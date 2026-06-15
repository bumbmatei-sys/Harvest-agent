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
}

const PLAN_FEATURES: Record<TenantPlan, PlanFeatures> = {
  starter: {
    blog: false,
    aiChat: false,
    aiKnowledge: false,
    map: false,
    maxChurches: 1,
    maxCourses: 5,
    maxAdmins: 2,
    customDomain: false,
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
  },
};

/**
 * Get feature flags for a given plan.
 * Defaults to 'starter' if plan is unknown.
 */
export function getPlanFeatures(plan: TenantPlan): PlanFeatures {
  return PLAN_FEATURES[plan] || PLAN_FEATURES.starter;
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
