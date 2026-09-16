// @vitest-environment node
//
// 🔴 THE `node` PRAGMA IS LOAD-BEARING. `happy-dom` has NO LAYOUT ENGINE —
// `getBoundingClientRect()` answers zeroes — and with happy-dom selected
// `MeasuringBrowser` never attaches and the suite times out. Every number below
// is measured inside a real Chromium over CDP.
//
// ONE `MeasuringBrowser` PER PROCESS: two instances in one process collide on
// the debugger port.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildCssForMarkup } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { setUpOrFail } from '../../test/support/suite-setup';
import { CONTROL_DENSITY, DENSITY_PX } from '../layout/form-layout';

/**
 * THE-369 · 🔴 EVERY CONTROL THIS TICKET ADDS CLEARS BOTH FLOORS — MEASURED.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ `Button`'s INTRINSIC SIZES ARE 24 / 28 / 32 / 36px — `xs` h-6, `sm` h-7,
 * `default` h-8, `lg` h-9 — and EVERY ONE is below BOTH floors (#500). So every
 * control here carries its own: `min-h-11` (44px) below `sm`, released by
 * `sm:min-h-0` and replaced above it by `CONTROL_DENSITY.control`, Rule 4's
 * 38px. The token is IMPORTED by the component rather than respelled, and
 * imported again here rather than retyped, so this suite cannot measure a number
 * the rule has since moved away from.
 *
 * 🔴 THE CLASS STRINGS ARE DISCOVERED FROM THE SHIPPED SOURCE, NOT RETYPED.
 * THE-346 found this by mutation: a replica whose classes are hand-written here
 * measures a FICTION the moment the component drifts, and reports it as a pass.
 * `discover()` pulls the exact string out of `AdminCRM.tsx` and THROWS if the
 * surface moved — a discovery that finds nothing must never fall back to a
 * default, because a default turns "the component changed" into "it is fine".
 *
 * 🔴 AND ANIMATION IS SUPPRESSED BEFORE MEASURING. The row trigger carries
 * `transition-colors`; `settle()` waits two animation frames (~32ms), well
 * inside a 150ms transition, so an un-suppressed page reports a DRIFTING
 * mid-flight value. #490 measured a `min-h-[44px]` control at 7.7469px for
 * exactly this reason, and #511 found THE-327 was the last measuring suite not
 * doing it — `transition-all` animates width and height, the exact numbers a
 * probe reads.
 *
 * 🔴 NOTHING IS PINNED TO A LINE NUMBER, and there is no date fixture here.
 */

/** A phone, the `sm` boundary either side, and two desktops. */
const VIEWPORTS = [380, 639, 640, 768, 1280] as const;

/** #500's floor below `sm`, and Rule 4's control height above it. */
const TOUCH_FLOOR_PX = 44;
const RULE_4_PX = DENSITY_PX.control;

const ROOT = process.cwd();
const CRM = 'src/components/AdminCRM.tsx';
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** Pull one capture out of a file, or throw naming the file and the pattern. */
function discover(rel: string, re: RegExp, what: string): string {
  const m = read(rel).match(re);
  if (!m) throw new Error(`${what}: no match for ${re} in ${rel} — the surface moved`);
  return m[1];
}

/** Resolve the one interpolation every control here spells. */
const resolve = (cls: string) =>
  cls.replace('${CONTROL_DENSITY.control}', CONTROL_DENSITY.control).trim();

/** The ⋯ trigger on a timeline row. */
const triggerClass = resolve(discover(
  CRM,
  /data-activity-menu=\{act\.id\}\s*\n\s*className=\{`([^`]*)`\}/,
  'the row trigger class string',
));

/** The dialog's Cancel and Delete buttons, and the refusal's Close. */
const cancelClass = resolve(discover(
  CRM,
  /disabled=\{deletingActivity\}\s*\n\s*className=\{`(flex-1[^`]*text-muted[^`]*)`\}/,
  'the cancel button class string',
));
const deleteClass = resolve(discover(
  CRM,
  /data-testid="crm-confirm-delete-activity"\s*\n\s*className=\{`([^`]*)`\}/,
  'the delete button class string',
));
const closeClass = resolve(discover(
  CRM,
  /setActivityDeleteError\(null\); \}\}\s*\n\s*className=\{`(mt-5[^`]*)`\}/,
  'the refusal close button class string',
));

const CONTROLS = [
  ['row-trigger', triggerClass, '<svg width="16" height="16" aria-hidden="true"></svg>'],
  ['cancel', cancelClass, 'Cancel'],
  ['delete', deleteClass, 'Delete'],
  ['close', closeClass, 'Close'],
] as const;

const IDS = CONTROLS.map(([id]) => id);

/**
 * The replica. Every control sits in a box the width of the real dialog so a
 * label that would WRAP — and a wrapped label is a control taller than the rule
 * fixes — shows here and nowhere else.
 */
const page = () =>
  `<div class="min-h-screen bg-surface-sunken">
     <div class="p-4 max-w-md mx-auto space-y-4">
       ${CONTROLS.map(([id, cls, inner]) =>
         `<button data-control="${id}" class="${cls}">${inner}</button>`).join('\n')}
     </div>
   </div>`;

interface Box { w: number; h: number }
interface Reading {
  viewport: number;
  scrollWidth: number;
  controls: Record<string, Box | null>;
  transition: string;
}

let browser: MeasuringBrowser | null = null;
const readings: Reading[] = [];

afterAll(async () => { await browser?.close(); browser = null; });

setUpOrFail(async () => {
  const markup = page();
  const css = await buildCssForMarkup(markup);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'the369-'));
  const file = path.join(dir, 'activity-delete-controls.html');
  writeFileSync(
    file,
    '<!doctype html><html data-theme="light"><head><meta charset="utf-8">'
      + `<style>${css}</style>`
      // 🔴 SUPPRESS ANIMATION BEFORE MEASURING. See the header.
      + '<style>*,*::before,*::after{transition:none !important;animation:none !important}</style>'
      + `</head><body>${markup}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const viewport of VIEWPORTS) {
    readings.push(await browser.evaluateAt<Reading>(
      viewport,
      `(() => {
        const round = (n) => Math.round(n * 100) / 100;
        const box = (id) => {
          const el = document.querySelector('[data-control="' + id + '"]');
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { w: round(b.width), h: round(b.height) };
        };
        const ids = ${JSON.stringify(IDS)};
        const controls = {};
        for (const id of ids) controls[id] = box(id);
        const first = document.querySelector('[data-control="row-trigger"]');
        return {
          viewport: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          controls,
          transition: first ? getComputedStyle(first).transitionDuration : 'missing',
        };
      })()`,
    ));
  }
});

