import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import CampaignWidget from '../CampaignWidget';
import { STRIPE_CONNECT_ENABLED, STRIPE_CONNECT_HIDDEN_MESSAGE } from '@/lib/stripe-connect-feature';

/**
 * Give Now on the member campaign card. A legacy donateUrl still wins. One
 * chosen link opens that link. Several, or none, open the sheet. The card
 * form is absent while card giving is off, so the sheet cannot post to the
 * donate route.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { tenant, snapshotRows, flagState } = vi.hoisted(() => ({
  tenant: {
    current: {
      branding: {} as unknown,
      tenantId: 't1' as string | null,
      stripeConnectStatus: 'active' as string | undefined,
    },
  },
  snapshotRows: { current: [] as unknown[] },
  flagState: { enabled: false },
}));

vi.mock('@/lib/stripe-connect-feature', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stripe-connect-feature')>();
  return {
    ...actual,
    get STRIPE_CONNECT_ENABLED() { return flagState.enabled; },
  };
});
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => tenant.current }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: null } }));
vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => 't1',
  hasPlatformOverride: () => false,
  PLATFORM_TENANT_ID: 'harvest',
}));
vi.mock('../../utils/share-url', () => ({ usePublicShareUrl: () => 'https://test.example/campaign/c1' }));
vi.mock('../ShareButton', () => ({ default: () => null }));
vi.mock('../member/desktopKit', () => ({
  HeroBand: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Eyebrow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('next/image', () => ({
  default: ({ alt }: { alt?: string }) => <span data-cover-alt={alt ?? ''} />,
}));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  limit: () => ({}),
  onSnapshot: (_q: unknown, next: (snap: unknown) => void) => {
    next({ empty: snapshotRows.current.length === 0, docs: snapshotRows.current });
    return () => {};
  },
}));

const LINKS = {
  paypal: { url: 'https://paypal.me/testchurch', handle: 'testchurch' },
  revolut: { url: 'https://revolut.me/testchurch', handle: 'testchurch' },
  wise: { url: 'https://wise.com/pay/business/testchurch', handle: 'testchurch' },
  zelle: { email: 'test@example.test', handle: 'testchurch' },
};

function campaignDoc(extra: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    data: () => ({
      title: 'Roof Fund',
      description: 'Help us fix the roof',
      goal: 50000,
      raised: 18000,
      isActive: true,
      tenantId: 't1',
      campaignType: 'fundraising',
      ...extra,
    }),
  };
}

let container: HTMLDivElement;
let root: Root;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

async function mount(
  extra: Record<string, unknown> = {},
  branding: unknown = { givingLinks: LINKS },
  status: string | undefined = 'active',
) {
  tenant.current = { branding, tenantId: 't1', stripeConnectStatus: status };
  snapshotRows.current = [campaignDoc(extra)];
  await act(async () => {
    root = createRoot(container);
    root.render(<CampaignWidget />);
  });
  await flush();
}

const giveNow = () =>
  [...container.querySelectorAll('button')].find((b) => /give now/i.test(b.textContent || ''));

async function clickGiveNow() {
  const button = giveNow();
  expect(button, 'Give Now was not rendered').toBeTruthy();
  await act(async () => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}

const renderedProviders = () =>
  [...container.querySelectorAll('[data-provider]')].map((el) => el.getAttribute('data-provider'));

beforeEach(() => {
  vi.clearAllMocks();
  flagState.enabled = false;
  vi.spyOn(window, 'open').mockImplementation(() => null);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
  vi.restoreAllMocks();
});

describe('Give Now follows the campaign choice', () => {
  it('opens a legacy donateUrl ahead of a chosen link', async () => {
    await mount({
      donateUrl: 'https://revolut.me/legacy-church',
      paymentProviders: ['paypal'],
    });
    await clickGiveNow();
    expect(window.open).toHaveBeenCalledWith(
      'https://revolut.me/legacy-church',
      '_blank',
      'noopener,noreferrer',
    );
    expect(window.open).not.toHaveBeenCalledWith(
      'https://paypal.me/testchurch',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('opens the single chosen link directly', async () => {
    await mount({ paymentProviders: ['revolut'] });
    await clickGiveNow();
    expect(window.open).toHaveBeenCalledWith(
      'https://revolut.me/testchurch',
      '_blank',
      'noopener,noreferrer',
    );
    expect(container.querySelector('[data-testid="giving-links"]')).toBeNull();
  });

  it('opens the sheet on only the chosen links when several are ticked', async () => {
    await mount({ paymentProviders: ['wise', 'revolut'] });
    await clickGiveNow();
    expect(window.open).not.toHaveBeenCalled();
    expect(renderedProviders()).toEqual(['revolut', 'wise']);
    expect(container.querySelector('[data-testid="giving-links"] h3')?.textContent)
      .toBe('Choose how to give');
  });

  it('shows every published link when none were chosen', async () => {
    await mount({});
    await clickGiveNow();
    expect(window.open).not.toHaveBeenCalled();
    expect(renderedProviders()).toEqual(['paypal', 'zelle', 'revolut', 'wise']);
    expect(container.querySelector('[data-testid="giving-links"] h3')?.textContent)
      .toBe('Ways to give');
  });

  it('does not render the card form while card giving is off', async () => {
    expect(STRIPE_CONNECT_ENABLED).toBe(false);
    await mount({ paymentProviders: ['revolut', 'wise'] });
    await clickGiveNow();
    expect(container.textContent).not.toContain('Select Amount');
    expect(container.textContent).not.toContain('Your email *');
    expect(container.querySelector('input[placeholder="Your email *"]')).toBeNull();
    expect(container.querySelector('input[placeholder="Custom amount ($)"]')).toBeNull();
    const cardDonate = [...container.querySelectorAll('button')]
      .find((b) => /^Donate/.test((b.textContent || '').trim()));
    expect(cardDonate).toBeUndefined();
  });

  it('does not offer Give Now when there is nowhere to give', async () => {
    await mount({}, {});
    expect(giveNow()).toBeUndefined();
    expect(container.textContent).toContain('Roof Fund');
  });

  it('hides the card form on the detail view while card giving is off', async () => {
    flagState.enabled = false;
    await mount({
      paymentProviders: ['wise', 'revolut'],
      coverImage: 'https://example.test/cover.jpg',
      endDate: '2099-01-01',
    });
    await clickGiveNow();
    expect(container.textContent).not.toContain('Select Amount');
    expect(container.querySelector('input[placeholder="Custom amount ($)"]')).toBeNull();
    expect(container.textContent).not.toContain('Your Information');
    expect(container.querySelector('input[placeholder="Your email *"]')).toBeNull();
    expect(container.querySelector('input[placeholder="Your name"]')).toBeNull();
    expect(container.textContent).not.toContain(STRIPE_CONNECT_HIDDEN_MESSAGE);
    const cardDonate = [...container.querySelectorAll('button')]
      .find((b) => /^Donate/.test((b.textContent || '').trim()));
    expect(cardDonate).toBeUndefined();
    expect(container.querySelector('[data-cover-alt="Roof Fund"]')).not.toBeNull();
    expect(container.textContent).toMatch(/days left/);
    expect(container.textContent).toContain('$18,000');
    expect(container.textContent).toContain('Help us fix the roof');
    expect(renderedProviders()).toEqual(['revolut', 'wise']);
  });

  it('draws the card form on the detail view when card giving is on', async () => {
    flagState.enabled = true;
    await mount({ paymentProviders: ['wise', 'revolut'] });
    await clickGiveNow();
    expect(STRIPE_CONNECT_ENABLED).toBe(true);
    expect(container.textContent).toContain('Select Amount');
    expect(container.querySelector('input[placeholder="Custom amount ($)"]')).not.toBeNull();
    expect(container.textContent).toContain('Your Information');
    expect(container.querySelector('input[placeholder="Your email *"]')).not.toBeNull();
    const cardDonate = [...container.querySelectorAll('button')]
      .find((b) => /^Donate/.test((b.textContent || '').trim()));
    expect(cardDonate).toBeTruthy();
    expect(container.textContent).toContain('$25');
  });
});
