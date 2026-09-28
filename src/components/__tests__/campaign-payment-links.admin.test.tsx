import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminFundraising from '../AdminFundraising';
import {
  CAMPAIGN_NO_PAYMENT_LINKS,
  CAMPAIGN_PICKER_HELP,
  CAMPAIGN_PICKER_TITLE,
} from '@/lib/payment-link-selection';

/**
 * The campaign editor picks from the ministry's saved links and stores the
 * ids. It never writes a URL, and an update still does not write `raised`.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { addDoc, updateDoc, campaignsResult, tenant } = vi.hoisted(() => ({
  addDoc: vi.fn(async (_ref: unknown, _data?: Record<string, unknown>) => ({ id: 'c9' })),
  updateDoc: vi.fn(async (_ref: unknown, _data?: Record<string, unknown>) => {}),
  campaignsResult: { current: { data: [] as unknown[], isLoading: false } },
  tenant: { current: { branding: {} as unknown } },
}));

vi.mock('../../utils/auth-fetch', () => ({ authFetch: vi.fn() }));
vi.mock('../../utils/notify', () => ({ notifyError: vi.fn() }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => tenant.current }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: () => ({
    currentTenantId: 't1',
    isAuthReady: true,
    isSuperAdmin: false,
    tenantPlan: 'plus',
  }),
}));
vi.mock('../AdminScreenHeader', () => ({
  useAdminHeader: () => ({ setHeaderAction: () => {}, setHeaderOverride: () => {} }),
  HeaderActionButton: () => null,
}));
vi.mock('../settings/PaymentSection', () => ({ default: () => null }));
vi.mock('../ImageUpload', () => ({ ImageUpload: () => null }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  addDoc,
  updateDoc,
  deleteDoc: vi.fn(async () => {}),
  doc: (_db: unknown, _c: string, id: string) => ({ id }),
  serverTimestamp: () => 'SERVER_TS',
  query: () => ({}),
  where: () => ({}),
  onSnapshot: (_q: unknown, next: (snap: { docs: unknown[] }) => void) => {
    next({ docs: [] });
    return () => {};
  },
  limit: () => ({}),
  Timestamp: { fromDate: (d: Date) => d },
}));
vi.mock('../../hooks/queries/useCampaignQueries', () => ({
  useCampaigns: () => campaignsResult.current,
}));

const WITH_LINKS = {
  givingLinks: {
    paypal: { url: 'https://paypal.me/testchurch', handle: 'testchurch' },
    revolut: { url: 'https://revolut.me/testchurch', handle: 'testchurch' },
    zelle: { email: 'test@example.test', handle: 'testchurch' },
  },
};

const CAMPAIGN = {
  id: 'camp1',
  title: 'Roof Fund',
  description: 'Help us fix the roof',
  coverImage: '',
  goal: 50000,
  raised: 1000,
  endDate: '',
  isActive: true,
  campaignType: 'fundraising' as const,
  pledgeDeadline: null,
  tenantId: 't1',
};

let container: HTMLDivElement;
let root: Root;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

async function mount(branding: unknown, campaigns: unknown[] = []) {
  tenant.current = { branding };
  campaignsResult.current = { data: campaigns, isLoading: false };
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminFundraising />);
  });
  await flush();
}

async function click(el: Element | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    (el as HTMLElement).dispatchEvent(new Event('click', { bubbles: true }));
  });
  await flush();
}

async function typeInto(el: Element | null, value: string) {
  expect(el).toBeTruthy();
  const input = el as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
}

const buttonNamed = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
});

describe('the campaign editor payment-link picker', () => {
  it('lists the links the ministry has saved', async () => {
    await mount(WITH_LINKS);
    await click(buttonNamed('New campaign'));
    const picker = container.querySelector('[data-campaign-provider-picker]');
    expect(picker).not.toBeNull();
    expect(picker!.textContent).toContain(CAMPAIGN_PICKER_TITLE);
    expect(picker!.textContent).toContain(CAMPAIGN_PICKER_HELP);
    const offered = [...picker!.querySelectorAll('[data-provider-option]')]
      .map((el) => el.getAttribute('data-provider-option'));
    expect(offered).toEqual(['paypal', 'zelle', 'revolut']);
    expect(container.querySelector('[data-testid="campaign-no-payment-links"]')).toBeNull();
  });

  it('saves the ticked provider id and no URL', async () => {
    await mount(WITH_LINKS);
    await click(buttonNamed('New campaign'));
    await typeInto(container.querySelector('input[placeholder="Campaign title"]'), 'Crusade');
    const box = container.querySelector('[data-provider-option="revolut"] [data-slot="checkbox"]');
    await click(box);
    await click(buttonNamed('Create campaign'));

    expect(addDoc).toHaveBeenCalled();
    const payload = addDoc.mock.calls.at(-1)?.[1];
    expect(payload?.paymentProviders).toEqual(['revolut']);
    expect(payload).not.toHaveProperty('donateUrl');
    expect(JSON.stringify(payload)).not.toMatch(/https?:/);
    expect(JSON.stringify(payload)).not.toContain('revolut.me');
  });

  it('still strips raised when an existing campaign is saved', async () => {
    await mount(WITH_LINKS, [CAMPAIGN]);
    const edit = [...container.querySelectorAll('button')].find((b) => b.querySelector('svg.lucide-pen'));
    await click(edit);
    const box = container.querySelector('[data-provider-option="revolut"] [data-slot="checkbox"]');
    await click(box);
    await click(buttonNamed('Save changes'));

    expect(updateDoc).toHaveBeenCalled();
    const payload = updateDoc.mock.calls.at(-1)?.[1];
    expect(payload?.paymentProviders).toEqual(['revolut']);
    expect(payload).not.toHaveProperty('raised');
    expect(payload).not.toHaveProperty('donateUrl');
    expect(JSON.stringify(payload)).not.toMatch(/https?:/);
  });

  it('points at Donations when the ministry has saved no links', async () => {
    await mount({});
    await click(buttonNamed('New campaign'));
    const pointer = container.querySelector('[data-testid="campaign-no-payment-links"]');
    expect(pointer).not.toBeNull();
    expect(pointer!.textContent?.trim()).toBe(CAMPAIGN_NO_PAYMENT_LINKS);
    expect(container.querySelector('[data-campaign-provider-picker]')).toBeNull();
    expect(pointer!.querySelector('button, a')).toBeNull();
  });
});
