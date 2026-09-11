// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom. happy-dom has NO LAYOUT ENGINE — with the real
// compiled stylesheet injected, `getBoundingClientRect()` returns zeros on
// every element and `getComputedStyle(el).display` answers `block` for a flex
// container. No assertion written against it could tell a usable run-sheet row
// from an unusable one. Everything below is measured in real Chromium over CDP
// (`src/test/support/browser-measure.ts`), which is why this file selects the
// `node` environment and renders to a string.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { setUpOrFail } from '../../test/support/suite-setup';
import { FORM_CONTAINER, DENSITY_PX, DESKTOP_CONTROL_MAX_PX } from '../layout/form-layout';
import { ItemRow, TEXT_BUTTON, NAV_CLEARANCE } from '../events/ServicePlanRow';
import { fmtClock, itemClockTimes, type ServicePlanItem } from '../events/service-plan';

/**
 * THE-313 — WHERE the order of service renders, measured in Chromium.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THIS FILE MOUNTS THE REAL `ItemRow`. IT IS NOT A REPLICA.
 *
 * ⚠️ Every other Chromium layout suite in this repo renders a hand-written copy
 * of the screen and then needs a second assertion pinning the copy's class
 * strings against the real file — THE-304's header says so in as many words —
 * because the copy drifts the moment somebody edits one and not the other.
 * `ServicePlanRow.tsx` was split out of `ServicePlanPanel.tsx` specifically so
 * that this suite does not have to: it imports no Firestore, no react-query and
 * no app store, so `renderToStaticMarkup` can render the shipped component and
 * the boxes measured below are the boxes a church sees. There is no replica to
 * pin, which is strictly stronger than pinning one.
 *
 * The surrounding CHROME — the panel's card, its buttons, the admin shell and
 * its bottom nav — is still assembled here, because mounting the panel itself
 * would drag in the whole data layer. Those class strings come from
 * `ServicePlanRow.tsx`'s own exports (`TEXT_BUTTON`, `NAV_CLEARANCE`) rather
 * than being retyped, for the same reason.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ⚠️ WIDTH IS NOT MONOTONIC ON THIS SHELL, so the ladder is measured WHOLE:
 * 380 / 768 / 1024 / 1280 / 1440. #429 measured a panel falling at 1024 — the
 * shell TAKES 275.5px away crossing that line, so the content box drops from
 * 951px at 1023px to 708.5px at 1024px — and #426 measured a card falling twice
 * with its narrowest point at 1280. Measuring only the ends would miss both.
 *
 * 🔴 THE BOTTOM NAV IS `fixed bottom-0` AT `z-[100]` and the ADMIN shell's
 * `pb-safe` COMPILES TO NOTHING — neither `globals.css` nor the Tailwind config
 * defines the class, and #437 fixed that for the MEMBER shell only. So the
 * clearance is EXPLICIT: `NAV_CLEARANCE` (`pb-[120px] lg:pb-0`) on the panel,
 * on top of the shell's own `pb-24`, and section 4 measures that the last item
 * clears the nav's top edge at 380px with the scroller at the bottom.
 */

const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

/**
 * ⚠️ `pb-safe` is NOT a rule in this app. Named so a reader does not take the
 * class in the shell replica below for the thing providing the clearance.
 */
const PB_SAFE_IS_INERT =
  'the admin shell still carries the inert class; the clearance measured here is NAV_CLEARANCE plus pb-24';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PANEL_SRC = readFileSync(path.join(REPO_ROOT, 'src/components/events/ServicePlanPanel.tsx'), 'utf8');
/** The panel's CODE, comments stripped — its header quotes the shell's own classes. */
const PANEL_CODE = PANEL_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/* ═════════════════════════════════════════════════════════════════════════════
   The fixture. ⚠️ Deliberately hostile: a real order of service is long, and a
   five-row fixture fits every viewport — which makes the bottom-nav clearance
   assertion vacuous by never reaching the nav. Titles and names are the length
   a church actually types.
   ═══════════════════════════════════════════════════════════════════════════ */

const START = new Date(2026, 8, 6, 10, 0, 0);

const row = (
  id: string, title: string, minutes: number, order: number,
  personName: string | null = null, note: string | null = null,
): ServicePlanItem => ({
  id, title, minutes, order,
  personId: personName ? `u-${id}` : null,
  personName, note,
});

