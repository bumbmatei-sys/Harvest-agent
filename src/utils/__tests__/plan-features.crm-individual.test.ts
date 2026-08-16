import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import * as planFeaturesModule from '../plan-features';
import {
  getPlanFeatures,
  getFeatureMinPlan,
  getMinPlanForFeatureCell,
  FEATURE_MIN_PLAN,
  PLAN_ORDER,
  PLAN_DISPLAY_NAMES,
} from '../plan-features';

/**
 * THE-161 — CRM on Individual.
 *
 * A $49 church has members and had no way to see who they are. `crm` is now
 * `true` on every tier. The two no-regression describes below exist because a
 * one-cell change to a hand-written matrix is exactly the edit that takes a
 * neighbouring cell with it: `docs` (Notes) stays Small Team and above, and
 * `communityGroups` stays Ministry-only.
 */

const ROOT = path.resolve(__dirname, '../../..');

/** `hasFeature`'s definition of "unlocked", not a second one. */
function unlocked(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return false;
}

describe('Individual includes CRM', () => {
  it('unlocks the crm cell on Individual (plus)', () => {
    expect(getPlanFeatures('plus').crm).toBe(true);
  });

  it('names Individual as the cheapest plan that unlocks CRM', () => {
    // Derived from the matrix, so no upgrade-screen label was edited to say so.
    expect(getFeatureMinPlan('crm')).toBe('plus');
    expect(getMinPlanForFeatureCell('crm')).toBe('plus');
    expect(FEATURE_MIN_PLAN.crm).toBe('Individual');
  });

  it('leaves no tier without CRM', () => {
    const without = PLAN_ORDER.filter((plan) => !getPlanFeatures(plan).crm);
    expect(without).toEqual([]);
  });
});

describe('Small Team and Ministry still include CRM', () => {
  it('keeps crm unlocked on Small Team (pro)', () => {
    expect(getPlanFeatures('pro').crm).toBe(true);
  });

  it('keeps crm unlocked on Ministry (max)', () => {
    expect(getPlanFeatures('max').crm).toBe(true);
  });
});

describe('Notes is still absent on Individual and present above it', () => {
  // 🔴 No-regression. `docs` sits one line above `crm` in the matrix and is NOT
  // part of this change. Notes stays Small Team and above.
  it('leaves docs locked on Individual (plus)', () => {
    expect(getPlanFeatures('plus').docs).toBe(false);
  });

  it('leaves docs unlocked on Small Team (pro) and Ministry (max)', () => {
    expect(getPlanFeatures('pro').docs).toBe(true);
    expect(getPlanFeatures('max').docs).toBe(true);
  });

  it('still names Small Team as the minimum plan for Notes', () => {
    expect(getFeatureMinPlan('docs')).toBe('pro');
    expect(FEATURE_MIN_PLAN.docs).toBe('Small Team');
  });

  it('does not let Notes ride along with CRM onto the cheapest tier', () => {
    // Stated as the relationship rather than as two values: the point is that
    // the two cells moved apart, not merely that each holds some value.
    expect(getPlanFeatures('plus').crm).toBe(true);
    expect(getPlanFeatures('plus').docs).toBe(false);
    expect(FEATURE_MIN_PLAN.docs).not.toBe(FEATURE_MIN_PLAN.crm);
  });
});

describe('community groups is still Ministry only', () => {
  // 🔴 No-regression. `communityGroups` is deliberately false on plus AND pro;
  // a separate change removes the member-app surfaces that leak it.
  it('leaves communityGroups locked on Individual (plus) and Small Team (pro)', () => {
    expect(getPlanFeatures('plus').communityGroups).toBe(false);
    expect(getPlanFeatures('pro').communityGroups).toBe(false);
  });

  it('keeps communityGroups on Ministry (max) alone', () => {
    const withIt = PLAN_ORDER.filter((plan) => getPlanFeatures(plan).communityGroups);
    expect(withIt).toEqual(['max']);
  });

  it('still names Ministry as the minimum plan for community chat', () => {
    expect(getFeatureMinPlan('community_chat')).toBe('max');
    expect(FEATURE_MIN_PLAN.community_chat).toBe(PLAN_DISPLAY_NAMES.max);
    expect(FEATURE_MIN_PLAN.community_chat).toBe('Ministry');
  });
});

/**
 * 🔴 The premise the whole change rests on. Flipping `crm` widens what a tier
 * ADVERTISES. If anything authorising a read keyed off the same cell, the flip
 * would widen access instead — a different and much larger change.
 *
 * HOW THIS IS ASSERTED — by enumeration, in three steps:
 *
 *   1. SOUNDNESS. The matrix (`PLAN_FEATURES`) is module-private: it is not on
 *      this module's exports. So the only way any file can read the `crm` cell
 *      is by importing an accessor from `utils/plan-features`. A file that does
 *      not import from that module cannot read the flag — there is no global,
 *      no Firestore field and no API payload carrying it. (`/api/plans`
 *      publishes an explicit allowlist of cells and `crm` is not among them,
 *      asserted below.)
 *
 *   2. ENUMERATE. Walk every rule file, every API route and every query hook on
 *      disk — not a sample — and check each one against step 1. The walk is
 *      itself asserted non-empty and asserted to have reached the CRM routes
 *      specifically, so a mis-typed path cannot make this pass vacuously.
 *
 *   3. ACCOUNT FOR THE READERS. Separately, enumerate every `.crm` read in the
 *      whole of `src` and pin the file set. All three are client render
 *      decisions. A new consumer anywhere fails this and forces a re-audit.
 */
