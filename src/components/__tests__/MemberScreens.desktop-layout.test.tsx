import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * THE-190 batch H — the seven member-app screens, and the reading measure.
 *
 * The member app had four surfaces whose content is PROSE — a Bible chapter,
 * an Ask Harvest thread, a news feed and a Messages thread — and four different
 * answers to how wide prose should be, none of them named:
 *
 *   AllNews feed        `lg:max-w-2xl`      609.0px   (42rem at the 14.5px base)
 *   Ask Harvest thread  `lg:max-w-3xl`      696.0px   (48rem, plus an inline COPY)
 *   Bible chapter       `lg:max-w-[760px]`  760.0px
 *   Messages thread     — none —            unbounded: 994.08px of prose at 1920px
 *
 * form-layout.ts gains Rule 6, `READING_MEASURE`, at 680px, and those four take
 * it. NewsTab does NOT: it is a data-dense page with a 340px rail beside it, so
 * it takes Rule 1a's page measure. Which surface took which is the subject of
 * "a reading surface uses a reading measure, not the form measure" below —
 * naming it is the point of that test.
 *
 * TWO files in scope are deliberately UNCHANGED, and each has a test saying so
 * rather than a silent absence:
 *
 *   MainApp.tsx        the member shell. Every screen renders inside it, Profile
 *                      included (PR 346/347), so a container change here would
 *                      silently resize an already-converted screen. It does not
 *                      need one: every screen it mounts can cap itself, and five
 *                      of them now do.
 *   LivestreamView.tsx already capped, at `lg:max-w-[1280px]`. It is a
 *                      full-viewport overlay — it replaces the shell rather than
 *                      rendering inside it — so the 1120px page measure, which
 *                      is derived from the shell's 275.5px of chrome, is the
 *                      wrong derivation for it. Its dark values (PR 337) are
 *                      pinned here too.
 *
 * Every rule this PR adds is `lg:`-gated, or is a `sm:` cap wider than any
 * phone or tablet viewport, so NOTHING below 1024px moves — which the mobile
 * layer test below pins per file against a mechanically extracted baseline.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─────────────────────────────────────────────────────────────────────────────
// Mocks. One set, shared by the baseline recorder and the assertions — the
// lesson ChurchEnrollment.desktop-layout.test.tsx paid for.
// ─────────────────────────────────────────────────────────────────────────────
const LOREM = 'The Lord is my shepherd; I shall not want. He maketh me to lie down in green pastures: he leadeth me beside the still waters. He restoreth my soul.';

const fx = vi.hoisted(() => ({ lorem: 'The Lord is my shepherd; I shall not want. He maketh me to lie down in green pastures: he leadeth me beside the still waters. He restoreth my soul.' }));

