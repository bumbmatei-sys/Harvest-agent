import type { TenantPlan } from '@/types/tenant.types';

// ─────────────────────────────────────────────────────────────────────────────
// HARVEST — shared per-plan usage limits (single source of truth)
//
// Leaf module: only imports the TenantPlan type (which erases at compile). Import
// PLAN_LIMITS / getPlanLimits everywhere metering runs — NEVER hardcode a limit
// at a call site, or the tiers drift.
//
// Both RAG limits are metered in TOKENS — the unit BOTH providers bill on — so
// the cap tracks real cost instead of drifting from it (a 500-page PDF dwarfs
// 100 FAQs, so a byte- or doc-count cap would be the wrong axis):
//   • queryTokensPerMonth — a FLOW. Monthly MiMo tokens spent answering
//     chat/RAG queries. Resets each month (month-keyed usage doc).
//   • ingestTokensTotal   — a STOCK. Total Gemini embed tokens spent embedding
//     documents into the knowledge base. Persistent, NEVER resets (capping the
//     embedded corpus, option C — not doc count, and not folded into the monthly
//     bucket, since embedding is one-time and conflating it would block querying
//     after a big upload).
//
// SMS is metered in SEGMENTS — the unit Twilio bills on — for the same reason:
//   • smsSegmentsPerMonth — a FLOW. Monthly Twilio segments. Resets each month
//     (shares the month-keyed usage doc with queryTokens).
// ─────────────────────────────────────────────────────────────────────────────

export type PlanId = TenantPlan; // 'plus' | 'pro' | 'max' | 'ultra'

export interface PlanLimits {
  /** Monthly RAG/chat query budget, in MiMo tokens. Resets each month. */
  queryTokensPerMonth: number;
  /** Total embedded-corpus ceiling, in Gemini embed tokens. Persistent. */
  ingestTokensTotal: number;
  /**
   * Monthly Twilio budget, in SEGMENTS (not messages). Resets each month.
   *
   * SEGMENTS, deliberately: Twilio bills per segment, and a body over 160 GSM-7
   * characters (70 for UCS-2 — any emoji or non-Latin character forces UCS-2)
   * splits into several. A 300-character template is 2 segments, so metering it
   * as "1 message" would undercount real cost by 2–3× and the cap would not
   * bind. The counter is fed by Twilio's own `num_segments`, never an estimate.
   *
   * `null` keeps the original #213 meaning — NOT metered (see sms-usage.ts).
   * No tier is null today.
   */
  smsSegmentsPerMonth: number | null;
}

// TUNE THESE — starting proposal, NOT verified against real tenant data.
// Query = monthly (resets). Ingest = total embedded tokens (persistent, never
// resets). Query numbers are the confirmed roadmap values. Ingest numbers are a
// proposal (plus ≈ 750 pages, ultra ≈ 45,000 pages @ ~660 embed tokens/page) —
// left tunable on purpose; they are NOT locked.
//
// SMS segments — all four CONFIRMED by Matei (ultra 2026-07-25; plus / pro /
// max signed off at merge). At the verified US rate (~$0.0079 + ~$0.003 carrier
// surcharge ≈ $0.0109/segment) the ultra ceiling costs ~$44/mo, 9.4% of the
// $479 plan. Unlike the ingest numbers above, these are LOCKED — change them
// only with the same sign-off, and update the pinning test in
// __tests__/sms-usage.test.ts alongside.
// A segment cap bounds VOLUME, not SPEND — the price per segment varies ~10× by
// country (UK ~$0.04, Brazil ~$0.075, where 4,000 segments would be ~$160 and
// ~$300). That is why sends are restricted to US destinations; see
// sms-destination.ts.
export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  plus:  { queryTokensPerMonth: 2_000_000,   ingestTokensTotal: 500_000,    smsSegmentsPerMonth: 250 },
  pro:   { queryTokensPerMonth: 10_000_000,  ingestTokensTotal: 2_000_000,  smsSegmentsPerMonth: 500 },
  max:   { queryTokensPerMonth: 50_000_000,  ingestTokensTotal: 10_000_000, smsSegmentsPerMonth: 2_000 },
  ultra: { queryTokensPerMonth: 150_000_000, ingestTokensTotal: 30_000_000, smsSegmentsPerMonth: 4_000 },
};

/** Fallback tier when a tenant's plan is missing/unknown — the most restrictive,
 * matching getPlanFeatures' 'plus' default so an unrecognized plan never gets
 * an accidentally generous cap. */
export const DEFAULT_PLAN_ID: PlanId = 'plus';

/** Resolve the limits for a plan id. Unknown/missing → DEFAULT_PLAN_ID limits. */
export function getPlanLimits(plan: string | null | undefined): PlanLimits {
  return PLAN_LIMITS[plan as PlanId] ?? PLAN_LIMITS[DEFAULT_PLAN_ID];
}
