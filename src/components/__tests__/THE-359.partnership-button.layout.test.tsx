// @vitest-environment node
//
// 🔴 THE `node` PRAGMA IS LOAD-BEARING. `happy-dom` has NO LAYOUT ENGINE —
// `getBoundingClientRect()` answers zeroes and `getComputedStyle().display`
// answers `block` for a flex container — and with happy-dom selected
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

/**
 * THE-359 · 🔴 THE "Partner with Us" BUTTON CLEARS THE TOUCH FLOOR — MEASURED.
 *
 * ⚠️ `Button`'S INTRINSIC SIZES ARE 24 / 28 / 32 / 36px — `xs` h-6, `sm` h-7,
 * `default` h-8, `lg` h-9 — AND EVERY ONE OF THEM IS BELOW BOTH FLOORS (#500).
 * Its default is 32px. A button shipped at its own size is a 32px tap target on
 * a phone, so this one carries an explicit height and this suite is what proves
 * the override actually won.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE CLASS STRING IS DISCOVERED FROM THE SHIPPED SOURCE, NOT RETYPED.
 *
 * THE-346 found this by mutation: a replica whose classes are hand-written here
 * measures a fiction the moment the component drifts. `discover()` pulls the
 * exact string out of `Profile.tsx` and THROWS if the surface moved, and a
 * precondition below re-asserts that the measured string is still in the file.
 *
 * 🔴 AND TRANSITIONS ARE SUPPRESSED BEFORE MEASURING. `Button` carries
 * `transition-all`, which includes `min-height`; `settle()` waits two animation
 * frames (~32ms), well inside a 150ms transition, so an un-suppressed page
 * reports a DRIFTING mid-flight value. #490 measured `min-h-[44px]` at 7.7469px
 * and a menu row at 41.79998779296875px — exactly 44 × 0.95 — for this reason.
 * The resting layout is the one a person sees.
 *
 * 🔴 NOTHING IS PINNED TO A LINE NUMBER.
 */

/** The founder's phone, the `sm` boundary either side, and two desktops. */
const VIEWPORTS = [380, 639, 640, 768, 1280] as const;

/** #500's floor below `sm`, and Rule 4's ceiling above it. */
const TOUCH_FLOOR_PX = 44;
const RULE_4_MIN_PX = 38;

const ROOT = process.cwd();
const PROFILE = 'src/components/Profile.tsx';
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Pull one capture out of a file, or throw naming the file and the pattern.
 * A DISCOVERY THAT FINDS NOTHING MUST THROW, never fall back: a default turns
 * "the surface moved" into "the surface is fine".
 */
function discover(rel: string, re: RegExp, what: string): string {
  const m = read(rel).match(re);
  if (!m) throw new Error(`${what}: no match for ${re} in ${rel} — the surface moved`);
  return m[1];
}

/** The CTA, found by its label rather than by its position in the file. */
const ctaClass = discover(
  PROFILE,
  /size="lg"\s*\n\s*onClick=\{onGoToPartner\}\s*\n\s*className="([^"]+)"/,
  'the "Partner with Us" button',
);

/**
 * `Button`'s own base and `lg` classes, taken from the primitive itself — so
 * the replica wears exactly what the shipped element wears, including the
 * `h-9` that the override has to beat.
 */
const BUTTON = 'src/components/ui/button.tsx';
const buttonBase = discover(
  BUTTON,
  /cva\(\s*\n?\s*"([^"]+)"/,
  "Button's base class",
);
const buttonLg = discover(
  BUTTON,
  /\n\s{8}lg: "([^"]+)"/,
  "Button's lg size class",
);

/** The Card the button sits in, and the section heading above it. */
const cardClass = discover(
  PROFILE,
  /<Card className="(bg-surface-raised rounded-3xl shadow-xs border border-line ring-0 py-4[^"]*)">/,
  'the partnership card',
);

let browser: MeasuringBrowser | undefined;

interface Box { w: number; h: number; x: number; y: number; bottom: number }
interface Reading {
  viewport: number;
  scrollWidth: number;
  cta: Box | null;
  minHeight: string;
  fontSize: string;
}
const readings = new Map<number, Reading>();

/**
 * The replica: the partnership card as `Profile` composes it in the state this
 * ticket changed — a section heading, a card, and one button inside it. Nothing
 * else from the page, because nothing else constrains this button's height.
 */
const page = () =>
  `<div class="min-h-screen bg-surface-sunken">
     <div class="p-4 space-y-6 max-w-lg mx-auto">
       <div>
         <h4 class="text-[10px] font-bold text-faint tracking-wider uppercase mb-3 ml-2">Partnership</h4>
         <div class="${cardClass} flex flex-col">
           <button data-cta type="button" class="${buttonBase} ${buttonLg} ${ctaClass}">Partner with Us</button>
         </div>
       </div>
     </div>
   </div>`;