describe('14 · every control is ≥44px below sm, and Rule 4’s 38px holds above', () => {
  it('the replica resolved — the classes came off the shipped component', () => {
    // A discovery that silently returned nothing would make every measurement
    // below a measurement of an unstyled button.
    for (const [id, cls] of CONTROLS) {
      expect(cls, `${id}'s class string is empty`).not.toBe('');
      expect(cls, `${id} lost its phone floor`).toContain('min-h-11');
      expect(cls, `${id} never releases the phone floor`).toContain('sm:min-h-0');
      expect(cls, `${id} does not carry Rule 4's control height`).toContain(CONTROL_DENSITY.control);
    }
    expect(readings, 'no viewport was measured').toHaveLength(VIEWPORTS.length);
  });

  it('🔴 animation really was suppressed — otherwise every number is mid-flight', () => {
    // #490's defect, asserted rather than assumed: the page reports zero
    // transition duration, so `settle()` cannot have caught a drifting value.
    for (const r of readings) {
      expect(r.transition, `transitions are live at ${r.viewport}px`).toMatch(/^0s(,\s*0s)*$/);
    }
  });

  it.each(VIEWPORTS.filter((v) => v < 640))('at %ipx every control is at least 44px tall', (viewport) => {
    const r = readings.find((x) => x.viewport === viewport)!;
    for (const id of IDS) {
      const box = r.controls[id];
      expect(box, `${id} did not render at ${viewport}px`).toBeTruthy();
      expect(box!.h, `${id} is ${box!.h}px at ${viewport}px — below the 44px tap floor`)
        .toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
    }
  });

  it.each(VIEWPORTS.filter((v) => v < 640))('at %ipx the row trigger is 44px WIDE too', (viewport) => {
    // THE-308 found a tab that cleared the floor on height while measuring
    // 35.6px WIDE. An icon-only control is exactly the shape that does that.
    const r = readings.find((x) => x.viewport === viewport)!;
    expect(r.controls['row-trigger']!.w,
      `the row trigger is ${r.controls['row-trigger']!.w}px wide at ${viewport}px`)
      .toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
  });

  it.each(VIEWPORTS.filter((v) => v >= 640))('at %ipx every control sits at Rule 4 38px', (viewport) => {
    const r = readings.find((x) => x.viewport === viewport)!;
    for (const id of IDS) {
      const box = r.controls[id];
      expect(box, `${id} did not render at ${viewport}px`).toBeTruthy();
      expect(box!.h, `${id} is ${box!.h}px at ${viewport}px — Rule 4 fixes a control at ${RULE_4_PX}px`)
        .toBe(RULE_4_PX);
    }
  });

  it('🔴 the two floors are actually DIFFERENT, so this suite measures a breakpoint', () => {
    // If `sm:min-h-0` were dropped every control would be 44px everywhere and
    // the Rule 4 assertion would fail; if `min-h-11` were dropped they would be
    // 38px everywhere and the floor assertion would fail.
    for (const id of IDS) {
      const below = readings.find((r) => r.viewport === 639)!.controls[id]!;
      const above = readings.find((r) => r.viewport === 640)!.controls[id]!;
      expect(below.h, `${id} below sm`).toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
      expect(above.h, `${id} above sm`).toBe(RULE_4_PX);
      expect(below.h, `${id} does not change across the breakpoint`).not.toBe(above.h);
    }
  });

  it('🔴 no control overflows its viewport at any width', () => {
    for (const r of readings) {
      expect(r.scrollWidth, `the page scrolls sideways at ${r.viewport}px`)
        .toBeLessThanOrEqual(r.viewport);
    }
  });

  it('🔴 and no control exceeds the desktop density cap', () => {
    for (const r of readings.filter((x) => x.viewport >= 640)) {
      for (const id of IDS) {
        expect(r.controls[id]!.h, `${id} sprawls past the desktop band at ${r.viewport}px`)
          .toBeLessThanOrEqual(DENSITY_PX.action);
      }
    }
  });
});
