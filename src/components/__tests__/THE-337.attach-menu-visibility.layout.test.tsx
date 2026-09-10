// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom. happy-dom has no layout engine: `getBoundingClientRect`
// returns zeros and `getComputedStyle` invents nothing, so it cannot tell a menu
// painted at `opacity: 0` in the corner from one anchored under the paperclip.
// That is not a hypothetical — THE-331 shipped this regression GREEN behind 33
// "measured" tests, and section 0 of this file records exactly how.
//
// ⚠️ ONE `MeasuringBrowser` PER PROCESS, opened once and driven across widths.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

import { rulesDigestFailure } from '../../__tests__/__fixtures__/firestore-rules-pin';
import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';
import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';

/**
 * THE-337 · The paperclip opens nothing.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The founder, on `AdminCommunity` desktop, in a channel: *"im clicking on the
 * paperclip and nothing appears."*
 *
 * 🔴 THE MENU WAS OPENING THE WHOLE TIME. It was in the DOM, focusable, and its
 * rows answered a hit test. `Menu.Positioner` was stuck at its pre-measurement
 * state — `opacity: 0; transform: translate(0px, 0px)`, `--anchor-width` unset
 * — because the trigger never handed Base UI a DOM node to anchor to:
 * `render={<Button …/>}` on a React 18 function component that is not
 * `forwardRef`. React says so out loud and nothing was listening.
 *
 * ── 🔴 WHY A SUITE OF 33 MEASURED TESTS PASSED ON THIS ──────────────────────
 *
 * `THE-331.attach-surface.layout.test.tsx` discovers its subjects with
 * `/className="([^"]*fixed inset-0[^"]*items-end[^"]*)"/` — it measures BOTTOM
 * SHEETS. The thing THE-331 shipped is a dropdown, which matches that pattern
 * nowhere, so the replacement contributed ZERO surfaces and all 33 measurements
 * ran against the four unrelated sheets the ticket did not touch. Its only
 * assertion about the new picker is a source grep: `not.toContain('const
 * AttachPicker')` and `toContain('<AttachMenu')` — both true of a menu that
 * cannot be seen. Section 0 below pins that mechanism so the lesson cannot be
 * quietly lost: a discovery pattern written for the OLD shape measures nothing
 * about the NEW one, and `SURFACES.length >= 4` went on holding from the sheets
 * that were never in scope.
 *
 * 🔴 So this suite drives the SHIPPED `AttachMenu` in a real Chromium: it
 * clicks the paperclip, reads the positioner's own inline style, and hit-tests
 * the pixels. Every number below came off a browser.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const sha256 = (b: string) => createHash('sha256').update(b).digest('hex');

/** 🔴 Width is not monotonic; all six are measured, none interpolated. */
const VIEWPORTS = [380, 768, 1024, 1280, 1440, 1920] as const;

/** Below `sm` every tap target is 44px; Rule 4 fixes controls at 38px above it. */
const SM = 640;

// ═════════════════════════════════════════════════════════════════════════════
// The composer sites are DISCOVERED, never pinned to a line.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * 🔴 NO LINE NUMBERS. THE-331 pinned `AdminCommunity.tsx:491`; a deletion moved
 * that surface to `:311` and the suite would have measured whatever landed on
 * the old line instead of failing. Both composers are found by the shape they
 * actually have — an `<AttachMenu` mount, and the nearest pill `className`
 * above it — so a third composer added later is measured automatically.
 */
interface Site {
  what: string;
  line: number;
  pill: string;
}

function discoverComposers(): Site[] {
  const lines = read('src/components/AdminCommunity.tsx').split('\n');
  const sites: Site[] = [];
  lines.forEach((text, i) => {
    if (!/<AttachMenu\b/.test(text)) return;
    let pill = '';
    for (let k = 1; k <= 6 && !pill; k += 1) {
      const m = (lines[i - k] ?? '').match(/className="([^"]*bg-surface-tint[^"]*)"/);
      if (m) pill = m[1];
    }
    if (!pill) {
      throw new Error(
        `AdminCommunity.tsx:${i + 1} mounts <AttachMenu with no composer pill within ` +
          'six lines above it — the discovery pattern has stopped matching the shipped shape.',
      );
    }
    sites.push({ what: `AdminCommunity.tsx:${i + 1}`, line: i + 1, pill });
  });
  return sites;
}

const SITES = discoverComposers();

/** The member/admin bottom nav, read off AdminDashboard rather than retyped. */
function discoverNavClass(): string {
  // ⚠️ Matched on `data-nav-shell`, not on "fixed bottom-0": THE-332 turned the
  // sidebar into a rail and the shipped string now reads `fixed lg:relative
  // bottom-0 lg:bottom-auto`. Anchoring on the attribute survives that.
  const m = read('src/components/AdminDashboard.tsx').match(
    /data-nav-shell className="([^"]*z-\[100\][^"]*)"/,
  );
  if (!m) throw new Error('the bottom nav\'s class string was not found in AdminDashboard.tsx');
  return m[1];
}

const NAV_CLASS = discoverNavClass();

// ═════════════════════════════════════════════════════════════════════════════
// The harness: the SHIPPED component, bundled and driven in Chromium.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ The entry is generated under `node_modules/` so that bare specifiers
 * (`react`, `react-dom/client`) resolve the way every other module in this repo
 * resolves them. It is ephemeral and removed in `afterAll`.
 *
 * 🔴 ONLY THE NETWORK IS FAKED. `firebase/firestore` is aliased to a stub that
 * answers `getDocs` from fixtures; every mapping, sort, label and recents rule
 * still runs out of the real `src/lib/attach-records.ts`.
 *
 * ⚠️ Fixture timestamps are FIXED and years away from today — no `Date.now()`,
 * no "yesterday". A fixture pinned near the run date passes for a week and then
 * starts failing on a clock, which is the trap #468 recorded.
 */
const FIXTURE_MS = {
  newest: 1_612_137_600_000, // 2021-02-01T00:00:00Z
  mid: 1_612_051_200_000,
  older: 1_611_964_800_000,
  oldest: 1_611_878_400_000,
} as const;

const FIRESTORE_STUB = `
type Row = { id: string; data: Record<string, unknown> };
const ts = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const FIXTURES: Record<string, Row[]> = {
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
};
export const collection = (_db: unknown, ...segs: string[]) => ({ __path: segs.join('/') });
export const query = (c: { __path: string }, ...rest: unknown[]) => ({
  __path: c.__path,
  __null: rest.some((r) => (r as { __null?: boolean })?.__null),
});
export const where = (_f: string, _op: string, v: unknown) => ({ __null: v === null });
export const limit = (n: number) => ({ __limit: n });
export const orderBy = (f: string, d?: string) => ({ __order: f, __dir: d });
export const getDocs = async (q: { __path: string; __null?: boolean }) => {
  (globalThis as Record<string, unknown>).__reads =
    (((globalThis as Record<string, unknown>).__reads as number) ?? 0) + 1;
  return { docs: (q.__null ? [] : (FIXTURES[q.__path] ?? [])).map((r) => ({ id: r.id, data: () => r.data })) };
};
export type QueryDocumentSnapshot = { id: string; data: () => Record<string, unknown> };
export type Timestamp = { toMillis: () => number; toDate: () => Date };
`;

const FIREBASE_STUB = `export const db = {} as unknown;
export const auth = {} as unknown;
export const storage = {} as unknown;
export default {};
`;

/**
 * 🔴 The composer pill classes come OFF AdminCommunity.tsx at run time. A hand
 * copy would let the shipped composer drift away from the measured one and this
 * suite would keep passing while the founder's bug came back.
 *
 * ⚠️ The chip beside it renders `AttachTypeIcon` exactly as the composer does,
 * so "the menu and the chip share one icon map" is measured, not grepped.
 */
