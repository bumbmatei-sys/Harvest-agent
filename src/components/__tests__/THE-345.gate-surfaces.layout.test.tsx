// @vitest-environment node
//
// NODE, NOT happy-dom. happy-dom has NO LAYOUT ENGINE - with the real compiled
// stylesheet injected, `getBoundingClientRect()` returns zeros and no assertion
// below could tell a 44px tap target from a 28px one. A DOM environment also
// breaks the CDP attach: `browser-measure` reaches the browser's own debugger
// port, which a DOM-emulating global `fetch` treats as cross-origin and blocks.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { CONTROL_DENSITY, DENSITY_PX, FORM_CONTAINER } from '../layout/form-layout';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { PAID_EVENTS_HIDDEN_TITLE, PAID_EVENTS_HIDDEN_MESSAGE } from '../../lib/paid-events-feature';

/**
 * THE-345 - what the two surfaces this ticket adds actually MEASURE.
 *
 * ===========================================================================
 * WHY A REPLICA RATHER THAN THE SCREENS THEMSELVES. Both surfaces are a few
 * elements deep inside components that pull in Firestore, react-query and the
 * app store, none of which will start under `@vitest-environment node`. What is
 * measured here is therefore the EXACT markup those screens render - the same
 * primitive, the same class strings, copied character for character - and the
 * assertion below that those strings are still what the screens spell is what
 * keeps the replica honest. That is the same arrangement THE-313 used for
 * `ServicePlanRow` and THE-317 for the rota panel.
 *
 * TWO SURFACES:
 *   - the paid-events notice on the event form. It carries no control, so what
 *     is at stake is that it does not overflow a phone.
 *   - the "Remove leftover record" button in the dangling-adoption notice. It
 *     IS a tap target, and it is the only one this ticket adds, so it takes the
 *     44px floor below `sm` and releases to Rule 4's 38/40px band above.
 */

const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

/**
 * The button's class string, spelled ONCE here and asserted against the screen.
 * `min-h-11` is 44px and it is NOT inert on this element: the button sits
 * inside an `AlertDescription`, whose type scale would otherwise leave it near
 * 28px on a phone.
 */
const REMOVE_BUTTON_CLASS =
  'rounded-brand border border-line px-3 text-xs font-semibold text-strong '
  + `hover:bg-surface-sunken disabled:opacity-50 min-h-11 sm:min-h-0 ${CONTROL_DENSITY.action}`;

interface Reading {
  scrollWidth: number;
  removeButton: { width: number; height: number } | null;
  notice: { width: number; height: number } | null;
  noticeRight: number;
  bodyRight: number;
}

const readings = new Map<number, Reading>();
let browser: MeasuringBrowser | null = null;

beforeAll(async () => {
  const css = await buildAppCss();

  const page = renderToStaticMarkup(
    <div data-admin-scope="" className={`w-full ${FORM_CONTAINER} space-y-6`}>
      {/* The event form's notice, exactly as AdminEvents renders it. */}
      <Alert data-paid-events-gate="form">
        <AlertTitle>{PAID_EVENTS_HIDDEN_TITLE}</AlertTitle>
        <AlertDescription>{PAID_EVENTS_HIDDEN_MESSAGE}</AlertDescription>
      </Alert>

      {/* The dangling-adoption notice, exactly as AdminCourses renders it. */}
      <Alert data-courses-dangling-adoptions="1">
        <AlertTitle>One adopted course is no longer in the library</AlertTitle>
        <AlertDescription>
          Harvest has removed a course your church had adopted, so it is no
          longer shown here and no longer counts towards your plan. You can clear
          the leftover record now.
          <span className="mt-2 flex flex-wrap gap-2">
            <button type="button" data-remove-leftover="" className={REMOVE_BUTTON_CLASS}>
              Remove leftover record
            </button>
          </span>
        </AlertDescription>
      </Alert>
    </div>,
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the345-'));
  const file = path.join(dir, 'gate-surfaces.html');
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${page}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const viewport of VIEWPORTS) {
    readings.set(viewport, await browser.evaluateAt<Reading>(viewport, `(async () => {
      const box = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { width: b.width, height: b.height };
      };
      const notice = document.querySelector('[data-paid-events-gate="form"]');
      const nb = notice ? notice.getBoundingClientRect() : null;
      return {
        scrollWidth: document.documentElement.scrollWidth,
        removeButton: box('[data-remove-leftover]'),
        notice: box('[data-paid-events-gate="form"]'),
        noticeRight: nb ? nb.right : 0,
        bodyRight: document.body.getBoundingClientRect().right,
      };
    })()`));
  }
}, 120_000);

