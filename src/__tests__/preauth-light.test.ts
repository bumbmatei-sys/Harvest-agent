import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { contrastRatio, AA_CONTRAST, THEME_STORAGE_KEY } from '../lib/theme';
import { PREAUTH_PATHS, isPreAuthPath, normalizePath } from '../lib/preauth-theme';
import { applyThemeForLocation } from '../lib/theme-runtime';

/**
 * THE-85 — pre-auth screens are light mode only.
 *
 * The decision under test: every screen a prospective customer reaches before
 * they have a working account renders LIGHT, always — regardless of the stored
 * preference and regardless of the OS. Dark mode exists only behind auth.
 *
 * Both halves of the mechanism are exercised against the REAL artefacts: the
 * pre-paint <script> is extracted from layout.tsx and executed, and the client
 * applier is imported and called. A test that re-implemented either would keep
 * passing after the override was deleted, which is the failure mode these exist
 * to prevent.
 */

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');
const GLOBALS = path.join(ROOT, 'src/app/globals.css');
const LAYOUT = path.join(ROOT, 'src/app/layout.tsx');

/* ── the real pre-paint script, extracted and made runnable ─────────────────── */

/**
 * Pull the pre-paint theme script out of layout.tsx.
 *
 * layout.tsx holds two dangerouslySetInnerHTML blocks (this one and the tenant
 * brand <style>); match on the IIFE body so the right one is taken, and fail
 * loudly rather than silently testing nothing if the shape ever changes.
 */
function preePaintScript(): string {
  const layout = readFileSync(LAYOUT, 'utf8');
  const m = layout.match(/__html: `(\(function\(\)\{try\{[\s\S]*?)`,/);
  if (!m) throw new Error('pre-paint theme script not found in layout.tsx');
  return (
    m[1]
      // The source is a TS template literal read as raw text, so evaluate the
      // one interpolation it carries — using the SAME shared constant the
      // server does, which is the point of the test.
      .replace('${JSON.stringify(PREAUTH_PATHS)}', JSON.stringify(PREAUTH_PATHS))
      // …and unescape the template literal's `\\/`, which reaches the browser
      // as `\/`.
      .replace(/\\\\/g, '\\')
  );
}

const SCRIPT = preePaintScript();

/** Run the real pre-paint script against a given URL, as a fresh document would. */
function runPrePaint(url: string): void {
  window.history.replaceState({}, '', url);
  // eslint-disable-next-line no-new-func
  new Function(SCRIPT)();
}

/** What <html> is actually stamped with right now. */
const stamped = () => ({
  attr: document.documentElement.getAttribute('data-theme'),
  dark: document.documentElement.classList.contains('dark'),
});

