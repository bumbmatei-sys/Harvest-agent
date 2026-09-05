import { adminDb } from './firebase-admin';
import { checkDestination } from './sms-destination';
import { reserveSmsSegment, settleSmsSegments, refundSmsSegment } from './sms-usage';
import { isOptedOut } from './sms-optout';
import { zernioSendSms } from './zernio';
import { SMS_FEATURE_ENABLED, SMS_HIDDEN_MESSAGE } from './sms-feature';
import { getEffectiveFeatures, toTenantPlan, readTenantAddons } from '@/utils/plan-features';

/**
 * THE-314 — the SINGLE OUTBOUND FUNNEL, now on the new provider.
 *
 * This module replaces `lib/twilio.ts` as the send path. That file is still on
 * disk and still compiles, DELIBERATELY: it is the proven path, and until the
 * new one has run in production a dead module is cheaper than a broken send
 * path. Nothing imports it any more — see the retirement note at its head.
 *
 * ─── Every send in the product goes through `sendSms` ────────────────────────
 *
 * `sendAutomatedSms` (check-in, event registration, pledge), the broadcast
 * route, the settings test send, the Text-to-Give reply and `sendTenantSms`
 * (the interface a future feature calls) all funnel here, so all five gates
 * live in ONE place and cannot be skipped by adding a caller:
 *
 *   0. THE-245 master switch    — nothing sends while SMS is hidden.
 *   1. PLAN ENTITLEMENT         — 🔴 NEW. SMS is Ministry-only (THE-314).
 *   2. STOP suppression         — 🔴 carrier-mandated; see sms-optout.ts.
 *   3. US-only destination      — unchanged product policy.
 *   4. Monthly segment cap      — 🔴 now binds on EVERY send; see below.
 *
 * ─── 🔴 WHY THE CAP NOW BINDS ON EVERYTHING ──────────────────────────────────
 *
 * Under Twilio the cap bound on `source: 'platform'` only, because most sends
 * went out on a church's OWN credentials and Twilio invoiced the church. There
 * was no Harvest money to protect.
 *
 * Harvest now RESELLS: one vendor account, Harvest pays for every number and
 * every segment, and bills the church. So every send is a platform send, the
 * 'byo' branch has no producer left, and the cap is the whole cost control. An
 * unmetered send is money leaking directly out of Harvest.
 */

/** Whose account a send goes out on — and therefore who pays.
 *
 * ⚠️ 'byo' IS RETAINED BUT UNREACHABLE. No code path produces it any more: a
 * church holds no vendor credential under the reseller model. It is kept so the
 * meter's shape, `/api/sms-usage`'s two counters and the historical
 * `smsSegmentsByo` field in existing tenants' usage documents all keep meaning
 * what they meant — deleting it would silently reinterpret data already
 * written. */
export type SmsCredentialSource = 'platform' | 'byo';

export type SendSmsCode =
  | 'feature_hidden'
  | 'plan_not_entitled'
  | 'recipient_opted_out'
  | 'non_us_destination'
  | 'invalid_destination'
  | 'sms_cap_reached'
  | 'no_number'
  | 'provider_error'
  | 'send_failed';

export interface SendSmsResult {
  ok: boolean;
  sid?: string;
  /** The provider's OWN segment count for the delivered message — what the
   * counter is incremented by, and what Harvest is billed for. */
  segments?: number;
  error?: string;
  code?: SendSmsCode;
  country?: string | null;
  used?: number;
  cap?: number | null;
}

/** Who to bill this send to. `tenantId: null` = deliberately unmetered (a super
 * admin, whose tenantId is null — a `tenants/null/usage/...` write would be a
 * bug). Such a caller is also not plan-gated, because it has no plan. */
export interface SmsMeter {
  tenantId: string | null;
  source: SmsCredentialSource;
}

/** The tenant's purchased number, as stored at
 * `tenants/{t}/integrations/sms`. Server-only: that path has no rule in
 * firestore.rules, so no client reads it — the admin screen goes through
 * `/api/sms/numbers`. */
