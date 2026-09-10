// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom. Every claim this ticket makes is a LAYOUT claim —
// "the composer is fixed", "the nav occupies no band", "the menu is visible" —
// and happy-dom has no layout engine: `getBoundingClientRect()` returns zeros
// on every element and `getComputedStyle(el).position` never resolves a
// Tailwind class. A source-only suite would pass on all three defects at once,
// which is how THE-276 shipped a broken dashboard behind a green run.
//
// ⚠️ ONE `MeasuringBrowser` PER PROCESS, opened once and driven across widths.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';

/**
 * THE-348 · The member chat: a floating composer, the wrong attach menu, and
 * no admin gate.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The founder, on a phone, with three screenshots:
 *
 *   1. *"in a chat I can scroll up and down and the input bar moved as well.
 *      In a chat hide the bottom menu and put the input text field fixed at
 *      the bottom."*
 *   2. *"as an admin if I press on paperclip it appears attach a form, not all
 *      that is in community and the same style that we applied."*
 *   3. *"The user, non admin should not have the paperclip."*
 *
 * ── What is measured here, and what is NOT ──────────────────────────────────
 *
 * 🔴 THE SHIPPED `UserMessages` IS DRIVEN IN CHROMIUM. Only the network is
 * faked: `firebase/firestore` is aliased to a stub that answers from fixtures,
 * and every class, every gate, every effect and every layout rule still runs
 * out of the real component. The composer measured below is the composer that
 * ships.
 *
 * ⚠️ THE SHELL IS NOT HAND-COPIED. `THE-321.profile-measure.test.tsx` writes
 * the member nav out class-for-class in its own JSX, with a comment saying so —
 * and a copy drifts the moment the shell moves. The two class strings this
 * suite needs (the bottom nav, and the content wrapper that reserved its band)
 * are EXTRACTED from `MainApp.tsx` as template-literal SOURCE and EVALUATED
 * here with the four shell variables set explicitly, so what renders is the
 * shipped expression rather than a transcription of it.
 *
 * ⚠️ NOT MEASURED, and named rather than left as a silent gap: the iOS
 * `100vh` behaviour that is the ROOT of defect 1. Chromium under
 * `Emulation.setDeviceMetricsOverride` has no retracting URL bar, so the gap
 * between the layout viewport and the visual viewport cannot be reproduced
 * here. What IS measured is the property that closes it — the composer resolves
 * `position: fixed` against the viewport and nothing in its ancestor chain
 * turns that back into containment — which is the mechanism, not the symptom.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** 🔴 Width is not monotonic; all five are measured, none interpolated. */
const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

/** Below `sm` every tap target is 44px; Rule 4 fixes controls at 38px above. */
const SM = 640;

/** The member shell becomes desktop here — the composer stops being fixed. */
const LG = 1024;

// ═════════════════════════════════════════════════════════════════════════════
// 0 · The shell's two class strings are DISCOVERED, never pinned to a line.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * 🔴 NO LINE NUMBERS ANYWHERE IN THIS FILE. THE-331 pinned
 * `AdminCommunity.tsx:491`; a deletion moved that surface to `:311` and the
 * suite would have measured whatever landed on the old line rather than
 * failing. Both strings below are found by shape.
 */
function extractTemplate(src: string, startsWith: string, endsAt: string): string {
  const i = src.indexOf(startsWith);
  if (i < 0) throw new Error(`MainApp.tsx no longer contains a className starting "${startsWith}"`);
  const j = src.indexOf(endsAt, i);
  if (j < 0) throw new Error(`the className starting "${startsWith}" has no "${endsAt}" after it`);
  return src.slice(i, j);
}

const MAIN_APP = read('src/components/MainApp.tsx');

/** The bottom nav / desktop rail. Anchored on `z-[100]`, which is its layer. */
const NAV_TEMPLATE = (() => {
  const m = MAIN_APP.match(/className=\{`(bg-surface-raised border-t[^`]*z-\[100\][^`]*)`\}/);
  if (!m) throw new Error("the member bottom nav's class template was not found in MainApp.tsx");
  return m[1];
})();

/** The content wrapper — the element that reserved the nav's 65px band. */
const WRAPPER_TEMPLATE = extractTemplate(
  MAIN_APP,
  'flex-1 overflow-x-hidden relative',
  // ⚠️ The BACKTICK is part of the terminator. This expression nests a second
  // template inside itself, so ending at the bare `}` would take the outer
  // template's own closing backtick along with the body and every evaluation
  // after it would die on "Unexpected end of input".
  '`} onScroll={handleScroll}',
);

/**
 * Evaluate one of those templates with the shell variables set.
 *
 * 🔴 THIS IS THE SHIPPED EXPRESSION RUNNING, not a re-implementation of it. If
 * MainApp changes which variable chooses which class, this evaluates the new
 * choice — and a template that stops compiling fails here, loudly, rather than
 * silently measuring a stale copy.
 */
function evalTemplate(tpl: string, vars: Record<string, unknown>): string {
  const names = ['isSidebarCollapsed', 'isNavVisible', 'activeBottomTab', 'effectiveTopTab', 'isChatOpen'];
  const fn = new Function(...names, 'return `' + tpl + '`') as (...a: unknown[]) => string;
  return fn(...names.map((n) => vars[n]));
}

const SHELL_VARS = {
  isSidebarCollapsed: false,
  isNavVisible: true,
  activeBottomTab: 'home',
  effectiveTopTab: 'messages',
};

const NAV_SHOWN = evalTemplate(NAV_TEMPLATE, { ...SHELL_VARS, isChatOpen: false });
const NAV_HIDDEN = evalTemplate(NAV_TEMPLATE, { ...SHELL_VARS, isChatOpen: true });
const WRAPPER_SHOWN = evalTemplate(WRAPPER_TEMPLATE, { ...SHELL_VARS, isChatOpen: false });
const WRAPPER_HIDDEN = evalTemplate(WRAPPER_TEMPLATE, { ...SHELL_VARS, isChatOpen: true });

// ═════════════════════════════════════════════════════════════════════════════
// The harness: the SHIPPED component, bundled and driven in Chromium.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ Fixture timestamps are FIXED and years away from today — no `Date.now()`,
 * no "yesterday". A fixture pinned near the run date passes for a week and then
 * starts failing on a clock, which is the trap #468 recorded. `fmtTime` in the
 * component renders a RELATIVE string off these, so they are deliberately old
 * enough that the relative form is stable forever ("Feb 1" and not "3m ago").
 */
const FIXTURE_MS = {
  newest: 1_612_137_600_000, // 2021-02-01T00:00:00Z
  mid: 1_612_051_200_000,
  older: 1_611_964_800_000,
  oldest: 1_611_878_400_000,
} as const;

/** Enough messages that the thread scrolls — defect 1 is about scrolling. */
const DM_MESSAGE_COUNT = 40;

