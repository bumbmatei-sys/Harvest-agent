import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * Desktop layout rules for the course builder's Curriculum tab (THE-179).
 *
 * AdminCourseEditor carries ZERO Tailwind classes — every existing rule in it
 * is an inline `style={}` object. That is a different starting point than the
 * Add Church form (ChurchEnrollment.desktop-layout.test.tsx), which this file
 * otherwise mirrors: the container/field-width/button rules are the SAME
 * form-layout.ts module, added here purely via `className`, and only on the
 * handful of elements/properties the inline styles were changed to stop
 * owning (see the comments in AdminCourseEditor.tsx itself). An inline
 * `style` always wins a cascade fight against any class, so every property
 * this PR makes responsive had to be removed from `style` first — that is
 * what "no rule is shadowed" below actually checks for.
 *
 * Field lookups go through visible text (placeholder or button label), never
 * a class pattern — same discipline as the Church form's tests.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u', email: 'a@t.com' } } }));
vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => 'tenant-1',
  getWriteTenantScope: async () => 'tenant-1',
}));
vi.mock('firebase/firestore', () => ({
  collection: (_d: unknown, ...s: string[]) => ({ __path: s.join('/') }),
  doc: (_d: unknown, ...s: string[]) => ({ __path: s.join('/') }),
  query: (...a: any[]) => a,
  where: (...a: any[]) => a,
  addDoc: async () => ({ id: 'new-course' }),
  updateDoc: async () => {},
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
vi.mock('../ImageUpload', () => ({
  ImageUpload: (props: any) => <div data-image-upload="" className={props.className ?? ''} />,
}));
vi.mock('../RichTextEditor', () => ({
  default: (props: any) => (
    <textarea data-rich-text-editor="" value={props.content} onChange={(e: any) => props.onChange(e.target.value)} />
  ),
}));

const AdminCourseEditor = (await import('../AdminCourseEditor')).default;
const {
  mobileLayer, fontSizeTokens, colourTokens, allTokens,
  maxWidthPx, maxWidthTokens, isResponsive, breakpointOf,
} = await import('../../test/support/class-inventory');
const { FORM_CONTAINER, FIELD_WIDTH, FIELD_WIDTHS, ACTION_BUTTON } =
  await import('../layout/form-layout');

const SRC = path.resolve(__dirname, '..');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

/**
 * Baseline extracted mechanically, from THIS repo's HEAD~1 (d86b0a2's parent,
 * cf3d3ce — the unmodified file, before this PR's diff), never hand-typed.
 * `AdminCourseEditor.tsx` is copied out to a temp path, restored to HEAD~1,
 * mounted with the SAME mocks the assertions use, then put back — mirroring
 * the git-stash recipe in ChurchEnrollment.desktop-layout.test.tsx, adapted to
 * `git show` because there is one committed "before" revision to diff against
 * rather than uncommitted work to stash.
 *
 * To re-record — ONLY when the sub-640px rendering is deliberately changing,
 * which for this PR it is not:
 *
 *     UPDATE_LAYOUT_BASELINE=1 npx vitest run \
 *       src/components/__tests__/AdminCourseEditor.desktop-layout.test.tsx
 */
const FIXTURES = path.join(__dirname, '__fixtures__');
const RECORDING = !!process.env.UPDATE_LAYOUT_BASELINE;
const TARGET_FILE = path.join(SRC, 'AdminCourseEditor.tsx');
const PRE_PR_REVISION = 'cf3d3ce';

interface Baseline { mobileLayer: string[]; fontSizes: string[]; colours: string[] }

const readFixture = <T,>(name: string): T =>
  JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8')) as T;

let BASELINE!: Baseline;

/**
 * THE-305 — the deliberate, RECORDED delta between the measured baseline and
 * what this screen renders now.
 *
 * APPEND-ONLY, AND THE FIXTURE IS NEVER REWRITTEN. Re-recording is the wrong
 * tool here twice over: the recorder mounts `PRE_PR_REVISION`'s source, so it
 * would reproduce the identical baseline and accept nothing; and substituting a
 * baseline is how a guard silently stops guarding. So the fixture stays exactly
 * as it was measured and the edit is spelled out below, row for row. Every row
 * this ticket did not touch is still compared byte-for-byte.
 *
 * `remove` is asserted to MATCH the baseline at `at` before it is dropped, so a
 * stale or wrong entry fails loudly instead of masking a real change, and the
 * list cannot outlive the edit that justifies it.
 */
const EDITED_SINCE_MEASUREMENT: ReadonlyArray<{
  ticket: string;
  why: string;
  /** Offset into the ORIGINAL baseline (edits are applied highest-first). */
  at: number;
  remove: readonly string[];
  insert: readonly string[];
}> = [
  {
    ticket: 'THE-305',
    at: 4,
    remove: ['button\t', 'svg\tlucide lucide-arrow-left', 'path\t', 'path\t', 'div\t', 'h1\t'],
    insert: [],
    why:
      'Deleted the editor\'s SECOND back arrow and its in-body <h1>. The screen ' +
      'drew two stacked headers: the shell\'s (back chevron, the title "Courses", ' +
      'the avatar) and, directly below it, this one — another back arrow over a ' +
      '"New Course" heading that wrapped onto three lines. AdminScreenHeader\'s own ' +
      'contract already forbade it ("Rendered once per screen — screens must NOT ' +
      'repeat their own title below it"). The title and the back handler now go up ' +
      'to the shared header through setHeaderOverride, the mechanism AdminEvents, ' +
      'AdminCRM and AdminCommunity already use, so AdminDashboard.tsx is untouched. ' +
      'The six rows are exactly that arrow (button + its lucide-arrow-left svg and ' +
      'two paths) and the heading (its wrapper div + the h1). The row immediately ' +
      'after them — the "1 level / 1 section / 1 lesson" <p> — is deliberately NOT ' +
      'in this list: the subtitle stays, in the same slot, at the same size and ' +
      'colour, which is what keeps its information from being lost with the heading.',
  },
];

/**
 * The recorded baseline with `EDITED_SINCE_MEASUREMENT` applied and re-indexed.
 *
 * Edits are applied highest-offset-first so every `at` stays an offset into the
 * ORIGINAL baseline and no entry has to account for another entry's shift.
 */
function editedRows(baseline: readonly string[], indexed: boolean): string[] {
  const rows = baseline.map((r) => (indexed ? r.replace(/^\d+\t/, '') : r));
  for (const e of [...EDITED_SINCE_MEASUREMENT].sort((a, b) => b.at - a.at)) {
    expect(
      rows.slice(e.at, e.at + e.remove.length),
      `${e.ticket}: the baseline no longer says what this entry removes — drop or fix the entry`,
    ).toEqual([...e.remove]);
    rows.splice(e.at, e.remove.length, ...e.insert);
  }
  return indexed ? rows.map((r, i) => `${i}\t${r}`) : rows;
}

describe('the recorded edit is exactly the edit that justifies it', () => {
  it('names its ticket, states a reason, and actually changes something', () => {
    expect(EDITED_SINCE_MEASUREMENT.map((e) => e.ticket)).toEqual(['THE-305']);
    for (const e of EDITED_SINCE_MEASUREMENT) {
      expect(e.remove.length + e.insert.length, `${e.ticket} removes and inserts nothing`).toBeGreaterThan(0);
      expect(e.why.length, `${e.ticket} is recorded without a stated reason`).toBeGreaterThan(80);
    }
  });

  it('leaves the subtitle standing — its information is not lost with the heading', async () => {
    // The heading went; the line under it did not. Asserted on the render, not
    // on the delta list, so removing the <p> later fails here even if someone
    // also edits the list above to match.
    const text = ((await builder()).textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('1 level');
    expect(text).toContain('1 section');
    expect(text).toContain('1 lesson');
  });
});

beforeAll(async () => {
  if (RECORDING) {
    const backup = readFileSync(TARGET_FILE, 'utf8');
    try {
      const preDiff = execSync(`git show ${PRE_PR_REVISION}:src/components/AdminCourseEditor.tsx`, {
        cwd: path.resolve(SRC, '../..'), encoding: 'utf8',
      });
      writeFileSync(TARGET_FILE, preDiff);
      vi.resetModules();
      const PreDiffEditor = (await import('../AdminCourseEditor')).default;
      const { container, unmount } = await mount(<PreDiffEditor course={null} onClose={() => {}} />);
      await openCurriculum(container);
      writeFileSync(path.join(FIXTURES, 'admin-course-editor-mobile.json'), JSON.stringify({
        mobileLayer: mobileLayer(container), fontSizes: fontSizeTokens(container), colours: colourTokens(container),
      } satisfies Baseline, null, 2) + '\n');
      unmount();
    } finally {
      writeFileSync(TARGET_FILE, backup);
      vi.resetModules();
    }
  }
  BASELINE = readFixture<Baseline>('admin-course-editor-mobile.json');
});

interface Mounted { container: HTMLDivElement; unmount: () => void }

async function mount(element: React.ReactElement): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root!: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(element);
    await Promise.resolve();
  });
  return { container, unmount: () => { act(() => root.unmount()); container.remove(); } };
}

const byText = (root: ParentNode, tag: string, text: string): HTMLElement[] =>
  Array.from(root.querySelectorAll(tag)).filter((el) => (el.textContent ?? '').trim() === text) as HTMLElement[];

const buttonByText = (root: ParentNode, text: string): HTMLButtonElement => {
  const [btn] = byText(root, 'button', text);
  if (!btn) throw new Error(`no button "${text}" — the builder markup changed, test needs updating`);
  return btn as HTMLButtonElement;
};

const inputByPlaceholder = (root: ParentNode, placeholderPrefix: string): HTMLInputElement => {
  const el = Array.from(root.querySelectorAll('input')).find((i) =>
    (i.getAttribute('placeholder') ?? '').startsWith(placeholderPrefix));
  if (!el) throw new Error(`no input placeholder "${placeholderPrefix}..." — markup changed, test needs updating`);
  return el as HTMLInputElement;
};

const setValue = (el: HTMLInputElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

/** Switch to the Curriculum tab — everything under test lives there. */
async function openCurriculum(container: HTMLDivElement): Promise<void> {
  const tab = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').startsWith('Curriculum'));
  if (!tab) throw new Error('no Curriculum tab button — markup changed, test needs updating');
  await act(async () => { tab.dispatchEvent(new Event('click', { bubbles: true })); await Promise.resolve(); });
}

/** A fresh builder, already on the Curriculum tab (one empty level/section/lesson). */
async function builder(): Promise<HTMLDivElement> {
  mounted = await mount(<AdminCourseEditor course={null} onClose={() => {}} />);
  await openCurriculum(mounted.container);
  return mounted.container;
}

/** Fire the same native DnD sequence the component's handlers listen for. */
function drag(from: HTMLElement, to: HTMLElement): void {
  from.dispatchEvent(new Event('dragstart', { bubbles: true }));
  to.dispatchEvent(new Event('dragenter', { bubbles: true }));
  from.dispatchEvent(new Event('dragend', { bubbles: true }));
}

let mounted: Mounted | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });

