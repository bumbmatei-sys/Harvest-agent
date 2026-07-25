import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import CanvasEditor from '../CanvasEditor';

/**
 * THE-33 — CanvasEditor must not lose a drawing silently. Two distinct paths:
 *
 *   A. the Back button awaited the final PUT but called `onBack()` in the catch too,
 *      so a failed save navigated away exactly like a successful one — the drawing
 *      only ever existed in the Excalidraw scene, so it was gone;
 *   B. the cleanup effect cleared the pending debounce timer WITHOUT flushing it, so
 *      any exit that wasn't the Back button dropped everything drawn since the last
 *      debounce fired.
 *
 * A third, quieter path fell out of the same code: the debounced save advanced
 * `lastSavedElements` BEFORE the PUT, so a failed auto-save left the component
 * believing the work was saved and every later exit check found "nothing to save".
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── Excalidraw stub ──────────────────────────────────────────────────────────
// Stands in for the dynamically imported editor: hands the component an API object
// whose scene the test controls, and captures onChange so the debounce can be driven.
const harness = vi.hoisted(() => ({
  scene: [] as unknown[],
  onChange: null as null | ((els: unknown[]) => void),
  updateScene: vi.fn(),
  apiHandedOver: false,
}));

vi.mock('next/dynamic', () => ({
  default: () =>
    function ExcalidrawStub(props: any) {
      if (!harness.apiHandedOver) {
        harness.apiHandedOver = true;
        props.excalidrawAPI({
          getSceneElements: () => harness.scene,
          updateScene: harness.updateScene,
        });
      }
      harness.onChange = props.onChange;
      return null;
    },
}));
vi.mock('@excalidraw/excalidraw/index.css', () => ({}));

const authFetch = vi.hoisted(() => vi.fn());
const notifyError = vi.hoisted(() => vi.fn());
vi.mock('../../utils/auth-fetch', () => ({ authFetch }));
vi.mock('../../utils/notify', () => ({ notifyError }));
vi.mock('../../utils/tenant-scope', () => ({ getTenantScope: async () => 'tenant-1' }));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: null } }));
vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  onSnapshot: () => () => {},
}));

/** Every PUT the component issued, in order. */
const puts = () =>
  authFetch.mock.calls
    .filter(([, opts]) => opts?.method === 'PUT')
    .map(([url, opts]) => ({ url, elements: JSON.parse(opts.body).elements }));

let container: HTMLDivElement;
let root: Root;
let mounted = false;
const onBack = vi.fn();

/**
 * Unmount and flush the teardown. Every test must end unmounted: the component keeps
 * a `beforeunload` listener on the shared window, so a root left alive would answer
 * the next test's dispatch too.
 */
async function unmountEditor() {
  if (!mounted) return;
  mounted = false;
  await act(async () => { root.unmount(); await Promise.resolve(); await Promise.resolve(); });
}

async function mountEditor() {
  await act(async () => {
    root = createRoot(container);
    root.render(<CanvasEditor canvasId="canvas-1" canvasName="My Canvas" onBack={onBack} />);
  });
  mounted = true;
  // Flush getTenantScope + the load fetch so `loading` clears and Excalidraw renders.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

/** Draw something: push it into the scene and fire Excalidraw's onChange. */
function draw(elements: unknown[]) {
  harness.scene = elements;
  act(() => { harness.onChange?.(elements); });
}

/** Let the 1.5s auto-save debounce fire and settle. */
async function runDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(1600);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
}

function clickBack() {
  const backButton = [...container.querySelectorAll('button')]
    .find(b => b.textContent?.includes('Back'))!;
  return act(async () => { backButton.click(); await Promise.resolve(); await Promise.resolve(); });
}

const statusChip = () => container.textContent || '';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  harness.scene = [];
  harness.onChange = null;
  harness.apiHandedOver = false;
  // Default: the initial load succeeds with an empty canvas; every PUT succeeds.
  authFetch.mockImplementation(async (_url: string, opts?: any) =>
    opts?.method === 'PUT'
      ? { ok: true }
      : { ok: true, json: async () => ({ elements: [] }) },
  );
});

