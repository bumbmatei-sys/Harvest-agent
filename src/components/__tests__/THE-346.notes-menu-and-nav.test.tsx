import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';

import AdminDocs from '../AdminDocs';
import { AdminHeaderContext } from '../AdminScreenHeader';

/**
 * THE-346 · the Notes menu, the expand control and the bottom nav — driven
 * through the REAL `AdminDocs`, not a replica.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY THE REAL COMPONENT, AND WHAT IS DELIBERATELY NOT ASKED HERE
 *
 * #475 shipped 70 tests, 33 of them measured in Chromium, and THE ATTACH MENU
 * DID NOT OPEN AT ALL — every one of those assertions was about a menu that was
 * never on the screen. So the menu here is OPENED, by clicking the trigger the
 * screen actually renders, and every row is read back out of the live DOM. A
 * menu that stopped opening fails at the first `expect`, not silently.
 *
 * NO LAYOUT CLAIM IS MADE IN THIS FILE. happy-dom has no layout engine:
 * `getBoundingClientRect()` answers zeroes and `getComputedStyle().display`
 * answers `block` for a flex container. Every geometric question this ticket
 * asks — where the expand control sits, whether the nav's 65px band is gone,
 * whether a row is 44px — is asked in
 * `THE-346.six-defects.layout.test.tsx`, in real Chromium over CDP. What
 * happens here is BEHAVIOUR: which rows exist, in what order, what a click
 * writes, and whether the nav flag comes back on both exits.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Syntactic diagnostics for a source string, from TypeScript's OWN parser.
 *
 * THIS IS THE INDEPENDENT ORACLE, and independence is the whole point. A
 * line-counting heuristic cannot tell a comment body from code — this repo
 * writes block comments whose continuation lines carry no leading `*`, so any
 * such heuristic either passes vacuously or condemns correct prose. TypeScript
 * parsing the RESULT answers the question that actually matters: a stripper
 * that ate 150 lines of a file leaves something that is not a program.
 */
function syntaxErrors(src: string): string[] {
  return (
    ts.transpileModule(src, {
      reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ESNext },
      fileName: 'probe.tsx',
    }).diagnostics ?? []
  ).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
}

// ── The screen's dependencies, stubbed exactly as THE-275's suite stubs them ──

const hookState = vi.hoisted(() => ({ docs: null as null | unknown[] }));

const DOCS = [
  {
    id: 'd1',
    title: 'Sermon — Advent I',
    content: '<p>Body</p>',
    folderId: null,
    createdBy: 'u1',
    createdAt: null,
    updatedAt: null,
    isPrivate: false,
    sharedWith: [],
    tenantId: 't1',
    pinned: false,
  },
];

const editorProps = vi.hoisted(() => ({ last: null as null | Record<string, unknown> }));
vi.mock('../RichTextEditor', () => ({
  default: (props: Record<string, unknown>) => { editorProps.last = props; return null; },
  COMPACT_PROSE_CLASS: 'prose prose-sm',
}));

const addDocFn = vi.hoisted(() => vi.fn(async () => ({ id: 'created' })));
const updateDocFn = vi.hoisted(() => vi.fn(async () => undefined as unknown));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segs: string[]) => ({ __path: segs.join('/') }),
  query: () => ({}), where: () => ({}),
  addDoc: addDocFn,
  updateDoc: updateDocFn,
  deleteDoc: vi.fn(async () => undefined as unknown),
  doc: (_db: unknown, _c: string, id: string) => ({ id }),
  getDoc: vi.fn(async () => ({ data: () => ({ active: true }) })),
  getDocs: vi.fn(async () => ({ docs: [] })),
  serverTimestamp: () => 'SERVER_TS',
  Timestamp: class {},
  arrayUnion: (v: unknown) => v, arrayRemove: (v: unknown) => v,
}));

