import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE-363 · THE-108 — AdminCourseEditor's forked `Course` and `Lesson`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 🔴 THIS TICKET STOPS HERE, AND THIS FILE IS THE EVIDENCE FOR STOPPING.
 *
 * STOP condition 3 is "unifying the course types changes behaviour — STOP and
 * report what relies on the narrowing". It does, in BOTH directions, and the
 * two types are not assignable to each other in either. Measured with the
 * compiler rather than by reading:
 *
 *   Fork → canonical   TS2322: property `id` is incompatible,
 *                      `string | undefined` is not assignable to `string`.
 *   Canonical → fork   TS2741: property `status` is MISSING in the canonical
 *                      Course but REQUIRED in the fork.
 *
 * So the fork is not "untidy but identical". It is a genuinely different type,
 * and unifying it is a change to the canonical `Course` — which 17 non-test
 * modules import, and which `LibraryCourse` extends — not an edit to one
 * component.
 *
 * ── What relies on the narrowing, precisely ─────────────────────────────────
 *
 * 1. `Course.id` IS OPTIONAL IN THE FORK AND REQUIRED IN THE CANONICAL TYPE.
 *    `emptyCourse()` in AdminCourseEditor builds a course that has never been
 *    saved and therefore has no document id. Adopting the canonical type makes
 *    that factory invalid; making `id` optional canonically pushes a
 *    `string | undefined` into every consumer that indexes by course id.
 *
 * 2. THE FORKED `Lesson` REQUIRES SIX FIELDS THE CANONICAL ONE MARKS OPTIONAL —
 *    `youtubeUrl`, `outline`, `sources`, `scripture`, `quiz`, `teacherNote`.
 *    The editor reads all six unconditionally (`lesson.quiz.length`,
 *    `lesson.teacherNote`, …). Against the canonical type each of those is
 *    `possibly undefined` — six compiler errors, and six behaviour decisions
 *    about what an absent value should do, which is a different ticket.
 *
 * 3. THE FORK CARRIES FOUR FIELDS THE CANONICAL `Course` DOES NOT — `status`,
 *    `author`, `coverImage`, `createdAt`. `status` is REQUIRED. The canonical
 *    file already records this split deliberately: its `LibraryCourse` note
 *    says a tenant course "carries the same field on the Firestore doc; it
 *    lives on AdminCourseEditor's local Course type, not this one."
 *
 * ── ⚠️ SO THIS FILE DOES NOT UNIFY ANYTHING ─────────────────────────────────
 *
 * It PINS THE DRIFT so the finding cannot evaporate: the exact field-by-field
 * difference is asserted from the AST of both files, so a future unification
 * has a checklist and a silent partial merge turns this red. When the types are
 * genuinely unified, this file is what gets deleted — deliberately, by whoever
 * does it.
 *
 * 🔴 THE-345's counting and THE-342's by-id reads live in `AdminCourses.tsx`,
 * NOT in the editor, so nothing here touches them. Section 3 pins that.
 *
 * NO LINE NUMBER IS PINNED ANYWHERE IN THIS FILE.
 */