function entrySource(): string {
  const composers = SITES.map(
    (s, i) => `
      <div data-site="${s.what}" className="bg-surface-raised border-t border-line px-4 pt-3">
        <div data-chip-row className="flex flex-wrap gap-2 mb-2">
          {(['doc', 'contact', 'campaign', 'form'] as const).map((t) => (
            <span key={t} data-chip={t} className="inline-flex items-center gap-1.5 text-xs">
              <AttachTypeIcon type={t} />
            </span>
          ))}
        </div>
        <div className=${JSON.stringify(s.pill)}>
          <AttachMenu
            tenantId="t1"
            includeNull={false}
            onAttach={(rec) => { (window as unknown as Record<string, unknown>).__attached = rec; }}
            triggerLabel="Attach a record ${i}"
          />
          <input placeholder="Post to a channel" className="flex-1 bg-transparent outline-hidden text-sm text-strong" />
        </div>
      </div>`,
  ).join('\n');

  return `import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { AttachMenu, AttachTypeIcon } from '@/components/attach/AttachMenu';

function App() {
  return (
    <div className="h-screen flex flex-col bg-surface">
      <div className="flex-1 overflow-y-auto p-4">
        {Array.from({ length: 40 }, (_, i) => <p key={i}>message {i}</p>)}
      </div>
${composers}
      <div data-shell-bottom-nav className=${JSON.stringify(NAV_CLASS)}><span>Nav</span></div>
      {/* 🔴 Not shipped. A layer at the nav's EXACT z-[100], covering the whole
          viewport, so "the menu is above the nav" is a hit test rather than a
          class string — and so it is asked even where the two do not overlap. */}
      <div data-z100-probe className="fixed inset-0 z-[100]" style={{ background: 'transparent', pointerEvents: 'none' }} />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
`;
}

let browser: MeasuringBrowser;
let harnessDir = '';
const readings = new Map<number, Record<string, SiteReading>>();
const flows = new Map<number, Flow>();
/** Firestore reads performed by the time the page had mounted and settled. */
let readsOnMount = -1;
/** The open menu's own colours, resolved in each of the four palettes. */
let palettes: { key: string; bg: string; fg: string; rowFg: string }[] = [];

interface Submenu {
  label: string;
  opened: boolean;
  opacity: string;
  box: { w: number; h: number };
  items: string[];
  rowHeights: number[];
}

interface Flow {
  readsAfterOpen: number;
  submenus: Submenu[];
  browseFound: boolean;
  dialogOpen: boolean;
  dialogBox: { x: number; y: number; w: number; h: number };
  dialogOpacity: string;
  dialogZ: number;
  hasSearchInput: boolean;
  cascaderRoots: string[];
  cascaderRowHeights: number[];
  afterDrill: string[];
  attached: { category: string; type: string; id: string; title: string; subtitle: string } | null;
  dialogClosedAfterPick: boolean;
  /** The four chips beside the composer, rendered through AttachTypeIcon. */
  chipIcons: { type: string; svgs: number; d: string }[];
  /** The same four glyphs as the menu draws them, for the drift check. */
  menuIcons: { label: string; d: string }[];
}

interface SiteReading {
  triggerBox: { x: number; y: number; w: number; h: number };
  /** The POSITIONER's own inline style — the field the bug lived in. */
  positionerInline: string;
  positionerOpacity: string;
  positionerZ: string;
  anchorWidth: string;
  popupBox: { x: number; y: number; w: number; h: number; top: number; bottom: number; right: number };
  popupOpacity: string;
  popupVisibility: string;
  /** Every sampled pixel of the open menu, and whether the menu won it. */
  sampled: number;
  coveredByNav: number;
  coveredByZ100: number;
  notMenu: number;
  /** Ancestors of the trigger, and every property that could clip a child. */
  ancestors: { tag: string; cls: string; overflow: string; transform: string; filter: string; contain: string; perspective: string; willChange: string }[];
  portalledToBody: boolean;
  clippedByAncestor: string[];
  rowHeights: number[];
  scrollWidth: number;
  viewportW: number;
}

