import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TenantPlan } from '@/types/tenant.types';

// usePlanGate imports these by relative path; the specifiers below resolve to
// the same module ids, so the mocks apply.
let mockPlan: TenantPlan | undefined;
let mockHasCtx = true;
let mockOverride = false;

vi.mock('../../contexts/TenantContext', () => ({
  useTenantOptional: () => (mockHasCtx ? { tenantPlan: mockPlan } : undefined),
}));
vi.mock('../../utils/tenant-scope', () => ({
  hasPlatformOverride: () => mockOverride,
}));

import { usePlanGate, FEATURE_MIN_PLAN, PLAN_NAMES } from '../usePlanGate';
import { FEATURE_MIN_PLAN_NAME } from '@/components/PlanUpgradeScreen';
import {
  FEATURE_MAP,
  PLAN_DISPLAY_NAMES,
  getFeatureMinPlan,
  type FeatureKey,
} from '@/utils/plan-features';

const ALL_KEYS = Object.keys(FEATURE_MAP) as FeatureKey[];

// Rendered through react-dom directly: @testing-library/react is present but its
// @testing-library/dom peer is not installed, and this hook needs no DOM queries.
// Mirrors the harness in hooks/queries/__tests__/useContactsScoping.test.tsx.
let container: HTMLDivElement;
let root: Root;

function gate(feature: FeatureKey, plan: TenantPlan | undefined): boolean {
  mockPlan = plan;
  const ref = { current: null as unknown as boolean };
  function Probe() {
    ref.current = usePlanGate(feature);
    return null;
  }
  act(() => {
    root.render(<Probe />);
  });
  return ref.current;
}

beforeEach(() => {
  mockPlan = undefined;
  mockHasCtx = true;
  mockOverride = false;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('usePlanGate — community_chat (Community Groups)', () => {
  // Community Groups moved from Ministry-only to Community and above. Reverting
  // `max.communityGroups` to false in the feature matrix fails this test.
  it('is unlocked on Ministry (max)', () => {
    expect(gate('community_chat', 'max')).toBe(true);
  });

  it('is locked on Small Team (pro)', () => {
    expect(gate('community_chat', 'pro')).toBe(false);
  });

  it('is locked on Individual (plus)', () => {
    expect(gate('community_chat', 'plus')).toBe(false);
  });

  it('stays unlocked on Ministry (max)', () => {
    expect(gate('community_chat', 'max')).toBe(true);
  });
});

describe('usePlanGate — context edge cases', () => {
  it('opens the gate for a platform-context super admin', () => {
    mockOverride = true;
    expect(gate('accounting', 'plus')).toBe(true);
  });

  it('opens the gate when no tenant context is mounted', () => {
    mockHasCtx = false;
    expect(gate('accounting', undefined)).toBe(true);
  });

  it('opens the gate while the plan is still loading', () => {
    expect(gate('accounting', undefined)).toBe(true);
  });
});

describe('FEATURE_MIN_PLAN — minimum plan labels', () => {
  // Each of the corrections below gets its own assertion: `crm` and
  // `tax_receipts` were already wrong before the Community Groups move (both
  // said Ministry while Community has had them), and must not be covered only
  // incidentally by the community_chat test.
  //
  // `crm` and `docs` then moved a second time, down to Small Team (pro), in the
  // repricing. The labels below are derived from PLAN_FEATURES, so that move
  // propagated with no code change — these expectations are what proves it.
  //
  // `crm` has since moved a THIRD time, in THE-161: it is on every tier now, so
  // the cheapest plan that unlocks it is the cheapest plan there is. Derived
  // again, so again no label was edited to make it true.
  // And a FOURTH time, in THE-200: the Forever Free tier also carries CRM and
  // sits at the front of PLAN_ORDER, so the cheapest tier that unlocks CRM is
  // now Free. Derived again, so again no label was edited to make it true — and
  // it is a TRUE claim, which is the bar: free really does have CRM, so no
  // church is shown a tier name for something that tier lacks.
  it('names Free as the minimum plan for CRM (moved by THE-200)', () => {
    expect(FEATURE_MIN_PLAN.crm).toBe('Free');
  });

  it('names Ministry as the minimum plan for tax receipts', () => {
    expect(FEATURE_MIN_PLAN.tax_receipts).toBe('Ministry');
  });

  it('names Ministry as the minimum plan for community chat', () => {
    expect(FEATURE_MIN_PLAN.community_chat).toBe('Ministry');
  });

  it('keeps Ministry as the minimum plan for accounting', () => {
    expect(FEATURE_MIN_PLAN.accounting).toBe('Ministry');
  });

  it('keeps the cheapest tier for features every plan has', () => {
    expect(FEATURE_MIN_PLAN.fundraising).toBe('Individual');
  });

  it('names Ministry for event registration and Small Team for docs', () => {
    expect(FEATURE_MIN_PLAN.event_registration).toBe('Ministry');
    expect(FEATURE_MIN_PLAN.docs).toBe('Small Team');
  });

  it('covers every gate key', () => {
    expect(Object.keys(FEATURE_MIN_PLAN).sort()).toEqual([...ALL_KEYS].sort());
  });
});

describe('minimum-plan labels agree across call sites', () => {
  // The regression test for the duplication this replaced: usePlanGate and
  // PlanUpgradeScreen each carried a hand-maintained copy of this map, and they
  // drifted. Both now re-export the derived one, so they cannot disagree.
  it('resolves identical labels for every FeatureKey', () => {
    for (const key of ALL_KEYS) {
      expect(FEATURE_MIN_PLAN_NAME[key]).toBe(FEATURE_MIN_PLAN[key]);
    }
  });

  it('is literally the same frozen object at both call sites', () => {
    expect(FEATURE_MIN_PLAN_NAME).toBe(FEATURE_MIN_PLAN);
    expect(Object.isFrozen(FEATURE_MIN_PLAN)).toBe(true);
  });

  it('exposes the same plan display names from both modules', () => {
    expect(PLAN_NAMES).toBe(PLAN_DISPLAY_NAMES);
  });
});

describe('label ↔ gate consistency', () => {
  // The structural guarantee: for every key, the plan the upgrade screen tells
  // you to buy is the cheapest plan on which the gate actually opens.
  it('every label is the cheapest plan whose gate opens', () => {
    for (const key of ALL_KEYS) {
      const minPlan = getFeatureMinPlan(key);
      expect(minPlan, `no plan unlocks ${key}`).not.toBeNull();
      expect(FEATURE_MIN_PLAN[key]).toBe(PLAN_DISPLAY_NAMES[minPlan!]);
      expect(gate(key, minPlan!), `${key} locked on its own minimum plan`).toBe(true);
    }
  });

  it('every label is the cheapest such plan — the tier below it is locked', () => {
    const order: TenantPlan[] = ['plus', 'pro', 'max'];
    for (const key of ALL_KEYS) {
      const idx = order.indexOf(getFeatureMinPlan(key)!);
      if (idx <= 0) continue; // unlocked on the cheapest tier; nothing below it
      expect(gate(key, order[idx - 1]), `${key} unlocked below its label`).toBe(false);
    }
  });
});
