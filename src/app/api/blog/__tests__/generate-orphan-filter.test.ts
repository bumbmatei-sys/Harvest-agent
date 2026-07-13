import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAdminDb, state } = vi.hoisted(() => {
  const state: {
    sources: Array<{ sourceId: string }>;
    chunks: Array<{ sourceId: string; chunk: string }>;
    chunkQuery: { ordered: boolean; limit: number | null };
    added: any;
  } = {
    sources: [],
    chunks: [],
    chunkQuery: { ordered: false, limit: null },
    added: null,
  };

  // Minimal chainable Firestore stub. rag_chunks .get() returns state.chunks in
  // order (the test seeds them newest-first to mirror orderBy createdAt desc).
  function collection(name: string) {
    if (name === 'rag_sources') {
      return {
        where: () => ({
          get: async () => ({ docs: state.sources.map((s) => ({ data: () => s })) }),
        }),
      };
    }
    if (name === 'rag_chunks') {
      const q: any = {
        where: () => q,
        orderBy: () => {
          state.chunkQuery.ordered = true;
          return q;
        },
        limit: (n: number) => {
          state.chunkQuery.limit = n;
          return q;
        },
        get: async () => {
          const sliced = state.chunks.slice(0, state.chunkQuery.limit ?? undefined);
          return { empty: sliced.length === 0, docs: sliced.map((c) => ({ data: () => c })) };
        },
      };
      return q;
    }
    if (name === 'tenants') {
      return {
        doc: () => ({
          get: async () => ({ data: () => ({ name: 'Test Ministry', plan: 'max' }) }),
          collection: () => ({ doc: () => ({ set: async () => {} }) }),
        }),
      };
    }
    if (name === 'blog_posts') {
      return {
        add: async (data: any) => {
          state.added = data;
          return { id: 'post-1' };
        },
      };
    }
    throw new Error(`unexpected collection ${name}`);
  }

  return { mockAdminDb: { collection }, state };
});

vi.mock('@/lib/firebase-admin', () => ({ adminDb: mockAdminDb }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'ts', increment: () => 'inc' },
}));
vi.mock('@/lib/ai-config', () => ({
  getMimoChatUrl: () => 'https://mimo.test/chat',
  MIMO_MODEL: 'mimo-test',
}));

const { generateAndSavePost } = await import('../generate/route');

const validPostJson = JSON.stringify({
  seoTitle: 'Grace That Abounds Today',
  seoDescription: 'A short description of grace for readers seeking hope and encouragement.',
  slug: 'grace-that-abounds',
  keywords: ['grace', 'faith'],
  title: 'Grace That Abounds',
  category: 'Faith',
  tags: ['grace'],
  estimatedReadTime: 5,
  htmlContent: '<h1>Grace That Abounds</h1><p>Grace is unmerited favor.</p>',
});

function mockMimoOnce() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: validPostJson } }] }),
    })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MIMO_API_KEY = 'mimo-test-key';
  state.sources = [];
  state.chunks = [];
  state.chunkQuery = { ordered: false, limit: null };
  state.added = null;
});

describe('generateAndSavePost — recency + orphan filtering', () => {
  it('orders chunks by recency and caps at 25', async () => {
    state.sources = [{ sourceId: 'live-1' }];
    state.chunks = [{ sourceId: 'live-1', chunk: 'recent content' }];
    mockMimoOnce();

    await generateAndSavePost('tenant1', '');

    expect(state.chunkQuery.ordered).toBe(true);
    expect(state.chunkQuery.limit).toBe(25);
  });

  it('excludes chunks whose source no longer exists (orphans)', async () => {
    state.sources = [{ sourceId: 'live-1' }];
    state.chunks = [
      { sourceId: 'orphan-old', chunk: 'STALE dev-doc test content' },
      { sourceId: 'live-1', chunk: 'real recent ministry content' },
    ];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: validPostJson } }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await generateAndSavePost('tenant1', '');

    const promptSent = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content;
    expect(promptSent).toContain('real recent ministry content');
    expect(promptSent).not.toContain('STALE dev-doc test content');
  });

  it('throws the add-content message when every chunk is orphaned', async () => {
    state.sources = [{ sourceId: 'live-1' }];
    state.chunks = [{ sourceId: 'deleted-source', chunk: 'orphaned content' }];
    mockMimoOnce();

    await expect(generateAndSavePost('tenant1', '')).rejects.toThrow(
      /No knowledge base content found/i,
    );
  });

  it('throws the add-content message when there are no chunks at all', async () => {
    state.sources = [{ sourceId: 'live-1' }];
    state.chunks = [];
    mockMimoOnce();

    await expect(generateAndSavePost('tenant1', '')).rejects.toThrow(
      /No knowledge base content found/i,
    );
  });
});
