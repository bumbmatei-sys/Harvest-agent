import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import postcss from 'postcss';

import {
  buildAppCss,
  buildCssForMarkup,
  GLOBALS_CSS,
  REPO_ROOT,
  TAILWIND_CONFIG,
} from '../test/support/tailwind-build';
import { V4_SPELLING_RENAMES, toV4Spelling } from '../test/support/class-inventory';

/**
 * THE-261 — the Tailwind v4 migration, asserted against the built stylesheet.
 *
 * This suite exists because the migration changed the thing every other
 * theming guard resolves against. Those seventeen suites keep proving what
 * they proved — that is their job and it is unchanged. This one proves the
 * properties the MIGRATION is answerable for, and it proves them the way the
 * rest of this repo does: by compiling globals.css with the real config and
 * reading the CSS, not by inspecting the shape of a config object.
 *
 * Two things it is deliberately NOT:
 *
 *   • It is not a second copy of theming-stage3/-classic-palette. Those assert
 *     the palettes' VALUES and contrast ratios and are untouched by v4. This
 *     asserts that the palettes still RESOLVE at all under the new engine —
 *     that every token a block declares still terminates in a real value, and
 *     that Classic still falls through to Harvest for the ones it omits.
 *   • It is not a scope police for Phase 2. It pins that no shadcn token was
 *     defined and that `border`/`line` is untouched, because those are this
 *     ticket's stated boundaries, and it says nothing about when they move.
 */

const SRC = path.join(REPO_ROOT, 'src');
const sha256 = (buf: Buffer | string): string => createHash('sha256').update(buf).digest('hex');

let css: string;
beforeAll(async () => {
  css = await buildAppCss();
}, 120_000);

/* ── Variable resolution ─────────────────────────────────────────────────── */

/** Every `--x: value` a rule with exactly this selector declares. */
function declaredBy(sheet: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(sheet).walkRules((rule) => {
    const selectors = rule.selectors.map((s) => s.trim()).sort().join(', ');
    if (selectors !== selector) return;
    rule.walkDecls((decl) => {
      if (decl.prop.startsWith('--')) out[decl.prop] = decl.value.trim();
    });
  });
  return out;
}

/**
 * Resolve `value` against `vars` until nothing is left to substitute.
 *
 * Returns null when a `var()` names something nothing declares — which is the
 * failure this whole suite is about. A bare `var(--missing)` makes its
 * declaration invalid at computed-value time and the browser drops it, so a
 * palette token that "resolves" to a dangling name paints nothing at all.
 */
function resolve(value: string, vars: Record<string, string>, depth = 0): string | null {
  if (depth > 24) return null;
  const m = /var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,([^)]*))?\)/.exec(value);
  if (!m) return value;
  const [whole, name, fallback] = m;
  const declared = vars[name];
  if (declared === undefined) {
    if (fallback === undefined) return null;
    return resolve(value.replace(whole, fallback.trim()), vars, depth + 1);
  }
  return resolve(value.replace(whole, declared), vars, depth + 1);
}

/**
 * The four palette blocks, each with the variable scope a browser would have
 * when that block is the winning one. Order matters: a later map wins, exactly
 * as the later rule does, and `:root` is beneath all of them — which is what
 * makes the Classic fall-through a property of the cascade rather than of a
 * list someone has to keep up to date.
 */
const PALETTES = [
  { name: 'Harvest light (:root)', selector: ':root', beneath: [] as string[] },
  { name: 'Harvest dark (.dark, [data-theme="dark"])', selector: '.dark, [data-theme="dark"]', beneath: [':root'] },
  {
    name: 'Classic light ([data-palette="classic"][data-theme="light"])',
    selector: '[data-palette="classic"][data-theme="light"]',
    beneath: [':root'],
  },
  {
    name: 'Classic dark ([data-palette="classic"].dark, [data-palette="classic"][data-theme="dark"])',
    selector: '[data-palette="classic"].dark, [data-palette="classic"][data-theme="dark"]',
    beneath: [':root', '.dark, [data-theme="dark"]'],
  },
] as const;

