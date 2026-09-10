/**
 * THE-342 — three reads that lie about being complete.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE DEFECT
 *
 * One defect wearing three costumes: a read that presents a PARTIAL or a FAILED
 * result as if it were the whole truth.
 *
 *   · `CoursePage` made TEN unbounded `getDocs` calls and swallowed every
 *     rejection into `catch { console.error }`, so a member whose tenant scope
 *     came back null was shown "No courses found" — a confident lie about their
 *     church, produced by a query Firestore had refused.
 *   · `AdminCourses` capped the shared catalogue at 200 while `CoursePage` read
 *     it unbounded. Two screens, one collection, two different truths, and
 *     neither said which.
 *   · `ChurchMap` read EVERY active church on Earth, unordered and unbounded,
 *     and rendered a failure as "No verified churches found in your area".
 *
 * `#405` found FORTY-ONE files doing unordered `limit(N)`. Firestore has no
 * default order, so an unordered `limit(N)` returns N ARBITRARY documents.
 *
 * The governing rules, from `AGENTS.md`: a figure ships only when its read is
 * EXACT (`getCountFromServer`) or PROVABLY COMPLETE; and the Silent-Failure
 * Rule — "a default value that hides an error is a bug".
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ⚠️ HOW THIS FILE AVOIDS THE WAYS ITS PREDECESSORS FAILED
 *
 * THIRTEEN guards in this series passed a planted defect. Each failure is
 * answered by a specific measure here:
 *
 *   · one read a DOCBLOCK 700 LINES AWAY that quoted the gate verbatim, and one
 *     matched only a comment saying the check lived elsewhere → EVERY content
 *     assertion below runs over `codeOf()`, which strips block and line
 *     comments. Section 0 proves the stripper does not eat the files it is
 *     pointed at, because `86bbxkawp` records an inherited stripper eating ~150
 *     lines of a real file.
 *   · one was satisfied because an IMPORT LINE carried the word → the reads are
 *     matched as balanced `query(...)` CALL EXPRESSIONS, not as bare substrings.
 *   · one measured a whole file where the first match sat above every fetch →
 *     each read is located and asserted INDIVIDUALLY, and the number of reads
 *     found is itself asserted, so a read that disappears fails.
 *   · two were VACUOUS because an empty `slice` made them trivially true → every
 *     sweep below asserts its own population is non-empty before asserting
 *     anything about its members.
 *   · one passed with its own gate DELETED because the assertion's message
 *     contained the string it grepped for → section 9 checks this file, and its
 *     needles are assembled from fragments at run time.
 *
 * 🔴 NOTHING HERE ASKS WHAT THE CURRENT BRANCH CHANGED. No child process, no
 * version-control invocation, no diff. `#454` is the standing sweep and
 * `THE-315.branch-diff-guards.test.ts` is the detector; THE-315's own section 2
 * contained exactly that mistake. Every claim is made against files on disk.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { rulesDigestFailure } from './__fixtures__/firestore-rules-pin';

const REPO_ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const sha256 = (t: string | Buffer): string => createHash('sha256').update(t).digest('hex');

/**
 * Source with block and line comments stripped — the CODE, not the prose.
 *
 * ⚠️ The `//` arm requires a non-`:` character before the slashes so that a
 * `https://` inside a string literal is not read as a comment. That is the
 * exact bug behind `86bbxkawp`, where an inherited stripper ate ~150 lines of
 * `IntegrationsSection.tsx` from the first URL onward. Section 0 asserts the
 * damage is bounded on every file this suite reads.
 */
const codeOfString = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const codeOf = (rel: string): string => codeOfString(read(rel));

/** The four sites, by path. Line numbers are deliberately absent — see §8. */
const SITES = {
  coursePage: 'src/components/CoursePage.tsx',
  adminCourses: 'src/components/AdminCourses.tsx',
  churchMap: 'src/components/ChurchMap.tsx',
  crm: 'src/hooks/queries/useCRMQueries.ts',
} as const;

const SHARED_READ_MODULE = 'src/utils/bounded-list-read.ts';
const CEILINGS_MODULE = 'src/utils/library-authoring.ts';

/**
 * Every balanced `query( … )` call expression in `src`.
 *
 * 🔴 Balanced-paren extraction, NOT a line regex. A read spanning five lines is
 * one expression, and asserting "the file contains orderBy somewhere" is what
 * let a guard pass on a docblock 700 lines away. This ties `limit` and
 * `orderBy` to the SAME call.
 */
