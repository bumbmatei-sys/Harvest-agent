import { TenantPlan } from '../types/tenant.types';

export interface PlanFeatures {
  /** Show blog tab in user app + blog management in admin */
  blog: boolean;
  /** Show AI chat in user app */
  aiChat: boolean;
  /** Show AI Knowledge Base in admin */
  aiKnowledge: boolean;
  /** Show church map in user app (pro and above) */
  map: boolean;
  /** Show global multi-church discovery directory (Ministry / max only) */
  churchDirectory: boolean;
  /** Max number of churches (0 = hidden, -1 = unlimited) */
  maxChurches: number;
  /**
   * Max number of contacts (-1 = unlimited).
   *
   * VALUES ONLY — nothing enforces this yet. No contact cap exists anywhere in
   * the app today; this cell is the published number so the plan matrix, the
   * public /api/plans catalog and the in-app comparison all read from one
   * place instead of a marketing page.
   *
   * It lives here rather than in PLAN_LIMITS (src/lib/planLimits.ts) because
   * PLAN_LIMITS holds METERED flows and stocks — token and segment budgets fed
   * by a per-tenant monthly usage doc. Contacts are a static entity count, the
   * same shape as maxCourses / maxAdmins / maxChurches, so it belongs with
   * them.
   *
   * When enforcement lands it mirrors the `maxCourses` shape below: gated
   * client-side only (bypassable by a direct Firestore write, since
   * firestore.rules does not enforce it — rules-level enforcement is a separate
   * hardening task), blocking new creation only; a tenant already over the
   * limit (e.g. after a downgrade) keeps their existing contacts.
   */
  maxContacts: number;
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
  /** Allow custom domain (Community / max+) */
  customDomain: boolean;
  /** Allow custom branding — logo, colors, ministry name (Community / max+) */
  customBranding: boolean;
  // `customBackground` ("custom auth-page background image") was removed: no
  // background uploader was ever built anywhere in the app, so the flag sold a
  // capability that does not exist. It was true on exactly the tiers where
  // customBranding is true (at the time, Community/max and the since-deleted
  // Ministry/ultra tier), so dropping it from the Branding-tab gate (see
  // hasBrandingAccess below) changed no tier's access. Don't re-add it as a
  // plan flag unless an uploader ships with it.
  //
  // `publicCalendar` was removed for the same reason, and on the same
  // precedent: no public event-calendar page exists anywhere in the app. It was
  // `true` on every tier, so nothing ever gated on it and removing it changed
  // no tier's access — it only stopped the matrix (and the public /api/plans
  // catalog) advertising a capability that was never built. Don't re-add it
  // unless a calendar ships with it.
  /** Newsletter (manual + Mailchimp) — Small Team / pro+ */
  newsletterAutomation: boolean;
  /** AI-generated newsletter from Instagram (Community / max+) */
  automatedNewsletter: boolean;
  /**
   * SMS: manual broadcasts + automated event-registration/check-in/pledge
   * triggers (see AdminSms TRIGGERS; scheduled broadcasts and other triggers
   * are not promised).
   *
   * `true` on EVERY tier, deliberately. SMS is no longer sold by plan: Harvest
   * does not offer platform SMS at all, so the only thing deciding whether a
   * tenant can send is whether they have connected their OWN Twilio
   * credentials. A plan cell gating a capability the plan does not supply
   * gates nothing.
   *
   * This also retires a live bug: plus/pro/max each carried a monthly Twilio
   * segment budget in PLAN_LIMITS while this cell was `false` — three tiers
   * metered for a feature they could not reach. Those budgets are now `null`
   * (unmetered); see src/lib/planLimits.ts.
   */
  smsAutomation: boolean;
  /** Number of AI assistants (0 = none, 1 = one, -1 = unlimited) */
  aiAssistant: number;
  /** Fundraising campaigns feature */
  fundraising: boolean;
  /** Event registration integration */
  eventRegistration: boolean;
  /** Docs / TipTap notes integration (Small Team / pro+) */
  docs: boolean;
  /** CRM for donors and members (Small Team / pro+) */
  crm: boolean;
  /** Accounting tools integration */
  accountingTools: boolean;
  /** Tax receipt generation */
  taxReceipt: boolean;
  /** Community groups — private channels + DMs (Community / max+) */
  communityGroups: boolean;
  /** Custom forms → CRM pipeline (Community / max+) */
  customForms: boolean;
  /** Check-in system with QR attendance (Small Team / pro+) */
  checkInSystem: boolean;
  /** Livestream + live giving (Small Team / pro+) */
  livestream: boolean;
  /** Sermon notes shared to livestream (viewer read-only panel) */
  sermonNotes: boolean;
  /** AI-generated SEO blog articles on schedule from Knowledge Base */
  automatedBlog: boolean;
  /** Annual giving statements (year-end tax summaries) — Ministry / max+ */
  givingStatements: boolean;
  /** Pledge campaigns — Ministry (max) and above */
  pledgeCampaigns: boolean;
  /** Text-to-Give via inbound SMS keyword — BYO Twilio, all plans */
  textToGive: boolean;
  /** Installable Progressive Web App (mobile app) — all plans */
  pwaApp: boolean;
  // `donationRetention` ("percentage of a donation the ministry keeps") was
  // removed with the move to a flat 0% platform fee on every tier. It was a
  // hand-maintained complement of PLATFORM_FEE_MAP (`100 - fee * 100`), and
  // that duplication is what once let the app advertise "keeps 100%" while
  // actually charging 2.5%. With PLATFORM_FEE_MAP now { plus: 0, pro: 0,
  // max: 0 } the field is a constant 100 on every tier — it carries no
  // information and can only drift again. Read PLATFORM_FEE_MAP
  // (src/lib/stripe-connect.ts) directly; it is the rate actually charged.
}

