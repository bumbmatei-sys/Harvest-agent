import { getPlanFeatures, type PlanFeatures } from './plan-features';
import type { TenantPlan } from '../types/tenant.types';

/**
 * THE-110 / THE-127 — the third state a capability gate has always had and has
 * never been able to say.
 *
 * ─── The shape ───────────────────────────────────────────────────────────────
 *
 * A gate answers one of THREE things, not two:
 *
 *   permitted   the tier includes the capability
 *   denied      the tier does not
 *   unknown     THE PLAN HAS NOT LOADED YET — no answer exists
 *
 * Every gate in this repo collapsed `unknown` into one of the other two, and
 * both collapses are wrong in their own way:
 *
 *   unknown → denied     AdminBlog's `tenantPlan ? …automatedBlog : false`.
 *                        The Automate button is absent on first paint, appears
 *                        when the tenant doc resolves, and a church inside a
 *                        window where the plan re-resolves watches it vanish
 *                        and come back. That is THE-110's flicker, and it is
 *                        also the reason a church reads a not-yet-known
 *                        entitlement as a refusal.
 *
 *   unknown → permitted  `usePlanGate`'s `if (!ctx.tenantPlan) return true`.
 *                        Quieter, and worse in one specific way: it FLASHES A
 *                        CONTROL THE CHURCH MAY NOT HAVE, and then takes it
 *                        away. Showing someone a feature they did not buy and
 *                        retracting it is a worse first impression than a
 *                        moment of honest blankness.
 *
 * So this returns the third state instead of picking a wrong one, and the call
 * site renders it — see `AdminBlog.tsx`, which puts a `Skeleton` in the
 * control's own footprint while the answer is `unknown`.
 *
 * ─── 🔴 BOOLEAN CELLS ONLY, AND THAT IS THE WHOLE POINT ──────────────────────
 *
 * The parameter is `BooleanFeatureCell`, so a numeric CAP (`maxCourses`,
 * `maxChurches`, `maxAdmins`, `maxContacts`) cannot be passed in. That is a
 * deliberate refusal, not an oversight, and it is the one distinction this
 * module exists to hold:
 *
 *   A CAP PROTECTS HARVEST. `plan-features.ts`'s `maxCourses` note records that
 *   an unknown or loading plan falls back to `plus` — fail CLOSED — and
 *   AdminCourses implements it. Over-granting a cap lets a church create a
 *   resource it did not buy, and the only thing that would undo it is a
 *   reconciliation nobody has written. Under-granting one costs a church a
 *   "you are at your limit" that clears the moment the plan lands. Those are
 *   not comparable, so the cap fails closed and MUST KEEP FAILING CLOSED.
 *
 *   A CAPABILITY GATE PROTECTS NOBODY. Card 86bbtx3dj settled that plan caps
 *   are client-side by design: `firestore.rules` scopes by membership and by
 *   permission, NEVER by plan. A nav entry or an Automate button is therefore a
 *   DISPLAY decision — the server still refuses the action either way — so
 *   neither collapse buys any safety. There is nothing to fail closed against,
 *   and the honest answer to "has the plan loaded" is `unknown`.
 *
 * ⚠️ So the answer to "should fail-closed apply to every gate or only to caps"
 * is ONLY TO CAPS, and the type signature is where that is enforced rather than
 * left to a reviewer to notice.
 */
export type PlanGateState = 'permitted' | 'denied' | 'unknown';

/**
 * The `PlanFeatures` cells that are a yes/no capability.
 *
 * Derived from `PlanFeatures` rather than listed, so a cell added to the matrix
 * is covered here the day it lands and a cell that changes from `boolean` to
 * `number` stops compiling at every call site instead of silently becoming a
 * cap that fails open.
 */
export type BooleanFeatureCell = {
  [K in keyof PlanFeatures]: PlanFeatures[K] extends boolean ? K : never;
}[keyof PlanFeatures];

/** What a gate may be told before it asks. */
export interface PlanGateInput {
  /** The tenant's tier. `null`/`undefined` means NOT YET LOADED, not "free". */
  readonly plan: TenantPlan | null | undefined;
  /**
   * A platform-context super admin (apex domain) who is not inside any tenant.
   * Resolves `permitted` without consulting a tier, exactly as it does today —
   * there is no plan to wait for, so this is never `unknown`.
   */
  readonly platformOverride?: boolean;
}

/**
 * Where this gate stands.
 *
 * 🔴 READS THE TIER, NOT THE TENANT. Same question `getPlanFeatures` answers —
 * "does this tier include the cell" — deliberately, because that is the question
 * both call sites this ticket changes were already asking. A gate that must
 * account for purchased add-ons reads `planFeatures` off `TenantContext`
 * instead; layering add-ons here would be a second `getEffectiveFeatures`.
 */
export function resolvePlanGateState(
  cell: BooleanFeatureCell,
  { plan, platformOverride = false }: PlanGateInput,
): PlanGateState {
  if (platformOverride) return 'permitted';
  // NOT `!plan`. A plan that has not loaded is the third state, and collapsing
  // it here would put back the exact defect above one layer down.
  if (plan === null || plan === undefined) return 'unknown';
  return getPlanFeatures(plan)[cell] ? 'permitted' : 'denied';
}

/**
 * True only when the gate is a definite yes.
 *
 * ⚠️ `unknown` is FALSE here, and that is correct for a side effect — a fetch
 * fired on an unresolved entitlement is a request for something nobody has
 * established the church can have. It is NOT correct for RENDERING, which is why
 * this returns a boolean and the render path reads `PlanGateState` directly. A
 * component that renders from this alone has re-collapsed the three states.
 */
export function planGatePermits(state: PlanGateState): boolean {
  return state === 'permitted';
}
