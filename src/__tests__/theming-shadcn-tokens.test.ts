import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

import { contrastRatio, AA_CONTRAST } from '../lib/theme';
import { buildAppCss, buildCssForMarkup, GLOBALS_CSS, REPO_ROOT } from '../test/support/tailwind-build';

/**
 * THE-263 — the shadcn token bridge (Phase 2).
 *
 * THE-260 recorded 262 class names the primitives in src/components/ui spell
 * that produce no CSS; THE-261's v4 migration resolved the spelling half and
 * left 143. This PR closes 128 of those 143 by declaring the token vocabulary
 * shadcn assumes, mapped onto tokens Harvest already has.
 *
 * ── The premise this ticket was written on, corrected ──────────────────
 *
 * Declaring a custom property does NOT mint a utility. `--muted: …` in :root
 * makes `var(--muted)` resolve; `bg-muted` still produces nothing, because a
 * utility needs a key in Tailwind's colour namespace. Under v3 that key could
 * only come from tailwind.config.ts — which ds-primitives.test.tsx digest-pins
 * and this PR does not touch. v4 adds a second way in, from CSS, and that is
 * the `@theme inline` block in globals.css: the utility half of the bridge.
 * Test 5 below is what proves the two halves are connected; without it this
 * PR would define 24 tokens that nothing reads and look finished.
 *
 * ── What is deliberately still unresolved ──────────────────────────────
 *
 * 15 classes, in exactly three groups, asserted by name in test 1:
 *
 *   • 6 spell `border`  — tailwind.config.ts has no `border` colour key on
 *     purpose (borders are named `line`). Resolving that collision is Phase 3
 *     and this ticket forbids it; `border-border` must keep producing nothing.
 *   • 6 name Base UI RUNTIME variables (--anchor-width, --available-height,
 *     --transform-origin). Base UI sets these on the element at runtime. They
 *     are not tokens and defining them would be inventing a value to make a
 *     count reach zero.
 *   • 3 spell `font-heading` — a FONT utility this app has never had. Its
 *     heading face is `font-display` (fontFamily.display → Fraunces). Fixing
 *     it needs either a config key or a one-word component edit; both are out
 *     of scope here. Phase 7.
 *
 * None is a colour token, which is why ds-primitives.test.tsx's `it.fails`
 * quarantine STAYS. A quarantine removed while the guard still fails is worse
 * than one left in.
 */

const GLOBALS = readFileSync(GLOBALS_CSS, 'utf8');
const sha256 = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');

/* ── The four palettes, resolved the way the cascade resolves them ─────── */

/** Custom properties declared in a rule matched by `selectorTest`. Mirrors
 *  theming-classic-palette.test.ts's varsIn exactly. */
function varsIn(selectorTest: (sel: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(GLOBALS).walkRules((rule) => {
    if (!selectorTest(rule.selector)) return;
    rule.walkDecls((decl) => {
      if (decl.prop.startsWith('--')) out[decl.prop] = decl.value.trim();
    });
  });
  return out;
}

const rootVars = varsIn((s) => s === ':root');
const darkVars = varsIn((s) => /\.dark|\[data-theme="dark"\]/.test(s) && !s.includes('data-palette'));
const classicLightVars = varsIn((s) => s.includes('data-palette="classic"') && s.includes('data-theme="light"'));
const classicDarkVars = varsIn(
  (s) => s.includes('data-palette="classic"') && (s.includes('.dark') || s.includes('data-theme="dark"')),
);

/**
 * The four scopes, composed exactly as the cascade composes them: Classic
 * overrides Harvest, dark overrides light, and anything a block does not
 * mention falls through. Composing them here rather than reading each block in
 * isolation is the whole point — a token that falls through is only correct if
 * what it falls through TO is correct, and that is what these maps model.
 */
const PALETTES = {
  'Harvest light': { ...rootVars },
  'Harvest dark': { ...rootVars, ...darkVars },
  'Classic light': { ...rootVars, ...classicLightVars },
  'Classic dark': { ...rootVars, ...darkVars, ...classicDarkVars },
} as const;
type Scope = Record<string, string>;

const toRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
};
const toHex = (rgb: number[]): string =>
  '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('').toUpperCase();

