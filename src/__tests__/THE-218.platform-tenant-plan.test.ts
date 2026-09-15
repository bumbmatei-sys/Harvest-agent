import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './__fixtures__/the-346-strip-comments';
import {
  getPlanFeatures,
  toTenantPlan,
  PLAN_ORDER,
  PLAN_DISPLAY_NAMES,
} from '@/utils/plan-features';
import { getPlanLimits, PLAN_LIMITS } from '@/lib/planLimits';

/**
 * THE-218 — Harvest's own platform tenant, and the seed value that degraded it.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `scripts/seed-platform-tenant.js` wrote `plan: 'ministry'`. 'Ministry' is what
 * the `max` tier is CALLED on the pricing screen; the field holds a `TenantPlan`
 * ID, and the four ids are 'free' | 'plus' | 'pro' | 'max'. So the seed wrote a
 * display name where an id belongs, no lookup recognised it, and all three
 * resolvers fell through to their unknown-plan default — which is INDIVIDUAL.
 * Harvest's own tenant ran on the caps of a $49 church.
 *
 * ─── Why the fix is the seed and nothing else ───────────────────────────────
 *
 * 🔴 Section 3 is the guard against the fix everyone reaches for first: teaching
 * a resolver that 'ministry' means 'max', or branching on the platform tenant id
 * inside plan logic. Either would leave the other resolvers wrong and add a cell
 * nothing else honours — the same defect `plan-features.ts` records THREE
 * DELETED CELLS for. The seed is the only writer of this field on the platform
 * tenant, so correcting it there corrects every reader at once.
 *
 * ⚠️ Section 2's fallback assertions are UNCHANGED BEHAVIOUR, pinned on purpose.
 * An unknown plan id must still resolve to the most restrictive paid tier. This
 * ticket did not loosen that; it stopped handing it a value it could not read.
 *
 * NO LINE NUMBER IS PINNED ANYWHERE IN THIS FILE.
 */

const ROOT = process.cwd();
const SEED = 'scripts/seed-platform-tenant.js';
const seedSource = () => readFileSync(join(ROOT, SEED), 'utf8');
const seedCode = () => stripComments(seedSource());

/** The `plan:` value the seed writes, read out of the script itself. */
function seededPlan(): string {
  const m = seedCode().match(/\bplan:\s*'([^']*)'/);
  expect(m, `${SEED} no longer writes a quoted plan literal`).not.toBeNull();
  return m![1];
}

/* ═══ 1 · The seed writes a real plan id, and the right one ══════════════════ */

describe('1 · the platform tenant seed writes a TenantPlan id', () => {
  it('writes a value that is one of the four ids, not a display name', () => {
    expect(
      PLAN_ORDER,
      `${SEED} writes plan '${seededPlan()}', which is not a TenantPlan id`,
    ).toContain(seededPlan() as never);
  });

  it("writes 'max' — the top tier, which is what the platform is entitled to", () => {
    expect(seededPlan()).toBe('max');
  });

  it("no longer writes 'ministry', which is the DISPLAY NAME of that tier", () => {
    // Pinned as its own case so the failure names the confusion directly rather
    // than only saying "not in PLAN_ORDER".
    expect(seededPlan()).not.toBe('ministry');
    expect(
      PLAN_DISPLAY_NAMES.max.toLowerCase(),
      'the display name is what was mistakenly written; if this changes, so did the trap',
    ).toBe('ministry');
  });
});

/* ═══ 2 · That value resolves to the Ministry entitlement, on every resolver ══ */

