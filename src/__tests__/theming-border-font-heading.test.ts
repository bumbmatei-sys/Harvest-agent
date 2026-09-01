import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

import {
  buildCssForMarkup,
  GLOBALS_CSS,
  REPO_ROOT,
  TAILWIND_CONFIG,
} from '../test/support/tailwind-build';

/**
 * THE-264 — the `border` collision and `font-heading`, and the quarantine.
 *
 * ── What this PR decided, and on what evidence ──────────────────────────
 *
 * tailwind.config.ts has no `border` colour key on purpose, and its textColor
 * comment states the reason: putting strong/muted/faint in `colors` would mint
 * `border-strong`, which resolves to --text-strong (earth #2D2519), beside the
 * existing `border-line-strong`, which resolves to --border-strong (stone
 * #D6CCBE). "Two different colours behind near-identical class names."
 *
 * That objection is about SUB-KEYS, and a sub-keyless `border` theme key does
 * not reproduce it: it mints `border-border`, `bg-border` and `text-border`
 * and nothing else. No `border-strong`. No second meaning for any name that
 * already resolves. The harm the `line` naming prevents is a name COLLISION,
 * and `border-border` collides with nothing — it is only redundant to read.
 *
 * So the property that was actually being protected is asserted here directly,
 * rather than inferred from the absence of a config key: `border-strong`,
 * `border-faint`, `border-subtle` and `border-hairline` still produce nothing,
 * and every `border-line-*` still resolves to the value it resolved to before.
 * Those assertions outlive any future decision about where `border` lives.
 *
 * `--font-heading` is the other half. It is NOT a component typo — it is a
 * first-class token in shadcn's own CLI, listed beside --font-sans,
 * --font-serif and --font-mono, read when the CLI resolves a heading face and
 * written when it installs one. It aliases the display face because Fraunces
 * is already what this app puts on card and dialog titles by hand, which
 * layout.tsx says in its own words ("600/700 are used for section + card
 * titles").
 */

const sha256 = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');

const rule = (css: string, cls: string): string | null => {
  const esc = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`\\.${esc}\\s*\\{[^}]*\\}`))?.[0].replace(/\s+/g, ' ') ?? null;
};

/** One build, every class this file asks about. */
const PROBED = [
  'border-border', 'bg-border', 'text-border', 'ring-border',
  'border-strong', 'border-faint', 'border-subtle', 'border-hairline', 'border-muted',
  'border-line', 'border-line-subtle', 'border-line-strong', 'border-line-hairline',
  'border', 'border-2',
  'font-heading', 'font-display', 'font-sans', 'font-serif',
  'text-strong', 'text-muted', 'text-faint',
  'bg-primary', 'bg-muted', 'bg-accent', 'bg-card', 'bg-popover', 'bg-destructive',
  'text-foreground', 'text-muted-foreground', 'bg-background', 'border-input', 'ring-ring',
  'rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-xl',
] as const;

let css: string;

beforeAll(async () => {
  css = await buildCssForMarkup(`<div class="${PROBED.join(' ')}"></div>`);
}, 180_000);

/* ── 1. The `border` collision, resolved ─────────────────────────────────── */

describe('border-border resolves, and reads --border', () => {
  it('border-border, bg-border and text-border all produce a rule', () => {
    expect(rule(css, 'border-border')).toBe('.border-border { border-color: var(--border); }');
    expect(rule(css, 'bg-border')).toBe('.bg-border { background-color: var(--border); }');
    expect(rule(css, 'text-border')).toBe('.text-border { color: var(--border); }');
  });

  it('reads --border itself, so a palette override still reaches it', () => {
    // The point of `@theme inline`: the utility substitutes the value rather
    // than minting --color-border and routing through it, so .dark's own
    // --border reaches the element. A plain @theme would break that.
    for (const cls of ['border-border', 'bg-border', 'text-border']) {
      expect(rule(css, cls), `${cls} does not read --border`).toContain('var(--border)');
      expect(rule(css, cls), `${cls} routes through a minted theme variable`)
        .not.toContain('var(--color-border)');
    }
  });

  it('is declared in globals.css, not in tailwind.config.ts', () => {
    // Shape 1 of the three: the config is digest-pinned, and a CSS theme key
    // is how v4 adds a colour name from the stylesheet.
    expect(readFileSync(GLOBALS_CSS, 'utf8')).toContain('--color-border: var(--border);');
    const config = readFileSync(TAILWIND_CONFIG, 'utf8');
    expect(config, 'a `border` colour key was added to the config').not.toMatch(
      /^\s*border:\s/m,
    );
  });

  it('leaves the width utilities alone — `border` is still 1px', () => {
    // A colour named `border` mints `border-border`, not `border`. If it had
    // taken the bare class, every 1px rule in the app would have become a
    // colour declaration.
    expect(rule(css, 'border')).toContain('border-width: 1px');
    expect(rule(css, 'border')).not.toContain('border-color');
    expect(rule(css, 'border-2')).toContain('border-width: 2px');
  });
});

