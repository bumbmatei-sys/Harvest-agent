// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom — the same reason THE-290's, THE-294's and THE-296's
// position tests give. Nothing here needs a DOM: the page is rendered to a
// string and every measurement happens inside a real browser over CDP. Under
// happy-dom the globals carry browser semantics and a request to the browser's
// own debugger port fails same-origin, so the browser could never be attached.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { NAV_CLEARANCE } from '../settings/GivingStatementsSection';
import { ACTION_HEIGHT, ICON_BUTTON } from '../settings/OnboardingSection';
import { FORM_CONTAINER, DENSITY_PX, DESKTOP_CONTROL_MAX_PX } from '../layout/form-layout';

/**
 * THE-300 — the billing surface's GEOMETRY, measured in Chromium.
 *
 * ─── Why this is measured and not reasoned about ─────────────────────────────
 *
 * 🔴 happy-dom HAS NO LAYOUT ENGINE. With the real compiled stylesheet injected,
 * `getBoundingClientRect()` still returns zeros on every element and
 * `getComputedStyle` answers `display: block` for a flex container. Every other
 * layout guard in this repo reasons about CLASS NAMES, which answers "how tall
 * may this box be" and cannot answer "how tall did it land" — and a touch target
 * is exactly the second question, because it depends on the line box of whatever
 * text is inside it.
 *
 * ⚠️ WIDTH IS NOT MONOTONIC on this surface, so the ladder is measured whole:
 * 380 / 768 / 1024 / 1280 / 1440. Crossing 1024 the shell TAKES 275.5px away and
 * globals.css trims the rem base to 14.5px, so a control can be SHORTER at 1280
 * than at 768. Checking only the phone and the desktop would miss it.
 *
 * ⚠️ AND NOTHING IS MEASURED BEFORE IT SETTLES. THE-295 measured 1018px against
 * a real 224px and THE-292 read one control at 38.19 and 40.73 on consecutive
 * runs, both because a `transition` was still running. Every reading below is
 * taken after two animation frames plus a beat (`evaluateAt`'s own settle), and
 * this slice removed the `transition-all` from the term segments for the same
 * reason — a transition over `all` animates the very height being measured.
 *
 * ─── 🔴 WHAT IS AND IS NOT CLAIMED ABOUT 44px ────────────────────────────────
 *
 * THE-190 forbids a blanket 44px floor, and it is right to: 423 sub-44px targets
 * are already shipped and deliberately left alone, so a floor asserted over a
 * whole screen fails honest controls or gets weakened until it means nothing.
 *
 * So the claim here is scoped exactly to what this slice OWNS — the add-on
 * controls and the term segments — which is THE-298's precedent (lift your own
 * control, report the ones you do not). The plan card's ~40px Upgrade button is
 * measured and REPORTED rather than asserted, with the reason recorded in the
 * source suite: its sub-640px class layer is pinned byte-for-byte and the only
 * way past that pin is to re-record the baseline, which substitutes the value
 * the guard measures.
 */

/** ⚠️ Width is not monotonic here — the whole ladder, not the ends. */
const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

/**
 * The shell, replicated class-for-class from `AdminDashboard`.
 *
 * 🔴 `pb-safe` IS WRITTEN AND IS DELIBERATELY NOT RELIED ON. There is no such
 * utility in this repo, so it compiles to nothing and reserves nothing; #437
 * fixed that for the MEMBER shell but the ADMIN nav still carries the inert
 * class, which is why this slice puts an explicit `NAV_CLEARANCE` on the page.
 * The class is replicated so the fixture matches the shell character for
 * character; it simply contributes no pixels, which is the point.
 *
 * ⚠️ And the admin nav does NOT hide on scroll — `MainApp` carries
 * `max-lg:translate-y-full` behind `isNavVisible`, `AdminDashboard` carries no
 * translate at all. So "both nav states" on THIS shell is the two FORMS it
 * takes: a fixed bottom bar below `lg`, a sidebar column from `lg`.
 */
const SELECTORS = {
  scroller: '[data-shell-scroll]',
  page: '[data-billing-page]',
  last: '[data-billing-last]',
  bottomNav: '[data-shell-bottom-nav]',
  dialogScrim: '[data-probe-scrim]',
  dialogPanel: '[data-probe-panel]',
} as const;

