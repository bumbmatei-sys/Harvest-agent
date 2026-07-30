import { describe, it, expect } from 'vitest';
import {
  getPlanFeatures,
  getPlanDisplayName,
  hasFeature,
  hasBrandingAccess,
  PLAN_PRICING,
  PLAN_DONATION_RETENTION,
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
  it('returns correct features for plus plan', () => {
    const f = getPlanFeatures('plus');
    expect(f.blog).toBe(true);
    // AI chat is available on Small Team (pro) and above; gated to match the pricing page.
    expect(f.aiChat).toBe(false);
    expect(f.maxChurches).toBe(1);
    expect(f.maxCourses).toBe(2);
    expect(f.maxAdmins).toBe(1);
    expect(f.customDomain).toBe(false);
    expect(f.aiAssistant).toBe(0);
  });

  it('returns correct features for pro plan', () => {
    const f = getPlanFeatures('pro');
    expect(f.aiChat).toBe(true);
    expect(f.maxCourses).toBe(5);
    expect(f.maxAdmins).toBe(5);
    expect(f.customDomain).toBe(false);
  });

  it('returns correct features for ultra plan', () => {
    const f = getPlanFeatures('ultra');
    expect(f.aiAssistant).toBe(1);
    expect(f.customDomain).toBe(true);
    expect(f.maxAdmins).toBe(-1);
    expect(f.maxChurches).toBe(-1);
    expect(f.map).toBe(true);
  });

  it('defaults to plus for unknown plan', () => {
    const f = getPlanFeatures('nonexistent' as any);
    expect(f).toEqual(getPlanFeatures('plus'));
  });
});

