import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
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
  extractClassNames,
  extractInlineCustomProperties,
  EXEMPT,
  NOT_A_UTILITY,
  SET_AT_RUNTIME,
  SET_BY_NEXT_FONT,
  rel,
} from '../components/ui/__tests__/ds-primitives.audit';
import { rulesDigestFailure } from './__fixtures__/firestore-rules-pin';

/**
 * THE-270 — shadcn Phase 7: install `sidebar`.
 *
 * `sidebar` is the component THE-266's four (tooltip, skeleton, collapsible,
 * breadcrumb) were the registry dependencies OF, and the one THE-267 (#412)
 * mapped eight tokens for. It unblocks `sidebar-07` (the admin and member
 * shells) and `sidebar-11` (the Obsidian notes tree). This PR installs it and
 * wires it into NOTHING — a component imported by nothing is the correct end
 * state; adoption is Phase 8.
 *
 * ── What the install actually did ───────────────────────────────────────
 *
 *   npx shadcn@4.11.0 add sidebar
 *   ✔ Created 2 files:  src/hooks/use-mobile.ts   src/components/ui/sidebar.tsx
 *   ℹ Skipped 6 files:  button, input, separator, skeleton, tooltip, sheet
 *
 * Six of `sidebar`'s seven registry dependencies already existed here and are
 * digest-pinned across several suites. `--overwrite` defaults to false and
 * there is no separate skip flag — its ABSENCE is the skip — and the CLI
 * content-compares before it would even prompt. Section 3 does not take the
 * CLI's word for it: it re-checks all twenty-one against digests spelled as
 * literals.
 *
 * globals.css, tailwind.config.ts, components.json, layout.tsx, package.json
 * and package-lock.json were not touched. ZERO new tokens and ZERO new npm
 * packages, which is the headline: #412 had already done the token work, and
 * `sidebar`'s registry entry declares no `dependencies`, `cssVars`, `css` or
 * `tailwind` block at all.
 *
 * ── The ten unresolved classes, and why none was a missing token ─────────
 *
 * The guard reported ten findings on first run. The ticket predicted they
 * would be missing `--sidebar*` tokens. Not one of them was — every one of
 * THE-267's eight resolves. They were three different things:
 *
 *   • SEVEN naming a property sidebar.tsx SETS ON ITSELF as an inline style
 *     (`--sidebar-width`, `--sidebar-width-icon`, `--skeleton-width`). THE-267
 *     pinned that the widths must never become tokens — they are React
 *     constants the component owns. `undefined-var` was simply the wrong
 *     answer, so the audit now reads the component's own `style={{ … }}`.
 *     See extractInlineCustomProperties, and section 10, which proves the
 *     reading did not blunt the guard.
 *   • TWO that are not classes at all: `floating` and `inset`, the operands of
 *     `variant === "floating" || variant === "inset"` (sidebar.tsx:224, :235).
 *     Fixed in the extractor, not by an exemption list.
 *   • ONE genuinely dead class: `no-scrollbar`, ui.shadcn.com's own site
 *     utility, which nothing here defines. Held in NOT_A_UTILITY with that
 *     stated, and recorded in section 10 so Phase 8 knows SidebarContent will
 *     paint a visible scrollbar until someone decides otherwise.
 *
 * ⚠️ NOTHING was added to SET_AT_RUNTIME by this PR, and one entry LEFT it.
 * #416 had exempted chart.tsx's `bg-(--color-bg)` by name; reading inline
 * styles made that entry redundant, `holds back no stale exemption` said so,
 * and it was removed. Section 10 asserts both halves — the list is the Base UI
 * three again, and chart.tsx is exactly as quiet as it was before.
 */

const sha256 = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');

const UI_DIR = path.join(REPO_ROOT, 'src/components/ui');
const HOOKS_DIR = path.join(REPO_ROOT, 'src/hooks');
const FIXTURES = path.join(UI_DIR, '__tests__/__fixtures__');
const SIDEBAR = path.join(UI_DIR, 'sidebar.tsx');
const USE_MOBILE = path.join(HOOKS_DIR, 'use-mobile.ts');
const LAYOUT = path.join(REPO_ROOT, 'src/app/layout.tsx');

