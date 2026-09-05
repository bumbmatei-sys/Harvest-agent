import { adminDb } from './firebase-admin';

/**
 * THE-314 — STOP handling. 🔴 The one consent obligation Harvest cannot push
 * down to the church.
 *
 * ─── Why this is Harvest's and not the church's ──────────────────────────────
 *
 * COLLECTING CONSENT IS THE CHURCH'S JOB. It composes the message, it holds the
 * relationship, it is the sender and the data controller; Harvest is the tool,
 * exactly as Mailchimp and Resend are. Nothing in this file collects an opt-IN,
 * and no opt-in flow exists anywhere in the product, deliberately.
 *
 * HONOURING STOP IS NOT THE SAME OBLIGATION. Every mobile carrier requires an
 * SMS sender to stop on STOP, and enforces it by flagging and then blocking the
 * NUMBER — and under the reseller model (see zernio.ts) that number and the
 * brand registration behind it are HARVEST'S. A church that ignores STOP would
 * get Harvest's account penalised, and every other church's messages with it.
 * So this is a control protecting the account, which is why it cannot be
 * delegated to the party whose behaviour it constrains.
 *
 * ─── Two independent guarantees, deliberately both ───────────────────────────
 *
 * 1. THE VENDOR ENFORCES IT. A recipient who replies STOP is opted out at the
 *    CARRIER, and the vendor then refuses any further send to that number with
 *    a 409 — documented as "never silently dropped". So even with this file
 *    deleted, a member who texts STOP receives nothing further.
 * 2. HARVEST ENFORCES IT ANYWAY. This mirror is written from the inbound
 *    webhook the moment a STOP keyword arrives, and the funnel checks it BEFORE
 *    calling the vendor.
 *
 * The mirror is not redundancy for its own sake. It buys three things the
 * vendor's refusal alone does not:
 *   · a broadcast to 400 members does not spend 400 round trips discovering
 *     opt-outs one 409 at a time;
 *   · the refusal is visible in the tenant's own smsLogs, so an admin can see
 *     WHY a member stopped receiving messages;
 *   · the guarantee survives a provider swap, which is the exact event this
 *     ticket is.
 *
 * Server-only, Admin SDK. `tenants/{t}/smsOptOuts/{digits}` has no rule in
 * firestore.rules and therefore no client read or write — same posture as
 * `integrations/*`, and the reason this ticket needs no rules change.
 */

/**
 * The carrier-standard opt-out keyword set. These five are the ones every US
 * carrier requires an SMS sender to honour; they are matched on the WHOLE
 * message body, case-insensitively, after trimming.
 *
 * ⚠️ Whole-body, not substring. "Please don't stop sending these" contains
 * "stop" and is not an opt-out; treating it as one would silently unsubscribe a
 * member who asked for the opposite.
 */
export const STOP_KEYWORDS = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'] as const;

/** The matching opt-IN keywords. A member who opted out must be able to come
 * back without asking an admin — the carriers require this half too. */
export const START_KEYWORDS = ['START', 'UNSTOP', 'YES'] as const;

/** Digits only, so `+1 (555) 123-4567` and `+15551234567` resolve to the same
 * document. The same normalisation the inbound number index already uses. */
export function optOutKey(phone: string): string {
  return (phone || '').replace(/\D/g, '');
}

function normalise(body: string): string {
  return (body || '').trim().toUpperCase();
}

export function isStopKeyword(body: string): boolean {
  return (STOP_KEYWORDS as readonly string[]).includes(normalise(body));
}

export function isStartKeyword(body: string): boolean {
  return (START_KEYWORDS as readonly string[]).includes(normalise(body));
}

function ref(tenantId: string, phone: string) {
  return adminDb.collection('tenants').doc(tenantId).collection('smsOptOuts').doc(optOutKey(phone));
}

/** Record that this number asked to stop. Idempotent. */
export async function recordOptOut(tenantId: string, phone: string, keyword: string): Promise<void> {
  const key = optOutKey(phone);
  if (!tenantId || !key) return;
  await ref(tenantId, phone).set(
    { phone, keyword: normalise(keyword), optedOutAt: new Date().toISOString() },
    { merge: true },
  );
}

/** Undo an opt-out after a START keyword. Deletes rather than flagging, so
 * `isOptedOut` stays a single existence check with no field to misread. */
export async function recordOptIn(tenantId: string, phone: string): Promise<void> {
  const key = optOutKey(phone);
  if (!tenantId || !key) return;
  await ref(tenantId, phone).delete();
}

/**
 * Is this number suppressed for this tenant?
 *
 * 🔴 FAILS CLOSED. If the lookup throws, the answer is "yes, suppressed" and
 * the send does not happen. Sending to someone who may have said STOP is the
 * failure that gets a number blocked; not sending is a message that arrives
 * late. Those are not comparable costs.
 */
export async function isOptedOut(tenantId: string | null, phone: string): Promise<boolean> {
  const key = optOutKey(phone);
  if (!tenantId || !key) return false;
  try {
    const snap = await ref(tenantId, phone).get();
    return snap.exists;
  } catch (e) {
    console.error('SMS opt-out lookup failed — refusing the send:', e);
    return true;
  }
}