describe('no rule, route or query gates on the crm flag', () => {
  /** Every file under `dir` whose basename passes `keep`, recursively, minus tests. */
  function filesUnder(dir: string, keep: (name: string) => boolean): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const entry of readdirSync(d)) {
        if (entry === '__tests__' || entry === 'node_modules') continue;
        const full = path.join(d, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (keep(entry)) out.push(full);
      }
    };
    walk(dir);
    return out;
  }

  const rel = (f: string) => path.relative(ROOT, f);
  const read = (f: string) => readFileSync(f, 'utf8');

  const ROUTES = filesUnder(path.join(ROOT, 'src/app/api'), (f) => f === 'route.ts');
  const QUERIES = filesUnder(path.join(ROOT, 'src/hooks/queries'), (f) => /\.tsx?$/.test(f));
  const RULES = path.join(ROOT, 'firestore.rules');

  it('step 1 — the matrix is module-private, so only plan-features importers can read a cell', () => {
    expect(Object.keys(planFeaturesModule)).not.toContain('PLAN_FEATURES');
    // And the matrix really is the only definition of the cell: no other module
    // re-declares a crm entitlement the enumeration could miss.
    expect(read(path.join(ROOT, 'src/utils/plan-features.ts'))).toMatch(
      /^const PLAN_FEATURES: Record<TenantPlan, PlanFeatures> = \{$/m
    );
  });

  it('step 2 — the enumeration actually reached the routes and queries on disk', () => {
    // A broken path would yield an empty list and pass every check below, so the
    // walk is pinned to real, named files it must have found.
    expect(ROUTES.length).toBeGreaterThan(20);
    expect(QUERIES.length).toBeGreaterThan(0);
    const routeSet = new Set(ROUTES.map(rel));
    expect(routeSet).toContain('src/app/api/crm/send-email/route.ts');
    expect(routeSet).toContain('src/app/api/crm/contact-activities/route.ts');
    expect(routeSet).toContain('src/app/api/plans/route.ts');
    expect(QUERIES.map(rel)).toContain('src/hooks/queries/useCRMQueries.ts');
  });

  it.each([
    ['route', () => ROUTES],
    ['query', () => QUERIES],
  ])('no %s file reads the crm cell', (_kind, get) => {
    const offenders = get()
      .filter((f) => {
        const src = read(f);
        // Step 1: a file that never imports the module cannot hold a cell.
        if (!src.includes('plan-features')) return false;
        // Step 2: an importer must not touch this cell, by property or by key.
        return /\.crm\b/.test(src) || /['"]crm['"]/.test(src);
      })
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('the two CRM routes import nothing from the plan matrix at all', () => {
    // The strongest form of step 1 for the routes that would matter most.
    for (const route of [
      'src/app/api/crm/send-email/route.ts',
      'src/app/api/crm/contact-activities/route.ts',
    ]) {
      expect(read(path.join(ROOT, route)), route).not.toContain('plan-features');
    }
  });

  it('firestore.rules scopes CRM on the manageCRM permission, never on plan', () => {
    const rules = read(RULES);
    // The cell name appears nowhere in the rules (case-sensitive: `manageCRM` is
    // a permission, not this flag).
    expect(rules).not.toMatch(/\bcrm\b/);
    // And the two CRM collections gate on the permission, positively asserted so
    // this cannot pass by the rules having lost their CRM blocks entirely.
    expect(rules).toMatch(
      /match \/contacts\/\{contactId\} \{\s*allow read: if isTenantAdmin\(tenantId\);\s*allow write: if hasPermission\('manageCRM', tenantId\);/
    );
    expect(rules).toMatch(
      /match \/contactActivities\/\{activityId\} \{\s*allow read: if isTenantAdmin\(tenantId\);\s*allow write: if hasPermission\('manageCRM', tenantId\);/
    );
  });

  it('the public /api/plans catalog does not publish the crm cell', () => {
    // It reads `getPlanFeatures(id)` but emits an explicit allowlist, so no
    // client — including the marketing site — can gate on crm downstream either.
    const route = read(path.join(ROOT, 'src/app/api/plans/route.ts'));
    expect(route).toContain('getPlanFeatures');
    expect(route).not.toMatch(/\bcrm\b/);
  });

  it('step 3 — every reader of the crm cell in src is a client render decision', () => {
    const SOURCES = filesUnder(path.join(ROOT, 'src'), (f) => /\.tsx?$/.test(f));
    const readers = SOURCES.filter((f) => /\.crm\b/.test(read(f))).map(rel).sort();
    // AdminDashboard — whether the CRM nav entry renders, and whether the tab
    //                  shows AdminCRM or the upgrade screen.
    // AdminSettings  — one word in a plan-summary string.
    // Both are renders. Neither authorises anything.
    expect(readers).toEqual([
      'src/components/AdminDashboard.tsx',
      'src/components/AdminSettings.tsx',
    ]);
  });

  it('the crm gate key resolves a label, and labels do not authorise', () => {
    // `FEATURE_MAP.crm` and `<PlanUpgradeScreen featureKey="crm" />` are the
    // remaining references. They resolve a plan NAME for upgrade copy — the
    // screen shown when the render decisions above have already said no.
    expect(FEATURE_MIN_PLAN.crm).toBe(PLAN_DISPLAY_NAMES.plus);
    expect(unlocked(getPlanFeatures('plus').crm)).toBe(true);
  });
});
