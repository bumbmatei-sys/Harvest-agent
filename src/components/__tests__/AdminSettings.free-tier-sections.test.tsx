import React, { act } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

/**
 * THE-225 — what a FREE tenant's admin Settings screen offers.
 *
 * Reported three times by the founder, and never previously worked on (THE-221
 * covered it and has not run): free Settings still showed "Payments (Connect
 * Stripe)" and an Integrations section holding Gmail. Free must show exactly
 * three things: Appearance, Onboarding Questions, Customize Navigation.
 *
 * The two removals are gated on different things, deliberately:
 *
 *  • STRIPE CONNECT on `fundraising`, the cell the section exists to serve.
 *    Free has no donate page (`fundraising: false`; THE-202/THE-213 refuse the
 *    route server-side), so this section configured a payout destination for
 *    money that cannot arrive — and asked a church for its bank details to do
 *    it. Straightforward, and no tier that gives loses anything.
 *
 *  • GMAIL is NOT gated on a feature cell at all, because the cell it would
 *    have to be is `crm`, and free's CRM is half of what the free tier IS
 *    (see the matrix). THE-193 deliberately moved Gmail onto `crm`, and that
 *    was right. So the second half of the gate is a property of the PROVIDER —
 *    `outboundSend` in settings/integration-providers.ts — refused to a tier
 *    that is not sold (`isUnpricedTier`, derived from PLAN_PRICING). That is
 *    the same reasoning the matrix already writes on free's `smsAutomation`
 *    and `textToGive`: no working send surface on a tier that pays nothing and
 *    holds no card. NO PLAN FLAG CHANGED, and the last block here pins that.
 *
 * 🔴 AND NO DEAD END. THE-193 existed because a CRM "Connect your email" button
 * routed to a Settings page with no Integrations section. Hiding Gmail would
 * re-open exactly that, so the CRM control goes with it — asserted from
 * rendered output in AdminCRM.gmail-dead-end.test.tsx, and from the shared
 * predicate here.
 *
 * Sections are read from RENDERED OUTPUT by their visible labels, never from
 * the `sections` array, so a change that keeps the constant and breaks the
 * render fails here.
 */

const scope = vi.hoisted(() => ({ platformOverride: false }));

vi.mock('../../firebase', () => ({
  auth: { currentUser: { uid: 'u1', email: 'admin@church.org' } },
  db: {},
  messaging: Promise.resolve(null),
  VAPID_KEY: 'test-vapid-key',
}));
vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  getDoc: async () => ({ exists: () => true, data: () => ({ tenantId: 'tenant-1' }) }),
  updateDoc: vi.fn(),
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  getDocs: async () => ({ forEach: () => {} }),
  onSnapshot: () => () => {},
}));
vi.mock('../../utils/auth-fetch', () => ({
  authFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
}));
vi.mock('../../utils/tenant-scope', () => ({
  hasPlatformOverride: () => scope.platformOverride,
  isSuperAdmin: () => false,
  SUPER_ADMIN_EMAIL: 'founder@theharvest.site',
  getTenantScope: async () => 'tenant-1',
}));
vi.mock('next/image', () => ({ default: () => null }));

import AdminSettings from '../AdminSettings';
import { getPlanFeatures, PLAN_DISPLAY_NAMES, PLAN_PRICING } from '../../utils/plan-features';
import {
  INTEGRATION_PROVIDERS,
  getIntegrationProvider,
  hasAnyIntegrationProvider,
  isProviderAvailable,
} from '../settings/integration-providers';
import type { TenantPlan } from '../../types/tenant.types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(plan: string): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <AdminSettings
        onBack={() => {}}
        currentPlan={plan as TenantPlan}
        onChangePlan={() => {}}
        onCancelPlan={() => {}}
        tenantId="tenant-1"
        email="admin@church.org"
        isPlanOwner
        onCustomizeNav={() => {}}
      />,
    );
  });
  await act(async () => { await Promise.resolve(); });
  return host;
}

/**
 * Every SECTION an admin can act on, in document order, by its visible label.
 *
 * The accordion rows carry `data-settings-row`; "Customize Navigation" is a
 * plain button below the accordion and is the third of the three the founder
 * named, so it is included by label. The Account plan card is deliberately NOT
 * a section — it is a status card with no control on an unpriced tier — and is
 * asserted separately below.
 */
function sections(host: HTMLElement): string[] {
  const rows = Array.from(host.querySelectorAll('[data-settings-row]')).map(
    (row) => (row.querySelector('button > span:nth-child(2)')?.textContent || '').trim(),
  );
  const customize = Array.from(host.querySelectorAll('p')).some(
    (p) => (p.textContent || '').trim() === 'Customize Navigation',
  );
  return customize ? [...rows, 'Customize Navigation'] : rows;
}

/** The region headings the accordion drew, in order. */
function regions(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('[data-settings-region]'))
    .map((r) => r.getAttribute('data-settings-region') || '')
    .filter((label) => label !== 'ungrouped');
}

