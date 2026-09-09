import { describe, it, expect } from 'vitest';
import {
  getPlanFeatures,
  getPlanDisplayName,
  hasFeature,
  hasBrandingAccess,
  BILLING_TERMS,
  TERM_MONTHS,
  TERM_BILLED_PHRASE,
  DISCOUNTED_TERMS,
  ADVERTISED_DISCOUNT_PCT,
  actualSavingPct,
  discountClaim,
  discountClaimShape,
  planPriceUsd,
  formatPlanMonthlyHeadline,
  planTermMonthlyDisplayed,
  monthlyHeadlineContract,
  PLAN_PRICING,
  formatPlanPrice,
  getFeatureMinPlan,
  getFeatureMinPlanName,
  FEATURE_MIN_PLAN,
  FEATURE_MAP,
  PLAN_ORDER,
  PRICED_PLAN_ORDER,
  TOP_PLAN,
  PLAN_DISPLAY_NAMES,
  getMinPlanForFeatureCell,
  type FeatureKey,
} from '../plan-features';
import type { TenantPlan, PricedPlan } from '@/types/tenant.types';
import * as planFeaturesModule from '../plan-features';
// The rate actually charged. This import used to carry a warning: the fee map
// shared a module with the STRIPE_PRICE_* env reads, so pulling it in was only
// safe server-side. Splitting stripe-config.ts into stripe-connect.ts (this
// map) and billing.ts (the price IDs) removed that coupling — stripe-connect.ts
// reads no env at all and is a plain constant. Importing it is unconditionally
// safe now, here or anywhere.
import { PLATFORM_FEE_MAP } from '@/lib/stripe-connect';

describe('getPlanFeatures', () => {
  it('returns correct features for plus plan', () => {
    const f = getPlanFeatures('plus');
    expect(f.blog).toBe(true);
    // No tier includes the RAG chat — it is the AI Assistant add-on (THE-253).
    expect(f.aiChat).toBe(false);
    expect(f.maxChurches).toBe(1);
    expect(f.maxContacts).toBe(150);
    expect(f.maxCourses).toBe(2);
    expect(f.maxAdmins).toBe(2);
    expect(f.customDomain).toBe(false);
  });

  it('returns correct features for pro plan', () => {
    const f = getPlanFeatures('pro');
    expect(f.aiChat).toBe(false);
    expect(f.maxContacts).toBe(500);
    expect(f.maxCourses).toBe(5);
    expect(f.maxAdmins).toBe(5);
    expect(f.customDomain).toBe(false);
  });

  it('returns correct features for max plan (the top tier)', () => {
    const f = getPlanFeatures('max');
    expect(f.customDomain).toBe(true);
    expect(f.maxContacts).toBe(2_000);
    expect(f.maxAdmins).toBe(15);
    // NOT -1: max did not inherit the deleted ultra tier's unlimited churches.
    // Every tier is capped at one campus; extra campuses become a paid add-on.
    expect(f.maxChurches).toBe(1);
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
    // 'Ministry', not the old 'Community': max inherited the deleted ultra
    // tier's display name when the two folded together.
    expect(getPlanDisplayName('max')).toBe('Ministry');
  });

  it('defaults to Individual for unknown plan', () => {
    expect(getPlanDisplayName('bad' as any)).toBe('Individual');
  });
});

describe('hasFeature', () => {
  it('returns true for enabled boolean features', () => {
    expect(hasFeature('pro', 'blog')).toBe(true);
    expect(hasFeature('plus', 'blog')).toBe(true);
  });

  /* WAS 'AI chat is available on Small Team and above' — pro and max true.
     🔴 INVERTED BY THE-253: no tier includes the chat. `hasFeature` answers the
     TIER question, so false on all four is the correct answer now; a tenant's
     real entitlement is `getEffectiveFeatures`, which lifts it from the add-on. */
  it('AI chat is on NO tier — it is the add-on', () => {
    expect(hasFeature('free', 'aiChat')).toBe(false);
    expect(hasFeature('plus', 'aiChat')).toBe(false);
    expect(hasFeature('pro', 'aiChat')).toBe(false);
    expect(hasFeature('max', 'aiChat')).toBe(false);
  });

  it('returns false for disabled boolean features', () => {
    expect(hasFeature('plus', 'aiKnowledge')).toBe(false);
  });

  it('returns true for non-zero numeric features', () => {
    expect(hasFeature('plus', 'maxChurches')).toBe(true);
    expect(hasFeature('plus', 'maxCourses')).toBe(true);
    expect(hasFeature('plus', 'maxContacts')).toBe(true);
  });

  it('map is available on pro and above', () => {
    expect(hasFeature('plus', 'map')).toBe(false);
    expect(hasFeature('pro', 'map')).toBe(true);
    expect(hasFeature('max', 'map')).toBe(true);
  });

  it('automatedNewsletter is available on max only', () => {
    expect(hasFeature('plus', 'automatedNewsletter')).toBe(false);
    expect(hasFeature('pro', 'automatedNewsletter')).toBe(false);
    expect(hasFeature('max', 'automatedNewsletter')).toBe(true);
  });

  it('customBranding (logo/colors/name) is available on max only', () => {
    expect(hasFeature('plus', 'customBranding')).toBe(false);
    expect(hasFeature('pro', 'customBranding')).toBe(false);
    expect(hasFeature('max', 'customBranding')).toBe(true);
  });

  it('customDomain is available on Ministry (max) only', () => {
    expect(hasFeature('plus', 'customDomain')).toBe(false);
    expect(hasFeature('pro', 'customDomain')).toBe(false);
    expect(hasFeature('max', 'customDomain')).toBe(true);
  });

  it('customForms is available on Ministry (max) only', () => {
    expect(hasFeature('plus', 'customForms')).toBe(false);
    expect(hasFeature('pro', 'customForms')).toBe(false);
    expect(hasFeature('max', 'customForms')).toBe(true);
  });

  it('checkInSystem is available on Small Team (pro) and above', () => {
    expect(hasFeature('plus', 'checkInSystem')).toBe(false);
    expect(hasFeature('pro', 'checkInSystem')).toBe(true);
    expect(hasFeature('max', 'checkInSystem')).toBe(true);
  });

  it('livestream is available on Small Team (pro) and above', () => {
    expect(hasFeature('plus', 'livestream')).toBe(false);
    expect(hasFeature('pro', 'livestream')).toBe(true);
    expect(hasFeature('max', 'livestream')).toBe(true);
  });

  it('sermonNotes is available on Small Team (pro) and above', () => {
    expect(hasFeature('plus', 'sermonNotes')).toBe(false);
    expect(hasFeature('pro', 'sermonNotes')).toBe(true);
    expect(hasFeature('max', 'sermonNotes')).toBe(true);
  });

  it('automatedBlog is available on Ministry (max) only', () => {
    expect(hasFeature('plus', 'automatedBlog')).toBe(false);
    expect(hasFeature('pro', 'automatedBlog')).toBe(false);
    expect(hasFeature('max', 'automatedBlog')).toBe(true);
  });

  it('givingStatements is available on Ministry (max) only', () => {
    expect(hasFeature('plus', 'givingStatements')).toBe(false);
    expect(hasFeature('pro', 'givingStatements')).toBe(false);
    expect(hasFeature('max', 'givingStatements')).toBe(true);
  });

  it('pwaApp (mobile app) is available on all plans, free included', () => {
    // The name said "all plans" while only three were asserted; free was added
    // to the matrix by THE-200 and given pwaApp by THE-205, so it is named here
    // explicitly rather than left implied by the title.
    expect(hasFeature('free', 'pwaApp')).toBe(true);
    expect(hasFeature('plus', 'pwaApp')).toBe(true);
    expect(hasFeature('pro', 'pwaApp')).toBe(true);
    expect(hasFeature('max', 'pwaApp')).toBe(true);
  });

  it('eventRegistration is available on Ministry (max) only', () => {
    expect(hasFeature('plus', 'eventRegistration')).toBe(false);
    expect(hasFeature('pro', 'eventRegistration')).toBe(false);
    expect(hasFeature('max', 'eventRegistration')).toBe(true);
  });

  it('pledgeCampaigns is available on Ministry (max) only', () => {
    expect(hasFeature('plus', 'pledgeCampaigns')).toBe(false);
    expect(hasFeature('pro', 'pledgeCampaigns')).toBe(false);
    expect(hasFeature('max', 'pledgeCampaigns')).toBe(true);
  });
});