let matchesDark = false;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-palette');
  document.documentElement.classList.remove('dark');
  matchesDark = false;
  // happy-dom reports prefers-color-scheme: dark as false and offers no way to
  // change it, so stub the query the way a dark-OS browser would answer.
  window.matchMedia = ((q: string) => ({
    matches: /prefers-color-scheme:\s*dark/.test(q) ? matchesDark : false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

/**
 * TEST 1 — the regression test for the whole issue.
 * 🔴 Removing the override from EITHER half must fail this by name.
 *
 * THE-168 extends this in place rather than adding a parallel test: the
 * stored FAMILY is set to 'classic' alongside mode='dark', and both halves
 * must force back to 'harvest' + light. A Classic pre-auth screen has never
 * been built or reviewed (see theme-runtime.ts's applyThemeForLocation), so
 * this is the same regression, one axis further.
 */
describe('a pre-auth screen renders light with the stored preference set to dark', () => {
  it.each(PREAUTH_PATHS)('%s is light before first paint and after a route change', (p) => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    // Half 1: the pre-paint script, i.e. a hard load / refresh / deep link.
    runPrePaint(p);
    expect(stamped(), `${p} painted dark/classic on load — this is THE-85, extended to family`).toEqual({
      attr: 'light',
      dark: false,
    });

    // Half 2: the client applier, i.e. signing out of dark mode navigates here
    // with no reload, so nothing re-runs the script.
    document.documentElement.classList.add('dark');
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.setAttribute('data-palette', 'classic');
    applyThemeForLocation(p);
    expect(stamped(), `${p} stayed dark/classic after a client-side navigation`).toEqual({
      attr: 'light',
      dark: false,
    });
  });

  it('leaves the dark palette itself untouched — the tokens still resolve', () => {
    // The fix must not delete or hardcode anything: `.dark` is simply never
    // stamped on a pre-auth screen, so every token resolves to its :root light
    // value. If the dark block were emptied instead, the signed-in app would go
    // light with it.
    const css = readFileSync(GLOBALS, 'utf8');
    let darkDecls = 0;
    postcss.parse(css).walkRules((rule) => {
      if (!/\.dark|\[data-theme="dark"\]/.test(rule.selector)) return;
      rule.walkDecls((d) => { if (d.prop.startsWith('--')) darkDecls += 1; });
    });
    expect(darkDecls, 'the dark palette was removed rather than overridden').toBeGreaterThan(40);
  });
});

/**
 * TEST 2 — prefers-color-scheme is deliberately overridden.
 */
describe('a pre-auth screen renders light with prefers-color-scheme: dark and no stored preference', () => {
  it.each(PREAUTH_PATHS)('%s ignores a dark OS', (p) => {
    matchesDark = true;
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();

    runPrePaint(p);
    expect(stamped(), `${p} followed the OS instead of forcing light`).toEqual({
      attr: 'light',
      dark: false,
    });

    applyThemeForLocation(p);
    expect(stamped()).toEqual({ attr: 'light', dark: false });
  });

  it('still follows a dark OS behind auth — the override is scoped, not global', () => {
    matchesDark = true;
    runPrePaint('/');
    // ⚠️ `/` is BEHIND auth, so no force applies and the family falls to the
    // default — which THE-265 moved from 'harvest' to 'classic'. The MODE
    // assertion (a dark OS is still followed here) is what this test is for
    // and it is unchanged; the family is written against the constant so it
    // tracks the default rather than re-pinning a literal.
    expect(stamped(), 'the OS preference stopped working everywhere').toEqual({
      attr: 'dark',
      dark: true,
    });
  });
});

/**
 * TEST 3 — the guard that stops this PR going too far.
 * 🔴 Applying the override to a signed-in screen must fail this by name.
 *
 * Extended to family: a signed-in screen must keep rendering the user's
 * stored 'classic' choice, not get silently pulled back to Harvest. This is
 * the mirror image of TEST 1 above and guards the same forcing logic from
 * the opposite direction — proof the force is scoped to pre-auth/funnel
 * screens rather than applied everywhere (STOP condition: a third stamping
 * path, or an over-broad one, would fail exactly here).
 */
describe('a signed-in screen still renders dark when the stored preference is dark', () => {
  const SIGNED_IN = ['/', '/admin', '/admin/crm', '/admin/docs/abc', '/bible', '/profile'];

  it.each(SIGNED_IN)('%s renders dark', (p) => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    runPrePaint(p);
    expect(stamped(), `${p} was forced light — dark mode is broken behind auth`).toEqual({
      attr: 'dark',
      dark: true,
    });

    applyThemeForLocation(p);
    expect(stamped(), `${p} was forced light/harvest on a client-side navigation`).toEqual({
      attr: 'dark',
      dark: true,
    });
  });

  it('classifies no signed-in path as pre-auth', () => {
    for (const p of SIGNED_IN) {
      expect(isPreAuthPath(p), `${p} is being treated as a pre-auth screen`).toBe(false);
    }
  });

  it('does not force light while the gate is merely resolving', () => {
    // OnboardingGate renders `children` — the whole signed-in app — in its
    // 'loading' state when there is no checkout marker. Forcing light there
    // would flash every dark-mode user light on every load.
    const gate = readFileSync(path.join(SRC, 'components/OnboardingGate.tsx'), 'utf8');
    expect(gate).toContain('useForcedLightTheme(rendersFunnelScreen)');
    expect(gate).toMatch(/status === 'loading' && onCheckoutSuccess/);
    expect(gate, "a bare status !== 'ready' would catch the pass-through states")
      .not.toContain("useForcedLightTheme(status !== 'ready')");
  });
});

/**
 * TEST 4 — the preference survives. Signing out and back in returns to dark.
 * Extended to family: signing out and back in must return the user to
 * 'classic' too, and neither key may be overwritten by the pre-auth force.
 */
describe('signing out and back in returns the user to dark', () => {
  it('round-trips /admin -> /auth -> / without losing the stored choice', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    // Signed in, dark + classic.
    applyThemeForLocation('/admin');
    expect(stamped()).toEqual({ attr: 'dark', dark: true });

    // Sign out: App.tsx navigates to /auth with no reload.
    applyThemeForLocation('/auth');
    expect(stamped()).toEqual({ attr: 'light', dark: false });
    expect(
      localStorage.getItem(THEME_STORAGE_KEY),
      'the pre-auth override overwrote the stored preference',
    ).toBe('dark');

    // Sign back in.
    applyThemeForLocation('/');
    expect(stamped(), 'dark did not come back after signing in again').toEqual({
      attr: 'dark',
      dark: true,
    });
  });

  it('never writes either storage key from the theme-application layer', () => {
    // Reading is fine; resolving the choice to 'light'/'harvest' and PERSISTING
    // it is how a user silently loses dark mode (or Classic) by signing out
    // once. One assertion covers both keys: theme-runtime.ts and layout.tsx
    // must contain no localStorage.setItem call at all.
    const runtime = readFileSync(path.join(SRC, 'lib/theme-runtime.ts'), 'utf8');
    expect(runtime).not.toMatch(/localStorage\.setItem/);
    expect(readFileSync(LAYOUT, 'utf8')).not.toMatch(/localStorage\.setItem/);
  });

  it('survives a hard reload of a pre-auth screen', () => {
    // ⚠️ Stores 'classic' deliberately: the point is that the funnel FORCES a
    // family rather than reading one, so the stored value is ignored on the
    // way in and still intact on the way out. THE-265 made the forced value
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    runPrePaint('/auth');
    expect(stamped()).toEqual({ attr: 'light', dark: false });
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });
});

