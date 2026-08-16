import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * THE-162, the other way into Community Groups from the member app.
 *
 * The news feed's comment menu carries "Message privately": it calls
 * getOrCreateDm() — a write to tenants/{t}/directMessages, the DM half of
 * `communityGroups` — and then jumps to the Messages tab. Both NewsTab and
 * AllNews carry a copy.
 *
 * It is moderator-only, so it is not the member-facing leak the ticket
 * describes. It is gated all the same, for two reasons: it creates Community
 * Groups data on a tenant that has not bought Community Groups, and with the
 * Messages tab now gated it would otherwise write a DM thread and then land the
 * clicker on a "not included" screen — a button that silently creates data
 * nobody can open.
 *
 * The rest of the menu (Delete comment) is moderation, not community, and must
 * survive on every tier.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => 'tenant-1',
  getWriteTenantScope: async () => 'tenant-1',
  hasPlatformOverride: () => false,
  PLATFORM_TENANT_ID: 'harvest',
}));

const fx = vi.hoisted(() => ({
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
  addDoc: async () => ({ id: 'new-doc' }),
  updateDoc: async () => {},
  deleteDoc: async () => {},
  deleteField: () => undefined,
  getCountFromServer: async () => ({ data: () => ({ count: 1 }) }),
  // The feed derives `canManage` from the user doc; the comment kebab only
  // offers "Message privately" to a moderator. Give the signed-in user that
  // capability — the plan flag is what is under test, not the role.
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

vi.mock('../../lib/dm', () => ({
  getOrCreateDm: async (...args: unknown[]) => { fx.dmCalls.push(args); return 'dm-1'; },
}));

vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'GET', WRITE: 'WRITE', UPDATE: 'UPDATE', DELETE: 'DELETE' },
  handleFirestoreError: () => {},
}));

// usePlanGate reads the tenant plan through this context; nothing else in the
// feed does, so a bare value is enough.
const tenant = vi.hoisted(() => ({ tenantPlan: 'plus' as string | null }));
vi.mock('../../contexts/TenantContext', () => ({
  useTenantOptional: () => tenant,
  useTenant: () => tenant,
}));

let container: HTMLDivElement;
let root: Root;

const POST = {
  id: 'post-1',
  data: () => ({
    id: 'post-1', authorId: 'other-uid', authorName: 'Member', content: 'Hello',
    createdAt: '2026-01-01T00:00:00.000Z', tenantId: 'tenant-1', likes: [], commentCount: 1,
  }),
};

const COMMENT = {
  id: 'c-1', authorId: 'member-uid', authorName: 'Member', content: 'Hi',
  createdAt: '2026-01-02T00:00:00.000Z',
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  fx.snapshots = {};
  fx.dmCalls = [];
  tenant.tenantPlan = 'plus';
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
});

for (const [label, importer] of [
  ['AllNews', () => import('../AllNews')],
  ['NewsTab', () => import('../NewsTab')],
] as const) {
  describe(`${label} — "Message privately" follows the Community Groups flag`, () => {
    /** Mount the feed on `plan` and open a comment's kebab menu. */
    async function openCommentMenu(plan: string): Promise<boolean> {
      tenant.tenantPlan = plan;
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
          </QueryClientProvider>,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      // The comments toggle is an icon + a count with no stable hook, so click
      // candidates until the composer appears, then stop — clicking it twice
      // closes the section again. (Same approach as write-tenant-scope.test.)
      const composer = () => Array.from(container.querySelectorAll('input')).find((i) =>
        (i.placeholder || '').toLowerCase().includes('comment'),
      );
      for (const b of Array.from(container.querySelectorAll('button'))) {
        if (composer()) break;
        await act(async () => { b.click(); await Promise.resolve(); });
      }
      const kebab = container.querySelector('button[aria-label="Comment options"]') as HTMLButtonElement | null;
      if (!kebab) return false;
      await act(async () => { kebab.click(); await Promise.resolve(); });
      return true;
    }

    const menuLabels = (): string[] =>
      Array.from(container.querySelectorAll('button')).map((b) => (b.textContent || '').trim());

    it('is offered on Ministry', async () => {
      expect(await openCommentMenu('max'), 'the comment menu was not reachable').toBe(true);
      expect(menuLabels()).toContain('Message privately');
    });

    it('is withheld on Individual', async () => {
      expect(await openCommentMenu('plus')).toBe(true);
      expect(menuLabels()).not.toContain('Message privately');
    });

    it('is withheld on Small Team', async () => {
      expect(await openCommentMenu('pro')).toBe(true);
      expect(menuLabels()).not.toContain('Message privately');
    });

    it('leaves comment moderation alone on Individual', async () => {
      // Deleting a comment is moderation, not Community Groups. If this goes
      // missing the gate has reached past the feature it is meant to cover.
      expect(await openCommentMenu('plus')).toBe(true);
      expect(menuLabels()).toContain('Delete comment');
    });

    it('creates no DM on Individual, because there is nothing to click', async () => {
      expect(await openCommentMenu('plus')).toBe(true);
      const dmButton = Array.from(container.querySelectorAll('button')).find(
        (b) => (b.textContent || '').includes('Message privately'),
      );
      expect(dmButton).toBeUndefined();
      expect(fx.dmCalls, 'a DM was created on a tenant without Community Groups').toEqual([]);
    });
  });
}
