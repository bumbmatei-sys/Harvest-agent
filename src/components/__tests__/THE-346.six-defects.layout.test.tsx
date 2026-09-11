// @vitest-environment node
//
// NODE, NOT happy-dom — the same reason THE-276-FIX, THE-290, THE-320 and
// THE-331 give, re-verified for this ticket rather than inherited: with
// happy-dom selected, `MeasuringBrowser` never attaches and the suite times
// out. Nothing here needs a DOM. The page is rendered to a string and every
// measurement happens inside a real Chromium over CDP.
//
// ONE `MeasuringBrowser` PER PROCESS. Two instances in one process collide on
// a debugger port.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { setUpOrFail } from '../../test/support/suite-setup';

/**
 * THE-346 · six defects the founder found on a phone. EVERY ONE OF THEM IS A
 * LAYOUT CLAIM, so every one of them is measured in a real browser.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS AT ALL
 *
 * `happy-dom` has NO LAYOUT ENGINE. With the real compiled stylesheet injected,
 * `getBoundingClientRect()` returns zeroes on every element and
 * `getComputedStyle(el).display` answers `block` for a flex container. So a
 * source-only assertion — "the class string contains `min-h-11`" — would PASS
 * ON ALL SIX BROKEN. It has to, because five of the six defects are a
 * relationship between two boxes and the sixth is a box's own height, and a
 * class name is neither.
 *
 * THE-308's suite is the proof of that, and it is this ticket's own no-regression
 * partner. It measured the List/Month TRIGGERS in Chromium, found a correct
 * 44px, and passed — while the LIST holding them was 32px and the pill hung
 * 6px out of each end of it. Both numbers were right; nobody had measured
 * the relationship. So the assertions below are about relationships wherever
 * the defect is one.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * EVERY CLASS STRING IS READ OFF THE SHIPPED SOURCE AT RUN TIME
 *
 * Nothing here is hand-copied. THE-331 recorded why: a hand copy lets the
 * shipped class drift away from the measured one, and the suite then keeps
 * passing while the founder's bug comes back. And NOTHING IS PINNED TO A LINE
 * NUMBER — THE-331's own first draft named `AdminCommunity.tsx:491`, a deletion
 * moved it to `:311`, and the suite would have measured whatever landed there.
 * Every surface below is found by PATTERN, and a pattern that finds nothing
 * throws rather than measuring a default.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * TRANSITIONS ARE DISABLED IN THE MEASURED PAGE, AND THAT IS A FINDING
 *
 * `TabsTrigger` carries `transition-all`, and `transition-all` includes
 * `min-height`. `MeasuringBrowser.settle()` waits two animation frames (~32ms)
 * — well inside a 150ms transition — so a trigger measured on arrival at a new
 * viewport reports a value MID-FLIGHT. Measured here before the fix, the same
 * element's computed `min-height` came back as 7.7469px on one run and
 * 1.43015px on the next: a drifting number, which is the tell.
 *
 * THE-323's own header records the identical artefact from the other side —
 * "7.63px, then 7.69px, then 7.75px on three consecutive runs — a DRIFTING
 * value" — and diagnoses it as `Button`'s `transition-all` animating
 * min-height, not as a broken class. This suite therefore measures the RESTING
 * layout, which is the one a person sees, by suppressing transitions in the
 * page it builds. Without that, every number below is a race.
 */

/** The founder's phone, and the four widths above it. Width is NOT monotonic. */
const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Pull one capture out of a file, or throw naming the file and the pattern.
 *
 * A DISCOVERY THAT FINDS NOTHING MUST THROW, never fall back. A default would
 * turn "the surface moved" into "the surface is fine", which is the failure
 * mode a discovery guard exists to prevent.
 */
function discover(rel: string, re: RegExp, what: string): string {
  const m = read(rel).match(re);
  if (!m) throw new Error(`${what}: no match for ${re} in ${rel} — the surface moved`);
  return m[1];
}

// ── The surfaces, all six, discovered ───────────────────────────────────────

const DOCS = 'src/components/AdminDocs.tsx';
const DASH = 'src/components/AdminDashboard.tsx';
const COMMUNITY = 'src/components/AdminCommunity.tsx';
const NEWS = 'src/components/NewsTab.tsx';
const EVENTS = 'src/components/AdminEvents.tsx';

/** 1+2 · the notes editor's header row and the two controls in its left group. */
const docsHeaderRow = discover(
  DOCS,
  /<div className="(flex shrink-0 items-center justify-between[^"]*border-b border-line[^"]*)">/,
  'the notes editor header row',
);
const docsLeftGroup = discover(
  DOCS,
  /<div className="(flex min-w-0 items-center gap-2)">/,
  "the editor header's left group",
);
const docsBackBtn = discover(
  DOCS,
  /className="(flex shrink-0 items-center gap-1\.5 text-\[13px\][^"]*text-gold[^"]*)"/,
  'the back-to-Notes button',
);
const docsExpandBtn = discover(
  DOCS,
  /data-testid="docs-expand-toggle"\s*\n\s*className="([^"]+)"/,
  'the expand toggle',
);

