"use client";
import { useTenantOptional } from '../contexts/TenantContext';
import { tenantAllows, type TenantCapability } from '../lib/tenant-lifecycle';

export type { TenantCapability };

/**
 * The client-side half of REP-4's lifecycle enforcement.
 *
 * `usePlanGate` answers "does this TIER include the feature". This answers "does
 * this tenant's LIFECYCLE still permit the action". Both questions have to be
 * yes; they are different questions and they read different fields.
 *
 * ⚠️ CLIENT-GATED IS NOT ENFORCEMENT, and the PR says so out loud. Anyone with a
 * token can call the API directly, and `firestore.rules` cannot express this
 * (rules would need a cross-document read of the tenant doc on every write —
 * expressible only as a `get()` per rule evaluation, which is a cost and a
 * deploy this PR deliberately does not make). What this buys is that the buttons
 * are gone, which is enough until a paying customer has an incentive to beat it.
 *
 * 🔴 The one exception is GIVING, which is stopped server-side on
 * `/api/stripe/donate`. That is money, and it is one route.
 *
 * 🔴 `export` is never false here, in any state — the module makes that
 * structural. A church's giving records are theirs and no lifecycle state may
 * withhold them.
 */
export function useTenantCapability(capability: TenantCapability): boolean {
  const ctx = useTenantOptional();
  // Outside a TenantProvider there is no tenant to be archived (the platform
  // surfaces, storybook-ish renders). Allow, matching `usePlanGate`'s own
  // no-context behaviour rather than blanking a screen that has no tenant.
  if (!ctx) return true;
  return ctx.capabilities[capability] ?? tenantAllows(undefined, capability);
}

/** True when the tenant's subscription has ended and the downgrade applies. */
export function useIsTenantArchived(): boolean {
  // Derived from a gated capability rather than from the raw status string, so
  // there is still exactly one mapping from state to consequence.
  return !useTenantCapability('publishing');
}