vi.mock('../../firebase', () => ({
  db: {}, auth: { currentUser: { uid: 'me', email: 'me@t.com', displayName: 'Maria Bumb' } },
}));
vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => 'tenant-1',
  getWriteTenantScope: async () => 'tenant-1',
  isPlatformContext: () => false,
  hasPlatformOverride: () => false,
  PLATFORM_TENANT_ID: 'harvest',
}));
vi.mock('firebase/firestore', () => {
  const snapOf = (rows: any[]) => ({
    docs: rows.map((r) => ({ id: r.id, data: () => r, exists: () => true })),
    forEach: (cb: any) => rows.forEach((r) => cb({ id: r.id, data: () => r, exists: () => true })),
    size: rows.length, empty: rows.length === 0,
  });
  const posts = Array.from({ length: 3 }, (_, i) => ({
    id: `p${i}`, type: 'post', authorId: 'admin', authorName: 'Pastor Adams',
    createdAt: new Date(2026, 0, 4 + i).toISOString(),
    content: `${fx.lorem} ${fx.lorem}`, likes: ['a'], comments: [], tenantId: 'tenant-1',
    title: `Sunday Gathering ${i + 1}`,
  }));
  const msgs = [
    { id: 'm1', senderId: 'admin', senderName: 'Pastor Adams', senderRole: 'church_admin', content: fx.lorem, createdAt: { toMillis: () => 1, toDate: () => new Date(2026, 0, 5) } },
    { id: 'm2', senderId: 'me', senderName: 'Maria Bumb', senderRole: 'user', content: `${fx.lorem} ${fx.lorem}`, createdAt: { toMillis: () => 2, toDate: () => new Date(2026, 0, 5) } },
  ];
  return {
    collection: (_d: unknown, ...s: string[]) => ({ __path: s.join('/') }),
    doc: (_d: unknown, ...s: string[]) => ({ __path: s.join('/') }),
    query: (c: any, ...a: unknown[]) => ({ __path: c?.__path, a }),
    where: () => ({}), orderBy: () => ({}), limit: () => ({}),
    getDoc: async () => ({ exists: () => true, data: () => ({ displayName: 'Maria Bumb', role: 'user', tenantId: 'tenant-1' }) }),
    getDocs: async (q: any) => snapOf(String(q?.__path).includes('community_posts') ? posts : []),
    getCountFromServer: async () => ({ data: () => ({ count: 3 }) }),
    onSnapshot: (q: any, cb: any) => {
      const p = String(q?.__path ?? '');
      queueMicrotask(() => {
        if (typeof cb !== 'function') return;
        if (p.includes('comments')) return cb(snapOf(Array.from({ length: 3 }, (_, i) => ({ id: `k${i}`, name: 'Grace Miller', text: fx.lorem.slice(0, 70) }))));
        if (p.includes('livestream')) return cb({ exists: () => true, data: () => ({ active: true, sessionId: 's1', youtubeVideoId: 'abc123', title: 'Sunday Morning Service', viewerCount: 42, sermonNote: { title: 'The Good Shepherd', contentHtml: `<p>${fx.lorem}</p>` } }) });
        if (p.includes('community_posts')) return cb(snapOf(posts));
        if (p.includes('channels')) return cb(snapOf([{ id: 'c1', name: 'general', members: ['me'], lastMessage: 'Welcome to the church family channel.', lastMessageAt: { toMillis: () => 3, toDate: () => new Date(2026, 0, 5) } }]));
        if (p.includes('directMessages')) return cb(snapOf([{ id: 'd1', participants: ['me', 'admin'], participantNames: { admin: 'Pastor Adams' }, participantRoles: { admin: 'church_admin' }, lastMessage: fx.lorem.slice(0, 60), lastMessageAt: { toMillis: () => 2, toDate: () => new Date(2026, 0, 5) } }]));
        if (/Messages$/.test(p)) return cb(snapOf(msgs));
        return cb(snapOf([]));
      });
      return () => {};
    },
    addDoc: async () => ({ id: 'x' }), updateDoc: async () => {}, deleteDoc: async () => {},
    setDoc: async () => {}, serverTimestamp: () => 'ts', deleteField: () => 'del',
    arrayUnion: (v: unknown) => v, arrayRemove: (v: unknown) => v,
    Timestamp: class { toMillis() { return 0; } },
  };
});
vi.mock('next/image', () => ({ default: (p: any) => <img src={typeof p.src === 'string' ? p.src : ''} alt={p.alt ?? ''} width={p.width} height={p.height} className={p.className} /> }));
vi.mock('react-markdown', () => ({ default: (p: any) => <div>{p.children}</div> }));
vi.mock('../../utils/auth-fetch', () => ({ authFetch: async () => ({ ok: true, json: async () => ({}) }) }));
vi.mock('../../utils/send-notification', () => ({ sendPushNotification: async () => {} }));
vi.mock('../../utils/firestore-errors', () => ({ OperationType: new Proxy({}, { get: (_t, k) => k }), handleFirestoreError: () => {} }));
vi.mock('../../utils/super-admins', () => ({ isSuperAdminEmail: () => false }));
vi.mock('../../utils/tenant.utils', () => ({ checkRosterAdmin: async () => false }));
vi.mock('../../lib/dm', () => ({ getOrCreateDm: async () => 'dm1' }));
vi.mock('../../utils/share-url', () => ({ useShareBaseUrl: () => 'https://t.harvest.app', usePublicShareUrl: () => 'https://t.harvest.app/x', buildShareUrl: () => 'https://t.harvest.app/x' }));
vi.mock('../../hooks/usePlanGate', () => ({ usePlanGate: () => ({ allowed: true, loading: false, plan: 'max', features: {} }) }));
vi.mock('../../hooks/useLiveNow', () => ({ useLiveNow: () => ({ live: true, videoId: 'abc', title: 'Sunday Service' }) }));
vi.mock('../../hooks/queries/useCampaignQueries', () => ({ useCampaigns: () => ({ data: [], isLoading: false }) }));
vi.mock('../../contexts/TenantContext', () => ({ useTenant: () => ({ tenant: { id: 'tenant-1', name: 'Harvest' }, loading: false }) }));
vi.mock('../../contexts/SavedItemsContext', () => ({ useSavedItems: () => ({ items: [], isSaved: () => false, toggle: () => {}, save: () => {}, remove: () => {} }) }));
vi.mock('../../utils/plan-features', async (orig) => ({
  ...(await (orig as any)()),
  getPlanFeatures: () => ({ communityGroups: true, map: true, courses: true, aiChat: true, bible: true }),
}));
vi.mock('../../utils/member-courses', () => ({ hasMemberVisibleCourses: async () => true }));
vi.mock('../TipTapReadOnly', () => ({ default: (p: any) => <div dangerouslySetInnerHTML={{ __html: p.contentHtml ?? '' }} /> }));