/* ── 2. The property the `line` naming protects ──────────────────────────── */

describe('border-strong, border-muted and border-faint', () => {
  it('border-strong produces nothing — the documented harm never happens', () => {
    // THE ticket's hard rule, and the reason `strong`/`muted`/`faint` live
    // under textColor. `border-line-strong` is the only strong border name.
    expect(rule(css, 'border-strong'), 'border-strong resolves — it would shadow border-line-strong')
      .toBeNull();
  });

  it('border-faint, border-subtle and border-hairline produce nothing either', () => {
    for (const cls of ['border-faint', 'border-subtle', 'border-hairline']) {
      expect(rule(css, cls), `${cls} resolves — the line naming has been undermined`).toBeNull();
    }
  });

  it('the text roles are still text-only, and still read their own tokens', () => {
    expect(rule(css, 'text-strong')).toBe('.text-strong { color: var(--text-strong); }');
    expect(rule(css, 'text-faint')).toBe('.text-faint { color: var(--text-faint); }');
    // The one overlap THE-263 documented: textColor.muted wins for text-muted.
    expect(rule(css, 'text-muted')).toBe('.text-muted { color: var(--text-muted); }');
  });

  it('border-muted is THE-263’s, unchanged here, and is not a `line` name', () => {
    // Recorded rather than asserted away: --color-muted has minted
    // border-muted since THE-263 (globals.css says so in as many words), so
    // "border-muted produces nothing" was already false before this PR. It is
    // not the documented harm — there is no `border-line-muted` for it to
    // shadow, and it reads the shadcn muted SURFACE, not --text-muted. This
    // PR neither created it nor moved it; the assertion pins that.
    expect(rule(css, 'border-muted')).toBe('.border-muted { border-color: var(--muted); }');
  });

  it('the config still states the reasoning, so it outlives this PR', () => {
    const config = readFileSync(TAILWIND_CONFIG, 'utf8');
    expect(config).toContain('Borders are named `line` rather');
    expect(config).toContain('border-strong` would then resolve to --text-strong');
  });
});

/* ── 3. border-line is untouched ─────────────────────────────────────────── */

describe('the line scale resolves to exactly what it did before', () => {
  // Pinned literally, not compared to a rebuild: a regression that moved both
  // sides would pass a self-comparison.
  const BEFORE: Record<string, string> = {
    'border-line': '.border-line { border-color: var(--border-default); }',
    'border-line-subtle': '.border-line-subtle { border-color: var(--border-subtle); }',
    'border-line-strong': '.border-line-strong { border-color: var(--border-strong); }',
    'border-line-hairline': '.border-line-hairline { border-color: var(--border-hairline); }',
  };

  for (const [cls, expected] of Object.entries(BEFORE)) {
    it(`${cls} is unchanged`, () => {
      expect(rule(css, cls)).toBe(expected);
    });
  }
});

/* ── 4. font-heading ─────────────────────────────────────────────────────── */

