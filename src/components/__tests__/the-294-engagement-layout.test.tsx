// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom — the same reason THE-276-FIX's, THE-283's and
// THE-290's position tests give. Nothing here needs a DOM: the page is rendered
// to a string and every measurement happens inside a real browser over CDP.
// Under happy-dom the globals carry browser semantics and a request to the
// browser's own debugger port fails same-origin, so the browser could never be
// attached to.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { ContentTab } from '../dashboard/ContentTab';
import { DashboardTabs } from '../dashboard/DashboardTabs';
import { EngagementTab } from '../dashboard/EngagementTab';
import { OverviewTab } from '../dashboard/OverviewTab';
import type { ContentData } from '../dashboard/useContentData';
import type { EngagementData } from '../dashboard/useEngagementData';
import type { OverviewData } from '../dashboard/useOverviewData';

/**
 * THE-294 — WHERE the Engagement and Content tabs render, measured in Chromium.
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
 * because of it — THE-276 found a 4px page overflow at 1024 and 1280 ONLY, #426
 * measured a card falling twice with its narrowest point at 1280, and #429
 * measured the panel FALLING at 1024. A test that checked the phone and the
 * desktop would have missed all three.
 *
 * ─── 🔴 TWO PAGES, TWO BROWSERS, and why they are not one ───────────────────
 *
 * Base UI mounts only the ACTIVE tab panel, so a single static page can hold one
 * tab's content. Rendering both panels into one page to save a browser launch
 * would measure a layout the app never produces — two tabs' widgets stacked in
 * one column — and the bottom-nav clearance assertion in particular would then
 * be about the wrong widget. Each tab therefore gets its own page and its own
 * measuring browser, which is the same fixture shape THE-290 used, twice.
 *
 * ─── The two properties that matter at 380px ─────────────────────────────────
 *
 * 🔴 A TABLE MUST SCROLL INSIDE ITS OWN CARD. The activity-type table is four
 * columns wide with two multi-word headings, which is wider than a 380px phone,
 * and the wrong fix is to let that overflow reach the page: horizontal body
 * scroll makes every other widget drift under the thumb. `ui/table` wraps every
 * table in an `overflow-x-auto` container, and this asserts the container is the
 * thing that scrolls — that it GENUINELY overflows, so the claim is not vacuous
 * — and that `documentElement` does not overflow at all.
 *
 * 🔴 THE LAST WIDGET MUST CLEAR THE BOTTOM NAV. The admin shell's nav is `fixed
 * bottom-0` at `z-[100]`. ⚠️ ITS `pb-safe` COMPILES TO NOTHING — THE-295 is
 * fixing that — so nothing here relies on it for clearance. See {@link SHELL_NOTE}.
 */

const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

const POINTS = Array.from({ length: 8 }, (_, i) => ({ label: `W${i}`, value: (i + 1) * 3 }));
const FOUR_POINTS = Array.from({ length: 4 }, (_, i) => ({ label: `W${i}`, value: i + 1 }));

/** Overview data, complete everywhere, so the shell mounts as it really does. */
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
 * Engagement data with a HOSTILE table.
 *
 * ⚠️ All five recognised types are present with six-figure counts, so the
 * four-column table carries its widest realistic content: a church that has run
 * a CRM for three years genuinely reaches five digits of activity rows, and a
 * table sized against "Notes 4" would pass a test it should fail. Two of the
 * three numeric columns sit under multi-word headings, which is what actually
 * sets the minimum width.
 */
