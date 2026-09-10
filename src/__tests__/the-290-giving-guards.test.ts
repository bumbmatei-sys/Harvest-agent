import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

import { GLOBALS_CSS, REPO_ROOT } from '../test/support/tailwind-build';
import { rulesDigestFailure } from './__fixtures__/firestore-rules-pin';

/**
 * THE-290 — the static guards: what this slice was not allowed to add.
 *
 * The rendered behaviour is in `components/__tests__/the-290-giving-tab.test.tsx`
 * and the layout in `the-290-giving-layout.test.tsx`. What is here is the set of
 * things only visible in the SOURCE — a hardcoded hex, an inline style, a minted
 * token, a new dependency, a new index, an edit to a file another ticket owns.
 *
 * ⚠️ Nothing here shells out to `git show`. Every baseline is a literal digest
 * or a literal value, pinned when this test was written. A guard that
 * re-derives its own baseline from the repository at assertion time cannot fail
 * — it just describes whatever it was handed.
 */

const sha256 = (t: string | Buffer): string => createHash('sha256').update(t).digest('hex');
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** Every file this ticket adds or modifies. The subject of every guard below. */
const TOUCHED_FILES = [
  'src/components/dashboard/giving-data.ts',
  'src/components/dashboard/useGivingData.ts',
  'src/components/dashboard/CampaignProgress.tsx',
  'src/components/dashboard/PledgeFulfilment.tsx',
  'src/components/dashboard/GivingTab.tsx',
  // Modified by this slice, so they come under the same bars.
  'src/components/dashboard/dashboard-data.ts',
  'src/components/dashboard/DashboardTabs.tsx',
  'src/components/AdminDashboardHome.tsx',
] as const;

/** The files this slice ADDS. Some claims are only about new code. */
const NEW_FILES = TOUCHED_FILES.slice(0, 5);

