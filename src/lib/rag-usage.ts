import { adminDb } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getPlanLimits, type PlanLimits } from '@/lib/planLimits';

// ─────────────────────────────────────────────────────────────────────────────
// HARVEST — RAG usage metering (server-only; Admin SDK)
//
// Two independent per-tenant limits, both in TOKENS (see planLimits.ts):
//   • QUERY  — a monthly FLOW.  Doc: tenants/{tenantId}/usage/{YYYY-MM}
//              field `queryTokens`. Month-keyed → resets with no cron; a TTL
//              field (`expiresAt`) lets Firestore sweep finished months.
//   • INGEST — a persistent STOCK. Doc: tenants/{tenantId}/usage/ingest
//              field `ingestTokens`. Never resets.
//
// Why a separate `usage/ingest` doc rather than a field on the tenant doc:
//   (1) keeps every usage counter under ONE subcollection with one rules block;
//   (2) avoids coupling a hot, differently-gated doc (the tenant doc is read on
//       every page load) to the metering write path; (3) parallels the
//       month-keyed query docs so the admin indicator reads both the same way.
//
// Every read/write here is a DIRECT `.doc()` get — NO composite index needed.
// The whole module is Admin-SDK-only: the usage subcollection has no client
// rule, so it is default-DENY to every client (stricter than admin-gated). All
// client reads go through /api/rag-usage (also Admin SDK). Never meter against a
// null/transient tenantId, and never for a super admin (tenantId: null) — a
// write to tenants/null/usage/... is a bug; callers must gate on that.
// ─────────────────────────────────────────────────────────────────────────────

/** Keep a finished month's query doc ~this long past its month, then Firestore
 * TTL (a policy on the `usage.expiresAt` field) sweeps it. */
const QUERY_DOC_TTL_DAYS = 90;

function usageCol(tenantId: string) {
  return adminDb.collection('tenants').doc(tenantId).collection('usage');
}
function queryRef(tenantId: string, month: string) {
  return usageCol(tenantId).doc(month);
}
function ingestRef(tenantId: string) {
  return usageCol(tenantId).doc('ingest');
}

/** Current UTC month key, e.g. "2026-07". Server-side only. */
export function monthKey(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * ~4 chars/token documented APPROXIMATION — the fallback used only when a
 * provider does not return a real token count (Gemini embedContent on the
 * developer API exposes none; MiMo usually returns usage.total_tokens). Flagged
 * as an approximation at every call site.
 */
export function approxTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);
}

/** Read a tenant's plan and resolve its limits. Missing/unknown plan → 'plus'
 * (the most restrictive default). Never throws. */
export async function getTenantPlanLimits(tenantId: string): Promise<PlanLimits> {
  try {
    const snap = await adminDb.collection('tenants').doc(tenantId).get();
    const plan = snap.exists ? (snap.data()?.plan as string | undefined) : undefined;
    return getPlanLimits(plan);
  } catch {
    return getPlanLimits(undefined);
  }
}

/** TTL instant for a month's query doc: the 1st of that month + TTL days. */
function ttlTimestamp(month: string): Timestamp {
  const [y, m] = month.split('-').map(Number);
  const expire = new Date(Date.UTC(y, m - 1, 1));
  expire.setUTCDate(expire.getUTCDate() + QUERY_DOC_TTL_DAYS);
  return Timestamp.fromDate(expire);
}

// ── INGEST (persistent stock; hard pre-call gate) ────────────────────────────

export interface IngestGate {
  allowed: boolean;
  used: number;
  ceiling: number;
}

/**
 * Atomically check-and-RESERVE ingest tokens BEFORE the embed call. Reserving
 * in the SAME transaction as the read is what stops two concurrent near-limit
 * requests from both passing a naive read-then-write. A missing doc reads as 0.
 * Returns `{ allowed:false }` (writes nothing) when this doc would cross the
 * ceiling — the caller must then block WITHOUT calling embedContent.
 */
