// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom. happy-dom has NO LAYOUT ENGINE — with the real
// compiled stylesheet injected, `getBoundingClientRect()` returns zeros on every
// element, so no question about a box can be asked of it. Everything below is
// measured in real Chromium over CDP (`src/test/support/browser-measure.ts`).
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { setUpOrFail } from '../../test/support/suite-setup';
import { InsightFeed } from '../dashboard/InsightFeed';
import { REASON } from '../dashboard/dashboard-data';

/**
 * THE-328 — the insight feed, measured.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 WHAT THE TAP-TARGET BAR ACTUALLY ASKS OF THIS PANEL.
 *
 * Every tappable target must be ≥44px below `sm`, and above `sm` Rule 4 fixes
 * controls at 38px — a test asserts `DENSITY_PX.control < 44` deliberately.
 *
 * ⚠️ THIS PANEL HAS NO CONTROLS AT ALL, and that is a MEASURED claim here
 * rather than an assumed one. It renders a card, a destructive alert per
 * refused read and one item per note; nothing in it is a button, a link, a
 * select or a tab trigger. So the 44px floor is not satisfied by sizing — it is
 * satisfied because there is nothing to size, and section 1 proves the negative
 * by querying for every control selector the ladder measures elsewhere.
 *
 * 🔴 THAT IS THE ASSERTION THAT MATTERS: it FAILS THE MOMENT a later ticket
 * adds a disclosure toggle, a "why this number" button or a tooltip trigger to
 * this panel — which is precisely the change THE-328 rejected, and precisely
 * the one that would smuggle the schema string back onto a phone. A control
 * appearing here must come with its own measurement, and this file makes that
 * unavoidable rather than optional.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ⚠️ WIDTH IS NOT MONOTONIC on this shell, so the ladder is measured WHOLE at
 * 380 / 768 / 1024 / 1280 / 1440 rather than at its ends.
 * ⚠️ ONE `MeasuringBrowser` in this process. Two collide on a debugger port.
 * ⚠️ NO CLOCK IS INVOLVED. The feed takes weekly buckets as VALUES, never a
 * date, so this file pins no fixture to any date at all — the #468 fuse cannot
 * be lit from here.
 */

const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

const points = (...values: number[]) => values.map((value, i) => ({ label: `w${i}`, value }));

/**
 * The widest state the panel can reach: one refused read (a destructive alert
 * carrying the longest REASON this feed can be handed) and two long notes.
 * A layout that holds here holds for every shorter state.
 */
const INPUTS = {
  memberSeries: { kind: 'complete', points: points(0, 0, 0, 12345) },
  givingSeries: { kind: 'unavailable', reason: REASON.tooManyToChart },
  submissionsSeries: { kind: 'complete', points: points(1, 2, 3, 9876) },
} as const;

interface Reading {
  viewport: number;
  bodyScrollWidth: number;
  /** Anything a finger could press, by every selector the ladder measures. */
  controls: { label: string; width: number; height: number }[];
  /** The alert and the item rows — each must fit inside its own box. */
  blocks: { kind: string; width: number; scrollWidth: number; height: number }[];
  text: string;
}

let browser: MeasuringBrowser;
const readings = new Map<number, Reading>();