/** Open a section by label; accordion content only exists while expanded. */
async function expand(host: HTMLElement, label: string): Promise<void> {
  const header = Array.from(host.querySelectorAll('button')).find(
    (b) => (b.textContent || '').trim().startsWith(label),
  );
  expect(header, `no accordion row labelled "${label}"`).toBeTruthy();
  await act(async () => { header!.click(); });
}

const FREE: TenantPlan = 'free';
const PRICED: TenantPlan[] = ['plus', 'pro', 'max'];

beforeEach(() => {
  scope.platformOverride = false;
  document.body.innerHTML = '';
});

// ─── 1. 🔴 the founder's list ────────────────────────────────────────────────
describe('a free tenant\'s Settings', () => {
  it('🔴 shows exactly Appearance, Onboarding Questions and Customize Navigation', async () => {
    const host = await mount(FREE);

    expect(sections(host)).toEqual([
      'Appearance',
      'Onboarding Questions',
      'Customize Navigation',
    ]);
  });

  it('shows no Stripe Connect section', async () => {
    const host = await mount(FREE);

    expect(sections(host), 'free was offered Stripe Connect').not.toContain('Payments (Connect Stripe)');
    // Named the way the founder does, in case the label is ever reworded.
    expect(host.textContent, 'a Stripe Connect control survived on free').not.toMatch(/Connect Stripe/);
  });

  it('shows no Integrations section, and therefore no Gmail card', async () => {
    const host = await mount(FREE);

    expect(sections(host), 'free was offered Integrations').not.toContain('Integrations');
    for (const provider of INTEGRATION_PROVIDERS) {
      expect(host.textContent, `free was offered ${provider.label}`).not.toContain(provider.label);
    }
  });

  it('draws no region heading over a section it no longer has', async () => {
    // The Settings accordion has drawn headings only above visible rows since
    // THE-183, so removing the Payments row must take the "Payments" heading
    // with it — the Settings-side of the empty-group rule.
    const host = await mount(FREE);

    expect(regions(host)).toEqual(['Appearance', 'Church Setup']);
    expect(host.textContent).not.toContain('Connected Services');
  });

  it('keeps the Appearance controls and the plan card working', async () => {
    // The removals must not take the two things free DOES have with them.
    const host = await mount(FREE);
    await expand(host, 'Appearance');

    expect(host.querySelector('[role="radiogroup"][aria-label="Colour theme"]')).toBeTruthy();
    expect(host.querySelector('[role="radiogroup"][aria-label="Palette family"]')).toBeTruthy();
    // Unpriced tiers already had no Manage/Cancel (THE-212); still true.
    expect(host.querySelector('[data-testid="settings-manage-action"]')).toBeNull();
    expect(sections(host)).not.toContain('Cancel Subscription');
  });

  it('still shows every section to a platform super admin', async () => {
    // `platformOverride` is applied at both new gates, in the shape it has
    // everywhere else in this screen.
    scope.platformOverride = true;
    const host = await mount(FREE);

    expect(sections(host)).toContain('Payments (Connect Stripe)');
    expect(sections(host)).toContain('Integrations');
  });
});

// ─── 2. 🔴 the three priced tiers are unchanged ──────────────────────────────
describe("the three priced tiers' Settings sections are unchanged", () => {
  // Pinned per tier, in render order. Giving Statements is Ministry-only,
  // SMS (Twilio) is every paid tier, and the AI Assistant row is behind
  // AI_TELEGRAM_ASSISTANT_ENABLED (false) on every tier including this list.
  const EXPECTED: Record<string, string[]> = {
    plus: [
      'Appearance',
      'Payments (Connect Stripe)',
      'Onboarding Questions',
      'SMS (Twilio)',
      'Integrations',
      'Cancel Subscription',
      'Customize Navigation',
    ],
    pro: [
      'Appearance',
      'Payments (Connect Stripe)',
      'Onboarding Questions',
      'SMS (Twilio)',
      'Integrations',
      'Cancel Subscription',
      'Customize Navigation',
    ],
    max: [
      'Appearance',
      'Payments (Connect Stripe)',
      'Onboarding Questions',
      'Giving Statements',
      'SMS (Twilio)',
      'Integrations',
      'Cancel Subscription',
      'Customize Navigation',
    ],
  };

  for (const plan of PRICED) {
    it(`${PLAN_DISPLAY_NAMES[plan]} sees exactly the sections it saw before`, async () => {
      const host = await mount(plan);
      expect(sections(host)).toEqual(EXPECTED[plan]);
    });

    it(`${PLAN_DISPLAY_NAMES[plan]} can still reach Stripe Connect`, async () => {
      const host = await mount(plan);
      expect(sections(host), `${plan} lost Stripe Connect`).toContain('Payments (Connect Stripe)');
      expect(getPlanFeatures(plan).fundraising, `${plan} lost fundraising`).toBe(true);
    });

    it(`${PLAN_DISPLAY_NAMES[plan]} can still reach Gmail from Settings`, async () => {
      const host = await mount(plan);
      await expand(host, 'Integrations');
      const cards = Array.from(host.querySelectorAll('p')).map((p) => (p.textContent || '').trim());
      expect(cards, `${plan} lost the Gmail card`).toContain('Gmail');
    });
  }
});

