import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

import { GLOBALS_CSS, REPO_ROOT, buildAppCss } from '../test/support/tailwind-build';
import { AA_CONTRAST, accentTintGround, contrastRatio } from '../lib/theme';
import { BAND_FILL, BAND_MIX, BAND_LABEL, bandOf } from '../components/dashboard/RetentionHeatmap';
import { RETENTION_MONTHS } from '../components/dashboard/retention-data';
import { rulesDigestFailure } from './__fixtures__/firestore-rules-pin';

/**
 * THE-299 — the static guards: what this slice was not allowed to add.
 *
 * The rendered behaviour is in
 * `components/__tests__/the-299-retention-tab.test.tsx` and the layout in
 * `the-299-retention-layout.test.tsx`. What is here is the set of things only
 * visible in the SOURCE — a hardcoded hex, an inline style, a minted token, a
 * new dependency, a new index, an `orderBy` on a mixed-type field, an edit to a
 * file another ticket owns — plus the two claims that are specific to this
 * ticket: that the colour scale clears AA in all four palettes, and that the
 * component was INSTALLED from a registry rather than invented.
 *
 * ⚠️ Nothing here shells out to `git show`. Every baseline is a literal digest
 * or a literal value, pinned when this test was written. A guard that
 * re-derives its own baseline from the repository at assertion time cannot fail
 * — it just describes whatever it was handed.
 */

const sha256 = (t: string | Buffer): string => createHash('sha256').update(t).digest('hex');
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** Repo-relative, forward slashes on every platform. See `functionsTree`. */
const rel = (abs: string): string => path.relative(REPO_ROOT, abs).split(path.sep).join('/');

/** Every file this ticket adds or modifies. The subject of every guard below. */
const TOUCHED_FILES = [
  'src/components/dashboard/retention-data.ts',
  'src/components/dashboard/RetentionHeatmap.tsx',
  // Modified by this slice, so they come under the same bars.
  'src/components/dashboard/useGrowthData.ts',
  'src/components/dashboard/GrowthTab.tsx',
  'src/components/dashboard/growth-data.ts',
  'src/components/dashboard/DashboardTabs.tsx',
] as const;

/** The files this slice ADDS. Some claims are only about new code. */
const NEW_FILES = TOUCHED_FILES.slice(0, 2);

