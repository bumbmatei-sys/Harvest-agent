// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom, and this is load-bearing. Nothing in this file needs a
// DOM — the page is rendered to a string and every measurement happens inside a
// real browser. Under this repo's default happy-dom environment the globals are
// replaced with browser-semantics ones, and `fetch` to the browser's own
// debugger port fails same-origin ("Cross-Origin Request Blocked"), so the
// browser can never be attached to. `renderToStaticMarkup` and `buildAppCss`
// are both server-side and unaffected.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser, type Box, type Measurement } from '../../test/support/browser-measure';
import { DashboardTabs } from '../dashboard/DashboardTabs';
import { OverviewTab } from '../dashboard/OverviewTab';
import type { OverviewData } from '../dashboard/useOverviewData';

/**
 * THE-276-FIX — WHERE the dashboard renders, not how wide its boxes may be.
 *
 * ─── The defect these tests exist for ────────────────────────────────────────
 *
 * THE-276 shipped green with every widget in a 420px column on the RIGHT of a
 * 1044px container, the live-now strip sharing a row with the tab strip, and
 * roughly 900px of empty space to its left. `ui/tabs.tsx` styled its root with
 * `data-horizontal:flex-col`, which Tailwind compiles to `[data-horizontal]`,
 * while the installed Base UI emits `data-orientation="horizontal"`. The rule
 * never matched, the root stayed a flex ROW, and the panel's `flex-1` made it a
 * second column beside the list.
 *
 * 🔴 WHY THE SUITE COULD NOT SEE IT. Every layout guard in this repo measures
 * WIDTHS from class names — `class-inventory.ts` turns `max-w-6xl` into 1044px
 * and the tests do arithmetic on it. A 420px column inside a 1044px container
 * overflows nothing and declares no fixed width, so "no horizontal overflow at
 * any width" was TRUE and useless. The missing question was POSITION.
 *
 * ⚠️ THE-276's own per-column figures (380→308, 768→342, 1024→168.1,
 * 1280→232.1, 1440→252) were computed against the `max-w-6xl` WRAPPER on the
 * assumption the grid filled it. The wrapper was 1044px; the grid inside it was
 * 420px. The numbers described the container, never the element — which is why
 * they are re-derived here by measurement instead of arithmetic.
 *
 * ─── How position is asserted ────────────────────────────────────────────────
 *
 * In a real browser, over CDP, with no npm dependency — see
 * `test/support/browser-measure.ts` for why not Playwright and why a missing
 * browser fails rather than skips.
 *
 * 🔴 EVERY ASSERTION IS RELATIVE — panel against list, grid against wrapper,
 * strip against list. `AdminDashboard.tsx` may not be opened by this ticket, so
 * the shell around the dashboard is approximated; making the assertions
 * relative is what stops that approximation from being load-bearing. The one
 * absolute number below (the sidebar spacer) is the width observed in the bug
 * report, and no assertion depends on it.
 */

/** The ladder, unchanged from THE-276 — now measured rather than derived. */
const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

/** Fully-loaded, everything-readable data, so no widget is in an empty state. */
const POINTS = Array.from({ length: 8 }, (_, i) => ({ label: `W${i}`, value: (i + 1) * 3 }));
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
} as unknown as OverviewData;

const SELECTORS = {
  wrapper: '[data-dashboard-measure]',
  tabsRoot: '[data-slot="tabs"]',
  list: '[data-slot="tabs-list"]',
  panel: '[data-slot="tabs-content"]',
  strip: '[data-live-strip]',
  kpiGrid: '[data-kpi-grid]',
} as const;

let browser: MeasuringBrowser;
const measured = new Map<number, Measurement>();

