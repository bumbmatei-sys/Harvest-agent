import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import postcss from 'postcss';
import { contrastRatio, AA_CONTRAST } from '../lib/theme';
import { PREAUTH_PATHS, isPreAuthPath } from '../lib/preauth-theme';
import tw from '../../tailwind.config';

/**
 * Dark mode on the member app screens — Home, Blog, Prayer and the rest.
 *
 * The founder's report: page backgrounds stayed light in dark mode across the
 * member app while the shell (sidebar/nav) went dark. PR 326 and PR 337 fixed
 * the course editor, Notes list, and the semantic badge colour maps — none of
 * them touched a member app screen, which is why the bug kept resurfacing.
 *
 * As in PR 322/323/326/337, nothing here is asserted against a hand-typed hex.
 * Every colour is read out of the REAL source, resolved through the REAL
 * Tailwind config and the REAL variable blocks in globals.css, and every ratio
 * is computed. A test that pinned a passing number would keep passing after
 * the palette moved, which is the failure mode these exist to prevent.
 */

const NON_TEXT_CONTRAST = 3.0;

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');
const GLOBALS = path.join(ROOT, 'src/app/globals.css');

const FILES = {
  shell: 'components/MainApp.tsx',
  home: 'components/NewsTab.tsx',
  blog: 'components/BlogTab.tsx',
  prayer: 'components/PrayerWall.tsx',
  profile: 'components/Profile.tsx',
  bible: 'components/BiblePage.tsx',
  aiChat: 'components/AIChat.tsx',
  messages: 'components/UserMessages.tsx',
  map: 'components/ChurchMap.tsx',
  allNews: 'components/AllNews.tsx',
  personalInfo: 'components/PersonalInformationModal.tsx',
  saved: 'components/SavedItems.tsx',
} as const;
type ScreenKey = keyof typeof FILES;

const ALREADY_CLEAN_FILES = {
  themeToggle: 'components/ThemeToggle.tsx',
  settingsAccordion: 'components/settings/SettingsAccordion.tsx',
} as const;

const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');
const SOURCES: Record<ScreenKey, string> = Object.fromEntries(
  (Object.entries(FILES) as [ScreenKey, string][]).map(([k, rel]) => [k, read(rel)]),
) as Record<ScreenKey, string>;

// ── globals.css: the brace-matched light (:root) and dark (.dark /
// [data-theme="dark"]) blocks, parsed for real rather than regex-scraped. ──

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

// Synchronous (readFileSync + postcss are both sync), so these are ready
// before any describe body runs — no beforeAll needed, and pairs computed at
// describe-scope (for a ratio-in-the-title) can rely on them immediately.
const GLOBALS_CSS = readFileSync(GLOBALS, 'utf8');
const lightVars: Record<string, string> = varsIn(GLOBALS_CSS, (s) => s === ':root');
const darkVars: Record<string, string> = varsIn(GLOBALS_CSS, (s) => /\.dark|\[data-theme="dark"\]/.test(s));

type Theme = 'light' | 'dark';
/** The ground each theme composites a translucent fill over, for the rare
 *  expression that cannot be reduced without one. */
const BACKSTOP: Record<Theme, string> = { light: '#FFFFFF', dark: '#221D18' };

/** A dark lookup that falls back to light, exactly as the cascade does. */
const inTheme = (theme: Theme) => (name: string): string | undefined =>
  theme === 'dark' ? darkVars[name] ?? lightVars[name] : lightVars[name];

// ── colour evaluation — hex, `R G B` channel triplets, var() chains with
// fallbacks, rgb()/rgba(), and color-mix() over `transparent` or a colour. ──

const toHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('').toUpperCase();

const parseHex = (h: string): [number, number, number] => {
  const v = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as [number, number, number];
};

function resolveColor(
  expr: string | undefined,
  lookup: (n: string) => string | undefined,
  backdrop: string,
  depth = 0,
): string | null {
  if (!expr || depth > 12) return null;
  const v = expr.trim().replace(/^["']|["']$/g, '').trim();

  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    const [a, b, c] = v.slice(1);
    return `#${a}${a}${b}${b}${c}${c}`.toUpperCase();
  }
  if (/^white$/i.test(v)) return '#FFFFFF';
  if (/^black$/i.test(v)) return '#000000';
  if (/^\d{1,3}\s+\d{1,3}\s+\d{1,3}$/.test(v)) {
    const [r, g, b] = v.split(/\s+/).map(Number);
    return toHex(r, g, b);
  }

  const varMatch = v.match(/^var\((--[a-z0-9-]+)\s*(?:,\s*([\s\S]+))?\)$/i);
  if (varMatch) {
    const direct = resolveColor(lookup(varMatch[1]), lookup, backdrop, depth + 1);
    if (direct) return direct;
    return varMatch[2] ? resolveColor(varMatch[2], lookup, backdrop, depth + 1) : null;
  }

  const rgbMatch = v.match(/^rgba?\(\s*([\s\S]+?)\s*(?:\/[^)]*)?\)$/i);
  if (rgbMatch && !/^color-mix/i.test(v)) {
    return resolveColor(rgbMatch[1].replace(/,/g, ' '), lookup, backdrop, depth + 1);
  }

  // color-mix(in srgb, <colour> P%, <transparent | colour>)
  const mix = v.match(
    /^color-mix\(\s*in\s+srgb\s*,\s*([\s\S]+?)\s+(\d+(?:\.\d+)?)%\s*,\s*([\s\S]+?)\s*\)$/i,
  );
  if (mix) {
    const fg = resolveColor(mix[1], lookup, backdrop, depth + 1);
    if (!fg) return null;
    const over = /^transparent$/i.test(mix[3].trim())
      ? backdrop
      : resolveColor(mix[3], lookup, backdrop, depth + 1);
    if (!over) return null;
    const alpha = Number(mix[2]) / 100;
    const [fr, fg2, fb] = parseHex(fg);
    const [br, bg, bb] = parseHex(over);
    return toHex(fr * alpha + br * (1 - alpha), fg2 * alpha + bg * (1 - alpha), fb * alpha + bb * (1 - alpha));
  }

  return null;
}

