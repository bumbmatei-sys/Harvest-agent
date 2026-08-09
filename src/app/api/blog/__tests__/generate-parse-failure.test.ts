import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Which failure the generator REPORTS (JAVASCRIPT-NEXTJS-8).
 *
 * A model response that won't parse used to raise "Add ministry-focused source
 * material (sermons, devotionals, teaching notes)…" — telling the tenant to go
 * upload sermons to fix what is actually a JSON formatting fault. `bumb` has 4
 * sources and 59 chunks; the content was never the problem.
 *
 * The add-source-material message is correct for exactly one situation — there
 * was little or nothing to write from — and these tests hold that line in both
 * directions.
 */

const { mockAdminDb, state } = vi.hoisted(() => {
  const state: {
    sources: Array<{ sourceId: string }>;
    chunks: Array<{ sourceId: string; chunk: string }>;
    added: any;
  } = { sources: [], chunks: [], added: null };

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
        orderBy: () => q,
        limit: () => q,
        get: async () => ({
          empty: state.chunks.length === 0,
          docs: state.chunks.map((c) => ({ data: () => c })),
        }),
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

const { generateAndSavePost, BlogGenerationError } = await import('../generate/route');

/** The message that blames the tenant's content. */
const ADD_SOURCE_MATERIAL = /Add ministry-focused source material/i;

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

/** Comfortably past MIN_CONTEXT_CHARS_FOR_ARTICLE (800). */
const SUBSTANTIAL_CHUNK = 'Sermon notes on grace, mercy and the life of the church. '.repeat(30);

function mimoReturns(content: string, finishReason = 'stop') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content }, finish_reason: finishReason }],
      }),
    })),
  );
}

function withSubstantialContext() {
  state.sources = [{ sourceId: 'live-1' }];
  state.chunks = [{ sourceId: 'live-1', chunk: SUBSTANTIAL_CHUNK }];
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MIMO_API_KEY = 'mimo-test-key';
  state.sources = [];
  state.chunks = [];
  state.added = null;
});

describe('generateAndSavePost — reports the failure that actually occurred', () => {
  it('invalid JSON WITH context present gives a parse-failure message, not add-source-material', async () => {
    withSubstantialContext();
    mimoReturns('I am sorry, I cannot help with that request.');

    await expect(generateAndSavePost('bumb', '')).rejects.toThrow(BlogGenerationError);

    const err = await generateAndSavePost('bumb', '').catch((e) => e);
    expect(err.kind).toBe('invalid-json');
    // The whole point: it must NOT send the admin off to upload sermons.
    expect(err.message).not.toMatch(ADD_SOURCE_MATERIAL);
    expect(err.message).toMatch(/format|read/i);
    expect(err.diagnostics.contextChars).toBeGreaterThan(800);
  });

  it('the reverse case — NO retrieved context still gives the content message', async () => {
    state.sources = [{ sourceId: 'live-1' }];
    state.chunks = [];
    mimoReturns(JSON.stringify(article));

    const err = await generateAndSavePost('bumb', '').catch((e) => e);
    expect(err.kind).toBe('no-context');
    expect(err.message).toMatch(/No knowledge base content found/i);
  });

  it('the reverse case — THIN context plus invalid JSON still gives add-source-material', async () => {
    state.sources = [{ sourceId: 'live-1' }];
    state.chunks = [{ sourceId: 'live-1', chunk: 'Short note.' }];
    mimoReturns('not json at all');

    const err = await generateAndSavePost('bumb', '').catch((e) => e);
    expect(err.kind).toBe('no-context');
    expect(err.message).toMatch(ADD_SOURCE_MATERIAL);
  });

  it('a response truncated at the token ceiling is reported as truncation, not bad content', async () => {
    withSubstantialContext();
    // Cut mid-article: the JSON never closes its braces.
    mimoReturns(JSON.stringify(article).slice(0, 120), 'length');

    const err = await generateAndSavePost('bumb', '').catch((e) => e);
    expect(err.kind).toBe('truncated-output');
    expect(err.message).not.toMatch(ADD_SOURCE_MATERIAL);
    expect(err.message).toMatch(/cut off|ran out of room/i);
    expect(err.diagnostics.finishReason).toBe('length');
  });
});

describe('generateAndSavePost — response shapes that must parse', () => {
  it('parses a ```json fenced response', async () => {
    withSubstantialContext();
    mimoReturns('```json\n' + JSON.stringify(article) + '\n```');

    const result = await generateAndSavePost('bumb', '');
    expect(result.title).toBe('Grace That Abounds');
  });

  it('parses a response wrapped in prose', async () => {
    withSubstantialContext();
    mimoReturns('Certainly! Here is the article:\n' + JSON.stringify(article) + '\nHope it helps.');

    const result = await generateAndSavePost('bumb', '');
    expect(result.title).toBe('Grace That Abounds');
  });

  it('parses htmlContent laid out across real line breaks', async () => {
    withSubstantialContext();
    // JSON forbids a literal newline inside a string, and a model writing a long
    // article is very likely to produce exactly this. The repair pass escapes
    // the control characters rather than losing an otherwise perfect article.
    mimoReturns(
      '{\n' +
        '  "seoTitle": "Grace That Abounds Today",\n' +
        '  "seoDescription": "A short description of grace.",\n' +
        '  "slug": "grace-that-abounds",\n' +
        '  "title": "Grace That Abounds",\n' +
        '  "htmlContent": "<h1>Grace That Abounds</h1>\n' +
        '    <p>Grace is unmerited favor.</p>\n' +
        '    <h2>Conclusion</h2>\n' +
        '    <p>Walk in it.</p>"\n' +
        '}',
    );

    const result = await generateAndSavePost('bumb', '');
    expect(result.title).toBe('Grace That Abounds');
    expect(state.added.content).toContain('<h2>Conclusion</h2>');
  });
});

describe('generateAndSavePost — diagnostics for the next occurrence', () => {
  it('attaches the raw model output and finish_reason to the error', async () => {
    withSubstantialContext();
    mimoReturns('Sorry, I will not write that.', 'stop');

    const err = await generateAndSavePost('bumb', '').catch((e) => e);

    expect(err.diagnostics.rawResponseExcerpt).toBe('Sorry, I will not write that.');
    expect(err.diagnostics.rawResponseLength).toBe('Sorry, I will not write that.'.length);
    expect(err.diagnostics.finishReason).toBe('stop');
    expect(err.diagnostics.chunksUsed).toBe(1);
    expect(err.diagnostics.failureKind).toBe('invalid-json');
  });

  it('records an empty model response as such rather than losing it', async () => {
    withSubstantialContext();
    mimoReturns('', 'stop');

    const err = await generateAndSavePost('bumb', '').catch((e) => e);
    expect(err.kind).toBe('invalid-json');
    expect(err.diagnostics.rawResponseLength).toBe(0);
  });
});
