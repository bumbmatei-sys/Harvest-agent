import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * REP-5b, the client half — tests 1, 2 and 14.
 *
 * REP-5a made an add-on MEAN something; nothing on screen READ one. `planFeatures`
 * came from `getPlanFeatures`, the base-tier function, so a church that owned
 * five extra admin seats saw the tier's cap on every screen.
 *
 * Driven through the REAL `TenantProvider`, the REAL `getEffectiveFeatures` and
 * the REAL `readTenantAddons`. Only Firebase is mocked — `getEffectiveFeatures`
 * is PURE (no fetch, no clock, no module state), which is what makes it usable
 * from a context at all.
 *
 * 🔴 EVERY CAP IS ASSERTED AGAINST THE REAL MATRIX, read through
 * `getPlanFeatures` at assertion time, never against a literal. A test that
 * wrote `502` would pass while the tier's published allowance drifted underneath
 * it, which is the drift this whole area exists to prevent.
 */

const { mockGetDoc } = vi.hoisted(() => ({ mockGetDoc: vi.fn() }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, coll: string, id: string) => ({ coll, id }),
  getDoc: (...args: any[]) => mockGetDoc(...args),
}));
vi.mock('../../firebase', () => ({ db: {} }));

const { mockHasPlatformOverride } = vi.hoisted(() => ({
  mockHasPlatformOverride: vi.fn(() => false),
}));
vi.mock('../../utils/tenant-scope', () => ({
  hasPlatformOverride: () => mockHasPlatformOverride(),
}));

import { TenantProvider, useTenant, type TenantContextValue } from '../TenantContext';
import {
  CONTACTS_PER_PACK,
  NO_ADDONS,
  getEffectiveFeatures,
  getPlanFeatures,
  TOP_PLAN,
} from '../../utils/plan-features';

const TENANT = 'grace-chapel';

/** The tenant document the provider reads. `addons` in MEANINGS, as stored. */
function tenantDoc(data: Record<string, unknown>) {
  mockGetDoc.mockResolvedValue({
    exists: () => true,
    data: () => data,
  });
}

/** The five meanings, as `tenants/{id}.addons` carries them. */
const OWNS = {
  nothing: { aiAssistant: 0, adminSeats: 0, contactPacks: 0, unlimitedContacts: false, campuses: 0 },
  fiveSeats: { aiAssistant: 0, adminSeats: 5, contactPacks: 0, unlimitedContacts: false, campuses: 0 },
  aBitOfEverything: {
    aiAssistant: 1, adminSeats: 2, contactPacks: 3, unlimitedContacts: true, campuses: 1,
  },
};

/** The context, captured from inside a real render. */
let seen: TenantContextValue | null = null;

const Probe: React.FC = () => {
  seen = useTenant();
  return null;
};

let container: HTMLDivElement;
let root: Root;

