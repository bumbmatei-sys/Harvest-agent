import { adminDb } from './firebase-admin';
import { checkDestination } from './sms-destination';
import { reserveSmsSegment, settleSmsSegments, refundSmsSegment } from './sms-usage';

/**
 * Twilio helpers. Credentials are stored per-tenant (admin-only) at
 * tenants/{tenantId}/integrations/twilio and are only ever read server-side —
 * the auth token is never returned to the client.
 *
 * `sendSms` is the SINGLE outbound funnel. Every send path in the app goes
 * through it — sendAutomatedSms (checkin, pledge, event_registration), the
 * broadcast route, the settings test-send, and the Text-to-Give reply — so the
 * US-only destination gate and the per-tenant segment cap live INSIDE it and
 * cannot be bypassed by adding a caller. Nothing else may POST to
 * /Messages.json or return a TwiML <Message>; both bill segments, and only this
 * function meters them.
 */

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  templates?: Record<string, { enabled: boolean; text: string }>;
}

const TWILIO_API = 'https://api.twilio.com/2010-04-01';

export async function getTwilioConfig(tenantId: string): Promise<TwilioConfig | null> {
  const snap = await adminDb.collection('tenants').doc(tenantId).collection('integrations').doc('twilio').get();
  if (!snap.exists) return null;
  const d = snap.data() as Partial<TwilioConfig> | undefined;
  if (!d?.accountSid || !d?.authToken || !d?.fromNumber) return null;
  return { accountSid: d.accountSid, authToken: d.authToken, fromNumber: d.fromNumber, templates: d.templates };
}

function authHeader(sid: string, token: string): string {
  return 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
}