const ENGAGEMENT = {
  loading: false,
  activityReason: null,
  attendanceReason: null,
  prayerReason: null,
  activitySeries: { kind: 'complete', points: POINTS },
  prayer: { kind: 'complete', points: FOUR_POINTS },
  activityTypes: {
    total: 148930,
    unrecognised: 412,
    appRecorded: 96214,
    adminLogged: 52716,
    rows: [
      { type: 'meeting', label: 'Meetings', activities: 61240, appRecorded: 61240, adminLogged: 0 },
      { type: 'note', label: 'Notes', activities: 40118, appRecorded: 12904, adminLogged: 27214 },
      { type: 'email', label: 'Emails', activities: 28770, appRecorded: 0, adminLogged: 28770 },
      { type: 'donation', label: 'Donations', activities: 15106, appRecorded: 15106, adminLogged: 0 },
      { type: 'call', label: 'Calls', activities: 3284, appRecorded: 0, adminLogged: 3284 },
    ],
  },
  spread: {
    activities: 96214,
    contacts: 4127,
    busiest: 218,
    withoutContact: 91,
    bands: [
      { label: '1 activity', contacts: 1904 },
      { label: '2 to 5', contacts: 1522 },
      { label: '6 to 10', contacts: 488 },
      { label: '11 or more', contacts: 213 },
    ],
  },
  attendance: { sessions: 312, checkIns: 28941, busiest: 1204, empty: 7 },
} as unknown as EngagementData;

const CONTENT = {
  loading: false,
  completionReason: null,
  completion: {
    completions: 1842,
    learnersWithACompletion: 913,
    courses: 24,
    adoptedCourses: 6,
    learners: 4127,
    coursesWithNoCompletion: 3,
  },
} as unknown as ContentData;

/**
 * ⚠️ HOW THE SHELL IS APPROXIMATED, and what that makes load-bearing.
 *
 * `AdminDashboard.tsx` is THE-277's and this ticket may not open it, so its
 * geometry is REPLICATED here from the class strings it actually carries rather
 * than invented. This is THE-290's fixture, unchanged, so the measured ladder
 * stays comparable with #429's and #433's pins.
 *
 * 🔴 THE SIDEBAR AND THE BOTTOM NAV ARE ONE ELEMENT — a bottom bar on a phone,
 * the left sidebar from `lg`. Rendering a spacer AND a second nav beside it
 * charges the row twice and collapses the ladder, which is the fixture bug #433
 * recorded. So it is modelled as its two forms, each where it applies:
 *
 *   · from `lg` — the `w-[289px]` spacer, which is the nav in sidebar form;
 *   · below `lg` — a `fixed bottom-0 … z-[100]` bar, `lg:hidden`.
 *
 * 🔴 `pb-safe` IS DELIBERATELY NOT RELIED ON. It compiles to NOTHING today —
 * there is no such utility, and THE-295 is the ticket fixing it — so a clearance
 * that depended on it would be measuring a class name that produces no CSS. The
 * clearance below comes entirely from the scroll container's own `pb-24`, which
 * is a real Tailwind class, and the assertion measures the resulting gap in
 * pixels rather than trusting either name. The class is still written on the
 * replicated nav so the fixture matches the shell's markup character for
 * character; it simply contributes nothing, which is the point.
 *
 * The scroll container's `p-0 lg:p-6` is OMITTED, exactly as #433 omitted it and
 * for its stated reason: including it moves the ladder 43px narrower at 1024 and
 * 1280 (`1.5rem × 14.5px × 2`), and leaving it out keeps this pin comparable
 * with the two already in the repo. 🔴 The 1024 reversal survives either way.
 *
 * 🔴 NO WIDTH ASSERTION READS ANY OF THESE NUMBERS — every width claim below is
 * relative or about overflow. The ONE assertion that depends on the replication
 * is the bottom-nav clearance, and it says so at the point of use.
 */
const SHELL_NOTE = 'see the block comment above';

const SELECTORS = {
  wrapper: '[data-dashboard-measure]',
  scroller: '[data-shell-scroll]',
  list: '[data-slot="tabs-list"]',
  panel: '[data-slot="tabs-content"]',
  engagement: '[data-engagement-tab]',
  content: '[data-content-tab]',
  trend: '[data-widget="Engagement over time"]',
  attendanceCard: '[data-widget="Attendance & check-in"]',
  attendanceInner: '[data-attendance]',
  tableCard: '[data-widget="Activity type"]',
  tableInner: '[data-activity-types]',
  tableScroller: '[data-slot="table-container"]',
  spreadCard: '[data-widget="How widely engagement is spread"]',
  spreadInner: '[data-engagement-spread]',
  prayerCard: '[data-widget="Prayer wall activity"]',
  completionCard: '[data-widget="Course completion"]',
  completionInner: '[data-course-completion]',
  bottomNav: '[data-shell-bottom-nav]',
} as const;

