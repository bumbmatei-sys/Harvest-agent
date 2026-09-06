// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom. happy-dom has NO LAYOUT ENGINE — with the real
// compiled stylesheet injected, `getBoundingClientRect()` returns zeros and no
// assertion below could tell a 44px day cell from a 28px one. Which is exactly
// the number at stake here: `calendar` ships `[--cell-size:--spacing(7)]`, and
// 28px is what a month grid draws unless somebody measures it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { DENSITY_PX, FORM_CONTAINER } from '../layout/form-layout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import EventMonthView from '../events/EventMonthView';
import { toMonthEvent, type MonthEvent } from '../events/month-view';

/**
 * THE-308 — what a day cell actually does, measured in Chromium.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE PREMISE THIS TICKET WAS HANDED IS ARITHMETICALLY FALSE, AND THIS FILE
 * IS WHERE THAT IS SETTLED.
 *
 * The ticket says: "A month grid has 28–31 cells — at 380px a day cell cannot
 * be 44px wide AND fit seven columns." Seven 44px cells are 308px. `calendar`
 * wraps them in its own `p-2`, so 324px, inside a 380px viewport. It fits with
 * 56px to spare, and the readings below say so at every width.
 *
 * ⚠️ THE REAL PROBLEM WAS NEVER THE COLUMN COUNT. It is that the primitive's
 * default cell is `--spacing(7)` — 28px — and every tappable thing `calendar`
 * draws is sized from that ONE variable: the day buttons (`min-w-(--cell-size)`,
 * `aspect-square`) and the month nav arrows (`size-(--cell-size)`) alike. So the
 * fix is one declaration on the root, and the floor lands on all of them at
 * once. A hand-built grid would have needed the floor applied per element, and
 * would have missed the nav arrows — which is the kind of thing that ships.
 *
 * ⚠️ `transition-all` IS ON `button`'s BASE CLASS, and `CalendarDayButton` IS a
 * Button. So every reading here is taken repeatedly and nothing is believed
 * until two consecutive readings agree — THE-295 read 1018px against a real
 * 224px by trusting the first answer, and THE-324 caught a control mid-flight
 * at 39.73px on its way to 44px.
 *
 * ⚠️ ONE `MeasuringBrowser` IN THIS FILE. Two in a process collide on a
 * PID-derived debugger port and silently compare a page with itself.
 * ═════════════════════════════════════════════════════════════════════════════
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

/* ── The fixture. Deliberately busy: a month with a day carrying three. ───── */

const ev = (id: string, title: string, day: number, hour: number, status: string): MonthEvent =>
  toMonthEvent(
    {
      title,
      status,
      location: 'Main hall and the community annexe',
      isOnline: false,
      startDate: {
        toDate: () => new Date(2026, 8, day, hour, 0),
        seconds: Math.floor(new Date(2026, 8, day, hour, 0).getTime() / 1000),
      },
    },
    id,
  );

const EVENTS: MonthEvent[] = [
  ev('e1', 'Sunday Morning Gathering', 13, 10, 'published'),
  ev('e2', 'Baptism Service and Lunch', 13, 16, 'published'),
  ev('e3', 'Evening Prayer and Communion', 13, 19, 'draft'),
  ev('e4', 'Midweek Prayer', 16, 19, 'draft'),
  ev('e5', 'Youth Group — Autumn Term Launch', 25, 18, 'published'),
];

interface Control {
  label: string;
  kind: string;
  width: number;
  height: number;
  minHeight: string;
}
interface Reading {
  viewport: number;
  docScrollWidth: number;
  bodyScrollWidth: number;
  cellSize: string;
  dayCells: Control[];
  navButtons: Control[];
  otherControls: Control[];
  todayButton: Control | null;
  tabTriggers: Control[];
  columnsInFirstWeek: number;
}

let browser: MeasuringBrowser;
const readings = new Map<number, Reading>();