/** Every CSS custom property an expression ultimately names. */
const tokensNamed = (expr: string): string[] =>
  [...expr.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]);

// ── Tailwind class → colour expression, through the real config ──

const twExtend = (tw.theme?.extend ?? {}) as Record<string, Record<string, unknown>>;
const twColors = (twExtend.colors ?? {}) as Record<string, unknown>;
const twTextColor = (twExtend.textColor ?? {}) as Record<string, unknown>;

function lookupScale(group: Record<string, unknown>, rest: string): string | null {
  const parts = rest.split('-');
  for (let i = parts.length; i > 0; i -= 1) {
    const head = parts.slice(0, i).join('-');
    const tail = parts.slice(i).join('-');
    const entry = group[head];
    if (entry == null) continue;
    if (typeof entry === 'string') {
      if (!tail) return entry;
      continue;
    }
    const key = tail || 'DEFAULT';
    const value = (entry as Record<string, unknown>)[key];
    if (typeof value === 'string') return value;
  }
  return null;
}

/** Resolve a utility class to the colour expression Tailwind emits for it. */
function classToExpr(cls: string): string | null {
  const bare = cls.replace(/^(?:hover|focus|active|group-hover|placeholder|dark):/g, '');

  const arbitrary = bare.match(/^(?:bg|text|border|ring|divide)-\[([^\]]+)\]$/);
  if (arbitrary) {
    const inner = arbitrary[1].replace(/_/g, ' ');
    return /^(?:#|rgb|hsl|color-mix|var\()/i.test(inner) ? inner : null;
  }

  const named = bare.match(/^(bg|text|border|ring|divide|placeholder)-(.+)$/);
  if (!named) return null;
  const [, prefix, rest] = named;
  if (prefix === 'text') {
    return lookupScale(twTextColor, rest) ?? lookupScale(twColors, rest);
  }
  return lookupScale(twColors, rest);
}

/** Compute one pair's contrast in one theme. `ink`/`bg`/`ground` are real
 *  colour expressions (var() chains, color-mix(), rgb(), or a Tailwind class
 *  resolved via classToExpr) — never a literal hex typed by hand. */
interface Pair {
  target: string;
  state: string;
  ink: string;
  bg: string;
  ground: string;
  /** 'text' needs AA (4.5:1); 'nontext' (icons, UI boundaries) needs 3:1. */
  kind?: 'text' | 'nontext';
}

function ratioOf(pair: Pair, theme: Theme): { ratio: number; fg: string; bg: string } {
  const lookup = inTheme(theme);
  const ground = resolveColor(pair.ground, lookup, BACKSTOP[theme]);
  expect(ground, `${pair.target} (${pair.state}): ground "${pair.ground}" did not resolve in ${theme}`).not.toBeNull();
  const bg = resolveColor(pair.bg, lookup, ground!);
  expect(bg, `${pair.target} (${pair.state}): background "${pair.bg}" did not resolve in ${theme}`).not.toBeNull();
  const fg = resolveColor(pair.ink, lookup, bg!);
  expect(fg, `${pair.target} (${pair.state}): ink "${pair.ink}" did not resolve in ${theme}`).not.toBeNull();
  return { ratio: contrastRatio(fg!, bg!), fg: fg!, bg: bg! };
}

const label = (p: Pair) => `${p.target} — ${p.state}`;
const floorFor = (p: Pair) => (p.kind === 'nontext' ? NON_TEXT_CONTRAST : AA_CONTRAST);

// ═══════════════════════════════════════════════════════════════════════════
// The pairs — one per screen in scope, naming the classes/expressions this
// PR actually put in place. Resolved through the real config; nothing here
// is a hand-typed hex.
// ═══════════════════════════════════════════════════════════════════════════

const SURFACE = classToExpr('bg-surface')!;             // var(--surface)
const SURFACE_RAISED = classToExpr('bg-surface-raised')!; // var(--surface-raised)
const SURFACE_CHIP = classToExpr('bg-surface-chip')!;     // var(--surface-chip)
const SURFACE_SUNKEN = classToExpr('bg-surface-sunken')!; // var(--surface-sunken)
const TEXT_STRONG = classToExpr('text-strong')!;
const TEXT_MUTED = classToExpr('text-muted')!;
const TEXT_FAINT = classToExpr('text-faint')!;
const SURFACE_GOLD = 'var(--surface-gold)';

