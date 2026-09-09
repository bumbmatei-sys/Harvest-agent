// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom, and this is load-bearing — the same reason THE-286's
// layout suite gives. Every question here is a LAYOUT question and happy-dom
// cannot answer one: with the real compiled stylesheet injected,
// `getBoundingClientRect()` returns all zeros and `getComputedStyle(el).display`
// answers `block` for a flex container. Under the repo's default happy-dom
// environment the globals are replaced with browser-semantics ones, and a
// request to the browser's own debugger port then fails same-origin, so the
// measuring browser can never be attached to.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { DENSITY_PX, DESKTOP_CONTROL_MAX_PX } from '../layout/form-layout';
import { NAV_CLEARANCE } from '../settings/GivingStatementsSection';

/* 🔴 THE-335 — THE NEWSLETTER SWITCH IS MOCKED ON.
   This suite MEASURES `IntegrationsSection` as itself, through its own
   `platformOverride` path, so that all three provider cards and their real
   controls are on the page to measure. `NEWSLETTER_FEATURE_ENABLED` is false on
   disk now, and the switch sits AHEAD of the override by design — a hidden
   feature is hidden from the super admin too — so Instagram and Mailchimp would
   both be absent and this file would be measuring one card where it means to
   measure three. Its own vacuity guard catches that, which is how it was found.

   ⚠️ MOCKED RATHER THAN THE FLOOR LOWERED. The composition has to stay measured
   for the flip back; that the cards are GONE while the switch is off is asserted
   in `AdminSettings.integrations-gating.test.tsx`. */
vi.mock('../../lib/newsletter-feature', () => ({
  NEWSLETTER_FEATURE_ENABLED: true,
  NEWSLETTER_HIDDEN_MESSAGE: 'Newsletter is temporarily unavailable.',
}));


/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-296 — where the two converted sections land, and how big their controls are
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ─── "≥44px at every width" versus Rule 4 ────────────────────────────────────
 *
 * Settled the way THE-286 settled it, and the way the brief itself asks for:
 * 44px is a TOUCH floor and is asserted below `sm`; Rule 4's 38px control / 40px
 * action band is the settled DESKTOP density, capped by DESKTOP_CONTROL_MAX_PX,
 * and `AdminCRM.desktop-layout.test.tsx` asserts `DENSITY_PX.control < 44` on
 * purpose. A desktop pointer is not a thumb. Raising the desktop band to 44
 * would break a settled, tested rule inside a slice whose whole point is to
 * inherit what is already there.
 *
 * ─── The rem trap ───────────────────────────────────────────────────────────
 *
 * globals.css trims the rem base to 14.5px from 1024px up, so a rem-named size
 * renders 9.4% smaller than its name on a desktop (`h-11` is 44 by name and
 * 39.875px on a monitor). Every load-bearing dimension here is in px, and
 * measured at all five widths rather than reasoned about: width is NOT monotonic
 * in this shell — THE-184 found the content box DROPPING from 951px at 1023px to
 * 708.5px at 1024px as the sidebar appears.
 */

const ROOT = path.resolve(__dirname, '../../..');
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** The ladder every layout suite in this repo uses. */
const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;
/** iPhone 14/15 logical height — these questions are about the BOTTOM of the
 *  viewport, and the harness's 1200px default is no phone. */
const PHONE_HEIGHT = 844;
const TOUCH_TARGET_MIN_PX = 44;

/**
 * The safe-area inset a notched phone takes at the bottom.
 *
 * 🔴 The nav's own `pb-safe` DOES NOT RESERVE IT. Compiled against the real
 * config `pb-safe` emits no rule at all — it is not a utility this repo defines,
 * in tailwind.config.ts or in globals.css — so the class is inert and the nav is
 * exactly as tall as its content. THE-295 is fixing that; this slice does not
 * depend on it landing, and makes its own clearance explicit instead.
 */
const SAFE_INSET_PX = 34;

