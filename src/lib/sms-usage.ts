import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getPlanLimits } from '@/lib/planLimits';
import { monthKey, monthlyUsageTtl } from '@/lib/rag-usage';

// ─────────────────────────────────────────────────────────────────────────────
// HARVEST — SMS segment metering (server-only; Admin SDK)
//
// One per-tenant limit, a monthly FLOW measured in TWILIO SEGMENTS:
//   Doc: tenants/{tenantId}/usage/{YYYY-MM}   field: `smsSegments`
// That is the SAME month doc the RAG query counter uses (field `queryTokens`),
// with the same `expiresAt` TTL — one usage subcollection, one rules block, one
// TTL policy, no reset job. Every access is a DIRECT `.doc()` get, so NO
// composite index is needed. This mirrors rag-usage.ts on purpose; there is no
// second metering mechanism.
//
// ORDERING — check → send → increment by ACTUAL segments (the query-token
// pattern, not the ingest one). A message's segment count is known only from
// Twilio's `num_segments` in the send response, so it cannot be gated on
// beforehand; pre-ESTIMATING from body length would drift the counter
// permanently whenever the estimate disagreed with Twilio.
//
// But "read, then send, then increment" alone would let two concurrent
// near-limit sends both pass. So the gate ATOMICALLY RESERVES ONE SEGMENT — the
// minimum any send can possibly cost — inside a transaction (exactly how
// checkAndReserveIngest defeats the same race), and the post-send settle adds
// only the EXTRA segments Twilio actually charged. Net effect:
//   • two concurrent sends at cap-1 → exactly one passes;
//   • a multi-segment final message may overshoot the cap once, which is the
//     accepted trade-off and matches how #213 handles query tokens;
//   • a send that never happened (rejected destination, Twilio error) is
//     refunded, so it consumes no allotment.
//
// Never meter a null/transient tenantId and never a super admin (tenantId:
// null) — a write to tenants/null/usage/... is a bug. Callers resolve the
// tenant SERVER-SIDE from the authenticated request, never from client state.
// A missing usage doc reads as 0.
// ─────────────────────────────────────────────────────────────────────────────

function monthRef(tenantId: string, month: string) {
  return adminDb.collection('tenants').doc(tenantId).collection('usage').doc(month);
}

/** Read `smsSegments` off a month-doc snapshot. Missing doc / missing field → 0. */
function readSegments(snap: { exists: boolean; data: () => any }): number {
  return (snap.exists ? snap.data()?.smsSegments : 0) ?? 0;
}

/** Resolve a tenant's monthly segment cap. Missing/unknown plan → 'plus' (the
 * most restrictive default). `null` keeps #213's meaning: NOT metered. */
export async function getSmsSegmentCap(tenantId: string): Promise<number | null> {
  try {
    const snap = await adminDb.collection('tenants').doc(tenantId).get();
    const plan = snap.exists ? (snap.data()?.plan as string | undefined) : undefined;
    return getPlanLimits(plan).smsSegmentsPerMonth;
  } catch {
    return getPlanLimits(undefined).smsSegmentsPerMonth;
  }
}

export interface SmsGate {
  allowed: boolean;
  /** Segments used this month AFTER the reservation when allowed; the unchanged
   * count when blocked. */
  used: number;
  /** The plan cap, or null when the tier is unmetered. */
  cap: number | null;
}

/**
 * Atomically check-and-RESERVE one segment before a send. Reserving in the SAME
 * transaction as the read is what stops two concurrent near-limit sends from
 * both passing a naive read-then-write. A missing doc reads as 0.
 *
 * Returns `{ allowed:false }` and writes NOTHING when the tenant is already at
 * or over cap — the caller must then block WITHOUT calling Twilio. An unmetered
 * tier (`cap === null`) is always allowed and writes nothing.
 */
export async function reserveSmsSegment(tenantId: string, date: Date = new Date()): Promise<SmsGate> {
  const cap = await getSmsSegmentCap(tenantId);
  const month = monthKey(date);
  const ref = monthRef(tenantId, month);

  if (cap === null) {
    const snap = await ref.get();
    return { allowed: true, used: readSegments(snap), cap: null };
  }

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const used = readSegments(snap);
    if (used + 1 > cap) {
      return { allowed: false, used, cap };
    }
    tx.set(
      ref,
      { smsSegments: used + 1, updatedAt: FieldValue.serverTimestamp(), expiresAt: monthlyUsageTtl(month) },
      { merge: true },
    );
    return { allowed: true, used: used + 1, cap };
  });
}

/**
 * Settle a completed send: add the EXTRA segments beyond the one already
 * reserved, taking the count from Twilio's `num_segments`. A 1-segment message
 * settles to a no-op; a 3-segment message adds 2. FieldValue.increment is
 * race-free, so concurrent settles never clobber each other.
 *
 * `actualSegments` of 0 or 1 (including the "Twilio didn't tell us" case) keeps
 * the reserved 1 — a delivered message is never billed as free. Never negative:
 * a successful send is never refunded.
 */
export async function settleSmsSegments(
  tenantId: string,
  actualSegments: number,
  date: Date = new Date(),
): Promise<void> {
  const extra = Math.max(0, Math.floor(actualSegments) - 1);
  if (extra <= 0) return;
  const month = monthKey(date);
  await monthRef(tenantId, month).set(
    {
      smsSegments: FieldValue.increment(extra),
      updatedAt: FieldValue.serverTimestamp(),
      expiresAt: monthlyUsageTtl(month),
    },
    { merge: true },
  );
}

/**
 * Give the reserved segment back when the send did not happen (Twilio error,
 * network failure). A transient provider failure must never permanently eat a
 * tenant's allotment. Clamped at 0; best-effort — a failed refund is logged,
 * not thrown.
 */
export async function refundSmsSegment(tenantId: string, date: Date = new Date()): Promise<void> {
  const ref = monthRef(tenantId, monthKey(date));
  try {
    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const used = readSegments(snap);
      tx.set(ref, { smsSegments: Math.max(0, used - 1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
  } catch (e) {
    console.error('refundSmsSegment failed:', e);
  }
}

// ── Snapshot for the admin usage indicator ───────────────────────────────────

export interface SmsUsageSnapshot {
  plan: string;
  month: string;
  smsSegmentsUsed: number;
  /** null when the tier is unmetered. */
  smsSegmentsCap: number | null;
}

/** Read the counter + cap for the admin SMS usage indicator. Missing doc → 0. */
export async function getSmsUsageSnapshot(
  tenantId: string,
  date: Date = new Date(),
): Promise<SmsUsageSnapshot> {
  const month = monthKey(date);
  const [tenantSnap, monthSnap] = await Promise.all([
    adminDb.collection('tenants').doc(tenantId).get(),
    monthRef(tenantId, month).get(),
  ]);
  const plan = (tenantSnap.exists ? (tenantSnap.data()?.plan as string | undefined) : undefined) || 'plus';
  return {
    plan,
    month,
    smsSegmentsUsed: readSegments(monthSnap),
    smsSegmentsCap: getPlanLimits(plan).smsSegmentsPerMonth,
  };
}
