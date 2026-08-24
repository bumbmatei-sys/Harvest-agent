import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PlanUpgradeSection from '../PlanUpgradeSection';
import { PRICED_PLAN_ORDER, PLAN_DISPLAY_NAMES, BILLING_TERMS } from '../../../utils/plan-features';

/**
 * THE-212 — what Billing offers a Forever Free tenant, and where its Upgrade
 * button goes.
 *
 * ─── The two defects, at the surface a founder actually pressed ──────────────
 *
 * 🔴 UPGRADE WENT TO STRIPE. A free tenant carries no billing identifier, so
 * `/api/billing/invoices` reported it as `processor: 'stripe'` — its default
 * when it finds no Stripe customer — and this component took the
 * `proc !== 'dodo'` arm straight into `/api/stripe/checkout`, which resolves a
 * Stripe PRICE ID. That is where the founder's "no price ID" came from.
 *
 * 🔴 MANAGE HAD NOTHING TO MANAGE. The footer's "Manage Subscription" opens the
 * hosted portal, where a subscription is cancelled and a card replaced. A free
 * tenant has neither, with any processor, so the button's only outcome was the
 * portal route's "No Stripe subscription found. Please subscribe first." — on
 * the one screen where this tenant is meant to be able to start paying.
 *
 * ⚠️ TARGETS ARE NAMED BY LABEL, never matched by a value pattern: the plan
 * buttons are found through `PLAN_DISPLAY_NAMES`, the actions through their
 * `data-testid`, and the terms through `BILLING_TERMS`. Nothing here reads a
 * price, so a reprice cannot break these tests and cannot hide a break either.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mockAuthFetch, mockGetTenantId } = vi.hoisted(() => ({
  mockAuthFetch: vi.fn(),
  mockGetTenantId: vi.fn(),
}));

vi.mock('../../../firebase', () => ({ auth: { currentUser: null }, db: {} }));
vi.mock('../../../utils/auth-fetch', () => ({ authFetch: mockAuthFetch }));
vi.mock('../useTenantId', () => ({ getTenantId: mockGetTenantId }));

let container: HTMLDivElement;
let root: Root;

/** Every URL `authFetch` was called with, in order. */
const calledUrls = () => mockAuthFetch.mock.calls.map((c) => String(c[0]));

/** The parsed JSON body of the call to `url`, or undefined if it never ran. */
function bodyPostedTo(url: string): Record<string, unknown> | undefined {
  const call = mockAuthFetch.mock.calls.find((c) => String(c[0]) === url);
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : undefined;
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 409, json: async () => body } as unknown as Response;
}

function mount(props: Parameters<typeof PlanUpgradeSection>[0]) {
  act(() => {
    root = createRoot(container);
    root.render(<PlanUpgradeSection {...props} />);
  });
}

/** The card button whose label names this tier — "Upgrade to Small Team". */
function planButton(plan: (typeof PRICED_PLAN_ORDER)[number]): HTMLButtonElement {
  const label = PLAN_DISPLAY_NAMES[plan];
  const button = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent || '').includes(label) && !(b.textContent || '').includes('Current Plan'),
  );
  if (!button) throw new Error(`No plan button found for "${label}"`);
  return button as HTMLButtonElement;
}

/** The term toggle segment whose label names this term. */
function selectTerm(term: (typeof BILLING_TERMS)[number]) {
  const button = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent || '').toLowerCase().startsWith(term.slice(0, 5)),
  );
  if (!button) throw new Error(`No term toggle found for "${term}"`);
  act(() => { button.click(); });
}

async function clickAndSettle(el: HTMLElement) {
  await act(async () => {
    el.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  mockGetTenantId.mockResolvedValue('t1');
  mockAuthFetch.mockResolvedValue(jsonResponse({ url: 'https://dodo/checkout/1' }));
  // jsdom/happy-dom give no real navigation; make the redirect observable.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: '' },
  });
  // The plan cards live in a scroll track; scrollIntoView is not implemented.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container.remove();
});

// ── 4 ────────────────────────────────────────────────────────────────────────
describe('a free tenant sees an upgrade action in Billing, not a manage action', () => {
  it('renders the upgrade action and no manage action', () => {
    mount({ currentPlan: 'free', tenantId: 't1', processor: 'stripe' });

    expect(container.querySelector('[data-testid="billing-upgrade-action"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="billing-manage-action"]')).toBeNull();
  });

  it('offers no subscription-management wording at all', () => {
    mount({ currentPlan: 'free', tenantId: 't1', processor: 'stripe' });

    expect(container.textContent).not.toContain('Manage Subscription');
    // `processor` is 'stripe' for a tenant with no billing records at all, so
    // the attribution line would name a processor this church has never paid.
    expect(container.textContent).not.toContain('Powered by Stripe');
  });

  it('still renders every priced tier, so the upgrade is reachable', () => {
    mount({ currentPlan: 'free', tenantId: 't1', processor: 'stripe' });

    for (const plan of PRICED_PLAN_ORDER) {
      expect(planButton(plan), PLAN_DISPLAY_NAMES[plan]).not.toBeNull();
    }
  });

  it('a paid tenant is unchanged: the manage action is still there', () => {
    mount({ currentPlan: 'max', tenantId: 't1', processor: 'dodo' });

    expect(container.querySelector('[data-testid="billing-manage-action"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="billing-upgrade-action"]')).toBeNull();
    expect(container.textContent).toContain('Powered by Dodo Payments');
  });
});