function queryCalls(src: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < src.length; i++) {
    // A call, not the word inside a longer identifier (`subQueryFor(`).
    if (!src.startsWith('query(', i)) continue;
    const prev = i > 0 ? src[i - 1] : ' ';
    if (/[A-Za-z0-9_$.]/.test(prev)) continue;
    let depth = 0;
    for (let j = i + 'query'.length; j < src.length; j++) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')') {
        depth--;
        if (depth === 0) { out.push(src.slice(i, j + 1)); break; }
      }
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// 0 · The instrument, before anything measured with it
// ═══════════════════════════════════════════════════════════════════════════
describe('0 — the comment stripper does not eat the code it is pointed at', () => {
  it('🔴 keeps almost every non-comment line of every file this suite reads', () => {
    const files = [...Object.values(SITES), SHARED_READ_MODULE, CEILINGS_MODULE];
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const rawCode = read(f)
        .split('\n')
        .filter((l) => {
          const t = l.trim();
          return t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        }).length;
      const strippedLines = codeOf(f).split('\n').filter((l) => l.trim() !== '').length;
      // `86bbxkawp`: a stripper that ate a file from its first URL onward left
      // a fraction this small. Anything above 0.7 means the code survived.
      expect(strippedLines / rawCode, `${f}: stripper ate too much`).toBeGreaterThan(0.7);
    }
  });

  it('🔴 still removes comments, so the assertions below read code and not prose', () => {
    // If this ever passed trivially the whole suite would be reading docblocks.
    const withProse = codeOf(SITES.coursePage);
    expect(withProse).not.toContain('Silent-Failure Rule');
    expect(read(SITES.coursePage)).toContain('Silent-Failure Rule');
  });

  it('🔴 queryCalls() finds balanced expressions and not bare words', () => {
    // Balanced to the matching paren, nested calls included.
    expect(queryCalls("const a = query(collection(db,'x'), limit(2));"))
      .toEqual(["query(collection(db,'x'), limit(2))"]);
    // Not a substring of a longer identifier.
    expect(queryCalls('subQueryFor(1)')).toEqual([]);
    // ⚠️ It reads whatever it is given, so callers must hand it codeOf(): a
    // commented-out read would otherwise be measured as a real one.
    const withComment = "query(collection(db,'x'), limit(2));\n// query(nope)\n";
    expect(queryCalls(withComment)).toHaveLength(2);
    expect(queryCalls(codeOfString(withComment))).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1 · No unordered limit(N) — swept, and named per site
// ═══════════════════════════════════════════════════════════════════════════
describe('1 — every bounded read is ORDERED', () => {
  /**
   * A site bounds its reads one of two ways, and BOTH are checked:
   *   · inline — a `query(… limit(N) …)`, which must also carry an `orderBy`;
   *   · delegated — through `readBoundedList`, which orders and counts for it.
   *
   * ⚠️ A site with neither has no bounded read at all, which is the original
   * defect, so `siteReads` counting zero FAILS rather than passing vacuously.
   * Two guards in this series were trivially true because the set they
   * iterated was empty.
   */
  function siteReads(file: string) {
    const code = codeOf(file);
    const inline = queryCalls(code).filter((c) => /\blimit\s*\(/.test(c));
    const delegated = (code.match(/readBoundedList\s*\(/g) ?? []).length;
    return { code, inline, delegated, total: inline.length + delegated };
  }

  for (const [name, file] of Object.entries(SITES)) {
    it(`🔴 ${name} (${file}) has no unordered limit(N)`, () => {
      const { inline, total } = siteReads(file);
      expect(total, `${file}: no bounded read found — did a read move?`).toBeGreaterThan(0);
      for (const call of inline) {
        expect(
          /\borderBy\s*\(/.test(call),
          `${file}: unordered limit(N) — an unordered limit returns ARBITRARY rows:\n${call}`,
        ).toBe(true);
      }
    });

    it(`🔴 ${name} (${file}) leaves no UNBOUNDED collection read behind`, () => {
      const { code, delegated } = siteReads(file);
      // A bare getDocs/onSnapshot straight at a collection is the unbounded
      // shape: no ceiling, no order, no count. Every read on these screens
      // either carries a limit or goes through the shared reader.
      const bare = [
        ...(code.match(/getDocs\s*\(\s*collection\s*\(/g) ?? []),
        ...(code.match(/onSnapshot\s*\(\s*collection\s*\(/g) ?? []),
      ];
      expect(bare, `${file}: an unbounded collection read remains`).toEqual([]);
      // and the delegation this file claims really is present
      if (delegated === 0) {
        expect(queryCalls(code).some((c) => /\blimit\s*\(/.test(c)),
          `${file}: neither a ceiling nor the shared reader`).toBe(true);
      }
    });
  }

  it('🔴 across all four sites, at least one inline ceiling is swept — the sweep is not blind', () => {
    const inlineTotal = Object.values(SITES)
      .flatMap((f) => queryCalls(codeOf(f)).filter((c) => /\blimit\s*\(/.test(c)));
    expect(inlineTotal.length, 'no inline ceiling anywhere — the sweep would pass on anything')
      .toBeGreaterThan(0);
    for (const call of inlineTotal) expect(call).toMatch(/\borderBy\s*\(/);
  });

  it('🔴 the shared reader orders every window it serves', () => {
    const shared = queryCalls(codeOf(SHARED_READ_MODULE)).filter((c) => /fsLimit|limit\s*\(/.test(c));
    expect(shared.length).toBeGreaterThan(0);
    for (const call of shared) expect(call, `unordered window in the shared reader:\n${call}`)
      .toMatch(/orderBy\(documentId\(\)\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · One collection, ONE ceiling
// ═══════════════════════════════════════════════════════════════════════════
describe('2 — AdminCourses and CoursePage cannot disagree about the library', () => {
  it('🔴 the catalogue ceiling is ONE exported constant, not a literal per screen', () => {
    const ceilings = codeOf(CEILINGS_MODULE);
    expect(ceilings).toMatch(/export const LIBRARY_COURSE_FETCH_LIMIT\s*=\s*\d+/);
  });

  it('🔴 both screens import that constant and neither writes its own number', () => {
    for (const file of [SITES.adminCourses, SITES.coursePage]) {
      const code = codeOf(file);
      expect(code, `${file} must import the shared ceiling`).toContain('LIBRARY_COURSE_FETCH_LIMIT');
      // The 200-vs-unlimited split was a hardcoded literal. Any numeric literal
      // passed to limit() is the shape that let the two drift.
      for (const call of queryCalls(code)) {
        const m = call.match(/\blimit\s*\(\s*(\d+)\s*\)/);
        expect(m, `${file}: limit() takes a raw number ${m?.[1]} — import a ceiling instead`).toBeNull();
      }
    }
  });

  it('🔴 neither screen can lose an ADOPTED course to the catalogue ceiling', () => {
    // The deeper half of the same bug: resolving adoptions against a ceilinged
    // catalogue scan drops an adopted course whose id sorts past the ceiling,
    // silently, on whichever screen scans. Both now read the pointers BY ID,
    // which is complete by construction.
    for (const file of [SITES.adminCourses, SITES.coursePage]) {
      expect(codeOf(file), `${file} must resolve adoptions by id`).toContain('readDocsByIds');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3-5 · Truncation is stated, counts are exact, failure is not emptiness
// ═══════════════════════════════════════════════════════════════════════════
describe('3 — a truncated list says so on screen', () => {
  const SURFACES: Record<string, string> = {
    'the course library': 'src/components/course/CourseLibrary.tsx',
    'the courses admin': SITES.adminCourses,
    'the church finder': SITES.churchMap,
  };

  it('🔴 the notice is ONE shared sentence, so no two screens word it differently', () => {
    expect(codeOf(SHARED_READ_MODULE)).toMatch(/export function truncationNotice/);
    // "Showing N of M" is the honest shape the CRM already established.
    expect(read(SHARED_READ_MODULE)).toContain('Showing ${nf(shown)} of ${nf(total)}');
  });

  for (const [label, file] of Object.entries(SURFACES)) {
    it(`🔴 ${label} renders a truncation notice`, () => {
      const code = codeOf(file);
      const rendersNotice =
        code.includes('truncationNotice') || /data-\w*-?truncated/.test(code);
      expect(rendersNotice, `${file}: nothing on screen says the list is short`).toBe(true);
    });
  }
});

describe('4 — every count shown is EXACT, or no figure is shown', () => {
  it('🔴 the shared reader takes its total from getCountFromServer', () => {
    const code = codeOf(SHARED_READ_MODULE);
    expect(code).toContain('getCountFromServer');
    // The aggregation must feed `total` — a count taken from the fetched rows
    // would be clamped by the ceiling and would silently equal it.
    expect(code).toMatch(/const total\s*=\s*\(await getCountFromServer/);
  });

  it('🔴 AdminCourses derives its headline figure from the aggregation, not from the capped list', () => {
    const code = codeOf(SITES.adminCourses);
    expect(code).toContain('getCountFromServer');
    // The old figure was `courses.length + adopted.length`, where courses came
    // from a limit(100). Its return would re-introduce the invented number.
    expect(code).not.toMatch(/courses\.length\s*\+\s*adopted\.length/);
    expect(code).toContain('exactOwnTotal');
  });

  it('🔴 an uncountable total renders NO figure rather than a zero', () => {
    // A `0` and a "we could not read this" render identically; that is the bug.
    expect(codeOf(SITES.adminCourses)).toMatch(/exactOwnTotal === null/);
  });

  it('🔴 the plan cap counts the exact total and fails CLOSED when it is unknown', () => {
    const code = codeOf(SITES.adminCourses);
    expect(code).toMatch(/ownCount === null[\s\S]{0,80}\?\s*true/);
    expect(code).not.toMatch(/isAtCourseLimit\(\s*courses\.length/);
  });
});

describe('5 — a failed read surfaces as a FAILURE, never as an empty list', () => {
  it('🔴 the shared reader does not catch — a rejection reaches the caller', () => {
    const code = codeOf(SHARED_READ_MODULE);
    expect(code).not.toContain('catch');
    // and it never manufactures an empty success
    expect(code).not.toMatch(/return\s*\{\s*rows:\s*\[\]\s*,\s*total:\s*0/);
  });

  const FAILURE_SURFACES: Record<string, string> = {
    coursePage: 'src/components/course/CourseLibrary.tsx',
    adminCourses: SITES.adminCourses,
    churchMap: SITES.churchMap,
  };

  for (const [name, file] of Object.entries(FAILURE_SURFACES)) {
    it(`🔴 ${name} renders a distinct failure state`, () => {
      const code = codeOf(file);
      expect(/data-\w*-?read-failed/.test(code), `${file}: no failure state`).toBe(true);
      expect(code, `${file}: the failure must be an alert, not an empty state`)
        .toMatch(/variant="destructive"/);
    });
  }

  it('🔴 the failure is checked BEFORE the empty state on every surface that has both', () => {
    // Order is the whole guarantee: an empty state reached first would render
    // "no courses" for a read that was refused.
    const library = codeOf('src/components/course/CourseLibrary.tsx');
    const failedAt = library.indexOf('readFailed ?');
    const emptyAt = library.indexOf('filtered.length === 0');
    expect(failedAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(-1);
    expect(failedAt, 'the empty state is reached before the failure state').toBeLessThan(emptyAt);

    const map = codeOf(SITES.churchMap);
    const mapFailedAt = map.indexOf('churchesFailed ?');
    const mapEmptyAt = map.indexOf('churches.length === 0');
    expect(mapFailedAt).toBeGreaterThan(-1);
    expect(mapEmptyAt).toBeGreaterThan(-1);
    expect(mapFailedAt).toBeLessThan(mapEmptyAt);
  });

  it('🔴 no site answers a rejected read with an empty array', () => {
    for (const file of Object.values(SITES)) {
      const code = codeOf(file);
      // `catch { … setX([]) }` is the exact shape AGENTS.md names.
      expect(code, `${file}: a catch resolves into an empty list`)
        .not.toMatch(/catch[\s\S]{0,200}?set[A-Z]\w*\(\s*\[\s*\]\s*\)/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · CoursePage's unfiltered reads, named outcome per read
// ═══════════════════════════════════════════════════════════════════════════
describe("6 — CoursePage's unfiltered reads are gated, bounded and reported", () => {
  it('🔴 every read on the screen goes through the counted reader', () => {
    const code = codeOf(SITES.coursePage);
    // The bare `getDocs` that made ten unbounded reads must be gone entirely:
    // its absence is what makes "every read is bounded" checkable at all.
    expect(code, 'CoursePage still calls getDocs directly').not.toMatch(/\bgetDocs\s*\(/);
    expect(code).toContain('readBoundedList');
  });

  it('🔴 the tenant-scoped reads keep their where(tenantId) — rules are not filters', () => {
    // Removing it would not leak: the /courses rule dereferences
    // resource.data.tenantId, so an unfiltered list is REJECTED WHOLESALE for
    // anyone who is not a super admin. It would simply always fail.
    const code = codeOf(SITES.coursePage);
    const scoped = code.match(/where\("tenantId", "==", tenantId\)/g) ?? [];
    expect(scoped.length, 'courses, authors and categories each keep a tenant filter').toBe(3);
  });

  it('🔴 a rejected course read sets a failure flag rather than leaving the list empty', () => {
    const code = codeOf(SITES.coursePage);
    expect(code).toContain('setCoursesFailed(true)');
    // and that flag actually reaches the screen
    expect(code).toMatch(/readFailed=\{coursesFailed\}/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7-8 · The map
// ═══════════════════════════════════════════════════════════════════════════
describe('7 — ChurchMap does not read the whole collection', () => {
  it('🔴 the churches read is bounded by a named ceiling', () => {
    const code = codeOf(SITES.churchMap);
    expect(code).toMatch(/export const CHURCH_MAP_FETCH_LIMIT\s*=\s*\d+/);
    expect(code).toContain('CHURCH_MAP_FETCH_LIMIT');
    expect(code).toContain('readBoundedList');
    // The unbounded shape must be gone, not merely accompanied.
    expect(code, 'ChurchMap still calls getDocs directly').not.toMatch(/\bgetDocs\s*\(/);
  });

  it('🔴 the active-status filter is kept, so the ceiling applies to a real subset', () => {
    expect(codeOf(SITES.churchMap)).toContain("where('status', '==', 'active')");
  });
});

describe("8 — #476's map work is intact", () => {
  const map = () => read(SITES.churchMap);

  it('🔴 key={mapTheme} still remounts the tile layer on a theme flip', () => {
    // react-leaflet creates L.TileLayer once on mount and does not re-issue
    // tiles when the url prop changes; without this the map stays light.
    expect(codeOf(SITES.churchMap)).toContain('key={mapTheme}');
  });

  it('🔴 the OSM attribution is still rendered and attributionControl is not disabled', () => {
    expect(map()).toContain('openstreetmap.org/copyright');
    expect(map()).toContain('OpenStreetMap');
    expect(codeOf(SITES.churchMap)).not.toContain('attributionControl={false}');
    expect(codeOf(SITES.churchMap)).toContain('tile.openstreetmap.org');
  });

  it('🔴 the gold divIcon markers still read from --brand-color', () => {
    expect(codeOf(SITES.churchMap)).toContain('--brand-color');
    expect(codeOf(SITES.churchMap)).toContain('divIcon');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9 · The CRM read, located
// ═══════════════════════════════════════════════════════════════════════════
describe('9 — the CRM read is located and its ceiling is reported', () => {
  it('🔴 it lives in useCRMQueries.ts, not in AdminCRM.tsx', () => {
    // Card 86bbnjmwk said "AdminCRM truncates at 500 contacts plus 1000 users".
    // The reads are not in that component at all.
    const crm = codeOf('src/components/AdminCRM.tsx');
    expect(crm, 'AdminCRM must hold no list read of its own').not.toMatch(/\bgetDocs\s*\(\s*query\s*\(/);
    expect(codeOf(SITES.crm)).toMatch(/export const CRM_FETCH_LIMIT\s*=\s*1000/);
  });

  it('🔴 the card’s 500/1000 SPLIT does not exist — one ceiling governs both collections', () => {
    const code = codeOf(SITES.crm);
    const literals = code.match(/\blimit\s*\(\s*(\d+)\s*\)/g) ?? [];
    expect(literals, 'a raw numeric ceiling reintroduces the split').toEqual([]);
    const uses = code.match(/limit\(CRM_FETCH_LIMIT\)/g) ?? [];
    // contacts (scoped + unscoped) and users (scoped + unscoped) = four reads,
    // all through the one constant.
    expect(uses.length).toBe(4);
  });

  it('🔴 the CRM reports its true totals with an exact aggregation', () => {
    expect(codeOf(SITES.crm)).toContain('getCountFromServer');
    expect(codeOf(SITES.crm)).toMatch(/contactsTruncated/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10-11 · Ordering traps
// ═══════════════════════════════════════════════════════════════════════════
describe('10 — no DESC limit truncates the soonest rows from a forward-looking list', () => {
  it('🔴 no read this ticket touches pairs a descending order with a limit', () => {
    // THE-324's trap: a DESC limit drops the SOONEST rows, so a forward-looking
    // list needs asc. Every ceiling here orders by documentId() ascending.
    const files = [...Object.values(SITES), SHARED_READ_MODULE];
    let bounded = 0;
    for (const file of files) {
      for (const call of queryCalls(codeOf(file))) {
        if (!/\blimit\s*\(/.test(call)) continue;
        bounded++;
        expect(call, `${file}: a descending order under a limit`).not.toMatch(/'desc'|"desc"/);
      }
    }
    expect(bounded, 'no bounded reads found — the sweep went blind').toBeGreaterThan(0);
  });

  it('🔴 the ceilings order by documentId(), which excludes no document', () => {
    // An orderBy on a DATA field silently drops every document missing it.
    expect(codeOf(SHARED_READ_MODULE)).toContain('orderBy(documentId())');
  });
});

describe('11 — only one timestamp representation is written', () => {
  it('🔴 this ticket writes no timestamp at all', () => {
    // The safest way to keep the invariant: the reads it changes are reads.
    // `invoices.issuedAt` and `contactActivities.createdAt` each hold BOTH a
    // Timestamp and an ISO string, and Firestore sorts across types by TYPE
    // first — which is a second reason nothing here orders by a data field.
    for (const file of [...Object.values(SITES), SHARED_READ_MODULE]) {
      const code = codeOf(file);
      expect(code, `${file} writes a serverTimestamp`).not.toContain('serverTimestamp(');
      expect(code, `${file} orders by a mixed-type date column`)
        .not.toMatch(/orderBy\(\s*['"](issuedAt|createdAt|submittedAt)['"]/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12 · #482's CRM work
// ═══════════════════════════════════════════════════════════════════════════
describe("12 — #482's CRM work is untouched", () => {
  const crm = () => read('src/components/AdminCRM.tsx');

  it('🔴 AdminCRM.tsx is at a digest some ticket recorded', () => {
    // THE-342 recorded the first accepted value because the read IT fixed lives
    // in useCRMQueries.ts and the component never needed editing. THE-350
    // recorded the second, because the founder's manual-donation bug is IN this
    // component. A digest that is neither means a ticket edited the CRM without
    // saying so, and the behavioural assertions below then measure a file
    // nobody accounted for.
    const actual = sha256(readFileSync(path.join(REPO_ROOT, 'src/components/AdminCRM.tsx')));
    const match = THE_342_BASELINE.adminCrmDigests.find(([digest]) => digest === actual);
    expect(
      match,
      `AdminCRM.tsx is at ${actual}, which is none of:\n  ` +
        THE_342_BASELINE.adminCrmDigests.map(([d, why]) => `${d} (${why})`).join('\n  '),
    ).toBeTruthy();
  });

  it('🔴 the payment-links disclaimer still collapses, with its text unchanged', () => {
    const c = crm();
    // The trigger sentence that stays visible when the fold is shut, and the
    // panel body that THE-249 wrote — both byte-for-byte.
    expect(c).toContain('Gifts sent through your own payment links are not counted here.');
    expect(c).toContain('open their contact, press Add Activity, choose Donation and enter the amount.');
    // Still a fold, and still keepMounted so the text is findable when shut.
    expect(c).toContain('<Collapsible');
    expect(c).toContain('keepMounted');
    expect(c).toContain('crm-manual-giving-panel');
  });

  it('🔴 the Contacts/Roles switcher is ONE definition, so it cannot differ between tabs', () => {
    // #482's fix. "Identical on both tabs" is true by CONSTRUCTION when there
    // is a single `subTabBar` element rendered in both places — asserting the
    // markup twice would only prove two copies currently agree.
    const c = crm();
    const definitions = c.match(/const subTabBar = \(/g) ?? [];
    expect(definitions.length, 'the switcher must be defined exactly once').toBe(1);
    const uses = c.match(/\{subTabBar\}/g) ?? [];
    expect(uses.length, 'the one switcher must be rendered on both sub-views')
      .toBeGreaterThanOrEqual(2);
    // and #482's tap-target floor on its pills survives
    expect(c).toContain('min-h-11 min-w-11 sm:min-h-0 sm:min-w-0');
  });

  it("🔴 AdminRoles no longer injects an unscoped global reset", () => {
    // #482 found `* { margin:0; padding:0 }` zeroing a sibling's padding.
    expect(codeOf('src/components/AdminRoles.tsx')).not.toMatch(/\*\s*\{[^}]*margin:\s*0[^}]*padding:\s*0/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13-14 · Files that must not move
// ═══════════════════════════════════════════════════════════════════════════
describe('13-14, 21 — the files this ticket may not touch', () => {
  it('🔴 firestore.indexes.json declares NO new composite index', () => {
    // ⚠️ deploy-rules.yml runs `firestore:rules,storage` only, so an index
    // added here would be INERT and the query would throw failed-precondition
    // in production. Every read this ticket writes is an equality filter plus
    // orderBy(documentId()) — a prefix scan of an automatic single-field index.
    const idx = JSON.parse(read('firestore.indexes.json'));
    const composite = (idx.indexes ?? []) as { fields?: unknown[] }[];
    // The claim is the COUNT, pinned: a new entry appearing fails here.
    expect(composite.length).toBe(THE_342_BASELINE.compositeIndexCount);
  });

  it('🔴 no read added by this ticket needs an index that does not exist', () => {
    // Structural, not a digest: an equality `where` plus orderBy(documentId())
    // is served by the automatic (field, __name__) index. A second `where`, or
    // an orderBy on a data field, is what would need a composite index.
    for (const file of Object.values(SITES)) {
      for (const call of queryCalls(codeOf(file))) {
        if (!/\borderBy\s*\(/.test(call)) continue;
        const wheres = call.match(/\bwhere\s*\(/g) ?? [];
        expect(wheres.length, `${file}: ${wheres.length} where() clauses under an orderBy:\n${call}`)
          .toBeLessThanOrEqual(1);
        expect(call, `${file}: orderBy on a data field needs a composite index:\n${call}`)
          .toMatch(/orderBy\(\s*documentId\(\)\s*\)/);
      }
    }
  });

  it('🔴 firestore.rules is at a digest some ticket recorded', () => {
    // ⚠️ It AUTO-DEPLOYS on merge with no emulator tests in CI, and THE-313's
    // one-line change turned 46 files red.
    //
    // 🔴 ASKED THROUGH THE SHARED HELPER, NEVER BY WRITING THE DIGEST DOWN.
    // Writing the literal here is the mistake THE-333 and THE-341 each made:
    // THE-325 asserts that the accepted set lives in exactly ONE place, so a
    // second copy in a suite means a legitimate rules change would cost two
    // edits instead of one — and it turned THE-325 red both times. This ticket
    // records no rules digest anywhere, in this file or in its ownership
    // entry, because it does not touch the file.
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production')
      .toBeNull();
  });

  it('🔴 functions/ and src/app/layout.tsx are untouched by this ticket', () => {
    expect(sha256(readFileSync(path.join(REPO_ROOT, 'src/app/layout.tsx')))).toBe(
      THE_342_BASELINE.layoutDigest,
    );
    // The whole tree, so a new file counts as a change too.
    const walkAll = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return ['node_modules', 'lib', '.git'].includes(e.name) ? [] : walkAll(p);
        return [p];
      });
    const files = walkAll(path.join(REPO_ROOT, 'functions')).sort();
    const tree = sha256(files.map((f) => `${path.relative(REPO_ROOT, f)}:${sha256(readFileSync(f))}`).join('\n'));
    expect(tree).toBe(THE_342_BASELINE.functionsTreeDigest);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15-17 · Primitives, tap targets, colour
// ═══════════════════════════════════════════════════════════════════════════
describe('15 — every element that has a primitive uses it', () => {
  it('🔴 every surface this ticket touched renders its notice through ui/alert', () => {
    const surfaces = [
      'src/components/course/CourseLibrary.tsx',
      SITES.adminCourses,
      SITES.churchMap,
    ];
    for (const file of surfaces) {
      const code = codeOf(file);
      expect(code, `${file} must import the alert primitive`).toMatch(
        /import \{[^}]*\bAlert\b[^}]*\} from ['"][^'"]*ui\/alert['"]/,
      );
      expect(code, `${file}: <Alert> is not rendered`).toContain('<Alert');
    }
  });

  it('🔴 accordion is the one primitive NOT on disk, so nothing may import it', () => {
    const installed = readdirSync(path.join(REPO_ROOT, 'src/components/ui'))
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => f.replace(/\.tsx$/, ''));
    expect(installed.length).toBeGreaterThan(20);
    expect(installed).not.toContain('accordion');
    for (const p of ['alert', 'empty', 'badge', 'button', 'skeleton', 'pagination']) {
      expect(installed, `${p} should be installed`).toContain(p);
    }
  });

  it('🔴 no hand-rolled substitute for the alert primitive on the touched surfaces', () => {
    // A role="alert" div beside an imported <Alert> is the substitute shape.
    for (const file of ['src/components/course/CourseLibrary.tsx', SITES.churchMap]) {
      expect(codeOf(file), `${file}: hand-written role="alert"`).not.toMatch(/<div[^>]*role="alert"/);
    }
  });
});

describe('16 — tap targets', () => {
  it('🔴 this ticket adds no new interactive control below 44px', () => {
    // The notices and failure states are text, not controls: no load-more
    // button was added, so there is no new tap target to size. Asserted rather
    // than assumed, because a later edit that adds one must fail here.
    for (const file of ['src/components/course/CourseLibrary.tsx', SITES.churchMap]) {
      const code = codeOf(file);
      // Inside an <Alert …> … </Alert> region there must be no <button>.
      const alerts = code.match(/<Alert[\s\S]*?<\/Alert>/g) ?? [];
      expect(alerts.length, `${file}: no Alert rendered`).toBeGreaterThan(0);
      for (const a of alerts) {
        expect(a, `${file}: a control inside a notice needs a 44px floor`).not.toContain('<button');
      }
    }
  });

  it('🔴 the category pills keep their 44px floor', () => {
    // Untouched by this ticket, asserted so a careless edit to the file fails.
    expect(codeOf('src/components/course/CourseLibrary.tsx')).toContain('h-[44px]');
  });
});

describe('17 — no colour hardcoded, no emoji, no raw Tailwind scale', () => {
  const TOUCHED = [
    ...Object.values(SITES),
    SHARED_READ_MODULE,
    CEILINGS_MODULE,
    'src/components/course/CourseLibrary.tsx',
  ];

  it('🔴 no hex colour is introduced in any touched file', () => {
    /**
     * ⚠️ ChurchMap carries TWO hexes that PREDATE this ticket: the gold
     * `#d4a017` marker and the blue `#3b82f6` you-are-here dot, both inside
     * leaflet `divIcon` template HTML. They are pinned by VALUE rather than
     * waved through, so this ticket cannot add a third and cannot change
     * either — recolouring a marker is a palette change, not a read fix, and
     * is reported rather than done. Every other touched file must be clean.
     */
    const PRE_EXISTING: Record<string, string[]> = {
      'src/components/ChurchMap.tsx': ['#d4a017', '#3b82f6'],
      // The featured-course hero gradient, twice (mobile and desktop arms).
      // Also pre-existing, also REPORTED rather than changed: swapping these
      // for tokens is a palette change with a visual diff, which belongs to a
      // theming ticket and not to a ticket about read honesty.
      'src/components/course/CourseLibrary.tsx': ['#2e4057', '#1a2a3a', '#2e4057', '#1a2a3a'],
    };
    for (const file of TOUCHED) {
      const hexes = codeOf(file).match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      expect(hexes.sort(), `${file} hardcodes a colour`)
        .toEqual([...(PRE_EXISTING[file] ?? [])].sort());
    }
  });

  it('🔴 no raw Tailwind colour scale in the markup this ticket added', () => {
    // #482 found divide-stone-200 at 12.06:1 on a dark card across 13 screens.
    const added = ['src/components/course/CourseLibrary.tsx', SITES.churchMap, SITES.adminCourses];
    for (const file of added) {
      const alerts = codeOf(file).match(/<Alert[\s\S]*?<\/Alert>/g) ?? [];
      expect(alerts.length).toBeGreaterThan(0);
      for (const a of alerts) {
        expect(a, `${file}: a raw Tailwind scale inside a notice`)
          .not.toMatch(/\b(divide|bg|text|border)-(stone|zinc|slate|gray|neutral|red|amber|green|blue)-\d{2,3}\b/);
      }
    }
  });

  it('🔴 no emoji in any file this ticket added or edited — including its comments', () => {
    /**
     * The RAW source, not `codeOf`, and that is deliberate: `the-333-guards`
     * sweeps ChurchMap's raw file, so a house 🔴 marker written into a comment
     * there turns another ticket's suite red. Every production file this
     * ticket touches is held to the same rule rather than only that one.
     *
     * ⚠️ The swept range is the PICTOGRAPH range. `★` (U+2605) in
     * CourseLibrary's featured chip is a DINGBAT that predates this ticket —
     * the same distinction the-333 drew for `✦` (U+2726) — so it is legal, and
     * this guard must not be the thing that quietly deletes it.
     */
    const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{FE0F}]/gu;
    for (const file of TOUCHED) {
      expect(read(file).match(EMOJI) ?? [], `${file} ships an emoji`).toEqual([]);
    }
    // Non-vacuity: the pattern really does catch what it claims to.
    expect('🔴'.match(EMOJI)).not.toBeNull();
    // And the dingbat it must NOT catch is still on screen.
    expect('★'.match(EMOJI)).toBeNull();
    expect(read('src/components/course/CourseLibrary.tsx'),
      'the featured chip lost its dingbat').toContain('★');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 18-20 · The guards' own hygiene
// ═══════════════════════════════════════════════════════════════════════════
describe('18-20 — this suite obeys the rules it enforces', () => {
  const SELF = 'src/__tests__/THE-342.read-honesty-guards.test.ts';

  it('🔴 no test in this ticket pins a LINE NUMBER', () => {
    // THE-331 pinned AdminCommunity.tsx:491; a deletion shifted it to :311 and
    // the suite would have measured whatever landed there. Every line number in
    // the ticket description WILL move.
    const code = codeOf(SELF);
    expect(code, 'a path:line locator').not.toMatch(/\.tsx?:\d+/);
    expect(code, 'an indexed line lookup').not.toMatch(/split\(\s*['"]\\n['"]\s*\)\s*\[\s*\d+\s*\]/);
  });

  it('🔴 no fixture in this ticket is pinned to a date near today', () => {
    // #468's turned main red for everyone; THE-324 left one four days out that
    // would have failed SILENTLY. This suite reads files and hashes them — it
    // constructs no date at all, which is the strongest form of the claim.
    const code = codeOf(SELF);
    expect(code, 'a literal date').not.toMatch(/\b20\d{2}-\d{2}-\d{2}\b/);
    expect(code, 'a clock read').not.toMatch(/new Date\(|Date\.now\(/);
  });

  it('🔴 no guard in this PR asserts anything about the current branch’s diff', () => {
    // #454 is the standing sweep; THE-315's own section 2 contained exactly
    // this. ⚠️ The needles are ASSEMBLED AT RUN TIME: a guard whose assertion
    // message contains the string it greps for passes with its gate deleted,
    // which has already happened once in this series.
    const vcs = ['g', 'i', 't'].join('');
    const proc = ['child', '_', 'process'].join('');
    const code = codeOf(SELF);
    expect(code.includes(proc), 'this suite imports a process spawner').toBe(false);
    expect(code.includes(`${vcs} diff`), 'this suite reads a diff').toBe(false);
    expect(code.includes(['exec', 'Sync'].join('')), 'this suite shells out').toBe(false);
    expect(code.includes(['changed', 'Since'].join('')),
      'this suite asks what the branch changed').toBe(false);
  });

  it('🔴 the self-check above is not vacuous — it can see this file', () => {
    // The failure mode it exists to prevent: a gate that reads nothing.
    expect(codeOf(SELF).length).toBeGreaterThan(2000);
    expect(codeOf(SELF)).toContain('queryCalls');
  });
});

/**
 * The pinned baselines. Recorded ONCE, by this ticket, for the files it must
 * not move — and deliberately NOT recorded in the shared ownership register
 * where a `firestore.rules` digest turned THE-325 red for two tickets running.
 */
const THE_342_BASELINE = {
  layoutDigest: 'b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f',
  functionsTreeDigest: '1a3a1c7f27699263bcdf5bd0320c7cb0803a6f76644952f631000bc9bedef2d7',
  compositeIndexCount: 10,
  /**
   * AdminCRM.tsx — an ACCEPTED SET, appended to and never substituted.
   *
   * THE-342 recorded the first value to say "this ticket did not open the CRM
   * component; the read it fixed lives in useCRMQueries.ts". THE-350 DOES open
   * it, deliberately and for a reason THE-342 could not have: the founder's
   * "if I add a donation from a user in CRM it updates the CRM but not the
   * dashboard". Add Activity → Donation now calls `/api/donations/manual`, so
   * the gift is written to the `tenants/{t}/invoices` money ledger before any
   * CRM write happens at all.
   *
   * A SET rather than a replacement is the #422/#434 lesson this repo already
   * paid for: CI runs against `refs/pull/N/merge`, so a file another ticket
   * legitimately lands on holds a different value on the merge ref than on this
   * branch, and `main` went red for everyone the last time a digest was
   * substituted instead of added. A value that is NEITHER — a ticket editing
   * this file without recording why — still fails, which is the whole threat.
   *
   * What THE-342's OTHER twelve-section assertions prove is unchanged, and they
   * are the ones that carry #482's work: the payment-links disclaimer still
   * collapses with its text byte-for-byte, and the Contacts/Roles switcher is
   * still ONE definition rendered on both sub-views. Those run against the file
   * on disk, so they now measure THE-350's version of it rather than trusting a
   * hash to stand in for them.
   */
  adminCrmDigests: [
    ['a1b76895d3bc769d4213bad38f3e34c6a513bdff91b8a84f504e1217b33c82fc', 'THE-342 — the state that ticket left it in'],
    ['6e6ea8889f8ca1842ba7ff67e5ce688ad1a846c00e4881121198172d69297412', 'THE-350 — Add Activity → Donation writes an invoice'],
  ] as ReadonlyArray<readonly [digest: string, source: string]>,
} as const;