const ITEMS: ServicePlanItem[] = [
  row('a', 'Welcome and call to worship', 3, 0, 'Adaeze Okonkwo-Fitzgerald'),
  row('b', 'Worship set — four songs, band and singers', 22, 1, 'Benjamin Achterberg', 'Opens in G, modulates to A for the last chorus'),
  row('c', 'Notices, birthdays and the offering', 6, 2, 'Christina Balasubramanian'),
  row('d', 'Baby dedication — the Nwachukwu family', 7, 3, 'Adaeze Okonkwo-Fitzgerald'),
  row('e', 'Sermon: Ephesians 4 and the shape of a church', 31, 4, 'Adaeze Okonkwo-Fitzgerald', 'Hand over to the prayer team at the end'),
  ...Array.from({ length: 15 }, (_, i) =>
    row(`x${i}`, `Ministry moment ${i + 1}`, 4, 5 + i, i % 2 ? 'Benjamin Achterberg' : null)),
];

/* ═════════════════════════════════════════════════════════════════════════════
   The page. The real rows, inside the panel's own chrome, inside the shell.
   ═══════════════════════════════════════════════════════════════════════════ */

const noop = () => {};

const Panel = () => (
  <div data-service-plan className={`bg-surface-raised rounded-2xl p-5 border border-line shadow-xs mb-5 ${NAV_CLEARANCE}`}>
    <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
      <h3 className="text-sm font-bold text-body flex items-center gap-1.5 font-display">Order of service</h3>
      <span data-plan-total className="text-xs text-muted tabular-nums">1h 51 · ends 11:51</span>
    </div>
    <div data-plan-items className="space-y-1.5">
      {itemClockTimes(ITEMS, START).map(({ item, startsAt }, i) => (
        <ItemRow
          key={item.id}
          item={item}
          index={i}
          clock={fmtClock(startsAt)}
          people={[{ id: 'u-a', name: 'Adaeze Okonkwo-Fitzgerald' }, { id: 'u-b', name: 'Benjamin Achterberg' }]}
          onChange={noop}
          onRemove={noop}
          onMove={noop}
          onDragStart={noop}
          onDragEnter={noop}
          onDragEnd={noop}
        />
      ))}
    </div>
    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-line">
      <button data-plan-action="save" className={TEXT_BUTTON}>Save changes</button>
      <button data-plan-action="copy" className={TEXT_BUTTON}>Copy run sheet</button>
      <button data-plan-action="share" className={TEXT_BUTTON}>Share</button>
      <button data-plan-action="template" className={TEXT_BUTTON}>Save as template</button>
      <button data-plan-action="delete" className={TEXT_BUTTON}>Remove</button>
    </div>
  </div>
);

interface Box { x: number; width: number; height: number; right: number; top: number; bottom: number }
interface Control { label: string; tag: string; width: number; height: number }
interface Reading {
  viewport: number;
  docScrollWidth: number;
  bodyScrollWidth: number;
  panel: Box | null;
  rows: Box[];
  controls: Control[];
  /** True when a row's title input sits on its own line — the wrapped phone form. */
  wrapped: boolean[];
  scrolled: { lastBottom: number; navTop: number } | null;
  /** The panel's own computed `padding-bottom` — what NAV_CLEARANCE spells. */
  panelPaddingBottom: number;
}

let browser: MeasuringBrowser;
const readings = new Map<number, Reading>();

