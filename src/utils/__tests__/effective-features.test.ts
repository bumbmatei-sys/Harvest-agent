import { describe, it, expect } from 'vitest';
import {
  CONTACTS_PER_PACK,
  NO_ADDONS,
  PLAN_ORDER,
  PRICED_PLAN_ORDER,
  getEffectiveFeatures,
  getPlanFeatures,
  readTenantAddons,
  type PlanFeatures,
} from '../plan-features';
import {
  UNLIMITED,
  hasUnlimitedContacts,
  isAtContactLimit,
  resolveContactLimit,
} from '../contact-capacity';
import { resolveAdminLimit } from '../admin-seats';
import type { TenantAddons } from '../../types/tenant.types';

/**
 * REP-5a — `getEffectiveFeatures(plan, addons)`: what a TENANT has, as opposed
 * to what its TIER includes.
 *
 * Driven against the REAL `PLAN_FEATURES`, never a fixture. A test matrix would
 * pass while the shipped one drifted, which is the whole failure this separates
 * itself from.
 *
 * 🔴 `getPlanFeatures` IS NOT TOUCHED BY ANY OF THIS. It has roughly forty
 * callers reading a tier's PUBLISHED allowance — the pricing matrix, /api/plans,
 * the comparison table — and every one of them must keep reading exactly what it
 * read before. That is asserted first, below, because it is the thing most worth
 * being sure of.
 *
 * Targets are named by LABEL throughout. Nothing here matches on `500` or on a
 * value shape: the pack size is `CONTACTS_PER_PACK`, the tiers come from
 * `PLAN_ORDER`, and the caps are read from the matrix by name.
 */

/** An add-on set built by naming what is owned. Everything else is zero. */
function owning(over: Partial<TenantAddons>): TenantAddons {
  return { ...NO_ADDONS, ...over };
}

/**
 * The three NUMERIC cells add-ons may raise, by name.
 *
 * Was four: `aiAssistant` — the retired Telegram assistant's per-tier COUNT —
 * was removed from `PlanFeatures` with the assistant itself (THE-253), so
 * `getEffectiveFeatures` no longer raises it and there is no fourth cap. The
 * add-on QUANTITY it was raised from (`TenantAddons.aiAssistant`) is very much
 * still here: it is what lifts `LIFTED_CELLS` below, and `owning({ aiAssistant:
 * n })` all through this file still means "holds n of the live add-on".
 */
const CAPPED_CELLS = ['maxContacts', 'maxAdmins', 'maxChurches'] as const;

/**
 * The two BOOLEAN cells an add-on may switch on (THE-253), by name.
 *
 * 🔴 SEPARATE FROM `CAPPED_CELLS` BECAUSE THEY OBEY A DIFFERENT LAW. A capped
 * cell is raised by a quantity and the assertions below compare it with `>=`;
 * these are lifted by OWNERSHIP — one add-on or ten is the same capability —
 * and the only law that binds them is that a lift never turns a cell OFF that
 * the tier had ON. Folding them into `CAPPED_CELLS` would run `>=` against a
 * boolean, where `false >= false` passes and the assertion means nothing.
 */
const LIFTED_CELLS = ['aiChat', 'aiKnowledge'] as const;

// ── Test 6 — 🔴 THE NO-REGRESSION TEST ───────────────────────────────────────

