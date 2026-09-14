// @vitest-environment node
//
// THE `node` PRAGMA IS LOAD-BEARING. `happy-dom` has NO LAYOUT ENGINE -
// `getBoundingClientRect()` answers zeroes and `getComputedStyle().display`
// answers `block` for a flex container - and with happy-dom selected
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
 * THE-362 - "Support This Message" is a real touch target, MEASURED.
 *
 * This ticket rewires that button, so #500's rule applies to it: every control
 * a ticket touches must clear 44px below `sm`, and must say its own height
 * rather than inherit one from padding. `ui/button.tsx`'s intrinsic sizes are
 * 24 / 28 / 32 / 36px (`xs` h-6, `sm` h-7, `default` h-8, `lg` h-9) and every
 * one is under both floors, so nothing on this screen may rely on an intrinsic.
 *
 * WHY IT IS MEASURED AND NOT READ OFF A CLASS NAME. #490 measured a
 * `min-h-[44px]` control at 7.7469px and a menu row at 41.79998779296875px -
 * exactly 44 x 0.95 - because the page was still mid-transition when the
 * reading was taken. `settle()` waits two animation frames (~32ms), well inside
 * a 150ms transition, so the stylesheet below suppresses every transition and
 * every animation BEFORE a single box is read. A class name would have reported
 * 44 in both of those cases.
 *
 * THE CLASS STRING IS DISCOVERED FROM THE SHIPPED SOURCE, NOT RETYPED. THE-346
 * found this by mutation: a replica whose classes are hand-written here
 * measures a fiction the moment the component drifts. `discover()` pulls the
 * exact `className` off `LivestreamView`'s own button and THROWS if it moved,
 * so shrinking the shipped control shrinks what is measured.
 *
 * NOTHING IS PINNED TO A LINE NUMBER.
 */

/** The founder's phone, the `sm` boundary either side, and two desktops. */
const VIEWPORTS = [380, 639, 640, 768, 1280] as const;

/** #500's floor below `sm`, and Rule 4's control floor above it. */
const TOUCH_FLOOR_PX = 44;
const RULE_4_MIN_PX = 38;

const ROOT = process.cwd();
const VIEW = 'src/components/LivestreamView.tsx';
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Pull one capture out of a file, or throw naming the file and the pattern.
 * A DISCOVERY THAT FINDS NOTHING MUST THROW, never fall back: a default turns
 * "the surface moved" into "the surface is fine".
 */
function discover(rel: string, re: RegExp, what: string): string {
  const m = read(rel).match(re);
  if (!m) throw new Error(`${what}: no match for ${re} in ${rel} - the surface moved`);
  return m[1];
}

/**
 * The shipped button's own `className`, and the row it sits in.
 *
 * The row matters as much as the button: the support control and the prayer
 * control share a `lg:flex` row, and a button that measures 44px on its own can
 * still be squeezed by a sibling. Both come out of the shipped file.
 */
const BUTTON_CLASS = discover(
  VIEW,
  /data-livestream-support\s*\n\s*className="([^"]+)"/,
  'the support button',
);
/**
 * The button's background, DISCOVERED rather than retyped.
 *
 * `LivestreamView` declares it once as `GOLD` and uses it in six places. Pulled
 * from the file so this replica cannot hardcode a colour of its own, and so a
 * change to the shipped token is measured rather than papered over.
 */
const GOLD = discover(
  VIEW,
  /const GOLD = '([^']+)';/,
  "the file's brand colour",
);
const ROW_CLASS = discover(
  VIEW,
  /<div className="(p-4 space-y-3 max-w-2xl[^"]*)">/,
  'the row the support button sits in',
);

/**
 * The replica: the support row exactly as `LivestreamView` composes it, on the
 * dark full-screen surface it actually sits on.
 *
 * The prayer sibling is included because it shares the row - a `lg:flex-1`
 * button's width, and therefore whether its label wraps to a second line, is
 * decided by what is beside it.
 */
const page = () =>
  `<div class="min-h-screen bg-black">
     <div class="${ROW_CLASS}">
       <button data-support class="${BUTTON_CLASS}" style="background-color:${GOLD}">
         <svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 21s-8-4.5-8-10a4 4 0 018-1 4 4 0 018 1c0 5.5-8 10-8 10z"/></svg>
         Support This Message
       </button>
       <button data-prayer class="w-full py-3 rounded-xl font-semibold text-white bg-white/10 lg:hidden">
         Submit Prayer Request
       </button>
     </div>
   </div>`;

