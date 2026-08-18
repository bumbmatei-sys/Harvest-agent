import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminCRM from '../AdminCRM';
import { PLATFORM_TENANT_ID } from '../../utils/tenant-scope';

/**
 * How AdminCRM resolves its tenant, and what it renders when the contacts read
 * fails (THE-44).
 *
 * Two defects are pinned here:
 *
 * 1. AdminCRM was the ONE admin screen that resolved its tenant without reading
 *    `isSuperAdmin`, so a super admin on the apex passed `null` down instead of
 *    the platform tenant — indistinguishable, to the hooks, from a tenant admin
 *    whose tenant failed to resolve.
 * 2. It destructured `data: contacts = []` and nothing else, so a REJECTED read
 *    rendered as "No contacts yet". A pastor cannot tell that from a church with
 *    no contacts, which is the silent-failure class that has now shipped here
 *    four times (THE-33, THE-37, THE-44, THE-46).
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const {
  navigate, authFetch, notifyError, invalidateQueries, store, contactsResult, useContactsWithUsers,
} = vi.hoisted(() => ({
  navigate: vi.fn(),
  authFetch: vi.fn(async () => ({ ok: true, json: async () => ({ connected: false }) })),
  notifyError: vi.fn(),
  invalidateQueries: vi.fn(async () => {}),
  store: { currentTenantId: null as string | null, isAuthReady: true, isSuperAdmin: false },
  contactsResult: {
    current: { data: [] as unknown[], isLoading: false, isError: false, error: null as Error | null, refetch: vi.fn() },
  },
  useContactsWithUsers: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../../utils/auth-fetch', () => ({ authFetch }));
vi.mock('../../utils/notify', () => ({ notifyError }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
// AdminCRM reads the tenant plan for the maxContacts cap (contact-capacity.ts).
// `undefined` is the loading/unknown plan, which fails closed to 'plus' (150) —
// no test here is near that number, so the cap stays inert.
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ tenantPlan: undefined }) }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  addDoc: vi.fn(async () => ({ id: 'a1' })),
  deleteDoc: vi.fn(async () => {}),
  setDoc: vi.fn(async () => {}),
  doc: () => ({}),
  serverTimestamp: () => 'SERVER_TS',
  // THE-74 added a batched import write. Mocked modules must export every
  // binding the component imports, so this is required even where unused.
  writeBatch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn(async () => {}) })),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => store }));
vi.mock('../AdminScreenHeader', () => ({
  useAdminHeader: () => ({ setHeaderAction: () => {}, setHeaderOverride: () => {} }),
  HeaderActionButton: () => null,
}));
vi.mock('../AnalyticsAndRoles', () => ({
  default: ({ mode }: { mode: string }) => <div data-testid="analytics-and-roles">{mode}</div>,
}));
// Spread the real module so the pure helpers it exports (resolvePipelineStage,
// which every stage badge in AdminCRM calls) stay REAL — only the two data hooks
// are stubbed. A hand-written object here would silently drop new exports.
vi.mock('../../hooks/queries/useCRMQueries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/queries/useCRMQueries')>()),
  useContactsWithUsers: (...args: unknown[]) => {
    useContactsWithUsers(...args);
    return contactsResult.current;
  },
  useContactActivities: () => ({
    data: [], isLoading: false, isError: false, error: null, refetch: () => {},
  }),
  // Undefined data = counts not in yet. Deliberate here: it proves the error and
  // empty states below are what AdminCRM renders on its own, with no coverage
  // line propping them up.
  useCRMCounts: () => ({ data: undefined }),
}));

let container: HTMLDivElement;
let root: Root;

async function mountCRM(permissions: Record<string, boolean> = { fullAccess: true }) {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <AdminCRM currentUserRole="admin" currentUserPermissions={permissions as never} />,
    );
  });
  await act(async () => {
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
}

const pillNamed = (name: string) =>
  Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === name);

/** The tenant id AdminCRM handed to the contacts hook on its first render. */
const tenantPassedToHook = () => useContactsWithUsers.mock.calls[0][0];

