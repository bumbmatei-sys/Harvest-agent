import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import postcss from 'postcss';
import { buildUtilityCss } from '../../test/support/tailwind-build';

/**
 * The course builder's COURSE INFO tab — smaller, and split into two columns
 * (THE-187).
 *
 * PR 348 (THE-179) constrained the CURRICULUM tab and deliberately left this
 * one alone. Measured in headless Chromium against the real compiled CSS and
 * the real admin shell, at 1440px on unmodified b990525, Course Info was:
 *
 *   panel                    1080px wide
 *   "Course Title"           1048px      (a title needing about 440)
 *   "Course Description"     1048px      (a paragraph wanting 45-75 characters)
 *   "Category" / "Status"     517px each (a category select needing about 280)
 *   "Featured Course" bar    1048px      — 629.5px of nothing between the label
 *                                          block and the toggle on its right
 *   "+ Select Authors"       1048px
 *   whole panel            1229.81px tall, in a 1200px-high viewport
 *
 * The founder's verdict: "course info is extremely big. I need it way smaller
 * and split into 2 screens."
 *
 * ── How the rules reach this file ────────────────────────────────────────────
 * AdminCourseEditor.tsx carries ZERO Tailwind classes of its own — every rule
 * in it is an inline `style={}` object, and an inline style always beats a
 * class. So, exactly as PR 348 did, each rule is layered in via `className`
 * and any inline property that would shadow it is dropped first. There is one
 * of those here: the info panel's `display/flexDirection/gap`, which would
 * outrank `lg:grid` and make the split silently do nothing. It is re-stated
 * verbatim as unprefixed classes, and test 1(b) below proves the replacement
 * emits the same three declarations the inline object did.
 *
 * ── 🔴 THE LOAD-BEARING TEST IS THE FIRST ONE ────────────────────────────────
 * Below 640px the app is fine and must not move. Verified here against a
 * baseline extracted mechanically from b990525, and out-of-band by a Chromium
 * screenshot diff: 380px, 480px and 639px are byte-identical before and after
 * (sha256 2b04d0f0b85cf712 / c6ef6d0967ad2d07 / effde0af3443cf89). 768px does
 * change, and is meant to — it is above the `sm` gate every Rule 2/3 token in
 * form-layout.ts carries.
 *
 * Geometry is asserted the way PR 346 (Profile.composition.test.tsx) did it:
 * by generating the REAL Tailwind CSS from tailwind.config.ts and resolving
 * what each class actually emits at a given viewport, rather than reading
 * class names and believing them.
 *
 * Fields are named by their visible LABEL throughout, never by a value pattern.
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
  classInventory, mobileLayer, fontSizeTokens, colourTokens, allTokens,
  maxWidthPx, maxWidthTokens, isResponsive, breakpointOf, arbitraryPx,
} = await import('../../test/support/class-inventory');
const {
  FORM_CONTAINER, FORM_MEASURE, FIELD_WIDTH, FIELD_WIDTHS, ACTION_BUTTON,
  COLUMN_SPLIT, COLUMN_GROUP, COLUMN_RULES, SPLIT_MIN_PX, DENSITY_PX,
} = await import('../layout/form-layout');

const SRC = path.resolve(__dirname, '..');
const ROOT = path.resolve(SRC, '../..');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

/**
 * Baselines are extracted mechanically from b990525 — this PR's parent, the
 * unmodified file — never hand-typed. They record what the component RENDERS,
 * so they are captured by putting the pre-PR file back in the working tree and
 * running the recorder against it, the git-stash recipe
 * ChurchEnrollment.desktop-layout.test.tsx uses. (PR 348's in-process file
 * swap is not used here: Vite's transform cache does not reliably notice a
 * source file rewritten during the same run, and a baseline silently recorded
 * from the CHANGED file would pass test 1 no matter what moved.)
 *
 * To re-record — ONLY when the sub-640px rendering is deliberately changing,
 * which for this PR it is not:
 *
 *     git checkout a32665a -- src/components/AdminCourseEditor.tsx
 *     UPDATE_LAYOUT_BASELINE=1 npx vitest run \
 *       src/components/__tests__/AdminCourseEditor.course-info.test.tsx
 *     git checkout HEAD -- src/components/AdminCourseEditor.tsx
 *
 * The recorder refuses to run against a working tree that already carries this
 * PR's markup, so a stale baseline cannot be recorded by accident.
 *
 * `git` is used ONLY while recording. CI checks out at depth 1, so no revision
 * but HEAD exists on the runner — a `git show <sha>` in an assertion fails the
 * job rather than the assertion, which is exactly what it did on the first
 * attempt at this PR. Everything the tests compare against is in the fixture.
 */
const FIXTURES = path.join(__dirname, '__fixtures__');
const FIXTURE = path.join(FIXTURES, 'admin-course-editor-info-mobile.json');
const RECORDING = !!process.env.UPDATE_LAYOUT_BASELINE;
const TARGET_FILE = path.join(SRC, 'AdminCourseEditor.tsx');
/**
 * The merge base. `AdminCourseEditor.tsx` is byte-identical here and at
 * b990525, the revision the Chromium numbers above were measured on, so the
 * baseline is the same file either way.
 */
