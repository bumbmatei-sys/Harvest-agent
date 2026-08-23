import { describe, it, expect } from 'vitest';
import {
  getPlanFeatures,
  getEffectiveFeatures,
  hasFeature,
  getMinPlanForFeatureCell,
  monthlyHeadlineContract,
  ceilToCent,
  isPricedPlan,
  formatPlanPrice,
  PLAN_ORDER,
  PRICED_PLAN_ORDER,
  PLAN_PRICING,
  PLAN_DISPLAY_NAMES,
  PLAN_BLURBS,
  BILLING_TERMS,
  ADVERTISED_DISCOUNT_PCT,
  AI_ASSISTANT_ADDON_PRICING,
  CONTACTS_PER_PACK,
  TOP_PLAN,
  FEATURE_MIN_PLAN,
  FEATURE_MAP,
  type PlanFeatures,
  type FeatureKey,
} from '../plan-features';
import type { TenantPlan, PricedPlan } from '@/types/tenant.types';

// ─────────────────────────────────────────────────────────────────────────────
// THE-200 — the Forever Free tier's plan foundation.
//
// 🔴 EVERY TARGET IS NAMED BY LABEL, NEVER BY VALUE PATTERN. A test that says
// "every flag that is false on free stays false" asserts nothing — it would
// pass on an empty matrix and on a matrix where a flag flipped and the loop
// simply stopped visiting it. Each cell below is written out by name, so
// deleting one from the matrix fails compilation and flipping one fails an
// assertion that says which.
// ─────────────────────────────────────────────────────────────────────────────

describe('THE-200 — free is a tier, not a $0 price', () => {
  // ── 1 ──────────────────────────────────────────────────────────────────────
  it('free is in PLAN_ORDER and is the FIRST entry', () => {
    // First is load-bearing, not cosmetic: getMinPlanForFeatureCell returns the
    // first tier in this array whose cell is truthy, so the position IS the
    // definition of "cheapest tier with this feature".
    expect(PLAN_ORDER).toContain('free');
    expect(PLAN_ORDER[0]).toBe('free');
    expect([...PLAN_ORDER]).toEqual(['free', 'plus', 'pro', 'max']);
  });

  // ── 2 ──────────────────────────────────────────────────────────────────────
  it('TOP_PLAN is still max — adding a tier at the bottom did not move the top', () => {
    // TOP_PLAN is the last PLAN_ORDER entry and is the fallback every upgrade
    // string falls back to. A tier added at the wrong end silently repoints it.
    expect(TOP_PLAN).toBe('max');
    expect(PLAN_ORDER[PLAN_ORDER.length - 1]).toBe('max');
  });

  // ── 3 ── 🔴 THE SEAM ───────────────────────────────────────────────────────
  it('free is ABSENT from PLAN_PRICING, which keeps exactly three priced tiers', () => {
    // The whole design rests on this. Free has no price and no billing term, so
    // it is not a row of zeros in the price table — it is not in the table at
    // all. PRICED_PLANS (and everything derived from it: every discount claim,
    // every headline, the Dodo catalogue) reads this table's own keys.
    expect(Object.prototype.hasOwnProperty.call(PLAN_PRICING, 'free')).toBe(false);
    expect(Object.keys(PLAN_PRICING).sort()).toEqual(['max', 'plus', 'pro']);
    expect(Object.keys(PLAN_PRICING)).toHaveLength(3);

    // And the two orderings differ by exactly the free tier.
    expect([...PRICED_PLAN_ORDER]).toEqual(['plus', 'pro', 'max']);
    expect(PRICED_PLAN_ORDER).not.toContain('free' as unknown as PricedPlan);
    expect(PLAN_ORDER.length - PRICED_PLAN_ORDER.length).toBe(1);

    // The runtime narrowing agrees with the table, for callers holding a
    // TenantPlan that must decide whether a price exists.
    expect(isPricedPlan('free')).toBe(false);
    for (const plan of PRICED_PLAN_ORDER) expect(isPricedPlan(plan)).toBe(true);

    // A price surface asked about free names it rather than printing "$0/mo" or
    // "$NaN/mo" — free has no billing cycle for a suffix to describe.
    for (const term of BILLING_TERMS) {
      expect(formatPlanPrice('free', term)).toBe('Free');
    }
  });

  // ── 4 ── BY MUTATION ───────────────────────────────────────────────────────
  it('the price contract STILL throws when a priced tier disagrees — and does not throw for free', () => {
    // The guard must not have been defanged by the free tier's arrival. Two
    // halves, and both matter:

    // (a) It passes as shipped. If adding free had made the contract throw —
    //     e.g. by putting free in the pricing table with three zeros, where
    //     ceilToCent(0) * months = 0 is fine but every downstream saving is
    //     nonsense — this line would fail at import time, not here.
    expect(() => monthlyHeadlineContract()).not.toThrow();

    // (b) It still CATCHES a real understatement. Verified by mutation of the
    //     rounding RULE, which is the thing that can actually regress; checked
    //     against the shipped ceiling the assertion would be true by
    //     construction and would guard nothing.
    expect(() => monthlyHeadlineContract(Math.round)).toThrow(
      /may never promise less than the bill/,
    );
    expect(() => monthlyHeadlineContract(Math.floor)).toThrow();

    // And it names the TIER it caught. Note the mutation here must be of the
    // RULE, not of the table: `ceilToCent` cannot understate by construction —
    // a ceiling never rounds down — so no price table exists that makes the
    // shipped rule throw. That is exactly why the contract takes the rule as an
    // argument, and it is the reason this assertion pairs a mutated rule with a
    // table rather than mutating the table alone.
    expect(() =>
      monthlyHeadlineContract(Math.round, {
        // Only `max` understates under Math.round: 1325/12 = 110.42 rounds
        // DOWN to 110, implying 1320 against a charged 1325. plus and pro are
        // given exactly-divisible prices so they cannot throw first and the
        // message can only name max.
        plus: { monthly: 39, quarterly: 90, yearly: 360 },
        pro: { monthly: 79, quarterly: 150, yearly: 600 },
        max: { monthly: 159, quarterly: 399, yearly: 1325 },
      }),
    ).toThrow(/max/);
  });
});

