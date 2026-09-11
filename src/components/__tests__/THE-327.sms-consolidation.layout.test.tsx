// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom — the same reason THE-320 gives and it was re-verified
// here rather than inherited: with happy-dom selected `MeasuringBrowser` never
// attaches and the suite times out. Nothing here needs a DOM; the page is
// rendered to a string and every measurement happens inside a real Chromium
// over CDP.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { setUpOrFail } from '../../test/support/suite-setup';
import { DENSITY_PX } from '../layout/form-layout';
import AdminSms from '../AdminSms';

/* 🔴 THE-335 — THE MASTER SWITCH IS MOCKED ON.
   `SMS_FEATURE_ENABLED` is false on disk again, and `AdminSms` and `SmsSection`
   are one-line wrappers that render `null` while it is — so without this every
   assertion in this file would measure an empty string and the suite would pass
   while proving nothing about the composition it exists to pin. That is the
   failure mode this repo has been bitten by eleven times.

   ⚠️ MOCKED RATHER THAN THE SUITE DELETED OR SKIPPED. The switch's whole design
   is that the feature comes back INTACT; these suites are what proves it is
   still intact, so they have to keep running. `the-245-sms-hidden.test.ts` is
   where "no surface is reachable today" is asserted. */
vi.mock('../../lib/sms-feature', () => ({
  SMS_FEATURE_ENABLED: true,
  SMS_HIDDEN_MESSAGE: 'SMS is temporarily unavailable.',
}));


/**
 * THE-327 · Test 17 — the SMS section MEASURED, with the third tab on it.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 🔴 happy-dom HAS NO LAYOUT ENGINE. `getBoundingClientRect()` returns zeros
 * and `getComputedStyle` answers `display: block` for a flex container even
 * with the compiled stylesheet injected, so a class-name assertion can say how
 * wide a box MAY be and can never say where it landed. Every number below came
 * out of Chromium.
 *
 * ── What this file adds over THE-320's ladder ───────────────────────────────
 *
 * THE-320 measures this screen's composer, its native `<select>` and its
 * actions and is unchanged by this ticket — that it still passes is the
 * evidence that the consolidation moved no measured value. What THE-320 cannot
 * cover is the control THIS ticket ADDED: a THIRD tab trigger. That matters
 * because tab triggers are a recorded trap in this programme — 🔴 THE-317
 * measured one at 25px, and another came out 44px tall and 35.6px WIDE — so a
 * trigger added by copying a class string is exactly the thing to measure
 * rather than assume.
 *
 * ⚠️ ONE `MeasuringBrowser` PER PROCESS: two instances in one process collide
 * on a PID-derived debugger port and silently compare a page with itself. This
 * file opens exactly one, and it is a separate file from THE-320's for that
 * reason.
 *
 * ⚠️ `transition-all` MAKES AN IMMEDIATE POST-RESIZE READING A LIE — the tab
 * triggers carry `transition-colors`, and the pill shell settles. A drifting
 * value is the tell, so every reading below is taken by LOOPING UNTIL TWO
 * CONSECUTIVE READINGS MATCH rather than once after the resize.
 *
 * ⚠️ WIDTH IS NOT MONOTONIC on this shell — globals.css trims the rem base for
 * desktop density, so the content box RISES to 768 and FALLS again at 1024.
 * All five widths are asserted; a test that checked only the phone and the
 * desktop would miss the fall.
 */

const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

interface Control { tag: string; slot: string; label: string; h: number; w: number }
interface Reading { vw: number; screenW: number; docScrollW: number; bodyScrollW: number; controls: Control[] }

let browser: MeasuringBrowser;
const readings = new Map<number, Reading>();

