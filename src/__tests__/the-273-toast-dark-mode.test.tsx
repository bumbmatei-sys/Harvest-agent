import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import postcss from 'postcss';
import { toast } from 'sonner';
import {
  THEME_STORAGE_KEY,
  FAMILY_STORAGE_KEY,
  DEFAULT_PALETTE_FAMILY,
  THEME_CHOICES,
  contrastRatio,
  AA_CONTRAST,
  DARK_SURFACE_RAISED,
  CLASSIC_DARK_SURFACE_RAISED,
  type PaletteFamily,
  type ThemeChoice,
} from '../lib/theme';
import { PREAUTH_PATHS } from '../lib/preauth-theme';
import { useTheme } from '../lib/use-theme';
import { Toaster } from '../components/ui/sonner';

/**
 * THE-273 — the toast follows the app's theme, and `next-themes` is gone.
 *
 * ─── the defect ────────────────────────────────────────────────────────────
 *
 * `src/components/ui/sonner.tsx` hard-coded `theme = "light"`, and said why in
 * its own docblock: "the app ships light-only (there is no ThemeProvider
 * anywhere…)". That was accurate when written, and the light default was the
 * RIGHT call then — shadcn's own "system" would have handed sonner the OS
 * preference and rendered dark toasts over a light-only UI.
 *
 * Dark mode has since landed in four palettes and `<Toaster />` is mounted in
 * layout.tsx, i.e. app-wide: every success, error and confirmation toast in
 * both the admin and the member app. Classic has been the default family since
 * #409, so the common dark-mode case is a white toast on a #1C1C1C page. The
 * comment describing a light-only app outlived the app being light-only, which
 * is the most expensive kind of stale comment: it read as a justification.
 *
 * ─── the fix ───────────────────────────────────────────────────────────────
 *
 * THE-271 (#415) shipped `src/lib/use-theme.ts`, a next-themes-shaped read of
 * what the pre-paint script already stamped on <html>. It never stamps and
 * never writes on read, so this is a change of import specifier, not a second
 * theme system. Section 8 pins that file byte-identical: THE-273 adopts it, it
 * does not edit it.
 *
 * 🔴 ONE DIVERGENCE FROM next-themes IS LOAD-BEARING HERE, and section 4 is
 * about nothing else: the shim's `theme` is the RESOLVED theme, never the
 * string "system". sonner passes `theme` straight through and resolves
 * "system" against `matchMedia` ITSELF — so handing it "system" makes the toast
 * follow the OS rather than the app. That is the original bug wearing a new
 * costume, and on the THE-85 pre-auth funnel (where a stored 'dark' is forced
 * to light) it would put a dark toast on a forced-light sign-in page.
 *
 * ⚠️ `palette` IS DELIBERATELY NOT READ, and section 2 is the evidence rather
 * than the assertion. The toast's three colours are `var()` references to
 * Harvest tokens, and `var()` is late-bound: it resolves in the scope of the
 * element that reads it, and <html> already carries data-palette. So all four
 * palettes fall through the cascade with the component knowing only the MODE.
 * Section 2 proves the fall-through actually produces four distinct, correct
 * colour sets rather than assuming it.
 *
 * ⚠️ AND THIS FILE HAS FAILED INVISIBLY ONCE ALREADY. Its own docblock records
 * it: the shadcn defaults (--popover, --popover-foreground, --border, --radius)
 * were not defined in this app's globals.css, so each made its custom property
 * invalid at computed-value time, dropping the declaration that consumed it
 * back to `unset` — a transparent, borderless, square-cornered toast, with no
 * CSS error anywhere. Section 5 is the guard against a repeat, and it reads the
 * var() references OUT OF THE RENDERED STYLE ATTRIBUTE rather than from a list
 * typed here, so pointing a colour at a token that does not exist fails it.
 *
 * ⚠️ No `git show` anywhere: every pin below reads the working tree and
 * compares against a digest recorded in this file, so a shallow CI clone
 * cannot change the result.
 */

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');
const GLOBALS_CSS = readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8');
const SONNER_SRC = readFileSync(path.join(SRC, 'components/ui/sonner.tsx'), 'utf8');
/** ⚠️ sonner.tsx QUOTES the wording and the cast it removed, so that a reader
 *  arriving at the file learns what changed and why. Every negative source
 *  assertion below therefore runs against the code with `//` comments stripped
 *  — otherwise the file's own record of the bug would read as the bug. */
const SONNER_CODE = SONNER_SRC.replace(/^\s*\/\/[^\n]*$/gm, '');

const sha256 = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

const digestOf = (rel: string): string => sha256(readFileSync(path.join(ROOT, rel)));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ── the cascade, resolved the way a browser would ──────────────────────────
 * Same `varsIn` / `resolveVar` / `scopeFor` shape as theming-stage3,
 * theming-classic-palette and the-271-one-theme-system, on purpose: a second
 * implementation would drift from the one the palette tickets are checked by. */

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

