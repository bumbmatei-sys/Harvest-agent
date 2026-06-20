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
    expect(f.aiChat).toBe(false);
    expect(f.maxChurches).toBe(1);
    expect(f.maxCourses).toBe(5);
    expect(f.maxAdmins).toBe(2);
    expect(f.customDomain).toBe(false);
    expect(f.aiAssistant).toBe('addon');
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
    expect(f.aiAssistant).toBe('included');
    expect(f.customDomain).toBe(true);
    expect(f.maxAdmins).toBe(-1);
  });

  it('returns correct features for enterprise plan', () => {
    const f = getPlanFeatures('enterprise');
    expect(f.map).toBe(true);
    expect(f.maxChurches).toBe(-1);
    expect(f.aiAssistant).toBe('included');
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
  });

  it('returns true for non-zero numeric features', () => {
    expect(hasFeature('plus', 'maxChurches')).toBe(true);
    expect(hasFeature('plus', 'maxCourses')).toBe(true);
  });

  it('returns true for aiAssistant on all plans (addon or included both count)', () => {
    expect(hasFeature('plus', 'aiAssistant')).toBe(true);
    expect(hasFeature('pro', 'aiAssistant')).toBe(true);
    expect(hasFeature('max', 'aiAssistant')).toBe(true);
    expect(hasFeature('ultra', 'aiAssistant')).toBe(true);
    expect(hasFeature('enterprise', 'aiAssistant')).toBe(true);
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

  it('yearly = 10 months (2 months free promo)', () => {
    const plans = ['plus', 'pro', 'max', 'ultra'] as const;
    for (const plan of plans) {
      const { monthlyUsd, yearlyUsd } = PLAN_PRICING[plan];
      expect(yearlyUsd).toBe((monthlyUsd as number) * 10);
    }
  });
});

describe('PLAN_DONATION_RETENTION', () => {
  it('matches marketing site values', () => {
    expect(PLAN_DONATION_RETENTION.plus).toBe(85);
    expect(PLAN_DONATION_RETENTION.pro).toBe(90);
    expect(PLAN_DONATION_RETENTION.max).toBe(95);
    expect(PLAN_DONATION_RETENTION.ultra).toBe(100);
    expect(PLAN_DONATION_RETENTION.enterprise).toBe(100);
  });
});

describe('AI_ASSISTANT_ADDON_PRICING', () => {
  it('has expected values', () => {
    expect(AI_ASSISTANT_ADDON_PRICING.setupFeeUsd).toBe(150);
    expect(AI_ASSISTANT_ADDON_PRICING.monthlyUsd).toBe(100);
  });
});