/**
 * The twenty-one that existed before, with the digests THE-266 recorded at
 * 6aceb0e / f2c594a and THE-272 (#416) recorded at 19f4e13.
 *
 * ⚠️ Spelled as literals rather than read from primitive-digests.json. That
 * fixture is re-recorded by this PR — it has to be, it gains sidebar.tsx — so
 * a test comparing it against itself would pass no matter what the CLI had
 * done to button.tsx. This is the same reasoning THE-266 wrote down for its
 * own thirteen, extended to the four it added and the four #416 added.
 *
 * ⚠️ This PR was rebased onto #416 and #415. The four Batch B names below
 * arrived with #416, not with `shadcn add sidebar`; they are pinned here for
 * the same reason as the rest — `sidebar` names `button` and `input` among its
 * registry dependencies, and a rebase must not be the moment any of the
 * twenty-one quietly moves.
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
  'skeleton.tsx': '8110bba70d0cb9fe968c0b7bd092ad12258caef40b028b4a87f402bdab907faf',
  'sonner.tsx': 'f76ee6fb6aa5892bdc1c92b8b282a59f34b63f3fa2ab01475df4a61988f0014b',
  'table.tsx': 'a13f55a7c1406197608f223006cf16f211a257b213362caaef0d2abf3a389c8f',
  'tabs.tsx': '8bf9ee3935ab86c268a2a71cb5b4b67d3d5587ca9f2e0bf25f37ffdb1980434c',
  'tooltip.tsx': '2cea2294d4947b88d815860f64e0b5e0eb47a59bde47cfd194aac2230c923865',
};

/** The six `sidebar` names as registry dependencies — the ones at risk. */
const REGISTRY_DEPENDENCIES = [
  'button.tsx',
  'input.tsx',
  'separator.tsx',
  'sheet.tsx',
  'skeleton.tsx',
  'tooltip.tsx',
] as const;

/** The five hooks that existed before use-mobile. */
const PRE_EXISTING_HOOKS = [
  'useCapacitorPush.ts',
  'useClaimsFreshness.ts',
  'useLiveNow.ts',
  'usePlanGate.ts',
  'useTenantCapability.ts',
] as const;

/** As of 767ca9b. None is this PR's business; all are asserted in section 9. */
const LAYOUT_SHA = 'b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f';
const GLOBALS_SHA = '1fd6001c2d3bddc50a45b02ce1253b6b60802699fb33fa159f5ed42b8aeb9957';
const COMPONENTS_JSON_SHA = '5102c25c44791f19be9a94380f85f6e78934feccbfce7fe9ec54c316e99a76b4';
/** main's, as of 5b780e8 — proves this PR adds no dependency. */
/**
 * ⚠️ WAS a sha256 of package.json, standing in for "this PR adds no dependency
 * of ANY name". THE-273 has since REMOVED one (next-themes, once sonner.tsx
 * stopped importing it), so a byte digest can no longer make that claim — it
 * would only say "package.json is whatever it is today", and would move again
 * on a reformat or a version bump that adds nothing.
 *
 * So the claim is asserted directly instead, and more sharply than the digest
 * managed: the dependency NAMES as of main (bb514cd), across both fields. An
 * added name fails; a removed name fails unless it is listed below; a version
 * bump or a whitespace change does not, because neither was ever the point.
 */
const MAIN_DEPENDENCY_NAMES: readonly string[] = [
    '@aws-sdk/client-s3',
    '@aws-sdk/s3-request-presigner',
    '@base-ui/react',
    '@capacitor/cli',
    '@capacitor/core',
    '@capacitor/push-notifications',
    '@composio/core',
    '@dnd-kit/core',
    '@dnd-kit/sortable',
    '@dnd-kit/utilities',
    '@excalidraw/excalidraw',
    '@firebase/rules-unit-testing',
    '@google/genai',
    '@marsidev/react-turnstile',
    '@sentry/nextjs',
    '@tailwindcss/postcss',
    '@tailwindcss/typography',
    '@tanstack/react-query',
    '@tanstack/react-query-devtools',
    '@testing-library/jest-dom',
    '@testing-library/react',
    '@testing-library/user-event',
    '@tiptap/extension-image',
    '@tiptap/extension-link',
    '@tiptap/extension-placeholder',
    '@tiptap/extension-text-align',
    '@tiptap/extension-underline',
    '@tiptap/pm',
    '@tiptap/react',
    '@tiptap/starter-kit',
    '@tiptap/suggestion',
    '@types/dompurify',
    '@types/leaflet',
    '@types/node',
    '@types/qrcode',
    '@types/react',
    '@types/react-dom',
    '@types/sanitize-html',
    '@upstash/ratelimit',
    '@upstash/redis',
    '@vercel/analytics',
    '@vitejs/plugin-react',
    'class-variance-authority',
    'clsx',
    'country-state-city',
    'docx',
    'dodopayments',
    'dompurify',
    'eslint',
    'eslint-config-next',
    'firebase',
    'firebase-admin',
    'geist',
    'happy-dom',
    'leaflet',
    'libphonenumber-js',
    'lucide-react',
    'motion',
    'next',
    'next-pwa',
    'next-themes',
    'pdf-lib',
    'postcss',
    'posthog-js',
    'qrcode',
    'react',
    'react-dom',
    'react-google-autocomplete',
    'react-leaflet',
    'react-markdown',
    'react-player',
    'react-router-dom',
    'recharts',
    'resend',
    'sanitize-html',
    'shadcn',
    'sonner',
    'standardwebhooks',
    'stripe',
    'tailwind-merge',
    'tailwindcss',
    'tw-animate-css',
    'typescript',
    'unpdf',
    'vitest',
    'zustand',
];

