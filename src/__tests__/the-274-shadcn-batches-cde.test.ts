import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import postcss from 'postcss';

import { GLOBALS_CSS, REPO_ROOT, TAILWIND_CONFIG } from '../test/support/tailwind-build';
import {
  auditPrimitives,
  extractClassNames,
  SET_AT_RUNTIME,
  SET_BY_NEXT_FONT,
  rel,
} from '../components/ui/__tests__/ds-primitives.audit';
import { contrastRatio, AA_CONTRAST } from '../lib/theme';
import { rulesDigestFailure } from './__fixtures__/firestore-rules-pin';

/**
 * THE-274 — shadcn Phase 7, Batches C, D and E, installed in one pass.
 *
 * Twenty-one primitives, one CLI call, one PR. They carry the Obsidian notes
 * tree (command, context-menu, resizable, item, empty), the profile/settings
 * cascade (field, input-group, textarea), the dashboard's customise drawer
 * (switch, checkbox, toggle-group) and the insight feeds (alert, spinner,
 * hover-card, scroll-area). As with THE-266, THE-270 and THE-272, every one is
 * wired into NOTHING — imported by nothing is the correct end state, and
 * section 9 asserts it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ TWO OF THE TICKET'S PREMISES NEEDED CORRECTING, AND ONE WAS CONFIRMED.
 *
 * 1. THE LIST WAS 19; THE CLI WROTE 21. Two arrived that the ticket did not
 *    name, and both are correct:
 *      • `popover` — the ticket asked for it explicitly ("install popover if it
 *        is missing"). It was missing. It is a registry item (200) and is now
 *        installed, which is also what makes a date-picker COMPOSABLE later.
 *      • `toggle` — a registry dependency of `toggle-group`, which nothing in
 *        the ticket mentions and which was not installed. The CLI pulled it in
 *        on its own. Section 3 pins the file set at exactly 43 so that neither
 *        an unexpected arrival nor a disappearance is silent.
 *
 * 2. `date-picker` IS NOT A REGISTRY ITEM — CONFIRMED, exactly as the ticket
 *    predicted and exactly the shape THE-272 found for `data-table`.
 *    `https://ui.shadcn.com/r/styles/base-nova/date-picker.json` is a 404
 *    while `popover.json` and the other nineteen are 200. In shadcn it is a
 *    COMPOSITION of `calendar` + `popover`, written where it is used. Nothing
 *    was hand-written to stand in for it; section 12 asserts its absence.
 *
 * 3. "EXPECT ZERO NEW TOKENS" — HELD. globals.css is byte-identical (section
 *    4). The bridge has now survived THE-266's four, THE-272's four, THE-270's
 *    sidebar and these twenty-one without a single token being added.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ THE TWO UNRESOLVED CLASSES, AND WHY NEITHER WAS A MISSING TOKEN.
 *
 * The guard reported two findings against calendar.tsx on first run:
 *
 *     rtl:**:[.rdp-button_next>svg]:rotate-180        no rule generated
 *     rtl:**:[.rdp-button_previous>svg]:rotate-180    no rule generated
 *
 * Neither was fixed by defining a token — the ticket forbids that, and it
 * would have been wrong: these name no custom property at all. calendar.tsx
 * spells them inside `String.raw` with an ESCAPED underscore
 * (`rdp-button\_next`), because in a Tailwind arbitrary variant `_` means a
 * space. The extractor read TypeScript's COOKED text, where `\_` has already
 * collapsed to `_`, and so asked Tailwind about a class that appears in no
 * file. Tailwind — which scans the source — had generated a rule for the
 * backslash spelling all along.
 *
 * Same shape as THE-272's `dot`/`line`/`dashed`/`top` comparands, and the same
 * remedy: a reader that agrees with the runtime, not an exemption. See
 * isStringRawTag in ds-primitives.audit.ts, and section 1's mutation, which
 * pins that an UNTAGGED template with the same escape still fails.
 */

const sha256 = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');

const UI_DIR = path.join(REPO_ROOT, 'src/components/ui');
/**
 * THE-331. Vendored registry INTERNALS, excluded for the same reason `UI_DIR`
 * is: this guard asks which APPLICATION files adopt a primitive, and a
 * primitive reaching for another primitive is not an adoption to record. The
 * reui cascader's own modules import `scroll-area` and `spinner` exactly as
 * `ui/*` files import each other. 🔴 This does NOT widen what the guard
 * accepts from app code — a screen under `src/components` that adopts a new
 * primitive without a recorded entry still fails, which is the whole threat.
 */
const REUI_DIR = path.join(REPO_ROOT, 'src/components/reui');
const FIXTURES = path.join(UI_DIR, '__tests__/__fixtures__');
const LAYOUT = path.join(REPO_ROOT, 'src/app/layout.tsx');

/**
 * The twenty-one this PR installs, as a LITERAL list.
 *
 * ⚠️ This list is the reason the guard cannot be satisfied by an empty
 * directory. `auditPrimitives` is pointed at whatever `readdirSync` finds, so
 * DELETING a newly written file would remove it from the audit and every
 * token assertion would pass while auditing nothing — the exact failure mode
 * THE-266's first attempt shipped. Section 1 walks this literal list and
 * requires each name both to exist on disk and to appear in the audit's own
 * `classesByFile`, so a deletion fails BY NAME.
 */
const NEW_PRIMITIVES = [
  'alert.tsx',
  'button-group.tsx',
  'calendar.tsx',
  'checkbox.tsx',
  'command.tsx',
  'context-menu.tsx',
  'empty.tsx',
  'field.tsx',
  'hover-card.tsx',
  'input-group.tsx',
  'item.tsx',
  'popover.tsx',
  'radio-group.tsx',
  'resizable.tsx',
  'scroll-area.tsx',
  'slider.tsx',
  'spinner.tsx',
  'switch.tsx',
  'textarea.tsx',
  'toggle-group.tsx',
  'toggle.tsx',
] as const;

/**
 * The 22 that existed at 788a589, with the digests recorded there.
 *
 * ⚠️ Spelled as LITERALS rather than read from primitive-digests.json. This PR
 * RE-RECORDS that fixture — it must, it gains twenty-one entries — so a test
 * comparing the fixture against itself would pass no matter what the CLI had
 * done to button.tsx or dialog.tsx. FIVE of these are registry dependencies of
 * what this PR installs — `command` → dialog + input-group, `field` → label +
 * separator, `input-group` → button + input + textarea, `item`/`button-group`
 * → separator — so five were live candidates for exactly that rewrite. The CLI
 * reported them "skipped (identical)"; this is the assertion that does not
 * take its word for it.
 */
const PRE_EXISTING_DIGESTS: Record<string, string> = {
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
  'sonner.tsx': '2ebc0c9ba968858cead2fbf2523dfd9da217715339967025e8c8df94f2131ab9',
  'table.tsx': 'a13f55a7c1406197608f223006cf16f211a257b213362caaef0d2abf3a389c8f',
  'tabs.tsx': '8bf9ee3935ab86c268a2a71cb5b4b67d3d5587ca9f2e0bf25f37ffdb1980434c',
  'tooltip.tsx': '2cea2294d4947b88d815860f64e0b5e0eb47a59bde47cfd194aac2230c923865',
};

/**
 * The class counts of those 22, recorded BEFORE this PR touched the extractor.
 * Pinned as literals for the same reason the digests are: this PR re-records
 * primitive-class-counts.json, and the claim under test is that the
 * `String.raw` fix moved none of these numbers — no pre-existing primitive
 * spells a raw-tagged template, so none of them can have shifted.
 */
const PRE_EXISTING_COUNTS: Record<string, number> = {
  'avatar.tsx': 48,
  'badge.tsx': 49,
  'breadcrumb.tsx': 18,
  'button.tsx': 80,
  'card.tsx': 44,
  'chart.tsx': 63,
  'collapsible.tsx': 0,
  'dialog.tsx': 53,
  'dropdown-menu.tsx': 79,
  'input.tsx': 35,
  'label.tsx': 11,
  'pagination.tsx': 13,
  'progress.tsx': 18,
  'select.tsx': 104,
  'separator.tsx': 6,
  'sheet.tsx': 61,
  'sidebar.tsx': 167,
  'skeleton.tsx': 3,
  'sonner.tsx': 3,
  'table.tsx': 26,
  'tabs.tsx': 73,
  'tooltip.tsx': 53,
};

/** The out-of-scope files, pinned at 788a589. */
const LAYOUT_SHA = 'b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f';
const TAILWIND_CODE_SHA = '491ebb5575d16eddfab00c6ed89900c725141b412e410e9e97342ff2108b2904';
const GLOBALS_SHA = '1fd6001c2d3bddc50a45b02ce1253b6b60802699fb33fa159f5ed42b8aeb9957';

const FUNCTIONS_DIGESTS: Record<string, string> = {
  'functions/.gcloudignore': '9c20b803e45cd916',
  'functions/package-lock.json': 'bbe18ca8fb92c17d',
  'functions/package.json': '33846d2de1bef5e3',
  'functions/src/index.ts': '39ccade96ac3d4dd',
  'functions/tsconfig.json': 'a707d5b587803ee0',
};

