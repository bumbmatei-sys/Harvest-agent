import { adminDb } from './firebase-admin';
import { checkDestination } from './sms-destination';
import { reserveSmsSegment, settleSmsSegments, refundSmsSegment, recordByoSegments } from './sms-usage';
import { getPlatformTwilioConfig } from './twilio-platform';
import { SMS_FEATURE_ENABLED, SMS_HIDDEN_MESSAGE } from './sms-feature';

/**
 * Twilio helpers. A tenant's OWN credentials are stored per-tenant (admin-only)
 * at tenants/{tenantId}/integrations/twilio and are only ever read server-side —
 * the auth token is never returned to the client.
 *
 * `sendSms` is the SINGLE outbound funnel. Every send path in the app goes
 * through it — sendAutomatedSms (checkin, pledge, event_registration), the
 * broadcast route, the settings test-send, and the Text-to-Give reply — so the
 * US-only destination gate and the segment cap live INSIDE it and cannot be
 * bypassed by adding a caller. Nothing else may POST to /Messages.json or return
 * a TwiML <Message>; both bill segments, and only this function meters them.
 *
 * TWO ACCOUNTS, TWO RULES. A send goes out either on HARVEST'S account
 * (`source: 'platform'` — Harvest pays Twilio) or on the TENANT'S OWN account
 * (`source: 'byo'` — Twilio bills the church directly):
 *   • the segment CAP is a Harvest cost control, so it binds on platform sends
 *     ONLY. Capping a BYO send would limit a church spending its own money on
 *     its own credentials, which protects nobody.
 *   • the US-only DESTINATION GATE applies to BOTH. It protects the SENDER from
 *     international per-segment rates (UK ≈ $0.04, BR ≈ $0.075 vs US ≈ $0.0109)
 *     and is a product policy — "US only for now; another country means BYOK" —
 *     not a Harvest cost control.
 * Today there is no platform account (see twilio-platform.ts), so every send
 * resolves to 'byo' and nothing is capped — which is right, because Harvest is
 * paying for none of it.
 */

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  templates?: Record<string, { enabled: boolean; text: string }>;
}

/** Whose Twilio account a send goes out on — and therefore who pays for it. */
export type SmsCredentialSource = 'platform' | 'byo';

/** Credentials plus the account they belong to. The source is derived HERE, in
 * the one place credentials are resolved, so it can never disagree with the
 * `cfg` a caller then hands to sendSms. */
export interface ResolvedTwilioConfig extends TwilioConfig {
  source: SmsCredentialSource;
}

const TWILIO_API = 'https://api.twilio.com/2010-04-01';

/**
 * Decide which account a tenant sends on, from an ALREADY-READ
 * integrations/twilio document. Tenant credentials win; otherwise fall back to
 * Harvest's platform account (see twilio-platform.ts — today it does not exist,
 * so this returns null and nothing can be sent).
 *
 * Exported so sms/incoming — which reads that same document for its
 * Text-to-Give config — resolves identically instead of hand-rolling the check.
 * One resolver, one answer, no way for the credentials and the declared source
 * to drift apart.
 *
 * `templates` are tenant CONTENT, not credentials, so they survive either way.
 */
export function resolveTwilioConfig(d: Partial<TwilioConfig> | undefined): ResolvedTwilioConfig | null {
  if (d?.accountSid && d?.authToken && d?.fromNumber) {
    return {
      accountSid: d.accountSid,
      authToken: d.authToken,
      fromNumber: d.fromNumber,
      templates: d.templates,
      source: 'byo',
    };
  }
  const platform = getPlatformTwilioConfig();
  return platform ? { ...platform, templates: d?.templates, source: 'platform' } : null;
}

export async function getTwilioConfig(tenantId: string): Promise<ResolvedTwilioConfig | null> {
  const snap = await adminDb.collection('tenants').doc(tenantId).collection('integrations').doc('twilio').get();
  return resolveTwilioConfig(snap.exists ? (snap.data() as Partial<TwilioConfig> | undefined) : undefined);
}

/** Which account this tenant's sends would go out on right now, or null when
 * neither is available (nothing can be sent). Returns no credentials — it is for
 * surfaces like /api/sms-usage that must know whether the cap applies without
 * touching the auth token. */
