import { describe, it, expect } from 'vitest';
import {
  NO_ADDONS,
  PLAN_ORDER,
  PRICED_PLAN_ORDER,
  UNLIMITED_CAP,
  getEffectiveFeatures,
  getPlanFeatures,
  readTenantAddons,
  toTenantPlan,
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
 * Targets are named by LABEL throughout. The tiers come from `PLAN_ORDER` and
 * the caps are read from the matrix by name — except where a cap is the
 * DELIVERABLE, which THE-370's four contact figures are, and those are written
 * out per plan on purpose.
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
 * The one capped cell an add-on still RAISES, by name.
 *
 * 🔴 WAS THREE — THE-370. `maxContacts` and `maxChurches` were raised by the
 * Contacts +500 pack and the Campus add-on; both products are retired and both
 * raises are gone from `getEffectiveFeatures`. The two cells stay in
 * `CAPPED_CELLS` above because the "no add-on lowers any cap" invariant still
 * has to hold for them — an add-on must not move them at all, which is a
 * stricter statement than not moving them down, and is asserted separately.
 */
const RAISED_CELLS = ['maxAdmins'] as const;

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
        unlimitedContacts: true,
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
    const first = getEffectiveFeatures(plan, owning({ adminSeats: 1 }));
    expect(first).not.toBe(getPlanFeatures(plan));
    // Frozen: an accidental `features.maxContacts = 0` throws in strict mode
    // rather than silently editing one church's screen.
    expect(Object.isFrozen(first)).toBe(true);
  });
});

// ── Test 15 — 🔴 THE-370: CAMPUSES ARE UNCAPPED ON EVERY PAID PLAN ──────────

describe('maxChurches is unlimited on every paid tier', () => {
  /* 🔴 THE DELIVERABLE, NAMED PER PLAN. The founder: "remove the campus addon.
     let them add as many as they want." Every paid tier was `maxChurches: 1`
     with additional campuses sold as an add-on; the add-on is retired and the
     cap is gone. Written out per plan rather than derived, because a derivation
     from the matrix would pass against any value the matrix happened to hold —
     which is exactly what this ticket changes. */

  it('Individual (plus) has unlimited campuses', () => {
    expect(getPlanFeatures('plus').maxChurches).toBe(UNLIMITED_CAP);
    expect(getEffectiveFeatures('plus').maxChurches).toBe(UNLIMITED_CAP);
  });

  it('Small Team (pro) has unlimited campuses', () => {
    expect(getPlanFeatures('pro').maxChurches).toBe(UNLIMITED_CAP);
    expect(getEffectiveFeatures('pro').maxChurches).toBe(UNLIMITED_CAP);
  });

  it('Ministry (max) has unlimited campuses', () => {
    expect(getPlanFeatures('max').maxChurches).toBe(UNLIMITED_CAP);
    expect(getEffectiveFeatures('max').maxChurches).toBe(UNLIMITED_CAP);
  });

  it.each(PRICED_PLAN_ORDER)('%s is not capped at any finite number', (plan) => {
    // The mutation this catches: `maxChurches: 1` restored on any one tier.
    // A `toBe(UNLIMITED_CAP)` above would catch that; this catches a cap set to
    // some OTHER finite number, which is the same defect wearing a disguise.
    const cap = getPlanFeatures(plan).maxChurches;
    expect(cap, `${plan} carries a finite church cap`).toBe(UNLIMITED_CAP);
    expect(cap).toBeLessThan(0);
  });

  it('🔴 Forever Free keeps ZERO campuses, and that is a decision', () => {
    /* ⚠️ FREE WAS NOT UNCAPPED WITH THE PAID TIERS, ON PURPOSE.
     *
     * The founder's sentence was about the ADD-ON — "remove the campus addon,
     * let them add as many as they want" — and free has never been able to buy
     * it or to hold a campus at all. Three things follow from leaving it at 0
     * and none of them follow from raising it:
     *
     *  1. 0 = hidden, and `hasFeature` reads 0 as falsy, which is what keeps
     *     `getMinPlanForFeatureCell('maxChurches')` answering 'plus'. Uncapping
     *     free would make the cell true on every tier and DELETE the row from
     *     every plan-comparison surface that derives from it.
     *  2. A free tenant is one evangelist, not a multi-campus ministry — the
     *     matrix has said so since THE-200 and nothing in this ticket disagrees.
     *  3. Campuses become the one thing paying buys that free cannot have,
     *     which is what the refusal on AdminChurches now says in words.
     */
    expect(getPlanFeatures('free').maxChurches).toBe(0);
    expect(getEffectiveFeatures('free').maxChurches).toBe(0);
    // And it is 0 rather than unlimited — the distinction the whole note is about.
    expect(getPlanFeatures('free').maxChurches).not.toBe(UNLIMITED_CAP);
  });

  it('🔴 no add-on can raise a church cap any more, because none exists', () => {
    // `getEffectiveFeatures` no longer reads a campus count at all. Even a
    // tenant document that still carries one changes nothing — see the retired
    // key tests below.
    for (const plan of PLAN_ORDER) {
      const base = getPlanFeatures(plan).maxChurches;
      for (const addons of [
        owning({ adminSeats: 9 }),
        owning({ aiAssistant: 4 }),
        owning({ unlimitedContacts: true }),
      ]) {
        expect(getEffectiveFeatures(plan, addons).maxChurches, plan).toBe(base);
      }
    }
  });
});

