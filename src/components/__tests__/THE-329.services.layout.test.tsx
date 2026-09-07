// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom. happy-dom has NO LAYOUT ENGINE — with the real
// compiled stylesheet injected, `getBoundingClientRect()` returns zeros on every
// element and `getComputedStyle(el).display` answers `block` for a flex
// container. "Is this control 44px" is a question about boxes and cannot be
// asked of a source string or of a DOM with no layout. Everything below is
// measured in real Chromium over CDP (`src/test/support/browser-measure.ts`).
// No Playwright, no devDependency, no browser download.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { FORM_CONTAINER, DENSITY_PX, DESKTOP_CONTROL_MAX_PX } from '../layout/form-layout';
import ServiceCreateForm from '../events/ServiceCreateForm';

/**
 * THE-329 — the create-a-service form, measured.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 WHAT THIS FILE IS FOR
 *
 * A church creates a service on a phone at the side of a stage, so every
 * tappable target on this form must be ≥44px BELOW `sm`, and Rule 4's desktop
 * density (38px controls, 40px actions) must hold from 640px up.
 *
 * ⚠️ MEASURED TRAPS THIS FILE EXISTS TO CATCH, all three of them previously real
 * in this repo:
 *
 *   · `select` sets its height with `data-[size=default]:h-9` — an ATTRIBUTE
 *     selector that OUTRANKS a plain `sm:h-[38px]`, so a control that looks
 *     answered in the source measures 32px. `CONTROL` answers it at the same
 *     specificity, and only a measurement proves that worked.
 *   · `input` and `button` carry `h-8` (32px). `min-h-[44px]` beats a leaked
 *     `h-` outright because `min-height` is a DIFFERENT PROPERTY — asserted, not
 *     assumed. 🔴 `min-h-11` is NOT inert and neither is `min-h-[44px]`.
 *   · BOTH AXES. THE-326 found a tab 44px tall and 35.6px WIDE. A target that
 *     is tall enough and 35px wide is still a miss, so width is asserted too.
 *
 * ⚠️ WIDTH IS NOT MONOTONIC on this shell, so the ladder is measured WHOLE at
 * 380 / 768 / 1024 / 1280 / 1440 rather than at the ends.
 * ⚠️ `transition-all` is on the button and the select trigger, so an immediate
 * post-resize reading is a LIE — `settle()` inside `evaluateAt` loops until two
 * readings agree, and a drifting value would show as a control whose height
 * disagrees with itself between widths.
 * ⚠️ ONE `MeasuringBrowser` in this process. Two collide on a PID-derived
 * debugger port and silently compare a page with itself.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ⚠️ THE FIXTURE'S DATES ARE FAR FROM TODAY — #468's fuse. A fixture pinned to
 * a date near the runner's clock turned `main` red for everyone the moment the
 * clock passed it. {@link NOW} is 2031, built from NUMBERS rather than an ISO
 * literal, because an ISO literal with no offset is parsed in the RUNNER'S
 * timezone and would encode the runner into every boundary derived from it.
 * No timer is faked here at all: the component takes its dates as props.
 */

const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

/** Wed 7 May 2031, 09:00 local. Five years out; no clock reaches it. */
const NOW = new Date(2031, 4, 7, 9, 0, 0);
const SUN_11 = new Date(2031, 4, 11, 10, 0, 0);
const SUN_18 = new Date(2031, 4, 18, 10, 0, 0);

/** The section's own formatter, so the labels are the shipped ones. */
const fmtDay = (d: Date): string =>
  `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()} `
  + `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`;

/**
 * ⚠️ LONG LABELS ON PURPOSE. A form measured with "Carols" in the event picker
 * proves nothing about the one a real church fills in — THE-326's overlap was
 * found by a label that did not fit, not by a short one.
 */
const EVENTS = [
  { id: 'e1', title: 'Carols by Candlelight — the whole parish, 6pm', startsAt: SUN_18 },
  { id: 'e2', title: 'Sunday Worship Gathering', startsAt: SUN_11 },
];

const TEMPLATES = [
  { id: 't1', name: 'Sunday Morning' },
  { id: 't2', name: 'Evening Prayer and Communion' },
];

interface Control {
  label: string;
  tag: string;
  width: number;
  height: number;
  scrollWidth: number;
  clientWidth: number;
}

interface Reading {
  viewport: number;
  bodyScrollWidth: number;
  controls: Control[];
  /** Every run of 12+ digits in the page's RENDERED text — THE-326's raw epoch. */
  epochs: string[];
  /** Every element carrying an inline `style` attribute, named so a failure says which. */
  inlineStyled: string[];
}

let browser: MeasuringBrowser;
const readings = new Map<number, Reading>();

