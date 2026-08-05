import { TenantPlan } from '../types/tenant.types';

export interface PlanFeatures {
  /** Show blog tab in user app + blog management in admin */
  blog: boolean;
  /** Show AI chat in user app */
  aiChat: boolean;
  /** Show AI Knowledge Base in admin */
  aiKnowledge: boolean;
  /** Show church map in user app — free on every tier */
  map: boolean;
  /** Show global multi-church discovery directory */
  churchDirectory: boolean;
  /**
   * Max number of churches / campuses (0 = hidden, -1 = unlimited).
   *
   * ⚠️ A HARD CAP in the code today — AdminChurches blocks "Add church" at the
   * limit. The 2 / 4 / 6 / 8 figures are meant as an INCLUDED ALLOWANCE with
   * $10/campus overage above it on paid tiers, but that billing does not exist:
   * `stripe-config.ts` carries no per-campus price and nothing prices a campus
   * beyond the allowance. Until it does, a hard cap is the honest behaviour.
   * Do not read these numbers as "overage is implemented" — it is not.
   *
   * (Separately: `/api/churches/add-billing` already charges $10/mo for church
   * 2+ on `ultra` ONLY, via an inline Stripe `price_data`. That predates this
   * allowance and is untouched here — so on `ultra` churches 2–8 are still
   * billed despite being inside the allowance. Reconciling the two is the
   * per-campus billing work, not this change.)
   */
  maxChurches: number;
  /**
   * Max number of courses (-1 = unlimited).
   *
   * Enforced client-side only, mirroring `maxChurches`: AdminCourses gates the
   * "New course" button (fail closed on an unknown/loading plan — falls back
   * to 'plus'). This is bypassable by anyone crafting a Firestore write
   * directly, since firestore.rules does not enforce it — rules-level
   * enforcement is a separate hardening task, not done here. Blocks new
   * creation only; a tenant already over the limit (e.g. after a downgrade)
   * keeps their existing courses.
   */
  maxCourses: number;
  /** Max number of admin accounts (-1 = unlimited) */
  maxAdmins: number;
  /**
   * Max number of member accounts in the tenant (-1 = unlimited).
   *
   * ⚠️ A VALUE ONLY — nothing enforces it. There is no member cap in the code
   * today and this change deliberately does not add one: members arrive by
   * SELF-SIGNUP, so a hard block would reject a *visitor*, who has no way to
   * fix it. The agreed behaviour is to let them past the cap, notify the admin,
   * and gate something the admin controls instead — behavioural work that
   * belongs with the enforcement change, not with these values.
   *
   * COUNTING RULE (decided): count every user doc in the tenant, ADMINS
   * INCLUDED. One number, no role filter — a counter that depends on role data
   * being correct is a counter that will drift.
   */
  maxMembers: number;
  /** Allow custom domain — free on every tier */
  customDomain: boolean;
  /** Allow custom branding — logo, colors, ministry name — free on every tier */
  customBranding: boolean;
  // `customBackground` ("custom auth-page background image") was removed: no
  // background uploader was ever built anywhere in the app, so the flag sold a
  // capability that does not exist. It was true on exactly the tiers where
  // customBranding is true (max, ultra), so dropping it from the Branding-tab
  // gate (see hasBrandingAccess below) changed no tier's access. Don't re-add
  // it as a plan flag unless an uploader ships with it.
  /** Newsletter (manual + Mailchimp) — free on every tier */
  newsletterAutomation: boolean;
  /** AI-generated newsletter from Instagram — free on every tier */
  automatedNewsletter: boolean;
  /** SMS: manual broadcasts + automated event-registration/check-in/pledge triggers (see AdminSms TRIGGERS; scheduled broadcasts and other triggers are not promised) */
  smsAutomation: boolean;
  /** Number of AI assistants (0 = none, 1 = one, -1 = unlimited) */
  aiAssistant: number;
  /** Fundraising campaigns feature */
  fundraising: boolean;
  /** Event registration integration */
  eventRegistration: boolean;
  /** Docs / TipTap notes integration — free on every tier */
  docs: boolean;
  /** CRM for donors and members — free on every tier */
  crm: boolean;
  /** Accounting tools integration */
  accountingTools: boolean;
  /** Tax receipt generation */
  taxReceipt: boolean;
  /** Community groups — private channels + DMs — free on every tier */
  communityGroups: boolean;
  /** Custom forms → CRM pipeline — free on every tier */
  customForms: boolean;
  /** Check-in system with QR attendance — free on every tier */
  checkInSystem: boolean;
  /** Livestream + live giving — free on every tier */
  livestream: boolean;
  /** Sermon notes shared to livestream (viewer read-only panel) */
  sermonNotes: boolean;
  /** AI-generated SEO blog articles on schedule from Knowledge Base */
  automatedBlog: boolean;
  /** Annual giving statements (year-end tax summaries) — free on every tier */
  givingStatements: boolean;
  /** Public event calendar page — all plans (it's public-facing) */
  publicCalendar: boolean;
  /** Pledge campaigns — free on every tier */
  pledgeCampaigns: boolean;
  /** Text-to-Give via inbound SMS keyword */
  textToGive: boolean;
  /** Installable Progressive Web App (mobile app) — all plans */
  pwaApp: boolean;
  /**
   * Platform fee taken on donations, as a whole percentage (4 = 4%).
   *
   * Mirrors `PLATFORM_FEE_MAP` (src/lib/stripe-config.ts) by hand as
   * `fee * 100`; a test enforces the identity. See PLAN_PLATFORM_FEE_PCT below
   * before changing this.
   *
   * This REPLACED `donationRetention` (the `100 - fee * 100` complement). Two
   * numbers for one fact is what caused THE-51, where the app advertised
   * "keeps 100%" while a fee was deducted. The fee is now the only number, and
   * it is expressed the same way in both modules. Retention is retired — do
   * not reintroduce it in the app or on the marketing site.
   */
  platformFeePct: number;
}

