import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Write paths must resolve the tenant with getWriteTenantScope(), not
 * getTenantScope().
 *
 * getTenantScope() returns null BY DESIGN for a super admin with no host scope:
 * null means "all tenants", which is correct for a read and wrong for a write.
 * #249 fixed three sites on the courses screen; these are the remaining five,
 * across four features.
 *
 * Two shapes of harm, and they are NOT equally severe — see the per-site notes:
 *   • `tenantId: tenantId || null` on a CREATE — the document is written and the
 *     UI looks successful, but the field is wrong.
 *   • a bare `if (!tenantId) return;` — the action silently does nothing.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Both resolvers, independently controllable — the whole bug is that they differ
// for a super admin with no host scope.
const scope = vi.hoisted(() => ({ read: 'tenant-1' as string | null, write: 'tenant-1' as string | null }));
vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => scope.read,
  getWriteTenantScope: async () => scope.write,
  // The feed's "Message privately" now runs through usePlanGate (Community
  // Groups is Ministry-only), and that hook reads hasPlatformOverride. With no
  // TenantProvider mounted here the gate is open, so these tenant-scope
  // assertions are unaffected — the export just has to exist.
  hasPlatformOverride: () => false,
  PLATFORM_TENANT_ID: 'harvest',
}));

const fx = vi.hoisted(() => ({
  adds: [] as Array<{ path: string; data: any }>,
  // Keyed by collection path — one onSnapshot mock serves the feed listener and
  // each post's comments listener, and a comment doc read as a post crashes.
  snapshots: {} as Record<string, any[]>,
  dmCalls: [] as any[],
}));

vi.mock('../../firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'admin-uid', displayName: 'Admin', email: 'a@test.com', photoURL: '' } },
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  query: (col: any) => col,
  where: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  addDoc: async (col: any, data: any) => { fx.adds.push({ path: col?.__path, data }); return { id: 'new-doc' }; },
  updateDoc: async () => {},
  deleteDoc: async () => {},
  // The feed derives `canManage` from the user doc, and the comment kebab only
  // offers "Message privately" to a moderator. Give the signed-in user that
  // capability — it is orthogonal to the tenant-scope behaviour under test.
  getDoc: async (ref: any) => ({
    exists: () => true,
    data: () => (String(ref?.__path).startsWith('users/')
      ? { displayName: 'Admin', photoURL: '', role: 'admin', tenantId: 'tenant-1', permissions: { fullAccess: true } }
      : { adminEmails: ['a@test.com'], name: 'Tenant' }),
  }),
  getDocs: async () => ({ docs: [], forEach: () => {} }),
  arrayUnion: (v: unknown) => v,
  arrayRemove: (v: unknown) => v,
  onSnapshot: (q: any, onNext: any) => {
    const docs = fx.snapshots[q?.__path] ?? [];
    if (typeof onNext === 'function') onNext({ docs, forEach: (f: any) => docs.forEach(f) });
    return () => {};
  },
  serverTimestamp: () => 'ts',
}));

// THE-251 — NewsTab mounts CampaignWidget, which now reads `branding` to draw
// the church's own payment links on a campaign. In the app that context always
// resolves (TenantProvider wraps everything in App.tsx); here it has to be
// supplied. Empty branding: this suite is about WRITE SCOPING, and a church
// with no links renders the widget exactly as it did before.
// Everything else in the module keeps its real implementation — notably
// `useTenantOptional`, which other components on this screen read and which is
// deliberately safe outside a provider.
vi.mock('@/contexts/TenantContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/TenantContext')>()),
  useTenant: () => ({ branding: {} }) as never,
}));
vi.mock('../../lib/dm', () => ({
  getOrCreateDm: async (...args: unknown[]) => { fx.dmCalls.push(args); return { id: 'dm-1' }; },
}));

vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'GET', WRITE: 'WRITE', UPDATE: 'UPDATE', DELETE: 'DELETE' },
  handleFirestoreError: () => {},
}));


let container: HTMLDivElement;
let root: Root;

function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function byText(fragment: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent || '').includes(fragment)
  ) as HTMLButtonElement | undefined;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  scope.read = 'tenant-1';
  scope.write = 'tenant-1';
  fx.adds = [];
  fx.snapshots = {};
  fx.dmCalls = [];
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container.remove();
});

/** Apex super admin: read scope null, write scope the platform tenant. */
function apexSuperAdmin() {
  scope.read = null;
  scope.write = 'harvest';
}


// ─────────────────────────────────────────────────────────────────────────────
// Sites 2 & 3 — community comments (AllNews and NewsTab)
//
// SCOPE OF HARM, precisely: no rule reads a comment's own tenantId. The read
// scopes off the PARENT POST's tenantId, create validates authorId/content/keys
// only, delete is authorId-only, update is false. So a null here does NOT orphan
// the comment — it is wrong denormalised data that a future tenant-filtered
// query or export would silently miss. Worth fixing, not a visibility bug.
// ─────────────────────────────────────────────────────────────────────────────
const POST = {
  id: 'post-1',
  data: () => ({
    id: 'post-1', authorId: 'other-uid', authorName: 'Member', content: 'Hello',
    createdAt: '2026-01-01T00:00:00.000Z', tenantId: 'tenant-1', likes: [], commentCount: 0,
  }),
};

