// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom. happy-dom has NO LAYOUT ENGINE — with the real
// compiled stylesheet injected, `getBoundingClientRect()` returns zeros on every
// element and `getComputedStyle(el).overflowX` cannot tell a scroller from a
// block. No assertion below could tell a rota that scrolls inside its card from
// one that drags the whole page sideways. Everything here is measured in real
// Chromium over CDP (`src/test/support/browser-measure.ts`), which is why this
// file selects the `node` environment and renders to a string.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { FORM_CONTAINER, DENSITY_PX, DESKTOP_CONTROL_MAX_PX } from '../layout/form-layout';
import { NAV_CLEARANCE } from '../events/ServicePlanRow';
import VolunteerRotaView from '../events/VolunteerRotaView';
import type { ServicePlanItem } from '../events/service-plan';
import type { RotaReadState, RotaService } from '../events/volunteer-rota';

/**
 * THE-317 — WHERE the volunteer rota renders, measured in Chromium.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THIS FILE MOUNTS THE REAL `VolunteerRotaView`. IT IS NOT A REPLICA.
 *
 * ⚠️ Every other Chromium layout suite in this repo renders a hand-written copy
 * of the screen and then needs a second assertion pinning the copy's class
 * strings against the real file, because the copy drifts the moment somebody
 * edits one and not the other. #449 established the better shape by splitting
 * `ServicePlanRow` out of `ServicePlanPanel`, and this ticket keeps it:
 * `VolunteerRotaView.tsx` imports no Firestore, no react-query and no app
 * store, so `renderToStaticMarkup` renders the SHIPPED component and the boxes
 * measured below are the boxes a church sees. There is no replica to pin.
 *
 * The surrounding CHROME — the admin shell and its bottom nav — is still
 * assembled here, because mounting the panel would drag in the whole data
 * layer. `NAV_CLEARANCE` and `FORM_CONTAINER` come from their own modules
 * rather than being retyped, for the same reason.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE CLAIM THIS FILE EXISTS TO MAKE, IN TWO HALVES THAT MUST BOTH HOLD:
 *
 *   A. THE PAGE BODY NEVER SCROLLS SIDEWAYS, at any of the five widths.
 *   B. AND THE SCROLLER GENUINELY OVERFLOWS, so A is not vacuous.
 *
 * ⚠️ HALF B IS #429's LESSON AND IT IS THE ONE THAT IS EASY TO LOSE. A rota
 * whose table happened to fit inside 380px would satisfy A trivially — and so
 * would a rota rendered with two short rows and no person picker. The fixture
 * below is therefore DELIBERATELY HOSTILE: real-length names and item titles,
 * six weeks, and enough rows to reach past the fold. `scrollWidth >
 * clientWidth` on the scroller is asserted at 380px, so the test is measuring a
 * scroller that is really doing something.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ⚠️ WIDTH IS NOT MONOTONIC ON THIS SHELL, so the ladder is measured WHOLE:
 * 380 / 768 / 1024 / 1280 / 1440. #429 measured a panel FALLING at 1024 — the
 * shell takes 275.5px away crossing that line — and #426 measured a card
 * falling twice with its narrowest point at 1280. Measuring only the ends would
 * miss both, and #449 measured this very shell going 380 → 768 → 748.5 →
 * 1004.5 → 1120.
 *
 * 🔴 THE BOTTOM NAV IS `fixed bottom-0` AT `z-[100]` and the ADMIN shell's
 * safe-area class COMPILES TO NOTHING — neither `globals.css` nor the Tailwind
 * config defines it, and #437 fixed that for the MEMBER shell only. So the
 * clearance is EXPLICIT: `NAV_CLEARANCE` on the card, on top of the shell's own
 * `pb-24`, and section 4 measures that the last row clears the nav's top edge
 * at 380px with the page scrolled to the bottom.
 */

const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

/**
 * ⚠️ The admin shell's safe-area class is NOT a rule in this app. Named so a
 * reader does not take the class in the shell replica below for the thing
 * providing the clearance.
 */
const PB_SAFE_IS_INERT =
  'the admin shell still carries the inert class; the clearance measured here is NAV_CLEARANCE plus pb-24';

