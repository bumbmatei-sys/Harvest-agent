// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom, and this is load-bearing. Every question in this file
// is a LAYOUT question and happy-dom cannot answer one: with the real compiled
// stylesheet injected, `getBoundingClientRect()` returns all zeros and
// `getComputedStyle(el).display` answers `block` for a flex container (measured
// in THE-276's post-mortem, not assumed). Under the repo's default happy-dom
// environment the globals are replaced with browser-semantics ones, and a
// request to the browser's own debugger port then fails same-origin, so the
// measuring browser can never be attached to.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { DENSITY_PX, DESKTOP_CONTROL_MAX_PX } from '../layout/form-layout';
import { CountryPromptSurface, OVERLAY_CLEARANCE } from '../country/CountryPrompt';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-292 · tests 12 and 13 — MEASURED, not assumed
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Two questions, both of which a class-name assertion would get wrong:
 *
 *   12. 🔴 Does the prompt clear the bottom nav and LAYER above z-100 at 380px?
 *       ⚠️ `ui/dialog.tsx` and `ui/sheet.tsx` ship at `z-50`, BELOW the nav's
 *       `z-[100]`, so a prompt built on either primitive would paint UNDER the
 *       nav. This one layers explicitly (scrim 101 / panel 102) and the proof
 *       below is `document.elementFromPoint` — what the browser would actually
 *       hand a thumb — rather than a comparison of two z-index strings.
 *       ⚠️ And `pb-safe` COMPILES TO NOTHING in this repo (THE-286, card
 *       86bbujvt8): the nav reserves no iPhone safe inset. Nothing here relies
 *       on it — the overlay adds `env(safe-area-inset-bottom)` itself.
 *
 *   13. Is every control ≥44px below `sm`, while Rule 4 still holds above it?
 *       ⚠️ Rule 4 fixes a control at 38px from `sm:` up and an existing test
 *       asserts `DENSITY_PX.control < 44` ON PURPOSE. 44px is a TOUCH floor and
 *       a desktop pointer is not a thumb, so the floor is asserted where touch
 *       happens and the band is asserted above it. Raising desktop to 44px
 *       would break a settled, tested rule.
 *
 * ── The rem trap ─────────────────────────────────────────────────────────────
 * globals.css trims the rem base to 14.5px from 1024px up, so a rem-named size
 * renders 9.4% smaller than its name on a desktop — `h-11` is 44 by name and
 * 39.875px on a monitor. Every load-bearing dimension here is in px, and
 * measured at all five widths: ⚠️ width is NOT monotonic in this shell (THE-184
 * found the content box DROPPING from 951px at 1023px to 708.5px at 1024px).
 */

const ROOT = path.resolve(__dirname, '../../..');
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** The ladder every layout suite in this repo uses. */
const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

/** iPhone 14/15 logical height — these questions are about the viewport BOTTOM. */
const PHONE_HEIGHT = 844;

/** The touch floor. Not negotiable below `sm`. */
const TOUCH_TARGET_MIN_PX = 44;

/**
 * The safe-area inset a notched phone takes at the bottom.
 *
 * ⚠️ WHAT THE-295 (#437) CHANGED, AND WHAT IT DID NOT. The MEMBER nav measured
 * here now carries `pb-[calc(8px+env(safe-area-inset-bottom))]` in place of the
 * inert `pb-safe`, so it does reserve the inset. Two things it did NOT change,
 * both of which keep this prompt's own clearance load-bearing:
 *
 *   🔴 `pb-safe` IS STILL NOT A UTILITY THIS REPO DEFINES — zero matches in
 *      tailwind.config.ts and globals.css. THE-295 fixed the two call sites it
 *      owned rather than defining it, deliberately, so as not to change the
 *      height of surfaces it could not re-measure.
 *   🔴 THE ADMIN NAV STILL CARRIES THE INERT CLASS. `AdminDashboard.tsx`'s nav
 *      is still `… pb-safe lg:pb-0 … z-[100]`, and this prompt mounts on BOTH
 *      shells. So on the owner's surface the nav reserves nothing, exactly as
 *      before, and an overlay that budgeted for the nav alone would still sit
 *      under the home indicator there.
 *
 * `env(safe-area-inset-bottom)` also resolves to 0 in headless Chromium, so the
 * measurements below are the WORST CASE: whatever clearance is asserted has to
 * hold with the inset contributing nothing, which is exactly the phone this
 * would fail on.
 */
const SAFE_INSET_PX = 34;

