import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { contrastRatio, AA_CONTRAST } from '../lib/theme';

/**
 * Theming stage 4 — the hue scales.
 *
 * Stage 3 themed the neutral ramp. The hues were still fixed hexes, so 771 uses
 * of red/green/amber/blue/yellow/purple/pink/sky/field/wheat did not theme: a
 * bg-red-50 banner stayed a bright block on the dark ground and text-red-600 on
 * it fell to 3.1:1.
 *
 * As in stage 3, every ratio here is COMPUTED. Hardcoding a passing number would
 * survive any palette change, which is the failure mode these exist to prevent.
 */

const ROOT = path.resolve(__dirname, '../..');
const GLOBALS = path.join(ROOT, 'src/app/globals.css');

const DARK_SURFACES = { '--surface': '#1A1612', '--surface-raised': '#221D18' };

/** The exact values these scales had BEFORE stage 4. The light theme must not move. */
const SOURCE: Record<string, Record<string, string>> = {
  red: { 50: '#FEF2F2', 100: '#FEE2E2', 200: '#FECACA', 300: '#FCA5A5', 400: '#F87171', 500: '#EF4444', 600: '#DC2626', 700: '#B91C1C', 800: '#991B1B' },
  green: { 50: '#F0FDF4', 100: '#DCFCE7', 400: '#4ADE80', 500: '#22C55E', 600: '#16A34A', 700: '#15803D', 800: '#166534' },
  amber: { 50: '#FFFBEB', 100: '#FEF3C7', 200: '#FDE68A', 500: '#F59E0B', 600: '#D97706', 700: '#B45309', 800: '#92400E' },
  blue: { 50: '#EFF6FF', 100: '#DBEAFE', 500: '#3B82F6', 600: '#2563EB', 700: '#1D4ED8' },
  yellow: { 50: '#FEFCE8', 100: '#FEF9C3', 500: '#EAB308', 600: '#CA8A04', 700: '#A16207', 800: '#854D0E' },
  purple: { 50: '#FAF5FF', 100: '#F3E8FF', 500: '#A855F7', 700: '#7E22CE' },
  pink: { 500: '#EC4899' },
  sky: { 100: '#E4F0FA', 500: '#4F97D6', 600: '#3A78B5', 700: '#2C5C8C' },
  field: { 100: '#EAF0E2', 200: '#C9D8B3', 500: '#6E8E52', 600: '#55703F', 700: '#40562F' },
  wheat: { 50: '#FBF4E6', 100: '#F5EDE0', 200: '#EAD5A8', 500: '#C9963A', 600: '#B5862F', 700: '#8F6822' },
};

