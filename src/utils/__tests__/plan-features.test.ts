import { describe, it, expect } from 'vitest';
import {
  getPlanFeatures,
  getPlanDisplayName,
  hasFeature,
  hasBrandingAccess,
  PLAN_PRICING,
  PLAN_PLATFORM_FEE_PCT,
  AI_ASSISTANT_ADDON_PRICING,
  formatPlanPrice,
  getFeatureMinPlan,
  FEATURE_MIN_PLAN,
  FEATURE_MAP,
  PLAN_ORDER,
  PLAN_DISPLAY_NAMES,
  getMinPlanForFeatureCell,
  type FeatureKey,
} from '../plan-features';
// The rate actually charged. Importing stripe-config is safe HERE and only here:
// tests run server-side, where its STRIPE_PRICE_* env reads resolve. Today they
// resolve via the `?? 'price_...'` fallbacks; once B1 (#207) removes those and
// makes the module throw on a missing var, its own src/test/setup.ts stubs all
// nine — verified by running this import against #207 with every var unset.
// Do NOT copy this import into plan-features.ts itself: that module is pulled
// into ~20 client components and would take the browser bundle down under B1.
import { PLATFORM_FEE_MAP } from '@/lib/stripe-config';

describe('getPlanFeatures', () => {
  it('returns correct features for plus (Seed, free) plan', () => {
    const f = getPlanFeatures('plus');
    expect(f.blog).toBe(true);
    // RAG stays paid on the free tier — the one feature exclusion besides SMS.
    expect(f.aiChat).toBe(false);
    expect(f.maxChurches).toBe(2);
    expect(f.maxCourses).toBe(2);
    expect(f.maxAdmins).toBe(3);
    expect(f.maxMembers).toBe(250);
    // Free tier now carries custom domains — features are not what paid tiers sell.
    expect(f.customDomain).toBe(true);
    expect(f.aiAssistant).toBe(0);
  });

  it('returns correct features for pro (Root) plan', () => {
    const f = getPlanFeatures('pro');
    expect(f.aiChat).toBe(true);
    expect(f.maxCourses).toBe(5);
    expect(f.maxAdmins).toBe(9);
    expect(f.maxMembers).toBe(1000);
    expect(f.customDomain).toBe(true);
  });

  it('returns correct features for ultra (Harvest, top) plan', () => {
    const f = getPlanFeatures('ultra');
    expect(f.aiAssistant).toBe(1);
    expect(f.customDomain).toBe(true);
    expect(f.maxAdmins).toBe(-1);
    expect(f.maxMembers).toBe(-1);
    // Was -1 (unlimited); the campus allowance made it a hard cap of 8.
    expect(f.maxChurches).toBe(8);
    expect(f.map).toBe(true);
  });

  it('defaults to plus for unknown plan', () => {
    const f = getPlanFeatures('nonexistent' as any);
    expect(f).toEqual(getPlanFeatures('plus'));
  });
});

describe('getPlanDisplayName', () => {
  it('returns correct display names', () => {
    expect(getPlanDisplayName('plus')).toBe('Seed');
    expect(getPlanDisplayName('pro')).toBe('Root');
    expect(getPlanDisplayName('max')).toBe('Grove');
    expect(getPlanDisplayName('ultra')).toBe('Harvest');
  });

  it('renames the four tiers to Seed / Root / Grove / Harvest', () => {
    // Mutation guard for the rename. Internal ids stay plus/pro/max/ultra —
    // they are written on every tenant doc in Firestore, so renaming THOSE
    // would be a data migration. Only the display names move.
    expect(PLAN_ORDER.map((p) => PLAN_DISPLAY_NAMES[p])).toEqual([
      'Seed', 'Root', 'Grove', 'Harvest',
    ]);
    expect(Object.keys(PLAN_DISPLAY_NAMES)).toEqual(['plus', 'pro', 'max', 'ultra']);
  });

  it('defaults to the free tier name for an unknown plan', () => {
    expect(getPlanDisplayName('bad' as any)).toBe('Seed');
  });
});

