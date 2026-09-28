import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TenantAddons } from '../../types/tenant.types';

/**
 * Blog automation writes articles from the AI Knowledge Base. The base is
 * hidden on every tier (THE-253) and lifted only by the AI Assistant add-on
 * or by the platform / no-tenant bypass. The Automate control has to follow
 * that same condition, or a Ministry admin sees a button whose screen is gone.
 *
 * The helper is the condition. AdminBlog fails closed when the prop is
 * omitted. AdminDashboard is what computes it and hands it to both screens.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TENANT_ID = 'grace';

const navigate = vi.hoisted(() => vi.fn());
const params = vi.hoisted(() => ({ current: {} as { section?: string } }));
const checkRosterAdminStatus = vi.hoisted(() => vi.fn());
const isSuperAdminMock = vi.hoisted(() => vi.fn(() => false));
const platformOverride = vi.hoisted(() => ({ current: false }));
const authFetch = vi.hoisted(() =>
  vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => ({}) })),
);
const store = vi.hoisted(() => ({
  current: {
    tenantPlan: null as string | null,
    currentTenantId: 'grace' as string | null,
    isAuthReady: true,
  },
}));
const ctx = vi.hoisted(() => ({
  current: {
    branding: null as unknown,
    isLoading: false,
    tenantPlan: undefined as string | undefined,
    tenantAddons: null as TenantAddons | null,
  },
}));
const currentUser = vi.hoisted(() => ({ current: { uid: 'user-1' } as { uid: string } | null }));
const userQuery = vi.hoisted(() => ({ current: { data: undefined as unknown, isLoading: false } }));
/** When true, the AdminBlog mock records the prop instead of mounting the screen. */
const blogMode = vi.hoisted(() => ({ record: false }));
const recorded = vi.hoisted(() => ({ values: [] as Array<boolean | undefined> }));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate, useParams: () => params.current }));
vi.mock('../../utils/tenant.utils', () => ({ checkRosterAdminStatus }));
vi.mock('../../utils/tenant-scope', () => ({
  isSuperAdmin: isSuperAdminMock,
  hasPlatformOverride: () => platformOverride.current,
  getTenantScope: async () => TENANT_ID,
  PLATFORM_TENANT_ID: 'harvest',
}));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => store.current }));
vi.mock('../../hooks/queries/useUserQueries', () => ({ useCurrentUser: () => userQuery.current }));
vi.mock('../../hooks/queries/useTenantQueries', () => ({
  useTenant: () => ({ data: { name: 'Grace Ministry', ownerId: 'someone-else' }, isLoading: false }),
}));
vi.mock('../../contexts/TenantContext', () => ({ useTenant: () => ctx.current }));
vi.mock('../../firebase', () => ({
  db: {},
  get auth() { return { get currentUser() { return currentUser.current; } }; },
}));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(async () => {}) }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  limit: () => ({}),
  doc: () => ({}),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  deleteDoc: async () => {},
  onSnapshot: (_q: unknown, next: (snap: { docs: unknown[] }) => void) => {
    next({ docs: [] });
    return () => {};
  },
}));
vi.mock('../../utils/auth-fetch', () => ({ authFetch }));
vi.mock('../../utils/notify', () => ({ notifyError: () => {} }));
vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'get', DELETE: 'delete' },
  handleFirestoreError: () => {},
}));
vi.mock('../AdminRoles', () => ({ normalizePermissions: (raw: unknown) => raw }));
vi.mock('../AdminScreenHeader', async () => {
  const React = await import('react');
  return {
    AdminScreenHeader: () => null,
    AdminHeaderContext: React.createContext({
      setHeaderAction: () => {}, setHeaderOverride: () => {}, setHeaderHidden: () => {},
    }),
  };
});
vi.mock('../AdminBlogPostEditor', () => ({ default: () => null }));

vi.mock('../AdminBlog', async () => {
  const React = await import('react');
  const actual = await vi.importActual<typeof import('../AdminBlog')>('../AdminBlog');
  return {
    default: (props: { knowledgeBaseEnabled?: boolean }) => {
      if (blogMode.record) {
        recorded.values.push(props.knowledgeBaseEnabled);
        return React.createElement('div', {
          'data-screen': 'AdminBlog',
          'data-knowledge-base-enabled': String(props.knowledgeBaseEnabled),
        });
      }
      return React.createElement(actual.default, props);
    },
  };
});

