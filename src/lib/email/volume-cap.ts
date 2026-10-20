import type { TenantPlan } from '@/types/tenant.types';

/**
 * Sends per calendar month, per ministry, across every broadcast. This is a
 * Harvest abuse and cost limit on the shared sending account, not a plan
 * promise: no screen advertises these figures as an entitlement. Free and
 * Individual have no newsletter, so their cap is zero.
 */
export const MONTHLY_SEND_CAP: Readonly<Record<TenantPlan, number>> = Object.freeze({
  free: 0,
  plus: 0,
  pro: 5000,
  max: 25000,
});

export function monthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export type VolumeDecision =
  | { readonly ok: true; readonly remaining: number }
  | { readonly ok: false; readonly remaining: number; readonly cap: number };

export function decideVolume(input: { cap: number; used: number; requested: number }): VolumeDecision {
  const remaining = Math.max(0, input.cap - input.used);
  if (input.requested > remaining) return { ok: false, remaining, cap: input.cap };
  return { ok: true, remaining: remaining - input.requested };
}