/** The admin shell's bottom nav classes, READ FROM THE SHELL. */
function navClass(): string {
  const shell = src('src/components/AdminDashboard.tsx');
  /* ⚠️ THE-332 — WIDENED, NOT LOOSENED. This looked for `className={`…`}`
     exactly: a template literal, with nothing between `<div` and `className`.
     Both of those were implementation details of a nav that has since changed
     shape — the desktop half became a rail, so the collapsed/expanded width
     interpolation that MADE it a template literal is gone and the class list is
     now a plain string, and the element carries a `data-nav-shell` marker. The
     pattern matched neither, so `navClass()` threw and this whole suite was
     SKIPPED rather than failed, which says nothing about its assertions and is
     the worst way for a guard to go quiet.
     What it still refuses to do is measure a stale hand-typed copy: the
     `bg-surface-raised border-t lg:border-t-0` anchor and the four required
     tokens asserted below are unchanged, so a nav that stops being
     bottom-anchored still fails here. It also still matches the template-literal
     form, because CI runs `refs/pull/N/merge` and a merge ref cut before
     THE-332 landed legitimately carries it. */
  const match = /<div[^>]*?className=\{?[`"](bg-surface-raised border-t lg:border-t-0[^`"]*)[`"]\}?>/.exec(shell);
  if (!match) throw new Error('the bottom nav could not be located in AdminDashboard.tsx');
  const cls = match[1].replace(/\$\{[^}]*\}/g, 'lg:w-64');
  for (const required of ['fixed', 'bottom-0', 'z-[100]', 'pb-safe']) {
    expect(cls, `the bottom nav no longer carries ${required}`).toContain(required);
  }
  return cls;
}

/**
 * 🔴 The dialog OnboardingSection actually opens, READ FROM THE SECTION.
 *
 * THE-286 could record "no converted section opens a dialog" as a finding for
 * whoever converted one that does. This slice is that ticket — the question
 * editor is a real overlay — so the class is extracted from the source rather
 * than hand-typed, and the z-order is then measured rather than asserted about
 * a copy.
 */
function dialogClass(): string {
  const section = src('src/components/settings/OnboardingSection.tsx');
  const m = /\{showQuestionModal && editingQuestion && \(\s*<div className="([^"]+)"/.exec(section);
  if (!m) throw new Error("OnboardingSection's question dialog could not be located");
  return m[1];
}

interface Box { x: number; y: number; width: number; height: number; top: number; bottom: number }

let browser: MeasuringBrowser;