describe('hasFeature', () => {
  it('returns true for enabled boolean features', () => {
    expect(hasFeature('pro', 'aiChat')).toBe(true);
    expect(hasFeature('plus', 'blog')).toBe(true);
  });

  it('AI chat is available on Small Team and above', () => {
    expect(hasFeature('plus', 'aiChat')).toBe(false);
    expect(hasFeature('pro', 'aiChat')).toBe(true);
    expect(hasFeature('max', 'aiChat')).toBe(true);
    expect(hasFeature('ultra', 'aiChat')).toBe(true);
  });

  it('returns false for disabled boolean features', () => {
    expect(hasFeature('plus', 'aiKnowledge')).toBe(false);
  });

  it('returns true for non-zero numeric features', () => {
    expect(hasFeature('plus', 'maxChurches')).toBe(true);
    expect(hasFeature('plus', 'maxCourses')).toBe(true);
  });

  // ─── Freemium: every feature is on for every tier except RAG and SMS ───────
  //
  // These `it`s were "X is available on <tier> and above" placement guards. The
  // placement changed — it did not stop mattering — so each one is kept and now
  // asserts the free-tier truth. Reverting any single cell fails here by name.

  const FREE_ON_EVERY_TIER = [
    'accountingTools', 'automatedBlog', 'automatedNewsletter', 'checkInSystem',
    'churchDirectory', 'communityGroups', 'crm', 'customBranding', 'customDomain',
    'customForms', 'docs', 'eventRegistration', 'givingStatements', 'livestream',
    'map', 'newsletterAutomation', 'pledgeCampaigns', 'sermonNotes', 'taxReceipt',
  ] as const;

  it.each(FREE_ON_EVERY_TIER)('%s is unlocked on all four tiers', (key) => {
    PLAN_ORDER.forEach((plan) => {
      expect(hasFeature(plan, key), `${key} locked on ${plan}`).toBe(true);
    });
  });

  it('map is available on every tier, including the free one', () => {
    expect(hasFeature('plus', 'map')).toBe(true);
    expect(hasFeature('pro', 'map')).toBe(true);
    expect(hasFeature('max', 'map')).toBe(true);
    expect(hasFeature('ultra', 'map')).toBe(true);
  });

  it('automatedNewsletter is available on every tier, including the free one', () => {
    expect(hasFeature('plus', 'automatedNewsletter')).toBe(true);
    expect(hasFeature('pro', 'automatedNewsletter')).toBe(true);
    expect(hasFeature('max', 'automatedNewsletter')).toBe(true);
    expect(hasFeature('ultra', 'automatedNewsletter')).toBe(true);
  });

  it('customBranding (logo/colors/name) is available on every tier', () => {
    expect(hasFeature('plus', 'customBranding')).toBe(true);
    expect(hasFeature('pro', 'customBranding')).toBe(true);
    expect(hasFeature('max', 'customBranding')).toBe(true);
    expect(hasFeature('ultra', 'customBranding')).toBe(true);
  });

  it('customDomain is available on every tier', () => {
    expect(hasFeature('plus', 'customDomain')).toBe(true);
    expect(hasFeature('pro', 'customDomain')).toBe(true);
    expect(hasFeature('max', 'customDomain')).toBe(true);
    expect(hasFeature('ultra', 'customDomain')).toBe(true);
  });

  it('customForms is available on every tier', () => {
    expect(hasFeature('plus', 'customForms')).toBe(true);
    expect(hasFeature('pro', 'customForms')).toBe(true);
    expect(hasFeature('max', 'customForms')).toBe(true);
    expect(hasFeature('ultra', 'customForms')).toBe(true);
  });

  it('checkInSystem is available on every tier', () => {
    expect(hasFeature('plus', 'checkInSystem')).toBe(true);
    expect(hasFeature('pro', 'checkInSystem')).toBe(true);
    expect(hasFeature('max', 'checkInSystem')).toBe(true);
    expect(hasFeature('ultra', 'checkInSystem')).toBe(true);
  });

  it('livestream is available on every tier', () => {
    expect(hasFeature('plus', 'livestream')).toBe(true);
    expect(hasFeature('pro', 'livestream')).toBe(true);
    expect(hasFeature('max', 'livestream')).toBe(true);
    expect(hasFeature('ultra', 'livestream')).toBe(true);
  });

  it('sermonNotes is available on every tier', () => {
    expect(hasFeature('plus', 'sermonNotes')).toBe(true);
    expect(hasFeature('pro', 'sermonNotes')).toBe(true);
    expect(hasFeature('max', 'sermonNotes')).toBe(true);
    expect(hasFeature('ultra', 'sermonNotes')).toBe(true);
  });

  it('automatedBlog is available on every tier', () => {
    expect(hasFeature('plus', 'automatedBlog')).toBe(true);
    expect(hasFeature('pro', 'automatedBlog')).toBe(true);
    expect(hasFeature('max', 'automatedBlog')).toBe(true);
    expect(hasFeature('ultra', 'automatedBlog')).toBe(true);
  });

  it('givingStatements is available on every tier', () => {
    expect(hasFeature('plus', 'givingStatements')).toBe(true);
    expect(hasFeature('pro', 'givingStatements')).toBe(true);
    expect(hasFeature('max', 'givingStatements')).toBe(true);
    expect(hasFeature('ultra', 'givingStatements')).toBe(true);
  });

  it('eventRegistration is available on every tier', () => {
    expect(hasFeature('plus', 'eventRegistration')).toBe(true);
    expect(hasFeature('pro', 'eventRegistration')).toBe(true);
    expect(hasFeature('max', 'eventRegistration')).toBe(true);
    expect(hasFeature('ultra', 'eventRegistration')).toBe(true);
  });

  it('pledgeCampaigns is available on every tier', () => {
    expect(hasFeature('plus', 'pledgeCampaigns')).toBe(true);
    expect(hasFeature('pro', 'pledgeCampaigns')).toBe(true);
    expect(hasFeature('max', 'pledgeCampaigns')).toBe(true);
    expect(hasFeature('ultra', 'pledgeCampaigns')).toBe(true);
  });

  it('churchDirectory is available on every tier (was top-tier only)', () => {
    expect(hasFeature('plus', 'churchDirectory')).toBe(true);
    expect(hasFeature('pro', 'churchDirectory')).toBe(true);
    expect(hasFeature('max', 'churchDirectory')).toBe(true);
    expect(hasFeature('ultra', 'churchDirectory')).toBe(true);
  });

  it('accountingTools is available on every tier (was top-tier only)', () => {
    expect(hasFeature('plus', 'accountingTools')).toBe(true);
    expect(hasFeature('pro', 'accountingTools')).toBe(true);
    expect(hasFeature('max', 'accountingTools')).toBe(true);
    expect(hasFeature('ultra', 'accountingTools')).toBe(true);
  });

  it('pwaApp (mobile app) is available on all plans', () => {
    expect(hasFeature('plus', 'pwaApp')).toBe(true);
    expect(hasFeature('pro', 'pwaApp')).toBe(true);
    expect(hasFeature('max', 'pwaApp')).toBe(true);
    expect(hasFeature('ultra', 'pwaApp')).toBe(true);
  });

  it('publicCalendar is available on all plans (public-facing)', () => {
    expect(hasFeature('plus', 'publicCalendar')).toBe(true);
    expect(hasFeature('pro', 'publicCalendar')).toBe(true);
    expect(hasFeature('max', 'publicCalendar')).toBe(true);
    expect(hasFeature('ultra', 'publicCalendar')).toBe(true);
  });

  // ─── The two exclusions ───────────────────────────────────────────────────
  //
  // SMS is the only feature family the free tier does not get: it carries a hard
  // per-segment carrier cost. RAG (aiChat / aiKnowledge) is the other, asserted
  // in its own block below because it is UNCHANGED by the freemium move.

  it('smsAutomation is locked on the free tier and unlocked on all paid tiers', () => {
    expect(hasFeature('plus', 'smsAutomation')).toBe(false);
    expect(hasFeature('pro', 'smsAutomation')).toBe(true);
    expect(hasFeature('max', 'smsAutomation')).toBe(true);
    expect(hasFeature('ultra', 'smsAutomation')).toBe(true);
  });

  it('textToGive tracks SMS, not the everything-is-free rule', () => {
    // Text-to-Give is inbound-SMS-keyword only — there is no non-SMS path in the
    // codebase — so it is excluded from the free tier for the same carrier-cost
    // reason as smsAutomation, and moves with it.
    expect(hasFeature('plus', 'textToGive')).toBe(false);
    expect(hasFeature('pro', 'textToGive')).toBe(true);
    expect(hasFeature('max', 'textToGive')).toBe(true);
    expect(hasFeature('ultra', 'textToGive')).toBe(true);
  });

  it('RAG (aiChat / aiKnowledge) is UNCHANGED — still off on free, on everywhere else', () => {
    // Deliberately not swept up in the freemium flip: RAG moves to add-on gating
    // in its own change. Turning it on here would be the wrong shape; turning it
    // off on the paid tiers would kill RAG for every current paying tenant.
    (['aiChat', 'aiKnowledge'] as const).forEach((key) => {
      expect(hasFeature('plus', key), `${key} on free tier`).toBe(false);
      expect(hasFeature('pro', key)).toBe(true);
      expect(hasFeature('max', key)).toBe(true);
      expect(hasFeature('ultra', key)).toBe(true);
    });
  });
});

