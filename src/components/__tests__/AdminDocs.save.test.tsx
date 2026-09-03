import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminDocs from '../AdminDocs';

/**
 * AdminDocs lost a note's text on several paths, and told the user nothing on any
 * of them:
 *
 *   A. `saveDoc`'s catch set the status back to 'idle', which the status chip
 *      renders as an EMPTY STRING — so a failed write looked exactly like a
 *      document nobody had touched. There was no 'error' state at all.
 *   B. `closeEditor` did not await the save and closed regardless, so a failure
 *      landed on a screen the user had already left.
 *   C. that same close was guarded by `if (editTitle.trim())`, so a note with
 *      content and a blank title was never written on close — everything typed
 *      since the last debounce was discarded.
 *   D. the 2s auto-save debounce was never cleared on unmount, and it captured
 *      `editTitle` from the render scope at SCHEDULE time — so a title edited
 *      after the content keystroke was written back stale, reverting a title a
 *      blur had already saved.
 *
 * The toasts these tests assert only became visible at all once `<Toaster />` was
 * mounted in the root layout; before that every `toast.*` call in this file's
 * component was a no-op.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPEN_DOC = vi.hoisted(() => ({
  id: 'doc-1',
  title: 'Sermon',
  content: '<p>old</p>',
  folderId: null,
  createdBy: 'u1',
  createdAt: null,
  updatedAt: null,
  isPrivate: true,
  sharedWith: [] as string[],
  pinned: false,
}));

// ── RichTextEditor stub: hands the test the body's onChange so the debounce can be driven.
const harness = vi.hoisted(() => ({ onContentChange: null as null | ((c: string) => void) }));
vi.mock('../RichTextEditor', () => ({
  default: (props: { onChange: (c: string) => void }) => {
    harness.onContentChange = props.onChange;
    return null;
  },
}));

const updateDoc = vi.hoisted(() => vi.fn(async () => undefined as unknown));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  addDoc: vi.fn(async () => ({ id: 'created' })),
  updateDoc,
  deleteDoc: vi.fn(async () => {}),
  doc: (_db: unknown, _collection: string, id: string) => ({ id }),
  getDoc: vi.fn(async () => ({ data: () => ({ active: false }) })),
  getDocs: vi.fn(async () => ({ docs: [] })),
  serverTimestamp: () => 'SERVER_TS',
  Timestamp: class {},
  arrayUnion: (v: unknown) => v,
  arrayRemove: (v: unknown) => v,
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

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
// The docs hooks return `{ items, truncated }`, not a bare array (THE-262):
// the reads page to completeness, and `truncated` is how a surviving ceiling
// tells the consumer the list is short instead of lying by omission.
vi.mock('../../hooks/queries/useDocsQueries', () => ({
  useDocs: () => ({ data: { items: [OPEN_DOC], truncated: false }, isLoading: false }),
  useDocFolders: () => ({ data: { items: [], truncated: false } }),
  useSharedDocs: () => ({ data: { items: [], truncated: false } }),
}));

/** Every write the component issued, in order. */
const writes = () =>
  // vi.fn() with no declared signature types mock.calls as an array of empty
  // tuples, so the destructure below needs the real arity spelled out.
  (updateDoc.mock.calls as unknown as [{ id: string }, { title: string; content: string }][])
    .map(([ref, payload]) => ({ id: ref.id, ...payload }));

let container: HTMLDivElement;
let root: Root;
let mounted = false;

const flush = async () => {
  await act(async () => {
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
};

async function mountDocs() {
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminDocs />);
  });
  mounted = true;
  await flush();
}

async function unmountDocs() {
  if (!mounted) return;
  mounted = false;
  await act(async () => { root.unmount(); });
}

/**
 * Click the note in the tree to load it into the editor pane.
 *
 * THE-275 replaced the list view this used to click — a grid of doc cards that
 * only existed until a note was open — with a tree that is always on screen, so
 * the leaf is addressed by `data-doc-id` rather than by finding a `<p>` with the
 * title in it. Nothing else in this file changes: every assertion below is about
 * saving, and saving is untouched.
 *
 * The same note appears twice (once under Recents, once in the tree), which is
 * the point of Recents; either leaf opens it, so this takes the first.
 */
async function openEditor() {
  const leaf = container.querySelector(`[data-doc-id="${OPEN_DOC.id}"]`) as HTMLElement;
  await act(async () => { leaf.click(); });
  await flush();
}

const titleInput = () => container.querySelector('input[placeholder="Untitled"]') as HTMLInputElement | null;

/** Type into the title field the way a user does — React's tracked value setter. */
async function typeTitle(value: string) {
  const input = titleInput()!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  await act(async () => { input.dispatchEvent(new Event('input', { bubbles: true })); });
}

/** React maps onBlur to the focusout event. */
async function blurTitle() {
  await act(async () => { titleInput()!.dispatchEvent(new Event('focusout', { bubbles: true })); });
  await flush();
}

/** Type in the note body, which schedules the 2s auto-save debounce. */
async function typeContent(content: string) {
  await act(async () => { harness.onContentChange?.(content); });
}

/** Let the 2s debounce fire and settle. */
async function runDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(2100);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
}

async function clickBackToNotes() {
  const back = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Notes')!;
  await act(async () => { back.click(); });
  await flush();
}

/** True while the full editor is on screen (the title field only exists there). */
const editorIsOpen = () => titleInput() !== null;
const statusText = () => container.textContent || '';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  updateDoc.mockImplementation(async () => undefined);
  harness.onContentChange = null;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await unmountDocs();
  container.remove();
  vi.useRealTimers();
});

