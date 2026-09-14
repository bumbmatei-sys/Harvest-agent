import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import PlanUpgradeSection from '../settings/PlanUpgradeSection';
import AdminUpgradePage from '../AdminUpgradePage';
import { subscriptionProcessorAttribution } from '../../utils/plan-change';

/**
 * THE-135: the "Powered by …" line under the subscription-management actions is
 * derived from the processor that owns the subscription, never hardcoded.
 *
 * Subscriptions moved to Dodo; donations did not. The defect was two hardcoded
 * "Powered by Stripe" copies (PlanUpgradeSection, AdminUpgradePage) telling
 * every Dodo tenant its subscription runs on a processor it has never paid.
 * The donation surfaces (PaymentSection, PublicCampaign) run on Stripe Connect
 * and their Stripe lines are TRUE — this file also pins that they were not
 * caught in a find-and-replace.
 *
 * While the processor is unknown (before /api/billing/invoices resolves, or
 * when it can't be read) NO attribution renders: an async default is a silent
 * claim.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const authFetch = vi.hoisted(() => vi.fn());
vi.mock('../../utils/auth-fetch', () => ({ authFetch }));
vi.mock('../settings/useTenantId', () => ({ getTenantId: async () => 'grace' }));

let container: HTMLDivElement;
let root: Root | null = null;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

const mount = async (el: React.ReactElement) => {
  act(() => {
    root = createRoot(container);
    root.render(el);
  });
  await flush();
};

/** authFetch resolving /api/billing/invoices with the given processor. */
function billingRespondsWith(processor: string | null) {
  authFetch.mockResolvedValue({ ok: true, json: async () => ({ processor, invoices: [] }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/');
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container.remove();
});

describe('the attribution string has one source', () => {
  it('names Stripe for a Stripe tenant, Dodo Payments for a Dodo tenant, and nothing when unknown', () => {
    expect(subscriptionProcessorAttribution('stripe')).toBe('Powered by Stripe');
    expect(subscriptionProcessorAttribution('dodo')).toBe('Powered by Dodo Payments');
    expect(subscriptionProcessorAttribution(null)).toBeNull();
    expect(subscriptionProcessorAttribution(undefined)).toBeNull();
  });
});

describe('a Dodo tenant is never told its subscription is powered by Stripe', () => {
  it('PlanUpgradeSection (under "Manage Subscription") attributes the processor it was given', async () => {
    await mount(<PlanUpgradeSection currentPlan="plus" tenantId="grace" processor="dodo" />);
    expect(container.textContent).toContain('Powered by Dodo Payments');
    expect(container.textContent).not.toContain('Powered by Stripe');
  });

  it('AdminUpgradePage resolves the processor at mount and attributes it', async () => {
    billingRespondsWith('dodo');
    await mount(<AdminUpgradePage currentPlan="plus" tenantId="grace" email="p@grace.org" onBack={() => {}} />);
    expect(authFetch).toHaveBeenCalledWith('/api/billing/invoices');
    expect(container.textContent).toContain('Powered by Dodo Payments');
    expect(container.textContent).not.toContain('Powered by Stripe');
  });

  it('a Stripe tenant still reads Powered by Stripe on both surfaces', async () => {
    await mount(<PlanUpgradeSection currentPlan="plus" tenantId="grace" processor="stripe" />);
    expect(container.textContent).toContain('Powered by Stripe');
    act(() => { root?.unmount(); });
    root = null;

    billingRespondsWith('stripe');
    await mount(<AdminUpgradePage currentPlan="plus" tenantId="grace" email="p@grace.org" onBack={() => {}} />);
    expect(container.textContent).toContain('Powered by Stripe');
  });
});

describe('no attribution renders while the processor is unknown', () => {
  it('PlanUpgradeSection with the fetch not yet resolved (undefined) claims nothing', async () => {
    await mount(<PlanUpgradeSection currentPlan="plus" tenantId="grace" processor={undefined} />);
    expect(container.textContent).not.toMatch(/powered by/i);
  });

  it('PlanUpgradeSection with an undeterminable processor (null) claims nothing', async () => {
    await mount(<PlanUpgradeSection currentPlan="plus" tenantId="grace" processor={null} />);
    expect(container.textContent).not.toMatch(/powered by/i);
  });

  it('AdminUpgradePage claims nothing while its mount fetch is in flight', async () => {
    authFetch.mockReturnValue(new Promise(() => {})); // never resolves
    await mount(<AdminUpgradePage currentPlan="plus" tenantId="grace" email="p@grace.org" onBack={() => {}} />);
    expect(container.textContent).not.toMatch(/powered by/i);
  });

  it('AdminUpgradePage claims nothing when the processor cannot be determined', async () => {
    authFetch.mockResolvedValue({ ok: false, json: async () => ({}) });
    await mount(<AdminUpgradePage currentPlan="plus" tenantId="grace" email="p@grace.org" onBack={() => {}} />);
    expect(container.textContent).not.toMatch(/powered by/i);
  });
});

describe('the donation surfaces still say Stripe', () => {
  // Source-level pins, same technique as dodo-billing-flag.test.ts: donations
  // run on Stripe Connect and did not move. A find-and-replace across "Stripe"
  // — the tempting wrong fix for the subscription attribution — must fail
  // here, because it would turn a true statement about the donation path into
  // a false one.
  const src = (rel: string) => readFileSync(join(__dirname, '../..', rel), 'utf8');

  it('PaymentSection still tells the church its donation payouts run on Stripe Connect', () => {
    const paymentSection = src('components/settings/PaymentSection.tsx');
    expect(paymentSection).toContain('Powered by Stripe Connect');
    expect(paymentSection).not.toContain('subscriptionProcessorAttribution');
    expect(paymentSection).not.toMatch(/dodo/i);
  });

  it('PublicCampaign still reassures donors the payment is secure and encrypted', () => {
    const publicCampaign = src('components/PublicCampaign.tsx');
    expect(publicCampaign).toContain('Secure, encrypted payment.');
    expect(publicCampaign).not.toContain('subscriptionProcessorAttribution');
    expect(publicCampaign).not.toMatch(/dodo/i);
  });
});
