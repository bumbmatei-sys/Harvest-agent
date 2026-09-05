import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import postcss from 'postcss';

import {
  buildCssForMarkup,
  GLOBALS_CSS,
  REPO_ROOT,
  TAILWIND_CONFIG,
} from '../test/support/tailwind-build';
import {
  auditPrimitives,
  SET_AT_RUNTIME,
  SET_BY_NEXT_FONT,
  rel,
} from '../components/ui/__tests__/ds-primitives.audit';
import { contrastRatio, AA_CONTRAST, DEFAULT_PALETTE_FAMILY } from '../lib/theme';

/**
 * THE-266 — shadcn Phase 7, Batch A: tooltip, skeleton, collapsible, breadcrumb.
 *
 * These four are the registry dependencies of `sidebar`, which the admin shell,
 * the member shell and the notes tree all need. `sidebar` itself is NOT here:
 * its eight --sidebar-* tokens are still undefined, and defining them needs
 * four-palette mapping and contrast work that is its own ticket.
 *
 * ⚠️ WHAT THIS PR IS ACTUALLY TESTING.
 * Phase 2 (THE-263) built a token bridge: shadcn's token names aliased onto the
 * Harvest ramp, plus the `@theme inline` half that mints the utilities. Until
 * now nothing had crossed that bridge which THE-263 had not itself written.
 * These four components are the first arrivals from the registry, unedited, and
 * the claim under test is that they resolve against it with ZERO new tokens.
 *
 * They did. globals.css is untouched by this PR. That is the headline result,
 * and test 5 asserts it directly rather than leaving it implied by a green run.
 *
 * ⚠️ THE FAILURE MODE THIS FILE EXISTS TO PREVENT.
 * The first attempt at this ticket could not reach ui.shadcn.com, so the CLI
 * wrote nothing and the guard audited nothing — a green suite that proved
 * nothing at all. Test 10 is the guard against a repeat: it asserts the four
 * files exist AND that the audit actually opened each one, by name. A suite
 * that goes green because it looked at nothing is the specific thing ruled out.
 */

const sha256 = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');

const UI_DIR = path.join(REPO_ROOT, 'src/components/ui');
const FIXTURES = path.join(UI_DIR, '__tests__/__fixtures__');
const LAYOUT = path.join(REPO_ROOT, 'src/app/layout.tsx');

/** The four this PR installs. */
const NEW_PRIMITIVES = ['breadcrumb.tsx', 'collapsible.tsx', 'skeleton.tsx', 'tooltip.tsx'] as const;

/**
 * The 13 that existed before, with the digests THE-264 recorded.
 *
 * ⚠️ Spelled as literals rather than read from primitive-digests.json. That
 * fixture is re-recorded by this PR — it has to be, it gains four entries — so
 * a test comparing it against itself would pass no matter what the CLI had done
 * to button.tsx. These are the values as of 6aceb0e, pinned here by hand.
 */
const PRE_EXISTING_DIGESTS: Record<string, string> = {
  'avatar.tsx': '357b2f9aac0192c071cb2ed65cb6e4c8ec01fa02fc15cf50d889b85731b75666',
  'badge.tsx': '968b0403af74a785c9408ca69a677235e49d0c80b2c27fb9858ad421a8778c7d',
  'button.tsx': 'd14549ab3ba7a9d5d1f424c2599233bffa0b317121abf3b6efa2fb902d5e2781',
  'card.tsx': 'd8113cbf964f8d1aadf2649d2944d8bbc6e3cfd49d36746f76868cbc4dde3cfe',
  'dialog.tsx': 'ccabf6cc674a68b09d9168904bb46b7c1075a67312cf6f51f3e38b8eeacd2fdb',
  'dropdown-menu.tsx': '1c1ae4ec02de9778286f84e0d15a1b74cc610c13c5b6a13c1ada2e6770eeb4e1',
  'input.tsx': 'f7d6ecff9a4d631feeaf401c02bb87e26ddb38131c55d15a43b9290747390847',
  'label.tsx': '7f19b8476658d25ff197c84030e58cd7395059d876a54630e025951e474ebdae',
  'select.tsx': 'ca3bd1b370ea67b84632d435c22d8270752fa6013c06c365162af265e4a0e87e',
  'separator.tsx': '75085bd84ff6965e4a356c53a4689799cabf65caa93c0bba064d5a0c6fa78f13',
  'sheet.tsx': 'a8ff25079c1167230fc3a9ddce881a8fb24f8ebb1eecbc8189c7f1cf242018df',
  'sonner.tsx': 'f76ee6fb6aa5892bdc1c92b8b282a59f34b63f3fa2ab01475df4a61988f0014b',
  'tabs.tsx': '8bf9ee3935ab86c268a2a71cb5b4b67d3d5587ca9f2e0bf25f37ffdb1980434c',
};

