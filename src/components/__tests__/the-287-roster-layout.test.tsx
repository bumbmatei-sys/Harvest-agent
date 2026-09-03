// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom, and this is load-bearing. happy-dom has NO layout
// engine — with the real compiled stylesheet injected, `getBoundingClientRect()`
// returns zeros on every element and `getComputedStyle(el).display` answers
// `block` for a flex container — so no assertion written against it can tell a
// table that scrolls inside its card from one that widens the page. Everything
// below is measured in real Chromium over CDP. Under this repo's default
// happy-dom environment `fetch` to the browser's own debugger port is
// cross-origin and the browser can never be attached to.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAppCss, REPO_ROOT } from '../../test/support/tailwind-build';
import { MeasuringBrowser, type Box } from '../../test/support/browser-measure';
import { GivingTab } from '../dashboard/GivingTab';
import { GrowthTab } from '../dashboard/GrowthTab';
import type { OverviewData } from '../dashboard/useOverviewData';

/**
 * THE-287 — WHERE the Growth and Giving widgets land, measured.
 *
 * ─── Why the ladder is five widths and not one ───────────────────────────────
 *
 * 🔴 WIDTH IS NOT MONOTONIC HERE. #426 measured a card falling TWICE across the
 * ladder, narrowest at 1280; #421 found a 4px page overflow at 1024 and 1280
 * ONLY, clean at the three widths either side, because that is exactly where
 * `lg:p-0` has removed the wrapper's padding and `max-w-6xl` is not yet
 * binding. A single "desktop" measurement would have missed both. So every
 * assertion runs at 380 / 768 / 1024 / 1280 / 1440.
 *
 * ─── ⚠️ What is approximated, and what that costs ────────────────────────────
 *
 * Two things in this fixture are replicas rather than the real components, and
 * both are checked against their source below so they cannot drift silently:
 *
 *   1. THE TAB PANEL. Base UI mounts only the ACTIVE panel, and static markup
 *      has no React to click, so `DashboardTabs` cannot be made to render
 *      Growth. The panel is reproduced from `ui/tabs.tsx` — a `flex flex-col`
 *      root holding a `flex-1 text-sm outline-none pt-2` panel — which is the
 *      whole of what it contributes to layout. Where a widget lands inside its
 *      panel does not depend on which library mounted the panel; that the panel
 *      lands where the tab list does is THE-276-FIX's assertion and still runs.
 *
 *   2. THE ADMIN SHELL. `AdminDashboard.tsx` is pinned byte-identical by this
 *      ticket, so its scroll container (`overflow-y-auto pb-24 lg:pb-8 p-0
 *      lg:p-6`) and its bottom nav (`fixed bottom-0 … z-[100] pb-safe`) are
 *      reproduced from it, class for class, and asserted to still match.
 *
 * 🔴 EVERY ASSERTION IS RELATIVE — a widget against its panel, the table's
 * scroller against its card, the last widget against the nav's own measured top
 * edge. That is what stops the approximation from being load-bearing.
 */

const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

/* ── Fixture data: everything readable, so no widget sits in an empty state ── */

const POINTS = Array.from({ length: 8 }, (_, i) => ({ label: `W${i}`, value: (i + 1) * 3 }));

/** Enough countries and cities that the table is genuinely too wide for 380px. */
const COUNTRY_ROWS = [
  { country: 'United Kingdom', members: 41, cityless: 2, cities: [
    { city: 'London', members: 22 }, { city: 'Manchester', members: 9 }, { city: 'Birmingham', members: 8 }] },
  { country: 'Kenya', members: 33, cityless: 0, cities: [
    { city: 'Nairobi', members: 21 }, { city: 'Mombasa', members: 7 }, { city: 'Kisumu', members: 5 }] },
  { country: 'United States', members: 28, cityless: 1, cities: [
    { city: 'Los Angeles', members: 12 }, { city: 'Philadelphia', members: 9 }, { city: 'San Antonio', members: 6 }] },
  { country: 'Romania', members: 12, cityless: 0, cities: [
    { city: 'Cluj-Napoca', members: 7 }, { city: 'Bucharest', members: 5 }] },
];

