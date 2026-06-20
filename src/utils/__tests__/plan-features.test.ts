import { describe, it, expect } from 'vitest';
import {
  getPlanFeatures,
  getPlanDisplayName,
  hasFeature,
  PLAN_PRICING,
  AI_ASSISTANT_ADDON_PRICING,
  PLAN_REVENUE_SHARE,
  formatPlanPrice,
} from '../plan-features';

describe('getPlanFeatures', () => {
  it('returns correct features for plus plan', () => {
    const f = getPlanFeatures('plus');
    expect(f.blog).toBe(true);
    expect(f.aiChat).toBe(false);
    expect(f.maxChurches).toBe(1);
    expect(f.maxCourses).toBe(5);
    expect(f.maxAdmins).toBe(2);
    expect(f.customDomain).toBe(false);
    expect(f.aiAssistant).toBe(false);
  });

  it('returns correct features for pro plan', () => {
    const f = getPlanFeatures('pro');
    expect(f.aiChat).toBe(true);
    expect(f.maxCourses).toBe(-1);
    expect(f.maxAdmins).toBe(5);
    expect(f.customDomain).toBe(false);
  });

  it('returns correct features for ultra plan', () => {
    const f = getPlanFeatures('ultra');
    expect(f.aiAssistant).toBe(true);
    expect(f.customDomain).toBe(true);
    expect(f.maxAdmins).toBe(-1);
  });

  it('returns correct features for enterprise plan', () => {
    const f = getPlanFeatures('enterprise');
    expect(f.map).toBe(true);
    expect(f.maxChurches).toBe(-1);
  });

  it('defaults to plus for unknown plan', () => {
    const f = getPlanFeatures('nonexistent' as any);
    expect(f).toEqual(getPlanFeatures('plus'));
  });
});

