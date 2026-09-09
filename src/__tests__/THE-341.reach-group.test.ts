/**
 * THE-341 — BROADCASTING becomes REACH, and Forms moves into it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS TICKET CHANGED, AND WHY IT IS TWO LINES AND NOT MORE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE-338 was asked for "forms should go into reach section", found that no
 * REACH group existed, and REPORTED rather than guessed: the request did not
 * say whether it renamed an existing group or minted a new one, and those are
 * different nav changes with different blast radii. It pinned the status quo
 * and waited. The founder answered in one word — "renames" — so:
 *
 *   • `BROADCASTING` is now `REACH`, in BOTH group arrays.
 *   • `forms` left MINISTRY for REACH, in BOTH group arrays.
 *
 * Nothing else moved. All 23 tabs are still in exactly one group on each
 * shell, every permission gate is where it was, and the mobile drawer still
 * mirrors the desktop sidebar exactly — which is THE-338's own guarantee and
 * is re-asserted here rather than assumed.
 *
 * ── Why the rename reaches four files and not one ───────────────────────────
 * 🔴 The group LABEL is an IDENTITY, not a caption. It keys `DESKTOP_GROUP_ICONS`
 * (no entry ⇒ an iconless rail button), `DESKTOP_GROUP_LABELS` (no entry ⇒ the
 * rail prints the raw SHOUTING label), `RAIL_RECENT_GROUPS` (no entry ⇒ the
 * panel silently loses its pinned "Recent events" footer) and every
 * `data-nav-rail-*` attribute. A rename that updated only the arrays would
 * leave a nav that still works and is quietly three features poorer, so
 * section 3 asserts each of those couplings by name.
 *
 * ── What this file deliberately does NOT do ─────────────────────────────────
 * ⚠️ It pins no LINE NUMBER. THE-331 pinned line 491 of AdminCommunity.tsx, a
 * deletion shifted the subject up to line 311, and the suite went on measuring
 * whatever had landed there. Everything below is discovered by pattern.
 *
 * ⚠️ That sentence is written WITHOUT a `file:line` locator on purpose — the
 * sweep in section 9 reads these files verbatim and cannot tell a locator in
 * prose from one in an assertion. Wording the history around the rule is the
 * honest fix; excusing the file from its own sweep is not.
 *
 * ⚠️ It asserts NOTHING about this branch's diff. #454 is a standing sweep for
 * guards that expire when their own ticket merges, and THE-338 found one
 * inside THE-315's own section. Section 9 turns that rule on THIS file.
 *
 * ⚠️ It never asserts over an unproven `slice`. THE-338 found one of its own
 * assertions vacuous because an empty slice made it trivially true, and the
 * pre-existing THE-326 guard would have become vacuous the moment this ticket
 * renamed the group — `indexOf` returning -1, `slice(-1)` being one character,
 * and the row under assertion being the empty string. `groupRow()` below
 * proves the slice is non-empty before anything is asserted about it, and
 * section 0 proves the arrays parsed at all.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { rulesDigestFailure } from './__fixtures__/firestore-rules-pin';

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');

/** This file's own repo-relative path, so sweeps can exclude it BY PATH.
 *  🔴 Never by "does the line look like an assertion" — a gate that excuses
 *  itself because its own message contains the string it greps for is exactly
 *  how one guard in this series passed with its gate deleted. */
const SELF = 'src/__tests__/THE-341.reach-group.test.ts';

const DASHBOARD_REL = 'src/components/AdminDashboard.tsx';
const RAIL_GROUPS_REL = 'src/components/layout/nav-rail-groups.ts';
const RAIL_RECENTS_REL = 'src/components/layout/nav-rail-recents.tsx';
const RAIL_REL = 'src/components/layout/nav-rail.tsx';

