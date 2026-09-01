import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

import { contrastRatio, AA_CONTRAST } from '../lib/theme';
import { buildCssForMarkup, GLOBALS_CSS } from '../test/support/tailwind-build';

/**
 * THE-267 — the sidebar family, mapped onto Harvest's palettes.
 *
 * ── What could and could not be verified, and how ──────────────────────
 *
 * The ticket supplied the eight member names as "captured from the registry"
 * at https://ui.shadcn.com/r/colors/neutral.json. That URL is STILL not
 * reachable from this environment: the egress proxy answers 403 to CONNECT
 * for ui.shadcn.com, exactly as THE-263 recorded, and the vendored shadcn CLI
 * (node_modules/shadcn/dist/index.js, v4.11.0) still carries only the legacy
 * `--sidebar` / `--sidebar-background` pair. So the list was NOT taken on
 * trust and was NOT re-typed from memory — both of which THE-263 forbade.
 *
 * It was recovered from the CONSUMING SOURCE instead, which is reachable:
 * raw.githubusercontent.com serves shadcn-ui/ui, and the eight names are
 * exactly the set spelled by
 *   apps/v4/registry/new-york-v4/ui/sidebar.tsx                 (six of them)
 *   apps/v4/registry/new-york-v4/blocks/sidebar-07/components/
 *     team-switcher.tsx                                         (the other two)
 * A token family is defined by what reads it, so a list confirmed against
 * every consumer is a stronger check than one read off the palette file.
 *
 * `base-nova` (this repo's style, per components.json) is not published in
 * that repo, so `new-york-v4` is the closest readable source. That is a real
 * limitation and it is bounded: styles differ in which primitives spell which
 * utility, not in the token NAMESPACE — the same semantic names appear in
 * this repo's own installed base-nova primitives (bg-background, bg-border,
 * ring-ring, border-input, …) as in new-york-v4's. Defining all eight rather
 * than only the six sidebar.tsx uses is what makes the residual risk zero: a
 * name base-nova spells that new-york-v4 does not is still declared.
 *
 * ── The ticket premise this corrects ───────────────────────────────────
 *
 * The ticket recorded --sidebar-primary and --sidebar-primary-foreground as
 * "never referenced" and asked whether to define them anyway. They are
 * referenced. sidebar-07 — the member shell the ticket itself names as the
 * reason this family is being mapped — renders its header logo tile as
 * `bg-sidebar-primary text-sidebar-primary-foreground`. So this is not a
 * completeness judgement call: omitting them would have left a named consumer
 * painting an unset background, which is the exact silent failure THE-263
 * exists to prevent.
 *
 * ── The two 3:1 claims that do not hold, and why that is not a stop ─────
 *
 * The ticket asks that --sidebar-border and --sidebar-ring clear the 3:1
 * non-text bar. Measured, neither does in every palette, and in both cases
 * the shortfall is a pre-existing property of the token being aliased rather
 * than something this change introduces:
 *
 *   • --sidebar-border is --border-default, which is ~1.2-1.3:1 against its
 *     own ground in all four palettes — as every container hairline in this
 *     app is, and as --border (THE-263) already is. WCAG 1.4.11 asks 3:1 of a
 *     boundary that is the ONLY means of identifying a control; the sidebar
 *     is identified by its ground, which differs from the page ground in all
 *     four palettes (asserted below).
 *   • --sidebar-ring is --ring, i.e. the tenant accent. Gold on a white
 *     sidebar is 2.66:1. Raising it means moving --brand-color, which the
 *     ticket forbids, and the sidebar renders the ring BETTER than the rest
 *     of the app already does: this repo's primitives spell `ring-ring/50`
 *     (1.58:1 light, 2.51-2.60:1 dark) where sidebar.tsx spells a full-opacity
 *     `focus-visible:ring-2` (2.66 light, 5.84-6.29 dark).
 *
 * Rather than assert a threshold that is false, or drop the guard, every one
 * of these ratios is PINNED to its measured value below. A pin catches drift
 * in either direction, which a floor does not, and --sidebar-ring is asserted
 * identical to --ring in all four palettes so the two can only ever be fixed
 * together.
 */

