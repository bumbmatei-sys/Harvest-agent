import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

import { GLOBALS_CSS, REPO_ROOT } from '../test/support/tailwind-build';

/**
 * THE-294 — the static guards: what this slice was not allowed to add.
 *
 * The rendered behaviour is in
 * `components/__tests__/the-294-engagement-tab.test.tsx` and the layout in
 * `the-294-engagement-layout.test.tsx`. What is here is the set of things only
 * visible in the SOURCE — a hardcoded hex, an inline style, a minted token, a
 * new dependency, a new index, an `orderBy` on a mixed-type field, an edit to a
 * file another ticket owns.
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
  'src/components/dashboard/engagement-data.ts',
  'src/components/dashboard/useEngagementData.ts',
  'src/components/dashboard/ActivityTypes.tsx',
  'src/components/dashboard/AttendanceCard.tsx',
  'src/components/dashboard/EngagementSpread.tsx',
  'src/components/dashboard/EngagementTab.tsx',
  'src/components/dashboard/content-data.ts',
  'src/components/dashboard/useContentData.ts',
  'src/components/dashboard/CourseCompletion.tsx',
  'src/components/dashboard/ContentTab.tsx',
  // Modified by this slice, so they come under the same bars.
  'src/components/dashboard/dashboard-data.ts',
  'src/components/dashboard/DashboardTabs.tsx',
  'src/components/AdminDashboardHome.tsx',
] as const;

/** The files this slice ADDS. Some claims are only about new code. */
const NEW_FILES = TOUCHED_FILES.slice(0, 10);

