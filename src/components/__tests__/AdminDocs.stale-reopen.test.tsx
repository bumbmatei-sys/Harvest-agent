import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AdminDocs from '../AdminDocs';

/**
 * Two autosave edges left after the note-switch fix.
 *
 * Stale reopen: the docs query keeps the body it loaded. A save updates
 * Firestore and invalidates that query, but a refetch that started earlier
 * (or has not come back yet) still hands the previous body to the click.
 * Opening the note again paints that body, and the next autosave writes it
 * over the body that just landed.
 *
 * Misattributed save: one save generation for the whole screen. An autosave
 * of note A that fails after note B is on screen is still the latest
 * generation, so B shows "Not saved" and the error toast. A later response
 * for an older save of the same note must not replace a newer one.
 *
 * `@testing-library/jest-dom` matchers come from the vitest setup.
 * `@testing-library/react` is not imported: its peer `@testing-library/dom`
 * is not installed, and the lockfile digest forbids adding it. The mount
 * harness is the one the other AdminDocs suites use.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixtures = vi.hoisted(() => {
  type NoteFixture = {
    id: string;
    title: string;
    content: string;
    folderId: string | null;
    createdBy: string;
    createdAt: null;
    updatedAt: { toMillis: () => number } | null;
    isPrivate: boolean;
    sharedWith: string[];
    pinned: boolean;
  };
  const NOTE_A: NoteFixture = {
    id: 'note-a',
    title: 'Alpha note',
    content: '<p>cached-alpha</p>',
    folderId: null,
    createdBy: 'u1',
    createdAt: null,
    updatedAt: null,
    isPrivate: true,
    sharedWith: [],
    pinned: false,
  };
  const NOTE_B: NoteFixture = {
    id: 'note-b',
    title: 'Beta note',
    content: '<p>cached-beta</p>',
    folderId: null,
    createdBy: 'u1',
    createdAt: null,
    updatedAt: null,
    isPrivate: true,
    sharedWith: [],
    pinned: false,
  };
  return { NOTE_A, NOTE_B, NOTES: [NOTE_A, NOTE_B] };
});
const { NOTE_A, NOTE_B } = fixtures;

const FRESH_A = '<p>saved-alpha</p>';
const DRAFT_A = '<p>draft-alpha</p>';
const FIRST_A = '<p>first-alpha</p>';
const SECOND_A = '<p>second-alpha</p>';
const FRESH_B = '<p>saved-beta</p>';
const SERVER_A = '<p>server-alpha</p>';
const CACHED_A = '<p>cached-alpha</p>';
const OTHER_A = '<p>other-alpha</p>';

type CachedDoc = { id: string; content: string; title: string; clientWriteVersion?: number };
type CachedList = { items: CachedDoc[]; truncated: boolean };

const docsCache = vi.hoisted(() => {
  const state: { docs?: CachedList; shared?: CachedList } = {};
  const setQueryData = vi.fn((key: readonly string[], updater: unknown) => {
    const bucket = key[0] === 'sharedDocs' ? 'shared' : key[0] === 'docs' ? 'docs' : null;
    if (!bucket) return undefined;
    const prev = state[bucket];
    const next = typeof updater === 'function' ? (updater as (p: unknown) => unknown)(prev) : updater;
    state[bucket] = next as CachedList | undefined;
    return next;
  });
  return { state, setQueryData };
});

const editorHarness = vi.hoisted(() => ({
  /** When set, the stub reports its initial body once, the way TipTap's onUpdate does after normalising HTML. */
  emitOnMount: false,
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
      const [body, setBody] = React.useState(() => props.content);
      editorHarness.type = (html: string) => {
        setBody(html);
        props.onChange(html);
      };
      React.useEffect(() => {
        if (editorHarness.emitOnMount) props.onChange(props.content);
        // The initial body is the one this instance was created with.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return React.createElement('div', { 'data-testid': 'editor-body' }, body);
    },
  };
});

/** Server time captured with each note commit. Not the browser clock. */
const serverTime = vi.hoisted(() => ({ ms: 5_000_000 }));

/**
 * The acknowledgement snapshot is this session's write, frozen when
 * `updateDoc` runs. A later `getDoc` / `getDocFromServer` can be pointed at
 * a collaborator without changing that snapshot — which is the gap a
 * follow-up read loses.
 */