const ROOT_VARS = varsIn(GLOBALS_CSS, (s) => s === ':root');
const HARVEST_DARK_VARS = varsIn(
  GLOBALS_CSS,
  (s) => /\.dark|\[data-theme="dark"\]/.test(s) && !s.includes('data-palette'),
);
const CLASSIC_LIGHT_VARS = varsIn(
  GLOBALS_CSS,
  (s) => s.includes('data-palette="classic"') && s.includes('data-theme="light"'),
);
const CLASSIC_DARK_VARS = varsIn(
  GLOBALS_CSS,
  (s) => s.includes('data-palette="classic"') && (s.includes('.dark') || s.includes('data-theme="dark"')),
);

function scopeFor(theme: 'light' | 'dark', family: PaletteFamily): Record<string, string> {
  const scope = { ...ROOT_VARS };
  if (theme === 'dark') Object.assign(scope, HARVEST_DARK_VARS);
  if (family === 'classic') {
    Object.assign(scope, theme === 'dark' ? CLASSIC_DARK_VARS : CLASSIC_LIGHT_VARS);
  }
  return scope;
}

/**
 * 🔴 The whole invisible-toast failure mode lives in this function's return of
 * `null`.
 *
 * A browser resolving `background: var(--normal-bg)` where `--normal-bg` is
 * `var(--nope)` and `--nope` is declared nowhere does NOT fall back to the
 * previous background: the substitution makes the declaration invalid at
 * computed-value time and it becomes `unset`. Nothing is logged. So "does this
 * chain terminate in a literal?" is exactly the question, and an unterminated
 * chain must be distinguishable from an empty one — hence `null` rather than
 * the `''` the sibling suites return, which a `toMatch` would report as an
 * unhelpful empty-string mismatch.
 */
function resolveVar(value: string, scope: Record<string, string>, depth = 0): string | null {
  if (depth > 20) return null;
  const ref = value.trim().match(/^var\(\s*(--[a-zA-Z0-9-]+)\s*\)$/);
  if (!ref) return value.trim() || null;
  const next = scope[ref[1]];
  if (next === undefined) return null;
  return resolveVar(next, scope, depth + 1);
}

/* ── the four palettes, Classic first (it is the default since #409) ─────── */

interface Palette {
  name: string;
  theme: 'light' | 'dark';
  family: PaletteFamily;
  /** Spelled as the theme.ts constant where one exists, so this suite cannot
   *  drift from the ground deriveOnDarkAccent's AA guarantee is measured on. */
  raised?: string;
}

const PALETTES: readonly Palette[] = [
  { name: 'Classic light', theme: 'light', family: 'classic' },
  { name: 'Classic dark', theme: 'dark', family: 'classic', raised: CLASSIC_DARK_SURFACE_RAISED },
  { name: 'Harvest light', theme: 'light', family: 'harvest' },
  { name: 'Harvest dark', theme: 'dark', family: 'harvest', raised: DARK_SURFACE_RAISED },
];

/* ── React mounting ──────────────────────────────────────────────────────── */

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

const stampHtml = (theme: 'light' | 'dark', family: PaletteFamily) => {
  const el = document.documentElement;
  el.setAttribute('data-theme', theme);
  el.setAttribute('data-palette', family);
  el.classList.toggle('dark', theme === 'dark');
};

const setOsPrefersDark = (dark: boolean) => {
  window.matchMedia = ((q: string) => ({
    matches: /prefers-color-scheme:\s*dark/.test(q) ? dark : false,
    media: q,
    onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
};

beforeEach(() => {
  localStorage.clear();
  const el = document.documentElement;
  el.removeAttribute('data-theme');
  el.removeAttribute('data-palette');
  el.classList.remove('dark');
  setOsPrefersDark(false);
});

afterEach(async () => {
  await act(async () => { toast.dismiss(); });
  for (const m of mounted.splice(0)) {
    await act(async () => { m.root.unmount(); });
    m.container.remove();
  }
});

const mount = async (node: React.ReactElement): Promise<HTMLDivElement> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    const root = createRoot(container);
    mounted.push({ root, container });
    root.render(node);
  });
  return container;
};

/** sonner appends its list on a macrotask, so draining microtasks is not
 *  enough — the same wait `sonner.test.tsx` uses, and for the same reason. */