describe('Branding tab entitlement (hasBrandingAccess)', () => {
  // The retired `customBackground` flag used to be a third term in this OR chain
  // (AdminDashboard's canBranding). It was true on exactly max + ultra — the same
  // tiers customBranding is true on — so removing it must not hide the Branding
  // tab from any tier. This table is the before AND the after; if it ever
  // changes, a paying plan just lost a feature.
  const EXPECTED: Record<string, boolean> = {
    plus: true,    // Seed    — customBranding + customDomain (freemium: gained)
    pro: true,     // Root    — customBranding + customDomain (freemium: gained)
    max: true,     // Grove   — customBranding (unchanged)
    ultra: true,   // Harvest — customBranding + customDomain (unchanged)
  };

  (['plus', 'pro', 'max', 'ultra'] as const).forEach((plan) => {
    it(`${plan}: Branding tab ${EXPECTED[plan] ? 'visible' : 'hidden'}`, () => {
      expect(hasBrandingAccess(getPlanFeatures(plan))).toBe(EXPECTED[plan]);
    });
  });

  it('no tier that had branding-family access before has lost it', () => {
    // Pre-removal matrix values, transcribed from git history:
    //   plan   customBranding  customBackground  customDomain
    //   plus   false           false             false
    //   pro    false           false             false
    //   max    true            true              false
    //   ultra  true            true              true
    const BEFORE: Record<string, { branding: boolean; background: boolean; domain: boolean }> = {
      plus:  { branding: false, background: false, domain: false },
      pro:   { branding: false, background: false, domain: false },
      max:   { branding: true,  background: true,  domain: false },
      ultra: { branding: true,  background: true,  domain: true },
    };
    // One-directional now: the freemium move GRANTED branding to the two lower
    // tiers, so this can no longer be an equality. The invariant it exists to
    // protect is unchanged — no tier may LOSE branding-family access.
    (['plus', 'pro', 'max', 'ultra'] as const).forEach((plan) => {
      const b = BEFORE[plan];
      const beforeVisible = b.branding || b.background || b.domain;
      if (beforeVisible) {
        expect(hasBrandingAccess(getPlanFeatures(plan)), `${plan} lost branding`).toBe(true);
      }
    });
    // And every tier has it now — branding is a free-tier feature.
    (['plus', 'pro', 'max', 'ultra'] as const).forEach((plan) => {
      expect(hasBrandingAccess(getPlanFeatures(plan))).toBe(true);
    });
  });

  it('customBackground is gone from the plan matrix entirely', () => {
    (['plus', 'pro', 'max', 'ultra'] as const).forEach((plan) => {
      expect('customBackground' in getPlanFeatures(plan)).toBe(false);
    });
  });
});

