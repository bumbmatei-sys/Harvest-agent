// @vitest-environment node
//
// 🔴 THE `node` PRAGMA IS LOAD-BEARING. `happy-dom` has NO LAYOUT ENGINE —
// `getBoundingClientRect()` answers zeroes and `getComputedStyle().display`
// answers `block` for a flex container — and with happy-dom selected
// `MeasuringBrowser` never attaches and the suite times out. Every number below
// is measured inside a real Chromium over CDP.
//
// ONE `MeasuringBrowser` PER PROCESS: two instances in one process collide on
// the debugger port.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildCssForMarkup } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import { setUpOrFail } from '../../test/support/suite-setup';

/**
 * THE-359 · 🔴 THE "Partner with Us" ROW IS THE SAME SHAPE AND THE SAME HEIGHT
 * AS EVERY OTHER ROW ON THE PROFILE — MEASURED.
 *
 * THE FOUNDER, on the first attempt at this control: "The partner with us button
 * should look just as all other buttons with an icon. Not that huge fat ugly
 * button you created."
 *
 * ⚠️ THAT FIRST ATTEMPT WAS A FULL-BLEED `Button`, AND ITS HEIGHT WAS THE PART
 * THAT NEEDED JUSTIFYING. `ui/button.tsx`'s intrinsic sizes are 24 / 28 / 32 /
 * 36px — `xs` h-6, `sm` h-7, `default` h-8, `lg` h-9 — and every one is below
 * both floors (#500), so it carried an explicit `min-h-[44px] sm:h-[40px]` of
 * its own. The row that replaced it needs none: `SettingItem` already carries
 * the floor, and this suite measures that the inherited one is real rather than
 * assumed.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 IT IS MEASURED AGAINST A SIBLING, NOT AGAINST A NUMBER.
 *
 * The claim the founder made is a COMPARATIVE one — "just as all other buttons
 * with an icon" — so the assertion is comparative too: the Partner row and the
 * Donation History row directly below it are rendered from the SAME component
 * with the same props shape, and are required to agree on height, on the icon
 * disc's box and on the chevron's position at every width. A guard that only
 * checked "≥ 44px" would pass a row that was 44px and visibly unlike its
 * neighbours.
 *
 * 🔴 THE CLASS STRINGS ARE DISCOVERED FROM THE SHIPPED SOURCE, NOT RETYPED.
 * THE-346 found this by mutation: a replica whose classes are hand-written here
 * measures a fiction the moment the component drifts. `discover()` pulls the
 * exact strings out of `Profile.tsx` and THROWS if the surface moved.
 *
 * 🔴 AND TRANSITIONS ARE SUPPRESSED BEFORE MEASURING. `Item` carries
 * `transition-colors` and `Button` `transition-all`, which includes
 * `min-height`; `settle()` waits two animation frames (~32ms), well inside a
 * 150ms transition, so an un-suppressed page reports a DRIFTING mid-flight
 * value. #490 measured `min-h-[44px]` at 7.7469px and a menu row at
 * 41.79998779296875px — exactly 44 × 0.95 — for this reason.
 *
 * 🔴 NOTHING IS PINNED TO A LINE NUMBER.
 */

/** The founder's phone, the `sm` boundary either side, and two desktops. */
const VIEWPORTS = [380, 639, 640, 768, 1280] as const;

/** #500's floor below `sm`, and Rule 4's control floor above it. */
const TOUCH_FLOOR_PX = 44;
const RULE_4_MIN_PX = 38;

const ROOT = process.cwd();
const PROFILE = 'src/components/Profile.tsx';
const BUTTON = 'src/components/ui/button.tsx';
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Pull one capture out of a file, or throw naming the file and the pattern.
 * A DISCOVERY THAT FINDS NOTHING MUST THROW, never fall back: a default turns
 * "the surface moved" into "the surface is fine".
 */
function discover(rel: string, re: RegExp, what: string): string {
  const m = read(rel).match(re);
  if (!m) throw new Error(`${what}: no match for ${re} in ${rel} — the surface moved`);
  return m[1];
}

