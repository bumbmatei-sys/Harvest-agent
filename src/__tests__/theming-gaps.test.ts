import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Dark-mode gap guards.
 *
 * The class sweep in #257 could not see two other families of colour source:
 * component-local hex constants, and inline styles. Both render light on a dark
 * ground with no failing test and no error -- which is exactly why they need
 * guards rather than a one-time fix.
 */

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e !== '__tests__' && e !== 'node_modules') walk(p, out);
    } else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}
const FILES = walk(SRC);

/** Ramp values a component must not re-declare as a literal hex. */
const RAMP_HEXES: Record<string, string> = {
  '#FAF8F5': '--surface',
  '#FFFFFF': '--surface-raised',
  '#F3EEE7': '--surface-sunken',
  '#2D2519': '--text-strong',
  '#8B7355': '--text-muted',
  '#E8E2D9': '--border-default',
};

describe('no component re-declares a ramp colour as a local hex constant', () => {
  // This is the exact shape that left Ask Harvest, the course editor and AI
  // Knowledge fully light: `const CARD = "#FFFFFF"` never themes, and when the
  // surrounding surface DOES theme the result is dark-on-dark, i.e. unreadable.
  it('finds no `const NAME = "<ramp hex>"` in any component', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/^const\s+([A-Z_0-9]+)\s*=\s*"(#[0-9A-Fa-f]{6})";/gm)) {
        const hex = m[2].toUpperCase();
        if (hex in RAMP_HEXES) {
          offenders.push(`${path.relative(ROOT, f)}: ${m[1]} = ${m[2]} (use var(${RAMP_HEXES[hex]}))`);
        }
      }
    }
    expect(offenders, 'a ramp colour is hardcoded and will not theme').toEqual([]);
  });
});

describe('AIChat drives its --chat-* family off the ramp', () => {
  // AIChat injects an UNLAYERED :root, which outranks globals.css's @layer base.
  // A --chat-* override in the .dark block there would be silently ignored, so
  // the values themselves must reference the ramp.
  const src = readFileSync(path.join(SRC, 'components/AIChat.tsx'), 'utf8');

  it.each([
    ['--chat-bg', '--surface'],
    ['--chat-card', '--surface-raised'],
    ['--chat-text', '--text-strong'],
    ['--chat-text2', '--text-muted'],
    ['--chat-border', '--border-default'],
  ])('%s resolves to var(%s)', (chatVar, rampVar) => {
    const m = src.match(new RegExp(`${chatVar}:\\s*([^;]+);`));
    expect(m, `${chatVar} is not declared`).not.toBeNull();
    expect(m![1]).toContain(`var(${rampVar})`);
  });

  it('declares no bare hex in the --chat-* block', () => {
    const block = src.slice(src.indexOf('--chat-bg'), src.indexOf('--chat-gold-btn'));
    expect(block).not.toMatch(/:\s*#[0-9A-Fa-f]{6}/);
  });
});

describe('no semantic token anywhere in src carries an opacity modifier', () => {
  // Extends #257's guard from the one converted file to all of src/.
  // Variable-backed colours emit NOTHING with `/NN` -- a wrong swap deletes a
  // background silently, with no error and no failing test.
  it('finds no bg-surface*/border-line*/text-* with a /NN suffix', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(
        /\b(bg-surface(?:-raised|-sunken)?|border-line(?:-subtle|-strong)?|text-(?:strong|body|muted|faint))\/\d+/g,
      )) {
        offenders.push(`${path.relative(ROOT, f)}: ${m[0]}`);
      }
    }
    expect(offenders, 'variable-backed colours cannot take an opacity modifier').toEqual([]);
  });
});

describe('the map basemap follows a theme change, not only initial load', () => {
  const map = readFileSync(path.join(SRC, 'components/ChurchMap.tsx'), 'utf8');
  const hook = readFileSync(path.join(SRC, 'lib/use-resolved-theme.ts'), 'utf8');

  it('swaps CARTO light_all / dark_all off the resolved theme', () => {
    expect(map).toContain('useResolvedTheme');
    expect(map).toContain('dark_all');
    expect(map).toContain('light_all');
  });

  it('remounts the TileLayer so a toggle re-issues tiles', () => {
    // react-leaflet builds the underlying L.TileLayer once on mount and does
    // not re-request tiles when `url` changes, so without a theme-bound key the
    // map stays light until a full reload -- i.e. it would pass a
    // "works on load" check and still be broken on toggle.
    expect(map).toMatch(/key=\{mapTheme\}/);
  });

  it('the hook observes the attribute rather than reading storage once', () => {
    // The toggle stamps <html> directly, outside React, so only a
    // MutationObserver hears about it.
    expect(hook).toContain('MutationObserver');
    expect(hook).toContain("attributeFilter: ['data-theme', 'class']");
  });
});