// ── Test 7 — 🔴 THE-370: THE FOUR CONTACT CAPS ───────────────────────────────

describe('the four contact caps are 500 / 500 / 2,000 / 4,000', () => {
  /* 🔴 THE DELIVERABLE, NAMED PER PLAN. The founder: "lets not put cap on users
     that badly." Free was already 500 and stayed; the three paid tiers went
     150 → 500, 500 → 2,000 and 2,000 → 4,000. Literals on purpose — deriving
     these from the matrix would assert nothing about the numbers themselves. */

  it('Forever Free holds 500 contacts', () => {
    expect(getPlanFeatures('free').maxContacts).toBe(500);
  });

  it('Individual (plus) holds 500 contacts — was 150', () => {
    expect(getPlanFeatures('plus').maxContacts).toBe(500);
  });

  it('Small Team (pro) holds 2,000 contacts — was 500', () => {
    expect(getPlanFeatures('pro').maxContacts).toBe(2_000);
  });

  it('Ministry (max) holds 4,000 contacts — was 2,000', () => {
    expect(getPlanFeatures('max').maxContacts).toBe(4_000);
  });

  it('🔴 NO CAP WAS LOWERED — every tier holds at least what it held before', () => {
    /* The one property that makes a cap change safe to ship against live
       tenants: a church already over a lowered cap would keep what it has, but
       nothing here is lowered, so the question does not arise. Pinned against
       the pre-THE-370 matrix, written out. */
    const BEFORE = { free: 500, plus: 150, pro: 500, max: 2_000 } as const;
    for (const plan of PLAN_ORDER) {
      expect(getPlanFeatures(plan).maxContacts, plan).toBeGreaterThanOrEqual(BEFORE[plan]);
    }
  });

  it('free no longer holds MORE than the cheapest paid tier', () => {
    // The comment on free's cell used to call its 500 "deliberately generous
    // against Individual's 150". That comparison is retired with the numbers:
    // the two are equal now, and free must never exceed the tier above it.
    expect(getPlanFeatures('free').maxContacts)
      .toBeLessThanOrEqual(getPlanFeatures('plus').maxContacts);
  });

  it('the ladder never goes DOWN as the tier goes up', () => {
    // A ladder property rather than four literals: whatever the numbers become,
    // paying more may never buy fewer contacts.
    for (let i = 1; i < PLAN_ORDER.length; i += 1) {
      const below = getPlanFeatures(PLAN_ORDER[i - 1]).maxContacts;
      const here = getPlanFeatures(PLAN_ORDER[i]).maxContacts;
      expect(here, `${PLAN_ORDER[i]} holds fewer than ${PLAN_ORDER[i - 1]}`)
        .toBeGreaterThanOrEqual(below);
    }
  });

  it('🔴 maxContacts is no longer raised by anything an add-on carries', () => {
    // The Contacts +500 pack was the only thing that moved it. With the pack
    // retired, the published number and the tenant's number are one number.
    for (const plan of PLAN_ORDER) {
      const base = getPlanFeatures(plan).maxContacts;
      expect(getEffectiveFeatures(plan, owning({ adminSeats: 9, aiAssistant: 4 })).maxContacts, plan)
        .toBe(base);
      // Even with Unlimited Contacts held, the NUMBER is untouched — it is a
      // floor to ignore, not a limit that grew. See test 8.
      expect(getEffectiveFeatures(plan, owning({ unlimitedContacts: true })).maxContacts, plan)
        .toBe(base);
    }
  });

  it('reaches the shared contact-cap helper unchanged', () => {
    for (const plan of PLAN_ORDER) {
      expect(resolveContactLimit(plan)).toBe(getPlanFeatures(plan).maxContacts);
      expect(resolveContactLimit(plan, owning({ adminSeats: 2 })))
        .toBe(getPlanFeatures(plan).maxContacts);
    }
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

  it('🔴 STAYS A SEPARATE BOOLEAN — it is not folded into maxContacts', () => {
    /* 🔴 THE REASONING STILL HOLDS, SO THE BOOLEAN STAYS — THE-370.
     *
     * `Infinity` is not storable in Firestore. `-1` is, and is this matrix's
     * sentinel — but it is a NUMBER, and the app compares these cells with `>=`
     * in several places. One consumer that has not learned the sentinel reads
     * `count >= -1` as true forever and reports the church as AT ITS LIMIT:
     * unlimited contacts becoming zero capacity, silently, for the most
     * expensive add-on Harvest sells.
     *
     * So the number beside it must stay REAL, FINITE AND HONEST — the tier's
     * published allowance — and the unlimited fact travels separately. */
    for (const plan of PLAN_ORDER) {
      const held = getEffectiveFeatures(plan, owning({ unlimitedContacts: true }));
      expect(held.unlimitedContacts, plan).toBe(true);
      // 🔴 NOT FOLDED IN: the cell is not the sentinel and is not Infinity.
      expect(held.maxContacts, plan).toBe(getPlanFeatures(plan).maxContacts);
      expect(held.maxContacts, plan).not.toBe(UNLIMITED_CAP);
      expect(Number.isFinite(held.maxContacts), plan).toBe(true);
      expect(held.maxContacts, plan).toBeGreaterThan(0);
    }
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
    const features = getEffectiveFeatures('plus', owning({ adminSeats: 1 }));
    expect(isAtContactLimit(features.maxContacts - 1, features.maxContacts, features.unlimitedContacts)).toBe(false);
    expect(isAtContactLimit(features.maxContacts, features.maxContacts, features.unlimitedContacts)).toBe(true);
  });

  it('is read from the tenant add-on set by the shared helper', () => {
    expect(hasUnlimitedContacts(owning({ unlimitedContacts: true }))).toBe(true);
    expect(hasUnlimitedContacts(owning({ adminSeats: 4 }))).toBe(false);
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

describe('admin seats add to their cap, and nothing else does', () => {
  it.each(PLAN_ORDER)('%s: three admin seats add three', (plan) => {
    expect(getEffectiveFeatures(plan, owning({ adminSeats: 3 })).maxAdmins).toBe(
      getPlanFeatures(plan).maxAdmins + 3,
    );
  });

  it('reaches the shared admin-seat helper', () => {
    const plan = PLAN_ORDER[0];
    expect(resolveAdminLimit(plan, owning({ adminSeats: 4 }))).toBe(
      getPlanFeatures(plan).maxAdmins + 4,
    );
    expect(resolveAdminLimit(plan)).toBe(getPlanFeatures(plan).maxAdmins);
  });

  it('a seat raises admins ALONE — it touches no other cap', () => {
    // Was "a seat is not a campus", paired against the campus add-on. With that
    // add-on retired the statement is stronger: the seat is the only quantity
    // left, so it must move exactly one cell.
    for (const plan of PLAN_ORDER) {
      const base = getPlanFeatures(plan);
      const seats = getEffectiveFeatures(plan, owning({ adminSeats: 5 }));
      expect(seats.maxAdmins, plan).toBe(base.maxAdmins + 5);
      expect(seats.maxChurches, plan).toBe(base.maxChurches);
      expect(seats.maxContacts, plan).toBe(base.maxContacts);
      expect(seats.maxCourses, plan).toBe(base.maxCourses);
    }
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
    { label: 'unlimited contacts', addons: owning({ unlimitedContacts: true }) },
    { label: 'admin seats', addons: owning({ adminSeats: 6 }) },
    { label: 'AI assistants', addons: owning({ aiAssistant: 2 }) },
    {
      label: 'everything at once',
      addons: owning({ aiAssistant: 3, adminSeats: 8, unlimitedContacts: true }),
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
    const hostile = { aiAssistant: -5, adminSeats: -9, unlimitedContacts: false };
    for (const plan of PLAN_ORDER) {
      const base = getPlanFeatures(plan);
      const effective = getEffectiveFeatures(plan, hostile as TenantAddons);
      for (const cell of CAPPED_CELLS) {
        expect(effective[cell], `${plan}.${cell}`).toBe(base[cell]);
      }
    }
  });

  it('leaves every cell it does not name exactly as the tier set it', () => {
    /* An add-on moves the three cells named above and NOTHING else. It was six
       (THE-253 added `aiChat` and `aiKnowledge`, deliberately breaking the old
       "an add-on buys capacity, never a feature flag" rule because that rule was
       exactly why buying the AI Assistant add-on granted nothing at all), and
       THE-370 took `maxContacts` and `maxChurches` back off the list with the
       two retired add-ons. The guard's job is unchanged — a FOURTH cell must not
       appear without a test saying so. */
    const everything = owning({
      aiAssistant: 3, adminSeats: 8, unlimitedContacts: true,
    });
    const moveable = new Set<string>([...RAISED_CELLS, ...LIFTED_CELLS]);
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
    for (const junk of [undefined, null, 'adminSeats: 2', 42, [], { adminSeats: 'two' }]) {
      expect(readTenantAddons(junk)).toEqual(NO_ADDONS);
    }
    // A partially-filled doc keeps the fields it does carry.
    expect(readTenantAddons({ adminSeats: 2 })).toEqual(owning({ adminSeats: 2 }));
    // Fractional quantities round DOWN — half a seat is not half a seat of
    // capacity, and rounding up would grant what was not bought.
    expect(readTenantAddons({ adminSeats: 2.9 }).adminSeats).toBe(2);
  });
});

// ── Test 9 — 🔴 THE UNKNOWN-PLAN FALL-BACK STILL FAILS CLOSED ───────────────

describe('the unknown-plan fall-back still fails CLOSED', () => {
  /* 🔴 NO-REGRESSION, AND THE-370 MAKES IT MATTER MORE RATHER THAN LESS.
   *
   * A cap protects Harvest and must fail CLOSED: an unknown or still-loading
   * plan resolves to the CHEAPEST PAID tier, so it is granted the least any
   * payer gets. THE-370 raises what `plus` grants — 150 → 500 contacts, and
   * campuses 1 → unlimited — so the fall-back now hands out more than it used
   * to, and the guarantee that it is still the FLOOR and not the ceiling is the
   * thing worth pinning.
   *
   * 🔴 THERE ARE TWO FALL-BACKS AND BOTH ARE ASSERTED. `toTenantPlan` coerces an
   * untrusted string and `getPlanFeatures` has its own `|| PLAN_FEATURES.plus`
   * for a value that reaches it without being coerced first. They are separate
   * code paths: a mutation of one leaves the other passing, which is how a
   * single-path guard here would have missed a real loosening.
   */

  /** Everything a caller might hand these, short of a real plan. */
  const NOT_A_PLAN = [undefined, null, '', '   ', 'ultra', 'enterprise', 'free-trial', 'PLUS'] as const;

  it('🔴 getPlanFeatures falls back to plus — its own `||`, not toTenantPlan\u2019s', () => {
    for (const bad of NOT_A_PLAN) {
      expect(getPlanFeatures(bad as never), String(bad)).toEqual(getPlanFeatures('plus'));
    }
  });

  it('🔴 and NOT to the top tier, on any cell a church could notice', () => {
    // The loosening this exists to refuse: an unknown plan quietly entitled to
    // Ministry. Asserted per cell so the failure names what was given away.
    const fallback = getPlanFeatures(undefined as never);
    const top = getPlanFeatures('max');
    expect(fallback.maxContacts, 'an unknown plan was handed Ministry contacts')
      .toBeLessThan(top.maxContacts);
    expect(fallback.maxAdmins).toBeLessThan(top.maxAdmins);
    expect(fallback.maxCourses).toBeLessThan(top.maxCourses);
    for (const cell of ['customDomain', 'customBranding', 'accountingTools', 'communityGroups'] as const) {
      expect(fallback[cell], `an unknown plan was handed ${cell}`).toBe(false);
    }
  });

  it('🔴 and NOT to free either — free is not the floor, the cheapest PAID tier is', () => {
    /* Failing closed does not mean failing to NOTHING. A paying church whose
       plan is still loading must not be shown a free tenant's refusals, which
       is why the fall-back is `plus` and not `free`. The two differ on cells a
       church would notice immediately. */
    const fallback = getPlanFeatures(undefined as never);
    expect(fallback).not.toEqual(getPlanFeatures('free'));
    expect(fallback.newsFeed).toBe(true);
    expect(fallback.blog).toBe(true);
  });

  it('toTenantPlan\u2019s own fall-back is plus too, and they agree', () => {
    for (const bad of NOT_A_PLAN) {
      expect(toTenantPlan(bad as never), String(bad)).toBe('plus');
      // The two paths must not disagree — that is what makes "the fall-back"
      // a single fact rather than two that happen to match today.
      expect(getPlanFeatures(toTenantPlan(bad as never))).toEqual(getPlanFeatures(bad as never));
    }
  });

  it('🔴 a real plan is never redirected to the fall-back', () => {
    // The mirror, and what stops all of the above passing on a function that
    // returned `plus` unconditionally.
    for (const plan of PLAN_ORDER) {
      expect(getPlanFeatures(plan), plan).toBe(getPlanFeatures(plan));
      expect(toTenantPlan(plan), plan).toBe(plan);
    }
    expect(getPlanFeatures('max')).not.toEqual(getPlanFeatures('plus'));
    expect(getPlanFeatures('free')).not.toEqual(getPlanFeatures('plus'));
  });

  it('🔴 the fall-back grants unlimited campuses, and that is still CLOSED', () => {
    /* ⚠️ THE ONE CELL THE-370 MOVED IN THE LOOSENING DIRECTION, stated rather
       than absorbed. An unknown plan used to get `maxChurches: 1` and now gets
       unlimited.

       That is not a hole. The fall-back's job is to avoid refusing a PAYING
       church something it bought while its plan loads, and campuses are no
       longer something any paying church can be refused — every paid tier is
       unlimited, so "the least a payer gets" IS unlimited. The cap that still
       bites is free's 0, and an unknown plan is not free: `toTenantPlan` cannot
       return it and `getPlanFeatures`' `||` does not name it. */
    expect(getPlanFeatures(undefined as never).maxChurches).toBe(UNLIMITED_CAP);
    expect(getPlanFeatures(undefined as never).maxChurches)
      .toBe(getPlanFeatures('plus').maxChurches);
    // 🔴 AND IT IS NOT FREE'S 0 — the fall-back never resolves to the free tier.
    expect(getPlanFeatures(undefined as never).maxChurches)
      .not.toBe(getPlanFeatures('free').maxChurches);
  });
});

// ── Test 16 — 🔴 THE-370: A RETIRED KEY IN A TENANT DOCUMENT ────────────────

describe('a tenant document carrying a retired add-on key resolves as if it did not', () => {
  /* 🔴 THE MIGRATION THIS TICKET DELIBERATELY DID NOT WRITE.
   *
   * `contactPacks` and `campuses` are gone from `TenantAddons`, but a stale
   * `campuses: 2` may still sit in a `tenants/{id}.addons` map — nothing sweeps
   * Firestore. `readTenantAddons` coerces that untrusted value, so the question
   * is what it does with a key it no longer knows.
   *
   * 🔴 IT MUST BE IGNORED, NEVER THROW, AND NEVER GRANT ANYTHING. That holds
   * STRUCTURALLY rather than by a deny-list: the reader names the three fields
   * it wants and reads them off the value, and never enumerates the document's
   * own keys — so an unknown key is not read at all. There is no branch that
   * could throw on one and no path by which one could reach a cap.
   */

  /** A tenant doc as it would look for a church that bought both retired add-ons. */
  const LEGACY_DOC = {
    aiAssistant: 0,
    adminSeats: 0,
    unlimitedContacts: false,
    contactPacks: 3,
    campuses: 2,
  };

  it('🔴 does not throw', () => {
    expect(() => readTenantAddons(LEGACY_DOC)).not.toThrow();
    for (const plan of PLAN_ORDER) {
      expect(() => getEffectiveFeatures(plan, LEGACY_DOC as never)).not.toThrow();
    }
  });

  it('🔴 drops the retired keys entirely — the resolved set has exactly three', () => {
    const resolved = readTenantAddons(LEGACY_DOC);
    expect(Object.keys(resolved).sort()).toEqual(
      ['adminSeats', 'aiAssistant', 'unlimitedContacts'],
    );
    expect(resolved).not.toHaveProperty('contactPacks');
    expect(resolved).not.toHaveProperty('campuses');
  });

  it('🔴 grants NOTHING — it resolves exactly as an empty set does', () => {
    expect(readTenantAddons(LEGACY_DOC)).toEqual(NO_ADDONS);
  });

  it('🔴 every cell is identical to the same tenant without the retired keys', () => {
    // The strongest form of "as if it did not": cell for cell, on every tier.
    for (const plan of PLAN_ORDER) {
      expect(getEffectiveFeatures(plan, LEGACY_DOC as never), plan)
        .toEqual(getEffectiveFeatures(plan, NO_ADDONS));
    }
  });

  it('🔴 a retired key cannot raise a cap, at any quantity', () => {
    // The specific danger: `campuses: 99` reaching `maxChurches`, or
    // `contactPacks: 99` reaching `maxContacts`, through some surviving path.
    for (const quantity of [1, 2, 99, 100_000]) {
      const doc = { ...NO_ADDONS, contactPacks: quantity, campuses: quantity };
      for (const plan of PLAN_ORDER) {
        const base = getPlanFeatures(plan);
        const effective = getEffectiveFeatures(plan, doc as never);
        expect(effective.maxChurches, `${plan} campuses:${quantity}`).toBe(base.maxChurches);
        expect(effective.maxContacts, `${plan} contactPacks:${quantity}`).toBe(base.maxContacts);
        expect(effective.maxAdmins, `${plan}`).toBe(base.maxAdmins);
      }
    }
  });

  it('🔴 a retired key cannot switch on a capability either', () => {
    // `aiChat`/`aiKnowledge` are the only cells an add-on can turn ON, and only
    // `aiAssistant` does it. A retired key must not reach that lift.
    for (const plan of PLAN_ORDER) {
      const base = getPlanFeatures(plan);
      const effective = getEffectiveFeatures(
        plan,
        { ...NO_ADDONS, campuses: 5, contactPacks: 5 } as never,
      );
      for (const cell of LIFTED_CELLS) {
        expect(effective[cell], `${plan}.${cell}`).toBe(base[cell]);
      }
      expect(effective.unlimitedContacts, plan).toBe(false);
    }
  });

  it('a retired key alongside a LIVE one costs the live one nothing', () => {
    // The half that would be missed by a reader that bailed out on an unknown
    // key: the seats this church actually pays for still arrive.
    const mixed = { ...NO_ADDONS, adminSeats: 4, campuses: 2, contactPacks: 7 };
    expect(readTenantAddons(mixed)).toEqual(owning({ adminSeats: 4 }));
    for (const plan of PLAN_ORDER) {
      expect(getEffectiveFeatures(plan, mixed as never).maxAdmins, plan)
        .toBe(getPlanFeatures(plan).maxAdmins + 4);
    }
  });

  it('the same is true of a key that was NEVER a real add-on', () => {
    // Not a special case for the two retired names — the reader treats every
    // key it does not name the same way, which is why no deny-list exists.
    const junk = { ...NO_ADDONS, smsPacks: 9, somethingInvented: true };
    expect(readTenantAddons(junk)).toEqual(NO_ADDONS);
    expect(() => readTenantAddons(junk)).not.toThrow();
  });
});