beforeAll(async () => {
  const css = await buildAppCss();

  /**
   * 🔴 THE REAL COMPONENT, not a replica. `EventMonthView` takes its read as a
   * PROP — it imports no Firestore, no react-query and no `fetch` — so
   * `renderToStaticMarkup` renders the shipped component and the boxes below
   * are the boxes a church sees. There is no copy to keep in sync.
   *
   * It is mounted inside the ADMIN shell, class for class, because that is
   * where the clearance question lives: the bottom nav is `fixed bottom-0` at
   * `z-[100]`, and the admin scroller's `pb-24` is what clears it.
   */
  const page = renderToStaticMarkup(
    <div className="flex h-screen" data-admin-shell>
      <div className="hidden lg:block w-64 shrink-0" />
      <div className="min-w-0 flex-1 flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto pb-24 lg:pb-8 p-0 lg:p-6">
          <div className={`w-full ${FORM_CONTAINER} space-y-6`} data-admin-scope>
            {/*
              🔴 THE TAB BAR, class for class from AdminEvents. It lives on the
              SCREEN rather than in EventMonthView, so a suite that mounted only
              the view would never measure the two controls a church taps to
              reach it — and `tabs` sizes its list at `h-8`, which is 32px.
              A trigger clipped by its own list is exactly the kind of target
              that looks fine in a screenshot. The replica is pinned against the
              real file below, because AdminEvents imports Firestore and cannot
              be rendered to a string here.
            */}
            <div data-tabs-scope>
              <Tabs value="list">
                <TabsList>
                  <TabsTrigger value="list" className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0">List</TabsTrigger>
                  <TabsTrigger value="month" className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0">Month</TabsTrigger>
                </TabsList>
                <TabsContent value="list" className="mt-4 space-y-6" />
              </Tabs>
            </div>
            <EventMonthView
              read={{ kind: 'complete', events: EVENTS, undated: 0 }}
              loading={false}
              today={new Date(2026, 8, 13, 9, 0)}
              onOpenEvent={() => {}}
            />
          </div>
        </div>
      </div>
    </div>,
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the308-'));
  const file = path.join(dir, 'month-view.html');
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${page}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const viewport of VIEWPORTS) {
    readings.set(viewport, await browser.evaluateAt<Reading>(viewport, `(async () => {
      const pause = (ms) => new Promise((r) => setTimeout(r, ms));
      const read = () => {
        const measure = (el, kind) => {
          const b = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return {
            label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 44),
            kind,
            width: b.width,
            height: b.height,
            minHeight: cs.minHeight,
          };
        };
        const scope = document.querySelector('[data-admin-scope]');
        const grid = scope.querySelector('table');
        // ⚠️ button[data-day], not [data-day]: react-day-picker puts the
        // attribute on the <td> AND on the button inside it, so the bare
        // selector measured 65 boxes for a 30-day month — 35 cells and 30
        // buttons — and the empty outside-day <td>s among them are not targets.
        const dayCells = [...scope.querySelectorAll('button[data-day]')].map((el) => measure(el, 'day'));
        const navButtons = [...scope.querySelectorAll('.rdp-button_previous, .rdp-button_next, [class*="button_previous"], [class*="button_next"]')]
          .map((el) => measure(el, 'nav'));
        const dayButtonSet = new Set([...scope.querySelectorAll('button[data-day]')]);
        const navSet = new Set(navButtons.length ? [...scope.querySelectorAll('.rdp-button_previous, .rdp-button_next, [class*="button_previous"], [class*="button_next"]')] : []);
        const otherControls = [...scope.querySelectorAll('[data-slot="button"], [data-slot="item"]')]
          .filter((el) => !dayButtonSet.has(el) && !navSet.has(el))
          .map((el) => measure(el, 'other'));
        const firstRow = grid ? grid.querySelector('tbody tr') : null;
        const tabTriggers = [...scope.querySelectorAll('[data-slot="tabs-trigger"], [role="tab"]')]
          .map((el) => measure(el, 'tab'));
        const today = [...scope.querySelectorAll('[data-slot="button"]')]
          .find((el) => (el.textContent || '').trim() === 'Today');
        return {
          todayButton: today ? measure(today, 'today') : null,
          tabTriggers,
          viewport: window.innerWidth,
          docScrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
          cellSize: getComputedStyle(scope.querySelector('.rdp-root') || grid || scope).getPropertyValue('--cell-size').trim(),
          dayCells,
          navButtons,
          otherControls,
          columnsInFirstWeek: firstRow ? firstRow.children.length : 0,
        };
      };

      await pause(400);
      let previous = JSON.stringify(read());
      for (let attempt = 0; attempt < 12; attempt++) {
        await pause(150);
        const current = read();
        const serialised = JSON.stringify(current);
        if (serialised === previous) return current;
        previous = serialised;
      }
      return read();
    })()`));
  }
}, 180_000);

afterAll(async () => { await browser?.close(); });

const at = (v: number): Reading => {
  const r = readings.get(v);
  if (!r) throw new Error(`no reading at ${v}`);
  return r;
};

/* ═══ 11 · 🔴 a day cell is usable at 380px ════════════════════════════════ */

