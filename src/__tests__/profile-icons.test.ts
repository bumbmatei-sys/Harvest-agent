import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import tw from '../../tailwind.config';

/**
 * The Profile screen's icon tints.
 *
 * The rows were mostly blue (`sky`), which is not in Harvest's palette — the
 * brand is a gold accent over warm cream/wheat/earth, with field green as the
 * secondary. Two families now carry the whole screen:
 *
 *   • WHEAT / GOLD — you, your account, and your relationship with Harvest:
 *     Personal Information, Donation History, Contact Us, Privacy & Terms,
 *     Admin Dashboard.
 *   • FIELD GREEN — things you do, prefer or go and read: My Home Church,
 *     My Events, Saved, Push Notifications, Appearance, FAQ. (Roadmap was in
 *     this family too until THE-225 removed the row entirely.)
 *
 * RED IS RESERVED FOR DESTRUCTIVE ACTIONS. Log Out is the only red thing on
 * the screen, and the assertion below pins that rather than trusting review.
 *
 * The tests resolve each class against the ACTUAL light and dark variable
 * blocks in globals.css, following the pattern in ds-primitives.test.tsx: the
 * rendered DOM carries no `dark:` class and no JS branch on the theme, so the
 * proof that an icon themes is that the tokens it names resolve to different
 * values under the two blocks. A literal hex resolves to one value in both,
 * which is exactly the bug this pins.
 */

const ROOT = path.resolve(__dirname, '../..');
const PROFILE = path.join(ROOT, 'src/components/Profile.tsx');
const POLICY = path.join(ROOT, 'src/components/PrivacyTermsModal.tsx');
const GLOBALS = path.join(ROOT, 'src/app/globals.css');

const twExtend = (tw.theme?.extend ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
const colors = twExtend.colors ?? {};
const textColor = twExtend.textColor ?? {};

let lightVars: Record<string, string>;
let darkVars: Record<string, string>;

function varsIn(css: string, selectorTest: (sel: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(css).walkRules((rule) => {
    if (!selectorTest(rule.selector)) return;
    rule.walkDecls((decl) => {
      if (decl.prop.startsWith('--')) out[decl.prop] = decl.value.trim();
    });
  });
  return out;
}

beforeAll(() => {
  const css = readFileSync(GLOBALS, 'utf8');
  lightVars = varsIn(css, (s) => s === ':root');
  darkVars = varsIn(css, (s) => /\.dark|\[data-theme="dark"\]/.test(s));
});

/** A dark lookup that falls back to light, exactly as the cascade does. */
const inTheme = (theme: 'light' | 'dark') => (name: string): string | undefined =>
  theme === 'dark' ? darkVars[name] ?? lightVars[name] : lightVars[name];

/** Resolve a var() chain / channel triplet / hex to a comparable literal. */
function resolveValue(
  expr: string | undefined,
  lookup: (n: string) => string | undefined,
  depth = 0,
): string | null {
  if (!expr || depth > 12) return null;
  const v = expr.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v.toUpperCase();
  if (/^\d{1,3}\s+\d{1,3}\s+\d{1,3}$/.test(v)) return v;

  const varMatch = v.match(/^var\((--[a-z0-9-]+)\s*(?:,\s*([\s\S]+))?\)$/i);
  if (varMatch) {
    const direct = resolveValue(lookup(varMatch[1]), lookup, depth + 1);
    if (direct) return direct;
    return varMatch[2] ? resolveValue(varMatch[2], lookup, depth + 1) : null;
  }
  const rgbMatch = v.match(/^rgb\(\s*([\s\S]+?)\s*(?:\/[^)]*)?\)$/i);
  if (rgbMatch) return resolveValue(rgbMatch[1], lookup, depth + 1);
  return null;
}

/**
 * The Tailwind config entry a utility class reads, straight from the config so
 * the test cannot drift from what Tailwind will actually generate.
 *
 * ⚠️ `text-*` resolves against `textColor` FIRST. That distinction is the whole
 * game here: `colors.wheat[600]` is the literal #B5862F, while
 * `textColor.wheat[600]` is rgb(var(--ink-wheat-600)) and themes. A test that
 * looked only at `colors` would report a themed class as unthemed.
 */
function configValueFor(cls: string): string | undefined {
  const util = cls.match(/^(bg|text|border)-([a-z]+)-(\d{2,3})$/);
  if (!util) return undefined;
  const [, prefix, hue, shade] = util;
  const scale = prefix === 'text' ? (textColor[hue] ?? colors[hue]) : colors[hue];
  return scale?.[shade] as string | undefined;
}

/**
 * Every icon tint on the Profile screen and the policy screen it opens.
 *
 * Collected from the source rather than hand-listed: `iconBg="…"` and the
 * `className` on each lucide icon. A new row added without a token-backed
 * tint is therefore picked up automatically instead of quietly skipped.
 */
function iconClassesIn(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out = new Set<string>();
  // iconBg="bg-wheat-100" and the inline disc in the Appearance row.
  for (const m of src.matchAll(/iconBg="([^"]+)"/g)) m[1].split(/\s+/).forEach((c) => out.add(c));
  // className on any lucide icon: <Icon size={16} className="text-wheat-600" />
  for (const m of src.matchAll(/size=\{\d+\}\s+className="([^"]+)"/g)) {
    m[1].split(/\s+/).forEach((c) => out.add(c));
  }
  // The disc wrappers that spell their fill inline rather than via iconBg.
  // Narrowed to the icon disc itself — a `w-7`/`w-8` centring box — so the
  // sweep does not drag in the notification badge or the Cancel Partnership
  // button, which are not icon tints and are red on purpose.
  for (const m of src.matchAll(/className="([^"]*\bw-[78]\b[^"]*\bitems-center\b[^"]*)"/g)) {
    m[1].split(/\s+/).forEach((c) => out.add(c));
  }
  return [...out].filter((c) => /^(bg|text|border)-[a-z]+-\d{2,3}$/.test(c));
}