const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * 🔴 SOURCE WITH ITS COMMENTS STRIPPED, AND THIS IS NOT TIDINESS.
 *
 * The first cut of section 6 asserted the `library` gate with a pattern over
 * the RAW file, and a planted defect that deleted `isSuperAdmin &&` from the
 * real tab entry DID NOT FAIL IT — because a docblock ~700 lines above quotes
 * the gate verbatim while explaining that gates live on the tab and never on
 * the group. The guard was reading the explanation of the rule instead of the
 * rule. That is the "a NEIGHBOURING note contained the string" failure this
 * repo has already shipped once, and only mutation found it here.
 *
 * So every pattern assertion below runs against CODE, never against prose. The
 * `[^:]` guard keeps a `//` inside a URL from eating the rest of its line.
 */
const codeOf = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const DASHBOARD = codeOf(read(DASHBOARD_REL));

/* ═══════════════════════════════════════════════════════════════════════════
 * The parser — discovered by pattern, and PROVEN before it is trusted
 * ═══════════════════════════════════════════════════════════════════════════ */

type NavGroup = { label: string; ids: string[] };

/** The `{ label, ids }[]` literal for one array, parsed out of the source. */
function navGroups(name: string): NavGroup[] {
  const decl = `const ${name}: { label: string; ids: string[] }[] = [`;
  const start = DASHBOARD.indexOf(decl);
  expect(start, `${name} was not found — every assertion about it would be vacuous`)
    .toBeGreaterThan(-1);
  const end = DASHBOARD.indexOf('\n];', start);
  expect(end, `${name}'s literal never closes`).toBeGreaterThan(start);
  const body = DASHBOARD.slice(start, end);
  const groups = [...body.matchAll(/\{\s*label:\s*'([A-Z]+)',\s*ids:\s*\[([^\]]*)\]/g)].map((m) => ({
    label: m[1],
    ids: [...m[2].matchAll(/'([a-z]+)'/g)].map((x) => x[1]),
  }));
  expect(groups.length, `${name} parsed to nothing`).toBeGreaterThan(0);
  return groups;
}

/** Both shells, by the name of the array that draws each. */
const SHELLS = [
  ['MORE_GROUPS', 'the mobile More drawer'],
  ['DESKTOP_NAV_GROUPS', 'the desktop sidebar'],
] as const;