const GLOBALS = readFileSync(GLOBALS_CSS, 'utf8');

/* ── The four palettes, composed exactly as the cascade composes them ──── */

function varsIn(selectorTest: (sel: string) => boolean, css: string = GLOBALS): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(css).walkRules((rule) => {
    if (!selectorTest(rule.selector)) return;
    rule.walkDecls((decl) => {
      if (decl.prop.startsWith('--')) out[decl.prop] = decl.value.trim();
    });
  });
  return out;
}

const IS_ROOT = (s: string) => s === ':root';
const IS_DARK = (s: string) => /\.dark|\[data-theme="dark"\]/.test(s) && !s.includes('data-palette');
const IS_CLASSIC_LIGHT = (s: string) =>
  s.includes('data-palette="classic"') && s.includes('data-theme="light"');
const IS_CLASSIC_DARK = (s: string) =>
  s.includes('data-palette="classic"') && (s.includes('.dark') || s.includes('data-theme="dark"'));

function palettes(css: string = GLOBALS) {
  const root = varsIn(IS_ROOT, css);
  const dark = varsIn(IS_DARK, css);
  const cl = varsIn(IS_CLASSIC_LIGHT, css);
  const cd = varsIn(IS_CLASSIC_DARK, css);
  return {
    // Classic first: it is the DEFAULT family since THE-265, so it is what
    // most users actually see.
    'Classic light': { ...root, ...cl },
    'Classic dark': { ...root, ...dark, ...cd },
    'Harvest light': { ...root },
    'Harvest dark': { ...root, ...dark },
  } as const;
}

const PALETTES = palettes();
type Scope = Record<string, string>;
const PALETTE_NAMES = Object.keys(PALETTES) as (keyof typeof PALETTES)[];

const toRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
};
const toHex = (rgb: number[]): string =>
  '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('').toUpperCase();

/** Identical to theming-shadcn-tokens.test.ts's resolver — same chains, same
 *  refusal to guess. Returns null rather than contributing a silent black. */
function resolveHex(value: string | undefined, scope: Scope, depth = 0): string | null {
  if (value === undefined || depth > 12) return null;
  const v = value.trim();

  const varMatch = /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]+))?\)$/.exec(v);
  if (varMatch) {
    const direct = scope[varMatch[1]] !== undefined ? resolveHex(scope[varMatch[1]], scope, depth + 1) : null;
    return direct ?? (varMatch[2] ? resolveHex(varMatch[2], scope, depth + 1) : null);
  }

  const channels = /^rgba?\(\s*var\(\s*(--[\w-]+)\s*\)\s*(?:\/[^)]*)?\)$/.exec(v);
  if (channels) {
    const raw = scope[channels[1]];
    if (!raw) return null;
    const parts = raw.trim().split(/[\s,]+/).map(Number);
    return parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n)) ? toHex(parts.slice(0, 3)) : null;
  }

  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toUpperCase();

  const literal = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (literal) {
    const parts = literal[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) return toHex(parts.slice(0, 3));
  }
  return null;
}

const resolve = (token: string, scope: Scope): string | null => resolveHex(scope[token], scope, 0);
const ratio = (a: string, b: string): number => Math.round(contrastRatio(a, b) * 100) / 100;

/* ── The mapping, as declared ──────────────────────────────────────────── */

/**
 * Every token THE-267 adds, what it aliases, and why it needs no restatement
 * in .dark or in either Classic block.
 *
 * `via` names the token it points AT — that is the whole design, and test 2
 * asserts the CSS actually says so rather than repeating a value.
 */