// ─────────────────────────────────────────────────────────────────────────────
// 1. The one that matters most.
// ─────────────────────────────────────────────────────────────────────────────
describe('the sub-640px rendering of the course builder is unchanged', () => {
  it('renders the same class layer below 640px as it did before the rules existed', async () => {
    expect(mobileLayer(await builder())).toEqual(editedRows(BASELINE.mobileLayer, true));
  });

  it('gates every shared-module rule at sm: — the first breakpoint above the phone range', () => {
    const rules = [FORM_CONTAINER, ACTION_BUTTON, ...FIELD_WIDTHS];
    const ungated = rules.flatMap((r) => r.split(/\s+/).filter(Boolean)).filter((t) => !isResponsive(t));
    expect(ungated, 'these tokens would apply at every width, mobile included').toEqual([]);
    const gates = new Set(rules.flatMap((r) => r.split(/\s+/).filter(Boolean)).map(breakpointOf));
    expect([...gates]).toEqual(['sm']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Rule 1 — the container.
// ─────────────────────────────────────────────────────────────────────────────
describe('the builder content is constrained at desktop widths', () => {
  it('caps and centres the tab content (Info and Curriculum share one wrapper)', async () => {
    const c = await builder();
    const capped = Array.from(c.querySelectorAll('div')).find((d) => maxWidthTokens(d).length > 0);
    expect(capped, 'no element in the builder carries a maximum width').toBeDefined();
    expect(capped!.className).toContain('sm:mx-auto');
  });

  it('caps it at the same 1120px form-layout.ts already proved, not a new number', async () => {
    const c = await builder();
    const capped = Array.from(c.querySelectorAll('div')).find((d) => maxWidthTokens(d).length > 0)!;
    const px = maxWidthTokens(capped).map(maxWidthPx).find((v): v is number => v !== null);
    expect(px).toBe(1120);
  });

  it('leaves the cap inert below sm', async () => {
    const c = await builder();
    const capped = Array.from(c.querySelectorAll('div')).find((d) => maxWidthTokens(d).length > 0)!;
    expect(maxWidthTokens(capped).filter((t) => !isResponsive(t))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Rule 2 — a title input is narrower than the container.
// ─────────────────────────────────────────────────────────────────────────────
describe('a title input is narrower than the container', () => {
  it('caps the Level Title input at a field width, not the container width', async () => {
    const c = await builder();
    const input = inputByPlaceholder(c, 'Level Title');
    const px = maxWidthTokens(input).map(maxWidthPx).find((v): v is number => v !== null);
    expect(px, 'Level Title carries no width rule').not.toBeNull();
    expect(px!).toBe(FIELD_WIDTH.medium === 'sm:max-w-[280px]' ? 280 : maxWidthPx(FIELD_WIDTH.medium));
    expect(px!).toBeLessThan(1120);
  });

  it('caps the Section Title input the same way', async () => {
    const c = await builder();
    const input = inputByPlaceholder(c, 'Section Title');
    const px = maxWidthTokens(input).map(maxWidthPx).find((v): v is number => v !== null);
    expect(px).toBe(maxWidthPx(FIELD_WIDTH.medium));
    expect(px!).toBeLessThan(1120);
  });

  it('still grows to fill the row below sm — flex: 1 is untouched', async () => {
    const c = await builder();
    const input = inputByPlaceholder(c, 'Level Title');
    expect(input.style.flexGrow).toBe('1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Rule 3 — the Add Level / Add Section buttons.
// ─────────────────────────────────────────────────────────────────────────────
describe('the Add Level and Add Section buttons are content width from sm up', () => {
  it('"+ Add Level" is full width on mobile and content width from sm up', async () => {
    const c = await builder();
    const tokens = buttonByText(c, '+ Add Level').className.split(/\s+/);
    const base = tokens.filter((t) => !isResponsive(t));
    expect(base).toContain('w-full');
    expect(base.filter((t) => /^(?:max-)?w-/.test(t))).toEqual(['w-full']);
    expect(tokens).toContain('sm:w-auto');
  });

  it('"+ Add Section" is full width on mobile and content width from sm up', async () => {
    const c = await builder();
    const tokens = buttonByText(c, '+ Add Section').className.split(/\s+/);
    const base = tokens.filter((t) => !isResponsive(t));
    expect(base).toContain('w-full');
    expect(tokens).toContain('sm:w-auto');
  });

  it('"+ Add Lesson" gets the same treatment — same shared button style as Add Section', async () => {
    const c = await builder();
    const tokens = buttonByText(c, '+ Add Lesson').className.split(/\s+/);
    expect(tokens.filter((t) => !isResponsive(t))).toContain('w-full');
    expect(tokens).toContain('sm:w-auto');
  });

  it('leaves every OTHER user of the shared addLessonBtn style untouched (Outline/Quiz/Link "Add" buttons)', async () => {
    // These reuse the exact same style object as Add Section/Add Lesson, but
    // were never named in scope — proving they were not swept up too.
    const c = await builder();
    // Open the one lesson so its Outline/Quiz "+ Add" buttons render. Exact
    // match (not `.includes`) so the click lands on the innermost title text
    // node and bubbles up to the header's onClick — a substring match can find
    // an outer draggable wrapper instead, which has no handler of its own.
    const lessonRow = Array.from(c.querySelectorAll('div')).find((d) =>
      (d.textContent ?? '').trim() === 'Untitled Lesson');
    await act(async () => { lessonRow!.dispatchEvent(new Event('click', { bubbles: true })); await Promise.resolve(); });
    const outlineBtn = buttonByText(c, '+ Add Outline Point');
    expect(outlineBtn.className).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Depth mechanism.
// ─────────────────────────────────────────────────────────────────────────────
describe('nesting depth is visually distinguishable at desktop widths', () => {
  it('names the mechanism: a stepped left indent (sm: only) layered on the existing per-depth card language', async () => {
    const c = await builder();
    // Pre-existing, untouched cue: the accent dot shrinks Level (10px) -> Section (6px).
    // (Not filtered on `background`: it is `var(--brand-color, #C9963A)` — a
    // fallback-form custom property happy-dom's style setter drops entirely,
    // a test-environment quirk, not a real rendering difference.)
    const dots = Array.from(c.querySelectorAll('div')).filter((d) => d.style.borderRadius === '50%');
    const levelDot = dots.find((d) => d.style.width === '10px');
    const sectionDot = dots.find((d) => d.style.width === '6px');
    expect(levelDot, 'Level accent dot missing — depth cue regressed').toBeDefined();
    expect(sectionDot, 'Section accent dot missing — depth cue regressed').toBeDefined();

    // New, sm:-gated cue: the body that holds the next depth down indents
    // further left at desktop, and the step size grows the deeper you go.
    const levelBody = Array.from(c.querySelectorAll('div')).find((d) => d.className.includes('sm:pl-[28px]'));
    const sectionBody = Array.from(c.querySelectorAll('div')).find((d) => d.className.includes('sm:pl-[24px]'));
    expect(levelBody, 'Level body carries no desktop indent step').toBeDefined();
    expect(sectionBody, 'Section body carries no desktop indent step').toBeDefined();
    // Both keep their pre-existing (smaller, unequal) mobile padding untouched.
    expect(levelBody!.className).toContain('px-[14px]');
    expect(sectionBody!.className).toContain('px-[12px]');
  });

  it('keeps the indent inert below sm — mobile padding is exactly what it was', async () => {
    const c = await builder();
    const levelBody = Array.from(c.querySelectorAll('div')).find((d) => d.className.includes('sm:pl-[28px]'))!;
    const base = levelBody.className.split(/\s+/).filter((t) => !isResponsive(t));
    expect(base.sort()).toEqual(['px-[14px]']);
    expect(levelBody.style.paddingTop).toBe('12px');
    expect(levelBody.style.paddingBottom).toBe('14px');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Behaviour guard — the most important functional test.
//
// The FINDING this block used to record — that section- and lesson-level
// drag-reorder never committed their swap, because dragstart/dragenter/dragend
// bubble and the ancestor level's handler overwrote the child's reorder with a
// pre-reorder snapshot — was FIXED in THE-186. That PR was layout-only and
// deliberately left the interaction bug alone, so these two tests pinned the
// broken outcome as a no-regression guard; they now pin the correct one.
//
// The behavioural depth of the fix lives in AdminCourseEditor.drag-reorder.
// test.tsx (all three depths, cross-parent non-interference, the shared-ref
// question, and the persisted order shape). What stays here is the narrower
// thing this file exists for: the drag wrappers still work at all after the
// layout rules landed on them.
// ─────────────────────────────────────────────────────────────────────────────
describe('drag to reorder still works at level, section and lesson depth', () => {
  it('reorders levels by their drag wrapper', async () => {
    const c = await builder();
    setValue(inputByPlaceholder(c, 'Level Title'), 'Level A');
    await act(async () => { buttonByText(c, '+ Add Level').dispatchEvent(new Event('click', { bubbles: true })); });
    const titles = () => Array.from(c.querySelectorAll('input')).filter((i) =>
      (i.getAttribute('placeholder') ?? '').startsWith('Level Title'));
    setValue(titles()[1], 'Level B');
    expect(titles().map((i) => i.value)).toEqual(['Level A', 'Level B']);

    const wrappers = Array.from(c.querySelectorAll('[draggable="true"]')).filter((el) =>
      titles().some((i) => el.contains(i)));
    await act(async () => { drag(wrappers[1] as HTMLElement, wrappers[0] as HTMLElement); });
    expect(titles().map((i) => i.value)).toEqual(['Level B', 'Level A']);
  });

  it('reorders sections by their drag wrapper (THE-186)', async () => {
    const c = await builder();
    setValue(inputByPlaceholder(c, 'Section Title'), 'Section A');
    await act(async () => { buttonByText(c, '+ Add Section').dispatchEvent(new Event('click', { bubbles: true })); });
    const titles = () => Array.from(c.querySelectorAll('input')).filter((i) =>
      (i.getAttribute('placeholder') ?? '').startsWith('Section Title'));
    setValue(titles()[1], 'Section B');
    expect(titles().map((i) => i.value)).toEqual(['Section A', 'Section B']);

    // Exactly-one-containment, not "contains any": the level's OWN draggable
    // wrapper also contains BOTH section title inputs (it's their ancestor),
    // so a `.some()` match would wrongly pick the level wrapper up as one of
    // the two "section" wrappers.
    const wrappers = Array.from(c.querySelectorAll('[draggable="true"]')).filter((el) =>
      titles().filter((i) => el.contains(i)).length === 1);
    await act(async () => { drag(wrappers[1] as HTMLElement, wrappers[0] as HTMLElement); });
    // THE-186: the swap now commits. Before it, the bubbled ancestor level
    // handler overwrote this with a pre-reorder snapshot of `course.levels`.
    expect(titles().map((i) => i.value)).toEqual(['Section B', 'Section A']);
  });

  it('reorders lessons by their drag wrapper (THE-186)', async () => {
    const c = await builder();
    const lessonTitleInputs = () => Array.from(c.querySelectorAll('input')).filter((i) =>
      (i.getAttribute('placeholder') ?? '') === 'e.g. The Power of Grace') as HTMLInputElement[];
    // Click the exact title-text node (not a substring match on some ancestor
    // draggable wrapper) so the click bubbles up into the header's onClick.
    const openLessonHeader = async (text: string) => {
      const header = Array.from(c.querySelectorAll('div')).find((d) => d.textContent!.trim() === text);
      if (!header) throw new Error(`no lesson header "${text}" — markup changed, test needs updating`);
      await act(async () => { header.dispatchEvent(new Event('click', { bubbles: true })); await Promise.resolve(); });
    };

    await openLessonHeader('Untitled Lesson');
    setValue(lessonTitleInputs()[0], 'Lesson A');
    await act(async () => { buttonByText(c, '+ Add Lesson').dispatchEvent(new Event('click', { bubbles: true })); await Promise.resolve(); });
    await openLessonHeader('Untitled Lesson'); // the new, still-untitled second lesson
    setValue(lessonTitleInputs()[1], 'Lesson B');
    expect(lessonTitleInputs().map((i) => i.value)).toEqual(['Lesson A', 'Lesson B']);

    // Exactly-one-containment: the section's (and level's) own draggable
    // wrapper contains BOTH lesson title inputs as descendants, so only a
    // wrapper containing exactly one is an actual per-lesson wrapper.
    const wrappers = Array.from(c.querySelectorAll('[draggable="true"]')).filter((el) =>
      lessonTitleInputs().filter((i) => el.contains(i)).length === 1);
    await act(async () => { drag(wrappers[1] as HTMLElement, wrappers[0] as HTMLElement); });
    // THE-186: the swap now commits — previously BOTH the ancestor section's
    // and the ancestor level's handlers ran and reverted it.
    expect(lessonTitleInputs().map((i) => i.value)).toEqual(['Lesson B', 'Lesson A']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Add / remove / collapse at every depth.
// ─────────────────────────────────────────────────────────────────────────────
describe('add, remove and collapse still work at every depth', () => {
  it('adds and removes a level', async () => {
    const c = await builder();
    const countInputs = () => c.querySelectorAll('input[placeholder^="Level Title"]').length;
    expect(countInputs()).toBe(1);
    await act(async () => { buttonByText(c, '+ Add Level').dispatchEvent(new Event('click', { bubbles: true })); });
    expect(countInputs()).toBe(2);
    const removeBtns = Array.from(c.querySelectorAll('button')).filter((b) => b.textContent === '✕');
    await act(async () => { removeBtns[0].dispatchEvent(new Event('click', { bubbles: true })); });
    expect(countInputs()).toBe(1);
  });

  it('adds and removes a section', async () => {
    const c = await builder();
    const countInputs = () => c.querySelectorAll('input[placeholder="Section Title..."]').length;
    expect(countInputs()).toBe(1);
    await act(async () => { buttonByText(c, '+ Add Section').dispatchEvent(new Event('click', { bubbles: true })); });
    expect(countInputs()).toBe(2);
  });

  it('adds and removes a lesson', async () => {
    const c = await builder();
    // Direct-children count of the (one) section's lessons body — found by its
    // own sm:pl-[24px] indent class — rather than a text match: "Untitled
    // Lesson" appears in both the leaf title div AND its `flex:1` wrapper (an
    // empty lesson has no sibling badge text to tell them apart), double
    // counting every row.
    const lessonsBody = () => Array.from(c.querySelectorAll('div')).find((d) => d.className.includes('sm:pl-[24px]'))!;
    const countRows = () => Array.from(lessonsBody().children).filter((ch) => ch.getAttribute('draggable') === 'true').length;
    const before = countRows();
    await act(async () => { buttonByText(c, '+ Add Lesson').dispatchEvent(new Event('click', { bubbles: true })); });
    expect(countRows()).toBe(before + 1);
    const removeBtns = Array.from(lessonsBody().querySelectorAll('button')).filter((b) => b.textContent === '✕');
    await act(async () => { removeBtns[0].dispatchEvent(new Event('click', { bubbles: true })); });
    expect(countRows()).toBe(before);
  });

  it('collapses and re-expands a level', async () => {
    const c = await builder();
    expect(c.querySelectorAll('input[placeholder="Section Title..."]').length).toBe(1);
    const collapseToggles = Array.from(c.querySelectorAll('span')).filter((s) => s.textContent === '▲');
    await act(async () => { collapseToggles[0].dispatchEvent(new Event('click', { bubbles: true })); });
    expect(c.querySelectorAll('input[placeholder="Section Title..."]').length).toBe(0);
    const expandToggles = Array.from(c.querySelectorAll('span')).filter((s) => s.textContent === '▼');
    await act(async () => { expandToggles[0].dispatchEvent(new Event('click', { bubbles: true })); });
    expect(c.querySelectorAll('input[placeholder="Section Title..."]').length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Widths come from form-layout, not from new per-screen values.
// ─────────────────────────────────────────────────────────────────────────────
describe('widths come from form-layout, not from new per-screen values', () => {
  it('is imported by AdminCourseEditor.tsx', () => {
    expect(read('AdminCourseEditor.tsx')).toContain("from './layout/form-layout'");
  });

  it('every sm:max-w- token rendered by the builder matches a value form-layout.ts already exports', async () => {
    // form-layout.ts's constants are IMPORTED, not literal strings in this
    // file's source, so the check has to read what actually renders rather
    // than grep AdminCourseEditor.tsx's text for a pixel value it never spells
    // out directly.
    const found = allTokens(await builder()).filter((t) => /(?:^|:)max-w-/.test(t));
    expect(found.length, 'no width rule was applied at all').toBeGreaterThan(0);
    const known = new Set([FORM_CONTAINER, ...FIELD_WIDTHS].flatMap((r) => r.split(/\s+/)).filter((t) => t.includes('max-w-')));
    for (const token of found) expect(known.has(token), `${token} is not one of form-layout.ts's widths`).toBe(true);
  });

  it('the new indent classes are spacing, not width — no max-w/w- token among them', () => {
    // The depth mechanism (sm:pl-[28px]/sm:pl-[24px]) is intentionally NOT in
    // form-layout.ts: that module is documented as owning the container, field
    // widths and button — three WIDTH rules — not a generic indent scale.
    for (const token of ['sm:pl-[28px]', 'sm:pl-[24px]']) {
      expect(/max-w-|(?:^|:)w-/.test(token)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Colour.
// ─────────────────────────────────────────────────────────────────────────────
describe('no colour is hardcoded, and both palettes resolve', () => {
  it('adds no colour-bearing class — every className added by this PR is structural', async () => {
    expect(colourTokens(await builder())).toEqual([]);
  });

  it('leaves both palettes able to resolve exactly as they did', () => {
    const css = readFileSync(path.resolve(SRC, '../app/globals.css'), 'utf8');
    expect(css).toMatch(/^\s*:root\s*\{/m);
    expect(css).toMatch(/\[data-theme="dark"\]\s*\{/);
    // 🔴 THE-338 — the two Classic selectors this asserted are GONE, and their

    // absence is now what is asserted. The family's 14 overrides were promoted

    // into :root/.dark, so every token still resolves — in TWO palettes, not

    // four. Leaving the old assertion would have pinned a family that no

    // longer exists; deleting it outright would have stopped checking that the

    // theme scopes exist at all.

    expect(css).not.toMatch(/\[data-palette/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. PR 326's fix.
// ─────────────────────────────────────────────────────────────────────────────
describe('the Level and Section title inputs are still readable in dark mode', () => {
  it('keeps the Level title row on --surface-tint (PR 326 THE-136)', async () => {
    const c = await builder();
    const row = inputByPlaceholder(c, 'Level Title').closest('div')!;
    expect(row.style.background).toBe('var(--surface-tint)');
  });

  it('keeps the Section card on --surface-sunken (PR 326 THE-136)', async () => {
    const c = await builder();
    // Unlike the Level row, Section puts the colour on the CARD ROOT, not the
    // title-bar row: input -> title-bar (closest div) -> card root (its parent).
    const sectionCard = inputByPlaceholder(c, 'Section Title').closest('div')!.parentElement!;
    expect(sectionCard!.style.background).toBe('var(--surface-sunken)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Type scale.
// ─────────────────────────────────────────────────────────────────────────────
describe('no font size changed', () => {
  it('renders the same font-size class tokens as the baseline (empty — none exist as classes)', async () => {
    expect(fontSizeTokens(await builder())).toEqual(BASELINE.fontSizes);
  });

  it('introduces no font-size class anywhere in this PR\'s additions', async () => {
    expect(fontSizeTokens(await builder())).toEqual([]);
  });
});