/**
 * 🔴 THE PRIMITIVE'S OWN BASE CLASSES, DISCOVERED FROM `ui/item.tsx`, AND A
 * MEASUREMENT CAUGHT THEIR ABSENCE.
 *
 * The first version of this replica used only the classes `SettingItem` passes
 * — `p-3.5 gap-3 min-h-[44px]` and so on — and hand-wrote the inner divs. A
 * `<button>` is inline-block, so with no `flex` from `Item`'s own base the three
 * children STACKED and every row measured 91.5px instead of ~46px. It passed:
 * both rows were wrong by the same amount, so the comparative assertion was
 * comparing two fictions. A replica that omits the primitive is not a replica.
 *
 * So each slot's base class is pulled out of the primitive too, and the
 * assertions below re-check every one of them against the file.
 */
const ITEM = 'src/components/ui/item.tsx';
const itemBase = discover(
  ITEM,
  /const itemVariants = cva\(\s*\n\s*"([^"]+)"/,
  "Item's base class",
);
const itemDefaultVariant = discover(ITEM, /\n\s+default: "(border-transparent)",/, "Item's default variant");
const itemMediaBase = discover(
  ITEM,
  /const itemMediaVariants = cva\(\s*\n\s*"([^"]+)"/,
  "ItemMedia's base class",
);
const itemContentBase = discover(
  ITEM,
  /data-slot="item-content"[\s\S]{0,120}?cn\(\s*\n\s*"([^"]+)"/,
  "ItemContent's base class",
);
const itemTitleBase = discover(
  ITEM,
  /data-slot="item-title"[\s\S]{0,120}?cn\(\s*\n\s*"([^"]+)"/,
  "ItemTitle's base class",
);
const itemActionsBase = discover(
  ITEM,
  /data-slot="item-actions"[\s\S]{0,120}?cn\("([^"]+)"/,
  "ItemActions' base class",
);