const PRE_PR_REVISION = 'a32665a';

interface Baseline {
  infoMobileBoxes: string[];
  infoLabels: string[];
  infoOrder: string[];
  infoColours: string[];
  infoFontSizes: string[];
  curriculumMobile: string[];
  /** Pre-PR source of every function that WRITES — see test 12. */
  writePaths: Record<string, string>;
}

/**
 * The write paths this PR must not touch, named by what they do rather than by
 * line number. Their pre-PR source is recorded into the fixture rather than
 * read back out of git at test time: CI checks out at depth 1, so no revision
 * but HEAD exists on the runner and a `git show <sha>` here fails the job
 * rather than the assertion.
 */
const WRITE_PATHS = [
  'const handleSave',
  'const handleUpdateCategories',
  'const addAuthorToLibrary',
  'const updateLibraryAuthor',
  'const removeLibraryAuthor',
  'const result = await ingestTextSource(',
] as const;

/**
 * The source of `name`'s own statement — from the declaration to the `;` that
 * closes it, with brackets balanced so a `;` nested inside the body does not
 * end the slice early.
 *
 * RE-DERIVED (THE-186), deliberately and with the reason recorded here rather
 * than regenerated silently: this was a fixed `slice(at, at + 1400)`, a window
 * that neither reached the end of the longest path it guards (`handleSave` is
 * 2102 chars, so ~700 of its body went unchecked) nor stopped at the end of the
 * shortest (`updateLibraryAuthor` is 768, so its window ran ~630 chars into
 * whatever happened to follow it in the file). THE-186 edits `addLevel` /
 * `updateLevel` / `onLevelDragEnd`, which sit just past `removeLibraryAuthor`,
 * and the overspill reported that as "updateLibraryAuthor changed" — a write
 * path this ticket does not touch. Every one of the six paths is byte-identical
 * to its source at PRE_PR_REVISION (a32665a) under this extractor; the fixture
 * strings below were re-derived from that same revision, so the assertion still
 * compares against a32665a and not against THE-186's own output.
 *
 * The supported re-record path cannot produce them: `beforeAll` refuses to
 * record unless the file on disk is byte-identical to a32665a's, and HEAD's
 * AdminCourseEditor.tsx diverged from it (1375 -> 1420 lines) several PRs ago.
 */
function writePathBody(src: string, name: string): string {
  const at = src.indexOf(name);
  if (at < 0) throw new Error(`${name} vanished from AdminCourseEditor.tsx`);
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') depth--;
    else if (ch === ';' && depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(`${name} has no statement end — AdminCourseEditor.tsx changed shape`);
}

let BASELINE!: Baseline;

interface Mounted { container: HTMLDivElement; unmount: () => void }
let mounted: Mounted | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });

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

/** Switch to a tab by its visible label prefix. */
async function openTab(container: HTMLDivElement, prefix: string): Promise<void> {
  const tab = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').startsWith(prefix));
  if (!tab) throw new Error(`no "${prefix}" tab button — markup changed, test needs updating`);
  await act(async () => { tab.dispatchEvent(new Event('click', { bubbles: true })); await Promise.resolve(); });
}

/** A fresh builder on the Course Info tab (the tab it opens on). */
async function info(): Promise<HTMLDivElement> {
  mounted = await mount(<AdminCourseEditor course={null} onClose={() => {}} />);
  return mounted.container;
}

/** A fresh builder on the Curriculum tab — PR 348's screen, which must not move. */
async function curriculum(): Promise<HTMLDivElement> {
  mounted = await mount(<AdminCourseEditor course={null} onClose={() => {}} />);
  await openTab(mounted.container, 'Curriculum');
  return mounted.container;
}

// ── locating things by what a person can SEE ────────────────────────────────

const mobileTokens = (el: Element): string[] =>
  (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).filter((t) => !isResponsive(t));

/** True when the element draws no box below the split — `display: contents`. */
const isInertWrapper = (el: Element): boolean => mobileTokens(el).includes('contents');

/**
 * The sub-640px BOX layer: document order, tag, and the tokens that apply on a
 * phone, with `display: contents` elements dropped and indices recomputed.
 *
 * An element whose only mobile token is `contents` generates no box at all, so
 * it cannot move anything: including it would report an inert wrapper as a
 * mobile layout change and shift every later index behind it.
 */
function mobileBoxLayer(root: ParentNode): string[] {
  return classInventory(root)
    .filter((_e, i) => !isInertWrapper(Array.from(root.querySelectorAll('*'))[i]))
    .map(({ tag, tokens }) => `${tag}\t${tokens.filter((t) => !isResponsive(t)).join(' ')}`)
    .map((row, i) => `${i}\t${row}`);
}

/**
 * The section card whose heading starts with `text`.
 *
 * Found by the heading's own visible style — every one of them is `s.
 * sectionHeading`, a `0.14em`-tracked uppercase bar — never by position or by
 * a class pattern. Prefix rather than exact match because the Authors Library
 * heading carries a "+ New Author" button beside its title.
 */
