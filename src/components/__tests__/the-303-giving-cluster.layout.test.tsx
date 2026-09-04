// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom — the same reason THE-290's, THE-294's, THE-296's and
// THE-300's position tests give. happy-dom HAS NO LAYOUT ENGINE: with the real
// compiled stylesheet injected, `getBoundingClientRect()` still returns zeros
// and `getComputedStyle` answers `display: block` for a flex container. A touch
// target is a question about where a box LANDED, not about which classes it may
// spend, so it is asked of a real browser over CDP. And under happy-dom the
// globals carry browser semantics, so a request to the browser's own debugger
// port fails same-origin and the browser could never be attached at all.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { CONTROL_DENSITY, DENSITY_PX } from '../layout/form-layout';
import PublicGiving from '../PublicGiving';
import { readGivingLinks } from '../donations/giving-providers';

/**
 * THE-303 — the GEOMETRY of what this ticket adds, measured in Chromium.
 *
 * Three controls are new or newly load-bearing:
 *
 *   · the Donations explainer's fold trigger (bug 5)
 *   · the Accounting cash-note's fold trigger (bug 6)
 *   · every row on the public giving page — each one is a tap that sends money
 *     somewhere, opened by a stranger from a printed QR (bug 1)
 *
 * ⚠️ WIDTH IS NOT MONOTONIC, so the whole ladder is measured: 380 / 768 / 1024 /
 * 1280 / 1440. Crossing 1024 globals.css trims the rem base, so a control can be
 * SHORTER at 1280 than at 768 — checking only the ends would miss it.
 *
 * ⚠️ AND RULE 4 IS ASSERTED IN BOTH DIRECTIONS. Above `sm` a control is fixed at
 * `DENSITY_PX.control` (38px) ON PURPOSE — form-layout's own test pins
 * `DENSITY_PX.control < 44`. A blanket 44px floor across every viewport would be
 * asserting the opposite of the rule this repo actually holds, so the floor is
 * claimed BELOW `sm` and the density is claimed above it.
 */

/** ⚠️ Width is not monotonic here — the whole ladder, not the ends. */
const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;
const SM_PX = 640;

const ROOT = path.resolve(__dirname, '../../..');
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * A trigger's class string, LIFTED FROM ITS OWN SOURCE rather than retyped.
 *
 * 🔴 The point of THE-300's note applies here unchanged: a replica typed into
 * the test measures what the test believes the control is. Anchored on the
 * `data-testid` — which a restyle does not touch — so whatever className the
 * component carries is what gets measured, and shortening the control moves the
 * pixels instead of breaking the anchor.
 */