describe('11 · a day cell is usable at 380px, and nothing scrolls sideways', () => {
  it('the grid really was rendered, with seven columns', () => {
    // Otherwise every assertion below passes over an empty selector.
    expect(at(380).columnsInFirstWeek, 'the month grid is not seven columns wide').toBe(7);
    expect(at(380).dayCells.length, 'no day cells were measured').toBeGreaterThanOrEqual(28);
  });

  it('🔴 EVERY day cell is at least 44px on both axes at 380px', () => {
    for (const c of at(380).dayCells) {
      expect(c.height, `day "${c.label}" is ${c.height}px tall at 380px`).toBeGreaterThanOrEqual(44);
      expect(c.width, `day "${c.label}" is ${c.width}px wide at 380px`).toBeGreaterThanOrEqual(44);
    }
  });

  it('🔴 and so are the month nav arrows — the control a hand-built grid forgets', () => {
    expect(at(380).navButtons.length, 'no month nav was measured').toBeGreaterThanOrEqual(2);
    for (const c of at(380).navButtons) {
      expect(c.height, `nav "${c.label}" is ${c.height}px tall`).toBeGreaterThanOrEqual(44);
      expect(c.width, `nav "${c.label}" is ${c.width}px wide`).toBeGreaterThanOrEqual(44);
    }
  });

  it('🔴 every other control on the surface clears the thumb floor too', () => {
    const others = at(380).otherControls;
    expect(others.length, 'no other controls were measured').toBeGreaterThanOrEqual(2);
    for (const c of others) {
      expect(c.height, `"${c.label}" is ${c.height}px tall at 380px`).toBeGreaterThanOrEqual(44);
    }
  });

  it('🔴 and the page body does not scroll sideways at ANY width', () => {
    for (const v of VIEWPORTS) {
      const r = at(v);
      expect(r.docScrollWidth, `the document scrolls sideways at ${v}px`).toBeLessThanOrEqual(v);
      expect(r.bodyScrollWidth, `the body scrolls sideways at ${v}px`).toBeLessThanOrEqual(v);
    }
  });

  it('⚠️ width is not monotonic, so the grid is measured at all five widths', () => {
    // #429 measured a panel FALLING at 1024; #426 measured a card falling twice,
    // narrowest at 1280. Recorded rather than asserted as increasing.
    for (const v of VIEWPORTS) {
      expect(at(v).columnsInFirstWeek, `the grid lost a column at ${v}px`).toBe(7);
      expect(at(v).dayCells.length, `the grid lost cells at ${v}px`).toBeGreaterThanOrEqual(28);
    }
  });
});

/* ═══ 13 · Rule 4 above sm ═════════════════════════════════════════════════ */

describe('13 · above sm Rule 4 takes over, deliberately under 44', () => {
  it('DENSITY_PX.control is under 44 on purpose — a pointer is not a thumb', () => {
    expect(DENSITY_PX.control).toBeLessThan(44);
  });

  /**
   * 🔴 A DAY CELL IS NOT A FORM CONTROL, AND THIS IS WHERE THAT WAS SETTLED BY
   * MEASUREMENT RATHER THAN BY ASSUMPTION.
   *
   * ⚠️ The first spelling of this test asserted the desktop cell was EXACTLY
   * Rule 4's 38px, and Chromium answered 100.58px at 768. The assertion was
   * wrong, not the layout: `CalendarDayButton` is `w-full min-w-(--cell-size)`
   * and `aspect-square`, so on a full-width grid the cell takes a SEVENTH OF
   * THE MEASURE and squares itself. `--cell-size` is its FLOOR, never its size.
   *
   * That is the right behaviour and pinning 38px would have been a defect
   * dressed as compliance: seven 38px cells is a 266px month grid marooned in a
   * 940px measure, and Rule 4 exists to make FORM CONTROLS a consistent
   * density, not to cap a data grid at the height of a text input.
   *
   * So what is asserted above `sm` is the two things that are actually claimed:
   * the phone floor is RELEASED (the cause — proven on `--cell-size` above and
   * on a real control below), and the cell never falls BELOW Rule 4's density.
   */
  it(`🔴 from 768 up a day cell is at least Rule 4's ${DENSITY_PX.control}px, and grows with the grid`, () => {
    for (const v of [768, 1024, 1280, 1440]) {
      const cells = at(v).dayCells;
      expect(cells.length, `no day cells at ${v}`).toBeGreaterThanOrEqual(28);
      for (const c of cells) {
        expect(
          c.height,
          `day "${c.label}" is ${c.height}px at ${v}px — below Rule 4's ${DENSITY_PX.control}`,
        ).toBeGreaterThanOrEqual(DENSITY_PX.control);
      }
      // Square, because the grid is what sizes it — not a fixed control height.
      for (const c of cells) expect(c.width).toBeCloseTo(c.height, 0);
    }
  });

  it('🔴 and the phone floor is RELEASED above sm on a real control, not merely absent', () => {
    // The Today button is a form-shaped control, so it carries the explicit
    // `min-h-[44px] sm:min-h-0` pair. Without the release `min-height` would
    // beat `height` and it would still be 44 up here — measuring the release is
    // the only way to know the `sm:` half took.
    const small = at(380).todayButton;
    expect(small, 'the Today button was never measured').toBeTruthy();
    expect(parseFloat(small!.minHeight), 'Today has no 44px floor at 380px').toBeGreaterThanOrEqual(44);
    expect(small!.height).toBeGreaterThanOrEqual(44);

    for (const v of [768, 1024, 1280, 1440]) {
      const big = at(v).todayButton;
      expect(big, `the Today button vanished at ${v}`).toBeTruthy();
      expect(parseFloat(big!.minHeight) || 0, `the 44px floor survived at ${v}px`).toBeLessThan(44);
      // 🔴 And it lands ON Rule 4's density, not merely under the phone floor.
      // Measured, `size="sm"` put this at 25.38px — released, but off-density
      // and out of step with every other control on an admin screen.
      expect(big!.height, `Today is ${big!.height}px at ${v}px, not Rule 4's ${DENSITY_PX.control}`)
        .toBeCloseTo(DENSITY_PX.control, 0);
    }
  });

  it('🔴 and the release is what does it — the floor is present at 380 and gone above', () => {
    // Asserting the CAUSE, not just the number: without `sm:[--cell-size:38px]`
    // the 44px would simply persist upward and this would still read 44.
    expect(at(380).cellSize).toBe('44px');
    for (const v of [768, 1024, 1280, 1440]) {
      expect(at(v).cellSize, `--cell-size did not release at ${v}px`).toBe(`${DENSITY_PX.control}px`);
    }
  });
});