function sectionCard(root: ParentNode, text: string): HTMLElement {
  const heading = Array.from(root.querySelectorAll('div')).find((d) =>
    (d.getAttribute('style') ?? '').includes('letter-spacing: 0.14em')
    && (d.textContent ?? '').trim().startsWith(text));
  if (!heading) throw new Error(`no section heading "${text}" — markup changed, test needs updating`);
  return heading.parentElement as HTMLElement;
}

/** The clickable row whose visible title is exactly `text` (a toggle bar). */
function rowByTitle(root: ParentNode, text: string): HTMLElement {
  const title = Array.from(root.querySelectorAll('div')).find((d) => (d.textContent ?? '').trim() === text);
  if (!title) throw new Error(`no "${text}" row — markup changed, test needs updating`);
  const row = title.closest('div[style*="cursor: pointer"]');
  if (!row) throw new Error(`"${text}" is no longer inside a clickable row`);
  return row as HTMLElement;
}

/** Track count of a `grid-template-columns` value, `repeat()` included. */
function trackCount(value: string): number {
  const repeat = value.match(/^repeat\(\s*(\d+)\s*,/);
  if (repeat) return Number(repeat[1]);
  let depth = 0; let n = 1; let seen = false;
  for (const ch of value.trim()) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (/\s/.test(ch) && depth === 0) { if (seen) { n++; seen = false; } continue; }
    else seen = true;
  }
  return n;
}

/** The button whose visible label starts with `text`. */
function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim().startsWith(text));
  if (!btn) throw new Error(`no button "${text}" — markup changed, test needs updating`);
  return btn as HTMLButtonElement;
}

/** The wrapper a field's LABEL sits in — where Rule 2's cap belongs. */
function fieldBoxByLabel(root: ParentNode, label: string): HTMLElement {
  const el = Array.from(root.querySelectorAll('label')).find((l) => (l.textContent ?? '').trim() === label);
  if (!el) throw new Error(`no field labelled "${label}" — markup changed, test needs updating`);
  // Category's label shares a row with its "Manage" button, so the field box is
  // that row's parent; every other label's parent IS the field box.
  const parent = el.parentElement as HTMLElement;
  return maxWidthTokens(parent).length > 0 ? parent : (parent.parentElement as HTMLElement);
}

/** The panel Rule 5 splits, and its two column groups. */
function split(root: ParentNode) {
  const panel = Array.from(root.querySelectorAll('div')).find((d) =>
    COLUMN_SPLIT.split(/\s+/).every((t) => (d.getAttribute('class') ?? '').split(/\s+/).includes(t)));
  if (!panel) throw new Error('no Rule 5 split container on the Course Info tab');
  const groups = Array.from(panel.children) as HTMLElement[];
  return { panel: panel as HTMLElement, groups, left: groups[0], right: groups[1] };
}

/** Every visible label / placeholder / button label, in DOCUMENT order. */
function documentOrder(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll('label,button,select,input,textarea,[data-image-upload],[data-rich-text-editor]'))
    .map((el) => {
      const tag = el.tagName.toLowerCase();
      const text = (el.getAttribute('placeholder')
        ?? el.getAttribute('data-image-upload')
        ?? (tag === 'label' || tag === 'button' ? (el.textContent ?? '').trim() : '')) || tag;
      return `${tag}:${text}`;
    });
}

/** Every visible field label, in document order. */
const fieldLabels = (root: ParentNode): string[] =>
  Array.from(root.querySelectorAll('label')).map((l) => (l.textContent ?? '').trim());

// ── the real Tailwind CSS, resolved per viewport (PR 346's machinery) ───────

interface Emitted { cls: string; minWidth: number; decls: Record<string, string> }
let emitted: Emitted[] = [];

beforeAll(async () => {
  if (RECORDING) {
    const onDisk = readFileSync(TARGET_FILE, 'utf8');
    const pre = execSync(`git show ${PRE_PR_REVISION}:src/components/AdminCourseEditor.tsx`,
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (onDisk !== pre) {
      throw new Error(
        'refusing to record: src/components/AdminCourseEditor.tsx is not '
        + `${PRE_PR_REVISION}'s. Stash it first — see the recipe at the top of this file.`,
      );
    }
    const infoContainer = await info();
    const recorded: Baseline = {
      infoMobileBoxes: mobileBoxLayer(infoContainer),
      infoLabels: fieldLabels(infoContainer),
      infoOrder: documentOrder(infoContainer),
      infoColours: colourTokens(infoContainer),
      infoFontSizes: fontSizeTokens(infoContainer),
      curriculumMobile: [],
      writePaths: Object.fromEntries(WRITE_PATHS.map((fn) => [fn, writePathBody(pre, fn)])),
    };
    mounted!.unmount(); mounted = null;
    recorded.curriculumMobile = mobileLayer(await curriculum());
    mounted!.unmount(); mounted = null;
    writeFileSync(FIXTURE, JSON.stringify(recorded, null, 2) + '\n');
  }
  BASELINE = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Baseline;

  // Generate the app's REAL utilities for every class the Course Info tab
  // renders, so geometry is read out of emitted CSS rather than class names.
  const container = await info();
  const raw = allTokens(container).join(' ');
  mounted!.unmount(); mounted = null;

  // v4 emits the same utilities wrapped in `@layer utilities` and with theme
  // values referenced rather than inlined; buildUtilityCss undoes exactly
  // those two representational changes, so the walker below is unchanged.
  const out = { css: await buildUtilityCss(raw) };

  const unescape = (sel: string) =>
    sel.replace(/^\./, '')
      .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/\\/g, '');
  emitted = [];
  const collect = (node: postcss.Rule, minWidth: number) => {
    const decls: Record<string, string> = {};
    node.walkDecls((d) => { decls[d.prop] = d.value.trim(); });
    emitted.push({ cls: unescape(node.selector), minWidth, decls });
  };
  postcss.parse(out.css).each((node) => {
    if (node.type === 'rule') collect(node, 0);
    if (node.type === 'atrule' && node.name === 'media') {
      const m = node.params.match(/min-width:\s*([\d.]+)px/);
      if (!m) return;
      node.walkRules((r) => collect(r, Number(m[1])));
    }
  });
  expect(emitted.length, 'Tailwind produced no rules for the Course Info classes').toBeGreaterThan(0);
}, 180_000);

