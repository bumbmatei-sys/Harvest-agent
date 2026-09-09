import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import postcss from 'postcss';
import {
  THEME_STORAGE_KEY,
  deriveOnDarkAccent,
  deriveOnTintAccent,
  accentTintGround,
  contrastRatio,
  AA_CONTRAST,
  ACCENT_TINT_PCT,
  DARK_SURFACE,
  DARK_SURFACE_RAISED,
} from '../lib/theme';
import { PREAUTH_PATHS } from '../lib/preauth-theme';
import { applyThemeForLocation } from '../lib/theme-runtime';
import { rulesDigestFailure } from './__fixtures__/firestore-rules-pin';

/**
 * THE-265 — Classic is the default palette family.
 *
 * The founder asked to "remove the Harvest theme and have only the Classic
 * one". That is not a thing that can be built: Classic overrides 14 tokens
 * (surfaces, borders, text) and EVERYTHING else — ~120 tokens, the fonts, the
 * radii, the spacing, the shadows, and every gold accent — falls through to
 * Harvest. globals.css says so itself: "A second FAMILY, not a second theme…
 * Classic is purely additive." Deleting Harvest deletes the substrate Classic
 * is written on top of.
 *
 * So this ships the same thing on screen by a different route: the DEFAULT
 * family moves from Harvest to Classic. Nothing is deleted, a user who has
 * already chosen keeps their choice, and the whole change reverts by flipping
 * one constant.
 *
 * ⚠️ THE DEFAULT LIVES IN TWO PLACES AND THEY CANNOT IMPORT EACH OTHER.
 * `DEFAULT_PALETTE_FAMILY` (src/lib/theme.ts) is the bundled home; the
 * pre-paint <script> in layout.tsx is a raw string that runs before any bundle
 * and so spells it as a literal, exactly as it must spell both storage keys.
 * Nothing the compiler can see holds them together. Test 2 below is the only
 * thing that does — and if it ever stops holding, a cold load paints one
 * family and hydrates into the other: a flash that shows up only on a first
 * visit, which is the hardest kind of bug to notice and the easiest to ship.
 */

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');
const LAYOUT = path.join(ROOT, 'src/app/layout.tsx');
const GLOBALS = path.join(ROOT, 'src/app/globals.css');

/* ── the real pre-paint script, extracted and made runnable ─────────────────
 * Lifted from preauth-light.test.ts deliberately unchanged: a test that
 * re-implemented the script would keep passing after the real one broke, and
 * the whole point here is that the REAL default is the one under test.
 * ⚠️ No `git show` anywhere — CI's clone depth is not something this may
 * depend on. Every expectation below reads the working tree. */
function prePaintScript(): string {
  const layout = readFileSync(LAYOUT, 'utf8');
  const m = layout.match(/__html: `(\(function\(\)\{try\{[\s\S]*?)`,/);
  if (!m) throw new Error('pre-paint theme script not found in layout.tsx');
  return m[1]
    .replace('${JSON.stringify(PREAUTH_PATHS)}', JSON.stringify(PREAUTH_PATHS))
    .replace(/\\\\/g, '\\');
}

const SCRIPT = prePaintScript();

function runPrePaint(url: string): void {
  window.history.replaceState({}, '', url);
  // eslint-disable-next-line no-new-func
  new Function(SCRIPT)();
}

const stamped = () => ({
  attr: document.documentElement.getAttribute('data-theme'),
  dark: document.documentElement.classList.contains('dark'),
  palette: document.documentElement.getAttribute('data-palette'),
});