/**
 * 🔴 THE-338 INVERTED THIS BLOCK RATHER THAN DELETING IT.
 *
 * It used to assert that a user with no stored FAMILY got the default one,
 * that a stored 'harvest' was honoured behind auth, and that the pre-auth
 * funnel forced the default family anyway — THE-85's guarantee extended one
 * axis, so the sign-in screen never rendered a combination nobody had
 * reviewed.
 *
 * There is one palette family now. The attribute is stamped by nothing, the
 * storage key is read by nothing, and the funnel has nothing left to force
 * beyond the MODE. Deleting the block would have left the pre-auth path with
 * no guard against the axis quietly coming back on exactly the screens THE-85
 * exists to protect, so what it asserts was flipped: the family axis is
 * ABSENT, and light is still forced without it.
 */
describe('the family axis is gone, and THE-85’s light force does not depend on it', () => {
  it('the pre-paint script stamps no family attribute on any path', () => {
    for (const p of [...PREAUTH_PATHS, '/', '/admin']) {
      document.documentElement.removeAttribute('data-palette');
      runPrePaint(p);
      expect(
        document.documentElement.getAttribute('data-palette'),
        `${p} stamped a palette family`,
      ).toBeNull();
    }
  });

  it('applyThemeForLocation stamps no family attribute either', () => {
    for (const p of [...PREAUTH_PATHS, '/', '/admin']) {
      document.documentElement.removeAttribute('data-palette');
      applyThemeForLocation(p);
      expect(
        document.documentElement.getAttribute('data-palette'),
        `${p} stamped a palette family`,
      ).toBeNull();
    }
  });

  it('a leftover stored family from before the removal changes nothing', () => {
    // A returning user still has 'harvest-theme-family' in localStorage. It is
    // deliberately not migrated or cleared — nothing reads it — so the proof
    // that it is inert is that setting it moves neither axis.
    localStorage.setItem('harvest-theme-family', 'harvest');
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    runPrePaint('/');
    expect(stamped()).toEqual({ attr: 'dark', dark: true });
    for (const p of PREAUTH_PATHS) {
      runPrePaint(p);
      expect(stamped(), `${p} stopped forcing light`).toEqual({ attr: 'light', dark: false });
    }
  });
});

