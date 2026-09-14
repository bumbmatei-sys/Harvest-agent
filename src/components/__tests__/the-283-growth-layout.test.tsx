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
import { DashboardTabs } from '../dashboard/DashboardTabs';
import { GrowthTab } from '../dashboard/GrowthTab';
import { OverviewTab } from '../dashboard/OverviewTab';
import type { GrowthData } from '../dashboard/useGrowthData';
import type { OverviewData } from '../dashboard/useOverviewData';

/**
 * THE-283 — WHERE the Growth tab renders, measured in Chromium.
 *
 * ─── Why this is measured and not reasoned about ─────────────────────────────
 *
 * 🔴 happy-dom HAS NO LAYOUT ENGINE. `getBoundingClientRect()` returns zeros on
 * every element and `getComputedStyle` answers `display: block` for a flex
 * container, even with the real compiled stylesheet injected. THE-276 shipped
 * green with every widget in a 420px column because every layout guard in this
 * repo reasons about CLASS NAMES. A table is exactly the element that punishes
 * that: whether it overflows depends on its CONTENT, which no class name knows.
 *
 * ⚠️ WIDTH IS NOT MONOTONIC on this screen and the ladder is measured whole
 * because of it — THE-276 found a 4px page overflow at 1024 and 1280 ONLY, and
 * #426 measured a card falling twice with its narrowest point at 1280. A test
 * that checked the phone and the desktop would have missed both.
 *
 * ─── The property that matters at 380px ──────────────────────────────────────
 *
 * 🔴 A TABLE MUST SCROLL INSIDE ITS OWN CARD. A three-column table with real
 * country and city names is wider than a 380px phone, and the wrong fix is to
 * let that overflow reach the page: horizontal body scroll makes every other
 * widget on the tab drift under the thumb. `ui/table` wraps every table in an
 * `overflow-x-auto` container, and this asserts that the container is the thing
 * that scrolls — the table genuinely overflows it, and `documentElement`
 * does not overflow at all. THE-422 established the pattern; this measures it.
 */

const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

const POINTS = Array.from({ length: 8 }, (_, i) => ({ label: `W${i}`, value: (i + 1) * 3 }));

/** Overview data, complete everywhere, so the shared trend is in its ready state. */
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
  givingSeriesCents: { kind: 'complete', points: POINTS },
  submissionSeries: { kind: 'complete', points: POINTS },
  invoiceRows: [{ amountCents: 25000, issuedAt: null, type: 'donation_receipt' }],
  invoiceReason: null,
  liveNow: { active: false, title: 'Live now' },
} as unknown as OverviewData;

/**
 * A breakdown with LONG real place names and many rows.
 *
 * ⚠️ Deliberately hostile: "United Kingdom of Great Britain and Northern
 * Ireland" is a country a member can genuinely type, and a table sized against
 * "Kenya" would pass a test it should fail. Twelve rows also puts the list past
 * the point where the card scrolls vertically.
 */
const GROWTH = {
  loading: false,
  locationReason: null,
  /*
   * ⚠️ ADDED BY THE-299, which put a retention heatmap on this tab. Explicitly
   * REFUSED rather than left off the object: an omitted field arrives as
   * `undefined`, and a fixture that quietly renders a widget's loading skeleton
   * forever would be measuring a spinner. The heatmap's own layout is measured
   * in `the-299-retention-layout.test.tsx`; what matters here is only that this
   * tab's other widgets still land where they landed.
   */
  retention: null,
  retentionReason: 'Not measured on this page.',
  locations: {
    total: 240,
    withCountry: 208,
    withCity: 171,
    countryUnrecorded: 32,
    rows: [
      { country: 'United Kingdom of Great Britain and Northern Ireland', members: 54, citiesUnrecorded: 6,
        cities: [{ city: 'Kingston upon Thames', members: 24 }, { city: 'Newcastle upon Tyne', members: 14 }, { city: 'Stratford-upon-Avon', members: 10 }] },
      { country: 'Democratic Republic of the Congo', members: 41, citiesUnrecorded: 5,
        cities: [{ city: 'Kinshasa', members: 21 }, { city: 'Lubumbashi', members: 15 }] },
      { country: 'Kenya', members: 33, citiesUnrecorded: 3, cities: [{ city: 'Nairobi', members: 20 }, { city: 'Mombasa', members: 10 }] },
      { country: 'United States of America', members: 22, citiesUnrecorded: 2, cities: [{ city: 'San Francisco', members: 12 }, { city: 'Minneapolis', members: 8 }] },
      { country: 'Uganda', members: 14, citiesUnrecorded: 1, cities: [{ city: 'Kampala', members: 13 }] },
      { country: 'Nigeria', members: 12, citiesUnrecorded: 0, cities: [{ city: 'Lagos', members: 12 }] },
      { country: 'Tanzania', members: 9, citiesUnrecorded: 0, cities: [{ city: 'Dar es Salaam', members: 9 }] },
      { country: 'South Africa', members: 8, citiesUnrecorded: 1, cities: [{ city: 'Johannesburg', members: 7 }] },
      { country: 'Ghana', members: 6, citiesUnrecorded: 0, cities: [{ city: 'Accra', members: 6 }] },
      { country: 'Rwanda', members: 4, citiesUnrecorded: 0, cities: [{ city: 'Kigali', members: 4 }] },
      { country: 'Zambia', members: 3, citiesUnrecorded: 0, cities: [{ city: 'Lusaka', members: 3 }] },
      { country: 'Malawi', members: 2, citiesUnrecorded: 0, cities: [{ city: 'Lilongwe', members: 2 }] },
    ],
  },
} as unknown as GrowthData;