/** The only names allowed to be missing from the list above, each with the
 *  ticket that removed it. */
const REMOVED_SINCE_MAIN: readonly string[] = [
  'next-themes', // THE-273 — sonner.tsx was its last importer and no longer imports it
];

/** Its mirror: the only names allowed to be ADDED to it, each with its ticket.
 *  THE-274 installed Batches C/D/E; three of its twenty-one components import a
 *  package this app did not have. Named here rather than the assertion below
 *  being loosened, so the next addition still has to come back and say so. */
const ADDED_SINCE_MAIN: readonly string[] = [
  'cmdk', // THE-274 — command.tsx
  'date-fns', // THE-274 — react-day-picker's peer, reached by calendar.tsx
  'react-day-picker', // THE-274 — calendar.tsx
  'react-resizable-panels', // THE-274 — resizable.tsx
];
const TAILWIND_CODE_SHA = '491ebb5575d16eddfab00c6ed89900c725141b412e410e9e97342ff2108b2904';
const FUNCTIONS_TREE_SHA = '0acf97d60a6d5066680d7e7fe24ef1ce900bac0a274332942d570c259e0dddb9';

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
 * walkDecls over the whole root, NOT walkRules: the `--color-*` half of the
 * bridge lives inside `@theme inline`, which is an at-rule, and a rules-only
 * walk misses it while still returning a plausible-looking ledger. A
 * `--sidebar-width` added inside `@theme inline` has to trip section 5 too.
 */
const allDeclaredTokens = (): string[] => {
  const names = new Set<string>();
  postcss.parse(readFileSync(GLOBALS_CSS, 'utf8')).walkDecls((d) => {
    if (d.prop.startsWith('--')) names.add(d.prop);
  });
  return [...names].sort();
};

/** Every .ts/.tsx under `dir`, repo-relative and slash-separated. */
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });

/**
 * Every .ts/.tsx under src that is not itself a test.
 *
 * The `__tests__` exclusion is not cosmetic: this very file spells
 * `@/hooks/use-mobile` and the name `useIsMobile` in order to assert things
 * about them, so a sweep that included tests would report itself as an
 * importer and as a duplicate implementation.
 */
const productionFiles = (): string[] =>
  walk(path.join(REPO_ROOT, 'src')).filter((f) => !f.includes(`${path.sep}__tests__${path.sep}`));

/** A throwaway primitive on disk. The audit reads files; so do these tests. */
function fixturePrimitive(body: string, name = 'fixture.tsx'): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'the-270-'));
  const file = path.join(dir, name);
  writeFileSync(file, body, 'utf8');
  return file;
}

let decls: Decls;
let audit: Awaited<ReturnType<typeof auditPrimitives>>;
let borderCss: string;

beforeAll(async () => {
  decls = declarationsBySelector(readFileSync(GLOBALS_CSS, 'utf8'));
  audit = await auditPrimitives(
    readdirSync(UI_DIR)
      .filter((f) => f.endsWith('.tsx'))
      .sort()
      .map((f) => path.join(UI_DIR, f)),
  );
  borderCss = await buildCssForMarkup(
    '<div class="border-strong border-faint border-subtle border-hairline"></div>',
  );
}, 180_000);

/* ── 0. The resolver is pointed at real blocks ───────────────────────────── */

it('every palette selector this file names actually exists in globals.css', () => {
  // Not ceremony: a mistyped selector does not throw, it falls through to
  // :root, so "harvest dark" would silently report the LIGHT palette and every
  // value in section 6 would be pinned against the wrong block.
  for (const [palette, chain] of Object.entries(PALETTES)) {
    for (const sel of chain) {
      expect(decls.has(sel), `${palette} names a selector not in globals.css: ${sel}`).toBe(true);
    }
  }
});

/* ── 1. The guard, named ─────────────────────────────────────────────────── */

