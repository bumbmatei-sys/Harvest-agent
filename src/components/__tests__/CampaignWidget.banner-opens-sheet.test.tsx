import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import CampaignWidget, { CampaignDetailSheet, type Campaign } from '../CampaignWidget';
import { FeedEmbedCard } from '../EmbedCard';

/**
 * The feed banner and a fundraising card in a post both open the in-app
 * campaign sheet. Give Now keeps its own destination, and a click on it must
 * not also open the sheet.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { tenant, snapshotRows, feedDoc, flagState } = vi.hoisted(() => ({
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
  stripeConnectStatus?: string,
) {
  tenant.current = { branding, tenantId: 't1', stripeConnectStatus };
  snapshotRows.current = [campaignDoc(extra)];
  await act(async () => {
    root = createRoot(container);
    root.render(<CampaignWidget />);
  });
  await flush();
}

// A native button. The band itself is not a control; this is its view action.
const viewDetails = () => container.querySelector<HTMLButtonElement>('[aria-label^="View "]');
const giveNow = () =>
  [...container.querySelectorAll('button')].find((b) => /give now/i.test(b.textContent || ''));
// The detail view is a Sheet, so it portals to document.body.
const sheet = () => document.querySelector('[data-testid="campaign-detail-sheet"]');
const renderedProviders = () =>
  [...document.querySelectorAll('[data-provider]')].map((el) => el.getAttribute('data-provider'));

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}

function keyEvent(type: 'keydown' | 'keyup', key: string) {
  const code = key === ' ' ? 'Space' : key === 'Escape' ? 'Escape' : key === 'Enter' ? 'Enter' : key;
  return new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true });
}

async function keydown(el: Element, key: string) {
  await act(async () => {
    el.dispatchEvent(keyEvent('keydown', key));
  });
  await flush();
}

/**
 * Keydown + keyup on the focused element, plus the click a browser fires for
 * that key. happy-dom does not activate a button from the keyboard, and a bare
 * KeyboardEvent therefore never reaches a parent the way Space does in Chrome.
 * Enter clicks on keydown; Space clicks on keyup. `@testing-library/user-event`
 * cannot load here: its peer `@testing-library/dom` is not installed.
 */