describe('getPlanDisplayName', () => {
  it('returns correct display names', () => {
    expect(getPlanDisplayName('plus')).toBe('Individual');
    expect(getPlanDisplayName('pro')).toBe('Small Team');
    expect(getPlanDisplayName('max')).toBe('Community');
    expect(getPlanDisplayName('ultra')).toBe('Ministry');
  });

  it('defaults to Individual for unknown plan', () => {
    expect(getPlanDisplayName('bad' as any)).toBe('Individual');
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

  it('map is available on pro and above', () => {
    expect(hasFeature('plus', 'map')).toBe(false);
    expect(hasFeature('pro', 'map')).toBe(true);
    expect(hasFeature('max', 'map')).toBe(true);
    expect(hasFeature('ultra', 'map')).toBe(true);
  });

  it('automatedNewsletter is available on max and above only', () => {
    expect(hasFeature('plus', 'automatedNewsletter')).toBe(false);
    expect(hasFeature('pro', 'automatedNewsletter')).toBe(false);
    expect(hasFeature('max', 'automatedNewsletter')).toBe(true);
    expect(hasFeature('ultra', 'automatedNewsletter')).toBe(true);
  });

  it('customBranding (logo/colors/name) is available on max and above only', () => {
    expect(hasFeature('plus', 'customBranding')).toBe(false);
    expect(hasFeature('pro', 'customBranding')).toBe(false);
    expect(hasFeature('max', 'customBranding')).toBe(true);
    expect(hasFeature('ultra', 'customBranding')).toBe(true);
  });

  // Moved from Ministry-only to Community and above: a white-label platform that
  // cannot use the church's own domain is a weak Community-tier offer. Individual
  // (plus) and Small Team (pro) stay locked.
  it('customDomain is available on Community (max) and Ministry (ultra)', () => {
    expect(hasFeature('plus', 'customDomain')).toBe(false);
    expect(hasFeature('pro', 'customDomain')).toBe(false);
    expect(hasFeature('max', 'customDomain')).toBe(true);
    expect(hasFeature('ultra', 'customDomain')).toBe(true);
  });

  it('customForms is available on Community (max) and Ministry (ultra)', () => {
    expect(hasFeature('plus', 'customForms')).toBe(false);
    expect(hasFeature('pro', 'customForms')).toBe(false);
    expect(hasFeature('max', 'customForms')).toBe(true);
    expect(hasFeature('ultra', 'customForms')).toBe(true);
  });

  it('checkInSystem is available on Small Team (pro) and above', () => {
    expect(hasFeature('plus', 'checkInSystem')).toBe(false);
    expect(hasFeature('pro', 'checkInSystem')).toBe(true);
    expect(hasFeature('max', 'checkInSystem')).toBe(true);
    expect(hasFeature('ultra', 'checkInSystem')).toBe(true);
  });

  it('livestream is available on Small Team (pro) and above', () => {
    expect(hasFeature('plus', 'livestream')).toBe(false);
    expect(hasFeature('pro', 'livestream')).toBe(true);
    expect(hasFeature('max', 'livestream')).toBe(true);
    expect(hasFeature('ultra', 'livestream')).toBe(true);
  });

  it('sermonNotes is available on Small Team (pro) and above', () => {
    expect(hasFeature('plus', 'sermonNotes')).toBe(false);
    expect(hasFeature('pro', 'sermonNotes')).toBe(true);
    expect(hasFeature('max', 'sermonNotes')).toBe(true);
    expect(hasFeature('ultra', 'sermonNotes')).toBe(true);
  });

  it('smsAutomation is available on Ministry (ultra) only', () => {
    expect(hasFeature('plus', 'smsAutomation')).toBe(false);
    expect(hasFeature('pro', 'smsAutomation')).toBe(false);
    expect(hasFeature('max', 'smsAutomation')).toBe(false);
    expect(hasFeature('ultra', 'smsAutomation')).toBe(true);
  });

  it('automatedBlog is available on Community (max) and Ministry (ultra) only', () => {
    expect(hasFeature('plus', 'automatedBlog')).toBe(false);
    expect(hasFeature('pro', 'automatedBlog')).toBe(false);
    expect(hasFeature('max', 'automatedBlog')).toBe(true);
    expect(hasFeature('ultra', 'automatedBlog')).toBe(true);
  });

  it('givingStatements is available on Community (max) and Ministry (ultra)', () => {
    expect(hasFeature('plus', 'givingStatements')).toBe(false);
    expect(hasFeature('pro', 'givingStatements')).toBe(false);
    expect(hasFeature('max', 'givingStatements')).toBe(true);
    expect(hasFeature('ultra', 'givingStatements')).toBe(true);
  });

  it('pwaApp (mobile app) is available on all plans', () => {
    expect(hasFeature('plus', 'pwaApp')).toBe(true);
    expect(hasFeature('pro', 'pwaApp')).toBe(true);
    expect(hasFeature('max', 'pwaApp')).toBe(true);
    expect(hasFeature('ultra', 'pwaApp')).toBe(true);
  });

  it('eventRegistration is available on Community (max) and above', () => {
    expect(hasFeature('plus', 'eventRegistration')).toBe(false);
    expect(hasFeature('pro', 'eventRegistration')).toBe(false);
    expect(hasFeature('max', 'eventRegistration')).toBe(true);
    expect(hasFeature('ultra', 'eventRegistration')).toBe(true);
  });

  it('publicCalendar is available on all plans (public-facing)', () => {
    expect(hasFeature('plus', 'publicCalendar')).toBe(true);
    expect(hasFeature('pro', 'publicCalendar')).toBe(true);
    expect(hasFeature('max', 'publicCalendar')).toBe(true);
    expect(hasFeature('ultra', 'publicCalendar')).toBe(true);
  });

  it('pledgeCampaigns is available on Community (max) and above', () => {
    expect(hasFeature('plus', 'pledgeCampaigns')).toBe(false);
    expect(hasFeature('pro', 'pledgeCampaigns')).toBe(false);
    expect(hasFeature('max', 'pledgeCampaigns')).toBe(true);
    expect(hasFeature('ultra', 'pledgeCampaigns')).toBe(true);
  });

  it('textToGive is available on Ministry (ultra) only', () => {
    expect(hasFeature('plus', 'textToGive')).toBe(false);
    expect(hasFeature('pro', 'textToGive')).toBe(false);
    expect(hasFeature('max', 'textToGive')).toBe(false);
    expect(hasFeature('ultra', 'textToGive')).toBe(true);
  });
});

describe('Branding tab entitlement (hasBrandingAccess)', () => {
  // The retired `customBackground` flag used to be a third term in this OR chain
  // (AdminDashboard's canBranding). It was true on exactly max + ultra — the same
  // tiers customBranding is true on — so removing it must not hide the Branding
  // tab from any tier. This table is the before AND the after; if it ever
  // changes, a paying plan just lost a feature.
  const EXPECTED: Record<string, boolean> = {
    plus: false,   // Individual  — no branding, no domain (unchanged)
    pro: false,    // Small Team  — no branding, no domain (unchanged)
    max: true,     // Community   — customBranding (unchanged)
    ultra: true,   // Ministry    — customBranding + customDomain (unchanged)
  };

  (['plus', 'pro', 'max', 'ultra'] as const).forEach((plan) => {
    it(`${plan}: Branding tab ${EXPECTED[plan] ? 'visible' : 'hidden'}`, () => {
      expect(hasBrandingAccess(getPlanFeatures(plan))).toBe(EXPECTED[plan]);
    });
  });

  it('every tier that had branding-family access before the customBackground removal still has it', () => {
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
    (['plus', 'pro', 'max', 'ultra'] as const).forEach((plan) => {
      const b = BEFORE[plan];
      const beforeVisible = b.branding || b.background || b.domain;
      expect(hasBrandingAccess(getPlanFeatures(plan))).toBe(beforeVisible);
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

describe('PLAN_DONATION_RETENTION', () => {
  // What the ministry is TOLD it keeps must equal what Stripe actually leaves
  // behind after the platform application fee. `donationRetention` is a
  // hand-maintained mirror of PLATFORM_FEE_MAP (plan-features.ts cannot import
  // stripe-config.ts — it is pulled into ~20 client components, and that module
  // reads server-only STRIPE_PRICE_* env vars at load). Nothing enforces the
  // mirror structurally, so it is enforced here.
  //
  // This caught a real overstatement: Community (max) advertised 100% retention
  // while a 2.5% fee was being deducted, and Individual (plus) advertised 90%
  // while only 5% was taken. See THE-51.
  const PLANS = ['plus', 'pro', 'max', 'ultra'] as const;

  it.each(PLANS)(
    'retention for "%s" equals 100 - PLATFORM_FEE_MAP fee (the rate actually charged)',
    (plan) => {
      const feePct = PLATFORM_FEE_MAP[plan] * 100;
      expect(getPlanFeatures(plan).donationRetention).toBe(100 - feePct);
    }
  );

  it('matches the fee schedule exactly (98.5 / 98.5 / 99 / 100)', () => {
    expect(PLAN_DONATION_RETENTION.plus).toBe(98.5); // 1.5% fee
    expect(PLAN_DONATION_RETENTION.pro).toBe(98.5); // 1.5% fee
    expect(PLAN_DONATION_RETENTION.max).toBe(99); // 1% fee
    expect(PLAN_DONATION_RETENTION.ultra).toBe(100); // no fee
  });

  // THE-51's non-integer guard. It was anchored on Community (max) at 97.5; the
  // repricing made max a flat 99 (1% fee), so the anchor moved to the tiers that
  // are fractional NOW — Individual and Small Team at 98.5 off a 1.5% fee. The
  // assertion is deliberately NOT flipped to `Number.isInteger(...) === true` on
  // max: the guard's purpose is to prove a FRACTIONAL retention survives string
  // formatting and a JSON round-trip, and that only means anything on a plan
  // that actually has one. max's exact value is pinned separately below.
  it.each(['plus', 'pro'] as const)(
    'keeps %s as a non-integer 98.5 — never rounded to 98 or 99',
    (plan) => {
      expect(PLAN_DONATION_RETENTION[plan]).toBe(98.5);
      expect(Number.isInteger(PLAN_DONATION_RETENTION[plan])).toBe(false);
      // The comparison table renders this as `${v}%` (PlanUpgradeSection.tsx) and
      // /api/plans serves it raw as JSON. Both must survive the fraction intact.
      expect(`${PLAN_DONATION_RETENTION[plan]}%`).toBe('98.5%');
      expect(JSON.parse(JSON.stringify({ v: PLAN_DONATION_RETENTION[plan] })).v).toBe(98.5);
    }
  );

  it('keeps Community (max) at exactly 99 — a 1% fee, not 98.5 and not 100', () => {
    expect(PLAN_DONATION_RETENTION.max).toBe(99);
    expect(`${PLAN_DONATION_RETENTION.max}%`).toBe('99%');
    expect(JSON.parse(JSON.stringify({ v: PLAN_DONATION_RETENTION.max })).v).toBe(99);
  });

  it('never advertises more than the fee schedule allows', () => {
    PLANS.forEach((plan) => {
      const actualRetention = 100 - PLATFORM_FEE_MAP[plan] * 100;
      expect(getPlanFeatures(plan).donationRetention).toBeLessThanOrEqual(actualRetention);
    });
  });

  it('stays in sync with the donationRetention field in the feature matrix', () => {
    PLANS.forEach((plan) => {
      expect(getPlanFeatures(plan).donationRetention).toBe(PLAN_DONATION_RETENTION[plan]);
    });
  });
});

describe('communityGroups tier', () => {
  // Community Groups is sold on Community and above. The marketing site has
  // advertised it on Community for some time while the app gated it to Ministry;
  // this matrix is the side that moved. Ministry-only features (accounting, SMS,
  // text-to-give, custom domain) are unaffected — see the guard below.
  it('is unlocked on Community (max)', () => {
    expect(getPlanFeatures('max').communityGroups).toBe(true);
  });

  it('stays unlocked on Ministry (ultra)', () => {
    expect(getPlanFeatures('ultra').communityGroups).toBe(true);
  });

  it('stays locked on Individual (plus) and Small Team (pro)', () => {
    expect(getPlanFeatures('plus').communityGroups).toBe(false);
    expect(getPlanFeatures('pro').communityGroups).toBe(false);
  });

  it('did not drag any other feature onto Community', () => {
    // These stay Ministry-only. `customDomain` is deliberately NOT in this list
    // any more: it was moved to Community in its own change (see the
    // "customDomain is available on Community (max) and Ministry (ultra)" test),
    // which is exactly the kind of tier move this guard is meant to surface. It
    // is asserted true below so the guard still pins every cell it used to.
    const f = getPlanFeatures('max');
    expect(f.accountingTools).toBe(false);
    expect(f.smsAutomation).toBe(false);
    expect(f.textToGive).toBe(false);
    expect(f.churchDirectory).toBe(false);
    expect(f.customDomain).toBe(true);
  });
});

describe('getFeatureMinPlan / FEATURE_MIN_PLAN (derived)', () => {
  // These labels drive the upgrade screens — the exact surface where someone
  // decides what to buy — so a label naming a pricier plan than the matrix
  // requires is a direct over-sell. They used to be two hand-maintained literal
  // maps and had drifted; now they are derived from PLAN_FEATURES.
  it('returns the cheapest plan that unlocks the feature', () => {
    expect(getFeatureMinPlan('fundraising')).toBe('plus');
    expect(getFeatureMinPlan('event_registration')).toBe('max');
    expect(getFeatureMinPlan('docs')).toBe('pro');
    expect(getFeatureMinPlan('accounting')).toBe('ultra');
  });

  it('puts CRM on Small Team, not Community or Ministry', () => {
    // Two corrections, in order. The literal maps said 'Ministry' while max.crm
    // was true (#242 derived the label and fixed that); the repricing then moved
    // `crm` down again to Small Team (pro). Because the label is derived, that
    // second move needed no edit here beyond the expectation.
    expect(getFeatureMinPlan('crm')).toBe('pro');
    expect(FEATURE_MIN_PLAN.crm).toBe('Small Team');
  });

  it('puts tax receipts on Community, not Ministry', () => {
    // Same pre-existing bug as CRM, and a separate one — max.taxReceipt is true.
    expect(getFeatureMinPlan('tax_receipts')).toBe('max');
    expect(FEATURE_MIN_PLAN.tax_receipts).toBe('Community');
  });

  it('puts Community Groups on Community', () => {
    expect(getFeatureMinPlan('community_chat')).toBe('max');
    expect(FEATURE_MIN_PLAN.community_chat).toBe('Community');
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

// ─── Custom domain on Community (max) ────────────────────────────────────────
//
// Custom domains moved from Ministry-only to Community and above. A white-label
// platform that cannot use the church's own domain is a weak Community-tier offer.
//
// These tests are the mutation guard for that move: reverting
// `max.customDomain` to false in the matrix must fail here by name.

describe('customDomain tier (Community / max and above)', () => {
  it('is unlocked on Community (max)', () => {
    expect(getPlanFeatures('max').customDomain).toBe(true);
  });

  it('stays locked on Individual (plus) and Small Team (pro)', () => {
    expect(getPlanFeatures('plus').customDomain).toBe(false);
    expect(getPlanFeatures('pro').customDomain).toBe(false);
  });

  it('remains unlocked on Ministry (ultra)', () => {
    expect(getPlanFeatures('ultra').customDomain).toBe(true);
  });

  // The label the admin UI shows in the locked state. `customDomain` has NO
  // FeatureKey — the gate-key union covers only features fronted by
  // usePlanGate/PlanUpgradeScreen, and custom domain is gated by a boolean prop
  // on DomainSection instead. So the label derives via getMinPlanForFeatureCell
  // on the raw matrix cell rather than via FEATURE_MIN_PLAN. Deliberately not
  // adding a FeatureKey just to get a label.
  it('has no FeatureKey, and its minimum-plan label derives to Community', () => {
    expect(Object.values(FEATURE_MAP)).not.toContain('customDomain');

    const minPlan = getMinPlanForFeatureCell('customDomain');
    expect(minPlan).toBe('max');
    expect(PLAN_DISPLAY_NAMES[minPlan!]).toBe('Community');
  });

  it('getMinPlanForFeatureCell agrees with getFeatureMinPlan for every gate key', () => {
    // The two share one derivation; this pins that they cannot diverge.
    (Object.keys(FEATURE_MAP) as FeatureKey[]).forEach((key) => {
      expect(getMinPlanForFeatureCell(FEATURE_MAP[key])).toBe(getFeatureMinPlan(key));
    });
  });

  // Branding-tab access is `customBranding || customDomain`. Community already
  // had customBranding, so granting customDomain must not change any tier's
  // Branding access — the move is scoped to domain attachment only.
  it('does not change Branding tab access for any tier', () => {
    expect(hasBrandingAccess(getPlanFeatures('plus'))).toBe(false);
    expect(hasBrandingAccess(getPlanFeatures('pro'))).toBe(false);
    expect(hasBrandingAccess(getPlanFeatures('max'))).toBe(true);
    expect(hasBrandingAccess(getPlanFeatures('ultra'))).toBe(true);
  });
});

// ─── Repricing: new prices, new platform fees, five features to Small Team ────
//
// Mutation guard for the repricing. Every value it changed gets an assertion
// that names it, so reverting any one of the thirteen — four fees, four prices,
// five feature moves — fails here by name rather than silently shipping.

describe('PLAN_PRICING (repriced)', () => {
  const EXPECTED = {
    plus:  { monthlyUsd: 49,  yearlyUsd: 490  },
    pro:   { monthlyUsd: 99,  yearlyUsd: 990  },
    max:   { monthlyUsd: 199, yearlyUsd: 1990 },
    ultra: { monthlyUsd: 299, yearlyUsd: 2990 },
  } as const;

  it.each(Object.keys(EXPECTED) as (keyof typeof EXPECTED)[])(
    '%s is priced at the repriced monthly rate',
    (plan) => {
      expect(PLAN_PRICING[plan].monthlyUsd).toBe(EXPECTED[plan].monthlyUsd);
    }
  );

  it('prices the four tiers at 49 / 99 / 199 / 299 per month', () => {
    expect(PLAN_ORDER.map((p) => PLAN_PRICING[p].monthlyUsd)).toEqual([49, 99, 199, 299]);
  });

  it('bills annual as monthly × 10 (pay ten months, get twelve) on every tier', () => {
    PLAN_ORDER.forEach((plan) => {
      expect(PLAN_PRICING[plan].yearlyUsd).toBe(PLAN_PRICING[plan].monthlyUsd * 10);
      expect(PLAN_PRICING[plan].yearlyUsd).toBe(EXPECTED[plan].yearlyUsd);
    });
  });

  it('renders the repriced values through formatPlanPrice — the string the UI shows', () => {
    expect(formatPlanPrice('plus', 'monthly')).toBe('$49/mo');
    expect(formatPlanPrice('pro', 'monthly')).toBe('$99/mo');
    expect(formatPlanPrice('max', 'monthly')).toBe('$199/mo');
    expect(formatPlanPrice('ultra', 'monthly')).toBe('$299/mo');
    expect(formatPlanPrice('max', 'yearly')).toBe('$1,990/yr');
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

describe('PLATFORM_FEE_MAP ↔ donationRetention (repriced fees)', () => {
  it('is exactly { plus: 0.015, pro: 0.015, max: 0.01, ultra: 0 }', () => {
    expect(PLATFORM_FEE_MAP.plus).toBe(0.015);
    expect(PLATFORM_FEE_MAP.pro).toBe(0.015);
    expect(PLATFORM_FEE_MAP.max).toBe(0.01);
    expect(PLATFORM_FEE_MAP.ultra).toBe(0);
  });

  it('advertises retention of 98.5 / 98.5 / 99 / 100', () => {
    expect(PLAN_ORDER.map((p) => getPlanFeatures(p).donationRetention)).toEqual([
      98.5, 98.5, 99, 100,
    ]);
  });

  it.each(['plus', 'pro', 'max', 'ultra'] as const)(
    'retention on %s is exactly 100 - fee*100 (no float slop at the new rates)',
    (plan) => {
      expect(getPlanFeatures(plan).donationRetention).toBe(100 - PLATFORM_FEE_MAP[plan] * 100);
    }
  );
});

describe('five features moved from Community (max) to Small Team (pro)', () => {
  const MOVED = ['checkInSystem', 'livestream', 'sermonNotes', 'docs', 'crm'] as const;

  it.each(MOVED)('%s is unlocked on Small Team (pro)', (key) => {
    expect(getPlanFeatures('pro')[key]).toBe(true);
  });

  it.each(MOVED)('%s stays locked on Individual (plus)', (key) => {
    expect(getPlanFeatures('plus')[key]).toBe(false);
  });

  it.each(MOVED)('%s stays unlocked on Community (max) and Ministry (ultra)', (key) => {
    expect(getPlanFeatures('max')[key]).toBe(true);
    expect(getPlanFeatures('ultra')[key]).toBe(true);
  });

  it('moved these five and nothing else off Community-and-above exclusivity', () => {
    // Every other cell that was max-and-above before the move must still be
    // locked on pro. A sixth feature riding along fails here.
    const f = getPlanFeatures('pro');
    expect(f.customDomain).toBe(false);
    expect(f.customBranding).toBe(false);
    expect(f.eventRegistration).toBe(false);
    expect(f.taxReceipt).toBe(false);
    expect(f.givingStatements).toBe(false);
    expect(f.communityGroups).toBe(false);
    expect(f.customForms).toBe(false);
    expect(f.automatedBlog).toBe(false);
    expect(f.automatedNewsletter).toBe(false);
    expect(f.pledgeCampaigns).toBe(false);
    // Ministry-only cells are untouched too.
    expect(f.accountingTools).toBe(false);
    expect(f.smsAutomation).toBe(false);
    expect(f.textToGive).toBe(false);
    expect(f.churchDirectory).toBe(false);
    // Caps are explicitly out of scope for the move.
    expect(f.maxCourses).toBe(5);
    expect(f.maxAdmins).toBe(5);
    expect(f.maxChurches).toBe(1);
  });

  it('moves the derived upsell labels down with them — CRM and Notes now say Small Team', () => {
    // The whole point of deriving FEATURE_MIN_PLAN (#242): flipping a matrix cell
    // moves the upgrade copy with no edit to any label. `crm` and `docs` are the
    // two moved features that have a FeatureKey.
    expect(getFeatureMinPlan('crm')).toBe('pro');
    expect(FEATURE_MIN_PLAN.crm).toBe('Small Team');
    expect(getFeatureMinPlan('docs')).toBe('pro');
    expect(FEATURE_MIN_PLAN.docs).toBe('Small Team');
    expect(FEATURE_MIN_PLAN.crm).not.toBe('Community');
  });

  it('derives a Small Team label for the three moved cells that have no FeatureKey', () => {
    // checkInSystem / livestream / sermonNotes are gated by matrix cell rather
    // than a gate key, so their label comes from getMinPlanForFeatureCell.
    (['checkInSystem', 'livestream', 'sermonNotes'] as const).forEach((cell) => {
      const minPlan = getMinPlanForFeatureCell(cell);
      expect(minPlan, `nothing unlocks ${cell}`).toBe('pro');
      expect(PLAN_DISPLAY_NAMES[minPlan!]).toBe('Small Team');
    });
  });
});
