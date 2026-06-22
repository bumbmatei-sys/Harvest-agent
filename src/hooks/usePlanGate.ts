"use client";
import { auth } from '../firebase';
import { useTenantOptional } from '../contexts/TenantContext';
import { getPlanFeatures, PlanFeatures } from '../utils/plan-features';
import { isSuperAdminEmail } from '../utils/super-admins';

type FeatureKey =
  | 'fundraising'
  | 'event_registration'
  | 'docs'
  | 'crm'
  | 'accounting'
  | 'community_chat'
  | 'tax_receipts';

const FEATURE_MAP: Record<FeatureKey, keyof PlanFeatures> = {
  fundraising: 'fundraising',
  event_registration: 'eventRegistration',
  docs: 'docs',
  crm: 'crm',
  accounting: 'accountingTools',
  community_chat: 'communityGroups',
  tax_receipts: 'taxReceipt',
};

export const PLAN_NAMES: Record<string, string> = {
  plus: 'Individual',
  pro: 'Small Team',
  max: 'Community',
  ultra: 'Ministry',
  enterprise: 'Organization',
};

export const FEATURE_MIN_PLAN: Record<FeatureKey, string> = {
  fundraising: 'Individual',
  event_registration: 'Community',
  docs: 'Community',
  crm: 'Ministry',
  accounting: 'Ministry',
  community_chat: 'Ministry',
  tax_receipts: 'Organization',
};

export function usePlanGate(feature: FeatureKey): boolean {
  const ctx = useTenantOptional();

  // Super admin always gets all features, regardless of tenant plan
  const userEmail = auth.currentUser?.email;
  if (isSuperAdminEmail(userEmail)) return true;

  if (!ctx || !ctx.tenantPlan) return true; // global platform or no plan loaded yet
  const key = FEATURE_MAP[feature];
  if (!key) return false;
  const features = getPlanFeatures(ctx.tenantPlan);
  const value = features[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return false;
}
