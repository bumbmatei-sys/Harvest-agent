import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * THE-186 — nested drag-to-reorder at all three curriculum depths.
 *
 * The Curriculum tab promises "Drag ⠿ to reorder anything", and two of the
 * three depths silently did nothing. This file pins each depth, the mechanism
 * that broke them, and the two things the fix must not disturb.
 *
 * HOW A DROP IS DETECTED HERE. There is no `onDragOver` and no `onDrop` in
 * AdminCourseEditor.tsx — there never was. The component uses the
 * dragstart/dragenter/dragend triple instead: `onDragStart` records the source
 * index in a ref, `onDragEnter` records the index most recently entered in a
 * second ref, and `onDragEnd` — which the browser fires on the SOURCE element
 * when the gesture finishes — reads the two refs and commits the move. That is
 * a legitimate (if unusual) HTML5 DnD arrangement: it never calls
 * `preventDefault()` on a dragover, so the browser never treats anything as a
 * valid drop target and no `drop` event is ever produced. Nothing here needs
 * one, because the commit is driven from `dragend` rather than from the drop.
 *
 * WHY IT BROKE. All three of those event types bubble. Every depth listened for
 * the same three, so one lesson drag ran the lesson's handler, then its
 * section's, then its level's, all inside a single React batch — and each
 * ancestor committed an array it had built from the `course`/`level` its own
 * render had captured, i.e. from before the child's write. The last one to land
 * won, so the child's reorder was reverted with no error and no visual tell.
 *
 * WHAT THE FIX IS. Two collaborating parts, and `describe`s 4 and 5 below say
 * exactly what each is worth on its own:
 *   - ownership: `onDragStart`/`onDragEnd` stop propagation, so exactly one
 *     depth claims any drag; `onDragEnter` does NOT stop (an ancestor must
 *     still see a dragenter fired deep inside itself) and instead ignores any
 *     dragenter for a drag it did not start.
 *   - current-state commits: every write resolves against the live value via an
 *     updater rather than a captured snapshot.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const saved: Record<string, unknown>[] = [];

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u', email: 'a@t.com' } } }));
vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => 'tenant-1',
  getWriteTenantScope: async () => 'tenant-1',
}));
vi.mock('firebase/firestore', () => ({
  collection: (_d: unknown, ...s: string[]) => ({ __path: s.join('/') }),
  doc: (_d: unknown, ...s: string[]) => ({ __path: s.join('/') }),
  query: (...a: unknown[]) => a,
  where: (...a: unknown[]) => a,
  addDoc: async (_c: unknown, payload: Record<string, unknown>) => { saved.push(payload); return { id: 'new-course' }; },
  updateDoc: async (_d: unknown, payload: Record<string, unknown>) => { saved.push(payload); },
  deleteDoc: async () => {},
  setDoc: async () => {},
  getDoc: async () => ({ exists: () => true, data: () => ({ tenantId: 'tenant-1' }) }),
  getDocs: async () => ({ forEach: () => {} }),
}));
vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'GET', WRITE: 'WRITE', UPDATE: 'UPDATE', DELETE: 'DELETE' },
  handleFirestoreError: () => {},
}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('../ImageUpload', () => ({ ImageUpload: () => <div data-image-upload="" /> }));
vi.mock('../RichTextEditor', () => ({ default: () => <div data-rich-text="" /> }));

import AdminCourseEditor, { type Course } from '../AdminCourseEditor';