describe('AI_ASSISTANT_ADDON_PRICING', () => {
  it('AI Assistant add-on is $200/mo flat with no setup fee', () => {
    expect(AI_ASSISTANT_ADDON_PRICING.monthlyUsd).toBe(200);
    expect('setupFeeUsd' in AI_ASSISTANT_ADDON_PRICING).toBe(false);
  });
});

describe('PLAN_PLATFORM_FEE_PCT (THE-51 identity guard, re-pointed)', () => {
  // What the ministry is TOLD it pays must equal what Stripe actually takes as
  // the platform application fee. `platformFeePct` is a hand-maintained mirror
  // of PLATFORM_FEE_MAP (plan-features.ts cannot import stripe-config.ts — it is
  // pulled into ~20 client components, and that module reads server-only
  // STRIPE_PRICE_* env vars at load). Nothing enforces the mirror structurally,
  // so it is enforced here.
  //
  // This is the direct successor to THE-51's guard, which caught a real
  // overstatement: a tier advertised 100% retention while a fee was deducted.
  // The retention framing is gone — it was the `100 - fee * 100` complement,
  // two numbers for one fact — and the fee is now stated the same way in both
  // modules, so the identity is a plain multiplication.
  //
  // Strict equality is safe: 0.04*100, 0.02*100 and 0.01*100 are all exact in
  // IEEE 754 (verified in Node), so there is no float slop to tolerate here.
  const PLANS = ['plus', 'pro', 'max', 'ultra'] as const;

  it.each(PLANS)(
    'displayed fee for "%s" equals PLATFORM_FEE_MAP * 100 (the rate actually charged)',
    (plan) => {
      expect(getPlanFeatures(plan).platformFeePct).toBe(PLATFORM_FEE_MAP[plan] * 100);
    }
  );

  it('matches the fee schedule exactly (4 / 2 / 1 / 0)', () => {
    expect(PLAN_PLATFORM_FEE_PCT.plus).toBe(4);  // free tier pays the most
    expect(PLAN_PLATFORM_FEE_PCT.pro).toBe(2);
    expect(PLAN_PLATFORM_FEE_PCT.max).toBe(1);
    expect(PLAN_PLATFORM_FEE_PCT.ultra).toBe(0); // top tier pays nothing
  });

  // Replaces THE-51's NON-INTEGER guard, which is retired rather than
  // re-pointed. That test existed to prove a FRACTIONAL percentage survived
  // string formatting and a JSON round-trip (a `toFixed(1)` on 98.75 would have
  // rendered a wrong number on a pricing surface). Every fee is an integer now,
  // so there is no fraction left for it to protect and it would assert nothing.
  //
  // ⚠️ IF A FRACTIONAL FEE IS EVER REINTRODUCED (say 2.5%), formatting must be
  // re-verified end to end — the comparison table renders `${v}%` and
  // /api/plans serves the number raw as JSON. Do not re-add 2.5 and assume it
  // renders as 2.5%; the previous scheme silently rendered 3%. This assertion
  // is the tripwire: it fails first, loudly, at the value rather than at the
  // pixel.
  it.each(PLANS)('fee for "%s" is a whole percentage — no fractional fees', (plan) => {
    expect(Number.isInteger(PLAN_PLATFORM_FEE_PCT[plan])).toBe(true);
  });

  it('never advertises a lower fee than the schedule actually charges', () => {
    PLANS.forEach((plan) => {
      expect(getPlanFeatures(plan).platformFeePct).toBeGreaterThanOrEqual(
        PLATFORM_FEE_MAP[plan] * 100
      );
    });
  });

  it('stays in sync with the platformFeePct field in the feature matrix', () => {
    PLANS.forEach((plan) => {
      expect(getPlanFeatures(plan).platformFeePct).toBe(PLAN_PLATFORM_FEE_PCT[plan]);
    });
  });

  it('retires donationRetention entirely — the field is gone from every plan', () => {
    // Regression guard for the retirement. Retention was a derived complement of
    // the fee; keeping both is what let the app advertise one number while
    // charging another. If this fails, someone re-added the duplicate.
    PLANS.forEach((plan) => {
      expect('donationRetention' in getPlanFeatures(plan)).toBe(false);
    });
  });
});