beforeAll(async () => {
  const css = await buildAppCss();

  const page = renderToStaticMarkup(
    <div className="flex h-screen">
      <div className="hidden lg:block w-64 shrink-0" />
      <div className="min-w-0 flex-1 flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto pb-24 lg:pb-8 p-0 lg:p-6">
          <div className={`w-full ${FORM_CONTAINER} space-y-6`}>
            <ServiceCreateForm
              events={EVENTS}
              templates={TEMPLATES}
              formatDay={fmtDay}
              busy={false}
              onCreate={() => {}}
            />
          </div>
        </div>
      </div>
    </div>,
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the329-'));
  const file = path.join(dir, 'service-create.html');
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${page}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const viewport of VIEWPORTS) {
    readings.set(viewport, await browser.evaluateAt<Reading>(viewport, `(async () => {
      /* 🔴 LOOP UNTIL TWO READINGS MATCH. The submit button carries the button
         primitive's own transition-all, and min-height is an ANIMATABLE
         property - so the first frame after a resize reports the value the
         transition is on its way FROM, not the one it lands on. Measured: 1.47px
         on one run and 1.43px on the next, drifting, which is the tell. Two
         requestAnimationFrames (what the harness settles by) is not enough for a
         transition, so this waits for the page to stop moving before it reads.

         ⚠️ NOT "disable transitions and measure" - that would measure a page
         this product never ships. The transition is real and the reading waits
         for it. */
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const heights = () => [...document.querySelectorAll(
        '[data-slot="select-trigger"], [data-slot="button"], [data-slot="input"], input'
      )].map((el) => Math.round(el.getBoundingClientRect().height * 100) / 100).join(',');
      let previous = '';
      for (let i = 0; i < 120; i++) {
        await frame();
        const now = heights();
        if (now === previous && now !== '') break;
        previous = now;
      }
      return (() => {
      /* THE VISIBLE, TAPPABLE CONTROLS ONLY. The select primitive renders a
         HIDDEN native input of its own (base-ui form-association shim, 1px and
         aria-hidden) so a form can submit its value. It is the primitive's own
         internal, pinned by ds-primitives.test.tsx, and it is not a target a
         finger can reach: sweeping it would make this file assert that a shim
         is 44px tall. The filter is on what the BROWSER reports rather than on
         a name - aria-hidden, hidden, or a zero-ish box. */
      const controls = [...document.querySelectorAll(
        '[data-slot="select-trigger"], [data-slot="button"], [data-slot="input"], input'
      )].filter((el) => {
        if (el.closest('[aria-hidden="true"]') || el.getAttribute('aria-hidden') === 'true') return false;
        if (el.hasAttribute('hidden') || el.type === 'hidden') return false;
        const b = el.getBoundingClientRect();
        return b.width > 2 && b.height > 2;
      }).map((el) => {
        const b = el.getBoundingClientRect();
        return {
          label: (el.getAttribute('aria-label') || el.getAttribute('id') || el.textContent || '')
            .trim().slice(0, 48),
          tag: el.tagName.toLowerCase(),
          width: b.width, height: b.height,
          scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
        };
      });
      const text = document.body.innerText || '';
      return {
        viewport: window.innerWidth,
        bodyScrollWidth: document.documentElement.scrollWidth,
        controls,
        epochs: text.match(/\\b\\d{12,}\\b/g) || [],
        /* Same exclusion, same reason: the primitive's own hidden shim carries
           an inline style this ticket did not write and may not remove. What is
           asserted is that THE-329's OWN markup spells none. */
        inlineStyled: [...document.querySelectorAll('[style]')]
          .filter((el) => !(el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('hidden') || el.type === 'hidden'))
          .map((el) => el.tagName.toLowerCase() + (el.getAttribute('data-slot') ? '[' + el.getAttribute('data-slot') + ']' : '')),
      };
      })();
    })()`));
  }
}, 180_000);

afterAll(async () => { await browser?.close(); });

const at = (v: number): Reading => {
  const r = readings.get(v);
  if (!r) throw new Error(`no reading at ${v}px`);
  return r;
};

/* ═══ 16 · 🔴 EVERY CONTROL ≥44px BELOW sm; RULE 4's 38/40px ABOVE ════════ */