/** Source with block and line comments stripped — the code, not the prose. */
function codeOf(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/* ═══ 13a · No inline style ══════════════════════════════════════════════════ */

describe('no emoji, no inline style, no hardcoded colour', () => {
  /**
   * The bar is ZERO. The dashboard files carry no inline style at all and this
   * slice keeps it there — an inline style out-ranks every stylesheet rule, so a
   * themed token can never override one, which is exactly why the design system
   * could never reach `AnalyticsAndRoles.tsx` and its 193 of them.
   */
  it.each(TOUCHED_FILES)('%s carries no style={{ … }} at all', (file) => {
    const inline = codeOf(file).match(/style=\{\{/g) ?? [];
    expect(inline, `${file} has ${inline.length} inline styles`).toHaveLength(0);
  });

  it('and no style attribute of any other shape either', () => {
    for (const file of TOUCHED_FILES) {
      expect(codeOf(file), file).not.toMatch(/\sstyle\s*=/);
      expect(codeOf(file), file).not.toMatch(/\.style\.[a-zA-Z]/);
      expect(codeOf(file), file).not.toMatch(/setProperty\(/);
    }
  });

  /* ═══ 13b · No emoji reaches a screen ═════════════════════════════════════ */

  /**
   * 🔴 Comments are stripped first. This repo's house style uses 🔴 and ⚠️
   * heavily in prose to mark the load-bearing notes, and those are
   * documentation. What is banned is an emoji that can reach a SCREEN —
   * `lucide-react` is already imported by every file here that draws an icon.
   */
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

  it.each(TOUCHED_FILES)('%s uses no emoji outside its comments', (file) => {
    const found = codeOf(file).match(EMOJI);
    expect(found, `${file} carries ${found?.[0]} in code`).toBeNull();
  });

  it('every icon on the Giving tab is a lucide component', () => {
    for (const file of [
      'src/components/dashboard/CampaignProgress.tsx',
      'src/components/dashboard/PledgeFulfilment.tsx',
    ]) {
      expect(read(file), file).toMatch(/from 'lucide-react'/);
    }
  });

  /* ═══ 13c · No colour is hardcoded ════════════════════════════════════════ */

  it.each(TOUCHED_FILES)('%s contains no hex literal', (file) => {
    const hexes = codeOf(file).match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexes, `${file} hardcodes ${hexes.join(', ')}`).toHaveLength(0);
  });

  it.each(TOUCHED_FILES)('%s contains no rgb/hsl/oklch literal', (file) => {
    const fns = codeOf(file).match(/\b(?:rgba?|hsla?|oklch|lab)\s*\(/g) ?? [];
    expect(fns, `${file} hardcodes ${fns.join(', ')}`).toHaveLength(0);
  });

  it('no raw Tailwind palette step is spelled either — every colour is semantic', () => {
    // `bg-sky-100` is as fixed as a hex: the numbered ramps do not move with the
    // palette. Four palettes ship and Classic is the DEFAULT since #409, so a
    // literal is the same colour in all four and therefore wrong in at least three.
    const RAMP = /\b(?:bg|text|border|ring|fill|stroke|from|via|to|divide|outline)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;
    for (const file of TOUCHED_FILES) {
      const hits = codeOf(file).match(RAMP) ?? [];
      expect(hits, `${file} spells ${hits.join(', ')}`).toHaveLength(0);
    }
  });

  it('the Giving tab names no series colour of its own — it reuses CHART_VARS', () => {
    const giving = codeOf('src/components/dashboard/GivingTab.tsx');
    expect(giving).toMatch(/CHART_VARS/);
    // No `var(--chart-N)` spelled directly: the five slots are declared once, in
    // GivingMix, and referenced by index everywhere else.
    expect(giving).not.toMatch(/var\(--chart-\d\)/);
    // And the two money widgets plot no series at all, so they name no colour.
    for (const file of [
      'src/components/dashboard/CampaignProgress.tsx',
      'src/components/dashboard/PledgeFulfilment.tsx',
    ]) {
      expect(codeOf(file), file).not.toMatch(/var\(--/);
    }
  });

  /**
   * ⚠️ KNOWN AND ACCEPTED, and asserted here so it is not "fixed" by accident.
   * `progress` paints `bg-primary` on `bg-muted` at 2.30:1 in light, and
   * `--chart-4`/`--chart-5` are 1.50:1 / 1.77:1 on light. All three are recorded
   * in both directions in THE-272's guard. This slice adopts `progress` and does
   * NOT touch its classes: the widgets write every figure the bar depicts out as
   * a number beside it, so nothing is conveyed by the bar alone.
   */
  it('the progress primitive is adopted unchanged — its known contrast is not "fixed"', () => {
    const progress = read('src/components/ui/progress.tsx');
    expect(progress).toMatch(/bg-primary/);
    expect(progress).toMatch(/bg-muted/);
    for (const file of [
      'src/components/dashboard/CampaignProgress.tsx',
      'src/components/dashboard/PledgeFulfilment.tsx',
    ]) {
      // No class override that would repaint the track or the indicator.
      expect(codeOf(file), file).not.toMatch(/ProgressTrack|ProgressIndicator/);
    }
  });
});

/* ═══ 13d · All four palettes resolve, Classic first ═════════════════════════ */

/** Custom properties declared by rules whose selector matches. */
function varsIn(selectorTest: (sel: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(readFileSync(GLOBALS_CSS, 'utf8')).walkRules((rule) => {
    if (!selectorTest(rule.selector)) return;
    rule.walkDecls((decl) => { if (decl.prop.startsWith('--')) out[decl.prop] = decl.value.trim(); });
  });
  return out;
}

const rootVars = varsIn((s) => s === ':root');
const darkVars = varsIn((s) => /\.dark|\[data-theme="dark"\]/.test(s) && !s.includes('data-palette'));

/** 🔴 Classic FIRST — it is the default since #409, so it is the primary case. */
// 🔴 THE-338 — TWO palettes, not four. The second FAMILY (Classic) and its
// `data-palette` selectors are gone; its 14 overrides were promoted into
// :root/.dark. The surviving axis is light/dark, so keeping four keys would
// have run every assertion below twice over identical declarations.
const PALETTES: Record<string, Record<string, string>> = {
  Light: { ...rootVars },
  Dark: { ...rootVars, ...darkVars },
};

function resolve(value: string | undefined, scope: Record<string, string>, depth = 0): string | null {
  if (value === undefined || depth > 12) return null;
  const v = value.trim();
  const m = /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]+))?\)$/.exec(v);
  if (m) {
    const direct = scope[m[1]] !== undefined ? resolve(scope[m[1]], scope, depth + 1) : null;
    return direct ?? (m[2] ? resolve(m[2], scope, depth + 1) : null);
  }
  return v;
}

describe('both palettes resolve every token this slice leans on', () => {
  /**
   * The semantic tokens the three new widgets actually reference, via the
   * `ui/table`, `ui/progress`, `ui/card` and `ui/empty` primitives and their own
   * classes. `--primary` is new to this list because `progress` is newly
   * adopted; it is an EXISTING token, not one this slice minted.
   */
  const USED = [
    '--muted-foreground', '--foreground', '--card', '--card-foreground',
    '--border', '--muted', '--primary',
  ] as const;

  it.each(Object.entries(PALETTES))('%s resolves each of them to a real value', (name, scope) => {
    for (const token of USED) {
      expect(resolve(scope[token], scope), `${name} ${token}`).toBeTruthy();
    }
  });

  it('and --chart-1, the one series colour the giving trend plots, in all four', () => {
    // 🔴 The SAME slot the Overview tab draws giving in, so the colour does not
    // change under a reader who moves between the two tabs.
    for (const [name, scope] of Object.entries(PALETTES)) {
      expect(resolve(scope['--chart-1'], scope), `${name} --chart-1`).toBeTruthy();
    }
  });

  it('the two palettes are genuinely two — dark is not a copy of light', () => {
    // 🔴 THE-338 REPOINTED THIS. It proved the two FAMILIES were distinct, so
    // that "resolves in all four" was not four readings of the same values.
    // With one family the equivalent claim is that the MODES are distinct —
    // which is what makes "resolves in both" a real check rather than two
    // readings of :root.
    expect(resolve(PALETTES.Dark['--background'], PALETTES.Dark))
      .not.toBe(resolve(PALETTES.Light['--background'], PALETTES.Light));
  });
});

/* ═══ 14 · No new token was defined ══════════════════════════════════════════ */

describe('no new token was defined', () => {
  it('no file in this slice declares a custom property', () => {
    for (const file of TOUCHED_FILES) {
      const declared = codeOf(file).match(/(?<![\w-])--[\w-]+\s*:/g) ?? [];
      expect(declared, `${file} declares ${declared.join(', ')}`).toHaveLength(0);
    }
  });

  /**
   * The stronger half: a token can also be "added" by REFERENCING one that does
   * not exist. `var(--giving-accent)` compiles, resolves to nothing and paints
   * transparent — a token invented by use rather than by declaration.
   */
  it('every custom property these files reference already exists in globals.css', () => {
    const declared = new Set(Object.keys(rootVars));
    for (const map of [darkVars]) {
      for (const key of Object.keys(map)) declared.add(key);
    }
    const globals = readFileSync(GLOBALS_CSS, 'utf8');

    for (const file of TOUCHED_FILES) {
      for (const [, name] of codeOf(file).matchAll(/var\((--[\w-]+)/g)) {
        // `--color-<key>` is minted at RUNTIME by the chart primitive, scoped to
        // one chart, from that chart's own config. Not a design token.
        if (name.startsWith('--color-')) continue;
        expect(declared.has(name) || globals.includes(`${name}:`), `${file} references undeclared ${name}`).toBe(true);
      }
    }
  });

  it('the bridge has held with zero additions, and this slice adds none', () => {
    // The count of `--chart-N` slots is the one that would move if a widget
    // needed a sixth series colour. It does not: the giving trend plots one, and
    // the two money widgets plot none.
    expect(rootVars['--chart-5']).toBeTruthy();
    expect(rootVars['--chart-6']).toBeUndefined();
  });
});

/* ═══ 15 · The files this ticket may not touch ═══════════════════════════════ */

/**
 * 🔴 `AdminDashboard.tsx` is THE-277's. THE-276's design keeps it untouched and
 * this slice preserves that property: `AdminDashboardHome`'s five props are
 * unchanged, so the call site never needs editing. `firestore.rules`,
 * `firestore.indexes.json` and `functions/` are out of scope by instruction —
 * and `firestore.indexes.json` matters twice over, because it DOES NOT DEPLOY
 * ON MERGE (`deploy-rules.yml` runs `firestore:rules,storage` only, and its
 * `paths:` filter does not even include the file), so an index added there
 * would be inert and the query would throw `failed-precondition` in production
 * while every test stayed green. Every query this slice issues is one equality
 * or a subcollection read, served by the automatic single-field index every
 * collection already has.
 *
 * ⚠️ A SET per file, not a single digest, for THE-276's reason: CI runs against
 * `refs/pull/N/merge`, so a file another ticket legitimately lands on `main`
 * holds a different value there than on this branch. A value that is NEITHER —
 * i.e. this ticket editing the file — still fails, which is the whole threat.
 */
const UNTOUCHED: Record<string, ReadonlyArray<readonly [digest: string, source: string]>> = {
  'src/components/AdminDashboard.tsx': [
    ['722c5e4478be0a8508e7dff1232dd4c1f88cacdd502604f946f3134eb730d98c', 'main at 7fd4672, where this branch started — the value THE-276 and THE-283 both accepted'],
    // ⚠️ APPENDED BY THE-294, and it is a REPAIR of a red main rather than a
    // change to this ticket's claim. THE-291 (#434) removed the dead
    // `onChangePlan` / `onCancelPlan` props from the `<AdminSettings>` mount — a
    // client-side `plan` write no caller ever reached — and extended the
    // accepted SET in `the-276-dashboard-guards` and `the-283-growth-guards`
    // while missing this one, so this assertion has failed on `main` ever since.
    // The value is the same one those two already accept.
    //
    // 🔴 The guard is NOT weakened by this. Appended, never substituted: a
    // digest that is NEITHER — i.e. a ticket actually editing the file — still
    // fails, which is the whole threat this guard exists for. THE-294 does not
    // open `AdminDashboard.tsx` either.
    //
    // ⚠️ FOUR TICKETS REACHED THIS VALUE INDEPENDENTLY — THE-294, THE-296,
    // THE-298 and THE-292 — and this note records that rather than four entries
    // doing so. All four were cut from a main on which this assertion was
    // already red, all four diagnosed THE-291 (#434) as the cause, and all four
    // appended THIS digest. So each rebase conflict between them differed only
    // in its PROSE, never in what the set accepts, and every resolution has been
    // the UNION at unchanged size: the two values below are every value any side
    // has ever carried. None of the four opens `AdminDashboard.tsx`.
    //
    // 🔴 THE ENTRY ABOVE IS THE ONE AT RISK, and it is the reason this note is
    // this long. Only ONE value can match at a time, so `722c5e44…` matches
    // nothing today and deleting it passes every test on every branch cut after
    // #434 — while turning main red for any branch cut before it. It is dormant,
    // not dead. Appended, never substituted: a digest that is NEITHER — a ticket
    // actually editing the file — still fails, which is the whole threat.
    ['446f0bcb8ffa6accf4f80467b75a50023c1441937605b11e18aa01b53d8e53f8', 'main + THE-291 — the client-side plan write removed (appended by THE-294, THE-296, THE-298 and THE-292 independently)'],
    // 🔴 THE-326 — the Services nav entry. APPENDED, NEVER SUBSTITUTED: every
    // value above is still accepted, because CI runs against `refs/pull/N/merge`
    // and a merge ref cut before this ticket landed legitimately carries one of
    // them. A digest that is NEITHER — i.e. THIS slice editing the file — still
    // fails, which is the whole threat this guard exists for.
    //
    // ⚠️ THIS SLICE'S OWN CLAIM IS UNCHANGED: it does not edit AdminDashboard.
    // THE-326 does, and it must — the nav lives there and the ticket is "service
    // planning is buried inside Events, split it out". What it adds is the
    // `services` entry in `allTabs`, the same id in the MINISTRY group of BOTH
    // nav arrays, one arm on the render switch, and two imports. It introduces
    // no permission: the entry repeats Events' own
    // `navAllows(features?.eventRegistration) && (hasFullAccess ||
    // perms.manageEvents)`, so no tier's and no role's reach changes.
    ['69f7efceccd7b8381e5ceb114642f8b4634e73df1278bb082e678a1a0cb634f9', 'main + THE-326 — service planning split out of Events into its own section'],
    // 🔴 THE-327 — `'library'` added to the PLATFORM group of MORE_GROUPS and
    // the GROW group of DESKTOP_NAV_GROUPS. APPENDED, NEVER SUBSTITUTED: every
    // value above is still accepted, because CI runs against
    // `refs/pull/N/merge` and a merge ref cut before this ticket landed
    // legitimately carries one of them. A digest that is NEITHER — i.e. THIS
    // slice editing the file — still fails, which is the whole threat this
    // guard exists for.
    //
    // ⚠️ THIS SLICE'S OWN CLAIM IS UNCHANGED: it does not edit AdminDashboard.
    // THE-327 does, and it must — the founder reported the Library screen
    // deleted and it was not: the screen renders, the nav entry exists and
    // `admin-sections.ts` maps the slug, so `/admin/library` already resolved.
    // What was missing was any way to CLICK to it, because `'library'` was in
    // NEITHER group array and the desktop sidebar has no catch-all. It adds two
    // array entries and their reasons and nothing else — no permission, gate,
    // tab id, render arm or import changes, and the entry is still
    // `isSuperAdmin && { id: 'library' }`.
    ['decfdddbdab91094c936b503f931b663eeb6ba3048ee087c541fe1580f20e31e', 'main + THE-327 — the Library nav entry added to both group arrays'],
    // 🔴 THE-332 — the desktop nav became a RAIL. APPENDED, NEVER
    // SUBSTITUTED: every value above stays accepted, because CI runs against
    // `refs/pull/N/merge` and a merge ref cut before this ticket landed
    // legitimately carries one of them. A digest that is NEITHER — i.e. THIS
    // slice editing the file — still fails, which is the whole threat this
    // guard exists for.
    //
    // ⚠️ THIS SLICE'S OWN CLAIM IS UNCHANGED: it does not edit
    // AdminDashboard. THE-332 does, and it must — the nav lives there and the
    // ticket is "the sidebar shows all 24 tabs at once, make it a rail with
    // flyouts". What it changes is the DESKTOP column only: the four groups
    // became flyout triggers, Dashboard and Settings stayed pinned, and
    // `isSidebarCollapsed` / `collapsedGroups` went with the column they
    // collapsed. MORE_GROUPS and the mobile More sheet are byte-identical, and
    // no permission gate moved.
    ['508747ccbc7b2fef051d449626ef2f81f3655b214be0494c6c21a8c7df88b9bb', 'main + THE-332 — the desktop nav becomes a rail with flyouts'],
    // 🔴 APPENDED BY THE-334, nothing above removed or rewritten.
    ['00db3fa2b16a506d0a23dc1d582e6581c49e03350b966fb30d82d9434b09f450', 'main + THE-334 — one flyout at a time; the panel takes ClickUp’s shape and Settings moves to the account menu'],
    // 🔴 APPENDED BY THE-335, nothing above removed or rewritten: SMS hidden
    // again behind its own switch, the Newsletter nav entry and render branch
    // gated by a new one in the identical shape, and the Signups gate moved off
    // the `crm` cell onto its own so free can keep Signups without CRM.
    ['d81a5b117569424515bf8c8ebca8654e8b6f57f3c7447f2419968adcebdf8bbe', 'main + THE-335 — SMS and the newsletter hidden; Signups on its own plan cell'],
    ['a7dc96513ad4003892f3bc81d5faaed2f616bd04c496a4b3ec977777baf067b7', 'main + THE-341 — BROADCASTING renamed to REACH and `forms` moved into it, on both shells'],
    // APPENDED BY THE-346, nothing above removed or rewritten.
    ['3f1556d136fc8f4d2027772dfbd9b8d1be08c3678a9122ccbda8f5ac5e460e8c',
      'main + THE-346 - the bottom nav gains a display:contents visibility wrapper so the Notes editor can take the 65px band back on a phone when it goes fullscreen; the nav OWN class string is byte-identical, because four measured suites discover it out of this file by pattern'],
  ],
  'firestore.indexes.json': [
    ['8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0', 'main at 7fd4672'],
  ],
};

function functionsTree(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'lib' || entry === '.git') continue;
      const p = path.join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(path.relative(REPO_ROOT, p));
    }
  };
  walk(path.join(REPO_ROOT, 'functions'));
  return out.sort();
}

