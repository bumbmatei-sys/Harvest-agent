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
 * THE-368 · 🔴 THE GIVING DOCS LINK CLEARS BOTH HEIGHT FLOORS — MEASURED.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ `Button`'s INTRINSIC SIZES ARE 24 / 28 / 32 / 36px — `xs` h-6, `sm` h-7,
 * `default` h-8, `lg` h-9 — and EVERY ONE is below BOTH floors (#500). That is
 * one of the two reasons this control is not a `Button`; the other is that a
 * button competes with the screen's own content, and this must not.
 *
 * So the link carries the floors itself: `min-h-11` (44px) below `sm`, released
 * by `sm:min-h-0` and replaced above it by `CONTROL_DENSITY.control`, Rule 4's
 * 38px. The token is IMPORTED by the component rather than respelled, and
 * imported again here rather than retyped, so this suite cannot measure a
 * number the rule has since moved away from.
 *
 * 🔴 THE CLASS STRINGS ARE DISCOVERED FROM THE SHIPPED SOURCE, NOT RETYPED.
 * THE-346 found this by mutation: a replica whose classes are hand-written here
 * measures a FICTION the moment the component drifts, and reports it as a pass.
 * `discover()` pulls the exact string out of `GivingDocsLink.tsx` and THROWS if
 * the surface moved — a discovery that finds nothing must never fall back to a
 * default, because a default turns "the component changed" into "the component
 * is fine".
 *
 * 🔴 AND ANIMATION IS SUPPRESSED BEFORE MEASURING. The link carries
 * `transition-colors`; `settle()` waits two animation frames (~32ms), well
 * inside a 150ms transition, so an un-suppressed page reports a DRIFTING
 * mid-flight value. #490 measured a `min-h-[44px]` control at 7.7469px for
 * exactly this reason.
 *
 * 🔴 NOTHING IS PINNED TO A LINE NUMBER, and there is no date fixture here.
 */

/** A phone, the `sm` boundary either side, and two desktops. */
const VIEWPORTS = [380, 639, 640, 768, 1280] as const;

/** #500's floor below `sm`, and Rule 4's control height above it. */
const TOUCH_FLOOR_PX = 44;
const RULE_4_PX = DENSITY_PX.control;

const ROOT = process.cwd();
const COMPONENT = 'src/components/admin/GivingDocsLink.tsx';
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Pull one capture out of a file, or throw naming the file and the pattern.
 */
function discover(rel: string, re: RegExp, what: string): string {
  const m = read(rel).match(re);
  if (!m) throw new Error(`${what}: no match for ${re} in ${rel} — the surface moved`);
  return m[1];
}

/**
 * The anchor's own class string, as the component spells it, with the two
 * interpolations resolved: `CONTROL_DENSITY.control` from the real module, and
 * the caller's positioning `className` as empty — the floors are the
 * component's and must hold with no help from any host.
 */
const linkClass = discover(
  COMPONENT,
  /className=\{`([^`]*)`\}/,
  'the link class string',
)
  .replace('${CONTROL_DENSITY.control}', CONTROL_DENSITY.control)
  .replace('${className}', '')
  .trim();

/** The icon size the component renders, discovered rather than assumed. */
const iconPx = Number(discover(COMPONENT, /<BookOpen size=\{(\d+)\}/, 'the icon size'));

/**
 * The replica: the anchor exactly as the component renders it. `BookOpen` is a
 * 14px lucide svg, stood in for by an svg of the same box — the icon's IDENTITY
 * is irrelevant to height, its BOX is not, and rendering React here would need
 * a DOM this suite deliberately does not have.
 */
const link = (id: string, label: string) =>
  `<a data-link="${id}" href="https://example.invalid" target="_blank" rel="noopener" class="${linkClass}">
     <svg width="${iconPx}" height="${iconPx}" class="shrink-0" aria-hidden="true"></svg>
     <span>${label}</span>
   </a>`;

/**
 * All three pages on one page, because the floors must hold for the LONGEST
 * label as well as the shortest — a link that wraps is a link that is taller
 * than the box the rule fixes, and that would show here and nowhere else.
 */
const page = () =>
  `<div class="min-h-screen bg-surface-sunken">
     <div class="p-4 space-y-6 max-w-lg mx-auto">
       ${link('money-flow', 'The money flow')}
       ${link('how-giving-works', 'How giving works')}
       ${link('recording-a-gift', 'Recording a gift')}
     </div>
   </div>`;

interface Box { w: number; h: number; x: number; y: number }
interface Reading {
  viewport: number;
  scrollWidth: number;
  links: Record<string, Box | null>;
  transition: string;
}

const IDS = ['money-flow', 'how-giving-works', 'recording-a-gift'] as const;

let browser: MeasuringBrowser | null = null;
const readings: Reading[] = [];

afterAll(async () => { await browser?.close(); browser = null; });

setUpOrFail(async () => {
  const markup = page();
  const css = await buildCssForMarkup(markup);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'the368-'));
  const file = path.join(dir, 'giving-docs-link.html');
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
    const r = await browser.evaluateAt<Reading>(
      viewport,
      `(() => {
        const round = (n) => Math.round(n * 100) / 100;
        const box = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { w: round(b.width), h: round(b.height), x: round(b.x), y: round(b.y) };
        };
        const first = document.querySelector('[data-link="money-flow"]');
        return {
          viewport: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          links: {
            'money-flow': box('[data-link="money-flow"]'),
            'how-giving-works': box('[data-link="how-giving-works"]'),
            'recording-a-gift': box('[data-link="recording-a-gift"]'),
          },
          transition: first ? getComputedStyle(first).transitionDuration : 'missing',
        };
      })()`,
    );
    readings.push(r);
  }
});

describe('11 · every link is ≥44px below sm, and Rule 4 38px holds above', () => {
  it('the replica resolved — the classes came off the shipped component', () => {
    // A discovery that silently returned nothing would make every measurement
    // below a measurement of an unstyled anchor.
    expect(linkClass, 'the class string is empty').not.toBe('');
    expect(linkClass).toContain('min-h-11');
    expect(linkClass).toContain('sm:min-h-0');
    expect(linkClass).toContain(CONTROL_DENSITY.control);
    expect(iconPx).toBeGreaterThan(0);
    expect(readings, 'no viewport was measured').toHaveLength(VIEWPORTS.length);
  });

  it('🔴 animation really was suppressed — otherwise every number is mid-flight', () => {
    // #490's defect, asserted rather than assumed: the page reports zero
    // transition duration, so `settle()` cannot have caught a drifting value.
    for (const r of readings) {
      expect(r.transition, `transitions are live at ${r.viewport}px`).toMatch(/^0s(,\s*0s)*$/);
    }
  });

  it.each(VIEWPORTS.filter((v) => v < 640))('at %ipx every link is at least 44px tall', (viewport) => {
    const r = readings.find((x) => x.viewport === viewport)!;
    for (const id of IDS) {
      const box = r.links[id];
      expect(box, `${id} did not render at ${viewport}px`).toBeTruthy();
      expect(box!.h, `${id} is ${box!.h}px at ${viewport}px — below the 44px tap floor`)
        .toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
    }
  });

  it.each(VIEWPORTS.filter((v) => v >= 640))('at %ipx every link sits at Rule 4 38px', (viewport) => {
    const r = readings.find((x) => x.viewport === viewport)!;
    for (const id of IDS) {
      const box = r.links[id];
      expect(box, `${id} did not render at ${viewport}px`).toBeTruthy();
      expect(box!.h, `${id} is ${box!.h}px at ${viewport}px — Rule 4 fixes a control at ${RULE_4_PX}px`)
        .toBe(RULE_4_PX);
    }
  });

  it('🔴 the two floors are actually DIFFERENT, so this suite measures a breakpoint', () => {
    // If `sm:min-h-0` were dropped the link would be 44px everywhere and the
    // Rule 4 assertion would fail; if `min-h-11` were dropped it would be 38px
    // everywhere and the floor assertion would fail. This states the shape
    // directly so a future reader sees the breakpoint is real.
    const below = readings.find((r) => r.viewport === 639)!.links['money-flow']!;
    const above = readings.find((r) => r.viewport === 640)!.links['money-flow']!;
    expect(below.h).toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
    expect(above.h).toBe(RULE_4_PX);
    expect(below.h).not.toBe(above.h);
  });

  it('🔴 no link overflows its viewport at any width', () => {
    for (const r of readings) {
      expect(r.scrollWidth, `the page scrolls sideways at ${r.viewport}px`).toBeLessThanOrEqual(r.viewport);
      for (const id of IDS) {
        const box = r.links[id]!;
        expect(box.x + box.w, `${id} runs past the right edge at ${r.viewport}px`)
          .toBeLessThanOrEqual(r.viewport);
      }
    }
  });

  it('🔴 and the longest label did not wrap it taller than the shortest', () => {
    // One treatment means one HEIGHT, whichever of the three pages it names.
    for (const r of readings) {
      const heights = IDS.map((id) => r.links[id]!.h);
      expect(new Set(heights).size, `the three links differ in height at ${r.viewport}px: ${heights.join(', ')}`).toBe(1);
    }
  });
});