setUpOrFail(async () => {
  expect(PB_SAFE_IS_INERT).toBeTruthy();
  const css = await buildAppCss();

  const page = renderToStaticMarkup(
    <div className="flex h-screen">
      {/* The admin nav in its SIDEBAR form, from lg. `w-64` is the shell's own. */}
      <div className="hidden lg:block w-64 shrink-0" />
      <div className="min-w-0 flex-1 flex flex-col">
        {/* AdminDashboard's scroller, class for class: `overflow-y-auto pb-24 lg:pb-8 p-0 lg:p-6`. */}
        <div data-shell-scroll className="flex-1 min-h-0 overflow-y-auto pb-24 lg:pb-8 p-0 lg:p-6">
          {/* AdminEvents' detail view wrapper — FORM_CONTAINER, Rule 1a. */}
          <div className={FORM_CONTAINER}>
            <Panel />
          </div>
        </div>
      </div>
      {/* 🔴 The SAME nav in its bottom-bar form, below lg. `pb-safe` is inert. */}
      <div
        data-shell-bottom-nav
        className="lg:hidden bg-surface-raised border-t border-line flex justify-center py-2 px-2 pb-safe fixed bottom-0 w-full z-[100]"
      >
        <span>Nav</span>
      </div>
    </div>,
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the313-'));
  const file = path.join(dir, 'service-plan.html');
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${page}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const viewport of VIEWPORTS) {
    readings.set(viewport, await browser.evaluateAt<Reading>(viewport, `(() => {
      const box = (el) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x, width: b.width, height: b.height, right: b.right, top: b.top, bottom: b.bottom };
      };
      const rows = [...document.querySelectorAll('[data-plan-row]')];
      const controls = [...document.querySelectorAll('[data-service-plan] button, [data-service-plan] input, [data-service-plan] select')]
        .map((el) => {
          const b = el.getBoundingClientRect();
          return {
            label: el.getAttribute('aria-label') || el.getAttribute('data-plan-action') || (el.textContent || '').trim() || el.tagName,
            tag: el.tagName,
            width: b.width, height: b.height,
          };
        });

      // A row is "wrapped" when its title input starts a line of its own —
      // i.e. its top is at or below the handle's bottom.
      const wrapped = rows.map((r) => {
        const handle = r.querySelector('[data-plan-handle]').getBoundingClientRect();
        const title = r.querySelector('[data-plan-title]').getBoundingClientRect();
        return title.top >= handle.bottom - 1;
      });

      const nav = document.querySelector('[data-shell-bottom-nav]');
      const scroller = document.querySelector('[data-shell-scroll]');
      let scrolled = null;
      if (scroller) {
        scroller.scrollTop = scroller.scrollHeight;
        const last = rows[rows.length - 1];
        scrolled = {
          lastBottom: last ? last.getBoundingClientRect().bottom : 0,
          navTop: nav ? nav.getBoundingClientRect().top : 0,
        };
        scroller.scrollTop = 0;
      }

      return {
        viewport: window.innerWidth,
        docScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        panel: box(document.querySelector('[data-service-plan]')),
        panelPaddingBottom: parseFloat(
          getComputedStyle(document.querySelector('[data-service-plan]')).paddingBottom,
        ),
        rows: rows.map(box),
        controls, wrapped, scrolled,
      };
    })()`));
  }
}, 180_000);

afterAll(async () => { await browser?.close(); });

const at = (v: number): Reading => {
  const r = readings.get(v);
  if (!r) throw new Error(`no reading at ${v}px`);
  return r;
};