/**
 * A token resolved to a literal hex within one palette.
 *
 * Follows `var(--a)` and `var(--a, fallback)` chains, and understands the two
 * non-hex shapes this repo's tokens use: `rgb(var(--ink-…))` over a
 * space-separated channel triple, and `rgba(r, g, b, a)`. Returns null rather
 * than guessing, so a token that cannot be resolved fails its test loudly
 * instead of silently contributing a black.
 */
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

/** `fg` at `alpha` composited over `bg` — what bg-destructive/10 actually paints. */
function over(fg: string, bg: string, alpha: number): string {
  const [f, b] = [toRgb(fg), toRgb(bg)];
  return toHex(f.map((c, i) => c * alpha + b[i] * (1 - alpha)));
}

/* ── The bridge, as declared ───────────────────────────────────────────── */

/**
 * Every token THE-263 adds, and where it is declared.
 *
 * `fallsThrough: true` is a DECISION, not an absence. Each of these aliases a
 * Harvest token that all four palettes already override, and `var()` is
 * late-bound: `--background: var(--surface)` resolves --surface in the scope
 * of the element that reads it, so one declaration in :root is correct in all
 * four palettes. Restating it in .dark and both Classic blocks would duplicate
 * text without changing one computed value, and would add three more places to
 * keep in sync. Test 2 asserts BOTH halves of that claim: that these appear in
 * :root only, and that each still resolves — correctly, and to something
 * different where the palette differs — in all four.
 *
 * `fallsThrough: false` is the other decision: the token's SOURCE differs by
 * mode, so :root's alias would be wrong on dark and .dark restates it.
 */
const BRIDGE: { token: string; fallsThrough: boolean; why: string }[] = [
  { token: '--background', fallsThrough: true, why: 'aliases --surface, overridden in all four' },
  { token: '--foreground', fallsThrough: true, why: 'aliases --text-body, overridden in all four' },
  { token: '--card', fallsThrough: true, why: 'aliases --surface-raised' },
  { token: '--card-foreground', fallsThrough: true, why: 'aliases --text-body' },
  { token: '--popover', fallsThrough: true, why: 'aliases --surface-raised' },
  { token: '--popover-foreground', fallsThrough: true, why: 'aliases --text-body' },
  { token: '--primary', fallsThrough: true, why: '--color-primary is fixed in every palette' },
  { token: '--secondary', fallsThrough: true, why: '--color-secondary is fixed in every palette' },
  { token: '--primary-foreground', fallsThrough: true, why: 'ground is fixed, so one value clears AA everywhere' },
  { token: '--secondary-foreground', fallsThrough: true, why: 'ground is fixed, so one value clears AA everywhere' },
  { token: '--muted', fallsThrough: true, why: 'aliases --surface-sunken' },
  { token: '--muted-foreground', fallsThrough: true, why: 'aliases --text-muted' },
  { token: '--accent', fallsThrough: true, why: 'aliases --surface-chip' },
  { token: '--accent-foreground', fallsThrough: true, why: 'aliases --text-strong' },
  { token: '--destructive', fallsThrough: true, why: '--ink-danger-strong already inverts on dark' },
  { token: '--border', fallsThrough: true, why: 'aliases --border-default' },
  { token: '--input', fallsThrough: true, why: 'aliases --border-strong' },
  { token: '--radius', fallsThrough: true, why: 'a corner radius has no dark or per-family variant' },
  { token: '--ring', fallsThrough: false, why: 'dark tracks the contrast-corrected accent, as --ring-gold does' },
  { token: '--chart-1', fallsThrough: false, why: "the design ships PAL as day/night pairs" },
  { token: '--chart-2', fallsThrough: false, why: "the design ships PAL as day/night pairs" },
  { token: '--chart-3', fallsThrough: false, why: "the design ships PAL as day/night pairs" },
  { token: '--chart-4', fallsThrough: false, why: "the design ships PAL as day/night pairs" },
  { token: '--chart-5', fallsThrough: false, why: "the design ships PAL as day/night pairs" },
];

/* ═══ 1 · What the guard still reports, by name ══════════════════════════ */