afterEach(async () => {
  await unmountEditor();
  vi.useRealTimers();
  container.remove();
});

describe('CanvasEditor — Path A: the Back button must not swallow a failed save', () => {
  it('does NOT navigate away when the final save fails, and tells the user', async () => {
    await mountEditor();
    draw([{ id: 'rect-1' }]);

    authFetch.mockImplementation(async (_url: string, opts?: any) => {
      if (opts?.method === 'PUT') throw new Error('Network down');
      return { ok: true, json: async () => ({ elements: [] }) };
    });

    await clickBack();

    // The whole point: the user is still in the editor, with their drawing.
    expect(onBack).not.toHaveBeenCalled();
    // ...and they are actually told, the way other admin screens report a failed save.
    expect(notifyError).toHaveBeenCalledWith('Failed to save canvas', expect.any(Error));
    expect(statusChip()).toContain('Error');
  });

  it('treats a non-ok response as a failure too, not just a thrown fetch', async () => {
    await mountEditor();
    draw([{ id: 'rect-1' }]);

    authFetch.mockImplementation(async (_url: string, opts?: any) =>
      opts?.method === 'PUT' ? { ok: false, status: 500 } : { ok: true, json: async () => ({ elements: [] }) },
    );

    await clickBack();

    expect(onBack).not.toHaveBeenCalled();
    expect(notifyError).toHaveBeenCalled();
  });

  it('navigates as before when the final save succeeds', async () => {
    await mountEditor();
    draw([{ id: 'rect-1' }]);

    await clickBack();

    expect(puts()).toEqual([{ url: '/api/canvas/canvas-1', elements: [{ id: 'rect-1' }] }]);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('navigates without writing anything when there is nothing unsaved', async () => {
    await mountEditor();

    await clickBack();

    expect(puts()).toHaveLength(0);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('lets the user retry: a second Back after a failure saves and leaves', async () => {
    await mountEditor();
    draw([{ id: 'rect-1' }]);

    authFetch.mockImplementationOnce(async () => { throw new Error('Network down'); });
    await clickBack();
    expect(onBack).not.toHaveBeenCalled();

    await clickBack();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(puts()).toHaveLength(2); // the failed attempt, then the successful retry
  });

  it('a failed AUTO-save leaves the work marked unsaved, so Back still writes it', async () => {
    await mountEditor();
    draw([{ id: 'rect-1' }]);

    authFetch.mockImplementationOnce(async () => { throw new Error('Network down'); });
    await runDebounce();
    expect(statusChip()).toContain('Error');

    // The old code advanced `lastSavedElements` before the PUT, so this Back found
    // "nothing to save" and left the drawing behind.
    await clickBack();
    expect(puts()).toHaveLength(2);
    expect(puts()[1].elements).toEqual([{ id: 'rect-1' }]);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('CanvasEditor — Path B: unmount must not drop the pending save', () => {
  it('flushes the pending debounced change when the editor is unmounted another way', async () => {
    await mountEditor();
    draw([{ id: 'rect-1' }]); // debounce armed, 1.5s not yet elapsed

    // Browser back / in-app route change / parent clearing canvasId — no handleBack.
    await unmountEditor();

    expect(puts()).toEqual([{ url: '/api/canvas/canvas-1', elements: [{ id: 'rect-1' }] }]);
  });

  it('the flush is a real request that outlives the component — it settles after unmount', async () => {
    let resolvePut: (v: unknown) => void = () => {};
    authFetch.mockImplementation(async (_url: string, opts?: any) => {
      if (opts?.method !== 'PUT') return { ok: true, json: async () => ({ elements: [] }) };
      return new Promise((r) => { resolvePut = r; });
    });

    await mountEditor();
    draw([{ id: 'rect-1' }]);
    await unmountEditor();

    // Issued during teardown and still in flight afterwards: nothing aborts it, which
    // is exactly why an in-app unmount flush lands.
    expect(puts()).toHaveLength(1);
    await act(async () => { resolvePut({ ok: true }); await Promise.resolve(); });
  });

  it('does NOT double-write: a successful Back leaves the unmount flush nothing to do', async () => {
    await mountEditor();
    draw([{ id: 'rect-1' }]);

    await clickBack();
    expect(onBack).toHaveBeenCalledTimes(1);

    // onBack is what unmounts the editor in AdminDashboard.
    await unmountEditor();

    expect(puts()).toHaveLength(1);
  });

  it('does NOT double-write when a debounced save for the same content is already in flight', async () => {
    let resolvePut: (v: unknown) => void = () => {};
    authFetch.mockImplementation(async (_url: string, opts?: any) => {
      if (opts?.method !== 'PUT') return { ok: true, json: async () => ({ elements: [] }) };
      return new Promise((r) => { resolvePut = r; });
    });

    await mountEditor();
    draw([{ id: 'rect-1' }]);
    await runDebounce();              // debounce fired; PUT hanging
    expect(puts()).toHaveLength(1);

    await unmountEditor();

    expect(puts()).toHaveLength(1);   // the in-flight write already carries this scene
    await act(async () => { resolvePut({ ok: true }); await Promise.resolve(); });
  });

  it('flushes NEWER content drawn after a debounced save went out, ordered behind it', async () => {
    const seen: unknown[][] = [];
    const gates: Array<(v: unknown) => void> = [];
    authFetch.mockImplementation(async (_url: string, opts?: any) => {
      if (opts?.method !== 'PUT') return { ok: true, json: async () => ({ elements: [] }) };
      seen.push(JSON.parse(opts.body).elements);
      return new Promise((r) => gates.push(r));
    });

    await mountEditor();
    draw([{ id: 'rect-1' }]);
    await runDebounce();                 // PUT #1 (rect-1) in flight
    draw([{ id: 'rect-1' }, { id: 'rect-2' }]); // more drawing, debounce re-armed

    await unmountEditor();

    // The flush is chained behind the in-flight save rather than racing it, so the
    // newer scene can never be overwritten by the older one.
    expect(seen).toHaveLength(1);
    await act(async () => { gates[0]({ ok: true }); await Promise.resolve(); await Promise.resolve(); });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual([{ id: 'rect-1' }, { id: 'rect-2' }]);
    await act(async () => { gates[1]?.({ ok: true }); await Promise.resolve(); });
  });

  it('writes nothing on unmount when everything is already saved', async () => {
    await mountEditor();
    draw([{ id: 'rect-1' }]);
    await runDebounce();
    expect(puts()).toHaveLength(1);

    await unmountEditor();

    expect(puts()).toHaveLength(1);
  });
});

describe('CanvasEditor — Path B: tab close is warned about, not silently lost', () => {
  const fireBeforeUnload = () => {
    const e = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(e);
    return e;
  };

  it('warns before unload while there are unsaved changes', async () => {
    await mountEditor();
    draw([{ id: 'rect-1' }]);

    expect(fireBeforeUnload().defaultPrevented).toBe(true);
  });

  it('does not warn once the work is saved', async () => {
    await mountEditor();
    draw([{ id: 'rect-1' }]);
    await runDebounce();

    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });

  it('still warns while a save is in flight — an in-flight write dies with the page', async () => {
    authFetch.mockImplementation(async (_url: string, opts?: any) =>
      opts?.method === 'PUT'
        ? new Promise(() => {})               // never settles
        : { ok: true, json: async () => ({ elements: [] }) },
    );

    await mountEditor();
    draw([{ id: 'rect-1' }]);
    await runDebounce();

    expect(fireBeforeUnload().defaultPrevented).toBe(true);
  });

  it('stops warning after the editor is gone', async () => {
    await mountEditor();
    draw([{ id: 'rect-1' }]);
    await unmountEditor();

    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });
});