describe('font-heading is the display face', () => {
  it('resolves to the same family as font-display, fallbacks included', () => {
    // The whole stack, not just --font-display: a var() substitution failure
    // poisons the entire declaration, so `, Georgia, serif` is the fallback
    // that matters and it has to be on both.
    expect(rule(css, 'font-heading')).toBe(
      '.font-heading { font-family: var(--font-display), Georgia, serif; }',
    );
    expect(rule(css, 'font-heading')).toBe(rule(css, 'font-display')!.replace('display', 'heading'));
  });

  it('is not the body face, and not the reading serif', () => {
    // The mutation this test is written against: pointing --font-heading at
    // --font-sans would still resolve and would silently restyle every card.
    expect(rule(css, 'font-heading')).not.toContain('var(--font-sans)');
    expect(rule(css, 'font-heading')).not.toContain('var(--font-serif)');
    expect(rule(css, 'font-sans')).toContain('var(--font-sans)');
    expect(rule(css, 'font-serif')).toContain('var(--font-serif)');
  });

  it('aliases the face layout.tsx loads for card titles', () => {
    // The typographic judgement, held to the repo's own record rather than to
    // taste: Fraunces is --font-display, and layout.tsx says what it is for.
    const layout = readFileSync(path.join(REPO_ROOT, 'src/app/layout.tsx'), 'utf8');
    expect(layout).toContain('Fraunces');
    expect(layout).toContain("variable: '--font-display'");
    expect(layout).toContain('used for section + card titles');
  });

  it('no component was edited to get there', () => {
    // Shape 1 again: the three components still spell `font-heading`, and it
    // now resolves. Editing them would have been undone by the next
    // `shadcn add`, because --font-heading is the CLI's own token name.
    for (const f of ['card.tsx', 'dialog.tsx', 'sheet.tsx']) {
      const src = readFileSync(path.join(REPO_ROOT, 'src/components/ui', f), 'utf8');
      expect(src, `${f} no longer spells font-heading`).toContain('font-heading');
    }
  });

  it('--font-heading is the name shadcn’s own CLI uses', () => {
    // The premise this PR reversed. THE-263 recorded `font-heading` as a
    // component typo; the vendored CLI lists it beside the other font
    // variables it knows how to read and write.
    const cli = readFileSync(path.join(REPO_ROOT, 'node_modules/shadcn/dist/index.js'), 'utf8');
    expect(cli).toContain('--font-heading');
    expect(cli).toContain('"--font-sans","--font-serif","--font-mono"');
  });
});

/* ── 5. No token value moved ─────────────────────────────────────────────── */

describe('THE-263’s tokens all still resolve to the same value', () => {
  /** Every custom property globals.css declares, and its value. */
  const declared = (): Map<string, string[]> => {
    const out = new Map<string, string[]>();
    postcss.parse(readFileSync(GLOBALS_CSS, 'utf8')).walkDecls((d) => {
      if (!d.prop.startsWith('--')) return;
      const bucket = out.get(d.prop);
      if (bucket) bucket.push(d.value);
      else out.set(d.prop, [d.value]);
    });
    return out;
  };

  // The 19 :root aliases THE-263 shipped, pinned to the value each aliases.
  // A change to any of these is a change to what a component paints, and the
  // contrast assertions in theming-shadcn-tokens.test.ts rest on them.
  const THE_263: Record<string, string> = {
    '--background': 'var(--surface)',
    '--foreground': 'var(--text-body)',
    '--card': 'var(--surface-raised)',
    '--card-foreground': 'var(--text-body)',
    '--popover': 'var(--surface-raised)',
    '--popover-foreground': 'var(--text-body)',
    '--primary': 'var(--color-primary)',
    '--primary-foreground': 'var(--earth)',
    '--secondary': 'var(--color-secondary)',
    '--secondary-foreground': 'var(--earth)',
    '--muted': 'var(--surface-sunken)',
    '--muted-foreground': 'var(--text-muted)',
    '--accent': 'var(--surface-chip)',
    '--accent-foreground': 'var(--text-strong)',
    '--input': 'var(--border-strong)',
    '--border': 'var(--border-default)',
    '--destructive': 'rgb(var(--ink-danger-strong))',
    '--ring': 'var(--brand-color)',
  };

  it('every one is still declared, and still aliases the same token', () => {
    const d = declared();
    for (const [prop, value] of Object.entries(THE_263)) {
      expect(d.get(prop), `${prop} is no longer declared`).toBeDefined();
      expect(d.get(prop)![0], `${prop} no longer aliases ${value}`).toBe(value);
    }
  });

  it('--border in particular is unmoved — adding the theme key changed no value', () => {
    // The one token this PR touches the neighbourhood of. It is still the
    // same alias it was; only a utility name was added on top of it.
    expect(declared().get('--border')![0]).toBe('var(--border-default)');
  });

  it('the utilities the bridge minted still read the same properties', () => {
    const expected: Record<string, string> = {
      // bg-primary reads --color-primary, not --primary: `primary` is a JS
      // config colour and v4 inlines those, which is exactly why THE-263
      // left --color-primary out of @theme inline.
      'bg-primary': 'var(--color-primary)',
      'bg-muted': 'var(--muted)',
      'bg-accent': 'var(--accent)',
      'bg-card': 'var(--card)',
      'bg-popover': 'var(--popover)',
      'bg-background': 'var(--background)',
      'bg-destructive': 'var(--destructive)',
      'text-foreground': 'var(--foreground)',
      'text-muted-foreground': 'var(--muted-foreground)',
      'border-input': 'var(--input)',
      'ring-ring': 'var(--ring)',
    };
    for (const [cls, prop] of Object.entries(expected)) {
      expect(rule(css, cls), `${cls} no longer reads ${prop}`).toContain(prop);
    }
  });
});

