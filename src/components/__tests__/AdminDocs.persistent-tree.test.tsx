import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import postcss from 'postcss';
import AdminDocs from '../AdminDocs';
import { rulesDigestFailure } from '../../__tests__/__fixtures__/firestore-rules-pin';

/**
 * THE-275 — the notes screen is two panes, not a drill-down.
 *
 * ── The defect, as it actually was ───────────────────────────────────────────
 * "When I enter the notes, first is a directory of the folders and when I click
 * on the note I see the note tree. I don't need that at all."
 *
 * AdminDocs had TWO top-level returns, gated on `focusMode && openDoc`:
 *
 *   1. a landing view — a flat row of ROOT folder chips over a grid of doc
 *      cards. `activeFolderId` filtered the grid in place; it did not push a
 *      screen. A nested folder could not be reached from here at all, because
 *      the chip row rendered `folders.filter(f => !f.parentId)` and stopped.
 *   2. an editor view — the ONLY place the folder tree existed, in a left rail
 *      that was `hidden lg:flex`, so on a phone the tree needed a slide-in
 *      drawer on top of already having opened a note.
 *
 * And `openDocument()` ended with `setFocusMode(true)`, so every route into a
 * note — a click, a deep link, a fresh create, an import — switched the screen.
 * That one line was the drill-down.
 *
 * There is one return now. The tree is mounted unconditionally and the MAIN
 * pane is the only thing that swaps.
 *
 * ── What this file will NOT let regress ──────────────────────────────────────
 * The two visibility rules, which are the ones with a leak behind them
 * (tests 7), the Partial list notice (test 8, THE-262), and the persisted
 * shapes and out-of-scope files (tests 11 and 12).
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REPO = path.resolve(__dirname, '../../..');
const SRC = path.resolve(__dirname, '../..');
const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

// ═════════════════════════════════════════════════════════════════════════════
// Fixtures
//
// A four-deep folder chain, because "arbitrary nesting" is not two. `updatedAt`
// is distinct on every note so Recents has one correct answer rather than a
// tie broken by sort stability.
// ═════════════════════════════════════════════════════════════════════════════
const FOLDERS = vi.hoisted(() => [
  { id: 'f-ministry', name: 'Ministry', parentId: null, createdBy: 'u1', createdAt: null, order: 0 },
  { id: 'f-sermons', name: 'Sermons', parentId: 'f-ministry', createdBy: 'u1', createdAt: null, order: 1 },
  { id: 'f-2026', name: '2026', parentId: 'f-sermons', createdBy: 'u1', createdAt: null, order: 2 },
  { id: 'f-q1', name: 'Q1', parentId: 'f-2026', createdBy: 'u1', createdAt: null, order: 3 },
  { id: 'f-finance', name: 'Finance', parentId: null, createdBy: 'u1', createdAt: null, order: 4 },
  { id: 'f-empty', name: 'Archive', parentId: null, createdBy: 'u1', createdAt: null, order: 5 },
]);

/**
 * Deliberately NOT in `updatedAt` order. `useDocs` happens to sort its result,
 * but Recents is the one place where the order IS the feature, so it must not
 * ride on that.
 */
const DOCS = vi.hoisted(() => {
  const t = (iso: string) => ({ toMillis: () => Date.parse(iso), toDate: () => new Date(iso) });
  const base = {
    content: '<p>x</p>', createdBy: 'u1', createdAt: null,
    isPrivate: true, sharedWith: [] as string[], pinned: false, folderId: null,
  };
  return [
    { ...base, id: 'd-oldest', title: 'Vision Statement', updatedAt: t('2026-01-02T00:00:00Z'), folderId: 'f-ministry' },
    { ...base, id: 'd-newest', title: 'Easter Sunday Draft', updatedAt: t('2026-05-01T00:00:00Z'), folderId: 'f-q1' },
    { ...base, id: 'd-mid', title: 'Budget 2026', updatedAt: t('2026-03-10T00:00:00Z'), folderId: 'f-finance' },
    { ...base, id: 'd-second', title: 'Elders Meeting', updatedAt: t('2026-04-20T00:00:00Z'), folderId: null },
    { ...base, id: 'd-fifth', title: 'Parking Rota', updatedAt: t('2026-02-01T00:00:00Z'), folderId: null, pinned: true },
  ];
});

/**
 * A note SHARED with this viewer, carrying a folderId that names one of THIS
 * tenant's folders.
 *
 * That collision is the point. `useSharedDocs` is scoped by the viewer
 * (`sharedWith array-contains uid`) with no tenant constraint, so its notes
 * belong to somebody else's folder tree; if the two sets were merged by
 * `folderId`, this note would be filed inside Finance — a folder it has nothing
 * to do with — and would read as one of this church's own.
 */
const SHARED = vi.hoisted(() => [{
  id: 'd-shared', title: 'Regional Prayer List', content: '<p>y</p>',
  folderId: 'f-finance', createdBy: 'someone-else', createdAt: null,
  updatedAt: { toMillis: () => Date.parse('2026-06-01T00:00:00Z'), toDate: () => new Date('2026-06-01T00:00:00Z') },
  isPrivate: true, sharedWith: ['u1'], pinned: false,
}]);

/** Per-test overrides for what the three hooks return. */
const hookState = vi.hoisted(() => ({
  docs: null as null | unknown[],
  folders: null as null | unknown[],
  shared: null as null | unknown[],
  truncated: false,
  loading: false,
}));

const editorProps = vi.hoisted(() => ({ last: null as null | Record<string, unknown> }));
vi.mock('../RichTextEditor', () => ({
  default: (props: Record<string, unknown>) => { editorProps.last = props; return null; },
  COMPACT_PROSE_CLASS: 'prose prose-sm',
}));

const updateDoc = vi.hoisted(() => vi.fn(async () => undefined as unknown));
const deleteDocFn = vi.hoisted(() => vi.fn(async () => undefined as unknown));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}), query: () => ({}), where: () => ({}),
  addDoc: vi.fn(async () => ({ id: 'created' })),
  updateDoc,
  deleteDoc: deleteDocFn,
  doc: (_db: unknown, _c: string, id: string) => ({ id }),
  getDoc: vi.fn(async () => ({ data: () => ({ active: false }) })),
  getDocs: vi.fn(async () => ({ docs: [] })),
  serverTimestamp: () => 'SERVER_TS',
  Timestamp: class {},
  arrayUnion: (v: unknown) => v, arrayRemove: (v: unknown) => v,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('../../utils/notify', () => ({ notifyError: vi.fn() }));