/**
 * THE ORDER OF THE HEADER'S CONTROLS, READ OUT OF THE SOURCE.
 *
 * THIS IS THE DIFFERENCE BETWEEN A GUARD AND A DECORATION, and it was found by
 * mutation rather than by inspection: the first version of this file took the
 * CLASS STRINGS off the source and then laid the replica out in an order
 * hand-written here. Moving the expand toggle back beside the menu — the exact
 * defect item 2 exists to fix — changed the shipped screen and changed NOTHING
 * in the replica, so all 27 measured assertions went on passing. A replica that
 * cannot express the defect measures nothing.
 *
 * So the header's children are ordered by WHERE THEY APPEAR IN THE FILE. Each
 * control is found by an anchor that identifies it uniquely — the handler it
 * calls, its test id, its component name — and the replica is built by sorting
 * those offsets. Move the toggle in `AdminDocs.tsx` and it moves here, which is
 * what makes the measurement answer the founder's question.
 */
type HeaderSlot = 'back' | 'expand' | 'breadcrumb' | 'menu';

function headerOrder(): HeaderSlot[] {
  const src = read(DOCS);
  const rowAt = src.indexOf(docsHeaderRow);
  if (rowAt < 0) throw new Error('the editor header row moved');
  // The row ends where the editor body begins; both are discovered, not counted.
  const bodyAt = src.indexOf('docs-editor', rowAt);
  if (bodyAt < 0) throw new Error('the editor body marker moved — the header region is unbounded');
  const region = src.slice(rowAt, bodyAt);

  const anchors: Array<[HeaderSlot, string]> = [
    ['back', 'onClick={closeEditor}'],
    ['expand', 'data-testid="docs-expand-toggle"'],
    ['breadcrumb', '<DocsBreadcrumb'],
    ['menu', '<EditorMenu'],
  ];
  const found = anchors.map(([slot, anchor]) => {
    const at = region.indexOf(anchor);
    if (at < 0) throw new Error(`${slot}: "${anchor}" is not in the editor header any more`);
    return [slot, at] as const;
  });
  return found.sort((a, b) => a[1] - b[1]).map(([slot]) => slot);
}

const HEADER_ORDER = headerOrder();

/**
 * Which of the header's two groups a control sits in, also read off the source.
 *
 * The left group is `flex min-w-0 items-center gap-2`; the right one is
 * `flex shrink-0 items-center gap-2`. A control's group is decided by which
 * opening tag most recently precedes it, so moving the toggle between them
 * moves it between them here.
 */
function groupOf(anchor: string): 'left' | 'right' {
  const src = read(DOCS);
  const rowAt = src.indexOf(docsHeaderRow);
  const region = src.slice(rowAt, src.indexOf('docs-editor', rowAt));
  const at = region.indexOf(anchor);
  if (at < 0) throw new Error(`${anchor} is not in the editor header`);
  const leftAt = region.lastIndexOf(`<div className="${docsLeftGroup}">`, at);
  const rightAt = region.lastIndexOf('<div className="flex shrink-0 items-center gap-2">', at);
  return leftAt > rightAt ? 'left' : 'right';
}

const EXPAND_GROUP = groupOf('data-testid="docs-expand-toggle"');
const BACK_GROUP = groupOf('onClick={closeEditor}');
const MENU_GROUP = groupOf('<EditorMenu');
/** Every menu row's shared tap-target class, as the screen spells it. */
const docsMenuRow = discover(
  DOCS,
  /const MENU_ROW = '([^']+)'/,
  "the note menu's row class",
);