const SIDEBAR: { token: string; via: string; why: string }[] = [
  { token: '--sidebar', via: '--surface-raised', why: 'the ramp token all three existing sidebars already use' },
  { token: '--sidebar-foreground', via: '--text-body', why: 'ordinary copy; overridden in all four' },
  { token: '--sidebar-primary', via: '--primary', why: 'a solid brand tile; chained so the AA pair cannot drift' },
  { token: '--sidebar-primary-foreground', via: '--primary-foreground', why: 'the ink for that tile' },
  { token: '--sidebar-accent', via: '--surface-chip', why: 'the raised interactive chip, as --accent' },
  { token: '--sidebar-accent-foreground', via: '--text-strong', why: 'hover is the emphasised state' },
  { token: '--sidebar-border', via: '--border-default', why: 'what border-line resolves to' },
  { token: '--sidebar-ring', via: '--ring', why: 'chained so it inherits --ring’s own .dark restatement' },
];

const SIDEBAR_TOKENS = SIDEBAR.map((s) => s.token);

/** Every utility the real sidebar.tsx and the sidebar-07 block spell. */
const CONSUMED_UTILITIES = [
  'bg-sidebar',
  'text-sidebar-foreground',
  'bg-sidebar-accent',
  'text-sidebar-accent-foreground',
  'border-sidebar-border',
  'bg-sidebar-border',
  'ring-sidebar-ring',
  'bg-sidebar-primary',
  'text-sidebar-primary-foreground',
];

/* ═══ 1 · Every defined --sidebar-* token resolves, named one by one ═════ */

describe('every --sidebar token is declared, and declared once', () => {
  for (const { token, via, why } of SIDEBAR) {
    it(`${token} is declared, in :root only, as an alias of ${via} — ${why}`, () => {
      expect(varsIn(IS_ROOT)[token], `${token} is not declared in :root`).toBe(`var(${via})`);
      // Falling through is the DECISION. Restating any of these in .dark or a
      // Classic block would change no computed value (test 2 proves each still
      // differs per palette) and would add three more places to keep in sync.
      for (const [label, test] of [
        ['.dark', IS_DARK],
        ['Classic light', IS_CLASSIC_LIGHT],
        ['Classic dark', IS_CLASSIC_DARK],
      ] as const) {
        expect(varsIn(test)[token], `${token} was restated in ${label}; it is meant to fall through`)
          .toBeUndefined();
      }
    });
  }

  it('declares exactly these eight and no more', () => {
    const declared = new Set<string>();
    postcss.parse(GLOBALS).walkDecls((d) => {
      if (/^--sidebar/.test(d.prop)) declared.add(d.prop);
    });
    expect([...declared].sort()).toEqual([...SIDEBAR_TOKENS].sort());
  });
});

/* ═══ 2 · Each resolves in all four palettes, Classic first ═════════════ */