// The Bible reader fetches its chapter and translation list over HTTP.
const VERSES = [
  'In the beginning God created the heaven and the earth. And the earth was without form, and void; and darkness was upon the face of the deep.',
  'And the Spirit of God moved upon the face of the waters. And God said, Let there be light: and there was light.',
  'And God saw the light, that it was good: and God divided the light from the darkness.',
];
globalThis.fetch = (async (url: any) => {
  if (String(url).includes('available_translations')) {
    return { ok: true, json: async () => ({ translations: [{ id: 'BSB', name: 'Berean Standard Bible', englishName: 'Berean Standard Bible', shortName: 'BSB', language: 'eng', licenseUrl: 'https://x' }] }) };
  }
  return { ok: true, json: async () => ({ chapter: { content: VERSES.map((t, i) => ({ type: 'verse', number: i + 1, content: [t] })) } }) };
}) as any;

const {
  mobileLayer, colourTokens, allTokens, maxWidthTokens, maxWidthPx,
  isResponsive, breakpointOf, heightTokens, heightPx, arbitraryPx,
  REM_PX_MOBILE, REM_PX_DESKTOP,
} = await import('../../test/support/class-inventory');
const {
  FORM_CONTAINER, FORM_MEASURE, CONTAINERS, READING_MEASURE, READING_MEASURE_PX,
  READING_MIN_PX, SPLIT_MIN_PX,
} = await import('../layout/form-layout');

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.resolve(__dirname, '..');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

/**
 * Source with every comment removed. Necessary, not cosmetic: this PR's own
 * comments QUOTE the values they retire — `lg:max-w-2xl`, `maxWidth: "48rem"` —
 * so a "this token is gone" assertion run over raw source passes only while the
 * change is undocumented, which is precisely backwards. The `//` case guards
 * the `:` of a URL so `https://…` inside a comment is not half-eaten.
 */
const stripComments = (s: string) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const code = (rel: string) => stripComments(read(rel));