describe('THE-200 — what a free tenant gets', () => {
  const free = getPlanFeatures('free');

  // ── 5 ──────────────────────────────────────────────────────────────────────
  it('free allows 500 members and exactly one course', () => {
    // 500 is the founder's chosen cap (option A: capped but generous) and one
    // course is the whole member-side product — a single adopted discipleship
    // course. Nothing enforces either yet; THE-201 is the server-side gate.
    expect(free.maxContacts).toBe(500);
    expect(free.maxCourses).toBe(1);
  });

  // ── 6 ──────────────────────────────────────────────────────────────────────
  it('free has CRM — which is also how it has analytics', () => {
    // ⚠️ There is no `analytics` cell in this matrix, on ANY tier: analytics is
    // a PERMISSION on a sub-tab of the CRM screen, not a plan flag. So "free
    // gets analytics" is asserted as `crm: true` plus the absence of a flag
    // that would be a lie to invent.
    expect(free.crm).toBe(true);
    expect(hasFeature('free', 'crm')).toBe(true);
    expect('analytics' in free).toBe(false);
  });

  // ── 7 ── 🔴 ───────────────────────────────────────────────────────────────
  it('free has NO fundraising — no donate page for a free tenant', () => {
    // The founder's explicit call. This is the first tier ever to carry
    // fundraising false; it was true on all three priced tiers before and still
    // is. The cell alone is not the gate — the donate route must refuse
    // server-side (THE-202) because it is a money surface.
    expect(free.fundraising).toBe(false);
    expect(hasFeature('free', 'fundraising')).toBe(false);
    for (const plan of PRICED_PLAN_ORDER) {
      expect(getPlanFeatures(plan).fundraising, `${plan} lost fundraising`).toBe(true);
    }
  });

  // ── 7b ── 🔴 THE-205 ──────────────────────────────────────────────────────
  it('free HAS pwaApp — the installable app is on every tier', () => {
    // Founder-confirmed in THE-205, reversing the value THE-200 shipped. Asserted
    // POSITIVELY and in its own case rather than by deleting the old
    // `toBe(false)` line from test 8: a removed assertion is weaker coverage than
    // the one it replaced, and this cell has now moved once already.
    expect(free.pwaApp).toBe(true);
    expect(hasFeature('free', 'pwaApp')).toBe(true);
    for (const plan of PRICED_PLAN_ORDER) {
      expect(getPlanFeatures(plan).pwaApp, `${plan} lost pwaApp`).toBe(true);
    }
  });

  // ── 8 ── ENUMERATED, NOT PATTERN-MATCHED ──────────────────────────────────
  it('every other feature is false on free — each named individually', () => {
    // `pwaApp` is deliberately ABSENT from this list — it is true on free as of
    // THE-205 and is asserted in test 7b directly above.
    // 🔴 Written out cell by cell on purpose. `Object.entries(free).filter(...)`
    // would pass against a matrix that had silently lost half its keys.
    expect(free.blog).toBe(false);
    expect(free.aiChat).toBe(false);
    expect(free.aiKnowledge).toBe(false);
    expect(free.map).toBe(false);
    expect(free.customDomain).toBe(false);
    expect(free.customBranding).toBe(false);
    expect(free.newsletterAutomation).toBe(false);
    expect(free.automatedNewsletter).toBe(false);
    expect(free.smsAutomation).toBe(false);
    expect(free.eventRegistration).toBe(false);
    expect(free.docs).toBe(false);
    expect(free.accountingTools).toBe(false);
    expect(free.taxReceipt).toBe(false);
    expect(free.communityGroups).toBe(false);
    expect(free.customForms).toBe(false);
    expect(free.checkInSystem).toBe(false);
    expect(free.livestream).toBe(false);
    expect(free.sermonNotes).toBe(false);
    expect(free.automatedBlog).toBe(false);
    expect(free.givingStatements).toBe(false);
    expect(free.pledgeCampaigns).toBe(false);
    expect(free.textToGive).toBe(false);

    // Numeric cells, by name too. 0 = none; `hasFeature` reads 0 as false.
    expect(free.maxChurches).toBe(0);
    expect(free.aiAssistant).toBe(0);
    expect(hasFeature('free', 'maxChurches')).toBe(false);
    expect(hasFeature('free', 'aiAssistant')).toBe(false);

    // maxAdmins — the decision, pinned. ONE: one evangelist is one admin, and a
    // tier with no card is otherwise a free shared workspace for any number of
    // people. Deliberately below Individual's 2 so the cheapest paid tier's
    // seat count still means something.
    expect(free.maxAdmins).toBe(1);

    // Belt and braces on the enumeration itself: exactly the entitlements free
    // carries are truthy. This DERIVED check is allowed only because every
    // cell above is also asserted by name — it catches a NEW cell added to the
    // interface and defaulted true on free, which the named list cannot see.
    // `pwaApp` joined this set in THE-205 (asserted by name in test 7b).
    const truthy = (Object.keys(free) as (keyof PlanFeatures)[])
      .filter((k) => hasFeature('free', k))
      .sort();
    expect(truthy).toEqual(['crm', 'maxContacts', 'maxCourses', 'maxAdmins', 'pwaApp'].sort());
  });
});