describe("sidebar's token classes all resolve", () => {
  it('sidebar.tsx spells no class that resolves to nothing', () => {
    const mine = audit.findings.filter((f) => rel(f.file) === rel(SIDEBAR));
    expect(mine, `sidebar.tsx has unresolved classes: ${JSON.stringify(mine)}`).toEqual([]);
  });

  it('and the audit as a whole is clean', () => {
    expect(audit.findings).toEqual([]);
  });

  it('the guard really opened sidebar.tsx, and pulled real classes out of it', () => {
    // The failure mode THE-266's section 10 names: a suite that goes green
    // because it looked at nothing. 43 files after THE-274 installed Batches
    // C, D and E, and sidebar.tsx is still the largest primitive in the
    // directory by class count.
    expect(audit.classesByFile.size).toBe(43);
    const basenames = [...audit.classesByFile.keys()].map((f) => path.basename(f));
    expect(basenames).toContain('sidebar.tsx');
    const counts = Object.fromEntries(
      [...audit.classesByFile].map(([f, c]) => [path.basename(f), c.length]),
    );
    expect(counts['sidebar.tsx']).toBe(167);
  });

  it('and it really does reach for the sidebar family — 25 of its classes name one', () => {
    // Non-vacuity for the claim above. "Nothing unresolved" would also be true
    // of a component that spelled no sidebar utility at all, which is what
    // THE-266's four did. This asserts the family is genuinely exercised.
    const sidebarClasses = (audit.classesByFile.get(SIDEBAR) ?? []).filter((c) =>
      /sidebar/.test(c),
    );
    expect(sidebarClasses.length).toBe(30);
    for (const cls of ['bg-sidebar', 'text-sidebar-foreground', 'ring-sidebar-ring']) {
      expect(sidebarClasses, `sidebar.tsx no longer spells ${cls}`).toContain(cls);
    }
  });

  it('and the only --sidebar properties it names by hand are the two tokens and the two widths', () => {
    // Read off the source, not the class list, so an arbitrary-value spelling
    // like `shadow-[0_0_0_1px_var(--sidebar-border)]` is covered too. A NINTH
    // family member arriving in a component would show up here first.
    const named = [...new Set([...readFileSync(SIDEBAR, 'utf8').matchAll(/--sidebar[a-z-]*/g)].map((m) => m[0]))].sort();
    expect(named).toEqual([
      '--sidebar-accent',
      '--sidebar-border',
      '--sidebar-width',
      '--sidebar-width-icon',
    ]);
  });
});

/* ── 2. The fixture stays empty ──────────────────────────────────────────── */

it('the unresolved fixture is still empty', () => {
  const p = path.join(FIXTURES, 'unresolved-token-classes.txt');
  expect(readFileSync(p, 'utf8')).toBe('');
  expect(statSync(p).size).toBe(0);
});

/* ── 3. The CLI rewrote nothing it should not have ───────────────────────── */

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

describe('all 21 pre-existing primitives are byte-identical', () => {
  it('every one of the 21 still hashes to its recorded digest, bar the two THE-273 and THE-276-FIX fixed', () => {
    const actual = Object.fromEntries(
      Object.keys(PRE_EXISTING_DIGESTS).map((f) => [
        f,
        sha256(readFileSync(path.join(UI_DIR, f), 'utf8')),
      ]),
    );
    expect(actual).toEqual({ ...PRE_EXISTING_DIGESTS, ...MOVED_SINCE });
  });

  it('and the six that are sidebar’s own registry dependencies are named individually', () => {
    // These six are the ones `npx shadcn add sidebar` re-resolves and would
    // have rewritten with --overwrite. Called out by name so a failure says
    // WHICH dependency the CLI touched rather than "one of seventeen".
    // sheet.tsx is compared against the MOVED_SINCE overlay for the same
    // reason the assertion above uses it: THE-295 raised its z-index
    // deliberately, long after this install. The claim here is about the CLI,
    // and it is unweakened — the file still has to match a digest named in
    // this repo with a ticket and a reason, not whatever it happens to hold.
    const expected = { ...PRE_EXISTING_DIGESTS, ...MOVED_SINCE };
    for (const file of REGISTRY_DEPENDENCIES) {
      expect(
        sha256(readFileSync(path.join(UI_DIR, file), 'utf8')),
        `the CLI rewrote ${file}, a registry dependency of sidebar`,
      ).toBe(expected[file]);
    }
  });

  it('src/components/ui holds exactly those 21 plus sidebar.tsx, plus THE-274’s 21', () => {
    // THE-274 installed Batches C, D and E in one pass: nineteen named by that
    // ticket, plus `popover` (which it asked for) and `toggle` (a registry
    // dependency of `toggle-group`). Named rather than loosened to "contains",
    // so the next arrival has to come back and say so.
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
    ).toEqual([...Object.keys(PRE_EXISTING_DIGESTS), 'sidebar.tsx', ...BATCH_CDE].sort());
  });

  it('sidebar.tsx exists and is the CLI’s output, not a hand-written copy', () => {
    // The first attempt at THE-266 could not reach ui.shadcn.com, wrote
    // nothing, and went green having audited nothing. The markers below are
    // ones only the CLI produces: it rewrites `@/registry/base-nova/*` to this
    // project's aliases and resolves shadcn's `IconPlaceholder` abstraction
    // into the configured icon library (components.json: "lucide").
    const src = readFileSync(SIDEBAR, 'utf8');
    expect(existsSync(SIDEBAR)).toBe(true);
    expect(src).toContain('from "@/components/ui/tooltip"');
    expect(src).toContain('from "@/hooks/use-mobile"');
    expect(src).toContain('import { PanelLeftIcon } from "lucide-react"');
    expect(src, 'a registry path survived — the import transform did not run').not.toContain(
      '@/registry/',
    );
    expect(src, 'IconPlaceholder survived — the icon transform did not run').not.toContain(
      'IconPlaceholder',
    );
  });
});