describe('AdminDocs — a failed save is visible (defect A)', () => {
  it('shows a real error state instead of falling back to the blank idle chip', async () => {
    await mountDocs();
    await openEditor();
    expect(statusText()).not.toContain('Not saved');

    updateDoc.mockRejectedValue(new Error('permission-denied'));
    await typeContent('<p>new work</p>');
    await runDebounce();

    // 'idle' renders as '' — the whole point is that a failure must NOT look like
    // an untouched document.
    expect(statusText()).toContain('Not saved');
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('Could not save this note'),
      expect.objectContaining({ id: 'doc-save-error' }),
    );
  });

  it('does not raise an error for an in-flight write that a newer, successful one superseded', async () => {
    await mountDocs();
    await openEditor();

    // Two writes genuinely overlapping — a slow connection where the second
    // debounce fires while the first PUT is still out.
    const inFlight: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
    updateDoc.mockImplementation(
      () => new Promise<undefined>((resolve, reject) => {
        inFlight.push({ resolve: () => resolve(undefined), reject });
      }),
    );

    await typeContent('<p>first</p>');
    await runDebounce();
    await typeContent('<p>second</p>');
    await runDebounce();
    expect(inFlight).toHaveLength(2);

    // The newer write lands, then the older one fails. Its content is already
    // superseded on the server, so there is nothing for the user to act on.
    await act(async () => { inFlight[1].resolve(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { inFlight[0].reject(new Error('transient')); await Promise.resolve(); await Promise.resolve(); });

    expect(statusText()).toContain('Saved');
    expect(statusText()).not.toContain('Not saved');
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('AdminDocs — closing the editor cannot silently drop the work (defect B)', () => {
  it('keeps the editor open, with the text still in it, when the save fails', async () => {
    await mountDocs();
    await openEditor();

    updateDoc.mockRejectedValue(new Error('offline'));
    await typeContent('<p>unsaved work</p>');
    await clickBackToNotes();

    expect(editorIsOpen()).toBe(true);
    expect(statusText()).toContain('Not saved');
    expect(toast.error).toHaveBeenCalled();
  });

  it('closes once the save has actually landed', async () => {
    await mountDocs();
    await openEditor();

    await typeContent('<p>good work</p>');
    await clickBackToNotes();

    expect(editorIsOpen()).toBe(false);
    expect(writes().at(-1)).toMatchObject({ id: 'doc-1', content: '<p>good work</p>' });
  });
});

describe('AdminDocs — an untitled note is still the user\'s work (defect C)', () => {
  it('saves content on close when the title is blank', async () => {
    await mountDocs();
    await openEditor();

    await typeTitle('');
    await typeContent('<p>content but no title</p>');
    await clickBackToNotes();

    expect(writes()).toContainEqual(
      expect.objectContaining({ id: 'doc-1', title: '', content: '<p>content but no title</p>' }),
    );
  });

  it('saves content on close when the title is whitespace only, and stores it as empty', async () => {
    await mountDocs();
    await openEditor();

    await typeTitle('   ');
    await typeContent('<p>whitespace title</p>');
    await clickBackToNotes();

    const last = writes().at(-1)!;
    expect(last.content).toBe('<p>whitespace title</p>');
    // '   ' is truthy, so an untrimmed title would defeat every `title || 'Untitled'`
    // fallback in the list and render as a blank name.
    expect(last.title).toBe('');
  });
});

describe('AdminDocs — the pending debounce on unmount (defect D)', () => {
  it('flushes the queued save immediately rather than leaving the timer to fire into a dead component', async () => {
    await mountDocs();
    await openEditor();
    await typeContent('<p>typed then navigated away</p>');
    expect(writes()).toHaveLength(0); // still inside the 2s debounce

    await unmountDocs();

    expect(writes()).toContainEqual(
      expect.objectContaining({ id: 'doc-1', content: '<p>typed then navigated away</p>' }),
    );
  });

  it('does not write again when the timer that was cleared would have fired', async () => {
    await mountDocs();
    await openEditor();
    await typeContent('<p>once only</p>');
    await unmountDocs();

    const afterUnmount = writes().length;
    await act(async () => { vi.advanceTimersByTime(2100); });
    expect(writes()).toHaveLength(afterUnmount);
  });
});

describe('AdminDocs — the debounce must not write back a stale title (defect D, stale closure)', () => {
  it('writes the title the user has now, not the one captured when the content keystroke scheduled the save', async () => {
    await mountDocs();
    await openEditor();

    // Content first — this is what schedules the timer, capturing the title as it
    // stood at that moment ("Sermon").
    await typeContent('<p>body</p>');
    // …then the title changes, with no blur, inside the 2s window.
    await typeTitle('Sermon Notes');
    await runDebounce();

    expect(writes().at(-1)).toMatchObject({ title: 'Sermon Notes', content: '<p>body</p>' });
    expect(writes().map(w => w.title)).not.toContain('Sermon');
  });

  it('never reverts a title that a blur already saved', async () => {
    await mountDocs();
    await openEditor();

    await typeContent('<p>body</p>');
    await typeTitle('Renamed');
    await blurTitle();
    await runDebounce();

    expect(writes().map(w => w.title)).not.toContain('Sermon');
    expect(writes().at(-1)!.title).toBe('Renamed');
    // The blur absorbs the queued content save rather than racing it: it already
    // carries the latest content, so letting the debounce fire too would be a
    // second, identical write overlapping the first.
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({ title: 'Renamed', content: '<p>body</p>' });
  });
});
