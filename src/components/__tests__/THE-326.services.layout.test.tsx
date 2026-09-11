// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom. happy-dom has NO LAYOUT ENGINE — with the real
// compiled stylesheet injected, `getBoundingClientRect()` returns zeros on every
// element. The defect this file exists for is two tab labels PAINTED ON TOP OF
// EACH OTHER, which is a question about boxes and cannot be asked of a source
// string or of a DOM with no layout. Everything below is measured in real
// Chromium over CDP (`src/test/support/browser-measure.ts`).
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { setUpOrFail } from '../../test/support/suite-setup';
import { FORM_CONTAINER } from '../layout/form-layout';
import VolunteerRotaView from '../events/VolunteerRotaView';
import type { ServicePlanItem } from '../events/service-plan';
import type { RotaReadState, RotaService } from '../events/volunteer-rota';

/**
 * THE-326 — the two visible defects in the founder's screenshot, measured.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 DEFECT 1 — "Who is on" AND "Not served recently" PRINTED ON TOP OF EACH
 *    OTHER. AND THE CAUSE WAS NOT THE `h-8` IT LOOKED LIKE.
 *
 * THE-308 recorded 29 `tabs` classes into two cross-screen sweeps, among them
 * `group-data-[orientation=horizontal]/tabs:h-8` and the trigger's
 * `h-[calc(100%-1px)]`, and a list constrained to 32px with labels that do not
 * fit is the obvious suspect. It is not what was happening. Measured on `main`,
 * at 380 / 768 / 1024 / 1280 / 1440:
 *
 *     trigger              width   scrollWidth   clientWidth
 *     Rota                  93.5        91            91
 *     Who is on             93.5        91            91
 *     Not served recently   93.5       115            91     ← 24px OVER
 *
 * The heights were already right — THE-317's `min-h-[51px]` on the list puts
 * every trigger at exactly 44px below `sm`, and this file re-measures that. The
 * overlap was HORIZONTAL, and it had two causes that had to BOTH be undone:
 *
 *   1. `min-w-[44px]` on the triggers, added for the tap-target floor,
 *      OVERRODE the flex default `min-width: auto` — the rule that stops a
 *      `flex-1` item shrinking below its own `white-space: nowrap` text. With
 *      the floor at 44px the three triggers divided the strip into equal thirds
 *      regardless of what was written on them, and `overflow: visible` meant
 *      the 24px that did not fit was PAINTED over the neighbour.
 *   2. `w-fit` on the list (the primitive's own), which sized the strip to
 *      286.34px rather than to its container.
 *
 * ⚠️ EITHER ONE ALONE STILL OVERLAPS AT 380px, and that was measured too:
 * `w-full` on its own leaves the third trigger at 113.3px against a
 * `scrollWidth` of 125. Both together put the narrowest trigger at 94.1px × 44px
 * with no overflow at any of the five widths — which is what section 4 asserts.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 DEFECT 2 — THE DATE SELECTOR RENDERED `1788513540000`.
 *
 * `Select.Value` with no children renders the VALUE, and the value is
 * `String(date.getTime())` because a select's value must be a string and the
 * date is the identity of the row. Section 5 sweeps the RENDERED TEXT of the
 * whole page for a bare 13-digit run, which is the only form of this claim that
 * a hardcoded label could not satisfy.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ⚠️ WIDTH IS NOT MONOTONIC ON THIS SHELL, so the ladder is measured WHOLE.
 * ⚠️ `transition-all` is on the trigger, so an immediate post-resize reading is
 * a lie. `settle()` inside `evaluateAt` handles it, and the readings below are
 * taken once per width after it, then asserted — a drifting value would show as
 * a trigger whose width disagrees with its own `scrollWidth` conclusion.
 * ⚠️ ONE `MeasuringBrowser` in this process. Two collide on a PID-derived
 * debugger port and silently compare a page with itself.
 */

const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

/* ═════════════════════════════════════════════════════════════════════════════
   The fixture.

   🔴 THE CLOCK IS FROZEN AND THE DATES ARE FAR FROM TODAY — the #468 fuse. A
   fixture pinned to '2026-09-06T10:00' turned `main` red for everyone the moment
   the clock passed it. These Sundays are in 2031 and `now` is stated explicitly
   as a prop rather than read from the system clock, so this file has no fuse to
   blow: `VolunteerRotaView` takes `now`, so no timer needs faking here at all.
   ═══════════════════════════════════════════════════════════════════════════ */

const NOW = new Date(2031, 4, 7, 9, 0, 0);          // Wed 7 May 2031, 09:00

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
    item(`${n}c`, 'Sermon: Ephesians 4 and the shape of a church', 31, 2, ADAEZE),
  ],
});