describe('getPlanDisplayName', () => {
  it('returns correct display names', () => {
    expect(getPlanDisplayName('plus')).toBe('Individual');
    expect(getPlanDisplayName('pro')).toBe('Community');
    expect(getPlanDisplayName('max')).toBe('Church');
    expect(getPlanDisplayName('ultra')).toBe('Ministry');
    expect(getPlanDisplayName('enterprise')).toBe('Enterprise');
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

  it('returns false for disabled boolean features', () => {
    expect(hasFeature('plus', 'aiChat')).toBe(false);
    expect(hasFeature('plus', 'aiAssistant')).toBe(false);
  });

  it('returns true for non-zero numeric features', () => {
    expect(hasFeature('plus', 'maxChurches')).toBe(true);
    expect(hasFeature('plus', 'maxCourses')).toBe(true);
  });

  it('map is only on enterprise', () => {
    expect(hasFeature('plus', 'map')).toBe(false);
    expect(hasFeature('pro', 'map')).toBe(false);
    expect(hasFeature('max', 'map')).toBe(false);
    expect(hasFeature('ultra', 'map')).toBe(false);
    expect(hasFeature('enterprise', 'map')).toBe(true);
  });
});

describe('PLAN_PRICING', () => {
  it('has correct monthly prices', () => {
    expect(PLAN_PRICING.plus.monthlyUsd).toBe(49);
    expect(PLAN_PRICING.pro.monthlyUsd).toBe(99);
    expect(PLAN_PRICING.max.monthlyUsd).toBe(199);
    expect(PLAN_PRICING.ultra.monthlyUsd).toBe(349);
    expect(PLAN_PRICING.enterprise.monthlyUsd).toBeNull();
  });

  it('yearly price equals 10 months (2 months free)', () => {
    const plans = ['plus', 'pro', 'max', 'ultra'] as const;
    for (const plan of plans) {
      const { monthlyUsd, yearlyUsd } = PLAN_PRICING[plan];
      expect(yearlyUsd).toBe((monthlyUsd as number) * 10);
    }
  });
});

describe('AI_ASSISTANT_ADDON_PRICING', () => {
  it('has expected values', () => {
    expect(AI_ASSISTANT_ADDON_PRICING.setupFeeUsd).toBe(150);
    expect(AI_ASSISTANT_ADDON_PRICING.monthlyUsd).toBe(100);
  });
});

describe('PLAN_REVENUE_SHARE', () => {
  it('has correct revenue share per plan', () => {
    expect(PLAN_REVENUE_SHARE.plus).toBe(70);
    expect(PLAN_REVENUE_SHARE.pro).toBe(80);
    expect(PLAN_REVENUE_SHARE.max).toBe(90);
    expect(PLAN_REVENUE_SHARE.ultra).toBe(100);
    expect(PLAN_REVENUE_SHARE.enterprise).toBe(100);
  });
});

describe('formatPlanPrice', () => {
  it('formats monthly prices', () => {
    expect(formatPlanPrice('plus', 'monthly')).toBe('$49/mo');
    expect(formatPlanPrice('ultra', 'monthly')).toBe('$349/mo');
  });

  it('formats yearly prices', () => {
    expect(formatPlanPrice('plus', 'yearly')).toBe('$490/yr');
    expect(formatPlanPrice('max', 'yearly')).toBe('$1,990/yr');
  });

  it('returns Custom for enterprise', () => {
    expect(formatPlanPrice('enterprise', 'monthly')).toBe('Custom');
    expect(formatPlanPrice('enterprise', 'yearly')).toBe('Custom');
  });
});

// ─── CONTRACT TEST ─────────────────────────────────────────────────────────────
//
// This test encodes the exact feature matrix that is displayed on the marketing
// site (theharvest.site). If you change any value in plan-features.ts you MUST
// update this matrix AND update the marketing site copy (or switch to /api/plans
// for live sync so they can never drift again).
//
// Columns: plus | pro | max | ultra | enterprise

describe('plan feature contract — must match marketing site', () => {
  it('blog is available on all plans', () => {
    expect(getPlanFeatures('plus').blog).toBe(true);
    expect(getPlanFeatures('pro').blog).toBe(true);
    expect(getPlanFeatures('max').blog).toBe(true);
    expect(getPlanFeatures('ultra').blog).toBe(true);
    expect(getPlanFeatures('enterprise').blog).toBe(true);
  });

  it('AI Chat starts at Community (pro)', () => {
    expect(getPlanFeatures('plus').aiChat).toBe(false);
    expect(getPlanFeatures('pro').aiChat).toBe(true);
    expect(getPlanFeatures('max').aiChat).toBe(true);
    expect(getPlanFeatures('ultra').aiChat).toBe(true);
    expect(getPlanFeatures('enterprise').aiChat).toBe(true);
  });

  it('AI Knowledge Base starts at Community (pro)', () => {
    expect(getPlanFeatures('plus').aiKnowledge).toBe(false);
    expect(getPlanFeatures('pro').aiKnowledge).toBe(true);
    expect(getPlanFeatures('max').aiKnowledge).toBe(true);
    expect(getPlanFeatures('ultra').aiKnowledge).toBe(true);
    expect(getPlanFeatures('enterprise').aiKnowledge).toBe(true);
  });

  it('Newsletter Automation starts at Church (max)', () => {
    expect(getPlanFeatures('plus').newsletterAutomation).toBe(false);
    expect(getPlanFeatures('pro').newsletterAutomation).toBe(false); // confirmed fix
    expect(getPlanFeatures('max').newsletterAutomation).toBe(true);
    expect(getPlanFeatures('ultra').newsletterAutomation).toBe(true);
    expect(getPlanFeatures('enterprise').newsletterAutomation).toBe(true);
  });

  it('SMS Automation starts at Church (max)', () => {
    expect(getPlanFeatures('plus').smsAutomation).toBe(false);
    expect(getPlanFeatures('pro').smsAutomation).toBe(false);
    expect(getPlanFeatures('max').smsAutomation).toBe(true);
    expect(getPlanFeatures('ultra').smsAutomation).toBe(true);
    expect(getPlanFeatures('enterprise').smsAutomation).toBe(true);
  });

  it('Custom Domain starts at Church (max)', () => {
    expect(getPlanFeatures('plus').customDomain).toBe(false);
    expect(getPlanFeatures('pro').customDomain).toBe(false);
    expect(getPlanFeatures('max').customDomain).toBe(true);
    expect(getPlanFeatures('ultra').customDomain).toBe(true);
    expect(getPlanFeatures('enterprise').customDomain).toBe(true);
  });

  it('Custom Background starts at Church (max)', () => {
    expect(getPlanFeatures('plus').customBackground).toBe(false);
    expect(getPlanFeatures('pro').customBackground).toBe(false);
    expect(getPlanFeatures('max').customBackground).toBe(true);
    expect(getPlanFeatures('ultra').customBackground).toBe(true);
    expect(getPlanFeatures('enterprise').customBackground).toBe(true);
  });

  it('AI Assistant included starts at Ministry (ultra)', () => {
    expect(getPlanFeatures('plus').aiAssistant).toBe(false);
    expect(getPlanFeatures('pro').aiAssistant).toBe(false);
    expect(getPlanFeatures('max').aiAssistant).toBe(false);
    expect(getPlanFeatures('ultra').aiAssistant).toBe(true);
    expect(getPlanFeatures('enterprise').aiAssistant).toBe(true);
  });

  it('Church Map is Enterprise only', () => {
    expect(getPlanFeatures('plus').map).toBe(false);
    expect(getPlanFeatures('pro').map).toBe(false);
    expect(getPlanFeatures('max').map).toBe(false);
    expect(getPlanFeatures('ultra').map).toBe(false);
    expect(getPlanFeatures('enterprise').map).toBe(true);
  });

  it('course limits', () => {
    expect(getPlanFeatures('plus').maxCourses).toBe(5);
    expect(getPlanFeatures('pro').maxCourses).toBe(-1);
    expect(getPlanFeatures('max').maxCourses).toBe(-1);
    expect(getPlanFeatures('ultra').maxCourses).toBe(-1);
    expect(getPlanFeatures('enterprise').maxCourses).toBe(-1);
  });

  it('admin seat limits', () => {
    expect(getPlanFeatures('plus').maxAdmins).toBe(2);
    expect(getPlanFeatures('pro').maxAdmins).toBe(5);
    expect(getPlanFeatures('max').maxAdmins).toBe(-1);
    expect(getPlanFeatures('ultra').maxAdmins).toBe(-1);
    expect(getPlanFeatures('enterprise').maxAdmins).toBe(-1);
  });

  it('location limits', () => {
    expect(getPlanFeatures('plus').maxChurches).toBe(1);
    expect(getPlanFeatures('pro').maxChurches).toBe(1);
    expect(getPlanFeatures('max').maxChurches).toBe(1);
    expect(getPlanFeatures('ultra').maxChurches).toBe(1);
    expect(getPlanFeatures('enterprise').maxChurches).toBe(-1);
  });
});