export interface TenantSmsNumber {
  numberId: string;
  phoneNumber: string;
  profileId: string;
  /** 'active' once the carrier registration is approved and the number can
   * actually deliver; 'pending_registration' while it cannot. */
  status: string;
  country: string;
  monthlyCostUsd: number | null;
  purchasedAt: string;
  templates?: Record<string, { enabled: boolean; text: string }>;
  text2give?: { keyword?: string; responseTemplate?: string; enabled?: boolean };
}

export const SMS_DOC = (tenantId: string) =>
  adminDb.collection('tenants').doc(tenantId).collection('integrations').doc('sms');

/** Admin-facing copy shown when the monthly segment allotment is exhausted. */
export const SMS_CAP_MESSAGE =
  "You've used all of your plan's SMS segments for this month (it resets on the 1st). Contact us if you need a larger allowance.";

/** Admin-facing copy for a tenant whose plan does not include SMS. */
export const SMS_PLAN_MESSAGE = 'SMS is available on the Ministry plan.';

/**
 * Read the tenant's number.
 *
 * ⚠️ `templates` and `text2give` are read from the NEW document and fall back
 * to the OLD `integrations/twilio` one. THE-245 promised that a church which
 * gets SMS back finds its configuration where it left it, and a provider swap
 * must not quietly break that promise: the automation templates and the
 * Text-to-Give keyword are tenant CONTENT, not vendor credentials, so they
 * survive the swap. Credentials on the old document are never read.
 */
export async function getTenantSmsNumber(tenantId: string): Promise<TenantSmsNumber | null> {
  const snap = await SMS_DOC(tenantId).get();
  if (!snap.exists) return null;
  const d = snap.data() as Partial<TenantSmsNumber> | undefined;
  if (!d?.numberId || !d?.phoneNumber) return null;

  let templates = d.templates;
  let text2give = d.text2give;
  if (!templates || !text2give) {
    const legacy = await adminDb
      .collection('tenants').doc(tenantId)
      .collection('integrations').doc('twilio')
      .get()
      .catch(() => null);
    const l = legacy?.exists ? (legacy.data() as any) : null;
    templates = templates ?? l?.templates;
    text2give = text2give ?? l?.text2give;
  }

  return {
    numberId: d.numberId,
    phoneNumber: d.phoneNumber,
    profileId: d.profileId || '',
    status: d.status || 'active',
    country: d.country || 'US',
    monthlyCostUsd: d.monthlyCostUsd ?? null,
    purchasedAt: d.purchasedAt || '',
    ...(templates ? { templates } : {}),
    ...(text2give ? { text2give } : {}),
  };
}

/**
 * Which account this tenant's sends go out on, or null when it has no number
 * and nothing can be sent. Always 'platform' now — Harvest owns every number.
 * Kept as a function rather than a constant because "has a number at all" is
 * the question `/api/sms-usage` and the super-admin panel actually ask.
 */
export async function getSmsCredentialSource(tenantId: string): Promise<SmsCredentialSource | null> {
  const number = await getTenantSmsNumber(tenantId);
  return number ? 'platform' : null;
}

/**
 * 🔴 THE MINISTRY GATE (THE-314).
 *
 * Resolved through `getEffectiveFeatures`, NEVER `getPlanFeatures` and never a
 * bare `plan === 'max'` comparison. That is not decoration: THE-253 established
 * that add-on capabilities are LIFTED with `||` and never assigned, and gating
 * on the raw plan here would close that door — the day SMS is sold as an add-on
 * to a lower tier, this call site already honours it and only
 * `getEffectiveFeatures` changes.
 *
 * FAILS CLOSED. A tenant document that cannot be read is a tenant whose
 * entitlement is unknown, and a send under the reseller model spends Harvest's
 * money. `toTenantPlan` fails closed to 'plus', which carries `smsAutomation:
 * false`, so an unreadable plan refuses rather than sends.
 */