vi.mock('../../utils/plan-features', () => ({ getPlanFeatures: () => ({ sermonNotes: false }) }));
vi.mock('../../utils/tenant-scope', () => ({ hasPlatformOverride: () => false, PLATFORM_TENANT_ID: 'harvest' }));
vi.mock('../../utils/doc-export', () => ({ exportToPDF: vi.fn(), exportToDOCX: vi.fn(), exportToMarkdown: vi.fn() }));
vi.mock('../../utils/markdown-import', () => ({ markdownToHtml: (s: string) => s, titleFromMarkdown: () => 'Imported' }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: async () => {} }) }));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: () => ({ currentTenantId: 't1', isAuthReady: true, tenantPlan: 'seed', isSuperAdmin: false }),
}));
vi.mock('../../hooks/queries/useDocsQueries', () => ({
  useDocs: () => ({
    data: { items: hookState.docs ?? DOCS, truncated: hookState.truncated },
    isLoading: hookState.loading,
  }),
  useDocFolders: () => ({ data: { items: hookState.folders ?? FOLDERS, truncated: false } }),
  useSharedDocs: () => ({ data: { items: hookState.shared ?? SHARED, truncated: false } }),
}));

// ── mounting ────────────────────────────────────────────────────────────────
let container: HTMLDivElement;
let root: Root;
let mounted = false;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

async function mountDocs() {
  await act(async () => { root = createRoot(container); root.render(<AdminDocs />); });
  mounted = true;
  await flush();
}
async function unmountDocs() {
  if (!mounted) return;
  mounted = false;
  await act(async () => { root.unmount(); });
}

const q = (sel: string) => container.querySelector(sel) as HTMLElement | null;
const qa = (sel: string) => [...container.querySelectorAll(sel)] as HTMLElement[];
/** The tree's own root element. Identity on this node is how "did not remount" is asked. */
const treeRoot = () => q('[data-testid="docs-tree"]');
/** Every note the tree renders, by id, in DOM order. */
const treeDocIds = () => qa('[data-doc-id]').map(el => el.getAttribute('data-doc-id')!);
const folderNames = () => qa('[data-folder-toggle]').map(el => el.textContent?.trim() ?? '');
const editorOpen = () => q('input[placeholder="Untitled"]') !== null;