const toastFns = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastFns }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1', displayName: 'Ada' } } }));
vi.mock('../../utils/notify', () => ({ notifyError: vi.fn() }));
// `sermonNotes: true` — the livestream row is plan-gated, and this ticket is
// about WHERE its trigger lives, so the plan that has it is the case to drive.
vi.mock('../../utils/plan-features', () => ({ getPlanFeatures: () => ({ sermonNotes: true }) }));
vi.mock('../../utils/tenant-scope', () => ({ hasPlatformOverride: () => false, PLATFORM_TENANT_ID: 'harvest' }));
vi.mock('../../utils/doc-export', () => ({ exportToPDF: vi.fn(), exportToDOCX: vi.fn(), exportToMarkdown: vi.fn() }));
vi.mock('../../utils/markdown-import', () => ({ markdownToHtml: (s: string) => s, titleFromMarkdown: () => 'Imported' }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: async () => {} }) }));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: () => ({ currentTenantId: 't1', isAuthReady: true, tenantPlan: 'pro', isSuperAdmin: false }),
}));
vi.mock('../../hooks/queries/useDocsQueries', () => ({
  useDocs: () => ({ data: { items: hookState.docs ?? DOCS, truncated: false }, isLoading: false }),
  useDocFolders: () => ({ data: { items: [], truncated: false } }),
  useSharedDocs: () => ({ data: { items: [], truncated: false } }),
}));

// ── mounting, with the shared header API spied ───────────────────────────────

let container: HTMLDivElement;
let root: Root;
let mounted = false;

/** Every `setNavHidden` value the screen published, in order. */
let navCalls: boolean[] = [];
let headerCalls: boolean[] = [];

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

async function mountDocs() {
  const api = {
    setHeaderAction: () => {},
    setHeaderOverride: () => {},
    setHeaderHidden: (v: boolean) => { headerCalls.push(v); },
    setNavHidden: (v: boolean) => { navCalls.push(v); },
  };
  await act(async () => {
    root = createRoot(container);
    root.render(
      <AdminHeaderContext.Provider value={api}>
        <AdminDocs />
      </AdminHeaderContext.Provider>,
    );
  });
  mounted = true;
  await flush();
}

async function unmountDocs() {
  if (!mounted) return;
  mounted = false;
  await act(async () => { root.unmount(); });
}

/** The whole document, because Base UI portals the open menu out of `container`. */
const qDoc = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const qaDoc = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const q = (sel: string) => container.querySelector(sel) as HTMLElement | null;

async function openNote() {
  const leaf = container.querySelector('[data-doc-id="d1"]') as HTMLElement | null;
  expect(leaf, 'no tree leaf for the fixture note').toBeTruthy();
  await act(async () => { leaf!.click(); });
  await flush();
}

const expandToggle = () => q('[data-testid="docs-expand-toggle"]');

/** The note menu's own trigger, found the way a user finds it. */
const menuTrigger = () => q('[aria-label="Document options"]');

async function openMenu() {
  const trig = menuTrigger();
  expect(trig, 'the note menu has no three-dot trigger').toBeTruthy();
  await act(async () => {
    trig!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    trig!.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
    trig!.click();
  });
  await flush();
}

/** Every row of the OPEN menu, top level and submenu triggers, in DOM order. */
const menuRows = () =>
  qaDoc('[role="menuitem"]').map((el) => (el.textContent ?? '').trim());

beforeEach(() => {
  vi.clearAllMocks();
  navCalls = [];
  headerCalls = [];
  hookState.docs = null;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await unmountDocs();
  container.remove();
  document.body.innerHTML = '';
});

// ═════════════════════════════════════════════════════════════════════════════
// 1 · the trigger
// ═════════════════════════════════════════════════════════════════════════════

const STRIPPED_FILES = [
  'src/components/AdminDocs.tsx',
  'src/components/AdminEvents.tsx',
  'src/components/ChurchMap.tsx',
  'src/components/AdminCommunity.tsx',
  'src/components/NewsTab.tsx',
  'src/components/AdminDashboard.tsx',
] as const;