const scopeFor = (p: (typeof PALETTES)[number]): Record<string, string> =>
  Object.assign({}, ...p.beneath.map((s) => declaredBy(css, s)), declaredBy(css, p.selector));

/* ── 1. All four palettes still resolve ──────────────────────────────────── */

describe('all four palettes resolve every token they declare', () => {
  it.each(PALETTES.map((p) => [p.name, p] as const))('%s', (_name, palette) => {
    const declared = declaredBy(css, palette.selector);
    // A palette that stopped matching would declare nothing and every
    // assertion below would be vacuously true, so the block's existence is
    // asserted first and by name.
    expect(Object.keys(declared).length, `${palette.name} declares no tokens — the block is gone`)
      .toBeGreaterThan(0);

    const scope = scopeFor(palette);
    const dangling = Object.entries(declared)
      .filter(([, value]) => resolve(value, scope) === null)
      .map(([token, value]) => `${token}: ${value}`);
    expect(dangling, `${palette.name} declares a token that resolves to nothing`).toEqual([]);
  });

  it('each palette declares the number of tokens it declared before the migration', () => {
    // v4 changed how the stylesheet is BUILT, not what globals.css says. A
    // block that silently lost half its declarations would still pass the test
    // above on the half that remained.
    expect(Object.fromEntries(PALETTES.map((p) => [p.selector, Object.keys(declaredBy(css, p.selector)).length])))
      .toEqual({
        ':root': 135,
        '.dark, [data-theme="dark"]': 83,
        '[data-palette="classic"][data-theme="light"]': 14,
        '[data-palette="classic"].dark, [data-palette="classic"][data-theme="dark"]': 14,
      });
  });
});

/* ── 2. The Classic fall-through ─────────────────────────────────────────── */

describe('the Classic blocks still fall through to :root and .dark for unlisted tokens', () => {
  /**
   * globals.css names these six as deliberately NOT overridden in either
   * Classic block: they are accent- or navy-derived rather than part of the
   * neutral surface ramp, and the non-negotiable is that a tenant's accent must
   * not grey out in either family. The fall-through is what delivers that, so
   * it is asserted as a property of the cascade rather than trusted.
   */
  const FALLS_THROUGH = [
    '--surface-gold', '--border-gold', '--glow-gold',
    '--ring-gold', '--scrim-night', '--surface-night',
  ];

  const classicLight = PALETTES[2];
  const classicDark = PALETTES[3];

  it.each(FALLS_THROUGH)('%s is absent from both Classic blocks', (token) => {
    expect(declaredBy(css, classicLight.selector)).not.toHaveProperty(token);
    expect(declaredBy(css, classicDark.selector)).not.toHaveProperty(token);
  });

  it('Classic light therefore renders :root’s value for each of them', () => {
    const root = declaredBy(css, ':root');
    const scope = scopeFor(classicLight);
    for (const token of FALLS_THROUGH) {
      expect(resolve(`var(${token})`, scope), `${token} does not fall through in Classic light`)
        .toBe(resolve(`var(${token})`, root));
    }
  });

  it('Classic dark therefore renders the dark block’s value for each of them', () => {
    const harvestDark = scopeFor(PALETTES[1]);
    const scope = scopeFor(classicDark);
    for (const token of FALLS_THROUGH) {
      expect(resolve(`var(${token})`, scope), `${token} does not fall through in Classic dark`)
        .toBe(resolve(`var(${token})`, harvestDark));
    }
  });

  it('and the tokens Classic DOES override differ from Harvest, so the families are still distinct', () => {
    const root = declaredBy(css, ':root');
    const scope = scopeFor(classicLight);
    const overridden = Object.keys(declaredBy(css, classicLight.selector));
    expect(overridden.length).toBe(14);
    const identical = overridden.filter(
      (token) => resolve(`var(${token})`, scope) === resolve(`var(${token})`, root),
    );
    // --surface-raised is the one token the two families agree on, and they
    // agree by design: Harvest's raised surface is plain white and Classic's
    // "plain white surfaces" brief lands on the same white. Every other token
    // in the block moves, which is what makes it a second family rather than a
    // near-copy — a block that quietly stopped overriding would show up here.
    expect(identical).toEqual(['--surface-raised']);
  });
});

