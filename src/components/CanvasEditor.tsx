'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { ArrowLeft } from 'lucide-react';
import { db } from '../firebase';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useTenant } from '../contexts/TenantContext';

// Dynamic import to avoid SSR issues with Excalidraw
const Excalidraw = dynamic(
  () => import('@excalidraw/excalidraw').then((mod) => mod.Excalidraw),
  { ssr: false }
);

interface CanvasEditorProps {
  canvasId: string;
  canvasName: string;
  onBack: () => void;
}

export default function CanvasEditor({ canvasId, canvasName, onBack }: CanvasEditorProps) {
  const { tenantId } = useTenant();
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [initialData, setInitialData] = useState<any>(null);
  const lastSavedElements = useRef<string>('');
  const isMounted = useRef(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const excalidrawAPI = useRef<any>(null);

  // Fix 6: Track mount state to prevent state updates after unmount
  useEffect(() => {
    return () => { isMounted.current = false; };
  }, []);

  // Load initial data from API
  useEffect(() => {
    if (!tenantId || !canvasId) return;

    const loadInitial = async () => {
      try {
        const res = await fetch(`/api/canvas/${canvasId}`);
        if (res.ok) {
          const data = await res.json();
          setInitialData({
            elements: data.elements || [],
            appState: data.appState || {},
          });
        }
      } catch (err) {
        console.error('Failed to load canvas:', err);
      }
    };

    loadInitial();
  }, [canvasId, tenantId]);

  // Real-time Firestore listener
  useEffect(() => {
    if (!tenantId || !canvasId) return;

    const docRef = doc(db, 'tenants', tenantId, 'canvases', canvasId);

    const unsub = onSnapshot(docRef, (snapshot: any) => {
      if (!snapshot.exists()) return;
      const data = snapshot.data();
      if (data) {
        // Fix 1: Compare serialized elements instead of boolean flag
        const remoteSerialized = JSON.stringify(data.elements || []);
        if (remoteSerialized !== lastSavedElements.current) {
          // Remote change — apply it (Fix 7: even if empty array)
          excalidrawAPI.current?.updateScene({ elements: data.elements || [] });
        }
      }
    });

    return () => unsub();
  }, [canvasId, tenantId]);

  // Debounced save handler
  const handleChange = useCallback(
    (elements: readonly any[], appState: any) => {
      if (!tenantId || !canvasId) return;

      setSaveStatus('saving');

      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }

      saveTimer.current = setTimeout(async () => {
        try {
          const serialized = JSON.stringify([...elements]);
          const docRef = doc(db, 'tenants', tenantId, 'canvases', canvasId);
          await updateDoc(docRef, {
            elements: [...elements],
            appState: { zoom: appState.zoom },
            updatedAt: serverTimestamp(),
          });
          // Fix 1: Record what we saved for comparison
          lastSavedElements.current = serialized;
          if (isMounted.current) {
            setSaveStatus('saved');
            setTimeout(() => { if (isMounted.current) setSaveStatus('idle'); }, 2000);
          }
        } catch (err) {
          console.error('Failed to save canvas:', err);
          // Fix 5: Show save failed error
          if (isMounted.current) {
            setSaveStatus('error');
            setTimeout(() => { if (isMounted.current) setSaveStatus('idle'); }, 3000);
          }
        }
      }, 1000);
    },
    [canvasId, tenantId]
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, []);

  const handleExcalidrawAPI = useCallback((api: any) => {
    excalidrawAPI.current = api;
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white shrink-0">
        {/* Back Button */}
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors text-sm font-medium"
          style={{ color: '#0b1121' }}
        >
          <ArrowLeft size={18} />
          Back
        </button>

        {/* Canvas Name */}
        <h1
          className="text-base font-semibold absolute left-1/2 -translate-x-1/2"
          style={{ color: '#0b1121' }}
        >
          {canvasName}
        </h1>

        {/* Save Status */}
        <div className="text-sm min-w-[80px] text-right">
          {saveStatus === 'saving' && (
            <span className="text-gray-400">Saving...</span>
          )}
          {saveStatus === 'saved' && (
            <span style={{ color: '#C9963A' }}>Saved</span>
          )}
          {saveStatus === 'error' && (
            <span className="text-red-500 font-medium">Save failed</span>
          )}
        </div>
      </div>

      {/* Excalidraw Canvas */}
      <div className="flex-1 min-h-0">
        {initialData ? (
          <Excalidraw
            key={canvasId}
            initialData={initialData}
            onChange={handleChange}
            excalidrawAPI={handleExcalidrawAPI}
            viewModeEnabled={false}
            zenModeEnabled={false}
            gridModeEnabled={false}
            UIOptions={{
              canvasActions: {
                changeViewBackgroundColor: true,
                clearCanvas: true,
                export: { saveFileToDisk: true },
                loadScene: true,
                saveToActiveFile: false,
                toggleTheme: true,
              },
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div
              className="animate-spin rounded-full h-8 w-8 border-b-2"
              style={{ borderColor: '#C9963A' }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