/** The four npm dependencies this PR accepts, and the versions it accepts. */
const NEW_DEPENDENCIES: Record<string, { range: string; version: string }> = {
  cmdk: { range: '^1.1.1', version: '1.1.1' },
  'date-fns': { range: '^4.4.0', version: '4.4.0' },
  // ⚠️ EXACT, not a caret. The registry declares `react-day-picker@latest`,
  // which is a moving target by construction; the founder's decision was to
  // pin it so the CLI's `@latest` cannot drift this tree on a later install.
  'react-day-picker': { range: '10.0.1', version: '10.0.1' },
  'react-resizable-panels': { range: '^4.12.3', version: '4.12.3' },
};

/* ── palette resolution ──────────────────────────────────────────────────
   🔴 THE-338 COLLAPSED FOUR CHAINS TO TWO. There used to be two palette
   FAMILIES (Harvest and Classic) crossed with two modes, and each of the four
   resolved through its own selector chain. The family axis is gone — Classic's
   14 overrides were promoted into :root/.dark and its selectors deleted — so
   'classic light' and 'harvest light' now name the same declarations, as do
   the two darks. Keeping four keys would have run every assertion below twice
   and reported a four-palette guarantee this app no longer offers. */
const PALETTES = {
  light: [':root'],
  dark: ['.dark, [data-theme="dark"]', ':root'],
} as const;

type Palette = keyof typeof PALETTES;
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

/**
 * Resolve one custom property in one palette, following var() indirection.
 *
 * ⚠️ Extended over THE-272's copy by one case: `rgb(var(--x))`. THE-274 is the
 * first batch to put `--destructive` on a ground, and globals.css defines it as
 * `rgb(var(--ink-danger-strong))` over Harvest's own space-separated triple.
 * THE-272's resolver only unwrapped a bare leading `var(`, so it returned the
 * literal string and contrastRatio produced NaN — which `toBeGreaterThanOrEqual`
 * silently fails rather than reports. Handled here rather than in lib/theme so
 * no production code moves for a test.
 */
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
  for (let i = 0; i < 10 && value; i++) {
    const wrapped = value.match(/^rgba?\(\s*var\(\s*(--[A-Za-z0-9-]+)\s*\)\s*\)$/);
    const direct = value.match(/^var\(\s*(--[A-Za-z0-9-]+)\s*(?:,([\s\S]*))?\)$/);
    const name = wrapped?.[1] ?? direct?.[1];
    if (!name || seen.has(name)) break;
    seen.add(name);
    const got = lookup(name);
    if (wrapped) {
      if (got === undefined) break;
      value = `rgb(${got})`;
      break;
    }
    value = got !== undefined ? got : direct?.[2]?.trim();
  }
  return (value ?? '').trim();
};

/** `#RRGGBB` straight through; `rgb(r g b)` / `rgb(r, g, b)` folded to hex. */
const toHexColour = (value: string): string => {
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;
  const m = value.match(/^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)/);
  if (!m) return value;
  return (
    '#' +
    [1, 2, 3]
      .map((i) => Math.round(Number(m[i])).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
};

const ratio = (decls: Decls, palette: Palette, fg: string, bg: string): number =>
  contrastRatio(
    toHexColour(resolve(decls, PALETTES[palette], fg)),
    toHexColour(resolve(decls, PALETTES[palette], bg)),
  );

const allDeclaredTokens = (): string[] => {
  const names = new Set<string>();
  postcss.parse(readFileSync(GLOBALS_CSS, 'utf8')).walkDecls((d) => {
    if (d.prop.startsWith('--')) names.add(d.prop);
  });
  return [...names].sort();
};

const pkg = (): { dependencies: Record<string, string>; devDependencies: Record<string, string> } =>
  JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

const lock = (): { packages: Record<string, { version?: string; dev?: boolean }> } =>
  JSON.parse(readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8'));

const walkFiles = (dir: string, skip: (name: string) => boolean = () => false): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return skip(e.name) ? [] : walkFiles(p, skip);
    return [p];
  });

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
}, 180_000);

/* ── 0. The resolver is pointed at real blocks ───────────────────────────── */

it('every palette selector this file names actually exists in globals.css', () => {
  // A mistyped selector does not throw — `resolve` falls through to the next
  // link and returns :root's value, so "classic dark" would silently report the
  // LIGHT palette and every ratio below would pass while measuring the wrong
  // thing. THE-266 caught exactly that during development.
  for (const [palette, chain] of Object.entries(PALETTES)) {
    for (const sel of chain) {
      expect(decls.has(sel), `${palette} names a selector not in globals.css: ${sel}`).toBe(true);
    }
  }
});

/* ── 1. The guard, named per component ───────────────────────────────────── */

describe("each new primitive's token classes resolve", () => {
  // One `it` per component, so a regression names the file rather than
  // reporting "something under src/components/ui is broken".
  for (const file of NEW_PRIMITIVES) {
    it(`${file} spells no class that produces nothing`, () => {
      const abs = path.join(UI_DIR, file);

      // ⚠️ THE MUTATION THAT PROVES THE GUARD READ THE FILE. The audit is
      // pointed at readdirSync's output, so a DELETED file simply leaves the
      // set and every token assertion below would pass vacuously. Both halves
      // are required: the file is on disk, AND the audit actually opened it.
      expect(existsSync(abs), `${file} is missing — the CLI did not write it, or it was deleted`)
        .toBe(true);
      expect(
        [...audit.classesByFile.keys()].map((f) => path.basename(f)),
        `${file} was never audited`,
      ).toContain(file);

      // …and it yielded real classes, so an emptied file cannot pass either.
      const classes = audit.classesByFile.get(abs) ?? [];
      expect(classes.length, `${file} yielded no classes at all`).toBeGreaterThan(0);

      const mine = audit.findings.filter((f) => path.basename(f.file) === file);
      expect(
        mine.map((f) => `${f.className} — ${f.reason}`),
        `${file} spells a class that resolves to nothing`,
      ).toEqual([]);
    });
  }

  it('and the audit as a whole is clean, across all 43 primitives', () => {
    expect(audit.findings).toEqual([]);
    expect(audit.classesByFile.size).toBe(43);
  });

  it('the audit opened all 43 files and pulled real classes out of the new 21', () => {
    // A build that produced nothing would report every class unresolved and
    // look like a very thorough guard; a reader that stopped reading would
    // report nothing and look like a very clean one. Both are excluded.
    expect(audit.generatedCount).toBeGreaterThan(200);
    for (const file of NEW_PRIMITIVES) {
      const classes = audit.classesByFile.get(path.join(UI_DIR, file)) ?? [];
      // spinner.tsx is the floor at 2 — it is one <svg> with two classes.
      expect(classes.length, `${file} yielded ${classes.length} classes`).toBeGreaterThanOrEqual(2);
    }
  });

/**
 * ⚠️ `dialog.tsx` and `sheet.tsx` each read ONE class MORE since THE-295, and
 * why. Both spelled `z-50` TWICE — once on the scrim, once on the panel — so
 * the extractor read one distinct class where it now reads two, `z-[101]` and
 * `z-[102]`. The count moved by exactly +1 in each file because a duplicate
 * became two names, NOT because the extractor's reading of anything changed,
 * which is the claim these counts are pinned for. See MOVED_SINCE below.
 */
const COUNT_MOVED_SINCE: Readonly<Record<string, number>> = {
  'dialog.tsx': 54,
  'sheet.tsx': 62,
};

  it('the String.raw fix moved no pre-existing count', () => {
    // The extractor changed in this PR. The claim is that it changed the
    // reading of exactly the raw-tagged templates and nothing else — no file
    // that predates this PR spells one, so not one of these may move.
    const counts = Object.fromEntries(
      [...audit.classesByFile].map(([f, c]) => [path.basename(f), c.length]),
    );
    const expectedCounts = { ...PRE_EXISTING_COUNTS, ...COUNT_MOVED_SINCE };
    for (const [file, expected] of Object.entries(expectedCounts)) {
      expect(counts[file], `${file} changed class count under the String.raw fix`).toBe(expected);
    }
  });

  it("calendar's two rtl classes are read with their backslash, and resolve", () => {
    // The bug, pinned from the other side: the class the extractor now reports
    // is the SOURCE spelling (with `\_`), which is what lands in the DOM and
    // what Tailwind generated a rule for. If the reader regressed to the cooked
    // text these two names would change and the guard would report them again.
    const classes = audit.classesByFile.get(path.join(UI_DIR, 'calendar.tsx')) ?? [];
    expect(classes).toContain(String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`);
    expect(classes).toContain(String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`);
    // And the cooked spelling — the one that produced the false positive — is
    // not what is read.
    expect(classes).not.toContain('rtl:**:[.rdp-button_next>svg]:rotate-180');
  });

  it('an untagged template literal with the same escape still fails', async () => {
    // ⚠️ The mutation the by-tag rule is written against. Reading raw text for
    // EVERY template literal would hide a real bug: an untagged `\_` really
    // does collapse to `_` at runtime, so the class in the DOM would not match
    // the rule Tailwind generated from the source. Only String.raw is exempt.
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const os = await import('node:os');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'the-274-'));
    const file = path.join(dir, 'fixture.tsx');
    writeFileSync(
      file,
      'export const F = () => <div className={`rtl:**:[.rdp-button\\_next>svg]:rotate-180`} />',
      'utf8',
    );
    const { findings } = await auditPrimitives([file]);
    expect(findings.map((f) => f.className)).toContain(
      'rtl:**:[.rdp-button_next>svg]:rotate-180',
    );
  }, 180_000);
});

/* ── 2. The unresolved fixture ───────────────────────────────────────────── */