describe('communityGroups tier', () => {
  // Community Groups was sold on Community (max) and above. Under the freemium
  // model it is on every tier — features are not what paid plans sell. The
  // guard below is kept and inverted: it now pins that the tier move did not
  // quietly drag RAG or SMS along with it.
  it('is unlocked on every tier, including the free one', () => {
    PLAN_ORDER.forEach((plan) => {
      expect(getPlanFeatures(plan).communityGroups).toBe(true);
    });
  });

  it('did not drag RAG or SMS onto the free tier', () => {
    // The four cells that must stay off on `plus`. A fifth feature riding along
    // with the freemium flip fails here.
    const f = getPlanFeatures('plus');
    expect(f.aiChat).toBe(false);
    expect(f.aiKnowledge).toBe(false);
    expect(f.smsAutomation).toBe(false);
    expect(f.textToGive).toBe(false);
    // Everything the old guard pinned as Ministry-only is now free — asserted
    // explicitly so the move is visible here rather than silent.
    expect(f.accountingTools).toBe(true);
    expect(f.churchDirectory).toBe(true);
    expect(f.customDomain).toBe(true);
  });
});

describe('getFeatureMinPlan / FEATURE_MIN_PLAN (derived)', () => {
  // These labels drive the upgrade screens — the exact surface where someone
  // decides what to buy — so a label naming a pricier plan than the matrix
  // requires is a direct over-sell. They used to be two hand-maintained literal
  // maps and had drifted; now they are derived from PLAN_FEATURES.
  it('returns the cheapest plan that unlocks the feature — now the free tier for all of them', () => {
    // Every gate key fronts a boolean feature, and every boolean feature except
    // RAG/SMS is on the free tier, so the derivation bottoms out at `plus` for
    // all seven. That is the freemium model, not a bug in the derivation — the
    // generic agreement tests below still prove the derivation itself works.
    expect(getFeatureMinPlan('fundraising')).toBe('plus');
    expect(getFeatureMinPlan('event_registration')).toBe('plus');
    expect(getFeatureMinPlan('docs')).toBe('plus');
    expect(getFeatureMinPlan('accounting')).toBe('plus');
  });

  it('puts CRM on the free tier', () => {
    // History, kept because it is the reason this map is derived at all: the old
    // literal maps said 'Ministry' while max.crm was true (#242), then the
    // repricing moved `crm` to Small Team, and now freemium moves it to Seed.
    // Three moves, zero edits to any label — that is the point of deriving.
    expect(getFeatureMinPlan('crm')).toBe('plus');
    expect(FEATURE_MIN_PLAN.crm).toBe('Seed');
  });

  it('puts tax receipts on the free tier', () => {
    expect(getFeatureMinPlan('tax_receipts')).toBe('plus');
    expect(FEATURE_MIN_PLAN.tax_receipts).toBe('Seed');
  });

  it('puts Community Groups on the free tier', () => {
    expect(getFeatureMinPlan('community_chat')).toBe('plus');
    expect(FEATURE_MIN_PLAN.community_chat).toBe('Seed');
  });

  it('is vacuous for features now — every gate key resolves to the free tier', () => {
    // The direct consequence of "every feature is free": `hasFeature` returns
    // true for every gate key on every plan, so no upgrade screen can fire for a
    // FEATURE reason any more. Limits (and, later, the RAG add-on) are the only
    // remaining upgrade reasons. Asserted explicitly so that if a future change
    // makes a feature paid again, this fails and the dead-branch note below gets
    // revisited rather than silently becoming wrong.
    (Object.keys(FEATURE_MAP) as FeatureKey[]).forEach((key) => {
      expect(getFeatureMinPlan(key), `${key} is not free`).toBe('plus');
      expect(FEATURE_MIN_PLAN[key]).toBe('Seed');
      expect(hasFeature('plus', FEATURE_MAP[key])).toBe(true);
    });
  });

  it('agrees with the feature matrix for every gate key', () => {
    (Object.keys(FEATURE_MAP) as FeatureKey[]).forEach((key) => {
      const minPlan = getFeatureMinPlan(key);
      expect(minPlan, `no plan unlocks ${key}`).not.toBeNull();
      // Unlocked at the named tier...
      expect(hasFeature(minPlan!, FEATURE_MAP[key])).toBe(true);
      // ...and locked on every cheaper tier.
      PLAN_ORDER.slice(0, PLAN_ORDER.indexOf(minPlan!)).forEach((cheaper) => {
        expect(
          hasFeature(cheaper, FEATURE_MAP[key]),
          `${key} unlocked on ${cheaper}, cheaper than the advertised ${minPlan}`
        ).toBe(false);
      });
      expect(FEATURE_MIN_PLAN[key]).toBe(getPlanDisplayName(minPlan!));
    });
  });

  it('never advertises a pricier plan than the matrix requires', () => {
    (Object.keys(FEATURE_MAP) as FeatureKey[]).forEach((key) => {
      const advertised = PLAN_ORDER.findIndex(
        (p) => getPlanDisplayName(p) === FEATURE_MIN_PLAN[key]
      );
      const actual = PLAN_ORDER.findIndex((p) => hasFeature(p, FEATURE_MAP[key]));
      expect(advertised, `${key} advertises a tier above what it needs`).toBe(actual);
    });
  });

  it('is frozen — it is derived state, not config to edit', () => {
    expect(Object.isFrozen(FEATURE_MIN_PLAN)).toBe(true);
  });
});