/** 2 · the bottom nav, and the wrapper THE-346 hides it with. */
const navClass = discover(
  DASH,
  /data-nav-shell className="([^"]*z-\[100\][^"]*)"/,
  'the admin shell bottom nav',
);
const navWrapperHidden = discover(
  DASH,
  /data-nav-visibility className=\{navHidden \? '([^']+)' : '[^']+'\}/,
  'the nav visibility wrapper, hidden',
);
const navWrapperShown = discover(
  DASH,
  /data-nav-visibility className=\{navHidden \? '[^']+' : '([^']+)'\}/,
  'the nav visibility wrapper, shown',
);
/** The shell's own wrapper around the community screen — the padding that stacks. */
const communityShellWrap = discover(
  DASH,
  /<div className="(p-4 pb-0 lg:p-0 h-full)"><AdminCommunity/,
  'the shell wrapper around AdminCommunity',
);

/** 3 · the chat thread pane, its message list and its composer. */
const threadPane = discover(
  COMMUNITY,
  /className=\{`\$\{anyThreadOpen \? 'flex' : 'hidden lg:flex'\} ([^`]*)`\}/,
  'the chat thread pane',
);
const msgList = discover(
  COMMUNITY,
  /<div className="(flex-1 min-h-0 overflow-y-auto p-4 space-y-3)">/,
  'the chat message list',
);
const composerOuter = discover(
  COMMUNITY,
  /<div className="(bg-surface-raised border-t border-line flex-shrink-0 px-4 pt-3)"/,
  'the chat composer wrapper',
);
const composerPill = discover(
  COMMUNITY,
  /<div className="(flex gap-2 items-center bg-surface-tint rounded-2xl[^"]*)">/,
  'the chat composer pill',
);

/** 4 · the news composer's avatar row and its action row. */
const newsAvatarRow = discover(
  NEWS,
  /<div className="(flex items-start gap-3)">\s*\n\s*<div className="w-9 h-9 rounded-full/,
  'the news composer avatar row',
);
const newsAvatar = discover(
  NEWS,
  /<div className="(w-9 h-9 rounded-full bg-surface-chip[^"]*)">/,
  'the news composer avatar',
);
const newsActionRow = discover(
  NEWS,
  /<div className="(flex items-center justify-between mt-3 pt-3 border-t border-line[^"]*)">/,
  'the news composer action row',
);
const newsClipBtn = discover(
  NEWS,
  /className="(p-2 -ml-2 text-muted[^"]*)"/,
  'the news composer paperclip',
);

/** 6 · the Events List/Month control. */
/**
 * `TabsList`'s className is OPTIONAL to discover, and every other surface's is
 * not — the difference is deliberate.
 *
 * Everywhere else, a pattern that finds nothing means the surface MOVED and the
 * suite would otherwise measure a stale hand copy, so `discover` throws. Here,
 * a bare `<TabsList>` is a REAL STATE of the screen: it is what shipped before
 * this ticket, and it is the state the founder reported. Throwing on it would
 * turn the defect into a broken guard — a red suite that says "the surface
 * moved" rather than "the pill hangs out of its container at 380px". So the
 * absence is measured instead, and the geometry cases below are what fail.
 */
const tabsListCls =
  read(EVENTS).match(/<TabsList className="([^"]+)">/)?.[1] ??
  (read(EVENTS).includes('<TabsList>')
    ? ''
    : (() => { throw new Error('the events TabsList is gone entirely'); })());
const tabTriggerCls = discover(
  EVENTS,
  /<TabsTrigger value="list" className="([^"]+)">List<\/TabsTrigger>/,
  'the events List trigger',
);

// ── Readings ────────────────────────────────────────────────────────────────

interface Box {
  x: number; y: number; w: number; h: number; right: number; bottom: number; display: string;
}

interface Reading {
  viewport: number;
  scrollWidth: number;
  boxes: Record<string, Box | null>;
  /** The nav in both states, at this width. */
  navShownH: number;
  navHiddenH: number;
  navShownTop: number;
  navHiddenDisplay: string;
}

let browser: MeasuringBrowser;
const readings = new Map<number, Reading>();

/** Which group each slot lives in, as the source says. */
const SLOT_GROUP: Record<HeaderSlot, 'left' | 'right'> = {
  back: BACK_GROUP,
  expand: EXPAND_GROUP,
  breadcrumb: groupOf('<DocsBreadcrumb'),
  menu: MENU_GROUP,
};

/** One header control, wearing the class string the screen gives it. */
function renderSlot(slot: HeaderSlot) {
  switch (slot) {
    case 'back':
      return <button key={slot} data-docs-back className={docsBackBtn}>Notes</button>;
    case 'expand':
      return <button key={slot} data-docs-expand className={docsExpandBtn}>E</button>;
    case 'breadcrumb':
      return <div key={slot} className="hidden min-w-0 sm:block"><span>Folder / Note</span></div>;
    case 'menu':
      return (
        <button
          key={slot}
          data-docs-menu-trigger
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg transition-colors hover:bg-surface-sunken sm:min-h-0 sm:min-w-0 sm:p-1.5"
        >
          M
        </button>
      );
  }
}

/**
 * The measured page.
 *
 * FOUR INDEPENDENT SCENES, not one screen. These six defects live on five
 * different screens and no single page contains them all; stitching them into
 * one fake screen would be a replica of something that does not exist. Each
 * scene below reproduces ONE surface's real ancestor chain — which for the chat
 * composer is the whole point, because the padding that breaks it is in a
 * DIFFERENT FILE from the composer.
 */
function page() {
  return (
    <div className="bg-surface">
      {/* ── Scene 1 · the notes editor header, with the nav SHOWN ───────────── */}
      <div data-scene="docs" className="relative">
        <div data-docs-header className={docsHeaderRow}>
          <div data-docs-left className={docsLeftGroup}>
            {HEADER_ORDER.filter((slot) => SLOT_GROUP[slot] === 'left').map(renderSlot)}
          </div>
          <span className="hidden sm:block text-xs text-faint">Saved</span>
          <div data-docs-right className="flex shrink-0 items-center gap-2">
            {HEADER_ORDER.filter((slot) => SLOT_GROUP[slot] === 'right').map(renderSlot)}
          </div>
        </div>
        {/* A menu row, wearing the class every row of the shipped menu wears.
            The menu's CONTENTS and ORDER are driven through the real component
            in THE-346.notes-menu-and-nav; what is asked here is the one thing
            happy-dom cannot answer — how tall the row actually is. */}
        <div data-menu-row className={`flex items-center px-2 py-1.5 text-sm ${docsMenuRow}`}>
          Share on web
        </div>
      </div>

      {/* ── Scene 2 · the bottom nav, in BOTH states, at every width ────────── */}
      <div data-nav-scene className="relative">
        <div data-nav-wrap-shown className={navWrapperShown}>
          <div data-nav-shown className={navClass.replace('fixed', 'relative')}>
            <span>Nav</span>
          </div>
        </div>
        <div data-nav-wrap-hidden className={navWrapperHidden}>
          <div data-nav-hidden className={navClass.replace('fixed', 'relative')}>
            <span>Nav</span>
          </div>
        </div>
      </div>

      {/* ── Scene 3 · the chat thread, INSIDE the shell wrapper that breaks it ─ */}
      <div data-community-shell className={communityShellWrap}>
        <div className="flex flex-col h-[360px] lg:flex-row lg:gap-5">
          <div data-thread-pane className={`flex ${threadPane}`}>
            <div className="flex flex-col h-full min-h-0 w-full">
              <div data-msg-list className={msgList}>
                <div className="flex justify-end">
                  <div className="flex flex-col items-end max-w-[78%]">
                    <div data-bubble className="bg-gold text-white rounded-2xl rounded-br-sm px-3.5 py-2.5 text-sm break-words">
                      Sunday
                    </div>
                  </div>
                </div>
              </div>
              <div data-composer-outer className={composerOuter} style={{ paddingBottom: '8px' }}>
                <div data-composer-pill className={composerPill}>
                  <button className="flex min-h-11 min-w-11 items-center justify-center">A</button>
                  <input
                    data-composer-input
                    className="flex-1 bg-transparent outline-hidden text-sm text-strong"
                    placeholder="Type a message..."
                  />
                  <button className="w-9 h-9 rounded-xl flex items-center justify-center">S</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Scene 4 · the news composer ─────────────────────────────────────── */}
      <div data-news-scene className="bg-surface-raised rounded-2xl border border-line p-4">
        <div className={newsAvatarRow}>
          <div data-news-avatar className={newsAvatar}>Y</div>
          <textarea rows={2} className="flex-1 min-w-0 bg-transparent text-sm p-0 pt-1.5" />
        </div>
        <div data-news-actions className={newsActionRow}>
          <div className="flex items-center gap-1">
            <button data-news-clip className={newsClipBtn}>
              <span data-news-clip-glyph className="block w-[18px] h-[18px]" />
            </button>
            <button data-news-pin className="flex items-center gap-1.5 px-2 py-1.5 text-xs">Pin</button>
          </div>
          <button data-news-post className="px-4 py-2 text-sm">Post</button>
        </div>
      </div>

      {/* ── Scene 5 · the Events List/Month control ─────────────────────────── */}
      <div data-events-scene className="px-4">
        <div className="group/tabs flex gap-2 data-[orientation=horizontal]:flex-col" data-orientation="horizontal">
          <div data-slot="tabs-list" data-variant="default" data-events-list className={`group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-[orientation=horizontal]/tabs:h-8 data-[variant=line]:rounded-none bg-muted ${tabsListCls}`}>
            <button data-slot="tabs-trigger" data-tab="list" className={`relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap ${tabTriggerCls}`}>List</button>
            <button data-slot="tabs-trigger" data-tab="month" className={`relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap ${tabTriggerCls}`}>Month</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const SELECTORS: Record<string, string> = {
  docsHeader: '[data-docs-header]',
  docsLeft: '[data-docs-left]',
  docsBack: '[data-docs-back]',
  docsExpand: '[data-docs-expand]',
  docsMenuTrigger: '[data-docs-menu-trigger]',
  menuRow: '[data-menu-row]',
  navWrapShown: '[data-nav-wrap-shown]',
  navWrapHidden: '[data-nav-wrap-hidden]',
  navShown: '[data-nav-shown]',
  navHidden: '[data-nav-hidden]',
  communityShell: '[data-community-shell]',
  threadPane: '[data-thread-pane]',
  msgList: '[data-msg-list]',
  bubble: '[data-bubble]',
  composerOuter: '[data-composer-outer]',
  composerPill: '[data-composer-pill]',
  composerInput: '[data-composer-input]',
  newsAvatar: '[data-news-avatar]',
  newsActions: '[data-news-actions]',
  newsClip: '[data-news-clip]',
  newsClipGlyph: '[data-news-clip-glyph]',
  newsPin: '[data-news-pin]',
  eventsList: '[data-events-list]',
  tabList: '[data-tab="list"]',
  tabMonth: '[data-tab="month"]',
};

setUpOrFail(async () => {
  const css = await buildAppCss();
  const html = renderToStaticMarkup(page());
  const dir = mkdtempSync(path.join(os.tmpdir(), 'the346-'));
  const file = path.join(dir, 'six-defects.html');
  writeFileSync(
    file,
    `<!doctype html><html data-theme="light"><head><meta charset="utf-8">` +
      `<style>${css}</style>` +
      // See the header: `transition-all` animates min-height, and two animation
      // frames is well inside a 150ms transition, so an un-suppressed page
      // reports a DRIFTING mid-flight value. The resting layout is the one a
      // person sees.
      `<style>*,*::before,*::after{transition:none !important;animation:none !important}</style>` +
      `</head><body>${html}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const viewport of VIEWPORTS) {
    const r = await browser.evaluateAt<Reading>(
      viewport,
      `(() => {
        const round = (n) => Math.round(n * 100) / 100;
        const box = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { x: round(b.x), y: round(b.y), w: round(b.width), h: round(b.height),
                   right: round(b.right), bottom: round(b.bottom),
                   display: getComputedStyle(el).display };
        };
        const sel = ${JSON.stringify(SELECTORS)};
        const boxes = {};
        for (const k of Object.keys(sel)) boxes[k] = box(sel[k]);
        const shown = document.querySelector('[data-nav-shown]').getBoundingClientRect();
        const hidden = document.querySelector('[data-nav-hidden]').getBoundingClientRect();
        return {
          viewport: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          boxes,
          navShownH: round(shown.height),
          navHiddenH: round(hidden.height),
          navShownTop: round(shown.top),
          navHiddenDisplay: getComputedStyle(document.querySelector('[data-nav-wrap-hidden]')).display,
        };
      })()`,
      900,
    );
    readings.set(viewport, r);
  }
}, 300_000);