/** Source with block and line comments stripped — the code, not the prose. */
function codeOf(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/* ═══ 15a · No inline style ══════════════════════════════════════════════════ */

describe('no emoji, no inline style, no hardcoded colour', () => {
  /**
   * The bar is ZERO. The dashboard files carry no inline style at all and this
   * slice keeps it there — an inline style out-ranks every stylesheet rule, so a
   * themed token can never override one.
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

  /* ═══ 15b · No emoji reaches a screen ═════════════════════════════════════ */

  /**
   * 🔴 Comments are stripped first. This repo's house style uses 🔴 and ⚠️
   * heavily in prose to mark the load-bearing notes, and those are
   * documentation. What is banned is an emoji that can reach a SCREEN.
   */
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

  it.each(TOUCHED_FILES)('%s uses no emoji outside its comments', (file) => {
    const found = codeOf(file).match(EMOJI);
    expect(found, `${file} carries ${found?.[0]} in code`).toBeNull();
  });

  it('every icon on the two new tabs is a lucide component', () => {
    for (const file of [
      'src/components/dashboard/ActivityTypes.tsx',
      'src/components/dashboard/AttendanceCard.tsx',
      'src/components/dashboard/EngagementSpread.tsx',
      'src/components/dashboard/CourseCompletion.tsx',
    ]) {
      expect(read(file), file).toMatch(/from 'lucide-react'/);
    }
  });

  /* ═══ 15c · No colour is hardcoded ════════════════════════════════════════ */

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

  it('the Engagement tab names no series colour of its own — it reuses CHART_VARS', () => {
    const tab = codeOf('src/components/dashboard/EngagementTab.tsx');
    expect(tab).toMatch(/CHART_VARS/);
    // No `var(--chart-N)` spelled directly: the five slots are declared once, in
    // GivingMix, and referenced by index everywhere else.
    expect(tab).not.toMatch(/var\(--chart-\d\)/);
    // And the four non-charting widgets name no colour at all.
    for (const file of [
      'src/components/dashboard/ActivityTypes.tsx',
      'src/components/dashboard/AttendanceCard.tsx',
      'src/components/dashboard/EngagementSpread.tsx',
      'src/components/dashboard/CourseCompletion.tsx',
      'src/components/dashboard/ContentTab.tsx',
    ]) {
      expect(codeOf(file), file).not.toMatch(/var\(--/);
    }
  });

  /**
   * ⚠️ KNOWN AND ACCEPTED, and asserted here so it is not "fixed" by accident.
   * `--chart-4`/`--chart-5` are 1.50:1 / 1.77:1 on light and `progress` paints
   * `bg-primary` on `bg-muted` at 2.30:1. All three are recorded in both
   * directions in THE-272's guard. 🔴 THIS SLICE ADOPTS NEITHER LOW-CONTRAST
   * CHART SLOT and adopts `progress` NOWHERE — the two trends use `--chart-2`
   * and `--chart-3` — and it does not touch any of the three definitions.
   */
  it('the known contrast pairs are left exactly as they are', () => {
    const progress = read('src/components/ui/progress.tsx');
    expect(progress).toMatch(/bg-primary/);
    expect(progress).toMatch(/bg-muted/);
    for (const file of TOUCHED_FILES) {
      expect(codeOf(file), file).not.toMatch(/ProgressTrack|ProgressIndicator/);
      expect(codeOf(file), file).not.toMatch(/--chart-4|--chart-5/);
    }
    // And the two slots the trends DO use are the low-numbered ones.
    const tab = codeOf('src/components/dashboard/EngagementTab.tsx');
    expect(tab).toMatch(/CHART_VARS\[2\]/);
    expect(tab).toMatch(/CHART_VARS\[1\]/);
    expect(tab).not.toMatch(/CHART_VARS\[[34]\]/);
  });
});

/* ═══ 15d · All four palettes resolve, Classic first ════════════════════════ */

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

describe('all four palettes resolve every token this slice leans on', () => {
  /**
   * The semantic tokens the five new widgets reference, via the `ui/table`,
   * `ui/card` and `ui/empty` primitives and their own classes. Every one of them
   * is an EXISTING token; none is minted here.
   */
  const USED = [
    '--muted-foreground', '--foreground', '--card', '--card-foreground',
    '--border', '--muted',
  ] as const;

  it.each(Object.entries(PALETTES))('%s resolves each of them to a real value', (name, scope) => {
    for (const token of USED) {
      expect(resolve(scope[token], scope), `${name} ${token}`).toBeTruthy();
    }
  });

  it('and --chart-2 and --chart-3, the two series colours these trends plot, in all four', () => {
    for (const [name, scope] of Object.entries(PALETTES)) {
      expect(resolve(scope['--chart-2'], scope), `${name} --chart-2`).toBeTruthy();
      expect(resolve(scope['--chart-3'], scope), `${name} --chart-3`).toBeTruthy();
    }
  });

  it('Classic is genuinely distinct from Harvest — the four are not two copies', () => {
    expect(resolve(PALETTES['Classic light']['--background'], PALETTES['Classic light']))
      .not.toBe(resolve(PALETTES['Harvest light']['--background'], PALETTES['Harvest light']));
  });
});

/* ═══ 16 · No new token was defined ═════════════════════════════════════════ */

describe('no new token was defined', () => {
  it('no file in this slice declares a custom property', () => {
    for (const file of TOUCHED_FILES) {
      const declared = codeOf(file).match(/(?<![\w-])--[\w-]+\s*:/g) ?? [];
      expect(declared, `${file} declares ${declared.join(', ')}`).toHaveLength(0);
    }
  });

  /**
   * The stronger half: a token can also be "added" by REFERENCING one that does
   * not exist. `var(--engagement-accent)` compiles, resolves to nothing and
   * paints transparent — a token invented by use rather than by declaration.
   */
  it('every custom property these files reference already exists in globals.css', () => {
    const declared = new Set(Object.keys(rootVars));
    for (const map of [darkVars, classicLightVars, classicDarkVars]) {
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
    expect(rootVars['--chart-5']).toBeTruthy();
    expect(rootVars['--chart-6']).toBeUndefined();
  });
});

/* ═══ 17 · 🔴 No orderBy, no composite constraint, no index ═════════════════ */

describe('no query this slice builds carries an orderBy or a composite constraint', () => {
  /**
   * 🔴 `contactActivities.createdAt` HOLDS BOTH TIMESTAMPS AND ISO STRINGS.
   * Five writers use `serverTimestamp()` — /api/checkin/submit,
   * /api/forms/submit, /api/event-registration/submit,
   * lib/event-registration-webhook.ts and AdminCRM.tsx — and two write
   * `new Date().toISOString()`: lib/donation-webhook.ts and
   * /api/crm/send-email. Firestore orders ACROSS TYPES BY TYPE FIRST, so
   * `orderBy('createdAt')` returns every string row before any Timestamp row.
   * Stable, and not chronological.
   */
  it('the word `orderBy` appears in no file this slice adds', () => {
    for (const file of NEW_FILES) {
      expect(codeOf(file), file).not.toMatch(/orderBy/);
    }
  });

  it('and the modified shared files gained none either', () => {
    // `dashboard-data.ts` documents the same trap for `invoices.issuedAt` and
    // has never issued one; this slice's edit to it is a bucket-count parameter.
    expect(codeOf('src/components/dashboard/dashboard-data.ts')).not.toMatch(/orderBy\(/);
  });

  it('the completeness proof stands in for ordering on every read', () => {
    const engagement = codeOf('src/components/dashboard/useEngagementData.ts');
    expect((engagement.match(/completeRead/g) ?? []).length).toBeGreaterThanOrEqual(3);
    const content = codeOf('src/components/dashboard/useContentData.ts');
    expect((content.match(/completeRead/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('🔴 every top-level query carries the ONE tenant equality and no second where', () => {
    // A second `where` needs a composite index, and `firestore.indexes.json`
    // DOES NOT DEPLOY ON MERGE — `deploy-rules.yml` runs `firestore:rules,storage`
    // and its `paths:` filter does not include the file — so the query would
    // throw `failed-precondition` in production while every test stayed green.
    for (const file of NEW_FILES) {
      const wheres = codeOf(file).match(/where\(/g) ?? [];
      expect(wheres, `${file} builds its own where clause`).toHaveLength(0);
    }
    // The two data modules build their queries out of `scopedQuery`, which is
    // the single equality, or out of a subcollection path, which needs none.
    expect(codeOf('src/components/dashboard/engagement-data.ts')).toMatch(/scopedQuery/);
    expect(codeOf('src/components/dashboard/content-data.ts')).toMatch(/scopedQuery/);
  });

  it('the published-course filter runs in memory, not as a second where', () => {
    const hook = codeOf('src/components/dashboard/useContentData.ts');
    expect(hook).toMatch(/status === 'published'/);
    // 🔴 And it does NOT use `publishedCoursesQuery`, which carries two
    // equalities: this slice leans on no declared index at all.
    expect(hook).not.toMatch(/publishedCoursesQuery/);
  });

  it('the deploy workflow really does exclude the index file — the premise, checked', () => {
    const workflow = read('.github/workflows/deploy-rules.yml');
    expect(workflow).toMatch(/firestore:rules,storage/);
    expect(workflow).not.toMatch(/firestore:indexes/);
  });
});

/* ═══ 18 · The completion rule reads only what the cast promises ════════════ */

describe('the widening cast in countCompletions is checked, not believed', () => {
  /**
   * 🔴 `countCompletions` takes `Pick<Course, 'levels' | 'requireQuiz'>` and
   * casts it to `Course` at the one call site, because `verifyCourseCompletion`
   * is typed against the whole interface while reading only those two fields.
   * If either that function or the `getAllLessons` it calls grows a third field
   * access, the cast becomes a lie — so the source is parsed rather than trusted.
   */
  it('verifyCourseCompletion and getAllLessons touch only `levels` and `requireQuiz`', () => {
    const source = read('src/utils/course.utils.ts');
    const fn = (name: string) => {
      const start = source.indexOf(name);
      expect(start, `${name} is gone from course.utils.ts`).toBeGreaterThan(-1);
      return source.slice(start, start + 900);
    };
    const bodies = [fn('export const getAllLessons'), fn('export const verifyCourseCompletion')].join('\n');
    const fields = new Set([...bodies.matchAll(/\bcourse\.([a-zA-Z_$][\w$]*)/g)].map((m) => m[1]));
    expect([...fields].sort(), 'the completion rule reads a field the dashboard does not supply')
      .toEqual(['levels', 'requireQuiz']);
  });

  it('and the dashboard consults that one rule rather than writing a second', () => {
    const data = codeOf('src/components/dashboard/content-data.ts');
    expect(data).toMatch(/verifyCourseCompletion/);
    // No local reimplementation: no lesson walk, no completedLessons subset test.
    expect(data).not.toMatch(/flatMap\(/);
    expect(data).not.toMatch(/\.every\(/);
  });
});

/* ═══ 19 · The claims these widgets make about themselves ═══════════════════ */

describe('the two labels that would otherwise be false claims', () => {
  it('🔴 no file in this slice says "channel"', () => {
    for (const file of TOUCHED_FILES) {
      // Comments included, deliberately: the module headers explain why the word
      // is refused, so they are allowed to mention it — but no CODE may.
      expect(codeOf(file), `${file} spells "channel" in code`).not.toMatch(/channel/i);
    }
  });

  it('and the widget is titled "Activity type"', () => {
    expect(codeOf('src/components/dashboard/ActivityTypes.tsx')).toMatch(/title="Activity type"/);
  });

  it('the attendance widget names the attendeeCount drift in its own comment', () => {
    // 🔴 The ticket's requirement, asserted on the SOURCE: the field being summed
    // carries a known one-directional shortfall and the widget that sums it must
    // say so where the next reader of the code will see it.
    const source = read('src/components/dashboard/AttendanceCard.tsx');
    expect(source).toMatch(/attendeeCount/);
    expect(source).toMatch(/two sequential awaits|TWO SEQUENTIAL AWAITS/i);
    expect(source).toMatch(/no transaction/i);
    expect(source).toMatch(/short, never over/i);
    // And in the read layer that produces the number, too.
    expect(read('src/components/dashboard/engagement-data.ts')).toMatch(/DRIFT SHORT/);
  });

  it('and no file in this slice claims a completion series exists', () => {
    for (const file of NEW_FILES) {
      const code = codeOf(file);
      expect(code, `${file} builds a completion series`).not.toMatch(/completionSeries|completionsOverTime/);
    }
    // `bucketWeekly` is used for the two collections that CAN be bucketed and
    // for nothing on the Content tab.
    expect(codeOf('src/components/dashboard/content-data.ts')).not.toMatch(/bucketWeekly|weekBuckets/);
    expect(codeOf('src/components/dashboard/useContentData.ts')).not.toMatch(/bucketWeekly|weekBuckets/);
  });

  it('the deleted widgets are recorded where the tab list is defined', () => {
    const tab = read('src/components/dashboard/ContentTab.tsx');
    expect(tab).toMatch(/DELETED_CONTENT_WIDGETS/);
    expect(tab).toMatch(/FOUNDER DECISION/);
    // 🔴 And the table is NOT rendered: no `.map(` over it anywhere.
    expect(codeOf('src/components/dashboard/ContentTab.tsx'))
      .not.toMatch(/DELETED_CONTENT_WIDGETS\s*\.\s*map/);
    // The tab shell's own bookkeeping records the same removal.
    expect(read('src/components/dashboard/DashboardTabs.tsx')).toMatch(/THE-294 DELETED THREE OF THEM/);
  });

  it('no identifier field is read from any document this slice touches', () => {
    // 🔴 The privacy ceiling THE-283 set, enforced in the mappers. `description`
    // is free text an admin typed about a named person; `authorName` and
    // `request` are the prayer wall's own; `displayName` and `email` are the
    // member's. None is read.
    const mappers = [
      codeOf('src/components/dashboard/engagement-data.ts'),
      codeOf('src/components/dashboard/content-data.ts'),
    ].join('\n');
    for (const field of ['description', 'authorName', 'authorId', 'displayName', 'email', 'phone', 'request', 'prayedBy', 'firstName', 'lastName']) {
      expect(mappers, `a mapper reads data.${field}`).not.toMatch(new RegExp(`data\\.${field}\\b`));
    }
  });
});

/* ═══ 20 · The files this ticket may not touch ══════════════════════════════ */

/**
 * 🔴 `AdminDashboard.tsx` is THE-277's, `MainApp.tsx` and the `dialog`/`sheet`
 * primitives are THE-295's, and `components/settings/` is THE-296's — three
 * tickets running beside this one. `firestore.rules`, `firestore.indexes.json`
 * and `functions/` are out of scope by instruction — and the indexes file
 * matters twice over, because it DOES NOT DEPLOY ON MERGE, so an index added
 * there would be inert and the query would throw `failed-precondition` in
 * production while every test stayed green.
 *
 * ⚠️ A SET per file, not a single digest, for THE-276's reason: CI runs against
 * `refs/pull/N/merge`, so a file another ticket legitimately lands on `main`
 * holds a different value there than on this branch. A value that is NEITHER —
 * i.e. this ticket editing the file — still fails, which is the whole threat.
 */
const UNTOUCHED: Record<string, ReadonlyArray<readonly [digest: string, source: string]>> = {
  'src/components/AdminDashboard.tsx': [
    ['446f0bcb8ffa6accf4f80467b75a50023c1441937605b11e18aa01b53d8e53f8', 'main at 133d557 — THE-291 (#434) removed the client-side plan write'],
    ['722c5e4478be0a8508e7dff1232dd4c1f88cacdd502604f946f3134eb730d98c', 'main before #434 — the value THE-276, THE-283 and THE-290 all accept'],
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
  'firestore.rules': [
    ['a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499', 'unchanged since 5e06c67'],
    // THE-313 (#462) wrote the `servicePlans` rule: `allow read: if
    // belongsToTenant(tenantId)` / `allow write: if hasPermission('manageEvents',
    // tenantId)`, inside `match /tenants/{tenantId}` beside `events`. It is
    // deployed — `firestore.rules` auto-deploys on merge.
    //
    // 🔴 APPENDED, NEVER SUBSTITUTED. The value above is still accepted, because
    // CI runs against `refs/pull/N/merge` and a merge ref cut before #462 landed
    // legitimately carries it. A digest that is NEITHER — this ticket editing the
    // file — still fails, which is the entire threat this guard exists for.
    ['4973c3c94c5a3be8d478f4373326b23fbd9de447d3ac6a5b8173f723dfd62075', 'main + THE-313 (#462) — the servicePlans rule'],
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
      else out.push(path.relative(REPO_ROOT, p));
    }
  };
  walk(path.join(REPO_ROOT, 'functions'));
  return out.sort();
}

describe('AdminDashboard.tsx, firestore.rules, firestore.indexes.json and functions/ byte-identical', () => {
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

  it('nothing in this slice imports the shell it may not open, or a parallel ticket\'s files', () => {
    for (const file of TOUCHED_FILES) {
      const code = codeOf(file);
      expect(code, file).not.toMatch(/from\s+['"][^'"]*AdminDashboard['"]/);
      expect(code, file).not.toMatch(/from\s+['"][^'"]*MainApp['"]/);
      expect(code, file).not.toMatch(/from\s+['"][^'"]*\/ui\/(?:dialog|sheet)['"]/);
      expect(code, file).not.toMatch(/from\s+['"][^'"]*\/settings\//);
      expect(code, file)
        .not.toMatch(/from\s+['"][^'"]*(?:AdminCheckin|AdminCRM|AdminCourses|PrayerWall)['"]/);
    }
  });

  /**
   * 🔴 THIS SLICE READS COLLECTIONS SEVEN ROUTES WRITE, and is DELIBERATELY NOT
   * ENTANGLED WITH ANY OF THEM. Nothing here imports a route, a webhook or their
   * helpers. The facts those files establish — `attendeeCount` incremented
   * outside a transaction, `createdAt` written as two different types, prayer
   * rows expiring at thirty days — are recorded in this slice's own module
   * headers instead, so a change over there surfaces as a failing assertion here
   * rather than as a broken import.
   */
  it('and nothing in this slice touches a route, a webhook or a cron', () => {
    for (const file of TOUCHED_FILES) {
      const code = codeOf(file);
      expect(code, file).not.toMatch(/donation-webhook|event-registration-webhook|checkin-session-delete/);
      expect(code, file).not.toMatch(/from\s+['"][^'"]*app\/api\//);
      expect(code, file).not.toMatch(/adminDb|firebase-admin/);
    }
  });

  /** The premises those headers assert, checked against the real files. */
  it('the four facts this slice is built on are still true of the code that writes the documents', () => {
    // 1. The ceiling.
    expect(read('src/hooks/queries/useCRMQueries.ts')).toMatch(/export const CRM_FETCH_LIMIT = 1000;/);

    // 2. `createdAt` is written as two different types.
    expect(read('src/lib/donation-webhook.ts')).toMatch(/createdAt: nowIso/);
    expect(read('src/app/api/crm/send-email/route.ts')).toMatch(/createdAt: new Date\(\)\.toISOString\(\)/);
    expect(read('src/app/api/checkin/submit/route.ts')).toMatch(/createdAt: FieldValue\.serverTimestamp\(\)/);

    // 3. `attendeeCount` is incremented outside a transaction, after the add.
    const checkin = read('src/app/api/checkin/submit/route.ts');
    expect(checkin).toMatch(/collection\('attendees'\)\.add/);
    expect(checkin).toMatch(/attendeeCount: FieldValue\.increment\(1\)/);
    expect(checkin, 'the two writes were put in a transaction — the drift note is now wrong')
      .not.toMatch(/runTransaction/);

    // 4. Prayer requests are cron-deleted at thirty days.
    expect(read('src/components/PrayerWall.tsx')).toMatch(/30 \* 24 \* 60 \* 60 \* 1000/);
    expect(read('vercel.json')).toMatch(/api\/prayer-requests\/cleanup/);
    expect(read('src/app/api/prayer-requests/cleanup/route.ts')).toMatch(/expiresAt/);
  });
});

/* ═══ Dependencies ══════════════════════════════════════════════════════════ */

describe('no npm dependency was added', () => {
  it('@tanstack/react-table was NOT installed for the activity table', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    /*
     * 🔴 A plain table needs no table library. `@tanstack/react-table` buys
     * INTERACTIVE sorting and filtering — a header a reader can click — and the
     * activity list is sorted once, with `Array.sort`, over an array already
     * entirely in memory.
     */
    for (const absent of ['@tanstack/react-table', '@tanstack/table-core']) {
      expect(pkg.dependencies[absent], `${absent} was added`).toBeUndefined();
      expect(pkg.devDependencies?.[absent], `${absent} was added as a devDependency`).toBeUndefined();
    }
  });

  it('no charting, heatmap or gauge library was added — recharts is still the only one', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    for (const absent of [
      'react-simple-maps', 'topojson-client', 'd3-geo', 'nivo', '@nivo/core',
      'victory', 'react-calendar-heatmap', 'cal-heatmap', 'react-heatmap-grid',
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
    // 🔴 `table` was INSTALLED by THE-272. This slice adopts it for one more
    // file, recorded in that ticket's own closed list; it installs nothing.
    const ui = readdirSync(path.join(REPO_ROOT, 'src/components/ui'))
      .filter((f) => f.endsWith('.tsx')).sort();
    expect(ui).toContain('table.tsx');
    expect(ui).not.toContain('data-table.tsx');
    expect(ui).not.toContain('heatmap.tsx');
  });

  it('and the adopter list in THE-272\'s guard names this slice\'s one new file', () => {
    // The decision is recorded there rather than being invisible in a relaxed
    // assertion — this is the cross-check that it really was recorded.
    const guard = read('src/__tests__/the-272-shadcn-batch-b.test.ts');
    expect(guard).toMatch(/THE_294_TABLE_ADOPTERS/);
    expect(guard).toMatch(/dashboard\/ActivityTypes\.tsx/);
    expect(guard).toMatch(/FOURTH adopter of `table` still fails/);
  });
});