/** As of 6aceb0e. Neither file is this PR's business; both are asserted below. */
const LAYOUT_SHA = 'bf5f96a61c3fa2f467556f44f0b36e91e49b7c830609b37c775fa6a2b9232ca5';
// ⚠️ REGENERATED ONCE, by THE-313 (#462), which added the `servicePlans` rule
// inside `match /tenants/{tenantId}` beside `events`: `allow read: if
// belongsToTenant(tenantId)` and `allow write: if hasPermission('manageEvents',
// tenantId)`. Purely additive — no existing rule's text moved and it names no new
// helper, so every other claim this pin carries is unchanged.
// Was: a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499
const RULES_SHA = '4973c3c94c5a3be8d478f4373326b23fbd9de447d3ac6a5b8173f723dfd62075';
const TAILWIND_CODE_SHA = '491ebb5575d16eddfab00c6ed89900c725141b412e410e9e97342ff2108b2904';

/* ── palette resolution ──────────────────────────────────────────────────────
 * The four palettes are two theme blocks times two families. Classic overrides
 * only the surface/border/text ramp; everything else falls through — the file
 * says so itself ("Classic is purely additive").
 *
 * ⚠️ The shadcn names are ALIASES onto that ramp: `--background: var(--surface)`,
 * `--foreground: var(--text-body)`. So Classic reaches them by indirection
 * without ever naming them, and a table of literal values per palette would be
 * wrong in a way that still looked right. Hence a resolver that follows var().
 */
const PALETTES = {
  'harvest light': [':root'],
  'harvest dark': ['.dark, [data-theme="dark"]', ':root'],
  'classic light': ['[data-palette="classic"][data-theme="light"]', ':root'],
  'classic dark': [
    '[data-palette="classic"].dark, [data-palette="classic"][data-theme="dark"]',
    '.dark, [data-theme="dark"]',
    ':root',
  ],
} as const;

type Decls = Map<string, Map<string, string>>;

const declarationsBySelector = (css: string): Decls => {
  const out: Decls = new Map();
  postcss.parse(css).walkRules((r) => {
    const key = r.selector.replace(/\s+/g, ' ').trim();
    const map = out.get(key) ?? new Map<string, string>();
    r.walkDecls((d) => {
      if (d.prop.startsWith('--')) map.set(d.prop, d.value.trim());
    });
    out.set(key, map);
  });
  return out;
};

/** Resolve one custom property in one palette, following var() indirection. */
const resolve = (decls: Decls, chain: readonly string[], token: string): string => {
  const lookup = (name: string): string | undefined => {
    for (const sel of chain) {
      const v = decls.get(sel)?.get(name);
      if (v !== undefined) return v;
    }
    return undefined;
  };
  let value = lookup(token);
  const seen = new Set<string>();
  while (value && /^var\(/.test(value)) {
    const inner = value.match(/^var\(\s*(--[A-Za-z0-9-]+)\s*(?:,([\s\S]*))?\)$/);
    if (!inner) break;
    const next = inner[1];
    if (seen.has(next)) break;
    seen.add(next);
    const got = lookup(next);
    value = got !== undefined ? got : inner[2]?.trim();
  }
  return (value ?? '').trim();
};

/**
 * Every custom property declared anywhere in globals.css.
 *
 * ⚠️ walkDecls over the whole root, NOT walkRules. `--font-heading` and the
 * whole `--color-*` half of the bridge are declared inside `@theme inline`,
 * which is an at-rule: a rules-only walk silently misses them and reports a
 * shorter ledger that still looks plausible. The same reason applies to the
 * --sidebar pin below — a sidebar token added inside @theme inline has to trip
 * it too, not slip past because of where it was written.
 */
const allDeclaredTokens = (): string[] => {
  const names = new Set<string>();
  postcss.parse(readFileSync(GLOBALS_CSS, 'utf8')).walkDecls((d) => {
    if (d.prop.startsWith('--')) names.add(d.prop);
  });
  return [...names].sort();
};

let css: string;
let decls: Decls;
let audit: Awaited<ReturnType<typeof auditPrimitives>>;

beforeAll(async () => {
  decls = declarationsBySelector(readFileSync(GLOBALS_CSS, 'utf8'));
  audit = await auditPrimitives(
    readdirSync(UI_DIR)
      .filter((f) => f.endsWith('.tsx'))
      .sort()
      .map((f) => path.join(UI_DIR, f)),
  );
  css = await buildCssForMarkup(
    '<div class="border-strong border-faint border-subtle border-hairline"></div>',
  );
}, 180_000);

const rule = (cls: string): string | null => {
  const esc = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`\\.${esc}\\s*\\{[^}]*\\}`))?.[0].replace(/\s+/g, ' ') ?? null;
};