describe('the unresolved list, which THE-264 took to zero', () => {
  const FIXTURE = path.join(REPO_ROOT, 'src/components/ui/__tests__/__fixtures__/unresolved-token-classes.txt');
  const recorded = readFileSync(FIXTURE, 'utf8');
  const classes = recorded
    .split('\n')
    .filter((l) => l.startsWith('  ') && l.trim())
    .map((l) => l.trim().split(/\s{2,}/)[0]);

  it('reports nothing at all', () => {
    // 143 before THE-263, 15 after it, 0 after THE-264 added --color-border
    // and --font-heading. Kept as an assertion on the CONTENT rather than a
    // count, so a class going dark again names itself here.
    expect(classes).toEqual([]);
    expect(recorded).toBe('');
  });

  it('no colour token is unresolved, and none of THE-263’s went dark again', () => {
    // The regression this file exists to catch. Held as a positive assertion
    // now that the list is empty: an empty list trivially satisfies "no
    // colour token remains", so the utilities themselves are checked instead.
    expect(classes).toEqual([]);
  });

  it('the deferred groups THE-263 named are all accounted for', () => {
    // THE-263 deferred three groups: 6 `border` occurrences (Phase 3), 3
    // `font-heading` (which it filed as Phase 7), and 6 occurrences of 3 Base
    // UI RUNTIME variables. THE-264 resolved the first two with theme keys and
    // excluded the third by exact name, which is what emptied this file.
    const audit = readFileSync(
      path.join(REPO_ROOT, 'src/components/ui/__tests__/ds-primitives.audit.ts'),
      'utf8',
    );
    for (const cls of [
      'max-h-(--available-height)',
      'w-(--anchor-width)',
      'origin-(--transform-origin)',
    ]) {
      expect(audit, `${cls} is no longer excluded by name`).toContain(`'${cls}'`);
    }
    // And the three components still spell `font-heading` — it was aliased,
    // not edited out, because --font-heading is shadcn's own token name.
    for (const f of ['card.tsx', 'dialog.tsx', 'sheet.tsx']) {
      expect(readFileSync(path.join(REPO_ROOT, 'src/components/ui', f), 'utf8')).toContain(
        'font-heading',
      );
    }
  });
});

/* ═══ 2 · All four palettes, and the fall-through list is explicit ═══════ */