/* ── 4. No new token was defined ─────────────────────────────────────────── */

describe('no new token was defined', () => {
  it('globals.css is byte-identical — THE-267 (#412) had already done the work', () => {
    // The point of this PR: `sidebar` is the component #412 mapped eight
    // tokens FOR, so installing it should need nothing. The strongest possible
    // statement of that is the file's own digest, not a token diff.
    expect(sha256(readFileSync(GLOBALS_CSS, 'utf8'))).toBe(GLOBALS_SHA);
  });

  it('and the token ledger still matches the recorded fixture exactly', () => {
    expect(`${allDeclaredTokens().join('\n')}\n`).toBe(
      readFileSync(path.join(FIXTURES, 'globals-tokens.txt'), 'utf8'),
    );
  });

  it('the sidebar family is still exactly THE-267’s eight, on both halves of the bridge', () => {
    const expected = [
      '--sidebar',
      '--sidebar-accent',
      '--sidebar-accent-foreground',
      '--sidebar-border',
      '--sidebar-foreground',
      '--sidebar-primary',
      '--sidebar-primary-foreground',
      '--sidebar-ring',
    ];
    const tokens = allDeclaredTokens();
    expect(tokens.filter((t) => /^--sidebar/.test(t)).sort()).toEqual(expected);
    // Without the @theme inline half, `bg-sidebar` mints no rule.
    expect(tokens.filter((t) => /^--color-sidebar/.test(t)).sort()).toEqual(
      expected.map((t) => t.replace('--sidebar', '--color-sidebar')).sort(),
    );
  });

  it('no new npm package was needed either', () => {
    // sidebar's registry entry declares no `dependencies`. Everything it
    // imports was already here: @base-ui/react (mergeProps, useRender),
    // class-variance-authority, lucide-react.
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of ['@base-ui/react', 'class-variance-authority', 'lucide-react']) {
      expect(deps[name], `${name} is missing — sidebar.tsx imports it`).toBeDefined();
    }
    // ⚠️ Before the rebase this asserted `recharts` was absent, which was the
    // sharpest way to say "this PR adds no dependency" while #416 was the only
    // PR that did. #416 has landed and recharts IS in main, so the assertion
    // would now be false for a reason that has nothing to do with sidebar.
    // Replaced by the stronger claim it was standing in for: no dependency of
    // ANY name was added. See MAIN_DEPENDENCY_NAMES for why that is a list of
    // names rather than a digest of the file.
    expect(
      Object.keys(deps).sort(),
      'a dependency name was added or removed — sidebar adds none, and every change since must be listed in REMOVED_SINCE_MAIN or ADDED_SINCE_MAIN',
    ).toEqual(
      [...MAIN_DEPENDENCY_NAMES.filter((n) => !REMOVED_SINCE_MAIN.includes(n)), ...ADDED_SINCE_MAIN].sort(),
    );
    expect(deps['recharts'], 'recharts arrived with #416, and is main’s').toBe('^3.8.0');
  });
});

/* ── 5. The three widths are still NOT tokens ────────────────────────────── */

describe('--sidebar-width, --sidebar-width-mobile and --sidebar-width-icon are still NOT tokens', () => {
  const WIDTHS = ['--sidebar-width', '--sidebar-width-mobile', '--sidebar-width-icon'] as const;

  it('none of the three is declared in globals.css', () => {
    // THE-267's decision, restated where the component that reads them lives:
    // they are React constants sidebar.tsx owns, and declaring them here would
    // add a stylesheet opinion about a value the component already sets.
    const declared = allDeclaredTokens();
    for (const w of WIDTHS) {
      expect(declared, `${w} became a token`).not.toContain(w);
      expect(declared, `${w} became a theme key`).not.toContain(w.replace('--', '--color-'));
    }
  });

  it('because sidebar.tsx sets them itself, as inline styles', () => {
    // ⚠️ Without this half the test above is vacuous: "not a token" would also
    // pass if nothing anywhere set them and the sidebar were simply broken.
    // This reads the component and asserts the properties really are supplied.
    const inline = extractInlineCustomProperties(SIDEBAR);
    expect(inline).toEqual(['--sidebar-width', '--sidebar-width-icon', '--skeleton-width']);
  });

  it('and the React constants still carry the values THE-267 recorded', () => {
    const src = readFileSync(SIDEBAR, 'utf8');
    expect(src).toContain('const SIDEBAR_WIDTH = "16rem"');
    expect(src).toContain('const SIDEBAR_WIDTH_MOBILE = "18rem"');
    expect(src).toContain('const SIDEBAR_WIDTH_ICON = "3rem"');
    // --sidebar-width-mobile is not spelled at all: the mobile width is the
    // same property, re-set to SIDEBAR_WIDTH_MOBILE on the Sheet (sidebar.tsx:193).
    expect(src).not.toContain('--sidebar-width-mobile');
  });
});