describe('2 · the platform tenant resolves to the right plan', () => {
  it('resolves to the Ministry feature set on all three resolvers', () => {
    const plan = seededPlan();
    expect(toTenantPlan(plan)).toBe('max');
    expect(getPlanFeatures(plan as never)).toBe(getPlanFeatures('max'));
    expect(getPlanLimits(plan)).toBe(PLAN_LIMITS.max);
  });

  it('and that is NOT the Individual fallback the old value landed on', () => {
    // The assertion that would have failed before the seed was fixed, stated in
    // the direction that makes the regression visible.
    expect(getPlanFeatures(seededPlan() as never)).not.toBe(getPlanFeatures('plus'));
    expect(getPlanLimits(seededPlan())).not.toBe(PLAN_LIMITS.plus);
  });

  it('carries communityGroups, which only the top tier does', () => {
    // A named cell rather than only object identity, so the claim survives a
    // future refactor that stops sharing frozen objects.
    expect(getPlanFeatures(seededPlan() as never).communityGroups).toBe(true);
    expect(getPlanFeatures('plus').communityGroups).toBe(false);
  });

  it('an UNRECOGNISED id still falls back to Individual — unchanged, and still right', () => {
    expect(toTenantPlan('ministry')).toBe('plus');
    expect(getPlanFeatures('ministry' as never)).toBe(getPlanFeatures('plus'));
    expect(getPlanLimits('ministry')).toBe(PLAN_LIMITS.plus);
    expect(getPlanLimits(undefined)).toBe(PLAN_LIMITS.plus);
  });
});

/* ═══ 3 · No special case that nothing else honours ══════════════════════════ */

describe('3 · plan logic carries no platform-tenant special case', () => {
  const PLAN_LOGIC = ['utils/plan-features.ts', 'lib/planLimits.ts'] as const;
  const planLogic = (rel: string) =>
    stripComments(readFileSync(join(ROOT, 'src', rel), 'utf8'));

  it.each(PLAN_LOGIC)('%s never branches on the platform tenant', (rel) => {
    const src = planLogic(rel);
    expect(src, `${rel} mentions PLATFORM_TENANT_ID`).not.toMatch(/PLATFORM_TENANT_ID/);
    expect(src, `${rel} hardcodes the platform subdomain`).not.toMatch(/['"]harvest['"]/);
  });

  it.each(PLAN_LOGIC)("%s never maps the display name 'ministry' to a tier", (rel) => {
    /**
     * 🔴 THE MUTATION THIS EXISTS FOR. Teaching a resolver that 'ministry' means
     * 'max' would make section 2 pass while leaving every OTHER reader of the
     * field wrong — a cell nothing else honours.
     *
     * ⚠️ `PLAN_DISPLAY_NAMES.max` is legitimately `'Ministry'`, capitalised, and
     * is a display VALUE. What is forbidden is the seed's lowercase id-shaped
     * literal (which no plan-logic file carries today), and any COMPARISON
     * against either casing — `plan === 'Ministry'` is the special case wearing
     * a capital letter.
     */
    const src = planLogic(rel);
    expect(src, `${rel} carries the seed's lowercase literal`).not.toMatch(/'ministry'/);
    expect(src, `${rel} compares a plan against the display name`).not.toMatch(
      /[=!]==?\s*['"]ministry['"]/i,
    );
    expect(src, `${rel} maps the display name onto something`).not.toMatch(
      /['"]ministry['"]\s*(?::|=>)/i,
    );
  });

  it('and the seed is still the single writer of the platform tenant plan', () => {
    const src = seedCode();
    expect(src).toMatch(/collection\('tenants'\)\.doc\(TENANT_ID\)/);
    expect((src.match(/\bplan:/g) || []).length, 'exactly one plan write').toBe(1);
  });
});

/* ═══ 4 · The fix does not reach production until the seed is re-run ═════════ */

describe('4 · the seed says out loud that it must be dispatched again', () => {
  it('records that the live document still holds the old value until then', () => {
    // A code fix to an idempotent seed script changes nothing in Firestore on
    // merge. Someone has to run it. That is a deploy step, and a deploy step
    // nobody wrote down is a deploy step nobody does.
    expect(seedSource()).toMatch(/RE-RUN/);
  });
});
