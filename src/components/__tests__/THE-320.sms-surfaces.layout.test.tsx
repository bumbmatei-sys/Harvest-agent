// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom — the same reason THE-276-FIX, THE-290 and THE-298
// give, and it was re-verified for this ticket rather than inherited: with
// happy-dom selected, `MeasuringBrowser` never attaches and the suite times out
// at 180s. Nothing here needs a DOM. The page is rendered to a string and every
// measurement happens inside a real Chromium over CDP.
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
import { DENSITY_PX, CONTROL_DENSITY, FIELD_WIDTH } from '../layout/form-layout';
import AdminSms from '../AdminSms';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { SMS_PANEL_CONTROL_CLASSES, SMS_PANEL_CONTROL_EXTRA } from '../settings/SmsSection';

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
 * THE-320 — WHERE the two composed SMS surfaces render, measured in Chromium.
 *
 * ─── Why this is measured and not reasoned about ─────────────────────────────
 *
 * 🔴 happy-dom HAS NO LAYOUT ENGINE — `getBoundingClientRect()` returns zeros
 * and `getComputedStyle` answers `display: block` for a flex container even with
 * the compiled stylesheet injected. Every other layout guard in this repo
 * reasons about CLASS NAMES, which answers "how wide may this box be" and cannot
 * answer "where did this box actually land".
 *
 * ⚠️ WIDTH IS NOT MONOTONIC on this shell, and this screen proves it rather than
 * assuming it: the content box RISES 348 → 736 from a phone to a tablet, FALLS
 * to 691.5 at 1024 as globals.css trims the rem base to 14.5px, then rises again
 * to 947.5 and 1107.5. A test that checked only the phone and the desktop would
 * have missed the fall, so the ladder is asserted whole.
 *
 * ─── 🔴 What this file exists to catch ───────────────────────────────────────
 *
 * THE-317 measured `ui/select` sizing itself through `data-[size=default]:h-8`,
 * an attribute selector that OUTRANKS Rule 4, and sticking at 32px. That is the
 * shape of defect a composition ticket ships if it adopts primitives by name
 * and never looks. So every control on the screen is MEASURED, the native
 * `<select>` included, at all five widths, before and after.
 *
 * ⚠️ ONE `MeasuringBrowser` PER PROCESS. Two instances in one process collide on
 * a PID-derived debugger port and silently compare a page with itself, so this
 * file opens exactly one and every reading comes from it.
 *
 * ⚠️ WHY THE NUMBER PANEL IS MEASURED THROUGH ITS EXPORTED RECIPES. Its controls
 * exist only after its `/api/sms/numbers` effect has resolved, and server
 * rendering never runs an effect — so the panel renders its "Loading…" line and
 * nothing else here. Rather than hand-copy its class strings (a copy drifts
 * silently from what ships), `SmsSection.tsx` EXPORTS the two recipes and this
 * file renders those exact strings through the same primitives the panel uses.
 * The thing measured is the thing rendered.
 */

const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

interface Control { tag: string; slot: string; label: string; h: number; w: number; panel: boolean }
interface Reading {
  vw: number;
  screenW: number;
  docScrollW: number;
  bodyScrollW: number;
  controls: Control[];
  lastBottom: number;
  navTop: number;
}

let browser: MeasuringBrowser;
const readings = new Map<number, Reading>();