/**
 * TEST 5 — the two lines the issue reports as unreadable. Computed, not asserted
 * against a hex, so a palette change cannot silently pass this.
 */
describe('the consent line and the tagline clear AA against the pre-auth background', () => {
  const css = readFileSync(GLOBALS, 'utf8');
  const authPage = readFileSync(path.join(SRC, 'components/AuthPage.tsx'), 'utf8');

  const lightVars: Record<string, string> = {};
  postcss.parse(css).walkRules((rule) => {
    if (rule.selector !== ':root') return;
    rule.walkDecls((d) => { if (d.prop.startsWith('--')) lightVars[d.prop] = d.value.trim(); });
  });

  /**
   * 🔴 THE-265 — the scope the funnel ACTUALLY renders in.
   *
   * This block used to resolve against `:root` alone, because the funnel was
   * forced to Harvest and `:root` IS Harvest light. The funnel now renders the
   * default family, so the real cascade is `:root` with Classic light's
   * overrides on top — and resolving against `:root` alone would be checking
   * contrast for a screen nobody sees. Built by cascading rather than by
   * listing, so a token Classic starts or stops overriding is picked up.
   */
  const classicLightOverrides: Record<string, string> = {};
  postcss.parse(css).walkRules((rule) => {
    if (!(rule.selector.includes('data-palette="classic"') && rule.selector.includes('data-theme="light"'))) return;
    rule.walkDecls((d) => { if (d.prop.startsWith('--')) classicLightOverrides[d.prop] = d.value.trim(); });
  });
  const funnelVars: Record<string, string> = { ...lightVars, ...classicLightOverrides };

  /** Resolve a var chain inside a light scope down to a literal hex. */
  function resolveIn(name: string, scope: Record<string, string>, depth = 0): string {
    const v = scope[name];
    if (!v || depth > 10) return v ?? '';
    const m = v.match(/^var\((--[a-z0-9-]+)\)$/i);
    return m ? resolveIn(m[1], scope, depth + 1) : v;
  }
  /** Harvest light — what `:root` alone says. */
  const resolve = (name: string): string => resolveIn(name, lightVars);

  /** The token a given line of copy actually paints with, read from the source. */
  function tokenFor(marker: string): string {
    const at = authPage.indexOf(marker);
    expect(at, `"${marker}" is no longer in AuthPage`).toBeGreaterThan(-1);
    // The colour is declared on the element wrapping the copy, just above it.
    const before = authPage.slice(Math.max(0, at - 600), at);
    const m = [...before.matchAll(/color:\s*'var\((--[a-z-]+)/g)].pop();
    expect(m, `no token found for "${marker}"`).not.toBeNull();
    return m![1];
  }

  // The ground AuthShell paints. Read from the source rather than assumed: if
  // the shell is ever re-grounded, the contrast must be recomputed against the
  // NEW ground, not against a stale constant.
  const groundToken = (() => {
    const shell = authPage.slice(authPage.indexOf('const AuthShell'), authPage.indexOf('const Eyebrow'));
    const m = shell.match(/background:\s*'var\((--[a-z-]+)/);
    expect(m, 'AuthShell no longer declares a background token').not.toBeNull();
    return m![1];
  })();

  it.each([
    ['consent line', 'By continuing you accept'],
    ['tagline', 'From conversion to devotion'],
  ])('%s clears AA 4.5:1 on the pre-auth ground', (_label, marker) => {
    const fg = resolve(tokenFor(marker));
    const bg = resolve(groundToken);
    expect(fg, 'foreground token did not resolve to a hex').toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(bg, 'background token did not resolve to a hex').toMatch(/^#[0-9A-Fa-f]{6}$/);

    const ratio = contrastRatio(fg, bg);
    expect(
      ratio,
      `${marker} is ${fg} on ${bg} = ${ratio.toFixed(2)}:1, needs ${AA_CONTRAST}:1`,
    ).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it.each([
    ['consent line', 'By continuing you accept'],
    ['tagline', 'From conversion to devotion'],
  ])('🔴 %s clears AA on the pre-auth ground IN THE FAMILY THAT RENDERS (THE-265)', (_label, marker) => {
    // The check THE-85's original argument said had never been done: the funnel
    // now renders Classic light, so the contrast that matters is the one in
    // Classic's scope, not Harvest's.
    const fg = resolveIn(tokenFor(marker), funnelVars);
    const bg = resolveIn(groundToken, funnelVars);
    expect(fg, 'foreground token did not resolve to a hex').toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(bg, 'background token did not resolve to a hex').toMatch(/^#[0-9A-Fa-f]{6}$/);

    const ratio = contrastRatio(fg, bg);
    expect(
      ratio,
      `${marker} is ${fg} on ${bg} = ${ratio.toFixed(2)}:1 in Classic light, needs ${AA_CONTRAST}:1`,
    ).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it('🔴 EVERY text token AuthPage paints clears AA in the family that renders', () => {
    // Not just the two lines the original issue named — the whole set the
    // screen actually uses, because THE-265 changed the family under all of
    // them at once. Enumerated from the source so a newly-added token is
    // covered without anyone remembering to list it here.
    const used = new Set<string>();
    for (const m of authPage.matchAll(/var\((--text-[a-z-]+)\)/g)) used.add(m[1]);
    for (const m of authPage.matchAll(/\btext-(strong|body|muted|faint|heading)\b/g)) used.add('--text-' + m[1]);
    expect(used.size, 'AuthPage paints no text tokens — the enumeration broke').toBeGreaterThan(0);

    const bg = resolveIn(groundToken, funnelVars);
    for (const token of [...used].sort()) {
      const fg = resolveIn(token, funnelVars);
      if (!/^#[0-9A-Fa-f]{6}$/.test(fg)) continue;
      const ratio = contrastRatio(fg, bg);
      expect(
        ratio,
        `${token} is ${fg} on ${bg} = ${ratio.toFixed(2)}:1 in Classic light`,
      ).toBeGreaterThanOrEqual(AA_CONTRAST);
    }
  });

  it('the ground itself is the same colour in both families, so the flip moved no background', () => {
    // --cream is not one of the 14 tokens Classic overrides. Worth pinning:
    // it is why the funnel flip changes the INK and not the paper.
    expect(resolveIn(groundToken, funnelVars)).toBe(resolve(groundToken));
  });

  it('is the light values that apply, because .dark is never stamped here', () => {
    // Same two lines resolved against the DARK ramp on the same cream ground —
    // the state THE-85 reported. Computed here to prove the force is what buys
    // the contrast above, not a lucky palette.
    const darkVars: Record<string, string> = {};
    postcss.parse(css).walkRules((rule) => {
      if (!/\.dark|\[data-theme="dark"\]/.test(rule.selector)) return;
      rule.walkDecls((d) => { if (d.prop.startsWith('--')) darkVars[d.prop] = d.value.trim(); });
    });
    const ground = resolve(groundToken);
    for (const marker of ['By continuing you accept', 'From conversion to devotion']) {
      const token = tokenFor(marker);
      const leaked = darkVars[token];
      expect(leaked, `${token} has no dark value to leak`).toBeDefined();
      expect(
        contrastRatio(leaked, ground),
        `${token} would have cleared AA on cream anyway — this test proves nothing`,
      ).toBeLessThan(AA_CONTRAST);
    }
  });
});

/**
 * TEST 6 — the fix did not hardcode anything.
 */
describe('no pre-auth component gained a hardcoded colour', () => {
  // Every screen the force applies to.
  const PREAUTH_FILES = [
    'components/AuthPage.tsx',
    'components/Onboarding.tsx',
    'components/ChurchOnboarding.tsx',
    'components/OnboardingGate.tsx',
    'components/FirstRunSetup.tsx',
    // THE-86: the post-payment handoff. Reached before the customer is signed
    // in on the new origin, so it is as pre-auth as the rest of this list.
    'components/WorkspaceHandoff.tsx',
  ];

  /**
   * Bare hex literals, i.e. NOT the `var(--token, #fallback)` form.
   *
   * A fallback is fine — the token still resolves and the hex is only reached
   * if the variable is missing entirely. A bare hex is the THE-85 shape: a
   * colour with no token behind it.
   *
   * ⚠️ These counts are the PRE-EXISTING baseline measured on
   * 35d9653 (origin/main after #295), not a target. They are the Google "G"
   * mark's four brand hexes plus the error/success banner pairs that predate
   * this PR. The assertion is `<=`: this PR must not add one, and removing the
   * banners' hexes later is a separate change that should lower the number.
   */
  const BARE_HEX_BASELINE: Record<string, number> = {
    'components/AuthPage.tsx': 10,
    'components/Onboarding.tsx': 3,
    'components/ChurchOnboarding.tsx': 3,
    'components/OnboardingGate.tsx': 0,
    'components/FirstRunSetup.tsx': 3,
    // A new screen starts at zero: there is no pre-existing baseline to inherit,
    // so it is held to the rule this test exists to enforce.
    'components/WorkspaceHandoff.tsx': 0,
  };

  const bareHexes = (file: string): string[] => {
    const src = readFileSync(path.join(SRC, file), 'utf8');
    const stripped = src.replace(/var\(\s*--[a-z0-9-]+\s*,\s*#[0-9A-Fa-f]{3,8}\s*\)/gi, 'var(--x)');
    return [...stripped.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((m) => m[0]);
  };

  it.each(PREAUTH_FILES)('%s gained no bare hex', (file) => {
    const found = bareHexes(file);
    expect(
      found.length,
      `${file} now has ${found.length} bare hexes (was ${BARE_HEX_BASELINE[file]}): ${found.join(', ')}`,
    ).toBeLessThanOrEqual(BARE_HEX_BASELINE[file]);
  });

  it.each(PREAUTH_FILES)('%s re-declares no ramp colour as a literal', (file) => {
    // Forcing light must not mean pasting the light values in. The whole point
    // is that the tokens still resolve — they just always resolve to light.
    const RAMP: Record<string, string> = {
      '#FAF8F5': '--surface / --cream',
      '#F3EEE7': '--surface-sunken',
      '#2D2519': '--text-strong',
      '#4A4038': '--text-body',
      '#68563F': '--text-muted',
      '#E8E2D9': '--border-default',
    };
    const offenders = bareHexes(file)
      .map((h) => h.toUpperCase())
      .filter((h) => h in RAMP)
      .map((h) => `${h} (use var(${RAMP[h]}))`);
    expect(offenders, `${file} hardcodes a ramp colour`).toEqual([]);
  });

  it('uses no /opacity modifier on a token-backed colour', () => {
    // A variable-backed colour emits NOTHING with `/NN` — silently, with no
    // error and no failing build. Scoped here to the pre-auth files and to the
    // theme layer this PR touched.
    const files = [...PREAUTH_FILES, 'lib/theme-runtime.ts', 'lib/preauth-theme.ts', 'App.tsx'];
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(path.join(SRC, f), 'utf8');
      for (const m of src.matchAll(
        /\b(bg-surface(?:-raised|-sunken|-chip|-tint|-gold|-night)?|border-line(?:-subtle|-strong)?|text-(?:strong|body|muted|faint)|(?:bg|text|border)-gold|(?:bg|border)-danger)\/\d+/g,
      )) {
        offenders.push(`${f}: ${m[0]}`);
      }
    }
    expect(offenders, 'variable-backed colours cannot take an opacity modifier').toEqual([]);
  });
});

/**
 * The two implementations of "is this a pre-auth path" must agree.
 *
 * The pre-paint script is a raw string and cannot import normalizePath, so it
 * mirrors it by hand. This runs the REAL script against the same table as the
 * function; a divergence surfaces here rather than as a dark flash in
 * production.
 */
describe('the pre-paint script and isPreAuthPath classify identically', () => {
  const TABLE = [
    '/auth', '/auth/', '/AUTH', '/auth?signup=church', '/onboarding', '/onboarding/',
    '/church-onboarding', '/church-onboarding/', '/', '', '/admin', '/admin/crm',
    '/authx', '/auth/extra', '/blog/1', '/onboarding-extra',
  ];

  it.each(TABLE)('%s', (p) => {
    runPrePaint(p || '/');
    // Storage is empty and the OS is light, so a non-pre-auth path resolves to
    // 'light' too — the distinguishing signal is that the script RETURNS EARLY
    // for a pre-auth path, which is what the dark-preference case below proves.
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    runPrePaint(p || '/');
    expect(stamped().dark).toBe(!isPreAuthPath(p || '/'));
    localStorage.clear();
  });

  it('normalizePath handles the forms a browser can actually produce', () => {
    expect(normalizePath('/auth/')).toBe('/auth');
    expect(normalizePath('/AUTH')).toBe('/auth');
    expect(normalizePath('')).toBe('/');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('/auth?x=1')).toBe('/auth');
  });

  it('the script is inline, pre-paint, and cannot throw', () => {
    const layout = readFileSync(LAYOUT, 'utf8');
    // next/script defers; a plain inline <script> in <head> runs before the
    // body renders, which is what makes this flash-free.
    expect(layout).toMatch(/<script\s+dangerouslySetInnerHTML/);
    expect(SCRIPT).toMatch(/^\(function\(\)\{try\{/);
    expect(SCRIPT).toMatch(/catch\(_\)\{\}/);
  });

  it('interpolates the shared path list rather than duplicating it', () => {
    const layout = readFileSync(LAYOUT, 'utf8');
    expect(layout).toContain('PREAUTH_PATHS');
    expect(layout).toContain('JSON.stringify(PREAUTH_PATHS)');
    for (const p of PREAUTH_PATHS) {
      expect(SCRIPT, `${p} missing from the emitted script`).toContain(`"${p}"`);
    }
  });

  it('documents why prefers-color-scheme is overridden', () => {
    // Without the note, the next reader "fixes" the override back out.
    const layout = readFileSync(LAYOUT, 'utf8');
    // Bounded to the comment block immediately above the script — a note buried
    // elsewhere in the file is not the one the next reader will see.
    const preamble = layout.slice(0, layout.indexOf('dangerouslySetInnerHTML'));
    expect(preamble).toMatch(/prefers-color-scheme is DELIBERATELY overridden/i);
  });
});

/**
 * Coverage guard: a pre-auth screen that injects an UNLAYERED :root would
 * outrank @layer base and could re-introduce a dark value the override cannot
 * reach. That is #258's bug (AIChat), and it must not appear on a funnel screen.
 */
describe('no pre-auth screen injects its own style block', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) {
        if (e !== '__tests__' && e !== 'node_modules') walk(p, out);
      } else if (/\.tsx?$/.test(e)) out.push(p);
    }
    return out;
  }

  const PREAUTH_TREE = [
    'components/AuthPage.tsx',
    'components/Onboarding.tsx',
    'components/ChurchOnboarding.tsx',
    'components/OnboardingGate.tsx',
    'components/FirstRunSetup.tsx',
    'components/WorkspaceHandoff.tsx',
    'components/settings/BrandingSection.tsx',
    'components/settings/DomainSection.tsx',
  ];

  it.each(PREAUTH_TREE)('%s declares no <style> and no :root', (file) => {
    const src = readFileSync(path.join(SRC, file), 'utf8');
    expect(src, 'an unlayered :root here would outrank the override').not.toMatch(/<style[\s>]/);
    expect(src).not.toContain(':root');
  });

  it('AIChat — the known offender — is not reachable pre-auth', () => {
    // Guards the pairing: AIChat still injects an unlayered :root (by design,
    // see theming-gaps.test.ts), so it must stay behind auth.
    const files = walk(SRC).filter((f) => PREAUTH_TREE.some((p) => f.endsWith(p)));
    for (const f of files) {
      expect(readFileSync(f, 'utf8'), `${f} pulls AIChat onto a pre-auth screen`)
        .not.toMatch(/from\s+'[./]*(?:components\/)?AIChat'/);
    }
  });
});
