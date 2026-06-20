import { TenantPlan } from '../types/tenant.types';

export interface PlanFeatures {
  /** Show blog tab in user app + blog management in admin */
  blog: boolean;
  /** Show AI chat in user app */
  aiChat: boolean;
  /** Show AI Knowledge Base in admin */
  aiKnowledge: boolean;
  /** Show church map in user app */
  map: boolean;
  /** Max number of churches (0 = hidden, -1 = unlimited) */
  maxChurches: number;
  /** Max number of courses (-1 = unlimited) */
  maxCourses: number;
  /** Max number of admin accounts (-1 = unlimited) */
  maxAdmins: number;
  /** Allow custom domain */
  customDomain: boolean;
  /** Allow custom background image on auth page */
  customBackground: boolean;
  /** Newsletter automation (coming soon) */
  newsletterAutomation: boolean;
  /** SMS automation (coming soon) */
  smsAutomation: boolean;
  /**
   * true  = AI Assistant is INCLUDED in the base plan price (Ultra / Enterprise).
   * false = AI Assistant is NOT included but is available as a paid add-on
   *         ($150 setup + $100/mo) on all plan tiers — see AI_ASSISTANT_ADDON_PRICING.
   */
  aiAssistant: boolean;
}

// ─── Single source of truth for feature flags ────────────────────────────────
//
// IMPORTANT: this matrix is mirrored on the marketing site (theharvest.site).
// If you change any cell here you MUST also update the marketing copy — or,
// better, make the marketing site fetch /api/plans at build time.
// The contract test in __tests__/plan-features.test.ts will fail CI if these
// values change without an explicit update to that test.

const PLAN_FEATURES: Record<TenantPlan, PlanFeatures> = {
  plus: {
    blog: true,
    aiChat: false,
    aiKnowledge: false,
    map: false,
    maxChurches: 1,
    maxCourses: 5,
    maxAdmins: 2,
    customDomain: false,
    customBackground: false,
    newsletterAutomation: false,
    smsAutomation: false,
    aiAssistant: false,
  },
  pro: {
    blog: true,
    aiChat: true,
    aiKnowledge: true,
    map: false,
    maxChurches: 1,
    maxCourses: -1,
    maxAdmins: 5,
    customDomain: false,
    customBackground: false,
    newsletterAutomation: false, // confirmed: not included in Community — was incorrectly true
    smsAutomation: false,
    aiAssistant: false,
  },
  max: {
    blog: true,
    aiChat: true,
    aiKnowledge: true,
    map: false,
    maxChurches: 1,
    maxCourses: -1,
    maxAdmins: -1,
    customDomain: true,
    customBackground: true,
    newsletterAutomation: true,
    smsAutomation: true,
    aiAssistant: false,
  },
  ultra: {
    blog: true,
    aiChat: true,
    aiKnowledge: true,
    map: false,
    maxChurches: 1,
    maxCourses: -1,
    maxAdmins: -1,
    customDomain: true,
    customBackground: true,
    newsletterAutomation: true,
    smsAutomation: true,
    aiAssistant: true,
  },
  enterprise: {
    blog: true,
    aiChat: true,
    aiKnowledge: true,
    map: true,
    maxChurches: -1,
    maxCourses: -1,
    maxAdmins: -1,
    customDomain: true,
    customBackground: true,
    newsletterAutomation: true,
    smsAutomation: true,
    aiAssistant: true,
  },
};

// ─── Pricing (source of truth) ────────────────────────────────────────────────

/** Base plan pricing in USD. null = contact sales / custom quote. */
export const PLAN_PRICING: Record<TenantPlan, { monthlyUsd: number | null; yearlyUsd: number | null }> = {
  plus:       { monthlyUsd: 49,   yearlyUsd: 490  },
  pro:        { monthlyUsd: 99,   yearlyUsd: 990  },
  max:        { monthlyUsd: 199,  yearlyUsd: 1990 },
  ultra:      { monthlyUsd: 349,  yearlyUsd: 3490 },
  enterprise: { monthlyUsd: null, yearlyUsd: null },
};

/** AI Assistant add-on pricing (available on all plans; included for free on Ultra/Enterprise). */
export const AI_ASSISTANT_ADDON_PRICING = {
  setupFeeUsd: 150,
  monthlyUsd:  100,
} as const;

/** Partner revenue share percentage per plan. */
export const PLAN_REVENUE_SHARE: Record<TenantPlan, number> = {
  plus:       70,
  pro:        80,
  max:        90,
  ultra:      100,
  enterprise: 100,
};

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
 * Internal IDs (plus/pro/max/ultra/enterprise) stay the same.
 */
export const PLAN_DISPLAY_NAMES: Record<TenantPlan, string> = {
  plus:       'Individual',
  pro:        'Community',
  max:        'Church',
  ultra:      'Ministry',
  enterprise: 'Enterprise',
};

/**
 * Get the display name for a given plan.
 * Defaults to 'Individual' if plan is unknown.
 */
export function getPlanDisplayName(plan: TenantPlan): string {
  return PLAN_DISPLAY_NAMES[plan] || PLAN_DISPLAY_NAMES.plus;
}

/**
 * Check if a specific feature is enabled for a plan.
 */
export function hasFeature(plan: TenantPlan, feature: keyof PlanFeatures): boolean {
  const features = getPlanFeatures(plan);
  const value = features[feature];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return false;
}

/**
 * Format a plan price as a display string, e.g. "$49/mo" or "Custom".
 */
export function formatPlanPrice(plan: TenantPlan, billing: 'monthly' | 'yearly'): string {
  const pricing = PLAN_PRICING[plan];
  if (!pricing) return 'Custom';
  const amount = billing === 'monthly' ? pricing.monthlyUsd : pricing.yearlyUsd;
  if (amount === null) return 'Custom';
  return `$${amount.toLocaleString()}/${billing === 'monthly' ? 'mo' : 'yr'}`;
}