/* ── 0. The resolver is pointed at real blocks ───────────────────────────── */

it('every palette selector this file names actually exists in globals.css', () => {
  // ⚠️ Not ceremony. A mistyped selector does not throw — `resolve` simply
  // falls through to the next link in the chain and returns :root's value, so
  // "harvest dark" would quietly report the LIGHT palette and every contrast
  // assertion below would pass while testing the wrong thing. This caught
  // exactly that during development: the dark block is `.dark,
  // [data-theme="dark"]`, not `[data-theme="dark"]` alone.
  for (const [palette, chain] of Object.entries(PALETTES)) {
    for (const sel of chain) {
      expect(decls.has(sel), `${palette} names a selector that is not in globals.css: ${sel}`).toBe(
        true,
      );
    }
  }
});

/* ── 1. The guard, per component, named ──────────────────────────────────── */

describe("each new primitive's token classes all resolve", () => {
  for (const file of NEW_PRIMITIVES) {
    it(`${file} spells no class that resolves to nothing`, () => {
      const abs = path.join(UI_DIR, file);
      const mine = audit.findings.filter((f) => rel(f.file) === rel(abs));
      expect(mine, `${file} has unresolved classes: ${JSON.stringify(mine)}`).toEqual([]);
    });
  }

  it('and the audit as a whole is clean', () => {
    expect(audit.findings).toEqual([]);
  });
});

/* ── 2. The fixture stays empty ──────────────────────────────────────────── */

it('the unresolved fixture is still empty', () => {
  const p = path.join(FIXTURES, 'unresolved-token-classes.txt');
  expect(readFileSync(p, 'utf8')).toBe('');
  expect(statSync(p).size).toBe(0);
});

/* ── 3. No pre-existing primitive moved ──────────────────────────────────── */

/**
 * ⚠️ THE-273 CHANGED sonner.tsx, and it is the only pre-existing primitive any
 * later ticket has moved. The map above is deliberately LEFT ALONE — it records
 * the install-time state and that is the claim it makes — so this is the single,
 * named exception layered over it. Every other entry is still compared against
 * the digest recorded when this PR landed, and a second file moving still fails.
 *
 * (The change: sonner.tsx stopped hard-coding `theme: "light"` — a correct call
 * when the app had no dark mode — and reads Harvest's own resolved theme
 * instead. See src/__tests__/the-273-toast-dark-mode.test.tsx.)
 */
/**
 * ⚠️ `tabs.tsx` MOVED, and why — THE-276-FIX.
 *
 * As vendored, this primitive styled itself with `data-horizontal:` and
 * `data-vertical:` variants, which Tailwind compiles to the attribute selectors
 * `[data-horizontal]` and `[data-vertical]`. The installed @base-ui/react
 * (^1.5.0) emits `data-orientation="horizontal"` instead, so none of those
 * twelve rules ever matched. The consequence shipped: the tabs root kept
 * `display:flex` with the default `row` direction, and the panel — a sibling
 * carrying `flex-1` — rendered as a second COLUMN beside the tab strip instead
 * of below it, putting every dashboard widget in a 420px band on the right of a
 * 1044px container. The active tab's underline, whose geometry comes from the
 * same variants, was never drawn either.
 *
 * Twelve class names re-spelled `data-[orientation=…]`. No element, slot,
 * variant or API changed.
 *
 * Named here rather than the assertion being loosened — the same treatment
 * THE-273's sonner.tsx fix got, and for the same reason: every other entry is
 * still compared against the digest this PR recorded, and a second file moving
 * still fails.
 */