/* ═════════════════════════════════════════════════════════════════════════════
   The fixture. ⚠️ Deliberately hostile — see half B above. Names and titles are
   the length a church actually types, not `Ada` and `Welcome`.
   ═══════════════════════════════════════════════════════════════════════════ */

const NOW = new Date(2026, 8, 2, 9, 0, 0);

const item = (
  id: string, title: string, minutes: number, order: number, personName: string | null,
): ServicePlanItem => ({
  id, title, minutes, order,
  personId: personName ? `u-${id}` : null,
  personName,
  note: null,
});

const ADAEZE = 'Adaeze Okonkwo-Fitzgerald';
const BENJAMIN = 'Benjamin Achterberg';

const sunday = (n: number, date: Date): RotaService => ({
  eventId: `e${n}`,
  eventTitle: 'Sunday Morning Gathering',
  startsAt: date,
  planId: `p${n}`,
  planName: 'Order of service',
  items: [
    item(`${n}a`, 'Welcome and call to worship', 3, 0, ADAEZE),
    item(`${n}b`, 'Worship set — four songs, band and singers', 22, 1, BENJAMIN),
    item(`${n}c`, 'Notices, birthdays and the offering', 6, 2, null),
    item(`${n}d`, 'Sermon: Ephesians 4 and the shape of a church', 31, 3, ADAEZE),
    item(`${n}e`, 'Response, ministry time and the sending', 12, 4, BENJAMIN),
  ],
});

const SERVICES: RotaService[] = [6, 13, 20, 27].map((day, i) =>
  sunday(i, new Date(2026, 8, day, 10, 0, 0)),
);

const PEOPLE = [
  { id: 'u-0a', name: ADAEZE },
  { id: 'u-0b', name: BENJAMIN },
  { id: 'u-0c', name: 'Christina Balasubramanian' },
];

const READ: RotaReadState = {
  failed: false, plansTruncated: false, eventsTruncated: false,
  oldestEventStart: new Date(2024, 0, 1),
};

/* ═════════════════════════════════════════════════════════════════════════════
   The page. The real view, inside the shell, with the real bottom nav.
   ═══════════════════════════════════════════════════════════════════════════ */

interface Box { x: number; width: number; height: number; right: number; top: number; bottom: number }
interface Scroller { scrollWidth: number; clientWidth: number; overflowX: string }
interface Control { label: string; tag: string; width: number; height: number; minHeight?: string; cssHeight?: string }
interface Reading {
  viewport: number;
  docScrollWidth: number;
  bodyScrollWidth: number;
  card: Box | null;
  scrollers: Scroller[];
  tables: Box[];
  controls: Control[];
  /** The card's own computed `padding-bottom` — what NAV_CLEARANCE spells. */
  cardPaddingBottom: number;
  scrolled: { lastBottom: number; navTop: number } | null;
}

let browser: MeasuringBrowser;
const readings = new Map<number, Reading>();

