"use client";
import { useTenantOptional } from '../contexts/TenantContext';
import {
  getPlanFeatures,
  FEATURE_MAP,
  FEATURE_MIN_PLAN,
  PLAN_DISPLAY_NAMES,
  type FeatureKey,
} from '../utils/plan-features';
import { hasPlatformOverride } from '../utils/tenant-scope';

// The gate vocabulary (`FeatureKey`/`FEATURE_MAP`) and the minimum-plan labels
// now live beside the feature matrix in plan-features.ts, where the labels are
// DERIVED from `PLAN_FEATURES` rather than hand-maintained. Re-exported here so
// existing importers of this module keep working — but new code should import
// from plan-features directly.
export type { FeatureKey };
export { FEATURE_MIN_PLAN };

/** @deprecated Alias of `PLAN_DISPLAY_NAMES` in plan-features.ts — import that instead. */
export const PLAN_NAMES: Record<string, string> = PLAN_DISPLAY_NAMES;

export function usePlanGate(feature: FeatureKey): boolean {
  const ctx = useTenantOptional();

  // Platform-context super admin (apex domain) gets all features. On a tenant
  // subdomain everyone — including super admins — is gated by the tenant plan.
  if (hasPlatformOverride()) return true;

  if (!ctx || !ctx.tenantPlan) return true; // global platform or no plan loaded yet
  const key = FEATURE_MAP[feature];
  if (!key) return false;
  const features = getPlanFeatures(ctx.tenantPlan);
  const value = features[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return false;
}