const ackBridge = vi.hoisted(() => {
  type Listener = {
    onNext: (snap: unknown) => void;
    onError: (err: Error) => void;
  };
  type NotedWrite = { ms: number; title?: string; content?: string };
  const listeners: Listener[] = [];
  const writes: NotedWrite[] = [];
  const state = {
    hold: false,
    mode: 'time' as 'time' | 'null' | 'error',
    poisonReads: false,
    /** Indexes whose unsubscribe the component actually called. */
    unsubscribed: [] as number[],
    /**
     * When set, unsubscribe delivers the held acknowledgement synchronously.
     * That is a snapshot already in flight as the listener is removed.
     */
    deliverOnUnsub: false,
  };
  function deliver(listener: Listener, write: NotedWrite | undefined) {
    if (state.mode === 'error') {
      listener.onError(new Error('read failed'));
      return;
    }
    const ms = write?.ms ?? 5_000_000;
    listener.onNext({
      metadata: { hasPendingWrites: true, fromCache: false },
      data: () => ({}),
    });
    listener.onNext({
      metadata: { hasPendingWrites: false, fromCache: false },
      data: () => ({
        title: write?.title,
        content: write?.content,
        updatedAt: state.mode === 'null' ? undefined : { toMillis: () => ms },
      }),
    });
  }
  return {
    state,
    listeners,
    writes,
    reset() {
      listeners.length = 0;
      writes.length = 0;
      state.hold = false;
      state.mode = 'time';
      state.poisonReads = false;
      state.unsubscribed = [];
      state.deliverOnUnsub = false;
    },
    noteWrite(payload: { title?: string; content?: string }, ms: number) {
      writes.push({ ms, title: payload.title, content: payload.content });
    },
    subscribe(onNext: (snap: unknown) => void, onError: (err: Error) => void) {
      const listener = { onNext, onError };
      const index = listeners.length;
      listeners.push(listener);
      if (!state.hold) {
        queueMicrotask(() => deliver(listener, writes[index]));
      }
      return () => {
        state.unsubscribed.push(index);
        if (state.deliverOnUnsub) deliver(listener, writes[index]);
      };
    },
    release(index: number) {
      const listener = listeners[index];
      if (!listener) throw new Error(`no acknowledgement listener at ${index}`);
      deliver(listener, writes[index]);
    },
  };
});

const freshRead = vi.hoisted(() => ({
  ms: null as number | null,
  content: null as string | null,
  title: null as string | null,
  fail: false,
  reset() {
    this.ms = null;
    this.content = null;
    this.title = null;
    this.fail = false;
  },
}));

