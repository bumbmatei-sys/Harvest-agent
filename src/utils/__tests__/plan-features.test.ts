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

  it('customDomain is available on Ministry (ultra) only', () => {
    expect(hasFeature('plus', 'customDomain')).toBe(false);
    expect(hasFeature('pro', 'customDomain')).toBe(false);
    expect(hasFeature('max', 'customDomain')).toBe(false);
    expect(hasFeature('ultra', 'customDomain')).toBe(true);
  });

  it('customForms is available on Community (max) and Ministry (ultra)', () => {
    expect(hasFeature('plus', 'customForms')).toBe(false);
    expect(hasFeature('pro', 'customForms')).toBe(false);
    expect(hasFeature('max', 'customForms')).toBe(true);
    expect(hasFeature('ultra', 'customForms')).toBe(true);
  });

  it('checkInSystem is available on Community (max) and Ministry (ultra)', () => {
    expect(hasFeature('plus', 'checkInSystem')).toBe(false);
    expect(hasFeature('pro', 'checkInSystem')).toBe(false);
    expect(hasFeature('max', 'checkInSystem')).toBe(true);
    expect(hasFeature('ultra', 'checkInSystem')).toBe(true);
  });

  it('livestream is available on Community (max) and Ministry (ultra)', () => {
    expect(hasFeature('plus', 'livestream')).toBe(false);
    expect(hasFeature('pro', 'livestream')).toBe(false);
    expect(hasFeature('max', 'livestream')).toBe(true);
    expect(hasFeature('ultra', 'livestream')).toBe(true);
  });

  it('sermonNotes is available on Community (max) and Ministry (ultra)', () => {
    expect(hasFeature('plus', 'sermonNotes')).toBe(false);
    expect(hasFeature('pro', 'sermonNotes')).toBe(false);
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

  it('matches the fee schedule exactly (95 / 95 / 97.5 / 100)', () => {
    expect(PLAN_DONATION_RETENTION.plus).toBe(95); // 5% fee
    expect(PLAN_DONATION_RETENTION.pro).toBe(95); // 5% fee
    expect(PLAN_DONATION_RETENTION.max).toBe(97.5); // 2.5% fee
    expect(PLAN_DONATION_RETENTION.ultra).toBe(100); // no fee
  });

  it('keeps Community (max) as a non-integer 97.5 — never rounded to 97 or 100', () => {
    expect(PLAN_DONATION_RETENTION.max).toBe(97.5);
    expect(Number.isInteger(PLAN_DONATION_RETENTION.max)).toBe(false);
    // The comparison table renders this as `${v}%` (PlanUpgradeSection.tsx) and
    // /api/plans serves it raw as JSON. Both must survive the fraction intact.
    expect(`${PLAN_DONATION_RETENTION.max}%`).toBe('97.5%');
    expect(JSON.parse(JSON.stringify({ v: PLAN_DONATION_RETENTION.max })).v).toBe(97.5);
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
    // Only communityGroups changed tier. These stay Ministry-only.
    const f = getPlanFeatures('max');
    expect(f.accountingTools).toBe(false);
    expect(f.smsAutomation).toBe(false);
    expect(f.textToGive).toBe(false);
    expect(f.customDomain).toBe(false);
    expect(f.churchDirectory).toBe(false);
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
    expect(getFeatureMinPlan('docs')).toBe('max');
    expect(getFeatureMinPlan('accounting')).toBe('ultra');
  });

  it('puts CRM on Community, not Ministry', () => {
    // Was 'Ministry' in both literal maps while max.crm has been true —
    // pointing a locked-out admin at $479 when $299 already unlocks it.
    expect(getFeatureMinPlan('crm')).toBe('max');
    expect(FEATURE_MIN_PLAN.crm).toBe('Community');
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