/** One group's parsed row, proven to exist before it is asserted about. */
function groupRow(arrayName: string, label: string): NavGroup {
  const found = navGroups(arrayName).find((g) => g.label === label);
  expect(found, `${arrayName} has no ${label} group — the assertion would be vacuous`)
    .toBeDefined();
  expect(found!.ids.length, `${arrayName}'s ${label} group parsed with no ids`)
    .toBeGreaterThan(0);
  return found!;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 0 · The arrays parse, so nothing below is vacuous
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('0 — the subject of every assertion below actually parsed', () => {
  it.each(SHELLS)('%s (%s) parses to four groups holding ids', (name, which) => {
    const groups = navGroups(name);
    expect(groups.length, `${which} did not parse`).toBe(4);
    for (const g of groups) {
      expect(g.ids.length, `${which}: ${g.label} parsed empty`).toBeGreaterThan(0);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 · The group is named REACH, and BROADCASTING keys nothing
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('1 — the group is named REACH and BROADCASTING is gone', () => {
  it.each(SHELLS)('%s (%s) has a REACH group and no BROADCASTING group', (name, which) => {
    const labels = navGroups(name).map((g) => g.label);
    expect(labels, `${which} has no REACH group`).toContain('REACH');
    expect(labels, `${which} still carries a BROADCASTING group`).not.toContain('BROADCASTING');
  });

  /**
   * 🔴 THE SWEEP, and what it deliberately scopes to.
   *
   * The claim worth making is "no RUNNING CODE keys off the old name" — a
   * quoted `'BROADCASTING'` literal is what an icon map, a recents list or a
   * `group === …` comparison would look like, and there are none left.
   *
   * ⚠️ It sweeps NON-TEST source only, on purpose and not to be lenient. Test
   * files legitimately carry the string as a NEGATIVE assertion (THE-338's
   * inverted section 4 asserts a label list `.not.toContain('BROADCASTING')`),
   * and a sweep that failed on those would be a sweep that punishes the guard
   * for guarding. Prose mentioning the old name in a comment is history and is
   * left alone deliberately: erasing the record of a rename is how the next
   * reader loses the reason for it.
   */
  it('🔴 no non-test source file keys off the string BROADCASTING', () => {
    const files = sourceFiles();
    expect(files.length, 'the sweep found no files to sweep').toBeGreaterThan(200);
    expect(files, 'the sweep is not reaching the file this ticket changed')
      .toContain(DASHBOARD_REL);
    expect(files, 'the sweep is not reaching the rail group maps').toContain(RAIL_GROUPS_REL);

    const offenders = files.filter((rel) => /'BROADCASTING'|"BROADCASTING"/.test(codeOf(read(rel))));
    expect(offenders, 'a source file still keys off the old group name').toEqual([]);
  });
});

/** Every non-test `.ts`/`.tsx` under `src/`, repo-relative. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const abs = path.join(dir, entry);
      if (statSync(abs).isDirectory()) {
        if (entry === '__tests__' || entry === '__fixtures__' || entry === 'node_modules') continue;
        walk(abs);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      if (/\.test\.tsx?$/.test(entry)) continue;
      out.push(path.relative(ROOT, abs));
    }
  };
  walk(SRC);
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 · forms is in REACH, not MINISTRY — and sms is still LISTED
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('2 — forms moved, and only forms moved', () => {
  it.each(SHELLS)('%s (%s): forms is in REACH and not in MINISTRY', (name, which) => {
    expect(groupRow(name, 'REACH').ids, `${which}: forms is not in REACH`).toContain('forms');
    expect(groupRow(name, 'MINISTRY').ids, `${which}: forms is still in MINISTRY`)
      .not.toContain('forms');
  });

  it.each(SHELLS)('%s (%s): REACH holds exactly the five expected ids, in order', (name, which) => {
    expect(groupRow(name, 'REACH').ids, `${which}: REACH's membership drifted`)
      .toEqual(['events', 'checkin', 'forms', 'sms', 'livestream']);
  });

  it.each(SHELLS)('%s (%s): MINISTRY keeps its other eight, in THE-334 order', (name, which) => {
    expect(groupRow(name, 'MINISTRY').ids, `${which}: MINISTRY lost or reordered something`)
      .toEqual([
        'churches', 'crm', 'signups', 'services', 'community',
        'fundraising', 'donations', 'accounting',
      ]);
  });

  /**
   * 🔴 HIDDEN IS NOT ABSENT. `SMS_FEATURE_ENABLED` is a master switch on the
   * TAB entry in `allTabs` (THE-335 / #481), and the groups are filtered
   * against that array — so an absent tab drops out of its group on its own.
   * The id must stay LISTED here or flipping the switch back restores a tab
   * that belongs to no group, and `admin-sections.ts` reads the literal too.
   */
  it.each(SHELLS)('%s (%s): sms is still LISTED in REACH though the feature is hidden', (name, which) => {
    expect(groupRow(name, 'REACH').ids, `${which}: sms was deleted from the array, not just hidden`)
      .toContain('sms');
    expect(DASHBOARD, 'the SMS master switch is no longer what hides the tab')
      .toMatch(/SMS_FEATURE_ENABLED &&\s*\n\s*navAllows\(features\?\.smsAutomation\)/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3 · The rail's identity couplings followed the rename
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('3 — every map keyed by the group label was renamed with it', () => {
  it('🔴 every group label in DESKTOP_NAV_GROUPS has a rail icon', () => {
    const src = codeOf(read(RAIL_GROUPS_REL));
    for (const { label } of navGroups('DESKTOP_NAV_GROUPS')) {
      expect(src, `${label} has no DESKTOP_GROUP_ICONS entry — its rail button would be iconless`)
        .toMatch(new RegExp(`^\\s*${label}:\\s*\\w+,`, 'm'));
    }
  });

  it('🔴 every group label has a readable rail label, and REACH reads "Reach"', () => {
    const src = codeOf(read(RAIL_GROUPS_REL));
    const at = src.indexOf('export const DESKTOP_GROUP_LABELS');
    expect(at, 'DESKTOP_GROUP_LABELS was not found').toBeGreaterThan(-1);
    const end = src.indexOf('};', at);
    expect(end, 'DESKTOP_GROUP_LABELS never closes').toBeGreaterThan(at);
    const body = src.slice(at, end);
    expect(body.length, 'DESKTOP_GROUP_LABELS parsed empty').toBeGreaterThan(20);

    for (const { label } of navGroups('DESKTOP_NAV_GROUPS')) {
      expect(body, `${label} has no readable label — the rail would print the raw identity`)
        .toMatch(new RegExp(`^\\s*${label}:\\s*'`, 'm'));
    }
    expect(body, 'REACH no longer reads "Reach" in the rail').toMatch(/^\s*REACH:\s*'Reach',/m);
  });

  it("🔴 REACH keeps its pinned 'Recent events' footer", () => {
    const src = codeOf(read(RAIL_RECENTS_REL));
    expect(src, 'REACH is not in RAIL_RECENT_GROUPS — the panel lost its footer')
      .toMatch(/RAIL_RECENT_GROUPS[^=]*=\s*\[[^\]]*'REACH'/);
    expect(src, "REACH has no recency source, so the footer would render nothing")
      .toMatch(/^\s*REACH:\s*\{\s*heading:\s*'Recent events',\s*tab:\s*'events'\s*\},/m);
    expect(src, 'the events query is no longer enabled for REACH')
      .toMatch(/group === 'REACH'/);
  });

  it('🔴 the MINISTRY section map names no id MINISTRY no longer holds', () => {
    const src = codeOf(read(RAIL_GROUPS_REL));
    const at = src.indexOf('export const DESKTOP_GROUP_SECTIONS');
    expect(at, 'DESKTOP_GROUP_SECTIONS was not found').toBeGreaterThan(-1);
    const body = src.slice(at);
    expect(body, 'the presentation map still blocks forms into MINISTRY').not.toMatch(/'forms'/);

    const ministryIds = new Set(groupRow('DESKTOP_NAV_GROUPS', 'MINISTRY').ids);
    const named = [...body.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(named.length, 'the section map parsed to no ids').toBeGreaterThan(0);
    for (const id of named) {
      expect(ministryIds.has(id), `the section map names '${id}', which MINISTRY does not hold`)
        .toBe(true);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 · No-regression on THE-338: the two shells still mirror each other
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('4 — the mobile drawer still mirrors the desktop sidebar', () => {
  it('🔴 the group NAMES are identical, in the same ORDER', () => {
    expect(navGroups('MORE_GROUPS').map((g) => g.label))
      .toEqual(navGroups('DESKTOP_NAV_GROUPS').map((g) => g.label));
  });

  it('🔴 every group holds the same ids, in the same order', () => {
    expect(navGroups('MORE_GROUPS')).toEqual(navGroups('DESKTOP_NAV_GROUPS'));
  });

  it('🔴 enumerated whole, so two arrays that drifted TOGETHER still fail', () => {
    expect(navGroups('DESKTOP_NAV_GROUPS')).toEqual([
      { label: 'CONTENT', ids: ['blog', 'courses', 'newsletter', 'ai', 'docs'] },
      {
        label: 'MINISTRY',
        ids: [
          'churches', 'crm', 'signups', 'services', 'community',
          'fundraising', 'donations', 'accounting',
        ],
      },
      { label: 'REACH', ids: ['events', 'checkin', 'forms', 'sms', 'livestream'] },
      { label: 'GROW', ids: ['affiliate', 'branding', 'library', 'tenants', 'inbox'] },
    ]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5 · All 23 tabs are still reachable, on BOTH shells
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 🔴 THE-332's docblock records that 21 of the 23 are reachable ONLY through
 *  the desktop flyouts, which is why a rename that orphans one is worse than
 *  the old label. Enumerated by id rather than counted. */
const ALL_TABS = [
  'accounting', 'affiliate', 'ai', 'blog', 'branding', 'checkin', 'churches',
  'community', 'courses', 'crm', 'docs', 'donations', 'events', 'forms',
  'fundraising', 'inbox', 'library', 'livestream', 'newsletter', 'services',
  'signups', 'sms', 'tenants',
] as const;

describe('5 — no tab was orphaned by the rename', () => {
  it('the enumeration is the 23 the product has', () => {
    expect(ALL_TABS).toHaveLength(23);
    expect(new Set(ALL_TABS).size, 'the enumeration repeats an id').toBe(23);
  });

  it.each(SHELLS)('%s (%s) reaches all 23, each exactly once', (name, which) => {
    const flat = navGroups(name).flatMap((g) => g.ids);

    /* 🔴 The missing and the extra are NAMED, not left to a sorted-array diff.
       "expected [ …(22) ] to deeply equal [ …(23) ]" tells a reader that
       something went, not WHAT went — and the tab that goes missing is the
       whole risk a nav rename carries. */
    const listed = new Set(flat);
    const missing = ALL_TABS.filter((id) => !listed.has(id));
    const unknown = flat.filter((id) => !(ALL_TABS as readonly string[]).includes(id));
    const twice = flat.filter((id, i) => flat.indexOf(id) !== i);
    expect(missing, `${which} orphaned: ${missing.join(', ') || 'nothing'}`).toEqual([]);
    expect(unknown, `${which} lists an id no tab defines: ${unknown.join(', ')}`).toEqual([]);
    expect(twice, `${which} lists twice: ${twice.join(', ')}`).toEqual([]);
    expect(flat.length, `${which} does not hold 23 ids`).toBe(23);
  });

  it('every id in either array has a real tab entry in allTabs', () => {
    for (const [name] of SHELLS) {
      for (const id of navGroups(name).flatMap((g) => g.ids)) {
        /* ⚠️ `label:` and not `label: '` — `churches` computes its label
           ("Campus" or "Campuses" by tenant), so requiring a string literal
           there would fail on a tab that is perfectly well defined. */
        expect(DASHBOARD, `${name} lists '${id}', which no allTabs entry defines`)
          .toMatch(new RegExp(`\\{ id: '${id}', label:`));
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6 · Every permission gate is unchanged
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('6 — the rename touched no gate', () => {
  /** 🔴 A gate lives on the TAB entry in `allTabs`, never on the group, which
   *  is why a regroup cannot move one. Asserted rather than reasoned. */
  it.each([
    ['library is super-admin only', /isSuperAdmin && \{ id: 'library'/],
    ['tenants is super-admin only', /isSuperAdmin && \{ id: 'tenants'/],
    ['ai needs uploadRag', /perms\.uploadRag\) &&\s*\{ id: 'ai'/],
    ['courses needs createCourses', /perms\.createCourses\)/],
    ['blog needs writeArticles', /perms\.writeArticles\)/],
    ['affiliate needs manageAffiliate', /perms\.manageAffiliate\) &&\s*\{ id: 'affiliate'/],
    ['branding has canBranding', /canBranding && \{ id: 'branding'/],
    ['donations has canDonations', /canDonations/],
    ['forms needs manageForms', /perms\.manageForms\) &&\s*\n?\s*\{ id: 'forms'/],
    ['checkin needs manageCheckin or manageQR', /perms\.manageCheckin \|\| perms\.manageQR\)/],
  ])('%s', (_what, pattern) => {
    expect(DASHBOARD).toMatch(pattern);
  });

  /** 🔴 The gate `forms` carries did NOT travel with it into REACH — it is on
   *  the tab, and the tab did not move. A church admin without `manageForms`
   *  sees no Forms row in REACH for the same reason they saw none in MINISTRY. */
  it("forms keeps its own gate after moving group", () => {
    expect(DASHBOARD, 'the customForms plan clause was dropped in the move')
      .toMatch(/navAllows\(features\?\.customForms\) &&/);
  });

  it('🔴 a group with NO permitted tabs is still OMITTED ENTIRELY, on both shells', () => {
    expect(DASHBOARD, 'the mobile drawer would draw an empty group heading')
      .toMatch(/if \(groupTabs\.length === 0\) return null;/);
    expect(DASHBOARD, 'the desktop sidebar no longer runs the emptiness rule')
      .toMatch(/visibleNavGroups\(/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7 · Dashboard and Settings stay pinned OUTSIDE the groups
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('7 — Dashboard and Settings are not in any group', () => {
  it.each(SHELLS)('%s (%s) lists neither', (name, which) => {
    const flat = navGroups(name).flatMap((g) => g.ids);
    expect(flat, `${which} swallowed dashboard into a group`).not.toContain('dashboard');
    expect(flat, `${which} swallowed settings into a group`).not.toContain('settings');
  });

  it('both are still built outside the group arrays', () => {
    expect(DASHBOARD, 'the Dashboard entry is gone').toMatch(/\{ id: 'dashboard', label: 'Dashboard'/);
    expect(DASHBOARD, 'the Settings entry is gone')
      .toMatch(/canSettings \? \[\{ id: 'settings', label: 'Settings'/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8 · GROUPED_MORE_IDS still DERIVES from MORE_GROUPS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('8 — the drawer catch-all set is derived, never copied', () => {
  /** 🔵 If this were a hand-written copy it would now be missing REACH's
   *  `forms`, and the drawer would render Forms a SECOND time under OTHER. */
  it('🔴 it is computed from MORE_GROUPS, not restated', () => {
    expect(DASHBOARD, 'GROUPED_MORE_IDS is no longer derived from MORE_GROUPS')
      .toMatch(/const GROUPED_MORE_IDS = new Set\(MORE_GROUPS\.flatMap\(\(g\) => g\.ids\)\);/);
  });

  it('the catch-all consumes it, so a grouped tab is never listed twice', () => {
    expect(DASHBOARD, 'the OTHER catch-all no longer filters on GROUPED_MORE_IDS')
      .toMatch(/!GROUPED_MORE_IDS\.has\(t\.id\)/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 9 · This file's own hygiene — the rules #454 sweeps for
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 🔴 Turned on THIS file, and on the measured companion beside it.
 *
 * ⚠️ EVERY PATTERN BELOW IS A REGEX, and that is load-bearing rather than
 * stylistic: a regex source contains escapes (`\s`, `\(`) that the literal it
 * matches does not, so this file scanning ITSELF cannot match its own
 * assertions. A plain `toContain('execFileSync')` would fail on its own
 * argument and have to be excused — and a gate that excuses itself is the
 * failure mode this section exists to prevent.
 */
const MY_FILES = [
  SELF,
  'src/components/__tests__/THE-341.reach-rail.test.tsx',
  'src/components/__tests__/THE-341.reach-rail.layout.test.tsx',
];

describe("9 — this ticket's own guards obey the standing rules", () => {
  it('both of this ticket\'s guard files exist and were read', () => {
    for (const rel of MY_FILES) {
      const body = read(rel);
      expect(body.length, `${rel} is empty`).toBeGreaterThan(500);
    }
  });

  it('🔴 no guard here pins a LINE NUMBER', () => {
    for (const rel of MY_FILES) {
      const body = read(rel);
      expect(body, `${rel} pins a file:line locator`).not.toMatch(/\.tsx?:\d+/);
      expect(body, `${rel} indexes source by line`).not.toMatch(/split\(['"`]\\n['"`]\)\s*\[\s*\d/);
    }
  });

  it('🔴 no guard here asserts anything about the current branch\'s DIFF', () => {
    for (const rel of MY_FILES) {
      const body = read(rel);
      expect(body, `${rel} shells out, which is how a diff assertion gets made`)
        .not.toMatch(/from ['"](?:node:)?child_process['"]/);
      expect(body, `${rel} runs a subprocess`).not.toMatch(/execFileSync\s*\(/);
      expect(body, `${rel} reads the git index`).not.toMatch(/git\s+(?:diff|status|merge-base)/);
    }
  });

  it('🔴 no fixture here is pinned to a date near today', () => {
    for (const rel of MY_FILES) {
      const body = read(rel);
      expect(body, `${rel} hardcodes a calendar date`).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(body, `${rel} constructs a fixed Date`).not.toMatch(/new Date\s*\(\s*['"]/);
      expect(body, `${rel} reads the wall clock`).not.toMatch(/Date\.now\s*\(/);
    }
  });

  it('🔴 no colour is hardcoded here, and no raw Tailwind scale is named', () => {
    for (const rel of MY_FILES) {
      const body = read(rel);
      /* ⚠️ SIX OR EIGHT digits, not three-to-eight. `#482` is a pull request
         and `#454` a standing sweep, and a three-digit window matched both —
         a guard that fires on its own citations gets excused, and an excused
         guard is the failure mode this whole section exists to prevent. Every
         hardcoded colour this repo has actually grown is the six-digit form,
         which this still catches, along with the functional notations.

         ⚠️ And no example of one is written out here, for the same reason the
         line-number history above is worded around its own rule: this file is
         one of the files it sweeps. */
      expect(body, `${rel} hardcodes a hex colour`)
        .not.toMatch(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/);
      expect(body, `${rel} hardcodes a functional colour`)
        .not.toMatch(/\b(?:rgba?|hsla?)\s*\(/);
      expect(body, `${rel} names a raw Tailwind colour scale`)
        .not.toMatch(/\b(?:divide|border|bg|text)-(?:stone|slate|gray|zinc|neutral)-\d{2,3}\b/);
    }
  });

  it('no emoji-free rule is broken by the SOURCE this ticket edited', () => {
    for (const rel of [DASHBOARD_REL, RAIL_GROUPS_REL, RAIL_RECENTS_REL, RAIL_REL]) {
      const body = read(rel);
      expect(body, `${rel} grew a raw Tailwind colour scale`)
        .not.toMatch(/\b(?:divide|border)-(?:stone|slate|gray|zinc|neutral)-\d{2,3}\b/);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 10 · The files this ticket must not open are byte-identical
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('10 — untouched files, pinned by digest and not by this branch\'s diff', () => {
  const sha = (rel: string) => createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');

  /**
   * 🔴 `firestore.rules` IS ASKED THROUGH THE REGISTER, NOT PINNED HERE.
   *
   * THE-325 built one shared accepted-digest set for that file precisely so a
   * legitimate rules change is ONE edit, and its own guard fails if the digest
   * is written down anywhere else — writing the literal here would put this
   * ticket in the way of every future rules change, which is what THE-333 did
   * when it turned THE-322 and THE-325 red. So this asks the register whether
   * the file on disk is at a recorded value, and says nothing of its own.
   */
  it('firestore.rules is at a digest the shared register accepts', () => {
    expect(rulesDigestFailure(), 'firestore.rules is at an unrecorded digest').toBeNull();
  });

  /** ⚠️ These two have no shared register, so they are pinned directly — and
   *  the pin is a literal digest rather than a diff against this branch. */
  it.each([
    ['firestore.indexes.json', '8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0'],
    ['src/app/layout.tsx', 'b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f'],
  ])('%s is byte-identical', (rel, digest) => {
    expect(sha(rel), `${rel} was edited by this ticket`).toBe(digest);
  });

  it('functions/ is byte-identical, tree and all', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir).sort()) {
        if (entry === 'node_modules' || entry === 'lib') continue;
        const abs = path.join(dir, entry);
        if (statSync(abs).isDirectory()) walk(abs);
        else files.push(path.relative(ROOT, abs));
      }
    };
    walk(path.join(ROOT, 'functions'));
    expect(files.length, 'the functions/ tree could not be read').toBeGreaterThan(0);
    const tree = createHash('sha256');
    for (const rel of files) tree.update(rel).update(readFileSync(path.join(ROOT, rel)));
    expect(tree.digest('hex'), 'a file under functions/ was edited by this ticket')
      .toBe('4016dc6b342dcbbf44b94994d35d01781c015035205616d4798c142199a1b5bf');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 11 · Line endings — THE-268's guard catches CRLF; this catches it here
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('11 — LF, not CRLF', () => {
  it.each([...MY_FILES, DASHBOARD_REL, RAIL_GROUPS_REL, RAIL_RECENTS_REL])(
    '%s has no carriage returns',
    (rel) => {
      expect(read(rel).includes('\r'), `${rel} was written with CRLF`).toBe(false);
    },
  );
});