/* ── 6. No THE-267 token moved ───────────────────────────────────────────── */

/**
 * All eight tokens, in both palettes, pinned by VALUE after the var()
 * chain is followed. A test that only checked "resolves to some colour" would
 * stay green while a ramp token was moved underneath the sidebar — the exact
 * regression this section exists to catch. Recorded from #412 as merged.
 */
const RESOLVED: Record<keyof typeof PALETTES, Record<string, string>> = {
  // 🔴 THE-338 re-recorded these. The sidebar's ground is --surface-raised,
  // which the founder's darkening moved from #242424 to #1F1F1F — so the
  // sidebar chrome went with it, which is the point of anchoring it to a ramp
  // token rather than a hex. The accent (--sidebar-primary / -ring) is
  // UNCHANGED at #C9963A in both modes, and the ink on it is still --earth:
  // this ticket removed a surface family, not the brand.
  light: {
    '--sidebar': '#FFFFFF',
    '--sidebar-foreground': '#404040',
    '--sidebar-primary': '#C9963A',
    '--sidebar-primary-foreground': '#2D2519',
    '--sidebar-accent': '#E0E0E0',
    '--sidebar-accent-foreground': '#1A1A1A',
    '--sidebar-border': '#E0E0E0',
    '--sidebar-ring': '#C9963A',
  },
  dark: {
    '--sidebar': '#1F1F1F',
    '--sidebar-foreground': '#CCCCCC',
    '--sidebar-primary': '#C9963A',
    '--sidebar-primary-foreground': '#2D2519',
    '--sidebar-accent': '#2A2A2A',
    '--sidebar-accent-foreground': '#F2F2F2',
    '--sidebar-border': '#2E2E2E',
    '--sidebar-ring': '#C9963A',
  },
};

describe('every THE-267 sidebar token still resolves to the same value', () => {
  for (const palette of Object.keys(PALETTES) as (keyof typeof PALETTES)[]) {
    it(`${palette}`, () => {
      const actual = Object.fromEntries(
        Object.keys(RESOLVED[palette]).map((t) => [t, resolve(decls, PALETTES[palette], t)]),
      );
      expect(actual).toEqual(RESOLVED[palette]);
    });
  }

  it('and --sidebar-ring is still identical to --ring in every palette', () => {
    // #412's chaining decision: the sidebar's focus ring must pick up the
    // contrast-corrected accent automatically rather than be restated.
    for (const chain of Object.values(PALETTES)) {
      expect(resolve(decls, chain, '--sidebar-ring')).toBe(resolve(decls, chain, '--ring'));
    }
  });
});

/* ── 7. Installed, not adopted ───────────────────────────────────────────── */

describe('sidebar is imported by nothing', () => {
  it('no file outside src/components/ui imports it', () => {
    const importers = walk(path.join(REPO_ROOT, 'src')).filter((f) => {
      if (f.startsWith(UI_DIR)) return false;
      if (f.includes(`${path.sep}__tests__${path.sep}`)) return false;
      return /@\/components\/ui\/sidebar/.test(readFileSync(f, 'utf8'));
    });
    expect(importers.map((f) => rel(f))).toEqual([]);
  });

  it('and no primitive inside src/components/ui imports it either', () => {
    // sidebar depends on six of them; none of them may depend back.
    for (const file of Object.keys(PRE_EXISTING_DIGESTS)) {
      expect(
        readFileSync(path.join(UI_DIR, file), 'utf8'),
        `${file} imports sidebar`,
      ).not.toContain('@/components/ui/sidebar');
    }
  });

  it('the install did NOT wrap the app in a SidebarProvider — or a TooltipProvider', () => {
    // The CLI printed the TooltipProvider instruction again (sidebar pulls
    // tooltip in). layout.tsx is THE-271's file and is hash-pinned besides.
    const layout = readFileSync(LAYOUT, 'utf8');
    expect(layout).not.toContain('SidebarProvider');
    expect(layout).not.toContain('TooltipProvider');
  });
});

/* ── 8. use-mobile ───────────────────────────────────────────────────────── */

