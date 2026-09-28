import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminDocs from '../AdminDocs';

/**
 * Switching notes kept the previous note's TipTap document, and a keystroke
 * after the switch wrote that document onto the newly selected note. Long
 * sidebar titles also overflowed the selected-row fill because ItemTitle is
 * `flex w-fit`.
 *
 * The editor stub here captures `content` once at mount the way TipTap 2.27
 * does — so this file goes red if the editor is not keyed on the note id.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixtures = vi.hoisted(() => {
  const t = (iso: string) => ({
    toMillis: () => Date.parse(iso),
    toDate: () => new Date(iso),
  });
  const LONG_TITLE = 'Fake Sunday gathering volunteer rota for the north campus parking and welcome team';
  const FOLDER = {
    id: 'f-sermons',
    name: 'Sermons',
    parentId: null as string | null,
    createdBy: 'u1',
    createdAt: null,
    order: 0,
  };
  const NOTE_A = {
    id: 'note-a',
    title: LONG_TITLE,
    content: '<p>fake-alpha-body</p>',
    folderId: 'f-sermons',
    createdBy: 'u1',
    createdAt: null,
    updatedAt: t('2026-05-01T00:00:00Z'),
    isPrivate: true,
    sharedWith: [] as string[],
    pinned: false,
  };
  const NOTE_B = {
    id: 'note-b',
    title: 'Fake Beta Budget Notes',
    content: '<p>fake-beta-body</p>',
    folderId: null as string | null,
    createdBy: 'u1',
    createdAt: null,
    updatedAt: t('2026-04-01T00:00:00Z'),
    isPrivate: true,
    sharedWith: [] as string[],
    pinned: false,
  };
  const NOTE_C = {
    id: 'note-c',
    title: 'Fake Gamma Welcome Script',
    content: '<p>fake-gamma-body</p>',
    folderId: null as string | null,
    createdBy: 'u1',
    createdAt: null,
    updatedAt: t('2026-03-01T00:00:00Z'),
    isPrivate: true,
    sharedWith: [] as string[],
    pinned: false,
  };
  return { LONG_TITLE, FOLDER, NOTE_A, NOTE_B, NOTE_C, NOTES: [NOTE_A, NOTE_B, NOTE_C] };
});
const { LONG_TITLE, FOLDER, NOTE_A, NOTE_B, NOTE_C, NOTES } = fixtures;

const TYPED_A = '<p>typed-in-fake-alpha</p>';
const TYPED_B = '<p>typed-in-fake-beta</p>';
const LATE_A = '<p>late-from-fake-alpha</p>';

const editorHarness = vi.hoisted(() => ({
  /** Latest props.onChange from the mounted editor instance. */
  rawOnChange: null as null | ((html: string) => void),
  /** Type into the stub: updates the on-screen body and notifies the parent. */
  type: null as null | ((html: string) => void),
}));

vi.mock('../RichTextEditor', () => {
  const React = require('react') as typeof import('react');
  return {
    COMPACT_PROSE_CLASS: 'prose prose-sm',
    default: function RichTextEditorStub(props: {
      content: string;
      onChange: (html: string) => void;
    }) {
      // TipTap reads `content` only at creation. A later props.content change
      // must not rewrite the document — that is the bug this stub exists to see.
      const [body, setBody] = React.useState(() => props.content);
      editorHarness.rawOnChange = props.onChange;
      editorHarness.type = (html: string) => {
        setBody(html);
        props.onChange(html);
      };
      return React.createElement('div', { 'data-testid': 'editor-body' }, body);
    },
  };
});

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
  useDocs: () => ({ data: { items: fixtures.NOTES, truncated: false }, isLoading: false }),
  useDocFolders: () => ({ data: { items: [fixtures.FOLDER], truncated: false } }),
  useSharedDocs: () => ({ data: { items: [], truncated: false } }),
}));

const writes = () =>
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

const editorBody = () => container.querySelector('[data-testid="editor-body"]')?.textContent ?? null;
const titleInput = () => container.querySelector('input[placeholder="Untitled"]') as HTMLInputElement | null;

async function clickLeaf(scope: 'recents' | 'tree', id: string) {
  const testId = scope === 'recents' ? 'docs-recents' : 'docs-tree';
  const leaf = container.querySelector(`[data-testid="${testId}"] [data-doc-id="${id}"]`) as HTMLElement | null;
  expect(leaf, `${scope} leaf ${id} missing`).toBeTruthy();
  await act(async () => { leaf!.click(); });
  await flush();
}

async function typeContent(html: string) {
  expect(editorHarness.type, 'editor stub is not mounted').toBeTruthy();
  await act(async () => { editorHarness.type!(html); });
  await flush();
}

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  updateDoc.mockImplementation(async () => undefined);
  editorHarness.rawOnChange = null;
  editorHarness.type = null;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await unmountDocs();
  container.remove();
  vi.useRealTimers();
});

