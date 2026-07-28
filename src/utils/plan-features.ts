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
  /** Show global multi-church discovery directory (Ministry only) */
  churchDirectory: boolean;
  /** Max number of churches (0 = hidden, -1 = unlimited) */
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
  /** Allow custom domain (Ministry / ultra only) */
  customDomain: boolean;
  /** Allow custom branding — logo, colors, ministry name (Community / max+) */
  customBranding: boolean;
  // `customBackground` ("custom auth-page background image") was removed: no
  // background uploader was ever built anywhere in the app, so the flag sold a
  // capability that does not exist. It was true on exactly the tiers where
  // customBranding is true (max, ultra), so dropping it from the Branding-tab
  // gate (see hasBrandingAccess below) changed no tier's access. Don't re-add
  // it as a plan flag unless an uploader ships with it.
  /** Newsletter (manual + Mailchimp) — Small Team / pro+ */
  newsletterAutomation: boolean;
  /** AI-generated newsletter from Instagram (Community / max+) */
  automatedNewsletter: boolean;
  /** SMS: manual broadcasts + automated event-registration/check-in/pledge triggers (see AdminSms TRIGGERS; scheduled broadcasts and other triggers are not promised) */
  smsAutomation: boolean;
  /** Number of AI assistants (0 = none, 1 = one, -1 = unlimited) */
  aiAssistant: number;
  /** Fundraising campaigns feature */
  fundraising: boolean;
  /** Event registration integration */
  eventRegistration: boolean;
  /** Docs / TipTap notes integration */
  docs: boolean;
  /** CRM for donors and members */
  crm: boolean;
  /** Accounting tools integration */
  accountingTools: boolean;
  /** Tax receipt generation */
  taxReceipt: boolean;
  /** Community groups (Rocket.Chat integration) */
  communityGroups: boolean;
  /** Custom forms → CRM pipeline (Ministry only) */
  customForms: boolean;
  /** Check-in system with QR attendance (Ministry only) */
  checkInSystem: boolean;
  /** Livestream + live giving (Ministry only) */
  livestream: boolean;
  /** Sermon notes shared to livestream (viewer read-only panel) */
  sermonNotes: boolean;
  /** AI-generated SEO blog articles on schedule from Knowledge Base */
  automatedBlog: boolean;
  /** Annual giving statements (year-end tax summaries) — Ministry only */
  givingStatements: boolean;
  /** Public event calendar page — all plans (it's public-facing) */
  publicCalendar: boolean;
  /** Pledge campaigns — Community (max) and above */
  pledgeCampaigns: boolean;
  /** Text-to-Give via inbound SMS keyword */
  textToGive: boolean;
  /** Installable Progressive Web App (mobile app) — all plans */
  pwaApp: boolean;
  /**
   * Percentage of donation payments the ministry retains after platform fee.
   * Mirrors `PLATFORM_FEE_MAP` (src/lib/stripe-config.ts) by hand as
   * `100 - fee * 100`; a test enforces the match. See PLAN_DONATION_RETENTION
   * below before changing this. May be fractional (max is 97.5).
   */
  donationRetention: number;
}

// ─── Feature matrix ───────────────────────────────────────────────────────────
//
// IMPORTANT: this matrix must match the pricing table on theharvest.site.
// If you change any cell, update the marketing site copy too — or switch the
// marketing site to consume /api/plans so they can never drift again.
// The contract test in __tests__/plan-features.test.ts will fail CI if this
// matrix changes without an explicit update to that test.

const PLAN_FEATURES: Record<TenantPlan, PlanFeatures> = {
  // Individual
  plus: {
    blog: true,
    // AI chat is available on Small Team (pro) and above; gated to match the pricing page.
    aiChat: false,
    aiKnowledge: false,
    map: false,
    churchDirectory: false,
    maxChurches: 1,
    maxCourses: 2,
    maxAdmins: 1,
    customDomain: false,
    customBranding: false,
    newsletterAutomation: false,
    automatedNewsletter: false,
    smsAutomation: false,
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
    publicCalendar: true,
    pledgeCampaigns: false,
    textToGive: false,
    pwaApp: true,
    donationRetention: 95,
  },
  // Small Team
  pro: {
    blog: true,
    aiChat: true,
    aiKnowledge: true,
    map: true,
    churchDirectory: false,
    maxChurches: 1,
    maxCourses: 5,
    maxAdmins: 5,
    customDomain: false,
    customBranding: false,
    newsletterAutomation: true,
    automatedNewsletter: false,
    smsAutomation: false,
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
    publicCalendar: true,
    pledgeCampaigns: false,
    textToGive: false,
    pwaApp: true,
    donationRetention: 95,
  },
  // Community
  max: {
    blog: true,
    aiChat: true,
    aiKnowledge: true,
    map: true,
    churchDirectory: false,
    maxChurches: 1,
    maxCourses: -1,
    maxAdmins: 10,
    customDomain: false,
    customBranding: true,
    newsletterAutomation: true,
    automatedNewsletter: true,
    smsAutomation: false,
    aiAssistant: 0,
    fundraising: true,
    eventRegistration: true,
    docs: true,
    crm: true,
    accountingTools: false,
    taxReceipt: true,
    communityGroups: false,
    customForms: true,
    checkInSystem: true,
    livestream: true,
    sermonNotes: true,
    automatedBlog: true,
    givingStatements: true,
    publicCalendar: true,
    pledgeCampaigns: true,
    textToGive: false,
    pwaApp: true,
    donationRetention: 97.5,
  },
  // Ministry (top plan)
  ultra: {
    blog: true,
    aiChat: true,
    aiKnowledge: true,
    map: true,
    churchDirectory: true,
    maxChurches: -1,
    maxCourses: -1,
    maxAdmins: -1,
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
    donationRetention: 100,
  },
};

