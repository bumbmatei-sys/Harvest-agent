import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { stripComments } from './__fixtures__/the-346-strip-comments';
import {
  ADVERTISED_DISCOUNT_PCT,
  BILLING_TERMS,
  PAID_PRODUCT_CHECKOUT_ENABLED,
  PLAN_BLURBS,
  PLAN_DISPLAY_NAMES,
  PLAN_FEES,
  PLAN_ORDER,
  PLAN_PRICING,
  PRICED_PLAN_ORDER,
  PROCESSOR_FEE_NOTE,
  UNLIMITED_CAP,
  actualSavingPct,
  discountClaim,
  discountClaimShape,
  formatDonationFee,
  formatPlanPrice,
  formatProductSalesFee,
  getEffectiveFeatures,
  getMinPlanForFeatureCell,
  getPlanDisplayName,
  getPlanFeatures,
  hasFeature,
  isUnpricedTier,
  termFreeMonths,
  toTenantPlan,
} from '@/utils/plan-features';
import { LEGACY_PLAN_ALIASES, canonicalPlanId } from '@/utils/plan-id';
import { getPlanLimits, PLAN_LIMITS, DEFAULT_PLAN_ID } from '@/lib/planLimits';
import { PLATFORM_FEE_MAP } from '@/lib/stripe-connect';
import { DEFAULT_EMAIL_LIMITS, resolveLimits } from '@/lib/email/limits';

const REPO = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(REPO, rel), 'utf8');

/**
 * The two-plan repricing: Church and Ministry replace plus / pro / max.
 *
 * Every number here is typed out from the approved spec, not read from the
 * constants under test, so a drifted constant fails instead of agreeing with
 * itself.
 */
describe('the two paid plans and what they cost', () => {
  it('sells Free, Church and Ministry and nothing else', () => {
    expect(PLAN_ORDER).toEqual(['free', 'church', 'ministry']);
    expect(PRICED_PLAN_ORDER).toEqual(['church', 'ministry']);
    expect(PLAN_DISPLAY_NAMES).toEqual({ free: 'Free', church: 'Church', ministry: 'Ministry' });
    expect(Object.keys(PLAN_BLURBS).sort()).toEqual(['church', 'free', 'ministry']);
  });

  it('prices Church at 30 / 300 and Ministry at 90 / 900, monthly and yearly only', () => {
    expect([...BILLING_TERMS]).toEqual(['monthly', 'yearly']);
    expect(PLAN_PRICING).toEqual({
      church: { monthly: 30, yearly: 300 },
      ministry: { monthly: 90, yearly: 900 },
    });
    expect(formatPlanPrice('church', 'monthly')).toBe('$30/mo');
    expect(formatPlanPrice('church', 'yearly')).toBe('$300/yr');
    expect(formatPlanPrice('ministry', 'monthly')).toBe('$90/mo');
    expect(formatPlanPrice('ministry', 'yearly')).toBe('$900/yr');
    expect(formatPlanPrice('free', 'monthly')).toBe('Free');
  });

  it('advertises "2 months free", and the stored percentage is the honest 16 (the real 16.67 rounded down)', () => {
    expect(ADVERTISED_DISCOUNT_PCT).toEqual({ yearly: 16 });
    expect(discountClaim('yearly')).toBe('2 months free');
    for (const plan of PRICED_PLAN_ORDER) {
      expect(termFreeMonths(plan, 'yearly')).toBe(2);
      // Never claim more than the bill delivers.
      expect(ADVERTISED_DISCOUNT_PCT.yearly).toBeLessThanOrEqual(actualSavingPct(plan, 'yearly'));
      expect(actualSavingPct(plan, 'yearly')).toBeCloseTo(16.6667, 3);
    }
    expect(discountClaimShape('yearly')).toBe('flat');
  });

  it('no longer carries the retired three-tier figures or the 20% claim', () => {
    const prices = Object.values(PLAN_PRICING).flatMap((p) => Object.values(p));
    for (const retired of [20, 40, 80, 190, 380, 752]) expect(prices).not.toContain(retired);
    expect(ADVERTISED_DISCOUNT_PCT.yearly).not.toBe(20);
    expect(discountClaim('yearly')).not.toMatch(/20/);
  });
});