// ─── Feature matrix ───────────────────────────────────────────────────────────
//
// IMPORTANT: this matrix must match the pricing table on theharvest.site.
// If you change any cell, update the marketing site copy too — or switch the
// marketing site to consume /api/plans so they can never drift again.
// The contract test in __tests__/plan-features.test.ts will fail CI if this
// matrix changes without an explicit update to that test.

const PLAN_FEATURES: Record<TenantPlan, PlanFeatures> = {
  // Individual — $49/mo
  plus: {
    blog: true,
    // AI chat is available on Small Team (pro) and above; gated to match the pricing page.
    aiChat: false,
    aiKnowledge: false,
    map: false,
    churchDirectory: false,
    maxChurches: 1,
    maxContacts: 150,
    maxCourses: 2,
    maxAdmins: 2,
    customDomain: false,
    customBranding: false,
    newsletterAutomation: false,
    automatedNewsletter: false,
    // SMS is BYO-only on every tier — see the block comment above `smsAutomation`
    // in PlanFeatures. Platform SMS is not sold, so the plan no longer gates it.
    smsAutomation: true,
    aiAssistant: 0,
    fundraising: true,
    eventRegistration: false,
    docs: false,
    crm: false,
    accountingTools: false,
    taxReceipt: false,
    communityGroups: false,
    customForms: false,
    checkInSystem: false,
    livestream: false,
    sermonNotes: false,
    automatedBlog: false,
    givingStatements: false,
    pledgeCampaigns: false,
    textToGive: true,
    pwaApp: true,
  },
  // Small Team — $99/mo
  pro: {
    blog: true,
    aiChat: true,
    aiKnowledge: true,
    map: true,
    churchDirectory: false,
    maxChurches: 1,
    maxContacts: 500,
    maxCourses: 5,
    maxAdmins: 5,
    customDomain: false,
    customBranding: false,
    newsletterAutomation: true,
    automatedNewsletter: false,
    smsAutomation: true,
    aiAssistant: 0,
    fundraising: true,
    eventRegistration: false,
    // Moved down from the top tier in an earlier repricing: Small Team carries
    // Notes/Docs, CRM, Check-In, Livestream and Sermon Notes. Visibility only —
    // no rule, route or query keys off these cells (CRM's Firestore rules scope
    // on the `manageCRM` permission, not on plan).
    docs: true,
    crm: true,
    accountingTools: false,
    taxReceipt: false,
    communityGroups: false,
    customForms: false,
    checkInSystem: true,
    livestream: true,
    sermonNotes: true,
    automatedBlog: false,
    givingStatements: false,
    pledgeCampaigns: false,
    textToGive: true,
    pwaApp: true,
  },
  // Ministry — $199/mo. The top tier.
  //
  // Absorbed the deleted `ultra` tier: churchDirectory, accountingTools and
  // aiAssistant: 1 folded in here. `maxChurches` deliberately did NOT inherit
  // ultra's -1 — every tier is capped at 1 campus and additional campuses
  // become a paid add-on.
  max: {
    blog: true,
    aiChat: true,
    aiKnowledge: true,
    map: true,
    churchDirectory: true,
    maxChurches: 1,
    maxContacts: 2_000,
    maxCourses: 15,
    maxAdmins: 15,
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
    pledgeCampaigns: true,
    textToGive: true,
    pwaApp: true,
  },
};