const screenStub = vi.hoisted(() => (name: string) => async () => {
  const React = await import('react');
  return { default: () => React.createElement('div', { 'data-screen': name }) };
});
vi.mock('../AdminRAG', screenStub('AdminRAG'));
vi.mock('../AdminCourses', screenStub('AdminCourses'));
vi.mock('../NewsletterCampaigns', screenStub('NewsletterCampaigns'));
vi.mock('../AdminFundraising', screenStub('AdminFundraising'));
vi.mock('../AdminDocs', screenStub('AdminDocs'));
vi.mock('../AdminEvents', screenStub('AdminEvents'));
vi.mock('../AdminServices', screenStub('AdminServices'));
vi.mock('../AdminCRM', screenStub('AdminCRM'));
vi.mock('../AdminAccounting', screenStub('AdminAccounting'));
vi.mock('../AdminForms', screenStub('AdminForms'));
vi.mock('../AdminCheckin', screenStub('AdminCheckin'));
vi.mock('../AdminLivestream', screenStub('AdminLivestream'));
vi.mock('../AdminSms', screenStub('AdminSms'));
vi.mock('../AdminCommunity', screenStub('AdminCommunity'));
vi.mock('../AdminChurches', screenStub('AdminChurches'));
vi.mock('../AdminBranding', screenStub('AdminBranding'));
vi.mock('../AdminDashboardHome', screenStub('AdminDashboardHome'));
vi.mock('../PlanUpgradeScreen', async () => {
  const React = await import('react');
  return {
    default: ({ featureName }: { featureName: string }) =>
      React.createElement('div', { 'data-upgrade-wall': featureName }),
  };
});

const stub = vi.hoisted(() => () => ({ default: () => null }));
vi.mock('../PlatformInbox', stub);
vi.mock('../AdminTenants', stub);
vi.mock('../AdminLibraryCourses', stub);
vi.mock('../AdminSettings', stub);
vi.mock('../AdminUpgradePage', stub);
vi.mock('../AffiliateSection', stub);
vi.mock('../NewsletterEditor', stub);
vi.mock('../CanvasList', stub);
vi.mock('../CanvasEditor', stub);
vi.mock('../AdminNavCustomizer', stub);
vi.mock('../FocusScreen', stub);
vi.mock('../Profile', stub);
vi.mock('../MyAccountMenu', stub);
vi.mock('../BillingAndPayments', stub);
vi.mock('../GraceWindowBanner', stub);

import AdminBlog from '../AdminBlog';
import AdminDashboard from '../AdminDashboard';
import { isKnowledgeBaseEnabled } from '../../lib/knowledge-base-feature';
import { getEffectiveFeatures, NO_ADDONS } from '../../utils/plan-features';
import { PLATFORM_TENANT_ID } from '../../utils/tenant-scope';

const ASSISTANT: TenantAddons = { aiAssistant: 1, adminSeats: 0, unlimitedContacts: false };

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  blogMode.record = false;
  recorded.values = [];
  authFetch.mockClear();
  navigate.mockClear();
  platformOverride.current = false;
  isSuperAdminMock.mockReturnValue(false);
  checkRosterAdminStatus.mockReset();
  checkRosterAdminStatus.mockResolvedValue('not-admin');
  store.current = { tenantPlan: null, currentTenantId: TENANT_ID, isAuthReady: true };
  ctx.current = { branding: null, isLoading: false, tenantPlan: undefined, tenantAddons: null };
  currentUser.current = { uid: 'user-1' };
  userQuery.current = {
    data: {
      role: 'church_admin',
      permissions: {},
      displayName: 'B',
      email: 'admin@grace.test',
    },
    isLoading: false,
  };
  params.current = {};
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) {
    const current = root;
    root = null;
    await act(async () => { current.unmount(); });
  }
  host.remove();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Mount or update the real blog screen on the root already created. */
async function renderBlog(plan: string | null, kb?: boolean) {
  store.current = { ...store.current, tenantPlan: plan };
  await act(async () => {
    root!.render(kb === undefined ? <AdminBlog /> : <AdminBlog knowledgeBaseEnabled={kb} />);
  });
  await flush();
}