const FIRESTORE_STUB = `
type Row = { id: string; data: Record<string, unknown> };
const ts = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) });

const dmMessages: Row[] = Array.from({ length: ${DM_MESSAGE_COUNT} }, (_, i) => ({
  id: 'm' + i,
  data: {
    dmId: 'dm1',
    senderId: i % 2 === 0 ? 'admin1' : 'me',
    senderName: i % 2 === 0 ? 'Pastor Adams' : 'Maria Bumb',
    content: 'Message ' + i + ' — the Lord is my shepherd; I shall not want.',
    createdAt: ts(${FIXTURE_MS.oldest} + i * 600000),
    read: true,
  },
}));

const FIXTURES: Record<string, Row[]> = {
  'tenants/t1/dmMessages': dmMessages,
  'tenants/t1/directMessages': [
    { id: 'dm1', data: { participants: ['me', 'admin1'], participantNames: { admin1: 'Pastor Adams' }, participantRoles: { admin1: 'church_admin', me: 'user' }, lastMessage: 'Message 39', lastMessageAt: ts(${FIXTURE_MS.newest}) } },
  ],
  'tenants/t1/channels': [
    { id: 'ch1', data: { name: 'general', description: 'The church family channel', members: ['me'], lastMessage: 'Welcome', lastMessageAt: ts(${FIXTURE_MS.mid}) } },
  ],
  'tenants/t1/channelMessages': [
    { id: 'cm1', data: { channelId: 'ch1', senderId: 'admin1', senderName: 'Pastor Adams', senderRole: 'church_admin', content: 'Welcome to the channel.', createdAt: ts(${FIXTURE_MS.mid}) } },
  ],
  // The four attachable categories, for AttachMenu.
  docs: [
    { id: 'd1', data: { title: 'Elders meeting notes', folderId: 'f1', updatedAt: ts(${FIXTURE_MS.newest}) } },
    { id: 'd2', data: { title: 'Baptism liturgy', folderId: 'f1', updatedAt: ts(${FIXTURE_MS.mid}) } },
    { id: 'd3', data: { title: 'Building survey', folderId: 'f1', updatedAt: ts(${FIXTURE_MS.older}) } },
    { id: 'd4', data: { title: 'Fourth doc, past the recents cut', folderId: 'f1', updatedAt: ts(${FIXTURE_MS.oldest}) } },
  ],
  docFolders: [{ id: 'f1', data: { name: 'Leadership' } }],
  contacts: [
    { id: 'c1', data: { firstName: 'Ada', lastName: 'Reeve', type: 'member', email: 'ada@example.org', createdAt: ts(${FIXTURE_MS.newest}) } },
    { id: 'c2', data: { firstName: 'Boaz', lastName: 'Cole', type: 'donor', email: 'boaz@example.org', createdAt: ts(${FIXTURE_MS.mid}) } },
  ],
  campaigns: [
    { id: 'k1', data: { title: 'Roof Appeal', raised: 1200, goal: 5000, isActive: true, createdAt: ts(${FIXTURE_MS.newest}) } },
  ],
  'tenants/t1/forms': [
    { id: 'q1', data: { title: 'Volunteer sign-up', submissionCount: 3, active: true, createdAt: ts(${FIXTURE_MS.newest}) } },
    { id: 'q2', data: { title: 'Prayer request', submissionCount: 1, active: true, createdAt: ts(${FIXTURE_MS.mid}) } },
  ],
  users: [],
};

const bump = (k: string) => {
  const g = globalThis as Record<string, unknown>;
  g[k] = ((g[k] as number) ?? 0) + 1;
};

export const collection = (_db: unknown, ...segs: string[]) => ({ __path: segs.join('/') });
export const doc = (_db: unknown, ...segs: string[]) => ({ __path: segs.join('/') });
export const query = (c: { __path: string }, ...rest: unknown[]) => ({
  __path: c.__path,
  __null: rest.some((r) => (r as { __null?: boolean })?.__null),
});
export const where = (_f: string, _op: string, v: unknown) => ({ __null: v === null });
export const limit = (n: number) => ({ __limit: n });
export const orderBy = (f: string, d?: string) => ({ __order: f, __dir: d });
export const serverTimestamp = () => ts(${FIXTURE_MS.newest});
export const getDocs = async (q: { __path: string; __null?: boolean }) => {
  bump('__reads');
  return { docs: (q.__null ? [] : (FIXTURES[q.__path] ?? [])).map((r) => ({ id: r.id, data: () => r.data })) };
};
export const getDoc = async () => ({
  exists: () => true,
  data: () => ({ displayName: 'Maria Bumb', role: (globalThis as Record<string, unknown>).__role ?? 'user', tenantId: 't1' }),
});
export const onSnapshot = (q: { __path: string }, cb: (s: unknown) => void) => {
  bump('__listeners');
  const rows = FIXTURES[q.__path] ?? [];
  queueMicrotask(() => cb({
    docs: rows.map((r) => ({ id: r.id, data: () => r.data })),
    forEach: (f: (d: unknown) => void) => rows.forEach((r) => f({ id: r.id, data: () => r.data })),
  }));
  return () => {};
};
export const addDoc = async (_c: unknown, payload: unknown) => {
  (globalThis as Record<string, unknown>).__sent = payload;
  return { id: 'new' };
};
export const updateDoc = async () => {};
export type QueryDocumentSnapshot = { id: string; data: () => Record<string, unknown> };
export type Timestamp = { toMillis: () => number; toDate: () => Date };
export const Timestamp = { fromMillis: ts };
`;

const FIREBASE_STUB = `export const db = {} as unknown;
export const auth = { currentUser: { uid: 'me', email: 'maria@example.org', displayName: 'Maria Bumb' } } as unknown;
export const storage = {} as unknown;
export default {};
`;

/**
 * The shell, built from the two EXTRACTED templates. Its inner wrappers mirror
 * the height chain MainApp puts between the content wrapper and this screen —
 * that chain is what `h-full` resolves through, so a harness without it would
 * measure a composer in a box the app never gives it.
 */
function entrySource(): string {
  return `import * as React from 'react';
import { createRoot } from 'react-dom/client';
import UserMessages from '@/components/UserMessages';
import { AttachTypeIcon } from '@/components/attach/AttachMenu';

const NAV_SHOWN = ${JSON.stringify(NAV_SHOWN)};
const NAV_HIDDEN = ${JSON.stringify(NAV_HIDDEN)};
const WRAPPER_SHOWN = ${JSON.stringify(WRAPPER_SHOWN)};
const WRAPPER_HIDDEN = ${JSON.stringify(WRAPPER_HIDDEN)};

function App() {
  const [chatOpen, setChatOpen] = React.useState(false);
  // 🔴 REMOUNTING IS HOW THE ROLE IS RE-READ. UserMessages reads the current
  // user's 'users' doc in a mount effect — which is right, and means the only
  // honest way to measure the admin case is to mount it again as an admin. The
  // React key does that; a page reload cannot, because the navigation tears the CDP
  // evaluation down and the call returns no result at all.
  const [role, setRole] = React.useState('user');
  // 🔴 THE EXIT THE CLEANUP EXISTS FOR. The back arrow and switching
  // conversations both re-run the effect, so its BODY sends the new value and
  // the nav comes back even with the cleanup deleted. Leaving the tab UNMOUNTS
  // this screen, and only the cleanup covers that — so the harness must be
  // able to unmount it, or the trap #490 warned about is untestable.
  const [screenMounted, setScreenMounted] = React.useState(true);
  (window as unknown as Record<string, unknown>).__chatOpen = chatOpen;
  (window as unknown as Record<string, unknown>).__setMounted = (m: boolean) => setScreenMounted(m);
  (window as unknown as Record<string, unknown>).__setRole = (r: string) => {
    (globalThis as Record<string, unknown>).__role = r;
    setRole(r);
  };
  return (
    <div className="flex flex-col lg:flex-row h-screen bg-surface overflow-hidden">
      <div data-shell-bottom-nav className={chatOpen ? NAV_HIDDEN : NAV_SHOWN}><span>Nav</span></div>
      <div className="flex-1 flex flex-col min-w-0">
        <div data-content-wrapper className={chatOpen ? WRAPPER_HIDDEN : WRAPPER_SHOWN}>
          <div className="h-full">
            <div className="relative w-full h-full">
              <div className="absolute w-full h-full p-4">
                <div className="-m-4 h-full lg:h-[calc(100%+2rem)]">
                  {screenMounted && (
                    <UserMessages key={role} embedded onBack={() => {}} onConversationOpenChange={setChatOpen} />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* A LAYER AT THE NAV'S EXACT z-[100], AND IT IS HIT-TESTABLE.
          #480's bug was a z-index that landed on the POPUP while the
          POSITIONER kept its own, and no class read could have seen it - so
          this is a hit test. pointerEvents is 'auto' DELIBERATELY: a first
          version copied THE-337's probe, which sets it to 'none', and
          elementFromPoint SKIPS such an element entirely - so "no pixel of the
          menu is covered" was structurally unable to fail. The mutation that
          drops the positioner's layer was run against that version and the
          suite stayed green. Mounted only while a sweep asks for it, so it
          cannot disturb the layout readings. */}
      <div data-z100-probe className="fixed inset-0 z-[100]" style={{ background: 'transparent', pointerEvents: 'auto', display: 'none' }} />
      {/* The same four glyphs the composer's chips draw, for the drift check. */}
      <div data-chip-row className="fixed top-0 left-0 opacity-0 pointer-events-none">
        {(['doc', 'contact', 'campaign', 'form'] as const).map((t) => (
          <span key={t} data-chip={t}><AttachTypeIcon type={t} /></span>
        ))}
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
`;
}

