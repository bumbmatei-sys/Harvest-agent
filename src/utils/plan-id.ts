import type { LegacyPlanId, PricedPlan, TenantPlan } from '../types/tenant.types';

/**
 * Leaf module: the one place a stored plan id is turned into a tier this build
 * sells. It imports only types, so `planLimits.ts` and the server libs can use
 * it without pulling in the plan matrix.
 *
 * plus and pro both become Church, max becomes Ministry. The mapping is applied
 * when a value is READ; nothing writes it back, and no Firestore document is
 * migrated. A document that still says `max` keeps saying `max` until the Dodo
 * webhook next writes its plan, and keeps resolving to Ministry in between.
 * (The closed Stripe webhook still writes `plus` when a subscription is cancelled;
 * that id resolves to Church like any other stored one.)
 */
export const LEGACY_PLAN_ALIASES: Readonly<Record<LegacyPlanId, PricedPlan>> = Object.freeze({
  plus: 'church',
  pro: 'church',
  max: 'ministry',
});

const CANONICAL_PLAN_IDS: readonly TenantPlan[] = ['free', 'church', 'ministry'];

/**
 * The tier a stored or untrusted plan value means, or `null` when it names none.
 *
 * `null` is not a default. The retired `ultra` tier, a typo and an absent value
 * all land here, and each caller decides what an unknown plan costs it
 * (`toTenantPlan` fails closed to Church; the webhook refuses outright).
 */
export function canonicalPlanId(raw: unknown): TenantPlan | null {
  if (typeof raw !== 'string') return null;
  if ((CANONICAL_PLAN_IDS as readonly string[]).includes(raw)) return raw as TenantPlan;
  if (Object.prototype.hasOwnProperty.call(LEGACY_PLAN_ALIASES, raw)) {
    return LEGACY_PLAN_ALIASES[raw as LegacyPlanId];
  }
  return null;
}
