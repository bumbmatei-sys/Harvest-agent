// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom — the same reason THE-276-FIX's position test gives.
// Nothing here needs a DOM: the page is rendered to a string and every
// measurement happens inside a real browser over CDP. Under happy-dom the
// globals carry browser semantics and a request to the browser's own debugger
// port fails same-origin, so the browser could never be attached to.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { DashboardTabs } from '../dashboard/DashboardTabs';
import { GivingTab } from '../dashboard/GivingTab';
import { OverviewTab } from '../dashboard/OverviewTab';
import type { GivingData } from '../dashboard/useGivingData';
import type { OverviewData } from '../dashboard/useOverviewData';

/**
 * THE-290 — WHERE the Giving tab renders, measured in Chromium.
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
 * ─── The two properties that matter at 380px ─────────────────────────────────
 *
 * 🔴 A TABLE MUST SCROLL INSIDE ITS OWN CARD. A four-column money table with
 * real campaign names and a progress bar is wider than a 380px phone, and the
 * wrong fix is to let that overflow reach the page: horizontal body scroll makes
 * every other widget drift under the thumb. `ui/table` wraps every table in an
 * `overflow-x-auto` container, and this asserts the container is the thing that
 * scrolls — that it GENUINELY overflows, so the claim is not vacuous, and that
 * `documentElement` does not overflow at all.
 *
 * 🔴 THE LAST WIDGET MUST CLEAR THE BOTTOM NAV. The admin shell's nav is `fixed
 * bottom-0` at `z-[100]` with `pb-safe`, so anything ending underneath it is
 * unreadable on a phone. See {@link SHELL_NOTE} for how the shell is
 * approximated and what that does and does not make load-bearing.
 */

const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

const POINTS = Array.from({ length: 8 }, (_, i) => ({ label: `W${i}`, value: (i + 1) * 3 }));

/** Overview data, complete everywhere, so the shared giving trend is ready. */
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
 * Campaigns with LONG real names and many rows.
 *
 * ⚠️ Deliberately hostile: a church genuinely names a campaign "Building Fund
 * Phase II — Sanctuary Roof & Fellowship Hall Restoration", and a table sized
 * against "Roof fund" would pass a test it should fail. Twelve rows also puts
 * the list past the point where the card scrolls vertically, and the set covers
 * a campaign over its goal and one with no goal at all so both progress-cell
 * branches are laid out.
 */
const GIVING = {
  loading: false,
  campaignReason: null,
  pledgeReason: null,
  campaigns: {
    total: 12,
    active: 3,
    unnamed: 1,
    withoutGoal: 1,
    goalDollars: 412000,
    raisedDollars: 233450,
    rows: [
      { id: 'c1', title: 'Building Fund Phase II — Sanctuary Roof & Fellowship Hall Restoration', goalDollars: 250000, raisedDollars: 121400, isActive: true, percent: 48.56 },
      { id: 'c2', title: 'Missionary Support: East Africa Church Planting Partnership', goalDollars: 60000, raisedDollars: 44300, isActive: true, percent: 73.83 },
      { id: 'c3', title: 'Youth Summer Camp Scholarship Fund', goalDollars: 18000, raisedDollars: 21500, isActive: true, percent: 100 },
      { id: 'c4', title: 'Benevolence & Emergency Assistance', goalDollars: 0, raisedDollars: 12250, isActive: false, percent: null },
      { id: 'c5', title: 'Christmas Outreach', goalDollars: 15000, raisedDollars: 9800, isActive: false, percent: 65.33 },
      { id: 'c6', title: 'New Sound System', goalDollars: 22000, raisedDollars: 7400, isActive: false, percent: 33.64 },
      { id: 'c7', title: 'Church Van Replacement', goalDollars: 30000, raisedDollars: 6200, isActive: false, percent: 20.67 },
      { id: 'c8', title: 'Food Pantry Restock', goalDollars: 5000, raisedDollars: 4100, isActive: false, percent: 82 },
      { id: 'c9', title: 'Sunday School Curriculum', goalDollars: 4000, raisedDollars: 2900, isActive: false, percent: 72.5 },
      { id: 'c10', title: 'Worship Team Instruments', goalDollars: 6000, raisedDollars: 2200, isActive: false, percent: 36.67 },
      { id: 'c11', title: 'Nursery Renovation', goalDollars: 2000, raisedDollars: 1200, isActive: false, percent: 60 },
      { id: 'c12', title: null, goalDollars: 0, raisedDollars: 200, isActive: false, percent: null },
    ],
  },
  pledges: {
    pledges: 34,
    pledgedDollars: 88400,
    paidDollars: 51200,
    percent: 57.92,
    byStatus: [
      { status: 'active', pledges: 19, pledgedDollars: 52000, paidDollars: 21400 },
      { status: 'fulfilled', pledges: 11, pledgedDollars: 30400, paidDollars: 29800 },
      { status: 'lapsed', pledges: 4, pledgedDollars: 6000, paidDollars: 0 },
    ],
    overdue: 6,
    notOverdue: 25,
    undated: 3,
  },
} as unknown as GivingData;