beforeEach(() => {
  vi.clearAllMocks();
  store.currentTenantId = null;
  store.isAuthReady = true;
  store.isSuperAdmin = false;
  contactsResult.current = {
    data: [], isLoading: false, isError: false, error: null, refetch: vi.fn(),
  };
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('AdminCRM tenant resolution', () => {
  it('falls back to the platform tenant for a super admin with no tenant in context', async () => {
    store.isSuperAdmin = true;
    await mountCRM();
    expect(tenantPassedToHook()).toBe(PLATFORM_TENANT_ID);
  });

  it('passes null for a NON-super-admin with no tenant, so the hooks can fault', async () => {
    store.isSuperAdmin = false;
    await mountCRM();
    // The whole point of reading `isSuperAdmin`: these two callers must NOT look
    // alike to the hooks. A super admin gets the platform scan; this one gets a
    // visible error rather than a permission-denied dressed up as an empty CRM.
    expect(tenantPassedToHook()).toBeNull();
  });

  it('lets a resolved tenant win over the super-admin fallback', async () => {
    store.currentTenantId = 'nations';
    store.isSuperAdmin = true;
    await mountCRM();
    expect(tenantPassedToHook()).toBe('nations');
  });
});

describe('AdminCRM contacts error state', () => {
  it('renders a distinguishable error — NOT the empty state — when the read fails', async () => {
    store.currentTenantId = 'nations';
    contactsResult.current = {
      data: undefined as unknown as unknown[],
      isLoading: false,
      isError: true,
      error: new Error('Missing or insufficient permissions.'),
      refetch: vi.fn(),
    };
    await mountCRM();

    const text = container.textContent || '';
    expect(text).toContain("Couldn't load contacts");
    expect(text).toContain('Missing or insufficient permissions.');
    expect(text).toContain('Try again');
    // The lie being killed: a rejected read must never read as "no contacts".
    expect(text).not.toContain('No contacts yet');
  });

  it('renders the EMPTY state — not the error — when the read succeeds with no rows', async () => {
    store.currentTenantId = 'nations';
    await mountCRM();

    const text = container.textContent || '';
    expect(text).toContain('No contacts yet');
    expect(text).not.toContain("Couldn't load contacts");
  });

  it('retries the query from the error state', async () => {
    store.currentTenantId = 'nations';
    const refetch = vi.fn();
    contactsResult.current = {
      data: undefined as unknown as unknown[],
      isLoading: false, isError: true, error: new Error('nope'), refetch,
    };
    await mountCRM();

    const retry = Array.from(container.querySelectorAll('button'))
      .find(b => b.textContent?.trim() === 'Try again');
    expect(retry).toBeTruthy();
    await act(async () => { retry!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(refetch).toHaveBeenCalled();
  });
});

/**
 * THE-47: the contacts error/loading states used to `return` before the
 * sub-view tab bar was even declared, so a failed (or loading) contacts read
 * took Analytics and Roles down with it — including the Roles screen an admin
 * would need to fix the very permissions problem that broke the contacts read.
 */
describe('AdminCRM sub-view tabs stay reachable during contacts loading/error (THE-47)', () => {
  it('contacts query fails: the error card renders AND the Analytics and Roles pills are present and clickable', async () => {
    store.currentTenantId = 'nations';
    contactsResult.current = {
      data: undefined as unknown as unknown[],
      isLoading: false, isError: true, error: new Error('nope'), refetch: vi.fn(),
    };
    await mountCRM();

    const text = container.textContent || '';
    expect(text).toContain("Couldn't load contacts");

    const analyticsPill = pillNamed('Analytics');
    const rolesPill = pillNamed('Roles');
    expect(analyticsPill).toBeTruthy();
    expect(rolesPill).toBeTruthy();
    expect(analyticsPill!.hasAttribute('disabled')).toBe(false);
    expect(rolesPill!.hasAttribute('disabled')).toBe(false);
  });

  it('contacts query fails: clicking Roles renders AnalyticsAndRoles in roles mode, not the error card', async () => {
    store.currentTenantId = 'nations';
    contactsResult.current = {
      data: undefined as unknown as unknown[],
      isLoading: false, isError: true, error: new Error('nope'), refetch: vi.fn(),
    };
    await mountCRM();

    const rolesPill = pillNamed('Roles')!;
    await act(async () => { rolesPill.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    const rendered = container.querySelector('[data-testid="analytics-and-roles"]');
    expect(rendered).toBeTruthy();
    expect(rendered!.textContent).toBe('roles');
    expect(container.textContent || '').not.toContain("Couldn't load contacts");
  });

  it('contacts query loading: spinner shows and the pills remain', async () => {
    store.currentTenantId = 'nations';
    contactsResult.current = {
      data: undefined as unknown as unknown[],
      isLoading: true, isError: false, error: null, refetch: vi.fn(),
    };
    await mountCRM();

    expect(container.querySelector('.animate-spin')).toBeTruthy();
    expect(pillNamed('Analytics')).toBeTruthy();
    expect(pillNamed('Roles')).toBeTruthy();
  });

  it('an admin without canViewAnalytics still does not see that pill while the contacts query is failing', async () => {
    store.currentTenantId = 'nations';
    contactsResult.current = {
      data: undefined as unknown as unknown[],
      isLoading: false, isError: true, error: new Error('nope'), refetch: vi.fn(),
    };
    // manageCRM (contacts) + manageAdmins (roles), but no analytics and no fullAccess.
    await mountCRM({ manageCRM: true, manageAdmins: true });

    expect(pillNamed('Analytics')).toBeUndefined();
    expect(pillNamed('Roles')).toBeTruthy();
  });
});