beforeAll(async () => {
  expect(PB_SAFE_IS_INERT).toBeTruthy();
  const css = await buildAppCss();

  const page = renderToStaticMarkup(
    <div className="flex h-screen">
      {/* The admin nav in its SIDEBAR form, from lg. `w-64` is the shell's own. */}
      <div className="hidden lg:block w-64 shrink-0" />
      <div className="min-w-0 flex-1 flex flex-col">
        {/* AdminDashboard's scroller, class for class. */}
        <div data-shell-scroll className="flex-1 min-h-0 overflow-y-auto pb-24 lg:pb-8 p-0 lg:p-6">
          {/* AdminEvents' rota view wrapper — FORM_CONTAINER, Rule 1a. */}
          <div className={`w-full ${FORM_CONTAINER} space-y-6`}>
            <VolunteerRotaView
              services={SERVICES}
              people={PEOPLE}
              read={READ}
              loading={false}
              now={NOW}
              onAssign={() => {}}
            />
          </div>
        </div>
      </div>
      {/* 🔴 The SAME nav in its bottom-bar form, below lg. Its safe-area class is inert. */}
      <div
        data-shell-bottom-nav
        className="lg:hidden bg-surface-raised border-t border-line flex justify-center py-2 px-2 pb-safe fixed bottom-0 w-full z-[100]"
      >
        <span>Nav</span>
      </div>
    </div>,
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the317-'));
  const file = path.join(dir, 'volunteer-rota.html');
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${page}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const viewport of VIEWPORTS) {
    readings.set(viewport, await browser.evaluateAt<Reading>(viewport, `(() => {
      const box = (el) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x, width: b.width, height: b.height, right: b.right, top: b.top, bottom: b.bottom };
      };
      const card = document.querySelector('[data-rota-card]');
      const scrollers = [...document.querySelectorAll('[data-rota-scroller]')].map((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        overflowX: getComputedStyle(el).overflowX,
      }));
      const tables = [...document.querySelectorAll('[data-slot="table"]')].map(box);

      // Every interactive control the rota renders, with its measured box.
      const controls = [...document.querySelectorAll(
        '[data-slot="select-trigger"], [data-slot="button"], [data-slot="tabs-trigger"]'
      )].map((el) => {
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
          tag: el.tagName.toLowerCase(),
          width: b.width,
          height: b.height,
          minHeight: cs.minHeight,
          cssHeight: cs.height,
        };
      });

      const cardPaddingBottom = card ? parseFloat(getComputedStyle(card).paddingBottom) : 0;

      // 🔴 The nav question is about the viewport's BOTTOM with the page
      // scrolled all the way down — a clearance that only holds at the top of a
      // long page is not a clearance.
      const shell = document.querySelector('[data-shell-scroll]');
      let scrolled = null;
      if (shell) {
        shell.scrollTop = shell.scrollHeight;
        const rows = document.querySelectorAll('[data-slot="table-row"]');
        const last = rows[rows.length - 1];
        const nav = document.querySelector('[data-shell-bottom-nav]');
        if (last && nav) {
          scrolled = {
            lastBottom: last.getBoundingClientRect().bottom,
            navTop: nav.getBoundingClientRect().top,
          };
        }
        shell.scrollTop = 0;
      }

      return {
        viewport: window.innerWidth,
        docScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        card: box(card),
        scrollers,
        tables,
        controls,
        cardPaddingBottom,
        scrolled,
      };
    })()`, 780));
  }
}, 240_000);

afterAll(async () => {
  await browser?.close();
});

const at = (viewport: number): Reading => {
  const r = readings.get(viewport);
  if (!r) throw new Error(`nothing was measured at ${viewport}`);
  return r;
};

/* ═══ 0 · The measurement itself is real ═══════════════════════════════════ */

describe('the measurement is real', () => {
  it('every viewport was measured, and the browser laid the page out', () => {
    for (const v of VIEWPORTS) {
      const r = at(v);
      expect(r.viewport, `the viewport override did not take at ${v}`).toBe(v);
      expect(r.card, `no rota card was found at ${v}`).not.toBeNull();
      expect((r.card as Box).width, `the card has no width at ${v}`).toBeGreaterThan(100);
    }
  });

  it('and the fixture is the hostile one — four services, twenty rows, three tabs', () => {
    // ⚠️ A guard on the FIXTURE, not on the app: a later edit that trimmed this
    // down would make half B below pass by fitting rather than by scrolling.
    expect(SERVICES.length).toBe(4);
    expect(SERVICES.flatMap((s) => s.items).length).toBe(20);
    const r = at(380);
    // Only the Rota tab's content is in the document at rest, so four tables.
    expect(r.tables.length, 'the fixture rendered no table').toBeGreaterThanOrEqual(4);
  });
});

/* ═══ 13 · 🔴 THE ROTA SCROLLS INSIDE ITS CARD, AND THE PAGE BODY DOES NOT
       MOVE — AT 380px AND AT EVERY OTHER WIDTH ═══════════════════════════════ */