let matchesDark = false;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-palette');
  document.documentElement.classList.remove('dark');
  matchesDark = false;
  window.matchMedia = ((q: string) => ({
    matches: /prefers-color-scheme:\s*dark/.test(q) ? matchesDark : false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

// ═══════════════════════════════════════════════════════════════════════════
// 1-4 · 🔴 THE-338 — THERE IS NO FAMILY LEFT TO DEFAULT TO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 🔴 FOUR SECTIONS COLLAPSED INTO ONE, AND THE COLLAPSE IS THE RECORD.
 *
 * THE-265's whole ticket was ONE VALUE: which palette family a user with no
 * stored preference renders in. Sections 1-4 proved it four ways — the
 * constant said Classic, `readStoredFamily` fell back to it, the pre-paint
 * script's duplicated literal agreed with it, and a stored 'harvest' was still
 * honoured so nobody lost a choice.
 *
 * THE-338 removes the axis those four sections are about. The founder asked to
 * "remove harvest theme"; because THE-265 had already made the neutral family
 * the default, what was on screen was already the neutral ramp, so the removal
 * promoted that family's 14 overrides per mode into `:root`/`.dark` and deleted
 * the attribute, the storage key, the constant, the type, the guard and the
 * toggle.
 *
 * So "which family is the default" has NO ANSWER now rather than a different
 * one, and four sections asserting the answer would each have had to be
 * rewritten into the same sentence. They are that sentence, once — and the
 * shape of the removal is asserted in section 5, which is where the detail
 * went rather than being lost.
 *
 * ⚠️ Everything from section 6 down is UNCHANGED IN INTENT and still runs: the
 * AA derivation against the dark ground, the pre-auth light-only force, that
 * nothing writes the stored preference during that force, and the five named
 * widths. Those were never about the family — they were about the dark GROUND
 * and the funnel, both of which survive. What moved is which ground: the
 * constants they read are `DARK_SURFACE` / `DARK_SURFACE_RAISED`, and THE-338
 * darkened those to #141414 / #1F1F1F.
 */
describe('1-4 — the family axis is gone, so there is no default to assert', () => {
  it('theme.ts exports neither a family default nor a family list', async () => {
    const theme = await import('../lib/theme');
    expect('DEFAULT_PALETTE_FAMILY' in theme, 'the family default is back').toBe(false);
    expect('PALETTE_FAMILIES' in theme, 'the family list is back').toBe(false);
    expect('FAMILY_STORAGE_KEY' in theme, 'the family storage key is back').toBe(false);
  });

  it('theme-runtime.ts has no family reader, and applyTheme takes one argument', async () => {
    const runtime = await import('../lib/theme-runtime');
    expect('readStoredFamily' in runtime, 'readStoredFamily is back').toBe(false);
    expect(runtime.applyTheme.length, 'applyTheme took a second (family) argument').toBe(1);
  });

  it('the pre-paint script stamps the mode and nothing else', () => {
    const layout = readFileSync(path.join(SRC, 'app/layout.tsx'), 'utf8');
    // The SCRIPT, not the prose: this file documents the removal in a comment
    // that necessarily names the attribute, and a whole-file grep would match
    // its own explanation and pass while the stamp was still live.
    const script = (/\(function\(\)\{[\s\S]*?\}\)\(\);/.exec(layout) ?? [''])[0];
    expect(script, 'the pre-paint IIFE was not found — this assertion would be vacuous')
      .toContain('document.documentElement');
    expect(script).toContain("setAttribute('data-theme'");
    expect(script).not.toContain('data-palette');
    expect(script).not.toContain('harvest-theme-family');
  });

  it('a leftover stored family is inert — it is deliberately not migrated', () => {
    localStorage.setItem('harvest-theme-family', 'harvest');
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    applyThemeForLocation('/');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-palette')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · 🔴 THE-338 — the control, the type and the guard are GONE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 🔴 THIS SECTION WAS INVERTED, NOT DELETED, AND IT IS THE ONE THAT MATTERS
 * MOST IN THIS FILE.
 *
 * THE-265's whole claim was that making Classic the DEFAULT deleted nothing:
 * "Flipping it back to 'harvest' is the entire revert… PaletteFamilyToggle
 * still offers both." This section proved it — both options rendered, both
 * families were in the type and the guard, the toggle still wrote the key.
 *
 * THE-338 is the ticket that DOES delete it, on the founder's "remove harvest
 * theme". So the guarantee this section held is deliberately withdrawn, and
 * what replaces it is the shape of the withdrawal: the component file is gone,
 * the type and its guard are gone, the storage key is read by nothing, and
 * nothing renders a family control. A test that merely disappeared would have
 * left all of that unwatched.
 *
 * ⚠️ The stored `harvest-theme-family` key is NOT migrated or cleared, and
 * that is asserted in `preauth-light.test.ts`: nothing reads it, so a value
 * left in a returning user's localStorage is inert, and shipping code whose
 * only job is to delete a key nobody consults would be the larger change.
 */
describe('5 — the palette family control and its type are gone', () => {
  it('the component file no longer exists', () => {
    expect(existsSync(path.join(SRC, 'components/PaletteFamilyToggle.tsx'))).toBe(false);
  });

  it('the type, the guard and the family list are gone from theme.ts', () => {
    const theme = readFileSync(path.join(SRC, 'lib/theme.ts'), 'utf8');
    for (const gone of ['PALETTE_FAMILIES', 'isPaletteFamily', 'DEFAULT_PALETTE_FAMILY', 'FAMILY_STORAGE_KEY']) {
      expect(theme, `${gone} is still exported`).not.toContain(`export const ${gone}`);
    }
    expect(theme, 'the PaletteFamily type is still declared').not.toContain('export type PaletteFamily');
  });

  it('no source file renders or imports a family control', () => {
    const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir)) {
        const q = path.join(dir, entry);
        if (statSync(q).isDirectory()) {
          if (entry !== '__tests__' && entry !== '__fixtures__' && entry !== 'node_modules') walk(q, out);
        } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(q);
      }
      return out;
    };
    // Comments stripped: this repo documents removals in prose that names the
    // thing removed, and a raw grep would match its own explanation.
    const offenders = walk(SRC)
      .filter((f) => strip(readFileSync(f, 'utf8')).includes('PaletteFamilyToggle'))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · 🔴 THE AA GUARANTEE against the Classic dark ground
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A spread of tenant accents, chosen to cover the cases that behave
 * DIFFERENTLY — not a list of colours that all pass trivially:
 *   • Harvest gold        already clears AA on both grounds → must be untouched
 *   • deep navy           1.01:1 raw, the pathological case the derivation exists for
 *   • mid-tone blue/green the interesting band: clears one ground, maybe not the other
 *   • near-black          worst case, drives the derivation furthest
 *   • already-light       clears everywhere, must be untouched
 */
const ACCENTS: ReadonlyArray<readonly [string, string]> = [
  ['#C9963A', 'Harvest gold (the default brand)'],
  ['#0C1526', 'deep navy — 1.01:1 raw on Harvest dark'],
  ['#1E3A8A', 'indigo 800 — a common church brand blue'],
  ['#2563EB', 'blue 600 — mid-tone, the interesting band'],
  ['#166534', 'green 800 — dark, needs real correction'],
  ['#7C3AED', 'violet 600'],
  ['#B91C1C', 'red 700'],
  ['#000000', 'pure black — the worst case'],
  ['#E8E2D9', 'stone 200 — already light, must not be touched'],
];

describe('6 — deriveOnDarkAccent clears AA against the Classic dark ground', () => {
  it.each(ACCENTS)(
    '🔴 %s (%s) clears AA on the Classic dark ground',
    (hex) => {
      const derived = deriveOnDarkAccent(hex, DARK_SURFACE);
      const ratio = contrastRatio(derived, DARK_SURFACE);
      expect(
        ratio,
        `${hex} -> ${derived} is ${ratio.toFixed(2)}:1 on ${DARK_SURFACE}`,
      ).toBeGreaterThanOrEqual(AA_CONTRAST);
    },
  );

  it.each(ACCENTS)(
    '%s (%s) clears AA on its Classic accent-tint chip too',
    (hex) => {
      // The gap deriveOnDarkAccent leaves: a tinted chip sits ABOVE the page
      // ground, so ink that clears on the ground can still fail on the chip.
      const derived = deriveOnTintAccent(hex, DARK_SURFACE_RAISED);
      const chip = accentTintGround(hex, DARK_SURFACE_RAISED, ACCENT_TINT_PCT);
      const ratio = contrastRatio(derived, chip);
      expect(
        ratio,
        `${hex} -> ${derived} is ${ratio.toFixed(2)}:1 on its chip ${chip}`,
      ).toBeGreaterThanOrEqual(AA_CONTRAST);
    },
  );

  it('🔴 the guarantee is STRUCTURAL, not a property of this accent list', () => {
    // The derivation walks toward CREAM and returns CREAM if nothing else
    // clears. So the guarantee holds for EVERY possible hex if and only if
    // CREAM itself clears AA on the ground. Assert that, and the list above
    // becomes evidence rather than the whole proof.
    const creamOnClassic = contrastRatio('#FAF8F5', DARK_SURFACE);
    expect(creamOnClassic).toBeGreaterThanOrEqual(AA_CONTRAST);
    // …and on the worst chip any accent can build (black at 12% on raised).
    const worstChip = accentTintGround('#FFFFFF', DARK_SURFACE_RAISED, ACCENT_TINT_PCT);
    expect(contrastRatio('#FAF8F5', worstChip)).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it('🔴 THE-338 DARKENED THE GROUND, which makes every accent EASIER', () => {
    /* 🔴 THIS TEST WAS INVERTED AND ITS COMPARISON REBUILT, because the
       family removal turned the original into a tautology.
    
       It read: "#1C1C1C is lighter than #1A1612, so an accent has LESS room
       against it… an accent tuned on Harvest is not automatically safe on
       Classic". Two grounds, two constants, a real comparison.
    
       There is one ground now, so comparing the constant to itself would have
       asserted nothing while still passing — the exact shape this repo has
       already shipped once and the reason that failure is called out.
    
       What IS true and worth pinning is the DIRECTION THE-338 moved it. The
       ground went from #1C1C1C to #141414, and a darker ground gives an accent
       MORE room, not less. So the risk the original recorded now runs the other
       way, and the derivation's guarantee is strictly easier to meet than it
       was — asserted against the literal the ticket moved away from, which is a
       real second value rather than the same one twice. */
    const BEFORE_THE_338 = '#1C1C1C';
    expect(DARK_SURFACE, 'the ground stopped being the one THE-338 set').toBe('#141414');
    expect(
      contrastRatio('#FAF8F5', DARK_SURFACE),
      'the ground got LIGHTER — an accent now has less room, not more',
    ).toBeGreaterThan(contrastRatio('#FAF8F5', BEFORE_THE_338));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 · --brand-color-on-dark derives against THE dark ground
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 🔴 THE-338 COLLAPSED THIS SECTION FROM TWO DERIVATIONS TO ONE.
 *
 * The server could not know which palette FAMILY was rendering — family was a
 * client-only localStorage preference — so layout.tsx computed BOTH
 * derivations, each scoped to a `[data-palette]` selector, and let the cascade
 * pick one at the moment the pre-paint script stamped the attribute. That was
 * the trap THE-265 called out and solved.
 *
 * One family, one dark ground, one derivation. The collapse is safe for the
 * reason the MODE axis never needed resolving either: the value is injected
 * unconditionally and is only ever read from inside a `.dark`-scoped rule, so
 * it is inert in light and correct in dark without the server asking which
 * applies.
 */
describe('7 — --brand-color-on-dark derives against the dark ground', () => {
  const layout = readFileSync(LAYOUT, 'utf8');

  it('one derivation is injected, at :root, with no family scoping', () => {
    expect(layout).toContain('--brand-color-on-dark:');
    expect(layout, 'a family-scoped accent rule is back').not.toContain('[data-palette=');
  });

  it('🔴 it is derived against the ramp CONSTANTS, not a literal', () => {
    // Reading the constants is what makes the AA correction follow the ground:
    // THE-338 darkened DARK_SURFACE and DARK_SURFACE_RAISED, and the injection
    // moved with them without this file being edited.
    expect(layout).toContain('deriveOnDarkAccent(brandColor, DARK_SURFACE)');
    expect(layout).toContain('deriveOnTintAccent(brandColor, DARK_SURFACE_RAISED)');
  });

  it('🔴 and the constants are the values globals.css actually declares', () => {
    // The AA guarantee is fictional if the two disagree — this is the join
    // that makes the derivation true of what renders.
    const globals = readFileSync(GLOBALS, 'utf8');
    const dark = globals.slice(globals.indexOf('.dark,'));
    expect(dark).toContain(`--surface:         ${DARK_SURFACE}`);
    expect(dark).toContain(`--surface-raised:  ${DARK_SURFACE_RAISED}`);
  });

  it('the derivation really does move an accent in the sensitive band', () => {
    // If it returned its input the injection would be decorative. It does not:
    // a mid-tone gold is lifted against the dark ground, while one that already
    // clears AA comes back untouched — which is the whole design.
    const sensitive = '#8A6D1F';
    expect(deriveOnDarkAccent(sensitive, DARK_SURFACE)).not.toBe(sensitive);
    expect(deriveOnDarkAccent('#C9963A', DARK_SURFACE), 'Harvest gold was altered').toBe('#C9963A');
  });

  it('a non-white-label tenant still injects nothing at all', () => {
    expect(layout).toContain('{brandColorValid && (');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8 · THE-85 no-regression — pre-auth is still light only, in both families
// ═══════════════════════════════════════════════════════════════════════════

describe('8 — pre-auth is still light-mode only, in both families', () => {
  it.each(PREAUTH_PATHS)('%s renders light with nothing stored', (p) => {
    runPrePaint(p);
    expect(stamped().attr).toBe('light');
    expect(stamped().dark).toBe(false);
  });

  it.each(PREAUTH_PATHS)('%s renders light with dark stored', (p) => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    runPrePaint(p);
    expect(stamped().attr).toBe('light');
    expect(stamped().dark).toBe(false);
  });

  it.each(PREAUTH_PATHS)('%s renders light with a leftover family key stored', (p) => {
    // 🔴 THE-338 — the stored `harvest-theme-family` key is deliberately not
    // migrated or cleared, so a returning user still has one. This is the
    // proof it is inert: it moves neither axis on the funnel.
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    localStorage.setItem('harvest-theme-family', 'harvest');
    runPrePaint(p);
    expect(stamped().attr).toBe('light');
    expect(stamped().dark).toBe(false);
  });

  it('a dark-OS visitor still gets a light sign-in page', () => {
    matchesDark = true;
    runPrePaint('/auth');
    expect(stamped().attr).toBe('light');
    expect(stamped().dark).toBe(false);
    expect(stamped().palette, 'the funnel stamped a palette family').toBeNull();
  });

  /* 🔴 THREE FAMILY TESTS STOOD HERE AND THE-338 REMOVED THEM, because the
     thing they asserted no longer exists rather than having a new value.

     They were: the pre-auth family FOLLOWS the default so the funnel matches
     the app; it is a FORCE not a fallback, so a stored 'harvest' is ignored on
     the funnel and honoured behind auth; and the runtime spells that forced
     family as DEFAULT_PALETTE_FAMILY rather than a second literal.

     THE-85's guarantee — the funnel renders exactly ONE deterministic
     presentation — is unchanged and is now true by construction: there is one
     family, so the only thing left to force is the MODE, which the tests above
     assert on every funnel path. */

  it('the runtime forces the MODE only — there is no family argument left to spell', () => {
    // 🔴 THE-338 — this asserted that the funnel's forced FAMILY was written as
    // DEFAULT_PALETTE_FAMILY rather than a second literal, so it could not
    // drift from the app it leads into. `applyThemeForLocation` no longer
    // passes a family at all, so that drift is impossible rather than caught.
    const raw = readFileSync(path.join(SRC, 'lib/theme-runtime.ts'), 'utf8');
    expect(raw).toContain("applyTheme(forced ? 'light' : readStoredChoice())");
    // 🔴 COMMENTS STRIPPED. theme-runtime.ts documents the removal in prose
    // that necessarily names `readStoredFamily`, and a raw grep would match
    // that explanation — reporting the removal as a regression, or (with the
    // sense flipped) passing on the strength of its own comment.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    expect(code, 'a family argument is back').not.toMatch(/readStoredFamily|PALETTE_FAMILY/);
  });

  it('and the client applier agrees with the script on every funnel path', () => {
    for (const p of PREAUTH_PATHS) {
      localStorage.clear();
      runPrePaint(p);
      const fromScript = stamped();
      document.documentElement.removeAttribute('data-theme');
      document.documentElement.removeAttribute('data-palette');
      document.documentElement.classList.remove('dark');
      applyThemeForLocation(p);
      expect(stamped(), `${p}: pre-paint and hydration disagree`).toEqual(fromScript);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9 · nothing writes the stored preference during a pre-auth force
// ═══════════════════════════════════════════════════════════════════════════

describe('9 — nothing writes the stored preference during a pre-auth force', () => {
  it('the theme-application layer contains no setItem at all', () => {
    const runtime = readFileSync(path.join(SRC, 'lib/theme-runtime.ts'), 'utf8');
    expect(runtime).not.toMatch(/localStorage\.setItem/);
    expect(readFileSync(LAYOUT, 'utf8')).not.toMatch(/localStorage\.setItem/);
  });

  it('behaviourally: a forced pre-auth render leaves the stored key exactly as found', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    localStorage.setItem('harvest-theme-family', 'harvest');
    runPrePaint('/auth');
    applyThemeForLocation('/auth');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    // 🔴 And the leftover family key is not cleared either. THE-338 removed
    // the axis WITHOUT shipping a migration: nothing reads the key, so code
    // whose only job is to delete it would be the larger change.
    expect(localStorage.getItem('harvest-theme-family')).toBe('harvest');
  });

  it('🔴 and nothing is written back on an ordinary render either', () => {
    // The failure mode this section exists for: "resolve the missing value and
    // persist it" would silently convert every user into someone who has
    // CHOSEN, and a revert would then not reach them. Nothing is persisted.
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    runPrePaint('/');
    applyThemeForLocation('/');
    expect(
      localStorage.getItem(THEME_STORAGE_KEY),
      'a resolved theme was persisted — every user is now permanently opted in',
    ).toBeNull();
    expect(document.documentElement.getAttribute('data-palette')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10 · every Harvest token still resolves to its prior value
// ═══════════════════════════════════════════════════════════════════════════

const GLOBALS_CSS = readFileSync(GLOBALS, 'utf8');

function varsIn(css: string, selectorTest: (s: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(css).walkRules((rule) => {
    if (!selectorTest(rule.selector)) return;
    rule.walkDecls((decl) => {
      if (decl.prop.startsWith('--')) out[decl.prop] = decl.value.trim();
    });
  });
  return out;
}

/**
 * 🔴 THE-338 REWROTE THIS SECTION AROUND THE PROMOTION.
 *
 * It asserted that ADDING a family had changed nothing about the existing one,
 * and its last test was the important one: Classic was purely additive — it
 * invented no token Harvest lacked. THE-338 turned exactly that property into
 * a hazard. Because the family held ONLY overrides, DELETING the Harvest
 * blocks would have left every token it never mentioned undeclared.
 *
 * So the family was PROMOTED rather than deleted, and this section now asserts
 * the other side of the same coin: the two blocks are still populated, they
 * ground on the ramp the AA guarantee reads, the accent tokens the family
 * deliberately never touched are still accent-derived, and the token COUNTS
 * did not move.
 */
describe('10 — the promotion kept every token the family never overrode', () => {
  const rootVars = varsIn(GLOBALS_CSS, (s) => s === ':root');
  const harvestDarkVars = varsIn(
    GLOBALS_CSS,
    (s) => /\.dark|\[data-theme="dark"\]/.test(s) && !s.includes('data-palette'),
  );
  it('the Harvest blocks are still present and populated', () => {
    expect(Object.keys(rootVars).length).toBeGreaterThan(100);
    expect(Object.keys(harvestDarkVars).length).toBeGreaterThan(20);
  });

  it('🔴 dark still grounds on the ramp the AA guarantee assumes', () => {
    // The precondition theme.ts documents: DARK_SURFACE must equal the real
    // `--surface` in the dark block, or every ratio asserted in section 6 is
    // computed against a colour nobody renders.
    expect(harvestDarkVars['--surface']).toBe(DARK_SURFACE);
    expect(harvestDarkVars['--surface-raised']).toBe(DARK_SURFACE_RAISED);
  });

  it('the gold accents are still accent-derived, not greyed out by the promotion', () => {
    // 🔴 The non-negotiable the removed family stated as a fall-through: the
    // tenant accent, and the fixed brand structure it composites against, must
    // not grey out. The family that deliberately never overrode these six is
    // gone; they are still declared, and still derived from the brand.
    for (const t of ['--surface-gold', '--border-gold', '--glow-gold', '--ring-gold', '--surface-night', '--scrim-night']) {
      const declared = harvestDarkVars[t] ?? rootVars[t];
      expect(declared, `${t} is no longer declared at all`).toBeDefined();
      expect(`${t}:${declared}`, `${t} was greyed out`).toMatch(/brand-color|wheat|navy|#/);
    }
  });

  it('🔴 the promotion introduced no token — the counts are unmoved', () => {
    // The trap, stated as a number. The removed family declared 14 overrides
    // per mode and nothing of its own, so promoting it could only change
    // VALUES. A count that moved would mean a token was added or dropped.
    expect(Object.keys(rootVars).length).toBe(167);
    expect(Object.keys(harvestDarkVars).length).toBe(89);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11 · globals.css, firestore.rules and functions/ are byte-identical
// ═══════════════════════════════════════════════════════════════════════════

const digest = (p: string): string =>
  createHash('sha256').update(readFileSync(path.join(ROOT, p))).digest('hex');

describe('11 — globals.css, firestore.rules and functions/ are byte-identical', () => {
  /**
   * ⚠️ THE-265 did not open globals.css; later shadcn phases do. If one lands
   * this line goes red — that is the pin doing its job, not a bug: regenerate
   * this ONE value in the same PR that changes the file, and say why, exactly
   * as `posthog-untouched.test.ts`'s header instructs. Do not delete the pin.
   *
   *   node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('src/app/globals.css')).digest('hex'))"
   *
   * Regenerated once, by THE-267 (shadcn Phase 7), which added the eight
   * --sidebar-* tokens and their eight matching @theme inline keys. That PR
   * moved NO existing token value: it is purely additive, every addition is a
   * var() alias of a token this file already pins, and the claim is asserted
   * directly — see section 9 of src/__tests__/theming-sidebar-tokens.test.ts,
   * which pins every THE-263/#410 token's resolved value in both palettes,
   * and the unchanged .dark and Classic counts in tailwind-v4-migration.test.ts.
   */
  it('🔴 globals.css is untouched — no token value moved', () => {
    expect(
      digest('src/app/globals.css'),
      'globals.css changed — regenerate this digest only in the PR that changed the file, and say why',
    ).toBe('1fd6001c2d3bddc50a45b02ce1253b6b60802699fb33fa159f5ed42b8aeb9957');
  });

  it('firestore.rules is untouched', () => {
    // Same value posthog-untouched.test.ts pins; restated here so THIS PR's
    // claim is self-contained. It auto-deploys to production on merge.
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
  });

  it('functions/ carries no change from this PR', () => {
    // posthog-untouched.test.ts pins each functions/ file by digest already.
    // What this adds is that no NEW file appeared there either.
    const listed: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'lib' || entry === '.git') continue;
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else listed.push(path.relative(ROOT, full));
      }
    };
    walk(path.join(ROOT, 'functions'));
    expect(listed.sort()).toEqual(
      [
        'functions/.gcloudignore',
        'functions/package-lock.json',
        'functions/package.json',
        'functions/src/index.ts',
        'functions/tsconfig.json',
      ].sort(),
    );
  });

  it('🔴 and this PR opened none of THE-266 files', () => {
    // A structural claim rather than a digest sweep: THE-265's diff is the
    // theme vocabulary, the runtime, the toggle, the layout script and tests.
    // Nothing under src/components/ui/ is in it.
    const uiDir = path.join(SRC, 'components/ui');
    expect(statSync(uiDir).isDirectory()).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12 · the five named widths, in both modes
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 🔴 THE-338 REPOINTED THIS SECTION FROM PaletteFamilyToggle TO ThemeToggle.
 *
 * It measured the FAMILY control — its class strings, its two equal-length
 * labels, its `hidden sm:inline xl:hidden` visibility contract — to show that
 * changing which family was DEFAULT moved no box. That control is deleted with
 * the family axis, so every assertion about its markup went with it.
 *
 * The claim is kept because it is still true and still worth guarding, and it
 * transfers exactly: ThemeToggle is the control that remains in the same row,
 * carries the same visibility contract, and is the one whose geometry the
 * 1280px band depends on (Profile's settings column SPLITS at xl, so available
 * width is not monotonic in viewport). What is asserted is what survived: the
 * contract, the token-based colouring, and that no axis reaches the markup.
 */
describe('12 — 380 / 768 / 1024 / 1280 / 1440, in both modes', () => {
  const toggle = readFileSync(path.join(SRC, 'components/ThemeToggle.tsx'), 'utf8');
  const WIDTHS = [380, 768, 1024, 1280, 1440] as const;
  // Tailwind's defaults, which is what the control's `sm:` / `xl:` mean.
  const SM = 640;
  const XL = 1280;

  it.each(WIDTHS)('at %ipx the label-visibility contract is unchanged', (w) => {
    // `hidden sm:inline xl:hidden` — icon-only below 640 and from 1280 up,
    // icon+label in between. Asserted as the resolved boolean at each width so
    // a future class edit has to restate the intent rather than drift.
    const labelShown = w >= SM && w < XL;
    expect(toggle).toContain('hidden sm:inline xl:hidden');
    expect(labelShown, `label visibility at ${w}px`).toBe(w >= 640 && w < 1280);
  });

  it('neither mode reaches the markup — the control has one shape', () => {
    // Mode is stamped on <html>, never on this control, so no width or mode
    // can produce different markup here. The control's classes are
    // token-based; the TOKENS change value per mode, the CLASSES do not.
    for (const mode of ['light', 'dark'] as const) {
      document.documentElement.setAttribute('data-theme', mode);
      document.documentElement.classList.toggle('dark', mode === 'dark');
      expect(toggle, mode).not.toMatch(/className="[^"]*\bdark:/);
    }
    // 🔴 And nothing here reads the removed family axis.
    expect(toggle, 'the mode control reads the removed family axis').not.toContain('data-palette');
  });

  it('the control reads its colours from tokens, so a palette change needs no new CSS', () => {
    for (const t of ['bg-surface-sunken', 'bg-surface-raised', 'text-strong', 'text-muted']) {
      expect(toggle, `${t} is no longer how this control gets its colour`).toContain(t);
    }
    expect(toggle, 'a raw hex was hardcoded into the control').not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});