const showToast = async (message = 'Exported as PDF') => {
  await act(async () => { toast.success(message); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

/** Mount the real wrapper, raise a real toast, and hand back sonner's own
 *  element — `data-sonner-theme` on it is the theme sonner ACTUALLY applied. */
const mountToasterAndToast = async (): Promise<HTMLElement> => {
  const container = await mount(<Toaster />);
  await showToast();
  const list = container.querySelector('[data-sonner-toaster]');
  expect(list, 'sonner rendered no toaster element').not.toBeNull();
  return list as HTMLElement;
};

/** What the wrapper passes to sonner, captured from the same hook call the
 *  wrapper makes. Paired with the source assertion in section 4 that the
 *  wrapper does `theme={theme}` and nothing else to it. */
const ThemeProbe: React.FC = () => {
  const { theme, palette } = useTheme();
  return <span data-theme={theme} data-palette={palette} />;
};

const probe = async (): Promise<{ theme: string; palette: string }> => {
  const c = await mount(<ThemeProbe />);
  const el = c.querySelector('span')!;
  return { theme: el.getAttribute('data-theme')!, palette: el.getAttribute('data-palette')! };
};

// ═══════════════════════════════════════════════════════════════════════════
// 1 · 🔴 THE WHOLE TICKET: the toast is dark in dark mode
// ═══════════════════════════════════════════════════════════════════════════

describe('1 — the toast is dark in dark mode', () => {
  it('🔴 a dark page gets a DARK toast, which is the defect this ticket fixes', async () => {
    // Classic dark: the default family since #409, i.e. the case a dark-mode
    // user actually hits. Before this ticket the wrapper hard-coded "light"
    // and this attribute read 'light' on a #1C1C1C page.
    stampHtml('dark', 'classic');
    const list = await mountToasterAndToast();
    expect(
      list.getAttribute('data-sonner-theme'),
      'a white toast is landing on the dark page — sonner was handed "light"',
    ).toBe('dark');
  });

  it('and a light page still gets a LIGHT toast — the fix is not an inversion', async () => {
    stampHtml('light', 'classic');
    const list = await mountToasterAndToast();
    expect(list.getAttribute('data-sonner-theme')).toBe('light');
  });

  it('🔴 it tracks a LIVE theme change, because the shim watches the stamp', async () => {
    // applyTheme writes <html> directly rather than through React, so a toast
    // already on screen when someone flips the toggle would otherwise keep the
    // theme it mounted with.
    stampHtml('light', 'classic');
    const list = await mountToasterAndToast();
    expect(list.getAttribute('data-sonner-theme')).toBe('light');

    await act(async () => { stampHtml('dark', 'classic'); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(
      list.getAttribute('data-sonner-theme'),
      'the toast kept its mount-time theme after <html> was restamped',
    ).toBe('dark');
  });

  it('the stale "light-only" justification no longer stands as a current claim', () => {
    // That comment is why this shipped wrong for as long as it did: it read as
    // a justification rather than as a fact with an expiry date. It is still
    // QUOTED in the file — deliberately, as the history of a decision that was
    // right when it was made — but only inside THE-273's correction of it, and
    // the code it justified is gone.
    expect(
      /theme\s*=\s*['"]light['"]/.test(SONNER_CODE),
      'sonner.tsx still hard-codes a light default',
    ).toBe(false);
    expect(SONNER_CODE, 'sonner.tsx still reaches for next-themes').not.toContain('next-themes');
    expect(
      SONNER_SRC,
      'the light-only wording is quoted in the file without THE-273 correcting it',
    ).toContain('THE-273');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · the toast renders correctly in all four palettes — Classic FIRST
//
//     ⚠️ This is also the answer to "does the toast need `palette`?". It does
//     not: the component reads only the MODE, and the four correct colour sets
//     below are produced by the cascade under it.
// ═══════════════════════════════════════════════════════════════════════════

describe('2 — the toast renders correctly in all four palettes', () => {
  it('Classic is still the default family, so it is the palette checked first', () => {
    expect(DEFAULT_PALETTE_FAMILY).toBe('classic');
  });

  for (const p of PALETTES) {
    it(`${p.name}: sonner is handed the right MODE for this stamp`, async () => {
      stampHtml(p.theme, p.family);
      const list = await mountToasterAndToast();
      expect(list.getAttribute('data-sonner-theme')).toBe(p.theme);
      // And the shim reports the family correctly even though the toast never
      // asks for it — the axis exists, this component simply does not need it.
      expect((await probe()).palette).toBe(p.family);
    });

    it(`${p.name}: the toast's three colours resolve to this palette's own values`, () => {
      const scope = scopeFor(p.theme, p.family);
      const bg = resolveVar('var(--surface-raised)', scope);
      const fg = resolveVar('var(--text-body)', scope);
      const border = resolveVar('var(--border-default)', scope);

      for (const [role, value] of [['--normal-bg', bg], ['--normal-text', fg], ['--normal-border', border]] as const) {
        expect(value, `${p.name}: ${role} does not resolve to a literal colour`).toMatch(
          /^#[0-9a-fA-F]{3,8}$/,
        );
      }
      if (p.raised) {
        expect(bg, `${p.name}: the toast ground drifted from the theme.ts constant`).toBe(p.raised);
      }
    });
  }

  it('🔴 the four are genuinely four — no two palettes paint the same toast', () => {
    const sets = PALETTES.map((p) => {
      const s = scopeFor(p.theme, p.family);
      return [
        resolveVar('var(--surface-raised)', s),
        resolveVar('var(--text-body)', s),
        resolveVar('var(--border-default)', s),
      ].join('/');
    });
    // Classic light and Harvest light share #FFFFFF as the toast GROUND — the
    // families differ there in text and border, not in the raised surface — so
    // the distinctness claim is about the whole set, and saying which is what
    // makes this test honest rather than lucky.
    expect(new Set(sets).size, `two palettes paint an identical toast: ${sets.join(' | ')}`).toBe(4);
  });

  it('⚠️ and the component reads the MODE only — `palette` is never destructured', () => {
    // The fall-through is a property of `var()` being late-bound, so a toast
    // that branched on the family would be four copies of one behaviour AND
    // would stop tracking a family added later.
    expect(SONNER_CODE).toContain('const { theme } = useTheme()');
    expect(/\bpalette\b\s*[,}]/.test(SONNER_CODE), 'sonner.tsx destructured `palette`').toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · 🔴 the toast's foreground clears AA on its OWN ground, × 4 palettes
//
//     Its own ground, not the page's: --normal-bg is --surface-raised, so the
//     toast paints on a surface a step above the page and the page's own
//     text/ground ratio does not cover it.
// ═══════════════════════════════════════════════════════════════════════════

describe('3 — the toast foreground clears AA on its own ground', () => {
  /** The floors the system already holds itself to: 5.66:1 (THE-263) and
   *  5.69:1 (THE-267). Both are well above AA's 4.5, and the toast is checked
   *  against the stricter of the two as well as against AA itself. */
  const SYSTEM_FLOOR = 5.69;

  for (const p of PALETTES) {
    it(`${p.name}: --text-body on --surface-raised clears AA`, () => {
      const scope = scopeFor(p.theme, p.family);
      const bg = resolveVar('var(--surface-raised)', scope)!;
      const fg = resolveVar('var(--text-body)', scope)!;
      const ratio = contrastRatio(fg, bg);
      expect(
        ratio,
        `${p.name}: toast text ${fg} on toast ground ${bg} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA_CONTRAST);
      expect(
        ratio,
        `${p.name}: ${ratio.toFixed(2)}:1 is below the floor the rest of the system holds`,
      ).toBeGreaterThanOrEqual(SYSTEM_FLOOR);
    });
  }

  it('🔴 every measured ratio, recorded — a token moving here re-opens the question', () => {
    // Pinned to 2dp rather than left as ">= 4.5". A token whose value moves
    // silently changes a number in this list, and the PR that moved it should
    // have to say so.
    const measured = Object.fromEntries(
      PALETTES.map((p) => {
        const s = scopeFor(p.theme, p.family);
        return [
          p.name,
          contrastRatio(resolveVar('var(--text-body)', s)!, resolveVar('var(--surface-raised)', s)!).toFixed(2),
        ];
      }),
    );
    expect(measured).toEqual({
      'Classic light': '10.37',
      'Classic dark': '9.67',
      'Harvest light': '10.09',
      'Harvest dark': '10.02',
    });
  });

  it('the toast is also distinguishable FROM the page it sits on', () => {
    // AA does not cover this: a toast whose ground equals the page ground is
    // perfectly readable and completely invisible as a toast. The border is
    // what carries the edge, so both are checked.
    for (const p of PALETTES) {
      const s = scopeFor(p.theme, p.family);
      const page = resolveVar('var(--surface)', s)!;
      const raised = resolveVar('var(--surface-raised)', s)!;
      const border = resolveVar('var(--border-default)', s)!;
      expect(raised, `${p.name}: the toast ground equals the page ground`).not.toBe(page);
      expect(border, `${p.name}: the toast border equals its own ground`).not.toBe(raised);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · 🔴 sonner receives the RESOLVED theme, NEVER "system"
//
//     sonner resolves "system" against matchMedia ITSELF, so "system" does not
//     mean "ask the app" — it means "ask the OS", which is the bug.
// ═══════════════════════════════════════════════════════════════════════════

describe('4 — sonner receives the resolved theme, never "system"', () => {
  it('🔴 no stored choice — "system" included — makes the shim yield "system"', async () => {
    for (const choice of THEME_CHOICES as readonly ThemeChoice[]) {
      localStorage.setItem(THEME_STORAGE_KEY, choice);
      localStorage.setItem(FAMILY_STORAGE_KEY, 'classic');
      stampHtml('dark', 'classic');
      const { theme } = await probe();
      expect(theme, `a stored '${choice}' reached sonner as '${theme}'`).not.toBe('system');
      expect(['light', 'dark']).toContain(theme);
    }
    // 'system' really is among the choices being exercised, or the loop above
    // proves nothing.
    expect(THEME_CHOICES).toContain('system');
  });

  it('🔴 a dark OS does NOT darken the toast on a light page — the OS-following bug', async () => {
    // The exact failure "system" would produce, driven end to end through the
    // real sonner: it computes actualTheme from matchMedia when handed
    // "system", so this attribute would read 'dark' over a light UI.
    setOsPrefersDark(true);
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    stampHtml('light', 'classic');
    const list = await mountToasterAndToast();
    expect(
      list.getAttribute('data-sonner-theme'),
      'the toast followed the OS instead of the app',
    ).toBe('light');
  });

  it('🔴 and on the THE-85 pre-auth funnel, where dark is FORCED to light', async () => {
    // The costliest case: a stored 'dark' that the funnel deliberately renders
    // light. "system" or the stored choice would both put a dark toast on the
    // sign-in page. Only the RESOLVED theme gets this right.
    expect(PREAUTH_PATHS.length, 'there are no pre-auth paths to force').toBeGreaterThan(0);
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    setOsPrefersDark(true);
    stampHtml('light', DEFAULT_PALETTE_FAMILY); // what the pre-paint script stamps on /auth
    const list = await mountToasterAndToast();
    expect(
      list.getAttribute('data-sonner-theme'),
      'a dark toast landed on the forced-light sign-in page',
    ).toBe('light');
  });

  it('the wrapper passes the hook value straight through, with no cast to widen it', () => {
    // A cast is how "system" would get back in without a type error: the hook
    // returns 'light' | 'dark', which assigns to sonner's 'light' | 'dark' |
    // 'system' on its own, so the absence of the cast is what makes a widened
    // return type a compile failure here rather than a silent behaviour change.
    expect(SONNER_CODE).toContain('theme={theme}');
    expect(SONNER_CODE, 'a cast is back — it is how "system" would return silently').not.toContain(
      'as ToasterProps["theme"]',
    );
    expect(SONNER_CODE).not.toMatch(/theme\s*=\s*\{[^}]*['"]system['"]/);
    expect(SONNER_CODE).toContain('from "@/lib/use-theme"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · 🔴 NO TOAST COLOUR RESOLVES TO `unset`
//
//     The failure this file already suffered once, and the one that ships
//     silently: an undefined var makes the custom property invalid at
//     computed-value time, the consuming declaration drops to `unset`, and the
//     toast is transparent, borderless and square — with no error anywhere.
// ═══════════════════════════════════════════════════════════════════════════

describe('5 — no toast colour resolves to unset', () => {
  /** 🔴 Read OUT OF the rendered element, never typed here. A list typed in
   *  this file would keep passing after the component was pointed at something
   *  undefined, which is the whole failure mode. */
  const renderedStyle = async (): Promise<Record<string, string>> => {
    const list = await mountToasterAndToast();
    const raw = list.getAttribute('style') || '';
    const out: Record<string, string> = {};
    for (const part of raw.split(';')) {
      const i = part.indexOf(':');
      if (i < 0) continue;
      const prop = part.slice(0, i).trim();
      if (prop.startsWith('--')) out[prop] = part.slice(i + 1).trim();
    }
    return out;
  };

  it('🔴 the wrapper actually sets its four custom properties, as token references', async () => {
    // The control for this whole section. sonner sets its own geometry vars on
    // the same element (--width, --gap, --offset-*), so "the style attribute is
    // non-empty" proves nothing; what must be there is the four the WRAPPER
    // contributes. And the three colours must still be var() CHAINS: replace
    // one with a literal hex and every resolution assertion below would pass
    // while having resolved nothing.
    const style = await renderedStyle();
    for (const prop of ['--normal-bg', '--normal-text', '--normal-border', '--border-radius']) {
      expect(style[prop], `the wrapper stopped setting ${prop}`).toBeDefined();
    }
    for (const prop of ['--normal-bg', '--normal-text', '--normal-border']) {
      expect(
        style[prop],
        `${prop} is no longer a token reference, so section 5 would resolve nothing`,
      ).toMatch(/^var\(--[a-z0-9-]+\)$/);
    }
  });

  it('🔴 every var() the toast references resolves to a literal, in all four palettes', async () => {
    const style = await renderedStyle();
    for (const p of PALETTES) {
      const scope = scopeFor(p.theme, p.family);
      for (const [prop, value] of Object.entries(style)) {
        const resolved = resolveVar(value, scope);
        expect(
          resolved,
          `${p.name}: ${prop}: ${value} does not resolve — the declaration that reads it becomes \`unset\`, i.e. an INVISIBLE toast`,
        ).not.toBeNull();
        expect(
          resolved,
          `${p.name}: ${prop} resolved to "${resolved}", which is not a literal colour or length`,
        ).toMatch(/^(#[0-9a-fA-F]{3,8}|\d+(\.\d+)?(px|rem|em|%))$/);
      }
    }
  });

  it('🔴 and the guard has teeth: an undefined token is REJECTED, not shrugged at', () => {
    // Mutation-proofs the assertion above. If this passes but the real check
    // cannot fail, section 5 is decorative and the invisible toast can ship.
    const scope = scopeFor('dark', 'classic');
    expect(resolveVar('var(--popover-that-does-not-exist)', scope)).toBeNull();
    // A one-hop alias onto an undefined token is the realistic shape, since
    // every token here IS an alias.
    expect(resolveVar('var(--alias)', { ...scope, '--alias': 'var(--still-not-defined)' })).toBeNull();
    // And a cycle terminates rather than hanging the suite.
    expect(resolveVar('var(--a)', { '--a': 'var(--b)', '--b': 'var(--a)' })).toBeNull();
    // While a real token still resolves, so the check is not simply "always null".
    expect(resolveVar('var(--surface-raised)', scope)).toBe(CLASSIC_DARK_SURFACE_RAISED);
  });

  it('the four shadcn defaults are defined now — the revert would COMPILE, and is still not done', () => {
    // THE-263 (#407) and THE-264 (#408) defined all four. Recorded here because
    // "they are undefined" was the reason the hand-patch existed, and that
    // reason has expired even though the hand-patch is still correct: each
    // upstream name resolves to exactly the value the wrapper spells directly,
    // in all four palettes, so a revert would be a rename with no pixel behind
    // it. If that equality ever breaks, this test names which palette broke it.
    for (const p of PALETTES) {
      const s = scopeFor(p.theme, p.family);
      expect(resolveVar('var(--popover)', s), `${p.name}: --popover`).toBe(resolveVar('var(--surface-raised)', s));
      expect(resolveVar('var(--popover-foreground)', s), `${p.name}: --popover-foreground`).toBe(resolveVar('var(--text-body)', s));
      expect(resolveVar('var(--border)', s), `${p.name}: --border`).toBe(resolveVar('var(--border-default)', s));
      expect(resolveVar('var(--radius)', s), `${p.name}: --radius`).toBe('12px');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6-7 · 🔴 next-themes is gone, and the census that made it possible still guards
// ═══════════════════════════════════════════════════════════════════════════

/** Every .ts/.tsx under src/, __tests__ INCLUDED. */
function walkAllSrc(dir: string = SRC, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e !== 'node_modules') walkAllSrc(p, out);
    } else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

const PKG = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as Record<
  string,
  Record<string, string> | undefined
>;

describe('6 — next-themes is not imported anywhere, and is out of package.json', () => {
  it('🔴 nothing under src imports it — sonner.tsx was the last one', () => {
    const importers = walkAllSrc()
      .filter((f) => /from\s+['"]next-themes['"]/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f))
      .sort();
    expect(
      importers,
      'next-themes is imported again — src/lib/use-theme.ts is the shim to point at',
    ).toEqual([]);
  });

  it('🔴 and it is declared in no dependency field, so it is not installed either', () => {
    // Every field, not just `dependencies`: demoting it to devDependencies
    // would leave it installed and importable, which is the exact
    // installed-but-inert state this removal exists to end.
    const declaredIn = [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ].filter((field) => PKG[field]?.['next-themes'] !== undefined);
    expect(declaredIn, 'next-themes came back into package.json').toEqual([]);
  });

  it('the lockfile no longer carries it either', () => {
    // package.json and package-lock.json disagreeing is how a removed
    // dependency stays installed on every `npm ci`.
    const lock = readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8');
    expect(lock).not.toContain('node_modules/next-themes');
    expect(lock).not.toContain('"next-themes"');
  });

  it('sonner is still the ONLY primitive that reaches for a theme at all', () => {
    // THE-271 pinned this alongside the census. It is the other half of the
    // same guard: a second primitive reaching for a theme hook is a second
    // opinion about what the theme is.
    const UI = path.join(SRC, 'components/ui');
    const reachers = readdirSync(UI)
      .filter((e) => /\.tsx?$/.test(e))
      .filter((e) => /\buseTheme\b|\buseResolvedTheme\b/.test(readFileSync(path.join(UI, e), 'utf8')))
      .sort();
    expect(reachers).toEqual(['sonner.tsx']);
  });
});

describe('7 — the import census still guards, updated rather than deleted', () => {
  const CENSUS = readFileSync(
    path.join(SRC, '__tests__/the-271-one-theme-system.test.tsx'),
    'utf8',
  );

  it('🔴 THE-271 kept its census test — a future re-import still fails it', () => {
    // The instinct once a cleanup lands is to delete the test that demanded
    // it. That would leave `shadcn add` free to paste the upstream import back
    // into the next primitive with nothing objecting.
    expect(
      /it\(\s*'🔴 nothing imports next-themes any more, and it is gone from package\.json'/.test(CENSUS),
      'THE-271 lost its next-themes census instead of flipping it',
    ).toBe(true);
    // It asserts EMPTY now, where it used to assert exactly sonner.tsx.
    expect(CENSUS).toContain("'next-themes is imported again — src/lib/use-theme.ts is the shim to point at instead'");
    expect(CENSUS).not.toContain("').toEqual(['src/components/ui/sonner.tsx']);");
  });

  it('and it walks the test trees too, now that the package is not installed at all', () => {
    // walkSrc skips __tests__, which was fine while the package existed. It no
    // longer is: this suite removed the two sections of THE-271 that DROVE the
    // real library, and nothing should be able to add another.
    expect(CENSUS).toContain('function walkAllSrc(');
    expect(CENSUS).toContain('const importers = walkAllSrc()');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8-10 · pins: this ticket changes ONE file under src/components/ui and
//        nothing in the load-bearing theme path
// ═══════════════════════════════════════════════════════════════════════════

describe('8 — use-theme.ts is untouched', () => {
  it('🔴 byte-identical to the version THE-271 (#415) shipped', () => {
    // THE-273 ADOPTS this module; it does not edit it. It shipped one PR ago
    // with its own guards (it never stamps, it never writes on read), and a
    // toast is not the place to discover that one of them moved.
    expect(
      digestOf('src/lib/use-theme.ts'),
      'src/lib/use-theme.ts changed — THE-273 must consume it, not edit it',
    ).toBe('c025962d2b71784b946acfe103a0d197aca70f449ee815a109922c19c9a55cbc');
  });

  it('and it is still the shim, not a second stamping path', () => {
    // Restated behaviourally so the digest above is not the only thing saying
    // it: a digest tells you something moved, not what mattered about it.
    const shim = readFileSync(path.join(SRC, 'lib/use-theme.ts'), 'utf8');
    expect(
      /\.setAttribute\(\s*['"]data-(theme|palette)['"]/.test(shim),
      'the shim became a stamping path',
    ).toBe(false);
  });
});

describe('9 — all 22 other primitives are byte-identical', () => {
  /** Recorded from `main` (bb514cd). sonner.tsx is deliberately absent: it is
   *  the one file this ticket changes, and listing it here with its NEW digest
   *  would make this pin agree with any future edit to it. */
  const UNCHANGED: Readonly<Record<string, string>> = {
    'avatar.tsx': '357b2f9aac0192c071cb2ed65cb6e4c8ec01fa02fc15cf50d889b85731b75666',
    'badge.tsx': '968b0403af74a785c9408ca69a677235e49d0c80b2c27fb9858ad421a8778c7d',
    'breadcrumb.tsx': '26f83fc8ed302d710851a71b705f5f8f28c805561c1fb6945370617267c5a4a9',
    'button.tsx': 'd14549ab3ba7a9d5d1f424c2599233bffa0b317121abf3b6efa2fb902d5e2781',
    'card.tsx': 'd8113cbf964f8d1aadf2649d2944d8bbc6e3cfd49d36746f76868cbc4dde3cfe',
    'chart.tsx': '0060b7708d85a5fffc914dcd1ee4753b5acfe83db7ba634b4cea280bd9f19c8f',
    'collapsible.tsx': 'ead4349ff7b01d696ef89294a81d18ee1d3f732321398896462c834ab9b9e065',
    'dialog.tsx': 'ccabf6cc674a68b09d9168904bb46b7c1075a67312cf6f51f3e38b8eeacd2fdb',
    'dropdown-menu.tsx': '1c1ae4ec02de9778286f84e0d15a1b74cc610c13c5b6a13c1ada2e6770eeb4e1',
    'input.tsx': 'f7d6ecff9a4d631feeaf401c02bb87e26ddb38131c55d15a43b9290747390847',
    'label.tsx': '7f19b8476658d25ff197c84030e58cd7395059d876a54630e025951e474ebdae',
    'pagination.tsx': '0aba86a91ba0a8d99e92846f10b395d0ddc1a8901a4f54418e8802c12fad57c1',
    'progress.tsx': '45e33890b5a82744fc27d0928f927c5942c1166e5e27de8f776b29112967d317',
    'select.tsx': 'ca3bd1b370ea67b84632d435c22d8270752fa6013c06c365162af265e4a0e87e',
    'separator.tsx': '75085bd84ff6965e4a356c53a4689799cabf65caa93c0bba064d5a0c6fa78f13',
    'sheet.tsx': 'a8ff25079c1167230fc3a9ddce881a8fb24f8ebb1eecbc8189c7f1cf242018df',
    'sidebar.tsx': '29e33400cfdd00cb499da3615ed2258d75192d2b2a5a5117a84d2db4242ed0bf',
    'skeleton.tsx': '8110bba70d0cb9fe968c0b7bd092ad12258caef40b028b4a87f402bdab907faf',
    'table.tsx': 'a13f55a7c1406197608f223006cf16f211a257b213362caaef0d2abf3a389c8f',
    'tabs.tsx': '8bf9ee3935ab86c268a2a71cb5b4b67d3d5587ca9f2e0bf25f37ffdb1980434c',
    'tooltip.tsx': '2cea2294d4947b88d815860f64e0b5e0eb47a59bde47cfd194aac2230c923865',
  };

  /** THE-274 installed Batches C, D and E after this landed: nineteen it named
   *  plus `popover` and `toggle`. Named rather than the assertion below being
   *  loosened, so the next arrival still has to come back and say so. */
  const BATCH_CDE = [
    'alert.tsx', 'button-group.tsx', 'calendar.tsx', 'checkbox.tsx', 'command.tsx',
    'context-menu.tsx', 'empty.tsx', 'field.tsx', 'hover-card.tsx', 'input-group.tsx',
    'item.tsx', 'popover.tsx', 'radio-group.tsx', 'resizable.tsx', 'scroll-area.tsx',
    'slider.tsx', 'spinner.tsx', 'switch.tsx', 'textarea.tsx', 'toggle-group.tsx',
    'toggle.tsx',
  ];

  it('🔴 21 untouched + sonner.tsx + THE-274’s 21 = the 43 primitives', () => {
    const present = readdirSync(path.join(SRC, 'components/ui'))
      .filter((e) => /\.tsx$/.test(e))
      .sort();
    expect(present).toEqual([...Object.keys(UNCHANGED), 'sonner.tsx', ...BATCH_CDE].sort());
  });

  /**
   * ⚠️ `tabs.tsx` MOVED SINCE, and why — THE-276-FIX.
   *
   * As vendored it styled itself with `data-horizontal:` / `data-vertical:`
   * variants, which Tailwind compiles to `[data-horizontal]` / `[data-vertical]`.
   * The installed @base-ui/react emits `data-orientation="horizontal"`, so none
   * of those twelve rules matched: the tabs root kept `display:flex` in the
   * default `row` direction and the panel, a `flex-1` sibling, rendered as a
   * second COLUMN beside the tab strip. Twelve class names re-spelled
   * `data-[orientation=…]`; no element, slot, variant or API changed.
   *
   * The same treatment this ticket's own sonner.tsx fix gets: named, so every
   * other entry is still compared against what main recorded.
   */
  const MOVED_SINCE: Readonly<Record<string, string>> = {
    'tabs.tsx': '096e3d4b2a99b1eff95d16959f97daaa1747fdb7de6226d6c54b9693e22b3410',
    // ⚠️ THE-295. Both shipped at the shadcn default `z-50` for scrim AND
    // panel, under the mobile bottom nav's `z-[100]` — so any dialog or sheet
    // mounted on a phone would have painted BELOW the navigation bar. THE-286
    // found it and reported rather than fixed it; THE-295 raised each scrim to
    // `z-[101]` and each panel to `z-[102]`, #427's existing layering. Four
    // class names in two files; no element, slot, variant, prop or API moved.
    'dialog.tsx': 'bfd230cea544d2de7650182341e082de92141174da80f6193843e8d71b622e41',
    'sheet.tsx': '68d13d9826a9b5b28e3d78a0ba632b347ca91b67a3333a38acb6310ade8846d4',
  };

  it('🔴 every one of the 21 hashes to what main recorded, bar the one THE-276-FIX fixed', () => {
    const actual = Object.fromEntries(
      Object.keys(UNCHANGED).map((f) => [f, digestOf(path.join('src/components/ui', f))]),
    );
    expect(actual).toEqual({ ...UNCHANGED, ...MOVED_SINCE });
  });

  it("and ds-primitives' own ledger moved for sonner.tsx alone", () => {
    // The fixture that pin lives in has to be re-recorded, and re-recording a
    // ledger is exactly when something rides along unnoticed. So the DELTA is
    // pinned: 21 entries identical to main, one changed, none added or removed.
    const ledger: Record<string, string> = JSON.parse(
      readFileSync(path.join(SRC, 'components/ui/__tests__/__fixtures__/primitive-digests.json'), 'utf8'),
    );
    //
    // ⚠️ THE-274 added twenty-one entries to this ledger. The claim here is
    // unchanged and is deliberately still scoped to the twenty-two THIS ticket
    // knew about: of those, sonner.tsx alone may differ. The new arrivals are
    // asserted separately, by name, so they cannot be the cover for a
    // pre-existing entry quietly moving.
    const known = new Set([...Object.keys(UNCHANGED), 'sonner.tsx']);
    const moved = Object.entries(ledger)
      .filter(([rel]) => known.has(path.basename(rel)))
      // 🔴 Compared against UNCHANGED alone, deliberately — NOT against the
      // MOVED_SINCE overlay. This assertion's whole job is to enumerate what
      // has moved away from what main recorded; folding the overlay in here
      // would make each named mover disappear from its own census.
      .filter(([rel, digest]) => digest !== UNCHANGED[path.basename(rel)])
      .map(([rel]) => rel)
      .sort();
    // ⚠️ Two movers now, not one: sonner.tsx (this ticket) and tabs.tsx
    // (THE-276-FIX, see MOVED_SINCE above). Both are named, so the claim is
    // still a DELTA — a third entry moving is still a failure.
    // ⚠️ Four movers now, not two: sonner.tsx (this ticket), tabs.tsx
    // (THE-276-FIX) and dialog.tsx + sheet.tsx (THE-295), all named in
    // MOVED_SINCE above with their reason. Still a DELTA — a fifth entry
    // moving is still a failure.
    expect(moved, 'the primitive ledger moved for something other than the four named movers').toEqual([
      'src/components/ui/dialog.tsx',
      'src/components/ui/sheet.tsx',
      'src/components/ui/sonner.tsx',
      'src/components/ui/tabs.tsx',
    ]);
    expect(ledger['src/components/ui/sonner.tsx']).toBe(digestOf('src/components/ui/sonner.tsx'));

    // And everything the ledger holds beyond those twenty-two is exactly
    // THE-274's twenty-one — no unexplained entry rode along with it.
    const arrivals = Object.keys(ledger)
      .map((rel) => path.basename(rel))
      .filter((base) => !known.has(base))
      .sort();
    expect(arrivals).toEqual([...BATCH_CDE].sort());
  });
});

describe('10 — layout.tsx, firestore.rules and functions/ are byte-identical', () => {
  it('🔴 layout.tsx is untouched — it carries the hash-pinned pre-paint script', () => {
    // The Toaster is mounted here and nothing about the mount changes: the fix
    // is entirely inside the component. Editing this file would mean
    // regenerating the pre-paint hash that four other suites pin.
    expect(digestOf('src/app/layout.tsx')).toBe(
      'bf5f96a61c3fa2f467556f44f0b36e91e49b7c830609b37c775fa6a2b9232ca5',
    );
  });

  it('🔴 firestore.rules is untouched', () => {
    expect(digestOf('firestore.rules')).toBe(
      'a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499',
    );
  });

  it('🔴 functions/ is untouched, as a whole tree rather than file by file', () => {
    // A manifest, so an ADDED or REMOVED file moves the digest too — pinning
    // individual files would miss both.
    const dir = path.join(ROOT, 'functions');
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of readdirSync(d).sort()) {
        const p = path.join(d, e);
        if (statSync(p).isDirectory()) {
          if (e !== 'node_modules' && e !== 'lib') walk(p, out);
        } else out.push(p);
      }
      return out;
    };
    const manifest = walk(dir)
      .map((f) => path.relative(ROOT, f))
      .sort()
      .map((rel) => `${sha256(readFileSync(path.join(ROOT, rel)))} ${rel}`)
      .join('\n');
    expect(sha256(`${manifest}\n`)).toBe(
      '2140ed2820c61b7a3504e55ff88e8aa8381d08a389ffcec5bdb12147af0fee0b',
    );
  });

  it('and the Toaster is still mounted app-wide, which is what makes this ticket app-wide', () => {
    const layout = readFileSync(path.join(SRC, 'app/layout.tsx'), 'utf8');
    expect(layout).toContain("import { Toaster } from '@/components/ui/sonner'");
    expect(layout).toContain('<Toaster />');
  });
});