/**
 * The MEMBER shell's bottom nav classes, READ FROM THE SHELL.
 *
 * ⚠️ `MainApp.tsx` deliberately, and not `AdminDashboard.tsx`: the admin shell
 * is owned by THE-291 in parallel, and a fixture that parsed it would couple
 * this suite to another ticket's edits. Both shells carry the same
 * `fixed bottom-0 … z-[100]` nav, and it is the LAYER that is under test, so
 * the member shell answers the question without reaching into a file this
 * ticket must not open.
 */
function navClass(): string {
  const shell = src('src/components/MainApp.tsx');
  const match = /<div className=\{`(bg-surface-raised border-t lg:border-t-0[^`]*)`\}>/.exec(shell);
  if (!match) throw new Error('the bottom nav could not be located in MainApp.tsx');
  const cls = match[1].replace(/\$\{[^}]*\}/g, 'lg:w-[224px]');
  for (const required of ['fixed', 'bottom-0', 'z-[100]']) {
    expect(cls, `the bottom nav no longer carries ${required}`).toContain(required);
  }
  return cls;
}

/** The nav's own z-layer, read from the shell rather than typed here. */
const NAV_Z = 100;

interface Box { x: number; y: number; width: number; height: number; top: number; bottom: number }

let browser: MeasuringBrowser;

/** Comfortably past Tailwind's 150ms default `transition-all` duration. */
const TRANSITION_SETTLE_MS = 300;

/**
 * Measure at `viewport`, AFTER any CSS transition the resize started has ended.
 *
 * 🔴 WITHOUT THIS, EVERY HEIGHT BELOW IS A LIE, and it lies in the direction
 * that hides the defect. `<CountrySelect>`'s button carries `transition-all`.
 * `Emulation.setDeviceMetricsOverride` changes the viewport, which flips the
 * `sm:` media query, which changes `min-height` and `padding` — and
 * `transition-all` then ANIMATES both. The harness's `settle()` waits two
 * animation frames, which is right for a static page and far short of a 150ms
 * transition, so the picker was measured in flight at 38.19px and 40.73px on
 * consecutive runs of the same assertion at the same width. Fully settled it is
 * 50px at 380px and 38px at 768px.
 *
 * ⚠️ The in-flight numbers are an artefact of RESIZING and nothing a member
 * ever sees: a phone does not change width, so the control paints at its 44px
 * floor from the first frame. But a test that reads them is a test that reports
 * a passing control as failing — or, with a floor one pixel lower, a failing one
 * as passing.
 */
function settled<T>(viewport: number, expression: string, height = 1200): Promise<T> {
  return browser.evaluateAt<T>(
    viewport,
    `new Promise((r) => setTimeout(r, ${TRANSITION_SETTLE_MS})).then(() => (${expression}))`,
    height,
  );
}

beforeAll(async () => {
  const css = await buildAppCss();

  const body = renderToStaticMarkup(
    <div>
      {/* Page content under everything, so the stack is realistic. */}
      <div className="min-h-screen bg-surface p-4">member screen</div>

      {/* The bottom nav, with a realistic 44px item inside it. */}
      <div data-nav className={navClass()}>
        <span style={{ display: 'inline-block', height: '44px' }} />
      </div>

      {/* 🔴 The prompt's REAL markup and REAL classes — not a copy of them. */}
      <CountryPromptSurface
        country="Kenya"
        onChange={() => {}}
        onSave={() => {}}
        onDismiss={() => {}}
        saving={false}
        error={null}
      />
    </div>,
  );

  // ⚠️ THE TWO z-PRIMITIVES MOVED, AND THIS ASSERTION IS WHY WE KNOW.
  //
  // It used to read `.toContain('z-50')` — the two primitives this prompt
  // deliberately does not use, pinned because "if either ever ships above the
  // nav, the explicit layering here stops being necessary, and if this
  // assertion fails it is because one of them MOVED". THE-295 (#437) moved
  // them: `ui/dialog` and `ui/sheet` now ship their scrim at `z-[101]` and
  // their panel at `z-[102]`, above the nav's `z-[100]`.
  //
  // 🔴 Those are the SAME two layers this prompt spells, and that is a
  // convergence rather than a coincidence — both reached for the pairing #427
  // established for the giving share sheet. So the layering here is no longer
  // compensating for a primitive that sits too low; it now AGREES with the
  // primitives. Re-pinned rather than deleted: the question "are these still
  // above the nav?" is exactly as worth asking as before, and a future move
  // back under `z-[100]` must still be loud.
  for (const [file, path] of [['ui/dialog', 'src/components/ui/dialog.tsx'], ['ui/sheet', 'src/components/ui/sheet.tsx']] as const) {
    expect(src(path), `${file}'s scrim left z-[101]`).toContain('z-[101]');
    expect(src(path), `${file}'s panel left z-[102]`).toContain('z-[102]');
  }

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the292-'));
  const file = path.join(dir, 'country-prompt.html');
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<style>${css}</style></head><body>${body}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);
}, 180_000);

