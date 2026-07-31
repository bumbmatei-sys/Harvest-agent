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
