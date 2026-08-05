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
  // Community Groups moved Ministry-only → Community-and-above → free on every
  // tier under the freemium model. Reverting `plus.communityGroups` to false in
  // the feature matrix fails the free-tier assertion below.
  it('is unlocked on Grove (max)', () => {
    expect(gate('community_chat', 'max')).toBe(true);
  });

  it('is unlocked on Root (pro)', () => {
    expect(gate('community_chat', 'pro')).toBe(true);
  });

  it('is unlocked on Seed (plus) — the free tier', () => {
    expect(gate('community_chat', 'plus')).toBe(true);
  });

  it('stays unlocked on Harvest (ultra)', () => {
    expect(gate('community_chat', 'ultra')).toBe(true);
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
  it('names Seed as the minimum plan for CRM', () => {
    expect(FEATURE_MIN_PLAN.crm).toBe('Seed');
  });

  it('names Seed as the minimum plan for tax receipts', () => {
    expect(FEATURE_MIN_PLAN.tax_receipts).toBe('Seed');
  });

  it('names Seed as the minimum plan for community chat', () => {
    expect(FEATURE_MIN_PLAN.community_chat).toBe('Seed');
  });

  it('names Seed as the minimum plan for accounting', () => {
    expect(FEATURE_MIN_PLAN.accounting).toBe('Seed');
  });

  it('keeps the cheapest tier for features every plan has', () => {
    expect(FEATURE_MIN_PLAN.fundraising).toBe('Seed');
  });

  it('names Seed for event registration and docs', () => {
    expect(FEATURE_MIN_PLAN.event_registration).toBe('Seed');
    expect(FEATURE_MIN_PLAN.docs).toBe('Seed');
  });

  it('resolves EVERY gate key to the free tier — no feature-based upgrade path left', () => {
    // The freemium consequence, asserted where the upgrade copy is produced:
    // with every feature on the free tier, `hasFeature` is always true and
    // PlanUpgradeScreen can no longer fire for a FEATURE reason. If a future
    // change makes a feature paid again, this test fails and that dead branch
    // becomes live again — which is exactly when someone should look at it.
    for (const key of ALL_KEYS) {
      expect(FEATURE_MIN_PLAN[key], key).toBe('Seed');
      expect(gate(key, 'plus'), `${key} locked on the free tier`).toBe(true);
    }
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
    const order: TenantPlan[] = ['plus', 'pro', 'max', 'ultra'];
    for (const key of ALL_KEYS) {
      const idx = order.indexOf(getFeatureMinPlan(key)!);
      if (idx <= 0) continue; // unlocked on the cheapest tier; nothing below it
      expect(gate(key, order[idx - 1]), `${key} unlocked below its label`).toBe(false);
    }
  });
});