const PROFILE_SRC = readFileSync(PROFILE, 'utf8');
const ICON_CLASSES = [...new Set([...iconClassesIn(PROFILE), ...iconClassesIn(POLICY)])];

describe('the Profile icons are on the Harvest palette', () => {
  it('collected a non-trivial set of icon classes to check', () => {
    // Guards the collector itself: a regex that stopped matching would make
    // every test below vacuously pass.
    expect(ICON_CLASSES.length).toBeGreaterThanOrEqual(4);
  });

  it('uses no blue/sky tint anywhere on the screen', () => {
    // Blue is not in Harvest's palette. `sky` IS token-backed and would theme
    // perfectly well — which is why this needs a test and not just an eye.
    const offenders = ICON_CLASSES.filter((c) => /-(sky|blue|indigo|cyan)-/.test(c));
    expect(offenders, 'blue is not in the Harvest palette').toEqual([]);
  });

  it('keeps field green on the rows that already used it', () => {
    for (const label of ['My Home Church', 'FAQ']) {
      const row = PROFILE_SRC.slice(
        Math.max(0, PROFILE_SRC.indexOf(`label="${label}"`) - 400),
        PROFILE_SRC.indexOf(`label="${label}"`),
      );
      expect(row, `${label} should stay field green`).toContain('field-');
    }
  });
});

/**
 * TEST 6 — no hex, no cool greys, no /opacity on a token colour.
 *
 * The repo-wide guards in theming-gaps.test.ts cover src/ generally; these
 * pin the same properties on this screen specifically, so a regression here
 * names the Profile screen instead of appearing as one line in a repo sweep.
 */
describe('no profile icon uses an untokenised colour', () => {
  it.each([PROFILE, POLICY])('%s spells no literal hex on an icon', (file) => {
    const src = readFileSync(file, 'utf8');
    const offenders = [
      ...src.matchAll(/\b(?:bg|text|border)-\[#[0-9a-fA-F]{3,8}\]/g),
    ].map((m) => m[0]);
    expect(offenders, 'a hardcoded hex cannot theme').toEqual([]);
  });

  it('uses no gray/slate/zinc/neutral utility', () => {
    const offenders = ICON_CLASSES.filter((c) => /-(gray|slate|zinc|neutral)-/.test(c));
    expect(offenders).toEqual([]);
  });

  it('puts no /opacity modifier on a token-backed colour', () => {
    // A bare `var(--x)` colour emits NOTHING with `/NN` — the tint silently
    // disappears with no error and no failing build. `bg-navy-500/10` was
    // exactly this shape on the Roadmap row (navy is a literal, so it worked,
    // but it could not theme either).
    //
    // black/white/transparent/current are Tailwind literals, not tokens, so
    // `/NN` composites correctly on them. The modal scrims use that on purpose
    // and must stay dark in BOTH themes — the same exemption theming-gaps
    // grants the bg-white/NN scrims.
    const LITERAL = /^(?:bg|text|border)-(?:black|white|transparent|current)\//;
    const offenders: string[] = [];
    for (const file of [PROFILE, POLICY]) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\b(?:bg|text|border)-[a-z]+(?:-\d{2,3})?\/\d+\b/g)) {
        if (LITERAL.test(m[0])) continue;
        offenders.push(`${path.basename(file)}: ${m[0]}`);
      }
    }
    expect(offenders, 'a token-backed colour with /NN emits no rule').toEqual([]);
  });

  it('leaves Log Out as the only red thing on the screen', () => {
    // Red is reserved for destructive actions. Admin Dashboard was red-tinted
    // and is navigation, so it now reads gold.
    const dashboard = PROFILE_SRC.slice(
      Math.max(0, PROFILE_SRC.indexOf('label="Admin Dashboard"') - 400),
      PROFILE_SRC.indexOf('label="Admin Dashboard"'),
    );
    expect(dashboard, 'Admin Dashboard is navigation, not a destructive action')
      .not.toMatch(/-red-/);

    // The remaining red is Log Out and the Cancel Partnership confirm, both of
    // which genuinely destroy something.
    const redRows = [...PROFILE_SRC.matchAll(/label="([^"]+)"[^]{0,200}?-red-/g)].map((m) => m[1]);
    expect(redRows, 'a navigation row is tinted red').toEqual([]);
  });
});

/**
 * TEST 7 — every icon resolves in BOTH themes.
 *
 * This is the assertion a literal cannot satisfy: the same class must produce
 * a different computed value under the light and dark variable blocks.
 */
describe('every profile icon colour resolves in both themes', () => {
  it('every collected icon class maps to a real Tailwind config entry', () => {
    const unmapped = ICON_CLASSES.filter((c) => configValueFor(c) === undefined);
    expect(unmapped, 'these classes generate no CSS rule at all').toEqual([]);
  });

  it.each(ICON_CLASSES)('%s resolves to a different value in light and dark', (cls) => {
    const configValue = configValueFor(cls);
    const light = resolveValue(configValue, inTheme('light'));
    const dark = resolveValue(configValue, inTheme('dark'));

    expect(light, `${cls} does not resolve in the light theme`).not.toBeNull();
    expect(dark, `${cls} does not resolve in the dark theme`).not.toBeNull();
    expect(dark, `${cls} is the same colour in both themes — it does not theme`).not.toBe(light);
  });
});