/** The shared row component every navigation row on this page is built from. */
const rowClass = discover(
  PROFILE,
  /render=\{<button type="button" onClick=\{onClick\} \/>\}\s*\n\s*className="([^"]+)"/,
  "SettingItem's row",
);
const mediaClass = discover(
  PROFILE,
  /<ItemMedia className=\{`([^`]*)\$\{iconBg\}`\}>/,
  "SettingItem's icon disc",
);
const titleClass = discover(
  PROFILE,
  /<ItemTitle className="([^"]+)">\{label\}<\/ItemTitle>/,
  "SettingItem's label",
);
/**
 * 🔴 EACH CARD IS DISCOVERED AT ITS OWN SITE, AND A MUTATION IS WHY.
 *
 * The first version took ONE `py-0` card class by pattern and used it for both
 * rows. A planted change that put the Partner row back in the padded `py-4`
 * card — 32px taller than its neighbour, which is exactly the "it doesn't look
 * like the others" symptom — did not move a single measured number, because the
 * replica was still rendering the pattern rather than the site. Each card is now
 * pulled from the source ANCHORED ON THE ROW IT CONTAINS, so the two cannot
 * drift apart without this suite seeing it.
 */
const partnerCardClass = discover(
  PROFILE,
  /<Card className="([^"]+)">\s*\n\s*<SettingItem\s*\n\s*icon=\{<HeartHandshake/,
  "the Partner row's card",
);
const historyCardClass = discover(
  PROFILE,
  /<Card className="([^"]+)">[\s\S]{0,400}?label="Donation History"/,
  "Donation History's card",
);

let browser: MeasuringBrowser | undefined;

interface Box { w: number; h: number; x: number; y: number; right: number }
interface Reading {
  viewport: number;
  scrollWidth: number;
  cards: Record<string, Box | null>;
  rows: Record<string, Box | null>;
  media: Record<string, Box | null>;
  chevron: Record<string, Box | null>;
  minHeight: string;
}
const readings = new Map<number, Reading>();

/**
 * One row, spelled exactly as `SettingItem` spells it: the primitive's own base
 * class on every slot, then the class `SettingItem` passes, in that order —
 * which is the order `cn()` merges them in.
 */
const row = (key: string, label: string) =>
  `<button data-row="${key}" type="button" data-slot="item"
     class="${itemBase} ${itemDefaultVariant} ${rowClass}">
     <div data-slot="item-media" class="${itemMediaBase} ${mediaClass} bg-wheat-100">
       <svg width="16" height="16" viewBox="0 0 16 16"></svg>
     </div>
     <div data-slot="item-content" class="${itemContentBase} flex-1 text-left">
       <div data-slot="item-title" class="${itemTitleBase} ${titleClass}">${label}</div>
     </div>
     <div data-slot="item-actions" class="${itemActionsBase} gap-2">
       <svg data-chevron="${key}" width="16" height="16" viewBox="0 0 16 16"></svg>
     </div>
   </button>`;

/**
 * The replica: the PARTNERSHIP section as `Profile` composes it in the state
 * this ticket changed — heading, the Partner row in its own card, then the
 * Donation History card. Both rows come from the same discovered classes, which
 * is what makes the comparison below meaningful rather than circular: if the
 * shipped Partner row ever stops being a `SettingItem`, `discover()` still
 * returns SettingItem's classes and the SOURCE assertion below fails instead.
 */
const page = () =>
  `<div class="min-h-screen bg-surface-sunken">
     <div class="p-4 space-y-6 max-w-lg mx-auto">
       <div>
         <h4 class="text-[10px] font-bold text-faint tracking-wider uppercase mb-3 ml-2">Partnership</h4>
         <div data-card="partner" class="${partnerCardClass} flex flex-col">${row('partner', 'Partner with Us')}</div>
         <div data-card="history" class="${historyCardClass} flex flex-col">${row('history', 'Donation History')}</div>
       </div>
     </div>
   </div>`;

setUpOrFail(async () => {
  const markup = page();
  const css = await buildCssForMarkup(markup);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'the359-'));
  const file = path.join(dir, 'partnership.html');
  writeFileSync(
    file,
    '<!doctype html><html data-theme="light"><head><meta charset="utf-8">'
      + `<style>${css}</style>`
      // 🔴 SUPPRESS ANIMATION BEFORE MEASURING. See the header.
      + '<style>*,*::before,*::after{transition:none !important;animation:none !important}</style>'
      + `</head><body>${markup}</body></html>`,
  );

  browser = new MeasuringBrowser();
  await browser.open(`file://${file}`);

  for (const viewport of VIEWPORTS) {
    const r = await browser.evaluateAt<Reading>(
      viewport,
      `(() => {
        const round = (n) => Math.round(n * 100) / 100;
        const box = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { w: round(b.width), h: round(b.height), x: round(b.x), y: round(b.y), right: round(b.right) };
        };
        const partner = document.querySelector('[data-row="partner"]');
        return {
          viewport: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          cards: { partner: box('[data-card="partner"]'), history: box('[data-card="history"]') },
          rows: { partner: box('[data-row="partner"]'), history: box('[data-row="history"]') },
          media: {
            partner: box('[data-row="partner"] [data-slot="item-media"]'),
            history: box('[data-row="history"] [data-slot="item-media"]'),
          },
          chevron: {
            partner: box('[data-chevron="partner"]'),
            history: box('[data-chevron="history"]'),
          },
          minHeight: partner ? getComputedStyle(partner).minHeight : '',
        };
      })()`,
      900,
    );
    readings.set(viewport, r);
  }
}, 300_000);

afterAll(async () => { await browser?.close(); });

const at = (v: number): Reading => {
  const r = readings.get(v);
  if (!r) throw new Error(`no reading at ${v}`);
  return r;
};
const boxOf = (v: number, group: 'rows' | 'media' | 'chevron' | 'cards', key: string): Box => {
  const b = at(v)[group][key];
  if (!b) throw new Error(`${group}.${key} was not measured at ${v} — it did not render`);
  return b;
};

/* ═══ 0 · the precondition ════════════════════════════════════════════════ */