it('the unresolved fixture is still empty, at zero bytes', () => {
  // Twenty-one components arrived and the recorded failure list did not grow.
  const recorded = readFileSync(path.join(FIXTURES, 'unresolved-token-classes.txt'), 'utf8');
  expect(recorded).toBe('');
});

/* ── 3. The CLI rewrote nothing it should not have ───────────────────────── */

/**
 * ⚠️ `tabs.tsx` MOVED SINCE, and why — THE-276-FIX.
 *
 * As vendored by this PR it styled itself with `data-horizontal:` and
 * `data-vertical:` variants, which Tailwind compiles to the attribute selectors
 * `[data-horizontal]` and `[data-vertical]`. The installed @base-ui/react
 * (^1.5.0) emits `data-orientation="horizontal"` instead, so none of those
 * twelve rules ever matched. It shipped: the tabs root kept `display:flex` with
 * the default `row` direction, and the panel — a `flex-1` sibling — rendered as
 * a second COLUMN beside the tab strip, putting every dashboard widget in a
 * 420px band on the right of a 1044px container. The active tab's underline,
 * whose geometry comes from the same variants, was never drawn either.
 *
 * Twelve class names re-spelled `data-[orientation=…]`. No element, slot,
 * variant or API changed — which is why the class COUNT below is untouched.
 *
 * Named rather than the assertion being loosened, the same treatment THE-273's
 * sonner.tsx fix gets in the sibling suites: every other entry is still
 * compared against the digest this PR recorded, and a second file moving still
 * fails.
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
  'tabs.tsx': '096e3d4b2a99b1eff95d16959f97daaa1747fdb7de6226d6c54b9693e22b3410',
};

describe('the CLI rewrote nothing it should not have', () => {
  it('all 22 pre-existing primitives are byte-identical to 788a589, bar the one THE-276-FIX fixed', () => {
    const actual = Object.fromEntries(
      Object.keys(PRE_EXISTING_DIGESTS).map((f) => [
        f,
        sha256(readFileSync(path.join(UI_DIR, f), 'utf8')),
      ]),
    );
    expect(actual).toEqual({ ...PRE_EXISTING_DIGESTS, ...MOVED_SINCE });
  });

  it('the five the CLI could have rewritten in particular', () => {
    // Each of these is a registry dependency of something installed here, so
    // each was a live candidate for an overwrite: dialog and input-group via
    // `command`, label and separator via `field`, button/input/textarea via
    // `input-group`. `--overwrite` defaults to false and the CLI content-
    // compares before it would prompt; this does not take its word for it.
    // dialog.tsx is compared against the MOVED_SINCE overlay, as the assertion
    // above is: THE-295 raised its z-index deliberately, long after this
    // install. The claim here is about the CLI and is unweakened — the file
    // still has to match a digest named in this repo with a ticket and a
    // reason, not whatever it happens to hold today.
    const expected = { ...PRE_EXISTING_DIGESTS, ...MOVED_SINCE };
    for (const f of ['button.tsx', 'dialog.tsx', 'input.tsx', 'label.tsx', 'separator.tsx']) {
      expect(sha256(readFileSync(path.join(UI_DIR, f), 'utf8')), `${f} was rewritten`).toBe(
        expected[f],
      );
    }
  });

  it('src/components/ui holds exactly the 22 plus the 21, and nothing else', () => {
    const onDisk = readdirSync(UI_DIR)
      .filter((f) => f.endsWith('.tsx'))
      .sort();
    expect(onDisk).toEqual(
      [...Object.keys(PRE_EXISTING_DIGESTS), ...NEW_PRIMITIVES].sort(),
    );
    expect(onDisk).toHaveLength(43);
  });

  it('the re-recorded digest fixture carries the 22 unchanged', () => {
    // The fixture had to be re-recorded — it gains 21 entries. This asserts
    // the re-record carried nothing with it: every pre-existing entry in the
    // regenerated file still holds the value recorded at 788a589.
    const fixture: Record<string, string> = JSON.parse(
      readFileSync(path.join(FIXTURES, 'primitive-digests.json'), 'utf8'),
    );
    // ⚠️ The overlay applies here too: the fixture is the live ledger, so a
    // file named in MOVED_SINCE holds its NEW digest there. Everything else
    // still has to hold the value recorded at 788a589.
    const expected = { ...PRE_EXISTING_DIGESTS, ...MOVED_SINCE };
    for (const [file, digest] of Object.entries(expected)) {
      expect(fixture[`src/components/ui/${file}`], `${file} moved in the fixture`).toBe(digest);
    }
    expect(Object.keys(fixture)).toHaveLength(43);
  });
});

/* ── 4. Zero new tokens ──────────────────────────────────────────────────── */

describe('the token bridge held, with zero new tokens', () => {
  it('globals.css is byte-identical — this PR defines no token at all', () => {
    expect(sha256(readFileSync(GLOBALS_CSS, 'utf8'))).toBe(GLOBALS_SHA);
  });

  it('and the token ledger is unchanged, name for name', () => {
    const recorded = readFileSync(path.join(FIXTURES, 'globals-tokens.txt'), 'utf8');
    expect(`${allDeclaredTokens().join('\n')}\n`).toBe(recorded);
  });

  it('the runtime exclusion list is still three, and still holds names not patterns', () => {
    // ⚠️ Twenty-one components arrived, several of them Base UI popups
    // (popover, hover-card, context-menu, command) — exactly the shape that
    // produced the three runtime entries in the first place. None needed a
    // fourth: the positioner classes they spell are the SAME three names.
    expect(Object.keys(SET_AT_RUNTIME).sort()).toEqual([
      'max-h-(--available-height)',
      'origin-(--transform-origin)',
      'w-(--anchor-width)',
    ]);
    for (const [cls, reason] of Object.entries(SET_AT_RUNTIME)) {
      expect(cls, `${cls} is a pattern, not a name`).not.toMatch(/[*?]|\.\+|\\/);
      expect(reason.length, `${cls} is exempted without a reason`).toBeGreaterThan(40);
    }
  });

  it('SET_BY_NEXT_FONT is still keyed by exact name, not a pattern', () => {
    expect(Object.keys(SET_BY_NEXT_FONT).sort()).toEqual([
      '--font-display',
      '--font-sans',
      '--font-serif',
    ]);
    for (const [prop, reason] of Object.entries(SET_BY_NEXT_FONT)) {
      expect(prop, `${prop} is a pattern, not a name`).not.toMatch(/[*?]|\.\+|\\/);
      expect(prop.startsWith('--'), `${prop} is not a property name`).toBe(true);
      expect(reason.length, `${prop} is exempted without a reason`).toBeGreaterThan(40);
    }
    // And the list is still grounded in the file that actually declares them.
    const layout = readFileSync(LAYOUT, 'utf8');
    for (const prop of Object.keys(SET_BY_NEXT_FONT)) {
      expect(layout).toContain(`variable: '${prop}'`);
    }
  });
});

/* ── 5. No existing token moved ──────────────────────────────────────────── */

describe('every token the earlier phases shipped still resolves to the same value', () => {
  /** THE-263/264's bridge, --chart-*, and THE-267/412's sidebar family. */
  const PINNED: Record<Palette, Record<string, string>> = {
    // 🔴 THE-338 re-recorded these. Light is the neutral ramp (unchanged from
    // what "classic light" held — the default since THE-265); dark is that
    // ramp darkened. The brand rows are untouched in both.
    light: {
      '--background': '#F7F7F7',
      '--foreground': '#404040',
      '--card': '#FFFFFF',
      '--muted': '#EFEFEF',
      '--muted-foreground': '#595959',
      '--primary': '#C9963A',
      '--primary-foreground': '#2D2519',
      '--accent': '#E0E0E0',
      '--accent-foreground': '#1A1A1A',
      '--popover': '#FFFFFF',
      '--popover-foreground': '#404040',
      '--sidebar': '#FFFFFF',
      '--sidebar-foreground': '#404040',
    },
    dark: {
      '--background': '#141414',
      '--foreground': '#CCCCCC',
      '--card': '#1F1F1F',
      '--muted': '#0C0C0C',
      '--muted-foreground': '#ABABAB',
      '--primary': '#C9963A',
      '--primary-foreground': '#2D2519',
      '--accent': '#2A2A2A',
      '--accent-foreground': '#F2F2F2',
      '--popover': '#1F1F1F',
      '--popover-foreground': '#CCCCCC',
      '--sidebar': '#1F1F1F',
      '--sidebar-foreground': '#CCCCCC',
    },
  };

  for (const palette of Object.keys(PALETTES) as Palette[]) {
    it(`${palette} — every pinned token still resolves to its recorded value`, () => {
      for (const [token, expected] of Object.entries(PINNED[palette])) {
        expect(
          toHexColour(resolve(decls, PALETTES[palette], token)),
          `${token} moved in ${palette}`,
        ).toBe(expected);
      }
    });
  }

  it('the eight --sidebar-* tokens and their @theme halves are all still declared', () => {
    const tokens = allDeclaredTokens();
    const family = [
      '--sidebar',
      '--sidebar-accent',
      '--sidebar-accent-foreground',
      '--sidebar-border',
      '--sidebar-foreground',
      '--sidebar-primary',
      '--sidebar-primary-foreground',
      '--sidebar-ring',
    ];
    expect(tokens.filter((t) => /^--sidebar/.test(t)).sort()).toEqual(family);
    expect(tokens.filter((t) => /^--color-sidebar/.test(t)).sort()).toEqual(
      family.map((t) => t.replace('--sidebar', '--color-sidebar')).sort(),
    );
  });

  it('--chart-1..5 are still declared, and --chart-4/5 are still the muted series', () => {
    const tokens = allDeclaredTokens();
    for (const n of [1, 2, 3, 4, 5]) expect(tokens).toContain(`--chart-${n}`);
    // Recorded by THE-272 and deliberately NOT fixed: the design's own muted
    // series, measured on the light ground.
    const four = ratio(decls, 'light', '--chart-4', '--background');
    const five = ratio(decls, 'light', '--chart-5', '--background');
    expect(four).toBeLessThan(3);
    expect(five).toBeLessThan(3);
    expect(four).toBeCloseTo(1.5, 1);
    expect(five).toBeCloseTo(1.77, 1);
  });
});