function triggerClass(rel: string, testid: string): string {
  const m = new RegExp(`data-testid="${testid}"[\\s\\S]{0,400}?className=(?:\\{\`([^\`]*)\`\\}|"([^"]*)")`).exec(src(rel));
  if (!m) throw new Error(`could not find ${testid} in ${rel} — the replica has drifted`);
  return (m[1] ?? m[2])
    .replace(/\$\{CONTROL_DENSITY\.control\}/g, CONTROL_DENSITY.control)
    .replace(/\$\{[^}]*\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 🔴 THE SHELL'S CLEARANCE, READ OUT OF `AdminDashboard`, not retyped.
 *
 * The admin content panel carries `pb-24 lg:pb-8` — 96px below `lg`, over a
 * bottom nav that measures ~44px. ⚠️ `pb-safe` on the nav itself reserves
 * NOTHING (there is no such utility in this repo; #437 fixed the MEMBER shell
 * and the admin one still carries the inert class), so this padding is the only
 * thing keeping the end of an admin screen off the nav. Lifting it means
 * deleting it from the shell fails this suite instead of silently passing.
 */
const SHELL_SCROLL = (() => {
  const m = /: '(overflow-y-auto pb-24 lg:pb-8)'\} p-0 lg:p-6/.exec(src('src/components/AdminDashboard.tsx'));
  if (!m) throw new Error('the admin shell scroll panel moved — this fixture no longer replicates it');
  return `${m[1]} p-0 lg:p-6`;
})();

const LINKS = readGivingLinks({
  givingLinks: {
    wise: { url: 'https://wise.com/pay/business/gracechapel', handle: '@gracechapel', email: 'giving@grace.org' },
    revolut: { url: 'https://revolut.me/gracechapel', handle: '@gracechapel', email: 'giving@grace.org' },
    zelle: { email: 'giving@grace.org', handle: 'Grace Chapel' },
  },
});

function page(): string {
  const donationsTrigger = triggerClass('src/components/AdminDonations.tsx', 'donations-disclosure-toggle');
  const accountingTrigger = triggerClass('src/components/AdminAccounting.tsx', 'accounting-cash-note-toggle');

  return renderToStaticMarkup(
    <div className="flex h-screen">
      {/* The admin shell's sidebar form, from `lg`. No assertion reads its width. */}
      <div className="hidden lg:block w-[289px] shrink-0" />
      <div className="min-w-0 flex-1 flex flex-col">
        {/* 🔴 THE ADMIN SHELL'S OWN SCROLL PANEL, lifted from AdminDashboard
            rather than typed — see `SHELL_SCROLL`. Its `pb-24` IS the clearance
            over the fixed bottom nav, and measuring it is how this ticket makes
            that explicit: the two folds live inside this panel and add no
            clearance of their own, so if the shell's ever went away the
            assertion below would catch it rather than a reader having to
            re-derive it. */}
        <div data-shell-scroll className={`flex-1 ${SHELL_SCROLL}`}>
          {/* Enough content that the panel genuinely scrolls at 380px —
              otherwise the clearance assertion below is vacuous. */}
          <div style={{ height: '1400px' }} />

          {/* The two fold triggers, at their real class strings. */}
          <button data-control="donations-fold" className={donationsTrigger}>
            <span className="text-sm font-semibold text-strong">
              Harvest does not process these gifts — what that means
            </span>
          </button>
          <button data-control="accounting-fold" className={accountingTrigger}>
            <span className="text-sm font-semibold text-strong">
              Why a cash or payment-link gift shows as $0 here
            </span>
          </button>

          {/* The public giving page, whole and real — no replica, because it is
              a component this ticket wrote and it can simply be rendered. */}
          <div data-giving-page>
            <PublicGiving tenantName="Grace Chapel" logo={null} links={LINKS} />
          </div>

          <div data-page-last className="bg-surface-raised rounded-brand-lg border border-line p-4">
            <span>the last thing on the page</span>
          </div>
        </div>
      </div>

      {/* 🔴 THE ADMIN BOTTOM NAV, class for class — `fixed bottom-0` at
          `z-[100]`. ⚠️ `pb-safe` IS WRITTEN AND RESERVES NOTHING: there is no
          such utility in this repo, #437 fixed that for the MEMBER shell and the
          ADMIN shell still carries the inert class. It is replicated so the
          fixture matches the shell character for character; it simply
          contributes no pixels, which is exactly why clearance has to be
          measured rather than assumed. */}
      <div
        data-shell-bottom-nav
        className="lg:hidden bg-surface-raised border-t border-line flex justify-center py-2 px-2 pb-safe fixed bottom-0 w-full z-[100]"
      >
        <span>Nav</span>
      </div>
    </div>,
  );
}

interface Control { height: number; width: number }
interface Reading {
  viewport: number;
  docScrollWidth: number;
  controls: Record<string, Control | null>;
  /** Every giving-page row — each one is a money tap. */
  rows: Control[];
  navPosition: string;
  navDisplay: string;
  navZ: string;
  scrolled: { lastBottom: number; navTop: number; scrolledBy: number } | null;
}

let browser: MeasuringBrowser;
const readings = new Map<number, Reading>();

beforeAll(async () => {
  const css = await buildAppCss();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'the303-'));
  const file = path.join(dir, 'giving.html');
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${page()}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const viewport of VIEWPORTS) {
    const reading = await browser.evaluateAt<Reading>(viewport, `(() => {
      const controls = {};
      for (const el of document.querySelectorAll('[data-control]')) {
        const b = el.getBoundingClientRect();
        controls[el.getAttribute('data-control')] = { height: b.height, width: b.width };
      }
      const rows = [];
      for (const el of document.querySelectorAll('[data-giving-page] [data-provider]')) {
        const b = el.getBoundingClientRect();
        rows.push({ height: b.height, width: b.width });
      }
      const navEl = document.querySelector('[data-shell-bottom-nav]');
      const sc = document.querySelector('[data-shell-scroll]');
      const last = document.querySelector('[data-page-last]');
      return {
        viewport: window.innerWidth,
        docScrollWidth: document.documentElement.scrollWidth,
        controls,
        rows,
        navPosition: navEl ? getComputedStyle(navEl).position : 'missing',
        navDisplay: navEl ? getComputedStyle(navEl).display : 'missing',
        navZ: navEl ? getComputedStyle(navEl).zIndex : 'missing',
        /*
         * SCROLLED HOME — the only state in which the last card could hide under
         * a fixed bottom-0 nav. Measuring the unscrolled page would pass on any
         * surface long enough to overflow.
         * (No backticks in here: this lives inside a template literal.)
         */
        scrolled: (() => {
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

const OWNED = [
  { key: 'donations-fold', label: 'Donations: the explainer fold' },
  { key: 'accounting-fold', label: 'Accounting: the cash-note fold' },
] as const;

/* ═══════════════════════════════════════════════════════════════════════════
 * 13 — every control ≥44px below sm; Rule 4 holds above
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('13 · every control ≥44px below sm; Rule 4 holds above', () => {
  it('the premise holds — the page really laid out, at every viewport', () => {
    for (const v of VIEWPORTS) {
      const r = at(v);
      expect(r.viewport, `the viewport did not take at ${v}px`).toBe(v);
      for (const { key } of OWNED) {
        expect(r.controls[key], `${key} is missing at ${v}px — is this measuring anything?`).toBeTruthy();
        expect(r.controls[key]!.height, `${key} has no height at ${v}px`).toBeGreaterThan(0);
      }
      expect(r.rows.length, `the giving page drew no rows at ${v}px`).toBeGreaterThan(0);
    }
  });

  it('🔴 below sm (380px) every control this ticket adds clears the 44px floor', () => {
    const r = at(380);
    const short = [
      ...OWNED.map(({ key, label }) => ({ label, height: r.controls[key]!.height })),
      ...r.rows.map((row, i) => ({ label: `giving page row ${i + 1}`, height: row.height })),
    ].filter((c) => c.height < 44);
    expect(short, 'a money control is under the touch floor on a phone').toEqual([]);
  });

  it('🔴 …and Rule 4 holds ABOVE sm — the folds take the 38px density, not 44', () => {
    // ⚠️ THIS IS THE OPPOSITE CLAIM, ON PURPOSE. `DENSITY_PX.control` is 38 and
    // form-layout's own suite asserts it is UNDER 44. A blanket floor at every
    // viewport would quietly delete that rule; this pins both halves of it.
    expect(DENSITY_PX.control, 'Rule 4 changed — re-read this suite').toBeLessThan(44);
    for (const v of VIEWPORTS.filter((x) => x >= SM_PX)) {
      const r = at(v);
      for (const { key, label } of OWNED) {
        expect(
          Math.round(r.controls[key]!.height),
          `${label} is ${r.controls[key]!.height}px at ${v}px — Rule 4 says ${DENSITY_PX.control}`,
        ).toBe(DENSITY_PX.control);
      }
    }
  });

  it('the giving-page rows stay full-bleed taps, not 44px slivers', () => {
    // A row that is 44 tall and narrow is still a hard target for a thumb: the
    // whole row is the tap, which is what `GivingLinks` intends.
    for (const v of VIEWPORTS) {
      for (const [i, row] of at(v).rows.entries()) {
        expect(row.width, `giving row ${i + 1} collapsed at ${v}px`).toBeGreaterThan(200);
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * the shell — nav clearance and no horizontal scroll
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('13b · the bottom nav does not sit on top of anything this ticket adds', () => {
  it('🔴 the nav is `fixed bottom-0` at z-[100] below lg, and a sidebar from lg', () => {
    expect(at(380).navPosition).toBe('fixed');
    expect(at(380).navZ).toBe('100');
    expect(at(1280).navDisplay, 'the bottom bar survived onto desktop').toBe('none');
  });

  it('🔴 the end of the page clears the nav with the panel scrolled home', () => {
    // The only state in which anything could hide under a `fixed bottom-0` bar.
    for (const v of VIEWPORTS.filter((x) => x < 1024)) {
      const s = at(v).scrolled!;
      expect(s.scrolledBy, `the panel did not scroll at ${v}px — the check is vacuous`).toBeGreaterThan(0);
      expect(
        s.lastBottom,
        `the last card is under the fixed nav at ${v}px — the shell's pb-24 is gone`,
      ).toBeLessThanOrEqual(s.navTop);
    }
  });

  it('⚠️ the PUBLIC giving page has no fixed nav over it at all', () => {
    // 🔴 Stated rather than measured, because absence is the claim. `/giving` is
    // a standalone public document — no shell, no tab strip, no bottom bar — so
    // there is nothing for its content to be underneath, and its own `py-10` is
    // the whole of its bottom spacing. A fixed anything appearing here later is
    // what this catches.
    const giving = src('src/components/PublicGiving.tsx');
    expect(giving, 'the public giving page grew a fixed overlay').not.toMatch(/fixed |sticky |z-\[/);
    expect(giving, 'the giving page lost its own vertical padding').toMatch(/py-10/);
  });

  it('no viewport scrolls horizontally', () => {
    for (const v of VIEWPORTS) {
      expect(at(v).docScrollWidth, `the document scrolls sideways at ${v}px`).toBeLessThanOrEqual(v);
    }
  });
});