describe('the comment stripper this file greps through does not eat code', () => {
  it('leaves every file it is pointed at still parsing as TypeScript', () => {
    // 86bbxkawp: the inherited stripper eats ~150 lines of a file. This one is
    // therefore CHECKED rather than trusted, against TypeScript's own parser.
    for (const rel of STRIPPED_FILES) {
      expect(syntaxErrors(stripComments(read(rel))), `${rel}: the stripper ate real code`)
        .toEqual([]);
    }
  });

  it('and the check is not vacuous — the oracle really reports a broken program', () => {
    // If `syntaxErrors` answered `[]` for everything, the case above would pass
    // on a stripper that returned the empty string.
    expect(syntaxErrors('const a = ;').length).toBeGreaterThan(0);
    expect(syntaxErrors('function f( {').length).toBeGreaterThan(0);
    // And a stripper that ate a closing brace would be caught by it.
    expect(syntaxErrors('function f() { return 1;').length).toBeGreaterThan(0);
  });

  it('really does remove a comment, so it is not a no-op', () => {
    expect(stripComments('const a = 1; // note\nconst b = 2;')).toBe('const a = 1; \nconst b = 2;');
    expect(stripComments('/* gone */const c = 3;')).toBe('const c = 3;');
    // A `//` inside a string is NOT a comment.
    expect(stripComments("const u = 'https://x.example';")).toContain('https://x.example');
    // A block comment's continuation lines need no leading `*` — which is how
    // this repo writes them, and what defeats every line-shape heuristic.
    expect(stripComments('/*\n  prose\n  more prose\n*/\nconst d = 4;').trim()).toBe('const d = 4;');
  });

  it('AND IT READS JSX, which is what defeated the hand-rolled version', () => {
    // An apostrophe in JSX TEXT is not the start of a string. A hand-rolled
    // scanner treats it as one, desynchronises, and from there leaves comments
    // in place while swallowing real code — silently.
    const jsx = [
      "const A = () => (",
      "  <p>the founder's screenshot</p>",
      ");",
      "// a real comment",
      "const B = 1;",
    ].join('\n');
    const stripped = stripComments(jsx);
    expect(stripped, 'JSX text was eaten').toContain("the founder's screenshot");
    expect(stripped, 'a comment after JSX text survived').not.toContain('a real comment');
    expect(stripped, 'code after the comment was eaten').toContain('const B = 1;');
  });

  it('and it keeps line numbers stable, so a failure still points somewhere', () => {
    for (const rel of STRIPPED_FILES) {
      expect(stripComments(read(rel)).split('\n').length, `${rel}: line count moved`)
        .toBe(read(rel).split('\n').length);
    }
  });

  it('is idempotent, so a second pass cannot remove anything more', () => {
    for (const rel of STRIPPED_FILES) {
      const once = stripComments(read(rel));
      expect(stripComments(once), `${rel}: stripping twice removed more`).toBe(once);
    }
  });

  it('keeps every import and export statement, verbatim', () => {
    // The lines a stripper that lost its place would take first.
    for (const rel of STRIPPED_FILES) {
      const kept = new Set(stripComments(read(rel)).split('\n').map((l) => l.trim()));
      const wanted = read(rel)
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /^(?:import|export) /.test(l));
      expect(wanted.length, `${rel} has no import lines to check`).toBeGreaterThan(0);
      expect(wanted.filter((l) => !kept.has(l)), `${rel}: an import or export was eaten`)
        .toEqual([]);
    }
  });
});