afterAll(async () => { await browser?.close(); });

const at = (v: number): Reading => {
  const r = readings.get(v);
  if (!r) throw new Error(`no reading at ${v}px`);
  return r;
};

describe('17 · the one control this ticket adds clears 44px below sm', () => {
  it('the remove control was actually measured', () => {
    expect(at(380).removeButton, 'the remove control was not measured at all').toBeTruthy();
    expect(at(380).removeButton!.height, 'the control measured zero - the stylesheet did not apply')
      .toBeGreaterThan(0);
  });

  it('it is at least 44px tall at 380px', () => {
    const b = at(380).removeButton!;
    expect(b.height, `the remove control is ${b.height}px tall at 380px`).toBeGreaterThanOrEqual(44);
  });

  it('and at least 44px wide, so it is a real target on both axes', () => {
    expect(at(380).removeButton!.width).toBeGreaterThanOrEqual(44);
  });

  it("Rule 4's band holds above sm - the control does not stay 44px on a desktop", () => {
    // The 44px floor is a PHONE rule. Above `sm` the shared action token fixes
    // it at 40px, so a form does not sprawl. Both halves are the rule; asserting
    // only the floor would let `min-h-11` leak into the desktop band unnoticed.
    for (const v of [768, 1024, 1280, 1440] as const) {
      const h = at(v).removeButton!.height;
      expect(h, `the remove control is ${h}px tall at ${v}px`).toBe(DENSITY_PX.action);
    }
  });
});

describe('the notices fit a phone', () => {
  it('nothing overflows the viewport at any width', () => {
    for (const v of VIEWPORTS) {
      expect(at(v).scrollWidth, `the page scrolls sideways at ${v}px`).toBeLessThanOrEqual(v);
    }
  });

  it('the paid-events notice renders and is not clipped at 380px', () => {
    const n = at(380).notice;
    expect(n, 'the paid-events notice did not render').toBeTruthy();
    expect(n!.height, 'the notice collapsed to nothing').toBeGreaterThan(0);
    expect(at(380).noticeRight).toBeLessThanOrEqual(at(380).bodyRight);
  });

  it('the notice grows to hold its wording rather than truncating it', () => {
    // The copy is two sentences and both are load-bearing: a church has to learn
    // that it cannot charge AND that registration still works. A notice clipped
    // to one line would deliver only the first.
    expect(at(380).notice!.height, 'the notice is one line tall - the wording is being clipped')
      .toBeGreaterThan(44);
  });
});

describe('the replica really is what the screens render', () => {
  it('AdminCourses spells this exact button class', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(path.resolve(__dirname, '../AdminCourses.tsx'), 'utf8');
    // The screen builds it as a template literal around CONTROL_DENSITY.action;
    // this compares the resolved halves, so a change to either goes red here
    // rather than leaving the measurement describing markup nobody ships.
    expect(src, 'the remove control lost its 44px floor')
      .toContain('min-h-11 sm:min-h-0 ${CONTROL_DENSITY.action}');
    expect(src, 'the remove control stopped spelling the shared border/padding')
      .toContain('rounded-brand border border-line px-3 text-xs font-semibold text-strong');
  });

  it('AdminEvents mounts the same primitive with the same wording', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(path.resolve(__dirname, '../AdminEvents.tsx'), 'utf8');
    expect(src).toContain('data-paid-events-gate="form"');
    expect(src).toContain('<AlertTitle>{PAID_EVENTS_HIDDEN_TITLE}</AlertTitle>');
    expect(src).toContain('<AlertDescription>{PAID_EVENTS_HIDDEN_MESSAGE}</AlertDescription>');
  });
});