// ─── Pricing (source of truth) ────────────────────────────────────────────────

/**
 * Months charged for a year of service. Annual = monthly × this.
 *
 * This is a PRICING DECISION, not a rounding convention — do NOT "simplify" it
 * back to a literal, and do not fold it into the yearlyUsd numbers below as a
 * one-off. Churches budget annually and prefer a single invoice, and a year
 * paid up front is worth materially more to Harvest than twelve monthly
 * payments, so the discount is deliberately generous: 9 of 12 months = 25% off.
 *
 * EVERY annual figure and every discount claim in this app derives from this
 * constant — prices, the monthly-equivalent line, the "months free" badges.
 * Nothing computes an annual number from a literal.
 *
 * ⚠️ CROSS-REPO: the marketing site (harvest-presentation-site) carries its own
 * copy of this constant in src/components/Pricing.tsx — the two repos cannot
 * share code, so they are kept in sync by hand. Changing this value here means
 * changing it there IN THE SAME BREATH, or the app and the public pricing page
 * quote different prices for the same plan.
 */
export const ANNUAL_BILLED_MONTHS = 9;

/** Months of service received free on annual billing (12 − billed months). */
export const ANNUAL_FREE_MONTHS = 12 - ANNUAL_BILLED_MONTHS;

/** Annual discount against twelve monthly payments, as a whole percent (25). */
export const ANNUAL_DISCOUNT_PCT = Math.round((1 - ANNUAL_BILLED_MONTHS / 12) * 100);

/**
 * Base plan pricing in USD.
 *
 * `yearlyUsd` is `monthlyUsd * ANNUAL_BILLED_MONTHS`, written out as literals
 * rather than computed, so the published price of each tier is readable at a
 * glance in the one table that defines it. The literals are NOT left
 * unguarded: plan-features.test.ts pins the identity
 * `yearlyUsd === monthlyUsd * ANNUAL_BILLED_MONTHS` on every tier, so a
 * literal that drifts from the multiplier fails the suite instead of shipping.
 */
export const PLAN_PRICING: Record<TenantPlan, { monthlyUsd: number; yearlyUsd: number }> = {
  plus: { monthlyUsd: 49,  yearlyUsd: 441  },
  pro:  { monthlyUsd: 99,  yearlyUsd: 891  },
  max:  { monthlyUsd: 199, yearlyUsd: 1791 },
};