/** The revision this PR branched from — the "before" every baseline is taken at. */
const PRE_PR_REVISION = '29769c6';
const at = (rel: string) =>
  execSync(`git show ${PRE_PR_REVISION}:src/components/${rel}`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

/**
 * The seven files in scope, and how each is mounted. Order is the brief's.
 * `UserMessages` and `AIChat` are each mounted twice — the list/empty state AND
 * the open thread — because the thread is the reading surface and it is behind
 * a click.
 */
const FIXTURES = path.join(__dirname, '__fixtures__');
const RECORDING = !!process.env.UPDATE_LAYOUT_BASELINE;
const FIXTURE = path.join(FIXTURES, 'member-screens-mobile.json');

interface Baseline { [surface: string]: { mobileLayer: string[]; colours: string[]; heights: string[] } }

interface Mounted { container: HTMLDivElement; unmount: () => void }
/**
 * Every surface is mounted ONCE, in beforeAll, and stays mounted for the whole
 * file. It must not be torn down between tests: `mobileLayer` and friends read
 * the live DOM, and React empties a container on unmount — an afterEach here
 * silently turned every assertion after the first into a comparison against an
 * empty subtree.
 */
let mounted: Mounted | null = null;
afterAll(() => { mounted?.unmount(); mounted = null; });

async function mount(el: React.ReactElement): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root!: Root;
  await act(async () => { root = createRoot(container); root.render(el); await Promise.resolve(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
  return { container, unmount: () => { act(() => root.unmount()); container.remove(); } };
}

const click = async (el: Element) => {
  await act(async () => { el.dispatchEvent(new Event('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 120)); });
};

/** Every surface, built from the component modules currently on disk. */
async function surfaces(): Promise<Record<string, HTMLDivElement>> {
  const out: Record<string, HTMLDivElement> = {};
  const keep: Mounted[] = [];
  const add = async (name: string, el: React.ReactElement) => {
    const m = await mount(el); keep.push(m); out[name] = m.container; return m.container;
  };
  const MainApp = (await import('../MainApp')).default;
  const NewsTab = (await import('../NewsTab')).default;
  const AllNews = (await import('../AllNews')).default;
  const BiblePage = (await import('../BiblePage')).default;
  const UserMessages = (await import('../UserMessages')).default;
  const AIChat = (await import('../AIChat')).default;
  const LivestreamView = (await import('../LivestreamView')).default;

  await add('MainApp', <MainApp onNavigate={() => {}} />);
  await add('NewsTab', <NewsTab tenantId="tenant-1" onOpenAllNews={() => {}} onOpenArticle={() => {}} onOpenLivestream={() => {}} onGoToPartner={() => {}} onOpenMessages={() => {}} />);
  await add('AllNews', <AllNews onBack={() => {}} onOpenMessages={() => {}} />);
  await add('BiblePage', <BiblePage />);
  await add('LivestreamView', <LivestreamView tenantId="tenant-1" onBack={() => {}} onDonate={() => {}} />);

  const um = await add('UserMessages', <UserMessages embedded onBack={() => {}} />);
  const dm = [...um.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Pastor Adams'));
  if (!dm) throw new Error('no DM row — UserMessages seeding changed, test needs updating');
  await click(dm);
  out.UserMessagesThread = um;

  localStorage.setItem('harvest_ai_chats', JSON.stringify([{
    id: 'h1', title: 'Who is the Good Shepherd?', preview: LOREM.slice(0, 40), date: new Date(2026, 0, 5).toISOString(),
    messages: [
      { id: 'a1', role: 'user', text: 'Who is the Good Shepherd, and what does the image mean in John 10?', time: '09:12' },
      { id: 'a2', role: 'ai', text: `${LOREM} ${LOREM}`, time: '09:12' },
    ],
  }]));
  const ai = await add('AIChat', <AIChat onBack={() => {}} />);
  const row = [...ai.querySelectorAll('div')].find((d) => (d.textContent ?? '').trim() === 'Who is the Good Shepherd?');
  if (!row) throw new Error('no history row — AIChat seeding changed, test needs updating');
  await click(row);
  out.AIChatThread = ai;
  localStorage.removeItem('harvest_ai_chats');

  mounted = { container: keep[0].container, unmount: () => keep.forEach((m) => m.unmount()) };
  return out;
}

/** The heights a surface renders, as class tokens — the touch-target pin. */
const heightLayer = (root: ParentNode): string[] =>
  [...root.querySelectorAll('*')]
    .map((el, i) => `${i}\t${heightTokens(el).join(' ')}`)
    .filter((r) => r.split('\t')[1]);

let BASELINE!: Baseline;
let SURFACES!: Record<string, HTMLDivElement>;

const SCOPE = ['NewsTab', 'MainApp', 'UserMessages', 'BiblePage', 'LivestreamView', 'AllNews', 'AIChat'] as const;
const ALL_SURFACES = [...SCOPE, 'UserMessagesThread', 'AIChatThread'] as const;

beforeAll(async () => {
  if (RECORDING) {
    // Restore all seven in-scope files to the pre-PR revision, record, put back.
    const backup = new Map(SCOPE.map((n) => [n, read(`${n}.tsx`)] as const));
    const layoutBackup = readFileSync(path.join(SRC, 'layout/form-layout.ts'), 'utf8');
    try {
      for (const n of SCOPE) writeFileSync(path.join(SRC, `${n}.tsx`), at(`${n}.tsx`));
      writeFileSync(path.join(SRC, 'layout/form-layout.ts'), execSync(`git show ${PRE_PR_REVISION}:src/components/layout/form-layout.ts`, { cwd: ROOT, encoding: 'utf8' }));
      vi.resetModules();
      const pre = await surfaces();
      const rec: Baseline = {};
      for (const k of ALL_SURFACES) rec[k] = { mobileLayer: mobileLayer(pre[k]), colours: colourTokens(pre[k]), heights: heightLayer(pre[k]) };
      writeFileSync(FIXTURE, JSON.stringify(rec, null, 2) + '\n');
      mounted?.unmount(); mounted = null;
    } finally {
      for (const [n, src] of backup) writeFileSync(path.join(SRC, `${n}.tsx`), src);
      writeFileSync(path.join(SRC, 'layout/form-layout.ts'), layoutBackup);
      vi.resetModules();
    }
  }
  BASELINE = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Baseline;
  SURFACES = await surfaces();
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. The one that matters most — one test per file.
// ═════════════════════════════════════════════════════════════════════════════
describe('the sub-640px rendering of each file is unchanged', () => {
  it.each(ALL_SURFACES)('%s renders the same class layer below 640px as it did before', (name) => {
    expect(mobileLayer(SURFACES[name])).toEqual(BASELINE[name].mobileLayer);
  });

  it('gates every rule this PR applies above the phone range — nothing is unprefixed', () => {
    const tokens = [FORM_CONTAINER, READING_MEASURE].flatMap((r) => r.split(/\s+/).filter(Boolean));
    expect(tokens.filter((t) => !isResponsive(t)), 'these would apply at every width, mobile included').toEqual([]);
  });

  it('gates the reading measure at lg, where the member shell itself becomes desktop', () => {
    const gates = new Set(READING_MEASURE.split(/\s+/).filter(Boolean).map(breakpointOf));
    expect([...gates]).toEqual(['lg']);
    expect(READING_MIN_PX).toBe(SPLIT_MIN_PX);
    expect(READING_MIN_PX).toBe(1024);
  });

  it('leaves the page measure inert below its own width, so no tablet moves either', () => {
    // FORM_CONTAINER is `sm:`-gated (Rule 1a's own gate, unchanged), so on
    // NewsTab it becomes live at 640px — but a maximum of 1120px cannot bind a
    // viewport narrower than 1120px, so it changes nothing until then.
    expect(maxWidthPx(FORM_CONTAINER.split(/\s+/)[0])).toBe(1120);
    expect(1120).toBeGreaterThan(1023);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Touch targets.
// ═════════════════════════════════════════════════════════════════════════════
describe('no touch target got smaller', () => {
  it.each(ALL_SURFACES)('%s renders the same height tokens on the same elements', (name) => {
    expect(heightLayer(SURFACES[name])).toEqual(BASELINE[name].heights);
  });

  it('adds no height rule at all — every token this PR adds is a width or a margin', () => {
    const added = [FORM_CONTAINER, READING_MEASURE].join(' ').split(/\s+/).filter(Boolean);
    expect(added.filter((t) => heightPx(t, REM_PX_DESKTOP) !== null)).toEqual([]);
    expect(added.filter((t) => heightPx(t, REM_PX_MOBILE) !== null)).toEqual([]);
    for (const t of added) expect(t).toMatch(/^(?:sm|lg):(?:max-w-|mx-auto)/);
  });

  it('asserts only that nothing SHRANK — it does not impose a 44px floor (THE-190)', () => {
    // Many existing targets are under 44px, unprefixed, and deliberately left
    // alone. The pin above is an equality against the recorded baseline, which
    // catches a shrink and a growth alike without naming a minimum. This test
    // states that absence so a later reader does not "fix" it into a floor.
    const everyHeight = ALL_SURFACES.flatMap((n) =>
      BASELINE[n].heights.flatMap((r) => r.split('\t')[1].split(' ')))
      .map((t) => heightPx(t, REM_PX_MOBILE)).filter((v): v is number => v !== null);
    expect(everyHeight.some((h) => h < 44), 'the baseline has no sub-44px target left to protect').toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Rule 1/6 — every surface is bounded at desktop widths.
// ═════════════════════════════════════════════════════════════════════════════
/** The measure-bearing elements a surface renders, with their px value. */
const capsOf = (root: ParentNode): number[] =>
  [...root.querySelectorAll('*')]
    .flatMap((el) => maxWidthTokens(el))
    .map(maxWidthPx).filter((v): v is number => v !== null);

describe('each surface is constrained at desktop widths', () => {
  it('NewsTab caps its two-column band at the page measure', () => {
    const root = SURFACES.NewsTab.firstElementChild!;
    expect(root.className).toContain(FORM_CONTAINER);
    expect(capsOf(SURFACES.NewsTab)).toContain(1120);
  });

  it('AllNews caps its feed and its header at the reading measure', () => {
    const capped = [...SURFACES.AllNews.querySelectorAll('div')]
      .filter((d) => d.className.includes(READING_MEASURE));
    expect(capped.length, 'the feed and the sticky header both take it').toBe(2);
  });

  it('BiblePage caps the chapter, the chapter pager AND the search tab', () => {
    const c = SURFACES.BiblePage;
    const capped = [...c.querySelectorAll('div')].filter((d) => d.className.includes(READING_MEASURE));
    expect(capped.length, 'read tab column + pager are capped').toBeGreaterThanOrEqual(2);
    // The search tab is behind a tab switch, and it had NO cap before this PR.
    const src = read('BiblePage.tsx');
    const searchBlock = src.slice(src.indexOf('── SEARCH TAB ──'));
    expect(searchBlock).toContain('READING_MEASURE');
  });

  it('the Ask Harvest thread and its composer are capped at the reading measure', () => {
    const capped = [...SURFACES.AIChatThread.querySelectorAll('div,p')]
      .filter((el) => el.className.toString().includes(READING_MEASURE));
    expect(capped.length, 'thread + composer + disclaimer').toBe(3);
  });

  it('the Messages thread and its composer are capped — they had no maximum at all', () => {
    const capped = [...SURFACES.UserMessagesThread.querySelectorAll('div')]
      .filter((d) => d.className.includes(READING_MEASURE));
    expect(capped.length, 'message list + composer pill').toBeGreaterThanOrEqual(2);
    expect(at('UserMessages.tsx'), 'it really had none before').not.toMatch(/lg:max-w-/);
  });

  it('LivestreamView was already capped, and this PR leaves that cap alone', () => {
    expect(capsOf(SURFACES.LivestreamView)).toContain(1280);
    expect(read('LivestreamView.tsx')).toBe(at('LivestreamView.tsx'));
  });

  it('no surface is left unbounded — every one of the seven now carries a maximum', () => {
    const unbounded = SCOPE.filter((n) => {
      if (n === 'MainApp') return false;               // the shell; see its own test
      const root = n === 'UserMessages' ? SURFACES.UserMessagesThread
        : n === 'AIChat' ? SURFACES.AIChatThread : SURFACES[n];
      return capsOf(root).length === 0;
    });
    expect(unbounded).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. WHICH measure — the decision this PR is actually making.
// ═════════════════════════════════════════════════════════════════════════════
describe('a reading surface uses a reading measure, not the form measure', () => {
  it('names the four reading surfaces, and they take READING_MEASURE', () => {
    const READING = ['AllNews.tsx', 'BiblePage.tsx', 'AIChat.tsx', 'UserMessages.tsx'];
    for (const f of READING) {
      expect(read(f), `${f} is a reading surface and must take Rule 6`).toContain('READING_MEASURE');
      expect(read(f), `${f} must not take the form measure`).not.toContain('FORM_MEASURE');
    }
  });

  it('names the one that is NOT a reading surface: NewsTab takes the PAGE measure', () => {
    // A feed with a composer, poll cards, event cards, a campaign widget and a
    // 340px rail is a data-dense page, not a column of prose.
    expect(read('NewsTab.tsx')).toContain('FORM_CONTAINER');
    expect(read('NewsTab.tsx')).not.toContain('READING_MEASURE');
    expect(read('NewsTab.tsx')).not.toContain('FORM_MEASURE');
  });

  it('no in-scope screen takes the FORM measure — none of the seven is a form', () => {
    for (const n of SCOPE) expect(read(`${n}.tsx`), `${n} is not a form`).not.toContain('FORM_MEASURE');
    expect(FORM_MEASURE).toBe('sm:max-w-[940px] sm:mx-auto');
  });

  it('is 680px, and is NOT a member of CONTAINERS — that pair is the two sm: measures', () => {
    expect(maxWidthPx(READING_MEASURE.split(/\s+/)[0])).toBe(READING_MEASURE_PX);
    expect(READING_MEASURE_PX).toBe(680);
    expect(CONTAINERS).toEqual([FORM_CONTAINER, FORM_MEASURE]);
    expect(CONTAINERS).not.toContain(READING_MEASURE);
  });

  it('retires all three rem measures it replaces — none survives anywhere in scope', () => {
    // `max-w-2xl` (609px) and `max-w-3xl` (696px) are the rem trap live: their
    // names say 672 and 768, globals.css's 14.5px desktop base says otherwise.
    for (const n of SCOPE) {
      const src = read(`${n}.tsx`);
      // LivestreamView keeps its own untouched `max-w-2xl`, which is an
      // UNPREFIXED mobile cap on a full-screen overlay, not a desktop measure.
      if (n === 'LivestreamView') continue;
      expect(stripComments(src), `${n} still spells a rem container measure`).not.toMatch(/lg:max-w-(?:2xl|3xl|760px)/);
    }
    expect(at('AllNews.tsx')).toMatch(/lg:max-w-2xl/);
    expect(at('AIChat.tsx')).toMatch(/lg:max-w-3xl/);
    expect(at('BiblePage.tsx')).toMatch(/lg:max-w-\[760px\]/);
  });

  it('invents no width: every desktop max-width in scope is form-layout’s or pre-existing', () => {
    const NAMED = new Set([1120, 940, 680, 160, 280, 440, 760]);
    const PRE_EXISTING = new Set([1280]);          // LivestreamView's stage, untouched
    for (const n of SCOPE) {
      const src = read(`${n}.tsx`);
      const found = [...src.matchAll(/(?:^|["'` ])((?:sm|md|lg|xl|2xl):max-w-\[[\d.]+px\])/g)].map((m) => m[1]);
      for (const t of found) {
        const px = maxWidthPx(t)!;
        expect(NAMED.has(px) || PRE_EXISTING.has(px), `${n} spells ${t}, a width no rule names`).toBe(true);
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. The shell.
// ═════════════════════════════════════════════════════════════════════════════
describe("the member shell's container is unchanged", () => {
  it('MainApp.tsx is byte-identical to the revision this PR branched from', () => {
    expect(read('MainApp.tsx')).toBe(at('MainApp.tsx'));
  });

  it('DesktopContainer — the shell’s content column — is byte-identical too', () => {
    expect(read('layout/DesktopLayout.tsx')).toBe(at('layout/DesktopLayout.tsx'));
  });

  it('the shell imports no rule from form-layout, so it cannot resize a screen inside it', () => {
    expect(read('MainApp.tsx')).not.toMatch(/from '\.\/layout\/form-layout'/);
    expect(read('layout/DesktopLayout.tsx')).not.toMatch(/form-layout/);
  });

  it('the shell still carries no maximum of its own — each screen caps itself', () => {
    // Profile (PR 346/347) mounts in the same `w-full` wrapper as AIChat and the
    // Bible and is NOT in this batch's scope. A cap on the shell would have
    // resized it silently; that is exactly why the cap went on the screens.
    expect(read('layout/DesktopLayout.tsx')).toContain('lg:w-full lg:px-6 xl:px-8');
    expect(code('layout/DesktopLayout.tsx')).not.toMatch(/max-w/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. The AIChat guard.
// ═════════════════════════════════════════════════════════════════════════════
describe('conflicting inline widths are removed, not overridden', () => {
  it('the disclaimer no longer carries an inline maxWidth — the class is not shadowed', () => {
    const before = at('AIChat.tsx');
    expect(before, 'the "before" really did carry it').toMatch(/maxWidth:\s*"48rem"/);
    expect(code('AIChat.tsx'), 'an inline width always beats a class').not.toMatch(/maxWidth:\s*"48rem"/);
  });

  it('the disclaimer renders the class and no inline width at all', () => {
    const p = [...SURFACES.AIChatThread.querySelectorAll('p')]
      .find((el) => (el.textContent ?? '').includes('can make mistakes'));
    expect(p, 'the disclaimer is gone — markup changed, test needs updating').toBeDefined();
    expect(p!.className).toContain(READING_MEASURE);
    expect(p!.style.maxWidth, 'a surviving inline width would render the class inert').toBe('');
  });

  it('the `auto` side margins moved to the rule too — the shorthand carried both', () => {
    const p = [...SURFACES.AIChatThread.querySelectorAll('p')]
      .find((el) => (el.textContent ?? '').includes('can make mistakes'))!;
    expect(at('AIChat.tsx')).toMatch(/margin:\s*"8px auto 0"/);
    expect(p.style.margin).toBe('');
    expect(p.style.marginTop).toBe('8px');
    expect(READING_MEASURE).toContain('lg:mx-auto');
  });

  it('leaves every OTHER inline width in AIChat alone — they are not measures', () => {
    const src = read('AIChat.tsx');
    // The 280px history rail is a RAIL, the 78% bubble cap is a bubble, and the
    // 280px empty-state line is a paragraph of copy. None competes with a rule.
    expect(src).toMatch(/width:\s*280,\s*background:\s*CARD/);
    expect(src).toMatch(/maxWidth:\s*"78%"/);
    expect(src).toMatch(/marginBottom:\s*28,\s*maxWidth:\s*280/);
  });

  it('no other in-scope file layers a rule over a surviving inline width', () => {
    for (const n of SCOPE) {
      const src = read(`${n}.tsx`);
      // Every element that takes a rule, and the inline style on that same tag.
      for (const m of src.matchAll(/className=\{`[^`]*(?:READING_MEASURE|FORM_CONTAINER)[^`]*`\}([^>]*)>/g)) {
        expect(m[1], `${n} layers a rule over an inline maxWidth`).not.toMatch(/maxWidth/);
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. LivestreamView's deliberate dark values (PR 337).
// ═════════════════════════════════════════════════════════════════════════════
describe("LivestreamView's deliberate dark values are unchanged", () => {
  it('keeps the #0b1121 stage, the bg-black video frame and the black/50 scrim', () => {
    const src = read('LivestreamView.tsx');
    expect(src).toContain('bg-[#0b1121]');
    expect(src).toMatch(/className="w-full bg-black/);
    expect(src).toContain('bg-black/50');
  });

  it('renders them, in both themes — they are literals, not ramp tokens, on purpose', () => {
    const stage = SURFACES.LivestreamView.querySelector('.bg-\\[\\#0b1121\\]');
    expect(stage, 'the dark stage is gone').not.toBeNull();
    // A literal carries no [data-theme] variant, so it cannot invert. That is
    // the point: a video frame and a modal scrim are dark in BOTH palettes.
    for (const t of allTokens(SURFACES.LivestreamView).filter((x) => /0b1121|bg-black/.test(x))) {
      expect(t).not.toMatch(/^dark:/);
    }
  });

  it('this PR did not touch the file at all', () => {
    expect(read('LivestreamView.tsx')).toBe(at('LivestreamView.tsx'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. The Messages gate (PR 332 / THE-162).
// ═════════════════════════════════════════════════════════════════════════════
describe('the Messages gate is unchanged', () => {
  it('MainApp still gates the Messages TAB and the Messages ROUTE on communityGroups', () => {
    const src = read('MainApp.tsx');
    expect(src).toContain('hasCommunityGroups');
    expect(src).toMatch(/activeTopTab === 'messages' && \(\s*\n\s*hasCommunityGroups \?/);
    expect(src).toBe(at('MainApp.tsx'));
  });

  it('UserMessages’ queries and gates are byte-identical — only className strings moved', () => {
    // The whole file with JSX comments and className VALUES stripped. If that
    // normalised form matches the pre-PR revision, then no query, filter, sort,
    // write path or gate condition changed — only presentation did.
    const strip = (s: string) => stripComments(s)
      .replace(/className=\{`[^`]*`\}/g, 'className=X')
      .replace(/className="[^"]*"/g, 'className=X')
      .replace(/^import \{ READING_MEASURE \}.*$/m, '')
      .replace(/\s+/g, ' ').trim();
    expect(strip(read('UserMessages.tsx'))).toBe(strip(at('UserMessages.tsx')));
  });

  it('touches no Firestore path, no where(), no limit() and no listener', () => {
    const calls = (s: string) => (s.match(/(?:collection|doc|query|where|orderBy|limit|onSnapshot|getDocs|getDoc|addDoc|updateDoc|deleteDoc|setDoc)\(/g) ?? []).sort();
    expect(calls(read('UserMessages.tsx'))).toEqual(calls(at('UserMessages.tsx')));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. Behaviour, colour, type.
// ═════════════════════════════════════════════════════════════════════════════
describe('no behaviour changed on any screen in scope', () => {
  const strip = (s: string) => stripComments(s)
    .replace(/className=\{`[^`]*`\}/g, 'className=X')
    .replace(/className="[^"]*"/g, 'className=X')
    .replace(/^import \{ (?:READING_MEASURE|FORM_CONTAINER) \}.*$/gm, '')
    .replace(/\s+/g, ' ').trim();

  it.each(['NewsTab', 'AllNews', 'BiblePage', 'UserMessages'] as const)(
    '%s differs from the pre-PR revision only in class strings', (n) => {
      expect(strip(read(`${n}.tsx`))).toBe(strip(at(`${n}.tsx`)));
    });

  it('AIChat differs only in class strings AND the two inline properties it retired', () => {
    // AIChat is the exception by design: removing the inline width IS the fix.
    // Everything else must still normalise identically, so the diff is pinned
    // to exactly `maxWidth: "48rem"` and the `margin` shorthand it sat in.
    const norm = (s: string) => strip(s).replace(/textAlign: "center", fontSize: 11, color: TEXT2, margin(?:Top)?: (?:"8px auto 0"|8), (?:maxWidth: "48rem", )?lineHeight: 1\.5/g, 'DISCLAIMER');
    expect(norm(read('AIChat.tsx'))).toBe(norm(at('AIChat.tsx')));
  });

  it('MainApp and LivestreamView are untouched, so nothing there could have moved', () => {
    expect(read('MainApp.tsx')).toBe(at('MainApp.tsx'));
    expect(read('LivestreamView.tsx')).toBe(at('LivestreamView.tsx'));
  });
});

describe('no colour is hardcoded, and all four palettes resolve', () => {
  it.each(ALL_SURFACES)('%s renders exactly the colour tokens it rendered before', (name) => {
    expect(colourTokens(SURFACES[name])).toEqual(BASELINE[name].colours);
  });

  it('adds no colour to the shared rules module, and Rule 6 carries none', () => {
    const code = read('layout/form-layout.ts').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/\b(?:rgba?|hsla?|oklch|color-mix)\(/);
    const probe = document.createElement('div');
    probe.appendChild(document.createElement('span')).className = [READING_MEASURE, FORM_CONTAINER].join(' ');
    expect(colourTokens(probe)).toEqual([]);
  });

  it('leaves all four palettes to resolve exactly as they did', () => {
    const css = readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8');
    expect(css).toMatch(/^\s*:root\s*\{/m);
    expect(css).toMatch(/\[data-theme="dark"\]\s*\{/);
    expect(css).toMatch(/\[data-palette="classic"\]\[data-theme="light"\]\s*\{/);
    expect(css).toMatch(/\[data-palette="classic"\]\[data-theme="dark"\]\s*\{/);
  });

  it('changes no font size — the type scale is a separate programme', () => {
    const added = [READING_MEASURE, FORM_CONTAINER].join(' ').split(/\s+/);
    expect(added.filter((t) => /(?:^|:)text-|font-size/.test(t))).toEqual([]);
  });
});