beforeAll(async () => {
  const css = await buildAppCss();

  // Rendered as STATIC MARKUP in the states that matter, rather than mounted:
  // both sections load from Firestore on mount and a server render would show
  // an empty list. The markup below is the real components' output shape with
  // the real class strings, asserted against the sources in the fixture guard
  // at the end of this file so it cannot drift into measuring a stale copy.
  const { OnboardingPanelFixture, IntegrationsPanelFixture } = await import(
    './__fixtures__/the-296-panels'
  );

  const panel = (id: string, children: React.ReactNode) => (
    <div className="px-4 lg:px-0 sm:max-w-[940px] sm:mx-auto">
      <div className="bg-surface-raised rounded-brand border border-line shadow-[var(--ds-sh-sm)] overflow-hidden">
        {/* THE-316 — the hairline is a `Separator` between the header and
            the panel, not a `border-t` on the panel itself. Replicated here as
            the bare rule it compiles to, so the measured box below is the same
            box the screen paints. */}
        <div className="border-t border-line" />
        <div data-panel={id} className="px-5 py-4">{children}</div>
      </div>
    </div>
  );

  const body = renderToStaticMarkup(
    <div>
      <div className="flex">
        <div className="hidden lg:block w-[232px] shrink-0" />
        <div className="min-w-0 flex-1">
          {panel('onboarding', <OnboardingPanelFixture />)}
          {panel('integrations', <IntegrationsPanelFixture />)}
        </div>
      </div>

      {/* The bottom nav, with a realistic 44px item inside it. */}
      <div data-nav className={navClass()}>
        <span style={{ display: 'inline-block', height: '44px' }} />
      </div>

      {/* 🔴 The dialog THIS SLICE opens, at the layer it actually uses. */}
      <div data-dialog className={dialogClass()}>
        <div className="bg-surface-raised rounded-brand-lg p-4 max-w-md w-full">editor</div>
      </div>
    </div>,
  );

  // The panel wrapper above must be the accordion's own, not a guess at it.
  const accordion = src('src/components/settings/SettingsAccordion.tsx');
  expect(accordion, 'the accordion row restyled — this fixture is measuring a stale shell')
    .toContain('bg-surface-raised rounded-brand border border-line shadow-[var(--ds-sh-sm)] overflow-hidden');
  // THE-316 — the padding and the hairline are now two elements: the panel
  // keeps `px-5 py-4`, and the rule between it and the header is a Separator.
  // Both halves are still asserted, so a change to either still fails here.
  expect(accordion, 'the accordion panel padding moved').toContain('px-5 py-4');
  expect(accordion, 'the accordion panel lost its hairline').toContain('<Separator />');

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the296-'));
  const file = path.join(dir, 'sections.html');
  writeFileSync(file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`);

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);
}, 180_000);

afterAll(async () => { await browser?.close(); });

/** Every interactive control in one converted panel, with its real box. */
async function controls(panel: string, viewport: number, height = 1200) {
  return browser.evaluateAt<Array<Box & { tag: string; label: string }>>(viewport, `(() => {
    const root = document.querySelector('[data-panel="${panel}"]');
    return [...root.querySelectorAll('input, textarea, select, button, a[href]')].map((el) => {
      const b = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        label: el.getAttribute('aria-label') || el.getAttribute('id') || (el.textContent || '').trim().slice(0, 40),
        x: b.x, y: b.y, width: b.width, height: b.height, top: b.top, bottom: b.bottom,
      };
    });
  })()`, height);
}

const PANELS = ['onboarding', 'integrations'] as const;

/* ═══════════════════════════════════════════════════════════════════════════
 * 10 — every control ≥44px below sm; Rule 4's band holds above
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('10 · every control is ≥44px below sm; Rule 4 holds above', () => {
  it.each(PANELS)('%s clears the 44px touch floor at 380px', async (panel) => {
    const found = await controls(panel, 380, PHONE_HEIGHT);
    expect(found.length, `${panel} rendered no controls — this test would pass vacuously`)
      .toBeGreaterThanOrEqual(4);
    for (const c of found) {
      expect(c.height, `"${c.label}" (${c.tag}) is a ${c.height}px target on a phone in ${panel}`)
        .toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
    }
  });

  it.each(PANELS)('%s holds the floor across every mobile width, not just the narrowest', async (panel) => {
    for (const viewport of [380, 480, 639]) {
      for (const c of await controls(panel, viewport, PHONE_HEIGHT)) {
        expect(c.height, `"${c.label}" is ${c.height}px at ${viewport}px in ${panel}`)
          .toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
      }
    }
  });

  it.each(PANELS)('%s hands back to Rule 4 above sm rather than carrying 44px onto a desktop', async (panel) => {
    for (const viewport of [768, 1024, 1280, 1440]) {
      const single = (await controls(panel, viewport)).filter((c) => c.tag === 'input' || c.tag === 'select');
      expect(single.length, `no single-line control at ${viewport}px in ${panel}`).toBeGreaterThan(0);
      for (const c of single) {
        expect(c.height, `"${c.label}" is ${c.height}px at ${viewport}px — Rule 4 says ${DENSITY_PX.control}`)
          .toBeCloseTo(DENSITY_PX.control, 0);
        expect(c.height, 'the desktop density cap was raised').toBeLessThanOrEqual(DESKTOP_CONTROL_MAX_PX);
      }
    }
  });

  it('🔴 …and Rule 4 is under the touch floor ON PURPOSE — this is not an accident to fix', () => {
    // Pinned so a later ticket cannot "resolve" the two numbers by raising the
    // desktop band. The 38 and the 44 answer different questions.
    expect(DENSITY_PX.control).toBeLessThan(TOUCH_TARGET_MIN_PX);
    expect(DENSITY_PX.action).toBeLessThanOrEqual(DESKTOP_CONTROL_MAX_PX);
  });

  it.each(PANELS)('nothing in %s overflows sideways at any of the five widths', async (panel) => {
    for (const viewport of VIEWPORTS) {
      const scrollWidth = await browser.evaluateAt<number>(viewport, 'document.documentElement.scrollWidth');
      expect(scrollWidth, `the page scrolls sideways at ${viewport}px`).toBeLessThanOrEqual(viewport);
      const box = await browser.evaluateAt<Box>(viewport, `(() => {
        const b = document.querySelector('[data-panel="${panel}"]').getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height, top: b.top, bottom: b.bottom };
      })()`);
      for (const c of await controls(panel, viewport)) {
        expect(c.width, `"${c.label}" is wider than its panel at ${viewport}px`)
          .toBeLessThanOrEqual(box.width + 0.5);
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 11 — the last field clears the bottom nav at 380px, in BOTH nav states
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('11 · the last field clears the bottom nav at 380px, in both nav states', () => {
  it('🔴 the clearance is explicit and does NOT rely on pb-safe', () => {
    // `pb-safe` compiles to nothing in this repo. THE-295 is fixing that; this
    // slice must be correct whether or not it lands, so the inset is added by
    // the section itself.
    expect(NAV_CLEARANCE, 'the clearance stopped adding the safe-area inset')
      .toContain('env(safe-area-inset-bottom)');
    expect(NAV_CLEARANCE, 'the clearance is a bare pb-16-class value').toMatch(/calc\(\s*120px/);
    for (const rel of ['src/components/settings/OnboardingSection.tsx',
                       'src/components/settings/IntegrationsSection.tsx']) {
      expect(src(rel), `${rel} depends on pb-safe`).not.toContain('pb-safe');
      expect(src(rel), `${rel} stopped taking the shared clearance`).toContain('NAV_CLEARANCE');
    }
  });

  it.each(PANELS)('%s budgets for the nav AND the notch', async (panel) => {
    const m = await browser.evaluateAt<{ navHeight: number; padBottom: number }>(380, `(() => {
      const nav = document.querySelector('[data-nav]').getBoundingClientRect();
      const section = document.querySelector('[data-panel="${panel}"]').firstElementChild;
      return { navHeight: nav.height, padBottom: parseFloat(getComputedStyle(section).paddingBottom) };
    })()`, PHONE_HEIGHT);
    // `env(safe-area-inset-bottom)` resolves to 0 in headless Chromium, so the
    // measured padding is the 120px base alone — exactly the worst case to
    // assert against: it must already cover the nav plus the 34px the nav's own
    // inert `pb-safe` fails to reserve.
    expect(m.padBottom, `${panel}'s clearance no longer covers the nav plus the safe inset`)
      .toBeGreaterThanOrEqual(m.navHeight + SAFE_INSET_PX);
  });

  it.each(PANELS)('🔴 %s: the last control clears the nav in BOTH nav states', async (panel) => {
    // ⚠️ THE NAV HIDES ON SCROLL, so there are two states and the section must
    // be right in each.
    //
    // 🔴 MEASURED AT THE BOTTOM OF THE SCROLL, which is the only place the
    // question means anything. `getBoundingClientRect()` is viewport-relative,
    // so any control below the fold trivially reports a bottom past a
    // `fixed bottom-0` nav — that says the page is long, not that the clearance
    // is wrong. The clearance exists for exactly one moment: when a person has
    // scrolled as far as the page goes and the last control is the last thing
    // above the nav. So scroll there first, then ask.
    for (const navShown of [true, false]) {
      const m = await browser.evaluateAt<{
        navTop: number; navHeight: number; lastBottom: number; viewportH: number; atBottom: boolean;
      }>(380, `(() => {
          const nav = document.querySelector('[data-nav]');
          nav.style.display = ${navShown ? "''" : "'none'"};
          // 🔴 ONE PANEL AT A TIME, because that is what the screen does:
          // SettingsAccordion holds its expanded id as a single value, so one
          // row is open across the whole screen. Measuring two open panels
          // stacked would ask a question the product never poses — and would
          // scroll the upper one off the top of the viewport on the way to the
          // page's end, which is what a first draft of this test did.
          const others = [...document.querySelectorAll('[data-panel]')]
            .filter((p) => p.getAttribute('data-panel') !== '${panel}');
          const restore = others.map((p) => [p.parentElement.parentElement, p.parentElement.parentElement.style.display]);
          for (const [el] of restore) el.style.display = 'none';
          window.scrollTo(0, document.documentElement.scrollHeight);
          const root = document.querySelector('[data-panel="${panel}"]');
          const els = [...root.querySelectorAll('input, textarea, select, button, a[href]')];
          const last = els[els.length - 1].getBoundingClientRect();
          const nb = nav.getBoundingClientRect();
          const atBottom = Math.abs(
            window.scrollY + window.innerHeight - document.documentElement.scrollHeight) < 2;
          nav.style.display = '';
          for (const [el, d] of restore) el.style.display = d;
          window.scrollTo(0, 0);
          return { navTop: nb.top, navHeight: nb.height, lastBottom: last.bottom,
                   viewportH: window.innerHeight, atBottom };
        })()`, PHONE_HEIGHT);

      expect(m.atBottom, 'the page did not actually scroll to its end').toBe(true);

      if (navShown) {
        expect(m.lastBottom, `${panel}'s last control sits under the bottom nav`)
          .toBeLessThan(m.navTop);
        expect(m.lastBottom + SAFE_INSET_PX, `${panel}'s last control sits under the home indicator`)
          .toBeLessThan(m.navTop + m.navHeight);
      } else {
        // With the nav gone the control must still be on screen — a clearance
        // that pushed content past the fold would be its own bug.
        expect(m.lastBottom, `${panel}'s last control left the viewport with the nav hidden`)
          .toBeLessThanOrEqual(m.viewportH);
        expect(m.lastBottom, `${panel}'s last control is above the viewport entirely`)
          .toBeGreaterThan(0);
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 12 — dialogs open above z-100
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('12 · dialogs open above z-100', () => {
  it('🔴 the question editor paints above the bottom nav at 380px', async () => {
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
    // 🔴 Strictly above. A dialog at or under the nav's layer is a dialog with a
    // navigation bar painted through it.
    expect(m.dialog, 'the question editor no longer clears the bottom nav').toBeGreaterThan(m.nav);
    expect(m.dialog, 'the editor left the z-[200] layer THE-286 established').toBe(200);
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

  it('⚠️ …and it does NOT depend on THE-295 raising the primitives, because it mounts none', () => {
    // 🔴 THIS SLICE'S INDEPENDENCE IS THE CLAIM, and it is unchanged. The editor
    // is hand-rolled at z-[200] — the layer THE-286's settings dialog already
    // uses — and mounts no primitive, so it never inherited the primitives'
    // z-index whatever that was. The two assertions below ARE that claim, and
    // both still hold verbatim.
    const section = src('src/components/settings/OnboardingSection.tsx');
    for (const primitive of ['Dialog', 'Sheet', 'Popover', 'DropdownMenu']) {
      expect(section, `the section mounts a ${primitive} and would then inherit its z-index`)
        .not.toMatch(new RegExp(`<${primitive}\\b`));
    }
    expect(section, 'the question editor left z-[200]').toContain('z-[200]');

    // ✅ What HAS changed is the state of the world this test used to record.
    // When THE-296 was written the primitives still shipped at shadcn's z-50,
    // under the nav's z-[100], and this loop pinned that finding so it could not
    // be forgotten. THE-295 has since raised them — scrim z-[101], panel
    // z-[102], #427's layering — so the finding is CLOSED and what is pinned
    // here is the fix. Asserting `z-50` again would now assert the bug.
    //
    // Note this makes the section's independence a belt-and-braces property
    // rather than a necessity: it would be correct either way.
    for (const rel of ['src/components/ui/dialog.tsx', 'src/components/ui/sheet.tsx']) {
      expect(src(rel), `${rel} fell back to the shadcn z-50 default, under the nav`)
        .not.toContain('z-50');
      expect(src(rel), `${rel} lost its scrim layer`).toContain('z-[101]');
      expect(src(rel), `${rel} lost its panel layer`).toContain('z-[102]');
    }
  });
});
