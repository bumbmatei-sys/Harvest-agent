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
  TOP_PLAN,
  UNLIMITED_CAP,
  FEATURE_MIN_PLAN,
  FEATURE_MAP,
  type PlanFeatures,
  type FeatureKey,
} from '../plan-features';
import * as planFeaturesModule from '../plan-features';
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
    //     ⚠️ THE-343 removed the last shipped cell `Math.round` understated
    //     (Ministry's year was $564/12 = $47 exactly; since THE-372 it is
    //     $752/12, which rounds UP), so the round mutation
    //     is paired with the explicit table below rather than the shipped one.
    //     `Math.floor` still understates on the shipped table and so is left
    //     pointed at it.
    expect(() =>
      monthlyHeadlineContract(Math.round, {
        plus: { monthly: 39, quarterly: 90, yearly: 360 },
        pro: { monthly: 79, quarterly: 150, yearly: 600 },
        max: { monthly: 159, quarterly: 399, yearly: 1325 },
      }),
    ).toThrow(/may never promise less than the bill/);
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

  // ── 6 ── 🔴 ───────────────────────────────────────────────────────────────
  it('free has SIGNUPS and not CRM — which is also how it still has analytics', () => {
    // 🔴 THE-335 — the founder's split: "The free plan should have signup
    // feature not CRM since we separated them." This test used to read
    // `free.crm === true`, and the sentence it asserted ("which is also how it
    // has analytics") is the reason the swap needed a second cell rather than
    // one flipped boolean.
    expect(free.crm).toBe(false);
    expect(hasFeature('free', 'crm')).toBe(false);
    expect(free.signups).toBe(true);
    expect(hasFeature('free', 'signups')).toBe(true);

    // ⚠️ STILL no `analytics` cell in this matrix, on ANY tier: analytics is a
    // PERMISSION on the Signups screen, not a plan flag. So "free gets
    // analytics" is asserted as `signups: true` plus the continued absence of a
    // flag that would be a lie to invent — the sentence moved to the screen
    // analytics actually lives on, and no cell was added to carry it.
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
    expect(hasFeature('free', 'maxChurches')).toBe(false);
    // `aiAssistant` was here too, pinned at 0 with `hasFeature` false. The cell
    // is gone with the Telegram assistant (THE-253), so there is nothing left
    // to read as 0 — `'aiAssistant' in free` is asserted false further down.

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
    // 🔴 THE-335 — `crm` left and `signups` arrived. The pair is what the split is.
    expect(truthy).toEqual(['signups', 'maxContacts', 'maxCourses', 'maxAdmins', 'pwaApp'].sort());
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
    // The full map, pinned by value. `crm` moved to 'Free' when free went in at
    // the front of PLAN_ORDER, and THE-335 moved it back to 'Individual': free
    // no longer carries CRM, so the cheapest tier that does is Individual again.
    // 🔴 `signups` IS NOT IN THIS MAP and must not be added to it: this map is
    // keyed on GATE names (`FEATURE_MAP`), and the Signups screen is gated on
    // its cell directly rather than through a gate key.
    expect(FEATURE_MIN_PLAN).toEqual({
      fundraising: 'Individual',
      event_registration: 'Ministry',
      docs: 'Small Team',
      crm: 'Individual', // ⬅️ MOVED BACK (THE-335). Free no longer carries CRM.
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
      // ⬅️ NEW CELL (THE-205). free is false, so the feed's floor is the
      // cheapest tier that pays — the same answer `blog` gives, and for the
      // same reason. The feed was ungated entirely before this cell existed.
      newsFeed: 'plus',
      // 🔴 null, not 'pro' — MOVED by THE-253. `getMinPlanForFeatureCell` walks
      // PLAN_ORDER for the first tier carrying the cell and answers null when
      // none does. No plan includes the RAG chat or its knowledge base; they
      // are the AI Assistant add-on. A tier name here would put "Available on
      // Small Team and above" onto upgrade copy for a thing upgrading does not
      // buy — which is exactly what this table exists to prevent.
      aiChat: null,
      aiKnowledge: null,
      map: 'pro',
      maxChurches: 'plus',      // free is 0 → falsy → unchanged
      maxContacts: 'free',      // ⬅️ MOVED from 'plus'
      maxCourses: 'free',       // ⬅️ MOVED from 'plus'
      maxAdmins: 'free',        // ⬅️ MOVED from 'plus'
      // 🔴 `aiChat`/`aiKnowledge` are `null`, not 'pro' — no tier grants either
      // as of THE-253, so there is no minimum plan to name. `aiAssistant` is
      // absent entirely: the cell was deleted with the Telegram assistant.
      customDomain: 'max',
      customBranding: 'max',
      newsletterAutomation: 'pro',
      automatedNewsletter: 'max',
      // 🔴 THE-314 — MOVED from 'plus' to 'max'. SMS is Ministry-only, so the
      // upgrade screens that read this now name Ministry rather than Individual.
      smsAutomation: 'max',
      fundraising: 'plus',      // 🔴 UNCHANGED — free has no donate page
      eventRegistration: 'max',
      docs: 'pro',
      crm: 'plus',              // ⬅️ MOVED BACK to 'plus' (THE-335)
      signups: 'free',          // ⬅️ NEW CELL (THE-335) — free is what it exists for
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
      textToGive: 'max',        // 🔴 THE-314 — moves with smsAutomation above
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
  // it stood at d07203fb — BEFORE the free tier existed.
  //
  // ⚠️ `newsFeed` did not exist as a CELL at d07203fb: the news feed was ungated
  // on every tier, so every tier had it. `newsFeed: true` below is therefore the
  // faithful transcription of that state, not a new grant — THE-205 added the
  // cell precisely because free became the first tier to answer it `false`, and
  // these three rows are what proves it took nothing from a tier that pays. Written out rather
  // than compared against getPlanFeatures, which would compare the subject with
  // itself. If adding a tier changed one cell on a plan a church pays for, one
  // of these three fails and names it.
  //
  // 🔴 SIX CELLS MOVED SINCE, AND ONLY BY DELIBERATE REPRICINGS — THE-370 moved
  // `maxContacts` (150 → 500, 500 → 2,000, 2,000 → 4,000) and `maxChurches`
  // (1 → UNLIMITED_CAP on all three). Those are the ticket's whole subject and
  // are asserted per plan in `effective-features.test.ts`; they are transcribed
  // here so this row keeps being a no-regression check on EVERY OTHER cell
  // rather than failing wholesale on the two that were meant to move.

  const BEFORE: Record<PricedPlan, PlanFeatures> = {
    plus: {
      newsFeed: true, blog: true, aiChat: false, aiKnowledge: false, map: false,
      maxChurches: UNLIMITED_CAP, maxContacts: 500, maxCourses: 2, maxAdmins: 2,
      customDomain: false, customBranding: false,
      newsletterAutomation: false, automatedNewsletter: false,
      // 🔴 THE-314 — SMS is Ministry-only. plus and pro LOST these two cells.
      smsAutomation: false, fundraising: true,
      eventRegistration: false, docs: false, crm: true, signups: true,
      accountingTools: false, taxReceipt: false, communityGroups: false,
      customForms: false, checkInSystem: false, livestream: false,
      sermonNotes: false, automatedBlog: false, givingStatements: false,
      pledgeCampaigns: false, textToGive: false, pwaApp: true,
    },
    pro: {
      newsFeed: true, blog: true, aiChat: false, aiKnowledge: false, map: true,
      maxChurches: UNLIMITED_CAP, maxContacts: 2_000, maxCourses: 5, maxAdmins: 5,
      customDomain: false, customBranding: false,
      newsletterAutomation: true, automatedNewsletter: false,
      // 🔴 THE-314 — SMS is Ministry-only. plus and pro LOST these two cells.
      smsAutomation: false, fundraising: true,
      eventRegistration: false, docs: true, crm: true, signups: true,
      accountingTools: false, taxReceipt: false, communityGroups: false,
      customForms: false, checkInSystem: true, livestream: true,
      sermonNotes: true, automatedBlog: false, givingStatements: false,
      pledgeCampaigns: false, textToGive: false, pwaApp: true,
    },
    max: {
      newsFeed: true, blog: true, aiChat: false, aiKnowledge: false, map: true,
      maxChurches: UNLIMITED_CAP, maxContacts: 4_000, maxCourses: 15, maxAdmins: 15,
      customDomain: true, customBranding: true,
      newsletterAutomation: true, automatedNewsletter: true,
      smsAutomation: true, fundraising: true,
      eventRegistration: true, docs: true, crm: true, signups: true,
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
    // ⚠️ THE SUBJECT OF THIS FILE IS THE FREE TIER, and the pin moves only when
    // a reprice ticket moves it. THE-343 was that ticket for `max` — $80 to
    // $60 — and THE-372 moved it back to $80, with the quarter and year at $216
    // and $752 keeping THE-343's ratios. `plus` and `pro` are enumerated here precisely so a reprice
    // that reached further than its brief cannot pass this file.
    expect(PLAN_PRICING).toEqual({
      plus: { monthly: 20, quarterly: 54, yearly: 190 },
      pro: { monthly: 40, quarterly: 108, yearly: 380 },
      max: { monthly: 80, quarterly: 216, yearly: 752 },
    });
  });

  it('the billing terms and advertised discounts are unchanged', () => {
    expect([...BILLING_TERMS]).toEqual(['monthly', 'quarterly', 'yearly']);
    expect(ADVERTISED_DISCOUNT_PCT).toEqual({ quarterly: 10, yearly: 20 });
  });

  it('🔴 the contact pack is GONE, constant and all — THE-370', () => {
    /* WAS 'the add-on pack size is unchanged', pinning `CONTACTS_PER_PACK` at
       500. The founder retired the Contacts +500 add-on and raised the caps
       instead, so the constant has no meaning left and is DELETED rather than
       left dormant — the same treatment `plan-features.ts` records for the
       three cells it removed for being read by nothing.

       Asserted on the module's own exports, so a reintroduced constant fails
       here by name. */
    const exported = Object.keys(planFeaturesModule);
    expect(exported).not.toContain('CONTACTS_PER_PACK');
    expect(exported).toContain('UNLIMITED_CAP');
  });
});

describe('THE-200 — add-ons layered on a free tenant (reported, not guarded)', () => {
  // ⚠️ REPORTED BEHAVIOUR, NOT A REQUIREMENT. Nothing today can sell an add-on
  // to a free tenant: add-ons are attached to Dodo PRODUCTS, free has no
  // product, and the add-on route reads the tenant's live subscription. This
  // pins what WOULD happen if one arrived anyway (a hand-edited Firestore doc,
  // a tenant downgraded to free while holding one), so PR 2 and PR 4 can decide
  // deliberately rather than discovering it.
  it('raises free\u2019s admin cap like any other tier, and grants no feature flag', () => {
    const withAddons = getEffectiveFeatures('free', {
      aiAssistant: 1,
      adminSeats: 2,
      unlimitedContacts: false,
    });

    // 🔴 ONE CAP CELL MOVES NOW, NOT THREE — THE-370. The contact-pack and
    // campus add-ons are retired, so `maxContacts` and `maxChurches` read
    // straight through from the tier even for a tenant holding everything.
    // The old note here worried that a pack could lift a free tenant above
    // Individual's 150 contacts; that cannot happen any more, and Individual
    // is 500 in any case.
    expect(withAddons.maxAdmins).toBe(1 + 2);
    expect(withAddons.maxContacts).toBe(500);
    // 🔴 AND FREE STAYS AT ZERO CAMPUSES. Nothing an add-on carries can give a
    // free tenant a campus now — the only path there was the retired add-on.
    expect(withAddons.maxChurches).toBe(0);

    // 🔴 ONE FEATURE FLAG NOW MOVES, AND EXACTLY ONE — INVERTED BY THE-253.
    // This block used to read "NO FEATURE FLAG MOVES. An add-on buys capacity,
    // never entitlement." That rule was true and it was the defect: the AI
    // Assistant add-on is a live product that granted nothing. It now lifts
    // `aiChat` and `aiKnowledge`, on every tier including this one.
    expect(withAddons.aiChat).toBe(true);
    expect(withAddons.aiKnowledge).toBe(true);

    // ⚠️ AND THAT IS NOT A FREE AI CHAT. `PLAN_LIMITS.free.queryTokensPerMonth`
    // is 0, so the budget gate refuses the first question. The scenario is
    // hypothetical anyway — free has no Dodo subscription to attach an add-on
    // to (see the note above this test) — and it is pinned in
    // `the-253-ai-chat-addon.test.ts` rather than left to be discovered.

    // 🔴 EVERY OTHER FLAG STILL HOLDS. A free tenant holding add-ons has no
    // fundraising and no donate page, which is the one that would be a money
    // surface if it were wrong.
    expect(withAddons.fundraising).toBe(false);
    expect(withAddons.blog).toBe(false);
    expect(withAddons.livestream).toBe(false);
    // 🔴 THE-335 — an add-on grants no feature flag, and that is still true of
    // BOTH halves of the split: it neither restores the CRM free lost nor
    // withdraws the Signups screen free keeps.
    expect(withAddons.crm).toBe(false);
    expect(withAddons.signups).toBe(true);
  });

  it('leaves the base matrix untouched — getEffectiveFeatures is pure', () => {
    const before = { ...getPlanFeatures('free') };
    getEffectiveFeatures('free', { aiAssistant: 9, adminSeats: 9, unlimitedContacts: true });
    expect(getPlanFeatures('free')).toEqual(before);
  });
});