describe('THE-200 — FEATURE_MIN_PLAN still names the cheapest tier that HAS each feature', () => {
  // ── 9 ──────────────────────────────────────────────────────────────────────
  //
  // 🔴 THE FALSE-CLAIM GUARD. This string is shown to a paying church in every
  // upgrade prompt. If it starts saying "Free" for something free does not
  // have, the product is lying to a customer — a hard stop, not a nit.

  it('names Free ONLY for gates free actually passes', () => {
    for (const key of Object.keys(FEATURE_MAP) as FeatureKey[]) {
      const cell = FEATURE_MAP[key];
      const freeHasIt = hasFeature('free', cell);
      const namesFree = FEATURE_MIN_PLAN[key] === PLAN_DISPLAY_NAMES.free;
      expect(
        namesFree,
        `FEATURE_MIN_PLAN.${key} says "${FEATURE_MIN_PLAN[key]}" but free.${cell} is ${freeHasIt}`,
      ).toBe(freeHasIt);
    }
  });

  it('is correct for every gate key, written out', () => {
    // The full map, pinned by value. Exactly ONE entry moved when free went in
    // at the front of PLAN_ORDER: `crm`, Individual → Free. That is a true
    // statement — free carries crm: true — and it is the reason free is first.
    expect(FEATURE_MIN_PLAN).toEqual({
      fundraising: 'Individual',
      event_registration: 'Ministry',
      docs: 'Small Team',
      crm: 'Free', // ⬅️ MOVED. Was 'Individual'. True: free has CRM.
      accounting: 'Ministry',
      community_chat: 'Ministry',
      tax_receipts: 'Ministry',
    });
  });

  it('is correct for every raw matrix cell, including the ones that moved', () => {
    // Beyond the seven gate keys: every cell with a minimum-plan answer. Three
    // moved to 'free', and all three are caps free genuinely has a value for
    // (500 contacts, 1 course, 1 admin) rather than capabilities it lacks.
    const EXPECTED: Record<keyof PlanFeatures, TenantPlan | null> = {
      blog: 'plus',
      aiChat: 'pro',
      aiKnowledge: 'pro',
      map: 'pro',
      maxChurches: 'plus',      // free is 0 → falsy → unchanged
      maxContacts: 'free',      // ⬅️ MOVED from 'plus'
      maxCourses: 'free',       // ⬅️ MOVED from 'plus'
      maxAdmins: 'free',        // ⬅️ MOVED from 'plus'
      customDomain: 'max',
      customBranding: 'max',
      newsletterAutomation: 'pro',
      automatedNewsletter: 'max',
      smsAutomation: 'plus',    // free is false → unchanged, still Individual
      aiAssistant: 'max',
      fundraising: 'plus',      // 🔴 UNCHANGED — free has no donate page
      eventRegistration: 'max',
      docs: 'pro',
      crm: 'free',              // ⬅️ MOVED from 'plus'
      accountingTools: 'max',
      taxReceipt: 'max',
      communityGroups: 'max',
      customForms: 'max',
      checkInSystem: 'pro',
      livestream: 'pro',
      sermonNotes: 'pro',
      automatedBlog: 'max',
      givingStatements: 'max',
      pledgeCampaigns: 'max',
      textToGive: 'plus',       // free is false → unchanged, still Individual
      pwaApp: 'free',           // ⬅️ MOVED from 'plus' by THE-205
    };
    for (const [cell, expected] of Object.entries(EXPECTED) as [keyof PlanFeatures, TenantPlan | null][]) {
      expect(getMinPlanForFeatureCell(cell), `min plan for ${cell}`).toBe(expected);
    }
  });

  it('never names a tier that does not have the feature — checked across every tier', () => {
    // The general invariant behind the pinned tables above.
    const cells = Object.keys(getPlanFeatures('free')) as (keyof PlanFeatures)[];
    for (const cell of cells) {
      const min = getMinPlanForFeatureCell(cell);
      if (min === null) continue;
      expect(hasFeature(min, cell), `${min} named for ${cell} but does not have it`).toBe(true);
      // And nothing cheaper has it.
      for (const cheaper of PLAN_ORDER.slice(0, PLAN_ORDER.indexOf(min))) {
        expect(hasFeature(cheaper, cell), `${cheaper} is cheaper than ${min} and also has ${cell}`).toBe(false);
      }
    }
  });
});