// ─── Custom domain: now free on every tier ───────────────────────────────────
//
// Custom domains moved Ministry-only → Community-and-above → free on every tier.
// These tests are the mutation guard for the current position: locking
// `plus.customDomain` back to false must fail here by name.

describe('customDomain tier (free on every tier)', () => {
  it('is unlocked on every tier', () => {
    PLAN_ORDER.forEach((plan) => {
      expect(getPlanFeatures(plan).customDomain).toBe(true);
    });
  });

  // The label the admin UI shows in the locked state. `customDomain` has NO
  // FeatureKey — the gate-key union covers only features fronted by
  // usePlanGate/PlanUpgradeScreen, and custom domain is gated by a boolean prop
  // on DomainSection instead. So the label derives via getMinPlanForFeatureCell
  // on the raw matrix cell rather than via FEATURE_MIN_PLAN. Deliberately not
  // adding a FeatureKey just to get a label.
  it('has no FeatureKey, and its minimum-plan label derives to the free tier', () => {
    expect(Object.values(FEATURE_MAP)).not.toContain('customDomain');

    const minPlan = getMinPlanForFeatureCell('customDomain');
    expect(minPlan).toBe('plus');
    expect(PLAN_DISPLAY_NAMES[minPlan!]).toBe('Seed');
  });

  it('getMinPlanForFeatureCell agrees with getFeatureMinPlan for every gate key', () => {
    // The two share one derivation; this pins that they cannot diverge.
    (Object.keys(FEATURE_MAP) as FeatureKey[]).forEach((key) => {
      expect(getMinPlanForFeatureCell(FEATURE_MAP[key])).toBe(getFeatureMinPlan(key));
    });
  });

  it('does not change Branding tab access for any tier', () => {
    // Branding-tab access is `customBranding || customDomain`; both are free
    // now, so every tier has it.
    PLAN_ORDER.forEach((plan) => {
      expect(hasBrandingAccess(getPlanFeatures(plan))).toBe(true);
    });
  });
});

