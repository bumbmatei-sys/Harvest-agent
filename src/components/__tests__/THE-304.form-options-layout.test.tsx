// @vitest-environment node
//
// 🔴 NODE, NOT happy-dom — the same reason THE-298's layout suite gives. Nothing
// here needs a DOM: the editor is rendered to a string and every measurement
// happens inside a real browser over CDP. happy-dom has NO LAYOUT ENGINE —
// getBoundingClientRect() returns zeros on every element even with the real
// compiled stylesheet injected — so no assertion written against it could tell
// a usable option row from an unusable one.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';

import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { FORM_MEASURE, FIELD_WIDTH, CONTROL_DENSITY, DENSITY_PX, DESKTOP_CONTROL_MAX_PX } from '../layout/form-layout';
import { MAX_FIELD_OPTIONS } from '../AdminForms';
import { DEFAULT_PALETTE_FAMILY } from '../../lib/theme';

/**
 * THE-304 — WHERE the option editor renders, measured in Chromium.
 *
 * ─── The shape of the hard case ──────────────────────────────────────────────
 *
 * ⚠️ An option list is a REPEATING ROW OF SMALL CONTROLS: a text input plus
 * move-up, move-down and remove. At 380px that row has about 348px of content
 * box to spend, and three 44px tap targets plus their gaps take 137px of it —
 * so a single-line row leaves the input under 210px and shrinking, and a row
 * that refuses to shrink pushes the CARD past the viewport and scrolls the
 * whole page sideways. Both outcomes are the "poor system" this ticket is
 * about, one of them wearing a fix.
 *
 * 🔴 So the row is `flex-wrap` with a `basis-full` input: on a phone the input
 * takes the whole first line at full card width and the three controls wrap
 * beneath it, and from `sm` the basis is released and the row is one line
 * again. This file measures that it is true rather than asserting the classes
 * that are supposed to make it true.
 *
 * ⚠️ WIDTH IS NOT MONOTONIC on this shell, so the ladder is measured whole —
 * 380 / 768 / 1024 / 1280 / 1440 — for the reason THE-298 records: #429
 * measured a panel falling at 1024 and #426 a card falling twice with its
 * narrowest point at 1280.
 *
 * 🔴 THE BOTTOM NAV IS `fixed bottom-0` AT `z-[100]`, and ⚠️ `pb-safe` COMPILES
 * TO NOTHING in this app — neither globals.css nor the Tailwind config defines
 * it. The clearance measured below is therefore explicit: the builder's own
 * `paddingBottom: 120` plus the shell's real `pb-24`, and the assertion is that
 * the last option row clears the nav's top edge when scrolled to the bottom.
 */

const VIEWPORTS = [380, 768, 1024, 1280, 1440] as const;

/** ⚠️ Not a rule in this app; see the block comment. */
const PB_SAFE = 'compiles to nothing today; the clearance below comes from pb-24 and paddingBottom:120';

/* ═════════════════════════════════════════════════════════════════════════════
   The class strings under test — spelled here AND pinned against AdminForms.tsx,
   so this replica cannot drift away from the screen it stands in for.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ TWO forms of the same string, on purpose.
 *
 * `_SRC` is the string as AdminForms.tsx SPELLS it — a template literal whose
 * tail interpolates the two shared rules — and is what the pin below searches
 * the file for. `_CLASS` is that string RESOLVED, and is what this replica
 * renders. Pinning the resolved form would fail against a file that (correctly)
 * imports its widths rather than typing them, and rendering the source form
 * would put a literal "${FIELD_WIDTH.long}" into the markup.
 */
const OPTION_INPUT_SRC =
  'basis-full min-w-0 sm:basis-auto sm:flex-1 px-3 py-2 border border-line rounded-lg text-sm ' +
  'focus:outline-hidden focus:border-gold min-h-[44px] sm:min-h-0 ${FIELD_WIDTH.long} ${CONTROL_DENSITY.control}';

const OPTION_INPUT_CLASS =
  `basis-full min-w-0 sm:basis-auto sm:flex-1 px-3 py-2 border border-line rounded-lg text-sm ` +
  `focus:outline-hidden focus:border-gold min-h-[44px] sm:min-h-0 ${FIELD_WIDTH.long} ${CONTROL_DENSITY.control}`;