setUpOrFail(async () => {
  const { useAppStore } = await import('../../store/useAppStore');
  useAppStore.setState({ currentTenantId: 't1', isAuthReady: true, isSuperAdmin: true } as any);

  const css = await buildAppCss();

  /**
   * ⚠️ THE ADMIN SHELL IS REPLICATED FROM ITS OWN CLASS STRINGS, exactly as
   * THE-320, THE-290 and THE-298 replicate it. `AdminDashboard.tsx` is opened
   * by this ticket for the nav arrays only and is not a layout subject here.
   */
  const page = renderToStaticMarkup(
    <div className="min-h-screen bg-surface">
      <div className="lg:flex">
        <div data-shell-sidebar className="hidden lg:block w-[289px] shrink-0" />
        <div className="flex-1 p-4 lg:p-6">
          <div data-screen>
            <MemoryRouter><AdminSms /></MemoryRouter>
          </div>
        </div>
      </div>
      <div
        data-shell-bottom-nav
        className="lg:hidden bg-surface-raised border-t border-line flex justify-center py-2 px-2 fixed bottom-0 w-full z-[100]"
      />
    </div>,
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the327-'));
  const file = path.join(dir, 'sms.html');
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${page}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  const probe = `(() => {
    const round = (n) => Math.round(n * 100) / 100;
    const scope = document.querySelector('[data-screen]');
    return {
      vw: window.innerWidth,
      screenW: round(scope.getBoundingClientRect().width),
      docScrollW: document.documentElement.scrollWidth,
      bodyScrollW: document.body.scrollWidth,
      controls: [...scope.querySelectorAll('button, input, select, textarea, a')].map((el) => {
        const b = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          slot: el.getAttribute('data-slot') || '',
          label: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 32) || el.tagName,
          h: round(b.height), w: round(b.width),
        };
      }),
    };
  })()`;

  for (const viewport of VIEWPORTS) {
    /* 🔴 LOOP UNTIL TWO READINGS AGREE. `transition-colors` on every trigger
       means the first reading after a resize can be mid-flight, and a drifting
       value is the tell. Five attempts is generous; a genuinely unstable box
       fails loudly rather than being recorded at whatever it happened to be. */
    let previous = JSON.stringify(await browser.evaluateAt<Reading>(viewport, probe));
    let settled: Reading | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const next = await browser.evaluateAt<Reading>(viewport, probe);
      const serialised = JSON.stringify(next);
      if (serialised === previous) { settled = next; break; }
      previous = serialised;
    }
    if (!settled) throw new Error(`readings never settled at ${viewport}px`);
    readings.set(viewport, settled);
  }
}, 300_000);

afterAll(async () => { await browser?.close(); });

const at = (v: number): Reading => {
  const r = readings.get(v);
  if (!r) throw new Error(`no reading at ${v}px`);
  return r;
};

const tabs = (v: number) => at(v).controls.filter((c) => c.slot === 'tabs-trigger');