const SELECTORS = {
  wrapper: '[data-dashboard-measure]',
  list: '[data-slot="tabs-list"]',
  panel: '[data-slot="tabs-content"]',
  growth: '[data-growth-tab]',
  trend: '[data-widget="Member growth"]',
  tableCard: '[data-widget="Countries & cities"]',
  tableInner: '[data-location-table]',
  tableScroller: '[data-slot="table-container"]',
  deferredGrid: '[data-deferred-grid]',
} as const;

interface Reading {
  viewport: number;
  docScrollWidth: number;
  bodyScrollWidth: number;
  boxes: Record<string, { x: number; width: number; right: number } | null>;
  scroller: { clientWidth: number; scrollWidth: number; overflowX: string } | null;
  deferredCards: number;
  deferredTop: number[];
}

let browser: MeasuringBrowser;
const readings = new Map<number, Reading>();

setUpOrFail(async () => {
  const css = await buildAppCss();
  const body = renderToStaticMarkup(
    <div className="flex">
      {/*
        The admin shell, approximated exactly as THE-276-FIX's position test
        approximates it: `AdminDashboard.tsx` is THE-277's and may not be opened,
        so the sidebar is a spacer at the width the bug report observed, gated at
        `lg`. 🔴 No assertion below reads this number — every claim is either
        relative or about overflow, so the approximation is not load-bearing.
      */}
      <div className="hidden lg:block w-[289px] shrink-0" />
      <div className="min-w-0 flex-1">
        {/* AdminDashboardHome's own wrapper, class for class. */}
        <div data-dashboard-measure className="w-full max-w-6xl mx-auto space-y-6 p-4 lg:p-0">
          <div>Good morning.</div>
          <DashboardTabs
            overview={<OverviewTab data={READY} unreadCount={0} showInbox={false} />}
            growth={<GrowthTab data={READY} growth={GROWTH} />}
          />
        </div>
      </div>
    </div>,
  );

  /*
   * ⚠️ Base UI mounts only the ACTIVE panel, and this page is STATIC markup with
   * no React attached — clicking the Growth trigger would do nothing. So the
   * Growth panel is rendered as the page's only panel instead: the markup below
   * is what `DashboardTabs` emits for it, in the same wrapper, with the same
   * classes. What is being measured is the panel's CONTENT against the shell,
   * which is unaffected by which trigger is styled active.
   */
  const growthOnly = body.replace(
    /(<div[^>]*data-slot="tabs-content"[\s\S]*?>)[\s\S]*(<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>)$/,
    (_m, open: string, close: string) =>
      `${open}${renderToStaticMarkup(<GrowthTab data={READY} growth={GROWTH} />)}${close}`,
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the283-'));
  const file = path.join(dir, 'growth.html');
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${growthOnly}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const viewport of VIEWPORTS) {
    const reading = await browser.evaluateAt<Reading>(viewport, `(() => {
      const sel = ${JSON.stringify(SELECTORS)};
      const box = (el) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x, width: b.width, right: b.right };
      };
      const boxes = {};
      for (const k of Object.keys(sel)) boxes[k] = box(document.querySelector(sel[k]));
      const scrollerEl = document.querySelector(sel.tableScroller);
      const deferred = [...document.querySelectorAll('[data-deferred-grid] > *')];
      return {
        viewport: window.innerWidth,
        docScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        boxes,
        scroller: scrollerEl ? {
          clientWidth: scrollerEl.clientWidth,
          scrollWidth: scrollerEl.scrollWidth,
          overflowX: getComputedStyle(scrollerEl).overflowX,
        } : null,
        deferredCards: deferred.length,
        deferredTop: deferred.map((el) => Math.round(el.getBoundingClientRect().top)),
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

/* ═══ 8 · 🔴 The table scrolls inside its card; the page body does not move ══ */

describe('the table scrolls inside its card and the page body does not move at 380px', () => {
  it.each(VIEWPORTS)('the page has no horizontal overflow at %ipx', (viewport) => {
    const r = at(viewport);
    // 🔴 The whole property, in one number. THE-276's negative margin put 4px
    // of scroll here at 1024 and 1280 only, which is why all five are asserted
    // and not just the phone.
    expect(r.docScrollWidth, `documentElement overflows at ${viewport}px`).toBeLessThanOrEqual(viewport);
    expect(r.bodyScrollWidth, `body overflows at ${viewport}px`).toBeLessThanOrEqual(viewport);
  });

  it('the table genuinely overflows at 380px — the fixture is wide enough to prove it', () => {
    const scroller = at(380).scroller!;
    expect(scroller.overflowX).toBe('auto');
    // If this were false the test above would be vacuous: a table that fits
    // proves nothing about where its overflow would have gone.
    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
  });

  it('and the overflow is absorbed by the scroller, not passed up to the card', () => {
    const scroller = at(380).scroller!;
    const card = box(380, 'tableCard');
    // The scroller's visible width fits inside the card; only its scrollWidth
    // exceeds it. That is what "scrolls inside its own card" means.
    expect(scroller.clientWidth).toBeLessThanOrEqual(Math.ceil(card.width));
    expect(at(380).docScrollWidth).toBeLessThanOrEqual(380);
  });

  it('the scroller is inside the card at every width, never wider than it', () => {
    for (const viewport of VIEWPORTS) {
      const card = box(viewport, 'tableCard');
      const inner = box(viewport, 'tableInner');
      expect(inner.x, `${viewport}: table starts left of its card`).toBeGreaterThanOrEqual(card.x - 1);
      expect(inner.right, `${viewport}: table ends right of its card`).toBeLessThanOrEqual(card.right + 1);
    }
  });
});

/* ═══ 9 · 🔴 Positions and widths at all five viewports ══════════════════════ */

describe('positions and widths at all five viewports', () => {
  it.each(VIEWPORTS)('the Growth panel aligns with the tab list at %ipx', (viewport) => {
    // Relative, like THE-276-FIX's assertions, so the approximated shell around
    // it is never load-bearing.
    const panel = box(viewport, 'panel');
    const growth = box(viewport, 'growth');
    expect(Math.abs(growth.x - panel.x), `${viewport}px`).toBeLessThanOrEqual(1);
    expect(growth.width).toBeGreaterThan(0);
  });

  it.each(VIEWPORTS)('every widget spans the panel at %ipx — none is a narrow column', (viewport) => {
    const growth = box(viewport, 'growth');
    for (const name of ['trend', 'tableCard'] as const) {
      const widget = box(viewport, name);
      // 🔴 THE-276's defect was a widget at 420px inside a 1044px container,
      // which overflowed nothing and so was invisible to every width guard.
      // A widget narrower than 90% of its panel is that bug returning.
      expect(widget.width / growth.width, `${name} at ${viewport}px`).toBeGreaterThan(0.9);
    }
  });

  /**
   * ⚠️ THREE became TWO because THE-299 BUILT the retention heatmap, and the
   * track narrowed with them: `lg:grid-cols-3` became `lg:grid-cols-2`, because
   * a three-column track holding two cards leaves a third of the row empty at
   * every width above `lg`. The claim is otherwise unchanged and is still made
   * at all five viewports — a deferred widget is never hidden, and the two
   * still stack on a phone and share a row from `lg`.
   */
  it('the deferred two stack on a phone and sit in one row from lg', () => {
    for (const viewport of VIEWPORTS) expect(at(viewport).deferredCards, `${viewport}px`).toBe(2);

    // Below `lg` they stack: two distinct tops.
    for (const viewport of [380, 768] as const) {
      expect(new Set(at(viewport).deferredTop).size, `${viewport}px`).toBe(2);
    }
    // At `lg` and above they share a row: one top.
    for (const viewport of [1024, 1280, 1440] as const) {
      expect(new Set(at(viewport).deferredTop).size, `${viewport}px`).toBe(1);
    }
  });

  it('🔴 width is NOT monotonic, and the ladder records where it falls', () => {
    const widths = VIEWPORTS.map((v) => Math.round(box(v, 'growth').width));
    const [w380, w768, w1024, w1280, w1440] = widths;

    /*
     * ⚠️ MEASURED, not derived, and the arithmetic is recorded so a future
     * change to the shell shows up here as a number rather than as a surprise:
     *
     *   380  → 348   viewport 380, no sidebar below `lg`, wrapper `p-4` → −32
     *   768  → 736   same, −32
     *   1024 → 735   the 289px sidebar appears AND `lg:p-0` removes the padding
     *   1280 → 991   1280 − 289
     *   1440 → 1044  1440 − 289 = 1151, capped by `max-w-6xl`
     *
     * 🔴 SO WIDTH FALLS AT 1024, from 736 to 735. It is one pixel, and it is a
     * genuine reversal: the sidebar costs more than the padding it replaces.
     * A test that assumed width grows with the viewport would encode a false
     * property here, and #426 measured the same shape at larger magnitude on
     * the KPI card. This is why all five rungs are measured rather than the
     * phone and the desktop.
     */
    expect(widths).toEqual([348, 736, 735, 991, 1044]);

    // The fall is real and it is at 1024 — this is the assertion, not the pin.
    expect(w1024).toBeLessThan(w768);
    // And the cap binds at 1440: `max-w-6xl` is 1044px.
    expect(w1440).toBe(1044);
    expect(w1440 - w1280).toBeLessThan(w1280 - w1024);
    expect(w380).toBeLessThan(w768);
  });
});