async function press(el: HTMLElement, key: 'Enter' | ' ' | 'Escape') {
  el.focus();
  await act(async () => {
    const down = keyEvent('keydown', key);
    el.dispatchEvent(down);
    if (key === 'Enter' && !down.defaultPrevented && el.tagName === 'BUTTON') {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    const up = keyEvent('keyup', key);
    el.dispatchEvent(up);
    if (key === ' ' && !up.defaultPrevented && el.tagName === 'BUTTON') {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
  });
  await flush();
}

async function setInput(el: HTMLInputElement, value: string) {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  flagState.enabled = false;
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
    const view = viewDetails();
    expect(view, 'the view-details control is missing').toBeTruthy();
    expect(view!.tagName).toBe('BUTTON');
    expect(view!.getAttribute('aria-label')).toBe('View Roof Fund');
    expect(view!.tabIndex).toBe(0);
    await click(view!);
    expect(sheet()).not.toBeNull();
    expect(sheet()!.textContent).toContain('Help us fix the roof');
    expect(renderedProviders()).toEqual(['wise']);
    expect(window.open).not.toHaveBeenCalled();
  });

  it('a keyboard Enter opens the sheet', async () => {
    await mountWidget({ donateUrl: 'https://example.test/legacy' });
    await press(viewDetails()!, 'Enter');
    expect(sheet()).not.toBeNull();
    expect(sheet()!.textContent).toContain('Help us fix the roof');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('a keyboard Space opens the sheet', async () => {
    await mountWidget({ donateUrl: 'https://example.test/legacy' });
    const view = viewDetails()!;
    await keydown(view, ' ');
    expect(sheet(), 'Space must not open on keydown, the sheet would take the keyup').toBeNull();
    await press(view, ' ');
    expect(sheet()).not.toBeNull();
    expect(window.open).not.toHaveBeenCalled();
  });

  it('Space on Give Now does not open the sheet', async () => {
    await mountWidget({ donateUrl: 'https://wise.com/pay/business/legacy' });
    const button = giveNow();
    expect(button, 'Give Now was not rendered').toBeTruthy();
    await press(button!, ' ');
    // The key did activate Give Now. It must not also open the band's sheet.
    expect(window.open).toHaveBeenCalledTimes(1);
    expect(sheet(), 'Space on Give Now also opened the sheet').toBeNull();
  });

  it('Give Now is a sibling of the view-details control', async () => {
    await mountWidget({ donateUrl: 'https://example.test/legacy' });
    const view = viewDetails()!;
    const give = giveNow()!;
    expect(give.parentElement).toBe(view.parentElement);
    expect(view.contains(give), 'Give Now is inside the view control').toBe(false);
    const raised = [...container.querySelectorAll('span')].find((el) => el.textContent === '$18,000');
    const goal = [...container.querySelectorAll('span')].find((el) => el.textContent === 'of $50,000');
    expect(raised, 'the raised figure is not in the banner').toBeTruthy();
    expect(goal, 'the goal figure is not in the banner').toBeTruthy();
    expect(view.contains(raised!), 'the view name swallows the raised figure').toBe(false);
    expect(view.contains(goal!), 'the view name swallows the goal figure').toBe(false);
    expect(raised!.closest('[aria-hidden="true"]')).toBeNull();
    expect(goal!.closest('[aria-hidden="true"]')).toBeNull();
    expect(give.closest('[aria-hidden="true"]')).toBeNull();
    expect(give.textContent).toMatch(/Give Now/);
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
    expect(document.querySelector('[data-testid="giving-links"] h3')?.textContent).toBe('Ways to give');
    expect(errors, `console.error on Give Now: ${JSON.stringify(errors)}`).toEqual([]);
    spy.mockRestore();
  });

  it("the donate payload's tenantId is the campaign tenantId", async () => {
    flagState.enabled = true;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);
    await mountWidget({ tenantId: 'church-42' }, WISE, 'active');
    await click(viewDetails()!);
    const amount = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '$25');
    expect(amount, 'the card form did not render').toBeTruthy();
    await click(amount!);
    const email = document.querySelector<HTMLInputElement>('input[placeholder="Your email *"]');
    expect(email).toBeTruthy();
    await setInput(email!, 'giver@example.com');
    const donate = [...document.querySelectorAll('button')].find((b) => /^Donate/.test((b.textContent || '').trim()));
    expect(donate, 'Donate was not rendered').toBeTruthy();
    await click(donate!);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body)) as { metadata: { tenantId: string } };
    expect(body.metadata.tenantId).toBe('church-42');
  });
});

const SHEET_CAMPAIGN: Campaign = {
  id: 'c1',
  title: 'Roof Fund',
  description: 'Help us fix the roof',
  goal: 50000,
  raised: 18000,
  isActive: true,
  tenantId: 't1',
  campaignType: 'fundraising',
};

describe('closing the campaign sheet calls onClose', () => {
  async function mountSheet(onClose: () => void) {
    tenant.current = { branding: WISE, tenantId: 't1', stripeConnectStatus: undefined };
    await act(async () => {
      root = createRoot(container);
      root.render(<CampaignDetailSheet campaign={SHEET_CAMPAIGN} onClose={onClose} />);
    });
    await flush();
  }

  it('Back calls onClose', async () => {
    const onClose = vi.fn();
    await mountSheet(onClose);
    const back = document.querySelector('[aria-label="Back"]');
    expect(back, 'Back was not rendered').toBeTruthy();
    await click(back!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape calls onClose', async () => {
    const onClose = vi.fn();
    await mountSheet(onClose);
    const back = document.querySelector<HTMLElement>('[aria-label="Back"]');
    expect(back, 'Back was not rendered').toBeTruthy();
    await press(back!, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
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
    expect(sheet()!.textContent).toContain('Help us fix the roof');
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