function varsIn(css: string, match: (sel: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(css).walkRules((rule) => {
    if (!match(rule.selector)) return;
    rule.walkDecls((d) => {
      if (d.prop.startsWith('--')) out[d.prop] = d.value.trim();
    });
  });
  return out;
}

/** "254 242 242" -> "#FEF2F2". These are channel triplets, not hex, so that
 *  `rgb(var(--x) / <alpha-value>)` keeps the /NN opacity modifier working. */
function triToHex(v: string): string {
  const p = v.split(/\s+/).map(Number);
  expect(p, `"${v}" is not an R G B triplet`).toHaveLength(3);
  return '#' + p.map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();
}

let light: Record<string, string>;
let dark: Record<string, string>;

beforeAll(() => {
  const css = readFileSync(GLOBALS, 'utf8');
  light = varsIn(css, (s) => s === ':root');
  dark = varsIn(css, (s) => /\.dark|\[data-theme="dark"\]/.test(s));
});

const scaleTokens = () =>
  Object.entries(SOURCE).flatMap(([fam, shades]) =>
    Object.keys(shades).flatMap((sh) => {
      const t: string[] = [];
      if (Number(sh) <= 200) t.push(`--c-${fam}-${sh}`);
      else t.push(`--ink-${fam}-${sh}`);
      return t;
    }),
  );

describe('the light theme is unchanged by stage 4', () => {
  it.each(scaleTokens())('%s still resolves to its pre-stage-4 value', (token) => {
    const m = token.match(/^--(?:c|ink)-([a-z]+)-(\d+)$/)!;
    expect(light[token], `${token} is not declared in :root`).toBeDefined();
    expect(triToHex(light[token])).toBe(SOURCE[m[1]][m[2]].toUpperCase());
  });

  // wheat/sky/field already had hex vars that other CSS reads directly
  // (--surface-gold: var(--wheat-100)). Those were deliberately NOT repurposed,
  // so the two spellings must agree or the same colour drifts apart.
  it.each(['wheat-50', 'wheat-100', 'wheat-200', 'sky-100', 'field-100', 'field-200'])(
    '--c-%s agrees with the legacy hex var in light',
    (key) => {
      const legacy = light[`--${key}`];
      if (!legacy) return; // no legacy twin for this shade
      expect(triToHex(light[`--c-${key}`])).toBe(legacy.toUpperCase());
    },
  );
});

describe('every stage-4 token is paired across both themes', () => {
  it('no --c-*/--ink-* exists in one theme without the other', () => {
    const keys = (o: Record<string, string>) =>
      Object.keys(o).filter((k) => k.startsWith('--c-') || k.startsWith('--ink-'));
    expect(keys(light).filter((k) => !(k in dark)), 'light-only token stays light on dark').toEqual([]);
    expect(keys(dark).filter((k) => !(k in light)), 'dark-only token has no light fallback').toEqual([]);
  });

  it('solid fills at 300+ are deliberately NOT themed', () => {
    // bg-red-600 is a solid danger button. If it inverted with the ink it would
    // stop reading as a button, which is why only tints get a --c-* token.
    const themedFills = Object.keys(light).filter((k) => {
      const m = k.match(/^--c-[a-z]+-(\d+)$/);
      return m && Number(m[1]) > 200;
    });
    expect(themedFills, 'a solid fill must keep its value in both themes').toEqual([]);
  });
});

describe('dark hue values clear WCAG AA where they carry text', () => {
  const inkTokens = () =>
    Object.keys(SOURCE).flatMap((fam) =>
      Object.keys(SOURCE[fam])
        .filter((sh) => Number(sh) > 200)
        .map((sh) => [fam, sh] as const),
    );

  it.each(inkTokens())('dark ink %s-%s clears AA on both dark surfaces', (fam, sh) => {
    const ink = triToHex(dark[`--ink-${fam}-${sh}`]);
    for (const [name, surface] of Object.entries(DARK_SURFACES)) {
      const r = contrastRatio(ink, surface);
      expect(r, `--ink-${fam}-${sh} on ${name} is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_CONTRAST);
    }
  });

  it.each(inkTokens())('dark ink %s-%s clears AA on every tint of its own family', (fam, sh) => {
    const ink = triToHex(dark[`--ink-${fam}-${sh}`]);
    for (const tintShade of Object.keys(SOURCE[fam]).filter((s) => Number(s) <= 200)) {
      const tint = triToHex(dark[`--c-${fam}-${tintShade}`]);
      const r = contrastRatio(ink, tint);
      expect(
        r,
        `--ink-${fam}-${sh} on --c-${fam}-${tintShade} is ${r.toFixed(2)}:1 — a banner nobody can read`,
      ).toBeGreaterThanOrEqual(AA_CONTRAST);
    }
  });

  it('every dark tint stays distinguishable from the raised surface', () => {
    // A tint that matches the card it sits on is not a tint, it is nothing.
    const tooFlat: string[] = [];
    for (const [k, v] of Object.entries(dark)) {
      if (!k.startsWith('--c-')) continue;
      const r = contrastRatio(triToHex(v), DARK_SURFACES['--surface-raised']);
      if (r < 1.05) tooFlat.push(`${k} is ${r.toFixed(3)}:1`);
    }
    expect(tooFlat, 'tint is invisible against its own surface').toEqual([]);
  });
});

describe('no hue tint escapes the token system', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) {
        if (e !== '__tests__' && e !== 'node_modules') walk(p, out);
      } else if (/\.tsx?$/.test(e)) out.push(p);
    }
    return out;
  }

  // A tint shade used on a family with no --c-* token is the stone-50 bug all
  // over again: fine in light, a bright block in dark, and no failing test.
  it('every 50/100/200 hue utility in src has a themed token behind it', () => {
    const fams = Object.keys(SOURCE).join('|');
    const re = new RegExp(
      `\\b(?:bg|border|ring|divide|from|via|to)-(${fams})-(50|100|200)\\b`,
      'g',
    );
    const offenders: string[] = [];
    for (const f of walk(path.join(ROOT, 'src'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(re)) {
        if (!(`--c-${m[1]}-${m[2]}` in light)) {
          offenders.push(`${path.relative(ROOT, f)}: ${m[0]}`);
        }
      }
    }
    expect(offenders, 'this tint has no dark value and will glare').toEqual([]);
  });
});
