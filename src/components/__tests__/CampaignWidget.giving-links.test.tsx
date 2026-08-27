import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import CampaignWidget from '../CampaignWidget';
import { GIVING_PROVIDERS } from '../donations/giving-providers';

/**
 * THE-251 — the member's IN-APP campaign surface carries the same links.
 *
 * `/campaign/[id]` is the public, shareable page; this is what a signed-in
 * member sees in the news feed, and it has its own donate form. A member who
 * opens the campaign here and wants to use their church's Cash App should not
 * have to leave for the Give tab to find it — and if only one of the two
 * surfaces had the links, the church's own giving options would depend on which
 * door the member came through.
 *
 * Same component, same table, same validator as the Give page and the public
 * page. Asserted on rendered output.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { tenant, snapshotRows } = vi.hoisted(() => ({
  tenant: { current: { branding: {} as unknown } },
  snapshotRows: { current: [] as unknown[] },
}));

vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => tenant.current }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: () => ({ tenantId: 't1' }),
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
  onSnapshot: (_q: unknown, next: (snap: unknown) => void) => {
    next({ empty: snapshotRows.current.length === 0, docs: snapshotRows.current });
    return () => {};
  },
}));

const CAMPAIGN_DOC = {
  id: 'c1',
  data: () => ({
    title: 'Roof Fund',
    description: 'Help us fix the roof',
    goal: 50_000,
    raised: 18_000,
    isActive: true,
    tenantId: 't1',
    campaignType: 'fundraising',
  }),
};

const WITH_LINKS = {
  givingLinks: {
    paypal: { url: 'https://paypal.me/gracechapel', handle: 'gracechapel' },
    cashapp: { url: 'https://cash.app/$gracechapel', handle: '$gracechapel' },
  },
};

let container: HTMLDivElement;
let root: Root;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

async function mount(branding: unknown) {
  tenant.current = { branding };
  snapshotRows.current = [CAMPAIGN_DOC];
  await act(async () => {
    root = createRoot(container);
    root.render(<CampaignWidget />);
  });
  await flush();
}

/** Open the campaign detail, which is where the giving options live. */
async function openDetail() {
  const give = [...container.querySelectorAll('button')]
    .find((b) => /give now/i.test(b.textContent || ''));
  await act(async () => {
    give!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}

const givingBlock = () => container.querySelector('[data-testid="giving-links"]');
const renderedProviders = () =>
  [...container.querySelectorAll('[data-provider]')].map((el) => el.getAttribute('data-provider'));

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
});

describe('a campaign shows the tenant’s payment links (member news feed)', () => {
  it('renders the links in the campaign detail', async () => {
    await mount(WITH_LINKS);
    await openDetail();
    expect(givingBlock()).not.toBeNull();
    expect(renderedProviders()).toEqual(['paypal', 'cashapp']);
  });

  it('renders through the shared component, not a second one', async () => {
    await mount(WITH_LINKS);
    await openDetail();
    // The same test id and the same member-facing sentence the Give page and
    // the public campaign page carry — all three are one component.
    expect(givingBlock()!.textContent).toContain(
      'These go straight to your ministry through their own account.',
    );
  });

  it('keeps the in-app donate form beside them', async () => {
    await mount(WITH_LINKS);
    await openDetail();
    expect(container.textContent).toMatch(/Donate/);
  });

  it('orders the rows by the provider table', async () => {
    await mount({
      givingLinks: Object.fromEntries(
        [...GIVING_PROVIDERS].reverse().map((p) => [p.id, { handle: `grace-${p.id}` }]),
      ),
    });
    await openDetail();
    expect(renderedProviders()).toEqual(GIVING_PROVIDERS.map((p) => p.id));
  });

  it('shows no giving block when the church publishes no links', async () => {
    await mount({});
    await openDetail();
    expect(givingBlock()).toBeNull();
    expect(container.textContent).not.toContain('Other ways to give');
  });

  it('never renders an unsafe href, even from a stored value', async () => {
    await mount({
      givingLinks: {
        paypal: { url: 'javascript:alert(1)', handle: 'grace' },
        cashapp: { url: 'https://cash.app.evil.example/$grace', handle: '$grace' },
      },
    });
    await openDetail();
    const hrefs = [...container.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') || '');
    expect(hrefs.some((h) => h.startsWith('javascript:'))).toBe(false);
    expect(hrefs.some((h) => h.includes('evil.example'))).toBe(false);
    // Both rows still render — each has a handle — but as cards, not links.
    expect(renderedProviders()).toEqual(['paypal', 'cashapp']);
  });
});