// ─── fixture ────────────────────────────────────────────────────────────────
// Two levels; the first has two sections; the first section has two lessons.
// That is the smallest tree in which every depth has a sibling to swap with AND
// a cross-parent target to prove non-interference against.
const lesson = (id: string) => ({
  id, title: id, summary: '', youtubeUrl: '', duration: '', outline: [],
  scripture: '', quiz: [], sources: '', teacherNote: '', authorId: '',
});
const seed = (): Course => ({
  id: 'c1', title: 'C', description: '', category: '', thumbnail: '', status: 'draft',
  featured: false, issueCertificate: true, requireQuiz: false, author: '', authorIds: [],
  levels: [
    {
      id: 'L1', title: 'L1', sections: [
        { id: 'S1', title: 'S1', lessons: [lesson('A'), lesson('B')] },
        { id: 'S2', title: 'S2', lessons: [lesson('C')] },
      ],
    },
    { id: 'L2', title: 'L2', sections: [{ id: 'S3', title: 'S3', lessons: [lesson('D')] }] },
  ],
} as unknown as Course);

interface Mounted { container: HTMLDivElement; unmount: () => void }
let mounted: Mounted | null = null;
beforeEach(() => { saved.length = 0; });
afterEach(() => { mounted?.unmount(); mounted = null; });

async function curriculum(course: Course = seed()): Promise<HTMLDivElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root!: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminCourseEditor course={course} onClose={() => {}} />);
    await Promise.resolve();
  });
  mounted = { container, unmount: () => { act(() => root.unmount()); container.remove(); } };
  const tab = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').startsWith('Curriculum'));
  if (!tab) throw new Error('no Curriculum tab — markup changed, test needs updating');
  await act(async () => { tab.dispatchEvent(new Event('click', { bubbles: true })); await Promise.resolve(); });
  return container;
}

/**
 * The exact native sequence the component listens for. `bubbles: true` is the
 * point of the whole file — it is what let one gesture reach three handlers.
 */
function drag(from: HTMLElement, to: HTMLElement): void {
  from.dispatchEvent(new Event('dragstart', { bubbles: true }));
  to.dispatchEvent(new Event('dragenter', { bubbles: true }));
  from.dispatchEvent(new Event('dragend', { bubbles: true }));
}

const inputs = (c: ParentNode, placeholderPrefix: string): HTMLInputElement[] =>
  Array.from(c.querySelectorAll('input')).filter((i) =>
    (i.getAttribute('placeholder') ?? '').startsWith(placeholderPrefix)) as HTMLInputElement[];

const levelTitles = (c: ParentNode) => inputs(c, 'Level Title').map((i) => i.value);
const sectionTitles = (c: ParentNode) => inputs(c, 'Section Title').map((i) => i.value);

/** Lesson rows are collapsed by default; their title shows in the header. */
const lessonTitles = (c: ParentNode): string[] =>
  Array.from(c.querySelectorAll('[draggable="true"]'))
    .filter((el) => !el.querySelector('[draggable="true"]'))
    .map((el) => (el.textContent ?? '').trim())
    .map((t) => t.replace(/^⠿\s*/, '').split(/\s{2,}|▼|▲|✕/)[0].trim());

/**
 * Wrappers at one depth, identified by how many of that depth's title inputs
 * they contain. An ancestor wrapper contains ALL of them, so "exactly one" is
 * what separates a per-item wrapper from its ancestors — the same discipline
 * AdminCourseEditor.desktop-layout.test.tsx uses.
 */
const wrappersFor = (c: ParentNode, own: HTMLInputElement[]): HTMLElement[] =>
  Array.from(c.querySelectorAll('[draggable="true"]'))
    .filter((el) => own.filter((i) => el.contains(i)).length === 1) as HTMLElement[];

const levelWrappers = (c: ParentNode) => wrappersFor(c, inputs(c, 'Level Title'));
const sectionWrappers = (c: ParentNode) => wrappersFor(c, inputs(c, 'Section Title'));
/** Lesson wrappers are the only draggables with no draggable inside them. */
const lessonWrappers = (c: ParentNode): HTMLElement[] =>
  Array.from(c.querySelectorAll('[draggable="true"]'))
    .filter((el) => !el.querySelector('[draggable="true"]')) as HTMLElement[];