beforeAll(async () => {
  const css = await buildAppCss();
  const body = renderToStaticMarkup(
    <div className="flex">
      {/*
        The admin shell, approximated. `AdminDashboard.tsx` is THE-277's and this
        ticket may not open it, so the sidebar is a spacer at the width the bug
        report observed (0–289px), gated at `lg` where the shell becomes desktop.
        No assertion reads this number.
      */}
      <div className="hidden lg:block w-[289px] shrink-0" />
      <div className="min-w-0 flex-1">
        {/* AdminDashboardHome's own wrapper, class for class. */}
        <div data-dashboard-measure className="w-full max-w-6xl mx-auto space-y-6 p-4 lg:p-0">
          <div>Good morning.</div>
          <DashboardTabs overview={<OverviewTab data={READY} unreadCount={0} showInbox={false} />} />
        </div>
      </div>
    </div>,
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the276-'));
  const file = path.join(dir, 'dashboard.html');
  writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`);

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);
  for (const viewport of VIEWPORTS) measured.set(viewport, await browser.measure(viewport, SELECTORS));
}, 120_000);

afterAll(async () => { await browser?.close(); });

const at = (viewport: number) => measured.get(viewport)!;
const box = (viewport: number, name: keyof typeof SELECTORS): Box => {
  const found = at(viewport).boxes[name];
  if (!found) throw new Error(`${name} did not render at ${viewport}px`);
  return found;
};

/* ═══ 1 · The bug ════════════════════════════════════════════════════════════ */

describe("the tab panel's left edge aligns with the tab list's left edge", () => {
  it.each(VIEWPORTS)('at %ipx', (viewport) => {
    const list = box(viewport, 'list');
    const panel = box(viewport, 'panel');
    // 🔴 Before the fix these differed by ~628px: the list ended at x=1202 and
    // the panel began at x=1205, because they were siblings in a flex ROW.
    expect(Math.abs(panel.x - list.x), `list.x=${list.x} panel.x=${panel.x}`).toBeLessThanOrEqual(2);
  });

  it.each(VIEWPORTS)('and the tabs root stacks its children at %ipx', (viewport) => {
    const root = box(viewport, 'tabsRoot');
    // The mechanism, named. A row here is the defect, whatever the boxes say.
    expect(root.display).toBe('flex');
    expect(root.flexDirection, `tabs root is a flex ${root.flexDirection}`).toBe('column');
  });
});

/* ═══ 2 · The panel is the content column, not a sliver of it ════════════════ */

describe('the panel occupies most of the available content width, not a fifth of it', () => {
  it.each(VIEWPORTS)('at %ipx', (viewport) => {
    const wrapper = box(viewport, 'wrapper');
    const panel = box(viewport, 'panel');
    const fraction = panel.width / wrapper.width;
    // Before the fix this was 420/1044 = 0.40 at 1917px. The floor is set well
    // above that and well below 1, so padding or a border cannot trip it.
    expect(fraction, `panel ${panel.width}px of wrapper ${wrapper.width}px = ${(fraction * 100).toFixed(1)}%`)
      .toBeGreaterThanOrEqual(0.9);
  });
});

/* ═══ 3 · The strip is below the tabs, not beside them ═══════════════════════ */

describe('the live-now strip is not on the same row as the tab list', () => {
  it.each(VIEWPORTS)('at %ipx', (viewport) => {
    const list = box(viewport, 'list');
    const strip = box(viewport, 'strip');
    // Strictly below: the strip's top edge is at or past the list's bottom.
    expect(strip.y, `list.bottom=${list.bottom} strip.y=${strip.y}`).toBeGreaterThanOrEqual(list.bottom);
    // And it spans the column rather than sharing it.
    expect(strip.x).toBeCloseTo(list.x, 0);
  });
});

/* ═══ 4 · The grid starts where the content starts ═══════════════════════════ */

describe("the KPI grid starts at the content area's left edge", () => {
  it.each(VIEWPORTS)('at %ipx', (viewport) => {
    const wrapper = box(viewport, 'wrapper');
    const grid = box(viewport, 'kpiGrid');
    // The wrapper carries `p-4` below `lg` and `lg:p-0` above it, so the grid
    // is inset by the padding and no more.
    const inset = grid.x - wrapper.x;
    expect(inset, `grid is ${inset}px from the wrapper's left edge`).toBeGreaterThanOrEqual(0);
    expect(inset).toBeLessThanOrEqual(24);
  });
});

/* ═══ 5 · Position, at every width on the ladder ═════════════════════════════ */

describe('position is correct at 380 / 768 / 1024 / 1280 / 1440', () => {
  it('every widget in the panel shares the panel\'s left edge', () => {
    for (const viewport of VIEWPORTS) {
      const panel = box(viewport, 'panel');
      for (const name of ['strip', 'kpiGrid'] as const) {
        const el = box(viewport, name);
        expect(Math.abs(el.x - panel.x), `${name} at ${viewport}px: panel.x=${panel.x} ${name}.x=${el.x}`)
          .toBeLessThanOrEqual(2);
      }
    }
  });

  it('the KPI cards are laid out left to right from the panel edge, and are re-measured here', () => {
    // ⚠️ These are MEASURED, replacing THE-276's arithmetic. Recorded as a
    // range rather than exact pixels: this fixture approximates the shell, so
    // the absolute numbers depend on it while the relationships do not.
    for (const viewport of VIEWPORTS) {
      const cards = at(viewport).kpiCards;
      expect(cards, `no KPI cards at ${viewport}px`).toHaveLength(7);
      const panel = box(viewport, 'panel');
      expect(Math.abs(cards[0].x - panel.x)).toBeLessThanOrEqual(2);
      // Every card is wide enough to hold a label, a number and a sparkline.
      for (const card of cards) expect(card.width, `${viewport}px: a ${card.width}px card`).toBeGreaterThanOrEqual(120);
    }
  });

  it('the panel is never narrower than the phone it already renders on', () => {
    // The non-monotonicity guard, restated as a measurement: crossing `lg` the
    // shell takes the sidebar, so a wider viewport can yield a narrower column.
    // Whatever the ordering, no desktop column may be narrower than 380px's.
    const phone = box(380, 'panel').width;
    for (const viewport of VIEWPORTS.filter((v) => v >= 1024)) {
      expect(box(viewport, 'panel').width, `${viewport}px is narrower than 380px`).toBeGreaterThanOrEqual(phone);
    }
  });
});

/* ═══ 6 · No-regression: the old claim still holds ═══════════════════════════ */

describe('no horizontal overflow at any of the five widths', () => {
  it.each(VIEWPORTS)('at %ipx the document does not scroll sideways', (viewport) => {
    const { scrollWidth } = at(viewport);
    // 🔴 True before the fix as well — which is the point. It is kept as a
    // no-regression guard, not as evidence that the layout is right.
    expect(scrollWidth, `scrollWidth ${scrollWidth} > viewport ${viewport}`).toBeLessThanOrEqual(viewport);
  });

  it('and the tab strip still scrolls inside its own box rather than widening the page', () => {
    // Six labels do not fit a 380px phone; the overflow must stay in the scroller.
    const list = box(380, 'list');
    const panel = box(380, 'panel');
    expect(list.width).toBeGreaterThan(panel.width);
    expect(at(380).scrollWidth).toBeLessThanOrEqual(380);
  });
});