describe('what each plan includes, per the spec', () => {
  const church = getPlanFeatures('church');
  const ministry = getPlanFeatures('ministry');

  it('people limits are 500 and 5,000, admins 2 and 15', () => {
    expect(church.maxContacts).toBe(500);
    expect(ministry.maxContacts).toBe(5_000);
    expect(church.maxAdmins).toBe(2);
    expect(ministry.maxAdmins).toBe(15);
  });

  it('the AI assistant allowance is 300 and 5,000 messages, a real number and never "unlimited"', () => {
    expect(church.aiMessagesPerMonth).toBe(300);
    expect(ministry.aiMessagesPerMonth).toBe(5_000);
    expect(getPlanFeatures('free').aiMessagesPerMonth).toBe(0);
    for (const plan of PLAN_ORDER) {
      expect(getPlanFeatures(plan).aiMessagesPerMonth).not.toBe(UNLIMITED_CAP);
    }
    // The assistant is not built: the live RAG chat stays an add-on, on every tier.
    expect(church.aiChat).toBe(false);
    expect(ministry.aiChat).toBe(false);
  });

  it('Church has one community, up to three products and unlimited campuses', () => {
    expect(church.maxCommunities).toBe(1);
    expect(church.maxProducts).toBe(3);
    expect(church.maxChurches).toBe(UNLIMITED_CAP);
    expect(church.newsFeed).toBe(true);
    expect(church.communityGroups).toBe(true);
  });

  it('Ministry has unlimited communities and products', () => {
    expect(ministry.maxCommunities).toBe(UNLIMITED_CAP);
    expect(ministry.maxProducts).toBe(UNLIMITED_CAP);
  });

  it('Church has courses, donations and campaigns, CRM, signups, blog and notes', () => {
    for (const cell of ['blog', 'fundraising', 'crm', 'signups', 'docs', 'pwaApp'] as const) {
      expect(church[cell], cell).toBe(true);
    }
    expect(church.maxCourses).toBeGreaterThan(0);
  });

  it('Ministry adds everything the spec lists on top of Church', () => {
    for (const cell of [
      'newsletterAutomation',
      'socialScheduler',
      'smsAutomation',
      'textToGive',
      'eventRegistration',
      'checkInSystem',
      'customForms',
      'accountingTools', // "Giving records"
      'taxReceipt', // year-end giving receipts
      'givingStatements',
      'aiKnowledge',
      'customBranding',
    ] as const) {
      expect(ministry[cell], `ministry.${cell}`).toBe(true);
      expect(church[cell], `church.${cell}`).toBe(false);
    }
  });

  it('every Church capability is also on Ministry ("everything in Church plus")', () => {
    for (const [key, value] of Object.entries(church) as [keyof typeof church, unknown][]) {
      if (value === true) expect(ministry[key], key).toBe(true);
      if (typeof value === 'number' && value !== 0 && value !== UNLIMITED_CAP) {
        expect(ministry[key] === UNLIMITED_CAP || (ministry[key] as number) >= value, key).toBe(true);
      }
    }
  });

  it('derives the minimum plan for a Ministry-only feature as Ministry, not a retired name', () => {
    expect(getMinPlanForFeatureCell('givingStatements')).toBe('ministry');
    expect(getMinPlanForFeatureCell('docs')).toBe('church');
    expect(hasFeature('church', 'givingStatements')).toBe(false);
    expect(hasFeature('ministry', 'givingStatements')).toBe(true);
  });

  it('holding the admin-seat add-on still raises Church from 2', () => {
    expect(getEffectiveFeatures('church', { aiAssistant: 0, adminSeats: 3, unlimitedContacts: false, socialScheduler: 0 }).maxAdmins).toBe(5);
  });
});

