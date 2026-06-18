"use client";
import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Save, Eye } from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { authFetch } from '../utils/auth-fetch';
import { getTenantScope } from '../utils/tenant-scope';
import { sanitizeHtml } from '../utils/sanitize';

interface CanvasEditorProps {
  canvasId: string;
  canvasName: string;
  onBack: () => void;
}

const CanvasEditor: React.FC<CanvasEditorProps> = ({ canvasId, canvasName: initialName, onBack }) => {
  const [name, setName] = useState(initialName);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadCanvas = async () => {
      try {
        // Initial load via API (with tenant isolation + validation)
        const resp = await authFetch(`/api/canvas/${canvasId}`);
        if (!resp.ok) throw new Error('Failed to load canvas');
        const data = await resp.json();
        if (!cancelled) {
          setName(data.name || initialName);
          // Set content from elements — the API stores elements array, but we use a simple content string
          // For backward compat, check if there's a content field or reconstruct from elements
          setContent(data.content || '');
        }
      } catch (e) {
        console.error('Failed to load canvas:', e);
      }
      if (!cancelled) setLoading(false);
    };

    loadCanvas();

    // Real-time sync on correct tenant-scoped path
    const setupRealtime = async () => {
      const tenantId = await getTenantScope();
      if (!tenantId || cancelled) return;

      const canvasRef = doc(db, 'tenants', tenantId, 'canvases', canvasId);
      unsubRef.current = onSnapshot(canvasRef, (snapshot) => {
        if (snapshot.exists() && !cancelled) {
          const data = snapshot.data();
          if (data.name) setName(data.name);
          if (data.content !== undefined) setContent(data.content || '');
        }
      }, (error) => {
        console.error('Real-time sync error:', error);
      });
    };

    setupRealtime();

    return () => {
      cancelled = true;
      if (unsubRef.current) unsubRef.current();
    };
  }, [canvasId, initialName]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const resp = await authFetch(`/api/canvas/${canvasId}`, {
        method: 'PUT',
        body: JSON.stringify({ name, content }),
      });
      if (!resp.ok) throw new Error('Failed to save canvas');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      console.error('Failed to save canvas:', e);
      alert('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #d4a017)', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-0 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-4 flex-wrap">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ArrowLeft size={20} />
          <span className="text-sm font-medium">Back</span>
        </button>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#d4a017] focus:border-transparent"
          placeholder="Canvas name"
        />
        <button
          onClick={() => setPreviewMode(!previewMode)}
          className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <Eye size={16} />
          {previewMode ? 'Edit' : 'Preview'}
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 bg-[#d4a017] text-white rounded-xl text-sm font-semibold hover:bg-[#b8941a] transition-colors disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? 'Saving...' : 'Save'}
          </button>
          {saved && (
            <span className="text-sm text-green-600 font-medium">✓ Saved</span>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {previewMode ? (
          <div
            className="prose max-w-none min-h-[500px] p-6"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(content || '<p class="text-gray-400">Nothing to preview yet.</p>') }}
          />
        ) : (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Start writing your canvas content... (HTML supported)"
            className="w-full px-6 py-4 border-0 text-sm font-mono min-h-[500px] focus:outline-none resize-y"
          />
        )}
      </div>
    </div>
  );
};

export default CanvasEditor;
