import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminFundraising from '../AdminFundraising';

/**
 * The fundraising-chooser Stripe flag fix.
 *
 * The "New campaign" chooser's Fundraising option advertised "One-time &
 * recurring gifts toward a goal" unconditionally, even though recurring
 * giving only exists through `/api/stripe/donate`, which is gated off by
 * `STRIPE_CONNECT_ENABLED`. These tests hold the copy to the flag: a Ministry
 * tenant (the only plan with `pledgeCampaigns`, so the only one that even
 * renders this chooser) sees the honest string while the flag is off, and
 * the original string, byte for byte, if the flag were ever on again.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { flagState, tenant, appStore } = vi.hoisted(() => ({
  flagState: { enabled: false },
  tenant: { current: { branding: {} as unknown } },
  appStore: {
    current: {
      currentTenantId: 't1' as string | null,
      isAuthReady: true,
      isSuperAdmin: false,
      tenantPlan: 'max' as string | null,
    },
  },
}));

vi.mock('../../lib/stripe-connect-feature', () => ({
  get STRIPE_CONNECT_ENABLED() { return flagState.enabled; },
  STRIPE_CONNECT_HIDDEN_MESSAGE: 'Card giving inside the app is off.',
}));
vi.mock('../../utils/auth-fetch', () => ({ authFetch: vi.fn() }));
vi.mock('../../utils/notify', () => ({ notifyError: vi.fn() }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => tenant.current }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => appStore.current }));
vi.mock('../AdminScreenHeader', () => ({
  useAdminHeader: () => ({ setHeaderAction: () => {}, setHeaderOverride: () => {} }),
  HeaderActionButton: () => null,
}));
vi.mock('../settings/PaymentSection', () => ({ default: () => null }));
vi.mock('../ImageUpload', () => ({ ImageUpload: () => null }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  addDoc: vi.fn(async () => ({ id: 'c9' })),
  updateDoc: vi.fn(async () => {}),
  deleteDoc: vi.fn(async () => {}),
  doc: (_db: unknown, _c: string, id: string) => ({ id }),
  serverTimestamp: () => 'SERVER_TS',
  query: () => ({}),
  where: () => ({}),
  onSnapshot: (_q: unknown, _next: unknown, err: () => void) => { err?.(); return () => {}; },
  limit: () => ({}),
  Timestamp: { fromDate: (d: Date) => d },
}));
vi.mock('../../hooks/queries/useCampaignQueries', () => ({
  useCampaigns: () => ({ data: [], isLoading: false }),
}));

let container: HTMLDivElement;
let root: Root;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

async function mount() {
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminFundraising />);
  });
  await flush();
}

async function click(el: Element | null) {
  expect(el).not.toBeNull();
  await act(async () => {
    (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}

async function openNewCampaignForm() {
  await mount();
  await click([...container.querySelectorAll('button')].find((b) => /new campaign/i.test(b.textContent || ''))!);
}

beforeEach(() => {
  flagState.enabled = false;
  tenant.current = { branding: {} };
  appStore.current = { currentTenantId: 't1', isAuthReady: true, isSuperAdmin: false, tenantPlan: 'max' };
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
});

describe('the New campaign chooser reads STRIPE_CONNECT_ENABLED for a Ministry tenant', () => {
  it('shows the honest copy and says nothing about recurring giving while the flag is off', async () => {
    await openNewCampaignForm();
    expect(container.textContent).toContain('Gifts toward a goal, through your own giving links');
    expect(container.textContent).not.toContain('recurring');
  });

  it('shows the original recurring-giving copy, byte for byte, when the flag is on', async () => {
    flagState.enabled = true;
    await openNewCampaignForm();
    expect(container.textContent).toContain('One-time & recurring gifts toward a goal');
  });

  it('leaves the Pledge option copy untouched either way', async () => {
    await openNewCampaignForm();
    expect(container.textContent).toContain('Donors commit an amount, tracked over time');
  });
});
