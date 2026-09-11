// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom — the same reason THE-276-FIX's position test gives.
// Nothing here needs a DOM: the page is rendered to a string and every
// measurement happens inside a real browser over CDP. Under happy-dom the
// globals carry browser semantics and a request to the browser's own debugger
// port fails same-origin, so the browser could never be attached to.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { setUpOrFail } from '../../test/support/suite-setup';
import { GrowthTab } from '../dashboard/GrowthTab';
import { RETENTION_MONTHS, type RetentionGrid } from '../dashboard/retention-data';
import type { GrowthData } from '../dashboard/useGrowthData';
import type { OverviewData } from '../dashboard/useOverviewData';

/**
 * THE-299 — WHERE the retention heatmap renders, measured in Chromium.
 *
 * ─── Why this is measured and not reasoned about ─────────────────────────────
 *
 * 🔴 happy-dom HAS NO LAYOUT ENGINE. `getBoundingClientRect()` returns zeros on
 * every element and `getComputedStyle` answers `display: block` for a flex
 * container, even with the real compiled stylesheet injected. THE-276 shipped
 * green with every widget in a 420px column because every layout guard in this
 * repo reasons about CLASS NAMES.
 *
 * ⚠️ WIDTH IS NOT MONOTONIC on this screen and the ladder is measured whole
 * because of it — THE-276 found a 4px page overflow at 1024 and 1280 ONLY, and
 * #426 measured a card falling twice with its narrowest point at 1280.
 *
 * ─── 🔴 The property that matters at 380px ───────────────────────────────────
 *
 * Twelve periods plus a cohort gutter and a member-count gutter is 644px, and
 * a phone is 380px. The wrong fix is to let that overflow reach the page:
 * horizontal body scroll makes every other widget drift under the thumb, and
 * #422 established the pattern that says it must not. #429 made the assertion
 * non-vacuous by requiring the scroller to genuinely overflow — a grid that
 * happened to fit would prove nothing about where its overflow would have gone.
 * Both halves are asserted below.
 *
 * 🔴 AND THE GRID IS NOT NARROWED ON MOBILE. Twelve periods at 380px is the
 * same twelve periods as at 1440px; dropping columns below `lg` would make a
 * phone and a desktop answer the same question differently, which is a worse
 * failure than a scrollbar.
 *
 * ⚠️ THE-295: two `MeasuringBrowser` instances in one process collide on a
 * PID-derived debugger port and silently compare a page with itself. This file
 * opens exactly one, and vitest gives each test file its own worker process.
 */

const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

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

/**
 * A FULL grid — twelve cohorts, the oldest with all twelve periods observed,
 * and four-digit member counts.
 *
 * ⚠️ Deliberately the widest case the widget can ever be asked to draw. A
 * fixture with three cohorts and two periods would fit a phone and the overflow
 * assertions would pass while measuring nothing. Cohort sizes run to 1,240 so
 * the member-count gutter is exercised at its real width too.
 */
const RETENTION: RetentionGrid = {
  periods: RETENTION_MONTHS,
  rows: Array.from({ length: RETENTION_MONTHS }, (_, row) => {
    const observed = RETENTION_MONTHS - row;
    return {
      key: `2025-${String(row + 1).padStart(2, '0')}`,
      label: `${['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'][row]} 202${row < 4 ? 5 : 6}`,
      members: 1240 - row * 87,
      active: Array.from({ length: RETENTION_MONTHS }, (_, p) => (p < observed ? Math.max(0, 900 - p * 70 - row * 9) : null)),
      retained: Array.from({ length: RETENTION_MONTHS }, (_, p) => (p < observed ? Math.max(0, 100 - p * 8.5 - row * 1.1) : null)),
    };
  }),
  overall: Array.from({ length: RETENTION_MONTHS }, (_, p) => Math.max(0, 100 - p * 8)),
  membersTotal: 9_412,
  membersInWindow: 8_930,
  membersBeforeWindow: 401,
  membersAfterWindow: 74,
  membersUndated: 7,
  activitiesRead: 1_000,
  activitiesAttributed: 812,
  activitiesNotAMember: 173,
  activitiesUnresolved: 12,
  activitiesUndated: 3,
};