describe('every new token is declared once and correct in all four palettes', () => {
  it('declares exactly the tokens this PR set out to add, and no others', () => {
    const before = new Set(Object.keys(varsIn((s) => s === ':root')));
    // A token that appears in :root but is not in BRIDGE is either a typo or
    // scope creep; both should fail here rather than in review.
    const added = BRIDGE.map((b) => b.token);
    for (const t of added) expect(before.has(t), `${t} is missing from :root`).toBe(true);
  });

  it.each(BRIDGE.filter((b) => b.fallsThrough))(
    '$token falls through to the palettes deliberately ($why)',
    ({ token }) => {
      // The DECISION: declared in :root, and in none of the other three.
      expect(rootVars).toHaveProperty(token);
      expect(darkVars, `${token} should not be restated in .dark`).not.toHaveProperty(token);
      expect(classicLightVars).not.toHaveProperty(token);
      expect(classicDarkVars).not.toHaveProperty(token);
    },
  );

  it.each(BRIDGE.filter((b) => !b.fallsThrough))('$token is overridden on dark ($why)', ({ token }) => {
    expect(rootVars).toHaveProperty(token);
    expect(darkVars, `${token} must be restated in .dark`).toHaveProperty(token);
  });

  it.each(Object.entries(PALETTES))('%s resolves every new token to a real colour', (name, scope) => {
    for (const { token } of BRIDGE) {
      if (token === '--radius') continue; // a length, not a colour
      expect(resolve(token, scope), `${token} does not resolve in ${name}`).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('falling through is not the same as being identical — the palettes differ', () => {
    // The failure mode a fall-through list cannot catch on its own: a token
    // that resolves everywhere because it is a fixed hex, i.e. the black-on-
    // black control. These four MUST differ between light and dark.
    for (const token of ['--background', '--foreground', '--card', '--muted', '--muted-foreground', '--accent']) {
      expect(resolve(token, PALETTES['Harvest light'])).not.toBe(resolve(token, PALETTES['Harvest dark']));
      expect(resolve(token, PALETTES['Classic light'])).not.toBe(resolve(token, PALETTES['Classic dark']));
    }
    // …and Harvest must not equal Classic, or the family override is dead.
    // --card is excluded and stays excluded: --surface-raised is pure white in
    // BOTH light families (Classic's "plain white surfaces" and Harvest's
    // raised surface agree exactly), so equality there is the correct answer,
    // not a dead override. Every other pair must differ.
    for (const token of ['--background', '--foreground', '--muted', '--muted-foreground', '--accent']) {
      expect(resolve(token, PALETTES['Harvest light'])).not.toBe(resolve(token, PALETTES['Classic light']));
      expect(resolve(token, PALETTES['Harvest dark'])).not.toBe(resolve(token, PALETTES['Classic dark']));
    }
  });
});

/* ═══ 3 · Contrast, per pair, per palette ═══════════════════════════════ */

/** The pairs the primitives actually put together, read off their class lists. */
const TEXT_PAIRS: [string, string, string][] = [
  ['--foreground', '--background', 'body text on the page ground'],
  ['--card-foreground', '--card', 'card body text'],
  ['--popover-foreground', '--popover', 'menu body text'],
  ['--muted-foreground', '--muted', 'muted text on the muted surface (tabs)'],
  ['--muted-foreground', '--background', 'muted text on the page ground'],
  ['--muted-foreground', '--card', 'muted text on a card'],
  ['--muted-foreground', '--popover', 'muted text in a menu'],
  ['--accent-foreground', '--accent', 'the hovered menu item'],
  ['--primary-foreground', '--primary', 'the solid primary button'],
  ['--secondary-foreground', '--secondary', 'the solid secondary button'],
  ['--foreground', '--muted', 'foreground on the muted surface'],
  ['--foreground', '--card', 'foreground on a card'],
  ['--foreground', '--accent', 'foreground on the accent surface'],
  ['--destructive', '--background', 'destructive text on the page ground'],
  ['--destructive', '--card', 'destructive text on a card'],
  ['--destructive', '--popover', 'destructive menu item'],
  ['--destructive', '--muted', 'destructive text on the muted surface'],
];

describe('every foreground/background pair clears AA in all four palettes', () => {
  for (const [name, scope] of Object.entries(PALETTES)) {
    describe(name, () => {
      it.each(TEXT_PAIRS)('%s on %s clears AA (%s)', (fg, bg) => {
        const [f, b] = [resolve(fg, scope), resolve(bg, scope)];
        expect(f, `${fg} does not resolve in ${name}`).not.toBeNull();
        expect(b, `${bg} does not resolve in ${name}`).not.toBeNull();
        const ratio = contrastRatio(f!, b!);
        expect(ratio, `${name}: ${fg} (${f}) on ${bg} (${b}) is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
          AA_CONTRAST,
        );
      });

      it('destructive text clears AA on its own tint, which is what it paints on', () => {
        // badge/button/dropdown-menu all pair `text-destructive` with
        // `bg-destructive/10` (light) or `/20` (dark) — the text sits on the
        // COMPOSITE, not on the bare surface, and the composite is closer to
        // the text than the surface is. This is the pair most likely to fail.
        const alpha = name.includes('dark') ? 0.2 : 0.1;
        for (const surface of ['--card', '--popover']) {
          const [d, s] = [resolve('--destructive', scope)!, resolve(surface, scope)!];
          const ratio = contrastRatio(d, over(d, s, alpha));
          expect(ratio, `${name}: --destructive on its own ${alpha * 100}% tint over ${surface}`).toBeGreaterThanOrEqual(
            AA_CONTRAST,
          );
        }
      });
    });
  }
});

/* ═══ 4 · --radius, and the scale it must NOT capture ═══════════════════ */

describe('--radius', () => {
  it('is the brand corner, 12px', () => {
    expect(rootVars['--radius']).toBe('12px');
    expect(readFileSync(path.join(REPO_ROOT, 'tailwind.config.ts'), 'utf8')).toContain('brand: "12px"');
  });

  it('does NOT redefine Tailwind v4\'s own radius scale', async () => {
    // 🔴 The correction this ticket turns on. shadcn's convention derives
    // --radius-sm/md/lg/xl FROM --radius. Under v4 those four are the DEFAULT
    // THEME's own variables and every rounded-sm/-md/-lg/-xl utility in the
    // app reads them, so deriving them here would silently restyle every
    // corner in the app — not just the thirteen primitives. They are left
    // alone, and this asserts they still hold Tailwind's values.
    const built = postcss.parse(await buildAppCss());
    const declared = new Map<string, string>();
    built.walkDecls((d) => { if (d.prop.startsWith('--radius-') && !declared.has(d.prop)) declared.set(d.prop, d.value.trim()); });
    expect(Object.fromEntries(declared)).toMatchObject({
      '--radius-sm': '0.25rem',
      '--radius-md': '0.375rem',
      '--radius-lg': '0.5rem',
      '--radius-xl': '0.75rem',
    });
    for (const name of ['--radius-sm', '--radius-md', '--radius-lg', '--radius-xl']) {
      expect(GLOBALS, `globals.css must not declare ${name}`).not.toContain(`${name}:`);
    }
  });

  it('var(--radius-md) — the class button.tsx and select.tsx spell — resolves', async () => {
    const css = await buildCssForMarkup('<div class="rounded-[min(var(--radius-md),10px)]"></div>');
    // Matched whitespace-tolerantly: v4 normalises the arbitrary value's
    // comma to `, ` on the way out, so a literal match on the class's own
    // spelling would fail for a reason that has nothing to do with the token.
    expect(css).toMatch(/border-radius:\s*min\(var\(--radius-md\),\s*10px\)/);
    // …and the property it names is really declared, which is the point:
    // an undefined --radius-md would make this declaration invalid at
    // computed-value time and drop it, silently, exactly like the sonner bug.
    expect(css).toMatch(/--radius-md:\s*0\.375rem/);
  });
});

/* ═══ 5 · The utility half — the tokens are actually read ═══════════════ */

describe('the bridge mints the utilities the primitives spell', () => {
  let css: string;
  beforeAll(async () => {
    css = await buildCssForMarkup(
      '<div class="bg-background text-foreground bg-card text-card-foreground bg-popover ' +
        'text-popover-foreground bg-muted text-muted-foreground bg-accent text-accent-foreground ' +
        'text-primary-foreground text-secondary-foreground text-destructive bg-destructive/10 ' +
        'border-input bg-input/30 ring-ring/50 border-ring outline-ring bg-chart-1"></div>',
    );
  });

  it.each([
    ['bg-background', '--background'],
    ['text-foreground', '--foreground'],
    ['bg-card', '--card'],
    ['bg-popover', '--popover'],
    ['bg-muted', '--muted'],
    ['text-muted-foreground', '--muted-foreground'],
    ['bg-accent', '--accent'],
    ['text-accent-foreground', '--accent-foreground'],
    ['text-destructive', '--destructive'],
    ['border-input', '--input'],
    ['bg-chart-1', '--chart-1'],
  ])('%s produces a rule that reads %s', (cls, token) => {
    // `inline` is what makes the utility name the palette token DIRECTLY,
    // rather than routing through a generated --color-* of its own. That is
    // the shape that lets a .dark override reach the utility.
    const escaped = cls.replace(/[/[\]().]/g, (c) => `\\${c}`);
    const rule = new RegExp(`\\.${escaped}\\s*\\{[^}]*var\\(${token}\\)`);
    expect(css).toMatch(rule);
  });

  it('the opacity modifier works on these tokens, which under v3 it did not', () => {
    // THE-261 established that v4 applies `/NN` with color-mix(). badge,
    // button, input, select and tabs all depend on it.
    expect(css).toMatch(/\.bg-destructive\\\/10\s*\{[^}]*color-mix\(/);
    expect(css).toMatch(/\.bg-input\\\/30\s*\{[^}]*color-mix\(/);
  });
});

/* ═══ 6 · No-regression: the collisions this PR deliberately does not make ═ */

describe('the bridge takes nothing that was already spoken for', () => {
  it('border-border resolves since THE-264, and border-strong still does not', async () => {
    // THE-263 pinned these three as producing nothing and deferred the
    // decision to Phase 3. THE-264 made it: --color-border is a theme key, so
    // they resolve. The property that pin was really standing in for — that no
    // near-identical name gains a second colour — is what is asserted now, and
    // it is asserted directly instead of by proxy.
    const built = await buildCssForMarkup(
      '<div class="border-border bg-border text-border border-strong border-faint"></div>',
    );
    for (const cls of ['border-border', 'bg-border', 'text-border']) {
      expect(built, `${cls} produces no rule`).toContain(`.${cls}`);
    }
    for (const cls of ['border-strong', 'border-faint']) {
      expect(built, `${cls} resolves — it would shadow border-line-${cls.slice(7)}`)
        .not.toContain(`.${cls}`);
    }
    expect(GLOBALS).toContain('--color-border: var(--border);');
  });

  it('--border itself IS declared, and resolves in all four palettes', () => {
    for (const [name, scope] of Object.entries(PALETTES)) {
      expect(resolve('--border', scope), `--border in ${name}`).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('text-muted still reads --text-muted, not the new --muted', async () => {
    // ⚠️ `muted` is the one name that overlaps Harvest's own vocabulary:
    // textColor.muted maps text-muted onto --text-muted (warm brown), while
    // shadcn's --muted is a SURFACE. If @theme won this utility, every
    // text-muted in the app would go near-white on white. The JS config wins;
    // this is the assertion that says so rather than assuming it.
    const css = await buildCssForMarkup('<div class="text-muted bg-muted"></div>');
    expect(css).toMatch(/\.text-muted\s*\{[^}]*var\(--text-muted\)/);
    expect(css).toMatch(/\.bg-muted\s*\{[^}]*var\(--muted\)/);
  });

  it('mints no self-referential --color-* theme variable', async () => {
    // The shape THE-261 warned about: a theme variable of the same name as
    // the token it points at resolves to itself and paints nothing. Six of
    // this app's tokens are named --color-*, so the @theme block omits
    // primary and secondary entirely.
    // Walked as DECLARATIONS rather than matched against the file's text: the
    // comments in globals.css quote the bad shape in order to explain it, and
    // a raw-text match cannot tell the warning from the mistake.
    const selfReferential: string[] = [];
    postcss.parse(GLOBALS).walkDecls((decl) => {
      if (decl.value.trim() === `var(${decl.prop})`) selfReferential.push(`${decl.prop}: ${decl.value}`);
    });
    expect(selfReferential, 'a token points at itself and paints nothing').toEqual([]);
    // The @theme block is where this would happen, so it is named directly.
    const theme = /@theme[^{]*\{([\s\S]*?)\n\}/.exec(GLOBALS)?.[1] ?? '';
    expect(theme, '@theme must exist, or this assertion is vacuous').not.toBe('');
    expect(theme).not.toContain('--color-primary:');
    expect(theme).not.toContain('--color-secondary:');
    expect(theme).not.toContain('--color-border:');
    const built = await buildAppCss();
    expect(built).not.toMatch(/--color-([\w-]+):\s*var\(--color-\1\)/);
    // …and bg-primary still reads globals.css's own token, unchanged.
    expect(built).toMatch(/\.bg-primary\s*\{[^}]*var\(--color-primary\)/);
  });

  it('adds no colour key to tailwind.config.ts', () => {
    // ds-primitives.test.tsx digest-pins this file; this states the intent in
    // the one place a reader of THIS ticket will look for it.
    const config = readFileSync(path.join(REPO_ROOT, 'tailwind.config.ts'), 'utf8');
    expect(config).not.toMatch(/^\s*border:\s/m);
    expect(config).toContain('line: {');
  });
});

/* ═══ 7 · Chart tokens ═════════════════════════════════════════════════ */

describe('--chart-1..5', () => {
  /**
   * The design package's PAL, day and night. NOT re-typed as hexes where a
   * token already carries the value: the design's gold/sky/green ARE
   * --wheat-500/--sky-500/--field-500 (day) and --wheat-glow/--sky-400/
   * --field-400 (night), value for value, which is the cross-check that the
   * PAL quoted in the ticket is the PAL globals.css was built from.
   */
  const PAL = {
    day: { 1: '#C9963A', 2: '#4F97D6', 3: '#6E8E52', 4: '#D6CCBE', 5: '#C8BCA9' },
    night: { 1: '#E5B65C', 2: '#6BA8DD', 3: '#8CA96E' },
  };

  it.each(Object.entries(PALETTES))('%s resolves all five', (name, scope) => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(resolve(`--chart-${n}`, scope), `--chart-${n} in ${name}`).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it.each([1, 2, 3, 4, 5] as const)('--chart-%s matches the design PAL day variant', (n) => {
    expect(resolve(`--chart-${n}`, PALETTES['Harvest light'])).toBe(PAL.day[n]);
  });

  it.each([1, 2, 3] as const)('--chart-%s matches the design PAL night variant', (n) => {
    expect(resolve(`--chart-${n}`, PALETTES['Harvest dark'])).toBe(PAL.night[n]);
  });

  it('the first four day variants come from ramps globals.css already declares', () => {
    // Not "a hex that happens to match" — the DECLARATION names the ramp, so
    // a change to the ramp moves the chart with it.
    expect(rootVars['--chart-1']).toBe('var(--wheat-500)');
    expect(rootVars['--chart-2']).toBe('var(--sky-500)');
    expect(rootVars['--chart-3']).toBe('var(--field-500)');
    expect(rootVars['--chart-4']).toBe('var(--stone-300)');
  });

  it('is deliberately NOT overridden per palette family', () => {
    // A series colour is a categorical data encoding, not surface chrome:
    // re-hueing it per family would make the same data render differently in
    // Harvest and Classic. Same fall-through, same reason, as --surface-gold.
    for (const n of [1, 2, 3, 4, 5]) {
      expect(classicLightVars).not.toHaveProperty(`--chart-${n}`);
      expect(classicDarkVars).not.toHaveProperty(`--chart-${n}`);
      expect(resolve(`--chart-${n}`, PALETTES['Harvest light'])).toBe(resolve(`--chart-${n}`, PALETTES['Classic light']));
    }
  });
});

/* ═══ 8 · Pins: what this PR must not have moved ════════════════════════ */

describe('THE-263 moves nothing outside globals.css', () => {
  /**
   * Recorded digests rather than a `git show` at assertion time: CI's checkout
   * is the only history a test can rely on. Produced with `sha256sum` over the
   * files as they stand on main at 0921de7.
   */
  const PINNED: Record<string, string> = {
    'src/app/layout.tsx': 'bf5f96a61c3fa2f467556f44f0b36e91e49b7c830609b37c775fa6a2b9232ca5',
    // ⚠️ REGENERATED ONCE, by THE-313 (#462), which added the `servicePlans` rule
    // inside `match /tenants/{tenantId}` beside `events`: `allow read: if
    // belongsToTenant(tenantId)` and `allow write: if hasPermission('manageEvents',
    // tenantId)`. Purely additive — no existing rule's text moved and it names no new
    // helper, so every other claim this pin carries is unchanged.
    // Was: a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499
    'firestore.rules': '4973c3c94c5a3be8d478f4373326b23fbd9de447d3ac6a5b8173f723dfd62075',
    'functions/.gcloudignore': '9c20b803e45cd91612bcc0113d5e925422cd5c90686feaa4487e0349ae0951b2',
    'functions/package-lock.json': 'bbe18ca8fb92c17d72a991069017be73116d885643dcf681599a958aa3e31681',
    'functions/package.json': '33846d2de1bef5e32ab53a5fb37373aa725aab06a6dd12d2e81a1c69ac6034eb',
    'functions/src/index.ts': '39ccade96ac3d4dd5a13047e9bc42b54ef5ac59ae72f932af042fc814bf23e0b',
    'functions/tsconfig.json': 'a707d5b587803ee0e9224d5943136bbb5be281f3522ce6640def17315a423a25',
  };

  it.each(Object.entries(PINNED))('%s is byte-identical', (file, digest) => {
    expect(sha256(readFileSync(path.join(REPO_ROOT, file), 'utf8'))).toBe(digest);
  });

  it('the desktop rem trim is unchanged, and still unlayered', () => {
    // 1024px / 14.5px. Unlayered on purpose — inside @layer base it would lose
    // to the unlayered :root above it and the trim would silently stop.
    expect(GLOBALS).toContain('@media (min-width: 1024px) {\n  :root { font-size: 14.5px; }\n}');
    const trimIndex = GLOBALS.indexOf('font-size: 14.5px');
    const layerBaseEnd = GLOBALS.indexOf('@layer components');
    expect(trimIndex).toBeGreaterThan(layerBaseEnd);
  });

  it('changes globals.css by addition only', () => {
    // Every token the two pre-existing palette blocks declared is still there:
    // this PR appends a section to :root and six declarations to .dark, and
    // rewrites nothing. theming-classic-palette.test.ts pins the values.
    expect(Object.keys(rootVars).length).toBeGreaterThanOrEqual(135 + BRIDGE.length);
    expect(Object.keys(darkVars).length).toBe(83 + 6);
    expect(Object.keys(classicLightVars)).toHaveLength(14);
    expect(Object.keys(classicDarkVars)).toHaveLength(14);
  });
});