async function isEntitledToSms(tenantId: string): Promise<boolean> {
  try {
    const snap = await adminDb.collection('tenants').doc(tenantId).get();
    if (!snap.exists) return false;
    const data = snap.data() as { plan?: unknown; addons?: unknown } | undefined;
    const plan = toTenantPlan(typeof data?.plan === 'string' ? data.plan : null);
    return getEffectiveFeatures(plan, readTenantAddons(data?.addons)).smsAutomation === true;
  } catch (e) {
    console.error('SMS entitlement lookup failed — refusing the send:', e);
    return false;
  }
}

/**
 * Send one message, gated and metered.
 *
 * Order is deliberate: SWITCH → PLAN → STOP → DESTINATION → CAP → provider →
 * settle. Every refusal that can be decided without spending anything is
 * decided BEFORE the reservation, so a refused send consumes no allotment and
 * costs nothing.
 */
export async function sendSms(
  number: { phoneNumber: string },
  to: string,
  body: string,
  meter: SmsMeter,
): Promise<SendSmsResult> {
  // 0. THE-245 master switch — before everything, including the reserve.
  if (!SMS_FEATURE_ENABLED) {
    return { ok: false, error: SMS_HIDDEN_MESSAGE, code: 'feature_hidden' };
  }

  const tenantId = meter.tenantId;

  // 1. 🔴 PLAN ENTITLEMENT. Inside the funnel rather than at each call site, so
  //    that "SMS is Ministry-only" is a property of the send path itself and not
  //    a rule four routes each remember separately. A super admin (tenantId
  //    null) has no plan and is not gated here.
  //
  //    The extra tenant read costs one get per send, including per recipient of
  //    a broadcast. That is accepted on purpose: the alternative is a caller
  //    passing in a pre-resolved answer, which is exactly the shape that lets a
  //    future call site get it wrong invisibly.
  if (tenantId && !(await isEntitledToSms(tenantId))) {
    return { ok: false, error: SMS_PLAN_MESSAGE, code: 'plan_not_entitled' };
  }

  // 2. 🔴 STOP. Before the destination check and before anything is reserved.
  //    Carrier-mandated, and under the reseller model the number it protects is
  //    Harvest's. `isOptedOut` fails CLOSED — see sms-optout.ts.
  if (await isOptedOut(tenantId, to)) {
    return {
      ok: false,
      error: 'This person has replied STOP and will not receive messages.',
      code: 'recipient_opted_out',
    };
  }

  // 3. US-only destination gate.
  const dest = checkDestination(to);
  if (!dest.allowed) {
    return {
      ok: false,
      error: dest.reason,
      code: dest.country && dest.country !== 'US' ? 'non_us_destination' : 'invalid_destination',
      country: dest.country,
    };
  }

  // 4. Monthly segment cap. 🔴 Now on EVERY tenant send — Harvest pays for all
  //    of them. Fails CLOSED: if the allotment cannot be verified, do not send.
  //    An unmetered send is the unbounded bill this cap exists to prevent.
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

  const result = await zernioSendSms({ from: number.phoneNumber, to, text: body });

  if (!result.ok) {
    // Nothing was sent, so give the reservation back.
    if (tenantId) await refundSmsSegment(tenantId);
    if (result.optedOut) {
      // The vendor refused at the carrier. Mirror it locally so the next send
      // to this number is refused before the round trip.
      const { recordOptOut } = await import('./sms-optout');
      if (tenantId) await recordOptOut(tenantId, to, 'STOP').catch(() => {});
      return {
        ok: false,
        error: 'This person has replied STOP and will not receive messages.',
        code: 'recipient_opted_out',
      };
    }
    return { ok: false, error: result.error || 'Send failed', code: 'provider_error' };
  }

  // 5. Settle with the provider's real count. Metering is best-effort in the
  //    sense that a Firestore hiccup must not turn a DELIVERED message into a
  //    reported failure — but it is never skipped, and never settles to 0.
  const segments = result.segments ?? 1;
  if (tenantId) {
    try {
      await settleSmsSegments(tenantId, segments);
    } catch (e) {
      console.error('SMS segment metering failed:', e);
    }
  }
  return { ok: true, sid: result.id, segments: Math.max(1, segments) };
}