// ═════════════════════════════════════════════════════════════════════════════
// The page-side helpers, injected once and reused by every measurement.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ `getBoundingClientRect()` reports the SCALED box, so anything read while a
 * keyframe runs is a FRAME rather than a layout. Animation is suppressed in the
 * page's own stylesheet (see the `<style>` below), and these helpers still wait
 * for two frames after every interaction so React has committed.
 */
const PAGE_HELPERS = `
const raf2 = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const settle = async () => { await raf2(); await sleep(60); await raf2(); };
const box = (el) => {
  if (!el) return null;
  const b = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return { x: b.x, y: b.y, w: b.width, h: b.height, top: b.top, bottom: b.bottom, right: b.right,
           position: cs.position, display: cs.display, zIndex: cs.zIndex,
           paddingBottom: cs.paddingBottom, opacity: cs.opacity, visibility: cs.visibility };
};
const q = (s) => document.querySelector(s);
const txt = (el) => (el ? (el.textContent || '').trim() : '');
/** Click by dispatching the events Base UI listens for, in order. */
const click = async (el) => {
  if (!el) throw new Error('click: no element');
  el.scrollIntoView({ block: 'center' });
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    el.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, { bubbles: true, cancelable: true, view: window }));
  }
  await settle();
};
/** Open the DM thread from the conversation list. */
const openDm = async () => {
  const btn = [...document.querySelectorAll('button')].find(b => /Pastor Adams/.test(b.textContent || ''));
  await click(btn);
  return !!q('[data-composer]');
};
const backOut = async () => {
  const back = q('[data-composer]') ? [...document.querySelectorAll('button')].find(b => b.querySelector('svg.lucide-arrow-left')) : null;
  await click(back);
};
`;

// ═════════════════════════════════════════════════════════════════════════════

interface Box {
  x: number; y: number; w: number; h: number; top: number; bottom: number; right: number;
  position: string; display: string; zIndex: string; paddingBottom: string;
  opacity: string; visibility: string;
}

interface Reading {
  viewport: number;
  navShown: Box | null;
  navHiddenInThread: Box | null;
  navBackAfterExit: Box | null;
  /** Still hidden when a second conversation is opened straight after. */
  navInSecondThread: Box | null;
  /** The control for the unmount case — hidden again before the screen goes. */
  navWhileOpenAgain: Box | null;
  /** 🔴 The nav after the screen UNMOUNTS with a conversation still open. */
  navAfterUnmount: Box | null;
  composerBefore: Box | null;
  composerAfterScroll: Box | null;
  scrollerScrolledBy: number;
  lastBubbleBottom: number;
  composerTop: number;
  scrollWidth: number;
  viewportH: number;
  /** Every ancestor of the composer, and whether it could contain a `fixed`. */
  containingBlockers: { tag: string; cls: string; transform: string; filter: string; perspective: string; willChange: string; contain: string }[];
  /** The composer pill's controls, for the 44px floor. */
  controls: { label: string; w: number; h: number }[];
  navTapHit: string;
}

interface MenuFlow {
  readsOnMount: number;
  readsAfterOpen: number;
  triggerFound: boolean;
  categories: string[];
  positionerInline: string;
  positionerOpacity: string;
  popup: Box | null;
  sampled: number;
  coveredByZ100: number;
  notMenu: number;
  /** Pixels of the open menu covered by a REAL surface — composer or nav. */
  coveredByReal: number;
  positionerZ: string;
  popupZ: string;
  portalledToBody: boolean;
  submenuItems: string[];
  browseFound: boolean;
  dialogOpen: boolean;
  dialogBox: Box | null;
  hasSearchInput: boolean;
  cascaderRoots: string[];
  deepSearchHits: string[];
  attached: { title: string } | null;
  /** One commit per category, driven through the recents flyout. */
  attachedByCategory: { label: string; rowText: string; chips: string[] }[];
  menuIconPaths: string[];
  chipIconPaths: string[];
  rowHeights: number[];
}

let browser: MeasuringBrowser;
let harnessDir = '';
let pageDir = '';
let outDir = '';
const readings = new Map<number, Reading>();
let adminFlow: MenuFlow;
let memberSeesPaperclip = true;