// ─── 3. the dead-end guard, at the predicate ─────────────────────────────────
describe('no CRM control points at a hidden integration', () => {
  it('every tier that renders the Gmail card is a tier the CRM offers email on, and vice versa', () => {
    // One predicate, two screens. The CRM asks `isProviderAvailable(gmail, …)`
    // exactly as Settings does (see AdminCRM's `canConnectGmail`), so the two
    // answers cannot disagree by construction — this pins that they don't, per
    // tier, and the rendered proof is in AdminCRM.gmail-dead-end.test.tsx.
    const gmail = getIntegrationProvider('gmail');
    for (const plan of ['free', ...PRICED] as TenantPlan[]) {
      const features = getPlanFeatures(plan);
      const gmailReachable = isProviderAvailable(gmail, features, plan);
      expect(
        hasAnyIntegrationProvider(features, plan) || !gmailReachable,
        `${PLAN_DISPLAY_NAMES[plan]} can reach Gmail but has no Integrations section`,
      ).toBe(true);
    }
  });

  it('free reaches no provider at all, so the section it would point at is gone', () => {
    const features = getPlanFeatures(FREE);
    for (const provider of INTEGRATION_PROVIDERS) {
      expect(isProviderAvailable(provider, features, FREE), `free still reaches ${provider.label}`).toBe(false);
    }
    expect(hasAnyIntegrationProvider(features, FREE)).toBe(false);
  });

  it('withholds the SEND, not the CRM — free keeps its roster', () => {
    // The distinction the whole gate turns on. If this ever reads false, the
    // gate has been moved onto the `crm` cell and free has lost the half of the
    // product it exists for.
    expect(getPlanFeatures(FREE).crm, 'free lost the CRM to the Gmail gate').toBe(true);
  });

  it('an unrecognised legacy tier keeps Gmail — the gate asks for KNOWN and unpriced', () => {
    // `isUnpricedTier` refuses to read a retired tier name as "free" (see its
    // note in plan-features). A legacy record keeps whatever it has today.
    const gmail = getIntegrationProvider('gmail');
    const legacy = getPlanFeatures('ultra' as TenantPlan); // unknown → 'plus'
    expect(isProviderAvailable(gmail, legacy, 'ultra')).toBe(true);
  });
});

// ─── 4. no feature flag, price or contract changed ───────────────────────────
describe('no feature flag or price moved', () => {
  it('the cells these gates read are exactly what they were', () => {
    // `fundraising` gates Stripe Connect and `crm` entitles Gmail. Both are
    // READ by this ticket and neither is written by it.
    expect(getPlanFeatures('free').fundraising).toBe(false);
    expect(getPlanFeatures('plus').fundraising).toBe(true);
    expect(getPlanFeatures('pro').fundraising).toBe(true);
    expect(getPlanFeatures('max').fundraising).toBe(true);

    expect(getPlanFeatures('free').crm).toBe(true);
    expect(getPlanFeatures('plus').crm).toBe(true);
    expect(getPlanFeatures('pro').crm).toBe(true);
    expect(getPlanFeatures('max').crm).toBe(true);

    // The sidebar half reads these three, and writes none of them.
    expect(getPlanFeatures('free').aiChat).toBe(false);
    expect(getPlanFeatures('free').newsFeed).toBe(false);
    expect(getPlanFeatures('free').communityGroups).toBe(false);
    expect(getPlanFeatures('max').communityGroups).toBe(true);

    // 🔴 REPORTED, NOT FIXED — THE-224 owns this. `aiAssistant` is 0 on every
    // tier, Ministry included, while the member-facing assistant is gated by
    // `aiChat`. Pinned here so the count cannot quietly move under this ticket.
    expect(getPlanFeatures('free').aiAssistant).toBe(0);
    expect(getPlanFeatures('plus').aiAssistant).toBe(0);
    expect(getPlanFeatures('pro').aiAssistant).toBe(0);
    expect(getPlanFeatures('max').aiAssistant).toBe(1);
    expect(getPlanFeatures('pro').aiChat).toBe(true);
    expect(getPlanFeatures('max').aiChat).toBe(true);
  });

  it('the nine prices are untouched', () => {
    expect(PLAN_PRICING).toEqual({
      plus: { monthly: 20, quarterly: 49, yearly: 165 },
      pro: { monthly: 40, quarterly: 99, yearly: 329 },
      max: { monthly: 80, quarterly: 199, yearly: 659 },
    });
    expect(Object.keys(PLAN_PRICING), 'free gained a price').not.toContain('free');
  });
});