describe('use-mobile exists and is the only new hook', () => {
  it('it landed at src/hooks/use-mobile.ts', () => {
    // components.json aliases `hooks` to `@/hooks`; the registry item carries
    // no `target`, so the alias is what decided this.
    expect(existsSync(USE_MOBILE), 'use-mobile.ts is not in src/hooks').toBe(true);
    expect(readFileSync(USE_MOBILE, 'utf8')).toContain('export function useIsMobile()');
  });

  it('src/hooks holds exactly the five that were there, plus it', () => {
    expect(
      readdirSync(HOOKS_DIR, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.ts'))
        .map((e) => e.name)
        .sort(),
    ).toEqual([...PRE_EXISTING_HOOKS, 'use-mobile.ts'].sort());
  });

  it('and it collided with nothing — no other useIsMobile in the repo', () => {
    // The existing hooks are camelCase `useX.ts`; `use-mobile.ts` is kebab, so
    // a filename collision was never possible. A DUPLICATE IMPLEMENTATION was,
    // and that is what this checks.
    const others = productionFiles().filter(
      (f) => f !== USE_MOBILE && /function useIsMobile\b|const useIsMobile\b/.test(readFileSync(f, 'utf8')),
    );
    expect(others.map((f) => rel(f))).toEqual([]);
  });

  it('and only sidebar.tsx imports it', () => {
    const importers = productionFiles().filter(
      (f) => f !== USE_MOBILE && /@\/hooks\/use-mobile/.test(readFileSync(f, 'utf8')),
    );
    expect(importers.map((f) => rel(f))).toEqual(['src/components/ui/sidebar.tsx']);
  });
});

/* ── 9. Out-of-scope files ───────────────────────────────────────────────── */

describe('tailwind.config.ts, layout.tsx, firestore.rules and functions/ are byte-identical', () => {
  it('tailwind.config.ts adds no colour and keeps its pinned code digest', () => {
    const config = readFileSync(TAILWIND_CONFIG, 'utf8');
    const code = config
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/[^\n]*/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    expect(sha256(code)).toBe(TAILWIND_CODE_SHA);
  });

  it('layout.tsx is byte-identical — THE-271 owns it and the pre-paint script is untouched', () => {
    expect(sha256(readFileSync(LAYOUT, 'utf8'))).toBe(LAYOUT_SHA);
  });

  it('firestore.rules is byte-identical', () => {
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
  });

  it('functions/ carries no change from this PR', () => {
    // Name-and-content digest over the whole tree, path separators normalised
    // so the pin means the same thing on Windows and on CI.
    const everyFile = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(d, e.name);
        if (e.isDirectory()) return e.name === 'node_modules' ? [] : everyFile(p);
        return [p];
      });
    const all = everyFile(path.join(REPO_ROOT, 'functions'))
      .map((p) => path.relative(REPO_ROOT, p).split(path.sep).join('/'))
      .sort();
    const h = createHash('sha256');
    for (const f of all) {
      h.update(f, 'utf8');
      h.update('\0');
      h.update(readFileSync(path.join(REPO_ROOT, f)));
      h.update('\0');
    }
    expect(all).toHaveLength(5);
    expect(h.digest('hex')).toBe(FUNCTIONS_TREE_SHA);
  });

  it('components.json is byte-identical — the CLI asked to change nothing', () => {
    // `shadcn add` rewrites components.json when it has to resolve a new
    // alias or registry. It did not: every alias sidebar needed already
    // existed, which is why use-mobile knew where to land.
    expect(sha256(readFileSync(path.join(REPO_ROOT, 'components.json'), 'utf8'))).toBe(
      COMPONENTS_JSON_SHA,
    );
  });

  it('border-strong, border-faint, border-subtle and border-hairline still produce nothing', () => {
    for (const cls of ['border-strong', 'border-faint', 'border-subtle', 'border-hairline']) {
      const esc = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(
        borderCss.match(new RegExp(`\\.${esc}\\s*\\{[^}]*\\}`)),
        `${cls} now mints a rule`,
      ).toBeNull();
    }
  });
});

/* ── 10. The guard change is proven, not assumed ─────────────────────────── */