describe('getPlanFeatures is unchanged for every plan', () => {
  it('answers identically before and after getEffectiveFeatures has run with add-ons', () => {
    const before = PLAN_ORDER.map((plan) => structuredClone(getPlanFeatures(plan)));

    // Exercise it hard: every plan, a full add-on set, several times.
    for (const plan of PLAN_ORDER) {
      getEffectiveFeatures(plan, owning({
        aiAssistant: 4,
        adminSeats: 9,
        contactPacks: 7,
        unlimitedContacts: true,
        campuses: 5,
      }));
      getEffectiveFeatures(plan, null);
      getEffectiveFeatures(plan);
    }

    const after = PLAN_ORDER.map((plan) => structuredClone(getPlanFeatures(plan)));
    expect(after).toEqual(before);
  });

  it('never grows an unlimitedContacts key — that belongs to EffectiveFeatures alone', () => {
    for (const plan of PLAN_ORDER) {
      expect(getPlanFeatures(plan)).not.toHaveProperty('unlimitedContacts');
    }
  });

  it('is what getEffectiveFeatures falls back to when nothing is owned', () => {
    // With no add-ons the two must agree cell for cell — an add-on layer that
    // shifted a tier by itself would be a repricing, not a layer.
    for (const plan of PLAN_ORDER) {
      const { unlimitedContacts, ...effective } = getEffectiveFeatures(plan, NO_ADDONS);
      expect(effective).toEqual(getPlanFeatures(plan));
      expect(unlimitedContacts).toBe(false);
    }
  });

  it('gives the same answer for an absent, null and empty add-on set', () => {
    for (const plan of PLAN_ORDER) {
      expect(getEffectiveFeatures(plan)).toEqual(getEffectiveFeatures(plan, null));
      expect(getEffectiveFeatures(plan)).toEqual(getEffectiveFeatures(plan, NO_ADDONS));
    }
  });

  it('returns a NEW object each time, so no caller can write through to the matrix', () => {
    const plan = PLAN_ORDER[0];
    const first = getEffectiveFeatures(plan, owning({ contactPacks: 1 }));
    expect(first).not.toBe(getPlanFeatures(plan));
    // Frozen: an accidental `features.maxContacts = 0` throws in strict mode
    // rather than silently editing one church's screen.
    expect(Object.isFrozen(first)).toBe(true);
  });
});

// ── Test 15 ──────────────────────────────────────────────────────────────────

describe('maxChurches is still 1 on every PAID plan before add-ons', () => {
  it.each(PRICED_PLAN_ORDER)('%s is capped at one church', (plan) => {
    expect(getPlanFeatures(plan).maxChurches).toBe(1);
    expect(getEffectiveFeatures(plan).maxChurches).toBe(1);
  });

  it('gives the Forever Free tier ZERO churches, not one (THE-200)', () => {
    // 0 = hidden, and `hasFeature` reads 0 as falsy — which is what keeps
    // getMinPlanForFeatureCell('maxChurches') answering 'plus' rather than
    // naming Free for a capability free does not have. A free tenant is one
    // evangelist, not a campus.
    expect(getPlanFeatures('free').maxChurches).toBe(0);
    expect(getEffectiveFeatures('free').maxChurches).toBe(0);
  });

  it('makes the Campus add-on the ONLY path past a plan\u2019s own church cap', () => {
    // Not an omission — the design. No tier buys a second campus; the add-on
    // does, and that is why an unmapped live Campus is a real loss of function.
    for (const plan of PRICED_PLAN_ORDER) {
      expect(getEffectiveFeatures(plan, owning({ campuses: 1 })).maxChurches).toBe(2);
    }
    // On free it raises 0 → 1, the same +1. Reported, not built: nothing can
    // sell an add-on to a free tenant today (add-ons attach to Dodo products
    // and free has none). See plan-features.free-tier.test.ts.
    expect(getEffectiveFeatures('free', owning({ campuses: 1 })).maxChurches).toBe(1);
  });
});

// ── Test 7 ───────────────────────────────────────────────────────────────────