/* ── 6. The radius scale, and the rem trim ───────────────────────────────── */

describe('the pinned things this PR must not touch', () => {
  it('--radius-sm/md/lg/xl are not redefined in globals.css', () => {
    // Tailwind v4 theme variables. `.rounded-md` reads them app-wide, so
    // redefining one silently reshapes every corner in the app.
    const g = readFileSync(GLOBALS_CSS, 'utf8');
    for (const name of ['--radius-sm', '--radius-md', '--radius-lg', '--radius-xl']) {
      expect(g, `${name} is declared in globals.css`).not.toMatch(
        new RegExp(`^\\s*${name}\\s*:`, 'm'),
      );
    }
    // …and the utilities that read them still resolve.
    for (const cls of ['rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-xl']) {
      expect(rule(css, cls), `${cls} produces no rule`).not.toBeNull();
    }
  });

  it('the desktop rem trim is unchanged, and still unlayered', () => {
    const g = readFileSync(GLOBALS_CSS, 'utf8');
    expect(g).toContain('@media (min-width: 1024px) {\n  :root { font-size: 14.5px; }\n}');
    // Inside @layer it would lose to unlayered rules; THE-263 pinned that.
    const trim = g.indexOf('font-size: 14.5px');
    const layerBefore = g.lastIndexOf('@layer', trim);
    const closeBefore = g.lastIndexOf('\n}', trim);
    expect(closeBefore, 'the rem trim moved inside an @layer').toBeGreaterThan(layerBefore);
  });

  it('tailwind.config.ts is byte-identical to what THE-263 left', () => {
    // Not a re-derivation of the digest the ds-primitives guard pins — this
    // one is the whole file, comments included.
    expect(sha256(readFileSync(TAILWIND_CONFIG, 'utf8'))).toBe(
      '32af690fa7f32c4e568deb8b66ff827ffbace309a07a83ff0d4582dd2cd15749',
    );
  });
});

/* ── 7. The files this PR is forbidden to touch ──────────────────────────── */

describe('the forbidden files are byte-identical', () => {
  // Digests recorded from origin/main at the start of this PR, not read back
  // from `git show` at assertion time: CI's checkout is the only history a
  // test can rely on, and shelling out to git makes the assertion depend on
  // how the runner cloned the repo.
  const PINNED: Record<string, string> = {
    'src/app/layout.tsx': '953b2963652207ac00572d082bb035eaa63161db7f0c049fe1bbc0b311fe6e4e',
    'firestore.rules': 'a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499',
  };

  for (const [file, digest] of Object.entries(PINNED)) {
    it(`${file} is unchanged`, () => {
      expect(sha256(readFileSync(path.join(REPO_ROOT, file), 'utf8'))).toBe(digest);
    });
  }

  it('every file under functions/ is unchanged', () => {
    const recorded: Record<string, string> = JSON.parse(
      readFileSync(path.join(__dirname, '__fixtures__/functions-digests.json'), 'utf8'),
    );
    const actual = Object.fromEntries(
      Object.keys(recorded).map((f) => [f, sha256(readFileSync(path.join(REPO_ROOT, f), 'utf8'))]),
    );
    expect(actual).toEqual(recorded);
  });
});