/** Declarations in force for an element's classes at `viewport`, later winning. */
function effective(el: Element, viewport: number): Record<string, string> {
  const wanted = new Set((el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean));
  const out: Record<string, string> = {};
  for (const rule of emitted) {
    if (!wanted.has(rule.cls) || rule.minWidth > viewport) continue;
    Object.assign(out, rule.decls);
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. 🔴 The one that matters most.
// ═════════════════════════════════════════════════════════════════════════════
describe('the sub-640px rendering of Course Info is unchanged', () => {
  it('draws the same boxes below 640px as it did before the split existed', async () => {
    const now = mobileBoxLayer(await info());
    expect(now.length, 'a box appeared or vanished on the phone').toBe(BASELINE.infoMobileBoxes.length);

    // Exactly ONE line may differ, and only the panel's: its inline
    // display/flexDirection/gap moved to classes so that `lg:grid` is not
    // shadowed. 1(b) proves the replacement is the same three declarations.
    const moved = now
      .map((row, i) => ({ i, before: BASELINE.infoMobileBoxes[i], after: row }))
      .filter(({ before, after }) => before !== after);
    expect(moved.map((m) => m.after.split('\t').slice(1).join('\t')))
      .toEqual(['div\tflex flex-col gap-[16px]']);
    expect(moved.map((m) => m.before.split('\t').slice(1).join('\t'))).toEqual(['div\t']);
  });

  it('replaces the panel\'s inline box with classes that emit the same three declarations', async () => {
    const { panel } = split(await info());
    const d = effective(panel, 639);
    expect(d.display).toBe('flex');
    expect(d['flex-direction']).toBe('column');
    expect(d.gap).toBe('16px');
    // And those are exactly the three the untouched `s.panel` still carries
    // for the Curriculum tab, spelled out in the source rather than assumed.
    expect(read('AdminCourseEditor.tsx'))
      .toContain('panel: { display: "flex", flexDirection: "column", gap: 16 },');
  });

  it('adds two wrapper elements that draw no box at all below the split', async () => {
    const { groups } = split(await info());
    expect(groups).toHaveLength(2);
    for (const g of groups) {
      expect(mobileTokens(g), 'a column group carries a mobile-applicable rule').toEqual(['contents']);
      for (const viewport of [0, 380, 639, 768, SPLIT_MIN_PX - 1]) {
        expect(effective(g, viewport).display, `group has a box at ${viewport}px`).toBe('contents');
      }
    }
  });

  it('gates every rule this PR applies at sm: or above, and the split itself at lg:', () => {
    const smRules = [FORM_MEASURE, ACTION_BUTTON, ...FIELD_WIDTHS];
    const ungated = smRules.flatMap((r) => r.split(/\s+/)).filter((t) => !isResponsive(t));
    expect(ungated, 'these tokens would apply at every width, mobile included').toEqual([]);
    expect([...new Set(smRules.flatMap((r) => r.split(/\s+/)).map(breakpointOf))]).toEqual(['sm']);
    const splitGates = new Set(COLUMN_RULES.flatMap((r) => r.split(/\s+/)).map(breakpointOf));
    expect([...splitGates], 'Rule 5 must not fire before the admin shell is desktop').toEqual(['lg']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Touch targets.
//
// FINDING (pre-existing, NOT introduced here, and NOT fixed here). Measured in
// headless Chromium at 380px on unmodified b990525, several Course Info
// controls are already under the 44px touch minimum:
//
//   "Select category..." select   38px      "Status" select              38px
//   "+ Select Authors" button   33.5px      "Manage" button            16.5px
//   "Preview certificate" button 41.5px     "Course Title" input         41px
//
// The two instructions collide: "mobile must not change" is 🔴 and absolute,
// and raising any of these to 44px changes mobile. This PR keeps mobile
// byte-identical (test 1, plus the screenshot hashes in the header), so it
// cannot and does not fix them — THE-187 is a desktop layout change. What this
// test enforces is the half that is actually in scope: nothing this PR does
// makes any touch target smaller, and every rule it adds is gated above the
// phone range. Raising these six is its own change to the mobile rendering and
// wants its own ticket.
// ═════════════════════════════════════════════════════════════════════════════
describe('mobile touch targets are not made smaller, and the sub-44px ones are pinned', () => {
  it('adds no unprefixed height, padding or width token anywhere on the tab', async () => {
    const added = allTokens(await info())
      .filter((t) => !isResponsive(t))
      .filter((t) => /^(?:h-|min-h-|p[xytb]?-|w-|max-w-)/.test(t));
    expect(added, 'an unprefixed size token can only land on the phone').toEqual([]);
  });

  it('leaves every control that was under 44px exactly the size it was', async () => {
    // Recorded from the Chromium run above; asserted structurally, because the
    // sizes come from inline styles this PR does not touch and classes that
    // cannot apply below 640px.
    const c = await info();
    const controls = [
      buttonByText(c, '+ Select Authors'),
      buttonByText(c, 'Manage'),
      buttonByText(c, 'Preview certificate'),
      ...Array.from(c.querySelectorAll('select')),
    ];
    for (const el of controls) {
      const mobile = mobileTokens(el);
      expect(mobile.filter((t) => /^(?:h-|p[xytb]?-|min-h-)/.test(t)), 'a size class reached the phone').toEqual([]);
      for (const viewport of [380, 639]) {
        const d = effective(el, viewport);
        for (const prop of ['height', 'min-height', 'padding', 'padding-top', 'padding-bottom']) {
          expect(d[prop], `${prop} leaked below 640px`).toBeUndefined();
        }
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Two columns at desktop, one below the split.
// ═════════════════════════════════════════════════════════════════════════════
describe('Course Info is two columns at desktop widths and one below the split', () => {
  it('is a single flex column at every width below the split breakpoint', async () => {
    const { panel } = split(await info());
    for (const viewport of [380, 639, 768, 1023]) {
      const d = effective(panel, viewport);
      expect(d.display, `not one column at ${viewport}px`).toBe('flex');
      expect(d['flex-direction']).toBe('column');
      expect(d['grid-template-columns'], `a track list is in force at ${viewport}px`).toBeUndefined();
    }
  });

  it('is a two-track grid from the split breakpoint up', async () => {
    const { panel } = split(await info());
    for (const viewport of [SPLIT_MIN_PX, 1280, 1440]) {
      const d = effective(panel, viewport);
      expect(d.display, `not a grid at ${viewport}px`).toBe('grid');
      const tracks = d['grid-template-columns'];
      expect(tracks, `no tracks at ${viewport}px`).toBeTruthy();
      expect(trackCount(tracks), `not two columns at ${viewport}px`).toBe(2);
      // `repeat(2, …)` — one track definition used twice, so neither column
      // can be a strip the other has to carry.
      expect(tracks, `unequal tracks at ${viewport}px`).toMatch(/^repeat\(2,/);
    }
  });

  it('splits at lg, where the admin shell itself becomes desktop — not at xl', () => {
    // THE-184: a split at `xl` puts the reflow at exactly 1280px, which is
    // where PR 347 measured a 41px overflow. The shell takes its 275.5px of
    // chrome at `lg`, so `lg` is the one width at which the available width
    // already moves.
    expect(SPLIT_MIN_PX).toBe(1024);
    for (const rule of COLUMN_RULES) {
      for (const token of rule.split(/\s+/)) expect(breakpointOf(token)).toBe('lg');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 & 5. Where the boundary is.
//
// The founder: "Put all these to the left up to the author, and everything
// below Select Author to the right of the screen." The boundary is the Authors
// section: it and everything above it on the left, everything below it on the
// right. See the PR description for the two readings of "below Select Author"
// and the measurements that chose between them — cutting BETWEEN the Authors
// heading and its own "+ Select Authors" control leaves the heading 526.44px
// below the control it names, and swings the columns 194.94px out of balance
// against the 19.06px they carry as shipped.
// ═════════════════════════════════════════════════════════════════════════════
describe('everything through the Authors heading is in the left column', () => {
  it('puts Basic Information and Authors on this Course on the left', async () => {
    const c = await info();
    const { left } = split(c);
    for (const heading of ['Basic Information', 'Authors on this Course']) {
      expect(left.contains(sectionCard(c, heading)), `"${heading}" is not in the left column`).toBe(true);
    }
  });

  it('keeps the Authors heading and its own "+ Select Authors" control in the same column', async () => {
    const c = await info();
    const { left } = split(c);
    expect(left.contains(sectionCard(c, 'Authors on this Course'))).toBe(true);
    expect(left.contains(buttonByText(c, '+ Select Authors')),
      'the control was separated from the heading that names it').toBe(true);
  });

  it('puts every Course Info field on the left — the whole form is one column', async () => {
    const c = await info();
    const { left } = split(c);
    for (const label of ['Course Title', 'Course Description', 'Category', 'Status']) {
      expect(left.contains(fieldBoxByLabel(c, label)), `"${label}" is not in the left column`).toBe(true);
    }
    expect(left.contains(rowByTitle(c, 'Featured Course')), 'Featured Course moved').toBe(true);
  });
});

describe('everything below the Select Authors control is in the right column', () => {
  it('puts the Authors Library, the Thumbnail and the Certificate settings on the right', async () => {
    const c = await info();
    const { right } = split(c);
    for (const heading of ['Authors Library', 'Thumbnail', 'Certificate']) {
      expect(right.contains(sectionCard(c, heading)), `"${heading}" is not in the right column`).toBe(true);
    }
  });

  it('leaves nothing above the boundary on the right', async () => {
    const c = await info();
    const { right } = split(c);
    for (const heading of ['Basic Information', 'Authors on this Course']) {
      expect(right.contains(sectionCard(c, heading)), `"${heading}" crossed the split`).toBe(false);
    }
    expect(right.contains(buttonByText(c, '+ Select Authors'))).toBe(false);
  });

  it('accounts for every section — the five that exist are the five that are placed', async () => {
    const c = await info();
    const { left, right } = split(c);
    const headings = ['Basic Information', 'Authors on this Course', 'Authors Library', 'Thumbnail', 'Certificate'];
    const placed = headings.map((h) => {
      const card = sectionCard(c, h);
      return left.contains(card) ? 'left' : right.contains(card) ? 'right' : 'nowhere';
    });
    expect(placed).toEqual(['left', 'left', 'right', 'right', 'right']);
    // And there is no sixth section quietly added or dropped.
    expect(Array.from(left.children).length + Array.from(right.children).length).toBe(headings.length);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Top edges.
// ═════════════════════════════════════════════════════════════════════════════
describe('the two columns align at the top', () => {
  it('starts both columns in the grid\'s first row, at its start edge', async () => {
    const { panel, groups } = split(await info());
    // Both groups are DIRECT children of the grid, so they occupy row 1
    // together — a wrapper slipped around either is what breaks this.
    expect(Array.from(panel.children)).toHaveLength(2);
    expect(Array.from(panel.children)).toEqual(groups);
    for (const viewport of [SPLIT_MIN_PX, 1440]) {
      expect(effective(panel, viewport)['align-items'], `columns not top-aligned at ${viewport}px`)
        .toBe('flex-start');
    }
  });

  it('splits by explicit grouping, not auto-placement — each column is its own stack', async () => {
    // PR 346's finding: with auto-placement each block's top is tied to the
    // tallest block in its grid ROW, so a tall card on one side pushes a gap
    // into the other. Two explicit groups, each a flex column, cannot do that.
    const { groups } = split(await info());
    for (const g of groups) {
      const d = effective(g, 1440);
      expect(d.display).toBe('flex');
      expect(d['flex-direction']).toBe('column');
      // Rule 4's own two names for this 16px — no third one was minted.
      expect(d['row-gap'] ?? d.gap).toBe(`${DENSITY_PX.rowGap}px`);
      expect(d['column-gap'] ?? d.gap).toBe(`${DENSITY_PX.columnGap}px`);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. Document order — a screen reader and the tab key follow this, not the grid.
// ═════════════════════════════════════════════════════════════════════════════
describe('document order is unchanged', () => {
  it('renders every label, control and button in exactly the sequence it did before', async () => {
    expect(documentOrder(await info())).toEqual(BASELINE.infoOrder);
  });

  it('renders the same field labels, in the same order', async () => {
    expect(fieldLabels(await info())).toEqual(BASELINE.infoLabels);
  });

  it('reads left column then right column, so the visual order is the DOM order', async () => {
    const c = await info();
    const { left, right } = split(c);
    const all = Array.from(c.querySelectorAll('*'));
    const first = (el: Element) => all.indexOf(el);
    expect(first(left)).toBeLessThan(first(right));
    // Nothing was moved across the split to make the columns balance: the last
    // thing in the left column still precedes the first thing in the right.
    expect(first(left.lastElementChild!)).toBeLessThan(first(right.firstElementChild!));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. Dead space.
// ═════════════════════════════════════════════════════════════════════════════
describe('no region wider than a stated threshold is empty at 1440px', () => {
  /**
   * Threshold: 340px, the same number PR 346 settled on for the Profile page,
   * reused rather than re-invented. The only band that can be blank across the
   * page's whole height here is the centring margin either side of the form
   * measure — the page measure the tab wrapper carries is 1120px and the form
   * measure inside it is 940px, so 90px per side.
   *
   * The VERTICAL residual — the shorter column's tail — is not derivable from
   * CSS, so it is measured in Chromium and recorded: at 1440px the left column
   * is 625.44px and the right 606.38px, a 19.06px tail on a 462px column; at
   * 1024px, 661.5px against 643.88px, a 17.62px tail. Reproduce with the
   * screenshot recipe in the PR description. What this test can enforce is the
   * structural property that keeps it small: neither column holds fewer than
   * two of the five sections.
   */
  const THRESHOLD = 340;
  const VIEWPORT = 1440;

  it('leaves at most a 90px centring margin — no blank band anywhere near the threshold', async () => {
    const c = await info();
    const { panel } = split(c);
    const wrapper = Array.from(c.querySelectorAll('div')).find((d) =>
      FORM_CONTAINER.split(/\s+/).every((t) => (d.getAttribute('class') ?? '').split(/\s+/).includes(t)))!;
    const page = maxWidthPx(maxWidthTokens(wrapper)[0]);
    const form = maxWidthPx(maxWidthTokens(panel).find((t) => maxWidthPx(t) !== null)!);
    expect(page, 'the tab wrapper lost its page measure').toBe(1120);
    expect(form, 'the panel is not on the form measure').toBe(940);
    expect(effective(panel, VIEWPORT)['margin-left']).toBe('auto');
    const band = (page! - form!) / 2;
    expect(band, `dead band ${band}px at ${VIEWPORT}`).toBeLessThanOrEqual(THRESHOLD);
  });

  it('fills both columns — neither side is a stub the other has to carry', async () => {
    const { left, right } = split(await info());
    expect(left.children.length).toBeGreaterThanOrEqual(2);
    expect(right.children.length).toBeGreaterThanOrEqual(2);
  });

  it('lets each column end where its own content ends, rather than stretching', async () => {
    // `items-start`, not `stretch`: a stretched short column is a tall empty
    // box, which is the dead region this test exists to keep out.
    const { panel } = split(await info());
    expect(effective(panel, VIEWPORT)['align-items']).toBe('flex-start');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. Every number comes from form-layout.
// ═════════════════════════════════════════════════════════════════════════════
describe('widths, heights and gaps come from form-layout, not new per-screen values', () => {
  it('is imported by AdminCourseEditor.tsx', () => {
    expect(read('AdminCourseEditor.tsx')).toContain("from './layout/form-layout'");
  });

  it('draws every responsive token the tab renders from the module\'s own rules', async () => {
    const known = new Set(
      [FORM_CONTAINER, FORM_MEASURE, ACTION_BUTTON, ...FIELD_WIDTHS, ...COLUMN_RULES]
        .flatMap((r) => r.split(/\s+/)),
    );
    // The curriculum tab's own THE-179 indent steps do not render here, but the
    // builder chrome around the tab does; only tokens the module owns may
    // carry a LENGTH.
    const sized = allTokens(await info())
      .filter(isResponsive)
      .filter((t) => arbitraryPx(t) !== null || maxWidthPx(t) !== null);
    const stray = sized.filter((t) => !known.has(t));
    expect(stray, 'a length defined outside form-layout.ts rebuilds the problem in a new syntax').toEqual([]);
  });

  it('spells no width, gap or breakpoint inline in the component', () => {
    const src = read('AdminCourseEditor.tsx');
    // Comments quote the measured numbers; code must not.
    const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    expect(code.match(/sm:max-w-|sm:mx-auto|sm:flex-none|lg:grid-cols-|lg:gap-/g)).toBeNull();
  });

  it('takes the one unprefixed length it does carry straight off the panel it replaced', async () => {
    // `gap-[16px]` is not a new per-screen value: it re-states `s.panel`'s own
    // inline `gap: 16`, and it is the same 16px Rule 4 settled for a row gap.
    const { panel } = split(await info());
    const unprefixed = mobileTokens(panel).filter((t) => arbitraryPx(t) !== null);
    expect(unprefixed).toEqual(['gap-[16px]']);
    expect(arbitraryPx(unprefixed[0])).toBe(DENSITY_PX.rowGap);
    expect(DENSITY_PX.columnGap, 'the two axes of one 16px gap have drifted apart')
      .toBe(DENSITY_PX.rowGap);
    // Rule 5 exports no gap constant of its own — THE-181 already named this
    // 16px on both axes, and a second name for it is what this module exists
    // to prevent.
    expect(read('layout/form-layout.ts')).not.toMatch(/^export const SPLIT_GAP_PX/m);
  });

  it('gives Course Title, Course Description, Category and Status the widths the rules name', async () => {
    const c = await info();
    const widthOf = (label: string) =>
      maxWidthTokens(fieldBoxByLabel(c, label)).find((t) => maxWidthPx(t) !== null);
    expect(widthOf('Course Title')).toBe(FIELD_WIDTH.long);
    expect(widthOf('Course Description')).toBe(FIELD_WIDTH.long);
    expect(widthOf('Category')).toBe(FIELD_WIDTH.medium);
    expect(widthOf('Status')).toBe(FIELD_WIDTH.medium);
    expect(maxWidthPx(FIELD_WIDTH.medium)).toBe(280);
  });

  it('adds no fifth field width for the description editor', () => {
    // A multi-line editor wants a MEASURE — 45-75 characters of a 14px face is
    // 400-480px — and `long` (440px) is already the middle of that band.
    expect(FIELD_WIDTHS).toHaveLength(4);
    expect(maxWidthPx(FIELD_WIDTH.long)).toBe(440);
  });

  it('makes "+ Select Authors" content width from sm up, and nothing on the phone', async () => {
    const btn = buttonByText(await info(), '+ Select Authors');
    const tokens = (btn.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    expect(tokens.filter((t) => !isResponsive(t)), 'a width class reached the phone').toEqual([]);
    for (const t of ACTION_BUTTON.split(/\s+/)) expect(tokens).toContain(t);
    expect(tokens).toContain('sm:w-auto');
    expect(tokens).toContain('sm:self-start');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. PR 348's screen.
// ═════════════════════════════════════════════════════════════════════════════
describe('the Curriculum tab is untouched', () => {
  it('renders the same class layer below 640px as it did before this PR', async () => {
    expect(mobileLayer(await curriculum())).toEqual(BASELINE.curriculumMobile);
  });

  it('still caps the shared tab wrapper at the 1120px PAGE measure, not the form measure', async () => {
    const c = await curriculum();
    const capped = Array.from(c.querySelectorAll('div')).find((d) => maxWidthTokens(d).length > 0)!;
    expect(maxWidthTokens(capped).map(maxWidthPx).find((v): v is number => v !== null)).toBe(1120);
    expect(capped.className).toContain('sm:mx-auto');
  });

  it('renders no part of Rule 5 on the Curriculum tab', async () => {
    const tokens = new Set(allTokens(await curriculum()));
    for (const t of COLUMN_RULES.flatMap((r) => r.split(/\s+/))) expect(tokens.has(t)).toBe(false);
    expect(tokens.has('contents')).toBe(false);
  });

  it('leaves the Curriculum panel on the untouched shared style object', () => {
    const src = read('AdminCourseEditor.tsx');
    expect(src).toContain('{tab === "curriculum" && (\n <div style={s.panel}>');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. Colour.
// ═════════════════════════════════════════════════════════════════════════════
describe('no colour is hardcoded, and all four palettes resolve', () => {
  it('adds no colour-bearing class — every className added here is structural', async () => {
    expect(colourTokens(await info())).toEqual(BASELINE.infoColours);
  });

  it('defines no colour in the shared rules module', () => {
    const code = read('layout/form-layout.ts').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/\b(?:rgba?|hsla?|oklch|color-mix)\(/);
    const probe = document.createElement('div');
    probe.appendChild(document.createElement('span')).className =
      [FORM_MEASURE, ACTION_BUTTON, ...FIELD_WIDTHS, ...COLUMN_RULES].join(' ');
    expect(colourTokens(probe)).toEqual([]);
  });

  it('leaves all four palettes able to resolve exactly as they did', () => {
    const css = readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8');
    expect(css).toMatch(/^\s*:root\s*\{/m);
    expect(css).toMatch(/\[data-theme="dark"\]\s*\{/);
    expect(css).toMatch(/\[data-palette="classic"\]\[data-theme="light"\]\s*\{/);
    expect(css).toMatch(/\[data-palette="classic"\]\[data-theme="dark"\]\s*\{/);
  });

  it('changes no font size', async () => {
    expect(fontSizeTokens(await info())).toEqual(BASELINE.infoFontSizes);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 12. Behaviour.
// ═════════════════════════════════════════════════════════════════════════════
describe('no field, save, publish or author path changed', () => {
  it('leaves every save, publish, draft, category and AI-knowledge path byte-identical', () => {
    const now = read('AdminCourseEditor.tsx');
    expect(Object.keys(BASELINE.writePaths).sort(), 'the recorded write paths are not the ones under test')
      .toEqual([...WRITE_PATHS].sort());
    for (const fn of WRITE_PATHS) {
      expect(writePathBody(now, fn), `${fn} changed`).toBe(BASELINE.writePaths[fn]);
    }
  });

  it('opens the author picker from "+ Select Authors", exactly as before', async () => {
    const c = await info();
    expect(c.textContent).not.toContain('Select Authors from Library');
    await act(async () => {
      buttonByText(c, '+ Select Authors').dispatchEvent(new Event('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(c.textContent, 'the author picker no longer opens').toContain('Authors Library');
  });

  it('still toggles Featured Course, Issue certificates and Require passing quiz', async () => {
    const c = await info();
    for (const title of ['Featured Course', 'Issue certificates', 'Require passing quiz']) {
      const before = rowByTitle(c, title).outerHTML;
      await act(async () => {
        rowByTitle(c, title).dispatchEvent(new Event('click', { bubbles: true }));
        await Promise.resolve();
      });
      expect(rowByTitle(c, title).outerHTML, `"${title}" no longer toggles`).not.toBe(before);
    }
  });

  it('still shows and hides the category manager', async () => {
    const c = await info();
    expect(c.textContent).not.toContain('Hide');
    await act(async () => {
      buttonByText(c, 'Manage').dispatchEvent(new Event('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(buttonByText(c, 'Hide')).toBeTruthy();
  });

  it('keeps the same two tabs, in the same order', async () => {
    const c = await info();
    const tabs = Array.from(c.querySelectorAll('button'))
      .map((b) => (b.textContent ?? '').trim())
      .filter((t) => t === 'Course Info' || t.startsWith('Curriculum'));
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toBe('Course Info');
    expect(tabs[1]).toMatch(/^Curriculum \(\d+\)$/);
  });
});