/**
 * ⚠️ `dialog.tsx` and `sheet.tsx` MOVED SINCE, and why — THE-295.
 *
 * Both shipped at the shadcn default `z-50`, for scrim AND panel. The app's
 * mobile bottom nav is `fixed bottom-0 … z-[100]`, so any dialog or sheet
 * mounted on a phone would have rendered UNDER the navigation bar. THE-286
 * found this and reported it rather than fixing it, because raising a pinned
 * primitive from a settings slice would have widened that diff into the app
 * shell; THE-295 is that follow-up.
 *
 * Each file's scrim is now `z-[101]` and its panel `z-[102]` — #427's existing
 * layering, matching AdminDashboard's own More Sheet. FOUR class names, in two
 * files. No element, slot, variant, prop or API changed.
 *
 * Named here rather than the assertion being loosened — the same treatment
 * THE-273's sonner.tsx and THE-276-FIX's tabs.tsx got, and for the same
 * reason: every other entry is still compared against the digest this PR
 * recorded, and a further file moving still fails.
 */
const MOVED_SINCE: Record<string, string> = {
  'dialog.tsx': 'bfd230cea544d2de7650182341e082de92141174da80f6193843e8d71b622e41',
  'sheet.tsx': '68d13d9826a9b5b28e3d78a0ba632b347ca91b67a3333a38acb6310ade8846d4',
  'sonner.tsx': '2ebc0c9ba968858cead2fbf2523dfd9da217715339967025e8c8df94f2131ab9',
  'tabs.tsx': '096e3d4b2a99b1eff95d16959f97daaa1747fdb7de6226d6c54b9693e22b3410',
};

describe('the CLI rewrote nothing it should not have', () => {
  it('all 13 pre-existing primitives are byte-identical to 6aceb0e, bar the two THE-273 and THE-276-FIX fixed', () => {
    const actual = Object.fromEntries(
      Object.keys(PRE_EXISTING_DIGESTS).map((f) => [
        f,
        sha256(readFileSync(path.join(UI_DIR, f), 'utf8')),
      ]),
    );
    expect(actual).toEqual({ ...PRE_EXISTING_DIGESTS, ...MOVED_SINCE });
  });

  it('src/components/ui holds exactly the 13 plus the 4, plus B, sidebar, and THE-274’s 21', () => {
    // THE-272 (Batch B) installed chart, pagination, progress and table.
    // THE-270 then installed `sidebar` — the component THESE FOUR were the
    // registry dependencies OF. THE-274 then installed Batches C, D and E in
    // one pass: nineteen named plus `popover` (asked for by that ticket) and
    // `toggle` (pulled in as a registry dependency of `toggle-group`). All are
    // named here rather than the assertion being loosened to "contains", so
    // the next arrival still has to come back and say so, which is the whole
    // value of this test. Each ticket's own suite pins what it installed; this
    // one keeps proving that THE-266's four are still exactly what it installed.
    const BATCH_B = ['chart.tsx', 'pagination.tsx', 'progress.tsx', 'table.tsx'];
    const BATCH_CDE = [
      'alert.tsx', 'button-group.tsx', 'calendar.tsx', 'checkbox.tsx', 'command.tsx',
      'context-menu.tsx', 'empty.tsx', 'field.tsx', 'hover-card.tsx', 'input-group.tsx',
      'item.tsx', 'popover.tsx', 'radio-group.tsx', 'resizable.tsx', 'scroll-area.tsx',
      'slider.tsx', 'spinner.tsx', 'switch.tsx', 'textarea.tsx', 'toggle-group.tsx',
      'toggle.tsx',
    ];
    expect(
      readdirSync(UI_DIR)
        .filter((f) => f.endsWith('.tsx'))
        .sort(),
    ).toEqual(
      [
        ...Object.keys(PRE_EXISTING_DIGESTS),
        ...NEW_PRIMITIVES,
        ...BATCH_B,
        'sidebar.tsx',
        ...BATCH_CDE,
      ].sort(),
    );
  });

  it('sidebar arrived by its own ticket, not as a transitive dependency of these four', () => {
    // The original pin read `expect(existsSync(…sidebar.tsx)).toBe(false)`, and
    // it was load-bearing: while the eight --sidebar-* tokens were undefined,
    // `sidebar` appearing here would have been the CLI dragging in a component
    // whose tokens THE-266 had not mapped. THE-267 (#412) mapped them and
    // THE-270 installed it deliberately, so the absence is no longer the thing
    // to assert. Inverted rather than deleted, exactly as section 9 below
    // inverts the token pin: the file must be present, and — the half that
    // still catches the original failure — the audit must find it clean.
    expect(existsSync(path.join(UI_DIR, 'sidebar.tsx'))).toBe(true);
    expect(audit.findings.filter((f) => path.basename(f.file) === 'sidebar.tsx')).toEqual([]);
  });
});