const GIVERS = Array.from({ length: 10 }, (_, i) => ({
  id: `g${i}`,
  name: `Contact Number ${i + 1} With A Long Name`,
  dollars: (10 - i) * 1750,
  stage: i === 0 ? 'champion' : 'giving',
}));

const READY = {
  loading: false,
  members: { kind: 'exact', value: 128 },
  contacts: { kind: 'exact', value: 42 },
  courses: { kind: 'exact', value: 6 },
  posts: { kind: 'exact', value: 19 },
  articles: { kind: 'exact', value: 7 },
  submissions: { kind: 'exact', value: 3 },
  seventh: { label: 'Receipts', figure: { kind: 'exact', value: 88 } },
  memberSeries: { kind: 'complete', points: POINTS },
  givingSeries: { kind: 'complete', points: POINTS },
  submissionSeries: { kind: 'complete', points: POINTS },
  invoiceRows: [{ amountCents: 25000, issuedAt: null, type: 'donation_receipt' }],
  invoiceReason: null,
  liveNow: { active: false, title: 'Live now' },
  roster: {
    countries: { rows: COUNTRY_ROWS, covered: 114, total: 128, cityCovered: 111 },
    countriesReason: null,
    funnel: [
      { key: 'member', label: 'Member', value: 26 },
      { key: 'giving', label: 'Giving', value: 14 },
      { key: 'champion', label: 'Champion', value: 2 },
    ],
    funnelReason: null,
    givers: GIVERS,
    giversReason: null,
  },
} as unknown as OverviewData;

/* ── The replicas, and the classes they are copied from ─────────────────────── */

/** `ui/tabs.tsx`'s Panel, and the `pt-2` DashboardTabs gives it. */
const PANEL_CLASS = 'flex-1 text-sm outline-none pt-2';
/** `AdminDashboard.tsx:930`'s root: a viewport-height box that never scrolls. */
const SHELL_CLASS = 'flex flex-col lg:flex-row h-[100dvh] bg-surface overflow-hidden';
/**
 * `AdminDashboard.tsx:1037`'s main column.
 *
 * 🔴 `h-[100dvh]` HERE, not only on the root, and it is load-bearing: a
 * `flex-1` item defaults to `min-height: auto`, so without an explicit height
 * this column grows to its content and the scroller inside it never scrolls.
 * The first draft of this fixture omitted it, the scroller reported itself
 * already at its end, and the clearance assertion was measuring an unscrolled
 * page. The real shell spells it, so this does too.
 */
const MAIN_COLUMN_CLASS = 'flex-1 flex flex-col h-[100dvh] relative bg-surface overflow-hidden min-w-0';
/** `AdminDashboard.tsx:1113`'s scroll container, non-community branch. */
const SCROLLER_CLASS = 'flex-1 overflow-y-auto pb-24 lg:pb-8 p-0 lg:p-6';
/** `AdminDashboard.tsx:934`'s nav, both arms, minus its two shadows. */
const NAV_CLASS = 'bg-surface-raised border-t lg:border-t-0 lg:border-r border-line lg:border-line '
  + 'flex justify-center lg:justify-start py-2 lg:py-6 px-2 lg:px-4 pb-safe lg:pb-0 '
  + 'fixed lg:relative bottom-0 lg:bottom-auto w-full lg:w-64 lg:h-screen z-[100]';

/**
 * The shell, reproduced.
 *
 * 🔴 THE STRUCTURE IS THE POINT, not the styling. The root is `h-[100dvh]
 * overflow-hidden`, so the PAGE never scrolls and the content container does —
 * which is what makes that container's `pb-24` the thing standing between the
 * last widget and the fixed nav. A fixture that let the page scroll instead
 * would put the nav wherever the document happened to end and would assert
 * nothing about clearance.
 */