interface Reading {
  viewport: number;
  docScrollWidth: number;
  bodyScrollWidth: number;
  boxes: Record<string, { x: number; width: number; right: number; top: number; bottom: number } | null>;
  scroller: { clientWidth: number; scrollWidth: number; overflowX: string } | null;
  progressBars: number;
  navPosition: string;
  /** The last widget and the nav, after the scroll container is scrolled home. */
  scrolled: { lastBottom: number; navTop: number; scrolledBy: number } | null;
}

/** The shell, with whichever tab panel is being measured inside it. */
function page(panel: React.ReactNode, lastSelector: string): string {
  const body = renderToStaticMarkup(
    <div className="flex h-screen">
      {/* The nav IN ITS SIDEBAR FORM, from `lg`. No width assertion reads it. */}
      <div className="hidden lg:block w-[289px] shrink-0" />
      <div className="min-w-0 flex-1 flex flex-col">
        <div data-shell-scroll className="flex-1 min-h-0 overflow-y-auto pb-24 lg:pb-8">
          {/* AdminDashboardHome's own wrapper, class for class. */}
          <div data-dashboard-measure className="w-full max-w-6xl mx-auto space-y-6 p-4 lg:p-0">
            <div>Good morning.</div>
            <DashboardTabs overview={<OverviewTab data={READY} unreadCount={0} showInbox={false} />} />
          </div>
        </div>
      </div>
      {/*
        🔴 The SAME nav in its bottom-bar form, below `lg` only. `pb-safe` is
        written because the shell writes it; it compiles to nothing and nothing
        here depends on it.
      */}
      <div
        data-shell-bottom-nav
        className="lg:hidden bg-surface-raised border-t border-line flex justify-center py-2 px-2 pb-safe fixed bottom-0 w-full z-[100]"
      >
        <span>Nav</span>
      </div>
    </div>,
  );

  /*
   * ⚠️ Base UI mounts only the ACTIVE panel, and this page is STATIC markup with
   * no React attached — clicking a trigger would do nothing. So the panel under
   * test is substituted as the page's only panel: the markup below is what
   * `DashboardTabs` emits for it, in the same wrapper, with the same classes.
   * What is measured is the panel's CONTENT against the shell, which is
   * unaffected by which trigger is styled active.
   */
  const panelOpen = body.indexOf('data-slot="tabs-content"');
  if (panelOpen < 0) throw new Error('the tab panel is not in the rendered markup');
  const openTagEnd = body.indexOf('>', panelOpen) + 1;
  const tail = body.slice(openTagEnd);
  const closeAt = tail.lastIndexOf('</div></div></div></div></div>');
  if (closeAt < 0) throw new Error('the panel wrapper shape changed');
  const html =
    body.slice(0, openTagEnd) + renderToStaticMarkup(panel as React.ReactElement) + tail.slice(closeAt);

  if (!html.includes(lastSelector.replace(/[[\]]/g, '').split('=')[0])) {
    // A cheap premise check: the panel really rendered something to measure.
    throw new Error(`the panel did not render ${lastSelector}`);
  }
  return html;
}