/* ═══ 13b · 🔴 the tab bar — the two controls that reach the grid ══════════ */

describe('13b · the tab pair is a real target at 380px', () => {
  /**
   * 🔴 THIS IS THE ONE THE FIRST CUT OF THIS SUITE MISSED, and it was a real
   * defect, not a missing assertion about a passing surface.
   *
   * The tab bar lives on the SCREEN, not in `EventMonthView`, so measuring the
   * view alone never touched it. Measured, the triggers were 44px TALL — the
   * `min-h-[44px]` beat `tabs`' own `h-8` on the list — and "List" was
   * 35.6px WIDE, because a trigger is only as wide as its word plus `px-1.5`.
   * A four-letter label made a target that failed on one axis and passed on the
   * other, which is exactly the shape a screenshot cannot show.
   *
   * `min-w-[44px] sm:min-w-0` is the fix, and it is the SAME pair THE-304
   * already spells for the icon-only controls on the option editor, for the
   * same reason: height alone does not make a target when the content is
   * narrow.
   */
  it('🔴 both triggers clear 44px on BOTH axes at 380px', () => {
    const tabs = at(380).tabTriggers;
    expect(tabs.length, 'the tab bar was not measured').toBe(2);
    for (const t of tabs) {
      expect(t.height, `tab "${t.label}" is ${t.height}px tall at 380px`).toBeGreaterThanOrEqual(44);
      expect(t.width, `tab "${t.label}" is ${t.width}px wide at 380px`).toBeGreaterThanOrEqual(44);
    }
  });

  it('and the floor is released above sm, like every other control', () => {
    for (const v of [768, 1024, 1280, 1440]) {
      for (const t of at(v).tabTriggers) {
        expect(t.height, `tab "${t.label}" kept the phone floor at ${v}px`).toBeLessThan(44);
      }
    }
  });

  /**
   * ⚠️ THE REPLICA IS PINNED, because this one IS a replica: `AdminEvents.tsx`
   * imports Firestore, `qrcode` and the app store, so it cannot be rendered to
   * a string here the way `EventMonthView` can. So the markup above is asserted
   * to be the markup that ships — class for class — and drifts loudly if the
   * screen's tab bar is edited without this suite.
   */
  it('the replica matches the tab bar AdminEvents actually renders', () => {
    const screen = readFileSync(path.join(REPO_ROOT, 'src/components/AdminEvents.tsx'), 'utf8');
    for (const line of [
      '<TabsTrigger value="list" className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0">List</TabsTrigger>',
      '<TabsTrigger value="month" className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0">Month</TabsTrigger>',
    ]) {
      expect(screen, `the shipped tab bar no longer contains: ${line}`).toContain(line);
    }
  });
});
