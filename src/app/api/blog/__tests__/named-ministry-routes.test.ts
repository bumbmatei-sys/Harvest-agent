import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Named-ministry access on /api/blog/automate and /api/blog/generate.
 *
 * The caller's token already names their ministry. A different ministry in
 * the query or body is a cross-tenant read or write, and only a super admin
 * may do that. These tests call the route handlers. Deleting the
 * `named !== own && !isSuperAdmin` refusal from either route turns the
 * tenant-admin case into a success, so that suite goes red.
 */

const auth = vi.hoisted(() => ({
  user: {
    tenantId: 'grace' as string | null,
    uid: 'admin-1',
    email: 'admin@grace.test',
    isAdmin: true,
    isSuperAdmin: false,
  },
}));

const store = vi.hoisted(() => ({
  added: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/api-auth', () => ({
  requireAdmin: async () => auth.user,
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'tenants') {
        return {
          doc: () => ({
            get: async () => ({ data: () => ({ name: 'Hope', plan: 'max' }) }),
            collection: () => ({
              doc: () => ({
                get: async () => ({ exists: true, data: () => ({ enabled: false }) }),
                set: async () => {},
              }),
            }),
          }),
        };
      }
      if (name === 'rag_sources') {
        return {
          where: () => ({
            get: async () => ({ docs: [{ data: () => ({ sourceId: 'live-1' }) }] }),
          }),
        };
      }
      if (name === 'rag_chunks') {
        const query: {
          where: () => typeof query;
          orderBy: () => typeof query;
          limit: () => typeof query;
          get: () => Promise<{ empty: boolean; docs: Array<{ data: () => { sourceId: string; chunk: string } }> }>;
        } = {
          where: () => query,
          orderBy: () => query,
          limit: () => query,
          get: async () => ({
            empty: false,
            docs: [{ data: () => ({ sourceId: 'live-1', chunk: 'Sermon notes on grace. '.repeat(80) }) }],
          }),
        };
        return query;
      }
      if (name === 'blog_posts') {
        return {
          add: async (data: Record<string, unknown>) => {
            store.added = data;
            return { id: 'post-1' };
          },
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => 'ts',
    increment: () => 'inc',
    delete: () => 'delete',
  },
}));

vi.mock('@/lib/ai-config', () => ({
  getMimoChatUrl: () => 'https://mimo.test/chat',
  MIMO_MODEL: 'mimo-test',
}));

vi.mock('@/lib/money-path-sentry', () => ({
  captureHandledError: () => {},
}));

const { GET: automateGet, POST: automatePost } = await import('../automate/route');
const { POST: generatePost, generateAndSavePost } = await import('../generate/route');

const article = {
  seoTitle: 'Grace That Abounds Today',
  seoDescription: 'A short description of grace for readers seeking hope.',
  slug: 'grace-that-abounds',
  keywords: ['grace', 'faith'],
  title: 'Grace That Abounds',
  category: 'Faith',
  tags: ['grace'],
  estimatedReadTime: 5,
  htmlContent: '<h1>Grace That Abounds</h1><p>Grace is unmerited favor.</p>',
};

function asTenantAdmin() {
  auth.user = {
    tenantId: 'grace',
    uid: 'admin-1',
    email: 'admin@grace.test',
    isAdmin: true,
    isSuperAdmin: false,
  };
}

function asSuperAdmin() {
  auth.user = {
    tenantId: null,
    uid: 'super-1',
    email: 'super@harvest.test',
    isAdmin: true,
    isSuperAdmin: true,
  };
}

function settingsGet(tenantId?: string) {
  const params = new URLSearchParams();
  if (tenantId !== undefined) params.set('tenantId', tenantId);
  return {
    headers: { get: () => null },
    nextUrl: { searchParams: params },
  } as never;
}

function postJson(body: unknown) {
  return { json: async () => body, headers: { get: () => null } } as never;
}

beforeEach(() => {
  store.added = null;
  process.env.MIMO_API_KEY = 'mimo-test-key';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(article) }, finish_reason: 'stop' }],
      }),
    })),
  );
});

describe('/api/blog/automate named ministry', () => {
  it('refuses a tenant admin who names another ministry on GET', async () => {
    asTenantAdmin();
    const read = await automateGet(settingsGet('hope'));
    expect(read.status).toBe(403);
  });

  it('refuses a tenant admin who names another ministry on POST', async () => {
    asTenantAdmin();
    const write = await automatePost(postJson({ tenantId: 'hope', enabled: false }));
    expect(write.status).toBe(403);
  });

  it('lets a super admin name another ministry', async () => {
    asSuperAdmin();
    const read = await automateGet(settingsGet('hope'));
    const write = await automatePost(postJson({ tenantId: 'hope', enabled: false }));
    expect(read.status).toBe(200);
    expect(write.status).toBe(200);
    expect((await read.json()).enabled).toBe(false);
  });

  it('answers 400 when no ministry is on the token or the request', async () => {
    asSuperAdmin();
    const read = await automateGet(settingsGet());
    const write = await automatePost(postJson({ enabled: false }));
    expect(read.status).toBe(400);
    expect(write.status).toBe(400);
  });
});

describe('/api/blog/generate named ministry', () => {
  it('refuses a tenant admin who names another ministry', async () => {
    asTenantAdmin();
    const res = await generatePost(postJson({ tenantId: 'hope', topicHint: '' }));
    expect(res.status).toBe(403);
    expect(store.added).toBeNull();
  });

  it('saves a draft when the caller generates for their own ministry', async () => {
    asTenantAdmin();
    const res = await generatePost(postJson({ tenantId: 'grace', topicHint: 'grace' }));
    expect(res.status).toBe(200);
    expect(store.added).toMatchObject({
      tenantId: 'grace',
      status: 'draft',
      publishedAt: null,
    });
  });

  it('lets a super admin name another ministry and saves a draft', async () => {
    asSuperAdmin();
    const res = await generatePost(postJson({ tenantId: 'hope', topicHint: 'grace' }));
    expect(res.status).toBe(200);
    expect(store.added).toMatchObject({
      tenantId: 'hope',
      status: 'draft',
      publishedAt: null,
      title: 'Grace That Abounds',
    });
  });

  it('answers 400 when no ministry is on the token or the request', async () => {
    asSuperAdmin();
    const res = await generatePost(postJson({ topicHint: 'grace' }));
    expect(res.status).toBe(400);
    expect(store.added).toBeNull();
  });
});

describe('generateAndSavePost visibility', () => {
  it('keeps the scheduled job on published when Generate Now is not the caller', async () => {
    const result = await generateAndSavePost('hope', '');
    expect(result.title).toBe('Grace That Abounds');
    expect(store.added).toMatchObject({
      status: 'published',
      tenantId: 'hope',
    });
    expect(typeof store.added?.publishedAt).toBe('string');
  });
});
