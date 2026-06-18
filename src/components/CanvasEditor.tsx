"use client";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Users, Check, Loader2, AlertCircle } from 'lucide-react';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { authFetch } from '../utils/auth-fetch';
import { getTenantScope } from '../utils/tenant-scope';
import dynamic from 'next/dynamic';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/types/types';

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
  const lastSavedElements = useRef<string>('');
  const isMounted = useRef(true);
  const tenantIdRef = useRef<string | null>(null);

  // Load canvas data
  useEffect(() => {
    isMounted.current = true;
    let cancelled = false;

    const load = async () => {
      try {
        const tenantId = await getTenantScope();
        if (cancelled) return;
        tenantIdRef.current = tenantId;

        // Load via API
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

        // Only apply if this is a remote change (not our own write)
        if (remoteSerialized !== lastSavedElements.current && excalidrawAPI.current) {
          excalidrawAPI.current.updateScene({ elements: remoteElements });
        }
      }, (err) => {
        console.error('Real-time sync error:', err);
      });
    };

    // If tenantId already available, init immediately. Otherwise poll.
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
    saveTimer.current = setTimeout(async () => {
      if (!isMounted.current) return;
      setSaveStatus('saving');
      try {
        const serialized = JSON.stringify(elements);
        lastSavedElements.current = serialized;

        const resp = await authFetch(`/api/canvas/${canvasId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ elements }),
        });
        if (!resp.ok) throw new Error('Save failed');
        if (isMounted.current) {
          setSaveStatus('saved');
          setTimeout(() => { if (isMounted.current) setSaveStatus('idle'); }, 2000);
        }
      } catch (e) {
        console.error('Auto-save failed:', e);
        if (isMounted.current) setSaveStatus('error');
      }
    }, 1500);
  }, [canvasId]);

  // Cleanup
  useEffect(() => {
    return () => {
      isMounted.current = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const handleBack = async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    // Flush any pending changes
    if (excalidrawAPI.current) {
      const elements = excalidrawAPI.current.getSceneElements();
      const serialized = JSON.stringify(elements);
      if (serialized !== lastSavedElements.current) {
        try {
          await authFetch(`/api/canvas/${canvasId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ elements }),
          });
        } catch (e) {
          console.error('Final save failed:', e);
        }
      }
    }
    onBack();
  };

  // Loading state
  if (loading) {
    return (
      <div className="fixed inset-0 z-[9999] bg-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-[#C9963A]" />
          <span className="text-sm text-gray-500">Loading canvas...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="fixed inset-0 z-[9999] bg-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <AlertCircle className="w-10 h-10 text-red-400" />
          <span className="text-sm text-gray-600">{error}</span>
          <button onClick={handleBack} className="text-sm text-[#C9963A] hover:underline">Go back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-white flex flex-col">
      {/* Floating toolbar */}
      <div className="absolute top-4 left-4 z-[10000] flex items-center gap-3">
        <button
          onClick={handleBack}
          className="flex items-center gap-2 px-3 py-2 bg-white rounded-xl shadow-md border border-gray-100 hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700 cursor-pointer"
        >
          <ArrowLeft size={18} />
          <span>Back</span>
        </button>
        <div className="px-3 py-2 bg-white rounded-xl shadow-md border border-gray-100 text-sm font-semibold text-gray-900 max-w-[200px] truncate">
          {initialName}
        </div>
        <div className={`px-3 py-2 bg-white rounded-xl shadow-md border border-gray-100 text-xs font-medium flex items-center gap-1.5 ${
          saveStatus === 'saved' ? 'text-green-600' :
          saveStatus === 'saving' ? 'text-blue-500' :
          saveStatus === 'error' ? 'text-red-500' :
          'text-gray-400'
        }`}>
          {saveStatus === 'saving' && <Loader2 size={12} className="animate-spin" />}
          {saveStatus === 'saved' && <Check size={12} />}
          {saveStatus === 'error' && <AlertCircle size={12} />}
          {saveStatus === 'saving' ? 'Saving...' :
           saveStatus === 'saved' ? 'Saved' :
           saveStatus === 'error' ? 'Save failed' :
           'Auto-saved'}
        </div>
      </div>

      {/* Excalidraw canvas — takes full screen */}
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
