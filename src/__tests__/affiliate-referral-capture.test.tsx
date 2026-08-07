import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ReferralTracker from '../components/ReferralTracker';
import AdminUpgradePage from '../components/AdminUpgradePage';
import { AFFILIATE_PROGRAM_ENABLED } from '../utils/plan-features';

/**
 * `?ref=` attribution survives AFFILIATE_PROGRAM_ENABLED === false.
 *
 * Hiding the programme hides the surfaces that let someone BECOME an affiliate
 * or see their dashboard. It does NOT switch off capture: a referral link
 * shared before the flag flipped must still attribute if that person signs up
 * afterwards. The 12-month commission window (#253) reads
 * `subscription.start_date`, so an unattributed signup is not a delayed
 * commission — it is a permanently lost one, and the affiliate has no way to
 * know it happened.
 *
 * The client half of the chain, end to end:
 *   ReferralTracker (root layout) writes localStorage['affiliateReferrerId']
 *     → a checkout caller reads it back and puts `referrerId` in the POST body
 * The server half — /api/stripe/checkout stamping that `referrerId` into
 * `subscription_data.metadata` — is pinned in
 * src/app/api/stripe/checkout/__tests__/referral-attribution.test.ts.
 *
 * AdminUpgradePage stands in for the four callers that read the same key with
 * the same four lines (AdminUpgradePage, PlanUpgradeSection, ChurchOnboarding,
 * OnboardingGate); it is the one with the fewest dependencies to mount.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const authFetch = vi.hoisted(() => vi.fn());
vi.mock('../utils/auth-fetch', () => ({ authFetch }));
vi.mock('../components/settings/useTenantId', () => ({ getTenantId: async () => 'grace' }));

let container: HTMLDivElement;
let root: Root | null = null;

const flush = async () => {
  await act(async () => {
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  authFetch.mockResolvedValue({ json: async () => ({ url: 'https://checkout.stripe/x' }) });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container.remove();
});

/** The body AdminUpgradePage actually POSTed to /api/stripe/checkout. */
const checkoutBody = () => JSON.parse(authFetch.mock.calls[0][1].body);

describe('referral capture is NOT gated on the affiliate programme flag', () => {
  it('the programme really is hidden — otherwise the rest of this file proves nothing', () => {
    expect(AFFILIATE_PROGRAM_ENABLED).toBe(false);
  });

  it('ReferralTracker still captures ?ref= into localStorage with the programme hidden', () => {
    window.history.replaceState({}, '', '/pricing?ref=aff-code-9');

    act(() => {
      root = createRoot(container);
      root.render(<ReferralTracker />);
    });

    const stored = localStorage.getItem('affiliateReferrerId');
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!).id).toBe('aff-code-9');
  });

  it('a capture made BEFORE the flag flipped still reaches checkout as referrerId', async () => {
    // Written by a visit from a referral link that predates this PR.
    localStorage.setItem('affiliateReferrerId', JSON.stringify({ id: 'aff-code-9', ts: Date.now() }));

    act(() => {
      root = createRoot(container);
      root.render(<AdminUpgradePage currentPlan="plus" tenantId="grace" email="p@grace.org" onBack={() => {}} />);
    });

    const upgrade = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Upgrade to Ministry'
    );
    expect(upgrade, 'no upgrade button rendered').toBeTruthy();
    await act(async () => { upgrade!.click(); });
    await flush();

    expect(authFetch).toHaveBeenCalledWith('/api/stripe/checkout', expect.anything());
    expect(checkoutBody().referrerId).toBe('aff-code-9');
  });

  it('omits referrerId entirely when there was no capture (unchanged, no empty attribution)', async () => {
    act(() => {
      root = createRoot(container);
      root.render(<AdminUpgradePage currentPlan="plus" tenantId="grace" email="p@grace.org" onBack={() => {}} />);
    });

    const upgrade = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Upgrade to Ministry'
    );
    await act(async () => { upgrade!.click(); });
    await flush();

    expect(checkoutBody()).not.toHaveProperty('referrerId');
  });
});
