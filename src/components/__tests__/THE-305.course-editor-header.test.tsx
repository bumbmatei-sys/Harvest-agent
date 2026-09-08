import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * THE-305 — the course editor header, the star, and the emoji sweep.
 *
 * ── WHAT THE FOUNDER SAW ────────────────────────────────────────────────────
 * A screenshot of the create-course screen showing TWO stacked headers:
 *
 *   the shell's        a back chevron at far left, the title "Courses", the avatar
 *   the editor's own   a SECOND back arrow, a large "New Course" heading wrapping
 *                      onto three lines, the subtitle "1 level / 1 section /
 *                      1 lesson", then Draft / Save Draft / Publish
 *
 * So the page carried two back controls, and its real title sat in the body
 * while the nav named the LIST the editor had been opened from. His words: "In
 * the create new course delete the new course title and that arrow. Put new
 * course in the top nav bar title and only keep the back arrow from top left."
 *
 * ── HOW THE TITLE GETS INTO THE NAV, WITHOUT TOUCHING THE SHELL ─────────────
 * `AdminScreenHeader` exports an `AdminHeaderContext` whose `setHeaderOverride`
 * lets a screen publish `{ title, onBack, action, titleIcon }` up into the one
 * header AdminDashboard renders — on BOTH the desktop branded bar
 * (`headerOverride?.title ?? headerTitle`) and the mobile header. AdminEvents,
 * AdminCRM and AdminCommunity already drive it exactly this way. So the editor
 * passes a title up rather than rendering its own, and AdminDashboard.tsx — which
 * several guards assert byte-identical — is not opened at all.
 *
 * That is also what `AdminScreenHeader`'s own doc comment always demanded:
 * "Rendered once per screen — screens must NOT repeat their own title below it."
 * This screen was the one that did.
 *
 * ── WHAT IS DELIBERATELY NOT TOUCHED ────────────────────────────────────────
 * The drag-to-reorder (#413) and the 18-button editor toolbar (#425) both live
 * in this file and both are fragile. Sections 6 and 7 are no-regression pins
 * standing beside their own dedicated suites, not replacements for them.
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

import AdminCourseEditor, { type Course } from '../AdminCourseEditor';
import { AdminHeaderContext, type AdminHeaderOverride } from '../AdminScreenHeader';
import { rulesDigestFailure } from '../../__tests__/__fixtures__/firestore-rules-pin';

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.resolve(__dirname, '..');
const readSrc = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

/* ── fixture ──────────────────────────────────────────────────────────────── */

const lesson = (id: string) => ({
  id, title: id, summary: '', youtubeUrl: '', duration: '', outline: [],
  scripture: '', quiz: [], sources: '', teacherNote: '', authorId: '',
});
/**
 * Two levels; the first has two sections; the first section has two lessons —
 * the smallest tree in which every depth has a sibling to swap with.
 * Mirrors AdminCourseEditor.drag-reorder.test.tsx's seed deliberately.
 */
const seed = (): Course => ({
  id: 'c1', title: '', description: '', category: '', thumbnail: '', status: 'draft',
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

/* ── mounting, with a real header context so the override can be observed ─── */

interface Mounted {
  container: HTMLDivElement;
  /** The last override the editor published into the shell. */
  override: () => AdminHeaderOverride | null;
  unmount: () => void;
}
let mounted: Mounted | null = null;
beforeEach(() => { saved.length = 0; });
afterEach(() => { mounted?.unmount(); mounted = null; });

/**
 * Mount the editor inside a REAL `AdminHeaderContext.Provider`, the way
 * AdminDashboard mounts it, and capture what it publishes. The shell itself is
 * not rendered — this ticket's claim is precisely that the editor need only
 * publish, and that AdminDashboard.tsx does not change.
 */
async function editor(course: Course | null = null): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let latest: AdminHeaderOverride | null = null;
  const api = {
    setHeaderAction: () => {},
    setHeaderHidden: () => {},
    setHeaderOverride: (o: AdminHeaderOverride | null) => { latest = o; },
  };
  let root!: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(
      <AdminHeaderContext.Provider value={api}>
        <AdminCourseEditor course={course} onClose={() => { closed++; }} />
      </AdminHeaderContext.Provider>,
    );
    await Promise.resolve();
  });
  mounted = {
    container,
    override: () => latest,
    unmount: () => { act(() => root.unmount()); container.remove(); },
  };
  return mounted;
}