function Page({ tab, body }: { tab: string; body: React.ReactNode }) {
  return (
    <div className={SHELL_CLASS} data-page={tab}>
      {/*
        ⚠️ BOTH ARMS of the real bar, from its own class string: `fixed
        bottom-0 w-full z-[100] pb-safe` on a phone, and `lg:relative
        lg:w-64 lg:h-screen` — the sidebar — above `lg`. Reproducing only the
        mobile arm would have needed a second element to stand in for the
        sidebar, and then the desktop measurements would describe a shell with
        two of them.
      */}
      <div data-bottom-nav className={NAV_CLASS}>
        <div className="flex lg:hidden justify-around items-center w-full">
          {['Home', 'Members', 'Courses', 'More'].map((label) => (
            <div key={label} className="flex flex-col items-center justify-center gap-1 w-16 h-12 rounded-xl">
              <div className="size-[22px]" />
              <span className="text-[10px] font-medium">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={MAIN_COLUMN_CLASS}>
        <div data-scroller className={SCROLLER_CLASS}>
          {/* AdminDashboardHome's own wrapper, class for class. */}
          <div data-wrapper className="w-full max-w-6xl mx-auto space-y-6 p-4 lg:p-0">
            <div>Good morning.</div>
            {/* The Tabs root and panel, reproduced — see the header. */}
            <div className="flex flex-col w-full">
              <div data-panel className={PANEL_CLASS}>{body}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Measurement ──────────────────────────────────────────────────────────── */

interface TabMeasurement {
  scrollWidth: number;
  bodyScrollWidth: number;
  scrolledToEnd: boolean;
  scrollerOverflowed: boolean;
  scrollTop: number;
  boxes: Record<string, Box | null>;
  widgets: Array<{ title: string } & Box>;
  scrollers: Array<{ clientWidth: number; scrollWidth: number; overflowX: string } & Box>;
}

/**
 * 🔴 THE SCROLLER IS DRIVEN TO ITS END FIRST, and that is the whole test.
 *
 * `getBoundingClientRect()` is in VIEWPORT coordinates. An unscrolled page puts
 * the last widget below the fold, where it trivially "clears" a bar fixed to
 * the bottom of the viewport — an assertion that would pass on a layout with no
 * bottom padding at all. Scrolling to the end is what makes the question real:
 * when the reader has reached the bottom of the tab, is the last widget still
 * above the nav that is painted over it?
 */
const EXPRESSION = `(() => {
  const scroller = document.querySelector('[data-scroller]');
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
  const box = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { x: b.x, y: b.y, width: b.width, height: b.height, right: b.right,
             bottom: b.bottom, display: cs.display, flexDirection: cs.flexDirection };
  };
  const sel = { wrapper: '[data-wrapper]', panel: '[data-panel]', nav: '[data-bottom-nav]', scroller: '[data-scroller]' };
  const boxes = {};
  for (const k of Object.keys(sel)) boxes[k] = box(document.querySelector(sel[k]));
  return {
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    scrolledToEnd: scroller ? scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1 : false,
    scrollerOverflowed: scroller ? scroller.scrollHeight > scroller.clientHeight : false,
    scrollTop: scroller ? scroller.scrollTop : 0,
    boxes,
    widgets: [...document.querySelectorAll('[data-widget]')].map(
      (el) => ({ title: el.getAttribute('data-widget'), ...box(el) })),
    scrollers: [...document.querySelectorAll('[data-slot="table-container"]')].map((el) => ({
      ...box(el),
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      overflowX: getComputedStyle(el).overflowX,
    })),
  };
})()`;

let browser: MeasuringBrowser;
/** Kept so the palette probe can re-open the Growth page — see section 4. */
let growthUrl = '';
const growth = new Map<number, TabMeasurement>();
const giving = new Map<number, TabMeasurement>();

beforeAll(async () => {
  const css = await buildAppCss();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'the287-'));

  const write = (name: string, node: React.ReactElement) => {
    const file = path.join(dir, name);
    writeFileSync(
      file,
      `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>`
      + `<body>${renderToStaticMarkup(node)}</body></html>`,
    );
    return `file://${file}`;
  };

  growthUrl = write('growth.html', <Page tab="growth" body={<GrowthTab data={READY} />} />);
  const givingUrl = write('giving.html', <Page tab="giving" body={<GivingTab data={READY} />} />);

  browser = new MeasuringBrowser();
  await browser.open(growthUrl);
  for (const viewport of VIEWPORTS) {
    growth.set(viewport, await browser.evaluateAt<TabMeasurement>(viewport, EXPRESSION, 800));
  }
  await browser.open(givingUrl);
  for (const viewport of VIEWPORTS) {
    giving.set(viewport, await browser.evaluateAt<TabMeasurement>(viewport, EXPRESSION, 800));
  }
}, 180_000);

afterAll(async () => { await browser?.close(); });

const box = (m: TabMeasurement, name: string): Box => {
  const found = m.boxes[name];
  if (!found) throw new Error(`${name} did not render`);
  return found;
};

/* ═══ 0 · The replicas still match their source ══════════════════════════════ */

describe('the fixture reproduces the real shell rather than a convenient one', () => {
  const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

  it('the panel replica carries ui/tabs.tsx\'s own classes, and DashboardTabs\' pt-2', () => {
    expect(read('src/components/ui/tabs.tsx')).toContain('"flex-1 text-sm outline-none"');
    expect(read('src/components/dashboard/DashboardTabs.tsx')).toContain('className="pt-2"');
    expect(PANEL_CLASS).toBe('flex-1 text-sm outline-none pt-2');
  });

  it('the shell root is a viewport-height box that does not itself scroll', () => {
    // Without this the content container would not be the thing that scrolls,
    // and its `pb-24` would buy nothing.
    expect(read('src/components/AdminDashboard.tsx')).toContain('h-[100dvh]');
    expect(SHELL_CLASS).toContain('h-[100dvh]');
    expect(SHELL_CLASS).toContain('overflow-hidden');
  });

  it('and so is the main column, which is what makes the scroller scroll', () => {
    expect(read('src/components/AdminDashboard.tsx'))
      .toContain('flex-1 flex flex-col h-[100dvh] relative bg-surface lg:bg-surface overflow-hidden min-w-0');
    expect(MAIN_COLUMN_CLASS).toContain('h-[100dvh]');
    expect(MAIN_COLUMN_CLASS).toContain('overflow-hidden');
  });

  it('the scroll container replica carries AdminDashboard\'s own bottom padding', () => {
    // 🔴 `pb-24` below `lg` is what the real shell puts between the last widget
    // and the fixed nav. If it ever moves, the clearance assertion below is
    // measuring a shell that no longer exists.
    expect(read('src/components/AdminDashboard.tsx')).toContain('overflow-y-auto pb-24 lg:pb-8');
    expect(SCROLLER_CLASS).toContain('pb-24 lg:pb-8');
  });

  it('the bottom nav replica carries the four properties that make it an obstacle', () => {
    const shell = read('src/components/AdminDashboard.tsx');
    for (const required of ['fixed', 'bottom-0', 'z-[100]', 'pb-safe']) {
      expect(shell, `the real nav no longer carries ${required}`).toContain(required);
      expect(NAV_CLASS, `the replica does not carry ${required}`).toContain(required);
    }
  });
});

/* ═══ 1 · Every widget shares its panel's left edge, at all five widths ══════ */

describe('positions and widths at 380 / 768 / 1024 / 1280 / 1440', () => {
  it.each(VIEWPORTS)('every Growth widget starts at the panel\'s left edge at %ipx', (viewport) => {
    const m = growth.get(viewport)!;
    const panel = box(m, 'panel');
    expect(m.widgets.map((w) => w.title))
      .toEqual(['Giving & growth', 'Countries and cities', 'Giving tiers']);
    for (const w of m.widgets) {
      expect(Math.abs(w.x - panel.x), `${w.title} at ${viewport}px: panel.x=${panel.x} widget.x=${w.x}`)
        .toBeLessThanOrEqual(2);
      // And it spans the panel rather than sitting in a column of it — the
      // THE-276 defect, restated for these widgets.
      expect(w.width / panel.width, `${w.title} is ${w.width}px of ${panel.width}px`).toBeGreaterThanOrEqual(0.98);
    }
  });

  it.each(VIEWPORTS)('the Giving widget starts at the panel\'s left edge at %ipx', (viewport) => {
    const m = giving.get(viewport)!;
    const panel = box(m, 'panel');
    expect(m.widgets.map((w) => w.title)).toEqual(['Top givers']);
    expect(Math.abs(m.widgets[0].x - panel.x)).toBeLessThanOrEqual(2);
    expect(m.widgets[0].width / panel.width).toBeGreaterThanOrEqual(0.98);
  });

  it.each(VIEWPORTS)('the panel is inset from the wrapper by the wrapper\'s padding and no more at %ipx', (viewport) => {
    for (const m of [growth.get(viewport)!, giving.get(viewport)!]) {
      const inset = box(m, 'panel').x - box(m, 'wrapper').x;
      expect(inset, `panel is ${inset}px from the wrapper's left edge at ${viewport}px`).toBeGreaterThanOrEqual(0);
      expect(inset).toBeLessThanOrEqual(24);
    }
  });

  it('records the measured widths across the ladder, including where width falls', () => {
    /**
     * ⚠️ Width is NOT monotonic and this is the record of it. Crossing `lg` the
     * shell takes its 289px sidebar and the wrapper loses its padding, so a
     * WIDER viewport yields a NARROWER content column. These are measured, not
     * derived; what is asserted is the relationship, not the pixel.
     */
    const widths = VIEWPORTS.map((v) => ({ viewport: v, panel: box(growth.get(v)!, 'panel').width }));
    const falls = widths.filter((w, i) => i > 0 && w.panel < widths[i - 1].panel);
    // The fall is real and expected; naming it is what makes a NEW one visible.
    expect(falls.length, `panel width falls at ${JSON.stringify(falls)}`).toBeLessThanOrEqual(2);
    // 🔴 And whatever the ordering, no desktop column may be narrower than the
    // phone's: that is the failure mode a monotonic assumption would hide.
    const phone = widths[0].panel;
    for (const w of widths.filter((x) => x.viewport >= 1024)) {
      expect(w.panel, `${w.viewport}px (${w.panel}px) is narrower than 380px (${phone}px)`)
        .toBeGreaterThanOrEqual(phone);
    }
  });
});

/* ═══ 2 · 🔴 The table scrolls inside its card ═══════════════════════════════ */

describe('the table scrolls inside its card and the page body does not move at 380px', () => {
  it('both tables really do overflow at 380px, so the assertion has something to catch', () => {
    for (const [name, m] of [['growth', growth.get(380)!], ['giving', giving.get(380)!]] as const) {
      expect(m.scrollers, `${name} has no table container`).toHaveLength(1);
      const s = m.scrollers[0];
      /**
       * 🔴 If this were false the assertions below would pass VACUOUSLY — a
       * table that fits cannot demonstrate that overflow is contained. It was
       * false once, for a real reason: the countries table's cities column
       * carried `whitespace-normal`, which made every row five lines tall and
       * the table narrow enough to fit. The primitive's `whitespace-nowrap` is
       * kept instead, and this is the assertion that noticed.
       */
      expect(s.scrollWidth, `${name}: ${s.scrollWidth} <= ${s.clientWidth}, the table fits`)
        .toBeGreaterThan(s.clientWidth);
    }
  });

  it.each(VIEWPORTS)('the overflow stays in the table\'s own scroller at %ipx', (viewport) => {
    for (const [name, m] of [['growth', growth.get(viewport)!], ['giving', giving.get(viewport)!]] as const) {
      for (const s of m.scrollers) {
        expect(s.overflowX, `${name} table container at ${viewport}px is overflow-x: ${s.overflowX}`).toBe('auto');
        // The scroller itself is never wider than the panel that holds it.
        expect(s.width, `${name}: scroller ${s.width}px in a ${box(m, 'panel').width}px panel`)
          .toBeLessThanOrEqual(box(m, 'panel').width + 1);
      }
    }
  });

  it.each(VIEWPORTS)('and the page body does not scroll sideways at %ipx', (viewport) => {
    for (const [name, m] of [['growth', growth.get(viewport)!], ['giving', giving.get(viewport)!]] as const) {
      expect(m.scrollWidth, `${name}: documentElement.scrollWidth ${m.scrollWidth} > ${viewport}`)
        .toBeLessThanOrEqual(viewport);
      expect(m.bodyScrollWidth, `${name}: body.scrollWidth ${m.bodyScrollWidth} > ${viewport}`)
        .toBeLessThanOrEqual(viewport);
    }
  });
});

/* ═══ 3 · 🔴 The last widget clears the bottom nav ═══════════════════════════ */

describe('the last widget clears the bottom nav at 380px', () => {
  it('the nav is where the shell puts it — fixed to the bottom of the viewport', () => {
    const m = growth.get(380)!;
    const nav = box(m, 'nav');
    // 800px viewport height, set by `evaluateAt`. A `fixed bottom-0` bar sits
    // against it whatever the content behind it scrolls to.
    expect(nav.bottom).toBeCloseTo(800, 0);
    expect(nav.height, `a ${nav.height}px nav is not the shell's`).toBeGreaterThan(40);
  });

  /**
   * 🔴 The vacuity guard, and it applies to the tab that can actually be
   * vacuous.
   *
   * Growth is three widgets and overflows an 800px viewport, so its clearance
   * assertion is only meaningful once the scroller has been driven to its end —
   * and a scroller that never overflowed reports itself "at its end" the moment
   * it loads, which is exactly the fixture bug this found (an unconstrained
   * main column whose content ran off the page instead of scrolling).
   *
   * ⚠️ Giving is ONE widget and does not fill the viewport, so nothing scrolls
   * there and nothing can. Its clearance assertion below is therefore weaker by
   * construction — it is a regression guard for the day that tab grows, not a
   * demonstration of the mechanism. Saying so here is better than asserting a
   * scroll that cannot happen.
   */
  it('and the Growth tab really was scrolled to its end, so the question is not vacuous', () => {
    const m = growth.get(380)!;
    expect(m.scrollerOverflowed, 'Growth fits an 800px viewport — nothing was scrolled').toBe(true);
    expect(m.scrollTop, `Growth scrolled ${m.scrollTop}px`).toBeGreaterThan(0);
    expect(m.scrolledToEnd, 'Growth did not reach the bottom of its scroller').toBe(true);

    // Giving is short enough that its last widget is above the fold outright.
    const g = giving.get(380)!;
    expect(g.scrollerOverflowed, 'Giving now overflows and needs the scroll assertion too').toBe(false);
  });

  it.each(['growth', 'giving'] as const)('the %s tab\'s last widget ends above the nav', (tab) => {
    const m = (tab === 'growth' ? growth : giving).get(380)!;
    const nav = box(m, 'nav');
    const last = m.widgets[m.widgets.length - 1];
    /**
     * 🔴 The scroll container's `pb-24` is what buys this: 96px below the last
     * widget against a ~64px bar. Asserted against the nav's MEASURED top edge
     * rather than against 96, so a nav that grew a row would fail here.
     */
    expect(last.bottom, `${tab}: "${last.title}" ends at ${last.bottom}, nav starts at ${nav.y}`)
      .toBeLessThanOrEqual(nav.y);
  });

  it('and the clearance is the shell\'s padding, not luck', () => {
    // Named so a future reader can tell a deliberate 96px from a coincidence.
    const m = growth.get(380)!;
    const last = m.widgets[m.widgets.length - 1];
    const gap = box(m, 'nav').y - last.bottom;
    expect(gap, `only ${gap}px between the last widget and the nav`).toBeGreaterThanOrEqual(16);
  });
});

/* ═══ 4 · All four palettes resolve, Classic first ═══════════════════════════ */

/**
 * ⚠️ Four palettes ship — Classic light/dark and Harvest light/dark — and
 * Classic has been the DEFAULT since #409 (`DEFAULT_PALETTE_FAMILY` in
 * `lib/theme.ts`). A hardcoded colour is the same colour in all four, so it is
 * wrong in at least three; the static guards assert none is spelled, and this
 * asserts the consequence — that what IS spelled resolves to a real, distinct
 * colour in every one of them.
 *
 * 🔴 Measured, not parsed. `the-287-roster-guards` reads `globals.css` and can
 * say a token is declared; only a browser can say the cascade actually delivers
 * it to a `<td>` inside a `<table>` inside a `<Card>` under two stacked
 * attribute selectors.
 */
const PALETTES = [
  // Classic first: it is the default.
  { name: 'Classic light', palette: 'classic', theme: 'light' },
  { name: 'Classic dark', palette: 'classic', theme: 'dark' },
  { name: 'Harvest light', palette: 'harvest', theme: 'light' },
  { name: 'Harvest dark', palette: 'harvest', theme: 'dark' },
] as const;

const PALETTE_PROBE = (palette: string, theme: string) => `(() => {
  const html = document.documentElement;
  html.setAttribute('data-palette', ${JSON.stringify(palette)});
  html.setAttribute('data-theme', ${JSON.stringify(theme)});
  html.classList.toggle('dark', ${JSON.stringify(theme)} === 'dark');
  const read = (sel, prop) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el)[prop] : null;
  };
  return {
    cardBackground: read('[data-widget="Countries and cities"]', 'backgroundColor'),
    headText: read('[data-slot="table-head"]', 'color'),
    cellText: read('[data-country-row] [data-country-members]', 'color'),
    rowBorder: read('[data-country-row]', 'borderBottomColor'),
  };
})()`;

describe('every colour resolves in all four palettes, Classic first', () => {
  const seen = new Map<string, Record<string, string | null>>();

  beforeAll(async () => {
    // ⚠️ The Giving page was the last one opened by the measurement pass, and
    // it has no countries table. Re-open Growth rather than probing selectors
    // that are not on the page — a `null` reading would otherwise look like a
    // colour that failed to resolve.
    await browser.open(growthUrl);
    for (const p of PALETTES) {
      seen.set(p.name, await browser.evaluateAt(380, PALETTE_PROBE(p.palette, p.theme), 800));
    }
  }, 60_000);

  it.each(PALETTES.map((p) => p.name))('%s resolves every colour to something paintable', (name) => {
    const probe = seen.get(name)!;
    for (const [prop, value] of Object.entries(probe)) {
      expect(value, `${name}: ${prop} did not resolve`).toBeTruthy();
      // 🔴 `transparent` is what an undeclared `var(--token)` paints. A token
      // invented by reference rather than by declaration lands here.
      expect(value, `${name}: ${prop} is ${value}`).not.toMatch(/rgba\(0, 0, 0, 0\)/);
    }
  });

  it('and light and dark are genuinely different, so the pin is not four copies', () => {
    expect(seen.get('Classic light')).not.toEqual(seen.get('Classic dark'));
    expect(seen.get('Harvest light')).not.toEqual(seen.get('Harvest dark'));
  });

  it('the card and its text are not the same colour in any palette', () => {
    // The failure a palette bug actually produces: text painted onto its own
    // background. Cheap to assert and it covers all four.
    for (const [name, probe] of seen) {
      expect(probe.cellText, `${name}: text is the card colour`).not.toBe(probe.cardBackground);
      expect(probe.headText, `${name}: heading is the card colour`).not.toBe(probe.cardBackground);
    }
  });
});
