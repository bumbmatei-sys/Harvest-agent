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
// ─────────────────────────────────────────────────────────────────────────────

export type PlanId = TenantPlan; // 'plus' | 'pro' | 'max' | 'ultra'

export interface PlanLimits {
  /** Monthly RAG/chat query budget, in MiMo tokens. Resets each month. */
  queryTokensPerMonth: number;
  /** Total embedded-corpus ceiling, in Gemini embed tokens. Persistent. */
  ingestTokensTotal: number;
  /**
   * PLACEHOLDER ONLY — SMS metering (Twilio) is a SEPARATE prompt and is NOT
   * wired to anything here. This key exists so the shared limits table has one
   * home when SMS lands; `null` = not yet tuned. Do not meter against it.
   */
  smsSegmentsPerMonth: number | null;
}

// TUNE THESE — starting proposal, NOT verified against real tenant data.
// Query = monthly (resets). Ingest = total embedded tokens (persistent, never
// resets). Query numbers are the confirmed roadmap values. Ingest numbers are a
// proposal (plus ≈ 750 pages, ultra ≈ 45,000 pages @ ~660 embed tokens/page) —
// left tunable on purpose; they are NOT locked.
export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  plus:  { queryTokensPerMonth: 2_000_000,   ingestTokensTotal: 500_000,    smsSegmentsPerMonth: null },
  pro:   { queryTokensPerMonth: 10_000_000,  ingestTokensTotal: 2_000_000,  smsSegmentsPerMonth: null },
  max:   { queryTokensPerMonth: 50_000_000,  ingestTokensTotal: 10_000_000, smsSegmentsPerMonth: null },
  ultra: { queryTokensPerMonth: 150_000_000, ingestTokensTotal: 30_000_000, smsSegmentsPerMonth: null },
};

/** Fallback tier when a tenant's plan is missing/unknown — the most restrictive,
 * matching getPlanFeatures' 'plus' default so an unrecognized plan never gets
 * an accidentally generous cap. */
export const DEFAULT_PLAN_ID: PlanId = 'plus';

/** Resolve the limits for a plan id. Unknown/missing → DEFAULT_PLAN_ID limits. */
export function getPlanLimits(plan: string | null | undefined): PlanLimits {
  return PLAN_LIMITS[plan as PlanId] ?? PLAN_LIMITS[DEFAULT_PLAN_ID];
}