setUpOrFail(async () => {
  const css = await buildAppCss();

  const page = renderToStaticMarkup(
    <div className="flex h-screen">
      <div className="hidden lg:block w-64 shrink-0" />
      <div className="min-w-0 flex-1 flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto p-0 lg:p-6">
          {/* The two-column grid the Overview tab actually puts it in. */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <InsightFeed loading={false} inputs={INPUTS} />
          </div>
        </div>
      </div>
    </div>,
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the328-'));
  const file = path.join(dir, 'insight-feed.html');
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${page}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const viewport of VIEWPORTS) {
    readings.set(viewport, await browser.evaluateAt<Reading>(viewport, `(() => {
      const controls = [...document.querySelectorAll(
        'button, a[href], input, select, textarea, [role="button"], [role="tab"],' +
        '[data-slot="button"], [data-slot="select-trigger"], [data-slot="tabs-trigger"],' +
        '[data-slot="collapsible-trigger"], [data-slot="tooltip-trigger"], [tabindex]:not([tabindex="-1"])'
      )].map((el) => {
        const b = el.getBoundingClientRect();
        return {
          label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
          width: b.width, height: b.height,
        };
      });
      const blocks = [...document.querySelectorAll('[data-slot="alert"], [data-slot="item"], [data-slot="card"]')]
        .map((el) => {
          const b = el.getBoundingClientRect();
          return {
            kind: el.getAttribute('data-slot') || '?',
            width: b.width, scrollWidth: el.scrollWidth, height: b.height,
          };
        });
      return {
        viewport: window.innerWidth,
        bodyScrollWidth: document.documentElement.scrollWidth,
        controls,
        blocks,
        text: (document.body.textContent || '').replace(/\\s+/g, ' ').trim(),
      };
    })()`));
  }
}, 120_000);

afterAll(async () => { await browser?.close(); });

/* ═══ 1 · Every control ≥44px below sm; Rule 4's 38px holds above ════════════ */

describe('every control is ≥44px below sm, and Rule 4 holds above it', () => {
  it.each(VIEWPORTS)('%ipx', (viewport) => {
    const reading = readings.get(viewport)!;
    // 🔴 THE GATE: a reading that measured an empty page would pass every
    // assertion below vacuously.
    expect(reading.blocks.length, 'nothing rendered to measure').toBeGreaterThan(2);
    expect(reading.viewport).toBe(viewport);

    for (const control of reading.controls) {
      if (viewport < 640) {
        expect(control.height, `${control.label} is below the 44px floor`).toBeGreaterThanOrEqual(44);
      } else {
        // Rule 4 fixes controls at 38px above `sm`, deliberately under 44.
        expect(control.height, `${control.label} is not a Rule 4 control`).toBeGreaterThanOrEqual(24);
      }
    }
  });

  /**
   * 🔴 THE ASSERTION THAT BITES. The floor above is satisfied vacuously today
   * because the panel has NO controls — so the emptiness is asserted directly.
   * Adding a disclosure toggle, a tooltip trigger or a "why this number" button
   * to this feed fails HERE, by name, and must arrive with its own measurement.
   */
  it('the panel is a readout, not a control surface, at every width', () => {
    for (const viewport of VIEWPORTS) {
      const reading = readings.get(viewport)!;
      expect(reading.controls.map((c) => c.label), `a control appeared at ${viewport}px`).toEqual([]);
    }
  });
});

/* ═══ 2 · Nothing overflows, at any width ════════════════════════════════════ */

describe('the panel fits the width it is given', () => {
  it.each(VIEWPORTS)('%ipx has no horizontal overflow', (viewport) => {
    const reading = readings.get(viewport)!;
    expect(reading.bodyScrollWidth).toBeLessThanOrEqual(viewport);
    for (const block of reading.blocks) {
      // Each block's own content fits inside it — a sentence that ran past its
      // card would show here as a scrollWidth beyond the measured width.
      expect(block.scrollWidth, `${block.kind} overflows at ${viewport}px`)
        .toBeLessThanOrEqual(Math.ceil(block.width) + 1);
      expect(block.height, `${block.kind} collapsed at ${viewport}px`).toBeGreaterThan(0);
    }
  });
});

/* ═══ 3 · What is on screen is the copy, not the schema ══════════════════════ */

describe('the measured page shows a church sentence and no schema', () => {
  it('renders the sentences and none of the provenance, at 380px', () => {
    const text = readings.get(380)!.text;
    expect(text).toContain('12,345 members joined in the last seven days');
    expect(text).toContain('Giving could not be read for the last seven days.');
    for (const token of ['tenants/', '{id}', 'createdAt', 'submittedAt', 'amount (cents)', 'complete read']) {
      expect(text.includes(token), 'the compiled page rendered a schema token').toBe(false);
    }
  });
});