// ─── SMS is MINISTRY-ONLY ────────────────────────────────────────────────────
//
// 🔴 THE-314 REVERSED THE BYO-ONLY GUARD THAT STOOD HERE. It asserted these two
// cells were `true` on every tier, because SMS was not sold by plan: a church
// brought its own Twilio account, Twilio billed the church, and the cell gated
// nothing.
//
// Harvest now RESELLS on one vendor account and pays for every segment, so the
// cell decides who may spend Harvest's money. The founder's call is Ministry
// (`max`) only. The guard is UPDATED rather than deleted — it is still the thing
// that catches SMS drifting onto a tier the app does not sell it on.

describe('SMS is Ministry-only — gated by plan (THE-314)', () => {
  it.each(['smsAutomation', 'textToGive'] as const)(
    '%s is FALSE on free, plus and pro, and TRUE on max alone',
    (cell) => {
      expect(getPlanFeatures('free')[cell], `free must not carry ${cell}`).toBe(false);
      expect(getPlanFeatures('plus')[cell], `Individual (plus) must not carry ${cell}`).toBe(false);
      expect(getPlanFeatures('pro')[cell], `Small Team (pro) must not carry ${cell}`).toBe(false);
      expect(getPlanFeatures('max')[cell], `Ministry (max) must carry ${cell}`).toBe(true);
    }
  );

  it('unlocks at Ministry, so every upgrade screen names the right tier', () => {
    expect(getMinPlanForFeatureCell('smsAutomation')).toBe('max');
    expect(getMinPlanForFeatureCell('textToGive')).toBe('max');
  });

  it('🔴 names the two paid tiers that LOST it, so the downgrade stays recorded', () => {
    // Individual and Small Team both carried `true` before THE-314. This is not
    // a restatement of the cell values above: it is the record that they moved,
    // and that two paying tiers lost a capability they were promised.
    for (const lost of ['plus', 'pro'] as const) {
      expect(getPlanFeatures(lost).smsAutomation, `${lost} lost smsAutomation`).toBe(false);
      expect(getPlanFeatures(lost).textToGive, `${lost} lost textToGive`).toBe(false);
    }
  });
});

describe('Branding tab entitlement (hasBrandingAccess)', () => {
  // The retired `customBackground` flag used to be a third term in this OR chain
  // (AdminDashboard's canBranding). It was true on exactly the tiers
  // customBranding is true on — so removing it must not hide the Branding tab
  // from any tier. This table is the before AND the after; if it ever changes, a
  // paying plan just lost a feature.
  const EXPECTED: Record<string, boolean> = {
    plus: false,   // Individual — no branding, no domain (unchanged)
    pro: false,    // Small Team — no branding, no domain (unchanged)
    max: true,     // Ministry   — customBranding + customDomain (unchanged)
  };

  (['plus', 'pro', 'max'] as const).forEach((plan) => {
    it(`${plan}: Branding tab ${EXPECTED[plan] ? 'visible' : 'hidden'}`, () => {
      expect(hasBrandingAccess(getPlanFeatures(plan))).toBe(EXPECTED[plan]);
    });
  });

  it('every tier that had branding-family access before the customBackground removal still has it', () => {
    // Pre-removal matrix values, transcribed from git history. The `ultra` row is
    // gone with the tier; `max` carried branding then and carries it now, so
    // folding the two together changed nothing here either.
    //   plan   customBranding  customBackground  customDomain
    //   plus   false           false             false
    //   pro    false           false             false
    //   max    true            true              false
    const BEFORE: Record<string, { branding: boolean; background: boolean; domain: boolean }> = {
      plus: { branding: false, background: false, domain: false },
      pro:  { branding: false, background: false, domain: false },
      max:  { branding: true,  background: true,  domain: false },
    };
    (['plus', 'pro', 'max'] as const).forEach((plan) => {
      const b = BEFORE[plan];
      const beforeVisible = b.branding || b.background || b.domain;
      expect(hasBrandingAccess(getPlanFeatures(plan))).toBe(beforeVisible);
    });
  });

  it('customBackground is gone from the plan matrix entirely', () => {
    (['plus', 'pro', 'max'] as const).forEach((plan) => {
      expect('customBackground' in getPlanFeatures(plan)).toBe(false);
    });
  });
});

/* WAS 'AI_ASSISTANT_ADDON_PRICING — $200/mo flat with no setup fee'.
 *
 * 🔴 THE CONSTANT IS DELETED (THE-253) AND ITS FIGURE WAS WRONG. $200 was the
 * retired Telegram assistant's Stripe price; the AI Assistant product a church
 * can actually buy is $20/mo in live Dodo. Pinning 200 kept a number that could
 * only ever mis-sell. Nothing in this repo carries an add-on price now — the
 * marketing site quotes them from `DODO_ADD_ON_CATALOG`, pinned against the
 * live products there — so the replacement assertion is that the export is
 * gone, in `the-224-ai-assistant-no-seat.test.ts`. */

