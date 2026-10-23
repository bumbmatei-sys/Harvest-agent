// @vitest-environment node
//
// NODE, NOT happy-dom: `MeasuringBrowser` never attaches under a DOM environment, and the
// claims below are about where boxes land, which a DOM emulator with no layout engine cannot say.
// ONE `MeasuringBrowser` PER PROCESS.
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { PageHeader, PageTabs } from '@/components/admin-shell/PageHeader';
import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { setUpOrFail } from '../../test/support/suite-setup';

/**
 * The page header standard, measured:
 *   - the title, the pill and the main button sit on ONE line (title left, pill then button right);
 *   - the selected highlight stays fully INSIDE the pill;
 *   - the pill does not move or resize when the selection changes.
 *
 * The pill is rendered once per selection, from the real component and the real compiled
 * stylesheet, and every number is read off a real Chromium. Transitions are suppressed so the
 * resting layout is what is measured, not a frame in flight.
 */

const VALUES = ['overview', 'broadcasts', 'subscribers', 'settings'] as const;
const ITEMS = [
  { value: 'overview', label: 'Overview' },
  { value: 'broadcasts', label: 'Broadcasts' },
  { value: 'subscribers', label: 'Subscribers' },
  { value: 'settings', label: 'Settings' },
] as const;
const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

const page = () => (
  <body>
    {VALUES.map((value) => (
      <section key={value} data-case={value} style={{ padding: 16 }}>
        <PageHeader
          title="Newsletter"
          subtitle="The people in your CRM who opted in to email."
          tabs={<PageTabs label="Email sections" value={value} onValueChange={() => {}} items={ITEMS} />}
          action={<button type="button" data-action className="h-11 rounded-md bg-primary px-4 text-sm">New broadcast</button>}
        />
      </section>
    ))}
  </body>
);

interface R { x: number; y: number; w: number; h: number; right: number; bottom: number }
interface Reading { cases: Record<string, { list: R; title: R; action: R; controls: R; triggers: R[]; active: R | null; scrollWidth: number; viewport: number }> }
const readings = new Map<number, Reading>();
let browser: MeasuringBrowser;

setUpOrFail(async () => {
  const css = await buildAppCss();
  const body = renderToStaticMarkup(page());
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pageheader-'));
  const file = path.join(dir, 'page-header.html');
  writeFileSync(file, `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>${css}</style><style>*,*::before,*::after{transition:none !important;animation:none !important}</style></head>${body}</html>`);
  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);
  for (const viewport of VIEWPORTS) {
    readings.set(viewport, await browser.evaluateAt<Reading>(viewport, `(() => {
      const n = (v) => Math.round(v * 100) / 100;
      const cases = {};
      for (const sec of document.querySelectorAll('[data-case]')) {
        // Positions are read relative to the section, so the four stacked cases compare like for like.
        const o = sec.getBoundingClientRect();
        const r = (el) => { const b = el.getBoundingClientRect(); return { x: n(b.x - o.x), y: n(b.y - o.y), w: n(b.width), h: n(b.height), right: n(b.right - o.x), bottom: n(b.bottom - o.y) }; };
        const list = sec.querySelector('[data-page-tabs]');
        const active = sec.querySelector('[role=tab][aria-selected="true"]');
        cases[sec.getAttribute('data-case')] = {
          list: r(list), title: r(sec.querySelector('h1')), action: r(sec.querySelector('[data-action]')),
          controls: r(sec.querySelector('[data-page-header-controls]')),
          triggers: [...list.querySelectorAll('[role=tab]')].map(r), active: active ? r(active) : null,
          scrollWidth: document.documentElement.scrollWidth, viewport: window.innerWidth,
        };
      }
      return { cases };
    })()`, 900));
  }
}, 300_000);

afterAll(async () => { await browser?.close(); });

const at = (v: number, c: string) => readings.get(v)!.cases[c];
/** How much of the shorter box's height the two share vertically: 1 is the same line, 0 is a different one. */
const overlap = (a: R, b: R) => (Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y)) / Math.min(a.h, b.h);

describe.each(VIEWPORTS)('page header at %ipx', (viewport) => {
  it('draws a selected tab for every selection, and nothing overflows sideways', () => {
    for (const c of VALUES) {
      expect(at(viewport, c).active, `${c}: no selected tab`).not.toBeNull();
      expect(at(viewport, c).scrollWidth).toBeLessThanOrEqual(at(viewport, c).viewport);
    }
  });

  it('keeps the selected highlight fully inside the pill, with room to spare, whichever tab is selected', () => {
    for (const c of VALUES) {
      const { list, active } = at(viewport, c);
      const a = active!;
      expect(a.x, `${c} left`).toBeGreaterThanOrEqual(list.x + 2);
      expect(a.right, `${c} right`).toBeLessThanOrEqual(list.right - 2);
      expect(a.y, `${c} top`).toBeGreaterThanOrEqual(list.y + 2);
      expect(a.bottom, `${c} bottom`).toBeLessThanOrEqual(list.bottom - 2);
    }
  });

  it('does not move or resize the pill when the selection changes', () => {
    const first = at(viewport, VALUES[0]).list;
    for (const c of VALUES) {
      const { list } = at(viewport, c);
      expect(list, c).toEqual(first);
    }
  });

  it('gives every tab the same width, so no tab grows when it is selected', () => {
    for (const c of VALUES) {
      const widths = new Set(at(viewport, c).triggers.map((t) => t.w));
      expect(widths.size, `${c}: ${[...widths]}`).toBe(1);
    }
    const base = at(viewport, VALUES[0]).triggers.map((t) => t.w);
    for (const c of VALUES) expect(at(viewport, c).triggers.map((t) => t.w)).toEqual(base);
  });
});

describe.each([1024, 1280, 1440] as const)('on desktop at %ipx', (viewport) => {
  it('puts the title, the pill and the main button on ONE line: title left, pill then button right', () => {
    for (const c of VALUES) {
      const { title, list, action } = at(viewport, c);
      expect(overlap(title, list), `${c}: title vs pill`).toBeGreaterThanOrEqual(0.5);
      expect(overlap(list, action), `${c}: pill vs button`).toBeGreaterThanOrEqual(0.8);
      expect(title.right, `${c}: title before pill`).toBeLessThanOrEqual(list.x);
      expect(list.right, `${c}: pill before button`).toBeLessThanOrEqual(action.x);
    }
  });

  it('keeps the button at the right edge, where it was before the selection changed', () => {
    const first = at(viewport, VALUES[0]).action;
    for (const c of VALUES) expect(at(viewport, c).action).toEqual(first);
  });

  it('starts at the top of the content: the title sits at the section padding, with no space above it', () => {
    for (const c of VALUES) expect(at(viewport, c).title.y).toBeLessThanOrEqual(16 + 8);
  });
});