let closed = 0;
beforeEach(() => { closed = 0; });

/** Switch to the tab whose label starts with `prefix`. */
async function openTab(c: ParentNode, prefix: string): Promise<void> {
  const tab = Array.from(c.querySelectorAll('button')).find((b) => (b.textContent ?? '').startsWith(prefix));
  if (!tab) throw new Error(`no "${prefix}" tab — markup changed`);
  await act(async () => { tab.dispatchEvent(new Event('click', { bubbles: true })); await Promise.resolve(); });
}

const textOf = (el: ParentNode | null) => ((el as HTMLElement)?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Fire the same native DnD triple the component's handlers listen for. */
function drag(from: Element, to: Element): void {
  from.dispatchEvent(new Event('dragstart', { bubbles: true }));
  to.dispatchEvent(new Event('dragenter', { bubbles: true }));
  from.dispatchEvent(new Event('dragend', { bubbles: true }));
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. The duplication itself.
// ═════════════════════════════════════════════════════════════════════════════
describe('the course editor shows exactly ONE back control', () => {
  it('renders no back control of its own — the shell draws the only one', async () => {
    const m = await editor();
    // A back control here is an icon-only button carrying a lucide arrow or
    // chevron. Matched by the rendered svg rather than by position, so moving
    // the arrow elsewhere in the body would still be caught.
    const backish = Array.from(m.container.querySelectorAll('button'))
      .filter((b) => b.querySelector('svg[class*="arrow-left"], svg[class*="chevron-left"]'));
    expect(backish.map((b) => textOf(b)), 'the editor still draws its own back arrow').toEqual([]);
  });

  it('publishes exactly one back handler, and it is the editor\'s own onClose', async () => {
    const m = await editor();
    const o = m.override();
    expect(o, 'the editor published no header override at all').not.toBeNull();
    expect(typeof o!.onBack, 'the shell was given no back handler').toBe('function');

    // The surviving chevron must do what the deleted in-body arrow did.
    expect(closed).toBe(0);
    o!.onBack!();
    expect(closed, 'the published back handler does not close the editor').toBe(1);
  });

  it('leaves exactly one back control across shell and body combined', async () => {
    // The sum is what the founder counted: one published handler, zero in-body.
    const m = await editor();
    const inBody = Array.from(m.container.querySelectorAll('button'))
      .filter((b) => b.querySelector('svg[class*="arrow-left"], svg[class*="chevron-left"]')).length;
    const inShell = m.override()?.onBack ? 1 : 0;
    expect(inBody + inShell).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. The title moves up.
// ═════════════════════════════════════════════════════════════════════════════
describe('the top nav title reads "New Course" on the editor, not "Courses"', () => {
  it('publishes "New Course" for an unsaved course', async () => {
    expect((await editor()).override()?.title).toBe('New Course');
  });

  it('never publishes the list\'s title', async () => {
    // "Courses" is AdminDashboard's own headerTitle for the tab. The override
    // exists precisely so the nav stops saying it while the editor is open.
    expect((await editor()).override()?.title).not.toBe('Courses');
  });

  it('tracks the course\'s own name once it has one', async () => {
    // The heading read `course.title || "New Course"`. That expression moved to
    // the header rather than being rewritten, so a saved course still reads by
    // its own name.
    const named = { ...seed(), title: 'Foundations of Prayer' } as Course;
    expect((await editor(named)).override()?.title).toBe('Foundations of Prayer');
  });

  it('sets the title from the shared header mechanism, not a shell edit', () => {
    const src = readSrc('AdminCourseEditor.tsx');
    expect(src, 'the editor does not use the shared header API').toContain('useAdminHeader');
    expect(src).toContain('setHeaderOverride({ title: course.title || "New Course"');
    // The shell renders it. Pinned here so the two halves cannot drift apart.
    const shell = readSrc('AdminDashboard.tsx');
    expect(shell).toContain('headerOverride?.title ?? headerTitle');
  });

  it('clears the override on unmount, so the list gets its own title back', async () => {
    const m = await editor();
    expect(m.override()).not.toBeNull();
    m.unmount();
    mounted = null;
    expect(m.override(), 'the editor left "New Course" in the nav after closing').toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. The heading goes; its information does not.
// ═════════════════════════════════════════════════════════════════════════════
describe('the large in-body heading is gone and its information survives', () => {
  it('renders no <h1> anywhere in the editor', async () => {
    const m = await editor();
    expect(m.container.querySelectorAll('h1').length, 'the in-body heading is still there').toBe(0);
  });

  it('keeps the level / section / lesson counts, in the top bar where they were', async () => {
    // WHERE IT WENT: nowhere. The subtitle stays in the top bar's left slot, at
    // the same 12px and the same muted colour; it is simply no longer sitting
    // underneath a heading. It could not move UP into the shared header —
    // `AdminHeaderOverride` carries a title, a back handler, an action and an
    // icon, and adding a fifth field would be a shell change for one screen.
    const m = await editor(seed());
    expect(textOf(m.container)).toContain('2 levels');
    expect(textOf(m.container)).toContain('3 sections');
    expect(textOf(m.container)).toContain('4 lessons');
  });

  it('recomputes those counts as the curriculum changes', async () => {
    // Derived state, not a caption — which is the reason it had to survive.
    const m = await editor();
    expect(textOf(m.container)).toContain('1 level');
    const addLevel = Array.from(m.container.querySelectorAll('button'))
      .find((b) => (b.textContent ?? '').trim() === '+ Add Level');
    await openTab(m.container, 'Curriculum');
    const add = addLevel ?? Array.from(m.container.querySelectorAll('button'))
      .find((b) => (b.textContent ?? '').trim() === '+ Add Level');
    await act(async () => { add!.dispatchEvent(new Event('click', { bubbles: true })); await Promise.resolve(); });
    expect(textOf(m.container)).toContain('2 levels');
  });

  it('still shows the status pill and the three save actions beside it', async () => {
    // The row the heading was removed FROM keeps everything else it carried.
    const m = await editor();
    const labels = Array.from(m.container.querySelectorAll('button')).map((b) => textOf(b));
    expect(labels).toContain('Save Draft');
    expect(labels).toContain('Publish');
    expect(textOf(m.container)).toContain('Draft');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. The emoji sweep — the whole file, not a spot check.
// ═════════════════════════════════════════════════════════════════════════════
/**
 * `Extended_Pictographic` is the Unicode property that means "emoji", and it is
 * deliberately the whole predicate.
 *
 * It catches every one of the nine this ticket replaced — the star, three
 * avatar placeholders, the play/clock/person lesson meta, the link glyph in a
 * placeholder string and the books glyph in the empty state — and it leaves the
 * editor's typographic chrome alone: the drag handle, the disclosure carets,
 * the check and the close cross are geometric shapes and dingbats, NOT
 * pictographic, so this sweep cannot be satisfied by mangling the drag handle.
 */
const EMOJI = /\p{Extended_Pictographic}/u;
const emojiIn = (s: string) => [...s].filter((c) => EMOJI.test(c));

describe('no emoji appears in the course editor\'s rendered output', () => {
  it('renders none on the Course Info tab', async () => {
    const m = await editor(seed());
    expect(emojiIn(textOf(m.container))).toEqual([]);
  });

  it('renders none on the Curriculum tab, at every depth', async () => {
    const m = await editor(seed());
    await openTab(m.container, 'Curriculum');
    // Open a level, a section and a lesson so the meta row (which carried three
    // of the nine) is actually in the tree when it is swept.
    for (const b of Array.from(m.container.querySelectorAll('div[style*="cursor: pointer"]'))) {
      await act(async () => { b.dispatchEvent(new Event('click', { bubbles: true })); await Promise.resolve(); });
    }
    expect(emojiIn(textOf(m.container))).toEqual([]);
  });

  it('spells none in the source either — including placeholders and comments', async () => {
    // A placeholder is an attribute, so it never reaches textContent; the link
    // glyph lived in exactly such a string. Sweeping the source covers it, and
    // covers a comment being used to smuggle the house style back in.
    expect(emojiIn(readSrc('AdminCourseEditor.tsx'))).toEqual([]);
  });

  it('leaves the non-emoji chrome standing', async () => {
    // The drag handle especially: it is the affordance #413's fix hangs off,
    // and "sweep the emoji" must not become "sweep the glyphs".
    const m = await editor(seed());
    await openTab(m.container, 'Curriculum');
    expect(textOf(m.container), 'the drag handle vanished with the emoji').toContain('\u283F');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. The star.
// ═════════════════════════════════════════════════════════════════════════════
describe('the Featured Course control uses a lucide icon', () => {
  /**
   * The Featured Course row, found by its own copy rather than by position.
   * The SMALLEST div containing both the label and the subtitle — anything
   * larger would sweep in the rich-text editor's own toolbar icons and make the
   * assertion below pass on the wrong svg.
   */
  /**
   * The Featured Course row's own label block: the SMALLEST div carrying both
   * the label and the subtitle. Anything larger sweeps in the rich-text
   * editor's toolbar icons, which is how a "there is an svg" assertion passes
   * on entirely the wrong svg.
   */
  const featuredLabel = (c: ParentNode): HTMLElement => {
    const rows = Array.from(c.querySelectorAll<HTMLElement>('div')).filter((d) => {
      const t = d.textContent ?? '';
      return t.includes('Featured Course') && t.includes('Pinned at the top of the course library');
    });
    if (!rows.length) throw new Error('no Featured Course row');
    return rows[rows.length - 1];
  };
  /** Its immediate parent — the flex line that carries the icon beside it. */
  const featuredRow = (c: ParentNode): HTMLElement => featuredLabel(c).parentElement as HTMLElement;

  it('draws a lucide star svg beside the label', async () => {
    const m = await editor();
    const svg = featuredRow(m.container).querySelector('svg');
    expect(svg, 'the Featured Course row has no icon at all').not.toBeNull();
    expect(svg!.getAttribute('class') ?? '').toContain('lucide-star');
  });

  it('carries no emoji in that row', async () => {
    const m = await editor();
    expect(emojiIn(featuredRow(m.container).textContent ?? '')).toEqual([]);
    expect(emojiIn(featuredLabel(m.container).textContent ?? '')).toEqual([]);
  });

  it('keeps the row\'s copy and its toggle', async () => {
    const m = await editor();
    const text = textOf(featuredRow(m.container));
    expect(text).toContain('Featured Course');
    expect(text).toContain('Pinned at the top of the course library for all users');
  });

  it('imports its icons from lucide-react, which the repo already depends on', () => {
    expect(readSrc('AdminCourseEditor.tsx')).toMatch(/import \{[^}]*Star[^}]*\} from "lucide-react"/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. NO-REGRESSION: drag-to-reorder, all three depths (#413).
//
// The dedicated suite is AdminCourseEditor.drag-reorder.test.tsx. This is the
// pin that THIS ticket did not disturb it — the header lives in the same file.
// ═════════════════════════════════════════════════════════════════════════════
describe('drag-to-reorder still works at level, section and lesson', () => {
  /*
   * The depth helpers are AdminCourseEditor.drag-reorder.test.tsx's, deliberately
   * reused rather than re-invented: a wrapper at one depth is the draggable that
   * contains exactly ONE of that depth's own title inputs (an ancestor contains
   * all of them), and a lesson wrapper is the only draggable with no draggable
   * inside it.
   */
  const inputsWith = (c: ParentNode, placeholderPrefix: string): HTMLInputElement[] =>
    Array.from(c.querySelectorAll('input')).filter((i) =>
      (i.getAttribute('placeholder') ?? '').startsWith(placeholderPrefix)) as HTMLInputElement[];
  const titles = (c: ParentNode, p: string) => inputsWith(c, p).map((i) => i.value);
  const wrappersFor = (c: ParentNode, own: HTMLInputElement[]): HTMLElement[] =>
    Array.from(c.querySelectorAll('[draggable="true"]'))
      .filter((el) => own.filter((i) => el.contains(i)).length === 1) as HTMLElement[];
  const lessonWrappers = (c: ParentNode): HTMLElement[] =>
    Array.from(c.querySelectorAll('[draggable="true"]'))
      .filter((el) => !el.querySelector('[draggable="true"]')) as HTMLElement[];

  const curriculum = async (): Promise<HTMLDivElement> => {
    const m = await editor(seed());
    await openTab(m.container, 'Curriculum');
    return m.container;
  };

  it('reorders at LEVEL depth', async () => {
    const c = await curriculum();
    expect(titles(c, 'Level Title')).toEqual(['L1', 'L2']);
    const w = wrappersFor(c, inputsWith(c, 'Level Title'));
    await act(async () => { drag(w[0], w[1]); await Promise.resolve(); });
    expect(titles(c, 'Level Title'), 'LEVEL: the drag did not commit').toEqual(['L2', 'L1']);
  });

  it('reorders at SECTION depth', async () => {
    const c = await curriculum();
    expect(titles(c, 'Section Title')).toEqual(['S1', 'S2', 'S3']);
    const w = wrappersFor(c, inputsWith(c, 'Section Title'));
    await act(async () => { drag(w[0], w[1]); await Promise.resolve(); });
    expect(titles(c, 'Section Title'), 'SECTION: the drag did not commit').toEqual(['S2', 'S1', 'S3']);
    // And the gesture stayed at its own depth.
    expect(titles(c, 'Level Title'), 'SECTION: a section gesture reordered the levels').toEqual(['L1', 'L2']);
  });

  it('reorders at LESSON depth', async () => {
    const c = await curriculum();
    const lessonTitles = () => lessonWrappers(c)
      .map((el) => (el.textContent ?? '').trim().replace(/^⠿\s*/, '').split(/\s{2,}|▼|▲|✕/)[0].trim());
    expect(lessonTitles().slice(0, 2)).toEqual(['A', 'B']);
    const w = lessonWrappers(c);
    await act(async () => { drag(w[0], w[1]); await Promise.resolve(); });
    expect(lessonTitles().slice(0, 2), 'LESSON: the drag did not commit').toEqual(['B', 'A']);
    // The two ancestor depths are undisturbed — the exact failure #413 fixed.
    expect(titles(c, 'Section Title'), 'LESSON: a lesson gesture reordered the sections').toEqual(['S1', 'S2', 'S3']);
    expect(titles(c, 'Level Title'), 'LESSON: a lesson gesture reordered the levels').toEqual(['L1', 'L2']);
  });

  it('keeps the dragstart/dragenter/dragend arrangement #413 depends on', () => {
    // #413's mechanism, asserted on the source because it is the thing that is
    // easy to "tidy" into a conventional onDragOver/onDrop pair and thereby
    // break: the commit rides on dragend, and stopPropagation is split BY EVENT
    // TYPE because an ancestor must still see a dragenter fired in a descendant.
    const src = readSrc('AdminCourseEditor.tsx');
    expect(src, '#413: an onDrop appeared — the commit rides on dragend').not.toContain('onDrop=');
    expect(src, '#413: an onDragOver appeared').not.toContain('onDragOver=');
    expect(src).toContain('onLevelDragEnd');
    for (const [handler, n] of [['onDragEnd={', 3], ['onDragStart={', 3], ['onDragEnter={', 3]] as const) {
      expect((src.split(handler).length - 1), `#413: a depth lost its ${handler}`).toBe(n);
    }
    // dragenter must NOT stop propagation; dragstart/dragend must.
    expect(src).toContain('onDragStart={(e) => { e.stopPropagation();');
    expect(src, '#413: dragenter started swallowing the event')
      .not.toMatch(/onDragEnter=\{\(e[^)]*\) => \{ e\.stopPropagation\(\)/);
  });

  it('leaves every drag handler byte-identical to the base branch', () => {
    // The strongest form of "do not touch the drag-to-reorder": the diff of this
    // file against main contains no drag handler line at all.
    const diff = execFileSync('git', ['diff', baseRef(), '--', 'src/components/AdminCourseEditor.tsx'],
      { cwd: ROOT, encoding: 'utf8' });
    const touched = diff.split('\n')
      .filter((l) => /^[+-][^+-]/.test(l))
      .filter((l) => /onDrag|dragging\.current|dragOver|dragLevel|reordered\(/i.test(l));
    expect(touched, 'THE-305 changed a drag-to-reorder line').toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. NO-REGRESSION: the #425 editor toolbar.
// ═════════════════════════════════════════════════════════════════════════════
describe('the #425 editor toolbar still renders as one horizontally-scrolling row', () => {
  it('is untouched by this ticket', () => {
    // The toolbar is RichTextEditor's, mounted into this screen. THE-305 edits
    // neither the component nor its mount, which is the whole claim.
    expect(changedSince('src/components/RichTextEditor.tsx'), 'the toolbar component was edited').toEqual([]);
    const diff = execFileSync('git', ['diff', baseRef(), '--', 'src/components/AdminCourseEditor.tsx'],
      { cwd: ROOT, encoding: 'utf8' });
    const touched = diff.split('\n')
      .filter((l) => /^[+-][^+-]/.test(l))
      .filter((l) => /RichTextEditor|editor-toolbar/.test(l));
    // The one RichTextEditor line this ticket does touch is the `sources`
    // placeholder, whose link emoji was one of the nine. Named, so any OTHER
    // toolbar-adjacent edit still fails.
    expect(touched.every((l) => l.includes('Books, articles, Bible verses')),
      'THE-305 changed a toolbar mount beyond the swept placeholder').toBe(true);
  });

  it('still mounts the shared editor, with its scroller intact', () => {
    const toolbar = readSrc('editor/RichTextToolbar.tsx');
    expect(toolbar).toContain('data-editor-toolbar');
    expect(toolbar).toContain('data-editor-toolbar-scroller');
    expect(toolbar, 'the single-row scroller lost its overflow rule').toMatch(/overflow-x-auto|overflow-x:\s*auto/);
    expect(changedSince('src/components/editor/'), 'the toolbar was edited').toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. The house rules.
// ═════════════════════════════════════════════════════════════════════════════
function baseRef(): string {
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  for (const ref of ['origin/main', 'refs/remotes/origin/main', 'main']) {
    try { return git(['rev-parse', '--verify', `${ref}^{commit}`]); } catch { /* next */ }
  }
  try {
    const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']).split(/\s+/);
    if (parents.length === 3) return parents[1];
  } catch { /* fall through */ }
  throw new Error('the base commit could not be resolved, so "byte-identical to main" would measure nothing');
}
/** Which of `paths` differ from the base. Empty means untouched. */
function changedSince(...paths: string[]): string[] {
  return execFileSync('git', ['diff', '--name-only', baseRef(), '--', ...paths],
    { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
}

describe('no colour is hardcoded, and all four palettes resolve', () => {
  it('adds no hex literal to the editor', () => {
    // The file already carried GREEN/RED/GREEN_BG/RED_BG hexes before this
    // ticket, and THE-282 deliberately left course.constants.ts's hexes alone.
    // The claim here is only that THE-305 introduced none.
    const diff = execFileSync('git', ['diff', baseRef(), '--', 'src/components/AdminCourseEditor.tsx'],
      { cwd: ROOT, encoding: 'utf8' });
    const added = diff.split('\n').filter((l) => /^\+[^+]/.test(l));
    const hexes = added.flatMap((l) => l.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []);
    expect(hexes, 'THE-305 hardcoded a colour').toEqual([]);
  });

  it('draws every icon it added from a palette-following token', () => {
    // GOLD is `var(--brand-color, ...)`, TEXT2 is `var(--text-muted)`. Both
    // follow the palette; neither is a literal. Classic is the default (#409),
    // and nothing here is palette-specific.
    const src = readSrc('AdminCourseEditor.tsx');
    expect(src).toContain('const GOLD = "var(--brand-color, #C9963A)";');
    expect(src).toContain('const TEXT2 = "var(--text-muted)";');
    for (const icon of ['<Star size={22}', '<BookOpen size={32}']) {
      expect(src).toContain(icon);
    }
  });

  /**
   * ⚠️ AMENDED BY THE-311, and RECORDED here rather than deleted or relaxed.
   *
   * THE-305's claim was TWO claims in one assertion: that the editor does not
   * import `course.constants.ts`, and that THE-305 did not edit that file. The
   * first is THE-305's own and is untouched below. The second was only ever a
   * statement about THE-305's diff — and THE-311 is the ticket that DOES fix
   * that file, mapping all seventeen exports onto existing palette tokens,
   * which is exactly what THE-282 and this comment said someone would have to
   * do eventually.
   *
   * 🔴 THE PIN IS NOT DROPPED, IT IS REPLACED BY A STRONGER ONE. Naming
   * THE-311 in a list and moving on would let any future edit to that file
   * ride in unnoticed. Instead the byte-identity claim becomes a claim about
   * the CONTENT of the diff: whatever anyone does to `course.constants.ts`, it
   * may not ADD a colour literal. That is the property this assertion existed
   * to protect ("that file's hardcoded hexes"), it holds for THE-311's diff,
   * and it keeps holding against a change nobody has thought of yet.
   *
   * The two hexes THE-311's diff does add are both `var(--token, #fallback)`
   * fallbacks and one `color-mix` lighten target, all three unreachable while
   * the token resolves — stripped here exactly as
   * `theming-member-app.test.ts` strips them, and for the same reason.
   */
  it('reads nothing out of course.constants.ts, and nothing hardcodes a colour into it', () => {
    // THE-282 reported that file's hardcoded hexes and deliberately did not fix
    // them. This ticket must not pull them in either — that is what would make
    // the diff unreviewable. 🔴 STILL TRUE, and still THE-305's own claim.
    expect(readSrc('AdminCourseEditor.tsx')).not.toContain('course.constants');

    const diff = execFileSync('git', ['diff', baseRef(), '--', 'src/utils/course.constants.ts'],
      { cwd: ROOT, encoding: 'utf8' });
    const added = diff.split('\n')
      .filter((l) => /^\+[^+]/.test(l))
      // Comment lines are prose; they quote the old hexes on purpose.
      .filter((l) => !/^\+\s*(\/\/|\*|\/\*)/.test(l))
      .map((l) => l
        .replace(/var\(\s*--[a-z0-9-]+\s*,\s*#[0-9A-Fa-f]{3,8}\s*\)/gi, 'VAR')
        .replace(/color-mix\(in srgb, VAR \d+%, #ffffff\)/gi, 'MIX'));
    const hexes = added.flatMap((l) => l.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []);
    expect(hexes, 'a colour literal was added to course.constants.ts').toEqual([]);
  });
});

/**
 * `firestore.rules` AUTO-DEPLOYS TO PRODUCTION ON MERGE, and #462 (THE-313)
 * added the `servicePlans` rule to it — `allow read: if
 * belongsToTenant(tenantId)` / `allow write: if hasPermission('manageEvents',
 * tenantId)`, inside `match /tenants/{tenantId}` beside `events`.
 *
 * 🔴 SO THE FILE IS PINNED BY CONTENT, NOT BY DIFF — the way the other 41
 * guards in this repo pin it. "Not in the diff against main" is a statement
 * about which branch you are on, and it stopped being true of this file the
 * moment another ticket legitimately landed on it; the accepted-digest SET says
 * the same thing about CONTENT and is true on any branch. BOTH values are
 * accepted because CI runs against `refs/pull/N/merge`, so a merge ref cut
 * before #462 landed carries the older one. A digest that is NEITHER — this
 * ticket editing the file — still fails, which is the entire threat.
 */

/**
 * ⚠️ AMENDED BY THE-326 — AdminDashboard.tsx IS PINNED BY DIGEST HERE, NOT BY
 * `changedSince`, AND THAT IS A STRENGTHENING RATHER THAN A RELAXATION.
 *
 * 🔴 `changedSince` ASKS WHAT THE CURRENT BRANCH CHANGED. That is the guard
 * shape this repo has been removing on sight — `THE-315.branch-diff-guards`
 * sweeps for it and #454 is the standing pass — because it is true only while
 * its own ticket is unmerged, and it goes red on the NEXT PR for a reason that
 * has nothing to do with that PR. `AdminDashboard.tsx` is the file it fails on
 * most, because it is the nav: THE-277, THE-291 and now THE-326 have all had
 * legitimate business there, and each one turned this assertion red for work it
 * was never written to detect.
 *
 * So the shell moves to the SAME accepted-digest set the rest of the repo
 * already pins it with (`the-276`, `the-283`, `the-290`, `the-294`, `the-299`,
 * `the-302`, `THE-292.country-prompt`, `AdminDocs.persistent-tree`). 🔴 The
 * claim THE-305 makes is unchanged and still strict: a digest that is neither
 * accepted value still fails, so an edit FROM THIS TICKET is caught exactly as
 * before — and it no longer depends on a base revision a depth-1 clone may not
 * have.
 *
 * ⚠️ `layout.tsx` and `functions/` stay on `changedSince`: no ticket in flight
 * touches either, so neither has the drift problem the shell has, and this
 * ticket is not the place to rewrite guards that are not failing.
 */
const ADMIN_DASHBOARD_ACCEPTED = [
  // main at 133d557 — THE-291 (#434) removed the client-side plan write.
  '446f0bcb8ffa6accf4f80467b75a50023c1441937605b11e18aa01b53d8e53f8',
  // main + THE-326 — service planning split out of Events into its own section.
  '69f7efceccd7b8381e5ceb114642f8b4634e73df1278bb082e678a1a0cb634f9',
  // 🔴 THE-327 — `'library'` added to the PLATFORM group of MORE_GROUPS and
  // the GROW group of DESKTOP_NAV_GROUPS. APPENDED, NEVER SUBSTITUTED: every
  // value above stays accepted, because CI runs against `refs/pull/N/merge`
  // and a merge ref cut before this ticket landed legitimately carries one of
  // them. A digest that is NONE of them — i.e. an edit FROM THIS TICKET —
  // still fails, exactly as before.
  //
  // ⚠️ THIS TICKET'S OWN CLAIM IS UNCHANGED: it does not open AdminDashboard.
  // THE-327 does, and only for two array entries: the founder reported the
  // Library screen deleted and it was not — the screen renders, the nav entry
  // exists and `admin-sections.ts` maps the slug, so `/admin/library` already
  // resolved. What was missing was any way to CLICK to it, because `'library'`
  // was in NEITHER group array and the desktop sidebar has no catch-all. No
  // permission, gate, tab id, render arm or import changed.
  'decfdddbdab91094c936b503f931b663eeb6ba3048ee087c541fe1580f20e31e',
// 🔴 THE-332 — the desktop nav became a rail with flyouts. APPENDED,
// never substituted: a merge ref cut before this ticket landed still
// carries a value above, and a digest that is NEITHER still fails.
'508747ccbc7b2fef051d449626ef2f81f3655b214be0494c6c21a8c7df88b9bb',
// 🔴 APPENDED BY THE-334 — main + THE-334 — one flyout at a time; the panel takes ClickUp’s shape and Settings moves to the account menu
'00db3fa2b16a506d0a23dc1d582e6581c49e03350b966fb30d82d9434b09f450',
];

describe('the files this ticket must not open are byte-identical', () => {
  it('leaves the shell alone — pinned by digest, not by this branch\'s diff', () => {
    const actual = createHash('sha256')
      .update(readFileSync(path.join(ROOT, 'src/components/AdminDashboard.tsx'))).digest('hex');
    expect(
      ADMIN_DASHBOARD_ACCEPTED,
      `AdminDashboard.tsx is at ${actual}, which is neither accepted value — so THIS ticket edited it`,
    ).toContain(actual);
  });

  it('leaves the layout and the functions alone', () => {
    expect(
      changedSince('src/app/layout.tsx', 'functions/'),
      'a file outside this ticket was modified',
    ).toEqual([]);
  });

  it('and leaves firestore.rules at an accepted digest', () => {
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
  });

  it('leaves the adoption gate and the definition of complete alone', () => {
    // maxCourses (THE-207/THE-55 closed as won't-fix) and "complete <=> every
    // lesson id is in completedLessons", which certificates also hang off.
    expect(changedSince('src/utils/course-adoption.ts')).toEqual([]);
    expect(changedSince('src/utils/course.utils.ts')).toEqual([]);
  });

  /**
   * ── 🔴 THE-312 NARROWED THIS FREEZE TO THE FILES IT IS ACTUALLY ABOUT ───────
   *
   * The list used to include `Profile.tsx` and `PersonalInformationModal.tsx`.
   * This suite is about the COURSE EDITOR HEADER. Neither settings surface is a
   * parallel ticket's file any more, and neither has anything to do with the
   * editor — but a `git diff --name-only origin/main` freeze fails on any edit
   * at any value, so those two entries alone made the settings/My-Profile
   * redesign impossible from a suite that never had an opinion about it.
   *
   * The property this assertion is FOR is diff hygiene: the course-editor work
   * must not reach sideways into unrelated screens. For the two settings
   * surfaces that is now stated as what it means — the editor does not import
   * them, and spells neither — which holds no matter how those screens are
   * later redesigned and still catches the editor reaching into them.
   *
   * ⚠️ The other five stay frozen. They are outside THE-312's scope and
   * unlocking them would be unlocking more than this ticket was asked to.
   */
  it('leaves the parallel tickets\' files alone', () => {
    expect(changedSince(
      'src/components/AdminForms.tsx',
      'src/components/AdminFundraising.tsx',
      'src/components/AdminDonations.tsx',
      'src/components/AdminAccounting.tsx',
      'src/components/PublicPledge.tsx',
    )).toEqual([]);
  });

  it('and reaches into neither settings surface — asserted by what the editor imports', () => {
    const editor = readSrc('AdminCourseEditor.tsx');
    for (const surface of ['Profile', 'PersonalInformationModal']) {
      expect(editor, `the course editor started importing ${surface}`)
        .not.toMatch(new RegExp(`from\\s+['"][^'"]*${surface}['"]`));
      expect(editor, `the course editor started mounting <${surface}>`)
        .not.toMatch(new RegExp(`<${surface}\\b`));
    }
  });

  it('adds no component, token or dependency', () => {
    expect(changedSince('package.json', 'package-lock.json'), 'a dependency was added').toEqual([]);
    expect(changedSince('src/components/ui/'), 'a ui primitive was added or edited').toEqual([]);
  });
});