const updateDoc = vi.hoisted(() => vi.fn(async (
  _ref?: unknown,
  _payload?: { title?: string; content?: string; updatedAt?: unknown },
) => undefined as unknown));
const getDoc = vi.hoisted(() => vi.fn(async () => ({
  data: () => {
    if (ackBridge.state.poisonReads) {
      return {
        active: false,
        title: 'Alpha note',
        content: '<p>other-alpha</p>',
        updatedAt: { toMillis: () => 5_008_000 },
      };
    }
    return {
      active: false,
      updatedAt: { toMillis: () => serverTime.ms },
    };
  },
})));
const getDocFromServer = vi.hoisted(() => vi.fn(async () => {
  if (freshRead.fail) throw new Error('unavailable');
  return {
    data: () => ({
      title: freshRead.title,
      content: freshRead.content,
      updatedAt: freshRead.ms == null ? undefined : { toMillis: () => freshRead.ms },
    }),
  };
}));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  addDoc: vi.fn(async () => ({ id: 'created' })),
  updateDoc,
  deleteDoc: vi.fn(async () => {}),
  doc: (_db: unknown, _collection: string, id: string) => ({ id }),
  getDoc,
  getDocFromServer,
  onSnapshot: (_ref: unknown, arg2: unknown, arg3?: unknown, arg4?: unknown) => {
    const onNext = (typeof arg2 === 'function' ? arg2 : arg3) as (snap: unknown) => void;
    const onError = (typeof arg2 === 'function' ? arg3 : arg4) as (err: Error) => void;
    return ackBridge.subscribe(onNext, onError ?? (() => {}));
  },
  getDocs: vi.fn(async () => ({ docs: [] })),
  serverTimestamp: () => 'SERVER_TS',
  Timestamp: class {},
  arrayUnion: (v: unknown) => v,
  arrayRemove: (v: unknown) => v,
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('../../utils/notify', () => ({ notifyError: vi.fn() }));
vi.mock('../../utils/plan-features', () => ({ getPlanFeatures: () => ({ sermonNotes: false }) }));
vi.mock('../../utils/tenant-scope', () => ({ hasPlatformOverride: () => false, PLATFORM_TENANT_ID: 'harvest' }));
vi.mock('../../utils/doc-export', () => ({ exportToPDF: vi.fn(), exportToDOCX: vi.fn(), exportToMarkdown: vi.fn() }));
vi.mock('../../utils/markdown-import', () => ({ markdownToHtml: (s: string) => s, titleFromMarkdown: () => 'Imported' }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: async () => {},
    setQueryData: docsCache.setQueryData,
  }),
}));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: () => ({ currentTenantId: 't1', isAuthReady: true, tenantPlan: 'seed', isSuperAdmin: false }),
}));
// The list the screen renders stays the stale copy on purpose. A save may
// patch the query cache; it must not be required to replace this hook result
// before a click, because that is the window the bug lives in.
vi.mock('../../hooks/queries/useDocsQueries', () => ({
  useDocs: () => ({ data: { items: fixtures.NOTES, truncated: false }, isLoading: false }),
  useDocFolders: () => ({ data: { items: [], truncated: false } }),
  useSharedDocs: () => ({ data: { items: [fixtures.NOTE_A], truncated: false } }),
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
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
};

function seedCaches() {
  docsCache.state.docs = {
    items: fixtures.NOTES.map((note) => ({ ...note })),
    truncated: false,
  };
  docsCache.state.shared = {
    items: [{ ...fixtures.NOTE_A }],
    truncated: false,
  };
}

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

function titleValue(): string | null {
  const input = container.querySelector('input[placeholder="Untitled"]') as HTMLInputElement | null;
  return input?.value ?? null;
}

/** The save chip's exact label, or '' when the note is idle. */
function statusChip(): string {
  const labelled = container.querySelector('[data-testid="docs-save-status"]');
  if (labelled) return labelled.textContent?.trim() ?? '';
  const text = container.textContent ?? '';
  if (text.includes('Not saved')) return 'Not saved';
  if (text.includes('Saving')) return 'Saving…';
  if (text.includes('Saved')) return 'Saved';
  return '';
}

async function clickLeaf(id: string) {
  const leaf = container.querySelector(`[data-testid="docs-tree"] [data-doc-id="${id}"]`) as HTMLElement | null;
  expect(leaf, `tree leaf ${id} missing`).toBeTruthy();
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
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
}

async function releaseAck(index: number) {
  await act(async () => {
    ackBridge.release(index);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
}

function deferred() {
  let resolve: () => void = () => {};
  let reject: (e: Error) => void = () => {};
  const promise = new Promise<undefined>((res, rej) => {
    resolve = () => res(undefined);
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  updateDoc.mockImplementation(async (_ref, payload) => {
    if (payload && typeof payload.title === 'string' && 'updatedAt' in payload) {
      ackBridge.noteWrite(payload, serverTime.ms);
    }
  });
  editorHarness.emitOnMount = false;
  editorHarness.type = null;
  fixtures.NOTE_A.title = 'Alpha note';
  fixtures.NOTE_A.content = CACHED_A;
  fixtures.NOTE_A.updatedAt = null;
  fixtures.NOTE_B.content = '<p>cached-beta</p>';
  fixtures.NOTE_B.updatedAt = null;
  serverTime.ms = 5_000_000;
  ackBridge.reset();
  freshRead.reset();
  seedCaches();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await unmountDocs();
  container.remove();
  vi.useRealTimers();
});

describe('AdminDocs — reopening a note uses the body that was just saved', () => {
  it('does not paint the stale cached copy or autosave it over the saved body', async () => {
    editorHarness.emitOnMount = true;
    await mountDocs();
    await clickLeaf('note-a');
    expect(editorBody()).toBe(NOTE_A.content);

    await typeContent(FRESH_A);
    await runDebounce();
    expect(writes()).toContainEqual(expect.objectContaining({ id: 'note-a', content: FRESH_A }));
    expect(writes().some((w) => w.id === 'note-a' && w.content === NOTE_A.content)).toBe(false);

    await clickLeaf('note-b');
    expect(editorBody()).toBe(NOTE_B.content);
    await clickLeaf('note-a');

    expect(editorBody()).toBe(FRESH_A);
    expect(editorBody()).not.toBe(NOTE_A.content);

    const writesBeforeReopenSave = writes().length;
    await runDebounce();
    const reopenWrites = writes().slice(writesBeforeReopenSave);
    expect(reopenWrites.some((w) => w.id === 'note-a' && w.content === NOTE_A.content)).toBe(false);
    expect(writes().filter((w) => w.id === 'note-a').every((w) => w.content === FRESH_A)).toBe(true);
    expect(editorBody()).toBe(FRESH_A);
  });

  it('patches the cached doc so the list copy matches the body that landed', async () => {
    await mountDocs();
    await clickLeaf('note-a');
    await typeContent(FRESH_A);
    await runDebounce();

    const cached = docsCache.state.docs?.items.find((item) => item.id === 'note-a');
    const shared = docsCache.state.shared?.items.find((item) => item.id === 'note-a');
    expect(cached?.content).toBe(FRESH_A);
    expect(cached?.title).toBe(NOTE_A.title);
    expect(cached?.clientWriteVersion).toBeGreaterThan(0);
    expect(shared?.content).toBe(FRESH_A);
    expect(shared?.clientWriteVersion).toBe(cached?.clientWriteVersion);
    // The hook the tree renders from is still the pre-save copy. The patch
    // has to live on the query cache, not by mutating that list.
    expect(fixtures.NOTE_A.content).toBe(CACHED_A);
  });

  it('opens a newer server row instead of the body this session wrote', async () => {
    editorHarness.emitOnMount = true;
    await mountDocs();
    await clickLeaf('note-a');
    await typeContent(FRESH_A);
    await runDebounce();

    // A refetch (or the other tab, or a collaborator) hands back a row that
    // never carries the client stamp. Its updatedAt is after our write.
    fixtures.NOTE_A.content = SERVER_A;
    fixtures.NOTE_A.updatedAt = { toMillis: () => Date.now() + 60_000 };
    await clickLeaf('note-b');
    await clickLeaf('note-a');

    expect(editorBody()).toBe(SERVER_A);
    const before = writes().length;
    await runDebounce();
    const after = writes().slice(before);
    expect(after.some((w) => w.content === FRESH_A || w.content === CACHED_A)).toBe(false);
    expect(after.some((w) => w.id === 'note-a' && w.content === SERVER_A)).toBe(true);

    // A stale list row that arrives afterwards must not put the older body back.
    fixtures.NOTE_A.content = CACHED_A;
    fixtures.NOTE_A.updatedAt = null;
    await clickLeaf('note-b');
    await clickLeaf('note-a');
    expect(editorBody()).toBe(SERVER_A);
  });

  it('prefers a later server edit when the browser clock is ahead of the server', async () => {
    // An hour ahead. A collaborator who saved five seconds after us is still
    // earlier than this clock, which is what used to make their edit lose.
    const now = vi.spyOn(Date, 'now').mockReturnValue(serverTime.ms + 3_600_000);
    try {
      await mountDocs();
      await clickLeaf('note-a');
      await typeContent(FRESH_A);
      await runDebounce();

      fixtures.NOTE_A.content = SERVER_A;
      fixtures.NOTE_A.updatedAt = { toMillis: () => serverTime.ms + 5_000 };
      await clickLeaf('note-b');
      await clickLeaf('note-a');
      expect(editorBody()).toBe(SERVER_A);
    } finally {
      now.mockRestore();
    }
  });

  it('keeps the saved body when the browser clock is behind and a stale refetch looks newer', async () => {
    // An hour behind. A row from a minute before our write is still later than
    // this clock, which is what used to make that stale body the one remembered.
    const now = vi.spyOn(Date, 'now').mockReturnValue(serverTime.ms - 3_600_000);
    try {
      editorHarness.emitOnMount = true;
      await mountDocs();
      await clickLeaf('note-a');
      await typeContent(FRESH_A);
      await runDebounce();

      fixtures.NOTE_A.content = CACHED_A;
      fixtures.NOTE_A.updatedAt = { toMillis: () => serverTime.ms - 60_000 };
      await clickLeaf('note-b');
      await clickLeaf('note-a');
      expect(editorBody()).toBe(FRESH_A);

      const before = writes().length;
      await runDebounce();
      expect(writes().slice(before).some((w) => w.content === CACHED_A)).toBe(false);
      expect(editorBody()).toBe(FRESH_A);
    } finally {
      now.mockRestore();
    }
  });

  it('uses the rename\'s server time, so a fast browser clock cannot hide a later edit', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(serverTime.ms + 3_600_000);
    try {
      await mountDocs();
      await clickLeaf('note-a');
      await typeContent(FRESH_A);
      await runDebounce();

      const trigger = container.querySelector('[aria-label="Document options"]') as HTMLElement | null;
      expect(trigger, 'document options').toBeTruthy();
      await act(async () => {
        trigger!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        trigger!.click();
      });
      await flush();
      const rename = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.trim() === 'Rename') as HTMLElement | undefined;
      expect(rename, 'Rename row').toBeTruthy();
      await act(async () => { rename!.click(); });
      await flush();
      const input = document.querySelector('input[placeholder="Name"]') as HTMLInputElement | null;
      expect(input, 'rename field').toBeTruthy();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'Renamed alpha');
      await act(async () => { input!.dispatchEvent(new Event('input', { bubbles: true })); });
      // The rename lands at a later server time than the content save.
      serverTime.ms += 2_000;
      const save = [...document.querySelectorAll('button')].find((el) => el.textContent?.trim() === 'Save');
      expect(save, 'rename save').toBeTruthy();
      await act(async () => { save!.click(); });
      await flush();

      fixtures.NOTE_A.title = 'Someone else';
      fixtures.NOTE_A.content = SERVER_A;
      fixtures.NOTE_A.updatedAt = { toMillis: () => serverTime.ms + 5_000 };
      await clickLeaf('note-b');
      await clickLeaf('note-a');
      expect(editorBody()).toBe(SERVER_A);
      expect(titleValue()).toBe('Someone else');
    } finally {
      now.mockRestore();
    }
  });
});

describe('AdminDocs — a save error stays on the note that failed', () => {
  it('does not show note A\'s autosave error or saving state while note B is open', async () => {
    await mountDocs();
    await clickLeaf('note-a');
    const pending = deferred();
    updateDoc.mockImplementation(() => pending.promise);

    await typeContent(DRAFT_A);
    await clickLeaf('note-b');
    expect(editorBody()).toBe(NOTE_B.content);
    expect(statusChip()).toBe('');
    expect(toast.error).not.toHaveBeenCalled();

    await act(async () => {
      pending.reject(new Error('offline'));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(editorBody()).toBe(NOTE_B.content);
    expect(statusChip()).toBe('');
    expect(container.textContent ?? '').not.toContain('Not saved');
    const away = toast.error.mock.calls.at(-1) as [string, { action?: { label: string } }] | undefined;
    expect(away?.[0]).toContain('Alpha note');
    expect(away?.[1].action?.label).toBe('Retry');
  });

  it('shows that error, and the unsaved body, when note A is opened again', async () => {
    await mountDocs();
    await clickLeaf('note-a');
    const pending = deferred();
    updateDoc.mockImplementation(() => pending.promise);

    await typeContent(DRAFT_A);
    await clickLeaf('note-b');
    await act(async () => {
      pending.reject(new Error('offline'));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(toast.error).toHaveBeenCalledTimes(1);
    await clickLeaf('note-a');
    expect(editorBody()).toBe(DRAFT_A);
    expect(statusChip()).toBe('Not saved');
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('retries the save of the note that failed after it was left', async () => {
    await mountDocs();
    await clickLeaf('note-a');
    updateDoc.mockRejectedValueOnce(new Error('offline'));
    await typeContent(DRAFT_A);
    await clickLeaf('note-b');

    const away = toast.error.mock.calls.at(-1) as [string, { action?: { onClick: () => void } }];
    expect(away[0]).toContain('Alpha note');
    updateDoc.mockResolvedValue(undefined);
    await act(async () => { away[1].action?.onClick(); });
    await flush();

    expect(editorBody()).toBe(NOTE_B.content);
    expect(statusChip()).toBe('');
    expect(writes().at(-1)).toMatchObject({ id: 'note-a', content: DRAFT_A });
    expect(toast.dismiss).toHaveBeenCalledWith('doc-save-error');

    await clickLeaf('note-a');
    expect(editorBody()).toBe(DRAFT_A);
    expect(statusChip()).toBe('Saved');
  });

  it('does not retry a payload once a newer save of that note has started', async () => {
    await mountDocs();
    await clickLeaf('note-a');
    updateDoc.mockRejectedValueOnce(new Error('offline'));
    await typeContent(DRAFT_A);
    await clickLeaf('note-b');
    const retry = (toast.error.mock.calls.at(-1) as [string, { action: { onClick: () => void } }])[1].action.onClick;

    const pending = deferred();
    updateDoc.mockImplementation(() => pending.promise);
    await clickLeaf('note-a');
    await typeContent(SECOND_A);
    await runDebounce();
    const calls = updateDoc.mock.calls.length;
    await act(async () => { retry(); });
    await flush();
    expect(updateDoc.mock.calls.length).toBe(calls);
    expect(toast.dismiss).toHaveBeenCalledWith('doc-save-error');
    pending.resolve();
    await flush();
  });

  it('does not retry over a server row newer than the last write this session read back', async () => {
    serverTime.ms = 5_000_000;
    await mountDocs();
    await clickLeaf('note-a');
    await typeContent(FRESH_A);
    await runDebounce();

    updateDoc.mockRejectedValueOnce(new Error('offline'));
    await typeContent(DRAFT_A);
    await clickLeaf('note-b');
    const retry = (toast.error.mock.calls.at(-1) as [string, { action: { onClick: () => void } }])[1].action.onClick;

    // The list the screen is holding is still the pre-save copy. The fresh
    // read is a later row. Retry used to trust the list.
    expect(fixtures.NOTE_A.updatedAt).toBeNull();
    freshRead.ms = 5_000_000 + 10_000;
    freshRead.content = SERVER_A;
    freshRead.title = 'Alpha note';
    const calls = updateDoc.mock.calls.length;
    await act(async () => { retry(); });
    await flush();
    expect(updateDoc.mock.calls.length).toBe(calls);
    expect(toast.dismiss).toHaveBeenCalledWith('doc-save-error');
    expect(writes().filter((w) => w.content === DRAFT_A)).toHaveLength(1);
  });

  it('does not retry a first save over a server row the list has not caught up to', async () => {
    await mountDocs();
    await clickLeaf('note-a');
    updateDoc.mockRejectedValueOnce(new Error('offline'));
    await typeContent(DRAFT_A);
    await clickLeaf('note-b');
    const retry = (toast.error.mock.calls.at(-1) as [string, { action: { onClick: () => void } }])[1].action.onClick;

    expect(fixtures.NOTE_A.updatedAt).toBeNull();
    freshRead.ms = 9_000_000;
    freshRead.content = SERVER_A;
    freshRead.title = 'Someone else';
    const calls = updateDoc.mock.calls.length;
    await act(async () => { retry(); });
    await flush();
    expect(updateDoc.mock.calls.length).toBe(calls);
    expect(toast.dismiss).toHaveBeenCalledWith('doc-save-error');
    expect(writes().filter((w) => w.content === DRAFT_A)).toHaveLength(1);
  });

  it('does not retry when the fresh read fails', async () => {
    await mountDocs();
    await clickLeaf('note-a');
    updateDoc.mockRejectedValueOnce(new Error('offline'));
    await typeContent(DRAFT_A);
    await clickLeaf('note-b');
    const retry = (toast.error.mock.calls.at(-1) as [string, { action: { onClick: () => void } }])[1].action.onClick;

    freshRead.fail = true;
    const calls = updateDoc.mock.calls.length;
    await act(async () => { retry(); });
    await flush();
    expect(updateDoc.mock.calls.length).toBe(calls);
    expect(toast.dismiss).not.toHaveBeenCalled();
  });

  it('does not mark note B saved when note A\'s autosave lands', async () => {
    await mountDocs();
    await clickLeaf('note-a');
    const pending = deferred();
    updateDoc.mockImplementation(() => pending.promise);

    await typeContent(DRAFT_A);
    await clickLeaf('note-b');
    expect(statusChip()).toBe('');

    await act(async () => {
      pending.resolve();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(editorBody()).toBe(NOTE_B.content);
    expect(statusChip()).toBe('');
    expect(container.textContent ?? '').not.toContain('Saved');

    await clickLeaf('note-a');
    expect(editorBody()).toBe(DRAFT_A);
    expect(statusChip()).toBe('Saved');
  });

  it('ignores a late failure from an older save after a newer one succeeded', async () => {
    await mountDocs();
    await clickLeaf('note-a');
    const inFlight: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
    updateDoc.mockImplementation(() => {
      const pending = deferred();
      inFlight.push(pending);
      return pending.promise;
    });

    await typeContent(FIRST_A);
    await runDebounce();
    await typeContent(SECOND_A);
    await runDebounce();
    expect(inFlight).toHaveLength(2);

    await act(async () => {
      inFlight[1].resolve();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    await act(async () => {
      inFlight[0].reject(new Error('stale response'));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(statusChip()).toBe('Saved');
    expect(statusChip()).not.toBe('Not saved');
    expect(toast.error).not.toHaveBeenCalled();
    expect(editorBody()).toBe(SECOND_A);

    await clickLeaf('note-b');
    await typeContent(FRESH_B);
    await runDebounce();
    await clickLeaf('note-a');
    expect(editorBody()).toBe(SECOND_A);
    expect(writes().filter((w) => w.id === 'note-a').every((w) => w.content === FIRST_A || w.content === SECOND_A)).toBe(true);
    expect(writes().at(-1)).toMatchObject({ id: 'note-b', content: FRESH_B });
  });

  it('still toasts when the failing save belongs to the note on screen', async () => {
    await mountDocs();
    await clickLeaf('note-a');
    updateDoc.mockRejectedValue(new Error('offline'));
    await typeContent(DRAFT_A);
    await runDebounce();

    expect(statusChip()).toBe('Not saved');
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('Could not save this note'),
      expect.objectContaining({ id: 'doc-save-error' }),
    );
    expect(editorBody()).toBe(DRAFT_A);
  });
});

describe('AdminDocs — a flush that fails while switching stays on the note that was left', () => {
  async function leaveAlphaWithFailingDraft() {
    await clickLeaf('note-a');
    updateDoc.mockRejectedValue(new Error('offline'));
    await typeContent(DRAFT_A);
  }

  function expectFailureStayedOnAlpha(destination: { body: string; title: string }) {
    expect(editorBody()).toBe(destination.body);
    expect(titleValue()).toBe(destination.title);
    expect(statusChip()).toBe('');
    expect(container.textContent ?? '').not.toContain('Not saved');
    const away = toast.error.mock.calls.at(-1) as [string, { id?: string; action?: { label: string } }];
    expect(away?.[0]).toContain('Alpha note');
    expect(away?.[1]?.id).toBe('doc-save-error');
    expect(away?.[1]?.action?.label).toBe('Retry');
    expect(writes().some((w) => w.id === 'note-a' && w.content === DRAFT_A)).toBe(true);
    expect(writes().some((w) => w.id !== 'note-a' && w.content === DRAFT_A)).toBe(false);
  }

  it('does not attribute the failure to the note opened from the quick switcher', async () => {
    await mountDocs();
    await leaveAlphaWithFailingDraft();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
    });
    await flush();
    const item = document.querySelector('[data-switcher-doc-id="note-b"]') as HTMLElement | null;
    expect(item, 'switcher row for note B').toBeTruthy();
    await act(async () => { item!.click(); });
    await flush();
    expectFailureStayedOnAlpha({ body: NOTE_B.content, title: NOTE_B.title });
  });

  it('does not attribute the failure to the note opened from a deep link', async () => {
    await mountDocs();
    await leaveAlphaWithFailingDraft();
    await act(async () => { root.render(<AdminDocs initialDocId="note-b" />); });
    await flush();
    expectFailureStayedOnAlpha({ body: NOTE_B.content, title: NOTE_B.title });
  });

  it('does not attribute the failure to a new note', async () => {
    await mountDocs();
    await leaveAlphaWithFailingDraft();
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'New doc');
    expect(button, 'New doc control').toBeTruthy();
    await act(async () => { button!.click(); });
    await flush();
    expectFailureStayedOnAlpha({ body: '', title: 'Untitled' });
  });

  it('does not attribute the failure to an imported note', async () => {
    await mountDocs();
    await leaveAlphaWithFailingDraft();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(input, 'markdown file input').toBeTruthy();
    const file = new File(['# from-file'], 'sermon.md', { type: 'text/markdown' });
    Object.defineProperty(input!, 'files', { configurable: true, value: [file] });
    await act(async () => { input!.dispatchEvent(new Event('change', { bubbles: true })); });
    await flush();
    expectFailureStayedOnAlpha({ body: '# from-file', title: 'Imported' });
  });
});

describe('AdminDocs — a late read-back cannot replace a newer save', () => {
  it('keeps the later body when the earlier acknowledgement resolves last', async () => {
    ackBridge.state.hold = true;
    await mountDocs();
    await clickLeaf('note-a');
    await typeContent(FIRST_A);
    await runDebounce();
    await typeContent(SECOND_A);
    await runDebounce();
    expect(ackBridge.writes.map((w) => w.content)).toEqual([FIRST_A, SECOND_A]);

    await releaseAck(1);
    const afterSecond = docsCache.state.docs?.items.find((item) => item.id === 'note-a');
    expect(afterSecond?.content).toBe(SECOND_A);
    expect(afterSecond?.clientWriteVersion).toBe(2);

    await releaseAck(0);
    const afterFirst = docsCache.state.docs?.items.find((item) => item.id === 'note-a');
    expect(afterFirst?.content).toBe(SECOND_A);
    expect(afterFirst?.clientWriteVersion).toBe(afterSecond?.clientWriteVersion);
    expect(statusChip()).toBe('Saved');

    await clickLeaf('note-b');
    await clickLeaf('note-a');
    expect(editorBody()).toBe(SECOND_A);

    const before = writes().length;
    await runDebounce();
    expect(writes().slice(before).some((w) => w.content === FIRST_A)).toBe(false);
    expect(editorBody()).toBe(SECOND_A);
  });
});

describe('AdminDocs — a read-back with no server time forgets the session copy', () => {
  async function saveThenAdoptServerRow() {
    await mountDocs();
    await clickLeaf('note-a');
    await typeContent(FRESH_A);
    await runDebounce();
    expect(writes().some((w) => w.content === FRESH_A)).toBe(true);

    fixtures.NOTE_A.content = SERVER_A;
    fixtures.NOTE_A.updatedAt = { toMillis: () => 1 };
    await clickLeaf('note-b');
    await clickLeaf('note-a');
    expect(editorBody()).toBe(SERVER_A);

    const before = writes().length;
    await runDebounce();
    expect(writes().slice(before).some((w) => w.content === FRESH_A)).toBe(false);
  }

  it('lets the server row win when the acknowledgement has no timestamp', async () => {
    ackBridge.state.mode = 'null';
    await saveThenAdoptServerRow();
  });

  it('lets the server row win when the acknowledgement listener fails', async () => {
    ackBridge.state.mode = 'error';
    await saveThenAdoptServerRow();
  });
});

describe('AdminDocs — a collaborator between the write and its acknowledgement', () => {
  it('remembers our commit time, so their later row is not treated as ours', async () => {
    ackBridge.state.hold = true;
    ackBridge.state.poisonReads = true;
    await mountDocs();
    await clickLeaf('note-a');
    await typeContent(FRESH_A);
    await runDebounce();
    expect(ackBridge.writes[0]).toMatchObject({ content: FRESH_A, ms: 5_000_000 });

    // The follow-up read now sees the collaborator. The acknowledgement,
    // released next, is still our write at 5_000_000.
    await releaseAck(0);

    fixtures.NOTE_A.content = OTHER_A;
    fixtures.NOTE_A.updatedAt = { toMillis: () => 5_000_000 };
    await clickLeaf('note-b');
    await clickLeaf('note-a');
    expect(editorBody()).toBe(FRESH_A);

    fixtures.NOTE_A.updatedAt = { toMillis: () => 5_008_000 };
    await clickLeaf('note-b');
    await clickLeaf('note-a');
    expect(editorBody()).toBe(OTHER_A);
  });
});

/**
 * The acknowledgement listener used to wait forever. `runDebounce` advances
 * 100ms past the 2s debounce, which would move the fake clock off the
 * timeout boundary, so these tests fire the debounce at exactly 2s.
 */
const SAVE_ACK_TIMEOUT_MS = 10_000;

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
}

async function fireDebounce() {
  await advance(2_000);
}

describe('AdminDocs — the save acknowledgement listener times out', () => {
  it('resolves with no time after 10s, clears Saving, and ignores a late snapshot', async () => {
    ackBridge.state.hold = true;
    await mountDocs();
    await clickLeaf('note-a');
    await typeContent(FRESH_A);
    await fireDebounce();

    expect(statusChip()).toBe('Saving…');
    expect(ackBridge.listeners).toHaveLength(1);
    expect(ackBridge.state.unsubscribed).toEqual([]);
    // The snapshot the timeout is about to drop is delivered from unsubscribe
    // itself, the way a listener callback already in flight still runs.
    ackBridge.state.deliverOnUnsub = true;

    await advance(SAVE_ACK_TIMEOUT_MS - 1);
    expect(statusChip()).toBe('Saving…');
    expect(ackBridge.state.unsubscribed).toEqual([]);

    await advance(1);
    expect(statusChip()).toBe('Saved');
    expect(statusChip()).not.toContain('Saving');
    expect(ackBridge.state.unsubscribed).toEqual([0]);

    const cached = docsCache.state.docs?.items.find((item) => item.id === 'note-a');
    expect(cached?.content).toBe(CACHED_A);
    expect(cached?.clientWriteVersion).toBeUndefined();

    // The snapshot that would have been this commit's acknowledgement, arriving
    // after the listener was dropped. It must not put the session body back.
    await releaseAck(0);
    expect(ackBridge.state.unsubscribed).toEqual([0]);
    expect(docsCache.state.docs?.items.find((item) => item.id === 'note-a')?.content).toBe(CACHED_A);

    fixtures.NOTE_A.content = SERVER_A;
    fixtures.NOTE_A.updatedAt = { toMillis: () => 1 };
    await clickLeaf('note-b');
    await clickLeaf('note-a');
    expect(editorBody()).toBe(SERVER_A);

    const before = writes().length;
    await runDebounce();
    expect(writes().slice(before).some((w) => w.content === FRESH_A)).toBe(false);
  });

  it('still records an acknowledgement that arrives before the timeout', async () => {
    ackBridge.state.hold = true;
    await mountDocs();
    await clickLeaf('note-a');
    await typeContent(FRESH_A);
    await fireDebounce();
    expect(statusChip()).toBe('Saving…');

    await advance(SAVE_ACK_TIMEOUT_MS - 1);
    expect(statusChip()).toBe('Saving…');
    expect(ackBridge.state.unsubscribed).toEqual([]);

    await releaseAck(0);
    expect(statusChip()).toBe('Saved');
    expect(ackBridge.state.unsubscribed).toEqual([0]);
    const cached = docsCache.state.docs?.items.find((item) => item.id === 'note-a');
    expect(cached?.content).toBe(FRESH_A);
    expect(cached?.clientWriteVersion).toBeGreaterThan(0);

    // The deadline passing afterwards must not drop the time we already stored,
    // and must not subscribe a second listener to do it.
    await advance(SAVE_ACK_TIMEOUT_MS);
    expect(statusChip()).toBe('Saved');
    expect(ackBridge.state.unsubscribed).toEqual([0]);
    expect(ackBridge.listeners).toHaveLength(1);

    fixtures.NOTE_A.content = SERVER_A;
    fixtures.NOTE_A.updatedAt = { toMillis: () => 5_000_000 };
    await clickLeaf('note-b');
    await clickLeaf('note-a');
    expect(editorBody()).toBe(FRESH_A);
  });
});
