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
 * `scripts/seed-platform-tenant.js` once wrote `plan: 'ministry'` when the id of
 * the top tier was 'max': a display name where an id belongs, which no lookup
 * recognised, so Harvest's own tenant ran on the cheapest paid tier's caps.
 *
 * The two-plan repricing renamed the tiers so the id and the name are the same
 * word, and 'ministry' is now the id. This file keeps the invariant that outlived
 * the trap: the seed writes a real `TenantPlan` id, it is the top tier, and every
 * resolver agrees on what it means. The seed is the only writer of this field on
 * the platform tenant, so it is also where the value is pinned.
 *
 * 🔴 Section 3 stays as the guard against the fix everyone reaches for first:
 * branching on the platform tenant id inside plan logic.
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
  it('writes a value that is one of the ids, not a display name that merely looks like one', () => {
    expect(
      PLAN_ORDER,
      `${SEED} writes plan '${seededPlan()}', which is not a TenantPlan id`,
    ).toContain(seededPlan() as never);
  });

  it("writes 'ministry' — the top tier, which is what the platform is entitled to", () => {
    expect(seededPlan()).toBe('ministry');
    expect(PLAN_ORDER[PLAN_ORDER.length - 1]).toBe(seededPlan());
  });

  it('writes the id and not the retired alias, so it never leans on the legacy mapping', () => {
    expect(seededPlan()).not.toBe('max');
    expect(PLAN_DISPLAY_NAMES.ministry.toLowerCase()).toBe(seededPlan());
  });
});

/* ═══ 2 · That value resolves to the Ministry entitlement, on every resolver ══ */

describe('2 · the platform tenant resolves to the right plan', () => {
  it('resolves to the Ministry feature set on all three resolvers', () => {
    const plan = seededPlan();
    expect(toTenantPlan(plan)).toBe('ministry');
    expect(getPlanFeatures(plan as never)).toBe(getPlanFeatures('ministry'));
    expect(getPlanLimits(plan)).toBe(PLAN_LIMITS.ministry);
  });

  it('and the live document, which may still hold the retired id, resolves identically', () => {
    for (const stored of ['max', 'ministry']) {
      expect(toTenantPlan(stored)).toBe('ministry');
      expect(getPlanFeatures(stored as never)).toBe(getPlanFeatures('ministry'));
      expect(getPlanLimits(stored)).toBe(PLAN_LIMITS.ministry);
    }
  });

  it('is NOT the Church fallback an unrecognised id lands on', () => {
    expect(getPlanFeatures(seededPlan() as never)).not.toBe(getPlanFeatures('church'));
    expect(getPlanLimits(seededPlan())).not.toBe(PLAN_LIMITS.church);
  });

  it('carries the Ministry-only cells', () => {
    expect(getPlanFeatures(seededPlan() as never).communityGroups).toBe(true);
    expect(getPlanFeatures(seededPlan() as never).givingStatements).toBe(true);
    expect(getPlanFeatures('church').givingStatements).toBe(false);
  });

  it('an UNRECOGNISED id still falls back to Church — unchanged in kind, and still right', () => {
    expect(toTenantPlan('ultra')).toBe('church');
    expect(getPlanFeatures('ultra' as never)).toBe(getPlanFeatures('church'));
    expect(getPlanLimits('ultra')).toBe(PLAN_LIMITS.church);
    expect(getPlanLimits(undefined)).toBe(PLAN_LIMITS.church);
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

  it.each(PLAN_LOGIC)('%s never maps a display name onto a tier by comparison', (rel) => {
    /**
     * A comparison against the capitalised display name — `plan === 'Ministry'` —
     * is the special case wearing a capital letter. The lowercase id is a real
     * id now and may appear; the display name may not be compared against.
     */
    const src = planLogic(rel);
    expect(src, `${rel} compares a plan against a display name`).not.toMatch(
      /[=!]==?\s*['"]Ministry['"]/,
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