beforeAll(async () => {
  harnessDir = mkdtempSync(path.join(ROOT, 'node_modules', '.the348-'));
  writeFileSync(path.join(harnessDir, 'firebase-stub.ts'), FIREBASE_STUB);
  writeFileSync(path.join(harnessDir, 'firestore-stub.ts'), FIRESTORE_STUB);
  writeFileSync(path.join(harnessDir, 'entry.tsx'), entrySource());

  outDir = mkdtempSync(path.join(os.tmpdir(), 'the348-out-'));
  await build({
    root: ROOT,
    configFile: false,
    logLevel: 'error',
    plugins: [react()],
    // ⚠️ `development`, deliberately: React 18's production `jsx-dev-runtime` is
    // an empty stub, so a production define with a dev JSX transform bundles a
    // page that throws before it mounts. Layout is identical either way.
    define: { 'process.env.NODE_ENV': '"development"' },
    resolve: {
      alias: [
        { find: /^@\/firebase$/, replacement: path.join(harnessDir, 'firebase-stub.ts') },
        { find: /^\.\.\/firebase$/, replacement: path.join(harnessDir, 'firebase-stub.ts') },
        { find: /^firebase\/firestore$/, replacement: path.join(harnessDir, 'firestore-stub.ts') },
        { find: /^@\//, replacement: path.join(ROOT, 'src') + '/' },
      ],
    },
    build: {
      outDir, emptyOutDir: true, copyPublicDir: false, minify: false,
      lib: { entry: path.join(harnessDir, 'entry.tsx'), formats: ['iife'], name: 'THE348', fileName: () => 'bundle.js' },
    },
  });

  const js = readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
  const css = await buildAppCss();
  pageDir = mkdtempSync(path.join(os.tmpdir(), 'the348-page-'));
  const file = path.join(pageDir, 'member-composer.html');
  writeFileSync(
    file,
    `<!doctype html><html data-theme="light"><head><meta charset="utf-8">` +
      `<style>${css}</style>` +
      /*
       * 🔴 ANIMATION IS SUPPRESSED BEFORE ANYTHING IS MEASURED, and this is a
       * correctness fix rather than a flake suppression. `DropdownMenuContent`
       * carries `zoom-in-95`, a keyframe from `scale(0.95)` to `scale(1)`, and
       * `getBoundingClientRect()` reports the SCALED box — #490 measured an
       * attach row at 41.79998779296875px, which is 44 × 0.95 to seven decimal
       * places, and a `TabsTrigger` at 7.7469px because `transition-all`
       * animates `min-height`. A wall-clock wait cannot fix that: on a loaded
       * runner the wait is spent before the menu opens and the FIRST frame is
       * what gets read. Suppressing the animation makes every number below the
       * RESTING layout, which is the only thing "this control is ≥44px" can
       * mean. A control that is genuinely too short still fails.
       */
      `<style>*,*::before,*::after{animation:none !important;transition:none !important}</style>` +
      `</head><body><div id="root"></div>` +
      // ⚠️ A `process` SHIM. This bundle reaches further than THE-337's did —
      // `UserMessages` pulls in tenant-scope, the super-admin list and the DM
      // helper — and something down that chain reads `process.env` at module
      // scope. A browser has no `process`, so the page threw before it mounted
      // and every measurement came back as one opaque CDP exception.
      `<script>window.process={env:{NODE_ENV:'development'}};</script>` +
      `<script>window.__err=null;window.addEventListener('error',(e)=>{window.__err=String(e.message)});</script>` +
      `<script>${js}</script></body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  /**
   * 🔴 READ BEFORE ANYTHING IS CLICKED. This is the only moment in the run when
   * no menu has ever been opened, so it is the only moment that can answer "did
   * mounting the composer read Firestore". Reloading later to re-create it does
   * not work — the navigation tears the CDP evaluation down.
   */
  const readsOnMount = await browser.evaluateAt<number>(
    380,
    `(async () => { ${PAGE_HELPERS}
       await settle();
       if (window.__err) throw new Error('the page threw: ' + window.__err);
       return (globalThis.__reads ?? 0);
     })()`,
    800,
  );

  // ── Per-width layout readings, as a MEMBER (the default role) ─────────────
  for (const v of VIEWPORTS) {
    const r = await browser.evaluateAt<Reading>(
      v,
      `(async () => { ${PAGE_HELPERS}
        globalThis.__role = 'user';
        await settle();
        const navShown = box(q('[data-shell-bottom-nav]'));
        await openDm();
        const composer = q('[data-composer]');
        const scroller = q('[data-thread-scroller]');
        const composerBefore = box(composer);
        const navHiddenInThread = box(q('[data-shell-bottom-nav]'));

        // 🔴 SCROLL THE LIST, NOT THE PAGE. The founder's bug is the composer
        // travelling while the conversation moves under it.
        scroller.scrollTop = 0;
        await settle();
        const atTop = box(composer);
        scroller.scrollTop = scroller.scrollHeight;
        await settle();
        const composerAfterScroll = box(composer);
        const scrollerScrolledBy = scroller.scrollTop;

        // The newest bubble must not end up underneath the composer.
        const bubbles = [...scroller.querySelectorAll('div')].filter(d => /^Message \\d+/.test(d.textContent || '') && d.children.length === 0);
        const lastBubbleBottom = bubbles.length ? bubbles[bubbles.length - 1].getBoundingClientRect().bottom : -1;

        // Every ancestor that could turn position:fixed back into containment.
        const containingBlockers = [];
        for (let el = composer.parentElement; el && el !== document.documentElement; el = el.parentElement) {
          const cs = getComputedStyle(el);
          containingBlockers.push({ tag: el.tagName.toLowerCase(), cls: el.className || '',
            transform: cs.transform, filter: cs.filter, perspective: cs.perspective,
            willChange: cs.willChange, contain: cs.contain });
        }

        const controls = [...composer.querySelectorAll('button,[role=button],input')].map(el => {
          const b = el.getBoundingClientRect();
          return { label: el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.tagName.toLowerCase(), w: b.width, h: b.height };
        });

        // A tap in the middle of the nav's old band, while a thread is open.
        const probe = document.elementFromPoint(Math.floor(window.innerWidth / 2), window.innerHeight - 20);
        const navTapHit = probe ? (probe.closest('[data-shell-bottom-nav]') ? 'nav' : (probe.closest('[data-composer]') ? 'composer' : 'other')) : 'none';

        // ── EXIT 1 · the back arrow ────────────────────────────────────
        await backOut();
        const navBackAfterExit = box(q('[data-shell-bottom-nav]'));

        // ── EXIT 2 · switching straight from one conversation to another ──
        await openDm();
        const chan = [...document.querySelectorAll('button')].find(b => /general/.test(b.textContent || ''));
        await click(q('[data-composer]') ? [...document.querySelectorAll('button')].find(b => b.querySelector('svg.lucide-arrow-left')) : null);
        await click(chan);
        const navInSecondThread = box(q('[data-shell-bottom-nav]'));
        await backOut();

        // ── EXIT 3 · 🔴 NAVIGATING AWAY — the screen UNMOUNTS ─────────────
        // The one exit the effect's CLEANUP is the only cover for. Deleting
        // that cleanup leaves the two exits above working and this one broken,
        // which is exactly the trap: a nav with no way back.
        await openDm();
        const navWhileOpenAgain = box(q('[data-shell-bottom-nav]'));
        window.__setMounted(false);
        await settle();
        const navAfterUnmount = box(q('[data-shell-bottom-nav]'));
        window.__setMounted(true);
        await settle();

        return { viewport: window.innerWidth, navShown, navHiddenInThread, navBackAfterExit,
                 navInSecondThread, navWhileOpenAgain, navAfterUnmount,
                 composerBefore: atTop, composerAfterScroll, scrollerScrolledBy,
                 lastBubbleBottom, composerTop: composerAfterScroll ? composerAfterScroll.top : -1,
                 scrollWidth: document.documentElement.scrollWidth, viewportH: window.innerHeight,
                 containingBlockers, controls, navTapHit };
      })()`,
      800,
    );
    readings.set(v, r);
  }

  // ── A MEMBER sees no paperclip ────────────────────────────────────────────
  memberSeesPaperclip = await browser.evaluateAt<boolean>(
    380,
    `(async () => { ${PAGE_HELPERS}
       globalThis.__role = 'user';
       await settle();
       await openDm();
       return !!q('[data-composer] [aria-label="Attach a record"]');
     })()`,
    800,
  );

  // ── An ADMIN gets the whole menu ──────────────────────────────────────────
  adminFlow = await browser.evaluateAt<MenuFlow>(
    380,
    `(async () => { ${PAGE_HELPERS}
      const readsOnMount = globalThis.__reads ?? 0;
      window.__setRole('church_admin');
      globalThis.__reads = 0;
      await settle();
      await openDm();

      const trigger = q('[data-composer] [aria-label="Attach a record"]');
      const triggerFound = !!trigger;
      // 🔴 DEGRADE, DO NOT THROW. A first version called click() straight
      // through, so restoring the old forms-only paperclip crashed the whole
      // evaluation with "click: no element" and vitest reported 39 SKIPPED
      // tests behind one opaque suite error. A guard whose failure mode is a
      // crash tells you the page broke, not WHICH claim broke — so the flow
      // returns an empty, well-formed reading instead and every assertion
      // below fails in its own words.
      if (!trigger) {
        return { readsOnMount, readsAfterOpen: globalThis.__reads ?? 0, triggerFound: false,
          categories: [], positionerInline: '', positionerOpacity: '', popup: null,
          sampled: 0, coveredByZ100: 0, notMenu: 0, coveredByReal: 0,
          positionerZ: '', popupZ: '', portalledToBody: false,
          submenuItems: [], browseFound: false, dialogOpen: false, dialogBox: null,
          hasSearchInput: false, cascaderRoots: [], deepSearchHits: [], attached: null,
          attachedByCategory: [], menuIconPaths: [], chipIconPaths: [], rowHeights: [] };
      }
      await click(trigger);
      const readsAfterOpen = globalThis.__reads ?? 0;

      // The POPUP and, above it, the POSITIONER — #480's bug lived in the gap
      // between the two, so both are read.
      const popupEl = document.querySelector('[role=menu]');
      const positioner = popupEl ? popupEl.parentElement : null;
      const categories = popupEl ? [...popupEl.querySelectorAll('[role=menuitem]')].map(txt) : [];
      const rowHeights = popupEl ? [...popupEl.querySelectorAll('[role=menuitem]')].map(e => e.getBoundingClientRect().height) : [];

      // 🔴 HIT-TEST EVERY PIXEL OF THE OPEN MENU against a layer sitting at the
      // nav's own z-[100]. A class read cannot see #480's defect, because the
      // class was RIGHT and the element it landed on was wrong.
      let sampled = 0, coveredByZ100 = 0, notMenu = 0;
      const probe = q('[data-z100-probe]');
      // 🔴 READ THE BOX HERE, WHILE THE MENU IS OPEN. A first version returned
      // box(popupEl) from the final result object — by which time Browse… had
      // closed the menu, so every dimension came back 0 and "the menu is
      // visible" would have been asserted against an empty rectangle.
      const popupOpen = box(popupEl);
      // 🔴 READ WHILE OPEN, for the same reason the box is. By the end of this
      // flow the menu has been closed and reopened five times and popupEl is
      // DETACHED — parentElement is null, getComputedStyle answers '', and the
      // layer assertion would compare '' to '50' rather than measuring.
      const positionerOpen = box(positioner);
      // The occluders that are actually on the page: the fixed composer and
      // the bottom nav. Sampled FIRST, with the synthetic probe still off.
      let coveredByReal = 0;
      if (popupEl) {
        const b = popupEl.getBoundingClientRect();
        // 🔴 THE WHOLE BOX, EDGES INCLUDED. A first version stepped
        // (height - 4) / 8 from top+2 and stopped 22px short of the bottom
        // edge — which is precisely where the fixed composer overlaps it. A
        // sweep that cannot reach the contested pixels is not a sweep.
        const xs = [], ys = [];
        for (let i = 0; i <= 10; i++) {
          xs.push(b.left + 1 + (b.width - 2) * (i / 10));
          ys.push(b.top + 1 + (b.height - 2) * (i / 10));
        }
        for (const px of xs) for (const py of ys) {
          const hit = document.elementFromPoint(Math.round(px), Math.round(py));
          if (!hit) continue;
          sampled++;
          const inMenu = popupEl.contains(hit) || hit === popupEl;
          if (!inMenu) {
            notMenu++;
            if (hit.closest('[data-composer]') || hit.closest('[data-shell-bottom-nav]')) coveredByReal++;
          }
        }
        // Now switch the synthetic z-[100] layer on and sweep again.
        probe.style.display = 'block';
        await settle();
        for (const px of xs) for (const py of ys) {
          const hit = document.elementFromPoint(Math.round(px), Math.round(py));
          if (hit && hit.closest('[data-z100-probe]')) coveredByZ100++;
        }
        probe.style.display = 'none';
        await settle();
      }

      // Open the first category's flyout, then Browse…
      const first = popupEl ? popupEl.querySelector('[role=menuitem]') : null;
      await click(first);
      const sub = [...document.querySelectorAll('[role=menu]')].filter(m => m !== popupEl).pop();
      const submenuItems = sub ? [...sub.querySelectorAll('[role=menuitem]')].map(txt) : [];
      const browseEl = sub ? [...sub.querySelectorAll('[role=menuitem]')].find(e => /Browse/.test(txt(e))) : null;
      const browseFound = !!browseEl;
      await click(browseEl);

      const dialog = document.querySelector('[role=dialog]');
      const dialogOpen = !!dialog;
      const searchInput = dialog ? dialog.querySelector('input') : null;
      const cascaderRoots = dialog ? [...dialog.querySelectorAll('[role=option]')].map(txt) : [];

      // 🔴 DEEP SEARCH: one query, hits from more than one category. A 'level'
      // scope would only ever filter the level you are standing on.
      let deepSearchHits = [];
      if (searchInput) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(searchInput, 'a');
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        await settle();
        deepSearchHits = [...dialog.querySelectorAll('[role=option]')].map(txt);
      }

      const dialogBox = box(dialog);

      // Close the browse dialog before driving the menu again.
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle();

      // 🔴 ONE RECORD FROM EACH OF THE FOUR, committed through the recents —
      // the path a person actually takes. Asserting only that four LABELS are
      // printed would pass on a menu whose rows commit nothing, which is the
      // shape of defect the founder reported in the first place.
      const attachedByCategory = [];
      for (let i = 0; i < 4; i++) {
        await click(q('[data-composer] [aria-label="Attach a record"]'));
        const menu = document.querySelector('[role=menu]');
        const cat = menu ? [...menu.querySelectorAll('[role=menuitem]')][i] : null;
        const label = txt(cat);
        await click(cat);
        const flyout = [...document.querySelectorAll('[role=menu]')].filter(m => m !== menu).pop();
        const row = flyout ? [...flyout.querySelectorAll('[role=menuitem]')].find(e => !/Browse/.test(txt(e))) : null;
        const rowText = txt(row);
        await click(row);
        const chips = [...document.querySelectorAll('[data-composer] .truncate')].map(txt);
        attachedByCategory.push({ label, rowText, chips });
      }
      const attached = attachedByCategory.length ? { title: attachedByCategory[0].rowText } : null;

      const pathsOf = (root) => root ? [...root.querySelectorAll('svg path')].map(p => p.getAttribute('d') || '') : [];
      return {
        readsOnMount, readsAfterOpen, triggerFound, categories,
        positionerInline: positioner ? (positioner.getAttribute('style') || '') : '',
        positionerOpacity: positioner ? getComputedStyle(positioner).opacity : '',
        popup: popupOpen, sampled, coveredByZ100, notMenu, coveredByReal,
        positionerZ: String(positionerOpen?.zIndex ?? ''),
        popupZ: String(popupOpen?.zIndex ?? ''),
        portalledToBody: !!popupEl && !q('[data-composer]').contains(popupEl),
        submenuItems, browseFound, dialogOpen, dialogBox,
        hasSearchInput: !!searchInput, cascaderRoots, deepSearchHits, attached, attachedByCategory,
        menuIconPaths: pathsOf(popupEl), chipIconPaths: pathsOf(q('[data-chip-row]')),
        rowHeights,
      };
    })()`,
    800,
  );
}, 300_000);

afterAll(async () => {
  await browser?.close();
  for (const d of [harnessDir, pageDir, outDir]) {
    if (d) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
});

const at = (v: number): Reading => {
  const r = readings.get(v);
  if (!r) throw new Error(`no reading at ${v}px`);
  return r;
};

// ═════════════════════════════════════════════════════════════════════════════
// 1 · The composer is FIXED at the bottom of a conversation.
// ═════════════════════════════════════════════════════════════════════════════

describe('the composer is FIXED at the bottom of a conversation', () => {
  it('resolves position: fixed below lg, at 380px', () => {
    const r = at(380);
    expect(r.composerBefore, 'no composer was found in the open thread').not.toBeNull();
    expect(r.composerBefore!.position, 'the composer is not fixed at 380px').toBe('fixed');
  });

  it('and its bottom edge IS the viewport bottom, before and after scrolling', () => {
    const r = at(380);
    expect(Math.abs(r.composerBefore!.bottom - r.viewportH), 'the composer does not sit on the viewport bottom before scrolling').toBeLessThanOrEqual(1);
    expect(Math.abs(r.composerAfterScroll!.bottom - r.viewportH), 'the composer left the viewport bottom after scrolling').toBeLessThanOrEqual(1);
  });

  it('the same holds at 768px — 768 is still a phone for this purpose', () => {
    const r = at(768);
    expect(r.composerBefore!.position).toBe('fixed');
    expect(Math.abs(r.composerBefore!.bottom - r.viewportH)).toBeLessThanOrEqual(1);
  });

  it('and NOTHING in its ancestor chain turns `fixed` back into containment', () => {
    // 🔴 The real trap, and the reason this is measured rather than grepped: a
    // `transform`, `filter`, `perspective`, `contain: paint` or `will-change`
    // on ANY ancestor makes a fixed child position against that ancestor
    // instead of the viewport — silently, with no warning and no class to read.
    // MainApp wraps this screen in a `motion.div`, which is exactly the kind of
    // element that carries one.
    for (const v of VIEWPORTS.filter((w) => w < LG)) {
      for (const a of at(v).containingBlockers) {
        const why = `${a.tag}.${String(a.cls).slice(0, 60)} at ${v}px`;
        expect(a.transform, `${why} has a transform, which would contain the fixed composer`).toBe('none');
        expect(a.filter, `${why} has a filter, which would contain the fixed composer`).toBe('none');
        expect(a.perspective, `${why} has a perspective, which would contain the fixed composer`).toBe('none');
        expect(a.contain, `${why} has containment, which would contain the fixed composer`).not.toMatch(/paint|layout|strict|content/);
      }
    }
  });

  it('but from lg up it goes BACK into flow — #475: no full-width slam on desktop', () => {
    // The thread is the right-hand column beside a 360px rail above `lg`. An
    // `inset-x-0` composer there would run edge to edge across a 1440px screen,
    // which is the exact defect #475 fixed on this file's sheets.
    for (const v of VIEWPORTS.filter((w) => w >= LG)) {
      const r = at(v);
      expect(r.composerBefore!.position, `the composer is still fixed at ${v}px`).not.toBe('fixed');
      expect(r.composerBefore!.x, `the composer starts at the screen edge at ${v}px`).toBeGreaterThan(0);
      expect(r.composerBefore!.w, `the composer spans the whole screen at ${v}px`).toBeLessThan(v);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · It does not MOVE when the message list scrolls.
// ═════════════════════════════════════════════════════════════════════════════

describe('the composer does not move when the message list scrolls', () => {
  it('the list really did scroll — the control, so this is not vacuous', () => {
    // 🔴 Two measurements that are equal because NOTHING HAPPENED prove
    // nothing. #490 shipped a measured guard that hardcoded element order and
    // kept passing while a button moved; a scroll that never occurred is the
    // same class of hole.
    for (const v of VIEWPORTS.filter((w) => w < LG)) {
      expect(at(v).scrollerScrolledBy, `the thread did not scroll at all at ${v}px`).toBeGreaterThan(100);
    }
  });

  it('and the composer reads the SAME y at the top of the thread and at the bottom', () => {
    for (const v of VIEWPORTS.filter((w) => w < LG)) {
      const r = at(v);
      expect(r.composerAfterScroll!.y, `the composer moved ${Math.abs(r.composerAfterScroll!.y - r.composerBefore!.y)}px when the list scrolled at ${v}px`)
        .toBeCloseTo(r.composerBefore!.y, 1);
    }
  });

  it('and it is VIEWPORT-fixed at both readings — which is what makes "same y" mean anything', () => {
    // 🔴 THE MUTATION THAT BREAKS THIS ONE IS `FIXED_COMPOSER = ''`, and the
    // assertion above alone would NOT have caught it. The thread's own message
    // list is an internal scroller, so an in-flow composer below it does not
    // move when that list scrolls either — the two y readings would agree, and
    // the guard would pass on the defect. The founder's bug is the PAGE
    // moving, which is `100vh` on iOS and is not reproducible in headless
    // Chromium; what closes it is that the composer resolves against the
    // viewport rather than against the column. So that property is asserted at
    // both readings, and it is the thing the mutation flips.
    for (const v of VIEWPORTS.filter((w) => w < LG)) {
      const r = at(v);
      expect(r.composerBefore!.position, `the composer is not viewport-fixed at the top of the thread at ${v}px`).toBe('fixed');
      expect(r.composerAfterScroll!.position, `the composer stopped being viewport-fixed after scrolling at ${v}px`).toBe('fixed');
    }
  });

  it('and the newest message is never left UNDERNEATH it', () => {
    // A `fixed` composer is out of flow, so the scroller has to reserve the
    // band itself — COMPOSER_BAND. This is what proves the number is right.
    for (const v of VIEWPORTS.filter((w) => w < LG)) {
      const r = at(v);
      expect(r.lastBubbleBottom, `no message bubble was found at ${v}px`).toBeGreaterThan(0);
      expect(r.lastBubbleBottom, `the newest message is hidden under the composer at ${v}px`)
        .toBeLessThanOrEqual(r.composerTop + 1);
    }
  });

  it('nothing overflows the viewport at any width', () => {
    for (const v of VIEWPORTS) {
      expect(at(v).scrollWidth, `the page scrolls horizontally at ${v}px`).toBeLessThanOrEqual(v + 1);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · The bottom nav is HIDDEN inside a conversation.
// ═════════════════════════════════════════════════════════════════════════════

describe('the bottom nav is hidden inside a conversation', () => {
  it('the nav occupies a real band at 380px when NO conversation is open', () => {
    // The control: if the nav measured nothing when shown, the hidden case
    // would pass vacuously.
    const r = at(380);
    expect(r.navShown, 'no bottom nav was rendered at all').not.toBeNull();
    expect(r.navShown!.h, 'the bottom nav has no height even when shown').toBeGreaterThan(40);
    expect(r.navShown!.bottom, 'the shown nav is not on the viewport bottom').toBeCloseTo(r.viewportH, 0);
  });

  it('and it is OFF THE VIEWPORT at 380px once a thread is open', () => {
    const r = at(380);
    expect(r.navHiddenInThread!.top, 'the nav is still on screen inside a conversation at 380px')
      .toBeGreaterThanOrEqual(r.viewportH - 1);
  });

  it('and the band is given BACK — a tap there lands on the composer, not the nav', () => {
    // 🔴 A z-index would repaint the nav under the thread while it still
    // swallowed every tap in its 65px band. This is the hit test that tells
    // the two apart, and it is why "hidden" is not asserted from a class.
    for (const v of VIEWPORTS.filter((w) => w < LG)) {
      expect(at(v).navTapHit, `a tap in the nav's old band still hits the nav at ${v}px`).not.toBe('nav');
    }
  });

  it('768px is still a phone for this purpose', () => {
    const r = at(768);
    expect(r.navHiddenInThread!.top).toBeGreaterThanOrEqual(r.viewportH - 1);
  });

  it('but the DESKTOP RAIL survives the same flag from lg up', () => {
    // The same element is the side rail above `lg`. An unscoped hide would
    // strip it, which is why the shipped condition is `max-lg:` gated.
    for (const v of VIEWPORTS.filter((w) => w >= LG)) {
      const r = at(v);
      expect(r.navHiddenInThread!.h, `the desktop rail lost its height at ${v}px`).toBeGreaterThan(0);
      expect(r.navHiddenInThread!.top, `the desktop rail was pushed off screen at ${v}px`).toBeLessThan(r.viewportH);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 · The nav returns on EVERY exit.
// ═════════════════════════════════════════════════════════════════════════════

describe('the nav returns on every exit', () => {
  it('the BACK ARROW brings it back, at every width below lg', () => {
    // ⚠️ #490's lesson, and the reason this ticket has a STOP condition for it:
    // *"a nav that stays hidden is a trap with no way out."*
    for (const v of VIEWPORTS.filter((w) => w < LG)) {
      const r = at(v);
      expect(r.navBackAfterExit, `no nav after backing out at ${v}px`).not.toBeNull();
      expect(r.navBackAfterExit!.bottom, `the nav did not come back after the back arrow at ${v}px`)
        .toBeCloseTo(r.viewportH, 0);
    }
  });

  it('SWITCHING conversations keeps it hidden — the exit that is not an exit', () => {
    // The control for the other two: moving from one thread straight into
    // another is NOT leaving a conversation, so the nav must stay away. A
    // signal that fired `false` on every dependency change would flash the nav
    // back for a frame here.
    for (const v of VIEWPORTS.filter((w) => w < LG)) {
      const r = at(v);
      expect(r.navInSecondThread!.top, `the nav came back between two conversations at ${v}px`)
        .toBeGreaterThanOrEqual(r.viewportH - 1);
    }
  });

  it('🔴 NAVIGATING AWAY brings it back — the screen unmounts with a thread OPEN', () => {
    // 🔴 THE TRAP, AND THE ONLY EXIT THE CLEANUP IS THE SOLE COVER FOR. The
    // back arrow and switching both re-run the effect, so its BODY sends the
    // new value and the nav returns even with the cleanup deleted. Leaving the
    // Messages tab UNMOUNTS this screen, and nothing runs but the cleanup.
    //
    // ⚠️ THIS ASSERTION WAS ADDED BECAUSE DELETING THE CLEANUP DID NOT FAIL
    // ANYTHING. The mutation was run, the measured suite stayed green, and the
    // guard was therefore not guarding — so the harness gained a mount switch
    // and this case. It fails now.
    for (const v of VIEWPORTS.filter((w) => w < LG)) {
      const r = at(v);
      // The control: it really was hidden immediately before the unmount.
      expect(r.navWhileOpenAgain!.top, `the nav was already visible before the unmount at ${v}px`)
        .toBeGreaterThanOrEqual(r.viewportH - 1);
      expect(r.navAfterUnmount!.bottom, `the nav stayed hidden after the screen was left at ${v}px — a trap with no way out`)
        .toBeCloseTo(r.viewportH, 0);
    }
  });

  it('and it comes back to EXACTLY where it was — not merely to somewhere', () => {
    for (const v of VIEWPORTS) {
      const r = at(v);
      expect(r.navBackAfterExit!.y, `the nav returned to a different y at ${v}px`).toBeCloseTo(r.navShown!.y, 1);
      expect(r.navBackAfterExit!.h, `the nav returned at a different height at ${v}px`).toBeCloseTo(r.navShown!.h, 1);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5 · An ADMIN's paperclip opens the FULL attach menu.
// ═════════════════════════════════════════════════════════════════════════════

describe("an ADMIN's paperclip opens the full attach menu", () => {
  it('there is a paperclip at all, and it is AttachMenu’s trigger', () => {
    expect(adminFlow.triggerFound, 'an admin has no attach trigger in the DM composer').toBe(true);
  });

  it('and it offers the FOUR categories, by their exact labels', () => {
    // 🔴 `campaigns` reads "Fundraising" and nowhere reads "Campaigns". The
    // four are frozen in `lib/attach-records.ts`; this asserts the SHIPPED
    // menu prints them, in order, rather than that the constant exists.
    expect(adminFlow.categories).toEqual(['Notes & Docs', 'Contacts', 'Fundraising', 'Forms']);
  });

  it('the forms-only sheet it replaced is GONE — no "Attach a Form" heading renders', () => {
    // The founder's words: *"it appears attach a form, not all that is in
    // community"*. A menu that opened beside a surviving sheet would satisfy
    // every other assertion here.
    expect(adminFlow.categories.join(' '), 'the forms-only sheet is still reachable').not.toMatch(/Attach a Form/);
  });

  it('each category flyout carries its recents and then Browse…', () => {
    expect(adminFlow.submenuItems.length, 'the first flyout is empty').toBeGreaterThan(1);
    expect(adminFlow.submenuItems.at(-1), 'Browse… is not the last row of the flyout').toMatch(/Browse/);
    // 2–3 recents, then Browse… — the founder asked for "2 3 recent ones".
    expect(adminFlow.submenuItems.length - 1).toBeLessThanOrEqual(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6 · 🔴 The menu is VISIBLE — measured, never asserted from a class.
// ═════════════════════════════════════════════════════════════════════════════

describe('the menu is VISIBLE', () => {
  it('it has a real box — #480 painted one at opacity 0 in the corner', () => {
    // ⚠️ The exact shape of THE-337's defect: the menu WAS in the DOM,
    // focusable, and answered a hit test, while `Menu.Positioner` sat at its
    // pre-measurement state. A class read cannot tell the two apart.
    const p = adminFlow.popup;
    expect(p, 'no menu popup was found at all').not.toBeNull();
    expect(p!.w, 'the menu has no width').toBeGreaterThan(100);
    expect(p!.h, 'the menu has no height').toBeGreaterThan(100);
    expect(p!.opacity, 'the menu is painted transparent').toBe('1');
    expect(p!.visibility).toBe('visible');
  });

  it('and the POSITIONER actually measured — it is not parked at translate(0,0)', () => {
    // 🔴 THE FIELD THE BUG LIVED IN. With no anchor node Base UI never runs a
    // measurement: the positioner keeps `transform: translate(0px, 0px)` and
    // leaves `--anchor-width` unset. Both are read off the shipped element.
    expect(adminFlow.positionerInline, 'the positioner never anchored').toMatch(/translate\(/);
    expect(adminFlow.positionerInline, 'the positioner is parked at its pre-measurement origin').not.toMatch(/translate\(0px,\s*0px\)/);
    expect(adminFlow.positionerInline, 'Base UI never measured the trigger — --anchor-width is unset').toMatch(/--anchor-width:\s*\d/);
  });

  it('it is portalled out of the composer, so a fixed composer cannot clip it', () => {
    expect(adminFlow.portalledToBody, 'the menu renders inside the composer and can be clipped by it').toBe(true);
  });

  it('🔴 NO pixel of it is covered by any surface that actually ships', () => {
    // 🔴 THE FOUNDER-FACING CLAIM, asked as a hit test over the menu's WHOLE
    // box — edges included. The first version of this sweep stepped from
    // top+2 and stopped 22px short of the bottom edge, which is exactly where
    // the fixed composer overlaps the menu, and it reported zero.
    //
    // ⚠️ IT FOUND A REAL DEFECT THIS TICKET INTRODUCED. The composer shipped
    // as `max-lg:z-[101]` — reasoning that a fixed composer must clear the
    // nav's `z-[100]` — and 22 of 121 sampled pixels came back covered by it:
    // the menu opens UPWARD from the paperclip and its bottom edge lands in
    // the composer's band. Inside a conversation the nav is hidden, so there
    // was nothing at 100 to clear; the composer is `max-lg:z-10` now.
    expect(adminFlow.sampled, 'no pixel of the menu was sampled — this assertion is vacuous').toBeGreaterThan(100);
    expect(adminFlow.coveredByReal, 'a shipped surface — the composer or the nav — covers the open menu').toBe(0);
  });

  /**
   * 🔴 AND THE LAYER THE MENU ACTUALLY PAINTS AT, PINNED RATHER THAN NARRATED.
   *
   * #480's bug was a z-index that landed on the POPUP while the POSITIONER
   * kept its own. `DropdownMenuContent`'s className styles the popup, and
   * `ui/dropdown-menu.tsx` hardcodes the positioner above it as `isolate
   * z-50`; `isolation: isolate` opens a stacking context, so the popup's own
   * `z-[110]` is painted at the positioner's 50.
   *
   * ⚠️ THE-337 MEASURED THIS AND COULD NOT FIX IT — the one-line change needed
   * (making the positioner's hardcoded class a `cn(...)` a caller can extend)
   * is in a file byte-frozen by nine tickets' digest guards, so it reported it
   * instead. THE-348 is in the same position and does the same, with one
   * difference: it MEASURES the consequence rather than reasoning about it. A
   * synthetic, hit-testable layer at the nav's exact `z-[100]` covers every
   * one of the 121 sampled pixels.
   *
   * 🔴 THE ASSERTIONS BELOW ARE THE RECORD, AND THEY GO RED WHEN IT IS FIXED.
   * The day the positioner can carry its own layer, `positionerZ` stops being
   * '50' and the synthetic layer stops covering the menu — both fail here, and
   * whoever fixes it has to come and delete this block. That is the point: it
   * is not an exemption, it is a note with a tripwire on it.
   */
  it('⚠️ the popup’s z-[110] is INERT — the positioner is the layer, and it is 50', () => {
    expect(adminFlow.popupZ, "the popup no longer carries THE-331's z-[110]").toBe('110');
    expect(adminFlow.positionerZ, 'the positioner’s hardcoded layer moved — re-read the block above').toBe('50');
  });

  it('⚠️ so a layer at the nav’s z-[100] WOULD cover it — measured, and reported', () => {
    // Not a claim that the menu is broken today: nothing at 100 is on screen
    // while a conversation is open, because the nav is hidden and the composer
    // is at 10. It is a claim about what the stacking order actually is.
    expect(adminFlow.coveredByZ100,
      'a z-[100] layer no longer covers the menu — the positioner was fixed, so delete this pin and its block')
      .toBe(adminFlow.sampled);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7 · Browse… opens the cascader, with DEEP search across all four.
// ═════════════════════════════════════════════════════════════════════════════

describe('Browse… opens the cascader with deep search across all four categories', () => {
  it('Browse… is there and opens a dialog with a search field', () => {
    expect(adminFlow.browseFound, 'no Browse… row in the category flyout').toBe(true);
    expect(adminFlow.dialogOpen, 'Browse… opened no dialog').toBe(true);
    expect(adminFlow.hasSearchInput, 'the browse dialog has no search field').toBe(true);
  });

  it('the dialog is visible and clears the menu’s own layer', () => {
    const d = adminFlow.dialogBox!;
    expect(d.w, 'the browse dialog has no width').toBeGreaterThan(100);
    expect(d.opacity).toBe('1');
    expect(Number(d.zIndex), 'the browse dialog sits under the menu it was opened from').toBeGreaterThan(110);
  });

  it('and it roots at all FOUR categories', () => {
    const roots = adminFlow.cascaderRoots.join(' | ');
    for (const label of ['Notes & Docs', 'Contacts', 'Fundraising', 'Forms']) {
      expect(roots, `${label} is not a root of the browse tree`).toContain(label);
    }
  });

  it('🔴 ONE query returns hits from EVERY category — this is `deep`, not `level`', () => {
    // ⚠️ `searchScope` defaults to "level", which filters only the level you
    // are standing on: a search that cannot find a contact while you are
    // looking at Forms is the opposite of the point. The proof is that a single
    // query annotates hits from more than one category — asserted per category
    // so a regression to "level" cannot pass on breadth alone.
    const hits = adminFlow.deepSearchHits;
    expect(hits.length, 'the deep search returned nothing — this assertion would be vacuous').toBeGreaterThan(3);
    for (const label of ['Notes & Docs', 'Contacts', 'Fundraising', 'Forms']) {
      expect(hits.some((h) => h.includes(label)), `one query returned no ${label} hit — searchScope is not deep`).toBe(true);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8 · All four record types ATTACH, and the icon map cannot drift.
// ═════════════════════════════════════════════════════════════════════════════

describe('all four record types attach with their exact labels', () => {
  it('each of the four commits a record through its recents flyout', () => {
    // 🔴 Not "four labels render" — four COMMITS. A menu whose rows print the
    // right words and attach nothing is the defect being fixed, not the fix.
    expect(adminFlow.attachedByCategory.map((a) => a.label))
      .toEqual(['Notes & Docs', 'Contacts', 'Fundraising', 'Forms']);
    for (const a of adminFlow.attachedByCategory) {
      expect(a.rowText.length, `${a.label}'s first recent is an empty row`).toBeGreaterThan(0);
    }
  });

  it('and every commit lands a chip on the composer — cumulatively, one per category', () => {
    adminFlow.attachedByCategory.forEach((a, i) => {
      expect(a.chips.length, `attaching from ${a.label} added no chip`).toBe(i + 1);
      expect(a.rowText, `${a.label}'s chip does not carry the record it committed`).toContain(a.chips[i]);
    });
  });

  it('AttachTypeIcon is SHARED between the menu and the chip — one map, no drift', () => {
    // ⚠️ The chips render through the exported `AttachTypeIcon`; the menu draws
    // its rows from `CATEGORY_ICONS`. Both resolve to the same four Lucide
    // glyphs, so every path the chip row draws must also be drawn by the menu.
    // (The menu draws MORE — each submenu trigger adds a chevron.)
    expect(adminFlow.chipIconPaths.length, 'the chip row drew no glyphs').toBeGreaterThan(4);
    for (const d of adminFlow.chipIconPaths) {
      expect(adminFlow.menuIconPaths, `the chip draws a path the menu does not: ${d}`).toContain(d);
    }
  });

  it('and they are LUCIDE PATHS, not emoji — every glyph is real SVG', () => {
    for (const d of adminFlow.chipIconPaths) {
      expect(d.length, 'an empty path element stood in for an icon').toBeGreaterThan(3);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9 · Records load on FIRST OPEN, not on mount.
// ═════════════════════════════════════════════════════════════════════════════

describe('records load on first open, not on mount', () => {
  it('mounting the composer performs NO attach read', () => {
    // ⚠️ Deliberate, and a no-regression: six Firestore listeners are already
    // live on this screen, and a composer the user never opens should not add
    // four one-shot reads to them.
    expect(adminFlow.readsOnMount, 'the attach records were read before the menu was ever opened').toBe(0);
  });

  it('and opening it reads all four categories — so the claim above is not vacuous', () => {
    expect(adminFlow.readsAfterOpen, 'opening the menu read nothing, so "not on mount" means nothing')
      .toBeGreaterThanOrEqual(4);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10 · 🔴 A NON-ADMIN sees no paperclip.
// ═════════════════════════════════════════════════════════════════════════════

describe('a NON-ADMIN sees no paperclip', () => {
  it('the member’s composer has no attach trigger at all', () => {
    // The founder's third item, in his words: *"The user, non admin should not
    // have the paperclip."* Absent, not disabled.
    expect(memberSeesPaperclip, 'a member can see the attach trigger').toBe(false);
  });

  it('and the SAME screen shows one to an admin — so this is a gate, not a missing feature', () => {
    // 🔴 The control. Without it, deleting the paperclip outright would pass.
    expect(adminFlow.triggerFound).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11 · Every control clears 44px below `sm`; Rule 4 owns density above it.
// ═════════════════════════════════════════════════════════════════════════════

describe('every control ≥44px below sm; Rule 4’s density holds above', () => {
  it('at 380px, every BUTTON in the composer clears 44px on both axes', () => {
    const btns = at(380).controls.filter((c) => c.label !== 'Type a message...');
    expect(btns.length, 'no buttons were found in the composer — vacuous').toBeGreaterThan(0);
    for (const c of btns) {
      expect(c.h, `${c.label} is ${c.h}px tall at 380px`).toBeGreaterThanOrEqual(44);
      expect(c.w, `${c.label} is ${c.w}px wide at 380px`).toBeGreaterThanOrEqual(44);
    }
  });

  it('and every MENU row and submenu row clears 44px too', () => {
    expect(adminFlow.rowHeights.length, 'no menu rows were measured').toBe(4);
    for (const h of adminFlow.rowHeights) {
      expect(h, `a category row is ${h}px tall`).toBeGreaterThanOrEqual(44);
    }
  });

  it('the floor is RELEASED above sm — an unprefixed rule would fight Rule 4', () => {
    for (const v of VIEWPORTS.filter((w) => w > SM)) {
      const btns = at(v).controls.filter((c) => c.label !== 'Type a message...');
      for (const c of btns) {
        expect(c.h, `${c.label} still carries the 44px phone floor at ${v}px`).toBeLessThan(44);
      }
    }
  });
});