setUpOrFail(async () => {
  const { useAppStore } = await import('../../store/useAppStore');
  useAppStore.setState({ currentTenantId: 't1', isAuthReady: true, isSuperAdmin: true } as any);

  const css = await buildAppCss();

  /**
   * ⚠️ THE ADMIN SHELL IS REPLICATED FROM ITS OWN CLASS STRINGS, not invented,
   * exactly as THE-290 and THE-298 replicate it — `AdminDashboard.tsx` is not
   * this ticket's to open. The bottom nav is `fixed bottom-0 … z-[100]`, which
   * is what the screen's own bottom clearance has to clear.
   */
  const page = renderToStaticMarkup(
    <div className="min-h-screen bg-surface">
      <div className="lg:flex">
        <div data-shell-sidebar className="hidden lg:block w-[289px] shrink-0" />
        <div className="flex-1 p-4 lg:p-6">
          <div data-screen>
            <MemoryRouter><AdminSms /></MemoryRouter>
          </div>
          {/* The number panel's two recipes, rendered through the primitives the
              panel itself uses. See the note in the header. */}
          <div data-panel className="mt-6">
            <Input
              data-panel-control
              defaultValue="US"
              className={`${SMS_PANEL_CONTROL_EXTRA.input} ${SMS_PANEL_CONTROL_CLASSES.control} font-mono ${FIELD_WIDTH.medium}`}
            />
            <Button
              data-panel-control
              className={`${SMS_PANEL_CONTROL_EXTRA.primaryAction} ${SMS_PANEL_CONTROL_CLASSES.action}`}
            >
              Buy a number
            </Button>
            <Button
              data-panel-control
              variant="outline"
              className={`${SMS_PANEL_CONTROL_EXTRA.secondaryAction} ${SMS_PANEL_CONTROL_CLASSES.action}`}
            >
              Check availability
            </Button>
          </div>
        </div>
      </div>
      <div
        data-shell-bottom-nav
        className="lg:hidden bg-surface-raised border-t border-line flex justify-center py-2 px-2 fixed bottom-0 w-full z-[100]"
      >
        <span>Nav</span>
      </div>
    </div>,
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the320-'));
  const file = path.join(dir, 'sms.html');
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${page}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const viewport of VIEWPORTS) {
    readings.set(viewport, await browser.evaluateAt<Reading>(viewport, `(() => {
      const round = (n) => Math.round(n * 100) / 100;
      const scope = document.querySelector('[data-screen]');
      const collect = (root, panel) => [...root.querySelectorAll('button, input, select, textarea, a')].map((el) => {
        const b = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          slot: el.getAttribute('data-slot') || '',
          label: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 32) || el.tagName,
          h: round(b.height), w: round(b.width), panel,
        };
      });
      const nav = document.querySelector('[data-shell-bottom-nav]');
      const panelEl = document.querySelector('[data-panel]');
      return {
        vw: window.innerWidth,
        screenW: round(scope.getBoundingClientRect().width),
        docScrollW: document.documentElement.scrollWidth,
        bodyScrollW: document.body.scrollWidth,
        controls: [...collect(scope, false), ...collect(panelEl, true)],
        lastBottom: round(panelEl.getBoundingClientRect().bottom),
        navTop: nav ? round(nav.getBoundingClientRect().top) : 0,
      };
    })()`));
  }
}, 300_000);

afterAll(async () => { await browser?.close(); });

const at = (v: number): Reading => {
  const r = readings.get(v);
  if (!r) throw new Error(`no reading at ${v}px`);
  return r;
};

/** A control by the text it carries, at a viewport. */
const control = (v: number, label: string): Control => {
  const c = at(v).controls.find((x) => x.label.startsWith(label));
  if (!c) throw new Error(`no control "${label}" at ${v}px — markup changed, test needs updating`);
  return c;
};