describe('a contact pack raises maxContacts by 500 per pack', () => {
  it.each(PLAN_ORDER)('%s: one pack adds exactly one pack of contacts', (plan) => {
    const base = getPlanFeatures(plan).maxContacts;
    expect(getEffectiveFeatures(plan, owning({ contactPacks: 1 })).maxContacts).toBe(
      base + CONTACTS_PER_PACK,
    );
  });

  it.each(PLAN_ORDER)('%s: three packs add three packs, not three contacts', (plan) => {
    const base = getPlanFeatures(plan).maxContacts;
    expect(getEffectiveFeatures(plan, owning({ contactPacks: 3 })).maxContacts).toBe(
      base + 3 * CONTACTS_PER_PACK,
    );
  });

  it('is 500 contacts to a pack, as sold', () => {
    // Pinned once, by name. Every assertion above derives from this constant so
    // a repricing of the pack moves them together.
    expect(CONTACTS_PER_PACK).toBe(500);
  });

  it('reaches the shared contact-cap helper', () => {
    const plan = PLAN_ORDER[0];
    expect(resolveContactLimit(plan, owning({ contactPacks: 2 }))).toBe(
      getPlanFeatures(plan).maxContacts + 2 * CONTACTS_PER_PACK,
    );
    // And the helper still answers the published number when nothing is owned.
    expect(resolveContactLimit(plan)).toBe(getPlanFeatures(plan).maxContacts);
  });
});

// ── Test 8 ───────────────────────────────────────────────────────────────────

describe('unlimited contacts beats any pack count', () => {
  it('is a BOOLEAN, and maxContacts stays a real finite number beside it', () => {
    // 🔴 The decision, asserted: no Infinity (Firestore cannot store it) and no
    // -1 (a numeric sentinel meeting a `>=` reads as ZERO capacity). The number
    // stays honest and the unlimited fact travels separately.
    const features = getEffectiveFeatures('max', owning({ unlimitedContacts: true }));

    expect(features.unlimitedContacts).toBe(true);
    expect(Number.isFinite(features.maxContacts)).toBe(true);
    expect(features.maxContacts).toBeGreaterThan(0);
    expect(features.maxContacts).not.toBe(UNLIMITED);
  });

  it('is unlimited no matter how many packs are also held', () => {
    const withBoth = getEffectiveFeatures('plus', owning({ unlimitedContacts: true, contactPacks: 9 }));
    expect(withBoth.unlimitedContacts).toBe(true);
    // The packs still count toward the number — they were paid for, and the
    // number is a floor, not a contradiction.
    expect(withBoth.maxContacts).toBe(
      getPlanFeatures('plus').maxContacts + 9 * CONTACTS_PER_PACK,
    );
  });

  it('makes the cap check answer "not at limit" at any count', () => {
    // The cap check asks "unlimited, or under the number?" — in that order.
    const features = getEffectiveFeatures('plus', owning({ unlimitedContacts: true }));
    for (const count of [0, 1, 150, 10_000, 1_000_000]) {
      expect(isAtContactLimit(count, features.maxContacts, features.unlimitedContacts)).toBe(false);
    }
  });

  it('still enforces the number when the add-on is NOT held', () => {
    // The mirror: the flag is what makes it unlimited, so without it the count
    // is compared as it always was.
    const features = getEffectiveFeatures('plus', owning({ contactPacks: 1 }));
    expect(isAtContactLimit(features.maxContacts - 1, features.maxContacts, features.unlimitedContacts)).toBe(false);
    expect(isAtContactLimit(features.maxContacts, features.maxContacts, features.unlimitedContacts)).toBe(true);
  });

  it('is read from the tenant add-on set by the shared helper', () => {
    expect(hasUnlimitedContacts(owning({ unlimitedContacts: true }))).toBe(true);
    expect(hasUnlimitedContacts(owning({ contactPacks: 4 }))).toBe(false);
    expect(hasUnlimitedContacts(undefined)).toBe(false);
  });

  it('keeps every existing two-argument cap check behaving exactly as before', () => {
    // The `unlimited` argument defaults to false, so no call site that has not
    // learned about add-ons changes its answer.
    expect(isAtContactLimit(150, 150)).toBe(true);
    expect(isAtContactLimit(149, 150)).toBe(false);
    expect(isAtContactLimit(9_999, UNLIMITED)).toBe(false);
  });
});