const GROWTH = {
  loading: false,
  locationReason: null,
  retention: RETENTION,
  retentionReason: null,
  locations: {
    total: 240,
    withCountry: 208,
    withCity: 171,
    countryUnrecorded: 32,
    rows: [
      { country: 'United Kingdom of Great Britain and Northern Ireland', members: 54, citiesUnrecorded: 6,
        cities: [{ city: 'Kingston upon Thames', members: 24 }, { city: 'Newcastle upon Tyne', members: 14 }] },
      { country: 'Democratic Republic of the Congo', members: 41, citiesUnrecorded: 5,
        cities: [{ city: 'Kinshasa', members: 21 }, { city: 'Lubumbashi', members: 15 }] },
      { country: 'Kenya', members: 33, citiesUnrecorded: 3, cities: [{ city: 'Nairobi', members: 20 }] },
    ],
  },
} as unknown as GrowthData;

const SELECTORS = {
  wrapper: '[data-dashboard-measure]',
  growth: '[data-growth-tab]',
  heatmapCard: '[data-widget="Retention cohorts"]',
  heatmapInner: '[data-retention-heatmap]',
  scroller: '[data-retention-scroller]',
  grid: '[data-retention-grid]',
  legend: '[data-retention-legend]',
  coverage: '[data-retention-coverage]',
  tableCard: '[data-widget="Countries & cities"]',
  deferredGrid: '[data-deferred-grid]',
} as const;

interface Reading {
  viewport: number;
  docScrollWidth: number;
  bodyScrollWidth: number;
  boxes: Record<string, { x: number; width: number; right: number; top: number; bottom: number } | null>;
  scroller: { clientWidth: number; scrollWidth: number; overflowX: string; overflowY: string } | null;
  cells: number;
  columns: number;
  positioned: string[];
}

let browser: MeasuringBrowser;
const readings = new Map<number, Reading>();

setUpOrFail(async () => {
  const css = await buildAppCss();
  const body = renderToStaticMarkup(
    <div className="flex">
      {/*
        The admin shell, approximated exactly as THE-283's layout test
        approximates it: `AdminDashboard.tsx` is THE-277's and may not be
        opened, so the sidebar is a spacer at the observed width, gated at `lg`.
        🔴 No assertion below reads this number — every claim is relative or is
        about overflow, so the approximation is not load-bearing.
      */}
      <div className="hidden lg:block w-[289px] shrink-0" />
      <div className="min-w-0 flex-1">
        {/* AdminDashboardHome's own wrapper, class for class. */}
        <div data-dashboard-measure className="w-full max-w-6xl mx-auto space-y-6 p-4 lg:p-0">
          <div>Good morning.</div>
          {/*
            ⚠️ The Growth panel is rendered directly rather than through
            `DashboardTabs`: this page is STATIC markup with no React attached,
            so clicking a trigger would do nothing and Base UI mounts only the
            ACTIVE panel. What is measured is the panel's CONTENT against the
            shell, which is unaffected by which trigger is styled active.
          */}
          <GrowthTab data={READY} growth={GROWTH} />
        </div>
      </div>
    </div>,
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the299-'));
  const file = path.join(dir, 'retention.html');
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const viewport of VIEWPORTS) {
    const reading = await browser.evaluateAt<Reading>(viewport, `(() => {
      const sel = ${JSON.stringify(SELECTORS)};
      const box = (el) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x, width: b.width, right: b.right, top: b.top, bottom: b.bottom };
      };
      const boxes = {};
      for (const k of Object.keys(sel)) boxes[k] = box(document.querySelector(sel[k]));
      const scrollerEl = document.querySelector(sel.scroller);
      const heatmap = document.querySelector(sel.heatmapInner);
      const positioned = heatmap
        ? [...heatmap.querySelectorAll('*')]
            .filter((el) => !el.closest('.sr-only'))
            .map((el) => el.tagName.toLowerCase() + ':' + getComputedStyle(el).position)
            .filter((p) => /:(fixed|sticky|absolute)$/.test(p))
        : [];
      const firstRow = document.querySelector('[data-retention-row]');
      return {
        viewport: window.innerWidth,
        docScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        boxes,
        scroller: scrollerEl ? {
          clientWidth: scrollerEl.clientWidth,
          scrollWidth: scrollerEl.scrollWidth,
          overflowX: getComputedStyle(scrollerEl).overflowX,
          overflowY: getComputedStyle(scrollerEl).overflowY,
        } : null,
        cells: document.querySelectorAll('[data-retention-cell]').length,
        columns: firstRow ? firstRow.querySelectorAll('[data-retention-cell]').length : 0,
        positioned,
      };
    })()`);
    readings.set(viewport, reading);
  }
}, 180_000);