const SRC = join(process.cwd(), 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

interface Field {
  readonly name: string;
  readonly optional: boolean;
  readonly type: string;
}

/** Every member of one interface, read off a real parse. */
function fields(rel: string, interfaceName: string): Field[] {
  const sf = ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Field[] = [];
  const walk = (node: ts.Node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      for (const m of node.members) {
        if (!ts.isPropertySignature(m) || !m.name) continue;
        out.push({
          name: m.name.getText(sf),
          optional: !!m.questionToken,
          type: (m.type?.getText(sf) ?? 'unknown').replace(/\s+/g, ' '),
        });
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return out;
}

const byName = (fs: Field[]) => new Map(fs.map((f) => [f.name, f]));

const CANON = 'types/course.types.ts';
const FORK = 'components/AdminCourseEditor.tsx';

// ═════════════════════════════════════════════════════════════════════════════
// 1 · The fork exists, and it is NOT identical
// ═════════════════════════════════════════════════════════════════════════════

describe('AdminCourseEditor forks the canonical Course and Lesson types', () => {
  it('both files really declare both interfaces', () => {
    expect(fields(CANON, 'Course').length, 'canonical Course').toBeGreaterThan(5);
    expect(fields(CANON, 'Lesson').length, 'canonical Lesson').toBeGreaterThan(5);
    expect(fields(FORK, 'Course').length, 'forked Course').toBeGreaterThan(5);
    expect(fields(FORK, 'Lesson').length, 'forked Lesson').toBeGreaterThan(5);
  });

  it('a forked type that is IDENTICAL would be merely untidy — this one is not', () => {
    const canon = byName(fields(CANON, 'Course'));
    const fork = byName(fields(FORK, 'Course'));
    const differing = [...fork.keys()].filter((k) => {
      const c = canon.get(k);
      return !c || c.optional !== fork.get(k)!.optional || c.type !== fork.get(k)!.type;
    });
    expect(differing.length, 'the fork differs from the canonical type').toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · What relies on the narrowing — the three blockers, field by field
// ═════════════════════════════════════════════════════════════════════════════

describe('unifying them changes behaviour', () => {
  it('BLOCKER 1 — Course.id: required canonically, OPTIONAL in the fork', () => {
    expect(byName(fields(CANON, 'Course')).get('id')!.optional).toBe(false);
    expect(byName(fields(FORK, 'Course')).get('id')!.optional).toBe(true);
    // And the factory that depends on it still exists.
    expect(read(FORK)).toContain('emptyCourse');
  });

  it('BLOCKER 2 — six Lesson fields are REQUIRED in the fork and optional canonically', () => {
    const canon = byName(fields(CANON, 'Lesson'));
    const fork = byName(fields(FORK, 'Lesson'));

    const NARROWED = ['youtubeUrl', 'outline', 'sources', 'scripture', 'quiz', 'teacherNote'];
    for (const name of NARROWED) {
      expect(canon.get(name), `canonical Lesson.${name}`).toBeDefined();
      expect(fork.get(name), `forked Lesson.${name}`).toBeDefined();
      expect(canon.get(name)!.optional, `canonical Lesson.${name} is optional`).toBe(true);
      expect(fork.get(name)!.optional, `forked Lesson.${name} is required`).toBe(false);
    }

    // The exact set, so a field leaving or joining it is a visible change
    // rather than a silent one.
    const narrowedNow = [...fork.values()]
      .filter((f) => !f.optional && canon.get(f.name)?.optional)
      .map((f) => f.name)
      .sort();
    expect(narrowedNow).toEqual([...NARROWED].sort());
  });

  it('BLOCKER 3 — the fork carries fields the canonical Course does not have', () => {
    const canon = byName(fields(CANON, 'Course'));
    const fork = fields(FORK, 'Course');

    const extra = fork.filter((f) => !canon.has(f.name)).map((f) => f.name).sort();
    expect(extra).toEqual(['author', 'coverImage', 'createdAt', 'status']);

    // `status` is the one that makes canonical → fork impossible: REQUIRED here,
    // absent there.
    expect(byName(fork).get('status')!.optional).toBe(false);
    expect(canon.has('status')).toBe(false);
  });

  it('the canonical file already records the split as deliberate', () => {
    // Needle assembled from fragments — spelled whole it would match itself.
    const note = ["AdminCourseEditor's local ", 'Course type'].join('');
    expect(read(CANON)).toContain(note);
  });

  it('the fork is what three screens import, so unifying is not a one-file edit', () => {
    for (const rel of [
      'components/AdminCourses.tsx',
      'components/AdminLibraryCourses.tsx',
      'components/CourseDetails.tsx',
    ]) {
      const needle = ['AdminCourse', 'Editor'].join('');
      expect(read(rel), `${rel} imports the forked Course`).toContain(needle);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · THE-345's counting and THE-342's by-id reads are unchanged (no-regression)
// ═════════════════════════════════════════════════════════════════════════════

describe("THE-345's counting and THE-342's by-id reads are unchanged", () => {
  const COURSES = 'components/AdminCourses.tsx';

  it('all four named invariants still live in AdminCourses, not the editor', () => {
    const src = read(COURSES);
    for (const name of [
      'countedAdoptions',
      'adoptedResolvedKey',
      'danglingAdoptions',
      'readDocsByIds',
    ]) {
      expect(src, `${name} must survive`).toContain(name);
    }
  });

  it('the cap still counts adoptions rather than raw length', () => {
    const src = read(COURSES);
    // A ghost adoption must not consume a slot — THE-345's actual claim.
    const call = ['isAtCourseLimit(ownCount, countedAdoptions'].join('');
    expect(src).toContain(call);
  });

  it('none of them is in AdminCourseEditor, so this ticket could not have touched them', () => {
    const editor = read(FORK);
    for (const name of [
      'countedAdoptions',
      'adoptedResolvedKey',
      'danglingAdoptions',
      'readDocsByIds',
    ]) {
      expect(editor, `${name} is not the editor's`).not.toContain(name);
    }
  });
});