// ─── Pricing (source of truth) ────────────────────────────────────────────────

/** Base plan pricing in USD. */
export const PLAN_PRICING: Record<TenantPlan, { monthlyUsd: number; yearlyUsd: number }> = {
  plus:  { monthlyUsd: 59,   yearlyUsd: 590  },
  pro:   { monthlyUsd: 119,  yearlyUsd: 1190 },
  max:   { monthlyUsd: 299,  yearlyUsd: 2990 },
  ultra: { monthlyUsd: 479,  yearlyUsd: 4790 },
};

/**
 * Percentage of donation payments the ministry retains after platform fee.
 *
 * These numbers are a HAND-MAINTAINED MIRROR of `PLATFORM_FEE_MAP` in
 * `src/lib/stripe-config.ts`, which is the rate actually charged:
 *
 *     donationRetention === 100 - PLATFORM_FEE_MAP[plan] * 100
 *
 * They are NOT derived from it in code, and deliberately so:
 * `stripe-config.ts` reads server-only `STRIPE_PRICE_*` env vars at module
 * load, while `plan-features.ts` is imported by ~20 client components. Importing
 * it here would drag those env reads into the browser bundle. Keep the mirror
 * manual; do not "simplify" it into an import.
 *
 * Because nothing enforces this structurally, `__tests__/plan-features.test.ts`
 * asserts the identity above for every plan. Never edit these values or the
 * `donationRetention` cells in the feature matrix independently of
 * `PLATFORM_FEE_MAP` — change the fee, change both, and let the test confirm it.
 *
 * Note `max` is 97.5, not an integer: a 2.5% fee. Anything formatting these must
 * not round or truncate.
 */
export const PLAN_DONATION_RETENTION: Record<TenantPlan, number> = {
  plus:  PLAN_FEATURES.plus.donationRetention,
  pro:   PLAN_FEATURES.pro.donationRetention,
  max:   PLAN_FEATURES.max.donationRetention,
  ultra: PLAN_FEATURES.ultra.donationRetention,
};

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

// ─── Accessors ────────────────────────────────────────────────────────────────

/**
 * Get feature flags for a given plan.
 * Defaults to 'plus' if plan is unknown.
 */
export function getPlanFeatures(plan: TenantPlan): PlanFeatures {
  return PLAN_FEATURES[plan] || PLAN_FEATURES.plus;
}

/**
 * Human-readable display names for each plan tier.
 * Internal IDs (plus/pro/max/ultra) stay the same.
 */
export const PLAN_DISPLAY_NAMES: Record<TenantPlan, string> = {
  plus: 'Individual',
  pro: 'Small Team',
  max: 'Community',
  ultra: 'Ministry',
};

/** Get the display name for a given plan. Defaults to 'Individual' if unknown. */
export function getPlanDisplayName(plan: TenantPlan): string {
  return PLAN_DISPLAY_NAMES[plan] || PLAN_DISPLAY_NAMES.plus;
}

/**
 * Check if a specific feature is enabled for a plan.
 * For aiAssistant: returns true for both 'included' and 'addon' (it's always available).
 * Use `getPlanFeatures(plan).aiAssistant === 'included'` to check if it's bundled.
 */
export function hasFeature(plan: TenantPlan, feature: keyof PlanFeatures): boolean {
  const features = getPlanFeatures(plan);
  const value = features[feature];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.length > 0; // 'included' | 'addon'
  return false;
}

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

/** Format a plan price as a display string, e.g. "$59/mo" */
export function formatPlanPrice(plan: TenantPlan, billing: 'monthly' | 'yearly'): string {
  const pricing = PLAN_PRICING[plan];
  if (!pricing) return 'Custom';
  const amount = billing === 'monthly' ? pricing.monthlyUsd : pricing.yearlyUsd;
  return `$${amount.toLocaleString()}/${billing === 'monthly' ? 'mo' : 'yr'}`;
}