/* ═════════════════════════════════════════════════════════════════════════════
   0. The measured page is the shipped component.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('this suite measures the component that ships', () => {
  it('mounts the real ItemRow rather than a replica of it', () => {
    // If a replica were needed, this import would not exist.
    expect(typeof ItemRow).toBe('function');
    // And the panel renders the same component, not a private copy.
    expect(PANEL_SRC).toContain("from './ServicePlanRow'");
    expect(PANEL_SRC).toContain('<ItemRow');
  });

  it('and takes the panel chrome from the panel s own exported class strings', () => {
    expect(PANEL_SRC).toContain('NAV_CLEARANCE');
    expect(PANEL_SRC).toContain('TEXT_BUTTON');
    expect(NAV_CLEARANCE).toBe('pb-[120px] lg:pb-0');
  });

  it('rendered every fixture row at every viewport', () => {
    for (const v of VIEWPORTS) expect(at(v).rows.length, `rows at ${v}px`).toBe(ITEMS.length);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   1. 🔴 No horizontal overflow at 380 / 768 / 1024 / 1280 / 1440.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('no horizontal overflow at any measured width', () => {
  it('the document never scrolls sideways', () => {
    for (const v of VIEWPORTS) {
      const r = at(v);
      expect(r.docScrollWidth, `the document overflows horizontally at ${v}px`).toBeLessThanOrEqual(r.viewport);
      expect(r.bodyScrollWidth, `the body overflows horizontally at ${v}px`).toBeLessThanOrEqual(r.viewport);
    }
  });

  it('every item row stays inside the panel', () => {
    for (const v of VIEWPORTS) {
      const r = at(v);
      for (const [i, box] of r.rows.entries()) {
        expect(box.right, `row ${i + 1} runs past the panel at ${v}px`)
          .toBeLessThanOrEqual(r.panel!.right + 0.5);
        expect(box.x, `row ${i + 1} starts left of the panel at ${v}px`)
          .toBeGreaterThanOrEqual(r.panel!.x - 0.5);
      }
    }
  });

  it('and no control is wider than the panel it sits in', () => {
    for (const v of VIEWPORTS) {
      const r = at(v);
      for (const c of r.controls) {
        expect(c.width, `${c.label} is wider than the panel at ${v}px`)
          .toBeLessThanOrEqual(r.panel!.width + 0.5);
      }
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   2. 🔴 Every control ≥44px below sm; Rule 4's 38px holds above.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('every control is at least 44px below sm', () => {
  it('at 380px, no control in the panel is shorter than 44px', () => {
    const r = at(380);
    expect(r.controls.length).toBeGreaterThan(ITEMS.length * 5);
    for (const c of r.controls) {
      expect(c.height, `${c.label} is ${c.height}px tall at 380px`).toBeGreaterThanOrEqual(44);
    }
  });

  it('and the drag handle in particular — a handle nobody can hit is unusable', () => {
    const r = at(380);
    const handles = r.controls.filter((c) => c.label.startsWith('Move '));
    expect(handles.length).toBe(ITEMS.length);
    for (const h of handles) {
      expect(h.height, `${h.label} is ${h.height}px tall`).toBeGreaterThanOrEqual(44);
      expect(h.width, `${h.label} is ${h.width}px wide`).toBeGreaterThanOrEqual(44);
    }
  });

  it('so does every remove button, which is the other icon-only target', () => {
    const r = at(380);
    const removes = r.controls.filter((c) => c.label.startsWith('Remove '));
    expect(removes.length).toBe(ITEMS.length);
    for (const b of removes) {
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.width).toBeGreaterThanOrEqual(44);
    }
  });

  /**
   * 🔴 ABOVE `sm`, RULE 4 WINS AND THIS SUITE DOES NOT FIGHT IT.
   * `form-layout.ts` fixes a control at 38px and asserts `DENSITY_PX.control <
   * 44` deliberately: a pointer at a desktop is not a thumb.
   */
  it('from sm up, a text control takes Rule 4s height and not the 44px floor', () => {
    expect(DENSITY_PX.control).toBeLessThan(44);
    for (const v of [768, 1024, 1280, 1440] as const) {
      const r = at(v);
      const texts = r.controls.filter((c) => c.tag === 'INPUT' || c.tag === 'SELECT');
      expect(texts.length).toBeGreaterThan(0);
      for (const c of texts) {
        expect(c.height, `${c.label} is ${c.height}px at ${v}px — Rule 4 says ${DENSITY_PX.control}`)
          .toBeCloseTo(DENSITY_PX.control, 0);
      }
    }
  });

  it('and nothing Rule 4 sizes exceeds the top of the desktop density band', () => {
    for (const v of [768, 1024, 1280, 1440] as const) {
      for (const c of at(v).controls) {
        if (c.tag === 'INPUT' || c.tag === 'SELECT' || c.label.startsWith('Move ') || c.label.startsWith('Remove ')) {
          expect(c.height, `${c.label} is ${c.height}px at ${v}px`)
            .toBeLessThanOrEqual(DESKTOP_CONTROL_MAX_PX + 0.5);
        }
      }
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   3. The phone form: a row wraps rather than squeezing its title.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('at 380px a row wraps instead of squeezing the title', () => {
  it('every title input takes a line of its own', () => {
    expect(at(380).wrapped, 'a row kept its title on the handle line at 380px')
      .toEqual(ITEMS.map(() => true));
  });

  it('and from sm up it is back on the handle line', () => {
    for (const v of [768, 1024, 1280, 1440] as const) {
      expect(at(v).wrapped.every((w) => w === false), `a row still wrapped at ${v}px`).toBe(true);
    }
  });

  it('a wrapped title is not narrower than the same markup already survives on a phone', () => {
    const r = at(380);
    const titles = r.controls.filter((c) => c.label.startsWith('Title of item'));
    expect(titles.length).toBe(ITEMS.length);
    for (const t of titles) {
      // Full row width, minus the row's own p-2 either side.
      expect(t.width, `a title input is only ${t.width}px at 380px`)
        .toBeGreaterThan(r.rows[0].width - 40);
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   4. 🔴 The last item clears the bottom nav at 380px.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the last item clears the bottom nav at 380px', () => {
  it('the fixture is long enough for the question to be real', () => {
    // A fixture that fits the viewport would pass by never reaching the nav.
    const r = at(380);
    const total = r.rows[r.rows.length - 1].bottom - r.rows[0].top;
    expect(total, 'the fixture fits on one screen, so this assertion is vacuous')
      .toBeGreaterThan(1200);
  });

  it('scrolled to the bottom, the last row sits above the navs top edge', () => {
    const r = at(380);
    expect(r.scrolled).not.toBeNull();
    expect(r.scrolled!.navTop).toBeGreaterThan(0);
    expect(
      r.scrolled!.lastBottom,
      `the last item ends ${r.scrolled!.lastBottom}px down, under a nav whose top is ${r.scrolled!.navTop}px`,
    ).toBeLessThanOrEqual(r.scrolled!.navTop);
  });

  /**
   * 🔴 WHAT THE CLEARANCE IS ACTUALLY MADE OF, measured rather than claimed.
   *
   * ⚠️ An earlier draft of this test asserted "remove NAV_CLEARANCE and the
   * assertion above fails". THAT IS NOT TRUE and the measurement says so: the
   * admin shell's own `pb-24` is 96px and the bottom nav measures ~41px, so
   * `pb-24` alone already clears it. Asserting otherwise would have been a
   * guard that reads as protecting something it does not protect.
   *
   * What IS true, and is what this asserts:
   *   · `pb-safe` contributes NOTHING — it compiles to no rule in this app, so
   *     it is not part of the sum whatever the shell's class list says.
   *   · The panel's own bottom padding is 120px, from `NAV_CLEARANCE`, and that
   *     is the headroom the run sheet has over the shell's minimum. It is
   *     directly measurable on the panel's computed style, so THIS is the
   *     assertion that fails if the token is dropped.
   */
  it('the panel carries 120px of its own bottom padding below sm, from NAV_CLEARANCE', () => {
    expect(NAV_CLEARANCE).toBe('pb-[120px] lg:pb-0');
    expect(at(380).panelPaddingBottom, 'the panel lost its own nav clearance at 380px').toBe(120);
    expect(at(768).panelPaddingBottom, 'the panel lost its own nav clearance at 768px').toBe(120);
    // 🔴 From `lg` the nav is a SIDEBAR, not a bottom bar, so the clearance is
    // released rather than left as dead space at the foot of a desktop page.
    for (const v of [1024, 1280, 1440] as const) {
      expect(at(v).panelPaddingBottom, `the panel still reserves nav space at ${v}px`).toBe(0);
    }
    expect(PANEL_SRC).toContain('${NAV_CLEARANCE}');
  });

  it('and `pb-safe` contributes nothing to it — the class compiles to no rule', async () => {
    // ⚠️ #437 fixed `pb-safe` for the MEMBER shell only; the ADMIN shell still
    // carries the inert class, which is why the clearance above is explicit.
    const css = await buildAppCss();
    expect(css).not.toMatch(/\.pb-safe\s*\{/);
  });

  it('the nav is above the panel, so clearance is the only thing keeping the row visible', () => {
    // z-[100] on the nav; the panel spells no z-index at all.
    expect(PANEL_CODE).not.toMatch(/\bz-\[/);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   5. The panel keeps its measure, at every width on the non-monotonic ladder.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the panel sits inside the page measure at every width', () => {
  it('never exceeds Rule 1as 1120px container', () => {
    for (const v of VIEWPORTS) {
      const r = at(v);
      expect(r.panel!.width, `the panel is ${r.panel!.width}px at ${v}px`).toBeLessThanOrEqual(1120.5);
    }
  });

  /**
   * ⚠️ The measurements, recorded rather than asserted as a shape: width is NOT
   * monotonic on this shell (#429 measured a panel falling at 1024; #426 a card
   * falling twice, narrowest at 1280), so a `toBeGreaterThan(previous)` here
   * would be asserting something this shell does not promise.
   */
  it('records the panel width at all five widths', () => {
    const widths = Object.fromEntries(VIEWPORTS.map((v) => [v, Math.round(at(v).panel!.width * 100) / 100]));
    expect(Object.keys(widths).map(Number)).toEqual([...VIEWPORTS]);
    for (const v of VIEWPORTS) expect(widths[v]).toBeGreaterThan(0);
  });
});
