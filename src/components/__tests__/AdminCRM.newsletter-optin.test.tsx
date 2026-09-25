import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import AdminCRM from '../AdminCRM';
import type { Contact } from '../../hooks/queries/useCRMQueries';
import { mountScreen, inputByPlaceholder } from '../../test/support/crm-screen';

/**
 * The founder newsletter filter and CSV export live on the platform CRM only.
 * A tenant admin's mock of tenant-scope that omits isPlatformContext must
 * keep both hidden — that fail-closed lives in AdminCRM, not in this mock.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { authFetch, notifyError, contactsResult, countsResult, platform } = vi.hoisted(() => ({
  authFetch: vi.fn(async (..._args: unknown[]): Promise<any> => ({ ok: true, json: async () => ({}) })),
  notifyError: vi.fn(),
  contactsResult: { current: { data: [] as unknown[], isLoading: false, isError: false, error: null, refetch: vi.fn() } },
  countsResult: { current: { data: undefined as unknown } },
  platform: { current: true },
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../utils/auth-fetch', () => ({ authFetch }));
vi.mock('../../utils/notify', () => ({ notifyError }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1', getIdToken: async () => 't' } } }));
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenantPlan: 'max', planFeatures: null, branding: {} }),
}));
vi.mock('../../utils/tenant-scope', () => ({
  PLATFORM_TENANT_ID: 'harvest',
  getTenantScope: async () => null,
  isSuperAdmin: () => platform.current,
  isPlatformContext: () => platform.current,
}));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  addDoc: vi.fn(async () => ({ id: 'a1' })),
  deleteDoc: vi.fn(async () => {}),
  setDoc: vi.fn(async () => {}),
  doc: () => ({}),
  serverTimestamp: () => 'SERVER_TS',
  writeBatch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn(async () => {}) })),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: () => ({ currentTenantId: 'harvest', isAuthReady: true, isSuperAdmin: platform.current }),
}));
vi.mock('../AdminScreenHeader', () => ({
  useAdminHeader: () => ({ setHeaderAction: () => {}, setHeaderOverride: () => {} }),
  HeaderActionButton: () => null,
}));
vi.mock('../AdminRoles', () => ({ default: () => null }));
vi.mock('../../hooks/queries/useCRMQueries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/queries/useCRMQueries')>()),
  useContactsWithUsers: () => contactsResult.current,
  useCRMCounts: () => countsResult.current,
  useContactActivities: () => ({ data: [], isLoading: false, isError: false, error: null, refetch: () => {} }),
}));

const profile = (opt: boolean | null) => ({
  createdAt: '2020-06-15T08:30:00.000Z',
  newsletterOptIn: opt,
  newsletterOptInAt: opt === null ? null : '2020-06-15T08:30:00.000Z',
  newsletterOptInSource: opt === null ? null : 'signup-email',
});

const contact = (over: Partial<Contact> & { id: string }): Contact => ({
  firstName: 'A', lastName: 'Person', email: 'a@example.com', phone: '',
  type: 'member', notes: '', totalDonated: 0,
  lastDonationAt: null, memberSince: null, createdAt: null,
  createdBy: 'u1', updatedAt: null, tenantId: 'grace',
  ...over,
});

const ROWS: Contact[] = [
  contact({
    id: 'ada', firstName: 'Ada', lastName: 'In', email: 'ada@example.com', type: 'member',
    account: { role: 'user', email: 'ada@example.com' }, accountProfile: profile(true),
  }),
  contact({
    id: 'bob', firstName: 'Bob', lastName: 'Out', email: 'bob@example.com', type: 'member',
    account: { role: 'user', email: 'bob@example.com' }, accountProfile: profile(false),
  }),
  contact({
    id: 'cara', firstName: 'Cara', lastName: 'Unknown', email: 'cara@example.com', type: 'member',
    account: { role: 'user', email: 'cara@example.com' }, accountProfile: profile(null),
  }),
  contact({
    id: 'dan', firstName: 'Dan', lastName: 'Donor', email: 'dan@example.com', type: 'donor',
  }),
  contact({
    id: 'eve', firstName: 'Eve', lastName: 'Both', email: 'eve@example.com', type: 'both',
    account: { role: 'user', email: 'eve@example.com' }, accountProfile: profile(true),
  }),
];
(ROWS[2] as Contact & { newsletter?: boolean }).newsletter = true;

let mounted: { unmount: () => void; container: HTMLElement } | null = null;

const text = () => (mounted?.container.textContent ?? '').replace(/\s+/g, ' ');

async function click(el: HTMLElement) {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await act(async () => { await Promise.resolve(); });
}

function buttonOutsideNewsletter(root: ParentNode, label: string): HTMLButtonElement {
  const match = Array.from(root.querySelectorAll('button')).find(b =>
    (b.textContent ?? '').replace(/\s+/g, ' ').trim() === label
    && !b.closest('[data-testid="crm-newsletter-filter"]'),
  );
  if (!match) throw new Error(`no button labelled "${label}" outside the newsletter filter`);
  return match as HTMLButtonElement;
}

async function show() {
  contactsResult.current = { data: ROWS, isLoading: false, isError: false, error: null, refetch: vi.fn() };
  countsResult.current = { data: undefined };
  mounted = await mountScreen(
    <AdminCRM currentUserRole="admin" currentUserPermissions={{ fullAccess: true } as never} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  platform.current = true;
  authFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('platform CRM', () => {
  it('filters Opted in, Opted out, Unknown and All, combined with search', async () => {
    await show();
    const root = mounted!.container;
    expect(root.querySelector('[data-testid="crm-newsletter-filter"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="crm-export-csv"]')).not.toBeNull();
    expect(text()).toContain('Ada');
    expect(text()).toContain('Dan');

    await click(root.querySelector('[data-testid="crm-newsletter-filter-in"]') as HTMLElement);
    expect(text()).toContain('Ada');
    expect(text()).toContain('Eve');
    expect(text()).not.toContain('Bob');
    expect(text()).not.toContain('Cara');
    expect(text()).not.toContain('Dan');

    await click(root.querySelector('[data-testid="crm-newsletter-filter-out"]') as HTMLElement);
    expect(text()).toContain('Bob');
    expect(text()).not.toContain('Ada');
    expect(text()).not.toContain('Cara');

    await click(root.querySelector('[data-testid="crm-newsletter-filter-unknown"]') as HTMLElement);
    expect(text()).toContain('Cara');
    expect(text()).not.toContain('Ada');
    expect(text()).not.toContain('Bob');
    expect(text()).not.toContain('Dan');

    await click(root.querySelector('[data-testid="crm-newsletter-filter-all"]') as HTMLElement);
    const input = inputByPlaceholder(root, 'Search by name or email');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, 'ada');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(text()).toContain('Ada');
    expect(text()).not.toContain('Bob');

    await click(root.querySelector('[data-testid="crm-newsletter-filter-out"]') as HTMLElement);
    expect(text()).toContain('No contacts match');
  });

  it('members plus opted in keeps a both row and drops a donor-only row', async () => {
    await show();
    const root = mounted!.container;
    await click(buttonOutsideNewsletter(root, 'Members'));
    await click(root.querySelector('[data-testid="crm-newsletter-filter-in"]') as HTMLElement);
    expect(text()).toContain('Ada');
    expect(text()).toContain('Eve');
    expect(text()).not.toContain('Dan');
    expect(text()).not.toContain('Bob');
  });

  it('calls the export route with the current filters and shows a non-OK error', async () => {
    await show();
    const root = mounted!.container;
    await click(buttonOutsideNewsletter(root, 'Members'));
    await click(root.querySelector('[data-testid="crm-newsletter-filter-out"]') as HTMLElement);
    const input = inputByPlaceholder(root, 'Search by name or email');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, 'ada');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    let release: (value: any) => void = () => {};
    authFetch.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const button = root.querySelector('[data-testid="crm-export-csv"]') as HTMLButtonElement;
    await click(button);
    expect(button.textContent).toContain('Exporting');
    expect(button.disabled).toBe(true);
    expect(authFetch).toHaveBeenCalledWith('/api/admin/crm-export?newsletter=out&type=member&q=ada');

    const downloads: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:crm');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    await act(async () => {
      release({
        ok: true,
        status: 200,
        blob: async () => new Blob(['csv']),
        headers: { get: (name: string) => name.toLowerCase() === 'content-disposition'
          ? 'attachment; filename="harvest-crm-newsletter-opted-out-2020-01-15.csv"'
          : null },
      });
      await Promise.resolve();
    });
    expect(downloads).toEqual(['harvest-crm-newsletter-opted-out-2020-01-15.csv']);

    authFetch.mockResolvedValue({
      ok: false,
      status: 413,
      json: async () => ({ error: 'over the limit of 2' }),
    });
    await click(root.querySelector('[data-testid="crm-export-csv"]') as HTMLElement);
    expect(text()).toContain('over the limit of 2');
    expect(notifyError).toHaveBeenCalled();
  });

  it('says the on-screen newsletter filter is partial and the CSV is not', async () => {
    contactsResult.current = { data: ROWS, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    countsResult.current = {
      data: {
        contactRecords: 4200, memberAccounts: 300, platformWide: true,
        contactsTruncated: true, usersTruncated: false,
      },
    };
    mounted = await mountScreen(
      <AdminCRM currentUserRole="super_admin" currentUserPermissions={{ fullAccess: true } as never} />,
    );
    const coverage = mounted.container.querySelector('[data-testid="crm-coverage"]')?.textContent ?? '';
    expect(coverage).toContain('newsletter filter');
    expect(coverage).toContain('The CSV export covers every account');
  });
});

describe('tenant admin', () => {
  it('renders neither the newsletter control nor Export CSV', async () => {
    platform.current = false;
    contactsResult.current = { data: ROWS, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    countsResult.current = {
      data: {
        contactRecords: 4200, memberAccounts: 300, platformWide: false,
        contactsTruncated: true, usersTruncated: false,
      },
    };
    mounted = await mountScreen(
      <AdminCRM currentUserRole="admin" currentUserPermissions={{ fullAccess: true } as never} />,
    );
    expect(mounted.container.querySelector('[data-testid="crm-newsletter-filter"]')).toBeNull();
    expect(mounted.container.querySelector('[data-testid="crm-export-csv"]')).toBeNull();
    const coverage = mounted.container.querySelector('[data-testid="crm-coverage"]')?.textContent ?? '';
    expect(coverage).not.toContain('newsletter filter');
    expect(coverage).not.toContain('CSV export');
    expect(coverage).toContain('type filter and the totals above cover only the rows loaded here');
    expect(text()).toContain('Ada');
    expect(text()).toContain('Dan');
  });
});