const automateButton = () => host.querySelector('[data-testid="blog-automate-button"]');
const gatePending = () => host.querySelector('[data-testid="automate-gate-pending"]');
const newPost = () =>
  [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('New post')) ?? null;
const automateFetches = () =>
  authFetch.mock.calls.filter((call) => String(call[0]).includes('/api/blog/automate'));

describe('isKnowledgeBaseEnabled', () => {
  it('is false unless the plan cell is on or the platform bypass is', () => {
    expect(isKnowledgeBaseEnabled(null, false)).toBe(false);
    expect(isKnowledgeBaseEnabled(undefined, false)).toBe(false);
    expect(isKnowledgeBaseEnabled({}, false)).toBe(false);
    expect(isKnowledgeBaseEnabled({ aiKnowledge: false }, false)).toBe(false);
    expect(isKnowledgeBaseEnabled({ aiKnowledge: true }, false)).toBe(true);
    // The bypass wins even when there is no cell to read.
    expect(isKnowledgeBaseEnabled(null, true)).toBe(true);
    expect(isKnowledgeBaseEnabled({ aiKnowledge: false }, true)).toBe(true);
    expect(isKnowledgeBaseEnabled({ aiKnowledge: true }, true)).toBe(true);
  });
});

describe('AdminBlog hides Automate while the knowledge base is off', () => {
  it.each([
    ['passed false', false as const],
    ['omitted', undefined],
  ])('on Ministry, with the prop %s: New post stays, Automate does not, and settings are not fetched', async (_label, kb) => {
    await renderBlog('max', kb);

    expect(newPost(), 'New post is the control that does not depend on the base').not.toBeNull();
    expect(automateButton(), 'Automate is offered without a knowledge base').toBeNull();
    expect(gatePending(), 'a skeleton is standing in for a control that will not appear').toBeNull();
    expect(automateFetches(), 'settings were fetched for a hidden control').toEqual([]);
    expect(host.textContent ?? '').not.toContain('Automated Blog');
  });

  it('does not reserve the loading footprint while the plan is still unknown', async () => {
    // On Ministry the gate is already `permitted`, so the skeleton would be
    // absent even if it were not gated. An unresolved plan is the only state
    // that renders it, and it must not render it while the base is hidden.
    await renderBlog(null, false);

    expect(newPost()).not.toBeNull();
    expect(automateButton()).toBeNull();
    expect(gatePending()).toBeNull();
    expect(automateFetches()).toEqual([]);
  });

  it('on Ministry with the base on, shows Automate and opens the panel', async () => {
    await renderBlog('max', true);

    const button = automateButton();
    expect(button, 'Automate did not return with the knowledge base').not.toBeNull();
    expect(gatePending()).toBeNull();
    expect(newPost()).not.toBeNull();
    expect(automateFetches().length, 'settings were not loaded for a visible control').toBeGreaterThan(0);

    await act(async () => { (button as HTMLButtonElement).click(); });

    expect(host.textContent ?? '').toContain('Automated Blog');
    expect(host.textContent ?? '').toContain('Generate Now');
  });

  it('closes the panel if the base turns off while it is open', async () => {
    await renderBlog('max', true);
    await act(async () => { (automateButton() as HTMLButtonElement).click(); });
    expect(host.textContent ?? '').toContain('Automated Blog');

    // Same root, so `showAutomation` is still true. The panel has to notice.
    await renderBlog('max', false);

    expect(host.textContent ?? '').not.toContain('Automated Blog');
    expect(automateButton()).toBeNull();
    expect(gatePending()).toBeNull();
  });

  it('still shows the not-yet-known skeleton once the base is on', async () => {
    await renderBlog(null, true);

    expect(automateButton(), 'the permitted control flashed before the plan resolved').toBeNull();
    expect(gatePending(), 'the three-state gate collapsed once the base was on').not.toBeNull();
    expect(automateFetches(), 'a fetch ran before the plan permitted it').toEqual([]);
  });
});