export async function checkAndReserveIngest(tenantId: string, tokens: number): Promise<IngestGate> {
  const { ingestTokensTotal: ceiling } = await getTenantPlanLimits(tenantId);
  const ref = ingestRef(tenantId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const used: number = (snap.exists ? snap.data()?.ingestTokens : 0) ?? 0;
    if (used + tokens > ceiling) {
      return { allowed: false, used, ceiling };
    }
    tx.set(ref, { ingestTokens: used + tokens, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { allowed: true, used: used + tokens, ceiling };
  });
}

/**
 * Give reserved ingest tokens back when the embed call fails, so a provider
 * error never permanently eats a tenant's ceiling. Clamped at 0. Best-effort —
 * a failed refund is logged, not thrown.
 */
export async function refundIngest(tenantId: string, tokens: number): Promise<void> {
  if (tokens <= 0) return;
  const ref = ingestRef(tenantId);
  try {
    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const used: number = (snap.exists ? snap.data()?.ingestTokens : 0) ?? 0;
      tx.set(ref, { ingestTokens: Math.max(0, used - tokens), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
  } catch (e) {
    console.error('refundIngest failed:', e);
  }
}

// ── QUERY (monthly flow; soft pre-call gate + atomic post-call increment) ─────

export interface QueryBudget {
  allowed: boolean;
  used: number;
  cap: number;
}

/**
 * Read this month's query-token budget. Pre-call gate: allowed while STRICTLY
 * under cap. Token cost is known only after the MiMo response, so this permits
 * one final over-shoot query (acceptable) and blocks the NEXT one. A missing
 * doc reads as 0.
 */
export async function checkQueryBudget(tenantId: string, date: Date = new Date()): Promise<QueryBudget> {
  const { queryTokensPerMonth: cap } = await getTenantPlanLimits(tenantId);
  const snap = await queryRef(tenantId, monthKey(date)).get();
  const used: number = (snap.exists ? snap.data()?.queryTokens : 0) ?? 0;
  return { allowed: used < cap, used, cap };
}

/**
 * Atomically add ACTUAL query tokens to this month's counter (post-call).
 * FieldValue.increment is race-free, so concurrent answers never clobber each
 * other's count. Sets a TTL so old months self-expire. No-op for <= 0 tokens.
 */
export async function incrementQueryTokens(tenantId: string, tokens: number, date: Date = new Date()): Promise<void> {
  if (tokens <= 0) return;
  const month = monthKey(date);
  await queryRef(tenantId, month).set(
    {
      queryTokens: FieldValue.increment(tokens),
      updatedAt: FieldValue.serverTimestamp(),
      expiresAt: ttlTimestamp(month),
    },
    { merge: true },
  );
}

// ── Snapshot for the admin usage indicator ───────────────────────────────────

export interface UsageSnapshot {
  plan: string;
  month: string;
  queryTokensUsed: number;
  queryTokensCap: number;
  ingestTokensUsed: number;
  ingestTokensCeiling: number;
}

/** Read both counters + limits for the admin usage indicator. Missing docs read
 * as 0. */
export async function getUsageSnapshot(tenantId: string, date: Date = new Date()): Promise<UsageSnapshot> {
  const month = monthKey(date);
  const [tenantSnap, qSnap, iSnap] = await Promise.all([
    adminDb.collection('tenants').doc(tenantId).get(),
    queryRef(tenantId, month).get(),
    ingestRef(tenantId).get(),
  ]);
  const plan = (tenantSnap.exists ? (tenantSnap.data()?.plan as string | undefined) : undefined) || 'plus';
  const limits = getPlanLimits(plan);
  const queryTokensUsed: number = (qSnap.exists ? qSnap.data()?.queryTokens : 0) ?? 0;
  const ingestTokensUsed: number = (iSnap.exists ? iSnap.data()?.ingestTokens : 0) ?? 0;
  return {
    plan,
    month,
    queryTokensUsed,
    queryTokensCap: limits.queryTokensPerMonth,
    ingestTokensUsed,
    ingestTokensCeiling: limits.ingestTokensTotal,
  };
}