const OPTION_ICON_CLASS =
  'shrink-0 inline-flex items-center justify-center min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 p-1 text-faint';

const ADD_OPTION_CLASS =
  'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-line ' +
  'text-body hover:bg-surface-sunken min-h-[44px] sm:min-h-0 disabled:opacity-30';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const ADMIN_FORMS = readFileSync(path.join(REPO_ROOT, 'src/components/AdminForms.tsx'), 'utf8');

/* ═════════════════════════════════════════════════════════════════════════════
   The replica. A dropdown field with a hostile option list.
   ═══════════════════════════════════════════════════════════════════════════ */

/** ⚠️ Deliberately hostile: a church genuinely writes an option this long, and
 *  a row sized against "Kids" would pass a test it should fail. */
const OPTIONS = [
  'Worship & Production — Sunday mornings and Thursday rehearsal',
  'Kids & Family Ministry (nursery through fifth grade)',
  'Hospitality',
  'Car Park & Welcome',
  'Prayer Team',
  // ⚠️ Padded to 24 so the editor genuinely OVERFLOWS a phone. A five-row
  // fixture fits on every viewport measured, which makes the bottom-nav
  // clearance assertion vacuous — it would pass by never reaching the nav.
  // A church that lists its ministries reaches this length for real.
  ...Array.from({ length: 19 }, (_, i) => `Ministry team ${i + 1}`),
];

const OptionRow = ({ opt, i, last }: { opt: string; i: number; last: boolean }) => (
  <div data-option-row={i} className="flex flex-wrap items-center gap-1.5">
    <input
      data-option-input={i}
      readOnly
      value={opt}
      aria-label={`Option ${i + 1}`}
      className={OPTION_INPUT_CLASS}
    />
    <button data-option-control={`up-${i}`} disabled={i === 0} aria-label={`Move option ${i + 1} up`}
      className={`${OPTION_ICON_CLASS} hover:text-body disabled:opacity-30`}><ChevronUp size={16} /></button>
    <button data-option-control={`down-${i}`} disabled={last} aria-label={`Move option ${i + 1} down`}
      className={`${OPTION_ICON_CLASS} hover:text-body disabled:opacity-30`}><ChevronDown size={16} /></button>
    <button data-option-control={`remove-${i}`} aria-label={`Remove option ${i + 1}`}
      className={`${OPTION_ICON_CLASS} hover:text-red-600`}><Trash2 size={15} /></button>
  </div>
);

const Editor = () => (
  <div className="bg-surface-raised rounded-2xl border border-line p-4">
    <div className="flex items-start gap-2">
      <span className="text-stone-300 mt-2.5 shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <input readOnly value="Which team would you like to join" placeholder="Field label"
            className={`flex-1 px-3 py-2 border border-line rounded-lg text-sm focus:outline-hidden focus:border-gold ${FIELD_WIDTH.long} ${CONTROL_DENSITY.control}`} />
          <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-surface-sunken text-muted whitespace-nowrap">Dropdown</span>
        </div>
        <div data-option-editor className="space-y-1.5">
          {OPTIONS.map((opt, i) => <OptionRow key={i} opt={opt} i={i} last={i === OPTIONS.length - 1} />)}
          <div className="flex flex-wrap items-center gap-2">
            <button data-option-control="add" className={ADD_OPTION_CLASS}><Plus size={12} /> Add option</button>
            <span className="text-[10px] text-muted">{OPTIONS.length} of {MAX_FIELD_OPTIONS} options</span>
          </div>
          <p data-option-note className="text-[10px] text-muted">
            41 responses already reference this form. Renaming or removing an option never changes an answer
            someone already gave — past answers keep their original wording and stay counted, listed
            separately in the answers view.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" readOnly /> Required
        </label>
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <button className="p-1 text-faint hover:text-body disabled:opacity-30"><ChevronUp size={16} /></button>
        <button className="p-1 text-faint hover:text-body disabled:opacity-30"><ChevronDown size={16} /></button>
        <button className="p-1 text-faint hover:text-red-600"><Trash2 size={15} /></button>
      </div>
    </div>
  </div>
);