// ─── Freemium repricing: prices, fees, limits, names ─────────────────────────
//
// Mutation guard for the repricing. Every value it changed gets an assertion
// that names it, so reverting any one of them fails here rather than silently
// shipping: four fees, four prices, four limit sets and the display-name map.

describe('PLAN_PRICING (freemium repricing)', () => {
  const EXPECTED = {
    plus:  { monthlyUsd: 0,   yearlyUsd: 0    },
    pro:   { monthlyUsd: 99,  yearlyUsd: 990  },
    max:   { monthlyUsd: 179, yearlyUsd: 1790 },
    ultra: { monthlyUsd: 299, yearlyUsd: 2990 },
  } as const;

  it.each(Object.keys(EXPECTED) as (keyof typeof EXPECTED)[])(
    '%s is priced at the repriced monthly rate',
    (plan) => {
      expect(PLAN_PRICING[plan].monthlyUsd).toBe(EXPECTED[plan].monthlyUsd);
    }
  );

  it('prices the four tiers at 0 / 99 / 179 / 299 per month', () => {
    expect(PLAN_ORDER.map((p) => PLAN_PRICING[p].monthlyUsd)).toEqual([0, 99, 179, 299]);
  });

  it('prices the four tiers at 0 / 990 / 1790 / 2990 per year', () => {
    expect(PLAN_ORDER.map((p) => PLAN_PRICING[p].yearlyUsd)).toEqual([0, 990, 1790, 2990]);
  });

  it('makes the free tier actually free — $0 monthly AND no annual price', () => {
    expect(PLAN_PRICING.plus.monthlyUsd).toBe(0);
    expect(PLAN_PRICING.plus.yearlyUsd).toBe(0); // $0 has no billing period
  });

  it('bills annual as monthly × 10 (pay ten months, get twelve) on every tier', () => {
    PLAN_ORDER.forEach((plan) => {
      expect(PLAN_PRICING[plan].yearlyUsd).toBe(PLAN_PRICING[plan].monthlyUsd * 10);
      expect(PLAN_PRICING[plan].yearlyUsd).toBe(EXPECTED[plan].yearlyUsd);
    });
  });

  it('keeps Grove at $179 — every price step must be larger than the last', () => {
    // $179 is LOAD-BEARING, not a number waiting to be rounded up. Total monthly
    // cost at giving G: plus 0.04G · pro 99+0.02G · max 179+0.01G · ultra 299.
    // Those cross at $4,950 / $8,000 / $12,000, so every tier owns a band.
    // At $199, pro→max and max→ultra BOTH cross at $10,000 and Grove is
    // mathematically dominated — never the cheapest choice at any giving level.
    // The cause is structural: the fee gap shrinks each step (2 → 1 → 1) while a
    // flat $100 price step does not.
    expect(PLAN_PRICING.max.monthlyUsd).toBe(179);

    const steps = PLAN_ORDER.slice(1).map(
      (p, i) => PLAN_PRICING[p].monthlyUsd - PLAN_PRICING[PLAN_ORDER[i]].monthlyUsd
    );
    expect(steps).toEqual([99, 80, 120]);

    // The property that keeps every tier alive: at each tier's own band the
    // total cost is the minimum across all four tiers.
    const total = (plan: (typeof PLAN_ORDER)[number], giving: number) =>
      PLAN_PRICING[plan].monthlyUsd + (PLAN_PLATFORM_FEE_PCT[plan] / 100) * giving;
    const cheapestAt = (giving: number) =>
      PLAN_ORDER.reduce((best, p) => (total(p, giving) < total(best, giving) ? p : best));
    expect(cheapestAt(1_000)).toBe('plus');
    expect(cheapestAt(6_000)).toBe('pro');
    expect(cheapestAt(10_000)).toBe('max');   // the band that vanishes at $199
    expect(cheapestAt(20_000)).toBe('ultra');
  });

  it('renders the repriced values through formatPlanPrice — the string the UI shows', () => {
    expect(formatPlanPrice('plus', 'monthly')).toBe('$0/mo');
    expect(formatPlanPrice('pro', 'monthly')).toBe('$99/mo');
    expect(formatPlanPrice('max', 'monthly')).toBe('$179/mo');
    expect(formatPlanPrice('ultra', 'monthly')).toBe('$299/mo');
    expect(formatPlanPrice('max', 'yearly')).toBe('$1,790/yr');
    expect(formatPlanPrice('ultra', 'yearly')).toBe('$2,990/yr');
  });

  it('leaves the retired AI Assistant add-on at $200 — not swept up in the repricing', () => {
    // THE-13: dormant code, intact by design. It is an ADD-ON price, not a plan
    // price, and shares the `monthlyUsd` field name with PLAN_PRICING — which is
    // exactly how a bulk repricing would catch it by accident.
    expect(AI_ASSISTANT_ADDON_PRICING.monthlyUsd).toBe(200);
    expect(Object.values(PLAN_PRICING).map((p) => p.monthlyUsd)).not.toContain(200);
  });
});