async function renderProvider() {
  await act(async () => {
    root.render(
      <TenantProvider initialTenantId={TENANT}>
        <Probe />
      </TenantProvider>,
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHasPlatformOverride.mockReturnValue(false);
  seen = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

// ── Test 1 ───────────────────────────────────────────────────────────────────

describe('the client sees the add-ons a tenant owns', () => {
  it('carries the stored add-on set onto the context', async () => {
    tenantDoc({ plan: 'pro', status: 'active', addons: OWNS.aBitOfEverything });
    await renderProvider();

    expect(seen?.tenantAddons).toEqual(OWNS.aBitOfEverything);
    expect(seen?.tenantPlan).toBe('pro');
  });

  it('comes from the SAME fetch that already supplies the plan — no second read', async () => {
    tenantDoc({ plan: 'pro', status: 'active', addons: OWNS.fiveSeats });
    await renderProvider();

    // 🔴 `tenants/{id}` carries `plan` and `addons` on one document, so the
    // add-on set costs no additional read and needs no new endpoint. A second
    // `getDoc` here would be a per-render Firestore cost on every screen.
    expect(mockGetDoc).toHaveBeenCalledTimes(1);
    expect(seen?.tenantAddons).toEqual(OWNS.fiveSeats);
  });

  it('reports owning nothing for a tenant that predates add-ons', async () => {
    // Every tenant created before REP-5a has NO `addons` field at all. That is a
    // real answer — "owns nothing" — not a missing one.
    tenantDoc({ plan: 'max', status: 'active' });
    await renderProvider();

    expect(seen?.tenantAddons).toEqual(NO_ADDONS);
  });

  it('fails closed on a corrupt set rather than inventing capacity', async () => {
    // A hand-edited or corrupt document. `readTenantAddons` floors counts at 0,
    // so the one direction an add-on may never move a cap — DOWN — is impossible,
    // and a garbage value can only ever under-report.
    tenantDoc({
      plan: 'pro',
      status: 'active',
      addons: { adminSeats: -5, contactPacks: 'lots', unlimitedContacts: 'yes', campuses: 2.7 },
    });
    await renderProvider();

    expect(seen?.tenantAddons).toEqual({
      aiAssistant: 0, adminSeats: 0, contactPacks: 0, unlimitedContacts: false, campuses: 2,
    });
  });
});

// ── Test 2 ───────────────────────────────────────────────────────────────────

describe('effective caps include owned add-ons', () => {
  it('raises maxAdmins by the seats the church bought', async () => {
    tenantDoc({ plan: 'pro', status: 'active', addons: OWNS.fiveSeats });
    await renderProvider();

    // 🔴 Against the REAL matrix, read at assertion time. The claim is "five
    // higher than the tier", not "five higher than a number typed here".
    const tierCap = getPlanFeatures('pro').maxAdmins;
    expect(seen?.planFeatures?.maxAdmins).toBe(tierCap + 5);
    // And the tier's own published allowance is untouched by any of this.
    expect(tierCap).toBe(getPlanFeatures('pro').maxAdmins);
  });

  it('raises every cell an add-on is supposed to raise, and nothing else', async () => {
    tenantDoc({ plan: 'pro', status: 'active', addons: OWNS.aBitOfEverything });
    await renderProvider();

    const tier = getPlanFeatures('pro');
    const features = seen?.planFeatures;

    expect(features?.maxAdmins).toBe(tier.maxAdmins + 2);
    expect(features?.maxContacts).toBe(tier.maxContacts + 3 * CONTACTS_PER_PACK);
    // The AI add-on no longer raises a COUNT — `PlanFeatures.aiAssistant` went
    // with the Telegram assistant (THE-253). The same owned quantity now lifts
    // the two capability cells instead, which is what the church actually buys.
    expect(features?.aiChat).toBe(true);
    expect(features?.aiKnowledge).toBe(true);
    // 🔴 The Campus add-on is the ONLY path past `maxChurches: 1`, by design.
    expect(tier.maxChurches).toBe(1);
    expect(features?.maxChurches).toBe(2);
    // Unlimited Contacts travels as its own boolean beside a finite, honest
    // number — never folded into `maxContacts` as a sentinel.
    expect(features?.unlimitedContacts).toBe(true);

    // Everything else is the tier's, untouched. Compared field-by-field against
    // the tier rather than spot-checked, so a new cell cannot quietly start
    // moving.
    //
    // ⚠️ THE EXEMPT LIST CHANGED SHAPE IN THE-253, not just membership. It was
    // "an add-on buys capacity, never a feature flag", so all four exemptions
    // were caps. `aiAssistant` (the Telegram count) is gone, and `aiChat` and
    // `aiKnowledge` join as the first FLAGS an add-on may move — which is the
    // whole of what the AI Assistant add-on now buys. Everything outside these
    // five must still be the tier's, exactly.
    const MOVES = ['maxAdmins', 'maxContacts', 'maxChurches', 'aiChat', 'aiKnowledge'];
    for (const key of Object.keys(tier) as (keyof typeof tier)[]) {
      if (MOVES.includes(key)) continue;
      expect(features?.[key], `${key} moved`).toEqual(tier[key]);
    }
  });

  it('is exactly what getEffectiveFeatures says — the context adds no arithmetic', async () => {
    tenantDoc({ plan: 'max', status: 'active', addons: OWNS.aBitOfEverything });
    await renderProvider();

    // 🔴 The context LAYERS, it does not compute. A second implementation of the
    // add-on arithmetic in the provider is the thing this pins out of existence.
    expect(seen?.planFeatures).toEqual(getEffectiveFeatures('max', OWNS.aBitOfEverything));
  });

  it('a tenant owning nothing reads exactly its tier — the no-regression case', async () => {
    tenantDoc({ plan: 'plus', status: 'active' });
    await renderProvider();

    // The overwhelmingly common case, and every tenant that predates REP-5a.
    // Switching `planFeatures` to `getEffectiveFeatures` must not have moved it.
    const tier = getPlanFeatures('plus');
    for (const key of Object.keys(tier) as (keyof typeof tier)[]) {
      expect(seen?.planFeatures?.[key], `${key} moved`).toEqual(tier[key]);
    }
  });

  it('is null until the plan has loaded, so no cap is claimed while in flight', async () => {
    mockGetDoc.mockReturnValue(new Promise(() => { /* never resolves */ }));
    await renderProvider();

    // An async default is a silent claim — the shape behind THE-64 and THE-139.
    expect(seen?.planFeatures).toBeNull();
  });
});

// ── 🔴 The platform super admin ──────────────────────────────────────────────

describe('add-ons for a platform super admin resolve to owning nothing', () => {
  it('gives the TOP TIER, unmodified — never another tenant’s purchases', async () => {
    mockHasPlatformOverride.mockReturnValue(true);
    await renderProvider();

    // 🔴 The override exists so an apex-domain super admin is not gated by a
    // tier they never bought. Its honest completion is the top tier's PUBLISHED
    // allowance: an add-on is a purchase by a specific tenant, and in platform
    // context `tenantId` is null — there is no tenant to have made one.
    //
    // 🔴 AND NULL IS NOT "ALL TENANTS". That is the `getTenantScope` trap, and it
    // is wrong on anything tenant-scoped. There is no union of every tenant's
    // add-ons to take here; inventing one would grant capacity nobody bought.
    expect(seen?.tenantAddons).toEqual(NO_ADDONS);
    expect(seen?.planFeatures).toEqual(getEffectiveFeatures(TOP_PLAN, NO_ADDONS));
    expect(seen?.planFeatures?.maxChurches).toBe(getPlanFeatures(TOP_PLAN).maxChurches);
    expect(seen?.planFeatures?.unlimitedContacts).toBe(false);
  });

  it('does NOT leak a tenant’s add-ons into the platform view', async () => {
    // The provider read a tenant doc holding add-ons, and then the override
    // applies. What the super admin sees must still be the tier, not this
    // church's purchased capacity attributed to the platform.
    tenantDoc({ plan: 'plus', status: 'active', addons: OWNS.aBitOfEverything });
    mockHasPlatformOverride.mockReturnValue(true);
    await renderProvider();

    expect(seen?.tenantAddons).toEqual(NO_ADDONS);
    expect(seen?.planFeatures?.maxChurches).toBe(1);
  });

  it('on a tenant subdomain a super admin gets that tenant’s real add-ons', async () => {
    // `hasPlatformOverride` is false on a tenant subdomain — everyone, super
    // admins included, is gated by that tenant's actual plan. Unchanged rule.
    mockHasPlatformOverride.mockReturnValue(false);
    tenantDoc({ plan: 'plus', status: 'active', addons: OWNS.fiveSeats });
    await renderProvider();

    expect(seen?.tenantAddons).toEqual(OWNS.fiveSeats);
    expect(seen?.planFeatures?.maxAdmins).toBe(getPlanFeatures('plus').maxAdmins + 5);
  });
});

// ── Test 14 ──────────────────────────────────────────────────────────────────

describe('the add-on set updates after a purchase without a page reload', () => {
  it('moves the caps when the refreshed document shows the purchase', async () => {
    tenantDoc({ plan: 'pro', status: 'active', addons: OWNS.nothing });
    await renderProvider();

    const before = getPlanFeatures('pro').maxAdmins;
    expect(seen?.planFeatures?.maxAdmins).toBe(before);

    // The webhook — the single writer — has now recorded the purchase.
    tenantDoc({ plan: 'pro', status: 'active', addons: OWNS.fiveSeats });
    await act(async () => { await seen?.refreshTenantAddons(); });

    // 🔴 Same mounted tree, no remount, no reload: the caps moved in place.
    expect(seen?.tenantAddons).toEqual(OWNS.fiveSeats);
    expect(seen?.planFeatures?.maxAdmins).toBe(before + 5);
  });

  it('re-reads rather than assuming what was asked for', async () => {
    tenantDoc({ plan: 'pro', status: 'active', addons: OWNS.nothing });
    await renderProvider();

    const readsBefore = mockGetDoc.mock.calls.length;
    tenantDoc({ plan: 'pro', status: 'active', addons: OWNS.fiveSeats });
    await act(async () => { await seen?.refreshTenantAddons(); });

    // 🔴 `on_payment_failure: 'prevent_change'` means Dodo decides whether a
    // change took AFTER the payment, so the purchase route cannot know what the
    // church ended up owning. What is shown always came from the webhook's
    // write, which is why this costs a read.
    expect(mockGetDoc.mock.calls.length).toBe(readsBefore + 1);
  });

  it('keeps the last known set when the refresh fails', async () => {
    tenantDoc({ plan: 'pro', status: 'active', addons: OWNS.fiveSeats });
    await renderProvider();

    mockGetDoc.mockRejectedValue(new Error('offline'));
    await act(async () => { await seen?.refreshTenantAddons(); });

    // Falling back to NO_ADDONS on a dropped request would strip capacity a
    // church pays for. Same posture as `refreshBranding`.
    expect(seen?.tenantAddons).toEqual(OWNS.fiveSeats);
  });

  it('setTenantAddons moves the caps directly — setTenantPlan’s counterpart', async () => {
    tenantDoc({ plan: 'pro', status: 'active', addons: OWNS.nothing });
    await renderProvider();

    await act(async () => { seen?.setTenantAddons(OWNS.aBitOfEverything); });

    expect(seen?.planFeatures).toEqual(getEffectiveFeatures('pro', OWNS.aBitOfEverything));
  });

  it('🔴 the one-shot latch does not undo a refresh', async () => {
    tenantDoc({ plan: 'pro', status: 'active', addons: OWNS.nothing });
    await renderProvider();

    tenantDoc({ plan: 'pro', status: 'active', addons: OWNS.fiveSeats });
    await act(async () => { await seen?.refreshTenantAddons(); });
    expect(seen?.tenantAddons).toEqual(OWNS.fiveSeats);

    // The validation effect re-running must not overwrite the newer value with
    // the one it read first. That is exactly what `addonsInitialized` — the
    // mirror of `planInitialized` — is for, and it is why a purchase surface can
    // rely on the refresh sticking.
    tenantDoc({ plan: 'pro', status: 'active', addons: OWNS.nothing });
    await act(async () => {
      root.render(
        <TenantProvider initialTenantId={TENANT}>
          <Probe />
        </TenantProvider>,
      );
    });

    expect(seen?.tenantAddons).toEqual(OWNS.fiveSeats);
  });
});