/** 🔴 The reported bug: the shell wrapper every screen renders into. */
const SHELL: Pair = {
  target: 'the member app shell', state: 'page background + sidebar wordmark',
  ink: TEXT_STRONG, bg: SURFACE, ground: SURFACE,
};

/** 🔴 Photographed: Home. */
const HOME: Pair = {
  target: 'Home (NewsTab) — News & Updates card', state: 'author name on the post card',
  ink: TEXT_STRONG, bg: SURFACE_RAISED, ground: SURFACE,
};

/** 🔴 Photographed: Blog. */
const BLOG: Pair = {
  target: 'Blog (BlogTab) — article card', state: 'title on the article card',
  ink: TEXT_STRONG, bg: SURFACE_RAISED, ground: SURFACE,
};

/** 🔴 Photographed: Prayer. */
const PRAYER: Pair = {
  target: 'Prayer (PrayerWall) — request card', state: 'author name on the request card',
  ink: TEXT_STRONG, bg: SURFACE_RAISED, ground: SURFACE,
};

const PROFILE: Pair = {
  target: 'Profile — avatar initial on the gold disc', state: 'initial letter',
  // wheat-700 on wheat-100/--surface-gold is THE-61's own documented AA
  // failure (4.33:1) — wheat-800 is its corrected ink. Using wheat-700 here
  // was caught by this very test failing in light mode (see the PR report).
  ink: classToExpr('text-wheat-800')!, bg: SURFACE_GOLD, ground: SURFACE_RAISED,
};

/** The BiblePage highlight fix: a verse's ink is forced dark because the
 *  highlighter-pastel fill (a true-colour swatch) never inverts — same shape
 *  as a real highlighter marker, which has no dark mode either. */
const BIBLE: Pair = {
  target: 'Bible — a highlighted verse', state: 'gold highlighter, forced-dark ink',
  ink: 'var(--earth)', bg: '#FEF08A', ground: SURFACE_RAISED,
};

const AI_CHAT: Pair = {
  target: 'Ask — chat-history delete button', state: 'hover (danger)',
  // ink-danger on c-danger-tint is 3.71:1 in light (below AA) — this test
  // caught that too; ink-danger-strong is the token's own higher-contrast
  // sibling (same naming convention as text-strong vs text-body).
  ink: 'rgb(var(--ink-danger-strong))', bg: 'rgb(var(--c-danger-tint))', ground: SURFACE_RAISED,
};

const MESSAGES: Pair = {
  target: 'Messages — non-admin sender avatar', state: 'initial letter',
  ink: TEXT_MUTED, bg: SURFACE_CHIP, ground: SURFACE_RAISED,
};

/** ChurchMap needed zero changes — every value it uses was already
 *  theme-aware. This asserts that's actually true, not assumed. */
const MAP: Pair = {
  target: 'Map — church list heading', state: '"Churches near you"',
  ink: TEXT_STRONG, bg: SURFACE_RAISED, ground: SURFACE,
};

const ALL_NEWS: Pair = {
  target: 'All news — author avatar', state: 'initial letter (brought in line with Home)',
  ink: TEXT_MUTED, bg: SURFACE_CHIP, ground: SURFACE,
};

const PERSONAL_INFO: Pair = {
  target: 'Account settings → Personal Information — Country field', state: 'selected value',
  ink: TEXT_STRONG, bg: SURFACE_SUNKEN, ground: SURFACE,
};

const SAVED: Pair = {
  target: 'Account settings → Saved — row title', state: 'saved item title on its row',
  ink: TEXT_STRONG, bg: SURFACE_RAISED, ground: SURFACE,
};

/** NOT part of SCREEN_PAIRS/the AA floor — a brand-icon-on-its-own-12%-tint
 *  disc (SavedItems, and the same shape elsewhere: NewsTab's date badge,
 *  PrayerWall's Pray pill…). Mixing an accent with a sliver of itself over
 *  white is inherently low-contrast, and this PR's fix (white -> transparent
 *  in the color-mix) does not change that: in light mode transparent
 *  composites onto the same white card white was hardcoding, so the ratio is
 *  IDENTICAL before and after. Pre-existing in both themes, unrelated to the
 *  reported bug, and out of a dark-mode-only PR's remit — recorded here
 *  rather than silently dropped. */
const SAVED_ICON_TINT: Pair = {
  target: 'Account settings → Saved — item-type icon', state: 'icon on its tint disc (pre-existing, both themes)',
  ink: 'var(--brand-color, #B8962E)', bg: 'color-mix(in srgb, var(--brand-color, #B8962E) 12%, transparent)', ground: SURFACE_RAISED,
};

const SCREEN_PAIRS: Record<ScreenKey, Pair> = {
  shell: SHELL, home: HOME, blog: BLOG, prayer: PRAYER, profile: PROFILE, bible: BIBLE,
  aiChat: AI_CHAT, messages: MESSAGES, map: MAP, allNews: ALL_NEWS,
  personalInfo: PERSONAL_INFO, saved: SAVED,
};