describe('formatPlanPrice', () => {
  it('formats monthly prices', () => {
    expect(formatPlanPrice('plus', 'monthly')).toBe('$49/mo');
    expect(formatPlanPrice('ultra', 'monthly')).toBe('$349/mo');
  });

  it('formats yearly prices with comma separator', () => {
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
// This table encodes exactly what is displayed on theharvest.site pricing page.
// If you change any value in plan-features.ts you MUST:
//   1. Update the corresponding assertion below
//   2. Update the marketing site copy (or switch it to /api/plans for live sync)
//
// Screenshots of the live pricing page are in docs/phase-a-audit.md for reference.

describe('plan feature contract — must match theharvest.site pricing table', () => {
  it('blog available on all plans', () => {
    expect(getPlanFeatures('plus').blog).toBe(true);
    expect(getPlanFeatures('pro').blog).toBe(true);
    expect(getPlanFeatures('max').blog).toBe(true);
    expect(getPlanFeatures('ultra').blog).toBe(true);
    expect(getPlanFeatures('enterprise').blog).toBe(true);
  });

  it('AI Knowledge Base starts at Community (pro)', () => {
    expect(getPlanFeatures('plus').aiKnowledge).toBe(false);
    expect(getPlanFeatures('pro').aiKnowledge).toBe(true);
    expect(getPlanFeatures('max').aiKnowledge).toBe(true);
    expect(getPlanFeatures('ultra').aiKnowledge).toBe(true);
    expect(getPlanFeatures('enterprise').aiKnowledge).toBe(true);
  });

  it('AI Assistant is addon on plus/pro/max, included on ultra/enterprise', () => {
    expect(getPlanFeatures('plus').aiAssistant).toBe('addon');
    expect(getPlanFeatures('pro').aiAssistant).toBe('addon');
    expect(getPlanFeatures('max').aiAssistant).toBe('addon');
    expect(getPlanFeatures('ultra').aiAssistant).toBe('included');
    expect(getPlanFeatures('enterprise').aiAssistant).toBe('included');
  });

  it('Newsletter Automation starts at Community (pro)', () => {
    // Note: the marketing site detailed table shows ✓ for Individual too,
    // but the plan cards only introduce it at Community. The plan cards are
    // authoritative; the table has a known display bug on the marketing site.
    expect(getPlanFeatures('plus').newsletterAutomation).toBe(false);
    expect(getPlanFeatures('pro').newsletterAutomation).toBe(true);
    expect(getPlanFeatures('max').newsletterAutomation).toBe(true);
    expect(getPlanFeatures('ultra').newsletterAutomation).toBe(true);
    expect(getPlanFeatures('enterprise').newsletterAutomation).toBe(true);
  });

  it('Custom Domain starts at Church (max)', () => {
    expect(getPlanFeatures('plus').customDomain).toBe(false);
    expect(getPlanFeatures('pro').customDomain).toBe(false);
    expect(getPlanFeatures('max').customDomain).toBe(true);
    expect(getPlanFeatures('ultra').customDomain).toBe(true);
    expect(getPlanFeatures('enterprise').customDomain).toBe(true);
  });

  it('Full Rebranding starts at Church (max)', () => {
    expect(getPlanFeatures('plus').customBackground).toBe(false);
    expect(getPlanFeatures('pro').customBackground).toBe(false);
    expect(getPlanFeatures('max').customBackground).toBe(true);
    expect(getPlanFeatures('ultra').customBackground).toBe(true);
    expect(getPlanFeatures('enterprise').customBackground).toBe(true);
  });

  it('Multiple Churches is Enterprise only', () => {
    expect(getPlanFeatures('plus').maxChurches).toBe(1);
    expect(getPlanFeatures('pro').maxChurches).toBe(1);
    expect(getPlanFeatures('max').maxChurches).toBe(1);
    expect(getPlanFeatures('ultra').maxChurches).toBe(1);
    expect(getPlanFeatures('enterprise').maxChurches).toBe(-1);
  });

  it('course limits match marketing site', () => {
    expect(getPlanFeatures('plus').maxCourses).toBe(5);
    expect(getPlanFeatures('pro').maxCourses).toBe(-1);
    expect(getPlanFeatures('max').maxCourses).toBe(-1);
    expect(getPlanFeatures('ultra').maxCourses).toBe(-1);
    expect(getPlanFeatures('enterprise').maxCourses).toBe(-1);
  });

  it('admin seat limits match marketing site', () => {
    expect(getPlanFeatures('plus').maxAdmins).toBe(2);
    expect(getPlanFeatures('pro').maxAdmins).toBe(5);
    expect(getPlanFeatures('max').maxAdmins).toBe(-1);
    expect(getPlanFeatures('ultra').maxAdmins).toBe(-1);
    expect(getPlanFeatures('enterprise').maxAdmins).toBe(-1);
  });

  it('donation retention matches marketing site percentages', () => {
    expect(PLAN_DONATION_RETENTION.plus).toBe(85);        // was wrong (70) in old UI code
    expect(PLAN_DONATION_RETENTION.pro).toBe(90);         // was wrong (80) in old UI code
    expect(PLAN_DONATION_RETENTION.max).toBe(95);         // was wrong (90) in old UI code
    expect(PLAN_DONATION_RETENTION.ultra).toBe(100);
    expect(PLAN_DONATION_RETENTION.enterprise).toBe(100);
  });
});