/* ── 3. Both dark selectors ──────────────────────────────────────────────── */

describe('both dark selectors work', () => {
  it('a dark: utility compiles to one rule per registered selector', async () => {
    const built = await buildCssForMarkup('<div class="dark:bg-cream"></div>');
    const scopes: string[] = [];
    postcss.parse(built).walkRules((rule) => {
      if (!rule.selector.includes('dark\\:bg-cream')) return;
      scopes.push(rule.selector.replace(/\.dark\\:bg-cream/g, '').trim());
    });
    expect(scopes.some((s) => /^:where\(\.dark, \.dark \*\)$/.test(s)), `.dark is not a hook: ${scopes}`).toBe(true);
    expect(
      scopes.some((s) => /^:where\(\[data-theme="dark"\], \[data-theme="dark"\] \*\)$/.test(s)),
      `[data-theme="dark"] is not a hook: ${scopes}`,
    ).toBe(true);
  }, 120_000);

  it('and the palette itself answers to both, in one rule', () => {
    // The two selectors share a rule in globals.css. Splitting them would still
    // work; losing one would silently halve the dark theme.
    const declared = declaredBy(css, '.dark, [data-theme="dark"]');
    expect(Object.keys(declared).length).toBeGreaterThan(0);
    expect(declared['--surface'], 'the dark ground is gone').toBeDefined();
  });

  it('no dark: utility reaches the light theme', () => {
    const unscoped: string[] = [];
    postcss.parse(css).walkRules((rule) => {
      if (!rule.selector.includes('.dark\\:')) return;
      const scope = rule.selector.replace(/\.dark\\:/g, '');
      if (!/\.dark\b|\[data-theme=["']?dark["']?\]/.test(scope)) unscoped.push(rule.selector);
    });
    expect(unscoped, 'a dark: utility would repaint the light theme').toEqual([]);
  });
});

/* ── 4. The desktop rem trim ─────────────────────────────────────────────── */

describe('the desktop rem trim still applies at 1024px and above', () => {
  it('is emitted, at 1024px, at 14.5px', () => {
    const found: string[] = [];
    postcss.parse(css).walkAtRules('media', (media) => {
      media.walkRules((rule) => {
        if (rule.selector !== ':root') return;
        rule.walkDecls('font-size', (decl) => {
          found.push(`${media.params} => ${decl.value}`);
        });
      });
    });
    expect(found).toContain('(min-width: 1024px) => 14.5px');
  });

  it('is UNLAYERED, which is the only reason it wins', () => {
    // v4's `@import "tailwindcss"` declares real cascade layers, and every
    // layered rule loses to an unlayered one. The trim sits outside every
    // layer in globals.css; moving it inside `@layer base` would put it in the
    // same layer as the `:root` block above it and change which one wins.
    let layered = false;
    postcss.parse(css).walkAtRules('layer', (layer) => {
      layer.walkDecls('font-size', (decl) => {
        if (decl.value.trim() === '14.5px' && (decl.parent as postcss.Rule)?.selector === ':root') layered = true;
      });
    });
    expect(layered, 'the rem trim moved inside a cascade layer and can now be out-ranked').toBe(false);
  });

  it('leaves the phone at the browser default — no :root font-size outside the query', () => {
    const unconditional: string[] = [];
    postcss.parse(css).walkRules((rule) => {
      if (rule.selector !== ':root') return;
      let inMedia = false;
      let node: postcss.Container | postcss.Document | undefined = rule.parent;
      while (node) {
        if (node.type === 'atrule' && (node as postcss.AtRule).name === 'media') inMedia = true;
        node = node.parent as postcss.Container | postcss.Document | undefined;
      }
      if (inMedia) return;
      rule.walkDecls('font-size', (decl) => {
        unconditional.push(decl.value);
      });
    });
    expect(unconditional, 'a :root font-size escaped the lg: media query and would resize the phone').toEqual([]);
  });
});

/* ── 5-6. Prose ──────────────────────────────────────────────────────────── */

/** Files whose markup carries a `prose` class — read, never listed. */
function proseCallSites(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const p = path.join(dir, entry);
      if (statSync(p).isDirectory()) {
        if (entry !== '__tests__' && entry !== 'node_modules') walk(p);
      } else if (/\.tsx?$/.test(entry) && /\bprose\b/.test(readFileSync(p, 'utf8').match(/class(Name)?=[^\n]*/g)?.join('\n') ?? '')) {
        out.push(path.relative(REPO_ROOT, p).split(path.sep).join('/'));
      }
    }
  };
  walk(SRC);
  return out.sort();
}

describe('prose still drives off the theme ramp', () => {
  /** The `.prose` rule that DECLARES the variables, not the ones that use them. */
  function proseVars(): Record<string, string> {
    let declaring: Record<string, string> = {};
    postcss.parse(css).walkRules((rule) => {
      if (rule.selector !== '.prose') return;
      const decls: Record<string, string> = {};
      rule.walkDecls((d) => {
        if (d.prop.startsWith('--tw-prose-')) decls[d.prop] = d.value.trim();
      });
      if (Object.keys(decls).length) declaring = decls;
    });
    return declaring;
  }

  it('the base .prose rule declares the full override set', () => {
    // @tailwindcss/typography still does `require('tailwindcss/colors')` for
    // its own defaults, so anything this config does not override renders in
    // Tailwind's greys — unreadable on the dark ground and invisible to every
    // class-based guard, because no component spells the colour.
    const vars = proseVars();
    // 18 ramp overrides and 18 invert overrides. Pinned rather than bounded:
    // the failure this guards against is the block silently arriving PARTIAL,
    // and a lower bound would pass on a block that lost a colour.
    expect(Object.keys(vars).length, 'the typography override block is not reaching the build').toBe(36);
  });

  it('every non-invert prose colour is a var(), not a Tailwind grey', () => {
    const hardcoded = Object.entries(proseVars())
      .filter(([k]) => !k.startsWith('--tw-prose-invert-'))
      // *-shadows holds an rgb channel triplet, consumed as `rgb(var(--x)/10%)`,
      // so it cannot be a var() reference.
      .filter(([k]) => !k.endsWith('-shadows'))
      .filter(([, v]) => !v.startsWith('var('))
      .map(([k, v]) => `${k}: ${v}`);
    expect(hardcoded, 'a prose colour bypasses the ramp and will not theme').toEqual([]);
  });

  it('and each of them resolves against the light and dark ramps alike', () => {
    const light = scopeFor(PALETTES[0]);
    const dark = scopeFor(PALETTES[1]);
    for (const [token, value] of Object.entries(proseVars())) {
      if (token.endsWith('-shadows')) continue;
      expect(resolve(value, light), `${token} does not resolve in the light theme`).not.toBeNull();
      expect(resolve(value, dark), `${token} does not resolve in the dark theme`).not.toBeNull();
    }
  });

  it('reaches every call site — the class is spelled and the rule exists', () => {
    // NINE, not the ten the brief expected: NewsTab.tsx has `prose` in three
    // COMMENTS about column measure and carries no prose class at all. Read
    // from the class attributes rather than listed, so the count cannot drift
    // again without this failing by name.
    expect(proseCallSites()).toEqual([
      'src/app/blog/[id]/page.tsx',
      'src/components/BlogTab.tsx',
      'src/components/CourseDetails.tsx',
      'src/components/NewsletterEditor.tsx',
      'src/components/TipTapReadOnly.tsx',
      'src/components/course/AuthorProfile.tsx',
      'src/components/course/CourseOverview.tsx',
      'src/components/course/CoursePreview.tsx',
      'src/components/course/LessonView.tsx',
    ]);
    expect(css, 'the .prose rule is not in the built stylesheet').toMatch(/\n\s*\.prose\s*\{/);
  });
});

describe('prose-invert is still light in both themes', () => {
  it('is used exactly once, by TipTapReadOnly', () => {
    const users = proseCallSites().filter((f) => /prose-invert/.test(readFileSync(path.join(REPO_ROOT, f), 'utf8')));
    expect(users).toEqual(['src/components/TipTapReadOnly.tsx']);
  });

  it('and TipTapReadOnly is rendered inside LivestreamView, whose stage is dark in both themes', () => {
    const livestream = readFileSync(path.join(SRC, 'components/LivestreamView.tsx'), 'utf8');
    expect(livestream).toContain('TipTapReadOnly');
    expect(livestream, 'the always-dark stage is gone, so prose-invert has nothing to sit on')
      .toContain('bg-[#0b1121]');
  });

  it('its variables are pinned to fixed warm tokens that do not invert', () => {
    // These must be the SAME colours in both palettes: prose-invert is not the
    // dark theme, it is white text on a navy video stage that is navy in both.
    // A value that tracked the ramp would go dark-on-dark in the dark theme.
    const light = scopeFor(PALETTES[0]);
    const dark = scopeFor(PALETTES[1]);
    const invert = Object.entries(
      (() => {
        let found: Record<string, string> = {};
        postcss.parse(css).walkRules((rule) => {
          if (rule.selector !== '.prose') return;
          const decls: Record<string, string> = {};
          rule.walkDecls((d) => {
            if (d.prop.startsWith('--tw-prose-invert-')) decls[d.prop] = d.value.trim();
          });
          if (Object.keys(decls).length) found = decls;
        });
        return found;
      })(),
    );
    expect(invert.length, 'the prose-invert overrides are gone').toBe(18);
    for (const [token, value] of invert) {
      if (token.endsWith('-shadows')) continue;
      const inLight = resolve(value, light);
      expect(inLight, `${token} does not resolve`).not.toBeNull();
      expect(resolve(value, dark), `${token} inverts with the theme — the video stage does not`).toBe(inLight);
    }
  });
});

/* ── 8. No shadcn token was defined ──────────────────────────────────────── */

describe('no shadcn token was defined', () => {
  /** The names the primitives spell and Phase 2 will define. Not this ticket. */
  const PHASE_TWO = [
    '--primary', '--primary-foreground', '--secondary', '--secondary-foreground',
    '--foreground', '--background', '--muted', '--muted-foreground',
    '--accent', '--accent-foreground', '--destructive', '--destructive-foreground',
    '--border', '--input', '--ring', '--radius', '--card', '--card-foreground',
    '--popover', '--popover-foreground',
  ];

  it('globals.css declares none of them', () => {
    const declared = new Set<string>();
    postcss.parse(readFileSync(GLOBALS_CSS, 'utf8')).walkDecls((decl) => {
      if (decl.prop.startsWith('--')) declared.add(decl.prop);
    });
    expect(PHASE_TWO.filter((t) => declared.has(t)), 'this ticket defined a Phase 2 token').toEqual([]);
    // The chart/sidebar families by prefix, so a `--chart-6` cannot slip past a list.
    expect([...declared].filter((t) => /^--(chart|sidebar)-/.test(t))).toEqual([]);
  });

  it('so the classes that need them still produce nothing, and the quarantine still has work', () => {
    const recorded = readFileSync(
      path.join(SRC, 'components/ui/__tests__/__fixtures__/unresolved-token-classes.txt'),
      'utf8',
    );
    expect(recorded, 'the unresolved list is empty — Phase 2 landed and the quarantine must go').not.toBe('');
    for (const cls of ['bg-muted', 'text-foreground', 'text-primary-foreground']) {
      expect(recorded, `${cls} resolves now, which means a token was defined`).toContain(cls);
    }
  });
});

/* ── 9. border / line ────────────────────────────────────────────────────── */

describe('border is still absent and line is still the border name', () => {
  it('`border-line` and its scale resolve', async () => {
    const built = await buildCssForMarkup(
      '<div class="border-line border-line-subtle border-line-strong border-line-hairline"></div>',
    );
    for (const cls of ['border-line', 'border-line-subtle', 'border-line-strong', 'border-line-hairline']) {
      expect(built, `${cls} produces no rule`).toMatch(new RegExp(`\\.${cls}\\s*\\{`));
    }
  }, 120_000);

  it('`border` is not a colour name — border-border, bg-border and text-border produce nothing', async () => {
    const built = await buildCssForMarkup('<div class="border-border bg-border text-border"></div>');
    for (const cls of ['border-border', 'bg-border', 'text-border']) {
      expect(built, `${cls} resolves — the border/line collision was resolved here, and it is Phase 3`)
        .not.toMatch(new RegExp(`\\.${cls}\\s*\\{`));
    }
  }, 120_000);

  it('the config still says why, so the reasoning outlives this PR', () => {
    const config = readFileSync(TAILWIND_CONFIG, 'utf8');
    expect(config).toContain('Borders are named `line` rather');
  });
});

/* ── 10. Only the enumerated mechanical renames touched components ───────── */

describe('no component changed except the listed mechanical renames', () => {
  /** Every non-test .ts/.tsx under src. */
  function sourceFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) {
          if (entry !== '__tests__' && entry !== 'node_modules') walk(p);
        } else if (/\.tsx?$/.test(entry) && !/\.test\./.test(entry)) {
          out.push(p);
        }
      }
    };
    walk(SRC);
    return out.filter((p) => !p.includes(`${path.sep}test${path.sep}support${path.sep}`)).sort();
  }

  it('no v3 spelling survives outside src/components/ui', () => {
    const survivors: string[] = [];
    for (const file of sourceFiles()) {
      const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
      if (rel.startsWith('src/components/ui/')) continue;
      const text = readFileSync(file, 'utf8');
      if (toV4Spelling(text) !== text) survivors.push(rel);
    }
    expect(survivors, 'a v3 utility spelling is still in app code and now renders differently').toEqual([]);
  });

  it('and src/components/ui keeps its own, because those files are shadcn v4 source', () => {
    // `outline-none` in a primitive MEANS v4's outline-none. Renaming it there
    // would have changed behaviour rather than preserved it, which is why the
    // sweep excluded the directory — asserted, so the exclusion is not folklore.
    const primitives = readdirSync(path.join(SRC, 'components/ui'))
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => readFileSync(path.join(SRC, 'components/ui', f), 'utf8'))
      .join('\n');
    expect(primitives).toMatch(/(?<![\w-])outline-none(?![\w-])/);
  });

  it('every application file differs from the base by nothing but that rename', () => {
    // History-dependent, so it states its own absence rather than passing
    // silently: a shallow clone has no base and the two assertions above still
    // stand on their own.
    const base = mergeBase();
    if (!base) {
      expect(existsSync(path.join(REPO_ROOT, '.git')), 'no git at all — nothing to compare against').toBe(true);
      return;
    }
    // --diff-filter=M keeps modified files only. A file ADDED since the base --
    // by this branch, or by main once main is merged in -- was never touched by
    // the sweep and has no `base:` blob to read, so `git show` would fail hard
    // and take the whole test with it. Nothing is lost by skipping them: the
    // v3-spelling scan above reads every source file in the tree, whenever it
    // arrived, so an added file carrying a v3 spelling still fails there.
    const changed = execSync(`git diff --name-only --diff-filter=M ${base} -- src`, { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .filter((p) => /\.tsx?$/.test(p) && !p.includes('__tests__') && !p.startsWith('src/test/'));

    const notARename: string[] = [];
    for (const rel of changed) {
      const before = execSync(`git show ${base}:${rel}`, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
      if (toV4Spelling(before) !== readFileSync(path.join(REPO_ROOT, rel), 'utf8')) notARename.push(rel);
    }
    expect(notARename, 'an application file changed by more than the v4 utility rename').toEqual([]);
  });

  it('renames exactly the three utilities v4 respells, and no others', () => {
    expect(V4_SPELLING_RENAMES.map(([v3, v4]) => `${v3} -> ${v4}`)).toEqual([
      'shadow-sm -> shadow-xs',
      'outline-none -> outline-hidden',
      'backdrop-blur-sm -> backdrop-blur-xs',
    ]);
  });
});

/** The commit this branch is measured against, or null in a shallow checkout. */
function mergeBase(): string | null {
  for (const candidate of ['origin/main', 'main']) {
    try {
      const merge = execSync(`git merge-base HEAD ${candidate}`, {
        cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim();
      if (merge) return merge;
    } catch { /* not present in this checkout */ }
  }
  return null;
}

/* ── 11. The files this ticket must not touch ────────────────────────────── */

describe('layout.tsx, firestore.rules and functions/ are byte-identical', () => {
  it.each([
    // layout.tsx carries the pre-paint theme script and is hash-pinned by THE-85.
    ['src/app/layout.tsx', '953b2963652207ac00572d082bb035eaa63161db7f0c049fe1bbc0b311fe6e4e'],
    // firestore.rules auto-deploys to production on merge to main.
    ['firestore.rules', 'a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499'],
    ['functions/src/index.ts', '39ccade96ac3d4dd5a13047e9bc42b54ef5ac59ae72f932af042fc814bf23e0b'],
  ])('%s', (rel, digest) => {
    expect(sha256(readFileSync(path.join(REPO_ROOT, rel))), `${rel} changed`).toBe(digest);
  });
});

/* ── 12. The quarantine ──────────────────────────────────────────────────── */

describe('the ds-primitives quarantine still fails as designed', () => {
  const GUARD = path.join(SRC, 'components/ui/__tests__/ds-primitives.test.tsx');

  it('is still `it.fails`, not `.skip` and not removed', () => {
    const guard = readFileSync(GUARD, 'utf8');
    expect(guard, 'the quarantine was skipped, which is silent forever')
      .toMatch(/it\.fails\('every token class in src\/components\/ui resolves'/);
    expect(guard).not.toMatch(/it\.skip\('every token class/);
  });

  it('its recorded list shrank, which is what this ticket was for, and is not empty', () => {
    const recorded = readFileSync(
      path.join(SRC, 'components/ui/__tests__/__fixtures__/unresolved-token-classes.txt'),
      'utf8',
    );
    const unresolved = recorded.split('\n').filter((l) => /^ {2}\S/.test(l)).length;
    // 262 before the migration; 143 after. Removing the quarantine is Phase 2's
    // job and `it.fails` turns red by itself when the list reaches zero.
    expect(unresolved).toBe(143);
    expect(unresolved).toBeLessThan(262);
  });
});

/* ── The build itself ────────────────────────────────────────────────────── */

describe('the build is on v4, through the JS config', () => {
  it('postcss.config.mjs runs @tailwindcss/postcss and nothing else', () => {
    const postcssConfig = readFileSync(path.join(REPO_ROOT, 'postcss.config.mjs'), 'utf8');
    expect(postcssConfig).toContain("'@tailwindcss/postcss': {}");
    // v4 does its own prefixing through Lightning CSS; leaving autoprefixer in
    // the chain would re-prefix what it already prefixed. Matched on the plugin
    // KEY, because the file explains in a comment why autoprefixer is gone.
    const plugins = Object.keys(
      (postcssConfig.match(/plugins:\s*\{([\s\S]*?)\n\s*\},/)?.[1] ?? '')
        .split('\n')
        .reduce<Record<string, true>>((acc, line) => {
          const key = /^\s*'?([@\w/-]+)'?\s*:/.exec(line)?.[1];
          if (key) acc[key] = true;
          return acc;
        }, {}),
    );
    expect(plugins).toEqual(['@tailwindcss/postcss']);
  });

  it('package.json is on v4 and carries no v3 plugin', () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps.tailwindcss).toMatch(/^\^?4\./);
    expect(deps['@tailwindcss/postcss']).toMatch(/^\^?4\./);
    expect(deps.autoprefixer, 'autoprefixer is a dependency again').toBeUndefined();
    // tailwindcss-animate is the v3 plugin; tw-animate-css is its v4 successor.
    expect(deps['tailwindcss-animate'], 'the v3 animation plugin came back').toBeUndefined();
    expect(deps['tw-animate-css']).toBeDefined();
  });

  it('globals.css imports v4 and names the JS config', () => {
    const globals = readFileSync(GLOBALS_CSS, 'utf8');
    expect(globals).toContain('@import "tailwindcss";');
    expect(globals).toContain('@import "tw-animate-css";');
    expect(globals).toContain('@config "../../tailwind.config.ts";');
    // The v3 directives, which v4 does not understand and would silently drop.
    expect(globals).not.toMatch(/@tailwind\s+(base|components|utilities)\s*;/);
  });

  it('the v4 preflight compatibility shims are live, not dead references', () => {
    // Each shim reads a Tailwind theme variable. v4 only emits a theme variable
    // that something uses, and `var(--color-gray-200, currentColor)` carries a
    // fallback — so if the variable were missing the shim would quietly become
    // `currentColor`, i.e. exactly the regression it exists to prevent.
    const root = declaredBy(css, ':host, :root');
    expect(root['--color-gray-200'], 'the border-colour shim resolves to its currentColor fallback').toBeDefined();
    expect(root['--color-gray-400'], 'the placeholder shim resolves to nothing').toBeDefined();
    expect(css).toMatch(/border-color:\s*var\(--color-gray-200, currentColor\)/);
    expect(css).toMatch(/button:not\(:disabled\)/);
  });

  it('the JS theme still reaches the utilities — colours are read from globals.css directly', () => {
    // v4 INLINES a JS config's colour values rather than routing them through
    // `--color-*` theme variables of its own. That is what keeps `bg-primary`
    // reading globals.css's `--color-primary` and not a generated variable of
    // the same name, which would be self-referential and paint nothing.
    expect(css).toMatch(/\.bg-primary\s*\{\s*background-color:\s*var\(--color-primary\);/);
    expect(css).toMatch(/\.bg-surface-raised\s*\{\s*background-color:\s*var\(--surface-raised\);/);
    expect(css).toMatch(/\.text-strong\s*\{\s*color:\s*var\(--text-strong\);/);
    const root = declaredBy(css, ':root');
    expect(resolve('var(--color-primary)', root), '--color-primary resolves to nothing').toBe('#C9963A');
  });

  it('a variable-backed colour now takes an opacity modifier — Phase 2 depends on it', async () => {
    // Under v3 this emitted NOTHING: the opacity modifier was applied by
    // substituting `<alpha-value>` into `rgb(... / <alpha-value>)`, and a bare
    // `var()` has no channels to substitute into, so `hover:bg-primary/80` was
    // a well-formed class that produced no rule. v4 applies the modifier with
    // color-mix(), which composes with any colour value at all.
    const built = await buildCssForMarkup('<div class="bg-primary/80 bg-surface-raised/50"></div>');
    expect(built).toMatch(/color-mix\(in oklab, var\(--color-primary\) 80%, transparent\)/);
    expect(built).toMatch(/color-mix\(in oklab, var\(--surface-raised\) 50%, transparent\)/);
  }, 120_000);
});