// ─── Feature matrix ───────────────────────────────────────────────────────────
//
// IMPORTANT: this matrix must match the pricing table on theharvest.site.
// If you change any cell, update the marketing site copy too — or switch the
// marketing site to consume /api/plans so they can never drift again.
// The contract test in __tests__/plan-features.test.ts will fail CI if this
// matrix changes without an explicit update to that test.

// FREEMIUM MODEL: every feature is on for every tier except RAG (aiChat /
// aiKnowledge) and SMS (smsAutomation / textToGive). Paid tiers do not sell
// more FEATURES — they sell a LOWER DONATION FEE and HIGHER LIMITS. So the only
// cells that vary below are platformFeePct, the four max* limits, the two RAG
// cells, the two SMS cells and aiAssistant (the retired Telegram add-on).
//
// Consequence, by design: `FEATURE_MIN_PLAN` is now vacuous for features —
// every boolean feature's minimum plan derives to the free tier, so
// `hasFeature` always returns true for them and no upgrade screen can fire for
// a feature reason. Limits (and, later, the RAG add-on) are the upgrade reason.
const PLAN_FEATURES: Record<TenantPlan, PlanFeatures> = {
  // Seed — free
  plus: {
    blog: true,
    // RAG stays paid. Deliberately NOT flipped with the rest: it moves to
    // add-on gating in its own change, and turning it on here would be the
    // wrong shape.
    aiChat: false,
    aiKnowledge: false,
    map: true,
    churchDirectory: true,
    maxChurches: 2,
    maxCourses: 2,
    maxAdmins: 3,
    maxMembers: 250,
    customDomain: true,
    customBranding: true,
    newsletterAutomation: true,
    automatedNewsletter: true,
    // SMS stays paid — it has a hard per-segment carrier cost.
    smsAutomation: false,
    aiAssistant: 0,
    fundraising: true,
    eventRegistration: true,
    docs: true,
    crm: true,
    accountingTools: true,
    taxReceipt: true,
    communityGroups: true,
    customForms: true,
    checkInSystem: true,
    livestream: true,
    sermonNotes: true,
    automatedBlog: true,
    givingStatements: true,
    publicCalendar: true,
    pledgeCampaigns: true,
    // SMS-based (inbound keyword → Twilio), which is why it tracks SMS rather
    // than the everything-is-free rule. There is no non-SMS Text-to-Give path.
    textToGive: false,
    pwaApp: true,
    platformFeePct: 4,
  },
  // Root
  pro: {
    blog: true,
    aiChat: true,
    aiKnowledge: true,
    map: true,
    churchDirectory: true,
    maxChurches: 4,
    maxCourses: 5,
    maxAdmins: 9,
    maxMembers: 1_000,
    customDomain: true,
    customBranding: true,
    newsletterAutomation: true,
    automatedNewsletter: true,
    smsAutomation: true,
    aiAssistant: 0,
    fundraising: true,
    eventRegistration: true,
    docs: true,
    crm: true,
    accountingTools: true,
    taxReceipt: true,
    communityGroups: true,
    customForms: true,
    checkInSystem: true,
    livestream: true,
    sermonNotes: true,
    automatedBlog: true,
    givingStatements: true,
    publicCalendar: true,
    pledgeCampaigns: true,
    textToGive: true,
    pwaApp: true,
    platformFeePct: 2,
  },
  // Grove
  max: {
    blog: true,
    aiChat: true,
    aiKnowledge: true,
    map: true,
    churchDirectory: true,
    maxChurches: 6,
    maxCourses: 10,
    maxAdmins: 15,
    maxMembers: 5_000,
    customDomain: true,
    customBranding: true,
    newsletterAutomation: true,
    automatedNewsletter: true,
    smsAutomation: true,
    aiAssistant: 0,
    fundraising: true,
    eventRegistration: true,
    docs: true,
    crm: true,
    accountingTools: true,
    taxReceipt: true,
    communityGroups: true,
    customForms: true,
    checkInSystem: true,
    livestream: true,
    sermonNotes: true,
    automatedBlog: true,
    givingStatements: true,
    publicCalendar: true,
    pledgeCampaigns: true,
    textToGive: true,
    pwaApp: true,
    platformFeePct: 1,
  },
  // Harvest (top plan)
  ultra: {
    blog: true,
    aiChat: true,
    aiKnowledge: true,
    map: true,
    churchDirectory: true,
    maxChurches: 8,
    maxCourses: -1,
    maxAdmins: -1,
    maxMembers: -1,
    customDomain: true,
    customBranding: true,
    newsletterAutomation: true,
    automatedNewsletter: true,
    smsAutomation: true,
    aiAssistant: 1,
    fundraising: true,
    eventRegistration: true,
    docs: true,
    crm: true,
    accountingTools: true,
    taxReceipt: true,
    communityGroups: true,
    customForms: true,
    checkInSystem: true,
    livestream: true,
    sermonNotes: true,
    automatedBlog: true,
    givingStatements: true,
    publicCalendar: true,
    pledgeCampaigns: true,
    textToGive: true,
    pwaApp: true,
    platformFeePct: 0,
  },
};