/** Four Sundays in May 2031 — five years out, so no clock can reach them. */
const SERVICES: RotaService[] = [11, 18, 25].map((day, i) =>
  sunday(i, new Date(2031, 4, day, 10, 0, 0)),
);

const PEOPLE = [
  { id: 'u-0a', name: ADAEZE },
  { id: 'u-0b', name: BENJAMIN },
];

const READ: RotaReadState = {
  failed: false, plansTruncated: false, eventsTruncated: false,
  oldestEventStart: new Date(2029, 0, 1),
};

interface Trigger {
  text: string;
  x: number; right: number; width: number; height: number;
  scrollWidth: number; clientWidth: number;
}
interface Reading {
  bodyScrollWidth: number;
  viewport: number;
  triggers: Trigger[];
  controls: { label: string; width: number; height: number }[];
  /** Every run of 12+ digits in the page's rendered text. */
  epochs: string[];
}

let browser: MeasuringBrowser;
const readings = new Map<number, Reading>();

setUpOrFail(async () => {
  const css = await buildAppCss();

  const page = renderToStaticMarkup(
    <div className="flex h-screen">
      <div className="hidden lg:block w-64 shrink-0" />
      <div className="min-w-0 flex-1 flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto pb-24 lg:pb-8 p-0 lg:p-6">
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
    </div>,
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the326-'));
  const file = path.join(dir, 'services.html');
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${page}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const viewport of VIEWPORTS) {
    readings.set(viewport, await browser.evaluateAt<Reading>(viewport, `(() => {
      const triggers = [...document.querySelectorAll('[data-slot="tabs-trigger"]')].map((el) => {
        const b = el.getBoundingClientRect();
        return {
          text: (el.textContent || '').trim(),
          x: b.x, right: b.right, width: b.width, height: b.height,
          scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
        };
      });
      const controls = [...document.querySelectorAll(
        '[data-slot="select-trigger"], [data-slot="button"], [data-slot="tabs-trigger"]'
      )].map((el) => {
        const b = el.getBoundingClientRect();
        return {
          label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
          width: b.width, height: b.height,
        };
      });
      // 🔴 RENDERED TEXT, not source. innerText collapses what is not shown.
      const text = document.body.innerText || '';
      const epochs = text.match(/\\b\\d{12,}\\b/g) || [];
      return {
        bodyScrollWidth: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        triggers, controls, epochs,
      };
    })()`));
  }
}, 180_000);

afterAll(async () => { await browser?.close(); });

const at = (v: number): Reading => {
  const r = readings.get(v);
  if (!r) throw new Error(`no reading at ${v}px`);
  return r;
};

/* ═══ 4 · 🔴 the tab labels do not overlap ═════════════════════════════════ */

describe('4 · the tab labels do not overlap, measured in Chromium', () => {
  it('the fixture really renders the three tabs — so the rest is not vacuous', () => {
    expect(at(380).triggers.map((t) => t.text))
      .toEqual(['Rota', 'Who is on', 'Not served recently']);
  });

  it.each(VIEWPORTS)('🔴 no trigger overflows its own box at %ipx', (viewport) => {
    /**
     * 🔴 THE DEFECT, STATED AS THE THING THAT WAS TRUE WHEN IT SHIPPED.
     * `scrollWidth > clientWidth` on a `nowrap`, `overflow: visible` element IS
     * the overlap: the excess is not clipped and not wrapped, it is painted over
     * whatever is beside it. On `main` this failed on "Not served recently" at
     * every one of the five widths (115 in 91 at 380px).
     */
    for (const t of at(viewport).triggers) {
      expect(
        t.scrollWidth,
        `"${t.text}" needs ${t.scrollWidth}px inside a ${t.clientWidth}px box at ${viewport}px `
          + '— the label is painted over its neighbour',
      ).toBeLessThanOrEqual(t.clientWidth);
    }
  });

  /**
   * ⚠️ THIS ONE DOES NOT CATCH THE REPORTED DEFECT, AND SAYS SO. Mutation-tested:
   * with `min-w-[44px]` and `w-fit` planted back, the five `scrollWidth`
   * assertions above all fail and THIS ONE STILL PASSES — because the BOXES were
   * always laid end to end. It was the TEXT that escaped its box.
   *
   * 🔴 It is kept because it is a different, non-vacuous invariant — the strip
   * must not stack or reorder its triggers, which is what a wrap or a dropped
   * `flex-direction` would do — but it is NOT the overlap guard, and a reader
   * who mistook it for one would think this defect was covered twice when it is
   * covered once, above.
   */
  it.each(VIEWPORTS)('and no two triggers share any horizontal space at %ipx', (viewport) => {
    const ts = at(viewport).triggers;
    for (let i = 1; i < ts.length; i += 1) {
      expect(
        ts[i].x,
        `"${ts[i].text}" starts at ${ts[i].x} but "${ts[i - 1].text}" runs to ${ts[i - 1].right} at ${viewport}px`,
      ).toBeGreaterThanOrEqual(ts[i - 1].right - 0.5);
    }
  });

  it.each(VIEWPORTS)('and the page still does not scroll sideways at %ipx', (viewport) => {
    // ⚠️ The fix must not buy its room by pushing the document wider — that
    // would trade an overlap for a horizontal scrollbar on a phone.
    expect(at(viewport).bodyScrollWidth, `the document overflows at ${viewport}px`)
      .toBeLessThanOrEqual(viewport);
  });
});