async function measurePage(html: string, lastSelector: string): Promise<{
  browser: MeasuringBrowser;
  readings: Map<number, Reading>;
}> {
  const css = await buildAppCss();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'the294-'));
  const file = path.join(dir, 'tab.html');
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`,
  );

  const browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  const readings = new Map<number, Reading>();
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
      const scrollerEl = document.querySelector(sel.tableScroller);
      const navEl = document.querySelector(sel.bottomNav);
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
        progressBars: document.querySelectorAll('[data-slot="progress"]').length,
        navPosition: navEl ? getComputedStyle(navEl).position : 'missing',
        /*
         * SCROLLED TO THE BOTTOM, which is the only state in which the last
         * widget could be hidden under a fixed bottom-0 nav. Measuring the
         * unscrolled page would pass on any tab long enough to overflow.
         * (No backticks in here: this comment lives inside a template literal.)
         */
        scrolled: (() => {
          const sc = document.querySelector(sel.scroller);
          const last = document.querySelector(${JSON.stringify(lastSelector)});
          if (!sc || !last || !navEl) return null;
          const before = sc.scrollTop;
          sc.scrollTop = sc.scrollHeight;
          const out = {
            lastBottom: last.getBoundingClientRect().bottom,
            navTop: navEl.getBoundingClientRect().top,
            scrolledBy: sc.scrollTop - before,
          };
          sc.scrollTop = before;
          return out;
        })(),
      };
    })()`, 900);
    readings.set(viewport, reading);
  }
  return { browser, readings };
}

let engagementBrowser: MeasuringBrowser;
let contentBrowser: MeasuringBrowser;
const engagementReadings = new Map<number, Reading>();
const contentReadings = new Map<number, Reading>();

beforeAll(async () => {
  expect(SHELL_NOTE).toBeTruthy();

  const engagement = await measurePage(
    page(<EngagementTab engagement={ENGAGEMENT} />, SELECTORS.prayerCard),
    SELECTORS.prayerCard,
  );
  engagementBrowser = engagement.browser;
  engagement.readings.forEach((v, k) => engagementReadings.set(k, v));

  const content = await measurePage(
    page(<ContentTab content={CONTENT} />, SELECTORS.completionCard),
    SELECTORS.completionCard,
  );
  contentBrowser = content.browser;
  content.readings.forEach((v, k) => contentReadings.set(k, v));
}, 300_000);

afterAll(async () => {
  await engagementBrowser?.close();
  await contentBrowser?.close();
});

const at = (viewport: number) => engagementReadings.get(viewport)!;
const box = (viewport: number, name: keyof typeof SELECTORS) => {
  const found = at(viewport).boxes[name];
  if (!found) throw new Error(`${name} did not render at ${viewport}px`);
  return found;
};
const contentAt = (viewport: number) => contentReadings.get(viewport)!;

/* ═══ 13 · 🔴 Tables scroll inside their cards; the page body does not move ══ */

describe('tables scroll inside their cards and the page body does not move at 380px', () => {
  it.each(VIEWPORTS)('the Engagement page has no horizontal overflow at %ipx', (viewport) => {
    const r = at(viewport);
    // 🔴 The whole property, in one number. THE-276's negative margin put 4px of
    // scroll here at 1024 and 1280 ONLY, which is why all five are asserted.
    expect(r.docScrollWidth, `documentElement overflows at ${viewport}px`).toBeLessThanOrEqual(viewport);
    expect(r.bodyScrollWidth, `body overflows at ${viewport}px`).toBeLessThanOrEqual(viewport);
  });

  it.each(VIEWPORTS)('and the Content page has none at %ipx either', (viewport) => {
    const r = contentAt(viewport);
    expect(r.docScrollWidth, `documentElement overflows at ${viewport}px`).toBeLessThanOrEqual(viewport);
    expect(r.bodyScrollWidth, `body overflows at ${viewport}px`).toBeLessThanOrEqual(viewport);
  });

  it('🔴 the activity table GENUINELY overflows at 380px — the fixture is wide enough to prove it', () => {
    const scroller = at(380).scroller!;
    expect(scroller.overflowX).toBe('auto');
    // If this were false the assertion above would be vacuous: a table that fits
    // proves nothing about where its overflow would have gone.
    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
  });

  it('and the overflow is absorbed by the scroller, not passed up to the card', () => {
    const scroller = at(380).scroller!;
    const card = box(380, 'tableCard');
    expect(scroller.clientWidth).toBeLessThanOrEqual(Math.ceil(card.width));
    expect(at(380).docScrollWidth).toBeLessThanOrEqual(380);
  });

  it('the table stays inside its card at every width, never wider than it', () => {
    for (const viewport of VIEWPORTS) {
      const card = box(viewport, 'tableCard');
      const inner = box(viewport, 'tableInner');
      expect(inner.x, `${viewport}: table starts left of its card`).toBeGreaterThanOrEqual(card.x - 1);
      expect(inner.right, `${viewport}: table ends right of its card`).toBeLessThanOrEqual(card.right + 1);
    }
  });

  it('🔴 no progress bar was adopted on either tab', () => {
    // THE-272's guard records the adopter list; this is the rendered half of the
    // same claim. `progress` stays at THE-290's two files.
    for (const viewport of VIEWPORTS) {
      expect(at(viewport).progressBars, `Engagement at ${viewport}px`).toBe(0);
      expect(contentAt(viewport).progressBars, `Content at ${viewport}px`).toBe(0);
    }
  });
});