/* ── 4-5. The bridge carried them, with no new token ─────────────────────── */

describe('the token bridge held', () => {
  it('globals.css still defines no token THE-266’s four primitives needed', () => {
    // The claim this PR was making — that four unedited registry components
    // cross the Phase 2 bridge with ZERO new tokens — is unchanged and still
    // asserted. What moved is only the ledger it is asserted against: THE-267
    // re-recorded it to add the sidebar family, which none of these four
    // components reads (the test in section 9 proves that separately). So the
    // comparison stays byte-exact against the current ledger, and the delta
    // that ledger is allowed to have gained is pinned by name right below.
    expect(`${allDeclaredTokens().join('\n')}\n`).toBe(
      readFileSync(path.join(FIXTURES, 'globals-tokens.txt'), 'utf8'),
    );
  });

  it('and the ledger’s only growth since THE-266 is THE-267’s sixteen lines', () => {
    const tokens = allDeclaredTokens();
    const sidebar = tokens.filter((t) => /^--(color-)?sidebar/.test(t));
    expect(sidebar).toHaveLength(16);
    // Every other name in the ledger predates this. Asserted as a count of the
    // non-sidebar remainder, which is what THE-266 recorded: 181 lines, of
    // which none was a sidebar token.
    expect(tokens.length - sidebar.length).toBe(181);
  });

  /**
   * What the four tokens these components consume actually resolve to, per
   * palette, after the var() chain is followed.
   *
   * ⚠️ Pinned by VALUE, not merely asserted to be "some colour". A test that
   * only checked the shape would stay green while a THE-263 token was quietly
   * moved underneath these components — which is exactly the regression the
   * ticket asks this to catch. Moving any one of these twelve numbers fails
   * here, by name and palette.
   */
  const RESOLVED: Record<keyof typeof PALETTES, Record<string, string>> = {
    'harvest light': {
      '--background': '#FAF8F5',
      '--foreground': '#4A4038',
      '--muted': '#F3EEE7',
      '--muted-foreground': '#68563F',
    },
    'harvest dark': {
      '--background': '#1A1612',
      '--foreground': '#D1C7BA',
      '--muted': '#120F0C',
      '--muted-foreground': '#B5A692',
    },
    'classic light': {
      '--background': '#F7F7F7',
      '--foreground': '#404040',
      '--muted': '#EFEFEF',
      '--muted-foreground': '#595959',
    },
    'classic dark': {
      '--background': '#1C1C1C',
      '--foreground': '#CCCCCC',
      '--muted': '#131313',
      '--muted-foreground': '#ABABAB',
    },
  };

  for (const palette of Object.keys(PALETTES) as (keyof typeof PALETTES)[]) {
    it(`every token the four components consume still resolves to its recorded value — ${palette}`, () => {
      const actual = Object.fromEntries(
        Object.keys(RESOLVED[palette]).map((t) => [t, resolve(decls, PALETTES[palette], t)]),
      );
      expect(actual).toEqual(RESOLVED[palette]);
    });
  }

  it('and Classic reaches them by fall-through, without naming one of them', () => {
    // The fall-through decision, asserted rather than described: Classic
    // redefines the ramp (--surface, --text-body, --text-muted) and NOT the
    // shadcn aliases. This PR adds no token, so it makes no new fall-through
    // decision — but it depends on that one, so it pins it.
    for (const family of ['light', 'dark'] as const) {
      const sel =
        family === 'light'
          ? '[data-palette="classic"][data-theme="light"]'
          : '[data-palette="classic"].dark, [data-palette="classic"][data-theme="dark"]';
      const block = decls.get(sel);
      expect(block, `the Classic ${family} block is missing`).toBeDefined();
      for (const alias of ['--background', '--foreground', '--muted', '--muted-foreground']) {
        expect(block?.has(alias), `Classic ${family} names ${alias} directly`).toBe(false);
      }
    }
  });
});

/* ── 6. Contrast, four palettes, ratios asserted ─────────────────────────── */