setUpOrFail(async () => {
  const markup = page();
  const css = await buildCssForMarkup(markup);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'the359-'));
  const file = path.join(dir, 'partnership.html');
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
        const el = document.querySelector('[data-cta]');
        const b = el ? el.getBoundingClientRect() : null;
        const cs = el ? getComputedStyle(el) : null;
        return {
          viewport: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          cta: b ? { w: round(b.width), h: round(b.height), x: round(b.x), y: round(b.y), bottom: round(b.bottom) } : null,
          minHeight: cs ? cs.minHeight : '',
          fontSize: cs ? cs.fontSize : '',
        };
      })()`,
      900,
    );
    readings.set(viewport, r);
  }
}, 300_000);

afterAll(async () => { await browser?.close(); });

const at = (v: number): Reading => {
  const r = readings.get(v);
  if (!r) throw new Error(`no reading at ${v}`);
  return r;
};
const cta = (v: number): Box => {
  const b = at(v).cta;
  if (!b) throw new Error(`the button was not measured at ${v} — it did not render`);
  return b;
};

/* ═══ 0 · the precondition ════════════════════════════════════════════════ */

describe('the measured surface is the shipped one', () => {
  it('🔴 the discovered class string is still in Profile.tsx, byte for byte', () => {
    expect(read(PROFILE), 'the CTA class drifted away from the measured copy')
      .toContain(ctaClass);
    expect(read(BUTTON), "Button's lg size drifted away from the measured copy")
      .toContain(buttonLg);
    // And the replica really did render something.
    expect(readings.size).toBe(VIEWPORTS.length);
    for (const v of VIEWPORTS) expect(cta(v).h, `no height at ${v}`).toBeGreaterThan(0);
  });

  it('🔴 nothing here was measured at a line number', () => {
    const self = read('src/components/__tests__/THE-359.partnership-button.layout.test.tsx');
    expect(self, 'a source coordinate was pinned').not.toMatch(/\.tsx?:\d+/);
  });

  it("🔴 Button's OWN sizes are all below the floor — the override is load-bearing", () => {
    /**
     * The premise, asserted rather than asserted-about. If `lg` ever became
     * 44px this suite would still pass on the override, and the next author
     * would delete the override believing the primitive covers it.
     */
    const sizes = read(BUTTON).match(/\n\s{8}(?:default|xs|sm|lg):\s*\n?\s*"h-(\d+)/g) ?? [];
    expect(sizes.length, "Button's size variants could not be read").toBeGreaterThanOrEqual(4);
    for (const s of sizes) {
      const rem = Number(/h-(\d+)/.exec(s)![1]);
      expect(rem * 4, `Button's ${s.trim()} now clears the floor on its own`)
        .toBeLessThan(TOUCH_FLOOR_PX);
    }
  });
});

/* ═══ 16f · the button measures ≥44px below `sm` ══════════════════════════ */

describe('16f · the "Partner with Us" button clears the touch floor below `sm`', () => {
  for (const v of [380, 639] as const) {
    it(`🔴 ${v}px — at least ${TOUCH_FLOOR_PX}px tall`, () => {
      const b = cta(v);
      expect(b.h, `🔴 THE BUTTON IS ${b.h}px AT ${v}px — under the ${TOUCH_FLOOR_PX}px floor`)
        .toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
      // ⚠️ AND IT IS A MINIMUM, NOT A FIXED HEIGHT — a wrapped label still grows.
      expect(at(v).minHeight, 'the height is fixed rather than a floor').toBe('44px');
    });
  }

  it(`🔴 640px — Rule 4 takes over and still clears ${RULE_4_MIN_PX}px`, () => {
    const b = cta(640);
    expect(b.h, `the button is ${b.h}px at the sm boundary`)
      .toBeGreaterThanOrEqual(RULE_4_MIN_PX);
    // The `sm:` rules really did engage: the phone floor is released.
    expect(at(640).minHeight, 'the 44px floor is still applied above sm').toBe('0px');
  });

  for (const v of [768, 1280] as const) {
    it(`${v}px — still at Rule 4's height, not the primitive's 36px`, () => {
      const b = cta(v);
      expect(b.h).toBeGreaterThanOrEqual(RULE_4_MIN_PX);
      // 40px is what `sm:h-[40px]` asks for, and what the sibling Cancel
      // Partnership button already uses — no new height is minted.
      expect(b.h).toBe(40);
    });
  }

  it('🔴 and it is full width, so the target is the whole row', () => {
    for (const v of VIEWPORTS) {
      expect(cta(v).w, `the button is only ${cta(v).w}px wide at ${v}px`).toBeGreaterThan(200);
    }
  });

  it('🔴 no horizontal overflow at any width, phone included', () => {
    for (const v of VIEWPORTS) {
      expect(at(v).scrollWidth, `the page scrolls sideways at ${v}px`)
        .toBeLessThanOrEqual(v);
    }
  });
});