describe('the rota scrolls inside its card and the page body does not move', () => {
  it.each(VIEWPORTS)('🔴 HALF A — the page body does not scroll sideways at %ipx', (viewport) => {
    const r = at(viewport);
    // ⚠️ Both, because they can disagree: an overflowing child can extend the
    // documentElement's scroll width while `body` still measures the viewport.
    expect(r.docScrollWidth, `the PAGE scrolls sideways at ${viewport}`).toBeLessThanOrEqual(viewport);
    expect(r.bodyScrollWidth, `the BODY scrolls sideways at ${viewport}`).toBeLessThanOrEqual(viewport);
  });

  it.each(VIEWPORTS)('the card stays inside the viewport at %ipx', (viewport) => {
    const card = at(viewport).card as Box;
    expect(card.x, `the card starts off-screen at ${viewport}`).toBeGreaterThanOrEqual(0);
    expect(card.right, `the card ends past the viewport at ${viewport}`).toBeLessThanOrEqual(viewport + 0.5);
  });

  it('🔴 HALF B — and at 380px the scroller GENUINELY OVERFLOWS, so half A is not vacuous', () => {
    /**
     * #429's lesson: a scroller that fits proves nothing. If a later change made
     * the table narrow enough to fit a phone, this fails and half A stops being
     * evidence of anything.
     *
     * 🔴 AND HALF B IS THE LOAD-BEARING HALF, WHICH IS WORTH SAYING PLAINLY.
     * Mutation-verified: deleting `overflow-x-auto` AND every `min-w-0` down the
     * chain fails THIS assertion and leaves half A green — because the admin
     * shell is `overflow-y-auto`, and CSS computes the other axis to `auto` when
     * one axis is not `visible`, so the SHELL would clip the overflow and the
     * page body would stay put either way. Half A is therefore necessary and not
     * sufficient; what actually proves the rota scrolls INSIDE ITS CARD is that
     * the element carrying `data-rota-scroller` is itself the scroller.
     */
    const r = at(380);
    expect(r.scrollers.length, 'there is no scroller at all').toBeGreaterThan(0);
    for (const s of r.scrollers) {
      expect(s.overflowX, 'the scroller does not scroll on x').toBe('auto');
      expect(s.clientWidth, 'the scroller has no width').toBeGreaterThan(0);
      expect(s.scrollWidth,
        `the scroller fits at 380px (${s.scrollWidth} <= ${s.clientWidth}) — half A proves nothing`)
        .toBeGreaterThan(s.clientWidth);
    }
  });

  it('the overflow is the TABLE\'s and it is contained by the scroller, not by the card', () => {
    const r = at(380);
    // The table really is wider than the card — that is the whole reason the
    // scroller exists — and the card is still inside the viewport, which is only
    // possible because the overflow is clipped at the scroller.
    const card = r.card as Box;
    expect(r.tables[0].width, 'the table is not wider than the card')
      .toBeGreaterThan(card.width);
    expect(card.right).toBeLessThanOrEqual(380.5);
  });

  it('and from 768 up the table has room, so the scroller stops being needed', () => {
    // Not asserted as "no overflow" — a very long person name legitimately still
    // overflows — but the scroller must be a scroller at every width, so the
    // behaviour degrades to nothing rather than to a broken layout.
    for (const v of [768, 1024, 1280, 1440]) {
      for (const s of at(v).scrollers) {
        expect(s.overflowX, `the scroller stopped scrolling at ${v}`).toBe('auto');
      }
    }
  });

  it('width is not monotonic across the ladder, and the whole ladder was measured', () => {
    // ⚠️ Recorded rather than asserted as increasing: #449 measured this shell
    // going 380 → 768 → 748.5 → 1004.5 → 1120, because the sidebar appears at
    // lg and TAKES width away. A test that assumed growth would be wrong here.
    const widths = VIEWPORTS.map((v) => (at(v).card as Box).width);
    expect(widths.length).toBe(5);
    const grewEverywhere = widths.every((w, i) => i === 0 || w > widths[i - 1]);
    expect(grewEverywhere, 'width became monotonic — re-read #429 before trusting the ends').toBe(false);
  });
});

/* ═══ 14 · Every control ≥44px below sm; Rule 4 holds above ════════════════ */

