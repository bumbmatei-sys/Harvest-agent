"use client";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Check, Loader2, AlertCircle } from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { authFetch } from '../utils/auth-fetch';
import { getTenantScope } from '../utils/tenant-scope';
import { notifyError } from '../utils/notify';
import dynamic from 'next/dynamic';
// @excalidraw/excalidraw 0.18 exposes subpath types as "./*" -> dist/types/excalidraw/*.d.ts,
// so the old "types/types" entry point no longer resolves. ExcalidrawElement now lives here.
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';

// Import Excalidraw CSS — CRITICAL: without this, the toolbar renders as raw unstyled elements
import '@excalidraw/excalidraw/index.css';

const Excalidraw = dynamic(
  () => import('@excalidraw/excalidraw').then(mod => ({ default: mod.Excalidraw })),
  { ssr: false }
);

interface CanvasEditorProps {
  canvasId: string;
  canvasName: string;
  onBack: () => void;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const CanvasEditor: React.FC<CanvasEditorProps> = ({ canvasId, canvasName: initialName, onBack }) => {
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [initialElements, setInitialElements] = useState<readonly ExcalidrawElement[]>([]);
  const excalidrawAPI = useRef<any>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Content the SERVER has confirmed. Only ever advanced by a PUT that came back ok —
  // it is the guard every exit path uses to decide "is there unsaved work here?", so
  // an optimistic advance would make a failed save look saved and lose the work.
  const lastSavedElements = useRef<string>('');
  // Payload of the write currently in flight. Purely the echo guard for the Firestore
  // listener below: our own write comes back as a snapshot, and without this it would
  // land while `lastSavedElements` is still the pre-write value and pointlessly
  // replace the live scene mid-edit.
  const inFlightElements = useRef<string>('');
  // Serializes every writer (debounce, back button, unmount flush) so a later write
  // can never overtake an earlier one and put stale content on top of newer content.
  const saveChain = useRef<Promise<void> | null>(null);
  const isMounted = useRef(true);
  const tenantIdRef = useRef<string | null>(null);
  // The unmount cleanup runs with `[]`-style deps and must not close over a stale
  // prop, so the id it writes to is read from here.
  const canvasIdRef = useRef(canvasId);
  useEffect(() => { canvasIdRef.current = canvasId; }, [canvasId]);

  /**
   * The single writer for the canvas. Advances `lastSavedElements` only after the
   * server accepts the write, and chains onto whatever save is already running so
   * two writers can never race. Rejects on failure — callers decide what the user
   * is told.
   */
  const persist = useCallback((elements: readonly ExcalidrawElement[], serialized: string): Promise<void> => {
    const run = async () => {
      inFlightElements.current = serialized;
      try {
        const resp = await authFetch(`/api/canvas/${canvasIdRef.current}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ elements }),
        });
        if (!resp.ok) throw new Error('Save failed');
        lastSavedElements.current = serialized;
      } finally {
        if (inFlightElements.current === serialized) inFlightElements.current = '';
      }
    };
    // A previous failure must not cancel this write, and the chain has to survive it.
    const chained = (saveChain.current ?? Promise.resolve()).catch(() => {}).then(run);
    saveChain.current = chained.catch(() => {});
    return chained;
  }, []);

  // Load canvas data
  useEffect(() => {
    isMounted.current = true;
    let cancelled = false;

    const load = async () => {
      try {
        const tenantId = await getTenantScope();
        if (cancelled) return;
        tenantIdRef.current = tenantId;

        const resp = await authFetch(`/api/canvas/${canvasId}`);
        if (!resp.ok) throw new Error('Failed to load canvas');
        const data = await resp.json();
        if (cancelled) return;

        const elements = data.elements || [];
        lastSavedElements.current = JSON.stringify(elements);
        setInitialElements(elements);
      } catch (e) {
        console.error('Failed to load canvas:', e);
        if (!cancelled) setError('Failed to load canvas');
      }
      if (!cancelled) setLoading(false);
    };

    load();
    return () => { cancelled = true; isMounted.current = false; };
  }, [canvasId]);

  // Real-time sync via Firestore
  useEffect(() => {
    let unsub: (() => void) | undefined;
    let checkInterval: ReturnType<typeof setInterval> | undefined;

    const init = async () => {
      const tenantId = tenantIdRef.current || await getTenantScope();
      if (!tenantId || !isMounted.current) return;
      tenantIdRef.current = tenantId;

      const canvasRef = doc(db, 'tenants', tenantId, 'canvases', canvasId);
      unsub = onSnapshot(canvasRef, (snapshot) => {
        if (!snapshot.exists() || !isMounted.current) return;
        const data = snapshot.data();
        const remoteElements = data.elements || [];
        const remoteSerialized = JSON.stringify(remoteElements);

        // Ignore the echo of our own write, whether it has been confirmed
        // (`lastSavedElements`) or is still in flight (`inFlightElements`).
        if (
          remoteSerialized !== lastSavedElements.current &&
          remoteSerialized !== inFlightElements.current &&
          excalidrawAPI.current
        ) {
          excalidrawAPI.current.updateScene({ elements: remoteElements });
        }
      }, (err) => {
        console.error('Real-time sync error:', err);
      });
    };

    if (tenantIdRef.current) {
      init();
    } else {
      checkInterval = setInterval(() => {
        if (tenantIdRef.current) {
          if (checkInterval) clearInterval(checkInterval);
          checkInterval = undefined;
          init();
        }
      }, 100);
    }

    return () => {
      if (checkInterval) clearInterval(checkInterval);
      if (unsub) unsub();
    };
  }, [canvasId]);

  // Debounced auto-save
  const handleChange = useCallback((elements: readonly ExcalidrawElement[]) => {
    if (!isMounted.current) return;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (!isMounted.current) return;
      const serialized = JSON.stringify(elements);
      if (serialized === lastSavedElements.current) return;
      setSaveStatus('saving');
      persist(elements, serialized).then(() => {
        if (isMounted.current) {
          setSaveStatus('saved');
          setTimeout(() => { if (isMounted.current) setSaveStatus('idle'); }, 2000);
        }
      }).catch((e) => {
        // `lastSavedElements` was NOT advanced, so the drawing still counts as
        // unsaved: the back button and the unmount flush will both retry it.
        console.error('Auto-save failed:', e);
        if (isMounted.current) setSaveStatus('error');
      });
    }, 1500);
  }, [persist]);

  // Cleanup — flush whatever the debounce never got to write.
  //
  // Ordering: `isMounted.current = false` stays first because the debounce callback,
  // the snapshot handler and the status timers all key off it. Everything added after
  // it therefore uses refs only and never calls setState.
  //
  // Why this flush actually lands: it is a plain fetch, and a fetch belongs to the
  // browser, not to React. Unmounting does not abort a request that has been issued
  // (nothing here wires an AbortController), so for every in-app exit — a router
  // navigation, AdminDashboard clearing `canvasId`, a parent unmounting the editor —
  // the document is still alive and the PUT completes normally. What it does NOT
  // survive is the page itself going away (tab close, hard navigation), which
  // cancels in-flight requests: `keepalive` is not a fix there because it caps the
  // body at 64KB and a real canvas exceeds that, and `navigator.sendBeacon` cannot
  // carry the Bearer token `authFetch` attaches. That case is handled honestly by
  // the beforeunload guard below — a warning rather than a write that quietly
  // doesn't run.
  useEffect(() => {
    return () => {
      isMounted.current = false;
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }

      const api = excalidrawAPI.current;
      if (!api) return;
      let elements: readonly ExcalidrawElement[];
      try {
        elements = api.getSceneElements();
      } catch {
        return; // Excalidraw already torn down — nothing left to read
      }
      const serialized = JSON.stringify(elements);
      // No double write: a successful handleBack already advanced
      // `lastSavedElements`, so the back-button exit arrives here with nothing to do,
      // and a debounced save still in flight is carrying this exact payload already.
      if (serialized === lastSavedElements.current || serialized === inFlightElements.current) return;
      persist(elements, serialized).catch((e) => {
        console.error('Canvas flush on unmount failed:', e);
      });
    };
  }, [persist]);

  // Tab close / hard navigation. The unmount flush cannot help here — the document is
  // being destroyed, which kills the request with it — so warn instead of pretending
  // to save. The browser's own "Leave site?" prompt gives the user the chance to stay
  // and let the debounce land.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const api = excalidrawAPI.current;
      if (!api) return;
      let serialized: string;
      try {
        serialized = JSON.stringify(api.getSceneElements());
      } catch {
        return;
      }
      // Deliberately not excused by `inFlightElements`: an in-flight write dies with
      // the page too, so pending content is still unsaved content.
      if (serialized === lastSavedElements.current) return;
      e.preventDefault();
      e.returnValue = ''; // Chrome/Safari only show the prompt when this is set
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Back button handler — flush pending changes before exiting. Navigating away is
  // conditional on that flush succeeding: leaving on a failed save is what silently
  // destroyed the drawing.
  const handleBack = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (excalidrawAPI.current) {
      const elements = excalidrawAPI.current.getSceneElements();
      const serialized = JSON.stringify(elements);
      if (serialized !== lastSavedElements.current) {
        setSaveStatus('saving');
        try {
          await persist(elements, serialized);
        } catch (e) {
          // Stay put. The drawing only exists in this component's Excalidraw scene,
          // so navigating now would throw it away with nothing but a console line to
          // show for it. Report it the way every other admin screen reports a failed
          // save (notifyError → window.alert, as AdminFundraising/AdminEvents/AdminCRM
          // do), leave the toolbar on "Error", and let Back be pressed again to retry.
          setSaveStatus('error');
          notifyError('Failed to save canvas', e);
          return;
        }
        setSaveStatus('saved');
      }
    }
    onBack();
  }, [onBack, persist]);

  // Loading state
  if (loading) {
    return (
      <div className="fixed inset-0 z-[9999] bg-surface-raised flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-gold" />
          <span className="text-sm text-muted">Loading canvas...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="fixed inset-0 z-[9999] bg-surface-raised flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <AlertCircle className="w-10 h-10 text-red-400" />
          <span className="text-sm text-muted">{error}</span>
          <button onClick={handleBack} className="text-sm text-gold hover:underline">Go back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-surface-raised flex flex-col excalidraw-canvas-container">
      {/* Our floating toolbar — sits above Excalidraw, below safe area */}
      <div className="absolute top-0 left-0 right-0 z-[10000] flex items-center justify-between px-3 py-2 canvas-top-bar"
           style={{ paddingTop: `max(env(safe-area-inset-top, 0px), 8px)` }}>
        <div className="flex items-center gap-2">
          <button
            onClick={handleBack}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/90 backdrop-blur-xs rounded-lg shadow-xs border border-line hover:bg-surface-sunken transition-colors text-xs font-medium text-body cursor-pointer"
          >
            <ArrowLeft size={16} />
            <span>Back</span>
          </button>
          <span className="text-xs font-semibold text-strong truncate max-w-[160px]">
            {initialName}
          </span>
        </div>
        <div className={`flex items-center gap-1 px-2 py-1 bg-white/90 backdrop-blur-xs rounded-md text-[10px] font-medium ${
          saveStatus === 'saved' ? 'text-green-600' :
          saveStatus === 'saving' ? 'text-blue-500' :
          saveStatus === 'error' ? 'text-red-500' :
          'text-faint'
        }`}>
          {saveStatus === 'saving' && <Loader2 size={10} className="animate-spin" />}
          {saveStatus === 'saved' && <Check size={10} />}
          {saveStatus === 'error' && <AlertCircle size={10} />}
          {saveStatus === 'saving' ? 'Saving' :
           saveStatus === 'saved' ? 'Saved' :
           saveStatus === 'error' ? 'Error' :
           'Auto'}
        </div>
      </div>

      {/* Excalidraw canvas — drawing tools accessible via bottom hamburger menu */}
      <div className="flex-1 w-full h-full">
        <Excalidraw
          excalidrawAPI={(api) => { excalidrawAPI.current = api; }}
          initialData={{ elements: initialElements as any }}
          onChange={handleChange}
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: true,
              export: false,
              loadScene: false,
              saveToActiveFile: false,
            },
          }}
        />
      </div>
    </div>
  );
};

export default CanvasEditor;
