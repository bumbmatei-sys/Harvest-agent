import { describe, it, expect } from 'vitest';
import {
  getPlanFeatures,
  getPlanDisplayName,
  hasFeature,
  PLAN_PRICING,
  PLAN_DONATION_RETENTION,
  AI_ASSISTANT_ADDON_PRICING,
  formatPlanPrice,
} from '../plan-features';

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

describe('AI_ASSISTANT_ADDON_PRICING', () => {
  it('AI Assistant add-on is $200/mo flat with no setup fee', () => {
    expect(AI_ASSISTANT_ADDON_PRICING.monthlyUsd).toBe(200);
    expect('setupFeeUsd' in AI_ASSISTANT_ADDON_PRICING).toBe(false);
  });
});

describe('PLAN_DONATION_RETENTION', () => {
  // Source of truth: theharvest.site pricing "Donation Retention" row.
  it('matches the marketing site retention tiers (90/95/100/100)', () => {
    expect(PLAN_DONATION_RETENTION.plus).toBe(90);
    expect(PLAN_DONATION_RETENTION.pro).toBe(95);
    expect(PLAN_DONATION_RETENTION.max).toBe(100);
    expect(PLAN_DONATION_RETENTION.ultra).toBe(100);
  });

  it('stays in sync with the donationRetention field in the feature matrix', () => {
    (['plus', 'pro', 'max', 'ultra'] as const).forEach((plan) => {
      expect(getPlanFeatures(plan).donationRetention).toBe(PLAN_DONATION_RETENTION[plan]);
    });
  });
});