describe('every foreground/background pair the four components introduce clears AA', () => {
  // tooltip inverts: text-background sits on bg-foreground. breadcrumb puts
  // both text-foreground and text-muted-foreground on the page ground.
  const PAIRS = [
    ['tooltip text-background on bg-foreground', '--background', '--foreground'],
    ['breadcrumb text-foreground on --background', '--foreground', '--background'],
    ['breadcrumb text-muted-foreground on --background', '--muted-foreground', '--background'],
  ] as const;

  for (const [label, fg, bg] of PAIRS) {
    for (const palette of Object.keys(PALETTES) as (keyof typeof PALETTES)[]) {
      it(`${label} — ${palette}`, () => {
        const r = contrastRatio(
          resolve(decls, PALETTES[palette], fg),
          resolve(decls, PALETTES[palette], bg),
        );
        expect(r, `${label} is ${r.toFixed(2)}:1 in ${palette}`).toBeGreaterThanOrEqual(
          AA_CONTRAST,
        );
      });
    }
  }

  it('and the worst of them clears THE-263 floor of 5.66:1', () => {
    const worst = Math.min(
      ...PAIRS.flatMap(([, fg, bg]) =>
        Object.values(PALETTES).map((chain) =>
          contrastRatio(resolve(decls, chain, fg), resolve(decls, chain, bg)),
        ),
      ),
    );
    expect(worst).toBeGreaterThanOrEqual(5.66);
  });

  it('skeleton bg-muted is a non-text surface, and is low-contrast on purpose', () => {
    // NOT an AA failure: --muted is a placeholder fill with no text on it, so
    // 1.4.3 does not apply to it. Recorded because it is genuinely near
    // invisible (~1.07:1 against the page ground) and Phase 8 adoption should
    // know that before putting a skeleton on a page and wondering where it went.
    for (const chain of Object.values(PALETTES)) {
      const r = contrastRatio(resolve(decls, chain, '--muted'), resolve(decls, chain, '--background'));
      expect(r).toBeLessThan(1.5);
    }
  });
});

/* ── 7. The `line` naming still protects what it protected ───────────────── */

it('border-strong, border-faint, border-subtle and border-hairline still produce nothing', () => {
  for (const cls of ['border-strong', 'border-faint', 'border-subtle', 'border-hairline']) {
    expect(rule(cls), `${cls} now mints a rule`).toBeNull();
  }
});

/* ── 8. THE-264's mutation guard, unbroadened ────────────────────────────── */

it('the runtime and next/font exclusions are still keyed by exact name, not a pattern', () => {
  for (const key of [...Object.keys(SET_AT_RUNTIME), ...Object.keys(SET_BY_NEXT_FONT)]) {
    // ⚠️ Only glob/regex metacharacters count. `(` and `)` are NOT wildcards
    // here — they are literal syntax in Tailwind's arbitrary-property form,
    // `max-h-(--available-height)`, so flagging them would fail on the very
    // names THE-264 recorded as exact.
    expect(key, `${key} is a wildcard, not a literal`).not.toMatch(/[*?]|\.\+|\.\*/);
  }
  // Held at their recorded membership: widening either list to admit a new
  // class is the shortcut this PR must not take, and an exact list is the
  // cheapest tripwire for it.
  // THE-272 briefly added a fourth, `bg-(--color-bg)`, for chart.tsx's tooltip
  // swatch; THE-270 removed it when `holds back no stale exemption` reported it
  // as doing no work — chart.tsx sets --color-bg in its own style={{ … }}, and
  // THE-270 taught the audit to read that. None of THE-266's four spells any of
  // these either way. The membership stays pinned because widening this list is
  // exactly the shortcut that must stay hard to take, and a fourth has to be
  // argued for in ds-primitives.audit.ts.
  expect(Object.keys(SET_AT_RUNTIME).sort()).toEqual([
    'max-h-(--available-height)',
    'origin-(--transform-origin)',
    'w-(--anchor-width)',
  ]);
  expect(Object.keys(SET_BY_NEXT_FONT).sort()).toEqual([
    '--font-display',
    '--font-sans',
    '--font-serif',
  ]);
});

/* ── 9. The sidebar pin, now that its own ticket has landed ──────────────── */

/**
 * This assertion used to read "no --sidebar token was added — that gap is
 * still its own ticket". THE-267 is that ticket, so the pin is inverted here
 * exactly as it is in tailwind-v4-migration.test.ts: still by prefix, so an
 * unexpected member cannot slip past, but now naming the eight that must be
 * present rather than requiring the set to be empty. Nothing THE-266 shipped
 * depends on the family being absent — this file's own subject is the four
 * primitives it installed, none of which spells a sidebar utility.
 */