/* ═══════════════════════════════════════════════════════════════════════════
   1 · 🔴 Every tappable target clears 44px below `sm`.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('1 · every control is at least 44px below sm', () => {
  it('measures every control on the SMS section at 380px', () => {
    const r = at(380);
    /* The composer is a four-row textarea, not a tap target. Excluded BY NAME
       rather than by a height threshold, so the exclusion cannot quietly grow
       to cover a control that shrank. */
    const targets = r.controls.filter((c) => c.tag !== 'TEXTAREA');
    expect(targets.length, 'nothing was measured — the screen did not render').toBeGreaterThan(3);
    for (const c of targets) {
      expect(c.h, `${c.tag} "${c.label}" is ${c.h}px at 380px — under the 44px floor`)
        .toBeGreaterThanOrEqual(44);
    }
  });

  it('🔴 including the THIRD tab — the control this ticket added', () => {
    const t = tabs(380);
    expect(t.map((x) => x.label), 'the switcher is not three tabs')
      .toEqual(['Broadcasts', 'Automated', 'Number']);
    for (const trigger of t) {
      // 🔴 HEIGHT *AND* WIDTH. One tab in this programme measured 44px tall and
      // 35.6px wide — tall enough to pass a height-only check and too narrow
      // to hit with a thumb.
      expect(trigger.h, `the "${trigger.label}" tab is ${trigger.h}px tall at 380px`).toBeGreaterThanOrEqual(44);
      expect(trigger.w, `the "${trigger.label}" tab is ${trigger.w}px wide at 380px`).toBeGreaterThanOrEqual(44);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2 · Above `sm`, Rule 4 hands back to the desktop band.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('2 · above sm, Rule 4’s 38px band holds', () => {
  it('🔴 DENSITY_PX.control is deliberately under 44 — the floor is a MOBILE floor', () => {
    /* Asserted rather than described: the 44px rule is `below sm`, and a test
       that carried it onto a desktop would be asserting the opposite of the
       design. */
    expect(DENSITY_PX.control, 'the desktop density band moved').toBeLessThan(44);
  });

  it.each([768, 1024, 1280, 1440])('the third tab releases the 44px floor at %ipx', (vw) => {
    const number = tabs(vw).find((t) => t.label === 'Number');
    expect(number, `the Number tab is missing at ${vw}px`).toBeTruthy();
    expect(number!.h, `the Number tab carries the mobile floor onto ${vw}px`).toBeLessThan(44);
  });

  it('and the three tabs are the same height as each other at every width', () => {
    /* The real risk of adding a trigger by copying a class string: one of them
       resolving differently. Sameness is the claim, at all five widths. */
    for (const vw of VIEWPORTS) {
      const heights = new Set(tabs(vw).map((t) => t.h));
      expect([...heights], `the tabs disagree about their height at ${vw}px`).toHaveLength(1);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3 · Width is not monotonic, and nothing overflows.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('3 · the screen fits at all five widths', () => {
  it.each(VIEWPORTS)('nothing scrolls horizontally at %ipx', (vw) => {
    const r = at(vw);
    expect(r.docScrollW, `the document scrolls sideways at ${vw}px`).toBeLessThanOrEqual(vw);
    expect(r.bodyScrollW, `the body scrolls sideways at ${vw}px`).toBeLessThanOrEqual(vw);
  });

  it('🔴 records the content ladder, fall included', () => {
    /* ⚠️ NOT MONOTONIC. globals.css trims the rem base for desktop density, so
       the box RISES from the phone to the tablet and FALLS at 1024. The whole
       ladder is asserted, because a test reading only the ends would miss it. */
    const ladder = VIEWPORTS.map((v) => at(v).screenW);
    expect(ladder.every((w) => w > 0), 'the screen measured zero somewhere').toBe(true);
    expect(ladder[2], 'the 1024px fall disappeared — the rem base changed').toBeLessThan(ladder[1]);
    expect(ladder[4], 'the ladder stopped rising into the widest desktop').toBeGreaterThan(ladder[2]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4 · 🔴 Both palettes resolve.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('4 · both palettes resolve on the moved surface', () => {
  /**
   * 🔴 MEASURED, BECAUSE A STYLESHEET GREP CANNOT ANSWER THIS. Counting
   * selectors proves nothing about whether a token RESOLVES — only a browser
   * with the real cascade can answer that, which is why this suite exists.
   *
   * 🔴 THE-338 — "FOUR PALETTES" WAS TWO FAMILIES × TWO THEMES. The family
   * axis is gone: the second family's 14 overrides were promoted into
   * :root/.dark and its `data-palette` selectors deleted. The mode axis is
   * untouched, so this measures the two themes.
   */
  const THEMES = ['light', 'dark'] as const;

  it('every theme paints a real colour on the number panel', async () => {
    const theme_ = await import('../../lib/theme');
    expect('DEFAULT_PALETTE_FAMILY' in theme_, 'the family axis is back').toBe(false);

    const seen: Record<string, { surface: string; text: string }> = {};
    {
      for (const theme of THEMES) {
        seen[theme] = await browser.evaluateAt(380, `(() => {
          const html = document.documentElement;
          html.setAttribute('data-theme', ${JSON.stringify(theme)});
          html.classList.toggle('dark', ${JSON.stringify(theme)} === 'dark');
          /* Read off elements that actually CARRY tokens. The screen wrapper
             has no colour class of its own, so it reports the UA default and
             would pass for every palette while proving nothing. The tab strip
             carries bg-surface-sunken and a trigger carries text-faint.
             (No backticks in here: this comment lives inside a template
             literal, and one would close it.) */
          const list = document.querySelector('[data-slot="tabs-list"]');
          const trigger = document.querySelector('[data-slot="tabs-trigger"]');
          return {
            surface: getComputedStyle(list).backgroundColor,
            text: getComputedStyle(trigger).color,
          };
        })()`);
      }
    }

    expect(Object.keys(seen), 'a palette combination was not measured').toHaveLength(2);
    for (const [key, c] of Object.entries(seen)) {
      /* A token that did not resolve leaves the browser transparent — which
         is `rgba(…, 0)`, NOT `rgb(0, 0, 0)`: opaque black is a colour, and an
         alpha check written as `/, 0\)$/` reports it as a failure. */
      for (const [what, value] of [['surface', c.surface], ['text', c.text]] as const) {
        expect(value, `${key} left the ${what} unresolved`).toMatch(/^rgba?\(/);
        expect(value, `${key} resolved the ${what} to fully transparent`).not.toMatch(/,\s*0\)$/);
      }
    }
    /* 🔴 And the two palettes are not the SAME colour, which is what a token
       that silently fell back to one literal would look like. */
    const surfaces = new Set(Object.values(seen).map((c) => c.surface));
    expect(surfaces.size, 'every palette painted an identical surface — a token fell back to a literal')
      .toBeGreaterThan(1);
  });
});
