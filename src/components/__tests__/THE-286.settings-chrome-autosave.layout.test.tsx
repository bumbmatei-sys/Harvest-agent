// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom, and this is load-bearing. Every question in this file
// is a LAYOUT question, and happy-dom cannot answer one: with the real compiled
// stylesheet injected, `getBoundingClientRect()` returns all zeros and
// `getComputedStyle(el).display` answers `block` for a flex container (measured
// in THE-276's post-mortem, not assumed). Under the repo's default happy-dom
// environment the globals are also replaced with browser-semantics ones, and a
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
import { NAV_CLEARANCE } from '../settings/GivingStatementsSection';
import GivingStatementsSection from '../settings/GivingStatementsSection';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-286 — where the converted section lands, and how big its controls are
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ─── ⚠️ "≥44px at every width" versus Rule 4, and how it is settled ──────────
 *
 * The brief asks for every tappable target to be ≥44px AT EVERY WIDTH. This
 * repo has already settled that question the other way for desktop, twice over:
 * `form-layout.ts` Rule 4 fixes a text control at 38px and an action at 40px
 * from `sm:` up, caps them with `DESKTOP_CONTROL_MAX_PX = 40`, and
 * `AdminCRM.desktop-layout.test.tsx` pins "keeps every density height behind
 * sm:, so a 38px control cannot become a 38px tap target" — asserting
 * `DENSITY_PX.control < 44` on purpose. 44px is a TOUCH floor; 38px is the
 * desktop density band, and a desktop pointer is not a thumb.
 *
 * The brief's own test 12 resolves it the same way: it says "every control is
 * ≥44px and the last field clears the bottom nav AT 380px". So the floor is
 * asserted where touch happens (below `sm`), and Rule 4's band is asserted
 * above it. Raising desktop to 44px would have broken a settled, tested rule in
 * a slice whose whole point is to inherit what is already there.
 *
 * ─── The rem trap, and why the numbers are in px ─────────────────────────────
 *
 * globals.css trims the rem base to 14.5px from 1024px up, so a rem-named size
 * renders 9.4% smaller than its name on a desktop — `h-11` is 44 by name and
 * 39.875px on a monitor. Every load-bearing dimension here is therefore in px,
 * and measured at all five widths rather than reasoned about: width is NOT
 * monotonic in this shell (THE-184 found the content box DROPPING from 951px at
 * 1023px to 708.5px at 1024px as the sidebar appears).
 */

const ROOT = path.resolve(__dirname, '../../..');
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** The ladder every layout suite in this repo uses. */
const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

/** iPhone 14/15 logical height — the questions below are about the BOTTOM of
 *  the viewport, and the harness's 1200px default is no phone. */
const PHONE_HEIGHT = 844;

/** The touch floor. Not negotiable below `sm`. */
const TOUCH_TARGET_MIN_PX = 44;

/**
 * The safe-area inset a notched phone takes at the bottom.
 *
 * 🔴 The nav's own `pb-safe` DOES NOT RESERVE THIS. Compiled against the real
 * config, `pb-safe` emits no rule at all — it is not a utility this repo
 * defines, in tailwind.config.ts or in globals.css — so the class is inert and
 * the nav is exactly as tall as its content. Reported rather than fixed here:
 * defining it would change the height of the bottom nav on every admin screen
 * at once. What the section does instead is add the inset itself, so its
 * clearance is right whether or not `pb-safe` ever starts resolving.
 */
const SAFE_INSET_PX = 34;

/** The admin shell's bottom nav classes, READ FROM THE SHELL — never a
 *  hand-typed copy of a nav that may since have moved. */