describe('THE-200 — the three priced tiers are untouched', () => {
  // ── 10 ── NO-REGRESSION, PER TIER ─────────────────────────────────────────
  //
  // The full feature row for each priced tier, transcribed from the matrix as
  // it stood at d07203fb — BEFORE the free tier existed. Written out rather
  // than compared against getPlanFeatures, which would compare the subject with
  // itself. If adding a tier changed one cell on a plan a church pays for, one
  // of these three fails and names it.

  const BEFORE: Record<PricedPlan, PlanFeatures> = {
    plus: {
      blog: true, aiChat: false, aiKnowledge: false, map: false,
      maxChurches: 1, maxContacts: 150, maxCourses: 2, maxAdmins: 2,
      customDomain: false, customBranding: false,
      newsletterAutomation: false, automatedNewsletter: false,
      smsAutomation: true, aiAssistant: 0, fundraising: true,
      eventRegistration: false, docs: false, crm: true,
      accountingTools: false, taxReceipt: false, communityGroups: false,
      customForms: false, checkInSystem: false, livestream: false,
      sermonNotes: false, automatedBlog: false, givingStatements: false,
      pledgeCampaigns: false, textToGive: true, pwaApp: true,
    },
    pro: {
      blog: true, aiChat: true, aiKnowledge: true, map: true,
      maxChurches: 1, maxContacts: 500, maxCourses: 5, maxAdmins: 5,
      customDomain: false, customBranding: false,
      newsletterAutomation: true, automatedNewsletter: false,
      smsAutomation: true, aiAssistant: 0, fundraising: true,
      eventRegistration: false, docs: true, crm: true,
      accountingTools: false, taxReceipt: false, communityGroups: false,
      customForms: false, checkInSystem: true, livestream: true,
      sermonNotes: true, automatedBlog: false, givingStatements: false,
      pledgeCampaigns: false, textToGive: true, pwaApp: true,
    },
    max: {
      blog: true, aiChat: true, aiKnowledge: true, map: true,
      maxChurches: 1, maxContacts: 2_000, maxCourses: 15, maxAdmins: 15,
      customDomain: true, customBranding: true,
      newsletterAutomation: true, automatedNewsletter: true,
      smsAutomation: true, aiAssistant: 1, fundraising: true,
      eventRegistration: true, docs: true, crm: true,
      accountingTools: true, taxReceipt: true, communityGroups: true,
      customForms: true, checkInSystem: true, livestream: true,
      sermonNotes: true, automatedBlog: true, givingStatements: true,
      pledgeCampaigns: true, textToGive: true, pwaApp: true,
    },
  };

  for (const plan of ['plus', 'pro', 'max'] as const) {
    it(`${plan} — every feature cell is exactly what it was before the free tier`, () => {
      expect(getPlanFeatures(plan)).toEqual(BEFORE[plan]);
    });
  }

  it('their display names and blurbs did not move, and free added its own', () => {
    expect(PLAN_DISPLAY_NAMES.plus).toBe('Individual');
    expect(PLAN_DISPLAY_NAMES.pro).toBe('Small Team');
    expect(PLAN_DISPLAY_NAMES.max).toBe('Ministry');
    expect(PLAN_BLURBS.plus).toBe('For solo evangelists and missionaries.');
    expect(PLAN_BLURBS.pro).toBe('For small ministries growing as a team.');
    expect(PLAN_BLURBS.max).toBe('For established churches going deeper.');

    // Free's own strings. The blurb names the AUDIENCE, which is what makes the
    // card differ from Individual's — both are aimed at evangelists, and only
    // the free one is aimed at discipling one person at a time.
    expect(PLAN_DISPLAY_NAMES.free).toBe('Free');
    expect(PLAN_BLURBS.free).toBe('For evangelists discipling one person at a time.');

    // Every tier has a distinct blurb — a duplicated one is a card that sells
    // the wrong plan.
    expect(new Set(PLAN_ORDER.map((p) => PLAN_BLURBS[p])).size).toBe(PLAN_ORDER.length);
  });
});