/* ═══ 13b · 🔴 The last widget clears the bottom nav at 380px ═══════════════ */

describe('the last widget clears the bottom nav at 380px', () => {
  it('the replicated nav really is a fixed bottom bar on a phone, and gone by lg', () => {
    // The premise of the assertion below, checked rather than assumed.
    expect(at(380).navPosition).toBe('fixed');
    const nav = box(380, 'bottomNav');
    expect(Math.round(nav.bottom), 'the nav is not at the bottom of the 900px viewport').toBe(900);
    expect(at(1024).boxes.bottomNav?.width ?? 0).toBe(0);
  });

  it('🔴 the prayer widget — the last on Engagement — ends above the nav when scrolled home', () => {
    /*
     * ⚠️ THIS IS THE ONE ASSERTION THAT DEPENDS ON THE REPLICATED SHELL. What it
     * proves is the part this ticket owns: the last widget does not grow past
     * the clearance the shell provides. A widget with a negative bottom margin,
     * an absolute position, or content spilling out of its card fails here.
     *
     * 🔴 The clearance measured is `pb-24`'s alone. `pb-safe` compiles to
     * nothing, so if this passes it passes on a real class.
     */
    const scrolled = at(380).scrolled!;
    expect(scrolled, 'the scrolled reading did not happen').toBeTruthy();
    expect(scrolled.scrolledBy, 'the container never scrolled — the assertion is vacuous')
      .toBeGreaterThan(100);
    expect(scrolled.navTop).toBeGreaterThan(0);
    expect(scrolled.lastBottom, 'the last widget ends underneath the bottom nav')
      .toBeLessThan(scrolled.navTop);
    expect(scrolled.navTop - scrolled.lastBottom).toBeGreaterThanOrEqual(16);
  });

  it('the prayer widget is genuinely the last thing on the Engagement tab', () => {
    // If the order changed, the assertion above would be clearing the nav with
    // the wrong widget.
    const tab = box(380, 'engagement');
    const prayer = box(380, 'prayerCard');
    expect(Math.abs(prayer.bottom - tab.bottom)).toBeLessThanOrEqual(1);
    expect(prayer.top).toBeGreaterThan(box(380, 'spreadCard').top);
    expect(box(380, 'spreadCard').top).toBeGreaterThan(box(380, 'tableCard').top);
    expect(box(380, 'tableCard').top).toBeGreaterThan(box(380, 'attendanceCard').top);
    expect(box(380, 'attendanceCard').top).toBeGreaterThan(box(380, 'trend').top);
  });

  it('and the Content tab\'s one widget clears it too', () => {
    const scrolled = contentAt(380).scrolled!;
    expect(scrolled).toBeTruthy();
    expect(scrolled.navTop).toBeGreaterThan(0);
    // ⚠️ A one-widget tab may not overflow the container at all, in which case
    // there is nothing to scroll — and the widget must still end above the nav.
    expect(scrolled.lastBottom).toBeLessThan(scrolled.navTop);
  });
});