it('the sidebar family is exactly the eight THE-267 mapped', () => {
  expect(allDeclaredTokens().filter((t) => /^--sidebar/.test(t)).sort()).toEqual([
    '--sidebar',
    '--sidebar-accent',
    '--sidebar-accent-foreground',
    '--sidebar-border',
    '--sidebar-foreground',
    '--sidebar-primary',
    '--sidebar-primary-foreground',
    '--sidebar-ring',
  ]);
});

it('and none of THE-266’s four primitives spells a sidebar utility', () => {
  // The reason the inversion above is safe here: this file audits breadcrumb,
  // collapsible, skeleton and tooltip, and the sidebar family is invisible to
  // all four.
  //
  // ⚠️ THE-270 — this loop used to run over EVERY entry in classesByFile, which
  // is every .tsx in src/components/ui and not the four this file is about. It
  // read as a statement about THE-266 and was in fact a statement about the
  // whole directory, so installing `sidebar` — whose entire job is to spell
  // `bg-sidebar` — turned it red for a reason that had nothing to do with
  // THE-266. Scoped to the four it names. The directory-wide claim it was
  // accidentally making is not lost: the sidebar family is pinned by name in
  // the test above this one, and every class in every primitive is resolved by
  // the guard in ds-primitives.test.tsx.
  const four = new Set<string>(NEW_PRIMITIVES);
  for (const [file, classes] of audit.classesByFile) {
    if (!four.has(path.basename(file))) continue;
    for (const cls of classes) {
      expect(cls, `${path.basename(file)} spells ${cls}`).not.toMatch(/sidebar/);
    }
  }
});

/* ── 10. The guard actually read the new files ───────────────────────────── */

describe('the four new files exist and the guard actually read them', () => {
  const basenames = (): string[] => [...audit.classesByFile.keys()].map((f) => path.basename(f));

  for (const file of NEW_PRIMITIVES) {
    it(`${file} exists and the audit opened it`, () => {
      expect(existsSync(path.join(UI_DIR, file)), `${file} was never written`).toBe(true);
      expect(basenames(), `the audit never opened ${file}`).toContain(file);
    });
  }

  it('the audit read 43 files, not 13', () => {
    // 13 + THE-266's 4 + THE-272's 4 + THE-270's sidebar + THE-274's 21. The
    // point of the assertion is unchanged: a guard that opened nothing would
    // report nothing and look thorough.
    expect(audit.classesByFile.size).toBe(43);
  });

  it('and pulled real classes out of the three that carry any', () => {
    // collapsible is excluded deliberately: it is a pure Base UI passthrough
    // with no className anywhere, so 0 is its correct count and a `> 0`
    // assertion on it would be false. Its presence in classesByFile above is
    // what proves it was read; this asserts the other three were not read as
    // silently empty, which is how "the guard audited nothing" would look.
    const counts = Object.fromEntries(
      [...audit.classesByFile].map(([f, c]) => [path.basename(f), c.length]),
    );
    expect(counts['tooltip.tsx']).toBe(53);
    expect(counts['breadcrumb.tsx']).toBe(18);
    expect(counts['skeleton.tsx']).toBe(3);
    expect(counts['collapsible.tsx']).toBe(0);
    expect(readFileSync(path.join(UI_DIR, 'collapsible.tsx'), 'utf8')).not.toContain('className');
  });
});

/* ── 11. Out-of-scope files ──────────────────────────────────────────────── */