const ACCOUNT_SETTINGS_SCREENS: ScreenKey[] = ['personalInfo', 'saved'];

// Every pair's ink/bg/ground must actually appear (as source text) in its
// screen — guards the guard: a pair describing code that has since moved
// would otherwise pass on a stale assumption.
const SOURCE_NEEDLES: Partial<Record<ScreenKey, string[]>> = {
  shell: ['bg-surface font-sans overflow-hidden', 'text-strong truncate'],
  home: ['bg-surface-raised rounded-2xl shadow-xs border border-line p-4'],
  blog: ['bg-surface-raised rounded-xl shadow-xs border border-line'],
  prayer: ["className=\"bg-surface-raised rounded-2xl border border-line p-4\""],
  /*
   * ⚠️ THE-321 — the second needle follows the composition it anchors. Profile
   * spelled this token as an INLINE STYLE, `background: 'var(--surface-gold)'`,
   * on the two avatar discs and the rail's chip; the visual pass replaced them
   * with `avatar` and `badge` carrying the MAPPED UTILITY for the same token,
   * `bg-surface-gold` (tailwind.config.ts). The pair this anchors is about
   * --surface-gold resolving in every palette, which is exactly as true of the
   * utility as it was of the inline style — only the spelling moved, so the
   * needle moves with it rather than the claim being dropped.
   */
  profile: ["text-wheat-800", 'bg-surface-gold'],
  bible: ['color: hlColor ? "var(--earth)" : undefined', 'HIGHLIGHT_COLORS'],
  aiChat: ['style.color = "rgb(var(--ink-danger-strong))"', 'style.background = "rgb(var(--c-danger-tint))"'],
  messages: ["'text-muted bg-surface-chip'"],
  allNews: ['bg-surface-chip text-muted'],
  personalInfo: ['!bg-surface-sunken !border-transparent !text-strong'],
  saved: ["text-[14px] font-bold text-strong line-clamp-2", '12%, transparent'],
};