describe('the Notes trigger is a three-dot menu, not a labelled Export button', () => {
  it('renders a ⋯ trigger and NO button labelled Export', async () => {
    await mountDocs();
    await openNote();

    expect(menuTrigger(), 'the three-dot trigger is missing').toBeTruthy();

    // The founder: "The 'export' button should be just the 3 dots."
    const labelled = [...container.querySelectorAll('button')].filter(
      (b) => (b.textContent ?? '').trim() === 'Export',
    );
    expect(labelled, 'a labelled Export button is still on the editor header').toEqual([]);
  });

  it('the `triggerLabel` prop that produced it is gone from the CODE', async () => {
    // The prop is what MADE the labelled button, so its absence is the thing
    // that cannot be re-introduced by accident.
    //
    // OVER COMMENT-STRIPPED SOURCE, and this case is the reason: this file's
    // own comments discuss `triggerLabel` by name, and a grep over raw source
    // would read that prose as the code and fail on a correct file. Thirteen
    // guards in this repo have passed a planted defect by reading something
    // that was not the code; this one fails on one for the mirror-image
    // reason, which is the same bug wearing the other hat.
    expect(stripComments(read('src/components/AdminDocs.tsx')), 'triggerLabel came back')
      .not.toMatch(/triggerLabel/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · Export is a submenu
// ═════════════════════════════════════════════════════════════════════════════

describe('Export is a SUBMENU containing PDF, DOCX and Markdown', () => {
  it('the three formats are NOT top-level rows, and Export is a submenu trigger', async () => {
    await mountDocs();
    await openNote();
    await openMenu();

    const rows = menuRows();
    expect(rows, 'the menu did not open').not.toEqual([]);
    expect(rows).toContain('Export');

    // Flattening the submenu is the mutation this catches: the three formats
    // would then be top-level rows beside Export.
    for (const format of ['PDF', 'DOCX', 'Markdown']) {
      expect(
        rows,
        `${format} is a TOP-LEVEL row — the Export submenu has been flattened`,
      ).not.toContain(format);
    }

    // And Export really is a submenu trigger, not a plain row: Base UI marks it
    // with `aria-haspopup="menu"` and a `data-popup-open`-able trigger.
    const exportRow = qaDoc('[role="menuitem"]').find(
      (el) => (el.textContent ?? '').trim() === 'Export',
    );
    expect(exportRow, 'no Export row').toBeTruthy();
    expect(
      exportRow!.getAttribute('aria-haspopup'),
      'Export is a plain item, not a submenu trigger',
    ).toBe('menu');
  });

  it('opening it reveals exactly PDF, DOCX and Markdown', async () => {
    await mountDocs();
    await openNote();
    await openMenu();

    const exportRow = qaDoc('[role="menuitem"]').find(
      (el) => (el.textContent ?? '').trim() === 'Export',
    )!;
    await act(async () => {
      exportRow.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      exportRow.click();
    });
    await flush();

    const rows = menuRows();
    for (const format of ['PDF', 'DOCX', 'Markdown']) {
      expect(rows, `${format} is missing from the open Export submenu`).toContain(format);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · the eight items, enumerated and in order
// ═════════════════════════════════════════════════════════════════════════════

describe('the menu contains all eight items in order', () => {
  it('enumerates them exactly, top level only', async () => {
    await mountDocs();
    await openNote();
    await openMenu();

    // The founder's table, in his order. Enumerated rather than spot-checked:
    // a row that moved, vanished or arrived fails by name.
    expect(menuRows()).toEqual([
      'Export',
      'Share with Admins',
      'Share on web',
      'Share to Livestream',
      'Share to blog draft',
      'Pin to Top',
      'Rename',
      'Delete',
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5 · Share to Livestream moved OUT of the header bar
// ═════════════════════════════════════════════════════════════════════════════

describe('Share to Livestream is in the menu and NOT in the header bar', () => {
  it('the broadcast button is gone from the editor toolbar', async () => {
    await mountDocs();
    await openNote();

    // The founder: "we have to move the button from the headerbar into the more
    // drawer". While the menu is CLOSED there must be no livestream control
    // anywhere on the screen — if there were, the row in the menu would be a
    // duplicate rather than a move.
    const onScreen = [...container.querySelectorAll('button')].map((b) =>
      (b.textContent ?? '').trim().toLowerCase(),
    );
    expect(
      onScreen.filter((t) => t.includes('livestream')),
      'the broadcast button is still in the header bar',
    ).toEqual([]);
  });

  it('and it IS a row of the menu, for a plan that has the feature', async () => {
    await mountDocs();
    await openNote();
    await openMenu();
    expect(menuRows()).toContain('Share to Livestream');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6 · Share to blog draft creates a DRAFT
// ═════════════════════════════════════════════════════════════════════════════

describe('Share to blog draft creates a draft', () => {
  it('writes one blog_posts document with status draft, and publishes nothing', async () => {
    await mountDocs();
    await openNote();
    await openMenu();

    const row = qaDoc('[role="menuitem"]').find(
      (el) => (el.textContent ?? '').trim() === 'Share to blog draft',
    );
    expect(row, 'the blog draft row is missing').toBeTruthy();
    await act(async () => {
      row!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      row!.click();
    });
    await flush();

    expect(addDocFn, 'no document was written').toHaveBeenCalledTimes(1);
    const [ref, data] = addDocFn.mock.calls[0] as unknown as [
      { __path: string },
      Record<string, unknown>,
    ];
    expect(ref.__path, 'the draft did not go to blog_posts').toBe('blog_posts');
    // A sermon note is written for a room, not for a church's public blog. A
    // single menu tap must not put it on the open web.
    expect(data.status, 'the draft was PUBLISHED').toBe('draft');
    expect(data.tenantId).toBe('t1');
    expect(data.title).toBe('Sermon — Advent I');
    expect(toastFns.success).toHaveBeenCalledWith('Blog draft created');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9 · THE TRAP — the nav returns on BOTH exits
// ═════════════════════════════════════════════════════════════════════════════

describe('the nav returns on BOTH exits', () => {
  it('expanding hides it, and pressing expand again gives it back', async () => {
    await mountDocs();
    await openNote();
    navCalls = [];

    await act(async () => { expandToggle()!.click(); });
    await flush();
    expect(navCalls.at(-1), 'expanding did not hide the bottom nav').toBe(true);

    await act(async () => { expandToggle()!.click(); });
    await flush();
    expect(navCalls.at(-1), 'pressing expand again did not bring the nav back').toBe(false);
  });

  it('LEAVING THE NOTE gives it back too, without pressing expand', async () => {
    // The trap: a nav still hidden on a screen that no longer has an expand
    // button to press. `editorFullscreen` is `focusMode && !!openDoc`, so
    // closing the note falsifies it without anybody remembering to.
    await mountDocs();
    await openNote();
    await act(async () => { expandToggle()!.click(); });
    await flush();
    expect(navCalls.at(-1)).toBe(true);

    const back = [...container.querySelectorAll('button')].find(
      (b) => (b.textContent ?? '').trim() === 'Notes',
    );
    expect(back, 'the back-to-Notes button is missing').toBeTruthy();
    await act(async () => { back!.click(); });
    await flush();

    expect(navCalls.at(-1), 'the nav stayed hidden after leaving the note').toBe(false);
  });

  it('and UNMOUNTING gives it back — the route change nothing else covers', async () => {
    await mountDocs();
    await openNote();
    await act(async () => { expandToggle()!.click(); });
    await flush();
    expect(navCalls.at(-1)).toBe(true);

    await unmountDocs();
    expect(
      navCalls.at(-1),
      'navigating away left the nav hidden — the effect cleanup is missing',
    ).toBe(false);
  });

  it('merely OPENING a note does not hide the nav', async () => {
    // The overcorrection this catches: hiding the nav on `openDoc` alone. A
    // phone would then lose every other screen the moment a note was opened,
    // with nothing on screen suggesting the expand button was the way back.
    // The nav comes off for FULLSCREEN, which is a thing the reader asked for.
    await mountDocs();
    navCalls = [];
    headerCalls = [];
    await openNote();
    expect(navCalls.every((v) => v === false), 'opening a note hid the nav').toBe(true);
    // The header flag tracks the same fullscreen state and so is also false
    // here — recorded rather than assumed, because an earlier draft of this
    // ticket claimed the header was hidden on open and it is not.
    expect(headerCalls.every((v) => v === false), 'opening a note hid the header').toBe(true);
  });
});