/** Verify credentials by fetching the account resource. */
export async function validateTwilio(sid: string, token: string): Promise<boolean> {
  try {
    const resp = await fetch(`${TWILIO_API}/Accounts/${sid}.json`, {
      headers: { Authorization: authHeader(sid, token) },
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/** Admin-facing copy shown when the monthly segment allotment is exhausted. */
export const SMS_CAP_MESSAGE =
  "You've used all of your plan's SMS segments for this month (it resets on the 1st). Upgrade your plan to keep sending.";

export type SendSmsCode =
  | 'non_us_destination'
  | 'invalid_destination'
  | 'sms_cap_reached'
  | 'twilio_error'
  | 'send_failed';

export interface SendSmsResult {
  ok: boolean;
  sid?: string;
  /** Twilio's OWN segment count for the delivered message (`num_segments`).
   * Present on success; this is what the counter is incremented by. */
  segments?: number;
  error?: string;
  code?: SendSmsCode;
  /** Resolved ISO country of the destination, when it could be determined. */
  country?: string | null;
  /** Present on `sms_cap_reached`, for the upgrade CTA. */
  used?: number;
  cap?: number | null;
}

/** Who to bill this send to. Required so no call site can silently skip
 * metering. `tenantId: null` = deliberately unmetered (super admin, whose
 * tenantId is null — a `tenants/null/usage/...` write would be a bug). The
 * destination gate still applies. */
export interface SmsMeter {
  tenantId: string | null;
}

/**
 * Twilio returns `num_segments` as a STRING (e.g. "2") on the message resource.
 * It is the real, authoritative count for the body Twilio just accepted — never
 * estimate from body length instead, or the counter drifts from the bill.
 *
 * It is accurate here because this function sends with `From` (a plain phone
 * number). Twilio documents that a create request using `From` is analysed
 * immediately and the response carries the segment count; only a request sent
 * via a Messaging Service SID comes back with `num_segments: 0`, because no
 * sender has been assigned yet. If this ever moves to a Messaging Service, the
 * count must instead be read from a status callback — see the 0 handling below.
 */
function parseNumSegments(data: any): number {
  const n = Number(data?.num_segments);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Send a single SMS, gated and metered.
 *
 * Order is deliberate: DESTINATION → CAP → Twilio → settle.
 *   1. Reject a non-US destination BEFORE anything else, so a rejected send
 *      consumes no allotment and costs nothing.
 *   2. Atomically reserve one segment against the tenant's monthly cap. At cap,
 *      return before the Twilio call — nothing is sent and nothing is billed.
 *   3. Send, then settle the counter with Twilio's real `num_segments`.
 *   4. On a failed send, refund the reservation.
 */
export async function sendSms(
  cfg: { accountSid: string; authToken: string; fromNumber: string },
  to: string,
  body: string,
  meter: SmsMeter,
): Promise<SendSmsResult> {
  // 1. US-only destination gate — before the cap check and before Twilio.
  const dest = checkDestination(to);
  if (!dest.allowed) {
    return {
      ok: false,
      error: dest.reason,
      code: dest.country && dest.country !== 'US' ? 'non_us_destination' : 'invalid_destination',
      country: dest.country,
    };
  }

  // 2. Per-tenant monthly segment cap. Super admins / non-tenant callers pass
  //    tenantId: null and are not metered.
  //
  //    The reserve runs a Firestore transaction, which can throw. It MUST NOT
  //    escape: sendSms's contract is that it always returns a SendSmsResult, and
  //    callers depend on it — sendAutomatedSms would skip its smsLogs write (the
  //    silent drop this whole path is built to avoid), the test route would 500
  //    instead of answering, and a broadcast would abort mid-flight without
  //    writing its history doc. Fail CLOSED: if the allotment cannot be
  //    verified, do not send. An unmetered send is exactly the unbounded bill
  //    this cap exists to prevent, and #213 fails closed on the same call.
  const tenantId = meter.tenantId;
  if (tenantId) {
    let gate;
    try {
      gate = await reserveSmsSegment(tenantId);
    } catch (e) {
      console.error('SMS segment reservation failed:', e);
      return { ok: false, error: 'Could not verify your SMS allotment — please try again.', code: 'send_failed' };
    }
    if (!gate.allowed) {
      return { ok: false, error: SMS_CAP_MESSAGE, code: 'sms_cap_reached', used: gate.used, cap: gate.cap };
    }
  }

  try {
    const params = new URLSearchParams({ To: to, From: cfg.fromNumber, Body: body });
    const resp = await fetch(`${TWILIO_API}/Accounts/${cfg.accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(cfg.accountSid, cfg.authToken),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      if (tenantId) await refundSmsSegment(tenantId);
      return { ok: false, error: data?.message || `Twilio error ${resp.status}`, code: 'twilio_error' };
    }

    // 3. Settle with Twilio's real count. A 0 (never expected on this `From`
    //    path) leaves the reserved 1 standing rather than billing the send as
    //    free. Metering is best-effort: a Firestore hiccup must not turn a
    //    delivered message into a reported failure.
    const segments = parseNumSegments(data);
    if (tenantId) {
      try {
        await settleSmsSegments(tenantId, segments);
      } catch (e) {
        console.error('SMS segment metering failed:', e);
      }
    }
    return { ok: true, sid: data?.sid, segments: Math.max(1, segments) };
  } catch (e: any) {
    if (tenantId) await refundSmsSegment(tenantId);
    return { ok: false, error: e?.message || 'Send failed', code: 'send_failed' };
  }
}

/** Replace {placeholders} in a template with provided values. */
export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

/**
 * Fire an automated SMS for a trigger if the tenant has it enabled and a phone
 * number is available. Best-effort — never throws; logs to smsLogs.
 *
 * `tenantId` is the billing tenant: these triggers only ever fire from a public
 * form submission that already resolved its tenant server-side, so the send is
 * always metered. A blocked send (non-US member, or the monthly cap reached) is
 * recorded with a distinct status and the reason — smsLogs is the surface where
 * an admin finds out why a member never got their text, so it must never look
 * like a silent drop.
 */
export async function sendAutomatedSms(
  tenantId: string,
  triggerKey: string,
  to: string | null | undefined,
  vars: Record<string, string>,
): Promise<void> {
  try {
    if (!to) return;
    const cfg = await getTwilioConfig(tenantId);
    if (!cfg) return;
    const tpl = cfg.templates?.[triggerKey];
    if (!tpl?.enabled || !tpl.text) return;

    const body = renderTemplate(tpl.text, vars);
    const result = await sendSms(cfg, to, body, { tenantId });
    await adminDb.collection('tenants').doc(tenantId).collection('smsLogs').add({
      trigger: triggerKey,
      phone: to,
      status: result.ok ? 'delivered' : statusForCode(result.code),
      // errorCode keeps its long-standing meaning (the human-readable message);
      // the machine-readable code gets its own field rather than being dropped.
      errorCode: result.error || null,
      code: result.ok ? null : result.code ?? null,
      segments: result.ok ? result.segments ?? null : null,
      sentAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn(`Automated SMS (${triggerKey}) failed:`, e);
  }
}

/** smsLogs status for a non-delivery. `blocked` marks the two policy stops
 * (non-US destination, cap reached) so they read differently from a genuine
 * Twilio failure — an admin can tell "we chose not to send" from "it broke". */
function statusForCode(code?: SendSmsCode): string {
  return code === 'non_us_destination' || code === 'sms_cap_reached' ? 'blocked' : 'failed';
}