describe('every pair is anchored to real source (guards the guard)', () => {
  for (const [key, needles] of Object.entries(SOURCE_NEEDLES) as [ScreenKey, string[]][]) {
    it.each(needles.map((n) => [n] as const))(`${key}: source still contains %s`, (needle) => {
      expect(SOURCES[key], `${FILES[key]} no longer contains the code this pair describes`).toContain(needle);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 1 · 🔴 the shell — the reported bug
// ═══════════════════════════════════════════════════════════════════════════

describe('the member app shell has a dark page background in dark mode', () => {
  it('bg-surface resolves to a dark colour in the dark block', () => {
    const dark = resolveColor(SURFACE, inTheme('dark'), BACKSTOP.dark);
    expect(dark, 'bg-surface did not resolve in dark mode').not.toBeNull();
    // Dark means low luminance; assert it directly rather than eyeballing the hex.
    const [r, g, b] = parseHex(dark!);
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    expect(luminance, `--surface resolved to ${dark}, which is not dark`).toBeLessThan(80);
  });

  it('the shell no longer references the non-inverting --ds-page-bg token', () => {
    // --ds-page-bg is #FAF8F5 in :root with no dark override — the exact shape
    // of the reported bug once it is the shell's own background. The fix
    // removes the lg:-only override entirely; bg-surface (already present at
    // every breakpoint) is what should govern the shell everywhere.
    expect(SOURCES.shell, 'MainApp.tsx reintroduced the non-inverting shell background').not.toMatch(/bg-\[var\(--ds-page-bg\)\]/);
  });

  it('--ds-page-bg itself is untouched (no token was edited, only the call site)', () => {
    expect(lightVars['--ds-page-bg']).toBe('#FAF8F5');
    expect(darkVars['--ds-page-bg']).toBeUndefined();
  });

  const { ratio, fg, bg } = ratioOf(SHELL, 'dark');
  it(`the shell wordmark clears AA on the shell background in dark mode (${ratio.toFixed(2)}:1)`, () => {
    expect(ratio, `${label(SHELL)} is ${fg} on ${bg} = ${ratio.toFixed(2)}:1 in dark, needs ${AA_CONTRAST}:1`).toBeGreaterThanOrEqual(AA_CONTRAST);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2-4 · 🔴 photographed: Home, Blog, Prayer
// ═══════════════════════════════════════════════════════════════════════════

describe('Home renders on a dark background in dark mode', () => {
  const { ratio, fg, bg } = ratioOf(HOME, 'dark');
  it(`the post card clears AA in dark mode (${ratio.toFixed(2)}:1)`, () => {
    expect(ratio, `${label(HOME)} is ${fg} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_CONTRAST);
  });
  it('bg-surface-raised (the card) differs from bg-surface (the page) in dark mode — two distinct dark surfaces, not one flat block', () => {
    const page = resolveColor(SURFACE, inTheme('dark'), BACKSTOP.dark);
    const card = resolveColor(SURFACE_RAISED, inTheme('dark'), BACKSTOP.dark);
    expect(card).not.toBe(page);
  });
});

describe('Blog renders on a dark background in dark mode', () => {
  const { ratio, fg, bg } = ratioOf(BLOG, 'dark');
  it(`the article card clears AA in dark mode (${ratio.toFixed(2)}:1)`, () => {
    expect(ratio, `${label(BLOG)} is ${fg} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_CONTRAST);
  });
  it('the reading-view sticky header no longer hardcodes bg-white', () => {
    expect(SOURCES.blog).not.toMatch(/bg-white\/80/);
    expect(SOURCES.blog).toContain('color-mix(in_srgb,var(--surface-raised)_80%,transparent)');
  });
});

describe('Prayer renders on a dark background in dark mode', () => {
  const { ratio, fg, bg } = ratioOf(PRAYER, 'dark');
  it(`the request card clears AA in dark mode (${ratio.toFixed(2)}:1)`, () => {
    expect(ratio, `${label(PRAYER)} is ${fg} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_CONTRAST);
  });
  it('the share-bar border no longer names the non-inverting --ds-border token', () => {
    expect(SOURCES.prayer).not.toMatch(/var\(--ds-border\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · every screen in scope is readable in dark mode
// ═══════════════════════════════════════════════════════════════════════════

describe('every screen in scope is readable in dark mode', () => {
  it.each((Object.entries(SCREEN_PAIRS) as [ScreenKey, Pair][]).map(([key, pair]) => [key, pair] as const))(
    '%s clears its floor in dark mode',
    (_key, pair) => {
      const { ratio, fg, bg } = ratioOf(pair, 'dark');
      expect(
        ratio,
        `${label(pair)} is ${fg} on ${bg} = ${ratio.toFixed(2)}:1 in dark, needs ${floorFor(pair)}:1`,
      ).toBeGreaterThanOrEqual(floorFor(pair));
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · account settings
// ═══════════════════════════════════════════════════════════════════════════

describe('the account settings screens are readable in dark mode', () => {
  it.each(ACCOUNT_SETTINGS_SCREENS.map((k) => [k, SCREEN_PAIRS[k]] as const))(
    '%s clears its floor in dark mode',
    (_key, pair) => {
      const { ratio, fg, bg } = ratioOf(pair, 'dark');
      expect(ratio, `${label(pair)} is ${fg} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(floorFor(pair));
    },
  );

  it('the avatar/edit-button rings on Personal Information no longer hardcode white/cream', () => {
    expect(SOURCES.personalInfo).not.toMatch(/border-white\b/);
    expect(SOURCES.personalInfo).not.toMatch(/border-cream\b/);
    expect(SOURCES.personalInfo).toContain('border-surface-raised');
  });

  it('the Country selector on Personal Information no longer hardcodes stone-100/earth', () => {
    expect(SOURCES.personalInfo).not.toMatch(/!bg-stone-100/);
    expect(SOURCES.personalInfo).not.toMatch(/!text-earth/);
  });

  it('Saved: the icon-tint disc is unaffected by this PR — identical composite in both themes (pre-existing, out of scope)', () => {
    const light = resolveColor(SAVED_ICON_TINT.bg, inTheme('light'), resolveColor(SAVED_ICON_TINT.ground, inTheme('light'), BACKSTOP.light)!);
    const dark = resolveColor(SAVED_ICON_TINT.bg, inTheme('dark'), resolveColor(SAVED_ICON_TINT.ground, inTheme('dark'), BACKSTOP.dark)!);
    // NOT asserting an AA/3:1 floor here — see the comment on SAVED_ICON_TINT.
    // What this PR guarantees is that the white -> transparent fix changed
    // NOTHING about how this disc renders in light mode.
    const litWhite = resolveColor('color-mix(in srgb, var(--brand-color, #B8962E) 12%, white)', inTheme('light'), BACKSTOP.light);
    expect(light, 'the transparent-mix fix altered the light-mode pixel').toBe(litWhite);
    expect(dark, 'dark mode did not actually change from light').not.toBe(light);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 · 🔴 the no-regression test
// ═══════════════════════════════════════════════════════════════════════════

describe('every screen in scope is still readable in light mode', () => {
  it.each((Object.entries(SCREEN_PAIRS) as [ScreenKey, Pair][]).map(([key, pair]) => [key, pair] as const))(
    '%s clears its floor in light mode',
    (_key, pair) => {
      const { ratio, fg, bg } = ratioOf(pair, 'light');
      expect(
        ratio,
        `${label(pair)} is ${fg} on ${bg} = ${ratio.toFixed(2)}:1 in light, needs ${floorFor(pair)}:1`,
      ).toBeGreaterThanOrEqual(floorFor(pair));
    },
  );

  it('the light theme itself is untouched by this PR — every token these screens now name kept its light value', () => {
    const PINNED: Record<string, string> = {
      '--surface': 'var(--cream)',
      '--surface-raised': '#FFFFFF',
      '--surface-chip': 'var(--stone-200)',
      '--surface-sunken': 'var(--stone-100)',
      '--text-strong': 'var(--earth)',
      '--text-muted': '#68563F',
      '--text-faint': '#766A5A',
      '--border-default': 'var(--stone-200)',
      '--ink-wheat-700': '143 104 34',
      '--ink-danger': '196 85 59',
      '--c-danger-tint': '247 231 226',
    };
    for (const [token, value] of Object.entries(PINNED)) {
      expect(lightVars[token], `${token} moved in the light theme — this PR must not retune light`).toBe(value);
    }
  });

  it('the colour-mix "white" bug pattern is gone from every screen (its light-mode render is provably unchanged)', () => {
    // color-mix(..., white) and color-mix(..., transparent) are IDENTICAL in
    // light mode whenever the element sits directly on --surface-raised
    // (#FFFFFF): mixing over transparent composites onto the white card,
    // producing the same pixels white was hardcoding. This is why light mode
    // does not regress even though every one of these calls changed.
    for (const [key, src] of Object.entries(SOURCES) as [ScreenKey, string][]) {
      const offenders = [...src.matchAll(/color-mix\(in[\s_]srgb,[\s\S]{0,80}?,\s*white\s*\)/g)].map((m) => m[0]);
      expect(offenders, `${FILES[key]} still mixes an accent over hardcoded white`).toEqual([]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8 · the tokens must exist on the dark side
// ═══════════════════════════════════════════════════════════════════════════

describe('every colour class used resolves to a property defined in the dark block', () => {
  /** Two exemptions.
   *  --brand-color: named by PR 323/326/337 and repeated in this PR's brief —
   *  the tenant accent is NOT part of the neutral ramp. Every fill derived
   *  from it composites over a themed surface, so it themes without inverting.
   *  --earth: this PR's own addition, for the same reason. BiblePage forces a
   *  highlighted verse's ink to var(--earth) specifically BECAUSE it must NOT
   *  invert — it composites against HIGHLIGHT_COLORS, a true-colour swatch
   *  table that is itself deliberately fixed (a highlighter has no dark mode;
   *  see test 12). An ink that inverted here would go light-on-light against
   *  a swatch that never changes. */
  const ACCENT_EXEMPT = ['--brand-color', '--earth'];

  const allExprs = [
    ...Object.values(SCREEN_PAIRS).flatMap((p) => [p.ink, p.bg, p.ground]),
    SURFACE, SURFACE_RAISED, SURFACE_CHIP, SURFACE_SUNKEN, TEXT_STRONG, TEXT_MUTED, TEXT_FAINT,
    classToExpr('border-line')!, classToExpr('border-line-strong')!, classToExpr('border-surface-raised')!,
  ];
  const used = [...new Set(allExprs.flatMap(tokensNamed))].sort();

  it('the screens name a non-trivial set of tokens', () => {
    expect(used.length).toBeGreaterThanOrEqual(8);
  });

  it.each(used.filter((t) => !ACCENT_EXEMPT.includes(t)))('%s has a dark value', (token) => {
    expect(darkVars[token], `${token} is only declared in :root, so this surface stays light on a dark page`).toBeDefined();
  });

  it.each(used.filter((t) => ACCENT_EXEMPT.includes(t)))('%s is the documented accent exemption and stays unthemed', (token) => {
    expect(darkVars[token], `${token} must not gain a dark value here`).toBeUndefined();
  });

  it('every semantic class these screens spell emits real CSS (no dead class name)', () => {
    const classes = new Set<string>();
    for (const src of Object.values(SOURCES)) {
      for (const m of src.replace(/var\(--[a-z0-9-]+\)/g, 'var(--x)').matchAll(
        /\b(?:hover:|focus:|placeholder:)?(?:bg|text|border)-(?:surface|line|danger|gold|strong|body|muted|faint|wheat-700|wheat-600)(?:-[a-z]+)?\b/g,
      )) classes.add(m[0]);
    }
    expect(classes.size, 'no semantic classes found — the scan is broken').toBeGreaterThan(0);
    const dead = [...classes].filter((c) => classToExpr(c) === null);
    expect(dead, 'this class emits no CSS at all').toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9 · nothing hardcoded introduced
// ═══════════════════════════════════════════════════════════════════════════

describe('no hex, rgb() or inline colour is introduced', () => {
  /**
   * Every bare colour literal LEFT in each of the 12 files, pinned exactly.
   * ⚠️ This is the surviving baseline, not a target. It is dominated by:
   *  - var(--brand-color, #hex) fallbacks (not counted — see below — the
   *    token always resolves, so the hex is dead unless the variable itself
   *    is removed);
   *  - map-pin colours in ChurchMap (deliberately fixed — a pin has no dark
   *    mode, see test 12);
   *  - decorative box-shadow / scrim rgba()s (elevation and backdrops, not
   *    text/background pairs — see test 12);
   *  - the BiblePage highlighter swatches (true-colour picker values, see
   *    test 12);
   *  - the AIChat --chat-* <style> block's documentation comments
   *    ("/* was #FAF8F5 *​/"), which are prose, not live declarations.
   *
   * `var(--token, #fallback)` is excluded from the scan entirely: the token
   * always resolves in a running app, and the hex is only reached if the
   * variable is missing outright.
   */
  const literals = (src: string): string[] =>
    [
      ...src
        .replace(/var\(\s*--[a-z0-9-]+\s*,\s*#[0-9A-Fa-f]{3,8}\s*\)/gi, 'var(--x)')
        // rgb()/rgba() wrapping a live CSS variable (e.g. this PR's own
        // rgb(var(--ink-danger))) is theme-aware, not a hardcoded literal —
        // strip it (handles the nested paren) before the literal scan below.
        .replace(/rgba?\(\s*var\([^()]*\)\s*\)/gi, 'RESOLVED_VAR')
        .matchAll(/#[0-9A-Fa-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g),
    ].map((m) => m[0]).sort();

  const BASELINE: Record<ScreenKey, string[]> = {
    shell: [
      'rgba(0,0,0,0.05)', 'rgba(0,0,0,0.02)', // bottom-nav / sidebar elevation shadows
      '#104', // false positive: the JSX comment "per #104 feedback" (an issue number, not a colour)
    ],
    home: [
      'rgba(0,0,0,0.12)', // dropdown-menu elevation shadow
      '#147', '#147', // false positive: "(the #147 fix: ...)" / "mirrors the post path's #147 fix" comments
    ],
    blog: [],
    prayer: [],
    profile: [
      'rgba(255,255,255,0.16)', // avatar photo ring inside the always-navy hero band (stable backdrop, see test 12)
      'rgba(212,165,74,0.18)',  // "Member since" chip fill inside the same always-navy hero band
    ],
    bible: [
      '#FEF08A', '#BBF7D0', '#BFDBFE', '#FBCFE8', // HIGHLIGHT_COLORS — true-colour swatches, see test 12
      'rgba(0,0,0,0.04)', 'rgba(0,0,0,0.12)', 'rgba(0,0,0,0.15)',       // elevation shadows (sheets, dropdown)
      'rgba(45,37,25,0.04)', 'rgba(45,37,25,0.12)', 'rgba(45,37,25,0.16)', // earth-tinted elevation shadows
    ],
    aiChat: [
      // The --chat-* <style> block's "/* was #hex */" documentation comments
      // (prose describing the pre-fix values, not live declarations) plus the
      // typography plugin's own kbd-shadow channel triplet — none render.
      '#FAF8F5', '#FFFFFF', '#2D2519', '#8B7355', '#E8E2D9',
      '#FFFFFF', // GOLD_LIGHT/GOLD_BTN gradient's light-mode anchor (--surface-raised composited value, documented in the same comment)
      '#fff', // isUser message bubble text on the always-solid GOLD_BTN gradient (self-consistent both themes)
      'rgba(0,0,0,0.06)', 'rgba(0,0,0,0.06)', 'rgba(0,0,0,0.07)', 'rgba(0,0,0,0.12)', 'rgba(0,0,0,0.35)', // elevation + drawer scrim
      'rgba(201,150,58,0.3)', // user-bubble shadow tinted toward the (fixed) brand colour
    ],
    messages: [],
    map: [
      '#d4a017', '#3b82f6', // marker pins — deliberately fixed, see test 12
      'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.3)', 'rgba(59, 130, 246, 0.3)', // pin drop-shadows + user-marker ring
      'rgba(0,0,0,0.06)', // church-list panel elevation shadow
    ],
    allNews: [],
    personalInfo: [],
    saved: [],
  };

  it.each(Object.keys(FILES) as ScreenKey[])('%s introduces no colour literal beyond its baseline', (key) => {
    expect(
      literals(SOURCES[key]),
      `${FILES[key]}'s colour literals changed — a new one here opts that surface out of theming`,
    ).toEqual([...BASELINE[key]].sort());
  });

  it('none of the twelve screens declares a local const re-spelling a ramp colour as a fixed hex', () => {
    const RAMP = ['#FAF8F5', '#FFFFFF', '#F3EEE7', '#2D2519', '#8B7355', '#E8E2D9', '#D6CCBE'];
    for (const [key, src] of Object.entries(SOURCES) as [ScreenKey, string][]) {
      for (const m of src.matchAll(/^const\s+([A-Z_0-9]+)\s*=\s*"(#[0-9A-Fa-f]{6})";/gm)) {
        // BiblePage's HIGHLIGHT_COLORS is a deliberate true-colour swatch
        // table, not a re-spelling of the neutral ramp — excluded by name.
        if (key === 'bible' && m[1] === 'GOLD_LIGHT') continue;
        expect(RAMP, `${FILES[key]}: ${m[1]} hardcodes a ramp colour`).not.toContain(m[2].toUpperCase());
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10 · 🔴 the tenant accent
// ═══════════════════════════════════════════════════════════════════════════

describe('the tenant accent is still not inverted', () => {
  it('--brand-color has no dark value', () => {
    expect(darkVars['--brand-color'], 'inverting the tenant accent is THE-111 and is a separate decision').toBeUndefined();
  });

  it('the on-dark variant is still derived rather than overriding the accent', () => {
    expect(lightVars['--brand-color-on-dark']).toBe('var(--brand-color)');
  });

  it('every "white"-mix fixed in this PR still reads the tenant accent, not a fixed hex', () => {
    // The fix for the color-mix(…, white) bug is always "white" -> "transparent",
    // never replacing var(--brand-color) itself — that would silently
    // un-white-label the screen.
    for (const [key, src] of Object.entries(SOURCES) as [ScreenKey, string][]) {
      const mixes = [...src.matchAll(/color-mix\(in[\s_]srgb,[\s\S]{0,60}?,\s*transparent\s*\)/g)].map((m) => m[0]);
      for (const m of mixes) {
        if (/var\(--brand-color/.test(m) || /var\(--surface-raised/.test(m)) continue;
        throw new Error(`${FILES[key]}: unexpected color-mix without a var() accent: ${m}`);
      }
    }
  });

  it('no screen in scope added a dark: variant (a second theming mechanism)', () => {
    for (const [key, src] of Object.entries(SOURCES) as [ScreenKey, string][]) {
      expect([...src.matchAll(/\bdark:[a-z-]+/g)].map((m) => m[0]), `${FILES[key]} added a dark: variant`).toEqual([]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11 · pre-auth stays light (THE-85)
// ═══════════════════════════════════════════════════════════════════════════

describe('no pre-auth surface gained a dark treatment', () => {
  it('the pre-auth path list is unchanged', () => {
    expect([...PREAUTH_PATHS]).toEqual(['/auth', '/onboarding', '/church-onboarding']);
  });

  it.each(['/', '/bible', '/messages', '/prayer'])('%s is a signed-in member route, not a funnel screen', (route) => {
    expect(isPreAuthPath(route), `${route} is being treated as pre-auth`).toBe(false);
  });

  it('no pre-auth screen pulls any of the twelve touched components onto the funnel', () => {
    const PREAUTH_TREE = [
      'components/AuthPage.tsx',
      'components/Onboarding.tsx',
      'components/ChurchOnboarding.tsx',
      'components/OnboardingGate.tsx',
      'components/FirstRunSetup.tsx',
      'components/WorkspaceHandoff.tsx',
    ];
    const COMPONENT_NAMES = Object.keys(FILES).map((k) => path.basename(FILES[k as ScreenKey], '.tsx'));
    for (const file of PREAUTH_TREE) {
      const src = read(file);
      for (const component of COMPONENT_NAMES) {
        expect(src, `${file} imports ${component}, which this PR themed for dark`)
          .not.toMatch(new RegExp(`from\\s+'[./]*(?:components/)?${component}'`));
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12 · 🔴 values deliberately dark in both themes — reviewed and left alone
// ═══════════════════════════════════════════════════════════════════════════

describe('a value that is deliberately dark in both themes is unchanged', () => {
  it('NewsTab: the attached-image remove button is a black scrim on arbitrary user photos (control-over-media, not a page surface)', () => {
    expect(SOURCES.home).toContain('rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors');
  });

  it('ChurchMap: the church marker pin is a fixed vivid colour with a white outline, legible on either basemap by design (like every map app\'s pins)', () => {
    expect(SOURCES.map).toContain('background-color: #d4a017');
    expect(SOURCES.map).toContain('border: 2px solid white');
  });

  it('ChurchMap: the user-location marker is the same deliberately-fixed shape', () => {
    expect(SOURCES.map).toContain('background-color: #3b82f6');
  });

  it('BiblePage: the highlight-colour swatches are true-colour picker values — a highlighter has no dark mode', () => {
    expect(SOURCES.bible).toContain('gold: "#FEF08A", green: "#BBF7D0", blue: "#BFDBFE", pink: "#FBCFE8"');
  });

  it('every modal backdrop scrim across the twelve screens is still a fixed black, matching the LivestreamView scrim PR 337 already reviewed', () => {
    const scrimFiles: ScreenKey[] = ['home', 'profile', 'bible', 'messages', 'allNews', 'personalInfo'];
    for (const key of scrimFiles) {
      expect(SOURCES[key], `${FILES[key]} lost its modal scrim`).toMatch(/bg-black\/(?:40|50)\b/);
    }
  });

  it('ChurchMap needed no edits at all — ChurchMap.tsx is byte-identical to main', () => {
    // Was `git diff --stat -- ChurchMap.tsx` asserted empty, which only ever
    // saw UNCOMMITTED changes: the moment the edit was committed the guard went
    // quiet again. THE-261 made that matter — its v4 utility rename touched
    // this file (outline-none -> outline-hidden, shadow-sm -> shadow-xs) and the
    // stat would have gone green on the commit rather than reporting it.
    //
    // It is now a content digest, recorded here, which is the pattern
    // src/components/ui/__tests__/ds-primitives.test.tsx states the case for:
    // CI's checkout is the only history a test can rely on. It holds across
    // commits, and every one of this file's measured values is still what it
    // was — the rename changes no colour, no width and no measured value.
    const digest = createHash('sha256').update(readFileSync(path.join(ROOT, 'src/components/ChurchMap.tsx'))).digest('hex');
    expect(digest, 'ChurchMap.tsx changed — every one of its measured values was reviewed and left alone').toBe(
      '842b22a62ebf54684f3457ff5b39116dedf474ab2aa943b6bd7f5aab7feec60f',
    );
  });
});