/* ── 6. Contrast ─────────────────────────────────────────────────────────── */

describe('every foreground/background pair the 21 components introduce clears AA', () => {
  /**
   * The pairs, read off the installed files:
   *
   *   alert.tsx:12         `bg-card text-card-foreground`      (default)
   *   alert.tsx:14         `bg-card` + `text-destructive`      (destructive)
   *   popover.tsx:40       `bg-popover text-popover-foreground`
   *   popover.tsx:77       PopoverDescription `text-muted-foreground`, inside it
   *   context-menu.tsx:104 `focus:bg-accent focus:text-accent-foreground`
   *   context-menu.tsx:104 `data-[variant=destructive]:text-destructive` on bg-popover
   *   checkbox.tsx:13      `data-checked:bg-primary data-checked:text-primary-foreground`
   *   field.tsx            FieldError `text-destructive` on the page ground
   *   calendar.tsx:212     `data-[range-middle=true]:bg-muted …:text-foreground`
   *   item.tsx:146         ItemDescription `text-muted-foreground` on bg-muted
   *
   * ⚠️ The `/30`, `/50`, `/80` blends are bounded, not skipped: each composites
   * its token over the ground beneath it, so the result lies between the two,
   * and asserting the text colour on BOTH endpoints brackets every blend of
   * them. resizable, scroll-area, spinner and toggle-group spell no
   * foreground/background pair of their own — they carry `bg-border`,
   * `ring-ring` and layout only.
   */
  const PAIRS = [
    ['alert text-card-foreground on bg-card', '--card-foreground', '--card'],
    ['alert destructive text-destructive on bg-card', '--destructive', '--card'],
    ['popover text-popover-foreground on bg-popover', '--popover-foreground', '--popover'],
    ['popover text-muted-foreground on bg-popover', '--muted-foreground', '--popover'],
    ['context-menu text-accent-foreground on bg-accent', '--accent-foreground', '--accent'],
    ['context-menu text-destructive on bg-popover', '--destructive', '--popover'],
    ['checkbox text-primary-foreground on bg-primary', '--primary-foreground', '--primary'],
    ['field text-destructive on bg-background', '--destructive', '--background'],
    ['calendar text-foreground on bg-muted', '--foreground', '--muted'],
    ['item text-muted-foreground on bg-muted', '--muted-foreground', '--muted'],
  ] as const;

  /**
   * The measured ratios. Pinned, not merely bounded.
   *
   * 🔴 THE-338 — the LIGHT row is unchanged (it is what 'classic light' held,
   * and that family has been the default since THE-265). Every DARK figure
   * except the gold pair went UP, because darkening a ground can only improve
   * text contrast — 9.67 -> 10.26, 9.46 -> 10.05, 11.57 -> 12.18, 8.09 -> 8.52.
   * The gold pair sits at 5.69 in both, untouched.
   */
  const RATIOS: Record<Palette, number[]> = {
    light: [10.37, 6.54, 10.37, 7.0, 13.18, 6.54, 5.69, 6.1, 9.02, 6.09],
    dark: [10.26, 10.05, 10.26, 7.18, 12.82, 10.05, 5.69, 11.23, 12.18, 8.52],
  };

  for (const palette of Object.keys(PALETTES) as Palette[]) {
    PAIRS.forEach(([label, fg, bg], i) => {
      it(`${label} — ${palette}`, () => {
        const r = ratio(decls, palette, fg, bg);
        expect(Number.isFinite(r), `${label} did not resolve to a colour in ${palette}`).toBe(true);
        expect(r, `${label} is ${r.toFixed(2)}:1 in ${palette}`).toBeGreaterThanOrEqual(
          AA_CONTRAST,
        );
        // And it is the ratio recorded, so a token moving underneath these
        // components fails here by name and palette rather than drifting
        // silently down towards the floor.
        expect(r).toBeCloseTo(RATIOS[palette][i], 1);
      });
    });
  }

  /**
   * ⚠️ THE 5.69 FLOOR IS THIS PAIR, ROUNDED — it is not a bar above it.
   *
   * The worst pair here is `text-primary-foreground` on `bg-primary`, identical
   * in both palettes because both tokens are mode-invariant, and it
   * measures 5.6876:1. #412's recorded floor of "5.69" is that same gold pair —
   * `--sidebar-primary-foreground` on `--sidebar-primary` resolves to the very
   * same two hexes — quoted to two decimals. So this batch does not clear that
   * floor by a margin; it MEETS it, because it is the same colour pair.
   *
   * Asserting `>= 5.69` would therefore fail by 0.0024 on a PR that moved
   * nothing, which is why the claim is written as "equals the recorded floor"
   * plus the one real threshold: AA at 4.5. THE-272 asserted `>= 5.69` and got
   * away with it only because its own worst pair was 6.08 and never reached
   * the boundary.
   */
  it('the worst of them is the recorded 5.69 floor itself, and clears AA', () => {
    const worst = Math.min(
      ...PAIRS.flatMap(([, fg, bg]) =>
        (Object.keys(PALETTES) as Palette[]).map((p) => ratio(decls, p, fg, bg)),
      ),
    );
    expect(worst).toBeGreaterThanOrEqual(AA_CONTRAST);
    expect(worst).toBeGreaterThanOrEqual(5.66); // THE-263's floor, cleared.
    expect(worst).toBeCloseTo(5.69, 2); // #412's floor, met — same pair.
    // And it really is the gold pair, not something else that happens to land
    // near it: the same two hexes #412 measured.
    expect(toHexColour(resolve(decls, PALETTES.light, '--primary-foreground'))).toBe('#2D2519');
    expect(toHexColour(resolve(decls, PALETTES.light, '--primary'))).toBe('#C9963A');
    expect(
      ratio(decls, 'light', '--sidebar-primary-foreground', '--sidebar-primary'),
    ).toBeCloseTo(worst, 4);
  });

  /**
   * ⚠️ THE PAIR THAT DOES NOT CLEAR AA, AND WHY IT IS NOT THIS PR'S TO FIX.
   *
   * item.tsx:146, field.tsx:138 and empty.tsx:76 each style a link inside a
   * description as `[&>a]:underline [&>a:hover]:text-primary`. On the two LIGHT
   * palettes the gold on the page ground is ~2.5:1, well under 4.5.
   *
   * It is recorded rather than fixed because it is NOT NEW. `button.tsx`'s
   * `link` variant has been exactly `text-primary underline-offset-4
   * hover:underline` since THE-260, and badge.tsx carries the same; the three
   * new files reuse the established link convention rather than inventing a
   * pair. Fixing it means moving `--primary` — the brand gold, load-bearing
   * across the whole app — which this ticket forbids outright. Same treatment
   * THE-266 gave skeleton's invisible `bg-muted` and THE-272 gave progress's
   * 2.30:1 track: measured, recorded, asserted in BOTH directions so a later
   * token move in either one is caught, and left for Phase 8 to decide in
   * daylight.
   */
  it('the link-hover text-primary pair is pre-existing, and recorded at its real ratio', () => {
    const measured = Object.fromEntries(
      (Object.keys(PALETTES) as Palette[]).map((p) => [
        p,
        Number(ratio(decls, p, '--primary', '--background').toFixed(2)),
      ]),
    );
    // ⚠️ The light figure is UNCHANGED at 2.48 — the accepted shortfall this
    // ticket was told not to "fix". Dark rose 6.42 -> 6.94 with the ground.
    expect(measured).toEqual({ light: 2.48, dark: 6.94 });
    // Asserted both ways, so a move in either direction fails here.
    expect(measured.light).toBeLessThan(AA_CONTRAST);
    expect(measured.dark).toBeGreaterThanOrEqual(AA_CONTRAST);

    // And the evidence that it predates this PR: button.tsx, untouched here,
    // already ships the identical treatment.
    const button = readFileSync(path.join(UI_DIR, 'button.tsx'), 'utf8');
    expect(button).toContain('text-primary underline-offset-4');
  });

  it('progress bg-primary on bg-muted is still recorded at its real ratio', () => {
    // Carried forward from THE-272 unchanged: a graphical object under 1.4.11's
    // 3:1, not text under 1.4.3. Re-asserted here because this PR must not have
    // moved --primary or --muted, and this is the number that would show it.
    const measured = Object.fromEntries(
      (Object.keys(PALETTES) as Palette[]).map((p) => [
        p,
        Number(ratio(decls, p, '--primary', '--muted').toFixed(2)),
      ]),
    );
    // ⚠️ 2.31 on light is the accepted 1.4.11 shortfall, preserved exactly.
    expect(measured).toEqual({ light: 2.31, dark: 7.37 });
  });
});