// ── Test 9 ───────────────────────────────────────────────────────────────────

describe('admin seats and campuses add to their caps', () => {
  it.each(PLAN_ORDER)('%s: three admin seats add three', (plan) => {
    expect(getEffectiveFeatures(plan, owning({ adminSeats: 3 })).maxAdmins).toBe(
      getPlanFeatures(plan).maxAdmins + 3,
    );
  });

  it.each(PLAN_ORDER)('%s: two campuses add two churches', (plan) => {
    expect(getEffectiveFeatures(plan, owning({ campuses: 2 })).maxChurches).toBe(
      getPlanFeatures(plan).maxChurches + 2,
    );
  });

  it('reaches the shared admin-seat helper', () => {
    const plan = PLAN_ORDER[0];
    expect(resolveAdminLimit(plan, owning({ adminSeats: 4 }))).toBe(
      getPlanFeatures(plan).maxAdmins + 4,
    );
    expect(resolveAdminLimit(plan)).toBe(getPlanFeatures(plan).maxAdmins);
  });

  it('keeps the two allowances independent — a seat is not a campus', () => {
    const seats = getEffectiveFeatures('pro', owning({ adminSeats: 5 }));
    expect(seats.maxChurches).toBe(getPlanFeatures('pro').maxChurches);

    const campuses = getEffectiveFeatures('pro', owning({ campuses: 5 }));
    expect(campuses.maxAdmins).toBe(getPlanFeatures('pro').maxAdmins);
  });
});

// ── Test 10 ──────────────────────────────────────────────────────────────────

/* WAS 'an AI add-on raises the assistant count' — three tests asserting that
   `owning({ aiAssistant: n })` raised `features.aiAssistant` by n, took a tier
   including none from 0 to 1, and stacked on Ministry's included 1.
 *
 * 🔴 THE CELL THEY ASSERTED ON NO LONGER EXISTS. `PlanFeatures.aiAssistant` was
 * the RETIRED TELEGRAM assistant's count and went with it (THE-253); nothing
 * ever metered against it, which is what THE-224 found and what made buying the
 * add-on grant nothing at all. There is no count to raise, so there is nothing
 * here to re-point at a different cell — the tests are deleted, not rewritten.
 *
 * ⚠️ WHAT THE ADD-ON NOW BUYS IS ASSERTED INSTEAD, and more strictly, by
 * `LIFTED_CELLS` above and by the-253-ai-chat-addon.test.ts: the same purchase
 * that used to raise an unread number now switches `aiChat` and `aiKnowledge`
 * on, which is the only path to either on any tier. The stacking test's
 * premise — a tier that already includes one — is gone too: no tier includes
 * the chat, so `plansWithOne` would now be empty and its
 * `toBeGreaterThan(0)` guard would fail, correctly. */

// ── Test 11 — 🔴 THE INVARIANT ───────────────────────────────────────────────