interface Box { w: number; h: number; x: number; right: number }
interface Reading {
  viewport: number;
  scrollWidth: number;
  support: Box | null;
  prayer: Box | null;
  minHeight: string;
  transition: string;
}

let browser: MeasuringBrowser;
const readings = new Map<number, Reading>();

setUpOrFail(async () => {
  const markup = page();
  const css = await buildCssForMarkup(markup);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'the362-'));
  const file = path.join(dir, 'livestream-support.html');
  writeFileSync(
    file,
    '<!doctype html><html data-theme="light"><head><meta charset="utf-8">'
      + `<style>${css}</style>`
      // SUPPRESS ANIMATION BEFORE MEASURING. See the header: #490 measured
      // `min-h-[44px]` at 7.7469px without this.
      + '<style>*,*::before,*::after{transition:none !important;animation:none !important}</style>'
      + `</head><body>${markup}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const viewport of VIEWPORTS) {
    const r = await browser.evaluateAt<Reading>(
      viewport,
      `(() => {
        const round = (n) => Math.round(n * 10000) / 10000;
        const box = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { w: round(b.width), h: round(b.height), x: round(b.x), right: round(b.right) };
        };
        const support = document.querySelector('[data-support]');
        const cs = support ? getComputedStyle(support) : null;
        return {
          viewport: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          support: box('[data-support]'),
          prayer: box('[data-prayer]'),
          minHeight: cs ? cs.minHeight : '',
          transition: cs ? cs.transitionDuration : '',
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
const support = (v: number): Box => {
  const b = at(v).support;
  if (!b) throw new Error(`the support button was not measured at ${v} - it did not render`);
  return b;
};

/* ═══ 0 · the measured surface is the shipped one ═════════════════════════ */

describe('the measured surface is the shipped one', () => {
  it('the discovered class string is the button LivestreamView renders', () => {
    /**
     * THE LOAD-BEARING ASSERTION OF THIS SUITE. The replica is built from the
     * shipped `className`, so it would measure a perfect button even if the
     * component had lost it entirely. This ties the measurement to the file.
     */
    const src = read(VIEW);
    expect(src, 'the support button lost its measurement handle')
      .toContain('data-livestream-support');
    expect(src, 'the discovered class string is not in the shipped file')
      .toContain(BUTTON_CLASS);
    expect(BUTTON_CLASS, 'the button declares no minimum height of its own')
      .toContain('min-h-[44px]');
  });

  it('and the measurement really happened, with animation off', () => {
    for (const v of VIEWPORTS) {
      expect(at(v).transition, `a transition is still live at ${v} - readings may drift`)
        .toMatch(/^0s(, 0s)*$/);
    }
    // Non-vacuity: a box was actually read, not a null quietly tolerated.
    expect(support(380).h).toBeGreaterThan(0);
  });
});

/* ═══ 11 · it measures at or above 44px below `sm` ════════════════════════ */

describe('11 - the support button measures >= 44px below sm', () => {
  it.each([380, 639] as const)('at %ipx it clears the touch floor', (v) => {
    const b = support(v);
    expect(b.h, `the support button is ${b.h}px at ${v} - under the ${TOUCH_FLOOR_PX}px floor`)
      .toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
  });

  it('the computed min-height is the real one, not a class name that lost', () => {
    // #490's failure mode: the class is present and the computed value is not.
    expect(at(380).minHeight).toBe('44px');
  });

  it('and above sm it still clears Rule 4’s control floor', () => {
    for (const v of [640, 768, 1280] as const) {
      const b = support(v);
      expect(b.h, `the support button is ${b.h}px at ${v}, under Rule 4's ${RULE_4_MIN_PX}px`)
        .toBeGreaterThanOrEqual(RULE_4_MIN_PX);
    }
  });

  it('it is a full-width target on a phone, and the page does not scroll sideways', () => {
    for (const v of [380, 639] as const) {
      const b = support(v);
      const r = at(v);
      expect(b.w, `the support button is only ${b.w}px wide at ${v}`).toBeGreaterThan(v * 0.6);
      expect(r.scrollWidth, `the livestream support row overflows at ${v}`)
        .toBeLessThanOrEqual(v);
    }
  });

  it('and its sibling in the same row clears the floor too', () => {
    // A row is only as tappable as the smaller of the two controls in it.
    const prayer = at(380).prayer;
    expect(prayer, 'the prayer control did not render').not.toBeNull();
    expect(prayer!.h, `the prayer control is ${prayer!.h}px at 380`)
      .toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
  });
});
