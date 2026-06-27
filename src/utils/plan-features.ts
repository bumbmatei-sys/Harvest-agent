import { TenantPlan } from '../types/tenant.types';

export interface PlanFeatures {
  /** Show blog tab in user app + blog management in admin */
  blog: boolean;
  /** Show AI chat in user app */
  aiChat: boolean;
  /** Show AI Knowledge Base in admin */
  aiKnowledge: boolean;
  /** Show church map in user app (own locations — all plans) */
  map: boolean;
  /** Show global multi-church discovery directory (Ministry only) */
  churchDirectory: boolean;
  /** Max number of churches (0 = hidden, -1 = unlimited) */
  maxChurches: number;
  /** Max number of courses (-1 = unlimited) */
  maxCourses: number;
  /** Max number of admin accounts (-1 = unlimited) */
  maxAdmins: number;
  /** Allow custom domain */
  customDomain: boolean;
  /** Allow full rebranding (logo + brand color) */
  customBackground: boolean;
  /** Newsletter automation */
  newsletterAutomation: boolean;
  /** SMS automation (coming soon) */
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
    aiChat: false,
    aiKnowledge: false,
    map: true,
    churchDirectory: false,
    maxChurches: 1,
    maxCourses: 2,
    maxAdmins: 1,
    customDomain: false,
    customBackground: false,
    newsletterAutomation: false,
    smsAutomation: false,
    aiAssistant: 0,
    fundraising: true,
    eventRegistration: false,
    docs: false,
    crm: false,
    accountingTools: false,
    taxReceipt: false,
    communityGroups: false,
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
    customBackground: false,
    newsletterAutomation: true,
    smsAutomation: false,
    aiAssistant: 0,
    fundraising: true,
    eventRegistration: false,
    docs: false,
    crm: false,
    accountingTools: false,
    taxReceipt: false,
    communityGroups: false,
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
    customDomain: true,
    customBackground: true,
    newsletterAutomation: true,
    smsAutomation: false,
    aiAssistant: 0,
    fundraising: true,
    eventRegistration: true,
    docs: true,
    crm: false,
    accountingTools: false,
    taxReceipt: false,
    communityGroups: false,
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
    customBackground: true,
    newsletterAutomation: true,
    smsAutomation: false,
    aiAssistant: -1,
    fundraising: true,
    eventRegistration: true,
    docs: true,
    crm: true,
    accountingTools: true,
    taxReceipt: true,
    communityGroups: true,
  },
};

// ─── Pricing (source of truth) ────────────────────────────────────────────────

/** Base plan pricing in USD. */
export const PLAN_PRICING: Record<TenantPlan, { monthlyUsd: number; yearlyUsd: number }> = {
  plus:  { monthlyUsd: 59,   yearlyUsd: 590  },
  pro:   { monthlyUsd: 119,  yearlyUsd: 1190 },
  max:   { monthlyUsd: 239,  yearlyUsd: 2390 },
  ultra: { monthlyUsd: 479,  yearlyUsd: 4790 },
};

/**
 * Percentage of donation payments the ministry retains after platform fee.
 * Source of truth: theharvest.site pricing table "Donations Retained" row.
 */
export const PLAN_DONATION_RETENTION: Record<TenantPlan, number> = {
  plus:  85,
  pro:   90,
  max:   95,
  ultra: 100,
};

/** AI Assistant add-on pricing (available on all plans; included on Ministry). */
export const AI_ASSISTANT_ADDON_PRICING = {
  setupFeeUsd: 150,
  monthlyUsd:  100,
} as const;

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

/** Format a plan price as a display string, e.g. "$59/mo" */
export function formatPlanPrice(plan: TenantPlan, billing: 'monthly' | 'yearly'): string {
  const pricing = PLAN_PRICING[plan];
  if (!pricing) return 'Custom';
  const amount = billing === 'monthly' ? pricing.monthlyUsd : pricing.yearlyUsd;
  return `$${amount.toLocaleString()}/${billing === 'monthly' ? 'mo' : 'yr'}`;
}