describe('THE-200 — no price, term or add-on price changed', () => {
  // ── 11 ─────────────────────────────────────────────────────────────────────
  it('the nine stored prices are byte-for-byte what they were', () => {
    expect(PLAN_PRICING).toEqual({
      plus: { monthly: 39, quarterly: 99, yearly: 329 },
      pro: { monthly: 79, quarterly: 199, yearly: 659 },
      max: { monthly: 159, quarterly: 399, yearly: 1329 },
    });
  });

  it('the billing terms and advertised discounts are unchanged', () => {
    expect([...BILLING_TERMS]).toEqual(['monthly', 'quarterly', 'yearly']);
    expect(ADVERTISED_DISCOUNT_PCT).toEqual({ quarterly: 15, yearly: 30 });
  });

  it('the add-on prices are unchanged', () => {
    expect(AI_ASSISTANT_ADDON_PRICING.monthlyUsd).toBe(200);
    expect(CONTACTS_PER_PACK).toBe(500);
  });
});

describe('THE-200 — add-ons layered on a free tenant (reported, not guarded)', () => {
  // ⚠️ REPORTED BEHAVIOUR, NOT A REQUIREMENT. Nothing today can sell an add-on
  // to a free tenant: add-ons are attached to Dodo PRODUCTS, free has no
  // product, and the add-on route reads the tenant's live subscription. This
  // pins what WOULD happen if one arrived anyway (a hand-edited Firestore doc,
  // a tenant downgraded to free while holding one), so PR 2 and PR 4 can decide
  // deliberately rather than discovering it.
  it('raises free\u2019s caps like any other tier, and grants no feature flag', () => {
    const withAddons = getEffectiveFeatures('free', {
      aiAssistant: 1,
      adminSeats: 2,
      contactPacks: 1,
      unlimitedContacts: false,
      campuses: 1,
    });

    // Capacity moves — the four cells getEffectiveFeatures touches, and only
    // those. Note this can lift a free tenant ABOVE Individual's 150 contacts;
    // that is the existing add-on model, not something this PR introduces.
    expect(withAddons.maxContacts).toBe(500 + CONTACTS_PER_PACK);
    expect(withAddons.maxAdmins).toBe(1 + 2);
    expect(withAddons.maxChurches).toBe(0 + 1);
    expect(withAddons.aiAssistant).toBe(0 + 1);

    // 🔴 NO FEATURE FLAG MOVES. An add-on buys capacity, never entitlement — so
    // a free tenant holding add-ons still has no fundraising and no donate
    // page, which is the one that would be a money surface if it were wrong.
    expect(withAddons.fundraising).toBe(false);
    expect(withAddons.blog).toBe(false);
    expect(withAddons.livestream).toBe(false);
    expect(withAddons.crm).toBe(true);
  });

  it('leaves the base matrix untouched — getEffectiveFeatures is pure', () => {
    const before = { ...getPlanFeatures('free') };
    getEffectiveFeatures('free', { aiAssistant: 9, adminSeats: 9, contactPacks: 9, unlimitedContacts: true, campuses: 9 });
    expect(getPlanFeatures('free')).toEqual(before);
  });
});