/**
 * The controls this slice OWNS, each with the floor it must clear below `sm`.
 * Labelled so a failure names the control rather than an index.
 */
const OWNED = [
  { key: 'addon-buy', label: 'Add-on: Add / Remove' },
  { key: 'addon-minus', label: 'Add-on: decrement' },
  { key: 'addon-plus', label: 'Add-on: increment' },
  { key: 'addon-commit', label: 'Add-on: commit the charge' },
  { key: 'term-monthly', label: 'Billing term: Monthly' },
  { key: 'term-quarterly', label: 'Billing term: Quarterly' },
  { key: 'term-yearly', label: 'Billing term: Yearly' },
] as const;

/**
 * A REPLICA of the two converted controls, built from the very class strings the
 * components use — read out of their own source at build time rather than
 * retyped, so a change to the component changes what is measured.
 *
 * ⚠️ WHY A REPLICA AND NOT THE REAL COMPONENTS. `AddOnsSection` renders nothing
 * until `/api/dodo/addons` answers and `processor === 'dodo'`, and this page is
 * STATIC markup with no React attached — there is no fetch to resolve. Mounting
 * it would measure an empty div. The class strings ARE the geometry, so they are
 * lifted verbatim from the source and asserted to still be there.
 */
const ROOT = path.resolve(__dirname, '../../..');
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** Pull a class string out of a component, so the replica cannot drift. */
function classFrom(rel: string, marker: RegExp, label: string): string {
  const m = marker.exec(src(rel));
  if (!m) throw new Error(`could not find ${label} in ${rel} — the replica has drifted`);
  return expand(m[1]);
}

/**
 * Resolve the interpolations a lifted class string carries.
 *
 * 🔴 The shared constants are expanded from their REAL exports, so a change to
 * `ACTION_HEIGHT` or `ICON_BUTTON` moves what is measured. Anything else
 * interpolated is a runtime branch (a selected/unselected fill) and collapses to
 * whitespace — none of those carry a height.
 */