/* ── 7. The border names still produce nothing ───────────────────────────── */

it('border-strong, border-faint, border-subtle and border-hairline still produce nothing', async () => {
  // Carried forward from THE-266/272. This batch spells more border utilities
  // than any before it — `border-input`, `border-ring`, `border-destructive`,
  // `border-primary`, `border-border` across ten files — so it is worth
  // re-asserting rather than trusting the earlier run.
  const { buildCssForMarkup } = await import('../test/support/tailwind-build');
  const css = await buildCssForMarkup(
    '<div class="border-strong border-faint border-subtle border-hairline"></div>',
  );
  for (const cls of ['border-strong', 'border-faint', 'border-subtle', 'border-hairline']) {
    const esc = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(css.match(new RegExp(`\\.${esc}\\s*\\{[^}]*\\}`)), `${cls} now mints a rule`).toBeNull();
  }
}, 180_000);

/* ── 8. Imported by nothing ──────────────────────────────────────────────── */

/**
 * ⚠️ THE-274 INSTALLED THESE AND ADOPTED NONE OF THEM. This assertion was
 * `toEqual([])` and said so: "installing is this ticket, not adopting".
 *
 * THE-286 is the first adopter, so the claim narrows rather than disappears —
 * from "nobody imports these" to "exactly these files do, each named with the
 * ticket that adopted them". That is strictly the stronger guard: an
 * unrecorded adoption still fails here, and now so does an adopter that
 * quietly stops adopting, which `toEqual([])` could never have caught.
 *
 * 🔴 The list is pinned WHOLE. Widening it is an edit to this line, visible in
 * review — which is the property that made the original assertion worth having.
 */