// ─────────────────────────────────────────────────────────────────────────────
// 1–3. All three depths. The product says "reorder anything"; these are the
//      three things "anything" means.
// ─────────────────────────────────────────────────────────────────────────────
describe('every depth the Curriculum hint bar promises can actually be reordered', () => {
  it('reordering a LESSON within a section persists', async () => {
    const c = await curriculum();
    expect(lessonTitles(c).slice(0, 2)).toEqual(['A', 'B']);
    const w = lessonWrappers(c);
    await act(async () => { drag(w[1], w[0]); });
    expect(lessonTitles(c).slice(0, 2)).toEqual(['B', 'A']);
  });

  it('reordering a SECTION within a level persists', async () => {
    const c = await curriculum();
    expect(sectionTitles(c)).toEqual(['S1', 'S2', 'S3']);
    const w = sectionWrappers(c);
    await act(async () => { drag(w[1], w[0]); });
    expect(sectionTitles(c)).toEqual(['S2', 'S1', 'S3']);
  });

  it('reordering a LEVEL still works', async () => {
    // The one depth that already worked before THE-186 — this is the
    // no-regression guard, because the fix touches the level handler too.
    const c = await curriculum();
    expect(levelTitles(c)).toEqual(['L1', 'L2']);
    const w = levelWrappers(c);
    await act(async () => { drag(w[1], w[0]); });
    expect(levelTitles(c)).toEqual(['L2', 'L1']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. The bubbling half, on its own.
//
// Asserted through the cross-parent gesture, because that is where bubbling
// does damage that NOTHING else can mask. Dragging lesson A (in S1) onto lesson
// C (in S2) gives the ancestor level a source index and a target index that
// DIFFER (section 0 -> section 1), so a reaching ancestor performs a real,
// visible section reorder off the back of a lesson gesture. Within one parent
// the ancestor's own indices coincide and its splice is an identity move, which
// is precisely why the original bug was invisible rather than obviously wrong.
// ─────────────────────────────────────────────────────────────────────────────
describe('a nested drag does not reach the ancestor handler', () => {
  it('a lesson dragged onto a lesson in ANOTHER section moves neither the sections nor the levels', async () => {
    const c = await curriculum();
    const w = lessonWrappers(c);
    await act(async () => { drag(w[0], w[2]); }); // A (in S1) -> C (in S2)
    expect(sectionTitles(c), 'a lesson gesture reordered the sections').toEqual(['S1', 'S2', 'S3']);
    expect(levelTitles(c), 'a lesson gesture reordered the levels').toEqual(['L1', 'L2']);
    expect(lessonTitles(c).slice(0, 3), 'lessons must not migrate between sections').toEqual(['A', 'B', 'C']);
  });

  it('a section dragged onto a section in ANOTHER level does not reorder the levels', async () => {
    const c = await curriculum();
    const w = sectionWrappers(c);
    await act(async () => { drag(w[0], w[2]); }); // S1 (in L1) -> S3 (in L2)
    expect(levelTitles(c), 'a section gesture reordered the levels').toEqual(['L1', 'L2']);
    expect(sectionTitles(c), 'sections must not migrate between levels').toEqual(['S1', 'S2', 'S3']);
  });

  it('a lesson reorder within a section leaves every ancestor ordering alone', async () => {
    const c = await curriculum();
    const w = lessonWrappers(c);
    await act(async () => { drag(w[1], w[0]); });
    expect(sectionTitles(c)).toEqual(['S1', 'S2', 'S3']);
    expect(levelTitles(c)).toEqual(['L1', 'L2']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. The closure half, on its own — and an honest account of what it is worth.
//
// The card called this a SECOND independent bug and asked for a behavioural
// test that fails when the functional commits are reverted while `describe` 4
// still passes. That test cannot be written, and the reason is worth recording
// rather than papering over with one that passes either way:
//
//   Bubbling was the ONLY thing in this component that ever put two writes into
//   one React batch. Remove it and one gesture produces exactly one write, so a
//   captured snapshot has nothing to be stale against. React 18 flushes every
//   discrete DOM event synchronously, so two `dispatchEvent` calls are two
//   batches no matter how they are wrapped — `unstable_batchedUpdates` and a
//   microtask were both tried here and neither merges them.
//
// So there were two DEFECTS but only one LIVE bug. The captured-snapshot
// pattern is what chose the SYMPTOM — a silent revert instead of visible
// corruption — and, revealingly, it was also masking damage: with the snapshot
// commits in place a cross-section lesson drag was a no-op, and fixing ONLY the
// closure turns it into a real lesson migration plus a section reorder. That is
// why the two were never separable halves of one repair: ownership is the fix,
// current-state commits are hardening that is unsafe to ship on its own.
//
// What survives as a test is therefore structural, and deliberately so: it is
// the only thing that can catch a NEW list write added later in the
// captured-snapshot shape, which — precisely because nothing batches any more —
// no behavioural test would notice until something batches again. It reads the
// working file with readFileSync; no revision is consulted at assertion time.
// ─────────────────────────────────────────────────────────────────────────────
describe('the handler reads current state, not a captured value', () => {
  it('no reorder or list write in the file commits a captured snapshot', () => {
    const src = readFileSync(path.join(__dirname, '..', 'AdminCourseEditor.tsx'), 'utf8');
    const offenders = [
      /const ls = \[\.\.\.course\.levels\]/,
      /const ss = \[\.\.\.level\.sections\]/,
      /const ls = \[\.\.\.section\.lessons\]/,
      /onChange\(\{ \.\.\.(?:section|level), (?:lessons|sections): [a-z]{2} \}\)/,
      /set\("levels", \[?\.\.\.course\.levels/,
    ].filter((re) => re.test(src)).map(String);
    expect(offenders, 'these rebuild a list from a captured prop/state').toEqual([]);
    // and the three reorder commits are the updater form
    expect(src).toMatch(/onChange\(\(prev\) => \(\{ \.\.\.prev, lessons: reordered\(prev\.lessons, from, to\) \}\)\)/);
    expect(src).toMatch(/onChange\(\(prev\) => \(\{ \.\.\.prev, sections: reordered\(prev\.sections, from, to\) \}\)\)/);
    expect(src).toMatch(/setLevels\(\(prev\) => reordered\(prev, from, to\)\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. The shared-ref question.
//
// `dragging.current` is NOT one ref shared between the lesson and section
// depths, as the card supposed — SectionCard and LevelCard each declare their
// OWN `useRef`, and they merely share a variable NAME across two component
// scopes. There is still a real way for the two to collide, though, and it is
// the bubbling one: before the fix a lesson's dragstart also reached LevelCard's
// wrapper and wrote a section index into LevelCard's ref, leaving a live drag
// recorded at two depths at once. These pin that a gesture is recorded at
// exactly one depth, and that consecutive gestures at different depths do not
// leave each other stale state.
// ─────────────────────────────────────────────────────────────────────────────
describe('a lesson drag and a section drag do not collide through the shared ref', () => {
  it('a lesson gesture immediately followed by a section gesture reorders each once', async () => {
    const c = await curriculum();
    await act(async () => { const w = lessonWrappers(c); drag(w[1], w[0]); });
    expect(lessonTitles(c).slice(0, 2)).toEqual(['B', 'A']);
    await act(async () => { const w = sectionWrappers(c); drag(w[1], w[0]); });
    expect(sectionTitles(c)).toEqual(['S2', 'S1', 'S3']);
    // the earlier lesson swap survived the later section swap
    expect(lessonTitles(c).slice(1, 3)).toEqual(['B', 'A']);
    expect(levelTitles(c)).toEqual(['L1', 'L2']);
  });

  it('an abandoned lesson gesture leaves no index behind for a later section gesture', async () => {
    const c = await curriculum();
    // dragstart with no dragenter and no dragend — the user pressed, moved
    // nothing, and released outside. Nothing may be committed by it, and it
    // must not prime the section depth with a stale source index.
    await act(async () => { lessonWrappers(c)[1].dispatchEvent(new Event('dragstart', { bubbles: true })); });
    expect(sectionTitles(c)).toEqual(['S1', 'S2', 'S3']);
    await act(async () => { const w = sectionWrappers(c); drag(w[1], w[0]); });
    expect(sectionTitles(c)).toEqual(['S2', 'S1', 'S3']);
    expect(lessonTitles(c).slice(1, 3)).toEqual(['A', 'B']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7 & 8. What the fix must NOT have moved.
// ─────────────────────────────────────────────────────────────────────────────
describe('the layout is unchanged', () => {
  it('keeps the stepped indent and every inline style on the drag wrappers', async () => {
    const c = await curriculum();
    // PR 348's depth-legibility indent: 14 -> 28px at section, 12 -> 24px at
    // lesson, gated at sm:. THE-186 is an interaction fix and owns none of it.
    const src = readFileSync(path.join(__dirname, '..', 'AdminCourseEditor.tsx'), 'utf8');
    expect(src).toContain('className="px-[14px] sm:pl-[28px]"');
    expect(src).toContain('className="px-[12px] sm:pl-[24px]"');
    // No drag wrapper carries any style or class of its own — they are bare
    // event carriers, which is why the fix could not have moved a pixel.
    for (const el of Array.from(c.querySelectorAll('[draggable="true"]'))) {
      expect(el.getAttribute('style'), 'a drag wrapper grew an inline style').toBeNull();
      expect(el.getAttribute('class'), 'a drag wrapper grew a class').toBeNull();
    }
  });

  it('renders one drag wrapper per item and no more', async () => {
    const c = await curriculum();
    // 2 levels + 3 sections + 4 lessons, with every section expanded by default.
    expect(c.querySelectorAll('[draggable="true"]').length).toBe(9);
  });
});

describe("the persisted order field's shape is unchanged", () => {
  it('persists order as array position, with no order/index/position key added', async () => {
    const c = await curriculum();
    // Lesson first, then level: once the levels swap, L2 renders first and the
    // document-order lesson wrappers span different sections, so w[0]/w[1]
    // would no longer be two siblings (that gesture is correctly a no-op).
    await act(async () => { const w = lessonWrappers(c); drag(w[1], w[0]); });
    await act(async () => { const w = levelWrappers(c); drag(w[1], w[0]); });

    const draft = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Save Draft');
    if (!draft) throw new Error('no Save Draft button — markup changed, test needs updating');
    await act(async () => { draft.dispatchEvent(new Event('click', { bubbles: true })); await Promise.resolve(); });

    expect(saved).toHaveLength(1);
    const levels = (saved[0] as { levels: Course['levels'] }).levels;
    // order is carried by position, exactly as before
    expect(levels.map((l) => l.id)).toEqual(['L2', 'L1']);
    const l1 = levels.find((l) => l.id === 'L1')!;
    expect(l1.sections.map((s) => s.id)).toEqual(['S1', 'S2']);
    expect(l1.sections[0].lessons.map((x) => x.id)).toEqual(['B', 'A']);
    // and no positional field was introduced at any depth
    const keysAt = (o: object) => Object.keys(o);
    expect(keysAt(levels[0])).toEqual(['id', 'title', 'sections']);
    expect(keysAt(l1.sections[0])).toEqual(['id', 'title', 'lessons']);
    for (const depth of [levels[0], l1.sections[0], l1.sections[0].lessons[0]]) {
      for (const banned of ['order', 'index', 'position', 'sortOrder']) {
        expect(depth, `${banned} appeared on a persisted node`).not.toHaveProperty(banned);
      }
    }
  });
});