for (const [label, importer] of [
  ['AllNews', () => import('../AllNews')],
  ['NewsTab', () => import('../NewsTab')],
] as const) {
  describe(`${label} — community comment create`, () => {
    async function mountAndComment() {
      const mod: any = await importer();
      const Component = mod.default;
      fx.snapshots = { community_posts: [POST] };
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      await act(async () => {
        root = createRoot(container);
        root.render(
          <QueryClientProvider client={qc}>
            {label === 'AllNews'
              ? <Component onBack={() => {}} onOpenMessages={() => {}} />
              : <Component onOpenAllNews={() => {}} onOpenArticle={() => {}} onOpenMessages={() => {}} />}
          </QueryClientProvider>
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      // The comments toggle is an icon-only button (MessageSquare + a count),
      // so there is no stable text or aria hook. Click candidates until the
      // composer appears — robust to the action row's markup changing.
      const composer = () => Array.from(container.querySelectorAll('input')).find((i) =>
        (i.placeholder || '').toLowerCase().includes('comment')
      ) as HTMLInputElement | undefined;

      if (!composer()) {
        for (const b of Array.from(container.querySelectorAll('button'))) {
          await act(async () => { b.click(); await Promise.resolve(); });
          if (composer()) break;
        }
      }
      const input = composer();
      if (!input) return false;
      await act(async () => { setValue(input, 'Nice post'); });

      const send = input.parentElement?.querySelector('button:not([disabled])') as HTMLButtonElement | null;
      if (!send) return false;
      await act(async () => { send.click(); await Promise.resolve(); await Promise.resolve(); });
      return true;
    }

    it('stamps tenantId "harvest" for an apex super admin, not null', async () => {
      apexSuperAdmin();
      const reached = await mountAndComment();
      expect(reached, 'comment composer was not reachable — test needs updating').toBe(true);
      const write = fx.adds.find((a) => a.path === 'community_posts/post-1/comments');
      expect(write, 'no comment write was captured').toBeDefined();
      expect(write!.data.tenantId).toBe('harvest');
      expect(write!.data.tenantId).not.toBeNull();
    });

    it('is unchanged for an ordinary tenant admin on a subdomain', async () => {
      const reached = await mountAndComment();
      expect(reached).toBe(true);
      const write = fx.adds.find((a) => a.path === 'community_posts/post-1/comments');
      expect(write!.data.tenantId).toBe('tenant-1');
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sites 4 & 5 — "Message privately" on a comment (AllNews and NewsTab)
//
// A bare `if (!tenantIdDm) return;` on the READ resolver: for a super admin on
// the apex the handler aborted before getOrCreateDm was ever called. The button
// spun, stopped, and nothing happened — no error, no DM, no trace anywhere.
// ─────────────────────────────────────────────────────────────────────────────
const COMMENT = {
  id: 'c-1', authorId: 'member-uid', authorName: 'Member', content: 'Hi',
  createdAt: '2026-01-02T00:00:00.000Z',
};

for (const [label, importer] of [
  ['AllNews', () => import('../AllNews')],
  ['NewsTab', () => import('../NewsTab')],
] as const) {
  describe(`${label} — start a DM from a comment`, () => {
    async function mountAndStartDm() {
      const mod: any = await importer();
      const Component = mod.default;
      fx.snapshots = {
        community_posts: [POST],
        'community_posts/post-1/comments': [{ id: COMMENT.id, data: () => COMMENT }],
      };
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      await act(async () => {
        root = createRoot(container);
        root.render(
          <QueryClientProvider client={qc}>
            {label === 'AllNews'
              ? <Component onBack={() => {}} onOpenMessages={() => {}} />
              : <Component onOpenAllNews={() => {}} onOpenArticle={() => {}} onOpenMessages={() => {}} />}
          </QueryClientProvider>
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      // Two phases, each re-querying the DOM: the comment kebab only exists
      // once the comments section is expanded, so a single pass over a stale
      // button list never reaches it. Neither control has a stable test hook —
      // the toggle is an icon + count, the kebab is a "..." — so click
      // candidates until the thing we need appears.
      const composer = () => Array.from(container.querySelectorAll('input')).find((i) =>
        (i.placeholder || '').toLowerCase().includes('comment')
      );
      const dmButton = () => Array.from(container.querySelectorAll('button')).find((b) =>
        (b.textContent || '').includes('Message privately')
      ) as HTMLButtonElement | undefined;

      // Phase 1: expand the comments section. Its toggle is an icon + a count
      // with no stable hook, so click candidates until the composer appears —
      // and stop immediately, because clicking it twice closes it again.
      for (const b of Array.from(container.querySelectorAll('button'))) {
        if (composer()) break;
        await act(async () => { b.click(); await Promise.resolve(); });
      }
      // Phase 2: open the comment's kebab. This one DOES have a stable hook.
      const kebab = container.querySelector('button[aria-label="Comment options"]') as HTMLButtonElement | null;
      if (!kebab) return false;
      await act(async () => { kebab.click(); await Promise.resolve(); });

      const target = dmButton();
      if (!target) return false;
      await act(async () => { target.click(); await Promise.resolve(); await Promise.resolve(); });
      return true;
    }

    it('creates the DM against the platform tenant for an apex super admin', async () => {
      apexSuperAdmin();
      const reached = await mountAndStartDm();
      expect(reached, '"Message privately" was not reachable — test needs updating').toBe(true);
      expect(fx.dmCalls, 'no DM was created').toHaveLength(1);
      expect(fx.dmCalls[0][0]).toBe('harvest');
    });

    it('is unchanged for an ordinary tenant admin on a subdomain', async () => {
      const reached = await mountAndStartDm();
      expect(reached).toBe(true);
      expect(fx.dmCalls[0][0]).toBe('tenant-1');
    });

    it('with NO resolvable tenant, creates no DM and says so rather than failing silently', async () => {
      scope.read = null;
      scope.write = null;
      const reached = await mountAndStartDm();
      expect(reached).toBe(true);
      expect(fx.dmCalls).toHaveLength(0);
      expect(container.textContent).toMatch(/no church selected/i);
    });
  });
}