afterAll(async () => {
  await browser?.close();
});

const at = (v: number): Reading => {
  const r = readings.get(v);
  if (!r) throw new Error(`no reading at ${v}`);
  return r;
};

const box = (v: number, key: string): Box => {
  const b = at(v).boxes[key];
  if (!b) throw new Error(`${key} was not measured at ${v} — the surface did not render`);
  return b;
};

// ═════════════════════════════════════════════════════════════════════════════
// 0 · the precondition — the classes really came off the shipped source.
// ═════════════════════════════════════════════════════════════════════════════

describe('the measured surfaces are the shipped ones', () => {
  it('every discovered class string is present in the file it came from', () => {
    const pairs: Array<[string, string, string]> = [
      [DOCS, docsHeaderRow, 'notes editor header'],
      [DOCS, docsBackBtn, 'back to Notes'],
      [DOCS, docsExpandBtn, 'expand toggle'],
      [DOCS, docsMenuRow, 'menu row'],
      [DASH, navClass, 'bottom nav'],
      [DASH, communityShellWrap, 'community shell wrapper'],
      [COMMUNITY, threadPane, 'thread pane'],
      [COMMUNITY, composerPill, 'composer pill'],
      [NEWS, newsActionRow, 'news action row'],
      [NEWS, newsClipBtn, 'news paperclip'],
      [EVENTS, tabsListCls, 'events TabsList'],
      [EVENTS, tabTriggerCls, 'events tab trigger'],
    ];
    for (const [file, cls, what] of pairs) {
      expect(read(file), `${what} drifted away from the measured copy`).toContain(cls);
    }
  });

  it('and nothing was measured at a line number', () => {
    // THE-331 pinned `AdminCommunity.tsx:491`; a deletion shifted it to `:311`,
    // so the suite would have measured whatever landed there. Discovery is by
    // pattern, and this file contains no `:<digits>` source coordinate.
    const self = read('src/components/__tests__/THE-346.six-defects.layout.test.tsx');
    const codeOnly = self.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(codeOnly, 'a source line number was pinned').not.toMatch(/\.tsx['"]?\s*,?\s*\d+\b/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7 · the expand control sits immediately right of "Notes" — MEASURED.
// ═════════════════════════════════════════════════════════════════════════════

describe('the expand control sits immediately right of "Notes"', () => {
  it('is to the RIGHT of the back button at every width', () => {
    // The founder: "The expand button should be in the left not right. Exactly
    // on the right of the notes button."
    for (const v of VIEWPORTS) {
      const back = box(v, 'docsBack');
      const expand = box(v, 'docsExpand');
      expect(expand.x, `expand is not right of "Notes" at ${v}px`).toBeGreaterThan(back.x);
    }
  });

  it('is IMMEDIATELY right of it — nothing sits between them', () => {
    // "Immediately" is the claim, and a gap is how it stops being true. The two
    // are flex siblings in a `gap-2` row, so the space between them is the row's
    // own gap and nothing else. 8px at the phone rem base, 7.25px at the 14.5px
    // desktop base — so the bound is the row's measured gap, not a constant.
    for (const v of VIEWPORTS) {
      const back = box(v, 'docsBack');
      const expand = box(v, 'docsExpand');
      const gap = expand.x - back.right;
      expect(gap, `expand is ${gap}px from "Notes" at ${v}px — something is between them`)
        .toBeLessThanOrEqual(9);
      expect(gap, `expand overlaps "Notes" at ${v}px`).toBeGreaterThanOrEqual(0);
    }
  });

  it('and it is in the LEFT group, not the right one', () => {
    // The mutation: moving it back beside the menu. Then its left edge would be
    // past the header's midpoint at every width.
    for (const v of VIEWPORTS) {
      const header = box(v, 'docsHeader');
      const expand = box(v, 'docsExpand');
      const left = box(v, 'docsLeft');
      expect(expand.right, `expand escaped the left group at ${v}px`)
        .toBeLessThanOrEqual(left.right + 0.5);
      expect(expand.x, `expand is in the right half of the header at ${v}px`)
        .toBeLessThan(header.x + header.w / 2);
    }
  });

  it('the three-dot menu is still on the RIGHT, so the row did not simply invert', () => {
    for (const v of VIEWPORTS) {
      const header = box(v, 'docsHeader');
      const trigger = box(v, 'docsMenuTrigger');
      expect(trigger.x, `the menu trigger left the right-hand group at ${v}px`)
        .toBeGreaterThan(header.x + header.w / 2);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8 · expanding hides the bottom nav on mobile — MEASURED at 380px.
// ═════════════════════════════════════════════════════════════════════════════

describe('expanding hides the bottom nav on mobile', () => {
  it('the nav occupies a real band at 380px when it is shown', () => {
    // The control: if the nav measured nothing when SHOWN, the hidden case
    // would pass vacuously.
    const r = at(380);
    expect(r.navShownH, 'the bottom nav has no height even when shown').toBeGreaterThan(40);
  });

  it('and NO band at all at 380px when the screen is expanded', () => {
    const r = at(380);
    expect(r.navHiddenDisplay, 'the nav wrapper is still in layout at 380px').toBe('none');
    expect(r.navHiddenH, 'the bottom nav still takes vertical space at 380px').toBe(0);
  });

  it('it is DISPLAY, not layering — a z-index would leave the band and the taps', () => {
    // A competing z-index would paint the nav under the editor while it still
    // took its 65px of the viewport and still swallowed taps in that band. Zero
    // height is the only thing that gives the band back.
    const r = at(380);
    expect(r.boxes.navHidden?.h ?? -1).toBe(0);
    expect(r.boxes.navHidden?.w ?? -1).toBe(0);
  });

  it('but the DESKTOP RAIL survives the same flag from lg up', () => {
    // The same element is the side rail above `lg`. An unscoped `hidden` would
    // strip it, which is why the wrapper's two states live in different media
    // queries.
    for (const v of [1024, 1280, 1440] as const) {
      expect(at(v).navHiddenDisplay, `the desktop rail was stripped at ${v}px`).toBe('contents');
      expect(at(v).navHiddenH, `the desktop rail lost its height at ${v}px`).toBeGreaterThan(0);
    }
  });

  it('and 768px is still a phone for this purpose — the nav goes at every width below lg', () => {
    expect(at(768).navHiddenDisplay).toBe('none');
    expect(at(768).navHiddenH).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10 · the chat composer spans the full width at 380px — MEASURED.
// ═════════════════════════════════════════════════════════════════════════════

describe('the chat composer spans the full width at 380px', () => {
  it('the composer pill sits on the SAME inset as the message bubbles above it', () => {
    // This is the founder's bug stated as a relationship rather than a number:
    // "the input text field is not wide enough to the whole width of the
    // screen" is what a bordered pill inset 32px looks like under a message
    // list whose box-less bubbles run to 16px.
    for (const v of VIEWPORTS) {
      const pill = box(v, 'composerPill');
      const list = box(v, 'msgList');
      const bubble = box(v, 'bubble');
      // The list's own content box: its padding is where the bubbles start.
      expect(Math.abs(pill.right - bubble.right), `composer and bubbles disagree on the right inset at ${v}px`)
        .toBeLessThanOrEqual(1);
      expect(pill.x, `the composer is inset further than the message list at ${v}px`)
        .toBeLessThanOrEqual(list.x + 17);
    }
  });

  it('and at 380px it is at least 90% of the screen', () => {
    // Before the fix this was 316px of 380 — 83.2%, with 32px of gutter each
    // side. The 90% floor fails on that and passes on the 348px the single
    // 16px inset gives.
    const pill = box(380, 'composerPill');
    expect(pill.w / 380, `the composer is ${pill.w}px of 380`).toBeGreaterThanOrEqual(0.9);
  });

  it('the thread pane itself reaches both screen edges below lg', () => {
    // The mechanism, measured: `-mx-4` cancels the shell's own gutter for the
    // thread only. If the negative margin were dropped, the pane would start at
    // 16px and the pill at 32px again.
    for (const v of [380, 768] as const) {
      const pane = box(v, 'threadPane');
      const shell = box(v, 'communityShell');
      expect(pane.x, `the thread pane is inset at ${v}px`).toBeLessThanOrEqual(shell.x + 0.5);
      expect(pane.w, `the thread pane is narrower than the shell at ${v}px`)
        .toBeGreaterThanOrEqual(shell.w - 0.5);
    }
  });

  it('and from lg up the pane goes back inside its card — the desktop is not flattened', () => {
    for (const v of [1024, 1280, 1440] as const) {
      const pane = box(v, 'threadPane');
      const shell = box(v, 'communityShell');
      expect(pane.x, `the thread pane hangs out of the shell at ${v}px`)
        .toBeGreaterThanOrEqual(shell.x - 0.5);
    }
  });

  it('nothing overflows the viewport at any width', () => {
    for (const v of VIEWPORTS) {
      expect(at(v).scrollWidth, `the page scrolls horizontally at ${v}px`).toBeLessThanOrEqual(v);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11 · the news composer's paperclip and pin align to the avatar's left edge.
// ═════════════════════════════════════════════════════════════════════════════

describe("the news composer's paperclip and pin align to the avatar's left edge", () => {
  it('the paperclip GLYPH lands exactly on the avatar\'s left edge', () => {
    // The founder: "put that paperclip and pin button in the left to be in
    // parallel with the user profile picture." The button keeps its `-ml-2`, so
    // it is the glyph — not the 44px hit area around it — that aligns, which is
    // the same optical trick the row's other controls get from their padding.
    for (const v of VIEWPORTS) {
      const avatar = box(v, 'newsAvatar');
      const glyph = box(v, 'newsClipGlyph');
      expect(Math.abs(glyph.x - avatar.x), `the paperclip glyph is ${glyph.x - avatar.x}px off the avatar at ${v}px`)
        .toBeLessThanOrEqual(1);
    }
  });

  it('the action row is no longer indented past the avatar', () => {
    // `pl-12` was 48px — the avatar's 36px plus the row's 12px gap, which is
    // where the TEXT starts, not where the composer starts.
    //
    // MEASURED ON THE BUTTON, NOT ON THE ROW, and that distinction was found by
    // mutation: padding lives INSIDE the row's border box, so restoring `pl-12`
    // moves the row's contents 48px and leaves `actions.x` exactly where it
    // was. An assertion on the row's own box cannot see this defect at all.
    for (const v of VIEWPORTS) {
      const actions = box(v, 'newsActions');
      const clip = box(v, 'newsClip');
      const inset = clip.x - actions.x;
      // The paperclip's own `-ml-2` puts its box 8px LEFT of the content edge,
      // so the content edge is where the button starts plus that 8px — and it
      // must be the row's own edge, not 48px into it.
      expect(inset, `the action row's content starts ${inset}px into it at ${v}px`)
        .toBeLessThanOrEqual(0.5);
      expect(inset, `the paperclip is further left than its own -ml-2 at ${v}px`)
        .toBeGreaterThanOrEqual(-9);
    }
  });

  it('and Pin follows the paperclip rather than being pushed right', () => {
    for (const v of VIEWPORTS) {
      const clip = box(v, 'newsClip');
      const pin = box(v, 'newsPin');
      expect(pin.x, `Pin is not beside the paperclip at ${v}px`).toBeGreaterThan(clip.x);
      expect(pin.x - clip.right, `Pin drifted from the paperclip at ${v}px`).toBeLessThanOrEqual(12);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 15 · the List / Month control measures correctly at 380px — BOTH axes.
// ═════════════════════════════════════════════════════════════════════════════

describe('the List / Month control measures correctly at 380px', () => {
  it('both triggers clear 44px on BOTH axes', () => {
    // THE-308's finding: one tab measured 44px tall and 35.6px WIDE. Height
    // alone does not make a target when the content is one short word.
    for (const key of ['tabList', 'tabMonth'] as const) {
      const t = box(380, key);
      expect(t.h, `${key} is ${t.h}px tall at 380px`).toBeGreaterThanOrEqual(44);
      expect(t.w, `${key} is ${t.w}px wide at 380px`).toBeGreaterThanOrEqual(44);
    }
  });

  it('AND THE PILL IS INSIDE ITS CONTAINER — the defect THE-308 could not see', () => {
    // This is the whole of item 6. Before: list 32px (y 0 → 32), trigger 44px
    // (y -6 → 38 relative to a list at 0 → 32) — the pill hung 6px out of each end of the box it
    // lived in, which is the "floating, misaligned" the founder is describing.
    const list = box(380, 'eventsList');
    for (const key of ['tabList', 'tabMonth'] as const) {
      const t = box(380, key);
      expect(t.y, `${key} escapes the top of its container at 380px`).toBeGreaterThanOrEqual(list.y - 0.01);
      expect(t.bottom, `${key} hangs ${(t.bottom - list.bottom).toFixed(1)}px out of the bottom of its container at 380px`)
        .toBeLessThanOrEqual(list.bottom + 0.01);
      expect(t.x).toBeGreaterThanOrEqual(list.x - 0.01);
      expect(t.right).toBeLessThanOrEqual(list.right + 0.01);
    }
  });

  it('the container is not oversized either — it wraps the triggers and its own padding', () => {
    // "much taller than the row needs" is the other half of the founder's
    // report, so the container is bounded above as well as below: 44px of
    // trigger plus the list's own 3px padding, and nothing more.
    const list = box(380, 'eventsList');
    const t = box(380, 'tabList');
    expect(list.h, `the List/Month container is ${list.h}px tall at 380px`)
      .toBeLessThanOrEqual(t.h + 6 + 0.01);
  });

  it('and the density is RESTORED above sm — this is a phone fix, not a redesign', () => {
    // Rule 4 owns density from `sm` up. A container that stayed 50px on a
    // desktop would be the overcorrection.
    for (const v of [768, 1024, 1280, 1440] as const) {
      const list = box(v, 'eventsList');
      expect(list.h, `the List/Month container kept the phone height at ${v}px`).toBeLessThan(44);
      for (const key of ['tabList', 'tabMonth'] as const) {
        expect(box(v, key).h, `${key} kept the phone floor at ${v}px`).toBeLessThan(44);
      }
    }
  });

  it('the two triggers are the same size as each other at every width', () => {
    for (const v of VIEWPORTS) {
      const a = box(v, 'tabList');
      const b = box(v, 'tabMonth');
      expect(Math.abs(a.h - b.h), `the two tabs differ in height at ${v}px`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(a.w - b.w), `the two tabs differ in width at ${v}px`).toBeLessThanOrEqual(0.5);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 18 · every menu item, tab and map control is ≥44px below sm — MEASURED.
// ═════════════════════════════════════════════════════════════════════════════

describe('every menu item, tab and control this ticket touches is ≥44px below sm', () => {
  it('at 380px', () => {
    const targets: Array<[string, string]> = [
      ['menuRow', 'a row of the note menu'],
      ['docsMenuTrigger', 'the three-dot trigger'],
      ['docsExpand', 'the expand toggle'],
      ['tabList', 'the List tab'],
      ['tabMonth', 'the Month tab'],
    ];
    for (const [key, what] of targets) {
      const b = box(380, key);
      expect(b.h, `${what} is ${b.h}px tall at 380px`).toBeGreaterThanOrEqual(44);
      expect(b.w, `${what} is ${b.w}px wide at 380px`).toBeGreaterThanOrEqual(44);
    }
  });

  it('and `min-h-11` really is 44px here — it is NOT inert', () => {
    // The premise worth checking rather than inheriting: THE-323 records that
    // `min-h-11` was once reported as ~7.6px, and that the number belonged to
    // `transition-all` timing rather than to the class. Below `sm` the root is
    // 16px, so 11 × 0.25rem is exactly 44px, and here it is.
    expect(box(380, 'menuRow').h).toBeGreaterThanOrEqual(44);
    expect(box(380, 'docsExpand').h).toBeGreaterThanOrEqual(44);
  });

  it('and the floor is released above sm, where Rule 4 owns density', () => {
    for (const v of [768, 1024, 1280, 1440] as const) {
      expect(box(v, 'docsExpand').h, `the expand toggle kept the phone floor at ${v}px`)
        .toBeLessThan(44);
    }
  });
});