/* ═══ 5 · 🔴 no raw epoch is rendered ══════════════════════════════════════ */

describe('5 · the date selector renders a formatted date, never a raw epoch', () => {
  it.each(VIEWPORTS)('🔴 no bare millisecond value appears in rendered text at %ipx', (viewport) => {
    /**
     * ⚠️ SWEPT OVER `innerText`, NOT OVER SOURCE. The value the trigger printed
     * came from the primitive at render time — it is in no string in this repo —
     * so only rendered text can catch it. A 12-digit-or-longer run is a
     * millisecond timestamp; nothing a church types is that shape.
     */
    expect(at(viewport).epochs, `a raw timestamp reached the screen at ${viewport}px`)
      .toEqual([]);
  });

  /**
   * 🔴 AND HERE IS WHAT THIS PAGE CANNOT SEE, SAID OUT LOUD RATHER THAN LEFT AS
   * A SILENTLY VACUOUS PASS.
   *
   * `Tabs.Panel` defaults to `keepMounted: false`, so only the ACTIVE panel is
   * in this static markup — and the date selector lives in the "Who is on"
   * panel, which is not the default tab. A static render cannot switch it (there
   * is no React on this page to handle the click), and adding `keepMounted` to
   * the shipped component to make a test easier would be changing production
   * code for the test's benefit.
   *
   * ⚠️ SO THE SWEEP ABOVE IS A WHOLE-PAGE FLOOR, NOT THE PROOF ABOUT THE
   * SELECTOR. The proof lives in `THE-326.date-format.test.tsx`, which mounts
   * the view with React, CLICKS through to the panel and reads the trigger's own
   * rendered text. This assertion pins that division so a later reader does not
   * mistake the empty sweep here for the whole claim.
   */
  it('the date selector is NOT on this page, and the claim about it lives elsewhere', () => {
    const selectTriggers = at(380).controls.filter((c) => c.label === 'Service date');
    expect(selectTriggers, 'the panel is mounted after all — fold the date claim back in here')
      .toEqual([]);
  });
});

/* ═══ 14 · 🔴 the 44px floor, and Rule 4 above sm ═════════════════════════ */

describe('14 · every control is ≥44px below sm, and Rule 4 holds above it', () => {
  it('🔴 every control is at least 44px tall at 380px', () => {
    for (const c of at(380).controls) {
      expect(c.height, `"${c.label}" is ${c.height}px tall at 380px`).toBeGreaterThanOrEqual(44);
    }
  });

  it('🔴 and at least 44px WIDE at 380px — which is now carried by content, not by min-w', () => {
    /**
     * ⚠️ THE ONE THIS TICKET HAD TO RE-PROVE. Removing `min-w-[44px]` is what
     * fixes the overlap, and it is also what could have dropped a short label
     * under the thumb floor — the ticket's own warning about a tab measured
     * 44px tall and 35.6px wide. It does not, because the flex `min-width: auto`
     * it restores is the CONTENT width, and the narrowest of the three measures
     * 94.1px. This assertion is what stops a future short label going under.
     */
    for (const c of at(380).controls) {
      expect(c.width, `"${c.label}" is ${c.width}px wide at 380px`).toBeGreaterThanOrEqual(44);
    }
  });

  it.each([768, 1024, 1280, 1440] as const)(
    'and above sm the controls are released, as Rule 4 intends, at %ipx',
    (viewport) => {
      // ⚠️ NOT a floor above `sm`: `DENSITY_PX.control < 44` is asserted
      // deliberately elsewhere. What must hold is that the release really
      // happened — a control still pinned at 44px above `sm` means a `min-h`
      // leaked past its `sm:` gate.
      const tallest = Math.max(...at(viewport).triggers.map((t) => t.height));
      expect(tallest, `a tab trigger is still ${tallest}px at ${viewport}px`).toBeLessThan(44);
    },
  );
});