function expand(cls: string): string {
  return cls
    .replace(/\$\{FORM_CONTAINER\}/g, FORM_CONTAINER)
    .replace(/\$\{NAV_CLEARANCE\}/g, NAV_CLEARANCE)
    .replace(/\$\{ACTION_HEIGHT\}/g, ACTION_HEIGHT)
    .replace(/\$\{ICON_BUTTON\}/g, ICON_BUTTON)
    .replace(/\$\{[^}]*\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ADDONS = 'src/components/settings/AddOnsSection.tsx';
const TERM = 'src/components/settings/BillingTermToggle.tsx';
const BILLING = 'src/components/BillingAndPayments.tsx';

function page(): string {
  /**
   * 🔴 ANCHORED ON STABLE ATTRIBUTES, NOT ON THE CLASSES BEING MEASURED.
   *
   * ⚠️ The first version matched each control by its leading utilities
   * (`mt-3 w-full px-3 …`). That made the anchor and the measurement the same
   * string: shrinking a stepper back to `p-1.5` did not produce a SHORT CONTROL,
   * it produced "could not find the increment stepper" and skipped all fifteen
   * tests. A guard that vanishes when the thing it guards changes is not a
   * guard. Each control is now found by an `aria-label` or by the handler it
   * carries — neither of which a restyle touches — and whatever className it
   * has is what gets measured.
   */
  const buyClass = classFrom(ADDONS,
    /onClick=\{\(\) => change\(addon, held > 0 \? 0 : 1\)\}[\s\S]{0,400}?className=\{`([^`]*)`\}/,
    'the add-on buy button');
  const stepDown = classFrom(ADDONS,
    /aria-label=\{`Remove one \$\{addon\.name\}`\}[\s\S]{0,600}?className=\{`([^`]*)`\}/,
    'the decrement stepper');
  const stepUp = classFrom(ADDONS,
    /aria-label=\{`Add one \$\{addon\.name\}`\}[\s\S]{0,600}?className=\{`([^`]*)`\}/,
    'the increment stepper');
  const commit = classFrom(ADDONS,
    /onClick=\{\(\) => change\(addon, target\)\}[\s\S]{0,400}?className=\{`([^`]*)`\}/,
    'the commit button');
  const segment = classFrom(TERM,
    /onClick=\{\(\) => onChange\(term\)\}[\s\S]{0,2500}?className=\{`([^`]*)`\}/,
    'the term segment');
  const track = classFrom(TERM, /data-testid="billing-term-toggle"[\s\S]{0,300}?className="([^"]*)"/, 'the term track');

  /**
   * 🔴 THE PAGE ROOT IS READ OUT OF `BillingAndPayments`, NOT ASSEMBLED HERE.
   *
   * ⚠️ Assembling it from the imported constants — `${FORM_CONTAINER} space-y-6
   * ${NAV_CLEARANCE}` — measured what this TEST believes the page is, not what
   * the page is. Deleting the clearance from the real component left the
   * measurement untouched and every clearance assertion passed on a page that
   * no longer had any. So the root class comes from the source, with the same
   * constants expanded, and the mutation now moves the pixels.
   */
  const pageRoot = classFrom(BILLING, /<div className=\{`([^`]*space-y-6[^`]*)`\}>/, 'the billing page root');

  return renderToStaticMarkup(
    <div className="flex h-screen">
      {/* The nav in its SIDEBAR form, from `lg`. No assertion reads its width. */}
      <div className="hidden lg:block w-[289px] shrink-0" />
      <div className="min-w-0 flex-1 flex flex-col">
        {/* AdminDashboard's own billing scroll panel, class for class. */}
        <div data-shell-scroll className="flex-1 overflow-y-auto p-4 lg:p-6">
          {/* BillingAndPayments' root, including this slice's clearance. */}
          <div data-billing-page className={pageRoot}>
            {/* Enough content to make the panel genuinely scroll at 380px —
                otherwise the clearance assertion is vacuous. */}
            <div style={{ height: '1400px' }} />

            <div className="bg-surface-raised rounded-2xl p-5 border border-line shadow-xs">
              <div className={track}>
                <button data-control="term-monthly" className={segment}>
                  <span className="block">Monthly</span>
                </button>
                <button data-control="term-quarterly" className={segment}>
                  <span className="block">Quarterly</span>
                  <span className="block text-[11px] font-bold text-gold">−10%</span>
                </button>
                <button data-control="term-yearly" className={segment}>
                  <span className="block">Yearly</span>
                  <span className="block text-[11px] font-bold text-gold">−20%</span>
                </button>
              </div>
            </div>

            {/* AddOnsSection's own card — the one it keeps, because it owns its
                own absence. Its controls, at the real class strings. */}
            <div className="bg-surface-raised rounded-2xl p-5 border border-line shadow-xs">
              <ul className="space-y-2.5">
                <li className="rounded-brand border-[0.5px] border-line bg-surface-tint px-5 py-4">
                  <button data-control="addon-buy" className={buyClass}>Add for $9/mo</button>
                  <div className="mt-3 flex items-center gap-2">
                    <button data-control="addon-minus" aria-label="Remove one" className={stepDown}>
                      <svg width="14" height="14" />
                    </button>
                    <span className="text-sm font-semibold text-strong w-6 text-center">1</span>
                    <button data-control="addon-plus" aria-label="Add one" className={stepUp}>
                      <svg width="14" height="14" />
                    </button>
                  </div>
                  <button data-control="addon-commit" className={commit}>Add 1 — $9.00 today</button>
                </li>
              </ul>
            </div>

            {/* The plan card's button — MEASURED AND REPORTED, not asserted.
                Its real class string, so the number in the report is real. */}
            <div className="bg-surface-raised rounded-2xl p-5 border border-line shadow-xs">
              <button data-control="plan-upgrade" className="w-full py-2.5 rounded-xl text-sm font-semibold bg-gold text-white">
                Upgrade to Pro
              </button>
            </div>

            {/* The LAST thing on the billing page — Generate Statement. */}
            <div data-billing-last className="bg-surface-raised rounded-2xl p-5 border border-line shadow-xs">
              <button className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gold">
                Generate Statement
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* A dialog scrim and panel at the primitives' own z-indices (#437), so
          the layering claim is measured rather than read off a class name. */}
      <div data-probe-scrim className="fixed inset-0 isolate z-[101]" />
      <div data-probe-panel className="fixed top-1/2 left-1/2 z-[102] w-full max-w-[calc(100%-2rem)]">panel</div>

      {/* The SAME nav in its bottom-bar form, below `lg`. `pb-safe` is written
          because the shell writes it; it compiles to nothing. */}
      <div
        data-shell-bottom-nav
        className="lg:hidden bg-surface-raised border-t border-line flex justify-center py-2 px-2 pb-safe fixed bottom-0 w-full z-[100]"
      >
        <span>Nav</span>
      </div>
    </div>,
  );
}

interface Control { label: string; height: number; width: number }
interface Reading {
  viewport: number;
  docScrollWidth: number;
  controls: Record<string, Control | null>;
  navPosition: string;
  navDisplay: string;
  navZ: string;
  scrimZ: string;
  panelZ: string;
  /** The last card and the nav, with the panel scrolled home. */
  scrolled: { lastBottom: number; navTop: number; scrolledBy: number } | null;
}

let browser: MeasuringBrowser;
const readings = new Map<number, Reading>();

beforeAll(async () => {
  const css = await buildAppCss();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'the300-'));
  const file = path.join(dir, 'billing.html');
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${page()}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const viewport of VIEWPORTS) {
    const reading = await browser.evaluateAt<Reading>(viewport, `(() => {
      const sel = ${JSON.stringify(SELECTORS)};
      const z = (s) => {
        const el = document.querySelector(s);
        return el ? getComputedStyle(el).zIndex : 'missing';
      };
      const controls = {};
      for (const el of document.querySelectorAll('[data-control]')) {
        const b = el.getBoundingClientRect();
        controls[el.getAttribute('data-control')] = {
          label: el.getAttribute('data-control'), height: b.height, width: b.width,
        };
      }
      const navEl = document.querySelector(sel.bottomNav);
      return {
        viewport: window.innerWidth,
        docScrollWidth: document.documentElement.scrollWidth,
        controls,
        navPosition: navEl ? getComputedStyle(navEl).position : 'missing',
        navDisplay: navEl ? getComputedStyle(navEl).display : 'missing',
        navZ: z(sel.bottomNav),
        scrimZ: z(sel.dialogScrim),
        panelZ: z(sel.dialogPanel),
        /*
         * SCROLLED TO THE BOTTOM, the only state in which the last card could be
         * hidden under a fixed bottom-0 nav. Measuring the unscrolled page would
         * pass on any surface long enough to overflow.
         * (No backticks in here: this lives inside a template literal.)
         */
        scrolled: (() => {
          const sc = document.querySelector(sel.scroller);
          const last = document.querySelector(sel.last);
          if (!sc || !last || !navEl) return null;
          const before = sc.scrollTop;
          sc.scrollTop = sc.scrollHeight;
          const out = {
            lastBottom: last.getBoundingClientRect().bottom,
            navTop: navEl.getBoundingClientRect().top,
            scrolledBy: sc.scrollTop - before,
          };
          sc.scrollTop = before;
          return out;
        })(),
      };
    })()`, 900);
    readings.set(viewport, reading);
  }
}, 180_000);

afterAll(async () => { await browser?.close(); });

const at = (v: number): Reading => {
  const r = readings.get(v);
  if (!r) throw new Error(`no reading at ${v}px`);
  return r;
};

/* ═══════════════════════════════════════════════════════════════════════════
 * 10 — touch targets
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('10 · every control this slice owns is ≥44px below sm; Rule 4 holds above', () => {
  it('the premise holds — the page really laid out, at every viewport', () => {
    for (const v of VIEWPORTS) {
      const r = at(v);
      expect(r.viewport, `the viewport did not take at ${v}px`).toBe(v);
      for (const { key } of OWNED) {
        expect(r.controls[key], `${key} is missing at ${v}px — is this measuring anything?`).toBeTruthy();
        expect(r.controls[key]!.height, `${key} has no height at ${v}px`).toBeGreaterThan(0);
      }
    }
  });

  it('🔴 below sm (380px) every owned control clears the 44px touch floor', () => {
    /**
     * ⚠️ TWO CONTROLS CLEAR IT FOR DIFFERENT REASONS, and the difference is why
     * this is measured rather than read off a class name.
     *
     *   · The add-on controls clear it BECAUSE this slice lifted them —
     *     `ICON_BUTTON` and `ACTION_HEIGHT` on targets that were ~26px and
     *     ~32px.
     *   · The term segments clear it because their `grid-cols-3` track stretches
     *     all three to the tallest row content (44.75px), with no floor spelled
     *     at all. A draft of this ticket added one and it moved nothing.
     *
     * A class-name guard would have called the second case a fix. This asks the
     * browser, so it reports the property either way — and if a later change to
     * the badge shortens that row, this fails and a floor becomes a real fix.
     */
    const r = at(380);
    const short = OWNED
      .map(({ key, label }) => ({ label, height: r.controls[key]!.height }))
      .filter((c) => c.height < 44);
    expect(short, 'a money control is under the touch floor on a phone').toEqual([]);
  });

  it('🔴 …and the steppers are 44px SQUARE, not merely 44px tall', () => {
    // An icon button that is 44 tall and 26 wide is still a 26px target for a
    // thumb travelling horizontally along a row.
    const r = at(380);
    for (const key of ['addon-minus', 'addon-plus']) {
      expect(r.controls[key]!.width, `${key} is under the touch floor on its width axis`)
        .toBeGreaterThanOrEqual(44);
    }
  });

  it('🔴 above sm Rule 4 holds — nothing sits above the desktop band', () => {
    // Rule 4 fixes a control at 38px and an action at 40px, and
    // DESKTOP_CONTROL_MAX_PX is the top of the band. The term segments are
    // TWO-LINE controls and are exempt from the ceiling by construction — a
    // label plus a badge cannot be 40px — so they are checked for the floor
    // only. Everything else must be inside the band.
    const SINGLE_LINE = ['addon-buy', 'addon-minus', 'addon-plus', 'addon-commit'];
    for (const v of [768, 1024, 1280, 1440]) {
      const r = at(v);
      for (const key of SINGLE_LINE) {
        expect(r.controls[key]!.height, `${key} is above the desktop band at ${v}px`)
          .toBeLessThanOrEqual(DESKTOP_CONTROL_MAX_PX);
      }
    }
  });

  it('🔴 Rule 4 is NOT fought: 38px is deliberately under the touch floor', () => {
    // A test asserts DENSITY_PX.control < 44 on purpose. This slice must not
    // have "fixed" that by raising the desktop density.
    expect(DENSITY_PX.control, "Rule 4's control height moved").toBe(38);
    expect(DENSITY_PX.control).toBeLessThan(44);
    expect(DENSITY_PX.action, "Rule 4's action height moved").toBe(40);
  });

  it('⚠️ REPORTED: the plan card button is under the floor and is not this slice\'s to lift', () => {
    /**
     * 🔴 STATED AS A MEASUREMENT, NOT SILENTLY OMITTED. `PlanUpgradeSection`'s
     * Upgrade/Downgrade button is `w-full py-2.5 text-sm` — a ~40px target that
     * charges a card. It is left alone because its sub-640px class layer is
     * pinned byte-for-byte from the card track onward, and the only way to add
     * an unprefixed `min-h-[44px]` to it is to RE-RECORD that baseline, which
     * substitutes the value the guard measures (STOP condition 6).
     *
     * Pinned as "under 44 and at least 36" so the finding cannot rot: if a later
     * ticket lifts it properly this fails and the report comes out.
     */
    const h = at(380).controls['plan-upgrade']!.height;
    expect(h, 'the plan button was lifted — delete this report and assert the floor')
      .toBeLessThan(44);
    expect(h, 'the plan button SHRANK — that is a regression, not a deferral')
      .toBeGreaterThanOrEqual(36);
  });

  it('no viewport on the ladder overflows the page horizontally', () => {
    for (const v of VIEWPORTS) {
      expect(at(v).docScrollWidth, `the billing page overflows at ${v}px`).toBeLessThanOrEqual(v);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 11 — the bottom-nav clearance
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('11 · the last card clears the bottom nav at 380px, in both nav states', () => {
  it('🔴 the nav really is a fixed bottom bar at 380px — the premise', () => {
    const r = at(380);
    expect(r.navPosition, 'the bottom nav is not fixed — this assertion is vacuous').toBe('fixed');
    expect(r.navZ, 'the bottom nav left z-100').toBe('100');
    expect(r.scrolled, 'the billing panel did not scroll — nothing to clear').toBeTruthy();
    // 🔴 And it GENUINELY scrolled, so the reading is of a bottomed-out page.
    expect(r.scrolled!.scrolledBy, 'the panel never scrolled — the clearance claim is vacuous')
      .toBeGreaterThan(0);
  });

  it('🔴 the last card ends ABOVE the nav once the page is scrolled home', () => {
    const { lastBottom, navTop } = at(380).scrolled!;
    expect(lastBottom, `the last card ends ${(lastBottom - navTop).toFixed(1)}px under the nav`)
      .toBeLessThanOrEqual(navTop);
  });

  it('🔴 the clearance comes from a REAL class, not from pb-safe', () => {
    // `pb-safe` compiles to nothing in this repo. If the gap above were coming
    // from it, this whole describe would be measuring a class name that emits no
    // CSS. The gap is NAV_CLEARANCE's, and it is a real Tailwind arbitrary value.
    expect(NAV_CLEARANCE, 'the clearance stopped being an explicit calc')
      .toMatch(/^pb-\[calc\(\d+px\+env\(safe-area-inset-bottom\)\)\]$/);
    expect(NAV_CLEARANCE, 'the clearance became pb-safe').not.toContain('safe]');
  });

  it('🔴 from lg the nav becomes the SIDEBAR — so there is nothing at bottom-0', () => {
    /**
     * The second nav state on this shell, and the claim is different in kind.
     *
     * ⚠️ NOT "the last card ends above the nav" — from `lg` the bar is
     * `lg:hidden`, so its rect collapses to zero at the top of the viewport and
     * that comparison would be against y=0, which every scrolled page fails and
     * which asserts nothing about clearance. The real claim from `lg` is that
     * the bar is GONE (the nav is the sidebar column instead), so there is
     * nothing at bottom-0 for the page to run under.
     */
    for (const v of [1024, 1280, 1440]) {
      const r = at(v);
      expect(r.navDisplay, `the bottom bar is still painted at ${v}px, where the nav is a sidebar`)
        .toBe('none');
      expect(r.docScrollWidth, `the page overflows beside the sidebar at ${v}px`).toBeLessThanOrEqual(v);
    }
  });

  it('🔴 …and below lg it is genuinely painted — so state one is not vacuous either', () => {
    for (const v of [380, 768]) {
      expect(at(v).navDisplay, `the bottom bar is not painted at ${v}px — nothing to clear`)
        .not.toBe('none');
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 12 — layering
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('12 · dialogs open above z-100', () => {
  it('🔴 #437 landed: the scrim is 101 and the panel 102, RESOLVED not read', () => {
    // ⚠️ Verified as computed style at every viewport rather than as a class
    // name, because that is the claim — a class that lost its stylesheet entry
    // reads fine and paints underneath the nav.
    for (const v of VIEWPORTS) {
      const r = at(v);
      expect(r.scrimZ, `the dialog scrim is not above the nav at ${v}px`).toBe('101');
      expect(r.panelZ, `the dialog panel is not above the scrim at ${v}px`).toBe('102');
    }
  });

  it('🔴 …and both really are above the nav, compared as numbers', () => {
    for (const v of VIEWPORTS) {
      const r = at(v);
      const nav = Number(r.navZ);
      expect(Number(r.scrimZ), `the scrim is not above the nav at ${v}px`).toBeGreaterThan(nav);
      expect(Number(r.panelZ), `the panel is not above the scrim at ${v}px`)
        .toBeGreaterThan(Number(r.scrimZ));
    }
  });

  it('🔴 the primitives themselves still carry those z-indices', () => {
    // The probe above measures a replica; this ties it to the real primitives so
    // the replica cannot drift away from what the app actually renders.
    expect(src('src/components/ui/dialog.tsx'), 'the dialog scrim left z-101').toContain('z-[101]');
    expect(src('src/components/ui/dialog.tsx'), 'the dialog panel left z-102').toContain('z-[102]');
    expect(src('src/components/ui/sheet.tsx'), 'the sheet scrim left z-101').toContain('z-[101]');
    expect(src('src/components/ui/sheet.tsx'), 'the sheet panel left z-102').toContain('z-[102]');
  });
});