// ─── Pricing (source of truth) ────────────────────────────────────────────────

/**
 * Base plan pricing in USD. Annual is monthly × 10 (pay ten months, get twelve)
 * on the paid tiers; `plus` is free, so it has no annual price — $0 has no
 * billing period.
 *
 * ⚠️ $179 for `max` is LOAD-BEARING — do not round it up to $199. Total monthly
 * cost at giving G is: plus 0.04G · pro 99 + 0.02G · max 179 + 0.01G ·
 * ultra 299. Those cross at $4,950 / $8,000 / $12,000, so every tier owns a
 * band of giving levels. At $199, pro→max and max→ultra BOTH cross at $10,000
 * and `max` is mathematically dominated — never the cheapest choice at any
 * giving level. The cause is structural: the fee gap shrinks each step
 * (2 → 1 → 1) while a flat $100 price step does not, so each price step must be
 * larger than the last. A rounder number reintroduces a dead tier.
 */
export const PLAN_PRICING: Record<TenantPlan, { monthlyUsd: number; yearlyUsd: number }> = {
  plus:  { monthlyUsd: 0,    yearlyUsd: 0    },
  pro:   { monthlyUsd: 99,   yearlyUsd: 990  },
  max:   { monthlyUsd: 179,  yearlyUsd: 1790 },
  ultra: { monthlyUsd: 299,  yearlyUsd: 2990 },
};

/**
 * Platform fee per plan as a whole percentage — the number shown to customers.
 *
 * These are a HAND-MAINTAINED MIRROR of `PLATFORM_FEE_MAP` in
 * `src/lib/stripe-config.ts`, which is the rate actually charged:
 *
 *     platformFeePct === PLATFORM_FEE_MAP[plan] * 100
 *
 * They are NOT derived from it in code, and deliberately so:
 * `stripe-config.ts` reads server-only `STRIPE_PRICE_*` env vars at module
 * load, while `plan-features.ts` is imported by ~20 client components. Importing
 * it here would drag those env reads into the browser bundle. Keep the mirror
 * manual; do not "simplify" it into an import.
 *
 * Because nothing enforces this structurally, `__tests__/plan-features.test.ts`
 * asserts the identity above for every plan. Never edit these values or the
 * `platformFeePct` cells in the feature matrix independently of
 * `PLATFORM_FEE_MAP` — change the fee, change both, and let the test confirm it.
 *
 * This replaced `PLAN_DONATION_RETENTION` (`100 - fee * 100`). The complement
 * was a second number for the same fact, and that duplication is what caused
 * THE-51. Retention is retired — in the app and on the marketing site. Show the
 * fee, phrased as a cost ("Platform fee — 2%"), never "your church keeps X%".
 *
 * Every value is an INTEGER (4 / 2 / 1 / 0). The previous scheme had 98.75 /
 * 1.25-shaped numbers where a `toFixed(1)` would have rendered a wrong number
 * on a pricing surface; that whole class of risk is gone. A test asserts
 * integrality so reintroducing a fractional fee fails loudly there first.
 */