describe('no near-black or default-palette colour is hardcoded where it must theme', () => {
  // A near-black arbitrary text colour is the worst class of theming bug: it is
  // not merely inconsistent, it is UNREADABLE on a dark ground. layout.tsx's
  // <body> carried one as the app-wide default, so it affected every screen
  // that did not override it.
  // #0b1121 is brand navy used as a heading on the public blog/course pages.
  // Converting it would change the LIGHT theme (navy -> earth) on 3 headings,
  // which is a design decision, so it is excluded and reported instead.
  it('finds no near-black text-[#…] arbitrary value', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      for (const m of readFileSync(f, 'utf8').matchAll(/text-\[#(?!0b1121)(?:0[0-9a-f]|1[0-9a-f]|2[0-9a-f])[0-9a-f]{4}\]/gi)) {
        offenders.push(`${path.relative(ROOT, f)}: ${m[0]}`);
      }
    }
    expect(offenders, 'near-black hardcoded text is unreadable in dark mode').toEqual([]);
  });

  // The near-black guard below only catches #00xxxx-#2fxxxx, so a MID-TONE or
  // LIGHT brand colour written as a bare hex slipped straight past it — which is
  // how text-[#C4553B] (brand danger) and bg-[#F7E7E2] (its tint) reached 44
  // uses that never themed. Anything with a token behind it must spell the
  // token, at any lightness.
  it('finds no arbitrary hex that duplicates an existing token', () => {
    const TOKENISED: Record<string, string> = {
      '#C4553B': 'text-danger / bg-danger',
      '#F7E7E2': 'bg-danger-tint',
      '#A23C28': 'text-danger-strong',
      '#40562F': 'text-field-700',
      '#6E8E52': 'field-500',
      '#FAF8F5': 'bg-surface / text-cream',
      '#F3EEE7': 'bg-surface-sunken',
      '#E8E2D9': 'bg-surface-chip / border-line',
      '#D6CCBE': 'border-line-strong',
      '#2D2519': 'text-strong',
      '#8B7355': 'text-warm-brown',
    };
    const offenders: string[] = [];
    for (const f of FILES) {
      // Gradient stops (from-/via-/to-) are deliberately NOT checked. They are
      // scrims laid over photos and video chrome — ChurchDetailsModal darkens a
      // church photo with from-[#2D2519] so the caption over it stays legible —
      // and they have to stay dark in BOTH themes. Theming one would turn the
      // scrim cream in dark and the caption would vanish. Same reasoning that
      // exempts the bg-white/NN scrims.
      for (const m of readFileSync(f, 'utf8').matchAll(
        /\b(?:bg|text|border|ring|divide)-\[(#[0-9a-fA-F]{6})\]/g,
      )) {
        const hex = m[1].toUpperCase();
        if (hex in TOKENISED) {
          offenders.push(`${path.relative(ROOT, f)}: ${m[0]} — use ${TOKENISED[hex]}`);
        }
      }
    }
    expect(offenders, 'a tokenised colour is hardcoded and will not theme').toEqual([]);
  });

  // Tailwind's gray/slate/zinc/neutral scales are cool greys the Harvest brand
  // never defined. They stayed spellable because tailwind.config.ts extends
  // `colors` rather than replacing it, and 376 uses had accumulated: washed-out
  // headers and grey dividers in dark mode, off-palette in light, and 64 uses
  // below WCAG AA on white (text-gray-400 was 2.54:1).
  //
  // This guard, not a config change, is what stops them coming back. Setting
  // `extend.colors.gray = {}` does NOT work — extend deep-merges, so it is a
  // no-op and gray-500 still resolves to #6b7280. Actually removing them needs a
  // top-level `theme.colors`, which replaces the ENTIRE default palette and would
  // require re-listing every hue the app uses plus white/black/transparent/
  // current. A guard costs one test and cannot break the build.
  it('finds no Tailwind default-neutral utility (gray/slate/zinc/neutral)', () => {
    const offenders: string[] = [];
    const neutral =
      /\b(?:bg|text|border|ring|divide|from|via|to|placeholder|fill|stroke|outline|accent|caret|decoration|shadow)-(?:gray|slate|zinc|neutral)-\d{2,3}\b/g;
    for (const f of FILES) {
      for (const m of readFileSync(f, 'utf8').matchAll(neutral)) {
        offenders.push(`${path.relative(ROOT, f)}: ${m[0]}`);
      }
    }
    expect(offenders, 'cool greys are off-palette in light and do not theme in dark').toEqual([]);
  });

  // remove-dark.js stripped dark classes with
  //   /dark:[a-zA-Z0-9\-\[\]\#\/\%]+/g
  // whose character class excludes `:`. On a two-level variant such as
  // dark:hover:bg-white/5 it matched only `dark:hover` and left `:bg-white/5`
  // behind. A leading colon is an EMPTY variant name, so Tailwind emits no rule
  // — the dark styling was deleted silently rather than disabled, with no error
  // and no failing test. 29 of these survived across 11 files; CountrySelect's
  // dropdown was the visible one. The script is gone, but the shape is cheap to
  // assert and would otherwise come back the next time someone bulk-edits
  // classes with a regex.
  it('finds no empty-variant class fragment (a stripped `dark:` prefix)', () => {
    const offenders: string[] = [];
    const frag =
      /(?<=[\s"'`])(:(?:bg|text|border|ring|placeholder|divide|from|to|via|shadow|outline|fill|stroke|accent|caret|decoration)-[A-Za-z0-9][\w./[\]#%-]*)/g;
    for (const f of FILES) {
      for (const m of readFileSync(f, 'utf8').matchAll(frag)) {
        offenders.push(`${path.relative(ROOT, f)}: ${m[1]}`);
      }
    }
    expect(offenders, 'an empty variant emits no CSS — this styling is silently dead').toEqual([]);
  });

  // Tailwind's `stone` scale is EXTENDED, not replaced, so stone-50 and
  // stone-400 still resolve to Tailwind's cool defaults (#FAFAF9 / #A8A29E) --
  // off-palette in light and unthemed in dark. These were the visible ones.
  it('finds no bg-stone-50 / text-stone-400 (Tailwind default cool greys)', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\b(?:bg-stone-50|text-stone-400)\b(?!\d)/g)) {
        offenders.push(`${path.relative(ROOT, f)}: ${m[0]}`);
      }
    }
    expect(offenders, 'Tailwind default greys do not theme').toEqual([]);
  });
});