describe('reading inline styles did not blunt the guard', () => {
  it('SET_AT_RUNTIME gained nothing from THE-270, and shed one it made redundant', () => {
    // The headline of the chosen approach. Seven classes arrived with sidebar
    // that could have been exempted by name; none was.
    //
    // ⚠️ The list is SHORTER than before this PR. #416 had added a fourth,
    // `bg-(--color-bg)`, because the guard could not then see that chart.tsx
    // supplies --color-bg itself. Reading inline styles made that visible, and
    // `holds back no stale exemption` — which requires every entry that applies
    // to be genuinely unresolved — named the entry as doing no work. It was
    // removed on that evidence. The test below proves the removal cost nothing.
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
    // Every exemption is still a literal name, not a pattern.
    for (const key of [...Object.keys(EXEMPT), ...Object.keys(SET_BY_NEXT_FONT)]) {
      expect(key, `${key} is a wildcard, not a literal`).not.toMatch(/[*?]|\.\+|\.\*/);
    }
  });

  it('🔴 dropping #416’s entry left chart.tsx exactly as quiet as before', () => {
    // The half that makes the removal safe rather than merely tidy. chart.tsx
    // spells `bg-(--color-bg)` and no longer has an exemption for it, so if the
    // reader did not cover it the guard would now report chart.tsx — a file
    // this PR never touched. It does not: the class is absent from findings AND
    // from exempted, because it simply resolves.
    const chart = path.join(UI_DIR, 'chart.tsx');
    const chartFindings = audit.findings.filter((f) => rel(f.file) === rel(chart));
    expect(chartFindings, `THE-270 made chart.tsx noisy: ${JSON.stringify(chartFindings)}`).toEqual(
      [],
    );
    expect(audit.exempted.map((f) => f.className)).not.toContain('bg-(--color-bg)');
    // And the reason, read off chart.tsx rather than asserted: it sets both
    // swatch properties inline, which is what the reader picks up.
    expect(extractInlineCustomProperties(chart)).toEqual(['--color-bg', '--color-border']);
  });

  it('a class reading a property its own file sets inline resolves', async () => {
    const file = fixturePrimitive(
      'export const F = () => <div style={{ "--fixture-width": "16rem" } as React.CSSProperties} className="w-(--fixture-width)" />',
    );
    const { findings } = await auditPrimitives([file]);
    expect(findings.map((f) => f.className)).not.toContain('w-(--fixture-width)');
  }, 120_000);

  it('🔴 and the same class in a file that does NOT set it still fails', async () => {
    // The mutation the whole design turns on. If the reader had been written
    // as "ignore any arbitrary property", this would pass and the guard would
    // be blind to every future missing token of this shape.
    const file = fixturePrimitive(
      'export const F = () => <div className="w-(--fixture-width)" />',
    );
    const { findings } = await auditPrimitives([file]);
    expect(findings).toContainEqual({
      file,
      className: 'w-(--fixture-width)',
      reason: 'undefined-var',
      property: '--fixture-width',
    });
  }, 120_000);

  it('🔴 and setting it in one file does not resolve it in another', async () => {
    // The scoping claim, asserted rather than described: inline properties are
    // held per file and never merged, so sidebar.tsx cannot vouch for a
    // property some other primitive forgot to define.
    const setter = fixturePrimitive(
      'export const A = () => <div style={{ "--fixture-width": "16rem" } as React.CSSProperties} />',
      'setter.tsx',
    );
    const reader = fixturePrimitive(
      'export const B = () => <div className="w-(--fixture-width)" />',
      'reader.tsx',
    );
    const { findings } = await auditPrimitives([setter, reader]);
    expect(findings).toContainEqual({
      file: reader,
      className: 'w-(--fixture-width)',
      reason: 'undefined-var',
      property: '--fixture-width',
    });
  }, 120_000);

  it('the operands of a comparison are not read as classes', () => {
    // `floating` and `inset` were reported as classes generating no rule
    // before the extractor learned this. They are the values of the `variant`
    // prop, compared inside a cn() call.
    const file = fixturePrimitive(
      `import { cn } from "@/lib/utils"
       export const F = ({ v, on }: { v: string; on: boolean }) => (
         <div className={cn("flex", v === "floating" || v === "inset" ? "p-2" : "p-0", on && "md:opacity-0")} />
       )`,
    );
    const classes = extractClassNames(file);
    expect(classes).not.toContain('floating');
    expect(classes).not.toContain('inset');
    // …and the arms of the ternary, and the right side of `&&`, are still read.
    expect(classes).toEqual(expect.arrayContaining(['flex', 'p-2', 'p-0', 'md:opacity-0']));
  });

  it('no-scrollbar is held as somebody else’s utility, and is genuinely still dead', () => {
    // Recorded rather than fixed. `.no-scrollbar` is defined by ui.shadcn.com's
    // own site stylesheet and by nothing here, so SidebarContent will paint a
    // visible scrollbar. That is a Phase 8 decision — define it, or drop the
    // class — and this is the note that keeps it from being forgotten.
    expect(Object.keys(NOT_A_UTILITY).sort()).toEqual(['no-scrollbar', 'toaster']);
    expect(NOT_A_UTILITY['no-scrollbar'].length).toBeGreaterThan(40);
    expect(readFileSync(SIDEBAR, 'utf8')).toContain('no-scrollbar');
    // The audit reports it as exempted, not as resolved — if globals.css ever
    // grows a real .no-scrollbar, `holds back no stale exemption` turns red.
    expect(audit.exempted.map((f) => f.className)).toContain('no-scrollbar');
  });
});