afterAll(async () => { await browser?.close(); });

const at = (viewport: number) => readings.get(viewport)!;
const box = (viewport: number, name: keyof typeof SELECTORS) => {
  const found = at(viewport).boxes[name];
  if (!found) throw new Error(`${name} did not render at ${viewport}px`);
  return found;
};

/* ═══ 🔴 The page body never scrolls sideways ═══════════════════════════════ */

describe('the grid scrolls inside its card and the page body does not move at 380px', () => {
  it.each(VIEWPORTS)('the page has no horizontal overflow at %ipx', (viewport) => {
    const r = at(viewport);
    expect(r.docScrollWidth, `documentElement overflows at ${viewport}px`).toBeLessThanOrEqual(viewport);
    expect(r.bodyScrollWidth, `body overflows at ${viewport}px`).toBeLessThanOrEqual(viewport);
  });

  /**
   * 🔴 AND THE GRID IS REACHABLE, not merely off the page.
   *
   * ⚠️ `ui/card` carries `overflow-hidden`, so the page-overflow assertions
   * above are NOT the whole guard here: delete `overflow-x-auto` and the card
   * clips the grid instead, the page still measures clean, and 264px of the
   * chart is silently unreachable at 380px. That is the failure mode this
   * assertion exists for — `overflowX` must be `auto` on the element that
   * overflows, which is what turns a clipped chart into a scrollable one.
   * Verified by mutation: removing the class fails exactly here.
   */
  it('🔴 the grid genuinely overflows at 380px — the assertion above is not vacuous', () => {
    const scroller = at(380).scroller!;
    expect(scroller.overflowX).toBe('auto');
    // If this were false, "the page does not scroll" would be measuring a grid
    // that fits, which proves nothing about where its overflow would have gone.
    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
    // 644px of grid against a 380px phone, less the card and page padding.
    expect(scroller.scrollWidth - scroller.clientWidth).toBeGreaterThan(200);
    // Every pixel of the grid is inside the scroller's scroll range.
    expect(scroller.scrollWidth).toBeGreaterThanOrEqual(Math.round(box(380, 'grid').width));
  });

  it('and the overflow is absorbed by the scroller, not passed up to the card', () => {
    const scroller = at(380).scroller!;
    const card = box(380, 'heatmapCard');
    expect(scroller.clientWidth).toBeLessThanOrEqual(Math.ceil(card.width));
    expect(at(380).docScrollWidth).toBeLessThanOrEqual(380);
  });

  it('the scroller sits inside its card at every width, never wider than it', () => {
    for (const viewport of VIEWPORTS) {
      const card = box(viewport, 'heatmapCard');
      const inner = box(viewport, 'heatmapInner');
      expect(inner.x, `${viewport}: content starts left of its card`).toBeGreaterThanOrEqual(card.x - 1);
      expect(inner.right, `${viewport}: content ends right of its card`).toBeLessThanOrEqual(card.right + 1);
    }
  });

  /**
   * ⚠️ `overflow-x-auto` computes `overflow-y` to `auto` as well, which is what
   * clipped the tab strip's active underline in THE-276-FIX. Here it is
   * harmless — the SVG is exactly as tall as the box — and this asserts the
   * scroller has not grown a vertical scrollbar it does not need.
   */
  it('the scroller does not also scroll vertically', () => {
    for (const viewport of VIEWPORTS) {
      const scroller = at(viewport).scroller!;
      expect(scroller.overflowY, `${viewport}px`).toBe('auto');
    }
  });
});

/* ═══ 🔴 The same twelve columns at every width ═════════════════════════════ */