/**
 * 🔴 THE INTERFACE ANOTHER FEATURE CALLS — one message, one person.
 *
 * ⚠️ THE-313 PART 3 (service-plan notifications: "you are on for the 14th",
 * accept/decline, reminders, unfilled-slot warnings) is the caller this exists
 * for. It was scoped email-only precisely because SMS was off; this ticket owes
 * it a send path and nothing more. THE SERVICE-PLAN INTEGRATION IS NOT BUILT
 * HERE and must not be.
 *
 * Everything a caller would otherwise have to remember is already inside:
 * the tenant's number is resolved, the plan is checked, STOP is honoured, the
 * destination is gated and the segment is metered. A caller supplies a tenant,
 * a phone number and a body; it never resolves credentials, never touches the
 * meter and never reaches the provider.
 *
 * 🔴 DO NOT ADD A SECOND SEND PATH. Anything that POSTs to the provider outside
 * this funnel escapes the cap, and under the reseller model that is Harvest's
 * money.
 */
export async function sendTenantSms(tenantId: string, to: string, body: string): Promise<SendSmsResult> {
  if (!SMS_FEATURE_ENABLED) {
    return { ok: false, error: SMS_HIDDEN_MESSAGE, code: 'feature_hidden' };
  }
  const number = await getTenantSmsNumber(tenantId);
  if (!number) {
    return { ok: false, error: 'This ministry has no SMS number yet.', code: 'no_number' };
  }
  return sendSms(number, to, body, { tenantId, source: 'platform' });
}

/** Replace {placeholders} in a template with provided values. */
export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

/**
 * Fire an automated SMS for a trigger. Best-effort — never throws; logs to
 * smsLogs.
 *
 * 🔴 THE THREE CALLERS ARE CHECK-IN, EVENT REGISTRATION AND PLEDGE, and none is
 * harmed when this does nothing: all three are best-effort, none blocks on the
 * result, and every one already no-ops for a tenant with no number or the
 * trigger switched off. A check-in is still recorded, a registration still
 * confirms, a pledge is still written, and every email confirmation still sends.
 */
export async function sendAutomatedSms(
  tenantId: string,
  triggerKey: string,
  to: string | null | undefined,
  vars: Record<string, string>,
): Promise<void> {
  try {
    if (!SMS_FEATURE_ENABLED) return;
    if (!to) return;
    const number = await getTenantSmsNumber(tenantId);
    if (!number) return;
    const tpl = number.templates?.[triggerKey];
    if (!tpl?.enabled || !tpl.text) return;

    const body = renderTemplate(tpl.text, vars);
    const result = await sendSms(number, to, body, { tenantId, source: 'platform' });
    await adminDb.collection('tenants').doc(tenantId).collection('smsLogs').add({
      trigger: triggerKey,
      phone: to,
      status: result.ok ? 'delivered' : statusForCode(result.code),
      errorCode: result.error || null,
      code: result.ok ? null : result.code ?? null,
      segments: result.ok ? result.segments ?? null : null,
      sentAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn(`Automated SMS (${triggerKey}) failed:`, e);
  }
}

/** smsLogs status for a non-delivery. `blocked` marks the POLICY stops so they
 * read differently from a genuine provider failure — an admin can tell "we
 * chose not to send" from "it broke". A STOP is the clearest such case: the
 * member asked, and an admin reading the log must see that rather than an
 * error. */
export function statusForCode(code?: SendSmsCode): string {
  return code === 'non_us_destination' ||
    code === 'sms_cap_reached' ||
    code === 'feature_hidden' ||
    code === 'plan_not_entitled' ||
    code === 'recipient_opted_out'
    ? 'blocked'
    : 'failed';
}