// ─── Tier deletion: `ultra` is gone ──────────────────────────────────────────
//
// Test #1 of the repricing. The `ultra` tier folded into `max`.

describe('the ultra tier is deleted', () => {
  it('PLAN_ORDER is exactly [free, plus, pro, max]', () => {
    // 🔴 THE-200 added the Forever Free tier at the FRONT. `ultra` staying gone
    // is what this block is about; the tier count is incidental to it, and was
    // never the claim worth pinning.
    expect([...PLAN_ORDER]).toEqual(['free', 'plus', 'pro', 'max']);
    expect([...PRICED_PLAN_ORDER]).toEqual(['plus', 'pro', 'max']);
  });

  it('TenantPlan has no ultra — PLAN_FEATURES has exactly four keys and none is ultra', () => {
    // PLAN_FEATURES is the runtime source of truth for which plan ids are real
    // (toTenantPlan coerces against it), so this is the observable stand-in for
    // the compile-time union.
    const ids = PLAN_ORDER.map((p) => p);
    expect(ids).toHaveLength(4);
    expect(ids).not.toContain('ultra');
    expect(getPlanFeatures('ultra' as any)).toEqual(getPlanFeatures('plus'));
  });

  it('no plan-facing export still carries an ultra key', () => {
    expect(Object.keys(PLAN_PRICING)).not.toContain('ultra');
    expect(Object.keys(PLAN_DISPLAY_NAMES)).not.toContain('ultra');
    expect(Object.keys(PLATFORM_FEE_MAP)).not.toContain('ultra');
  });

  it('TOP_PLAN is max, derived from the last PLAN_ORDER entry', () => {
    expect(TOP_PLAN).toBe('max');
    expect(TOP_PLAN).toBe(PLAN_ORDER[PLAN_ORDER.length - 1]);
  });

  it('folds ultra capabilities into max: accounting', () => {
    // `churchDirectory` was ultra's third folded-in cell; it was later removed
    // from the matrix entirely for having zero consumers — see the retired-cells
    // describe block below, which is now its regression test. Its SECOND,
    // `aiAssistant: 1`, went the same way in THE-253 with the Telegram
    // assistant that count belonged to, leaving accounting as the only one.
    const f = getPlanFeatures('max');
    expect(f.accountingTools).toBe(true);
    expect('aiAssistant' in f).toBe(false);
  });
});

// ─── Retired fields ──────────────────────────────────────────────────────────
//
// Test #8 of the repricing. `donationRetention` and `publicCalendar` are gone.
// This is the regression test for both retirements: it fails if either comes
// back, in the matrix or as a module export.
//
// `churchDirectory` joined this list later (THE-77): it named a global
// multi-church discovery directory that was never built — no gate, route,
// query or component read it anywhere in the app (see
// docs/plan-features-flag-audit.md). Same precedent as the other two.

describe('retired matrix cells stay retired', () => {
  it.each(['donationRetention', 'publicCalendar', 'churchDirectory'] as const)(
    '%s does not exist on any tier of PLAN_FEATURES',
    (cell) => {
      PLAN_ORDER.forEach((plan) => {
        expect(cell in getPlanFeatures(plan)).toBe(false);
        expect((getPlanFeatures(plan) as any)[cell]).toBeUndefined();
      });
    }
  );

  it('PLAN_DONATION_RETENTION is no longer exported', () => {
    // It was a per-plan mirror of `100 - PLATFORM_FEE_MAP * 100`. At a flat 0%
    // fee it is the constant 100 on every tier — no information, and one more
    // copy of the fee to drift. Surfaces render the FEE now.
    expect('PLAN_DONATION_RETENTION' in planFeaturesModule).toBe(false);
  });

  it('nothing derives a minimum plan for any retired cell', () => {
    // getMinPlanForFeatureCell walks PLAN_FEATURES; a retired cell is truthy
    // nowhere, so it derives to null rather than silently unlocking on plus.
    expect(getMinPlanForFeatureCell('donationRetention' as any)).toBeNull();
    expect(getMinPlanForFeatureCell('publicCalendar' as any)).toBeNull();
    expect(getMinPlanForFeatureCell('churchDirectory' as any)).toBeNull();
  });
});

// ─── Capacity limits ─────────────────────────────────────────────────────────
//
// Test #5 of the repricing.

describe('capacity limits per tier', () => {
  // 🔴 THE PAID capacity ladder, unchanged by THE-200. Free's own caps are a
  // different kind of number (a bound on a free tier, not a rung a church buys)
  // and are asserted in plan-features.free-tier.test.ts.
  it('maxContacts is 150 / 500 / 2000', () => {
    expect(PRICED_PLAN_ORDER.map((p) => getPlanFeatures(p).maxContacts)).toEqual([150, 500, 2_000]);
  });

  it('maxAdmins is 2 / 5 / 15', () => {
    expect(PRICED_PLAN_ORDER.map((p) => getPlanFeatures(p).maxAdmins)).toEqual([2, 5, 15]);
  });

  it('maxCourses is 2 / 5 / 15', () => {
    expect(PRICED_PLAN_ORDER.map((p) => getPlanFeatures(p).maxCourses)).toEqual([2, 5, 15]);
  });

  it('maxChurches is 1 on every PAID tier — no tier gets unlimited campuses', () => {
    expect(PRICED_PLAN_ORDER.map((p) => getPlanFeatures(p).maxChurches)).toEqual([1, 1, 1]);
    // Free gets 0, not 1: one evangelist is not a campus. 0 is falsy to
    // hasFeature, which is what keeps the min-plan label off Free for it.
    expect(getPlanFeatures('free').maxChurches).toBe(0);
  });

  it('no capacity cell is unlimited (-1) any more', () => {
    // The deleted ultra tier carried -1 for churches, courses and admins.
    // Nothing inherited it: every cap is a finite number, which is what makes
    // the add-on model (buy more contacts / seats / campuses) coherent.
    //
    // ⚠️ `>= 0`, not `> 0`, across ALL tiers: free's maxChurches is a real 0
    // (hidden), which is finite and correct. UNLIMITED_CAP is -1, so the guard
    // that matters is "never negative", and that is what is asserted.
    PLAN_ORDER.forEach((plan) => {
      const f = getPlanFeatures(plan);
      (['maxChurches', 'maxContacts', 'maxCourses', 'maxAdmins'] as const).forEach((cell) => {
        expect(f[cell], `${plan}.${cell} is unlimited`).toBeGreaterThanOrEqual(0);
        expect(f[cell], `${plan}.${cell} is the unlimited sentinel`).not.toBe(-1);
      });
    });
    // And every PAID tier's caps are still strictly positive.
    PRICED_PLAN_ORDER.forEach((plan) => {
      const f = getPlanFeatures(plan);
      (['maxChurches', 'maxContacts', 'maxCourses', 'maxAdmins'] as const).forEach((cell) => {
        expect(f[cell], `${plan}.${cell}`).toBeGreaterThan(0);
      });
    });
  });
});