describe('the grid is not narrowed on mobile', () => {
  it('🔴 twelve cohort rows and twelve columns on the oldest, at every viewport', () => {
    for (const viewport of VIEWPORTS) {
      const r = at(viewport);
      // The triangle: 12 + 11 + … + 1 cells are drawn, and the newest cohort's
      // unobserved periods draw nothing at all.
      expect(r.cells, `${viewport}px drew ${r.cells} cells`)
        .toBe((RETENTION_MONTHS * (RETENTION_MONTHS + 1)) / 2);
      expect(r.columns, `${viewport}px: the oldest cohort lost columns`).toBe(RETENTION_MONTHS);
    }
  });

  it('the grid is the same width at every viewport — geometry is fixed, not measured', () => {
    const widths = VIEWPORTS.map((v) => Math.round(box(v, 'grid').width));
    expect(new Set(widths).size, `the grid measured ${widths.join(', ')}`).toBe(1);
    // 88 + 52 + 12 × 42 = 644.
    expect(widths[0]).toBe(644);
  });
});

/* ═══ 🔴 Positions and widths at all five viewports ═════════════════════════ */

describe('positions and widths at all five viewports', () => {
  /**
   * 🔴 THE-276's defect in one assertion: a widget that landed in a 420px column
   * inside a 1044px wrapper while every class-name guard stayed green.
   *
   * ⚠️ The claim is RELATIVE — the heatmap is exactly as wide as the countries
   * table stacked above it — rather than "as wide as the wrapper". The wrapper
   * carries `p-4 lg:p-0`, so a wrapper-width comparison would be off by 32px
   * below `lg` and would have to be written with a padding constant in it: a
   * number that silently stops meaning anything the day the padding changes.
   * Both cards are full-width siblings in the same stack, and that is the
   * property worth asserting.
   */
  it('the heatmap card spans the content column at every width', () => {
    for (const viewport of VIEWPORTS) {
      const wrapper = box(viewport, 'wrapper');
      const table = box(viewport, 'tableCard');
      const card = box(viewport, 'heatmapCard');
      expect(Math.round(card.width), `${viewport}px: the card is not as wide as its sibling`)
        .toBe(Math.round(table.width));
      expect(Math.round(card.x), `${viewport}px: the card is inset from its sibling`)
        .toBe(Math.round(table.x));
      expect(card.x).toBeGreaterThanOrEqual(wrapper.x - 1);
      expect(card.right).toBeLessThanOrEqual(wrapper.right + 1);
      // And it is a column, not a sliver: THE-276 shipped 420px inside 1044px.
      expect(card.width, `${viewport}px: the card is only ${card.width}px wide`)
        .toBeGreaterThan(wrapper.width * 0.85);
    }
  });

  it('it sits below the countries table and above the deferred pair', () => {
    for (const viewport of VIEWPORTS) {
      const table = box(viewport, 'tableCard');
      const card = box(viewport, 'heatmapCard');
      const deferred = box(viewport, 'deferredGrid');
      expect(card.top, `${viewport}px: the heatmap is not below the table`).toBeGreaterThan(table.top);
      expect(deferred.top, `${viewport}px: the deferred pair is not below the heatmap`)
        .toBeGreaterThan(card.top);
    }
  });

  it('the legend and the coverage line stay inside the card and never overflow it', () => {
    for (const viewport of VIEWPORTS) {
      const card = box(viewport, 'heatmapCard');
      for (const part of ['legend', 'coverage'] as const) {
        const el = box(viewport, part);
        expect(el.x, `${viewport}px: ${part} starts outside the card`).toBeGreaterThanOrEqual(card.x - 1);
        expect(el.right, `${viewport}px: ${part} ends outside the card`).toBeLessThanOrEqual(card.right + 1);
      }
    }
  });

  /**
   * 🔴 THE BOTTOM NAV IS `fixed bottom-0` AT `z-[100]`, and `pb-safe` is fixed
   * for the MEMBER shell (#437) while the ADMIN shell still carries the inert
   * class. This widget's clearance is therefore made explicit rather than
   * inherited: it introduces NO fixed, sticky or absolute positioning and no
   * stacking context of its own, so it is ordinary flow content inside the
   * page's own padding and cannot be the thing that lands under the nav. It is
   * also not the last element on the tab — the deferred pair is below it.
   */
  it('🔴 the widget positions nothing — it cannot collide with the fixed bottom nav', () => {
    for (const viewport of VIEWPORTS) {
      expect(at(viewport).positioned, `${viewport}px: the heatmap positions an element`).toEqual([]);
    }
  });
});