describe('Harvest fees', () => {
  it('takes 0% of donations on every tier', () => {
    for (const plan of PLAN_ORDER) expect(PLAN_FEES[plan].donationsPct).toBe(0);
    expect(formatDonationFee('church')).toBe('0% on donations');
    expect(formatDonationFee('ministry')).toBe('0% on donations');
  });

  it('takes 5% of product sales on Church and 2% on Ministry, and none are listable on Free', () => {
    expect(PLAN_FEES.church.productSalesPct).toBe(5);
    expect(PLAN_FEES.ministry.productSalesPct).toBe(2);
    expect(PLAN_FEES.free.productSalesPct).toBeNull();
    expect(getPlanFeatures('free').maxProducts).toBe(0);
  });

  it('labels product-sales fees "coming soon" while paid product checkout is not live', () => {
    expect(PAID_PRODUCT_CHECKOUT_ENABLED).toBe(false);
    expect(formatProductSalesFee('church')).toBe('5% on product sales (coming soon)');
    expect(formatProductSalesFee('ministry')).toBe('2% on product sales (coming soon)');
    expect(formatProductSalesFee('free')).toBe('No product sales');
    expect(PROCESSOR_FEE_NOTE).toMatch(/processor/i);
  });

  it('the legacy PLATFORM_FEE_MAP stays 0 everywhere, so its `?? 0` fallback on a tier it does not list is still the truth', () => {
    // stripe-connect.ts is a pinned money path and keeps its original plus / pro / max
    // keys. A Church or Ministry lookup misses and falls back to 0, which is only
    // honest while PLAN_FEES charges no donation fee on any tier.
    expect(Object.values(PLATFORM_FEE_MAP).every((fee) => fee === 0)).toBe(true);
    for (const plan of [...Object.keys(PLAN_FEES), ...Object.keys(LEGACY_PLAN_ALIASES)]) {
      const fee = PLATFORM_FEE_MAP[plan] ?? 0;
      expect(fee, `${plan} would be charged a donation fee`).toBe(0);
    }
    for (const plan of Object.keys(PLAN_FEES)) {
      expect(PLAN_FEES[plan as keyof typeof PLAN_FEES].donationsPct).toBe(0);
    }
  });
});