const RECORDED_ADOPTERS: ReadonlyArray<{ file: string; ticket: string; why: string }> = [
  {
    file: 'src/components/settings/IntegrationsSection.tsx',
    ticket: 'THE-339',
    why:
      'APPENDED, never substituted. THE-339 hides the Gmail card behind a master switch, and the '
      + 'section it leaves behind needs a REPLACEMENT STATE rather than a heading over nothing: an '
      + 'admin whose only provider was Gmail would otherwise open Integrations onto an empty region '
      + 'and an intro paragraph still telling them to connect the thing that is gone. It takes '
      + '`alert` (Alert, AlertTitle, AlertDescription) for that state. Load-bearing rather than '
      + 'cosmetic, for the same reason FieldError is above: the primitive carries role="alert", '
      + 'which is what makes "sending is paused, and your account is still connected" reach a screen '
      + 'reader, and it paints from bg-card/text-card-foreground so both palettes resolve it with no '
      + 'colour of this ticket\'s own. It is also where the ONLY remaining Disconnect control lives, '
      + 'so an admin who connected Gmail before the switch went off can still revoke a live OAuth '
      + 'grant. `empty` is REJECTED: it announces an absent collection, and this is a capability '
      + 'withdrawn on purpose with a live connection possibly still behind it. `dialog` is REJECTED: '
      + 'nothing here is a decision that must interrupt. `sonner` is REJECTED: a toast leaves the '
      + 'screen while the connection it described is still granted. No primitive was edited.',
  },
  {
    file: 'src/components/settings/GivingStatementsSection.tsx',
    ticket: 'THE-286',
    why:
      'The proof section for the settings chrome. It takes `field` (Field, FieldLabel, ' +
      'FieldDescription, FieldError) and `textarea`, plus the pre-existing `input`, so that the ' +
      'section spells no field chrome of its own — it used to draw a card inside the accordion ' +
      "row's card and re-spell `px-4 py-2.5 border rounded-xl focus:ring-gold` three times. " +
      'FieldError is load-bearing rather than cosmetic: it carries role="alert", which is what ' +
      'makes a failed autosave reach a screen reader and not only an eye. No primitive was ' +
      'edited — their digests are pinned by ds-primitives.test.tsx and still match.',
  },
  {
    file: 'src/components/settings/OnboardingSection.tsx',
    ticket: 'THE-296',
    why:
      "The second section onto THE-286's chrome, and the one that still carried a SAVE BUTTON — " +
      'the control autosave was extracted to replace. It takes `field` (Field, FieldDescription, ' +
      'FieldError, FieldGroup, FieldLabel) plus the pre-existing `input`, so the question-editor ' +
      'dialog spells no field chrome of its own; it used to re-spell ' +
      '`px-4 py-2 border border-line rounded-lg focus:ring-2 focus:ring-gold` three times. ' +
      'FieldError is load-bearing for the same reason it is in GivingStatementsSection: its ' +
      'role="alert" is what carries a failed autosave to a screen reader, and here it replaces an ' +
      '`alert()` that left no record at all once dismissed. No primitive was edited.',
  },
  {
    file: 'src/components/AdminSettings.tsx',
    ticket: 'THE-316',
    why:
      'The settings visual pass, and the first adopter from a SCREEN rather than a section. It ' +
      'takes `item` (Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions) and ' +
      '`alert` (Alert, AlertTitle, AlertDescription, AlertAction), alongside the already-adopted ' +
      '`badge`, `button`, `dialog` and `separator`. This screen previously imported NOTHING from ' +
      'ui/ and hand-rolled a plan card, a Super Admin card, a navigation row, two Stripe status ' +
      'banners and a modal out of raw divs — the same ~2,000-line hand-rolled-UI failure that ' +
      'RetentionHeatmap, ServicePlanPanel, FormAnswersView and AdminSms shipped. `alert` is ' +
      'load-bearing rather than cosmetic: the two banner dismissals were bare buttons holding a ' +
      'bald glyph with no accessible name, and AlertAction gives them a labelled Button with the ' +
      "screen's focus ring. `item` is what removes the three hand-written flex rows. No primitive " +
      'was edited — their digests are pinned by ds-primitives.test.tsx and still match.',
  },
  {
    file: 'src/components/events/VolunteerRotaView.tsx',
    ticket: 'THE-317',
    why:
      'The volunteer rota, and the first adopter of `empty` in this repo. `empty` (Empty, ' +
      'EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription) is LOAD-BEARING rather than ' +
      "cosmetic, and it is the whole point of the ticket's exactness rule: when the plan or event " +
      'read cannot be PROVEN complete — it rejected, or it came back at its ceiling without ' +
      'reaching past the window — the rota refuses to list anybody and renders an Empty NAMING ' +
      'THE REASON instead. A zero or a bare empty list there is the class of bug that shipped as ' +
      '`Form submissions 0`, because it is indistinguishable from an answer. `item` (Item, ' +
      'ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemDescription) renders the "has not served ' +
      "recently\' rows — a person, an avatar and two lines about them, which is the primitive's " +
      'exact shape; THE-316 adopted it one ticket earlier for the same reason and this is its ' +
      'second adopter. No primitive was edited — their digests are pinned by ' +
      'ds-primitives.test.tsx and still match. The other nineteen in NEW_PRIMITIVES gain no ' +
      'adopter here: this view has no boolean (checkbox, switch, toggle, toggle-group), no free ' +
      'text or form field (textarea, field, input-group), no menu or overlay (command, ' +
      'context-menu, hover-card, popover), no date entry (calendar — the rota READS event dates, ' +
      'it does not set them), no split pane (resizable), no second scroll context (scroll-area — ' +
      'the overflow is one overflow-x-auto inside the card, per #422), no range (slider), no ' +
      'banner (alert), no grouped buttons (button-group) and no indeterminate wait (spinner — the ' +
      'wait here is a known shape, so it is skeleton).',
  },
  {
    file: 'src/components/Profile.tsx',
    ticket: 'THE-321',
    why:
      "The member Profile's visual pass, and the first adopter from a MEMBER-FACING screen — " +
      'THE-286, THE-296 and THE-316 were all admin surfaces. It takes `item` (Item, ItemActions, ' +
      'ItemContent, ItemMedia, ItemTitle), `switch` and `empty` (Empty, EmptyContent, ' +
      'EmptyDescription, EmptyHeader), alongside the already-adopted `avatar`, `badge`, `button`, ' +
      '`card`, `dialog` and `separator`. This screen previously imported NOTHING from ui/ and ' +
      'hand-rolled four card shells, both row types, nine hairlines, two avatars, two chips and a ' +
      'modal out of raw divs — the same hand-rolled-UI failure AdminSettings, RetentionHeatmap, ' +
      'ServicePlanPanel, FormAnswersView and AdminSms shipped. `switch` is load-bearing rather ' +
      'than cosmetic: the hand-rolled toggle it replaces painted its track from a literal hex ' +
      'fallback and moved its thumb by a magic 21px offset, so it was both the worst inline style ' +
      'in the file and its only palette-blind control. `empty` STATES the no-partnership case ' +
      'that a bare centred div only drew. No primitive was edited — their digests are pinned by ' +
      'ds-primitives.test.tsx and still match.',
  },
  // 🔴 APPENDED BY THE-320, BESIDE THE-317's AND THE-321's ENTRIES ABOVE — none
  // of them replaces another. THE-317 records VolunteerRotaView, THE-321 records
  // Profile, THE-320 records the two SMS surfaces; the resolution is the union of
  // all four and every earlier entry stands unedited.
  {
    file: 'src/components/AdminSms.tsx',
    ticket: 'THE-320',
    why:
      'The two SMS surfaces, and the last of the six screens that shipped ~2,000 lines of ' +
      'hand-rolled UI because every ticket read "no new component" as "install nothing". This ' +
      'screen imported NOTHING from ui/ and hand-rolled a tab switcher, a segment meter, four ' +
      'card shells, a broadcast composer, an empty state, two history lists, three template ' +
      'cards and the Text-to-Give panel out of raw divs. It takes `item` (Item, ItemMedia, ' +
      'ItemContent, ItemTitle, ItemDescription, ItemActions), `alert` (Alert, AlertDescription) ' +
      'and `empty` (Empty, EmptyHeader, EmptyMedia, EmptyTitle), alongside `card`, `button`, ' +
      '`input`, `textarea`, `label`, `tabs` and `progress`. `empty` is load-bearing rather than ' +
      'cosmetic: the no-broadcasts state was a bare div whose only content was a decorative ' +
      'glyph and a sentence, with nothing tying them together for a screen reader. `alert` ' +
      'carries the send outcome — including a partial send, a non-US skip and a cap block — ' +
      'which was previously a silent div a reader was never told about. The ten inline styles ' +
      'are gone and the file spells zero. No primitive was edited.',
  },
  {
    file: 'src/components/settings/SmsSection.tsx',
    ticket: 'THE-320',
    why:
      'The number panel, composed in the same pass and inside the accordion THE-316 composed. ' +
      'It already held ONE primitive — the `button` THE-318 added for the KYC identity-check ' +
      'link — and this ticket EXTENDS that pattern rather than replacing it: that Button, its ' +
      'variant="link" and its base-ui render={<a/>} are untouched. It adds `alert` (Alert, ' +
      'AlertDescription), `card`, `input` and `label`. `alert` is load-bearing: the purchase ' +
      'outcome banner reports money being spent — a KYC 202 that charged nothing, a release ' +
      'that cannot be undone — and it was a plain div no screen reader announced. `card` is ' +
      'adopted here and REJECTED on the sibling screen, and the difference is measured rather ' +
      'than stylistic: both shells here are rounded-2xl, which twMerge resolves against the ' +
      "primitive's rounded-xl, while the sibling's rounded-brand-lg/-xl do not resolve at all.",
  },
  // 🔴 APPENDED BY THE-323, BESIDE EVERY ENTRY ABOVE — none of them replaces
  // another. THE-323 records PersonalInformationModal and nothing else.
  {
    file: 'src/components/PersonalInformationModal.tsx',
    ticket: 'THE-323',
    why:
      'The member profile modal, adopting exactly ONE primitive for exactly one reason. It takes ' +
      '`alert` (Alert, AlertTitle, AlertDescription) and nothing else, because THE-323 is not the ' +
      "visual pass for this file — that is split out, and THE-321 stopped on it. `alert` is here " +
      'because the ticket THE-323 does land is the silent failure in `handleSave`: both of its ' +
      'failure branches ended in console (one after handleFirestoreError, which logs and does not ' +
      'throw), so a refused write left the modal open with the typed values still in it and ' +
      'nothing on screen changed. It is LOAD-BEARING rather than cosmetic, and in the strictest ' +
      'sense: the state machine that replaces those console lines has nowhere to be seen without ' +
      'it, and role="alert" is what carries a refused write to a screen reader — the reader with ' +
      'the least chance of noticing that a modal simply did not close. The delete flow beside it ' +
      'renders its own eight outcomes and is UNTOUCHED to the byte, so it gains no primitive ' +
      'here; substituting one for that markup would be the visual pass, not this fix. No ' +
      'primitive was edited — their digests are pinned by ds-primitives.test.tsx and still match.',
  },
  {
    file: 'src/components/events/ServiceCreateForm.tsx',
    ticket: 'THE-329',
    why:
      'The form a church creates a service with, and the whole of THE-329: a name and a date, no ' +
      'event required. APPENDED, never substituted — no entry above was removed or rewritten to ' +
      'make room. Of this batch it adopts ONE primitive, `field` (Field, FieldLabel, ' +
      'FieldDescription), beside `button`, `card`, `input` and `select`, which are not this ' +
      "batch's. `field` is adopted rather than the bare `label` + `input` pair the rest of " +
      '`AdminEvents` spells, because this is a NEW form rather than an edit to an old one and ' +
      '`field` exists precisely to stop that pair being re-spelled — it carries the label to ' +
      'control association and the description slot without a hand-written `htmlFor` or a ' +
      "hand-rolled help line. 🔴 `calendar` IS REJECTED HERE, DELIBERATELY, and it is this " +
      "file's one interesting rejection: it is installed and THE-308 composed it, but it picks a " +
      'DAY and a service needs a day AND a clock time, because every time on the run sheet is ' +
      '`itemClockTimes(items, start)` — so it would need a second control beside it and the two ' +
      'reconciled into one value, where `input type="datetime-local"` is one control for one ' +
      'fact and is exactly how `AdminEvents.tsx` already spells the start of a dated thing. ' +
      '`dialog`, `sheet` and `collapsible` are rejected in the file with reasons (creating a ' +
      'service is this screen\'s PRIMARY act and must not be behind a layer or a disclosure), as ' +
      'are `textarea`, `checkbox`/`switch`, `dropdown-menu`, `button-group` and `tooltip`. No ' +
      'primitive was edited and no new one is installed.',
  },
  {
    file: 'src/components/events/RotaInviteView.tsx',
    ticket: 'THE-324',
    why:
      'The admin half of invite/accept/remind — the unfilled-slot warning and the two send ' +
      'actions. APPENDED, never substituted: no entry above was removed or rewritten to make ' +
      'room. It adds `empty` (Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription) and ' +
      '`item` (ItemGroup, Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions), ' +
      'beside `alert`, `badge`, `button`, `button-group`, `card`, `separator` and `skeleton`. ' +
      '`empty` is load-bearing rather than decorative: this screen must render the REASON a read ' +
      'could not be proved complete instead of the figure, because "no unfilled slots" when the ' +
      'read failed is the Form-submissions-0 bug and is indistinguishable from an answer. `item` ' +
      'is adopted where part 2 adopted `table` and the difference is the shape of the row: a rota ' +
      'grid compares the same columns across weeks, whereas each row here is one slot with one ' +
      'problem and one action, which on a 380px phone a four-column table could only scroll ' +
      'sideways to say. `table` and `progress` are both rejected in the file, with reasons.',
  },
  {
    file: 'src/components/events/RotaRespondView.tsx',
    ticket: 'THE-324',
    why:
      'The volunteer half — the public accept page a signed-out person lands on from a text ' +
      'message, and the answer to what part 2 deferred about a volunteer-facing view. APPENDED, ' +
      'never substituted. It adds `empty` (Empty, EmptyHeader, EmptyMedia, EmptyTitle, ' +
      'EmptyDescription) and `item` (ItemGroup, Item, ItemMedia, ItemContent, ItemTitle, ' +
      'ItemDescription, ItemActions) beside `alert`, `badge`, `button`, `button-group`, `card` ' +
      'and `separator`. `item` carries this person OWN other upcoming slots — never another ' +
      "member's, because a bearer token must reveal no more than its holder already knows — and " +
      '`empty` is what says "nothing else booked" rather than rendering a bare zero. `dialog` is ' +
      'rejected in the file for the decline confirmation: the action is one tap and fully ' +
      'reversible, and a modal would add a dismissal step to the only thing the page exists for.',
  },
  {
    file: 'src/components/AdminServices.tsx',
    ticket: 'THE-326',
    why:
      'The Service planning section — the dedicated home the founder asked for, holding the run ' +
      'sheet, the volunteer rota and the invitations, which used to be buried inside Events. ' +
      'APPENDED, never substituted. It adopts `empty` (Empty, EmptyHeader, EmptyMedia, ' +
      'EmptyTitle, EmptyDescription) beside `card`, `select` and `tabs`. `tabs` names the three ' +
      'parts and is the one primitive the screen is built around; `select` picks which dated ' +
      'service the run sheet is for, and its trigger formats the value through `fmtDay` rather ' +
      'than printing the raw id — the same defect THE-326 fixes on the rota. `empty` is what ' +
      'says "no dated services yet" instead of an empty picker that reads as a broken screen. ' +
      'REJECTED, per element and with the reason: `table` (the three panels bring their own, ' +
      'and a sixth `table` adopter would need THE-272\'s closed list opened for markup this ' +
      'file does not draw); `dialog` and `sheet` (nothing here is modal — the picker is a ' +
      'control on the page); `separator` (the tab strip and the cards already divide the ' +
      'screen, so a rule would be a second divider over the first); `skeleton` (the panels own ' +
      'their own loading states and this screen renders nothing of its own while events load); ' +
      '`button` (the screen has no action of its own — every control belongs to a panel).',
  },
  {
    file: 'src/components/events/EventMonthView.tsx',
    ticket: 'THE-308',
    why:
      'The events month grid — the gap card 86bbr7n9c recorded as "Calendar → it is Events, no ' +
      'month grid". APPENDED, never substituted. It adopts `calendar` (Calendar, ' +
      'CalendarDayButton) and `empty`, beside `badge`, `button`, `card`, `item` and `skeleton`. ' +
      '`calendar` is the load-bearing one and the reason this ticket needed no registry block at ' +
      'all: it IS react-day-picker, so the primitive already emits the <table role="grid"> with ' +
      'column headers, roving focus and arrow-key navigation that a hand-built seven-column grid ' +
      'would have had to reimplement and would not have carried. The day cell EXTENDS ' +
      'CalendarDayButton rather than replacing it — the primitive is already laid out flex-col ' +
      'with [&>span]:text-xs, so an event count is a second line it was built to take. ' +
      '`popover` is rejected in the file with its reason: the anchor would be a 44px cell a ' +
      'thumb covers, it would overlay the neighbouring days a reader is comparing, and it ' +
      'evaporates on the next tap. The persistent day panel below the grid is used instead. ' +
      'The block this ticket was written around, shadcnspace calendar-application-01, is ' +
      'paywalled (403 "License required") and was never installed — so no primitive was ' +
      'rewritten, and all 18 the block depended on are pinned byte-identical in the-308-guards.',
  },
  {
    file: 'src/components/attach/AttachMenu.tsx',
    ticket: 'THE-331',
    why:
      'The attach picker. The paperclip used to open a hand-rolled sheet — `fixed inset-0 ' +
      'z-[300] flex items-end` with NO `sm:` override, so a phone sheet spanned a 1920px ' +
      'desktop edge to edge (measured: 1920px wide, bottom-pinned; now 464px and centred). ' +
      'It is a menu now, so `dropdown-menu` carries the four category submenus and their ' +
      'flyouts, and there is no full-width surface left to mis-place. `alert` is load-bearing ' +
      'rather than cosmetic: a rejected Firestore read used to answer `setItems([])` and then ' +
      'print "No docs yet", so a church that could not READ its contacts was told it HAD none ' +
      '— the loader now returns a discriminated union and this renders the failure branch. ' +
      '`empty` draws the genuinely-empty case, which is a different state and now looks like ' +
      'one. `spinner` replaces a hand-spun div with a hardcoded #d4a017 border, `dialog` ' +
      'carries the Browse… surface and `button` the trigger. `sheet` is REJECTED: the whole ' +
      'point is that this stopped being a sheet above `sm`. `command` is REJECTED with its ' +
      'reason at the call site — it is a flat searchable list with no hierarchy, and the ' +
      'founder chose c-cascader-3 for deep search that crosses all four collections and ' +
      'annotates each hit with the category it came from, which a flat list cannot express.',
  },
  {
    file: 'src/components/layout/nav-rail.tsx',
    ticket: 'THE-332',
    why:
      'The desktop admin nav rail\'s flyout. The sidebar rendered all 23 permitted tabs at ' +
      'once in a 232px scrolling column; it is now a 88px rail of six entries whose four ' +
      'group entries open a flyout. `popover` carries that flyout, and it is load-bearing ' +
      'rather than decorative: this repo\'s primitives are BASE UI, whose Popover already ' +
      'ships every part the founder asked for — `openOnHover` on the trigger gives hover, ' +
      'the trigger is a real <button> so Enter/Space open it and focus moves into the popup ' +
      'and returns on Escape, and `onOpenChange` reports WHY it opened ("trigger-press" vs ' +
      '"trigger-hover"), which is what lets a CLICK pin a flyout that a hover would close. ' +
      'The founder asked for both, and "both" is otherwise a pile of hand-rolled pointer ' +
      'listeners. `hover-card` is REJECTED with its reason at the call site: it has no press ' +
      'semantics and therefore nothing to pin, and it is documented for non-interactive ' +
      'preview content while these flyouts are the ONLY way to reach 21 of the 23 tabs. ' +
      '`dropdown-menu` is REJECTED because its items are `menuitem`s with roving focus and ' +
      'typeahead, which would swallow single-letter keys and give nav destinations menu ' +
      'semantics they do not have, and it closes on pointer-leave with no pin. `tooltip` is ' +
      'REJECTED because it is non-interactive by role — which is precisely the defect being ' +
      'fixed, since "collapsed" used to mean a `title` attribute no keyboard could open.',
  },
  {
    file: 'src/components/Onboarding.tsx',
    ticket: 'THE-336',
    why:
      'The member onboarding funnel. Its last step rejected with `No document to update: ' +
      '…/users/<uid>` — an account could not be finished at all — and that message reached ' +
      'the member through hand-written markup: a div carrying three bare hex literals and NO ' +
      '`role`, so a refused write was announced to nobody. `alert` is load-bearing rather ' +
      'than cosmetic and is the same adoption THE-321 made one screen over in ' +
      '`PersonalInformationModal`: its `role="alert"` is what carries a refused write to a ' +
      'screen reader, who is the reader least likely to notice that a Finish button simply ' +
      'did nothing, and it paints from `bg-card`/`text-destructive` so both palettes ' +
      'resolve it. It renders the save-failure state of a saveState machine, above the first ' +
      'field, so the message and the answers it failed to write are on screen together. ' +
      '`empty` is REJECTED: it announces an absent list, and this is a write that was ' +
      'refused, not a collection that is empty. `sonner` is REJECTED: a toast leaves the ' +
      'screen while the thing it described is still broken, and this message has to stay ' +
      'beside the answers the member must retry from. `dialog` is REJECTED: a second modal ' +
      'over a full-screen funnel step would cover the very fields the retry needs. ' +
      '`ui/card` was NOT adopted — the funnel already has its own cream shell, and swapping ' +
      'it would be a visual pass this fix has no business making.',
  },
];