function navClass(): string {
  const shell = src('src/components/AdminDashboard.tsx');
  const match = /<div className=\{`(bg-surface-raised border-t lg:border-t-0[^`]*)`\}>/.exec(shell);
  if (!match) {
    throw new Error('the bottom nav could not be located in AdminDashboard.tsx');
  }
  const cls = match[1].replace(/\$\{[^}]*\}/g, 'lg:w-64');
  for (const required of ['fixed', 'bottom-0', 'z-[100]', 'pb-safe']) {
    expect(cls, `the bottom nav no longer carries ${required}`).toContain(required);
  }
  return cls;
}

/** The settings cancel-confirm overlay's classes, read from AdminSettings. */
function dialogClass(): string {
  const settings = src('src/components/AdminSettings.tsx');
  const match = /\{showCancelConfirm && \(\s*<div className="([^"]+)"/.exec(settings);
  if (!match) throw new Error('the cancel-confirm dialog could not be located in AdminSettings.tsx');
  return match[1];
}

interface Box { x: number; y: number; width: number; height: number; top: number; bottom: number }

let browser: MeasuringBrowser;

beforeAll(async () => {
  const css = await buildAppCss();

  const body = renderToStaticMarkup(
    <div>
      <div className="flex">
        <div className="hidden lg:block w-[232px] shrink-0" />
        <div className="min-w-0 flex-1">
          {/* The accordion row's own container classes, so the section is
              measured inside the card it actually renders in rather than on a
              bare page. Copied from SettingsAccordion and asserted against it
              below, so this cannot drift into measuring a stale shell. */}
          <div className="px-4 lg:px-0 sm:max-w-[940px] sm:mx-auto">
            <div className="bg-surface-raised rounded-brand border border-line shadow-[var(--ds-sh-sm)] overflow-hidden">
              <div data-panel className="px-5 py-4 border-t border-line">
                <GivingStatementsSection />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* The bottom nav, with a realistic 44px item inside it. */}
      <div data-nav className={navClass()}>
        <span style={{ display: 'inline-block', height: '44px' }} />
      </div>

      {/* The dialog settings actually opens, at the z-layer it actually uses. */}
      <div data-dialog className={dialogClass()}>
        <div className="bg-surface-raised rounded-xl p-6 max-w-md w-full">confirm</div>
      </div>
    </div>,
  );

  // The panel wrapper above must be the accordion's own, not a guess at it.
  const accordion = src('src/components/settings/SettingsAccordion.tsx');
  expect(accordion, 'the accordion row restyled — this fixture is measuring a stale shell')
    .toContain('bg-surface-raised rounded-brand border border-line shadow-[var(--ds-sh-sm)] overflow-hidden');
  expect(accordion, 'the accordion panel padding moved').toContain('px-5 py-4 border-t border-line');

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the286-'));
  const file = path.join(dir, 'settings.html');
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<style>${css}</style></head><body>${body}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);
}, 180_000);

afterAll(async () => { await browser?.close(); });

/** Every interactive control in the converted panel, with its real box. */
async function controls(viewport: number, height = 1200) {
  return browser.evaluateAt<Array<Box & { tag: string; label: string }>>(viewport, `(() => {
    const panel = document.querySelector('[data-panel]');
    return [...panel.querySelectorAll('input, textarea, button, a[href]')].map((el) => {
      const b = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        label: el.getAttribute('id') || el.getAttribute('data-autosave') || (el.textContent || '').trim(),
        x: b.x, y: b.y, width: b.width, height: b.height, top: b.top, bottom: b.bottom,
      };
    });
  })()`, height);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 12 — every control ≥44px, and the last field clears the bottom nav at 380px
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('12 · every control is ≥44px and the last field clears the bottom nav at 380px', () => {
  it('every control clears the 44px touch floor at 380px', async () => {
    const found = await controls(380, PHONE_HEIGHT);
    expect(found.length, 'the panel rendered no controls — this test would pass vacuously')
      .toBeGreaterThanOrEqual(3);
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

  it('and hands back to Rule 4 above sm rather than carrying 44px onto a desktop', async () => {
    // The settled band, and the cap a later screen must not quietly raise.
    for (const viewport of [768, 1024, 1280, 1440]) {
      const single = (await controls(viewport)).filter((c) => c.tag === 'input');
      expect(single.length, `no single-line control at ${viewport}px`).toBeGreaterThan(0);
      for (const c of single) {
        expect(c.height, `"${c.label}" is ${c.height}px at ${viewport}px — Rule 4 says ${DENSITY_PX.control}`)
          .toBeCloseTo(DENSITY_PX.control, 0);
        expect(c.height, 'the desktop density cap was raised').toBeLessThanOrEqual(DESKTOP_CONTROL_MAX_PX);
      }
    }
  });

  it('🔴 the last field clears the nav INCLUDING the safe inset', async () => {
    const m = await browser.evaluateAt<{
      navTop: number; navHeight: number; panelPadBottom: number;
      lastFieldBottom: number; sectionBottom: number; padRule: string;
    }>(380, `(() => {
      const nav = document.querySelector('[data-nav]').getBoundingClientRect();
      const section = document.querySelector('[data-panel]').firstElementChild;
      const fields = [...document.querySelectorAll('[data-autosave]')];
      const last = fields[fields.length - 1].getBoundingClientRect();
      const cs = getComputedStyle(section);
      return {
        navTop: nav.top, navHeight: nav.height,
        panelPadBottom: parseFloat(cs.paddingBottom),
        lastFieldBottom: last.bottom,
        sectionBottom: section.getBoundingClientRect().bottom,
        padRule: cs.paddingBottom,
      };
    })()`, PHONE_HEIGHT);

    // (a) The budget covers the nav AND the notch. `env(safe-area-inset-bottom)`
    //     resolves to 0 in headless Chromium, so the measured padding is the
    //     120px base alone — which is exactly the worst case to assert against:
    //     it must already clear the nav plus the 34px the nav's own inert
    //     `pb-safe` fails to reserve.
    expect(m.panelPadBottom, 'the bottom clearance no longer covers the nav plus the safe inset')
      .toBeGreaterThanOrEqual(m.navHeight + SAFE_INSET_PX);

    // (b) 🔴 And the inset really is in the rule, not just in the comment. A
    //     `pb-16` (64px) would not cover this, which is the trap the brief names.
    const rule = NAV_CLEARANCE;
    expect(rule, 'the clearance stopped adding the safe-area inset').toContain('env(safe-area-inset-bottom)');
    expect(rule, 'the clearance is a bare pb-16-class value').toMatch(/calc\(\s*120px/);

    // (c) The last field itself sits clear of the nav, measured.
    expect(m.lastFieldBottom, 'the last field is under the bottom nav').toBeLessThan(m.navTop);
    expect(m.lastFieldBottom + SAFE_INSET_PX, 'the last field is under the home indicator')
      .toBeLessThan(m.navTop + m.navHeight);
  });

  it('nothing overflows sideways at any of the five widths', async () => {
    // Width is not monotonic in this shell: #426 measured a card falling TWICE
    // and narrowest at 1280, and #421 found a 4px overflow at 1024 and 1280
    // only. So every rung is measured rather than the extremes.
    for (const viewport of VIEWPORTS) {
      const scrollWidth = await browser.evaluateAt<number>(
        viewport, 'document.documentElement.scrollWidth',
      );
      expect(scrollWidth, `the page scrolls sideways at ${viewport}px`).toBeLessThanOrEqual(viewport);
    }
  });

  it('and no control is wider than the panel at any width', async () => {
    for (const viewport of VIEWPORTS) {
      const panel = await browser.evaluateAt<Box>(viewport, `(() => {
        const b = document.querySelector('[data-panel]').getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height, top: b.top, bottom: b.bottom };
      })()`);
      for (const c of await controls(viewport)) {
        expect(c.width, `"${c.label}" is wider than its panel at ${viewport}px`)
          .toBeLessThanOrEqual(panel.width + 0.5);
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 13 — dialogs open above z-100
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('13 · dialogs open above z-100', () => {
  it('the settings dialog paints above the bottom nav at 380px', async () => {
    const m = await browser.evaluateAt<{ nav: number; dialog: number; navPos: string; dialogPos: string }>(
      380, `(() => {
        const z = (s) => getComputedStyle(document.querySelector(s)).zIndex;
        const p = (s) => getComputedStyle(document.querySelector(s)).position;
        return { nav: Number(z('[data-nav]')), dialog: Number(z('[data-dialog]')),
                 navPos: p('[data-nav]'), dialogPos: p('[data-dialog]') };
      })()`, PHONE_HEIGHT);

    expect(m.navPos).toBe('fixed');
    expect(m.dialogPos).toBe('fixed');
    expect(m.nav, 'the bottom nav left z-100').toBe(100);
    // 🔴 Strictly above. A dialog at or under the nav's layer is a dialog with
    // a navigation bar painted through it.
    expect(m.dialog, 'the settings dialog no longer clears the bottom nav').toBeGreaterThan(m.nav);
  });

  it('it covers the nav geometrically, not merely numerically', async () => {
    const m = await browser.evaluateAt<{ covers: boolean }>(380, `(() => {
      const nav = document.querySelector('[data-nav]').getBoundingClientRect();
      const dlg = document.querySelector('[data-dialog]').getBoundingClientRect();
      return { covers: dlg.top <= nav.top && dlg.bottom >= nav.bottom
                       && dlg.left <= nav.left && dlg.right >= nav.right };
    })()`, PHONE_HEIGHT);
    expect(m.covers, 'the dialog does not span the nav it is supposed to sit over').toBe(true);
  });

  it('⚠️ records that the installed dialog/sheet primitives ship BELOW the nav', () => {
    // 🔴 REPORTED, NOT CHANGED. `ui/dialog.tsx` and `ui/sheet.tsx` are shadcn
    // defaults at `z-50`, which is under the nav's `z-[100]` — so a settings
    // section that reaches for them unguarded gets a dialog with a navigation
    // bar painted through it. Nothing in this slice mounts one (the converted
    // section opens no dialog at all, and the screen's own cancel-confirm is
    // hand-rolled at z-[200]), so this is a finding for whoever converts a
    // section that does, and NOT a change to a primitive whose digests are
    // pinned by ds-primitives.test.tsx.
    //
    // The established layering is #427's: scrim z-[101] / sheet z-[102],
    // matching AdminDashboard's own More Sheet.
    for (const rel of ['src/components/ui/dialog.tsx', 'src/components/ui/sheet.tsx']) {
      expect(src(rel), `${rel} no longer ships at z-50 — re-check this finding`).toContain('z-50');
    }
    const shell = src('src/components/AdminDashboard.tsx');
    expect(shell, "the More Sheet's scrim layer moved").toContain('z-[101]');
    expect(shell, 'the More Sheet layer moved').toContain('z-[102]');
  });

  it('the converted section opens no dialog, sheet, popover or dropdown', () => {
    // So the claim above is a statement about this slice, not an assumption.
    const section = src('src/components/settings/GivingStatementsSection.tsx');
    for (const primitive of ['Dialog', 'Sheet', 'Popover', 'DropdownMenu']) {
      expect(section, `the section mounts a ${primitive} and must then clear z-100`)
        .not.toMatch(new RegExp(`<${primitive}\\b`));
    }
  });
});