describe('16 · every control is ≥44px below sm, and Rule 4 holds above it', () => {
  it('the ladder was measured whole — width is not monotonic on this shell', () => {
    expect([...readings.keys()].sort((a, b) => a - b)).toEqual([...VIEWPORTS]);
    for (const v of VIEWPORTS) expect(at(v).viewport, `the ${v}px reading is at the wrong width`).toBe(v);
  });

  it('🔴 the form renders its controls at all — an empty sweep proves nothing', () => {
    // ⚠️ The failure this repo has had NINE TIMES: a guard that passes because
    // it found nothing to check. Five controls: name, date, template, event,
    // submit.
    for (const v of VIEWPORTS) {
      expect(at(v).controls.length, `no control was measured at ${v}px`).toBeGreaterThanOrEqual(5);
    }
  });

  it('🔴 at 380px every control is at least 44px TALL', () => {
    for (const c of at(380).controls) {
      expect(c.height, `"${c.label}" (${c.tag}) is ${c.height}px tall at 380px`)
        .toBeGreaterThanOrEqual(44);
    }
  });

  it('🔴 and at least 44px WIDE — THE-326 found one 44px tall and 35.6px wide', () => {
    for (const c of at(380).controls) {
      expect(c.width, `"${c.label}" (${c.tag}) is ${c.width}px wide at 380px`)
        .toBeGreaterThanOrEqual(44);
    }
  });

  it('🔴 from sm up, Rule 4\'s density holds and nothing exceeds the band', () => {
    // ⚠️ `DENSITY_PX.control < 44` DELIBERATELY — Rule 4 fixes a desktop control
    // at 38px and an action at 40px, and a test elsewhere asserts that
    // inequality on purpose. So the phone floor must be RELEASED above `sm`,
    // not merely satisfied: a control still 44px at 1280px means `sm:min-h-0`
    // did not take and Rule 4 is being overridden by the floor.
    expect(DENSITY_PX.control).toBeLessThan(44);
    for (const v of [768, 1024, 1280, 1440] as const) {
      for (const c of at(v).controls) {
        expect(c.height, `"${c.label}" is ${c.height}px at ${v}px — above the density band`)
          .toBeLessThanOrEqual(DESKTOP_CONTROL_MAX_PX);
        expect(c.height, `"${c.label}" is ${c.height}px at ${v}px — below the density band`)
          .toBeGreaterThanOrEqual(DENSITY_PX.control - 1);
      }
    }
  });

  it('🔴 the select trigger is answered at the attribute selector\'s own specificity', () => {
    // The trap, isolated: `data-[size=default]:h-9` is 36px and would win over a
    // plain `sm:h-[38px]`. If the fix had not taken, these read 36 and not 38.
    for (const v of [768, 1440] as const) {
      const triggers = at(v).controls.filter((c) => c.tag === 'button' && /Attach|template/i.test(c.label));
      expect(triggers.length, `no select trigger was measured at ${v}px`).toBeGreaterThan(0);
      for (const t of triggers) {
        expect(t.height, `the "${t.label}" select is ${t.height}px at ${v}px, not Rule 4's 38px`)
          .toBe(DENSITY_PX.control);
      }
    }
  });

  it('no control overflows its own box at any of the five widths', () => {
    for (const v of VIEWPORTS) {
      for (const c of at(v).controls) {
        expect(c.scrollWidth, `"${c.label}" overflows by ${c.scrollWidth - c.clientWidth}px at ${v}px`)
          .toBeLessThanOrEqual(c.clientWidth + 1);
      }
    }
  });

  it('and the page never scrolls sideways', () => {
    for (const v of VIEWPORTS) {
      expect(at(v).bodyScrollWidth, `the page scrolls sideways at ${v}px`)
        .toBeLessThanOrEqual(v + 1);
    }
  });
});

/* ═══ 15 (measured half) · NO INLINE STYLE, NO RAW EPOCH ═════════════════ */

describe('15 · inline styles stay at zero, and no raw epoch reaches the screen', () => {
  it('🔴 nothing this form renders carries an inline style attribute', () => {
    for (const v of VIEWPORTS) {
      expect(at(v).inlineStyled, `inline styles rendered at ${v}px`).toEqual([]);
    }
  });

  it('🔴 and no bare millisecond value is painted — THE-326\'s `1788513540000`', () => {
    // `Select.Value` with no children renders the VALUE, and this form's event
    // picker holds ids while its labels hold dates. The sweep is of RENDERED
    // TEXT, which a hardcoded label could not satisfy.
    for (const v of VIEWPORTS) {
      expect(at(v).epochs, `a raw epoch is painted at ${v}px`).toEqual([]);
    }
  });

  it('the closed pickers read back their LABELS, not their values', () => {
    // ⚠️ At rest both selects show their sentinel's label, which is what a
    // church sees before choosing anything.
    for (const v of VIEWPORTS) {
      const labels = at(v).controls.map((c) => c.label).join(' | ');
      expect(labels, `the event picker shows an id at ${v}px`).not.toMatch(/__none__|__blank__/);
    }
  });
});