it('only the recorded adopters import the new components, and each names its ticket', () => {
  const names = NEW_PRIMITIVES.map((f) => f.replace(/\.tsx$/, '')).join('|');
  const re = new RegExp(`@/components/ui/(${names})\\b`);
  const importers = walkFiles(path.join(REPO_ROOT, 'src'), (d) => d === 'node_modules')
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => {
      if (f.startsWith(UI_DIR) || f.startsWith(REUI_DIR)) return false;
      if (f.includes(`${path.sep}__tests__${path.sep}`)) return false;
      return re.test(readFileSync(f, 'utf8'));
    });
  expect(importers.map((f) => rel(f)).sort())
    .toEqual(RECORDED_ADOPTERS.map((a) => a.file).sort());

  // An entry that no longer adopts has to come out, so the list cannot outlive
  // what it records — the same shape as EDITED_SINCE_MEASUREMENT elsewhere.
  for (const { file, why } of RECORDED_ADOPTERS) {
    expect(re.test(readFileSync(path.join(REPO_ROOT, file), 'utf8')),
      `${file} is recorded as an adopter but imports none of the new primitives`).toBe(true);
    expect(why.length, `${file} is recorded without a stated reason`).toBeGreaterThan(80);
  }
});

it('and nothing outside the three primitives imports the three new runtime packages', () => {
  // The bundle consequence of this PR is zero precisely because of this: a file
  // no route reaches is in no chunk. Phase 8 is where cmdk, react-day-picker
  // and react-resizable-panels start costing anything.
  const owners: Record<string, string> = {
    cmdk: 'src/components/ui/command.tsx',
    'react-day-picker': 'src/components/ui/calendar.tsx',
    'react-resizable-panels': 'src/components/ui/resizable.tsx',
  };
  for (const [packageName, owner] of Object.entries(owners)) {
    const importers = walkFiles(path.join(REPO_ROOT, 'src'), (d) => d === 'node_modules')
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => {
        if (f.includes(`${path.sep}__tests__${path.sep}`)) return false;
        return new RegExp(`from ["']${packageName}["']`).test(readFileSync(f, 'utf8'));
      });
    expect(importers.map((f) => rel(f)), `${packageName} is imported outside ${owner}`).toEqual([
      owner,
    ]);
  }
});

/* ── 9. The dependencies ─────────────────────────────────────────────────── */