describe('AdminDashboard feeds the blog screen the same answer the knowledge base uses', () => {
  type Scene = {
    label: string;
    plan: 'max' | null;
    addons: TenantAddons | null;
    platform: boolean;
    tenantId: string | null;
  };

  /** The inputs the shell actually feeds the helper, recomputed here so a
   *  hand-rolled condition in the shell cannot agree with itself. */
  function shellSays(scene: Scene): boolean {
    const isWhiteLabel = !!scene.tenantId && scene.tenantId !== PLATFORM_TENANT_ID;
    const planUnlocked = scene.platform || !isWhiteLabel;
    const features = scene.plan ? getEffectiveFeatures(scene.plan, scene.addons) : null;
    return isKnowledgeBaseEnabled(features, planUnlocked);
  }

  const SCENES: Scene[] = [
    { label: 'Ministry, no add-ons', plan: 'max', addons: null, platform: false, tenantId: TENANT_ID },
    { label: 'Ministry holding the AI Assistant add-on', plan: 'max', addons: ASSISTANT, platform: false, tenantId: TENANT_ID },
    { label: 'Ministry, platform bypass', plan: 'max', addons: NO_ADDONS, platform: true, tenantId: TENANT_ID },
    { label: 'no tenant in scope', plan: 'max', addons: null, platform: false, tenantId: null },
    { label: 'unresolved plan', plan: null, addons: null, platform: false, tenantId: TENANT_ID },
  ];

  async function open(scene: Scene, section: string) {
    blogMode.record = true;
    recorded.values = [];
    platformOverride.current = scene.platform;
    store.current = { tenantPlan: scene.plan, currentTenantId: scene.tenantId, isAuthReady: true };
    ctx.current = {
      branding: null,
      isLoading: false,
      tenantPlan: scene.plan ?? undefined,
      tenantAddons: scene.addons,
    };
    params.current = { section };
    await act(async () => { root!.render(<AdminDashboard onNavigate={() => {}} />); });
    await flush();
  }

  it.each(SCENES)('$label — the blog prop matches the helper', async (scene) => {
    const expected = shellSays(scene);
    await open(scene, 'blog');

    // An unresolved plan fails the blog screen closed, so AdminBlog is not
    // mounted at all. Every other scene here reaches it.
    if (scene.plan === null && !scene.platform && scene.tenantId) {
      // No plan resolved: the blog screen itself is refused, so there is no
      // prop to pass. The helper still says no, and the wall is Blog's.
      expect(expected).toBe(false);
      expect(host.querySelector('[data-screen="AdminBlog"]')).toBeNull();
      expect(recorded.values).toEqual([]);
      expect(host.querySelector('[data-upgrade-wall]')?.getAttribute('data-upgrade-wall')).toBe('Blog');
      return;
    }

    const screen = host.querySelector('[data-screen="AdminBlog"]');
    expect(screen, 'the blog screen did not mount').not.toBeNull();
    expect(recorded.values.length, 'AdminBlog rendered without the prop being observed').toBeGreaterThan(0);
    expect(recorded.values.every((value) => value === expected)).toBe(true);
    expect(screen!.getAttribute('data-knowledge-base-enabled')).toBe(String(expected));
  });

  it.each(SCENES)('$label — the AI tab renders AdminRAG exactly when the helper says so', async (scene) => {
    const expected = shellSays(scene);
    await open(scene, 'ai-knowledge');

    const rag = host.querySelector('[data-screen="AdminRAG"]');
    const wall = host.querySelector('[data-upgrade-wall]');
    if (expected) {
      expect(rag, 'the knowledge base stayed walled after the helper said yes').not.toBeNull();
      expect(wall).toBeNull();
    } else {
      expect(rag, 'AdminRAG mounted while the helper said no').toBeNull();
      expect(wall?.getAttribute('data-upgrade-wall')).toBe('AI Knowledge');
    }
  });

  it('a Ministry tenant with no add-ons is handed false, and the add-on flips it', async () => {
    // Said again by name, so the two cases the gate exists for cannot hide
    // inside the derived table above. A roster resolution re-renders the
    // shell, so the prop is asserted on every render rather than by count.
    const passed = () => recorded.values;
    await open(
      { label: '', plan: 'max', addons: null, platform: false, tenantId: TENANT_ID },
      'blog',
    );
    expect(passed().length).toBeGreaterThan(0);
    expect(passed().every((value) => value === false)).toBe(true);

    await open(
      { label: '', plan: 'max', addons: ASSISTANT, platform: false, tenantId: TENANT_ID },
      'blog',
    );
    expect(passed().length).toBeGreaterThan(0);
    expect(passed().every((value) => value === true)).toBe(true);
  });
});
