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

export type PlanId = TenantPlan; // 'free' | 'plus' | 'pro' | 'max'

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
   * `null` keeps the original #213 meaning — NOT metered (see sms-usage.ts):
   * `reserveSmsSegment` returns `{ allowed: true }` and writes nothing, and the
   * admin snapshot reports `smsSegmentsCap: null`.
   *
   * EVERY tier is null today, and that is the intended end state. Harvest does
   * not sell platform SMS at all — sending requires the tenant's OWN Twilio
   * credentials, which Twilio bills them for directly. There is no Harvest
   * allotment to ration, so there is nothing to cap. BYO volume was already
   * unmetered: it counts into `smsSegmentsByo`, which no gate ever reads.
   */
  smsSegmentsPerMonth: number | null;
}

// TUNE THESE — starting proposal, NOT verified against real tenant data.
// Query = monthly (resets). Ingest = total embedded tokens (persistent, never
// resets). Query numbers are the confirmed roadmap values. Ingest numbers are a
// proposal (plus ≈ 750 pages, max ≈ 15,000 pages @ ~660 embed tokens/page) —
// left tunable on purpose; they are NOT locked.
//
// `max` keeps its OWN token numbers (50M query / 10M ingest). It did not
// inherit the deleted `ultra` tier's 150M/30M: those are pure COGS with no
// marketing value at the higher number, and max sells at $199, not the $299
// ultra carried.
//
// SMS segments — ALL NULL, i.e. not metered. Harvest does not sell platform
// SMS; a tenant sends on their own Twilio credentials and Twilio bills them
// directly, so there is no Harvest allotment to ration. The previous
// 250/500/2,000 budgets on plus/pro/max were metering tiers whose
// `smsAutomation` plan flag was `false` — a budget for a feature those tiers
// could not reach. See `smsSegmentsPerMonth` above and sms-usage.ts.
//
// (A segment cap would bound VOLUME, not SPEND — the price per segment varies
// ~10× by country, US ~$0.0109 vs UK ~$0.04 vs Brazil ~$0.075. Sends are
// restricted to US destinations regardless; see sms-destination.ts.)
export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  // Forever Free — ZERO on both AI budgets, and that is a real value rather
  // than a placeholder: free carries `aiChat: false` and `aiKnowledge: false`,
  // so a free tenant reaches neither the RAG chat endpoint nor the ingest path.
  // A non-zero budget here would be COGS allocated to a tier that cannot spend
  // it, and the mirror of the defect this file already documents below — three
  // tiers metered for an SMS feature their plan flag denied them.
  //
  // ⚠️ It is deliberately 0 and not `null`. `null` on `smsSegmentsPerMonth`
  // means UNMETERED (reserve returns allowed and writes nothing); the token
  // fields carry no such sentinel, and 0 is the honest cap for a tier with no
  // AI. If the free tier is ever given a taste of AI chat, this is the one line
  // that changes.
  free: { queryTokensPerMonth: 0,          ingestTokensTotal: 0,          smsSegmentsPerMonth: null },
  plus: { queryTokensPerMonth: 2_000_000,  ingestTokensTotal: 500_000,    smsSegmentsPerMonth: null },
  pro:  { queryTokensPerMonth: 10_000_000, ingestTokensTotal: 2_000_000,  smsSegmentsPerMonth: null },
  max:  { queryTokensPerMonth: 50_000_000, ingestTokensTotal: 10_000_000, smsSegmentsPerMonth: null },
};

/** Fallback tier when a tenant's plan is missing/unknown — the most restrictive,
 * matching getPlanFeatures' 'plus' default so an unrecognized plan never gets
 * an accidentally generous cap. */
export const DEFAULT_PLAN_ID: PlanId = 'plus';

/** Resolve the limits for a plan id. Unknown/missing → DEFAULT_PLAN_ID limits. */
export function getPlanLimits(plan: string | null | undefined): PlanLimits {
  return PLAN_LIMITS[plan as PlanId] ?? PLAN_LIMITS[DEFAULT_PLAN_ID];
}