/* ═══ 14 · 🔴 Positions and widths at all five viewports ════════════════════ */

describe('positions and widths at all five viewports', () => {
  it.each(VIEWPORTS)('the Engagement panel aligns with the tab list at %ipx', (viewport) => {
    // Relative, like THE-276-FIX's assertions, so the approximated shell around
    // it is never load-bearing.
    const panel = box(viewport, 'panel');
    const tab = box(viewport, 'engagement');
    expect(Math.abs(tab.x - panel.x), `${viewport}px`).toBeLessThanOrEqual(1);
    expect(tab.width).toBeGreaterThan(0);
  });

  it.each(VIEWPORTS)('every Engagement widget spans the panel at %ipx — none is a narrow column', (viewport) => {
    const tab = box(viewport, 'engagement');
    for (const name of ['trend', 'attendanceCard', 'tableCard', 'spreadCard', 'prayerCard'] as const) {
      const widget = box(viewport, name);
      // 🔴 THE-276's defect was a widget at 420px inside a 1044px container,
      // which overflowed nothing and so was invisible to every width guard. A
      // widget narrower than 90% of its panel is that bug returning.
      expect(widget.width / tab.width, `${name} at ${viewport}px`).toBeGreaterThan(0.9);
    }
  });

  it('🔴 width is NOT monotonic, and the 1024 reversal still holds', () => {
    const widths = VIEWPORTS.map((v) => Math.round(box(v, 'engagement').width));
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
     * 🔴 SO WIDTH FALLS AT 1024, from 736 to 735 — the reversal #429 pinned and
     * #433 re-pinned, unchanged by this slice. It is one pixel, and it is
     * genuine: the sidebar costs more than the padding it replaces. A test that
     * assumed width grows with the viewport would encode a false property here.
     */
    expect(widths).toEqual([348, 736, 735, 991, 1044]);

    // The fall is real and it is at 1024 — this is the assertion, not the pin.
    expect(w1024).toBeLessThan(w768);
    expect(w1440).toBe(1044);
    expect(w1440 - w1280).toBeLessThan(w1280 - w1024);
    expect(w380).toBeLessThan(w768);
  });

  it('the Content tab measures the same ladder — one screen, one geometry', () => {
    const widths = VIEWPORTS.map((v) => {
      const found = contentAt(v).boxes.content;
      if (!found) throw new Error(`the Content panel did not render at ${v}px`);
      return Math.round(found.width);
    });
    expect(widths).toEqual([348, 736, 735, 991, 1044]);
  });

  it('the attendance and completion figures stack on a phone and sit in a row from sm', () => {
    // A three-up grid of figures is unreadable at 380px; both are
    // `grid-cols-1 sm:grid-cols-3`, and this is that claim measured.
    for (const [reading, cardName, innerName] of [
      [at, 'attendanceCard', 'attendanceInner'],
      [contentAt, 'completionCard', 'completionInner'],
    ] as const) {
      const card = reading(380).boxes[cardName]!;
      const inner = reading(380).boxes[innerName]!;
      expect(inner.width).toBeLessThanOrEqual(Math.ceil(card.width));
      const tall = reading(380).boxes[cardName]!;
      const wide = reading(1440).boxes[cardName]!;
      expect(tall.bottom - tall.top, `${cardName} does not stack on a phone`)
        .toBeGreaterThan(wide.bottom - wide.top);
    }
  });

  it('the spread bands are two-up on a phone and four-up from sm', () => {
    // `grid-cols-2 sm:grid-cols-4`: four bands in two rows on a phone is the
    // only way four numbers with words under them are readable at 348px.
    const phone = box(380, 'spreadCard');
    const desktop = box(1440, 'spreadCard');
    expect(phone.bottom - phone.top).toBeGreaterThan(desktop.bottom - desktop.top);
    const inner = box(380, 'spreadInner');
    expect(inner.width).toBeLessThanOrEqual(Math.ceil(phone.width));
  });
});