/**
 * Monthly-equivalent price of a plan on annual billing, e.g. 199 -> 149.
 *
 * The one place this rounding lives. Math.round(199 * 9 / 12) is exactly 149 —
 * that is a consequence of choosing 9, not a special case to hard-code.
 */
export function annualMonthlyEquivalent(plan: TenantPlan): number {
  return Math.round((PLAN_PRICING[plan].monthlyUsd * ANNUAL_BILLED_MONTHS) / 12);
}

// `PLAN_DONATION_RETENTION` was removed alongside the `donationRetention`
// matrix cell it mirrored. It existed to publish `100 - PLATFORM_FEE_MAP[plan]
// * 100` without importing the fee map into the client bundle. Every tier
// now charges a 0% platform fee, so the whole map was the constant 100 —
// nothing to publish, and one more copy of the fee to drift out of sync (which
// it previously did, advertising "keeps 100%" against a real 2.5% charge).
// PLATFORM_FEE_MAP (src/lib/stripe-connect.ts) is the single source for the fee.
// Surfaces that used to render retention now render the FEE — "Donation fee —
// 0%" — which is the number a customer actually cares about.

/** AI Assistant add-on pricing (available on all plans; included on Ministry). */
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

/**
 * Master switch for the affiliate programme across the whole app.
 * Set to `false` to hide every user-facing surface (admin nav entry and the
 * /admin/affiliate section, the standalone affiliate dashboard on
 * affiliate.theharvest.app, the affiliate auth copy, the "Affiliate Program"
 * permission row). Backend routes (/api/affiliate/*), the payout and
 * commission-window libs, the Stripe webhook's commission paths, the
 * `affiliate_commissions` collection and its rules are intentionally left
 * intact so the feature can be re-enabled by flipping this one boolean back to
 * `true`.
 *
 * Hidden because subscription billing is moving from Stripe to Dodo Payments (a
 * merchant of record), which changes the payout rail end to end — affiliate
 * transfers run through Stripe Connect today and that relationship does not
 * survive the move unchanged. A public programme promising 15% of subscription
 * revenue for 12 months, on a payout rail mid-migration, is how you end up owing
 * commission you cannot pay. Migrate billing first, then decide whether to bring
 * it back.
 *
 * NOT a kill switch for referral capture: `?ref=` attribution (ReferralTracker →
 * localStorage['affiliateReferrerId'] → `referrerId` in checkout metadata) runs
 * regardless of this flag, so a link shared before the programme was hidden
 * still attributes if that person signs up afterwards.
 */
export const AFFILIATE_PROGRAM_ENABLED = false;

/**
 * Master switch for Dodo Payments subscription billing.
 *
 * 🔴 TRUE FROM REP-4 PR 2: NEW-MINISTRY SIGNUP CREATES A DODO CHECKOUT, AND THE
 * DODO WEBHOOK PROVISIONS THE TENANT. This is the highest-risk switch in the
 * project — a broken signup is a broken business, because there is no other way
 * for a church to become a customer.
 *
 * ─── What it does, exactly ───────────────────────────────────────────────────
 *
 *  ON   `SIGNUP_CHECKOUT_ENDPOINT` resolves to `/api/dodo/checkout`, so both
 *       signup call sites (ChurchOnboarding's first attempt and OnboardingGate's
 *       restart) post there. `/api/dodo/checkout` serves the request. The Dodo
 *       webhook's `subscription.active` handler builds the tenant.
 *  OFF  Both call sites resolve to `/api/stripe/checkout` and the Stripe webhook
 *       is again the only thing that creates a tenant — the pre-#290 behaviour,
 *       whole. `/api/dodo/checkout` additionally refuses with 503, so a stale
 *       browser tab holding the previous bundle cannot keep the Dodo path open.
 *
 * ⚠️ THE DODO WEBHOOK DELIBERATELY DOES NOT READ THIS FLAG. It gates whether new
 * Dodo checkouts are CREATED, never whether an already-paid subscription is
 * honoured. A customer who was mid-checkout when the flag was turned off must
 * still get their church; refusing there would take their money and give them
 * nothing.
 *
 * ⚠️ TENANTS PROVISIONED WHILE THIS WAS ON KEEP WORKING WHEN IT GOES OFF. They
 * carry `dodo*` identifiers on `tenant_private` and no Stripe subscription;
 * nothing in the sign-in, roster, rules or admin-area path reads a Stripe id.
 * What degrades is billing MANAGEMENT for those tenants — see the pull request
 * body for the itemised list.
 *
 * Mirrors AI_TELEGRAM_ASSISTANT_ENABLED and AFFILIATE_PROGRAM_ENABLED above in
 * shape only: those two hide features, this one routes money. Donations are
 * unaffected in either direction — giving stays on Stripe Connect at a 0%
 * platform fee (src/lib/stripe-connect.ts) and is not part of this migration.
 */