describe('the out-of-scope files are untouched', () => {
  it('tailwind.config.ts adds no colour and keeps its pinned code digest', () => {
    const config = readFileSync(TAILWIND_CONFIG, 'utf8');
    const code = config
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/[^\n]*/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    expect(sha256(code)).toBe(TAILWIND_CODE_SHA);
  });

  it('layout.tsx is byte-identical — the pre-paint theme script is untouched', () => {
    expect(sha256(readFileSync(LAYOUT, 'utf8'))).toBe(LAYOUT_SHA);
  });

  it('the tooltip install did NOT wrap the app in a TooltipProvider', () => {
    // The CLI prints instructions to add one to layout.tsx. Wiring is Phase 8,
    // and layout.tsx is pinned besides. A component imported by nothing is the
    // correct end state for this PR.
    expect(readFileSync(LAYOUT, 'utf8')).not.toContain('TooltipProvider');
  });

  it('firestore.rules is byte-identical', () => {
    expect(sha256(readFileSync(path.join(REPO_ROOT, 'firestore.rules'), 'utf8'))).toBe(RULES_SHA);
  });

  /**
   * ── THE-316 · the adopter list, and 🔴 A HOLE THIS TICKET FOUND IN IT ──────
   *
   * THE-266 installed these four and asserted that nothing imported them:
   * "Installing is this ticket; adoption is Phase 8." That assertion matched
   * only `@/components/ui/…`, the ALIAS spelling.
   *
   * 🔴 IT WAS THEREFORE VACUOUS FOR THREE OF THE FOUR. Every real adopter in
   * this repo reached for the RELATIVE spelling — `./ui/skeleton`,
   * `../ui/breadcrumb`, `./ui/collapsible` — and six files had been importing
   * these primitives, past a guard that reported zero, for as long as they had
   * existed. The guard was not wrong about its claim; it simply never looked
   * where the imports were. THE-272 closed exactly this hole in its own adopter
   * gate ("the original regex matched only the `@/` alias, so a `../ui/chart`
   * import would have slipped past it unrecorded") and this one was never
   * followed up.
   *
   * So the matcher below reads BOTH spellings, and the list records what is
   * actually true today rather than what was assumed. That is a strictly
   * stronger claim than the one it replaces: `tooltip` is still asserted to
   * have no adopter at all, and every other name is now closed against an
   * adopter nobody wrote down — which the old assertion could not have caught.
   *
   * ⚠️ The six pre-existing entries are recorded, NOT exempted. They are named
   * one by one so a seventh still fails, and so a reader can see which were
   * inherited and which this ticket added.
   */
  const RECORDED_UI_ADOPTERS: Readonly<Record<string, readonly string[]>> = {
    // 🔴 Adopted by nothing, still — the one name THE-266's claim held for.
    tooltip: [],
    collapsible: [
      // Pre-existing, and invisible to the alias-only matcher until now.
      'src/components/AdminAccounting.tsx',
      'src/components/AdminDonations.tsx',
      // THE-316 — the settings row card's disclosure. It was a bare <button>
      // toggling a conditionally-rendered div: a Collapsible written longhand,
      // without the aria-expanded / aria-controls pairing the primitive gives.
      'src/components/settings/SettingsAccordion.tsx',
    ],
    // The first three are pre-existing and were invisible to the alias-only
    // matcher until THE-316 closed it; recorded here so the set stays closed.
    skeleton: [
      'src/components/AdminDashboardHome.tsx',
      'src/components/dashboard/KpiCard.tsx',
      'src/components/dashboard/WidgetFrame.tsx',
      // THE-317 — the volunteer rota's loading state, and the first entry on
      // this list that was ADDED rather than uncovered. A rota's wait is a KNOWN
      // SHAPE — a card of stacked rows — so a skeleton says what is coming,
      // where a spinner would only say "wait". 🔴 A FIFTH adopter still fails.
      'src/components/events/VolunteerRotaView.tsx',
    ],
    breadcrumb: ['src/components/docs/DocsBreadcrumb.tsx'],
  };

  it('only the recorded adopters import the four, by either import spelling', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
        return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
      });
    const files = walk(path.join(REPO_ROOT, 'src')).filter(
      (f) => !f.startsWith(UI_DIR) && !f.includes(`${path.sep}__tests__${path.sep}`),
    );
    /** ⚠️ Alias AND relative — see the note above for why the difference is the
     *  whole point of this assertion. */
    const importsUi = (src: string, name: string) =>
      new RegExp(`from ['"](?:@/components|\\.{1,2}(?:/[\\w.-]+)*)/ui/${name}['"]`).test(src);

    for (const [name, recorded] of Object.entries(RECORDED_UI_ADOPTERS)) {
      const importers = files
        .filter((f) => importsUi(readFileSync(f, 'utf8'), name))
        .map((f) => rel(f))
        .sort();
      expect(importers, `${name} gained an adopter nobody recorded`).toEqual([...recorded].sort());

      // A recorded adopter that no longer adopts has to come out, so the list
      // cannot outlive what it records.
      for (const file of recorded) {
        expect(
          importsUi(readFileSync(path.join(REPO_ROOT, file), 'utf8'), name),
          `${file} is recorded as a ${name} adopter but does not import it`,
        ).toBe(true);
      }
    }
  });
});

/* ── 12. #409 is not disturbed ───────────────────────────────────────────── */

it('Classic is still the default palette family', () => {
  expect(DEFAULT_PALETTE_FAMILY).toBe('classic');
});