describe('AdminDashboard.tsx, firestore.rules, firestore.indexes.json and functions/ byte-identical', () => {
  /**
   * 🔴 THE-325 · the accepted SET moved to `__fixtures__/ownership/`, the
   * ASSERTION stayed here. This suite still says what it always said: the
   * `firestore.rules` on disk is at a digest some ticket recorded, and so
   * THIS ticket did not touch a file that auto-deploys to production with no
   * emulator test in CI. Only the list of accepted values is now shared, so a
   * legitimate rules change is one new per-ticket record rather than 50 edits.
   */
  it('firestore.rules carries no edit from this ticket', () => {
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
  });

  it.each(Object.entries(UNTOUCHED))('%s carries no edit from this ticket', (file, accepted) => {
    const actual = sha256(readFileSync(path.join(REPO_ROOT, file)));
    const match = accepted.find(([digest]) => digest === actual);
    expect(
      match,
      `${file} is at ${actual}, which is none of:\n  ` +
        accepted.map(([d, why]) => `${d} (${why})`).join('\n  '),
    ).toBeTruthy();
  });

  it('functions/ is unchanged, file for file', () => {
    const files = functionsTree();
    expect(files).toHaveLength(5);
    const tree = sha256(files.map((f) => `${f}:${sha256(readFileSync(path.join(REPO_ROOT, f)))}`).join('\n'));
    expect(tree).toBe('1a3a1c7f27699263bcdf5bd0320c7cb0803a6f76644952f631000bc9bedef2d7');
  });

  it('nothing in this slice imports the shell it may not open', () => {
    for (const file of TOUCHED_FILES) {
      expect(codeOf(file), file).not.toMatch(/from\s+['"][^'"]*AdminDashboard['"]/);
      expect(codeOf(file), file)
        .not.toMatch(/from\s+['"][^'"]*(?:AdminFundraising|AdminAccounting|AdminDonations|AdminCheckin|AdminCRM)['"]/);
    }
  });

  /**
   * 🔴 THE-289 owns provisioning and the Stripe SUBSCRIPTION webhook, and this
   * ticket reads a collection `donation-webhook.ts` writes. Adjacent, and
   * DELIBERATELY NOT ENTANGLED: nothing in this slice imports it, references its
   * helpers, or depends on a symbol from it. The unit facts it establishes —
   * `amount: amountCents`, `issuedAt: nowIso`, `raised: increment(amountDollars)`
   * — are recorded in this slice's own module headers instead, so a change over
   * there surfaces as a failing assertion here rather than as a broken import.
   */
  it('and nothing in this slice touches the donation webhook or provisioning', () => {
    for (const file of TOUCHED_FILES) {
      const code = codeOf(file);
      expect(code, file).not.toMatch(/donation-webhook|incrementCampaignRaised|free-provisioning|dodo\/provisioning/);
      expect(code, file).not.toMatch(/from\s+['"][^'"]*(?:AuthPage|Onboarding|ChurchOnboarding)['"]/);
    }
  });

  it('🔴 and no query it builds carries an orderBy or a composite constraint', () => {
    /*
     * 🔴 `invoices.issuedAt` holds BOTH ISO strings and Timestamps — the
     * donation webhook writes `issuedAt: nowIso` — and Firestore orders ACROSS
     * TYPES BY TYPE FIRST, so `orderBy('issuedAt','desc')` returns every string
     * row before any Timestamp row: stable, not chronological, and a `limit()`
     * on top of it is a biased sample. Neither `campaigns` nor `pledges` has a
     * composite index either, and the index file does not deploy on merge.
     */
    for (const file of NEW_FILES) {
      expect(codeOf(file), file).not.toMatch(/orderBy/);
    }
    // And the completeness proof is what stands in for ordering, on both reads.
    const hook = codeOf('src/components/dashboard/useGivingData.ts');
    expect((hook.match(/completeRead/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // 🔴 Every constraint on `campaigns` is the ONE tenant equality. A second
    // `where` would need a composite index that cannot be deployed.
    expect(codeOf('src/components/dashboard/giving-data.ts')).not.toMatch(/where\(/);
  });

  /**
   * 🔴 The relocation is structural, not incidental. `GivingTab` must plot
   * `data.givingSeries` and must not build a series of its own — no
   * `bucketWeekly`, no ledger read, no arithmetic.
   */
  it('the giving trend is relocated, not rebuilt — the tab constructs no series', () => {
    const tab = codeOf('src/components/dashboard/GivingTab.tsx');
    expect(tab).toMatch(/series:\s*data\.givingSeries/);
    expect(tab).not.toMatch(/bucketWeekly|completeRead|invoicesQuery|getDocs|useOverviewData\(/);
    // And the shared chart is reused rather than a second one written.
    expect(tab).toMatch(/from '\.\/TrendChart'/);
  });
});

/* ═══ Dependencies ═══════════════════════════════════════════════════════════ */

describe('no npm dependency was added', () => {
  it('@tanstack/react-table was NOT installed for the campaign table', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    /*
     * 🔴 A plain table needs no table library. `@tanstack/react-table` buys
     * INTERACTIVE sorting and filtering — a header a reader can click — and the
     * campaign list is sorted once, with `Array.sort`, over an array already
     * entirely in memory. Wanting a clickable header later is a dependency
     * decision to report, not one to take silently inside this ticket.
     */
    for (const absent of ['@tanstack/react-table', '@tanstack/table-core']) {
      expect(pkg.dependencies[absent], `${absent} was added`).toBeUndefined();
      expect(pkg.devDependencies?.[absent], `${absent} was added as a devDependency`).toBeUndefined();
    }
  });

  it('no charting or gauge library was added — recharts is still the only one', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    for (const absent of [
      'react-simple-maps', 'topojson-client', 'd3-geo', 'nivo', '@nivo/core',
      'victory', 'react-circular-progressbar', 'react-gauge-chart',
    ]) {
      expect(pkg.dependencies[absent], `${absent} was added`).toBeUndefined();
    }
    expect(pkg.dependencies.recharts, 'recharts is still the only charting library').toBeTruthy();
  });

  it('no Playwright, either — layout is measured over CDP with Node builtins', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    for (const absent of ['playwright', '@playwright/test', 'puppeteer']) {
      expect(pkg.dependencies[absent], `${absent} was added`).toBeUndefined();
      expect(pkg.devDependencies?.[absent], `${absent} was added`).toBeUndefined();
    }
  });

  it('no registry beyond the one already configured, and no new ui primitive', () => {
    const components = JSON.parse(read('components.json')) as { registries?: Record<string, unknown> };
    expect(components.registries ?? {}).toEqual({});
    // 🔴 `table` and `progress` were INSTALLED by THE-272. This slice adopts
    // them; it installs nothing. A hand-authored primitive would be a component
    // to report before adding.
    const ui = readdirSync(path.join(REPO_ROOT, 'src/components/ui'))
      .filter((f) => f.endsWith('.tsx')).sort();
    expect(ui).toContain('progress.tsx');
    expect(ui).toContain('table.tsx');
    expect(ui).not.toContain('data-table.tsx');
    expect(ui).not.toContain('gauge.tsx');
  });

  /**
   * 🔴 Stripe Connect stays off. `STRIPE_CONNECT_ENABLED = false` because the
   * platform account was closed as `rejected.fraud`, and this slice restores no
   * surface behind it — which is also why there is no tenant recurring gift to
   * read, and therefore no recurring widget on the tab.
   */
  it('Stripe Connect is still off and no surface behind it was restored', () => {
    expect(read('src/lib/stripe-connect-feature.ts'))
      .toMatch(/export const STRIPE_CONNECT_ENABLED = false;/);
    for (const file of TOUCHED_FILES) {
      expect(codeOf(file), file).not.toMatch(/STRIPE_CONNECT|stripe-connect|StripeConnectPanel/);
    }
  });
});