/** Source with block and line comments stripped — the code, not the prose. */
function codeOf(relPath: string): string {
  return read(relPath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/* ═══ 1 · 🔴 The Platform tab is gone, everywhere ═══════════════════════════ */

describe('the Platform tab is gone', () => {
  it('DashboardTabs declares five rows and none of them is platform', () => {
    const code = codeOf('src/components/dashboard/DashboardTabs.tsx');
    const ids = [...code.matchAll(/\{\s*id:\s*'([a-z]+)'/g)].map((m) => m[1]);
    expect(ids).toEqual(['overview', 'growth', 'giving', 'engagement', 'content']);
    expect(code).not.toMatch(/id:\s*'platform'/);
    expect(code).not.toMatch(/label:\s*'Platform'/);
    // The icon the row used, dropped with it rather than left imported.
    expect(code).not.toMatch(/\bServer\b/);
  });

  it('and the upcoming string that promised a plan mix is deleted, not reworded', () => {
    const code = codeOf('src/components/dashboard/DashboardTabs.tsx');
    expect(code).not.toMatch(/tenant health|plan mix|platform-wide totals/i);
  });

  /**
   * 🔴 THE SWEEP. `'platform'` occurs about forty times in `src/`, and every
   * one of them is a different concept — an SMS credential source, a reserved
   * subdomain, `PLATFORM_TENANT_ID`, prose. This asserts the specific shapes a
   * TAB ID would take, so the tab is provably gone from the whole repository
   * rather than only from the file it was declared in.
   */
  it('🔴 nothing anywhere in src refers to platform as a TAB', () => {
    const offenders: string[] = [];
    const TAB_SHAPES = [
      /data-tab-placeholder="platform"/,
      /tabs-trigger[^\n]*platform/,
      /value="platform"/,
      /DEFAULT_DASHBOARD_TAB\s*=\s*'platform'/,
      /tab(?:Id)?\s*[:=]\s*['"]platform['"]/,
    ];
    // ⚠️ Test files excluded. THE-276's suite and this one both SPELL these
    // shapes inside negative assertions — that is them doing their job, and a
    // sweep that counted them could never be satisfied.
    for (const file of walkSrc().filter((f) => !f.includes(`${path.sep}__tests__${path.sep}`))) {
      const src = readFileSync(file, 'utf8');
      for (const shape of TAB_SHAPES) {
        if (shape.test(src)) offenders.push(`${rel(file)}: ${shape.source}`);
      }
    }
    expect(offenders, 'something still names platform as a tab').toEqual([]);
  });

  /**
   * ⚠️ THE OTHER HALF OF THE SAME CLAIM, and the reason the sweep above is
   * narrow: the super-admin concept is NOT collateral. `analytics-permission.ts`
   * is untouched, `assertConcreteScope` still exists, and the apex answer is
   * still the apex answer.
   */
  it('🔴 the super-admin concept is untouched by the removal', () => {
    const permission = read('src/components/dashboard/analytics-permission.ts');
    expect(sha256(permission)).toBe(ANALYTICS_PERMISSION_SHA);
    expect(permission).toMatch(/isSuperAdmin/);

    // ⚠️ It lives in `lib/member-deletion`, not in `utils/query-helpers` —
    // checked rather than assumed, because a guard pointed at the wrong file
    // would pass by describing nothing.
    expect(read('src/lib/member-deletion.ts'))
      .toMatch(/export function assertConcreteScope/);

    // The apex string itself, in the one module that owns it.
    expect(read('src/components/dashboard/dashboard-data.ts'))
      .toMatch(/No ministry is in scope/);
  });
});

/**
 * `analytics-permission.ts` — the file THE-299 may not open.
 *
 * ⚠️ MOVED BY THE-302, and the value is REPLACED rather than appended because
 * this pin has always held exactly one — the same treatment THE-293 and THE-301
 * gave theirs. The previous value is recorded here so the move is on the record
 * and a future reader can see what it was:
 *
 *   a8749371e01c50184d02d5253100fbbe40c0e48be429805a3ab330b2d15a8439
 *     — `analytics-permission.ts` at 915d818, where THE-299 branched.
 *
 * 🔴 WHY IT MOVED, AND WHY THAT IS NOT WHAT THIS GUARD WATCHES FOR. A tenant
 * owner on a paid plan could not see any dashboard: no provisioning path — free,
 * Dodo or Stripe — writes a `permissions` key onto the buyer's `users/{uid}`, so
 * the gate's `fullAccess`/`analytics` terms were both `undefined` and the person
 * who bought the church was told to ask an admin. THE-302 adds ONE term,
 * `tenants/{id}.ownerId === the signed-in uid`, and the whole diff to this file
 * is that term: a fourth argument on `canViewAnalytics` defaulting to false, the
 * `|| isTenantOwner` clause, and a helper that reads `ownerId` off the
 * world-readable tenant document.
 *
 * ⚠️ NOTHING ON THE SUPER-ADMIN PATH IS IN THAT DIFF. `isSuperAdminEmail`, the
 * `role === ROLE_SUPER_ADMIN` term and the order they are evaluated in are
 * byte-identical; the new term is additive and can only ever grant.
 *
 * 🔴 A HASH PROVES A FILE DID NOT CHANGE, NOT THAT A CONCEPT STILL WORKS — so
 * all three legs of this guard's claim are now asserted behaviourally too, and
 * the assertion below is kept rather than relaxed:
 *
 *   super_admin   `the-302-analytics-owner.test.tsx` — the email arm resolves
 *                 `granted` with NO user document and a tenant owned by someone
 *                 else, and the ROLE arm grants on a tenant it does not own,
 *                 with ownership false in both.
 *   apex answer   the same file, reading `REASON.noTenant` from the module that
 *                 owns the string rather than grepping for it.
 *   concrete scope  `api/account/__tests__/member-erasure.test.ts` and
 *                 `member-export.test.ts` already call `assertConcreteScope`
 *                 directly — it throws on every non-concrete value and returns
 *                 a concrete one. Not duplicated here.
 */
const ANALYTICS_PERMISSION_SHA =
  '720fd2b4dc662e9580353864d865e8c717aa4c9419126814bd742ff150fdeaea';

function walkSrc(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
    }
  };
  walk(path.join(REPO_ROOT, 'src'));
  return out;
}

/* ═══ 2 · No emoji, no inline style, no hardcoded colour ════════════════════ */

describe('no emoji, no inline style, no hardcoded colour', () => {
  /**
   * The bar is ZERO. The dashboard files carry no inline style at all and this
   * slice keeps it there — an inline style out-ranks every stylesheet rule, so a
   * themed token can never override one.
   *
   * 🔴 THIS IS THE BAR THE INSTALLED COMPONENT COULD NOT MEET. Upstream's two
   * files carry thirteen `style={{ … }}` blocks between them (hover opacity,
   * transitions and a CSS animation shorthand). All three effects are dropped
   * here rather than exempted; see `RetentionHeatmap`'s header.
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

  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

  it.each(TOUCHED_FILES)('%s uses no emoji outside its comments', (file) => {
    const found = codeOf(file).match(EMOJI);
    expect(found, `${file} carries ${found?.[0]} in code`).toBeNull();
  });

  it('the heatmap icon is a lucide component, like every other widget icon', () => {
    expect(read('src/components/dashboard/RetentionHeatmap.tsx')).toMatch(/from 'lucide-react'/);
  });

  it.each(TOUCHED_FILES)('%s contains no hex literal', (file) => {
    const hexes = codeOf(file).match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexes, `${file} hardcodes ${hexes.join(', ')}`).toHaveLength(0);
  });

  it.each(TOUCHED_FILES)('%s contains no rgb/hsl/oklch literal', (file) => {
    const fns = codeOf(file).match(/\b(?:rgba?|hsla?|oklch|lab)\s*\(/g) ?? [];
    expect(fns, `${file} hardcodes ${fns.join(', ')}`).toHaveLength(0);
  });

  /**
   * 🔴 The whole file, comments included, for the raw ramp — because
   * `theming-gaps.test.ts` scans raw source and is right to: a class name in a
   * comment is still a class name to Tailwind's own scanner. This slice's first
   * draft of `RetentionHeatmap`'s header quoted upstream's spellings verbatim
   * and tripped that guard, which is how the rule was learned rather than
   * assumed.
   */
  it('no raw Tailwind palette step is spelled anywhere, comments included', () => {
    const RAMP = /\b(?:bg|text|border|ring|fill|stroke|from|via|to|divide|outline)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;
    for (const file of TOUCHED_FILES) {
      const hits = read(file).match(RAMP) ?? [];
      expect(hits, `${file} spells ${hits.join(', ')}`).toHaveLength(0);
    }
  });
});

/* ═══ 3 · 🔴 The colour scale: every cell, every palette, every ratio ═══════ */

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
const classicLightVars = varsIn((s) => s.includes('data-palette="classic"') && s.includes('data-theme="light"'));
const classicDarkVars = varsIn(
  (s) => s.includes('data-palette="classic"') && (s.includes('.dark') || s.includes('data-theme="dark"')),
);

/** 🔴 Classic FIRST — it is the default since #409, so it is the primary case. */
const PALETTES: Record<string, Record<string, string>> = {
  'Classic light': { ...rootVars, ...classicLightVars },
  'Classic dark': { ...rootVars, ...darkVars, ...classicDarkVars },
  'Harvest light': { ...rootVars },
  'Harvest dark': { ...rootVars, ...darkVars },
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

describe('🔴 every cell number clears AA against its own cell colour, in all four palettes', () => {
  /**
   * The cell colour the browser actually paints.
   *
   * `color-mix(in srgb, var(--muted) N%, var(--chart-2))` is a linear sRGB
   * interpolation from the track toward the hue, which is exactly what
   * `accentTintGround(hue, track, pct)` computes — the helper THE-61 wrote for
   * the accent-chip derivation, reused here rather than a second copy of the
   * same arithmetic. Nothing below is a hand-typed hex: every value is resolved
   * out of globals.css at assertion time, so a palette edit moves these numbers
   * instead of leaving them describing a stylesheet that no longer exists.
   */
  const cellColour = (palette: Record<string, string>, band: number): string => {
    const track = resolve(palette['--muted'], palette);
    const hue = resolve(palette['--chart-2'], palette);
    expect(track, 'no --muted').toBeTruthy();
    expect(hue, 'no --chart-2').toBeTruthy();
    return accentTintGround(hue!, track!, BAND_MIX[band]);
  };

  it.each(Object.keys(PALETTES))('%s: all six bands clear 4.5:1', (name) => {
    const palette = PALETTES[name];
    const ink = resolve(palette['--text-strong'], palette);
    expect(ink, `${name} has no --text-strong`).toBeTruthy();

    const ladder = BAND_MIX.map((mix, band) => {
      const cell = cellColour(palette, band);
      return { mix, cell, ratio: Number(contrastRatio(cell, ink!).toFixed(2)) };
    });

    const failing = ladder.filter((r) => r.ratio < AA_CONTRAST);
    expect(
      failing,
      `${name}: ${failing.map((r) => `${r.mix}% ${r.cell} is ${r.ratio}:1 on ${ink}`).join('; ')}`,
    ).toEqual([]);

    // 🔴 And the ladder is a real ladder — six distinct colours, not one repeated.
    expect(new Set(ladder.map((r) => r.cell)).size).toBe(BAND_MIX.length);
  });

  /**
   * 🔴 THE CAP IS LOAD-BEARING, AND THIS IS THE PROOF. One step past the top of
   * the scale, the number stops clearing AA on a dark ground. If this ever
   * passes, the cap has become arbitrary and the comment explaining it is
   * wrong; if the scale is raised, this is the assertion that has to be
   * confronted rather than a comment that can be skimmed.
   */
  it('🔴 65% would fail — the 60% cap is not a taste decision', () => {
    const palette = PALETTES['Classic dark'];
    const track = resolve(palette['--muted'], palette)!;
    const hue = resolve(palette['--chart-2'], palette)!;
    const ink = resolve(palette['--text-strong'], palette)!;
    expect(contrastRatio(accentTintGround(hue, track, 65), ink)).toBeLessThan(AA_CONTRAST);
    expect(contrastRatio(accentTintGround(hue, track, 60), ink)).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it('the two unreadable series slots are not used at any strength', () => {
    for (const file of TOUCHED_FILES) {
      expect(codeOf(file), file).not.toMatch(/--chart-4|--chart-5/);
    }
  });

  /**
   * 🔴 A class that produces no rule paints NOTHING — the "token invented by
   * use" failure. `ds-primitives.audit`'s extractor reads `className` and
   * `cn()` positions and never sees a lookup table like `BAND_FILL`, so the
   * compiled stylesheet is queried for each of the six by name instead. This
   * caught the first spelling of that table, which compiled to nothing.
   */
  it('🔴 Tailwind emits a real rule for every band, in the app build', async () => {
    const css = await buildAppCss();
    const SPECIAL = new Set(['.', '[', ']', '(', ')', '%', ',', '/']);
    const selectorFor = (cls: string) =>
      '.' + [...cls].map((ch) => (SPECIAL.has(ch) ? `\\${ch}` : ch)).join('');

    const missing = BAND_FILL.filter((cls) => !css.includes(selectorFor(cls)));
    expect(missing, `Tailwind generated no rule for ${missing.join(', ')}`).toEqual([]);

    // 🔴 And the fallback outside `@supports` is the TRACK, not the hue. A
    // browser without color-mix gets a flat uncoloured grid whose numbers are
    // all still legible, rather than every cell at full strength — which is
    // 2.27:1 against its own number in Classic dark.
    for (const cls of BAND_FILL) {
      const at = css.indexOf(selectorFor(cls));
      const rule = css.slice(at, at + 120).replace(/\s+/g, ' ');
      expect(rule, `${cls} falls back to something other than --muted`)
        .toContain('fill: var(--muted);');
    }
    // ⚠️ 60s. This compiles the app's whole stylesheet in process, which runs
    // 3–13s depending on how many workers are competing for the machine — well
    // past vitest's 5s default, and a timeout here would read as "the classes
    // do not compile", which is the opposite of what it would mean.
  }, 60_000);

  it('the bands are a partition — every share lands in exactly one', () => {
    expect(BAND_FILL).toHaveLength(BAND_MIX.length);
    expect(BAND_LABEL).toHaveLength(BAND_MIX.length);
    for (let share = 0; share <= 100; share += 0.5) {
      const band = bandOf(share);
      expect(Number.isInteger(band)).toBe(true);
      expect(band).toBeGreaterThanOrEqual(0);
      expect(band).toBeLessThan(BAND_FILL.length);
    }
    // Zero is its own band: "none active" is not "few active".
    expect(bandOf(0)).toBe(0);
    expect(bandOf(0.4)).toBe(1);
    expect(bandOf(100)).toBe(BAND_FILL.length - 1);
  });
});

/* ═══ 4 · All four palettes resolve every token this slice leans on ═════════ */

describe('all four palettes resolve every token this slice leans on', () => {
  const USED = [
    '--muted', '--chart-2', '--text-strong', '--text-body', '--text-muted',
    '--border', '--muted-foreground', '--card', '--card-foreground',
  ] as const;

  it.each(Object.entries(PALETTES))('%s resolves each of them to a real value', (name, scope) => {
    for (const token of USED) {
      expect(resolve(scope[token], scope), `${name} ${token}`).toBeTruthy();
    }
  });

  it('Classic is genuinely distinct from Harvest — the four are not two copies', () => {
    expect(resolve(PALETTES['Classic light']['--muted'], PALETTES['Classic light']))
      .not.toBe(resolve(PALETTES['Harvest light']['--muted'], PALETTES['Harvest light']));
  });
});

/* ═══ 5 · No new token was defined ═════════════════════════════════════════ */

describe('no new token was defined', () => {
  it('globals.css is byte-identical — the bridge has held through five batches', () => {
    expect(sha256(read('src/app/globals.css')))
      .toBe('772c79af681c2b97c496b91be4f2573415f2a65802dfac078dbc72e8a8fd3741');
    expect(rootVars['--chart-5']).toBeTruthy();
    expect(rootVars['--chart-6']).toBeUndefined();
  });

  it('no file in this slice declares a custom property', () => {
    for (const file of TOUCHED_FILES) {
      const declared = codeOf(file).match(/(?<![\w-])--[\w-]+\s*:/g) ?? [];
      expect(declared, `${file} declares ${declared.join(', ')}`).toHaveLength(0);
    }
  });

  it('every custom property these files reference already exists in globals.css', () => {
    const declared = new Set(Object.keys(rootVars));
    for (const map of [darkVars, classicLightVars, classicDarkVars]) {
      for (const key of Object.keys(map)) declared.add(key);
    }
    const globals = read('src/app/globals.css');
    for (const file of TOUCHED_FILES) {
      for (const [, name] of codeOf(file).matchAll(/var\((--[\w-]+)/g)) {
        if (name.startsWith('--color-')) continue;
        expect(declared.has(name) || globals.includes(`${name}:`), `${file} references undeclared ${name}`).toBe(true);
      }
    }
  });

  it('tailwind.config.ts and components.json are byte-identical too', () => {
    expect(sha256(read('tailwind.config.ts')))
      .toBe('32af690fa7f32c4e568deb8b66ff827ffbace309a07a83ff0d4582dd2cd15749');
    // 🔴 The install did NOT register the registry. `registries: {}` is still
    // empty, so nothing in this repo can pull from spectrum without the full
    // URL being typed again — which is the review step that caught the engine.
    const components = JSON.parse(read('components.json')) as { registries: Record<string, unknown> };
    expect(components.registries).toEqual({});
  });
});

/* ═══ 6 · 🔴 No orderBy, no composite constraint, no index ══════════════════ */

describe('no query this slice builds carries an orderBy or a composite constraint', () => {
  /**
   * 🔴 `contactActivities.createdAt` HOLDS BOTH TIMESTAMPS AND ISO STRINGS.
   * Firestore orders ACROSS TYPES BY TYPE FIRST, so `orderBy('createdAt')`
   * returns every string row before any Timestamp row. Stable, and not
   * chronological. `users` has no `(tenantId, createdAt)` composite index
   * either, and one added to `firestore.indexes.json` would be INERT.
   */
  it('the word `orderBy` appears in no file this slice touches', () => {
    for (const file of TOUCHED_FILES) {
      expect(codeOf(file), file).not.toMatch(/orderBy/);
    }
  });

  it('🔴 every query is built through scopedQuery — no file writes its own where', () => {
    for (const file of TOUCHED_FILES) {
      const wheres = codeOf(file).match(/where\(/g) ?? [];
      expect(wheres, `${file} builds its own where clause`).toHaveLength(0);
    }
    const hook = codeOf('src/components/dashboard/useGrowthData.ts');
    // Three collections, each through the one-equality helper and its bounded twin.
    for (const name of ['users', 'contacts', 'contactActivities']) {
      expect(hook, `${name} is not read through scopedQuery`).toContain(`'${name}'`);
    }
    expect((hook.match(/completeRead/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('the deploy workflow really does exclude the index file — the premise, checked', () => {
    const workflow = read('.github/workflows/deploy-rules.yml');
    expect(workflow).toMatch(/firestore:rules,storage/);
    expect(workflow).not.toMatch(/firestore:indexes/);
  });

  /** The premises this slice's headers assert, checked against the real writers. */
  it('the facts this slice is built on are still true of the code that writes the documents', () => {
    expect(read('src/hooks/queries/useCRMQueries.ts')).toMatch(/export const CRM_FETCH_LIMIT = 1000;/);

    // `createdAt` on contactActivities is written as two different types.
    expect(read('src/lib/donation-webhook.ts')).toMatch(/createdAt: nowIso/);
    expect(read('src/app/api/crm/send-email/route.ts')).toMatch(/createdAt: new Date\(\)\.toISOString\(\)/);
    expect(read('src/app/api/checkin/submit/route.ts')).toMatch(/createdAt: FieldValue\.serverTimestamp\(\)/);

    // 🔴 THE PREMISE THE TICKET DID NOT CARRY: `contactId` is a CRM contact id
    // in five writers, and a `users` doc id in AdminCRM, because the CRM
    // synthesises members into Contacts keyed by uid. Both halves, checked.
    for (const writer of [
      'src/app/api/checkin/submit/route.ts',
      'src/app/api/forms/submit/route.ts',
      'src/app/api/event-registration/submit/route.ts',
    ]) {
      expect(read(writer), writer).toMatch(/collection\('contacts'\)\.where\('email', '==', email\)/);
      expect(read(writer), writer).toMatch(/contactId: (?:match|ref)\.id/);
    }
    expect(read('src/hooks/queries/useCRMQueries.ts')).toMatch(/userDocToMemberContact/);
    expect(read('src/components/AdminCRM.tsx')).toMatch(/contactId: selected\.id/);

    // 🔴 And the link rule is the app's own — member-erasure's two queries.
    const erasure = read('src/lib/member-erasure.ts');
    expect(erasure).toMatch(/collection\('contacts'\)\.where\('userId', '=='/);
    expect(erasure).toMatch(/collection\('contacts'\)\.where\('email', '=='/);
  });
});

/* ═══ 7 · 🔴 Provenance: installed, and what was kept of it ═════════════════ */

describe('the component was installed from a registry, not invented', () => {
  /**
   * The two files `npx shadcn add https://ui.spectrumhq.in/r/cohort-chart.json`
   * wrote, byte for byte as the CLI produced them, recorded so a later reader
   * can re-fetch and diff. 🔴 NEITHER IS IN THE TREE, and that is the decision
   * this ticket had to make rather than a step it skipped:
   *
   *   · `chart-engine.tsx` is 1,036 lines of a general chart library — bars,
   *     lines, arcs, six skeleton variants, a seeded RNG for demo data — of
   *     which the cohort grid uses nine helpers, and every colour in it is a
   *     literal hex or a raw ramp step. Keeping it would have failed
   *     `theming-gaps.test.ts` permanently, for a file nothing renders.
   *   · `cohort-chart.tsx` fails the same guard on its own, defaults its `data`
   *     prop to seeded FABRICATED cohorts, and renders nothing at all until a
   *     `ResizeObserver` has reported a width — which is invisible to this
   *     repo's static-markup layout guards.
   *
   * What survives is in `RetentionHeatmap.tsx`, named in its header: the grid
   * geometry and its constants, the layout, the pooled summary row, the spoken
   * `aria-label`, and the screen-reader data table.
   */
  const UPSTREAM = {
    'cohort-chart.tsx': '8a8f14033a1cfdb8fd3de3a8400dc26ee89bd10574e5baa8fa07b1c79919b3b0',
    'chart-engine.tsx': '7b3263158f40b58a432aa1cc5d2f100c2681b5d5a5f619ed115567c5b56a27e4',
  } as const;

  it('the upstream digests are recorded, and neither file is in the tree', () => {
    expect(Object.keys(UPSTREAM)).toHaveLength(2);
    expect(existsSync(path.join(REPO_ROOT, 'src/components/spectrumui'))).toBe(false);
    for (const file of walkSrc()) {
      expect(rel(file), 'an upstream registry file is still in src/').not.toMatch(/spectrumui|chart-engine/);
    }
  });

  it('🔴 nothing from spectrum\'s heavy catalogue entered the tree', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    // The exact reason spectrum was rejected as a registry on card 86bbr6rz6.
    for (const banned of ['@react-three/fiber', '@react-three/rapier', '@react-three/drei', 'meshline', 'framer-motion']) {
      expect(all[banned], `${banned} entered the tree`).toBeUndefined();
    }
    /*
     * ⚠️ `motion` IS installed, and it was BEFORE this ticket — it is the
     * current package name for framer-motion and predates the dashboard
     * entirely. Asserting its ABSENCE would be a false claim about this repo,
     * so the claim made instead is that its version did not move and that
     * nothing in this slice reaches for it. package.json's digest below pins
     * the first half; naming it here stops a later reader concluding this slice
     * let it in.
     */
    expect(all['motion']).toBe('^12.38.0');
    for (const file of TOUCHED_FILES) {
      expect(codeOf(file), `${file} reached for motion`).not.toMatch(/from ['"]motion/);
    }
    const lock = read('package-lock.json');
    for (const banned of ['@react-three/fiber', '@react-three/rapier', 'meshline']) {
      expect(lock.includes(`"node_modules/${banned}"`), `${banned} is in the lockfile`).toBe(false);
    }
  });

  /**
   * ⚠️ AMENDED BY THE-319, and the list is APPENDED TO rather than replaced.
   *
   * The original claim — "nothing new" — was about the REGISTRY: this widget was
   * installed from spectrum and the point was that it dragged in no npm package
   * and no chart library. That claim is intact and the assertions around it are
   * untouched. What THE-319 adds is `../ui/table`, which is not "new" in that
   * sense at all: it is a primitive this repo already had installed and already
   * had three adopters of, and it replaces the plain `<table>` THE-299 wrote by
   * hand for the screen-reader data table. Nothing else moved.
   *
   * 🔴 A SIXTH entry still fails, so the list stays closed. In particular
   * `../ui/chart` would still fail here, which is the point: recharts has no
   * heatmap, and the visible grid is deliberately still an SVG.
   */
  it('and the widget imports nothing new — react, lucide, this repo and ui/table only', () => {
    const imports = [...read('src/components/dashboard/RetentionHeatmap.tsx')
      .matchAll(/^import[\s\S]*?from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual([
      '../ui/table', './WidgetFrame', './growth-data', './retention-data', 'lucide-react', 'react',
    ]);
    // No Radix-flavoured API arrived with it either. Against the CODE: the
    // header discusses `asChild` at length, and prose is not an API.
    expect(codeOf('src/components/dashboard/RetentionHeatmap.tsx')).not.toMatch(/asChild|@radix-ui/);
  });
});

/* ═══ 8 · No npm dependency was added ══════════════════════════════════════ */

describe('no npm dependency was added', () => {
  it('package.json and package-lock.json are byte-identical', () => {
    expect(sha256(read('package.json')))
      .toBe('1b2c57071a210a6b07302d2ba6bd90686bf0be05c2fe12e0fb3b197b8ac97da2');
    expect(sha256(read('package-lock.json')))
      .toBe('da626030b980aab1bcbe9ec608c563ca92ceda7970f416ea4f4ed6eeb86b8b84');
  });

  it('and no chart or date library was reached for', () => {
    /*
     * ⚠️ IMPORTS, not mentions. `growth-data`'s geo deferral names
     * react-simple-maps inside a user-facing reason STRING, and saying which
     * dependency the map would cost is the entire point of that sentence. A
     * guard that matched the word would be asserting the sentence away.
     */
    for (const file of TOUCHED_FILES) {
      const imports = [...codeOf(file).matchAll(/from ['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const banned of ['recharts', 'date-fns', 'd3', 'react-simple-maps', '@tanstack/react-table']) {
        expect(
          imports.some((i) => i === banned || i.startsWith(`${banned}/`)),
          `${file} imports ${banned}`,
        ).toBe(false);
      }
    }
  });
});

/* ═══ 9 · The pinned files, and the primitives ═════════════════════════════ */

/**
 * ⚠️ A SET per file, not a single digest, for THE-276's reason: CI runs against
 * `refs/pull/N/merge`, so a file another ticket legitimately lands on `main`
 * holds a different value there than on this branch. A value that is NEITHER —
 * i.e. this ticket editing the file — still fails, which is the whole threat.
 */
const UNTOUCHED: Record<string, ReadonlyArray<readonly [digest: string, source: string]>> = {
  'src/components/AdminDashboard.tsx': [
    ['446f0bcb8ffa6accf4f80467b75a50023c1441937605b11e18aa01b53d8e53f8', 'main at 915d818 — the value THE-291 (#434) left and THE-294 accepts'],
    ['722c5e4478be0a8508e7dff1232dd4c1f88cacdd502604f946f3134eb730d98c', 'main before #434 — the value THE-276, THE-283 and THE-290 accept'],
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
  ],
  'firestore.indexes.json': [
    ['8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0', 'main at 133d557'],
  ],
};

function functionsTree(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'lib' || entry === '.git') continue;
      const p = path.join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(rel(p));
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

  /**
   * ⚠️ Paths are normalised to forward slashes before hashing. The identical
   * guard in THE-276/283/290/294 hashes `path.relative` output verbatim, which
   * makes it a WINDOWS-ONLY failure in an otherwise green local run — the tree
   * itself is identical, only the separator differs. Normalising costs nothing
   * and makes the same claim on both platforms; the digest is unchanged.
   */
  it('functions/ is unchanged, file for file', () => {
    const files = functionsTree();
    expect(files).toHaveLength(5);
    const tree = sha256(files.map((f) => `${f}:${sha256(readFileSync(path.join(REPO_ROOT, f)))}`).join('\n'));
    expect(tree).toBe('1a3a1c7f27699263bcdf5bd0320c7cb0803a6f76644952f631000bc9bedef2d7');
  });

  /**
   * 🔴 Every pre-existing primitive, pinned as ONE literal tree digest computed
   * at 915d818. This PR regenerates no fixture, so there is no
   * `primitive-digests.json` to compare against itself — the claim is against a
   * value written here by hand.
   */
  it('all 43 ui primitives are byte-identical — this slice installed none', () => {
    const files = readdirSync(path.join(REPO_ROOT, 'src/components/ui'))
      .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
      .sort()
      .map((f) => `src/components/ui/${f}`);
    expect(files).toHaveLength(43);
    const tree = sha256(files.map((f) => `${f}:${sha256(readFileSync(path.join(REPO_ROOT, f)))}`).join('\n'));
    expect(tree).toBe('f02a80fe809b4ff8a1cb4eaceb2deb4e28ad090f85d6682c1e862fd674a50aa7');
  });

  it('nothing in this slice imports the shell it may not open, or a parallel ticket\'s files', () => {
    for (const file of TOUCHED_FILES) {
      const code = codeOf(file);
      expect(code, file).not.toMatch(/from\s+['"][^'"]*AdminDashboard['"]/);
      expect(code, file).not.toMatch(/from\s+['"][^'"]*MainApp['"]/);
      expect(code, file).not.toMatch(/from\s+['"][^'"]*\/settings\//);
      expect(code, file).not.toMatch(/adminDb|firebase-admin/);
      expect(code, file).not.toMatch(/from\s+['"][^'"]*app\/api\//);
    }
  });

  /**
   * ⚠️ THE-272's adopter list is a CLOSED table and a second adopter of any
   * primitive on it still fails there. THE-299 adopted NOTHING: its accessible
   * table was a plain `<table>` rather than `ui/table`, which would have been a
   * fourth adopter it had not recorded.
   *
   * ⚠️ AMENDED BY THE-319, and NARROWED BY EXACTLY ONE PAIR rather than dropped.
   *
   * THE-319 is the composition sweep, and "a grid of data is `table`" is the
   * whole of its mapping. So `RetentionHeatmap` adopts `ui/table` for that
   * screen-reader table, DELIBERATELY, and it is recorded as THE-272's fourth
   * adopter in `the-272-shadcn-batch-b.test.ts` — where a fifth still fails.
   * The assertion below is the same assertion with that one pair excepted, so
   * every other combination this ticket could have reached for still fails:
   *
   *   🔴 `ui/chart` in the heatmap still fails, and that is the important one.
   *      recharts has no heatmap and renders nothing under happy-dom; the
   *      visible grid stays an SVG and this guard is what keeps it one.
   *   🔴 `ui/progress` and `ui/pagination` in the heatmap still fail. The bands
   *      are a colour scale and not a fraction of anything, and the widget
   *      REFUSES over its ceiling rather than paginating.
   *   🔴 Any of the four in `retention-data.ts` or `GrowthTab.tsx` still fails.
   */
  const THE_319_ADOPTED = new Set(['src/components/dashboard/RetentionHeatmap.tsx:table']);

  it('🔴 this slice adopts no ui primitive beyond THE-319\'s table, so THE-272\'s closed list holds', () => {
    for (const file of NEW_FILES) {
      const code = codeOf(file);
      for (const primitive of ['table', 'chart', 'progress', 'pagination']) {
        if (THE_319_ADOPTED.has(`${file}:${primitive}`)) continue;
        expect(code, `${file} adopts ui/${primitive}`)
          .not.toMatch(new RegExp(`from ['"](?:@/components|\\.{1,2}(?:/[\\w.-]+)*)/ui/${primitive}['"]`));
      }
    }
    // 🔴 And the one exception is not vacuous: the adoption it excepts is real.
    expect(codeOf('src/components/dashboard/RetentionHeatmap.tsx'))
      .toMatch(/from '\.\.\/ui\/table'/);
  });
});

/* ═══ 10 · No-regression: the deleted widgets and the money gate ═══════════ */

describe('the widgets #438 deleted are still absent, and the money gate still refuses', () => {
  it('reach, impressions, blog views and completions-over-time are in no source file', () => {
    for (const file of TOUCHED_FILES) {
      const code = codeOf(file);
      expect(code, file).not.toMatch(/\breach\b/i);
      expect(code, file).not.toMatch(/\bimpressions?\b/i);
      expect(code, file).not.toMatch(/blog views|page views/i);
      expect(code, file).not.toMatch(/completions over time/i);
    }
    // And the record of WHY is still where THE-294 put it.
    expect(read('src/components/dashboard/ContentTab.tsx')).toMatch(/DELETED_CONTENT_WIDGETS/);
  });

  it('🔴 toInvoiceRow still refuses a missing amount rather than coercing it to zero', () => {
    const data = read('src/components/dashboard/dashboard-data.ts');
    expect(data).toMatch(/unreadableReceipts/);
    // The coercion #421 caught. If this ever matches again, money is being lost.
    expect(data).not.toMatch(/amount.*\?\?\s*0/);
    expect(data).not.toMatch(/Number\(.*amount.*\)\s*\|\|\s*0/);
  });

  /**
   * 🔴 The strongest form of "no money coercion" available here: these files do
   * not read a money field AT ALL. `toActivityStamp` deliberately maps only
   * `contactId` and `createdAt`, so `amount` — the field #421 caught being
   * coerced to `0` — never enters this slice's memory and cannot be lost in it.
   *
   * ⚠️ A blanket ban on `?? 0` would be the WRONG guard, and it was tried:
   * `retention-data` is full of `map.get(k) ?? 0` bucket increments, which
   * default a COUNT that is definitionally zero before anything has been
   * counted. That is not the defect. A missing AMOUNT read as zero money is.
   */
  it('and this slice reads no money field at all', () => {
    for (const file of NEW_FILES) {
      expect(codeOf(file), file).not.toMatch(/amount/i);
      expect(codeOf(file), file).not.toMatch(/\bcents\b|totalDonated|invoice/i);
    }
  });
});

/* ═══ 11 · The window is a constant, and the grid is bounded by it ═════════ */

describe('the grid cannot grow without bound', () => {
  it('twelve months, declared once and used by both the data and the view', () => {
    expect(RETENTION_MONTHS).toBe(12);
    expect(codeOf('src/components/dashboard/RetentionHeatmap.tsx')).toMatch(/RETENTION_MONTHS/);
    expect(codeOf('src/components/dashboard/useGrowthData.ts')).toMatch(/RETENTION_MONTHS/);
  });
});