// ── 1 (surface half) ─────────────────────────────────────────────────────────
describe('the free tenant’s Upgrade button starts a Dodo first subscription', () => {
  it.each(PRICED_PLAN_ORDER.flatMap((plan) => BILLING_TERMS.map((term) => ({ plan, term }))))(
    'posts plan $plan and term $term to the first-subscription route',
    async ({ plan, term }) => {
      mount({ currentPlan: 'free', tenantId: 't1', processor: 'stripe' });
      selectTerm(term);
      await clickAndSettle(planButton(plan));

      expect(calledUrls()).toEqual(['/api/dodo/first-subscription']);
      expect(bodyPostedTo('/api/dodo/first-subscription')).toMatchObject({
        plan,
        billing: term,
      });
    },
  );

  it('never touches the Stripe checkout or the Stripe portal', async () => {
    mount({ currentPlan: 'free', tenantId: 't1', processor: 'stripe' });
    await clickAndSettle(planButton('plus'));

    expect(calledUrls()).not.toContain('/api/stripe/checkout');
    expect(calledUrls()).not.toContain('/api/stripe/portal');
    // …and it does not even ask which processor owns a subscription that does
    // not exist. That question is what returned the wrong answer.
    expect(calledUrls()).not.toContain('/api/billing/invoices');
  });

  it('redirects to the Dodo checkout the route returns', async () => {
    mount({ currentPlan: 'free', tenantId: 't1', processor: 'stripe' });
    await clickAndSettle(planButton('pro'));

    expect(window.location.href).toBe('https://dodo/checkout/1');
  });

  it('applies no tier locally — the webhook is the only writer of plan', async () => {
    mount({ currentPlan: 'free', tenantId: 't1', processor: 'stripe' });
    await clickAndSettle(planButton('max'));

    // One call, and it is the checkout. No write of any kind, and no re-render
    // into the tier that was merely REQUESTED: the card still reads Free.
    expect(mockAuthFetch).toHaveBeenCalledTimes(1);
    expect(mockAuthFetch.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(container.textContent).not.toContain('Current Plan');
  });
});

// ── 5 (surface half) ─────────────────────────────────────────────────────────
describe('a paid Dodo tenant’s manage action reaches Dodo’s portal, not Stripe', () => {
  it('posts to the one routing portal endpoint, which sends Dodo tenants to Dodo', async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse({ url: 'https://dodo/portal/1' }));
    mount({ currentPlan: 'max', tenantId: 't1', processor: 'dodo' });

    const manage = container.querySelector('[data-testid="billing-manage-action"]') as HTMLElement;
    await clickAndSettle(manage);

    // The path is spelled `/api/stripe/portal` for stale-tab reasons; the ROUTE
    // is what routes a Dodo tenant to Dodo. Its behaviour is pinned in
    // `the-212-free-tenant-upgrade.test.ts`; here we pin that the button
    // reaches it rather than opening Stripe directly.
    expect(calledUrls()).toEqual(['/api/stripe/portal']);
    expect(window.location.href).toBe('https://dodo/portal/1');
  });

  it('a paid tenant’s plan change still goes to the Dodo plan-change route', async () => {
    // The term read answers first, then the preview — the real two-step the
    // client performs since THE-226. Answering only the preview would leave the
    // flow refusing before it ever routed, and this test would stop proving the
    // thing it is named for.
    mockAuthFetch.mockImplementation(async (url: string) =>
      String(url).startsWith('/api/dodo/change-plan?')
        ? jsonResponse({ plan: 'plus', billing: 'monthly' })
        : jsonResponse({ preview: { amountDueNow: 0, currency: 'USD' } }),
    );
    // happy-dom has no window.confirm; the owner declining the proration is
    // what keeps this test to the PREVIEW call, which is the routing assertion.
    window.confirm = vi.fn(() => false);
    mount({ currentPlan: 'plus', tenantId: 't1', processor: 'dodo' });

    await clickAndSettle(planButton('max'));

    // ⚠️ Matched on the PATH, not the whole URL (THE-226). The client now reads
    // the tenant's real billing term from `GET /api/dodo/change-plan?tenantId=…`
    // before it previews, because the plan surfaces were handing it this page's
    // price toggle and the route correctly refused that as a term switch. The
    // routing claim this test makes is unchanged — every call goes to the Dodo
    // plan-change route, and none to first-subscription.
    const paths = calledUrls().map((url: string) => url.split('?')[0]);
    expect([...new Set(paths)]).toEqual(['/api/dodo/change-plan']);
    expect(paths).not.toContain('/api/dodo/first-subscription');
    // The term read AND the preview both happened — the owner declining the
    // proration is what stops it there, so no confirm was ever sent.
    expect(paths).toHaveLength(2);
    const bodies = mockAuthFetch.mock.calls
      .map((c: any[]) => (c[1]?.body ? JSON.parse(c[1].body) : undefined))
      .filter(Boolean);
    expect(bodies.every((b: any) => b.confirm === undefined)).toBe(true);
  });
});