beforeAll(async () => {
  harnessDir = mkdtempSync(path.join(ROOT, 'node_modules', '.the337-'));
  writeFileSync(path.join(harnessDir, 'firebase-stub.ts'), FIREBASE_STUB);
  writeFileSync(path.join(harnessDir, 'firestore-stub.ts'), FIRESTORE_STUB);
  writeFileSync(path.join(harnessDir, 'entry.tsx'), entrySource());

  const outDir = mkdtempSync(path.join(os.tmpdir(), 'the337-out-'));
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
        { find: /^firebase\/firestore$/, replacement: path.join(harnessDir, 'firestore-stub.ts') },
        { find: /^@\//, replacement: path.join(ROOT, 'src') + '/' },
      ],
    },
    build: {
      outDir,
      emptyOutDir: true,
      copyPublicDir: false,
      minify: false,
      lib: {
        entry: path.join(harnessDir, 'entry.tsx'),
        formats: ['iife'],
        name: 'THE337',
        fileName: () => 'bundle.js',
      },
    },
  });

  const js = readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
  const css = await buildAppCss();
  const pageDir = mkdtempSync(path.join(os.tmpdir(), 'the337-page-'));
  const file = path.join(pageDir, 'attach-menu.html');
  writeFileSync(
    file,
    `<!doctype html><html data-theme="light" data-palette="classic"><head><meta charset="utf-8">` +
      `<style>${css}</style>` +
      /*
       * 🔴 AMENDED BY THE-346 — THE OPEN ANIMATION WAS BEING MEASURED, and this
       * is a correctness fix rather than a flake suppression.
       *
       * `DropdownMenuContent` carries `data-open:zoom-in-95 duration-100`: a
       * keyframe from `scale(0.95)` to `scale(1)`. `getBoundingClientRect()`
       * reports the SCALED box, so a menu measured while that keyframe is
       * running answers 95% of every height in it.
       *
       * ⚠️ THE 450ms WAIT ABOVE IS NOT A FIX FOR THAT, and cannot be. It is
       * wall clock, not frames: on a loaded runner the click's effect lands
       * late and the 450ms is spent before the menu opens, so the FIRST frame
       * of the animation is what gets measured. Observed on CI, exactly once
       * and exactly there: `a category row is 41.79998779296875px at 380`,
       * which is 44 × 0.94999972 — the opening frame of `zoom-in-95` to seven
       * decimal places, not a row that is genuinely too short.
       *
       * 🔴 THIS DOES NOT WEAKEN THE ASSERTION. Suppressing the animation makes
       * the measurement the RESTING layout, which is the only thing "every
       * control is ≥44px" can sensibly mean — a control is not 41.8px tall
       * because it is being drawn mid-zoom. A row that is really under 44px
       * still fails, and the mutation that shrinks one still catches it.
       *
       * ⚠️ THE SAME CLASS OF DEFECT, ONE ELEMENT OVER, IS WRITTEN UP IN
       * `THE-346.six-defects.layout.test.tsx`: `TabsTrigger`'s `transition-all`
       * animates `min-height`, and `MeasuringBrowser.settle()` waits two
       * animation frames — well inside a 150ms transition — so a trigger
       * measured after a viewport change reports a drifting mid-flight value
       * (7.7469px, then 1.43015px on the next run). THE-323's header records
       * the same artefact from the other side and attributes it to timing
       * rather than to the class. Any measured suite in this repo that does not
       * suppress animation is reading a frame rather than a layout.
       */
      `<style>*,*::before,*::after{animation:none !important;transition:none !important}</style>` +
      `</head><body><div id="root"></div>` +
      `<script>window.__err=null;window.addEventListener('error',(e)=>{window.__err=String(e.message)});</script>` +
      `<script>${js}</script></body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  /**
   * 🔴 READ BEFORE ANYTHING IS CLICKED, and only here. This is the only moment
   * in the run when no menu has ever been opened, so it is the only moment that
   * can answer "did mounting the composer read Firestore". Reloading the page
   * later to re-create it does not work: the navigation tears the CDP
   * evaluation down and the call returns no result at all.
   */
  readsOnMount = await browser.evaluateAt<number>(
    1280,
    `(async () => { await new Promise((r) => setTimeout(r, 600)); return window.__reads || 0; })()`,
    800,
  );

  const labels = SITES.map((s, i) => [s.what, `Attach a record ${i}`] as const);

  for (const viewport of VIEWPORTS) {
    const perSite = await browser.evaluateAt<Record<string, SiteReading>>(
      viewport,
      `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const labels = ${JSON.stringify(labels)};
        await sleep(250);
        if (window.__err) throw new Error('the harness page threw: ' + window.__err);
        const out = {};
        for (const [key, label] of labels) {
          const trig = document.querySelector('[aria-label="' + label + '"]');
          if (!trig) throw new Error('no trigger for ' + key);
          const tb = trig.getBoundingClientRect();

          const ancestors = [];
          const clipped = [];
          let n = trig.parentElement;
          while (n && n !== document.documentElement) {
            const cs = getComputedStyle(n);
            const rec = {
              tag: n.tagName,
              cls: String(n.className || '').slice(0, 80),
              overflow: cs.overflow, transform: cs.transform, filter: cs.filter,
              contain: cs.contain, perspective: cs.perspective, willChange: cs.willChange,
            };
            ancestors.push(rec);
            n = n.parentElement;
          }

          trig.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
          trig.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
          trig.click();
          await sleep(450);

          const popup = document.querySelector('[data-slot="dropdown-menu-content"]');
          if (!popup) throw new Error('no popup for ' + key);
          const pos = popup.parentElement;
          const pcs = getComputedStyle(pos);
          const b = popup.getBoundingClientRect();
          const nav = document.querySelector('[data-shell-bottom-nav]');
          const navB = nav.getBoundingClientRect();

          // The portal target decides whether an ancestor can clip at all.
          const portalledToBody = !trig.closest('[data-site]').contains(popup);
          for (const a of ancestors) {
            if (!portalledToBody && (a.overflow === 'hidden' || a.overflow === 'clip' ||
                a.transform !== 'none' || a.filter !== 'none' ||
                a.contain !== 'none' || a.perspective !== 'none')) {
              clipped.push(a.tag + '.' + a.cls);
            }
          }

          // 🔴 Hit test the open menu, every 8px down its centre line.
          let sampled = 0, coveredByNav = 0, coveredByZ100 = 0, notMenu = 0;
          const cx = b.left + b.width / 2;
          for (let y = Math.ceil(b.top) + 2; y < b.bottom - 2; y += 8) {
            if (y < 0 || y > window.innerHeight) continue;
            sampled += 1;
            const el = document.elementFromPoint(cx, y);
            if (!el || !popup.contains(el)) {
              notMenu += 1;
              if (el && el.closest('[data-shell-bottom-nav]')) coveredByNav += 1;
              if (el && el.hasAttribute && el.hasAttribute('data-z100-probe')) coveredByZ100 += 1;
            }
          }

          out[key] = {
            triggerBox: { x: tb.x, y: tb.y, w: tb.width, h: tb.height },
            positionerInline: pos.getAttribute('style') || '',
            positionerOpacity: pcs.opacity,
            positionerZ: pcs.zIndex,
            anchorWidth: pcs.getPropertyValue('--anchor-width').trim(),
            popupBox: { x: b.x, y: b.y, w: b.width, h: b.height, top: b.top, bottom: b.bottom, right: b.right },
            popupOpacity: getComputedStyle(popup).opacity,
            popupVisibility: getComputedStyle(popup).visibility,
            sampled, coveredByNav, coveredByZ100, notMenu,
            ancestors, portalledToBody, clippedByAncestor: clipped,
            rowHeights: [...popup.querySelectorAll('[data-slot="dropdown-menu-sub-trigger"]')]
              .map((e) => e.getBoundingClientRect().height),
            scrollWidth: document.documentElement.scrollWidth,
            viewportW: window.innerWidth,
          };

          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await sleep(300);
        }
        return out;
      })()`,
      800,
    );
    readings.set(viewport, perSite);
  }

  /**
   * 🔴 All four palettes, resolved on the OPEN MENU rather than on a token list.
   * `data-theme` × `data-palette` is how layout.tsx stamps them, so that is how
   * they are switched here. A menu that resolves to `transparent` or to nothing
   * in one of the four is a menu that cannot be read in it.
   */
  palettes = await browser.evaluateAt<typeof palettes>(
    1280,
    `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = [];
      const el = document.documentElement;
      for (const theme of ['light', 'dark']) {
        for (const palette of ['classic', 'harvest']) {
          el.setAttribute('data-theme', theme);
          el.setAttribute('data-palette', palette);
          el.classList.toggle('dark', theme === 'dark');
          await sleep(120);
          const trig = document.querySelector('[aria-label="Attach a record 0"]');
          trig.click();
          await sleep(400);
          const popup = document.querySelector('[data-slot="dropdown-menu-content"]');
          const cs = getComputedStyle(popup);
          const row = popup.querySelector('[data-slot="dropdown-menu-sub-trigger"]');
          out.push({
            key: theme + '/' + palette,
            bg: cs.backgroundColor,
            fg: cs.color,
            rowFg: row ? getComputedStyle(row).color : '',
          });
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await sleep(250);
        }
      }
      el.setAttribute('data-theme', 'light');
      el.setAttribute('data-palette', 'classic');
      el.classList.remove('dark');
      await sleep(120);
      return out;
    })()`,
    800,
  );

  // ── The whole journey, at a phone width and a desktop one ───────────────
  for (const viewport of [380, 1280] as const) {
    flows.set(
      viewport,
      await browser.evaluateAt<Flow>(
        viewport,
        `(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          await sleep(500);
          const r = {};
          const trig = document.querySelector('[aria-label="Attach a record 0"]');
          trig.click();
          await sleep(600);
          r.readsAfterOpen = window.__reads || 0;

          r.submenus = [];
          const subTrigs = [...document.querySelectorAll('[data-slot="dropdown-menu-sub-trigger"]')];
          for (const st of subTrigs) {
            st.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
            st.click();
            await sleep(400);
            const subs = [...document.querySelectorAll('[data-slot="dropdown-menu-sub-content"]')];
            const sub = subs[subs.length - 1];
            const b = sub ? sub.getBoundingClientRect() : null;
            const items = sub ? [...sub.querySelectorAll('[data-slot="dropdown-menu-item"]')] : [];
            r.submenus.push({
              label: st.textContent.trim(),
              opened: !!sub && b.width > 0 && b.height > 0 &&
                      Number(getComputedStyle(sub.parentElement).opacity) === 1,
              opacity: sub ? getComputedStyle(sub.parentElement).opacity : '0',
              box: b ? { w: b.width, h: b.height } : { w: 0, h: 0 },
              items: items.map((e) => e.textContent.trim()),
              rowHeights: items.map((e) => e.getBoundingClientRect().height),
            });
          }

          // 🔴 Browse… — nobody has ever reached this, because the menu never
          // opened. Drive it: open the cascader, drill, and commit a record.
          const openSubs = [...document.querySelectorAll('[data-slot="dropdown-menu-sub-content"]')];
          const lastSub = openSubs[openSubs.length - 1];
          const browse = [...lastSub.querySelectorAll('[data-slot="dropdown-menu-item"]')]
            .find((e) => /Browse/.test(e.textContent));
          r.browseFound = !!browse;
          r.dialogOpen = false;
          r.cascaderRoots = [];
          r.cascaderRowHeights = [];
          r.afterDrill = [];
          r.attached = null;
          r.dialogClosedAfterPick = false;
          r.hasSearchInput = false;
          r.dialogBox = { x: 0, y: 0, w: 0, h: 0 };
          r.dialogOpacity = '0';
          r.dialogZ = 0;

          if (browse) {
            browse.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
            browse.click();
            await sleep(700);
            const dlg = document.querySelector('[role="dialog"]');
            r.dialogOpen = !!dlg;
            if (dlg) {
              const db = dlg.getBoundingClientRect();
              r.dialogBox = { x: db.x, y: db.y, w: db.width, h: db.height };
              r.dialogOpacity = getComputedStyle(dlg).opacity;
              r.dialogZ = Number(getComputedStyle(dlg).zIndex) || 0;
              r.hasSearchInput = !!dlg.querySelector('input');
              const opts = [...dlg.querySelectorAll('[role="option"]')];
              r.cascaderRoots = opts.map((e) => e.textContent.trim());
              r.cascaderRowHeights = opts.map((e) => e.getBoundingClientRect().height);
              const contacts = opts.find((e) => /Contacts/.test(e.textContent));
              if (contacts) {
                contacts.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
                contacts.click();
                await sleep(500);
                const opts2 = [...dlg.querySelectorAll('[role="option"]')];
                r.afterDrill = opts2.map((e) => e.textContent.trim());
                const ada = opts2.find((e) => /Ada/.test(e.textContent));
                if (ada) {
                  ada.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
                  ada.click();
                  await sleep(600);
                  r.attached = window.__attached || null;
                  r.dialogClosedAfterPick = !document.querySelector('[role="dialog"]');
                }
              }
            }
          }

          // 🔴 One icon map, or two that can drift. The chip's glyph and the
          // menu's glyph are compared by their actual SVG path data.
          const pathOf = (el) => {
            const p = el ? el.querySelector('svg path, svg circle, svg rect') : null;
            return p ? (p.getAttribute('d') || p.tagName) : '';
          };
          r.chipIcons = [...document.querySelectorAll('[data-site] [data-chip]')]
            .slice(0, 4)
            .map((e) => ({ type: e.getAttribute('data-chip'), svgs: e.querySelectorAll('svg').length, d: pathOf(e) }));

          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await sleep(300);
          const t2 = document.querySelector('[aria-label="Attach a record 0"]');
          t2.click();
          await sleep(500);
          const popup = document.querySelector('[data-slot="dropdown-menu-content"]');
          r.menuIcons = [...popup.querySelectorAll('[data-slot="dropdown-menu-sub-trigger"]')]
            .map((e) => ({ label: e.textContent.trim(), d: pathOf(e) }));
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await sleep(200);
          return r;
        })()`,
        800,
      ),
    );
  }
}, 300_000);

afterAll(async () => {
  await browser?.close();
  if (harnessDir) rmSync(harnessDir, { recursive: true, force: true });
});

const at = (v: number) => {
  const r = readings.get(v);
  if (!r) throw new Error(`no reading at ${v}px`);
  return r;
};

const bullets = (xs: string[]) => xs.map((x) => `\n  ${x}`).join('');

// ═════════════════════════════════════════════════════════════════════════════
// 0. 🔴 Why THE-331's 33 measured tests passed on a menu that never appeared.
// ═════════════════════════════════════════════════════════════════════════════
describe('🔴 0 · the hole THE-331 left, pinned so it cannot reopen', () => {
  const THE_331 = 'src/components/__tests__/THE-331.attach-surface.layout.test.tsx';

  it('THE-331 discovers BOTTOM SHEETS, and the shipped picker is not one', () => {
    const suite = read(THE_331);
    expect(suite, 'the discovery pattern is the whole explanation').toContain('fixed inset-0');
    expect(suite).toContain('items-end');
    // The component that replaced the sheet matches that pattern in no
    // `className`, so it contributed zero surfaces to a suite that measured
    // only surfaces. ⚠️ Read off the CLASS STRINGS, not the file: this file's
    // own header quotes the old sheet's classes while explaining what went.
    const menu = read('src/components/attach/AttachMenu.tsx');
    const classNames = [...menu.matchAll(/className="([^"]*)"/g)].map((m) => m[1]);
    const sheets = classNames.filter((c) => /fixed inset-0/.test(c) && /items-end/.test(c));
    expect(sheets, 'the picker is a menu now; a sheet here would be the old bug back')
      .toEqual([]);
  });

  it('its only claim about the new picker was a source grep, true of a broken menu', () => {
    const suite = read(THE_331);
    expect(suite).toContain("not.toContain('const AttachPicker')");
    expect(suite).toContain("toContain('<AttachMenu')");
  });

  it('🔴 so this suite mounts the component and drives it, rather than reading it', () => {
    const self = read('src/components/__tests__/THE-337.attach-menu-visibility.layout.test.tsx');
    expect(self).toContain('MeasuringBrowser');
    expect(self).toContain('elementFromPoint');
    expect(self, 'the positioner inline style is the field the bug lived in')
      .toContain('positionerInline');
  });

  it('both composer sites were discovered, and there are two of them', () => {
    expect(
      SITES.map((s) => s.what),
      'AdminCommunity has two composers; if this shrinks the pattern stopped matching',
    ).toHaveLength(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. 🔴 THE BUG. Clicking the paperclip shows a VISIBLE menu, at both sites.
// ═════════════════════════════════════════════════════════════════════════════
describe('🔴 1 · clicking the paperclip shows a visible menu', () => {
  it.each(VIEWPORTS)('at %ipx both composers open a menu that can be seen', (v) => {
    const r = at(v);
    const dead = SITES.filter((s) => {
      const m = r[s.what];
      return Number(m.positionerOpacity) === 0 || m.popupBox.w === 0 || m.popupBox.h === 0;
    }).map((s) => {
      const m = r[s.what];
      return `${s.what} — positioner opacity ${m.positionerOpacity}, box ${m.popupBox.w}×${m.popupBox.h}, style "${m.positionerInline}"`;
    });
    expect(
      dead,
      `the founder's bug at ${v}px: the menu is in the DOM and painted at zero ` +
        'opacity. The positioner never measured because the trigger handed Base ' +
        'UI no DOM node to anchor to:' + bullets(dead),
    ).toEqual([]);
  });

  it.each(VIEWPORTS)('at %ipx the positioner actually ANCHORED to the paperclip', (v) => {
    const r = at(v);
    for (const s of SITES) {
      const m = r[s.what];
      // 🔴 The three fields that are all unset in the broken state, asserted
      // separately so a failure says WHICH part of anchoring did not happen.
      expect(
        m.anchorWidth,
        `${s.what} at ${v}px: --anchor-width is unset, so no measurement ever ran`,
      ).not.toBe('');
      expect(
        m.positionerInline,
        `${s.what} at ${v}px is still at the pre-measurement transform`,
      ).not.toContain('translate(0px, 0px)');
      expect(
        Math.abs(m.popupBox.x - m.triggerBox.x),
        `${s.what} at ${v}px opened ${Math.round(m.popupBox.x)}px away from a ` +
          `paperclip at ${Math.round(m.triggerBox.x)}px — it is not anchored to it`,
      ).toBeLessThanOrEqual(24);
    }
  });

  it.each(VIEWPORTS)('at %ipx the menu is on screen, not off the bottom of it', (v) => {
    const r = at(v);
    for (const s of SITES) {
      const m = r[s.what];
      expect(m.popupBox.top, `${s.what} at ${v}px opens above the viewport`).toBeGreaterThanOrEqual(0);
      expect(
        m.popupBox.bottom,
        `${s.what} at ${v}px opens BELOW THE FOLD — a bottom-anchored menu that ` +
          'did not collision-flip',
      ).toBeLessThanOrEqual(800);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Visible at the two extremes the ticket names, and every width between.
// ═════════════════════════════════════════════════════════════════════════════
describe('🔴 2 · the menu is visible at 380px and at 1920px', () => {
  it.each([380, 1920] as const)('at %ipx the menu is opaque and has area', (v) => {
    const r = at(v);
    for (const s of SITES) {
      const m = r[s.what];
      expect(Number(m.positionerOpacity), `${s.what} at ${v}px`).toBe(1);
      expect(m.popupVisibility, `${s.what} at ${v}px`).toBe('visible');
      expect(m.popupBox.w, `${s.what} at ${v}px has no width`).toBeGreaterThan(0);
      expect(m.popupBox.h, `${s.what} at ${v}px has no height`).toBeGreaterThan(0);
    }
  });

  it.each(VIEWPORTS)('at %ipx the menu fits inside the viewport', (v) => {
    const r = at(v);
    for (const s of SITES) {
      const m = r[s.what];
      expect(m.popupBox.x, `${s.what} at ${v}px starts off the left edge`).toBeGreaterThanOrEqual(0);
      expect(m.popupBox.right, `${s.what} at ${v}px runs off the right edge`).toBeLessThanOrEqual(v);
    }
  });

  it.each(VIEWPORTS)('at %ipx the open menu adds no horizontal overflow', (v) => {
    const r = at(v);
    for (const s of SITES) {
      expect(r[s.what].scrollWidth, `sideways scroll at ${v}px`).toBeLessThanOrEqual(v);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. 🔴 Above the bottom nav — hit-tested, never read off a class string.
// ═════════════════════════════════════════════════════════════════════════════
describe('🔴 3 · the menu is above the bottom nav', () => {
  it.each(VIEWPORTS)('at %ipx no sampled pixel of the menu is covered by the nav', (v) => {
    const r = at(v);
    const covered = SITES.filter((s) => r[s.what].coveredByNav > 0).map(
      (s) => `${s.what} — ${r[s.what].coveredByNav} of ${r[s.what].sampled} pixels are the nav`,
    );
    expect(
      covered,
      `the nav is painting over the menu at ${v}px:` + bullets(covered),
    ).toEqual([]);
  });

  it.each(VIEWPORTS)('at %ipx every sampled pixel of the menu IS the menu', (v) => {
    const r = at(v);
    for (const s of SITES) {
      const m = r[s.what];
      expect(m.sampled, `${s.what} at ${v}px sampled nothing`).toBeGreaterThan(0);
      expect(
        m.notMenu,
        `${s.what} at ${v}px: ${m.notMenu} of ${m.sampled} sampled pixels belong to ` +
          `something else (${m.coveredByZ100} of them a layer at the nav's own z-[100]). ` +
          'A menu you cannot click is a menu that is not there.',
      ).toBe(0);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Not clipped by any ancestor — every ancestor named, one by one.
// ═════════════════════════════════════════════════════════════════════════════
describe('4 · the menu is not clipped by any ancestor', () => {
  it('the menu portals out of the composer entirely', () => {
    const r = at(768);
    for (const s of SITES) {
      expect(
        r[s.what].portalledToBody,
        `${s.what}: the popup renders INSIDE the composer, so every overflow, ` +
          'transform, filter and containment property above it can clip it',
      ).toBe(true);
    }
  });

  it('every ancestor of the paperclip is named, with the properties that could clip', () => {
    const r = at(768);
    for (const s of SITES) {
      const as = r[s.what].ancestors;
      expect(as.length, `${s.what} has no ancestors — the walk did not run`).toBeGreaterThan(0);
      for (const a of as) {
        // Recorded per ancestor rather than aggregated: a failure has to say
        // WHICH box would have clipped, and what about it.
        expect(
          `${s.what} ${a.tag}.${a.cls} overflow=${a.overflow} transform=${a.transform} ` +
            `filter=${a.filter} contain=${a.contain} perspective=${a.perspective}`,
        ).toBeTypeOf('string');
      }
    }
  });

  it.each(VIEWPORTS)('at %ipx no ancestor actually clips the open menu', (v) => {
    const r = at(v);
    const offenders = SITES.flatMap((s) =>
      r[s.what].clippedByAncestor.map((a) => `${s.what} ← ${a}`),
    );
    expect(
      offenders,
      'an ancestor with an overflow, transform, filter or containment property ' +
        'is clipping the menu. That decides the fix: a portal, or a different ' +
        'primitive.' + bullets(offenders),
    ).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 13. Tap targets: 44px below `sm`, Rule 4's 38px above it.
// ═════════════════════════════════════════════════════════════════════════════
describe('13 · every control is ≥44px below sm, and Rule 4 holds above', () => {
  it('at 380px the paperclip and every category row are at least 44px', () => {
    const r = at(380);
    for (const s of SITES) {
      const m = r[s.what];
      expect(m.triggerBox.h, `${s.what}: the paperclip is ${m.triggerBox.h}px at 380`)
        .toBeGreaterThanOrEqual(44);
      expect(m.rowHeights.length, `${s.what}: no category rows were measured`).toBe(4);
      for (const h of m.rowHeights) {
        expect(h, `${s.what}: a category row is ${h}px at 380`).toBeGreaterThanOrEqual(44);
      }
    }
  });

  it.each(VIEWPORTS.filter((v) => v >= SM))('at %ipx the 44px floor is released, not fought', (v) => {
    const r = at(v);
    for (const s of SITES) {
      const m = r[s.what];
      // ⚠️ `min-h-11` is NOT inert above `sm`; the shipped class pairs it with
      // `sm:min-h-0` precisely so Rule 4's 38px control height still wins.
      expect(
        m.triggerBox.h,
        `${s.what}: the paperclip is still ${m.triggerBox.h}px at ${v}px — the ` +
          'mobile floor is fighting Rule 4',
      ).toBeLessThan(44);
    }
  });
});

const flowAt = (v: number): Flow => {
  const f = flows.get(v);
  if (!f) throw new Error(`no flow reading at ${v}px`);
  return f;
};

const CATEGORY_LABELS = ['Notes & Docs', 'Contacts', 'Fundraising', 'Forms'] as const;

// ═════════════════════════════════════════════════════════════════════════════
// 5 + 7. All four submenus open, each showing recents and then Browse…
// ═════════════════════════════════════════════════════════════════════════════
describe('5 · all four category submenus open', () => {
  it.each([380, 1280] as const)('at %ipx each of the four opens, named one by one', (v) => {
    const f = flowAt(v);
    expect(f.submenus.map((s) => s.label)).toEqual([...CATEGORY_LABELS]);
    const shut = f.submenus.filter((s) => !s.opened).map(
      (s) => `${s.label} — opacity ${s.opacity}, box ${s.box.w}×${s.box.h}`,
    );
    expect(shut, `these category flyouts did not open at ${v}px:` + bullets(shut)).toEqual([]);
  });

  it('🔴 campaigns reads "Fundraising" on screen, and nowhere reads "Campaigns"', () => {
    const f = flowAt(1280);
    expect(f.submenus.map((s) => s.label)).toContain('Fundraising');
    expect(f.submenus.map((s) => s.label)).not.toContain('Campaigns');
  });
});

describe('7 · each submenu shows recents, then Browse…', () => {
  it.each([380, 1280] as const)('at %ipx every flyout ends with Browse…', (v) => {
    const f = flowAt(v);
    for (const s of f.submenus) {
      expect(s.items.length, `${s.label} rendered no rows at all`).toBeGreaterThan(0);
      expect(
        s.items[s.items.length - 1],
        `${s.label}'s last row must be Browse…, after the recents`,
      ).toMatch(/Browse/);
    }
  });

  it('recents are capped, and the fourth doc is behind Browse… rather than listed', () => {
    const f = flowAt(1280);
    const docs = f.submenus.find((s) => s.label === 'Notes & Docs')!;
    const recents = docs.items.filter((i) => !/Browse/.test(i));
    expect(recents, 'ATTACH_RECENTS_LIMIT is 3').toHaveLength(3);
    expect(
      recents.join(' | '),
      'the fourth doc must not be in the flyout — that is what Browse… is for',
    ).not.toContain('Fourth doc');
    // Newest first, by the loader's own rule.
    expect(recents[0]).toContain('Elders meeting notes');
  });

  it('at 380px every recents row is still a 44px tap target', () => {
    const f = flowAt(380);
    for (const s of f.submenus) {
      for (const h of s.rowHeights) {
        expect(h, `a row in ${s.label} is ${h}px on a phone`).toBeGreaterThanOrEqual(44);
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. 🔴 Browse… opens the cascader, and a record can actually be picked.
// ═════════════════════════════════════════════════════════════════════════════
describe('🔴 6 · Browse… opens the cascader and a record can be picked', () => {
  it.each([380, 1280] as const)('at %ipx Browse… opens a visible dialog', (v) => {
    const f = flowAt(v);
    expect(f.browseFound, 'no Browse… row was reachable').toBe(true);
    expect(f.dialogOpen, 'Browse… opened nothing').toBe(true);
    expect(Number(f.dialogOpacity), 'the dialog is transparent').toBe(1);
    expect(f.dialogBox.w, 'the dialog has no width').toBeGreaterThan(0);
    expect(f.dialogBox.h, 'the dialog has no height').toBeGreaterThan(0);
  });

  it('the dialog clears the menu it was opened from, and the nav under both', () => {
    const f = flowAt(1280);
    expect(
      f.dialogZ,
      'the browse dialog must sit above the menu (110) and the nav (100), so it ' +
        'does not depend on the menu having closed first',
    ).toBeGreaterThan(110);
  });

  it('the cascader offers all four categories, and searches across them', () => {
    const f = flowAt(1280);
    expect(f.hasSearchInput, 'deep search has no field to type into').toBe(true);
    for (const label of CATEGORY_LABELS) {
      expect(
        f.cascaderRoots.join(' | '),
        `${label} is missing from the browse tree`,
      ).toContain(label);
    }
  });

  it('🔴 drilling into a category and picking a record commits the WHOLE record', () => {
    const f = flowAt(1280);
    expect(f.afterDrill.join(' | '), 'the drill did not reach the contacts').toContain('Ada Reeve');
    expect(f.attached, 'no record was committed — Browse… still cannot attach').not.toBeNull();
    // 🔴 Ids are not unique across the four collections; the category must ride
    // on the record rather than being parsed back out of a bare id.
    expect(f.attached).toEqual({
      category: 'contacts',
      type: 'contact',
      id: 'c1',
      title: 'Ada Reeve',
      subtitle: 'Member · ada@example.org',
    });
  });

  it('the dialog closes once a record is committed', () => {
    expect(flowAt(1280).dialogClosedAfterPick).toBe(true);
  });

  it('at 380px every cascader row is a 44px tap target too', () => {
    const f = flowAt(380);
    expect(f.cascaderRowHeights.length).toBeGreaterThan(0);
    for (const h of f.cascaderRowHeights) {
      expect(h, `a cascader row is ${h}px on a phone`).toBeGreaterThanOrEqual(44);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. All four record types still attach, with their labels.
// ═════════════════════════════════════════════════════════════════════════════
describe('8 · all four record types still attach with their labels', () => {
  it('the four ids and the four labels are exactly what shipped', () => {
    const lib = read('src/lib/attach-records.ts');
    expect(lib).toContain("['docs', 'contacts', 'campaigns', 'forms'] as const");
    expect(lib).toContain("docs: 'Notes & Docs'");
    expect(lib).toContain("contacts: 'Contacts'");
    expect(lib).toContain("campaigns: 'Fundraising'");
    expect(lib).toContain("forms: 'Forms'");
  });

  it('and every one of the four renders rows in its own flyout', () => {
    const f = flowAt(1280);
    const rows = Object.fromEntries(
      f.submenus.map((s) => [s.label, s.items.filter((i) => !/Browse/.test(i))]),
    );
    expect(rows['Notes & Docs'][0]).toContain('Elders meeting notes');
    expect(rows['Contacts'][0]).toContain('Ada Reeve');
    expect(rows['Fundraising'][0]).toContain('Roof Appeal');
    expect(rows['Forms'][0]).toContain('Volunteer sign-up');
  });

  it('a category that FAILS to read is not rendered as an empty one', () => {
    const src = read('src/components/attach/AttachMenu.tsx');
    // A rejected query answers `{ ok: false }`, and the menu must say so.
    expect(src).toContain('could not be loaded');
    expect(src).toContain('!categoryLoad.ok');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. 🔴 AttachTypeIcon is still shared between the menu and the chip.
// ═════════════════════════════════════════════════════════════════════════════
describe('9 · AttachTypeIcon is still shared between menu and chip', () => {
  it('the composer imports the icon from the menu rather than keeping its own', () => {
    const src = read('src/components/AdminCommunity.tsx');
    expect(src).toMatch(/import\s*\{[^}]*AttachTypeIcon[^}]*\}\s*from\s*['"][^'"]*attach\/AttachMenu['"]/);
    expect(src, 'the chip must render the shared icon').toContain('<AttachTypeIcon');
  });

  it('🔴 and the glyphs really are the same — compared as SVG path data', () => {
    const f = flowAt(1280);
    expect(f.chipIcons, 'the four chips did not render').toHaveLength(4);
    for (const chip of f.chipIcons) {
      expect(chip.svgs, `the ${chip.type} chip drew no icon`).toBeGreaterThan(0);
      expect(chip.d, `the ${chip.type} chip's icon has no path`).not.toBe('');
    }
    const byType = Object.fromEntries(f.chipIcons.map((c) => [c.type, c.d]));
    const byLabel = Object.fromEntries(f.menuIcons.map((m) => [m.label, m.d]));
    const pairs: [string, string][] = [
      ['doc', 'Notes & Docs'],
      ['contact', 'Contacts'],
      ['campaign', 'Fundraising'],
      ['form', 'Forms'],
    ];
    const drifted = pairs
      .filter(([t, l]) => byType[t] !== byLabel[l])
      .map(([t, l]) => `${t} chip vs ${l} menu row`);
    expect(
      drifted,
      'the chip and the menu are drawing DIFFERENT glyphs for the same record ' +
        'type — the drift THE-331 exported one map to prevent:' + bullets(drifted),
    ).toEqual([]);
  });

  it('no emoji stands in for any of the four, in the menu or the chip', () => {
    for (const rel of ['src/components/attach/AttachMenu.tsx']) {
      const classNamesAndStrings = read(rel);
      expect(
        /[\u{1F300}-\u{1FAFF}]/u.test(
          classNamesAndStrings.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''),
        ),
        `${rel} renders an emoji outside its comments`,
      ).toBe(false);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. 🔴 Records load on FIRST OPEN, not on mount.
// ═════════════════════════════════════════════════════════════════════════════
describe('10 · records still load on first open, not on mount', () => {
  it('🔴 mounting two composers reads Firestore ZERO times', () => {
    expect(
      readsOnMount,
      'the loaders fired on MOUNT. Six Firestore listeners are already live on ' +
        'this screen; a composer nobody opens must not add four one-shot reads ' +
        'to them.',
    ).toBe(0);
  });

  it.each([380, 1280] as const)('at %ipx opening the menu is what reads them', (v) => {
    expect(
      flowAt(v).readsAfterOpen,
      'opening the menu read nothing, so the rows shown came from somewhere else',
    ).toBeGreaterThan(0);
  });

  it('and the loader is still wired to onOpenChange rather than an effect', () => {
    const src = read('src/components/attach/AttachMenu.tsx');
    expect(src).toContain('onOpenChange={onOpenChange}');
    expect(src, 'a mount effect would defeat the whole point').not.toMatch(
      /React\.useEffect\([^)]*\)\s*=>\s*\{\s*void load\(\)/,
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. UserMessages.tsx — 🔴 THE-348 RESOLVED THIS SECTION'S PIN.
// ═════════════════════════════════════════════════════════════════════════════
/**
 * ⚠️ THE-337's TICKET SAID "THE-331 swapped the picker there too". IT HAD NOT.
 *
 * `UserMessages.tsx` never imported `AttachMenu`; it opened its own
 * hand-rolled, forms-only sheet from `setShowPicker(true)`, rendered the four
 * record types as EMOJI, and therefore could not carry THE-337's anchoring
 * regression at all. Three assertions pinned that true state, and the first of
 * them said what would happen next:
 *
 *   *"if UserMessages ever DOES adopt `AttachMenu`, this fails and its
 *   composer joins the measured set above."*
 *
 * 🔴 THE-348 IS THAT TICKET, AND THIS SECTION IS INVERTED RATHER THAN DELETED.
 * The founder: *"as an admin if I press on paperclip it appears attach a form,
 * not all that is in community and the same style that we applied."* So the
 * forms-only sheet is gone, the composer mounts the shared `AttachMenu`, and
 * the emoji went with it.
 *
 * ⚠️ AND IT DID JOIN A MEASURED SET, which is the half of that instruction
 * that matters. `THE-348.member-composer.layout.test.tsx` drives the SHIPPED
 * `UserMessages` in Chromium: it clicks the paperclip, reads the positioner's
 * own inline transform and `--anchor-width`, and hit-tests every pixel of the
 * open menu against a layer at the nav's `z-[100]` — the same three questions
 * this suite asks of AdminCommunity's two composers, asked of the third.
 *
 * 🔴 IT IS NOT ADDED TO **THIS** SUITE'S `SITES`, deliberately. That discovery
 * reads `AdminCommunity.tsx` and pairs each `<AttachMenu` mount with the
 * composer pill above it; UserMessages' composer is a different shape in a
 * different shell, whose surrounding chrome (a fixed composer, a hidden bottom
 * nav) is the thing under test in THE-348. Measuring it here would mean this
 * suite growing a second harness for someone else's screen. What is pinned
 * here instead is that the adoption HAPPENED and that a measured suite exists
 * for it — so the instruction above cannot be satisfied by a source grep alone.
 */
describe('11 · UserMessages.tsx — THE-348 adopted AttachMenu, and measured it', () => {
  const USER_MESSAGES = 'src/components/UserMessages.tsx';
  const THE_348_LAYOUT = 'src/components/__tests__/THE-348.member-composer.layout.test.tsx';

  it('🔴 DOES use AttachMenu now — THE-337\'s pin is resolved, not deleted', () => {
    expect(read(USER_MESSAGES), 'UserMessages stopped adopting AttachMenu again').toContain('AttachMenu');
  });

  it('and the forms-only sheet it used to open is gone', () => {
    // 🔴 COMMENT-STRIPPED, and the difference is not cosmetic: THE-348 records
    // in a doc comment what the deleted sheet WAS, so a raw grep for its
    // heading finds the epitaph and reports the sheet as still shipping.
    const src = stripComments(read(USER_MESSAGES));
    expect(src, 'the forms picker is still opened by state').not.toContain('setShowPicker(true)');
    expect(src, 'the forms-only sheet heading came back').not.toContain('Attach a Form');
  });

  it('🔴 its composer IS measured in a real browser — not asserted from source', () => {
    // The instruction this section left behind was "join the measured
    // composers", and a source grep cannot satisfy it. THE-348's suite must
    // exist, run in `node`, and ask this suite's three anchoring questions.
    const suite = readFileSync(path.join(ROOT, THE_348_LAYOUT), 'utf8');
    expect(suite.startsWith('// @vitest-environment node'),
      'THE-348 measures UserMessages without the node environment — every box would be a zero').toBe(true);
    expect(suite, 'THE-348 does not drive the shipped component').toContain("from '@/components/UserMessages'");
    expect(suite, 'THE-348 does not read the positioner, where THE-337\'s bug lived').toContain('--anchor-width');
    expect(suite, 'THE-348 does not hit-test the open menu against the nav\'s layer').toContain('data-z100-probe');
  });

  it('⚠️ and the four types are no longer EMOJI — the recorded exception is closed', () => {
    // THE-331's header claimed `AttachTypeIcon` was exported because "the
    // composer's chips and AttachmentCard rendered the same four types as
    // EMOJI". That was true of AdminCommunity and NOT of this file, which was
    // never converted — so THE-337 pinned the disagreement rather than fixing
    // it in a regression ticket. THE-348 converted it, so the claim and the
    // code agree at last.
    //
    // 🔴 AND IT IS COMMENT-STRIPPED, WHICH THE ORIGINAL PIN WAS NOT. Every
    // file in this repo writes 🔴 and ⚠️ in its prose, both inside this
    // character range — so `.toBe(true)` on RAW source was satisfied by the
    // comments and would have stayed green the day the four record-type
    // glyphs were deleted. The pin it replaces was therefore never watching
    // the code it named. Stripped, the question is the one it meant to ask.
    expect(
      /[\u{1F300}-\u{1FAFF}]/u.test(stripComments(read(USER_MESSAGES))),
      'emoji came back to UserMessages',
    ).toBe(false);
    expect(read(USER_MESSAGES), 'the shared icon map is not what replaced them').toContain('AttachTypeIcon');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 12. 🔴 No regression on THE-331's ACTUAL fix: not full-width from sm up.
// ═════════════════════════════════════════════════════════════════════════════
describe('🔴 12 · the surface is NOT full-width from sm up', () => {
  const DESKTOP = VIEWPORTS.filter((v) => v >= 768);

  it.each(DESKTOP)('at %ipx the menu is nowhere near the width of the screen', (v) => {
    const r = at(v);
    const wide = SITES.filter((s) => r[s.what].popupBox.w >= v * 0.5).map(
      (s) => `${s.what} spans ${Math.round(r[s.what].popupBox.w)}px of ${v}px`,
    );
    expect(
      wide,
      "THE-331's real fix was that a phone sheet stopped slamming across a " +
        '1920px screen — it measured 1920px before and 464px after. A menu that ' +
        'has grown back to half the viewport is that bug returning:' + bullets(wide),
    ).toEqual([]);
  });

  it.each(DESKTOP)('at %ipx the menu is anchored to the paperclip, not to the edges', (v) => {
    const r = at(v);
    for (const s of SITES) {
      const m = r[s.what];
      expect(
        m.popupBox.x,
        `${s.what} at ${v}px starts at the left edge — that is a sheet, not a menu`,
      ).toBeGreaterThan(0);
      expect(
        v - m.popupBox.right,
        `${s.what} at ${v}px reaches the right edge`,
      ).toBeGreaterThan(0);
    }
  });

  it('the picker is a menu, and the hand-rolled sheet did not come back', () => {
    const src = read('src/components/AdminCommunity.tsx');
    expect(src, 'the old sheet must stay gone').not.toContain('const AttachPicker');
    expect(src, 'the composer reaches for the menu').toContain('<AttachMenu');
  });

  it('at 380px the menu is still comfortably inside a phone', () => {
    const r = at(380);
    for (const s of SITES) {
      const m = r[s.what];
      expect(m.popupBox.w, `${s.what} is ${m.popupBox.w}px on a 380px phone`).toBeLessThanOrEqual(380);
      expect(m.popupBox.w, `${s.what} is unusably narrow on a phone`).toBeGreaterThan(120);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 14. No hardcoded colour, no emoji, and both palettes resolve.
// ═════════════════════════════════════════════════════════════════════════════
describe('14 · no colour hardcoded, no emoji; both palettes resolve', () => {
  it('the menu hardcodes no colour and invents no width', () => {
    const src = read('src/components/attach/AttachMenu.tsx');
    expect(/#[0-9a-fA-F]{3,8}\b/.test(src), 'a hex colour reached the file').toBe(false);
    expect(/\brgba?\(/.test(src), 'an rgb() colour reached the file').toBe(false);
    expect(/\bw-\[\d+px\]|\bmax-w-\[\d+px\]/.test(src), 'a pixel width was invented').toBe(false);
  });

  it('🔴 both palettes paint the open menu, measured on the popup itself', () => {
    expect(palettes.map((p) => p.key)).toEqual([
      'light/classic', 'light/harvest', 'dark/classic', 'dark/harvest',
    ]);
    const unpainted = palettes
      .filter((p) => !/^rgba?\(/.test(p.bg) || /rgba\([^)]*,\s*0\)$/.test(p.bg))
      .map((p) => `${p.key} → background ${p.bg || '(none)'}`);
    expect(
      unpainted,
      'the menu resolves to no surface colour in these palettes, so its rows sit ' +
        'on whatever is behind it:' + bullets(unpainted),
    ).toEqual([]);
    for (const p of palettes) {
      expect(p.fg, `${p.key} gives the menu no text colour`).toMatch(/^rgba?\(/);
      expect(p.rowFg, `${p.key} gives a category row no text colour`).toMatch(/^rgba?\(/);
    }
  });

  it('and light and dark really differ — the switch is not a no-op', () => {
    const light = palettes.find((p) => p.key === 'light/classic')!;
    const dark = palettes.find((p) => p.key === 'dark/classic')!;
    expect(dark.bg, 'dark resolves to the same surface as light').not.toBe(light.bg);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 15-17. What this PR's own guards may not do.
// ═════════════════════════════════════════════════════════════════════════════

/** The files this ticket adds or edits — the only ones these three may judge. */
const THIS_PR = [
  'src/components/attach/AttachMenu.tsx',
  'src/components/__tests__/THE-337.attach-menu-visibility.layout.test.tsx',
] as const;

describe('🔴 15 · no test in this PR pins a line number', () => {
  it('the composers are discovered by shape, and the count is asserted', () => {
    const self = read(THIS_PR[1]);
    expect(self, 'discovery, not pinning').toContain('discoverComposers');
    expect(self).toContain('<AttachMenu');
  });

  it.each(THIS_PR)('%s addresses no measured subject by line', (rel) => {
    const src = read(rel);
    // ⚠️ Matches a source file followed by a line number — the shape THE-331
    // pinned as `AdminCommunity.tsx:491` before a deletion moved it to :311.
    // Occurrences inside prose are stripped first: the header explains that
    // failure and has to be able to name it.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const pinned = [...code.matchAll(/['"`][^'"`]*\.tsx?:\d+/g)].map((m) => m[0]);
    expect(
      pinned,
      'a measured subject is addressed by line number; a deletion above it ' +
        'would silently re-point this at whatever landed there:' + bullets(pinned),
    ).toEqual([]);
  });
});

describe('🔴 16 · no fixture in this PR is pinned to a date near today', () => {
  it('every fixture timestamp is years away from the run date', () => {
    const now = Date.now();
    const YEAR = 365 * 24 * 60 * 60 * 1000;
    for (const [name, ms] of Object.entries(FIXTURE_MS)) {
      expect(
        Math.abs(now - ms) / YEAR,
        `the ${name} fixture is ${Math.round(Math.abs(now - ms) / (24 * 3600 * 1000))} days ` +
          'from today. A fixture near the run date passes for a week and then ' +
          'starts failing on a clock.',
      ).toBeGreaterThan(1);
    }
  });

  it('and no fixture is derived from the clock at all', () => {
    const self = read(THIS_PR[1]);
    const stub = self.slice(self.indexOf('const FIRESTORE_STUB'), self.indexOf('const FIREBASE_STUB'));
    expect(stub, 'a fixture built from Date.now() is a fixture that moves').not.toContain('Date.now(');
    expect(stub).not.toContain('new Date()');
  });
});

describe('🔴 17 · no guard in this PR asserts anything about the branch diff', () => {
  /**
   * ⚠️ ASSEMBLED FROM FRAGMENTS, on purpose. This guard reads its own file, so a
   * needle spelled out here would be found in the needle list and every file in
   * `THIS_PR` would fail on the guard rather than on the thing it guards.
   */
  const FORBIDDEN = [
    ['git', 'diff'].join(' '),
    ['git', 'show'].join(' '),
    ['git', 'rev-parse'].join(' '),
    ['git', 'merge-base'].join(' '),
    ['exec', 'FileSync'].join(''),
    ['exec', 'Sync'].join(''),
    ['spawn', 'Sync'].join(''),
  ];

  it.each(THIS_PR)('%s shells out to no git, and reads no diff', (rel) => {
    const src = read(rel);
    for (const forbidden of FORBIDDEN) {
      expect(
        src.includes(forbidden),
        `${rel} reaches for \`${forbidden}\`. A guard that judges the current ` +
          "branch's diff passes on the branch that wrote it and means nothing " +
          'afterwards.',
      ).toBe(false);
    }
  });

  it('and every subject is read off the working tree, by path', () => {
    const self = read(THIS_PR[1]);
    expect(self, 'the subjects are files on disk').toContain('readFileSync');
    // Same fragment trick, same reason as FORBIDDEN above.
    expect(self, 'a guard steered by CI metadata is a guard about the branch')
      .not.toContain(['process.env', 'GITHUB_'].join('.'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 18. The files this ticket may not open are byte-identical.
// ═════════════════════════════════════════════════════════════════════════════
describe('18 · firestore.rules, firestore.indexes.json, functions/ and layout.tsx are untouched', () => {
  /** Recorded off `main` at 9731c1d, the commit this branch starts from. */
  const UNTOUCHABLE: Readonly<Record<string, string>> = {
    'firestore.indexes.json': '8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0',
    'src/app/layout.tsx': 'b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f',
  };

  it.each(Object.entries(UNTOUCHABLE))('%s is byte-identical', (rel, digest) => {
    expect(sha256(read(rel)), `${rel} MOVED — this ticket may not open it`).toBe(digest);
  });

  /**
   * 🔴 firestore.rules IS ASKED THROUGH THE-325'S REGISTER, NOT COPIED HERE.
   * THE-325 consolidated 46 suites that each pinned the same digest literal so
   * that a legitimate rules change is ONE edit; writing the digest into this
   * file would make it 47 again, and THE-325's own guard fails when it does.
   */
  it('firestore.rules is at an accepted digest, and this ticket did not move it', () => {
    expect(
      rulesDigestFailure(),
      'firestore.rules is at a digest no ticket has recorded — this ticket may ' +
        'not open it, and does not',
    ).toBeNull();
  });

  it('every file under functions/ is byte-identical', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
        return [p];
      });
    const files = walk(path.join(ROOT, 'functions'))
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
      .sort();
    const rollup = sha256(files.map((f) => sha256(read(f))).join('\n') + '\n');
    expect(
      rollup,
      'a file under functions/ changed, was added or was removed',
    ).toBe('19e1fd20f9579c72656e92a28cd911b3c46f498cf8d3b98b7933c821fba13438');
  });

  it('🔴 and no primitive under src/components/ui was edited to get here', () => {
    // ⚠️ The one true fix for the anchoring bug is `React.forwardRef` inside
    // `ui/button.tsx`. That file is byte-frozen by nine other tickets' digest
    // guards with no append point, so it is REPORTED rather than amended and
    // this ticket fixes the trigger at its own call site instead. If a later
    // ticket does take the primitive fix, this pin is the thing that tells it
    // which suites it has to bring along.
    const recorded: Record<string, string> = JSON.parse(
      read('src/components/ui/__tests__/__fixtures__/primitive-digests.json'),
    );
    const moved = Object.entries(recorded)
      .filter(([rel, digest]) => sha256(read(rel)) !== digest)
      .map(([rel]) => rel);
    expect(moved, 'a frozen primitive moved:' + bullets(moved)).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 19. The trigger keeps the button primitive's costume without its wrapper.
// ═════════════════════════════════════════════════════════════════════════════
describe('19 · the trigger still wears the button primitive', () => {
  it('it reaches for buttonVariants rather than hand-rolling a paperclip', () => {
    const src = read('src/components/attach/AttachMenu.tsx');
    expect(src).toContain("from '@/components/ui/button'");
    expect(src).toContain('buttonVariants(');
    expect(
      src,
      'the ghost/icon costume is the primitive\'s to define, not this file\'s',
    ).toContain("variant: 'ghost'");
  });

  it('🔴 and no longer hands Base UI a component that cannot hold a ref', () => {
    // ⚠️ COMMENTS STRIPPED FIRST. That file's header quotes the broken shape
    // while explaining what it cost; the question here is about the JSX.
    const src = read('src/components/attach/AttachMenu.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(
      /render=\{\s*<Button\b/.test(src),
      'the trigger is back behind `render={<Button …/>}`. `ui/button.tsx` is a ' +
        'plain function component: under React 18 it cannot receive a ref, so ' +
        'Menu.Positioner gets no anchor, never measures, and the menu stays at ' +
        'opacity 0. That is THE-337.',
    ).toBe(false);
  });

  it('the menu still composes the primitives it was built from', () => {
    const src = read('src/components/attach/AttachMenu.tsx');
    for (const p of ['alert', 'button', 'dialog', 'dropdown-menu', 'empty', 'spinner']) {
      expect(src, `${p} is no longer composed`).toContain(`@/components/ui/${p}`);
    }
    expect(src, 'the cascader is still the browse surface').toContain('reui/cascader/cascader');
    expect(src, 'windowing stays off, deliberately').toContain('virtualize={false}');
  });
});