describe('legacy stored tiers resolve at read time, and nothing is migrated', () => {
  it('maps plus and pro to Church and max to Ministry', () => {
    expect(LEGACY_PLAN_ALIASES).toEqual({ plus: 'church', pro: 'church', max: 'ministry' });
    expect(canonicalPlanId('plus')).toBe('church');
    expect(canonicalPlanId('pro')).toBe('church');
    expect(canonicalPlanId('max')).toBe('ministry');
    expect(toTenantPlan('plus')).toBe('church');
    expect(toTenantPlan('pro')).toBe('church');
    expect(toTenantPlan('max')).toBe('ministry');
  });

  it('keeps the canonical ids and refuses to guess for anything else', () => {
    for (const id of ['free', 'church', 'ministry'] as const) expect(canonicalPlanId(id)).toBe(id);
    for (const junk of ['ultra', '', 'Plus', 'MAX', null, undefined, 3, {}]) expect(canonicalPlanId(junk)).toBeNull();
    // An unknown plan fails CLOSED to the cheapest paid tier, never to Ministry.
    expect(toTenantPlan('ultra')).toBe('church');
    expect(toTenantPlan(undefined)).toBe('church');
    expect(DEFAULT_PLAN_ID).toBe('church');
  });

  it('entitles a stored legacy id exactly as the tier it became', () => {
    expect(getPlanFeatures('plus')).toBe(getPlanFeatures('church'));
    expect(getPlanFeatures('pro')).toBe(getPlanFeatures('church'));
    expect(getPlanFeatures('max')).toBe(getPlanFeatures('ministry'));
    expect(hasFeature('max', 'givingStatements')).toBe(true);
    expect(hasFeature('pro', 'givingStatements')).toBe(false);
    expect(getEffectiveFeatures('max').maxContacts).toBe(5_000);
    expect(getEffectiveFeatures('pro').maxAdmins).toBe(2);
  });

  it('shows and prices a stored legacy id as its new tier', () => {
    expect(getPlanDisplayName('plus')).toBe('Church');
    expect(getPlanDisplayName('pro')).toBe('Church');
    expect(getPlanDisplayName('max')).toBe('Ministry');
    expect(formatPlanPrice('pro', 'monthly')).toBe('$30/mo');
    expect(formatPlanPrice('max', 'yearly')).toBe('$900/yr');
  });

  it('limits a stored legacy id exactly as the tier it became', () => {
    expect(getPlanLimits('plus')).toBe(PLAN_LIMITS.church);
    expect(getPlanLimits('pro')).toBe(PLAN_LIMITS.church);
    expect(getPlanLimits('max')).toBe(PLAN_LIMITS.ministry);
    expect(getPlanLimits('ultra')).toBe(PLAN_LIMITS.church);
    expect(getPlanLimits(undefined)).toBe(PLAN_LIMITS.church);
    expect(getPlanLimits('max').smsSegmentsPerMonth).toBeGreaterThan(0);
    expect(getPlanLimits('plus').smsSegmentsPerMonth).toBe(0);
  });

  it('does not treat a legacy paid id as the unpriced Free tier', () => {
    expect(isUnpricedTier('free')).toBe(true);
    for (const legacy of ['plus', 'pro', 'max', 'church', 'ministry']) expect(isUnpricedTier(legacy)).toBe(false);
  });

  it('reads email allowances a super admin saved under the old ids', () => {
    expect(DEFAULT_EMAIL_LIMITS.monthlySends).toEqual({ free: 0, church: 5000, ministry: 10000 });
    const stored = resolveLimits({ monthlySends: { free: 0, plus: 1234, pro: 9999, max: 4321 } });
    expect(stored.monthlySends.church).toBe(1234);
    expect(stored.monthlySends.ministry).toBe(4321);
    // The new id wins over a legacy one when both are present.
    expect(resolveLimits({ monthlySends: { church: 7, plus: 1234, ministry: 8, max: 4321 } }).monthlySends).toMatchObject({ church: 7, ministry: 8 });
  });

  it('the plan-id module imports only types, so it can sit at every read boundary', () => {
    const source = read('src/utils/plan-id.ts');
    const imports = source.split('\n').filter((l) => /^import /.test(l));
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line).toMatch(/^import type /);
  });

  it('writes nothing: no migration script or Firestore write was added for the legacy ids', () => {
    const code = stripComments(read('src/utils/plan-id.ts'));
    expect(code.length).toBeGreaterThan(200);
    expect(code).not.toMatch(/firebase|firestore|\.update\(|\.set\(/i);
  });
});

describe('"Accounting" is now "Giving records", under Giving, and the route still works', () => {
  it('labels the nav entry Giving records inside the Giving group', () => {
    const nav = read('src/components/admin-shell/shell-nav.ts');
    const giving = nav.slice(nav.indexOf("id: 'giving'"), nav.indexOf("id: 'platform'"));
    expect(giving).toContain("{ id: 'accounting', label: 'Giving records'");
    expect(giving).not.toContain("label: 'Accounting'");
  });

  it('keeps the accounting tab id, so /admin/accounting and every stored permission still resolve', () => {
    expect(read('src/components/AdminDashboard.tsx')).toContain("activeTab === 'accounting'");
    expect(read('src/lib/admin-sections.ts')).toContain("['accounting', 'accounting']");
    expect(read('src/app/api/composio/quickbooks/callback/route.ts')).toContain('/admin/accounting');
    expect(read('src/components/AdminRoles.tsx')).toContain('manageAccounting');
  });

  it('titles the screen Giving records and never claims to be accounting software', () => {
    const screen = read('src/components/AdminAccounting.tsx');
    expect(screen).toContain('title="Giving records"');
    expect(screen).not.toContain('title="Accounting"');
    expect(read('src/components/AdminDashboard.tsx')).toContain('featureName="Giving records"');
  });
});