export async function getSmsCredentialSource(tenantId: string): Promise<SmsCredentialSource | null> {
  const cfg = await getTwilioConfig(tenantId);
  return cfg?.source ?? null;
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
  | 'send_failed'
  // THE-245 — the feature is hidden, so nothing was sent. Deliberately its own
  // code rather than reusing `send_failed`: `statusForCode` files it as
  // 'blocked', which is the truth ("we chose not to send") and reads correctly
  // to an admin next to the two other policy stops. Nothing sends while
  // SMS_FEATURE_ENABLED is false, so today this is returned and never logged.
  | 'feature_hidden';

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

/** Who to bill this send to, and WHOSE Twilio account it goes out on. BOTH
 * fields are required so no call site can silently skip metering or silently
 * escape the cap — the property #229 built this shape for is unchanged, it just
 * carries one more fact now.
 *
 * `tenantId: null` = deliberately unmetered (super admin, whose tenantId is
 * null — a `tenants/null/usage/...` write would be a bug).
 *
 * `source` says which account paid: 'platform' (Harvest's — the cap binds) or
 * 'byo' (the tenant's own credentials — Twilio bills them directly, so the cap
 * does NOT bind; usage is still recorded for the admin's own visibility). It is
 * DECLARED by the caller rather than inferred from `cfg` inside sendSms:
 * inference would be a guess about credentials sendSms did not resolve, and a
 * future call site could get it wrong invisibly. Callers get it from
 * `getTwilioConfig`/`resolveTwilioConfig`, which derive it where the credentials
 * are chosen, so `cfg` and `meter.source` cannot disagree.
 *
 * The US-only destination gate is independent of both fields and always applies. */
export interface SmsMeter {
  tenantId: string | null;
  source: SmsCredentialSource;
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
 *      consumes no allotment and costs nothing. Applies to every send, on
 *      either account.
 *   2. PLATFORM SENDS ONLY: atomically reserve one segment against the tenant's
 *      monthly cap. At cap, return before the Twilio call — nothing is sent and
 *      nothing is billed. A BYO send skips this entirely; it is the church's own
 *      Twilio account and their own bill.
 *   3. Send, then settle the counter with Twilio's real `num_segments`. A BYO
 *      send records its segments too (visibility only, never a limit).
 *   4. On a failed platform send, refund the reservation.
 */
export async function sendSms(
  cfg: { accountSid: string; authToken: string; fromNumber: string },
  to: string,
  body: string,
  meter: SmsMeter,
): Promise<SendSmsResult> {
  // 0. THE-245 MASTER SWITCH — before everything, including the cap reserve.
  //    This is THE server-side gate: sendSms is the single outbound funnel, so
  //    while the switch is off nothing in the app can reach Twilio, spend a
  //    segment or arrive on a phone — not the broadcast route, not the test
  //    send, not a Text-to-Give reply, not an automated trigger.
  //
  //    🔴 FIRST, AND DELIBERATELY BEFORE `reserveSmsSegment`. Gating after the
  //    reserve would consume a tenant's allotment for a message that was never
  //    sent. Nothing is metered, nothing is written, nothing is refunded,
  //    because nothing was ever taken.
  if (!SMS_FEATURE_ENABLED) {
    return { ok: false, error: SMS_HIDDEN_MESSAGE, code: 'feature_hidden' };
  }

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

  // 2. Monthly segment cap — PLATFORM SENDS ONLY. The cap exists so one tenant
  //    cannot run up an unbounded bill on HARVEST'S Twilio account; a BYO send
  //    is on the tenant's own credentials and Twilio invoices them directly, so
  //    there is no Harvest money to protect and no reason to stop the send.
  //    Super admins / non-tenant callers pass tenantId: null and are not metered
  //    on either account.
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
  // `capped` gates the reserve/settle/refund triad; `tenantId` alone still gates
  // every usage write, so a null tenant never touches tenants/null/usage.
  const capped = tenantId !== null && meter.source === 'platform';
  if (tenantId && capped) {
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
      // Only a platform send reserved anything, so only a platform send can have
      // something to give back. A BYO send records nothing until it succeeds.
      if (tenantId && capped) await refundSmsSegment(tenantId);
      return { ok: false, error: data?.message || `Twilio error ${resp.status}`, code: 'twilio_error' };
    }

    // 3. Settle with Twilio's real count. A 0 (never expected on this `From`
    //    path) leaves the reserved 1 standing rather than billing the send as
    //    free. Metering is best-effort: a Firestore hiccup must not turn a
    //    delivered message into a reported failure.
    //
    //    A BYO send is still COUNTED — into its own field, never against the
    //    cap — because the admin's usage surface is the only place a church can
    //    see its own SMS volume, and losing that would be a regression for the
    //    people this change is meant to stop penalising.
    const segments = parseNumSegments(data);
    if (tenantId) {
      try {
        if (capped) await settleSmsSegments(tenantId, segments);
        else await recordByoSegments(tenantId, segments);
      } catch (e) {
        console.error('SMS segment metering failed:', e);
      }
    }
    return { ok: true, sid: data?.sid, segments: Math.max(1, segments) };
  } catch (e: any) {
    if (tenantId && capped) await refundSmsSegment(tenantId);
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
 * always counted, and it declares the source of the very `cfg` it sends with —
 * capped on Harvest's account, counted-only on the tenant's own.
 * A blocked send (non-US member, or the monthly cap reached) is
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
    // THE-245 — return before the config read AND before the smsLogs write.
    //
    // 🔴 THE THREE CALLERS ARE CHECK-IN, EVENT REGISTRATION AND PLEDGE, and
    // none of them is harmed by this. All three are best-effort, none blocks on
    // the result, and every one of them ALREADY no-ops for any tenant with no
    // Twilio credentials or the trigger switched off — which is most of them.
    // A check-in is still recorded, a registration still confirms, a pledge is
    // still written, and all three email confirmations still send. What stops
    // is the text, which is the whole point: an untested path must not spend
    // money or reach a phone from a check-in either.
    //
    // Ahead of the log write on purpose: a suppressed send is not history, and
    // writing 'blocked' rows for messages nobody asked for would fill an
    // admin's smsLogs with noise about a feature they cannot see. Existing rows
    // are untouched.
    if (!SMS_FEATURE_ENABLED) return;
    if (!to) return;
    const cfg = await getTwilioConfig(tenantId);
    if (!cfg) return;
    const tpl = cfg.templates?.[triggerKey];
    if (!tpl?.enabled || !tpl.text) return;

    const body = renderTemplate(tpl.text, vars);
    const result = await sendSms(cfg, to, body, { tenantId, source: cfg.source });
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
  return code === 'non_us_destination' || code === 'sms_cap_reached' || code === 'feature_hidden'
    ? 'blocked'
    : 'failed';
}