export const DODO_BILLING_ENABLED = true;

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
 * Internal IDs (plus/pro/max) stay the same.
 *
 * `max` displays as 'Ministry', not the old 'Community'. That is not a rename
 * of the product: 'Ministry' was the deleted `ultra` tier's name, and `max`
 * inherited it when the two folded together. The top tier is still called what
 * it was always called.
 */
export const PLAN_DISPLAY_NAMES: Record<TenantPlan, string> = {
  plus: 'Individual',
  pro: 'Small Team',
  max: 'Ministry',
};

/** Get the display name for a given plan. Defaults to 'Individual' if unknown. */
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
export const PLAN_ORDER: readonly TenantPlan[] = ['plus', 'pro', 'max'] as const;

/**
 * The most expensive tier — the last entry in `PLAN_ORDER`.
 *
 * DERIVED, not hardcoded. This is the "no plan unlocks it, name the top tier"
 * fallback for upgrade copy; it used to be a literal `'ultra'`, which is
 * exactly the kind of reference that breaks silently the next time a tier is
 * added or removed. Reading the last index means a tier change can only ever
 * move it, never leave it pointing at a plan that no longer exists.
 */
export const TOP_PLAN: TenantPlan = PLAN_ORDER[PLAN_ORDER.length - 1];

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
 * Display name of the cheapest plan that unlocks `feature` (e.g. 'Ministry').
 * Falls back to the TOP tier's name if nothing unlocks it, so upgrade copy can
 * never render an empty plan name.
 *
 * The fallback goes through `TOP_PLAN` (derived from the last `PLAN_ORDER`
 * entry) rather than naming a tier literally. It used to read
 * `PLAN_DISPLAY_NAMES.ultra`, which stopped compiling the moment that tier was
 * deleted — the point of deriving it is that the next tier change cannot break
 * this the same way, or worse, break it silently.
 */
export function getFeatureMinPlanName(feature: FeatureKey): string {
  const plan = getFeatureMinPlan(feature);
  return PLAN_DISPLAY_NAMES[plan ?? TOP_PLAN];
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
 * tiers where `customBranding` is true — at the time Community/max and the
 * since-deleted Ministry/ultra — so removing it left every tier's Branding
 * access unchanged:
 *   Individual (plus) hidden · Small Team (pro) hidden · Ministry (max) shown.
 * Folding ultra into max did not change that either: max already had both
 * `customBranding` and `customDomain`.
 */
export function hasBrandingAccess(features: PlanFeatures): boolean {
  return features.customBranding || features.customDomain;
}

/** Format a plan price as a display string, e.g. "$49/mo" */
export function formatPlanPrice(plan: TenantPlan, billing: 'monthly' | 'yearly'): string {
  const pricing = PLAN_PRICING[plan];
  if (!pricing) return 'Custom';
  const amount = billing === 'monthly' ? pricing.monthlyUsd : pricing.yearlyUsd;
  return `$${amount.toLocaleString()}/${billing === 'monthly' ? 'mo' : 'yr'}`;
}