describe('the new dependencies are declared, pinned and resolvable', () => {
  for (const [name, { range, version }] of Object.entries(NEW_DEPENDENCIES)) {
    it(`${name} is declared as ${range} and locked at ${version}`, () => {
      expect(pkg().dependencies[name], `${name} is not a production dependency`).toBe(range);
      expect(lock().packages[`node_modules/${name}`]?.version, `${name} is not locked`).toBe(
        version,
      );
    });

    it(`${name} actually resolves at ${version}`, () => {
      const manifest = path.join(REPO_ROOT, 'node_modules', name, 'package.json');
      expect(existsSync(manifest), `${name} is not installed`).toBe(true);
      expect(JSON.parse(readFileSync(manifest, 'utf8')).version).toBe(version);
    });
  }

  it('react-day-picker is pinned EXACTLY, because the registry declares it @latest', () => {
    // The registry entry for `calendar` asks for `react-day-picker@latest`.
    // A caret would have left this tree following a moving target on the next
    // install; the founder's decision was to pin it.
    expect(pkg().dependencies['react-day-picker']).toBe('10.0.1');
    expect(pkg().dependencies['react-day-picker']).not.toMatch(/^[\^~]/);
  });

  it('all four are production dependencies, not dev', () => {
    for (const name of Object.keys(NEW_DEPENDENCIES)) {
      expect(pkg().devDependencies?.[name], `${name} landed in devDependencies`).toBeUndefined();
      expect(lock().packages[`node_modules/${name}`]?.dev).not.toBe(true);
    }
  });

  it('every one of them supports React 18 — the version this app is on', () => {
    expect(pkg().dependencies.react).toBe('^18.3.1');
    for (const name of Object.keys(NEW_DEPENDENCIES)) {
      const manifest = JSON.parse(
        readFileSync(path.join(REPO_ROOT, 'node_modules', name, 'package.json'), 'utf8'),
      );
      const peer: string | undefined = manifest.peerDependencies?.react;
      if (!peer) continue;
      expect(
        /18/.test(peer) || /">=1[0-8]/.test(peer) || peer.includes('>=16'),
        `${name} peer-requires react ${peer}, which does not admit 18`,
      ).toBe(true);
    }
  });

  /**
   * The tree this PR started from, as one digest.
   *
   * ⚠️ A digest rather than a checked-in copy of the lockfile: the before-tree
   * is 1803 entries and 126 KB, and none of it is interesting except that it
   * did not move. Removing the 22 known additions from the CURRENT lockfile
   * must reproduce it exactly — which is a strictly stronger claim than
   * THE-272's `toContain` list, because it also fails on an addition nobody
   * expected, on a removal, and on any version of any other package moving.
   */
  const LOCK_BEFORE_COUNT = 1803;
  const LOCK_BEFORE_SHA = '972a91d30109a8ab87882e3c9b46fcbb51f5ef36425e36203d93e2daa4ce9f2c';

  /**
   * ⚠️ Seventeen of these are the Radix subtree cmdk reaches through
   * @radix-ui/react-dialog — NESTED under it rather than hoisted, because
   * @excalidraw/excalidraw already holds different versions at the top level.
   * Radix was ALREADY in this tree (48 entries before this PR): cmdk does not
   * introduce a second headless-UI library, it deepens one that was there.
   */
  const LOCK_ADDED = [
    '@date-fns/tz',
    '@radix-ui/react-dialog',
    '@radix-ui/react-dialog/node_modules/@radix-ui/primitive',
    '@radix-ui/react-dialog/node_modules/@radix-ui/react-compose-refs',
    '@radix-ui/react-dialog/node_modules/@radix-ui/react-context',
    '@radix-ui/react-dialog/node_modules/@radix-ui/react-dismissable-layer',
    '@radix-ui/react-dialog/node_modules/@radix-ui/react-focus-guards',
    '@radix-ui/react-dialog/node_modules/@radix-ui/react-focus-scope',
    '@radix-ui/react-dialog/node_modules/@radix-ui/react-id',
    '@radix-ui/react-dialog/node_modules/@radix-ui/react-portal',
    '@radix-ui/react-dialog/node_modules/@radix-ui/react-presence',
    '@radix-ui/react-dialog/node_modules/@radix-ui/react-primitive',
    '@radix-ui/react-dialog/node_modules/@radix-ui/react-slot',
    '@radix-ui/react-dialog/node_modules/@radix-ui/react-use-callback-ref',
    '@radix-ui/react-dialog/node_modules/@radix-ui/react-use-controllable-state',
    '@radix-ui/react-dialog/node_modules/@radix-ui/react-use-layout-effect',
    '@radix-ui/react-use-effect-event',
    '@radix-ui/react-use-effect-event/node_modules/@radix-ui/react-use-layout-effect',
    'cmdk',
    'date-fns',
    'react-day-picker',
    'react-resizable-panels',
  ].map((k) => `node_modules/${k}`);

  it('the lockfile gained exactly these 22 entries', () => {
    const after = Object.keys(lock().packages).filter(Boolean);
    for (const key of LOCK_ADDED) {
      expect(after, `${key} is missing from the lockfile`).toContain(key);
    }
    expect(after).toHaveLength(LOCK_BEFORE_COUNT + LOCK_ADDED.length);
  });

  it('and nothing else moved — the rest of the tree digests to what it was', () => {
    // Removing the 22 above from the current lockfile must reproduce the
    // before-tree exactly: same keys, same versions, nothing removed. "Do not
    // move any existing token's value" has a dependency analogue, and this is
    // it.
    const packages = lock().packages;
    const added = new Set(LOCK_ADDED);
    const rest = Object.entries(packages)
      .filter(([k]) => k && !added.has(k))
      .map(([k, v]) => `${k}@${v.version ?? ''}`)
      .sort();
    expect(rest).toHaveLength(LOCK_BEFORE_COUNT);
    expect(sha256(rest.join('\n'))).toBe(LOCK_BEFORE_SHA);
  });
});

/* ── 10. Out-of-scope files ──────────────────────────────────────────────── */

describe('the out-of-scope files are untouched', () => {
  it('tailwind.config.ts keeps its pinned code digest', () => {
    const config = readFileSync(TAILWIND_CONFIG, 'utf8');
    const code = config
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/[^\n]*/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    expect(sha256(code)).toBe(TAILWIND_CODE_SHA);
  });

  it('layout.tsx is byte-identical — the CLI’s provider advice was ignored again', () => {
    expect(sha256(readFileSync(LAYOUT, 'utf8'))).toBe(LAYOUT_SHA);
  });

  it('firestore.rules is byte-identical', () => {
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
  });

  it('functions/ carries no change from this PR', () => {
    // ⚠️ Keys are built with POSIX separators explicitly rather than taking
    // path.relative's output as-is: on Windows that yields backslashes and the
    // comparison fails for a reason that has nothing to do with the code.
    const actual = Object.fromEntries(
      walkFiles(path.join(REPO_ROOT, 'functions'), (d) => d === 'node_modules' || d === 'lib')
        .sort()
        .map((f) => [
          path.relative(REPO_ROOT, f).split(path.sep).join('/'),
          sha256(readFileSync(f, 'utf8')).slice(0, 16),
        ]),
    );
    expect(actual).toEqual(FUNCTIONS_DIGESTS);
  });

  it('components.json is untouched — the CLI wanted nothing from it', () => {
    const cfg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'components.json'), 'utf8'));
    expect(cfg.style).toBe('base-nova');
    expect(cfg.iconLibrary).toBe('lucide');
    expect(cfg.tailwind.css).toBe('src/app/globals.css');
    expect(cfg.registries).toEqual({});
  });
});

/* ── 11. What the CLI wrote, and what it did not ─────────────────────────── */

describe('the twenty-one files are the registry’s, transformed for this repo', () => {
  it('no file kept the registry’s own import paths', () => {
    // The CLI rewrites `@/registry/base-nova/ui/x` → `@/components/ui/x` and
    // `@/registry/base-nova/lib/utils` → `@/lib/utils`. A survivor would not
    // resolve and typecheck would fail, but it fails here first, by name.
    for (const file of NEW_PRIMITIVES) {
      const src = readFileSync(path.join(UI_DIR, file), 'utf8');
      expect(src, `${file} kept a @/registry path`).not.toContain('@/registry/');
    }
  });

  it('the five that shipped an icon placeholder had it resolved to lucide', () => {
    // calendar, checkbox, command, context-menu and spinner each import
    // `IconPlaceholder` from `@/app/(create)/components/icon-placeholder` in the
    // registry payload — a path that does not exist in this repo. components.json
    // sets iconLibrary: "lucide", and the CLI substitutes the real icon.
    for (const file of ['calendar.tsx', 'checkbox.tsx', 'command.tsx', 'context-menu.tsx', 'spinner.tsx']) {
      const src = readFileSync(path.join(UI_DIR, file), 'utf8');
      expect(src, `${file} kept the icon placeholder`).not.toContain('IconPlaceholder');
      expect(src, `${file} kept the (create) path`).not.toContain('(create)');
      expect(src, `${file} did not gain a lucide import`).toContain('lucide-react');
    }
  });
});

/* ── 12. date-picker ─────────────────────────────────────────────────────── */

describe('date-picker is a composition, not a registry item', () => {
  it('no date-picker primitive was written, because there is no such registry item', () => {
    // `https://ui.shadcn.com/r/styles/base-nova/date-picker.json` is a 404 —
    // the same shape THE-272 found for `data-table`. It is composed from
    // `calendar` + `popover` where it is used, and nothing was hand-written
    // here to stand in for it.
    expect(existsSync(path.join(UI_DIR, 'date-picker.tsx'))).toBe(false);
    expect(readdirSync(UI_DIR).filter((f) => /date-?picker/i.test(f))).toEqual([]);
  });

  it('but both halves it composes from are installed', () => {
    expect(existsSync(path.join(UI_DIR, 'calendar.tsx'))).toBe(true);
    expect(existsSync(path.join(UI_DIR, 'popover.tsx'))).toBe(true);
  });
});

/* ── 13. THE-338 — the family axis is gone ───────────────────────────────── */

it('the palette family axis is gone (THE-338)', async () => {
  // 🔴 INVERTED, not deleted. This pinned #409's guarantee that the ticket had
  // not disturbed WHICH family a user with no stored preference rendered in.
  // THE-338 removed the axis entirely, so the property worth keeping is that
  // it stayed removed — a re-introduced constant fails here.
  const theme = await import('../lib/theme');
  expect('DEFAULT_PALETTE_FAMILY' in theme).toBe(false);
  expect('PALETTE_FAMILIES' in theme).toBe(false);
});

/* ── 14. The extractor still reads what it always read ───────────────────── */

it('the extractor still reads cva variants and still ignores comparands', () => {
  // THE-272's fix and THE-270's reader are both load-bearing for the 21 files
  // above; this PR changed the same function, so both are re-asserted here.
  const alert = extractClassNames(path.join(UI_DIR, 'alert.tsx'));
  expect(alert).toContain('bg-card');
  expect(alert).toContain('text-destructive');
  // cva variant KEYS are not classes.
  expect(alert).not.toContain('default');
  expect(alert).not.toContain('destructive');
});