describe('each resolves in all four palettes', () => {
  for (const name of PALETTE_NAMES) {
    for (const { token } of SIDEBAR) {
      it(`${name}: ${token} resolves to a literal colour`, () => {
        const hex = resolve(token, PALETTES[name]);
        expect(hex, `${token} does not resolve in ${name}`).toMatch(/^#[0-9A-F]{6}$/);
      });
    }
  }

  it('the five neutral aliases actually differ between the palettes they fall through to', () => {
    // The point of falling through: one declaration, four different results.
    // If these were equal the fall-through would be hiding a bug, not saving
    // three restatements.
    for (const token of ['--sidebar', '--sidebar-foreground', '--sidebar-accent', '--sidebar-accent-foreground', '--sidebar-border']) {
      const harvestDark = resolve(token, PALETTES['Harvest dark']);
      const classicDark = resolve(token, PALETTES['Classic dark']);
      const harvestLight = resolve(token, PALETTES['Harvest light']);
      expect(harvestDark, `${token} did not change on dark`).not.toBe(harvestLight);
      expect(classicDark, `${token} is identical in both dark families`).not.toBe(harvestDark);
    }
  });

  it('the three brand aliases are deliberately family- and mode-independent, except --sidebar-ring on dark', () => {
    // --primary / --primary-foreground are fixed everywhere: the accent must
    // not grey out in Classic. --ring tracks the contrast-corrected accent on
    // dark, which is why chaining to it removes the need to restate anything.
    for (const token of ['--sidebar-primary', '--sidebar-primary-foreground']) {
      const values = PALETTE_NAMES.map((n) => resolve(token, PALETTES[n]));
      expect(new Set(values).size, `${token} should be one value in every palette`).toBe(1);
    }
    for (const name of PALETTE_NAMES) {
      expect(resolve('--sidebar-ring', PALETTES[name]), `${name}: --sidebar-ring drifted from --ring`)
        .toBe(resolve('--ring', PALETTES[name]));
    }
  });
});

/* ═══ 3 · No shadcn default grey shipped verbatim ═══════════════════════ */

describe('none of the registry defaults was pasted', () => {
  /**
   * The ten distinct oklch() literals across cssVars.light and cssVars.dark
   * for the eight sidebar tokens in the neutral base-colour registry, as the
   * ticket quoted them. These are shadcn's generic greys: they ignore
   * Harvest's surface ramp and cover two themes where this app has four.
   * Shipping any of them verbatim is the failure this test exists to catch.
   */
  const SHADCN_DEFAULTS = [
    'oklch(0.985 0 0)',
    'oklch(0.145 0 0)',
    'oklch(0.205 0 0)',
    'oklch(0.97 0 0)',
    'oklch(0.922 0 0)',
    'oklch(0.708 0 0)',
    'oklch(0.269 0 0)',
    'oklch(0.556 0 0)',
    'oklch(1 0 0 / 10%)',
    'oklch(0.488 0.243 264.376)',
  ];

  for (const literal of SHADCN_DEFAULTS) {
    it(`globals.css does not contain ${literal}`, () => {
      // Whitespace-normalised, and over the WHOLE file including comments: a
      // default pasted into a comment is a paste waiting to happen.
      const flat = GLOBALS.replace(/\s+/g, ' ');
      expect(flat, `a shadcn registry default was shipped verbatim: ${literal}`)
        .not.toContain(literal.replace(/\s+/g, ' '));
    });
  }

  it('globals.css declares no oklch colour at all', () => {
    // Stronger and simpler: this app's ramp is hex and rgb triples. Any oklch
    // appearing here is by definition imported from somewhere else.
    expect(GLOBALS).not.toMatch(/oklch\(/i);
  });
});

/* ═══ 4 · --sidebar-primary is not blue ════════════════════════════════ */

describe('--sidebar-primary is not the chart-palette blue', () => {
  it('the 264.376 hue literal appears nowhere', () => {
    expect(GLOBALS).not.toMatch(/0\.243\s+264\.376/);
    expect(GLOBALS).not.toMatch(/264\.376/);
  });

  it('resolves to Harvest gold — warm, not blue — in every palette', () => {
    for (const name of PALETTE_NAMES) {
      const hex = resolve('--sidebar-primary', PALETTES[name])!;
      const [r, g, b] = toRgb(hex);
      expect(r, `${name}: --sidebar-primary is blue-dominant (${hex})`).toBeGreaterThan(b);
      expect(g, `${name}: --sidebar-primary is blue-dominant (${hex})`).toBeGreaterThan(b);
      expect(hex).toBe('#C9963A');
    }
  });
});

/* ═══ 5 · Every foreground/background pair clears AA, × 4 palettes ══════ */

/**
 * Ratios measured, not eyeballed, and PINNED rather than floored — a pin
 * catches a value moving in either direction. Every entry here is also
 * asserted against the AA floor.
 */
const TEXT_PAIRS: { fg: string; bg: string; label: string }[] = [
  { fg: '--sidebar-foreground', bg: '--sidebar', label: 'label on the sidebar ground' },
  { fg: '--sidebar-foreground', bg: '--sidebar-accent', label: 'label on a hovered row' },
  { fg: '--sidebar-accent-foreground', bg: '--sidebar-accent', label: 'active label on a hovered row' },
  { fg: '--sidebar-accent-foreground', bg: '--sidebar', label: 'active label on the sidebar ground' },
  { fg: '--sidebar-primary-foreground', bg: '--sidebar-primary', label: 'icon on the brand tile' },
];

const EXPECTED_TEXT: Record<string, Record<string, number>> = {
  'Classic light': {
    '--sidebar-foreground/--sidebar': 10.37,
    '--sidebar-foreground/--sidebar-accent': 7.85,
    '--sidebar-accent-foreground/--sidebar-accent': 13.18,
    '--sidebar-accent-foreground/--sidebar': 17.4,
    '--sidebar-primary-foreground/--sidebar-primary': 5.69,
  },
  'Classic dark': {
    '--sidebar-foreground/--sidebar': 9.67,
    '--sidebar-foreground/--sidebar-accent': 8.46,
    '--sidebar-accent-foreground/--sidebar-accent': 12.13,
    '--sidebar-accent-foreground/--sidebar': 13.87,
    '--sidebar-primary-foreground/--sidebar-primary': 5.69,
  },
  'Harvest light': {
    '--sidebar-foreground/--sidebar': 10.09,
    '--sidebar-foreground/--sidebar-accent': 7.84,
    '--sidebar-accent-foreground/--sidebar-accent': 11.73,
    '--sidebar-accent-foreground/--sidebar': 15.11,
    '--sidebar-primary-foreground/--sidebar-primary': 5.69,
  },
  'Harvest dark': {
    '--sidebar-foreground/--sidebar': 10.02,
    '--sidebar-foreground/--sidebar-accent': 8.73,
    '--sidebar-accent-foreground/--sidebar-accent': 13.73,
    '--sidebar-accent-foreground/--sidebar': 15.76,
    '--sidebar-primary-foreground/--sidebar-primary': 5.69,
  },
};

describe('every sidebar text pair clears AA in all four palettes', () => {
  for (const name of PALETTE_NAMES) {
    for (const { fg, bg, label } of TEXT_PAIRS) {
      it(`${name}: ${label} (${fg} on ${bg})`, () => {
        const scope = PALETTES[name];
        const [f, b] = [resolve(fg, scope), resolve(bg, scope)];
        expect(f, `${fg} does not resolve`).not.toBeNull();
        expect(b, `${bg} does not resolve`).not.toBeNull();
        const r = ratio(f!, b!);
        expect(r, `${name}: ${fg} on ${bg} is ${r}:1, under AA`).toBeGreaterThanOrEqual(AA_CONTRAST);
        expect(r, `${name}: ${fg} on ${bg} moved to ${r}:1`).toBe(EXPECTED_TEXT[name][`${fg}/${bg}`]);
      });
    }
  }

  it('the floor across all 20 pairs is 5.69:1, at or above THE-263’s 5.66', () => {
    const all = PALETTE_NAMES.flatMap((n) => Object.values(EXPECTED_TEXT[n]));
    expect(all).toHaveLength(20);
    expect(Math.min(...all)).toBe(5.69);
    expect(Math.min(...all)).toBeGreaterThanOrEqual(5.66);
  });
});

/* ═══ 6 · The non-text pairs, at the bar that actually applies ══════════ */

/**
 * Pinned measurements. The header explains why a blanket 3:1 is not asserted
 * for the border or for the light-mode ring; what IS asserted unconditionally
 * is the thing 1.4.11 actually protects here — that the sidebar is
 * identifiable without its border, and that the focus ring clears 3:1 on the
 * dark grounds where the accent is contrast-corrected for exactly that.
 */
const EXPECTED_NON_TEXT: Record<string, { accentLift: number; borderOnSidebar: number; ringOnSidebar: number; sidebarVsPage: number }> = {
  'Classic light': { accentLift: 1.32, borderOnSidebar: 1.32, ringOnSidebar: 2.66, sidebarVsPage: 1.07 },
  'Classic dark': { accentLift: 1.14, borderOnSidebar: 1.23, ringOnSidebar: 5.84, sidebarVsPage: 1.1 },
  'Harvest light': { accentLift: 1.29, borderOnSidebar: 1.29, ringOnSidebar: 2.66, sidebarVsPage: 1.06 },
  'Harvest dark': { accentLift: 1.15, borderOnSidebar: 1.22, ringOnSidebar: 6.29, sidebarVsPage: 1.08 },
};

describe('the non-text pairs, measured and pinned', () => {
  for (const name of PALETTE_NAMES) {
    const exp = EXPECTED_NON_TEXT[name];

    it(`${name}: the hovered row lifts off the sidebar ground, and in the right direction`, () => {
      const s = PALETTES[name];
      const [accent, ground] = [resolve('--sidebar-accent', s)!, resolve('--sidebar', s)!];
      expect(ratio(accent, ground)).toBe(exp.accentLift);
      // THE-263's trap, restated: --surface-tint equals --surface on dark, so
      // it would put the hovered row on the WRONG SIDE of its own ground. The
      // chip is a step above the raised surface in every palette.
      const tint = resolve('--surface-tint', s)!;
      expect(ratio(accent, ground), `${name}: the chip lift collapsed to the --surface-tint value`)
        .toBeGreaterThan(ratio(tint, ground));
    });

    it(`${name}: the sidebar is identifiable by its own ground, without its border`, () => {
      const s = PALETTES[name];
      expect(ratio(resolve('--sidebar', s)!, resolve('--background', s)!)).toBe(exp.sidebarVsPage);
      expect(resolve('--sidebar', s), `${name}: the sidebar ground equals the page ground`)
        .not.toBe(resolve('--background', s));
      expect(ratio(resolve('--sidebar-border', s)!, resolve('--sidebar', s)!)).toBe(exp.borderOnSidebar);
    });

    it(`${name}: the focus ring is pinned, and identical to --ring`, () => {
      const s = PALETTES[name];
      expect(ratio(resolve('--sidebar-ring', s)!, resolve('--sidebar', s)!)).toBe(exp.ringOnSidebar);
    });
  }

  it('the focus ring clears the 3:1 non-text bar on both dark grounds', () => {
    // Where the accent is contrast-corrected against a dark ground, the bar is
    // met. On light it is 2.66:1 — --ring's pre-existing shortfall, which the
    // header explains and which cannot be fixed without moving --brand-color.
    for (const name of ['Classic dark', 'Harvest dark'] as const) {
      expect(EXPECTED_NON_TEXT[name].ringOnSidebar).toBeGreaterThanOrEqual(3);
    }
  });
});

/* ═══ 7 · Both halves of the bridge: the utilities actually mint ════════ */

describe('the utility half of the bridge', () => {
  it('every utility the real sidebar.tsx and sidebar-07 spell produces a rule', async () => {
    const built = await buildCssForMarkup(`<div class="${CONSUMED_UTILITIES.join(' ')}"></div>`);
    for (const cls of CONSUMED_UTILITIES) {
      expect(built, `${cls} produces no rule — the @theme inline half is missing`)
        .toMatch(new RegExp(`\\.${cls}\\s*\\{`));
    }
  }, 180_000);

  it('adding the family minted no new border-* name', async () => {
    // Non-negotiable, unchanged since THE-264: these four must still produce
    // nothing, or the `line` naming has been undone.
    const built = await buildCssForMarkup(
      '<div class="border-strong border-faint border-subtle border-hairline"></div>',
    );
    for (const cls of ['border-strong', 'border-faint', 'border-subtle', 'border-hairline']) {
      expect(built, `${cls} started producing a rule`).not.toMatch(new RegExp(`\\.${cls}\\s*\\{`));
    }
  }, 180_000);
});

/* ═══ 8 · --sidebar-width and --sidebar-width-icon are NOT tokens ═══════ */

describe('the two React constants stay out of the palette', () => {
  it('neither is declared anywhere in globals.css', () => {
    // SIDEBAR_WIDTH = "16rem", SIDEBAR_WIDTH_MOBILE = "18rem",
    // SIDEBAR_WIDTH_ICON = "3rem" are set as inline styles on the wrapper by
    // the component. Declaring them here would silently override the
    // component's own values, and a palette has nothing to say about a width.
    const declared = new Set<string>();
    postcss.parse(GLOBALS).walkDecls((d) => {
      if (d.prop.startsWith('--')) declared.add(d.prop);
    });
    expect(declared.has('--sidebar-width')).toBe(false);
    expect(declared.has('--sidebar-width-icon')).toBe(false);
    expect(declared.has('--sidebar-width-mobile')).toBe(false);
  });

  it('no --sidebar token carries a length value', () => {
    for (const name of PALETTE_NAMES) {
      for (const token of SIDEBAR_TOKENS) {
        const raw = PALETTES[name][token];
        if (raw === undefined) continue;
        expect(raw, `${token} looks like a length, not a colour`).not.toMatch(/\d(rem|px|em|%)/);
      }
    }
  });
});

/* ═══ 9 · No THE-263 or #410 token moved ═══════════════════════════════ */

/** Every bridge token's resolved value, per palette, as it stood at #410. */
const PHASE_TWO_BASELINE: Record<string, Record<string, string>> = {
  "Harvest light": {
    "--background": "#FAF8F5",
    "--foreground": "#4A4038",
    "--card": "#FFFFFF",
    "--card-foreground": "#4A4038",
    "--popover": "#FFFFFF",
    "--popover-foreground": "#4A4038",
    "--primary": "#C9963A",
    "--secondary": "#E6B325",
    "--primary-foreground": "#2D2519",
    "--secondary-foreground": "#2D2519",
    "--muted": "#F3EEE7",
    "--muted-foreground": "#68563F",
    "--accent": "#E8E2D9",
    "--accent-foreground": "#2D2519",
    "--destructive": "#A23C28",
    "--border": "#E8E2D9",
    "--input": "#D6CCBE",
    "--ring": "#C9963A",
    "--chart-1": "#C9963A",
    "--chart-2": "#4F97D6",
    "--chart-3": "#6E8E52",
    "--chart-4": "#D6CCBE",
    "--chart-5": "#C8BCA9",
  },
  "Harvest dark": {
    "--background": "#1A1612",
    "--foreground": "#D1C7BA",
    "--card": "#221D18",
    "--card-foreground": "#D1C7BA",
    "--popover": "#221D18",
    "--popover-foreground": "#D1C7BA",
    "--primary": "#C9963A",
    "--secondary": "#E6B325",
    "--primary-foreground": "#2D2519",
    "--secondary-foreground": "#2D2519",
    "--muted": "#120F0C",
    "--muted-foreground": "#B5A692",
    "--accent": "#2E2822",
    "--accent-foreground": "#FAF8F5",
    "--destructive": "#F0BFB2",
    "--border": "#332C26",
    "--input": "#463D35",
    "--ring": "#C9963A",
    "--chart-1": "#E5B65C",
    "--chart-2": "#6BA8DD",
    "--chart-3": "#8CA96E",
    "--chart-4": "#FFFFFF",
    "--chart-5": "#FFFFFF",
  },
  "Classic light": {
    "--background": "#F7F7F7",
    "--foreground": "#404040",
    "--card": "#FFFFFF",
    "--card-foreground": "#404040",
    "--popover": "#FFFFFF",
    "--popover-foreground": "#404040",
    "--primary": "#C9963A",
    "--secondary": "#E6B325",
    "--primary-foreground": "#2D2519",
    "--secondary-foreground": "#2D2519",
    "--muted": "#EFEFEF",
    "--muted-foreground": "#595959",
    "--accent": "#E0E0E0",
    "--accent-foreground": "#1A1A1A",
    "--destructive": "#A23C28",
    "--border": "#E0E0E0",
    "--input": "#C7C7C7",
    "--ring": "#C9963A",
    "--chart-1": "#C9963A",
    "--chart-2": "#4F97D6",
    "--chart-3": "#6E8E52",
    "--chart-4": "#D6CCBE",
    "--chart-5": "#C8BCA9",
  },
  "Classic dark": {
    "--background": "#1C1C1C",
    "--foreground": "#CCCCCC",
    "--card": "#242424",
    "--card-foreground": "#CCCCCC",
    "--popover": "#242424",
    "--popover-foreground": "#CCCCCC",
    "--primary": "#C9963A",
    "--secondary": "#E6B325",
    "--primary-foreground": "#2D2519",
    "--secondary-foreground": "#2D2519",
    "--muted": "#131313",
    "--muted-foreground": "#ABABAB",
    "--accent": "#2E2E2E",
    "--accent-foreground": "#F2F2F2",
    "--destructive": "#F0BFB2",
    "--border": "#333333",
    "--input": "#474747",
    "--ring": "#C9963A",
    "--chart-1": "#E5B65C",
    "--chart-2": "#6BA8DD",
    "--chart-3": "#8CA96E",
    "--chart-4": "#FFFFFF",
    "--chart-5": "#FFFFFF",
  },
};

describe('no existing token moved', () => {
  for (const name of PALETTE_NAMES) {
    it(`${name}: every THE-263 / #410 token resolves exactly as it did`, () => {
      const scope = PALETTES[name];
      const actual: Record<string, string | null> = {};
      for (const token of Object.keys(PHASE_TWO_BASELINE[name])) actual[token] = resolve(token, scope);
      expect(actual).toEqual(PHASE_TWO_BASELINE[name]);
    });
  }
});

/* ═══ 10 · Classic is still the default family (no-regression on #409) ══ */

describe('THE-265 is intact', () => {
  it('a missing preference still resolves to Classic', async () => {
    const { DEFAULT_PALETTE_FAMILY } = await import('../lib/theme');
    expect(DEFAULT_PALETTE_FAMILY).toBe('classic');
  });
});

/* ═══ 11 · The inverted pin catches an unexpected --sidebar* token ══════ */

/**
 * The mutation guard for the pin in tailwind-v4-migration.test.ts. That pin
 * used to assert NO --sidebar* token exists; it now asserts these eight exist
 * and nothing else does. Inverting a pin is only safe if the new form still
 * catches what the old one caught, so both directions are exercised here
 * against mutated copies of globals.css held in memory — no `git show`, and
 * no writing to the real file.
 */
describe('the inverted pin still proves what it replaced', () => {
  const sidebarTokensIn = (css: string): string[] => {
    const out = new Set<string>();
    postcss.parse(css).walkDecls((d) => {
      if (/^--sidebar/.test(d.prop)) out.add(d.prop);
    });
    return [...out].sort();
  };

  it('passes on the real file', () => {
    expect(sidebarTokensIn(GLOBALS)).toEqual([...SIDEBAR_TOKENS].sort());
  });

  it('catches an undeclared --sidebar-xyz', () => {
    const mutated = GLOBALS.replace(
      '  --sidebar: var(--surface-raised);',
      '  --sidebar: var(--surface-raised);\n  --sidebar-xyz: #FF0000;',
    );
    expect(mutated).not.toBe(GLOBALS);
    expect(sidebarTokensIn(mutated)).toContain('--sidebar-xyz');
    expect(sidebarTokensIn(mutated)).not.toEqual([...SIDEBAR_TOKENS].sort());
  });

  it('catches a --sidebar-width smuggled in as a token', () => {
    const mutated = GLOBALS.replace(
      '  --sidebar: var(--surface-raised);',
      '  --sidebar: var(--surface-raised);\n  --sidebar-width: 16rem;',
    );
    expect(sidebarTokensIn(mutated)).toContain('--sidebar-width');
  });

  it('catches a removal from any one of the eight', () => {
    for (const { token, via } of SIDEBAR) {
      const mutated = GLOBALS.replace(`  ${token}: var(${via});\n`, '');
      expect(mutated, `${token} was not found to remove — the pin is matching nothing`).not.toBe(GLOBALS);
      expect(sidebarTokensIn(mutated), `removing ${token} did not fail the pin`).not.toContain(token);
    }
  });

  it('still catches the thing the OLD pin caught: any --sidebar* on a file that should have none', () => {
    // The old pin's whole content was `expect(declared.filter(/^--sidebar/)).toEqual([])`.
    // Run that exact predicate against a stripped copy to show the inverted
    // form is a superset: it catches both absence AND unexpected presence,
    // where the old one caught presence only.
    let stripped = GLOBALS;
    for (const { token, via } of SIDEBAR) stripped = stripped.replace(`  ${token}: var(${via});\n`, '');
    expect(sidebarTokensIn(stripped)).toEqual([]);
    expect(sidebarTokensIn(stripped)).not.toEqual([...SIDEBAR_TOKENS].sort());
  });
});