describe('PLATFORM_FEE_MAP (freemium fees)', () => {
  it('is exactly { plus: 0.04, pro: 0.02, max: 0.01, ultra: 0 }', () => {
    expect(PLATFORM_FEE_MAP.plus).toBe(0.04);
    expect(PLATFORM_FEE_MAP.pro).toBe(0.02);
    expect(PLATFORM_FEE_MAP.max).toBe(0.01);
    expect(PLATFORM_FEE_MAP.ultra).toBe(0);
  });

  it('advertises fees of 4 / 2 / 1 / 0 percent', () => {
    expect(PLAN_ORDER.map((p) => getPlanFeatures(p).platformFeePct)).toEqual([4, 2, 1, 0]);
  });

  it.each(['plus', 'pro', 'max', 'ultra'] as const)(
    'the fee shown on %s is exactly PLATFORM_FEE_MAP * 100 (exact in IEEE 754 at these rates)',
    (plan) => {
      expect(getPlanFeatures(plan).platformFeePct).toBe(PLATFORM_FEE_MAP[plan] * 100);
    }
  );

  it('charges the free tier the most and the top tier nothing', () => {
    // The shape of the whole model in one assertion: paid tiers sell a LOWER
    // FEE, so the fee must fall monotonically as the price rises.
    const fees = PLAN_ORDER.map((p) => PLATFORM_FEE_MAP[p]);
    expect(fees).toEqual([...fees].sort((a, b) => b - a));
    expect(fees[0]).toBeGreaterThan(0);
    expect(fees[fees.length - 1]).toBe(0);
  });
});

describe('plan limits (freemium)', () => {
  it('caps churches at 2 / 4 / 6 / 8', () => {
    // ⚠️ `ultra` went from -1 (unlimited) to 8 — a REDUCTION. Safe only while no
    // tenant holds more than 8 churches.
    expect(PLAN_ORDER.map((p) => getPlanFeatures(p).maxChurches)).toEqual([2, 4, 6, 8]);
  });

  it('caps courses at 2 / 5 / 10 / unlimited', () => {
    expect(PLAN_ORDER.map((p) => getPlanFeatures(p).maxCourses)).toEqual([2, 5, 10, -1]);
  });

  it('caps admins at 3 / 9 / 15 / unlimited', () => {
    expect(PLAN_ORDER.map((p) => getPlanFeatures(p).maxAdmins)).toEqual([3, 9, 15, -1]);
  });

  it('sets members at 250 / 1,000 / 5,000 / unlimited', () => {
    expect(PLAN_ORDER.map((p) => getPlanFeatures(p).maxMembers)).toEqual([250, 1000, 5000, -1]);
  });

  it('every limit is a value only where stated — maxMembers is not enforced anywhere', () => {
    // maxMembers exists as a NUMBER in this change and nothing reads it as a
    // gate. Members arrive by self-signup, so a hard block would reject a
    // visitor, who cannot fix it; the agreed behaviour is to let them past, warn
    // the admin, and gate something the admin controls. This assertion just
    // pins that the value is present and well-formed on every tier.
    PLAN_ORDER.forEach((plan) => {
      const v = getPlanFeatures(plan).maxMembers;
      expect(typeof v).toBe('number');
      expect(v === -1 || v > 0).toBe(true);
    });
  });

  it('raises every limit (or holds it) as the tier rises — no limit goes backwards', () => {
    const rank = (n: number) => (n === -1 ? Infinity : n);
    (['maxChurches', 'maxCourses', 'maxAdmins', 'maxMembers'] as const).forEach((key) => {
      const values = PLAN_ORDER.map((p) => rank(getPlanFeatures(p)[key]));
      values.slice(1).forEach((v, i) => {
        expect(v, `${key} drops from ${PLAN_ORDER[i]} to ${PLAN_ORDER[i + 1]}`).toBeGreaterThanOrEqual(values[i]);
      });
    });
  });
});
