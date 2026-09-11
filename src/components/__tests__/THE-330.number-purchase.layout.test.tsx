// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom — the same reason THE-320, THE-290 and THE-298 give,
// re-verified for this ticket rather than inherited: with happy-dom selected,
// `MeasuringBrowser` never attaches and the suite times out. Nothing here needs
// a DOM. The page is rendered to a string and every measurement happens inside a
// real Chromium over CDP.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { setUpOrFail } from '../../test/support/suite-setup';
import { DENSITY_PX, CONTROL_DENSITY, FIELD_WIDTH } from '../layout/form-layout';
import { SMS_PICKER_CLASSES } from '../settings/SmsSection';
import { Badge } from '../ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Item, ItemContent, ItemTitle, ItemDescription } from '../ui/item';

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
 * THE-330 — WHERE THE NEW PICKERS AND THE NUMBER LIST LAND, MEASURED IN CHROMIUM.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 🔴 happy-dom HAS NO LAYOUT ENGINE — `getBoundingClientRect()` returns zeros
 * and `getComputedStyle` answers `display: block` for a flex container even with
 * the compiled stylesheet injected. Every other layout guard in this repo
 * reasons about CLASS NAMES, which answers "how wide may this box be" and cannot
 * answer "where did this box actually land".
 *
 * ─── 🔴 What this file exists to catch ──────────────────────────────────────
 *
 * THE-317 measured `ui/select` sizing itself through `data-[size=default]:h-8`,
 * an attribute selector that OUTRANKS Rule 4, and sticking at 32px — under the
 * touch floor, and `min-h-11` does not beat it. THIS TICKET ADDS TWO SELECTS
 * (three, counting the area picker), which is exactly the shape of control that
 * trap lives on. So all three are MEASURED, at all five widths, through the same
 * exported recipe the panel renders.
 *
 * ⚠️ ONE `MeasuringBrowser` PER PROCESS. Two instances in one process collide on
 * a PID-derived debugger port and silently compare a page with itself, so this
 * file opens exactly one and every reading comes from it.
 *
 * ⚠️ WIDTH IS NOT MONOTONIC on this shell — THE-320 measured the content box
 * RISING 348 → 736 from phone to tablet, FALLING to 691.5 at 1024 as globals.css
 * trims the rem base, then rising again. So the ladder is asserted whole rather
 * than at its ends.
 *
 * ⚠️ `transition-all` MAKES AN IMMEDIATE POST-RESIZE READING A LIE, and a
 * drifting value is the tell. Every reading below is taken once per viewport
 * after `evaluateAt` has settled the layout, and the heights asserted are the
 * settled ones — a drifting value would fail the equality, not pass it.
 *
 * ⚠️ Nothing here shells out to `git` and nothing here asserts anything about
 * the current branch's diff (#454). No date is pinned anywhere (#468).
 */

const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

interface Control { tag: string; id: string; h: number; w: number }
interface Reading {
  vw: number;
  docScrollW: number;
  bodyScrollW: number;
  controls: Control[];
  /** The type matrix: its own scroll width against the box it sits in. */
  matrix: { clientW: number; scrollW: number; cardW: number };
  /** The number list: the same question, plus its vertical overflow. */
  list: { clientW: number; scrollW: number; clientH: number; scrollH: number; cardW: number };
}

let browser: MeasuringBrowser;
const readings = new Map<number, Reading>();