describe('every control is at least 44px below sm, and Rule 4 holds above', () => {
  it('🔴 at 380px every control clears the thumb floor on both axes', () => {
    const controls = at(380).controls;
    expect(controls.length, 'no controls were measured').toBeGreaterThan(3);
    for (const c of controls) {
      expect(c.height, `"${c.label}" is ${c.height}px tall at 380px (min-height ${c.minHeight}, height ${c.cssHeight})`).toBeGreaterThanOrEqual(44);
      expect(c.width, `"${c.label}" is ${c.width}px wide at 380px`).toBeGreaterThanOrEqual(44);
    }
  });

  it('the person picker and the date picker are among them, not just the tabs', () => {
    // ⚠️ Otherwise this passes on a screen whose only 44px controls are the tab
    // triggers, which are the easiest ones to get right.
    const labels = at(380).controls.map((c) => c.label);
    expect(labels.some((l) => l.startsWith('Assign ')), 'no person picker was measured').toBe(true);
    expect(labels.some((l) => l.includes('earlier weeks')), 'no horizon control was measured').toBe(true);
  });

  it('🔴 the horizon arrows stay a 44px square at EVERY width, and that is the measured trade-off', () => {
    /**
     * ⚠️ NOT AN OVERSIGHT, AND NOT Rule 4 BEING IGNORED. Four `sm:`-gated
     * heights were tried on these two controls and every one was measured HERE
     * taking effect at 380px, pulling them to 34–39px — under the thumb floor.
     * `VolunteerRotaView.tsx` lists all four with the numbers each produced.
     *
     * The repo's usual `min-h-[44px] sm:min-h-0` + Rule 4 pairing masks this
     * everywhere else because `min-height` beats `height` outright; `button`
     * sets its own size with `size-8`, so here the height must be spelled and
     * nothing masks it. The phone floor is the harder constraint, so it wins.
     *
     * 🔴 This assertion is what keeps that a DECISION rather than a drift: if a
     * later change makes an `sm:` height work on this control, these stop being
     * 44 above `sm` and this goes red, which is the prompt to revisit it.
     */
    for (const v of VIEWPORTS) {
      const arrows = at(v).controls.filter((c) => c.label.includes('weeks'));
      expect(arrows.length, `no horizon arrow at ${v}`).toBe(2);
      for (const a of arrows) {
        expect(a.height, `an arrow is ${a.height}px at ${v}`).toBe(44);
        expect(a.width, `an arrow is ${a.width}px wide at ${v}`).toBe(44);
      }
    }
    // And Rule 4's cap is what it always was — this ticket does not move it.
    expect(DESKTOP_CONTROL_MAX_PX).toBe(40);
  });

  it('🔴 and from sm up Rule 4 takes over at 38px, which is DELIBERATELY under 44', () => {
    // `DENSITY_PX.control < 44` is asserted in `form-layout.ts` on purpose: a
    // pointer at a desktop is not a thumb. So this is the two rules agreeing,
    // not fighting — and the assertion is that the phone floor is RELEASED
    // above sm rather than that it was never applied.
    expect(DENSITY_PX.control).toBeLessThan(44);
    expect(DENSITY_PX.control).toBeLessThanOrEqual(DESKTOP_CONTROL_MAX_PX);
    for (const v of [768, 1024, 1280, 1440]) {
      const pickers = at(v).controls.filter((c) => c.label.startsWith('Assign '));
      expect(pickers.length, `no person picker at ${v}`).toBeGreaterThan(0);
      for (const c of pickers) {
        expect(c.height, `a picker is ${c.height}px at ${v}, not Rule 4's ${DENSITY_PX.control}`)
          .toBeCloseTo(DENSITY_PX.control, 0);
      }
    }
  });
});

/* ═══ 4 · Bottom-nav clearance, made explicit ══════════════════════════════ */

describe('the bottom nav does not cover the last row', () => {
  it('the card spends NAV_CLEARANCE below lg, and releases it above', () => {
    expect(NAV_CLEARANCE).toContain('lg:pb-0');
    // 120px below lg — the same clearance `AdminForms.tsx` already spends for
    // this nav, on top of the shell's own pb-24.
    expect(at(380).cardPaddingBottom).toBeGreaterThanOrEqual(120);
    expect(at(1440).cardPaddingBottom, 'the clearance is still spent on a desktop').toBeLessThan(120);
  });

  it('🔴 and with the page scrolled to the bottom at 380px, the last row clears the nav', () => {
    const scrolled = at(380).scrolled;
    expect(scrolled, 'the page could not be scrolled to the bottom').not.toBeNull();
    expect((scrolled as { lastBottom: number; navTop: number }).lastBottom,
      'the bottom nav covers the last row of the rota')
      .toBeLessThanOrEqual((scrolled as { lastBottom: number; navTop: number }).navTop);
  });
});