interface Box { x: number; width: number; height: number; right: number; top: number; bottom: number }
interface Reading {
  viewport: number;
  docScrollWidth: number;
  bodyScrollWidth: number;
  card: Box | null;
  editor: Box | null;
  rows: Box[];
  inputs: Box[];
  /** Every control of the option editor, by its aria-label. */
  controls: { label: string; width: number; height: number }[];
  /** True when a row's controls sit BELOW its input — the wrapped phone form. */
  wrapped: boolean[];
  scrolled: { lastBottom: number; navTop: number; scrolledBy: number } | null;
}

let browser: MeasuringBrowser;
const readings = new Map<number, Reading>();

beforeAll(async () => {
  expect(PB_SAFE).toBeTruthy();
  const css = await buildAppCss();

  const page = renderToStaticMarkup(
    <div className="flex h-screen">
      {/* The nav in its SIDEBAR form, from lg. No width assertion reads it. */}
      <div className="hidden lg:block w-[289px] shrink-0" />
      <div className="min-w-0 flex-1 flex flex-col">
        <div data-shell-scroll className="flex-1 min-h-0 overflow-y-auto pb-24 lg:pb-8">
          {/* AdminForms' builder wrapper and measure, class for class. */}
          <div data-builder className={FORM_MEASURE} style={{ paddingBottom: 120 }}>
            <div className="space-y-4">
              <Editor />
            </div>
          </div>
        </div>
      </div>
      {/* 🔴 The SAME nav in its bottom-bar form, below lg only. */}
      <div
        data-shell-bottom-nav
        className="lg:hidden bg-surface-raised border-t border-line flex justify-center py-2 px-2 pb-safe fixed bottom-0 w-full z-[100]"
      >
        <span>Nav</span>
      </div>
    </div>,
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), 'the304-'));
  const file = path.join(dir, 'options.html');
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
      const rows = [...document.querySelectorAll('[data-option-row]')];
      const inputs = [...document.querySelectorAll('[data-option-input]')];
      const controls = [...document.querySelectorAll('[data-option-editor] button, [data-option-editor] input')]
        .map((el) => {
          const b = el.getBoundingClientRect();
          return { label: el.getAttribute('aria-label') || (el.textContent || '').trim() || el.tagName,
                   width: b.width, height: b.height };
        });

      const wrapped = rows.map((row) => {
        const input = row.querySelector('[data-option-input]').getBoundingClientRect();
        const first = row.querySelector('button').getBoundingClientRect();
        return first.top >= input.bottom - 1;
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
          scrolledBy: scroller.scrollTop,
        };
        scroller.scrollTop = 0;
      }

      return {
        viewport: window.innerWidth,
        docScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        card: box(document.querySelector('[data-option-editor]').closest('.rounded-2xl')),
        editor: box(document.querySelector('[data-option-editor]')),
        rows: rows.map(box), inputs: inputs.map(box),
        controls, wrapped, scrolled,
      };
    })()`));
  }
}, 180_000);

afterAll(async () => { await browser?.close(); });

const at = (v: number) => {
  const r = readings.get(v);
  if (!r) throw new Error(`no reading at ${v}px`);
  return r;
};

/* ═════════════════════════════════════════════════════════════════════════════
   0. The replica is the screen.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('this file measures the class strings AdminForms actually renders', () => {
  it('pins every option-editor class string against the screen itself', () => {
    for (const [name, cls] of [
      ['the option text input', OPTION_INPUT_SRC],
      ['an option icon control', OPTION_ICON_CLASS],
      ['the Add option button', ADD_OPTION_CLASS],
    ] as const) {
      expect(ADMIN_FORMS, `${name}'s class string here is not the one AdminForms renders`).toContain(cls);
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   1. 380px — the hard case.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the option editor is usable at 380px', () => {
  it('does not scroll the page sideways at any measured width', () => {
    for (const v of VIEWPORTS) {
      const r = at(v);
      // 🔴 The failure mode a repeating row of small controls actually produces.
      expect(r.docScrollWidth, `the document overflows horizontally at ${v}px`).toBeLessThanOrEqual(r.viewport);
      expect(r.bodyScrollWidth, `the body overflows horizontally at ${v}px`).toBeLessThanOrEqual(r.viewport);
    }
  });

  it('keeps every option row inside the card at every measured width', () => {
    for (const v of VIEWPORTS) {
      const r = at(v);
      expect(r.rows.length).toBe(OPTIONS.length);
      for (const [i, row] of r.rows.entries()) {
        expect(row.right, `option row ${i + 1} runs past the card at ${v}px`)
          .toBeLessThanOrEqual(r.card!.right + 0.5);
        expect(row.x, `option row ${i + 1} starts left of the card at ${v}px`)
          .toBeGreaterThanOrEqual(r.card!.x - 0.5);
      }
    }
  });

  it('gives the option text a full-width line at 380px instead of a squeezed remainder', () => {
    const r = at(380);
    // Every row wraps: the three controls sit BELOW the input, not beside it.
    expect(r.wrapped, 'an option row kept its controls on the input line at 380px')
      .toEqual(OPTIONS.map(() => true));
    // And the input therefore gets the editor's whole width, not what three
    // 44px targets left over.
    for (const [i, input] of r.inputs.entries()) {
      expect(input.width, `option input ${i + 1} is narrower than its editor at 380px`)
        .toBeGreaterThanOrEqual(r.editor!.width - 0.5);
      // The measured floor the wrap exists to avoid: 348px of content box minus
      // three 44px targets and their gaps is under 210px.
      expect(input.width, `option input ${i + 1} was squeezed at 380px`).toBeGreaterThan(210);
    }
  });

  it('puts the controls back on one line from sm upward', () => {
    for (const v of [768, 1024, 1280, 1440] as const) {
      expect(at(v).wrapped, `an option row still wraps at ${v}px`).toEqual(OPTIONS.map(() => false));
    }
  });

  it('clears the fixed bottom nav when scrolled to the end, below lg where the nav exists', () => {
    // ⚠️ The nav is `fixed bottom-0 z-[100]`, so a row that ends under it is
    // simply unreachable. 🔴 Measured at 380 and 768 ONLY, and that is a fact
    // about the shell rather than a gap: the bar is `lg:hidden`, so from 1024px
    // up it is not on the screen at all — it has become the sidebar the spacer
    // above stands for. Asserting a clearance from a nav that is not rendered
    // would compare against a zeroed box and pass on nothing.
    for (const v of [380, 768] as const) {
      const s = at(v).scrolled!;
      expect(s.scrolledBy, `the builder did not overflow at ${v}px, so the clearance case is vacuous`)
        .toBeGreaterThan(0);
      expect(s.lastBottom, `the last option row ends under the bottom nav at ${v}px`)
        .toBeLessThanOrEqual(s.navTop);
    }
    // The converse, so "only two viewports" is a claim this file states rather
    // than a loop that quietly stops short.
    for (const v of [1024, 1280, 1440] as const) {
      expect(at(v).scrolled!.navTop, `the bottom nav is still rendered at ${v}px`).toBe(0);
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   2. Touch targets.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('every control clears 44px below sm, and Rule 4 holds above it', () => {
  it('measures every option-editor control at 380px at 44px or more, on both axes', () => {
    const r = at(380);
    expect(r.controls.length).toBeGreaterThan(0);
    for (const c of r.controls) {
      expect(c.height, `"${c.label}" is ${c.height}px tall at 380px`).toBeGreaterThanOrEqual(44);
      expect(c.width, `"${c.label}" is ${c.width}px wide at 380px`).toBeGreaterThanOrEqual(44);
    }
  });

  it("hands the box back to Rule 4's deliberate 38px from sm upward", () => {
    // 🔴 DENSITY_PX.control is 38 ON PURPOSE and a test elsewhere asserts it is
    // under 44. The floor above must therefore be phone-only, or it would have
    // quietly raised the desktop density of a control this screen shares with
    // every other admin form.
    expect(DENSITY_PX.control).toBeLessThan(44);
    expect(DENSITY_PX.control).toBeLessThanOrEqual(DESKTOP_CONTROL_MAX_PX);
    for (const v of [768, 1024, 1280, 1440] as const) {
      for (const [i, input] of at(v).inputs.entries()) {
        expect(input.height, `option input ${i + 1} is ${input.height}px at ${v}px, not Rule 4's ${DENSITY_PX.control}`)
          .toBe(DENSITY_PX.control);
      }
    }
  });

  it('spells the floor on its own controls, never on a shared primitive', () => {
    // THE-298's precedent: resizing AdminSecondaryButton would resize every
    // secondary button in the admin app, which is a redesign and not a fix.
    const ui = readFileSync(path.join(REPO_ROOT, 'src/components/admin/AdminUI.tsx'), 'utf8');
    expect(ui, 'the 44px floor was pushed into the shared primitive').not.toContain('min-h-[44px]');
    expect(ADMIN_FORMS).toContain('min-h-[44px] sm:min-h-0');
    expect(ADMIN_FORMS).toContain('min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0');
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
   3. Colour and iconography.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('no colour is hardcoded and no emoji is used', () => {
  it('adds no colour literal to AdminForms', () => {
    // The one literal in this file is the pre-existing GOLD fallback, which
    // this ticket does not touch.
    const literals = ADMIN_FORMS.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) ?? [];
    expect(literals).toEqual(['#B8962E']);
    expect(ADMIN_FORMS).toContain("const GOLD = 'var(--brand-color, #B8962E)';");
  });

  it('resolves in all four palettes, Classic first — measured, not read off the CSS', async () => {
    // 🔴 Classic is the DEFAULT since #409, so it is measured first and is the
    // reading the other three are compared against. Four = {classic, harvest} ×
    // {light, dark}, which is what use-theme stamps on <html>.
    const FAMILIES = ['classic', 'harvest'] as const;
    const THEMES = ['light', 'dark'] as const;
    expect(DEFAULT_PALETTE_FAMILY).toBe('classic');

    const seen: Record<string, { surface: string; text: string; border: string }> = {};
    for (const palette of FAMILIES) {
      for (const theme of THEMES) {
        seen[`${palette}/${theme}`] = await browser.evaluateAt(380, `(() => {
          document.documentElement.setAttribute('data-palette', ${JSON.stringify(palette)});
          document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});
          const input = document.querySelector('[data-option-input="0"]');
          const cs = getComputedStyle(input);
          // The option input itself carries no background — it sits ON the
          // card, whose bg-surface-raised is the surface token in play — so the
          // surface reading comes from the card and the text/border from the
          // control. Reading a background off an element that has none by design
          // would fail on transparent and prove nothing about the palette.
          const card = getComputedStyle(input.closest('.rounded-2xl'));
          return { surface: card.backgroundColor, text: cs.color, border: cs.borderTopColor };
        })()`);
      }
    }
    // Every palette resolves to a REAL colour — a token that did not resolve
    // leaves the browser at transparent or the initial black-on-transparent.
    for (const [key, c] of Object.entries(seen)) {
      for (const [prop, value] of Object.entries(c)) {
        expect(value, `${key} left ${prop} unresolved`).toMatch(/^rgba?\(/);
        expect(value, `${key} resolved ${prop} to transparent`).not.toBe('rgba(0, 0, 0, 0)');
      }
    }
    // And light and dark are genuinely different in each family, so "resolves"
    // is not four readings of the same fallback.
    for (const palette of FAMILIES) {
      expect(seen[`${palette}/light`].text, `${palette} renders the same text colour in both themes`)
        .not.toBe(seen[`${palette}/dark`].text);
    }
  });

  it('uses lucide icons and no emoji in the option editor', () => {
    const start = ADMIN_FORMS.indexOf('{fieldHasOptions(f.type) && (');
    expect(start).toBeGreaterThan(-1);
    const block = ADMIN_FORMS.slice(start, ADMIN_FORMS.indexOf('<label className="flex items-center gap-2 text-xs text-muted">', start));
    // 🔴 The block's own comments carry the repo's 🔴/⚠️ annotation marks, which
    // are prose about the change and not UI. Only the RENDERED half is checked.
    const rendered = block.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rendered).toMatch(/<ChevronUp|<ChevronDown|<Trash2|<Plus/);
    expect(rendered, 'an emoji reached the option editor')
      .not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u);
  });
});