setUpOrFail(async () => {
  const css = await buildAppCss();

  /**
   * ⚠️ THE PICKERS ARE RENDERED THROUGH THE PANEL'S OWN EXPORTED RECIPE, not a
   * hand-copied class string — a copy drifts silently from what ships. The
   * panel's controls exist only after its `/api/sms/numbers` effect resolves and
   * server rendering never runs an effect, which is why THE-320 established this
   * pattern for the same panel.
   *
   * The card shell replicates the panel's own (`rounded-2xl`, `p-6`), because
   * "does the list scroll INSIDE its card" is a question about that box.
   */
  const page = renderToStaticMarkup(
    <div className="min-h-screen bg-surface">
      <div className="flex-1 p-4 lg:p-6">
        <div data-screen>
          <div data-card className="bg-surface-raised rounded-2xl border border-line-subtle p-6 space-y-4 text-body">
            <div className={FIELD_WIDTH.long}>
              <label htmlFor="sms-country">Country</label>
              <select id="sms-country" className={SMS_PICKER_CLASSES}>
                <option>United States (US)</option>
                <option>United Kingdom (GB)</option>
              </select>
            </div>
            <div className={FIELD_WIDTH.long}>
              <label htmlFor="sms-type">Number type</label>
              <select id="sms-type" className={SMS_PICKER_CLASSES}>
                <option>Mobile · $3/month</option>
              </select>
            </div>
            <div className={FIELD_WIDTH.long}>
              <label htmlFor="sms-area">Area code</label>
              <select id="sms-area" className={SMS_PICKER_CLASSES}>
                <option>Any area</option>
                <option>Nashville, TN (615) — 42 available</option>
              </select>
            </div>

            {/* The per-type matrix, eight columns wide — the widest thing on the
                card and the reason `ui/table`'s own overflow container matters. */}
            <div data-matrix-box>
              <Table>
                <TableHeader>
                  <TableRow>
                    {['Type', 'SMS', 'Calls', 'WhatsApp', 'Monthly', 'Identity docs', 'Fulfilment', 'Stock'].map((h) => (
                      <TableHead key={h}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {['local', 'national', 'toll_free', 'mobile'].map((t) => (
                    <TableRow key={t}>
                      <TableCell className="whitespace-nowrap">{t}</TableCell>
                      <TableCell><Badge>Yes</Badge></TableCell>
                      <TableCell><Badge>Yes</Badge></TableCell>
                      <TableCell><Badge>Yes</Badge></TableCell>
                      <TableCell className="whitespace-nowrap">$3/month</TableCell>
                      <TableCell><Badge>Required</Badge></TableCell>
                      <TableCell className="whitespace-nowrap"><Badge>Buy now</Badge></TableCell>
                      <TableCell><Badge>In stock</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* The number list, with more rows than fit, so its own scroll is
                exercised rather than assumed. */}
            <div className="max-h-80 overflow-y-auto space-y-2" data-number-list>
              {Array.from({ length: 12 }, (_, i) => (
                <Item key={i} className="border border-line rounded-xl p-3">
                  <ItemContent>
                    <ItemTitle className="font-mono">+1615555{String(i).padStart(4, '0')}</ItemTitle>
                    <ItemDescription>
                      <span className="flex flex-wrap gap-1 mt-1">
                        {['voice', 'sms', 'mms'].map((f) => <Badge key={f}>{f}</Badge>)}
                      </span>
                    </ItemDescription>
                  </ItemContent>
                </Item>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the330-'));
  const file = path.join(dir, 'pickers.html');
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${page}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const viewport of VIEWPORTS) {
    readings.set(viewport, await browser.evaluateAt<Reading>(viewport, `(() => {
      const round = (n) => Math.round(n * 100) / 100;
      const card = document.querySelector('[data-card]');
      const matrixBox = document.querySelector('[data-matrix-box] [data-slot="table-container"]');
      const list = document.querySelector('[data-number-list]');
      return {
        vw: window.innerWidth,
        docScrollW: document.documentElement.scrollWidth,
        bodyScrollW: document.body.scrollWidth,
        controls: [...document.querySelectorAll('select')].map((el) => {
          const b = el.getBoundingClientRect();
          return { tag: el.tagName, id: el.id, h: round(b.height), w: round(b.width) };
        }),
        matrix: {
          clientW: matrixBox.clientWidth,
          scrollW: matrixBox.scrollWidth,
          cardW: round(card.getBoundingClientRect().width),
        },
        list: {
          clientW: list.clientWidth,
          scrollW: list.scrollWidth,
          clientH: list.clientHeight,
          scrollH: list.scrollHeight,
          cardW: round(card.getBoundingClientRect().width),
        },
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

const picker = (v: number, id: string): Control => {
  const c = at(v).controls.find((x) => x.id === id);
  if (!c) throw new Error(`no picker "${id}" at ${v}px — markup changed, test needs updating`);
  return c;
};

/** 🔴 BOTH NEW SELECTS, by name, plus the area picker. Named individually so a
 *  regression says WHICH control moved. */
const PICKERS = ['sms-country', 'sms-type', 'sms-area'] as const;

/* ═══════════════════════════════════════════════════════════════════════════
   21 · 🔴 Every control clears 44px below `sm` — and the selects are measured.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('21 · every control is at least 44px below sm', () => {
  it('🔴 all three pickers clear the touch floor at 380px', () => {
    expect(at(380).controls.length, 'nothing was measured — the page did not render').toBe(3);
    for (const id of PICKERS) {
      const c = picker(380, id);
      expect(c.h, `#${id} is ${c.h}px at 380px — under the 44px touch floor`).toBeGreaterThanOrEqual(44);
    }
  });

  /**
   * 🔴 THE MEASURED TRAP, CHECKED RATHER THAN INHERITED. `ui/select` pins its own
   * height through `data-[size=default]:h-8` — an attribute selector that
   * outranks Rule 4 — and stuck at 32px when THE-317 measured it. That is one of
   * the two reasons it is rejected for these controls; this asserts that the
   * native control it was rejected in favour of does not have the same problem.
   */
  it('🔴 and none of them sits at the 32px `ui/select` height the trap produces', () => {
    for (const v of VIEWPORTS) {
      for (const id of PICKERS) {
        expect(picker(v, id).h, `#${id} is at the ui/select trap height at ${v}px`).not.toBe(32);
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   21b · Rule 4's desktop band above `sm` — measured, and reported honestly.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('21b · Rule 4 above sm', () => {
  it('🔴 the token is still 38px and still deliberately under the touch floor', () => {
    expect(DENSITY_PX.control).toBe(38);
    expect(DENSITY_PX.control, 'the desktop band is deliberately below the touch floor').toBeLessThan(44);
    expect(CONTROL_DENSITY.control, 'Rule 4 stopped being sm:-gated').toMatch(/(^|\s)sm:/);
  });

  /**
   * ⚠️ A PRE-EXISTING PROPERTY OF THIS PANEL'S RECIPE, MEASURED AND REPORTED
   * RATHER THAN CHANGED — and THE-320 recorded exactly the same finding for the
   * panel's existing inputs and buttons.
   *
   * `CONTROL_DENSITY.control` is `sm:h-[38px] sm:py-0`, which sets HEIGHT; the
   * panel's recipes also spell an UNPREFIXED `min-h-[44px]`, and a height cannot
   * shrink below a min-height. So every control on THIS panel — the two new
   * selects included — measures 44px at every width rather than taking Rule 4's
   * band above `sm`.
   *
   * 🔴 ASSERTED, NOT ASSUMED, AND NOT QUIETLY FIXED. Releasing only the new
   * selects with `sm:min-h-0` would put 38px pickers beside 44px inputs and
   * buttons in the SAME form — a ragged row bought for a token's sake — and
   * releasing the panel's other controls is a measured change to controls this
   * ticket was not asked to move. The number is pinned here so it cannot drift
   * unnoticed in either direction.
   */
  it('🔴 the panel\'s pickers stay at the 44px floor above sm, exactly as its other controls do', () => {
    for (const v of [768, 1024, 1280, 1440]) {
      for (const id of PICKERS) {
        expect(picker(v, id).h, `#${id} changed height at ${v}px — the recipe moved`).toBe(44);
      }
    }
  });

  it('and no picker ever exceeds the touch floor either — it is a floor, not a growth', () => {
    for (const v of VIEWPORTS) {
      for (const id of PICKERS) {
        expect(picker(v, id).h, `#${id} grew past 44px at ${v}px`).toBeLessThanOrEqual(44);
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   21c · The pickers respect the form-layout width cap at every width.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('21c · the pickers take a form-layout width, and width is not monotonic', () => {
  it('🔴 no picker exceeds FIELD_WIDTH.long\'s 440px cap from sm up', () => {
    for (const v of [768, 1024, 1280, 1440]) {
      for (const id of PICKERS) {
        expect(picker(v, id).w, `#${id} is ${picker(v, id).w}px at ${v}px, past the 440px cap`)
          .toBeLessThanOrEqual(440);
      }
    }
  });

  /**
   * ⚠️ THE MEASURED NUMBER, NOT A GUESSED THRESHOLD. At 380px each picker is
   * 298px: the viewport less the shell's `p-4` (16px a side) and the card's own
   * `p-6` (24px a side) — 380 − 32 − 48 − 2px of border. A first pass here
   * asserted `> 300`, which was an invented figure and failed against the real
   * layout; pinning what Chromium actually reports is what this file is for.
   */
  it('and each fills its column on a phone, where the cap does not apply', () => {
    for (const id of PICKERS) {
      expect(picker(380, id).w, `#${id} does not fill its column at 380px`).toBe(298);
    }
    // All three agree, so one narrowing on its own is visible.
    const widths = new Set(PICKERS.map((id) => picker(380, id).w));
    expect(widths.size, 'the three pickers no longer share a width at 380px').toBe(1);
  });

  /** ⚠️ The ladder asserted WHOLE, because width is not monotonic on this shell:
   *  a test that checked only the phone and the desktop would miss a fall. */
  it('the width ladder is recorded at all five widths', () => {
    /**
     * 🔴 THE LADDER, PINNED TO WHAT CHROMIUM ACTUALLY REPORTED. The country
     * picker is 298px on a phone (the column it fills) and then sits at
     * FIELD_WIDTH.long's 440px cap at every larger width — it does not keep
     * growing with the card, which measures 348 → 736 → 980.5 → 1236.5 → 1396.5
     * across the same ladder.
     */
    expect(VIEWPORTS.map((v) => picker(v, 'sms-country').w), 'the width ladder moved')
      .toEqual([298, 440, 440, 440, 440]);
    const ladder = VIEWPORTS.map((v) => picker(v, 'sms-country').w);
    expect(ladder.length).toBe(5);
    for (const [i, w] of ladder.entries()) {
      expect(w, `the country picker collapsed at ${VIEWPORTS[i]}px`).toBeGreaterThan(0);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   22 · 🔴 At 380px the wide content scrolls INSIDE its card. The body does not.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('22 · at 380px the number list and the type matrix scroll inside their card', () => {
  it('🔴 the page body does not scroll horizontally at ANY width', () => {
    for (const v of VIEWPORTS) {
      const r = at(v);
      // 🔴 THE CLAIM THAT MATTERS: an eight-column matrix on a 380px phone must
      // not widen the page. A body that scrolls sideways is the defect.
      expect(r.bodyScrollW, `the body scrolls horizontally at ${v}px`).toBeLessThanOrEqual(r.vw);
      expect(r.docScrollW, `the document scrolls horizontally at ${v}px`).toBeLessThanOrEqual(r.vw);
    }
  });

  it('🔴 the type matrix overflows INSIDE its own container at 380px, not onto the page', () => {
    const { matrix } = at(380);
    // It genuinely is wider than the phone — otherwise this asserts nothing.
    expect(matrix.scrollW, 'the matrix is not actually wider than its box, so this proves nothing')
      .toBeGreaterThan(matrix.clientW);
    // …and the overflow is contained: the box itself fits within the card.
    expect(matrix.clientW, 'the matrix box is wider than its card').toBeLessThanOrEqual(Math.ceil(matrix.cardW));
  });

  it('🔴 the number list stays within its card at 380px and scrolls on the block axis', () => {
    const { list } = at(380);
    // 🔴 IT DOES NOT WIDEN THE CARD. Each row wraps rather than growing.
    expect(list.scrollW, 'the number list is wider than its own box — it will push the page')
      .toBeLessThanOrEqual(list.clientW + 1);
    expect(list.clientW, 'the number list is wider than its card').toBeLessThanOrEqual(Math.ceil(list.cardW));
    // …and twelve rows genuinely overflow its capped height, so the scroll is real.
    expect(list.scrollH, 'the number list does not actually overflow, so this proves nothing')
      .toBeGreaterThan(list.clientH);
  });

  it('and the same holds at every other width', () => {
    for (const v of [768, 1024, 1280, 1440]) {
      const { list, matrix } = at(v);
      expect(list.scrollW, `the number list overflows its box at ${v}px`).toBeLessThanOrEqual(list.clientW + 1);
      expect(matrix.clientW, `the matrix box escapes its card at ${v}px`).toBeLessThanOrEqual(Math.ceil(matrix.cardW));
    }
  });
});