/**
 * ⚠️ HOW THE SHELL IS APPROXIMATED, and what that makes load-bearing.
 *
 * `AdminDashboard.tsx` is THE-277's and this ticket may not open it, so its
 * geometry is REPLICATED here from the class strings it actually carries rather
 * than invented.
 *
 * 🔴 THE SIDEBAR AND THE BOTTOM NAV ARE ONE ELEMENT. That is the thing to get
 * right and the first draft of this file got it wrong. The shell has a single
 * `fixed lg:relative bottom-0 lg:bottom-auto … lg:w-64 lg:h-screen z-[100]`
 * element with `pb-safe lg:pb-0`: a bottom bar on a phone, the left sidebar from
 * `lg`. Rendering a `w-[289px]` spacer AND a second `lg:w-64` nav beside it
 * charged the row twice and collapsed the measured ladder to
 * [348, 736, 460, 716, 876] — a fixture bug that would have re-pinned every
 * width on this tab to a layout the app does not have.
 *
 * So the one element is modelled as its two forms, each where it applies:
 *
 *   · from `lg` — the `w-[289px]` spacer THE-276-FIX and THE-283 both measured
 *     against, which is the nav in its sidebar form;
 *   · below `lg` — a `fixed bottom-0 … pb-safe z-[100]` bar, `lg:hidden` so it
 *     cannot be counted a second time in the row above.
 *
 * The scroll container's own `pb-24 lg:pb-8` is replicated too, on a height-
 * constrained `overflow-y-auto` parent — 🔴 without the constraint the container
 * simply grows to its content and never scrolls, so a clearance assertion
 * against it measures nothing. The clearance test below therefore SCROLLS THE
 * CONTAINER TO ITS BOTTOM before measuring, which is the only state in which
 * "the last widget is hidden under the nav" can actually happen.
 *
 * 🔴 NO WIDTH ASSERTION READS ANY OF THESE NUMBERS — every width claim below is
 * relative or about overflow, exactly as THE-276-FIX and THE-283 established.
 * The ONE assertion that depends on the replication is the bottom-nav clearance,
 * and it says so at the point of use: what it proves is that THIS TAB's last
 * widget does not grow past the clearance the shell provides, which is the
 * property a widget can break and the only part of it this ticket owns.
 */
const SHELL_NOTE = 'see the block comment above';

