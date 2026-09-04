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
   * 🔴 NOT NULL ANY MORE — THE-314. Harvest RESELLS: one vendor account, and
   * Harvest pays for every segment before billing the church. So there is a
   * Harvest allotment to ration again, and this is the control that rations it.
   * `null` (unmetered) on a tier that can send would now mean an unbounded bill
   * on Harvest's card.
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
// SMS segments — 0 EVERYWHERE EXCEPT MINISTRY (THE-314), which carries 2,000.
//
// 🔴 The two numbers say the same thing from opposite ends: only Ministry can
// send, and Ministry's sending is bounded. `smsAutomation` is true on `max`
// alone, so the send funnel refuses the other three tiers before the cap is
// ever consulted — and the 0 here is the SECOND lock on the same door. Belt and
// braces on a money path is deliberate: if a future call site ever reached the
// funnel with the plan gate bypassed, the cap still refuses rather than
// spending. `null` would have let it spend without limit.
//
// 2,000 is the figure `max` carried before the budgets were retired, restored
// rather than reinvented. At the vendor's rates (~$0.008 per US segment) a full
// month costs Harvest roughly $16 against a $199 tier, alongside ~$3/month for
// the number itself and the one brand-level carrier campaign fee Harvest pays
// once for every church. It bounds a runaway, it does not ration normal use: a
// 400-member congregation can be texted five times a month inside it.
//
// ⚠️ IT BOUNDS VOLUME, NOT SPEND — the per-segment price varies ~10x by
// destination country. That is survivable only because the US-only destination
// gate in sms-destination.ts holds; if international sending is ever opened,
// this cap stops being a spend control and must be revisited.
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
  free: { queryTokensPerMonth: 0,          ingestTokensTotal: 0,          smsSegmentsPerMonth: 0 },
  plus: { queryTokensPerMonth: 2_000_000,  ingestTokensTotal: 500_000,    smsSegmentsPerMonth: 0 },
  pro:  { queryTokensPerMonth: 10_000_000, ingestTokensTotal: 2_000_000,  smsSegmentsPerMonth: 0 },
  max:  { queryTokensPerMonth: 50_000_000, ingestTokensTotal: 10_000_000, smsSegmentsPerMonth: 2_000 },
};

/** Fallback tier when a tenant's plan is missing/unknown — the most restrictive,
 * matching getPlanFeatures' 'plus' default so an unrecognized plan never gets
 * an accidentally generous cap. */
export const DEFAULT_PLAN_ID: PlanId = 'plus';

/** Resolve the limits for a plan id. Unknown/missing → DEFAULT_PLAN_ID limits. */
export function getPlanLimits(plan: string | null | undefined): PlanLimits {
  return PLAN_LIMITS[plan as PlanId] ?? PLAN_LIMITS[DEFAULT_PLAN_ID];
}