afterAll(async () => { await browser?.close(); });

/** Every interactive control in the prompt, with its real box. */
async function controls(viewport: number, height = 1200) {
  return settled<Array<Box & { tag: string; label: string }>>(viewport, `(() => {
    const card = document.querySelector('[data-testid="country-prompt"]');
    return [...card.querySelectorAll('input, textarea, button, a[href]')].map((el) => {
      const b = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        label: el.getAttribute('data-testid') || (el.textContent || '').trim().slice(0, 32),
        x: b.x, y: b.y, width: b.width, height: b.height, top: b.top, bottom: b.bottom,
      };
    });
  })()`, height);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 12 · 🔴 clears the bottom nav and layers above z-100 at 380px
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('12 · it clears the bottom nav and layers above z-100 at 380px', () => {
  it('🔴 the browser hands a tap over the nav to the PROMPT, not the nav', async () => {
    const hit = await settled<{
      overNav: string | null; navTop: number; navHeight: number;
      scrimZ: string; layerZ: string; navZ: string;
    }>(380, `(() => {
      const nav = document.querySelector('[data-nav]');
      const r = nav.getBoundingClientRect();
      // The exact middle of the nav — where a thumb would land on it.
      const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const owner = el && el.closest('[data-testid]');
      return {
        overNav: owner ? owner.getAttribute('data-testid') : (el ? el.tagName : null),
        navTop: r.top, navHeight: r.height,
        scrimZ: getComputedStyle(document.querySelector('[data-testid="country-prompt-scrim"]')).zIndex,
        layerZ: getComputedStyle(document.querySelector('[data-testid="country-prompt-layer"]')).zIndex,
        navZ: getComputedStyle(nav).zIndex,
      };
    })()`, PHONE_HEIGHT);

    // 🔴 The layer really is above the nav, measured by hit-testing.
    expect(hit.overNav, 'the bottom nav is painted OVER the prompt').toMatch(/country-prompt/);
    // And the numbers behind that, read from the computed style.
    expect(Number(hit.navZ)).toBe(NAV_Z);
    expect(Number(hit.scrimZ), 'the scrim fell below the nav').toBeGreaterThan(NAV_Z);
    expect(Number(hit.layerZ), 'the panel fell below the scrim').toBeGreaterThan(Number(hit.scrimZ));
  });

  it('🔴 no control sits under the home indicator, with the inset contributing nothing', async () => {
    const found = await controls(380, PHONE_HEIGHT);
    expect(found.length, 'the card rendered no controls — this would pass vacuously')
      .toBeGreaterThanOrEqual(3);
    for (const c of found) {
      expect(c.bottom + SAFE_INSET_PX, `"${c.label}" sits under the home indicator`)
        .toBeLessThanOrEqual(PHONE_HEIGHT);
    }
  });

  it('🔴 the clearance is explicit and does not rely on pb-safe', async () => {
    // (a) The rule itself carries the inset — the trap THE-286 named.
    expect(OVERLAY_CLEARANCE, 'the clearance stopped adding the safe-area inset')
      .toContain('env(safe-area-inset-bottom)');
    expect(OVERLAY_CLEARANCE, 'the clearance became a bare pb-* value').toMatch(/calc\(\s*40px/);
    // (b) 🔴 And nothing in the component depends on the inert utility.
    expect(src('src/components/country/CountryPrompt.tsx')).not.toMatch(/className=[^>]*\bpb-safe\b/);
    // (c) Compiled, the rule emits real padding rather than nothing at all —
    //     which is precisely how `pb-safe` fails.
    const pad = await settled<number>(380, `(() => parseFloat(getComputedStyle(
      document.querySelector('[data-testid="country-prompt-layer"]')).paddingBottom))()`, PHONE_HEIGHT);
    expect(pad, 'the overlay clearance compiled to nothing, exactly like pb-safe')
      .toBeGreaterThanOrEqual(40);
  });

  it('the card is fully reachable — it scrolls rather than clipping on a short phone', async () => {
    const m = await settled<{ overflowY: string; cardH: number; layerH: number }>(
      380, `(() => {
        const layer = document.querySelector('[data-testid="country-prompt-layer"]');
        return {
          overflowY: getComputedStyle(layer).overflowY,
          cardH: document.querySelector('[data-testid="country-prompt"]').getBoundingClientRect().height,
          layerH: layer.getBoundingClientRect().height,
        };
      })()`, PHONE_HEIGHT);
    expect(m.overflowY).toBe('auto');
    expect(m.layerH).toBe(PHONE_HEIGHT);
  });

  it('nothing overflows sideways at any of the five widths', async () => {
    // ⚠️ Width is not monotonic here, so every rung is measured rather than the
    // extremes: #426 measured a card falling TWICE and narrowest at 1280, and
    // #421 found a 4px overflow at 1024 and 1280 only.
    for (const viewport of VIEWPORTS) {
      const scrollWidth = await settled<number>(viewport, 'document.documentElement.scrollWidth');
      expect(scrollWidth, `the page scrolls sideways at ${viewport}px`).toBeLessThanOrEqual(viewport);
    }
  });

  it('and the card stays inside the viewport at all five widths', async () => {
    for (const viewport of VIEWPORTS) {
      const card = await settled<Box>(viewport, `(() => {
        const b = document.querySelector('[data-testid="country-prompt"]').getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height, top: b.top, bottom: b.bottom };
      })()`);
      expect(card.x, `the card starts off-screen at ${viewport}px`).toBeGreaterThanOrEqual(0);
      expect(card.x + card.width, `the card runs past the viewport at ${viewport}px`)
        .toBeLessThanOrEqual(viewport);
      expect(card.width, `the card collapsed at ${viewport}px`).toBeGreaterThan(200);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 13 · every control ≥44px below sm; Rule 4 still holds above
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('13 · every control is ≥44px below sm; Rule 4 still holds above', () => {
  it('every control clears the 44px touch floor at 380px', async () => {
    const found = await controls(380, PHONE_HEIGHT);
    expect(found.length).toBeGreaterThanOrEqual(3);
    for (const c of found) {
      expect(c.height, `"${c.label}" (${c.tag}) is a ${c.height}px target on a phone`)
        .toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
    }
  });

  it('the floor holds across every mobile width, not just the narrowest', async () => {
    for (const viewport of [380, 480, 639]) {
      for (const c of await controls(viewport, PHONE_HEIGHT)) {
        expect(c.height, `"${c.label}" is ${c.height}px at ${viewport}px`)
          .toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
      }
    }
  });

  it('⚠️ and hands back to Rule 4 above sm rather than carrying 44px onto a desktop', async () => {
    for (const viewport of [768, 1024, 1280, 1440]) {
      const found = await controls(viewport);
      const picker = found.find((c) => c.label.startsWith('Kenya') || c.label.startsWith('Select'));
      expect(picker, `no country picker at ${viewport}px`).toBeDefined();
      expect(picker!.height, `the picker is ${picker!.height}px at ${viewport}px — Rule 4 says ${DENSITY_PX.control}`)
        .toBeCloseTo(DENSITY_PX.control, 0);

      for (const testid of ['country-prompt-save', 'country-prompt-dismiss']) {
        const action = found.find((c) => c.label === testid)!;
        expect(action.height, `"${testid}" is ${action.height}px at ${viewport}px`)
          .toBeCloseTo(DENSITY_PX.action, 0);
        expect(action.height, 'the desktop density cap was raised')
          .toBeLessThanOrEqual(DESKTOP_CONTROL_MAX_PX);
      }
    }
  });

  it('🔴 Rule 4 is still deliberately BELOW the touch floor — this ticket did not fight it', () => {
    // The settled position, asserted here too so a later change cannot quietly
    // raise the desktop band to 44px and call it an accessibility fix.
    expect(DENSITY_PX.control).toBeLessThan(TOUCH_TARGET_MIN_PX);
    expect(DESKTOP_CONTROL_MAX_PX).toBeLessThan(TOUCH_TARGET_MIN_PX);
  });

  it('the card invents no width — it is capped by form-layout.ts', () => {
    const cmp = src('src/components/country/CountryPrompt.tsx');
    expect(cmp).toContain('FIELD_WIDTH.long');
    // 🔴 No hand-typed max-width anywhere in the component.
    expect(cmp).not.toMatch(/max-w-\[\d+px\]/);
  });
});