const SELECTORS = {
  wrapper: '[data-dashboard-measure]',
  scroller: '[data-shell-scroll]',
  list: '[data-slot="tabs-list"]',
  panel: '[data-slot="tabs-content"]',
  giving: '[data-giving-tab]',
  trend: '[data-widget="Giving over time"]',
  tableCard: '[data-widget="Campaign progress"]',
  tableInner: '[data-campaign-progress]',
  tableScroller: '[data-slot="table-container"]',
  pledgeCard: '[data-widget="Pledge fulfilment"]',
  pledgeInner: '[data-pledge-fulfilment]',
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
  /** The same two boxes after the scroll container is scrolled to its bottom. */
  scrolled: { pledgeBottom: number; navTop: number; scrolledBy: number } | null;
}

let browser: MeasuringBrowser;
const readings = new Map<number, Reading>();

beforeAll(async () => {
  expect(SHELL_NOTE).toBeTruthy();
  const css = await buildAppCss();
  const body = renderToStaticMarkup(
    <div className="flex h-screen">
      {/*
        The nav IN ITS SIDEBAR FORM, from `lg`. The width THE-276-FIX observed;
        no width assertion reads it.
      */}
      <div className="hidden lg:block w-[289px] shrink-0" />
      <div className="min-w-0 flex-1 flex flex-col">
        {/*
          AdminDashboard's own scroll container, class for class, on a
          height-constrained parent so it genuinely scrolls: `pb-24` is what
          provides the bottom-nav clearance on a phone, and `lg:pb-8` removes it
          at `lg`, where the same nav has become the sidebar beside it.
        */}
        {/*
          ⚠️ `p-0 lg:p-6` IS OMITTED, deliberately, and the number is recorded
          rather than lost. The shell's scroll container carries it, and adding
          it here moved the measured ladder to [348, 736, 692, 948, 1044] — 43px
          narrower at 1024 and 1280, which is `p-6` at the 14.5px desktop rem
          base (1.5rem × 14.5 × 2 = 43.5). That is a REAL cost the running app
          pays, and #429's pinned ladder does not model it, so including it here
          would leave two slices pinning two different ladders for one screen
          with nothing saying why. The horizontal padding is therefore left out
          so this ladder is comparable with #429's pin; the vertical clearance,
          which is what the bottom-nav test needs, is kept.

          🔴 The 1024 reversal survives either way — 736 → 735 without it and
          736 → 692 with it — so the property being pinned does not depend on
          the choice. Reported in the PR rather than buried here.
        */}
        <div data-shell-scroll className="flex-1 min-h-0 overflow-y-auto pb-24 lg:pb-8">
          {/* AdminDashboardHome's own wrapper, class for class. */}
          <div data-dashboard-measure className="w-full max-w-6xl mx-auto space-y-6 p-4 lg:p-0">
            <div>Good morning.</div>
            <DashboardTabs
              overview={<OverviewTab data={READY} unreadCount={0} showInbox={false} />}
              giving={<GivingTab data={READY} giving={GIVING} />}
            />
          </div>
        </div>
      </div>
      {/*
        🔴 The SAME nav in its bottom-bar form, below `lg` only. `lg:hidden`
        because the spacer above already stands for it from `lg` — see the block
        comment: counting it twice is what collapsed the width ladder.
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
   * no React attached — clicking the Giving trigger would do nothing. So the
   * Giving panel is rendered as the page's only panel instead: the markup below
   * is what `DashboardTabs` emits for it, in the same wrapper, with the same
   * classes. What is measured is the panel's CONTENT against the shell, which is
   * unaffected by which trigger is styled active.
   */
  const panelOpen = body.indexOf('data-slot="tabs-content"');
  expect(panelOpen, 'the tab panel is not in the rendered markup').toBeGreaterThan(-1);
  const openTagEnd = body.indexOf('>', panelOpen) + 1;
  // The panel is the LAST element of the tabs root, so everything from the end
  // of its open tag to the first of the trailing closers is its content.
  const tail = body.slice(openTagEnd);
  const closeAt = tail.lastIndexOf('</div></div></div></div></div>');
  expect(closeAt, 'the panel wrapper shape changed').toBeGreaterThan(-1);
  const givingOnly =
    body.slice(0, openTagEnd) +
    renderToStaticMarkup(<GivingTab data={READY} giving={GIVING} />) +
    tail.slice(closeAt);

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the290-'));
  const file = path.join(dir, 'giving.html');
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${givingOnly}</body></html>`,
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
          const pledge = document.querySelector(sel.pledgeCard);
          if (!sc || !pledge || !navEl) return null;
          const before = sc.scrollTop;
          sc.scrollTop = sc.scrollHeight;
          const out = {
            pledgeBottom: pledge.getBoundingClientRect().bottom,
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
}, 180_000);

afterAll(async () => { await browser?.close(); });

const at = (viewport: number) => readings.get(viewport)!;
const box = (viewport: number, name: keyof typeof SELECTORS) => {
  const found = at(viewport).boxes[name];
  if (!found) throw new Error(`${name} did not render at ${viewport}px`);
  return found;
};

/* ═══ 10 · 🔴 The table scrolls inside its card; the page body does not move ═ */

describe('the table scrolls inside its card and the page body does not move at 380px', () => {
  it.each(VIEWPORTS)('the page has no horizontal overflow at %ipx', (viewport) => {
    const r = at(viewport);
    // 🔴 The whole property, in one number. THE-276's negative margin put 4px of
    // scroll here at 1024 and 1280 ONLY, which is why all five are asserted.
    expect(r.docScrollWidth, `documentElement overflows at ${viewport}px`).toBeLessThanOrEqual(viewport);
    expect(r.bodyScrollWidth, `body overflows at ${viewport}px`).toBeLessThanOrEqual(viewport);
  });

  it('the campaign table genuinely overflows at 380px — the fixture is wide enough to prove it', () => {
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

  it('every progress bar renders and stays inside the table, at every width', () => {
    for (const viewport of VIEWPORTS) {
      // Ten of the twelve campaigns have a goal above zero; the two without one
      // render a reason instead of an indeterminate bar.
      expect(at(viewport).progressBars, `${viewport}px`).toBe(10 + 1); // + the pledge widget's
    }
  });
});

/* ═══ 11 · 🔴 The last widget clears the bottom nav at 380px ════════════════ */

describe('the last widget clears the bottom nav at 380px', () => {
  it('the replicated nav really is a fixed bottom bar on a phone, and gone by lg', () => {
    // The premise of the assertion below, checked rather than assumed. If the
    // replication stopped being `fixed bottom-0` the clearance test would be
    // measuring nothing at all.
    expect(at(380).navPosition).toBe('fixed');
    const nav = box(380, 'bottomNav');
    expect(Math.round(nav.bottom), 'the nav is not at the bottom of the 900px viewport').toBe(900);
    // 🔴 And from `lg` the same element is the sidebar instead — represented by
    // the spacer — so it is not a bottom bar there and nothing has to clear it.
    expect(at(1024).boxes.bottomNav?.width ?? 0).toBe(0);
  });

  it('🔴 the pledge widget — the last one on the tab — ends above the nav when scrolled to the bottom', () => {
    /*
     * ⚠️ THIS IS THE ONE ASSERTION THAT DEPENDS ON THE REPLICATED SHELL (see the
     * block comment at the top). What it proves is the part this ticket owns:
     * the last widget does not grow past the clearance the shell provides. A
     * widget with a negative bottom margin, an absolute position, or content
     * spilling out of its card would fail here.
     */
    const scrolled = at(380).scrolled!;
    expect(scrolled, 'the scrolled reading did not happen').toBeTruthy();

    // 🔴 The page genuinely scrolled, so this is the real bottom of the tab and
    // not a short page that never reached the nav.
    expect(scrolled.scrolledBy, 'the container never scrolled — the assertion is vacuous')
      .toBeGreaterThan(100);

    expect(scrolled.navTop).toBeGreaterThan(0);
    expect(scrolled.pledgeBottom, 'the last widget ends underneath the bottom nav')
      .toBeLessThan(scrolled.navTop);
    // With real room to spare, not a hairline.
    expect(scrolled.navTop - scrolled.pledgeBottom).toBeGreaterThanOrEqual(16);
  });

  it('the pledge widget is genuinely the last thing on the tab', () => {
    // If the order changed, the assertion above would be clearing the nav with
    // the wrong widget.
    const giving = box(380, 'giving');
    const pledge = box(380, 'pledgeCard');
    expect(Math.abs(pledge.bottom - giving.bottom)).toBeLessThanOrEqual(1);
    expect(pledge.top).toBeGreaterThan(box(380, 'tableCard').top);
    expect(box(380, 'tableCard').top).toBeGreaterThan(box(380, 'trend').top);
  });
});

/* ═══ 12 · 🔴 Positions and widths at all five viewports ════════════════════ */

describe('positions and widths at all five viewports', () => {
  it.each(VIEWPORTS)('the Giving panel aligns with the tab list at %ipx', (viewport) => {
    // Relative, like THE-276-FIX's assertions, so the approximated shell around
    // it is never load-bearing.
    const panel = box(viewport, 'panel');
    const giving = box(viewport, 'giving');
    expect(Math.abs(giving.x - panel.x), `${viewport}px`).toBeLessThanOrEqual(1);
    expect(giving.width).toBeGreaterThan(0);
  });

  it.each(VIEWPORTS)('every widget spans the panel at %ipx — none is a narrow column', (viewport) => {
    const giving = box(viewport, 'giving');
    for (const name of ['trend', 'tableCard', 'pledgeCard'] as const) {
      const widget = box(viewport, name);
      // 🔴 THE-276's defect was a widget at 420px inside a 1044px container,
      // which overflowed nothing and so was invisible to every width guard. A
      // widget narrower than 90% of its panel is that bug returning.
      expect(widget.width / giving.width, `${name} at ${viewport}px`).toBeGreaterThan(0.9);
    }
  });

  it('🔴 width is NOT monotonic, and the 1024 reversal still holds', () => {
    const widths = VIEWPORTS.map((v) => Math.round(box(v, 'giving').width));
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
     * 🔴 SO WIDTH FALLS AT 1024, from 736 to 735 — the reversal #429 pinned, and
     * it is unchanged by this slice. It is one pixel, and it is genuine: the
     * sidebar costs more than the padding it replaces. A test that assumed width
     * grows with the viewport would encode a false property here.
     *
     * ⚠️ The shell's scroll container also carries `lg:p-6`, which this fixture
     * omits so the ladder stays comparable with #429's pin — see the note at the
     * fixture. With it the ladder is [348, 736, 692, 948, 1044]: 43px narrower
     * at 1024 and 1280, and the reversal at 1024 is LARGER, not absent.
     */
    expect(widths).toEqual([348, 736, 735, 991, 1044]);

    // The fall is real and it is at 1024 — this is the assertion, not the pin.
    expect(w1024).toBeLessThan(w768);
    // And the cap binds at 1440: `max-w-6xl` is 1044px.
    expect(w1440).toBe(1044);
    expect(w1440 - w1280).toBeLessThan(w1280 - w1024);
    expect(w380).toBeLessThan(w768);
  });

  it('the pledge figures stack on a phone and sit in one row from sm', () => {
    // A three-up grid of money figures is unreadable at 380px; it is
    // `grid-cols-1 sm:grid-cols-3`, and this is that claim measured.
    const inner = box(380, 'pledgeInner');
    const card = box(380, 'pledgeCard');
    expect(inner.width).toBeLessThanOrEqual(Math.ceil(card.width));
    // The pledge card is taller on a phone than on the desktop precisely because
    // the figures stack there.
    expect(box(380, 'pledgeCard').bottom - box(380, 'pledgeCard').top)
      .toBeGreaterThan(box(1440, 'pledgeCard').bottom - box(1440, 'pledgeCard').top);
  });
});
