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
  REM_PX_MOBILE, REM_PX_DESKTOP, toV4Spelling,
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

/**
 * The revision this PR branched from — the "before" every baseline is taken at.
 *
 * ⚠️ This needs real git history, which CI does not have by default:
 * `actions/checkout@v4` makes a depth-1 clone, so `git show <older-rev>` dies
 * with `fatal: invalid object name` and a suite that is green locally is red on
 * CI for a reason nothing in the diff explains. `.github/workflows/test.yml`
 * therefore sets `fetch-depth: 0`, and `revisionIsReachable` below turns a
 * missing history into ONE named failure that says so, rather than a wall of
 * raw git errors from every assertion that happens to need the before.
 */
const PRE_PR_REVISION = '29769c6';

const revisionIsReachable = (): boolean => {
  try {
    execSync(`git cat-file -e ${PRE_PR_REVISION}^{commit}`, { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const at = (rel: string) => {
  try {
    return execSync(`git show ${PRE_PR_REVISION}:src/components/${rel}`, {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    });
  } catch (e) {
    if (!revisionIsReachable()) {
      throw new Error(
        `This suite diffs the working tree against ${PRE_PR_REVISION}, which is not in this ` +
        `clone. That is a CHECKOUT problem, not a code one: a depth-1 clone holds a single ` +
        `commit. Set 'fetch-depth: 0' on actions/checkout in .github/workflows/test.yml, or ` +
        `run 'git fetch --unshallow' locally.`,
      );
    }
    throw e;
  }
};

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
// 0. The precondition every "before" assertion in this file rests on.
// ═════════════════════════════════════════════════════════════════════════════
describe('the revision this suite diffs against is reachable', () => {
  it('can read the pre-PR revision — a shallow clone fails HERE, once, and says why', () => {
    expect(
      revisionIsReachable(),
      `${PRE_PR_REVISION} is not in this clone. actions/checkout@v4 defaults to a depth-1 ` +
      `shallow clone, which holds one commit and no history; .github/workflows/test.yml sets ` +
      `fetch-depth: 0 for exactly this. Locally: git fetch --unshallow.`,
    ).toBe(true);
    expect(at('MainApp.tsx').length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. The one that matters most — one test per file.
// ═════════════════════════════════════════════════════════════════════════════
/**
 * THE-295 replaced ONE inert class on the member bottom nav — `pb-safe`, which
 * compiled to no CSS at all, for `pb-[calc(8px+env(safe-area-inset-bottom))]`,
 * which compiles. The recorded layer holds the old spelling because the fixture
 * IS the pre-PR revision's render.
 *
 * 🔴 The fixture is deliberately NOT re-recorded. Re-recording would move all
 * 236 rows of MainApp's layer at once and pin whatever the file renders today,
 * which is exactly the silent re-baselining this suite exists to prevent. So
 * the one substitution is undone in the COMPARISON instead, for that one class
 * on that one element: every other row, every other surface and every other
 * class still has to match the measured revision character for character, and
 * a second class edit hiding behind this one still fails.
 */
const undoTHE295 = (rows: string[]): string[] =>
  rows.map((r) => r.replace('pb-[calc(8px+env(safe-area-inset-bottom))]', 'pb-safe'));

/**
 * 🔴 THE-348 · THE TWO `UserMessages` SURFACES MOVED BELOW 640px, DELIBERATELY.
 *
 * This batch measured "nothing below 640px moved". THE-348 moves three things
 * on the member chat on purpose, because all three are the founder's bug:
 *
 *   1. THE COMPOSER IS PINNED TO THE VIEWPORT below `lg` — *"in a chat I can
 *      scroll up and down and the input bar moved as well… put the input text
 *      field fixed at the bottom."* Five `max-lg:` tokens on the composer bar,
 *      and one on the scroller reserving the band a fixed element vacates.
 *   2. THE PAPERCLIP IS GONE FOR A MEMBER — *"The user, non admin should not
 *      have the paperclip."* Three elements (button, svg, path) leave the
 *      member's render entirely, which is what makes it 64 rows and not 67.
 *   3. THE SEND BUTTON TAKES THE 44px PHONE FLOOR. It measured 36 × 36 at
 *      380px in Chromium, beside an attach trigger that already cleared 44.
 *
 * 🔴 THE FIXTURE IS NOT RE-RECORDED, for the reason THE-295 wrote above:
 * re-recording would pin whatever the file renders today across all seven
 * surfaces at once, which is the silent re-baselining this suite exists to
 * prevent. So the diff is folded out HERE, item by item, and the folding is
 * itself pinned by the test directly below — a fourth change hiding behind
 * these three still fails.
 *
 * ⚠️ WHAT REPLACES THE PROXY, rather than nothing. A class-string comparison
 * was standing in for "the phone rendering did not move". For these two
 * surfaces that claim is now made DIRECTLY and far more strongly, in a real
 * browser, by `THE-348.member-composer.layout.test.tsx`: the composer's
 * position, its box before and after a 3,281px scroll, the nav's band, the
 * hit test in that band, and every control's height at five widths. A proxy
 * that has stopped being true should stop being asserted rather than be
 * quietly re-recorded — THE-205's words, in this file.
 */
const THE_348_SURFACES = ['UserMessages', 'UserMessagesThread'] as const;

/** The tokens THE-348 ADDS. Nothing else may appear. */
const THE_348_ADDED = [
  // The composer, pinned to the viewport below `lg`.
  // ⚠️ `z-10`, not the `z-[101]` this first shipped as. The composer does not
  // have to clear the nav's `z-[100]`, because inside a conversation the nav
  // is HIDDEN — and 101 put the composer above the ATTACH MENU, which
  // `ui/dropdown-menu.tsx` paints at its positioner's hardcoded `z-50`. A hit
  // test over the open menu's whole box found 22 of 121 pixels covered by it.
  'max-lg:fixed', 'max-lg:inset-x-0', 'max-lg:bottom-0', 'max-lg:z-10',
  // Its own safe-area padding — `undoTHE295` rewrites the calc form to this.
  'max-lg:pb-safe',
  // The band the scroller reserves for it.
  'max-lg:pb-[calc(72px+env(safe-area-inset-bottom))]',
  // The send button's 44px phone floor.
  'min-h-11', 'min-w-11',
] as const;

/** The paperclip's three elements, as the baseline rendered them. */
const THE_348_PAPERCLIP = 'lucide-paperclip';

/**
 * Fold THE-348's diff out of a row list so the rest can still be compared.
 *
 * ⚠️ THE INDEX COLUMN IS DROPPED, and that is not a loosening this ticket can
 * avoid: removing three elements shifts every later index by three, so an
 * index-keyed comparison would report 20 changed rows for one deletion. ORDER
 * IS KEPT, so an element that MOVED still fails — which is the claim the index
 * was carrying.
 */
function undoTHE348(nowRows: string[], baseRows: string[]): [string[], string[]] {
  const dropIndex = (rows: string[]) => rows.map((r) => r.split('\t').slice(1).join('\t'));
  // From the NEW rows: the tokens this ticket added.
  const now = dropIndex(nowRows).map((r) =>
    r.split(' ').filter((t) => !(THE_348_ADDED as readonly string[]).includes(t)).join(' '));
  // From the BASELINE: the paperclip's button, its svg and its path — found by
  // the svg's own lucide class, never by a row number.
  const base = dropIndex(baseRows);
  const at = base.findIndex((r) => r.includes(THE_348_PAPERCLIP));
  const trimmed = at < 0 ? base : [...base.slice(0, at - 1), ...base.slice(at + 2)];
  return [now, trimmed];
}

describe('the sub-640px rendering of each file is unchanged', () => {
  it.each(ALL_SURFACES)('%s renders the same class layer below 640px as it did before', (name) => {
    const now = undoTHE295(mobileLayer(SURFACES[name]));
    if ((THE_348_SURFACES as readonly string[]).includes(name)) {
      const [a, b] = undoTHE348(now, BASELINE[name].mobileLayer);
      expect(a, `${name} moved below 640px beyond THE-348's three folded changes`).toEqual(b);
      return;
    }
    expect(now).toEqual(BASELINE[name].mobileLayer);
  });

  it("THE-348's fold touches exactly its three changes, and only on its two surfaces", () => {
    // 🔴 The escape hatch above is only safe while it stays this small — the
    // same guard THE-295's fold carries directly below.
    for (const name of THE_348_SURFACES) {
      const rows = undoTHE295(mobileLayer(SURFACES[name]));
      // 1 · The added tokens are on the rows that are supposed to carry them.
      const composer = rows.filter((r) => r.includes('max-lg:fixed'));
      expect(composer, `${name}: the pinned composer is not exactly one element`).toHaveLength(1);
      expect(composer[0], `${name}: the pinned element is not the composer bar`).toContain('bg-surface-raised');
      const band = rows.filter((r) => r.includes('max-lg:pb-[calc(72px+env(safe-area-inset-bottom))]'));
      expect(band, `${name}: the composer band is not on exactly one element`).toHaveLength(1);
      expect(band[0], `${name}: the band is not on the message scroller`).toContain('overflow-y-auto');
      const floored = rows.filter((r) => r.includes('min-h-11'));
      expect(floored, `${name}: the 44px floor spread beyond the send button`).toHaveLength(1);
      // 2 · The paperclip really is gone for a member, and stayed gone.
      expect(rows.filter((r) => r.includes(THE_348_PAPERCLIP)),
        `${name}: a member can still see the paperclip`).toHaveLength(0);
      // 3 · And no token this ticket did not name entered the phone layer.
      const wasTokens = new Set(BASELINE[name].mobileLayer.flatMap((r) => r.split('\t')[2]?.split(' ') ?? []));
      const added = [...new Set(rows.flatMap((r) => r.split('\t')[2]?.split(' ') ?? []))]
        .filter((t) => t && !wasTokens.has(t));
      expect(added.sort(), `${name} gained a class nobody recorded`)
        .toEqual([...THE_348_ADDED].sort());
    }
  });

  it('and that normalisation touches exactly one class on exactly one row', () => {
    // The escape hatch above is only safe while it stays this small. If a later
    // edit spreads the class, or the nav row stops carrying it, this fails
    // rather than letting the normaliser quietly cover more ground.
    const rows = mobileLayer(SURFACES.MainApp);
    const touched = rows.filter((r) => r.includes('pb-[calc(8px+env(safe-area-inset-bottom))]'));
    expect(touched, 'the safe-area class is no longer on exactly one row').toHaveLength(1);
    expect(touched[0], 'the row it is on is not the fixed bottom nav').toContain('z-[100]');
    expect(rows.filter((r) => r.includes('pb-safe')), 'an inert pb-safe came back').toHaveLength(0);
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
    if ((THE_348_SURFACES as readonly string[]).includes(name)) {
      // 🔴 NOTHING SHRANK — and one thing GREW, which is the point. THE-348's
      // only height change is the send button gaining `min-h-11 min-w-11`
      // below `sm`; it measured 36 × 36 at 380px. The fold drops the index
      // column (three deleted elements shift every later one) and removes the
      // two added tokens, so every other height must still match in order.
      const [a, b] = undoTHE348(heightLayer(SURFACES[name]), BASELINE[name].heights);
      expect(a, `${name} changed a height beyond THE-348's send-button floor`).toEqual(b);
      return;
    }
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

  it('BiblePage caps the chapter and the chapter pager', () => {
    const c = SURFACES.BiblePage;
    const capped = [...c.querySelectorAll('div')].filter((d) => d.className.includes(READING_MEASURE));
    expect(capped.length, 'read tab column + pager are capped').toBeGreaterThanOrEqual(2);
  });

  it('BiblePage caps the search tab too — BOTH of its blocks, which had no cap at all', async () => {
    // Asserted on the rendered DOM behind the real tab switch, not on a
    // substring of the source. A `toContain('READING_MEASURE')` over the search
    // block passes while only ONE of the two blocks carries the rule, which is
    // exactly the half-fix this test exists to catch: the search FIELD and the
    // RESULTS list are separate children and both run the full column width
    // without it.
    const BiblePage = (await import('../BiblePage')).default;
    const m = await mount(<BiblePage />);
    try {
      const search = [...m.container.querySelectorAll('button')]
        .find((b) => b.getAttribute('aria-label') === 'Search');
      expect(search, 'no Search button — Bible markup changed, test needs updating').toBeDefined();
      await click(search!);
      const capped = [...m.container.querySelectorAll('div')]
        .filter((d) => d.className.includes(READING_MEASURE));
      expect(capped.length, 'the search field row AND the results list both take the measure').toBe(2);
      // And it really is new here: the pre-PR search tab carried no maximum.
      const before = at('BiblePage.tsx');
      expect(before.slice(before.indexOf('── SEARCH TAB ──'))).not.toMatch(/max-w/);
    } finally {
      m.unmount();
    }
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

  /**
   * ⚠️ The `at()` side of every byte-identity assertion in this file goes
   * through toV4Spelling first. THE-261 renamed shadow-sm/outline-none/
   * backdrop-blur-sm across the app so v4 keeps painting what v3 painted;
   * LivestreamView took that rename and nothing else. The claim is therefore
   * unchanged in substance — "this file is what it was" — and unchanged in
   * strength: any edit but those three spellings still fails.
   */
  it('LivestreamView was already capped, and this PR leaves that cap alone', () => {
    expect(capsOf(SURFACES.LivestreamView)).toContain(1280);
    expect(read('LivestreamView.tsx')).toBe(toV4Spelling(at('LivestreamView.tsx')));
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

/**
 * ⚠️ A LATER TICKET HAS EDITED ONE OF THESE FILES, so blanket byte-identity no
 * longer states something true.
 *
 * The edit is named here with the ticket that made it and why it is not a
 * layout change. The file stays in `SCOPE` rather than being dropped from it,
 * and it is exempted from ONE assertion — byte-identity — and nothing else.
 * Its mobile rendering layer, its colour tokens and its touch-target heights
 * are all still pinned to the measured revision, and all still pass unedited.
 * Those are the claim byte-identity was standing in for; a proxy that has
 * stopped being true should stop being asserted rather than be quietly
 * re-recorded to match whatever the file says today.
 *
 * This mirrors EDITED_SINCE_MEASUREMENT in preauth-funnel.desktop-layout.test.tsx,
 * which THE-195 and THE-201 established for the same situation.
 */
const EDITED_SINCE_MEASUREMENT: ReadonlyArray<{ file: string; ticket: string; why: string }> = [
  {
    file: 'MainApp.tsx',
    ticket: 'THE-202',
    why:
      'Gained a plan clause on ONE member tab. `Give` used to be unconditional: ' +
      "`{ id: 'partner', label: 'Give' }`. A free tenant has `fundraising: false` " +
      'and /api/stripe/donate now refuses it server-side, so an always-on Give tab ' +
      'was a member-facing link to a 403. It is now gated the same way the Blog tab ' +
      'directly above it already was, using the same `isMainSite || (isPlanReady && ' +
      'features?.X === true)` shape — so no new pattern, no new import and no new ' +
      'element entered the file. Nothing about the shell moved: no class, no inline ' +
      'style, no wrapper and no ordering. The proof is not this paragraph — MainApp ' +
      'keeps its mobileLayer, colours and heights pins from the measured revision, ' +
      'all asserted elsewhere in this file and all still passing. Only the ' +
      'byte-identity proxy for them moved.',
  },
  {
    file: 'MainApp.tsx',
    ticket: 'THE-205',
    why:
      'Gated the NEWS FEED, which free does not have, and moved what "Home" is ' +
      'as a consequence. The feed WAS Home: `topTabs[0]` was an unconditional ' +
      "`{ id: 'news' }` and the desktop sidebar's Home entry is an alias of it, " +
      'so dropping it for free without moving Home would land a member on a tab ' +
      'that is not there. `homeTabId` now derives Home — the feed where the tier ' +
      'has it, otherwise the course — and `effectiveTopTab` resolves the rendered ' +
      'tab during render so no free member sees a frame of the feed. This is a ' +
      'BEHAVIOUR change and is not claimed to be anything else. What it is not is ' +
      'a LAYOUT change, which is what this batch measured: the JSX element tree is ' +
      'identical tag for tag, and every class literal is unchanged — the two ' +
      'className expressions that differ do so only because the variable ' +
      'interpolated INSIDE them was renamed. Both are asserted directly below, ' +
      'in place of the whole-file proxy that can no longer state this.',
  },
  {
    file: 'MainApp.tsx',
    ticket: 'THE-213',
    why:
      'Gated the GIVE ROUTE, not only the Give tab THE-202 gated. The tab entry ' +
      'was the only thing reading `fundraising`, and three paths set ' +
      "`activeTopTab` to 'partner' without going near the tab strip — Profile's " +
      '"Give again →", NewsTab\'s giving CTA and the `?giving=1` deep link a ' +
      'printed QR carries — so a free member still reached a full donate form. ' +
      'The tab clause is now named `hasGiving` and read in three places: the tab, ' +
      "the `effectiveTopTab` redirect (where 'partner' joins 'news' in falling " +
      'back to Home) and the route itself, which is the pair the Messages tab has ' +
      'carried since THE-162. A BEHAVIOUR change, not a layout one: no JSX element ' +
      'was added or removed, no class literal changed, and no wrapper or ordering ' +
      "moved — the route's existing `&&` chain gained one more term. MainApp keeps " +
      'its mobileLayer, colours and heights pins from the measured revision, all ' +
      'asserted elsewhere in this file and all still passing.',
  },
  {
    file: 'MainApp.tsx',
    ticket: 'THE-295',
    why:
      'Made the bottom nav actually RESERVE the home-indicator inset. The nav ' +
      "carried `pb-safe`, and THE-286 measured that class against this repo's " +
      'real Tailwind config and found it emits NO CSS AT ALL — it is not a ' +
      'utility defined in tailwind.config.ts or in globals.css, so the class ' +
      'was inert and the nav was exactly as tall as its content. On a notched ' +
      'phone the bottom row of nav icons therefore sat in the gesture area. ' +
      'It is now `pb-[calc(8px+env(safe-area-inset-bottom))]`, the arbitrary ' +
      "form that does compile, carrying the 8px `py-2` already painted plus " +
      'the inset — the same base-plus-inset idiom AdminBlog, AdminTenants and ' +
      "GivingStatementsSection already use. ONE class literal changed and " +
      'nothing else: no JSX element was added, removed or reordered, no ' +
      'wrapper moved, no inline style and no token. The nav is TALLER below ' +
      '`lg` on a notched device by exactly the inset, which is the fix and not ' +
      'a side effect; `lg:pb-0` is untouched so desktop is unmoved. The proof ' +
      'is not this paragraph — the element-tree and class-literal inventories ' +
      'directly below pin the diff to exactly that one substitution, and ' +
      'MainApp keeps its mobileLayer, colours and heights pins.',
  },
  {
    file: 'NewsTab.tsx',
    ticket: 'THE-246',
    why:
      'Gated the feed\'s "Partner with Us" CARD on having somewhere to send the ' +
      'reader. THE-213 gated the Give tab and the Give route on the PLAN; THE-246 ' +
      'adds the second question a giving surface has to answer — whether the ' +
      'church has a payment RAIL at all (a live Stripe account, or a payment ' +
      'link it pasted) — and a church with neither has a Give page that is ' +
      'hidden entirely. MainApp therefore withholds `onGoToPartner` there, and ' +
      'this card renders only when a caller hands one over: a "Give Now" button ' +
      'that visibly does nothing is the THE-193 dead end, not a smaller version ' +
      'of one. The prop was ALREADY optional; this is the first caller to pass ' +
      'undefined. A BEHAVIOUR change and not a layout one — no element, class, ' +
      'wrapper or ordering moved, the existing block simply gained a condition ' +
      'in front of it, which is what the normalised comparison below folds out.',
  },
];

const EXEMPT_FILES = EDITED_SINCE_MEASUREMENT.map((e) => e.file);

/** Byte-identity, unless the file is named above with a ticket and a reason. */
const expectUnchangedUnlessExempted = (file: string) => {
  if (EXEMPT_FILES.includes(file)) return;
  expect(read(file), `${file} changed — this batch is a measurement, not an edit`).toBe(at(file));
};

describe('the byte-identity exemption list is exactly the edits that justify it', () => {
  it('names every exempted file with its ticket, and keeps the list to exactly those', () => {
    // The exemption is the dangerous part: an over-broad list turns every
    // byte-identity assertion below into a no-op. So the list is pinned whole —
    // file AND ticket — and widening it is an edit to this line, visible in
    // review, rather than a silent side effect of touching a shell file.
    expect(EDITED_SINCE_MEASUREMENT.map((e) => `${e.ticket} ${e.file}`)).toEqual([
      'THE-202 MainApp.tsx',
      'THE-205 MainApp.tsx',
      'THE-213 MainApp.tsx',
      'THE-295 MainApp.tsx',
      'THE-246 NewsTab.tsx',
    ]);
  });

  it('exempts only files this batch actually measured, that actually differ, with a stated reason', () => {
    for (const { file, why } of EDITED_SINCE_MEASUREMENT) {
      // An entry naming a file this batch never measured exempts nothing and
      // only disguises the list's real length. SCOPE holds surface names, not
      // filenames, so the extension comes off before the comparison.
      expect(SCOPE as readonly string[], `${file} is exempted but is not in scope`)
        .toContain(file.replace(/\.tsx$/, ''));
      // The digest MUST actually differ. If a later change reverts the edit,
      // this fails and the entry has to come back out — which is what stops the
      // list outliving the edits that justified it.
      expect(read(file), `${file} is exempted but unchanged — drop it from the list`)
        .not.toBe(at(file));
      // A bare filename explains nothing to whoever reads this next.
      expect(why.length, `${file} is exempted without a stated reason`).toBeGreaterThan(80);
    }
  });

  it('proves each exempted file is still pinned by the measurements byte-identity stood for', () => {
    // Stated here as well as in the sections above so the exemption cannot be
    // read as "MainApp is no longer checked".
    for (const file of EXEMPT_FILES) {
      const surface = file.replace(/\.tsx$/, '');
      expect(BASELINE[surface]?.mobileLayer, `${surface} lost its rendering pin`).toBeDefined();
      expect(BASELINE[surface]?.colours, `${surface} lost its colour pin`).toBeDefined();
      expect(BASELINE[surface]?.heights, `${surface} lost its height pin`).toBeDefined();
    }
  });
});

describe('the Give tab is gated on fundraising, which is why MainApp is exempted above', () => {
  it('never renders Give unconditionally — a free tenant must not be linked to a 403', () => {
    const src = read('MainApp.tsx');
    // The pre-PR revision carried this exact line. Its absence is the edit.
    expect(src).not.toMatch(/^\s*\{ id: 'partner', label: 'Give' \},\s*$/m);
    // THE-213 named the clause `hasGiving` and moved it above `topTabs`, because
    // the tab was no longer its only reader — the redirect and the route read it
    // too. The tab is still gated; the gate now just has a name.
    expect(src).toMatch(/hasGiving && \{ id: 'partner', label: 'Give' \}/);
  });

  it("uses `=== true`, not `!== false`, so the tab is absent while the plan is still loading", () => {
    // `features` is null before the plan resolves, and `null?.fundraising !== false`
    // is TRUE — so `!== false` would flash the tab on every cold load for every
    // tenant, including the free ones this gate exists for.
    const src = read('MainApp.tsx');
    expect(src).not.toMatch(/features\?\.fundraising !== false/);
  });

  it('keeps the tab on the apex site, which is not a tenant and has no plan', () => {
    // 🔴 `isMainSite ||` STILL LEADS, and that is the whole of this assertion.
    // THE-246 added a third conjunct to the tenant arm — a church must also have
    // a payment RAIL (a live Stripe account, or a payment link) for the tab to
    // exist — and the apex has neither a tenant document nor a plan to answer
    // either question with. The short-circuit is what keeps the platform's own
    // Give page exactly as it was.
    expect(read('MainApp.tsx')).toMatch(
      /const hasGiving =\s*isMainSite \|\| \(isPlanReady && features\?\.fundraising === true && hasGivingRails\);/,
    );
    // 🔴 `hasStripeGiving` no longer short-circuits on `isMainSite` alone. It
    // now reads `STRIPE_CONNECT_ENABLED` first — the same master switch THE-303
    // already reads on the public campaign page — because `isMainSite` says
    // nothing about whether a CARD can actually be taken: while the platform's
    // own Stripe account is closed, `/api/stripe/donate` refuses for the apex
    // Give page exactly as it does for any tenant, so a form promising "Secure,
    // encrypted payment via Stripe" there was the same false-claim shape THE-303
    // fixed elsewhere. `hasGiving` above is UNCHANGED — the apex Give TAB still
    // shows unconditionally, now rendering the links-only branch instead of a
    // form that would fail after a stranger typed their card in.
    expect(read('MainApp.tsx')).toMatch(
      /const hasStripeGiving = STRIPE_CONNECT_ENABLED && \(isMainSite \|\| stripeConnectStatus === 'active'\);/,
    );
  });

  it('🔴 gates the ROUTE too — a hidden tab is not a gate (THE-213)', () => {
    // Profile's "Give again →", NewsTab's giving CTA and the `?giving=1` deep
    // link all set `activeTopTab` directly, so the tab strip is not on the path.
    // Both halves are asserted: the redirect that sends a stale 'partner' Home,
    // and the render guard that keeps PartnerWithUsTab from mounting a donate
    // form on a tenant with no donate page.
    const src = read('MainApp.tsx');
    expect(src).toMatch(/\(activeTopTab === 'partner' && !hasGiving\)/);
    expect(src).toMatch(/effectiveTopTab === 'partner' && hasGiving && \(/);
  });
});

describe("the member shell's container is unchanged", () => {
  it('MainApp.tsx is byte-identical to the revision this PR branched from, or exempted above', () => {
    expectUnchangedUnlessExempted('MainApp.tsx');
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
    expect(read('LivestreamView.tsx')).toBe(toV4Spelling(at('LivestreamView.tsx')));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. The Messages gate (PR 332 / THE-162).
// ═════════════════════════════════════════════════════════════════════════════
describe('the Messages gate is unchanged', () => {
  it('MainApp still gates the Messages TAB and the Messages ROUTE on communityGroups', () => {
    const src = read('MainApp.tsx');
    expect(src).toContain('hasCommunityGroups');
    // `activeTopTab` → `effectiveTopTab` is THE-205's rename, and it is the ONLY
    // thing about this gate that moved: the tab it matches, the flag it reads
    // and the PlanUpgradeScreen it falls through to are all unchanged. The
    // rename is deliberately spelled out here rather than loosened to `\w+`,
    // so a future edit that swapped the CONDITION rather than the variable name
    // would still fail this line.
    expect(src).toMatch(/effectiveTopTab === 'messages' && \(\s*\n\s*hasCommunityGroups \?/);
    // Messages is gated on `communityGroups` and NOTHING else — in particular
    // not on THE-205's `hasNewsFeed`, which would take a Ministry feature away
    // from the tier that pays for it. Community Groups is `max` only; the feed
    // is every tier but free. Two gates, two flags.
    expect(src).not.toMatch(/effectiveTopTab === 'messages' && \(\s*\n\s*hasNewsFeed/);
    // Byte-identity dropped here, not weakened: THE-202 edited MainApp (see
    // EDITED_SINCE_MEASUREMENT). The two assertions above ARE the Messages gate
    // — the tab condition and the route condition — and they still hold
    // verbatim, which is what this test is named for. A whole-file comparison
    // would now fail on the Give tab, which has nothing to do with Messages.
    expectUnchangedUnlessExempted('MainApp.tsx');
  });

  /**
   * 🔴 THE-348 · THIS CLAIM IS NARROWED, AND SAYS SO — THE-205's treatment of
   * MainApp two describes below, for the same reason and by the same rule.
   *
   * The assertion was "only className strings moved". THE-348 changes what
   * this screen DOES, on purpose and in three places the founder named: the
   * forms-only attach sheet is deleted in favour of the shared `AttachMenu`,
   * the paperclip is gated on the current user's role, and the screen tells
   * the shell when a conversation is open so the bottom nav can hide. Folding
   * a change of that size through a normaliser would GUT this test rather than
   * extend it, so the claim narrows to the ones that are still true and states
   * them directly — which is strictly more readable than an equality whose
   * normaliser had grown to hide half a ticket.
   *
   * ⚠️ WHAT STILL HOLDS, ASSERTED BELOW: the Firestore call inventory, folded
   * to exactly the five calls that left with the deleted picker; and the
   * queries, gates and write paths themselves, named one by one. THE-348's own
   * suite asserts the rest — that the DM list, channel list, compose-new,
   * search, back arrow, read receipts and lastMessage bump all survive, and
   * that the six live listeners are unchanged.
   */
  it('UserMessages’ queries and gates survive — the call inventory lost exactly the picker', () => {
    const calls = (s: string) => (s.match(/(?:collection|doc|query|where|orderBy|limit|onSnapshot|getDocs|getDoc|addDoc|updateDoc|deleteDoc|setDoc)\(/g) ?? []).sort();
    const now = calls(read('UserMessages.tsx'));
    const before = calls(at('UserMessages.tsx'));

    // 🔴 THE DELETED `FormPicker` HELD EXACTLY FIVE FIRESTORE CALLS — one
    // `getDocs(query(collection(…), orderBy(…), limit(…)))`. Removing one
    // instance of each from the BEFORE list must reproduce the AFTER list
    // exactly: a sixth call removed, or any call ADDED, still fails here.
    const folded = [...before];
    for (const c of ['collection(', 'query(', 'orderBy(', 'limit(', 'getDocs(']) {
      const i = folded.indexOf(c);
      expect(i, `the picker's ${c} was not in the pre-PR call inventory — this fold is stale`).toBeGreaterThan(-1);
      folded.splice(i, 1);
    }
    expect(now, 'UserMessages changed a Firestore call beyond deleting the forms picker').toEqual(folded);
  });

  it('and every listener, filter and write path it had is still spelled the same way', () => {
    // The queries this test was standing for, named rather than proxied.
    const src = stripComments(read('UserMessages.tsx'));
    expect(src, 'the DM list query moved').toMatch(/'directMessages'\),\s*where\('participants', 'array-contains', currentUser\.uid\),\s*limit\(50\)/);
    expect(src, 'the channel list query moved').toMatch(/'channels'\),\s*where\('members', 'array-contains', currentUser\.uid\),\s*limit\(50\)/);
    expect(src, 'the DM message listener moved').toMatch(/'dmMessages'\),\s*where\('dmId', '==', dm\.id\),\s*limit\(300\)/);
    expect(src, 'the channel message listener moved').toMatch(/'channelMessages'\),\s*where\('channelId', '==', channel\.id\),\s*limit\(300\)/);
    expect(src, 'the admin picker query moved').toMatch(/'users'\),\s*where\('tenantId', '==', tenantId\),\s*limit\(200\)/);
    // The listener COUNT is what the six-listener budget rests on.
    expect((src.match(/onSnapshot\(/g) ?? []).length, 'the number of live listeners changed').toBe(4);
    // And the two write paths.
    expect(src, 'the read receipt write moved').toMatch(/updateDoc\(doc\(db, 'tenants', tenantId, 'dmMessages', d\.id\), \{ read: true \}\)/);
    expect(src, 'the message write moved').toMatch(/addDoc\(collection\(db, 'tenants', tenantId, 'dmMessages'\), payload\)/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. Behaviour, colour, type.
// ═════════════════════════════════════════════════════════════════════════════
describe('no behaviour changed on any screen in scope', () => {
  const strip = (s: string) => stripComments(s)
    .replace(/className=\{`[^`]*`\}/g, 'className=X')
    .replace(/className="[^"]*"/g, 'className=X')
    // ⚠️ `[^}]*` rather than a bare name: THE-333 added DENSITY_PX alongside
    // READING_MEASURE on this import, and a normaliser pinned to the exact
    // one-name form would report a token import as a behaviour change.
    .replace(/^import \{ (?:READING_MEASURE|FORM_CONTAINER)[^}]*\}.*$/gm, '')
    .replace(/\s+/g, ' ').trim();

  it.each(['AllNews', 'BiblePage'] as const)(
    '%s differs from the pre-PR revision only in class strings', (n) => {
      expect(strip(read(`${n}.tsx`))).toBe(strip(at(`${n}.tsx`)));
    });

  /**
   * 🔴 `UserMessages` IS NO LONGER ON THAT LIST, and this is the entry that
   * says why rather than a silent absence.
   *
   * THE-348 is a BEHAVIOUR change to this screen and is not claimed to be
   * anything else: the forms-only attach sheet is deleted for the shared
   * `AttachMenu`, the paperclip is gated on the current user's role, the
   * composer is pinned to the viewport, and the screen raises a flag the shell
   * reads to hide the bottom nav. All four are the founder's own words. The
   * claim that "only class strings moved" is therefore FALSE for this file,
   * and re-recording it or widening the normaliser until it passed would be
   * the silent re-baselining this suite exists to prevent.
   *
   * ⚠️ WHAT IT IS REPLACED BY, in both directions: the two assertions in the
   * Messages-gate describe above pin the Firestore surface to exactly the five
   * calls the deleted picker took with it, and name every query, listener and
   * write path individually; and `THE-348.member-composer.layout.test.tsx`
   * measures the RESULT in Chromium at five widths, which is a stronger claim
   * about this screen's phone rendering than a class-string diff ever was.
   */
  it('UserMessages differs from the pre-PR revision in exactly THE-348, and nothing else', () => {
    const before = strip(at('UserMessages.tsx'));
    const now = strip(read('UserMessages.tsx'));
    expect(now, 'UserMessages is unchanged — THE-348 did not land').not.toBe(before);

    // 🔴 THE THINGS THAT LEFT, and nothing else may have.
    for (const gone of ['FormPicker', 'Paperclip', 'showPicker', 'Attach a Form']) {
      expect(before, `${gone} was not in the pre-PR revision — this record is stale`).toContain(gone);
      expect(now, `${gone} is still in UserMessages`).not.toContain(gone);
    }
    // 🔴 THE THINGS THAT ARRIVED, each traceable to one of the founder's items.
    //
    // ⚠️ `setIsAdmin` AND NOT `isAdmin`, deliberately. The bare name was
    // ALREADY IN THIS FILE TWICE before THE-348 — `RoleBadge` derives one from
    // the role of the MESSAGE'S SENDER to colour a badge, and the DM thread
    // derives `isAdminSender` from `dm.participantRoles` to colour an avatar.
    // Neither is "may the person at the keyboard attach", and neither is in
    // scope at the composer. Greping the bare name would have matched a
    // pre-existing derivation and reported this ticket's gate as already
    // present — which is the shape of a guard that guards nothing.
    for (const added of ['AttachMenu', 'AttachTypeIcon', 'setIsAdmin', 'onConversationOpenChange', 'FIXED_COMPOSER']) {
      expect(before, `${added} was already there — this record is stale`).not.toContain(added);
      expect(now, `${added} did not land`).toContain(added);
    }
  });

  it('NewsTab differs only in class strings, THE-246\'s condition and THE-345\'s price gate', () => {
    // NewsTab is the second exception, and it is AIChat's treatment rather than
    // a dropped assertion: the diff is pinned to EXACTLY the `onGoToPartner &&`
    // guard now in front of the "Partner with Us" card, and everything else in
    // the file must still normalise identically. A second edit hiding behind
    // this one still fails.
    //
    // THE-345 ADDS A SECOND PINNED DIFF, pinned the same way rather than folded
    // into a looser normaliser. `events/{id}.price` is quoted here - twice, on
    // the two event cards this file renders - and charged by nothing:
    // /api/event-registration/submit totals `ticketTypes[].price` and never
    // reads it. So a member was shown "$50" for a conference the flow confirmed
    // them into for free. While no payment rail exists `eventPriceLabel` returns
    // null and neither span renders. BOTH occurrences are folded below, in BOTH
    // revisions, so a THIRD edit hiding behind these two still fails - and the
    // fold is written to match the gated form ONLY, so removing the gate without
    // restoring the original expression also fails.
    const norm = (src: string) =>
      strip(src)
        .replace(
          /\{onGoToPartner && \( (<DesktopCard[\s\S]*?<\/DesktopCard>) \)\}/,
          '$1',
        )
        .replace(/import \{ eventPriceLabel \} from '\.\.\/lib\/paid-events-feature'; /g, '')
        .replace(
          /\{eventPriceLabel\(event\.price\) && <span className=X>\{eventPriceLabel\(event\.price\)\}<\/span>\}/g,
          'PRICE_QUOTE',
        )
        .replace(
          /<span className=X>\{event\.price > 0 \? `\$\$\{event\.price\}` : 'Free'\}<\/span>/g,
          'PRICE_QUOTE',
        );
    expect(norm(read('NewsTab.tsx'))).toBe(norm(at('NewsTab.tsx')));
  });

  it('AIChat differs only in class strings, the two inline properties it retired, and THE-333\'s two rail controls', () => {
    // AIChat is the exception by design: removing the inline width IS the fix.
    // Everything else must still normalise identically, so the diff is pinned
    // to exactly `maxWidth: "48rem"` and the `margin` shorthand it sat in.
    //
    // 🔴 THE-333 ADDED A SECOND PINNED DIFF, and it is pinned the same way
    // rather than folded into a looser normaliser. Both rail controls were
    // sized by padding around their glyph — the collapse control measured 26px
    // and the reopen control 30px, under the 38px Rule 4 fixes above sm — so
    // each now takes DENSITY_PX.control and carries the aria-label its bare
    // icon never had. The two opening tags below are collapsed in BOTH
    // revisions; every other byte of this file must still match, so a third
    // edit hiding behind these two still fails.
    const norm = (s: string) => strip(s)
      .replace(/textAlign: "center", fontSize: 11, color: TEXT2, margin(?:Top)?: (?:"8px auto 0"|8), (?:maxWidth: "48rem", )?lineHeight: 1\.5/g, 'DISCLAIMER')
      .replace(/<button onClick=\{\(\) => setRailCollapsed\(true\)\}.*?\}\}>/g, 'COLLAPSE_CONTROL')
      .replace(/<button onClick=\{\(\) => setRailCollapsed\(false\)\}.*?\}\}>/g, 'REOPEN_CONTROL');
    expect(norm(read('AIChat.tsx'))).toBe(norm(at('AIChat.tsx')));
  });

  it('MainApp and LivestreamView carry no LAYOUT change, so nothing measured could have moved', () => {
    // LivestreamView is still byte-identical and asserted as such.
    expect(read('LivestreamView.tsx')).toBe(toV4Spelling(at('LivestreamView.tsx')));

    // MainApp is exempted from byte-identity twice now (THE-202, THE-205). This
    // test used to fold THE-202's one-line Give clause out of the whole file and
    // compare the rest; THE-205 is a real behaviour change — a new gate, a
    // derived Home, a renamed render variable — and folding a change of that
    // size through a normaliser would GUT this test rather than extend it. So
    // the claim narrows to the one this batch actually measured, and says so:
    // layout did not move. Two inventories state it exactly, and neither is
    // weaker than the proxy they replace in the layout dimension.
    //
    //   • THE ELEMENT TREE — every JSX tag, in order. THE-205 added no element,
    //     removed none and reordered none; it only put conditions in front of
    //     ones already there. A wrapper, a moved block or a dropped node fails
    //     here.
    const tags = (src: string) =>
      [...stripComments(src).matchAll(/<([A-Za-z][A-Za-z0-9.]*)/g)].map((m) => m[1]);
    expect(tags(read('MainApp.tsx')), 'MainApp changed its element tree').toEqual(tags(at('MainApp.tsx')));

    //   • EVERY CLASS LITERAL, in order. Three className expressions differ.
    //     Two do so only because `activeTopTab` was renamed `effectiveTopTab`
    //     INSIDE the interpolation that chooses between them — the classes
    //     chosen FROM are character-for-character what they were.
    //
    //     The third is THE-295's, on the bottom nav, and it is pinned to
    //     exactly one substitution the way AIChat's and NewsTab's diffs are
    //     above: `pb-safe` → `pb-[calc(8px+env(safe-area-inset-bottom))]`.
    //     🔴 That is not a restyle. `pb-safe` compiled to NO CSS against this
    //     repo's real config — THE-286 measured it and reported it — so the
    //     nav reserved no home-indicator inset and the class was inert. The
    //     replacement is the arbitrary form that does compile, carrying the
    //     8px `py-2` already painted plus the inset. Undoing exactly that,
    //     and the rename, is the whole of the normalisation below; it folds
    //     away no other class, no width and no token. Any second class edit
    //     — including one hiding behind this one — still fails here.
    //
    //     🔴 THE-348 ADDS A FOURTH AND FIFTH, pinned to exactly two
    //     substitutions the way THE-295's is above. The member nav is hidden
    //     while a conversation is open, and the content wrapper stops
    //     reserving the nav's 65px band while it is. BOTH are folded out of
    //     the SOURCE before the classes are read, so the inventory compares
    //     the same literals it always did:
    //
    //       • the nav's condition gains one term, `|| isChatOpen`. The classes
    //         it chooses BETWEEN are character-for-character what they were.
    //       • the wrapper's `'overflow-hidden pb-[65px] lg:pb-0'` becomes a
    //         template that drops `pb-[65px]` when the nav is hidden — which
    //         is why the count went 40 -> 41: a nested template is a second
    //         className match, not a second className.
    //
    //     🔴 NO ELEMENT WAS ADDED, REMOVED OR REORDERED, which is why the
    //     element-tree inventory directly above still passes UNFOLDED — the
    //     stronger of the two claims, and the one THE-348 deliberately kept by
    //     hiding the nav through a condition the shell already carried rather
    //     than through a wrapper. A third class edit hiding behind these two
    //     still fails here.
    const foldTHE348 = (src: string) => src
      .replace("`overflow-hidden ${isChatOpen ? '' : 'pb-[65px]'} lg:pb-0`", "'overflow-hidden pb-[65px] lg:pb-0'")
      .replace(" || isChatOpen ? 'max-lg:translate-y-full'", " ? 'max-lg:translate-y-full'");
    const classes = (src: string) =>
      [...stripComments(foldTHE348(src)).matchAll(/className=\{`([^`]*)`\}|className="([^"]*)"/g)]
        .map((m) => (m[1] ?? m[2])
          .replace(/\beffectiveTopTab\b/g, 'activeTopTab')
          .replace('pb-[calc(8px+env(safe-area-inset-bottom))]', 'pb-safe'));
    expect(classes(read('MainApp.tsx')), 'MainApp changed a class literal').toEqual(classes(at('MainApp.tsx')));
  });
});

describe('no colour is hardcoded, and both palettes resolve', () => {
  it.each(ALL_SURFACES)('%s renders exactly the colour tokens it rendered before', (name) => {
    if ((THE_348_SURFACES as readonly string[]).includes(name)) {
      // 🔴 THE-348 ADDS NO COLOUR AND REMOVES ONE: the paperclip button's
      // `hover:bg-[var(--border-hairline)]` leaves with the button. Asserted as
      // a REMOVAL of exactly that token rather than as a subset check, so a
      // colour that appeared would still fail.
      const gone = 'hover:bg-[var(--border-hairline)]';
      expect(colourTokens(SURFACES[name]), `${name} changed a colour beyond the paperclip's hover`)
        .toEqual(BASELINE[name].colours.filter((c) => c !== gone));
      expect(BASELINE[name].colours, 'the paperclip hover was never in the baseline — this fold is stale')
        .toContain(gone);
      return;
    }
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

  it('leaves both palettes to resolve exactly as they did', () => {
    const css = readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8');
    expect(css).toMatch(/^\s*:root\s*\{/m);
    expect(css).toMatch(/\[data-theme="dark"\]\s*\{/);
    // 🔴 THE-338 — the two Classic selectors this asserted are GONE, and their

    // absence is now what is asserted. The family's 14 overrides were promoted

    // into :root/.dark, so every token still resolves — in TWO palettes, not

    // four. Leaving the old assertion would have pinned a family that no

    // longer exists; deleting it outright would have stopped checking that the

    // theme scopes exist at all.

    expect(css).not.toMatch(/\[data-palette/);
  });

  it('changes no font size — the type scale is a separate programme', () => {
    const added = [READING_MEASURE, FORM_CONTAINER].join(' ').split(/\s+/);
    expect(added.filter((t) => /(?:^|:)text-|font-size/.test(t))).toEqual([]);
  });
});