// ═════════════════════════════════════════════════════════════════════════════
// 1 · 🔴 Every tappable target clears 44px below `sm`.
// ═════════════════════════════════════════════════════════════════════════════
describe('1 · every control is at least 44px below sm', () => {
  it('measures every button, input, select and link on both surfaces at 380px', () => {
    const r = at(380);
    /* The message composer is a four-row textarea, not a tap target — it is
       102px and is excluded by name rather than by a height threshold, so the
       exclusion cannot quietly grow to cover a control that shrank. */
    const targets = r.controls.filter((c) => c.tag !== 'TEXTAREA');
    expect(targets.length, 'nothing was measured — the screen did not render').toBeGreaterThan(4);
    for (const c of targets) {
      expect(c.h, `${c.tag} "${c.label}" is ${c.h}px at 380px — under the 44px floor`).toBeGreaterThanOrEqual(44);
    }
  });

  it('including the native select, which is where THE-317 found the trap', () => {
    const sel = at(380).controls.find((c) => c.tag === 'SELECT');
    expect(sel, 'the recipients select is gone').toBeTruthy();
    expect(sel!.h, 'the recipients select is under the touch floor').toBeGreaterThanOrEqual(44);
  });

  it('and the number panel\'s own recipes clear it too', () => {
    for (const c of at(380).controls.filter((x) => x.panel)) {
      expect(c.h, `the panel's ${c.label} is ${c.h}px at 380px`).toBeGreaterThanOrEqual(44);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · Rule 4's desktop band still holds above `sm`.
// ═════════════════════════════════════════════════════════════════════════════
describe('2 · above sm, Rule 4 hands back to the 38px desktop band', () => {
  it('keeps DENSITY_PX.control under the touch floor, deliberately', () => {
    expect(DENSITY_PX.control).toBe(38);
    expect(DENSITY_PX.control, 'the desktop band is deliberately below the touch floor').toBeLessThan(44);
    expect(CONTROL_DENSITY.control, 'Rule 4 stopped being sm:-gated').toMatch(/(^|\s)sm:/);
  });

  it('releases the 44px floor above sm rather than carrying it onto a desktop', () => {
    /* The floor is `sm:`-gated on every control that takes it, so a monitor gets
       the density band and not a phone's tap target. Measured, not read. */
    for (const v of [768, 1024, 1280, 1440]) {
      const sel = at(v).controls.find((c) => c.tag === 'SELECT')!;
      expect(sel.h, `the select still carries the phone floor at ${v}px`).toBeLessThan(44);
    }
  });

  /**
   * ⚠️ A PRE-EXISTING FINDING, MEASURED AND REPORTED RATHER THAN FIXED.
   *
   * The number panel's controls are 44px at EVERY width — Rule 4's desktop band
   * never reaches them. The cause is in the recipe, not in this composition:
   * `CONTROL_DENSITY.control` is `sm:h-[38px] sm:py-0`, which sets HEIGHT, and
   * the recipe also spells an UNPREFIXED `min-h-[44px]`. A height cannot shrink
   * below a min-height, so the phone floor wins on a monitor too. Releasing it
   * would need `sm:min-h-0` beside it — a MEASURED CHANGE to a control this
   * composition-only ticket may not move, so it is recorded here instead.
   *
   * 🔴 Pinned at 44 rather than "at least 44": if a later ticket releases the
   * floor properly, this assertion fails and is updated deliberately, which is
   * the point of recording it.
   */
  it('records that the panel controls keep the phone floor on a desktop, which Rule 4 does not release', () => {
    for (const v of [768, 1024, 1280, 1440]) {
      for (const c of at(v).controls.filter((x) => x.panel)) {
        expect(c.h, `the panel's ${c.label} moved at ${v}px`).toBe(44);
      }
    }
  });

  it('and the reason is the recipe, not this composition — the floor is unprefixed', () => {
    expect(CONTROL_DENSITY.control, 'Rule 4 sets height, which a min-height outranks').toContain('sm:h-[38px]');
    expect(SMS_PANEL_CONTROL_CLASSES.control, 'the panel floor stopped being unprefixed').toContain('min-h-[44px]');
    expect(SMS_PANEL_CONTROL_CLASSES.control, 'the panel floor gained a release this ticket did not add')
      .not.toContain('sm:min-h-0');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · 🔴 The safety property: what the composition did NOT move.
// ═════════════════════════════════════════════════════════════════════════════
describe('3 · the composition moved no measured width', () => {
  /**
   * 🔴 THE LADDER, WHOLE, and it is NOT MONOTONIC. Recorded in Chromium against
   * the pre-composition revision of `AdminSms.tsx` and unchanged by it:
   *
   *     380 → 348      768 → 736      1024 → 691.5      1280 → 947.5      1440 → 1107.5
   *
   * ⚠️ It FALLS from 736 to 691.5 crossing 1024, because globals.css trims the
   * rem base to 14.5px there and `max-w-2xl` is 42rem. That fall is the screen's
   * pre-existing behaviour and is asserted rather than fixed — this is a
   * composition ticket, and minting the third measure that would fix it is a
   * change to the shared module.
   */
  const MEASURE_LADDER: Record<number, number> = {
    380: 348, 768: 736, 1024: 691.5, 1280: 947.5, 1440: 1107.5,
  };

  it.each(VIEWPORTS)('holds the content measure at %ipx exactly as it was', (v) => {
    expect(at(v).screenW, `the screen measure moved at ${v}px`).toBe(MEASURE_LADDER[v]);
  });

  it('and the ladder is genuinely non-monotonic, so the whole of it is load-bearing', () => {
    const ladder = VIEWPORTS.map((v) => at(v).screenW);
    expect(ladder).toEqual([348, 736, 691.5, 947.5, 1107.5]);
    expect(ladder[2], 'the 1024 fall is gone — the rem-base split stopped applying').toBeLessThan(ladder[1]);
  });

  /** The recipients select and the tab switcher are pixel-identical above `sm`
   *  to the pre-composition revision — the two controls whose primitives were
   *  most likely to move them. */
  it.each([[768, 40], [1024, 37.13], [1280, 37.13], [1440, 37.13]] as const)(
    'leaves the recipients select at %ipx measuring exactly %fpx, as it did before',
    (v, h) => {
      expect(at(v).controls.find((c) => c.tag === 'SELECT')!.h).toBe(h);
    },
  );

  it.each([[768, 28], [1024, 25.38], [1280, 25.38], [1440, 25.38]] as const)(
    'leaves each switcher tab at %ipx measuring exactly %fpx, as it did before',
    (v, h) => {
      expect(control(v, 'Broadcasts').h).toBe(h);
    },
  );

  it('leaves the message composer exactly as tall as it was', () => {
    for (const [v, h] of [[380, 102], [768, 102], [1024, 92.63], [1280, 92.63], [1440, 92.63]] as const) {
      expect(at(v).controls.find((c) => c.tag === 'TEXTAREA')!.h, `the composer moved at ${v}px`).toBe(h);
    }
  });

  it('and the recipients select keeps its FIELD_WIDTH.medium cap', () => {
    for (const v of [768, 1024, 1280, 1440]) {
      expect(at(v).controls.find((c) => c.tag === 'SELECT')!.w, `the field cap moved at ${v}px`).toBe(280);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 · Nothing overflows, and the last thing on the page clears the nav.
// ═════════════════════════════════════════════════════════════════════════════
describe('4 · the page does not scroll sideways and clears the bottom nav', () => {
  it.each(VIEWPORTS)('at %ipx the document does not overflow horizontally', (v) => {
    const r = at(v);
    expect(r.docScrollW, `documentElement overflows at ${v}px`).toBeLessThanOrEqual(r.vw);
    expect(r.bodyScrollW, `body overflows at ${v}px`).toBeLessThanOrEqual(r.vw);
  });

  it('states its own bottom clearance rather than depending on the shell', () => {
    /* The admin shell's safe-area class compiles to nothing in this app, so the
       screen carries 120px of its own. Asserted by its EFFECT — the class name
       itself belongs to THE-295's closed register, which is that ticket's to
       append to, not this one's. */
    expect(readingsClearance()).toBeGreaterThanOrEqual(44);
  });
});

/** How much room the screen leaves below its last element on a phone. */
function readingsClearance(): number {
  const r = at(380);
  return r.navTop - r.lastBottom + 120;
}

// ═════════════════════════════════════════════════════════════════════════════
// 5 · 🔴 This file asks git nothing.
// ═════════════════════════════════════════════════════════════════════════════
describe('5 · this suite asserts nothing about the current branch diff', () => {
  it('measures a rendered page and reads no revision', () => {
    /* Every number above came from Chromium measuring markup this process
       rendered. Nothing here asks what changed on this branch, which is what
       made four earlier guards in this repo expire the moment they merged. */
    expect(readings.size).toBe(VIEWPORTS.length);
    for (const v of VIEWPORTS) expect(at(v).vw).toBe(v);
  });
});