export const PLAN_PLATFORM_FEE_PCT: Record<TenantPlan, number> = {
  plus:  PLAN_FEATURES.plus.platformFeePct,
  pro:   PLAN_FEATURES.pro.platformFeePct,
  max:   PLAN_FEATURES.max.platformFeePct,
  ultra: PLAN_FEATURES.ultra.platformFeePct,
};

/** AI Assistant add-on pricing (available on all plans; included on the top tier). */
export const AI_ASSISTANT_ADDON_PRICING = {
  monthlyUsd: 200,
} as const;

/**
 * Master switch for the AI (Telegram) Assistant feature across the whole app.
 * Set to `false` to hide every user-facing surface (settings tab, standalone
 * page, plan-comparison row, /api/plans availability). Backend routes, Stripe
 * wiring and the `aiAssistant` plan flag are intentionally left intact so the
 * feature can be re-enabled by flipping this one boolean back to `true`.
 */
export const AI_TELEGRAM_ASSISTANT_ENABLED = false;

// ─── Accessors ────────────────────────────────────────────────────────────────

/**
 * Get feature flags for a given plan.
 * Defaults to 'plus' if plan is unknown.
 */
export function getPlanFeatures(plan: TenantPlan): PlanFeatures {
  return PLAN_FEATURES[plan] || PLAN_FEATURES.plus;
}

/**
 * Coerce an untrusted plan value — a Firestore field, an API body, or a plan
 * that is still loading — to a TenantPlan, failing closed to 'plus'.
 *
 * This is the same fallback getPlanFeatures() has always applied at runtime via
 * `|| PLAN_FEATURES.plus`; callers just had no way to say so in the type system
 * and were passing a bare `string`. PLAN_FEATURES is the source of truth for
 * which ids are real, so adding a tier cannot leave this behind.
 */
export function toTenantPlan(plan: string | null | undefined): TenantPlan {
  return plan && Object.prototype.hasOwnProperty.call(PLAN_FEATURES, plan)
    ? (plan as TenantPlan)
    : 'plus';
}

/**
 * Human-readable display names for each plan tier.
 *
 * Internal IDs (plus/pro/max/ultra) stay the same ON PURPOSE: they are written
 * on every tenant doc in Firestore, so renaming them would be a data migration.
 * Only the names below change. Never put a plan name in UI copy by hand —
 * derive it from here (or from `getFeatureMinPlanName`), or the next rename
 * leaves a retired name stranded in a string literal.
 */
export const PLAN_DISPLAY_NAMES: Record<TenantPlan, string> = {
  plus: 'Seed',
  pro: 'Root',
  max: 'Grove',
  ultra: 'Harvest',
};

/** Get the display name for a given plan. Defaults to 'Seed' if unknown. */
export function getPlanDisplayName(plan: TenantPlan): string {
  return PLAN_DISPLAY_NAMES[plan] || PLAN_DISPLAY_NAMES.plus;
}

/**
 * Check if a specific feature is enabled for a plan.
 *
 * `aiAssistant` used to be an 'included' | 'addon' string; it is now a count
 * (0 = none, 1 = one, -1 = unlimited), so the number branch below covers it and
 * every other PlanFeatures member is a boolean. The old string branch was
 * unreachable — TypeScript narrowed its operand to `never` — and is gone.
 * Use `getPlanFeatures(plan).aiAssistant` directly for the count.
 */
export function hasFeature(plan: TenantPlan, feature: keyof PlanFeatures): boolean {
  const features = getPlanFeatures(plan);
  const value = features[feature];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return false;
}

// ─── Feature gates & minimum plan (derived) ───────────────────────────────────

/** Plan tiers cheapest → most expensive. Upgrade order; do not reorder. */
export const PLAN_ORDER: readonly TenantPlan[] = ['plus', 'pro', 'max', 'ultra'] as const;

/**
 * Gate keys used by `usePlanGate` and the upgrade screens. These are the
 * snake_case names threaded through UI call sites (e.g.
 * `<PlanUpgradeScreen featureKey="community_chat" />`); `FEATURE_MAP` translates
 * them to the camelCase `PlanFeatures` cells they actually gate on.
 */
export type FeatureKey =
  | 'fundraising'
  | 'event_registration'
  | 'docs'
  | 'crm'
  | 'accounting'
  | 'community_chat'
  | 'tax_receipts';