describe('AdminDocs — switching notes remounts the editor on the new body', () => {
  it('shows A then B then C via Recents leaves', async () => {
    await mountDocs();
    await clickLeaf('recents', 'note-a');
    expect(editorBody()).toBe(NOTE_A.content);
    expect(titleInput()?.value).toBe(NOTE_A.title);

    await clickLeaf('recents', 'note-b');
    expect(editorBody()).toBe(NOTE_B.content);
    expect(titleInput()?.value).toBe(NOTE_B.title);

    await clickLeaf('recents', 'note-c');
    expect(editorBody()).toBe(NOTE_C.content);
    expect(titleInput()?.value).toBe(NOTE_C.title);
  });

  it('shows A then B then C via tree leaves', async () => {
    await mountDocs();
    await clickLeaf('tree', 'note-a');
    expect(editorBody()).toBe(NOTE_A.content);

    await clickLeaf('tree', 'note-b');
    expect(editorBody()).toBe(NOTE_B.content);

    await clickLeaf('tree', 'note-c');
    expect(editorBody()).toBe(NOTE_C.content);
  });
});

describe('AdminDocs — a pending save is bound to the note that was edited', () => {
  it('flushes A on switch and never writes A\'s body onto B', async () => {
    await mountDocs();
    await clickLeaf('recents', 'note-a');
    await typeContent(TYPED_A);
    expect(writes()).toHaveLength(0);

    await clickLeaf('recents', 'note-b');
    // Flush is not awaited, but the write is issued before the pane settles.
    await flush();
    expect(writes()).toContainEqual(expect.objectContaining({ id: 'note-a', content: TYPED_A }));
    expect(writes().some(w => w.id === 'note-b')).toBe(false);
    expect(editorBody()).toBe(NOTE_B.content);

    await runDebounce();
    expect(writes().filter(w => w.id === 'note-a').every(w => w.content === TYPED_A)).toBe(true);
    expect(writes().some(w => w.id === 'note-b')).toBe(false);

    await typeContent(TYPED_B);
    await runDebounce();
    expect(writes().at(-1)).toMatchObject({ id: 'note-b', content: TYPED_B });
    expect(writes().some(w => w.id === 'note-b' && w.content === TYPED_A)).toBe(false);
    expect(writes().some(w => w.id === 'note-a' && w.content === TYPED_B)).toBe(false);
    expect(writes().some(w => w.id === 'note-b' && w.content === NOTE_A.content)).toBe(false);
  });

  it('ignores a late onChange from the unmounted editor', async () => {
    await mountDocs();
    await clickLeaf('recents', 'note-a');
    const aOnChange = editorHarness.rawOnChange;
    expect(aOnChange).toBeTruthy();
    await typeContent(TYPED_A);

    await clickLeaf('recents', 'note-b');
    await flush();
    const writesAfterSwitch = writes().length;
    expect(editorBody()).toBe(NOTE_B.content);

    await act(async () => { aOnChange!(LATE_A); });
    await flush();
    await runDebounce();

    expect(editorBody()).toBe(NOTE_B.content);
    expect(titleInput()?.value).toBe(NOTE_B.title);
    expect(writes().some(w => w.id === 'note-b' && (w.content === LATE_A || w.content === TYPED_A))).toBe(false);
    expect(writes().some(w => w.content === LATE_A)).toBe(false);
    expect(writes().length).toBe(writesAfterSwitch);

    await clickBackToNotes();
    const bWrites = writes().filter(w => w.id === 'note-b');
    expect(bWrites.every(w => w.content === NOTE_B.content || w.content === TYPED_B)).toBe(true);
    expect(bWrites.some(w => w.content === LATE_A || w.content === TYPED_A)).toBe(false);
  });

  it('re-clicking the open note does not reset the body or drop the pending save', async () => {
    await mountDocs();
    await clickLeaf('tree', 'note-a');
    await typeContent(TYPED_A);
    expect(editorBody()).toBe(TYPED_A);

    await clickLeaf('tree', 'note-a');
    expect(editorBody()).toBe(TYPED_A);
    expect(writes()).toHaveLength(0);

    await clickBackToNotes();
    expect(writes()).toContainEqual(expect.objectContaining({ id: 'note-a', content: TYPED_A }));
    expect(writes().some(w => w.id === 'note-a' && w.content === NOTE_A.content)).toBe(false);
  });
});

describe('DocsTree — long titles carry a tooltip and can shrink', () => {
  it('puts the full title on the row and truncate/min-w-0 on the label', async () => {
    await mountDocs();
    const row = container.querySelector(`[data-testid="docs-recents"] [data-doc-id="note-a"]`) as HTMLElement;
    expect(row, 'recents row for the long-titled note is missing').toBeTruthy();
    expect(row.getAttribute('title')).toBe(LONG_TITLE);

    const label = row.querySelector('[data-slot="item-title"]') as HTMLElement;
    expect(label, 'the row has no ItemTitle').toBeTruthy();
    expect(label.className).toMatch(/\btruncate\b/);
    expect(label.className).toMatch(/\bmin-w-0\b/);

    const folderRow = container.querySelector('[data-folder-toggle="f-sermons"]') as HTMLElement;
    expect(folderRow.getAttribute('title')).toBe(FOLDER.name);
  });
});