describe('no add-on lowers any cap', () => {
  const ADD_ON_SETS: Array<{ label: string; addons: TenantAddons }> = [
    { label: 'nothing owned', addons: NO_ADDONS },
    { label: 'one contact pack', addons: owning({ contactPacks: 1 }) },
    { label: 'unlimited contacts', addons: owning({ unlimitedContacts: true }) },
    { label: 'admin seats', addons: owning({ adminSeats: 6 }) },
    { label: 'campuses', addons: owning({ campuses: 3 }) },
    { label: 'AI assistants', addons: owning({ aiAssistant: 2 }) },
    {
      label: 'everything at once',
      addons: owning({ aiAssistant: 3, adminSeats: 8, contactPacks: 4, unlimitedContacts: true, campuses: 2 }),
    },
  ];

  it.each(ADD_ON_SETS)('$label never moves a capped cell downward on any plan', ({ addons }) => {
    for (const plan of PLAN_ORDER) {
      const base = getPlanFeatures(plan);
      const effective = getEffectiveFeatures(plan, addons);
      for (const cell of CAPPED_CELLS) {
        expect(effective[cell], `${plan}.${cell}`).toBeGreaterThanOrEqual(base[cell]);
      }
    }
  });

  it('clamps a negative quantity to zero rather than subtracting capacity', () => {
    // A corrupt tenant doc or a hand edit must never REDUCE a cap. This is the
    // one direction an add-on may not move a limit.
    const hostile = { aiAssistant: -5, adminSeats: -9, contactPacks: -3, unlimitedContacts: false, campuses: -2 };
    for (const plan of PLAN_ORDER) {
      const base = getPlanFeatures(plan);
      const effective = getEffectiveFeatures(plan, hostile as TenantAddons);
      for (const cell of CAPPED_CELLS) {
        expect(effective[cell], `${plan}.${cell}`).toBe(base[cell]);
      }
    }
  });

  it('leaves every cell it does not name exactly as the tier set it', () => {
    /* An add-on moves the six cells named above and NOTHING else. Six, not the
       original four: THE-253 added `aiChat` and `aiKnowledge`, deliberately
       breaking the old "an add-on buys capacity, never a feature flag" rule
       because that rule was exactly why buying the AI Assistant add-on granted
       nothing at all. The guard's job is unchanged — a SEVENTH cell must not
       appear without a test saying so. */
    const everything = owning({
      aiAssistant: 3, adminSeats: 8, contactPacks: 4, unlimitedContacts: true, campuses: 2,
    });
    const moveable = new Set<string>([...CAPPED_CELLS, ...LIFTED_CELLS]);
    for (const plan of PLAN_ORDER) {
      const base = getPlanFeatures(plan);
      const effective = getEffectiveFeatures(plan, everything);
      for (const key of Object.keys(base) as Array<keyof PlanFeatures>) {
        if (moveable.has(key)) continue;
        expect(effective[key], `${plan}.${key}`).toBe(base[key]);
      }
    }
  });

  it('a lifted cell is switched ON by ownership and never switched OFF', () => {
    /* 🔴 THE LAW FOR THE TWO BOOLEANS. Owning the add-on turns them on for
       every tier; owning nothing leaves each exactly where the tier put it. The
       second half is what stops a lift from becoming a REPLACEMENT — writing
       `aiChat: owned.aiAssistant > 0` instead of `base.aiChat || …` would take
       the chat away from Small Team and Ministry, which include it. */
    for (const plan of PLAN_ORDER) {
      const base = getPlanFeatures(plan);
      for (const cell of LIFTED_CELLS) {
        expect(getEffectiveFeatures(plan, NO_ADDONS)[cell], `${plan}.${cell} without`).toBe(base[cell]);
        for (const quantity of [1, 2, 25]) {
          expect(
            getEffectiveFeatures(plan, owning({ aiAssistant: quantity }))[cell],
            `${plan}.${cell} owning ${quantity}`,
          ).toBe(true);
        }
      }
    }
  });

  it('ignores a malformed add-on field instead of failing a screen render', () => {
    // The field comes off a Firestore document and may be anything. Failing
    // closed to "owns nothing" is the honest answer; throwing here would take
    // down the CRM.
    for (const junk of [undefined, null, 'contactPacks: 2', 42, [], { contactPacks: 'two' }]) {
      expect(readTenantAddons(junk)).toEqual(NO_ADDONS);
    }
    // A partially-filled doc keeps the fields it does carry.
    expect(readTenantAddons({ contactPacks: 2 })).toEqual(owning({ contactPacks: 2 }));
    // Fractional quantities round DOWN — half a pack is not half a pack of
    // capacity, and rounding up would grant what was not bought.
    expect(readTenantAddons({ contactPacks: 2.9 }).contactPacks).toBe(2);
  });
});
