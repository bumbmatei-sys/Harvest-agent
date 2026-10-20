import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import CampaignWidget from '../CampaignWidget';
import { FeedEmbedCard } from '../EmbedCard';

/**
 * The feed banner and a fundraising card in a post both open the in-app
 * campaign sheet. Give Now keeps its own destination, and a click on it must
 * not also open the sheet.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { tenant, snapshotRows, feedDoc } = vi.hoisted(() => ({
  tenant: {
    current: {
      branding: {} as unknown,
      tenantId: 't1' as string | null,
      stripeConnectStatus: undefined as string | undefined,
    },
  },
  snapshotRows: { current: [] as unknown[] },
  feedDoc: {
    current: null as null | { exists: () => boolean; data: () => Record<string, unknown> },
  },
}));

vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => tenant.current }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: null } }));
vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => 't1',
  hasPlatformOverride: () => false,
  PLATFORM_TENANT_ID: 'harvest',
}));
vi.mock('../../utils/share-url', () => ({ usePublicShareUrl: () => 'https://grace.example/campaign/c1' }));
vi.mock('../ShareButton', () => ({ default: () => null }));
vi.mock('../member/desktopKit', () => ({
  HeroBand: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Eyebrow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  limit: () => ({}),
  doc: () => ({}),
  getDoc: async () => {
    if (!feedDoc.current) throw new Error('no feed doc');
    return feedDoc.current;
  },
  onSnapshot: (_q: unknown, next: (snap: unknown) => void) => {
    next({ empty: snapshotRows.current.length === 0, docs: snapshotRows.current });
    return () => {};
  },
}));

const WISE = {
  givingLinks: {
    wise: { url: 'https://wise.com/pay/business/gracechapel', handle: 'gracechapel' },
  },
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
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

async function mountWidget(
  extra: Record<string, unknown> = {},
  branding: unknown = WISE,
) {
  tenant.current = { branding, tenantId: 't1', stripeConnectStatus: undefined };
  snapshotRows.current = [campaignDoc(extra)];
  await act(async () => {
    root = createRoot(container);
    root.render(<CampaignWidget />);
  });
  await flush();
}

const banner = () => container.querySelector<HTMLElement>('[role="button"]');
const giveNow = () =>
  [...container.querySelectorAll('button')].find((b) => /give now/i.test(b.textContent || ''));
const sheet = () => container.querySelector('[data-testid="campaign-detail-sheet"]');
const renderedProviders = () =>
  [...container.querySelectorAll('[data-provider]')].map((el) => el.getAttribute('data-provider'));

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}

async function keydown(el: Element, key: string) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  feedDoc.current = null;
  vi.spyOn(window, 'open').mockImplementation(() => null);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
  vi.restoreAllMocks();
});

describe('the campaign banner opens the in-app sheet', () => {
  it('a banner click opens the sheet', async () => {
    await mountWidget({ donateUrl: 'https://example.test/legacy' });
    const band = banner();
    expect(band, 'the banner is not a control').toBeTruthy();
    expect(band!.getAttribute('aria-label')).toBe('View Roof Fund');
    expect(band!.tabIndex).toBe(0);
    await click(band!);
    expect(sheet()).not.toBeNull();
    expect(container.textContent).toContain('Help us fix the roof');
    expect(renderedProviders()).toEqual(['wise']);
    expect(window.open).not.toHaveBeenCalled();
  });

  it('a keyboard Enter opens the sheet', async () => {
    await mountWidget({ donateUrl: 'https://example.test/legacy' });
    await keydown(banner()!, 'Enter');
    expect(sheet()).not.toBeNull();
    expect(container.textContent).toContain('Help us fix the roof');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('a keyboard Space opens the sheet', async () => {
    await mountWidget({ donateUrl: 'https://example.test/legacy' });
    await keydown(banner()!, ' ');
    expect(sheet()).not.toBeNull();
    expect(window.open).not.toHaveBeenCalled();
  });

  it('Give Now does not also open the sheet', async () => {
    await mountWidget({ donateUrl: 'https://wise.com/pay/business/legacy' });
    const button = giveNow();
    expect(button, 'Give Now was not rendered').toBeTruthy();
    await click(button!);
    expect(window.open).toHaveBeenCalledTimes(1);
    expect(window.open).toHaveBeenCalledWith(
      'https://wise.com/pay/business/legacy',
      '_blank',
      'noopener,noreferrer',
    );
    expect(sheet(), 'Give Now also opened the banner sheet').toBeNull();
  });

  it('Give Now opens the giving sheet for a Wise link when no providers were chosen', async () => {
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    await mountWidget({});
    await click(giveNow()!);
    expect(window.open).not.toHaveBeenCalled();
    expect(sheet()).not.toBeNull();
    expect(renderedProviders()).toEqual(['wise']);
    expect(container.querySelector('[data-testid="giving-links"] h3')?.textContent).toBe('Ways to give');
    expect(errors, `console.error on Give Now: ${JSON.stringify(errors)}`).toEqual([]);
    spy.mockRestore();
  });
});

describe('a feed campaign card opens the in-app sheet', () => {
  async function mountCard(embed: { type: 'fundraising' | 'blog' | 'event'; id: string }, doc: Record<string, unknown>) {
    tenant.current = { branding: WISE, tenantId: 't1', stripeConnectStatus: undefined };
    feedDoc.current = { exists: () => true, data: () => doc };
    await act(async () => {
      root = createRoot(container);
      root.render(<FeedEmbedCard embed={embed} tenantId="t1" />);
    });
    await flush();
  }

  it('a feed card opens the sheet in-app', async () => {
    const before = window.location.href;
    await mountCard(
      { type: 'fundraising', id: 'feed-roof' },
      {
        title: 'Roof Fund',
        description: 'Help us fix the roof',
        goal: 50000,
        raised: 18000,
        isActive: true,
        tenantId: 't1',
        campaignType: 'fundraising',
      },
    );
    const card = container.querySelector<HTMLButtonElement>('[data-testid="feed-campaign-card"]');
    expect(card, 'the feed card is still a link').toBeTruthy();
    expect(container.querySelector('a[href="/campaign/feed-roof"]')).toBeNull();
    await click(card!);
    expect(sheet()).not.toBeNull();
    expect(container.textContent).toContain('Help us fix the roof');
    expect(renderedProviders()).toEqual(['wise']);
    expect(window.location.href).toBe(before);
    expect(container.querySelector('a[href^="/campaign/"]')).toBeNull();
  });

  it('a pledge card keeps its public link', async () => {
    await mountCard(
      { type: 'fundraising', id: 'pledge-1' },
      { title: 'Prayer pledge', campaignType: 'pledge', goal: 10, raised: 1 },
    );
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/pledge/pledge-1');
    expect(container.querySelector('[data-testid="feed-campaign-card"]')).toBeNull();
    expect(sheet()).toBeNull();
  });
});