export const FEATURE_MAP: Record<FeatureKey, keyof PlanFeatures> = {
  fundraising: 'fundraising',
  event_registration: 'eventRegistration',
  docs: 'docs',
  crm: 'crm',
  accounting: 'accountingTools',
  community_chat: 'communityGroups',
  tax_receipts: 'taxReceipt',
};

/**
 * Cheapest plan that unlocks `feature`, or `null` if no plan does.
 *
 * DERIVED from `PLAN_FEATURES` — walk `PLAN_ORDER` and return the first tier
 * whose cell is truthy. This replaced two hand-maintained literal maps
 * (`FEATURE_MIN_PLAN` in usePlanGate.ts and `FEATURE_MIN_PLAN_NAME` in
 * PlanUpgradeScreen.tsx) that had silently drifted from the matrix: both listed
 * `crm` and `tax_receipts` as Ministry when Community (max) has had them for
 * some time, so upgrade screens told an Individual or Small Team admin to buy
 * the top plan when the tier below already unlocked the feature. Deriving makes
 * that class of drift structurally impossible — do not reintroduce a literal
 * map. (The repricing moved `crm` and `docs` down again, to Small Team; the
 * labels followed with no edit here, which is the point.)
 *
 * Truthiness matches `hasFeature`: numeric cells count as unlocked when non-zero.
 */
export function getFeatureMinPlan(feature: FeatureKey): TenantPlan | null {
  const key = FEATURE_MAP[feature];
  if (!key) return null;
  return getMinPlanForFeatureCell(key);
}

/**
 * Cheapest plan whose matrix cell `key` is truthy, or `null` if none is.
 *
 * Same derivation as `getFeatureMinPlan`, but keyed on the raw `PlanFeatures`
 * cell rather than a `FeatureKey` gate name. Not every cell has a `FeatureKey`
 * — those exist only for features fronted by `usePlanGate`/`PlanUpgradeScreen`
 * — so this is the way to derive a minimum-plan label for the rest (e.g.
 * `customDomain`, which is gated by a boolean prop, not a gate key). Use it
 * instead of writing a plan name into UI copy by hand: hardcoded names are
 * exactly what drifted in #242.
 */
export function getMinPlanForFeatureCell(key: keyof PlanFeatures): TenantPlan | null {
  return PLAN_ORDER.find((plan) => hasFeature(plan, key)) ?? null;
}

/**
 * Display name of the cheapest plan that unlocks `feature` (e.g. 'Grove').
 * Falls back to the top tier's name if nothing unlocks it, so upgrade copy can
 * never render an empty plan name.
 */
export function getFeatureMinPlanName(feature: FeatureKey): string {
  const plan = getFeatureMinPlan(feature);
  return plan ? PLAN_DISPLAY_NAMES[plan] : PLAN_DISPLAY_NAMES.ultra;
}

/**
 * Every gate key → the display name of its minimum plan, derived once at module
 * load. The single source both `usePlanGate` and `PlanUpgradeScreen` read, so
 * the two surfaces can never disagree. Frozen: it is derived state, not config.
 */
export const FEATURE_MIN_PLAN: Readonly<Record<FeatureKey, string>> = Object.freeze(
  Object.fromEntries(
    (Object.keys(FEATURE_MAP) as FeatureKey[]).map((k) => [k, getFeatureMinPlanName(k)])
  ) as Record<FeatureKey, string>
);

/**
 * Branding-family entitlement — does this plan's feature set unlock the admin
 * Branding tab/page? Extracted from AdminDashboard so the OR chain has exactly
 * one definition and can be asserted per tier in plan-features.test.ts.
 *
 * `customBackground` used to be a third term here. It was true on precisely the
 * tiers where `customBranding` is true (Community/max and Ministry/ultra), so
 * removing it left every tier's Branding access unchanged:
 *   Individual (plus) hidden · Small Team (pro) hidden · Community (max) shown ·
 *   Ministry (ultra) shown.
 */
export function hasBrandingAccess(features: PlanFeatures): boolean {
  return features.customBranding || features.customDomain;
}

/** Format a plan price as a display string, e.g. "$99/mo" (free tier: "$0/mo") */
export function formatPlanPrice(plan: TenantPlan, billing: 'monthly' | 'yearly'): string {
  const pricing = PLAN_PRICING[plan];
  if (!pricing) return 'Custom';
  const amount = billing === 'monthly' ? pricing.monthlyUsd : pricing.yearlyUsd;
  return `$${amount.toLocaleString()}/${billing === 'monthly' ? 'mo' : 'yr'}`;
}