describe('the measured surface is the shipped one', () => {
  it('🔴 the Partner row really is a SettingItem in the shipped source', () => {
    /**
     * THE LOAD-BEARING ASSERTION OF THIS WHOLE SUITE. The replica is built from
     * `SettingItem`'s classes, so it would measure a perfect row even if
     * `Profile` had gone back to a full-bleed Button. This is what ties the
     * measurement to the shipped component.
     */
    const src = read(PROFILE);
    expect(src, '🔴 the Partner control is no longer a SettingItem row')
      .toMatch(/<SettingItem\s+icon=\{<HeartHandshake[^>]*\/>\}\s*\n\s*iconBg="bg-wheat-100"\s*\n\s*label="Partner with Us"\s*\n\s*onClick=\{onGoToPartner\}\s*\n\s*\/>/);
    // And it is NOT the slab it replaced.
    expect(src, '🔴 the full-bleed Button came back')
      .not.toMatch(/<Button[^>]*>\s*\n\s*Partner with Us/);
  });

  it('🔴 every discovered class string is still in Profile.tsx, byte for byte', () => {
    for (const [cls, what] of [
      [rowClass, "SettingItem's row"],
      [mediaClass, "SettingItem's icon disc"],
      [titleClass, "SettingItem's label"],
      [partnerCardClass, "the Partner row's card"],
      [historyCardClass, "Donation History's card"],
    ] as const) {
      expect(read(PROFILE), `${what} drifted away from the measured copy`).toContain(cls);
    }
    // And the primitive's own halves, which the first version of this replica
    // left out entirely — see the note above `itemBase`.
    for (const [cls, what] of [
      [itemBase, "Item's base"],
      [itemMediaBase, "ItemMedia's base"],
      [itemContentBase, "ItemContent's base"],
      [itemTitleBase, "ItemTitle's base"],
      [itemActionsBase, "ItemActions' base"],
    ] as const) {
      expect(read(ITEM), `${what} drifted away from the measured copy`).toContain(cls);
    }
    // 🔴 THE ROW LAYS OUT AS A ROW. If `Item`'s `flex` ever stops reaching the
    // replica the children stack and every height below becomes a fiction.
    for (const v of VIEWPORTS) {
      const r = boxOf(v, 'rows', 'partner');
      const m = boxOf(v, 'media', 'partner');
      expect(m.h, `the icon disc is ${m.h}px at ${v}px — the row is not laying out as a row`)
        .toBeLessThan(r.h);
      expect(r.h, `the row is ${r.h}px at ${v}px — its children have stacked`).toBeLessThan(64);
    }
    expect(readings.size).toBe(VIEWPORTS.length);
    for (const v of VIEWPORTS) expect(boxOf(v, 'rows', 'partner').h, `no height at ${v}`).toBeGreaterThan(0);
  });

  it('🔴 nothing here was measured at a line number', () => {
    const self = read('src/components/__tests__/THE-359.partnership-button.layout.test.tsx');
    expect(self, 'a source coordinate was pinned').not.toMatch(/\.tsx?:\d+/);
  });

  it("🔴 Button's OWN sizes are all below the floor — the row inherits one instead", () => {
    /**
     * Kept from the first attempt, because it is the reason a bare `Button` was
     * never the right answer here and would need an override again if anybody
     * reached for one.
     */
    const sizes = read(BUTTON).match(/\n\s{8}(?:default|xs|sm|lg):\s*\n?\s*"h-(\d+)/g) ?? [];
    expect(sizes.length, "Button's size variants could not be read").toBeGreaterThanOrEqual(4);
    for (const s of sizes) {
      const rem = Number(/h-(\d+)/.exec(s)![1]);
      expect(rem * 4, `Button's ${s.trim()} now clears the floor on its own`)
        .toBeLessThan(TOUCH_FLOOR_PX);
    }
  });
});

/* ═══ 16f · the row clears the touch floor below `sm` ═════════════════════ */

describe('16f · the "Partner with Us" row clears the touch floor below `sm`', () => {
  for (const v of [380, 639] as const) {
    it(`🔴 ${v}px — at least ${TOUCH_FLOOR_PX}px tall`, () => {
      const b = boxOf(v, 'rows', 'partner');
      expect(b.h, `🔴 THE ROW IS ${b.h}px AT ${v}px — under the ${TOUCH_FLOOR_PX}px floor`)
        .toBeGreaterThanOrEqual(TOUCH_FLOOR_PX);
      // ⚠️ A MINIMUM, NOT A FIXED HEIGHT — a wrapped label still grows.
      expect(at(v).minHeight, 'the height is fixed rather than a floor').toBe('44px');
    });
  }

  it('🔴 above `sm` the padding carries it, and it stays a row rather than a slab', () => {
    /**
     * `sm:min-h-0` releases the phone floor, so above `sm` the height is
     * whatever `p-3.5` around a 28px disc computes to. Rule 4's 38px is a floor
     * for CONTROLS; this is a navigation row, and the number that matters is
     * that it agrees with its neighbours (asserted below) and does not balloon.
     */
    for (const v of [640, 768, 1280] as const) {
      const b = boxOf(v, 'rows', 'partner');
      expect(b.h, `the row is ${b.h}px at ${v}px`).toBeGreaterThanOrEqual(RULE_4_MIN_PX);
      expect(b.h, `the row is ${b.h}px at ${v}px — that is a slab, not a row`).toBeLessThan(64);
    }
  });

  it('🔴 and it is full width, so the whole row is the target', () => {
    for (const v of VIEWPORTS) {
      expect(boxOf(v, 'rows', 'partner').w, `only ${boxOf(v, 'rows', 'partner').w}px wide at ${v}px`)
        .toBeGreaterThan(200);
    }
  });
});

/* ═══ 🔴 the founder's actual claim: it looks like the others ═════════════ */

describe('it measures identically to the row directly below it', () => {
  for (const v of VIEWPORTS) {
    it(`🔴 ${v}px — same height, same disc, same chevron position as Donation History`, () => {
      const partner = boxOf(v, 'rows', 'partner');
      const history = boxOf(v, 'rows', 'history');

      expect(partner.h,
        `🔴 THE PARTNER ROW IS ${partner.h}px AND DONATION HISTORY IS ${history.h}px AT ${v}px `
        + '— it does not look like the other rows')
        .toBe(history.h);
      expect(partner.w, 'the two rows are not the same width').toBe(history.w);

      /**
       * 🔴 AND THE CARDS THEMSELVES. A row can be the right height inside a card
       * that is 32px taller than its neighbour, which is precisely what putting
       * it back in the padded `py-4` card would do — the two cards would not
       * line up and the section would read as one loud block above one quiet
       * row. Caught by mutation; asserted here.
       */
      const pCard = boxOf(v, 'cards', 'partner');
      const hCard = boxOf(v, 'cards', 'history');
      expect(pCard.h,
        `🔴 THE PARTNER CARD IS ${pCard.h}px AND DONATION HISTORY'S IS ${hCard.h}px AT ${v}px `
        + '— the two cards do not line up')
        .toBe(hCard.h);
      // The row fills its card, rather than floating in padding.
      expect(pCard.h - partner.h, 'the Partner row is padded away from its card edges')
        .toBeCloseTo(hCard.h - history.h, 1);

      // The icon disc: same size, same left edge.
      const pm = boxOf(v, 'media', 'partner');
      const hm = boxOf(v, 'media', 'history');
      expect(pm.h, 'the icon discs differ in height').toBe(hm.h);
      expect(pm.w, 'the icon discs differ in width').toBe(hm.w);
      expect(pm.x - partner.x, 'the icon discs sit at different insets')
        .toBeCloseTo(hm.x - history.x, 1);

      // The chevron: same distance from the right edge.
      const pc = boxOf(v, 'chevron', 'partner');
      const hc = boxOf(v, 'chevron', 'history');
      expect(partner.right - pc.right, 'the chevrons sit at different insets')
        .toBeCloseTo(history.right - hc.right, 1);
    });
  }

  it('🔴 no horizontal overflow at any width, phone included', () => {
    for (const v of VIEWPORTS) {
      expect(at(v).scrollWidth, `the page scrolls sideways at ${v}px`).toBeLessThanOrEqual(v);
    }
  });
});