async function clickLeaf(docId: string) {
  const leaf = qa(`[data-doc-id="${docId}"]`)[0];
  expect(leaf, `no tree leaf for ${docId}`).toBeTruthy();
  await act(async () => { leaf.click(); });
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  hookState.docs = null; hookState.folders = null; hookState.shared = null;
  hookState.truncated = false; hookState.loading = false;
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(async () => {
  await unmountDocs();
  container.remove();
  document.body.innerHTML = '';
});

// ═════════════════════════════════════════════════════════════════════════════
// 1 · 🔴 the whole ticket
// ═════════════════════════════════════════════════════════════════════════════
describe('the folder tree is present without opening a note', () => {
  it('renders folders and their notes on first paint, with nothing opened', async () => {
    await mountDocs();

    expect(editorOpen(), 'a note was opened — this test is about the landing state').toBe(false);
    expect(treeRoot(), 'the tree is not on screen until a note is opened').not.toBeNull();

    // Not just "a tree element exists": the folders and the notes inside them.
    expect(folderNames()).toEqual(expect.arrayContaining(['Ministry', 'Sermons', '2026', 'Q1', 'Finance']));
    expect(treeDocIds()).toEqual(expect.arrayContaining(['d-oldest', 'd-newest', 'd-mid']));
  });

  it('shows no folder-directory screen in front of it', async () => {
    await mountDocs();
    // The landing view's own furniture: the "All docs" escape from a filtered
    // folder, and the doc-card grid. Both are gone, and their absence is what
    // "no drill-down" means concretely.
    expect(container.textContent).not.toContain('All docs');
    expect(readFileSync(path.join(SRC, 'components/AdminDocs.tsx'), 'utf8'))
      .not.toMatch(/activeFolderId/);
  });

  it('opening a note does not switch the screen into focus mode by itself', async () => {
    await mountDocs();
    await clickLeaf('d-mid');
    expect(editorOpen()).toBe(true);
    // The one line that was the drill-down: openDocument ended with
    // setFocusMode(true). focusMode survives as a TOGGLE (its button is here),
    // but nothing enters it for you.
    const focus = qa('button').find(b => b.getAttribute('aria-label') === 'Focus mode');
    expect(focus, 'the focus-mode toggle is gone').toBeTruthy();
    expect(focus!.getAttribute('aria-pressed')).toBe('false');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · only the main pane swaps
// ═════════════════════════════════════════════════════════════════════════════
describe('clicking a note changes only the main pane', () => {
  it('keeps the very same tree element across two different notes', async () => {
    await mountDocs();
    const before = treeRoot();
    expect(before).not.toBeNull();

    await clickLeaf('d-mid');
    const afterFirst = treeRoot();
    await clickLeaf('d-newest');
    const afterSecond = treeRoot();

    // Identity, not equality: React reuses the DOM node only while the element
    // stays in the same position in the tree. A remount — which is what the old
    // two-return screen did on every open — hands back a different node.
    expect(afterFirst, 'the tree remounted when a note was opened').toBe(before);
    expect(afterSecond, 'the tree remounted when the note changed').toBe(before);
    expect(editorOpen()).toBe(true);
  });

  it('keeps a folder the user collapsed collapsed', async () => {
    await mountDocs();
    const toggle = qa('[data-folder-toggle="f-ministry"]')[0];
    await act(async () => { toggle.click(); });
    await flush();
    expect(q('[data-folder-children="f-ministry"]'), 'the folder did not collapse').toBeNull();

    await clickLeaf('d-second');

    expect(q('[data-folder-children="f-ministry"]'), 'opening a note re-expanded the tree').toBeNull();
    expect(qa('[data-folder-toggle="f-ministry"]')[0].getAttribute('aria-expanded')).toBe('false');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2b · focusMode survives, with a real job
// ═════════════════════════════════════════════════════════════════════════════
describe('focus mode is kept, as a toggle rather than as something that happens to you', () => {
  const rail = () => q('[data-testid="docs-sidebar"]')!;
  const focusButton = () =>
    qa('button').find(b => (b.getAttribute('aria-label') ?? '').includes('ocus mode'))!;

  it('hides the tree on a wide screen and gives it back', async () => {
    await mountDocs();
    await clickLeaf('d-mid');
    expect(rail().className, 'the rail is not laid out at lg to begin with').toContain('lg:flex');

    await act(async () => { focusButton().click(); });
    await flush();
    // `cn()` merges the two `lg:` display utilities and the later one wins, so
    // this is the rail actually going away rather than two classes fighting.
    expect(rail().className).toContain('lg:hidden');
    expect(rail().className).not.toContain('lg:flex');
    expect(focusButton().getAttribute('aria-pressed')).toBe('true');

    await act(async () => { focusButton().click(); });
    await flush();
    expect(rail().className).toContain('lg:flex');
    expect(rail().className).not.toContain('lg:hidden');
  });

  it('does not remount the tree on the way in or out', async () => {
    await mountDocs();
    await clickLeaf('d-mid');
    const before = treeRoot();
    await act(async () => { focusButton().click(); });
    await flush();
    await act(async () => { focusButton().click(); });
    await flush();
    expect(treeRoot(), 'focus mode remounted the tree').toBe(before);
  });

  it('still hides the app header while it is on, and only while it is on', async () => {
    // The header effect is `focusMode && !!openDoc` — unchanged from before
    // THE-275. What changed is that nothing sets focusMode for you.
    const src = readFileSync(path.join(SRC, 'components/AdminDocs.tsx'), 'utf8');
    expect(src).toMatch(/const editorFullscreen = focusMode && !!openDoc;/);
    expect(src).toMatch(/setHeaderHidden\(editorFullscreen\);/);
    // openDocument must not switch it on: that was the drill-down.
    const openDocument = src.slice(src.indexOf('const openDocument'), src.indexOf('const revealFolderIds'));
    expect(openDocument, 'opening a note enters focus mode again').not.toMatch(/setFocusMode\(true\)/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · nesting
// ═════════════════════════════════════════════════════════════════════════════
describe('arbitrary folder nesting renders', () => {
  it('follows a parentId chain four deep and files the leaf at the bottom of it', async () => {
    await mountDocs();

    // Depth is structural — each level is a <ul> inside the level above — so the
    // chain is asserted by containment rather than by a padding number.
    const ministry = q('[data-folder-id="f-ministry"]')!;
    const sermons = ministry.querySelector('[data-folder-id="f-sermons"]')!;
    const y2026 = sermons.querySelector('[data-folder-id="f-2026"]')!;
    const q1 = y2026.querySelector('[data-folder-id="f-q1"]')!;
    expect(q1, 'the fourth level did not render').toBeTruthy();

    expect(q1.querySelector('[data-doc-id="d-newest"]'), 'the note four levels down is missing')
      .toBeTruthy();
    expect(q1.getAttribute('data-depth')).toBe('3');
  });

  it('says so when a folder is empty rather than rendering a blank', async () => {
    await mountDocs();
    expect(q('[data-empty-folder="f-empty"]')).not.toBeNull();
    expect(q('[data-empty-folder="f-ministry"]'), 'a folder with contents claimed to be empty')
      .toBeNull();
  });
});

describe('a read in flight is not an empty church', () => {
  it('shows skeleton rows, not "No notes yet", while the first read is running', async () => {
    hookState.loading = true;
    hookState.docs = [];
    hookState.folders = [];
    await mountDocs();
    expect(q('[data-testid="docs-loading"]'), 'nothing marks the tree as loading').not.toBeNull();
    expect(q('[data-testid="docs-empty"]'), 'told the user they have no notes mid-read').toBeNull();
    // The old screen replaced the WHOLE list view with a spinner. The tree
    // keeps its shape, so the rows land in it instead of the layout jumping.
    expect(q('[data-testid="docs-tree"]')).not.toBeNull();
  });

  it('says the church is empty once the read has finished and it is', async () => {
    hookState.docs = [];
    hookState.folders = [];
    await mountDocs();
    expect(q('[data-testid="docs-loading"]')).toBeNull();
    expect(q('[data-testid="docs-empty"]')).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 · Recents
// ═════════════════════════════════════════════════════════════════════════════
describe('Recents shows exactly 3, newest by updatedAt', () => {
  it('lists three, in updatedAt order, from an unsorted input', async () => {
    await mountDocs();
    const recents = q('[data-testid="docs-recents"]')!;
    const ids = [...recents.querySelectorAll('[data-doc-id]')].map(e => e.getAttribute('data-doc-id'));

    expect(ids, 'Recents is not exactly three notes, newest first')
      .toEqual(['d-newest', 'd-second', 'd-mid']);
  });

  it('is still three when there are more notes than that', async () => {
    await mountDocs();
    expect(DOCS.length).toBeGreaterThan(3);
    expect(q('[data-testid="docs-recents"]')!.querySelectorAll('[data-doc-id]')).toHaveLength(3);
  });

  it('shows every note it has when there are fewer than three', async () => {
    hookState.docs = DOCS.slice(0, 2);
    await mountDocs();
    expect(q('[data-testid="docs-recents"]')!.querySelectorAll('[data-doc-id]')).toHaveLength(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5 · ⌘K
// ═════════════════════════════════════════════════════════════════════════════
describe('⌘K opens the quick switcher and finds a note by title', () => {
  const switcherItems = () =>
    [...document.querySelectorAll('[data-switcher-doc-id],[data-switcher-shared-id]')]
      .map(e => e.textContent ?? '');

  async function pressCmdK() {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
    });
    await flush();
  }

  it('opens on ⌘K and lists the notes', async () => {
    await mountDocs();
    expect(document.querySelector('[data-testid="docs-switcher-input"]')).toBeNull();
    await pressCmdK();
    expect(document.querySelector('[data-testid="docs-switcher-input"]'), '⌘K opened nothing')
      .not.toBeNull();
    expect(switcherItems().length).toBeGreaterThanOrEqual(DOCS.length);
  });

  it('narrows to one note when its title is typed', async () => {
    await mountDocs();
    await pressCmdK();
    const input = document.querySelector('[data-testid="docs-switcher-input"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, 'easter');
    await act(async () => { input.dispatchEvent(new Event('input', { bubbles: true })); });
    await flush();

    // One result, and it carries the full chain — so the row says WHERE the
    // note is, not just that a note by that name exists somewhere.
    expect(switcherItems().map(t => t.replace(/\s+/g, ' ').trim()))
      .toEqual(['Easter Sunday DraftMinistry / Sermons / 2026 / Q1']);
  });

  it('is reachable with Ctrl-K too, for the admins who are not on a Mac', async () => {
    await mountDocs();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', ctrlKey: true, bubbles: true }));
    });
    await flush();
    expect(document.querySelector('[data-testid="docs-switcher-input"]')).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6 · right-click
// ═════════════════════════════════════════════════════════════════════════════
describe('right-click offers rename, delete and move', () => {
  async function rightClick(sel: string) {
    const el = qa(sel)[0];
    expect(el, `nothing to right-click at ${sel}`).toBeTruthy();
    await act(async () => {
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });
    await flush();
  }
  const menuItems = () =>
    [...document.querySelectorAll('[role="menuitem"]')].map(e => e.textContent?.trim() ?? '');
  const clickMenuItem = async (label: string) => {
    const item = [...document.querySelectorAll('[role="menuitem"]')]
      .find(e => e.textContent?.trim() === label) as HTMLElement;
    expect(item, `no "${label}" in the context menu`).toBeTruthy();
    await act(async () => { item.click(); });
    await flush();
  };

  it('offers all three on a note', async () => {
    await mountDocs();
    await rightClick('[data-doc-id="d-mid"]');
    expect(menuItems()).toEqual(['Rename', 'Move to folder', 'Pin to top', 'Delete']);
  });

  it('Rename opens the rename modal the screen already had', async () => {
    await mountDocs();
    await rightClick('[data-doc-id="d-mid"]');
    await clickMenuItem('Rename');
    // The existing RenameModal, reached by its heading rather than by a class.
    expect(container.textContent).toContain('Rename Document');
    const input = q('input[placeholder="Name"]') as HTMLInputElement;
    expect(input.value, 'the modal did not open on the note that was right-clicked')
      .toBe('Budget 2026');
  });

  it('Delete opens the existing delete confirmation, and confirming calls deleteDoc', async () => {
    await mountDocs();
    await rightClick('[data-doc-id="d-mid"]');
    await clickMenuItem('Delete');
    expect(container.textContent).toContain('Delete this document?');

    const confirm = qa('button').find(b => b.textContent?.trim() === 'Delete')!;
    await act(async () => { confirm.click(); });
    await flush();
    expect(deleteDocFn).toHaveBeenCalledWith(expect.objectContaining({ id: 'd-mid' }));
  });

  it('Move to folder opens the existing move modal, and choosing a folder writes folderId', async () => {
    await mountDocs();
    await rightClick('[data-doc-id="d-mid"]');
    await clickMenuItem('Move to folder');
    expect(container.textContent).toContain('Move to Folder');

    // Scoped to the modal: "Ministry" is also a folder row in the tree behind
    // it, and that one only toggles the folder open.
    const modal = qa('div').filter(d => d.textContent?.includes('Move to Folder')).slice(-1)[0];
    const target = [...modal.querySelectorAll('button')]
      .find(b => b.textContent?.trim() === 'Ministry')!;
    expect(target, 'the move modal lists no Ministry folder').toBeTruthy();
    await act(async () => { target.click(); });
    await flush();
    expect(updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'd-mid' }),
      expect.objectContaining({ folderId: 'f-ministry' }),
    );
  });

  it('offers rename and delete on a folder, and Delete reaches deleteDoc on docFolders', async () => {
    await mountDocs();
    await rightClick('[data-folder-toggle="f-finance"]');
    expect(menuItems()).toEqual(['Rename', 'New note here', 'Delete']);
    await clickMenuItem('Delete');
    expect(container.textContent).toContain('Delete this folder?');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7 · 🔴 private and shared — no regression
// ═════════════════════════════════════════════════════════════════════════════
describe('private notes are visible only to their owner in the tree', () => {
  /**
   * ⚠️ WHAT `isPrivate` ACTUALLY DOES TODAY, established before this ticket:
   * NOTHING reads it. It is written `true` on every create and is consulted by
   * no query, no security rule and no render path. The `docs` rule admits any
   * tenant admin (`isTenantAdmin(resource.data.tenantId) || createdBy == uid ||
   * uid in sharedWith`), and `useDocs` filters on `tenantId` alone.
   *
   * So the boundary that exists — and the only one that can leak — is between
   * the two READS: `useDocs`, tenant-scoped, and `useSharedDocs`, viewer-scoped
   * with no tenant constraint at all. THE-275's non-negotiable is that this
   * behaviour is preserved EXACTLY, so these assert the boundary rather than
   * inventing an owner-only rule the screen has never had.
   */
  it('renders exactly the notes the tenant-scoped read returned — no more', async () => {
    await mountDocs();
    const tree = treeRoot()!;
    const inTree = new Set(
      [...tree.querySelectorAll('[data-doc-id]')].map(e => e.getAttribute('data-doc-id')!),
    );
    expect([...inTree].sort()).toEqual(DOCS.map(d => d.id).sort());
    expect(inTree.has('d-shared'), 'a viewer-scoped note was filed into the tenant tree').toBe(false);
  });

  it('keeps a shared note out of the folder it names, even when that folder exists here', async () => {
    await mountDocs();
    // The fixture's shared note carries folderId 'f-finance', which IS one of
    // this tenant's folders. Merging the two sets by folderId would file
    // somebody else's note inside Finance and present it as this church's.
    const finance = q('[data-folder-children="f-finance"]')!;
    expect(finance.querySelector('[data-doc-id="d-shared"]')).toBeNull();
    expect(finance.querySelector('[data-shared-doc-id="d-shared"]')).toBeNull();

    const shared = q('[data-testid="docs-shared"]')!;
    expect(shared.querySelector('[data-shared-doc-id="d-shared"]'), 'the shared note vanished')
      .not.toBeNull();
  });

  it('renders no Shared group at all when nothing is shared with the viewer', async () => {
    hookState.shared = [];
    await mountDocs();
    expect(q('[data-testid="docs-shared"]')).toBeNull();
    expect(container.textContent).not.toContain('Regional Prayer List');
  });

  it('the two reads are still the two reads — neither hook is filtered or merged', () => {
    const src = readFileSync(path.join(SRC, 'components/AdminDocs.tsx'), 'utf8');
    // The unwrap is still one hook to one array; a `[...docs, ...sharedDocs]`
    // anywhere is the merge this guards against.
    expect(src).toMatch(/const docs = docsRead\?\.items \?\? NO_DOCS;/);
    expect(src).toMatch(/const sharedDocs = sharedDocsRead\?\.items \?\? NO_DOCS;/);
    for (const f of ['components/AdminDocs.tsx', 'components/docs/DocsTree.tsx']) {
      expect(readFileSync(path.join(SRC, f), 'utf8'), `${f} merges the two sets`)
        .not.toMatch(/\.\.\.\s*docs\s*,\s*\.\.\.\s*sharedDocs|\.\.\.\s*sharedDocs\s*,\s*\.\.\.\s*docs/);
    }
  });

  it('still writes isPrivate on create, and writes it nowhere else', () => {
    const src = readFileSync(path.join(SRC, 'components/AdminDocs.tsx'), 'utf8');
    // Two creates (a new note, an imported note), both private, exactly as before.
    expect([...src.matchAll(/isPrivate: true,/g)]).toHaveLength(4);
    expect(src, 'isPrivate became a filter — that is a behaviour change, not this ticket')
      .not.toMatch(/isPrivate\s*(===|!==|\?|&&)/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8 · the Partial list notice — no regression (THE-262)
// ═════════════════════════════════════════════════════════════════════════════
describe('the Partial list notice still renders when truncated', () => {
  it('is absent on a complete read', async () => {
    await mountDocs();
    expect(q('[data-testid="docs-partial-list"]')).toBeNull();
    expect(container.textContent).not.toContain('Partial list');
  });

  it('appears, and says what it means, when the ceiling fired', async () => {
    hookState.truncated = true;
    await mountDocs();
    const notice = q('[data-testid="docs-partial-list"]');
    expect(notice, 'a truncated read is silent again — the defect THE-262 removed').not.toBeNull();
    expect(notice!.textContent).toContain('Partial list');
    expect(notice!.textContent).toContain('more notes than this view loads at once');
  });

  it('is inside the tree, where the notes it is about are', async () => {
    hookState.truncated = true;
    await mountDocs();
    // Not in the editor pane, which is empty until a note is opened and would
    // hide the notice on a phone.
    expect(q('[data-testid="docs-sidebar"]')!.querySelector('[data-testid="docs-partial-list"]'))
      .not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9 · colour
// ═════════════════════════════════════════════════════════════════════════════
describe('no colour is hardcoded and all four palettes resolve', () => {
  const NEW_FILES = [
    'components/docs/DocsTree.tsx',
    'components/docs/DocsQuickSwitcher.tsx',
    'components/docs/DocsBreadcrumb.tsx',
    'components/docs/docs-tree-model.ts',
  ];
  /** `var(--token, #fallback)` is not a hardcoded colour: the token still wins. */
  const literals = (src: string) =>
    (src.replace(/var\(\s*--[a-z0-9-]+\s*,\s*#[0-9A-Fa-f]{3,8}\s*\)/gi, 'var(--x)')
      .match(/#[0-9A-Fa-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g) ?? []).sort();

  it.each(NEW_FILES)('%s spells no raw colour', (f) => {
    expect(literals(readFileSync(path.join(SRC, f), 'utf8'))).toEqual([]);
  });

  it('AdminDocs added none either — it lost two with the drawer', () => {
    // The mobile slide-in drawer's scrim and side shadow were the file's only
    // two rgba()s. The two-pane layout has no drawer, so they are simply gone.
    expect(literals(readFileSync(path.join(SRC, 'components/AdminDocs.tsx'), 'utf8'))).toEqual([]);
  });

  let vars: Record<string, Record<string, string>>;
  let DEFAULT_FAMILY: string;
  beforeAll(async () => {
    DEFAULT_FAMILY = (await import('../../lib/theme')).DEFAULT_PALETTE_FAMILY;
    const css = readFileSync(path.join(REPO, 'src/app/globals.css'), 'utf8');
    const grab = (test: (sel: string) => boolean) => {
      const out: Record<string, string> = {};
      postcss.parse(css).walkRules(r => {
        if (!test(r.selector)) return;
        r.walkDecls(d => { if (d.prop.startsWith('--')) out[d.prop] = d.value.trim(); });
      });
      return out;
    };
    const harvestLight = grab(s => s === ':root');
    const harvestDark = grab(s => /(^|,)\s*\.dark\b|\[data-theme="dark"\]/.test(s) && !/data-palette/.test(s));
    const classicLight = grab(s => /\[data-palette="classic"\]\[data-theme="light"\]/.test(s));
    const classicDark = grab(s => /\[data-palette="classic"\](\.dark|\[data-theme="dark"\])/.test(s));
    vars = {
      // Classic first: it is DEFAULT_PALETTE_FAMILY, so it is the palette a
      // church actually sees unless it has chosen otherwise.
      'classic light': { ...harvestLight, ...classicLight },
      'classic dark': { ...harvestLight, ...harvestDark, ...classicDark },
      'harvest light': harvestLight,
      'harvest dark': { ...harvestLight, ...harvestDark },
    };
  });

  it('Classic is the default, and is the first palette checked', () => {
    expect(DEFAULT_FAMILY).toBe('classic');
    expect(Object.keys(vars)[0]).toBe('classic light');
  });

  it('every token the tree names has a value in all four palettes', async () => {
    await mountDocs();
    // Read the tokens off what actually RENDERED, so a class the tree stopped
    // spelling cannot leave a stale assertion passing.
    const named = new Set<string>();
    for (const el of [container, ...qa('*')]) {
      for (const m of (el.getAttribute?.('style') ?? '').matchAll(/var\((--[a-z0-9-]+)/g)) named.add(m[1]);
      for (const m of (el.getAttribute?.('class') ?? '').matchAll(/var\((--[a-z0-9-]+)/g)) named.add(m[1]);
    }
    // Plus the semantic classes' own tokens, resolved through globals.css.
    for (const t of ['--surface-raised', '--surface-sunken', '--text-strong', '--text-body',
      '--text-faint', '--text-muted', '--border-default']) named.add(t);

    expect(named.size, 'nothing was found to check — the scan is broken').toBeGreaterThanOrEqual(5);
    // --brand-color is the tenant accent and is deliberately absent from every
    // dark/palette block: it must NOT be greyed out by a family (THE-111).
    for (const [palette, table] of Object.entries(vars)) {
      for (const token of named) {
        if (token === '--brand-color') continue;
        expect(table[token], `${token} has no value in ${palette}`).toBeDefined();
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9b · the editor's own measure
// ═════════════════════════════════════════════════════════════════════════════
describe('a note is not rendered at reading size', () => {
  it('hands the editor a flat prose measure, not the shared responsive ramp', async () => {
    await mountDocs();
    await clickLeaf('d-mid');
    // RichTextEditor's default is `prose prose-sm sm:prose lg:prose-lg
    // xl:prose-2xl`, and prose-2xl is a 1.5rem base — so above 1280px a note,
    // and the placeholder that inherits from it, rendered at 24px. Notes opts
    // out; the other editors (blog, newsletter, courses) keep the ramp.
    expect(editorProps.last?.proseClass, 'the notes editor is back on the shared ramp')
      .toBe('prose prose-sm');
  });

  it('leaves every other editor on the shared default', () => {
    const rte = readFileSync(path.join(SRC, 'components/RichTextEditor.tsx'), 'utf8');
    // The prop is optional and defaults to the exact string every caller had,
    // so opting one screen out cannot move any of the others.
    expect(rte).toMatch(/proseClass = DEFAULT_PROSE_CLASS/);
    expect(rte).toContain("'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl'");
    for (const f of ['components/AdminBlog.tsx', 'components/NewsletterEditor.tsx']) {
      const src = readFileSync(path.join(SRC, f), 'utf8');
      if (!src.includes('<RichTextEditor')) continue;
      expect(src, `${f} started passing a prose measure`).not.toContain('proseClass');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10 · width
// ═════════════════════════════════════════════════════════════════════════════
describe('no horizontal overflow at 380/768/1024/1280/1440', () => {
  /**
   * ⚠️ Width is not monotonic on this screen. The rail appears at `lg` (1024px)
   * and takes `--sidebar-width` out of the row, so the editor is WIDER at 768px
   * — where it has the viewport to itself — than it is at 1024px. Both sides of
   * that step are measured.
   */
  const VIEWPORTS = [380, 768, 1024, 1280, 1440];
  type Rule = { cls: string; minWidth: number; decls: Record<string, string> };
  let emitted: Rule[] = [];
  let rootPx: { minWidth: number; size: number }[] = [];

  beforeAll(async () => {
    const { buildUtilityCss } = await import('../../test/support/tailwind-build');
    const css = readFileSync(path.join(REPO, 'src/app/globals.css'), 'utf8');
    postcss.parse(css).walkAtRules('media', (at) => {
      const mq = at.params.match(/min-width:\s*([\d.]+)px/);
      if (!mq) return;
      at.walkRules((r) => {
        if (!/(^|,)\s*(html|:root)\s*(,|$)/.test(r.selector)) return;
        r.walkDecls('font-size', (d) => {
          const v = d.value.trim().match(/^([\d.]+)px$/);
          if (v) rootPx.push({ minWidth: Number(mq[1]), size: Number(v[1]) });
        });
      });
    });
    postcss.parse(css).walkRules((r) => {
      if (!/(^|,)\s*(html|:root)\s*(,|$)/.test(r.selector)) return;
      r.walkDecls('font-size', (d) => {
        const v = d.value.trim().match(/^([\d.]+)px$/);
        if (v) rootPx.push({ minWidth: 0, size: Number(v[1]) });
      });
    });
    if (!rootPx.some(r => r.minWidth === 0)) rootPx.push({ minWidth: 0, size: 16 });
    rootPx.sort((a, b) => a.minWidth - b.minWidth);

    // Compile the REAL classes the screen renders, so nothing here is a guess
    // about what Tailwind emits.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const r = createRoot(host);
    await act(async () => { r.render(<AdminDocs />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const raw = [host, ...host.querySelectorAll('*')].map(e => e.getAttribute('class') || '').join(' ');
    await act(async () => { r.unmount(); });
    host.remove();

    const out = await buildUtilityCss(raw);
    const collect = (node: postcss.Rule, minWidth: number) => {
      const decls: Record<string, string> = {};
      node.walkDecls((d) => { decls[d.prop] = d.value.trim(); });
      const unescape = (sel: string) => sel.replace(/^\./, '')
        .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/\\/g, '');
      emitted.push({ cls: unescape(node.selector), minWidth, decls });
    };
    postcss.parse(out).each((node) => {
      if (node.type === 'rule') collect(node, 0);
      if (node.type === 'atrule' && node.name === 'media') {
        const m = node.params.match(/min-width:\s*([\d.]+)px/);
        if (!m) return;
        node.walkRules((r2) => collect(r2, Number(m[1])));
      }
    });
    expect(emitted.length, 'Tailwind produced no rules for the rendered classes').toBeGreaterThan(0);
  }, 180_000);

  const classesOf = (el: Element) => (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
  const effective = (classes: string[], viewport: number) => {
    const wanted = new Set(classes);
    const out: Record<string, string> = {};
    for (const rule of emitted) {
      if (!wanted.has(rule.cls) || rule.minWidth > viewport) continue;
      Object.assign(out, rule.decls);
    }
    return out;
  };
  const rootSizeAt = (v: number) => rootPx.filter(r => r.minWidth <= v).slice(-1)[0].size;
  const px = (value: string | undefined, viewport: number): number | null => {
    if (!value) return null;
    const rem = value.match(/^(-?[\d.]+)rem$/);
    if (rem) return Number(rem[1]) * rootSizeAt(viewport);
    const p = value.match(/^(-?[\d.]+)px$/);
    return p ? Number(p[1]) : null;
  };

  it('nothing in the screen declares a width wider than the viewport it renders in', async () => {
    await mountDocs();
    await clickLeaf('d-newest'); // the worst case: rail AND editor on screen
    const els = [container, ...qa('*')];

    for (const viewport of VIEWPORTS) {
      for (const el of els) {
        const d = effective(classesOf(el), viewport);
        for (const prop of ['width', 'min-width']) {
          const value = px(d[prop], viewport);
          if (value === null) continue;
          expect(
            value,
            `at ${viewport}px, .${classesOf(el).join('.')} sets ${prop}: ${d[prop]}`,
          ).toBeLessThanOrEqual(viewport);
        }
      }
    }
  });

  it('the rail is out of the row below 1024px, so a phone lays out one pane', async () => {
    await mountDocs();
    await clickLeaf('d-newest');
    const rail = q('[data-testid="docs-sidebar"]')!;
    const pane = q('[data-testid="docs-main-pane"]')!;

    // ⚠️ MEASURED, not assumed. With a note open, below `lg` the rail is
    // `display: none` and the editor has the viewport; at `lg` and above both
    // are laid out and the editor gives up --sidebar-width to the rail.
    expect(effective(classesOf(rail), 380).display, 'a 232px rail beside a 380px editor').toBe('none');
    expect(effective(classesOf(rail), 768).display).toBe('none');
    expect(effective(classesOf(rail), 1024).display).toBe('flex');
    expect(effective(classesOf(rail), 1440).display).toBe('flex');
    expect(effective(classesOf(pane), 380).display, 'the editor is not on screen on a phone').toBe('flex');
  });

  it('with no note open the tree is the pane on a phone, and the tree is never both', async () => {
    await mountDocs();
    const rail = q('[data-testid="docs-sidebar"]')!;
    const pane = q('[data-testid="docs-main-pane"]')!;
    // This is the whole answer to "no drill-down at 380px": the tree is what a
    // phone lands on, with no note open and no folder screen in front of it.
    expect(effective(classesOf(rail), 380).display).toBe('flex');
    expect(effective(classesOf(pane), 380).display, 'two panes at 380px').toBe('none');
    expect(effective(classesOf(rail), 1024).display).toBe('flex');
    expect(effective(classesOf(pane), 1024).display).toBe('flex');
  });

  it('mints no width of its own, and spends no page measure either', () => {
    const src = readFileSync(path.join(SRC, 'components/AdminDocs.tsx'), 'utf8');
    // This screen is a rail and a pane, not a document, so it takes the shell's
    // content box whole — FORM_CONTAINER's 1120px cap centred the pair and put a
    // band of dead space between the admin nav and the tree. Removing a measure
    // is not the same as inventing one, and the assertions below are what keep
    // the second thing from happening.
    expect(
      src.replace(/^\s*\/\/.*$/gm, ''),
      'a page measure is back on a screen that is not a document',
    ).not.toContain('FORM_CONTAINER');
    // The rail's width is the sidebar primitive's own custom property.
    expect(src).toContain('lg:w-(--sidebar-width)');
    // No new px width anywhere in the tree or the screen.
    for (const f of ['components/AdminDocs.tsx', 'components/docs/DocsTree.tsx']) {
      const widths = [...readFileSync(path.join(SRC, f), 'utf8')
        .matchAll(/\b(?:lg:|sm:|md:)?(?:max-)?w-\[(\d+)px\]/g)].map(m => m[0]);
      expect(widths, `${f} mints a pixel width`).toEqual([]);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11 · 🔴 out of scope, byte for byte
// ═════════════════════════════════════════════════════════════════════════════
describe('AdminDashboard.tsx, firestore.rules and functions/ are byte-identical', () => {
  /**
   * Digests recorded from a CLEAN `origin/main` working tree before a line of
   * this ticket was written, and embedded as literals.
   *
   * Not read from git at assertion time, deliberately: CI checks out with
   * `fetch-depth: 1`, so `git show <sha>` there dies with "invalid object
   * name" — the failure mode admin-data-screens.desktop-layout.test.tsx
   * documents at length. Same discipline, no shelling out.
   */
  /**
   * ⚠️ RE-RECORDED, because THE-276 and THE-277 landed on main between this
   * branch opening and merging — not because this branch edited the shell.
   *
   * The original value was taken from `origin/main` at 5e06c67. THE-277 added a
   * Signups nav entry and THE-276 put the dashboard behind a tab shell, and both
   * had to touch AdminDashboard.tsx, which is exactly why THIS ticket was told
   * not to. The claim the pin makes is about THIS branch's authorship, and that
   * claim is unchanged: `git diff origin/main -- AdminDashboard.tsx` is empty.
   * A digest that stayed stale would fail for their work rather than for a
   * regression, which is the one thing a guard must not do.
   */
  /**
   * ⚠️ RE-RECORDED AGAIN by THE-291, and for the same reason as last time: work
   * that is not this branch's landed on the file.
   *
   * THE-291 removed the dead `onChangePlan` / `onCancelPlan` props from the
   * `<AdminSettings>` mount. Their implementations wrote `plan` and
   * `planStatus` onto `users/{uid}` straight from the browser SDK — the write
   * the money path forbids — and neither prop was ever called by AdminSettings.
   *
   * 🔴 The assertion is NOT weakened: it is still one value, still strict, and
   * the AdminDocs mount assertion below is untouched and is the guard that
   * actually says what must stay true of this shell. A digest left stale would
   * fail for someone else's work rather than for a regression, which is the one
   * thing a guard must not do.
   */
  /**
   * ⚠️ AMENDED BY THE-326 — A SET, AND THE OLD VALUE IS STILL IN IT.
   *
   * 🔴 APPENDED, NEVER SUBSTITUTED. THE-291's digest below is exactly where it
   * was; THE-326's is an ADDITIONAL accepted value. `main` went red for everyone
   * once because a PR replaced a pinned digest, so replacing this one was not an
   * option — and stopping was not either, because the entry a set already solves
   * is the entry this ticket needs.
   *
   * ⚠️ THIS IS THE SHAPE THE REST OF THE REPO ALREADY USES for a file another
   * ticket legitimately owns — `the-276`, `the-283`, `the-290`, `the-294`,
   * `the-299`, `the-302` and `THE-292.country-prompt` all pin AdminDashboard as
   * a set of accepted values, for the reason `the-276` states in full: CI runs
   * against `refs/pull/N/merge`, so the file legitimately holds different values
   * on different merge refs.
   *
   * 🔴 AND IT IS NOT A LOOSENING. The claim this suite makes is "AdminDocs did
   * not edit the shell", and it still fails on any digest that is neither of
   * these two. What changed is only that somebody else's landed work no longer
   * counts as this ticket's edit. The AdminDocs mount assertion below — the one
   * that says WHAT must stay true of the shell — is untouched.
   *
   * THE-326 adds the `services` nav entry, its render-switch arm and two
   * imports: service planning is its own section now. It touches nothing about
   * Notes, and the mount assertion below proves that independently.
   */
  const ADMIN_DASHBOARD_DIGESTS = [
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
  'e9618615d801de3170869abf041d2260edaa5360db0eb25e6d7c95c247ec7fa4',
  ];

  it('AdminDashboard.tsx is untouched by THIS ticket — others legitimately own it', () => {
    const actual = sha256(readFileSync(path.join(SRC, 'components/AdminDashboard.tsx')));
    expect(
      ADMIN_DASHBOARD_DIGESTS,
      `AdminDashboard.tsx is at ${actual}, which is none of the accepted values — so THIS ticket edited it`,
    ).toContain(actual);
  });

  it("AdminDocs is still mounted with the wrapper and the props it had", () => {
    // The digest above already proves the shell is untouched by this branch;
    // this says WHAT must be true of the mount, so a failure names the thing
    // rather than just "something moved".
    //
    // ⚠️ By CONTENT, not by line number. The brief said the mount was on line
    // 1160 and must not move, and pinning the line was the literal reading —
    // but a line number is a fact about every line ABOVE it, so THE-277 adding
    // one nav entry pushed it to 1186 and failed this for someone else's work.
    // The mount itself — its wrapper, its props — is what the brief was
    // protecting, and that is byte-identical.
    const shell = readFileSync(path.join(SRC, 'components/AdminDashboard.tsx'), 'utf8');
    const line = shell.split('\n').find(l => l.includes('<AdminDocs'));
    expect(line, 'the AdminDocs mount is gone from the shell').toBeDefined();
    expect(line!.trim())
      .toBe('? <div className="p-4 lg:p-0"><AdminDocs initialDocId={itemId} onItemConsumed={clearItemId} /></div>');
    expect(shell, 'the import moved').toContain("import AdminDocs from './AdminDocs';");
  });

  it('firestore.rules is untouched', () => {
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
  });

  it('functions/ is untouched', () => {
    // A manifest of path + content, so a DELETED or ADDED file fails too — a
    // digest per file could not catch either.
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        if (name === 'node_modules' || name === '.git') return [];
        const full = path.join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
    const root = path.join(REPO, 'functions');
    expect(existsSync(root), 'functions/ is gone').toBe(true);
    const manifest = walk(root).sort()
      .map((f) => `${path.relative(REPO, f).split(path.sep).join('/')}  ${sha256(readFileSync(f))}`)
      .join('\n');
    expect(sha256(manifest), 'a file under functions/ changed, moved, appeared or went')
      .toBe('90bc1564c8a27159e77c91358972d4931c7623784a2a23d2531a6414028463f3');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 12 · the persisted shapes
// ═════════════════════════════════════════════════════════════════════════════
describe('the persisted Doc and DocFolder shapes are unchanged', () => {
  const hooks = () => readFileSync(path.join(SRC, 'hooks/queries/useDocsQueries.ts'), 'utf8');
  const fields = (iface: string) => {
    const m = hooks().match(new RegExp(`export interface ${iface} \\{([\\s\\S]*?)\\n\\}`));
    expect(m, `${iface} is gone`).not.toBeNull();
    return [...m![1].matchAll(/^\s*(\w+)\??:/gm)].map(x => x[1]);
  };

  it('Doc carries exactly the fields it carried', () => {
    expect(fields('Doc')).toEqual([
      'id', 'title', 'content', 'folderId', 'createdBy', 'createdAt', 'updatedAt',
      'isPrivate', 'sharedWith', 'tenantId', 'pinned',
    ]);
  });

  it('DocFolder carries exactly the fields it carried, order included', () => {
    expect(fields('DocFolder')).toEqual([
      'id', 'name', 'parentId', 'createdBy', 'createdAt', 'order', 'tenantId',
    ]);
  });

  it('the writes this screen makes still write those fields and no others', () => {
    const src = readFileSync(path.join(SRC, 'components/AdminDocs.tsx'), 'utf8');
    // Both folder creates still set `order: folders.length` — the ticket
    // forbids changing `order` semantics, and the tree reads `order` for
    // sibling sequence without ever writing it.
    expect([...src.matchAll(/order: folders\.length,/g)]).toHaveLength(2);
    expect(
      readFileSync(path.join(SRC, 'components/docs/DocsTree.tsx'), 'utf8'),
      'the tree writes to a document — it is a view',
    ).not.toMatch(/updateDoc|addDoc|deleteDoc|setDoc/);
  });

  it('the hooks file itself is untouched', () => {
    // The data model already supported this ticket; nothing had to migrate.
    expect(sha256(readFileSync(path.join(SRC, 'hooks/queries/useDocsQueries.ts'))))
      .toBe('47a90c2851cb4156b2965fc32f35750774efcade1a2cfb583c6e45a84ff4d2e8');
  });
});