// ─── AI is on no tier ────────────────────────────────────────────────────────
//
// Was test #11 of the repricing, which pinned aiChat/aiKnowledge at
// false/true/true as PROOF THE REPRICING LEFT THEM ALONE, and said in as many
// words: "They become add-on-gated in a later PR." THE-253 is that PR, so the
// two rows invert and the third assertion changes meaning entirely.

describe('aiChat / aiKnowledge are on NO tier — the add-on is the only path', () => {
  it('aiChat is false on all four', () => {
    expect(PRICED_PLAN_ORDER.map((p) => getPlanFeatures(p).aiChat)).toEqual([false, false, false]);
    // Free has no AI at all — and PLAN_LIMITS.free budgets 0 tokens to match.
    expect(getPlanFeatures('free').aiChat).toBe(false);
  });

  it('aiKnowledge is false on all four', () => {
    expect(PRICED_PLAN_ORDER.map((p) => getPlanFeatures(p).aiKnowledge)).toEqual([false, false, false]);
    expect(getPlanFeatures('free').aiKnowledge).toBe(false);
  });

  it('🔴 NEITHER HAS A MINIMUM PLAN, because no plan grants either', () => {
    // Was `'pro'` for both. `getMinPlanForFeatureCell` walks PLAN_ORDER for the
    // first tier with the cell and answers `null` when none has it — which is
    // the honest answer for a capability sold separately, and is what stops any
    // upgrade surface printing "Available on Small Team and above" for a thing
    // upgrading does not buy.
    expect(getMinPlanForFeatureCell('aiChat')).toBeNull();
    expect(getMinPlanForFeatureCell('aiKnowledge')).toBeNull();
  });
});

describe('communityGroups tier', () => {
  it('is unlocked on Ministry (max)', () => {
    expect(getPlanFeatures('max').communityGroups).toBe(true);
  });

  it('stays locked on Individual (plus) and Small Team (pro)', () => {
    expect(getPlanFeatures('plus').communityGroups).toBe(false);
    expect(getPlanFeatures('pro').communityGroups).toBe(false);
  });

  it('pins what max exclusively carries after the ultra fold', () => {
    // This guard used to assert accountingTools/smsAutomation/textToGive were
    // FALSE on max — they were ultra-only. All three have moved deliberately
    // since: accounting folded into max, SMS went BYO-only on every tier, and
    // THE-314 then brought SMS BACK to max alone as a sold capability. The guard
    // pins the current shape and still catches a feature drifting onto max by
    // accident. (`churchDirectory`, ultra's third folded-in cell, was later
    // removed from the matrix entirely — see 'retired matrix cells stay
    // retired' above.)
    const f = getPlanFeatures('max');
    expect(f.accountingTools).toBe(true);   // folded in from ultra
    expect(f.smsAutomation).toBe(true);     // THE-314 — max ONLY
    expect(f.textToGive).toBe(true);        // THE-314 — max ONLY
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
    // Was 'ultra'; accounting folded into max with the tier.
    expect(getFeatureMinPlan('accounting')).toBe('max');
  });

  it('puts CRM back on Individual — free no longer carries it (moved by THE-335)', () => {
    // THE-161 put CRM on every PAID tier and this said 'Individual'. THE-200
    // added a cheaper tier that ALSO had CRM and the label followed the cell;
    // THE-335 took CRM off free — the founder's split, "the free plan should
    // have signup feature not CRM since we separated them" — and the label
    // followed it BACK, with no literal edited in any component. That round trip
    // is the whole point of deriving it, and it is a TRUE statement in both
    // directions: no church is shown a claim about a tier that lacks the
    // feature.
    expect(getFeatureMinPlan('crm')).toBe('plus');
    expect(FEATURE_MIN_PLAN.crm).toBe('Individual');
    expect(FEATURE_MIN_PLAN.crm).not.toBe('Ministry');
    // The cheapest PAID tier still has it — CRM did not become free-only.
    expect(getPlanFeatures('plus').crm).toBe(true);
  });

  it('puts tax receipts on Ministry (max)', () => {
    expect(getFeatureMinPlan('tax_receipts')).toBe('max');
    expect(FEATURE_MIN_PLAN.tax_receipts).toBe('Ministry');
  });

  it('puts Community Groups on Ministry (max)', () => {
    expect(getFeatureMinPlan('community_chat')).toBe('max');
    expect(FEATURE_MIN_PLAN.community_chat).toBe('Ministry');
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

// ─── getFeatureMinPlanName fallback ──────────────────────────────────────────
//
// Test #9 of the repricing. The fallback used to be a literal
// `PLAN_DISPLAY_NAMES.ultra`, which stopped compiling when the tier was deleted.

describe('getFeatureMinPlanName fallback (no tier unlocks the feature)', () => {
  it('returns Ministry for a feature no tier unlocks', () => {
    // 'nope' is not in FEATURE_MAP, so getFeatureMinPlan returns null and the
    // fallback runs. It must name the TOP tier, never render empty.
    expect(getFeatureMinPlanName('nope' as FeatureKey)).toBe('Ministry');
  });

  it('does not reference a deleted tier — the fallback is the top of PLAN_ORDER', () => {
    expect(getFeatureMinPlanName('nope' as FeatureKey)).toBe(PLAN_DISPLAY_NAMES[TOP_PLAN]);
    expect(getFeatureMinPlanName('nope' as FeatureKey)).toBe(
      PLAN_DISPLAY_NAMES[PLAN_ORDER[PLAN_ORDER.length - 1]]
    );
  });

  it('still returns the real minimum plan for a feature that has one', () => {
    expect(getFeatureMinPlanName('docs')).toBe('Small Team');
    expect(getFeatureMinPlanName('fundraising')).toBe('Individual');
  });
});

describe('customDomain tier (Ministry / max only)', () => {
  it('is unlocked on Ministry (max)', () => {
    expect(getPlanFeatures('max').customDomain).toBe(true);
  });

  it('stays locked on Individual (plus) and Small Team (pro)', () => {
    expect(getPlanFeatures('plus').customDomain).toBe(false);
    expect(getPlanFeatures('pro').customDomain).toBe(false);
  });

  // The label the admin UI shows in the locked state. `customDomain` has NO
  // FeatureKey — the gate-key union covers only features fronted by
  // usePlanGate/PlanUpgradeScreen, and custom domain is gated by a boolean prop
  // on DomainSection instead. So the label derives via getMinPlanForFeatureCell
  // on the raw matrix cell rather than via FEATURE_MIN_PLAN. Deliberately not
  // adding a FeatureKey just to get a label.
  it('has no FeatureKey, and its minimum-plan label derives to Ministry', () => {
    expect(Object.values(FEATURE_MAP)).not.toContain('customDomain');

    const minPlan = getMinPlanForFeatureCell('customDomain');
    expect(minPlan).toBe('max');
    expect(PLAN_DISPLAY_NAMES[minPlan!]).toBe('Ministry');
  });

  it('getMinPlanForFeatureCell agrees with getFeatureMinPlan for every gate key', () => {
    // The two share one derivation; this pins that they cannot diverge.
    (Object.keys(FEATURE_MAP) as FeatureKey[]).forEach((key) => {
      expect(getMinPlanForFeatureCell(FEATURE_MAP[key])).toBe(getFeatureMinPlan(key));
    });
  });

  // Branding-tab access is `customBranding || customDomain`. max already had
  // customBranding, so this must not change any tier's Branding access.
  it('does not change Branding tab access for any tier', () => {
    expect(hasBrandingAccess(getPlanFeatures('plus'))).toBe(false);
    expect(hasBrandingAccess(getPlanFeatures('pro'))).toBe(false);
    expect(hasBrandingAccess(getPlanFeatures('max'))).toBe(true);
  });
});

// ─── Repricing: three tiers, new prices, zero fees ───────────────────────────
//
// Mutation guard for the repricing. Every value it changed gets an assertion
// that names it, so reverting any one of them fails here by name rather than
// silently shipping.

// 🔴 EVERY LOOP IN THIS BLOCK WALKS `PRICED_PLAN_ORDER`, NOT `PLAN_ORDER`.
// The block is about the nine stored PRICES; the Forever Free tier has none, so
// including it would make `planPriceUsd` a compile error and "prices ascending"
// a claim about a tier with no price. Free's own absence from PLAN_PRICING is
// asserted in the free-tier block below — that is the seam, and it is tested
// there deliberately rather than being smuggled in as a loop bound here.
describe('PLAN_PRICING — the stored nine-price table (THE-195)', () => {
  /* 🔴 TEST 1: the nine plan prices, per tier and per term, against the Dodo
     catalogue. Written out rather than derived from the table under test: a
     test that reads its subject asserts only that the subject equals itself.
     These are the figures verified against the authenticated live Dodo API on
     2026-08-27 — 2000 / 5400 / 19000 minor units on Individual, and so on.

     🔴 TRANSCRIBED BY HAND, NEVER DERIVED, because a reprice that moved a row
     instead of repricing it would still look plausible; only nine
     independently written numbers catch it. THE-222 shifted the table down a
     tier for exactly that reason.

     🔴 THE-248 RAISED THE SIX DISCOUNTED CELLS AND LEFT MONTHLY ALONE. The
     quarters were 49 / 99 / 199 and the years 165 / 329 / 659. Prices went UP:
     this is a deliberate REDUCTION IN DISCOUNT to a flat 10% and 20%, in place
     of the 17–18% and 31% the old figures happened to give, and not a mistake
     to be "corrected" back. Product ids, trials and tax category are
     unchanged. */
  const DODO_CATALOGUE_USD = {
    plus: { monthly: 20, quarterly: 54,  yearly: 190 },
    pro:  { monthly: 40, quarterly: 108, yearly: 380 },
    max:  { monthly: 60, quarterly: 162, yearly: 564 },
  } as const;

  it.each(
    (Object.keys(DODO_CATALOGUE_USD) as PricedPlan[]).flatMap((plan) =>
      BILLING_TERMS.map((term) => [plan, term] as const),
    ),
  )('%s on %s matches the Dodo catalogue exactly', (plan, term) => {
    expect(planPriceUsd(plan, term)).toBe(DODO_CATALOGUE_USD[plan][term]);
  });

  it('prices every tier on every term, in whole dollars', () => {
    for (const plan of PRICED_PLAN_ORDER) {
      for (const term of BILLING_TERMS) {
        expect(Number.isInteger(planPriceUsd(plan, term))).toBe(true);
        expect(planPriceUsd(plan, term)).toBeGreaterThan(0);
      }
    }
  });

  it('prices the tiers in ascending order on every term', () => {
    for (const term of BILLING_TERMS) {
      const figures = PRICED_PLAN_ORDER.map((p) => planPriceUsd(p, term));
      expect(figures, `${term} prices are not ascending`).toEqual([...figures].sort((a, b) => a - b));
    }
  });

  it('🔴 no longer derives a price from a billed-months multiplier', () => {
    // ANNUAL_BILLED_MONTHS is gone and must not come back. 20% off a year is
    // x9.6 months and 10% off a quarter is x2.7 — there is no integer to name,
    // which is exactly why the prices became a table.
    const mod = planFeaturesModule as unknown as Record<string, unknown>;
    expect(mod.ANNUAL_BILLED_MONTHS).toBeUndefined();
    expect(mod.ANNUAL_FREE_MONTHS).toBeUndefined();
    expect(mod.annualMonthlyEquivalent).toBeUndefined();
    // And no term's price IS a whole number of months at the monthly rate.
    for (const p of PRICED_PLAN_ORDER) {
      for (const term of DISCOUNTED_TERMS) {
        const inMonths = planPriceUsd(p, term) / planPriceUsd(p, 'monthly');
        expect(Number.isInteger(inMonths), `${p} ${term} is exactly ${inMonths} months`).toBe(false);
      }
    }
  });

  it('makes every longer term cheaper than the same span bought monthly', () => {
    for (const p of PRICED_PLAN_ORDER) {
      for (const term of DISCOUNTED_TERMS) {
        expect(planPriceUsd(p, term)).toBeLessThan(planPriceUsd(p, 'monthly') * TERM_MONTHS[term]);
      }
    }
  });

  /* 🔴 TEST 3: the badges are stored, not computed. */
  it('advertises exactly 10% and 20%, stored rather than computed', () => {
    expect(ADVERTISED_DISCOUNT_PCT).toEqual({ quarterly: 10, yearly: 20 });
    // ⚠️ THE ARGUMENT MOVED TERMS AT THE-248. It used to be quarterly that
    // proved a computed badge impossible, because the tiers rounded to
    // different whole percentages (18 beside Individual, 17 beside Ministry).
    // Every tier now saves the same on both terms, so that spread is gone.
    // YEARLY carries the argument instead, from the other side: the prices
    // deliver 20.83% against a founder's round 20, so a computed badge would
    // advertise 21 — a number nobody signed off — while the Terms, the FAQ and
    // the marketing site all say 20.
    expect(Math.round(actualSavingPct('plus', 'yearly'))).toBe(21);
    // 🔴 AND THE-343 ADDED A SECOND REASON on the same term: Ministry alone was
    // repriced, so the tiers no longer even agree with each other — 20.83 on
    // Individual and Small Team against 21.67 on Ministry. A computed badge now
    // has BOTH problems at once: a number nobody signed off, and three tiers
    // that disagree under one toggle.
    expect(Math.round(actualSavingPct('max', 'yearly'))).toBe(22);
    expect(Math.round(actualSavingPct('max', 'yearly')))
      .not.toBe(Math.round(actualSavingPct('plus', 'yearly')));
    expect(ADVERTISED_DISCOUNT_PCT.yearly).not.toBe(Math.round(actualSavingPct('plus', 'yearly')));
  });

  /* 🔴 TEST 4: no copy claims a saving larger than the smallest actual one. */
  it('states a percentage flat only when the WORST tier actually reaches it', () => {
    for (const term of DISCOUNTED_TERMS) {
      const worst = Math.min(...PRICED_PLAN_ORDER.map((p) => actualSavingPct(p, term)));
      if (discountClaimShape(term) === 'flat') {
        expect(ADVERTISED_DISCOUNT_PCT[term]).toBeLessThanOrEqual(worst);
      }
    }
  });

  it('quarterly is claimed flat — every tier saves EXACTLY the advertised 10%', () => {
    // 🔴 THE KNIFE EDGE. The claim does not CLEAR the worst saving, it MEETS
    // it: $54/$60, $108/$120 and $216/$240 are each exactly nine tenths.
    //
    // `toBe(10)` rather than `toBeCloseTo` is the whole point. `actualSavingPct`
    // computed this as 9.999999999999998 until THE-248 reordered its arithmetic
    // to subtract in dollars, and at that value `10 <= worst` is FALSE — the
    // badge would read "Save up to 10%" and the module-scope guard would fail
    // the build. A tolerant matcher would have let both through.
    for (const plan of PRICED_PLAN_ORDER) {
      expect(actualSavingPct(plan, 'quarterly'), `${plan} quarterly`).toBe(10);
    }
    expect(ADVERTISED_DISCOUNT_PCT.quarterly)
      .toBe(Math.min(...PRICED_PLAN_ORDER.map((p) => actualSavingPct(p, 'quarterly'))));
    expect(discountClaimShape('quarterly')).toBe('flat');
    expect(discountClaim('quarterly')).toBe('Save 10%');
    expect(discountClaim('quarterly')).not.toContain('up to');
  });

  it('yearly is claimed flat — the WORST tier saves 20.83% against an advertised 20%', () => {
    // Yearly clears with room, but NO LONGER IDENTICALLY. $190/$240 and
    // $380/$480 are each 20.8333%; THE-343 made Ministry $564/$720, which is
    // 21.6667%. The claim is bounded by the WORST tier, so what keeps this
    // 'flat' is the 20.83 pair — Ministry saving MORE cannot weaken a 20%
    // claim. Yearly is still not the term a future reprice breaks first;
    // quarterly, sitting on equality above, is.
    //
    // ⚠️ NOT A COPY EDIT. Nothing in `discountClaimShape` was touched; the
    // prices moved underneath it. If this ever reads 'upTo' it is because a
    // tier fell under its advertised figure, which is what it should then say.
    expect(actualSavingPct('plus', 'yearly')).toBeCloseTo(20.8333, 3);
    expect(actualSavingPct('pro', 'yearly')).toBeCloseTo(20.8333, 3);
    expect(actualSavingPct('max', 'yearly')).toBeCloseTo(21.6667, 3);
    // 🔴 THE WORST TIER IS WHAT THE CLAIM RESTS ON, so it is asserted as the
    // minimum rather than tier-by-tier: a reprice that lifted only Ministry
    // must not be able to carry a claim the other two do not honour.
    expect(Math.min(...PRICED_PLAN_ORDER.map((p) => actualSavingPct(p, 'yearly')))).toBeCloseTo(20.8333, 3);
    expect(Math.min(...PRICED_PLAN_ORDER.map((p) => actualSavingPct(p, 'yearly')))).toBeGreaterThan(20);
    expect(discountClaimShape('yearly')).toBe('flat');
    expect(discountClaim('yearly')).toBe('Save 20%');
    expect(discountClaim('yearly')).not.toContain('up to');
  });

  it('never advertises more than even the BEST tier saves, under any wording', () => {
    for (const term of DISCOUNTED_TERMS) {
      const best = Math.max(...PRICED_PLAN_ORDER.map((p) => actualSavingPct(p, term)));
      expect(ADVERTISED_DISCOUNT_PCT[term]).toBeLessThanOrEqual(best);
    }
    // The per-tier savings, pinned. 🔴 QUARTERLY IS FLAT ACROSS TIERS; YEARLY
    // IS NOT, and THE-343 is what separated them — Ministry alone was repriced,
    // so its year saves 21.7% against the 20.8% the other two deliver.
    expect(PRICED_PLAN_ORDER.map((p) => Number(actualSavingPct(p, 'quarterly').toFixed(1)))).toEqual([10.0, 10.0, 10.0]);
    expect(PRICED_PLAN_ORDER.map((p) => Number(actualSavingPct(p, 'yearly').toFixed(1)))).toEqual([20.8, 20.8, 21.7]);
  });

  it('renders the charged figure and cycle through formatPlanPrice', () => {
    // 🔴 The suffix names the BILLING CYCLE, so the amount beside it is what
    // actually leaves the account. "$99/qtr" is never "$33/mo".
    expect(formatPlanPrice('plus', 'monthly')).toBe('$20/mo');
    expect(formatPlanPrice('plus', 'quarterly')).toBe('$54/qtr');
    expect(formatPlanPrice('plus', 'yearly')).toBe('$190/yr');
    expect(formatPlanPrice('pro', 'quarterly')).toBe('$108/qtr');
    expect(formatPlanPrice('max', 'yearly')).toBe('$564/yr');
    expect(formatPlanPrice('max', 'monthly')).toBe('$60/mo');
    expect(formatPlanPrice('max', 'quarterly')).toBe('$162/qtr');
  });

  it('the headline is the per-month figure on every term and tier', () => {
    // Ceiled at the cent. An exact division keeps its whole-dollar form.
    expect(formatPlanMonthlyHeadline('plus', 'yearly')).toBe('$15.84');
    expect(formatPlanMonthlyHeadline('pro', 'yearly')).toBe('$31.67');
    // 🔴 MINISTRY'S YEAR DIVIDES EXACTLY SINCE THE-343: $564/12 is $47 on the
    // nose, so it keeps the WHOLE-DOLLAR form and carries no cents at all.
    // $47 x 12 is $564 exactly — the headline and the charged total reconcile
    // with nothing left over, which no other yearly cell manages.
    expect(formatPlanMonthlyHeadline('max', 'yearly')).toBe('$47');
    expect(formatPlanMonthlyHeadline('max', 'yearly')).not.toContain('.');
    // 🔴 ALL THREE QUARTERS DIVIDE EXACTLY under THE-248, so all three keep the
    // whole-dollar form. That branch used to carry one cell; it now carries the
    // whole column.
    expect(formatPlanMonthlyHeadline('plus', 'quarterly')).toBe('$18');
    expect(formatPlanMonthlyHeadline('pro', 'quarterly')).toBe('$36');
    expect(formatPlanMonthlyHeadline('max', 'quarterly')).toBe('$54');
  });

  it('monthly renders as decided: the headline IS the charged price, no note', () => {
    // The decided behaviour, named. On monthly the per-month figure and the
    // charged figure are the same number on the same cycle, so the card shows
    // the headline alone and the note is suppressed (the card test asserts the
    // suppression; this asserts the two figures really do coincide).
    for (const plan of PRICED_PLAN_ORDER) {
      expect(formatPlanMonthlyHeadline(plan, 'monthly')).toBe(
        `$${planPriceUsd(plan, 'monthly').toLocaleString()}`,
      );
      expect(planTermMonthlyDisplayed(plan, 'monthly')).toBe(planPriceUsd(plan, 'monthly'));
    }
  });

  it('the per-month headline never states a figure that implies less than the charged total', () => {
    // 🔴 THE HONESTY GUARD — one assertion per tier per term, nine in all.
    //
    // This is the defect THE-196 exists to remove. Under the old
    // `Math.round` the Individual yearly headline was $27 (implying $324
    // against a charged $329) and Small Team quarterly was $66 (implying $198
    // against $199). Both would fail here.
    for (const plan of PRICED_PLAN_ORDER) {
      for (const term of BILLING_TERMS) {
        const charged = planPriceUsd(plan, term);
        const implied = planTermMonthlyDisplayed(plan, term) * TERM_MONTHS[term];
        expect(
          implied,
          `${plan} ${term}: headline implies $${implied.toFixed(2)}, Dodo charges $${charged}`,
        ).toBeGreaterThanOrEqual(charged);
      }
    }
  });

  it('the headline reconciles with the charged total, not merely exceeds it', () => {
    // Ceiling to the DOLLAR would also pass the guard above while putting $768
    // beside a charged $760. The cent bounds the gap at the rounding itself.
    //
    // 🔴 THE BOUND IS DERIVED, NOT A CONSTANT. It was a flat 0.05, which was
    // only the worst gap the THE-222 prices happened to produce — THE-248's
    // $760 year overshoots by $0.08 without breaking the rule at all. Ceiling
    // at the cent can add at most one cent per month, so `months × $0.01` is
    // the honest ceiling, and it still excludes ceiling to the DOLLAR (up to
    // $0.99 a month), which is the presentation this rules out.
    for (const plan of PRICED_PLAN_ORDER) {
      for (const term of BILLING_TERMS) {
        const charged = planPriceUsd(plan, term);
        const months = TERM_MONTHS[term];
        const implied = planTermMonthlyDisplayed(plan, term) * months;
        expect(implied - charged, `${plan} ${term}`).toBeLessThan(months * 0.01 + 1e-9);
        expect(implied - charged, `${plan} ${term}`).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });

  it('the honesty guard throws when the rounding rule would understate the bill', () => {
    // Verified by MUTATION, and the mutation is the realistic one: the rule
    // regressing to what it was before THE-196. Checked against the shipped
    // ceiling the guard could never fail, so it takes the rule as its subject.
    expect(() => monthlyHeadlineContract()).not.toThrow();
    // ⚠️ THE-343 TOOK THE LAST OFFENDING CELL AWAY. Every quarter divides
    // exactly ($54/3, $108/3, $162/3 → $18, $36, $54), and every year now
    // either rounds UP ($190/12 = $15.83 → $16; $380/12 = $31.67 → $32) or
    // divides exactly ($564/12 = $47). `Math.round` therefore understates
    // NOWHERE on the shipped table, so pointing this mutation at it would
    // assert a rule that cannot fire — a guard that passes while proving
    // nothing. The rule is still the subject; the hazard is now supplied.
    expect(() => monthlyHeadlineContract(Math.round, {
          // 🔴 THE TABLE IS EXPLICIT BECAUSE THE SHIPPED ONE NO LONGER OFFENDS.
          // THE-343 repriced Ministry to $564/yr, which is $47/mo EXACTLY, so
          // after it every quarter divides exactly and every year either
          // divides exactly or rounds UP — `Math.round` understates NOWHERE on
          // today's prices. Left pointed at the shipped table this mutation
          // would have passed while proving nothing, which is precisely the
          // vacuous guard this suite exists to refuse.
          //
          // So the hazard is supplied rather than borrowed: only `max`
          // understates here — 1325/12 = 110.4167 rounds DOWN to 110, implying
          // $1,320 against a charged $1,325 — while plus and pro divide exactly
          // and so cannot throw first, which is what lets the message name max.
          plus: { monthly: 39, quarterly: 90, yearly: 360 },
          pro: { monthly: 79, quarterly: 150, yearly: 600 },
          max: { monthly: 159, quarterly: 399, yearly: 1325 },
        })).toThrow(/never promise less than the bill/);
    expect(() => monthlyHeadlineContract(Math.round, {
          // 🔴 THE TABLE IS EXPLICIT BECAUSE THE SHIPPED ONE NO LONGER OFFENDS.
          // THE-343 repriced Ministry to $564/yr, which is $47/mo EXACTLY, so
          // after it every quarter divides exactly and every year either
          // divides exactly or rounds UP — `Math.round` understates NOWHERE on
          // today's prices. Left pointed at the shipped table this mutation
          // would have passed while proving nothing, which is precisely the
          // vacuous guard this suite exists to refuse.
          //
          // So the hazard is supplied rather than borrowed: only `max`
          // understates here — 1325/12 = 110.4167 rounds DOWN to 110, implying
          // $1,320 against a charged $1,325 — while plus and pro divide exactly
          // and so cannot throw first, which is what lets the message name max.
          plus: { monthly: 39, quarterly: 90, yearly: 360 },
          pro: { monthly: 79, quarterly: 150, yearly: 600 },
          max: { monthly: 159, quarterly: 399, yearly: 1325 },
        })).toThrow(/max yearly/);
    // Ceiling to the DOLLAR does not understate, so the guard accepts it — it
    // is bounded by the reconciliation test above, not by this one.
    expect(() => monthlyHeadlineContract(Math.ceil)).not.toThrow();
    // Flooring understates almost everywhere, and still does on the SHIPPED
    // table — $15.83 and $31.67 floor to $15 and $31 — so this half needs no
    // supplied hazard and keeps the shipped prices in the mutation's scope.
    expect(() => monthlyHeadlineContract(Math.floor)).toThrow(/never promise less than the bill/);
  });

  it('describes each term in prose without falling into an else-branch', () => {
    // The signup banner asked `billing === 'yearly' ? ... : 'billed monthly'`,
    // which told a quarterly church "billed monthly" on the last screen before
    // it paid. A total map cannot do that.
    expect(TERM_BILLED_PHRASE.monthly).toBe('billed monthly');
    expect(TERM_BILLED_PHRASE.quarterly).toBe('billed quarterly');
    expect(TERM_BILLED_PHRASE.yearly).toBe('billed annually');
    expect(Object.keys(TERM_BILLED_PHRASE).sort()).toEqual([...BILLING_TERMS].sort());
  });

  it('no plan price is 200 — the retired $200 add-on price is gone, not folded in', () => {
    // WAS 'leaves the retired AI Assistant add-on at $200 — not swept up in the
    // repricing': it pinned `AI_ASSISTANT_ADDON_PRICING.monthlyUsd === 200` as
    // dormant-but-intact, on the reasoning that an ADD-ON price sharing
    // PLAN_PRICING's `monthlyUsd` field name is exactly what a bulk repricing
    // catches by accident. THE-253 deleted the constant: $200 against a live
    // $20 product was not worth preserving, and the live figure lives in Dodo.
    // The half that still means something is kept — no PLAN was ever priced at
    // 200, so nothing absorbed it on the way out.
    expect(Object.values(PLAN_PRICING).flatMap((p) => Object.values(p))).not.toContain(200);
  });
});


describe('PLAN_DISPLAY_NAMES (repriced)', () => {
  it('is Individual / Small Team / Ministry', () => {
    expect(PRICED_PLAN_ORDER.map((p) => PLAN_DISPLAY_NAMES[p])).toEqual([
      'Individual',
      'Small Team',
      'Ministry',
    ]);
    // Plus the free tier's own name, added by THE-200 and deliberately plain:
    // the card's differentiator is the audience (the blurb) and the price.
    expect(PLAN_DISPLAY_NAMES.free).toBe('Free');
  });

  it('no longer calls the top tier Community', () => {
    expect(Object.values(PLAN_DISPLAY_NAMES)).not.toContain('Community');
    expect(PLAN_DISPLAY_NAMES.max).toBe('Ministry');
  });
});

describe('PLATFORM_FEE_MAP — donations are free on every tier', () => {
  it('is exactly { plus: 0, pro: 0, max: 0 }', () => {
    expect(PLATFORM_FEE_MAP.plus).toBe(0);
    expect(PLATFORM_FEE_MAP.pro).toBe(0);
    expect(PLATFORM_FEE_MAP.max).toBe(0);
  });

  it('has no non-zero rate on any key', () => {
    expect(Object.values(PLATFORM_FEE_MAP)).toEqual([0, 0, 0]);
  });

  it.each(['plus', 'pro', 'max'] as const)(
    'a $100 donation on %s deducts nothing',
    (plan) => {
      // The same arithmetic the donate route runs to build application_fee_amount.
      const amountCents = 10_000;
      expect(Math.round(amountCents * PLATFORM_FEE_MAP[plan])).toBe(0);
    }
  );
});

describe('four features moved from the top tier to Small Team (pro)', () => {
  // Was five. `crm` moved a second time in THE-161 — past Small Team, all the
  // way to Individual — so Small Team is no longer its floor and it is asserted
  // in its own file (plan-features.crm-individual.test.ts) instead. The four
  // below are untouched by that move, and the "stays locked on Individual"
  // assertion is precisely what stops one of them riding along with it.
  const MOVED = ['checkInSystem', 'livestream', 'sermonNotes', 'docs'] as const;

  it.each(MOVED)('%s is unlocked on Small Team (pro)', (key) => {
    expect(getPlanFeatures('pro')[key]).toBe(true);
  });

  it.each(MOVED)('%s stays locked on Individual (plus)', (key) => {
    expect(getPlanFeatures('plus')[key]).toBe(false);
  });

  it.each(MOVED)('%s stays unlocked on Ministry (max)', (key) => {
    expect(getPlanFeatures('max')[key]).toBe(true);
  });

  it('moved these four and nothing else off top-tier exclusivity', () => {
    // Every other cell that was max-and-above before the move must still be
    // locked on pro. A sixth feature riding along fails here.
    //
    // `smsAutomation` and `textToGive` were on this list as top-tier-only. They
    // are deliberately NOT any more: SMS went BYO-only on every tier in the
    // repricing, so they are asserted true in the BYO describe above rather than
    // false here.
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
    expect(f.accountingTools).toBe(false);
    // `churchDirectory` was asserted false here too; it was later removed from
    // the matrix entirely (see 'retired matrix cells stay retired' above).
    // Caps are explicitly out of scope for the move.
    expect(f.maxCourses).toBe(5);
    expect(f.maxAdmins).toBe(5);
    expect(f.maxChurches).toBe(1);
  });

  it('moves the derived upsell label down with it — Notes now says Small Team', () => {
    // The whole point of deriving FEATURE_MIN_PLAN (#242): flipping a matrix cell
    // moves the upgrade copy with no edit to any label. `docs` is the moved
    // feature that has a FeatureKey. (`crm` had one too and has since moved
    // again, to Individual — that move needed no edit here either, which is the
    // same point made twice.)
    expect(getFeatureMinPlan('docs')).toBe('pro');
    expect(FEATURE_MIN_PLAN.docs).toBe('Small Team');
    expect(FEATURE_MIN_PLAN.docs).not.toBe('Ministry');
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
