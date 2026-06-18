'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, FileText, Clock, User } from 'lucide-react';

interface Canvas {
  id: string;
  name: string;
  createdBy: string;
  createdByName: string;
  createdAt: string | null;
  updatedAt: string | null;
}

interface CanvasListProps {
  onOpenCanvas: (id: string, name: string) => void;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Unknown';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function CanvasList({ onOpenCanvas }: CanvasListProps) {
  const [canvases, setCanvases] = useState<Canvas[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  // Fix 5: Error feedback to users
  const [error, setError] = useState<string | null>(null);

  const fetchCanvases = useCallback(async () => {
    try {
      const res = await fetch('/api/canvas');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setCanvases(data.canvases || []);
    } catch (err) {
      console.error('Failed to fetch canvases:', err);
      setError('Failed to load canvases. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCanvases();
  }, [fetchCanvases]);

  const handleCreate = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/canvas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) throw new Error('Failed to create');
      const data = await res.json();
      setCanvases((prev) => [data, ...prev]);
      setNewName('');
      setShowNewModal(false);
    } catch (err) {
      console.error('Failed to create canvas:', err);
      setError('Failed to create canvas. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      const res = await fetch(`/api/canvas/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      setCanvases((prev) => prev.filter((c) => c.id !== id));
      setDeleteConfirm(null);
    } catch (err) {
      console.error('Failed to delete canvas:', err);
      setError('Failed to delete canvas. Please try again.');
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#C9963A' }} />
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-8">
      {/* Fix 5: Error banner */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between">
          <span className="text-red-600 text-sm">{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-400 hover:text-red-600 text-sm font-medium"
          >
            Dismiss
          </button>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#0b1121' }}>
            Canvas
          </h1>
          <p className="text-gray-500 mt-1">
            Collaborative whiteboard for your team
          </p>
        </div>
        <button
          onClick={() => setShowNewModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-white font-medium transition-all hover:opacity-90 active:scale-[0.98]"
          style={{ backgroundColor: '#C9963A' }}
        >
          <Plus size={18} />
          New Canvas
        </button>
      </div>

      {/* Empty State */}
      {canvases.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ backgroundColor: '#C9963A15' }}
          >
            <FileText size={28} style={{ color: '#C9963A' }} />
          </div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: '#0b1121' }}>
            No canvases yet
          </h2>
          <p className="text-gray-500 mb-6">
            Create your first one!
          </p>
          <button
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-white font-medium"
            style={{ backgroundColor: '#C9963A' }}
          >
            <Plus size={18} />
            Create Canvas
          </button>
        </div>
      ) : (
        /* Canvas Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {canvases.map((canvas) => (
            <div
              key={canvas.id}
              className="group relative bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-all cursor-pointer"
              onClick={() => onOpenCanvas(canvas.id, canvas.name)}
            >
              <div className="flex items-start justify-between mb-3">
                <h3
                  className="font-semibold text-base truncate flex-1 pr-2"
                  style={{ color: '#0b1121' }}
                >
                  {canvas.name}
                </h3>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteConfirm(canvas.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-50 transition-all"
                  title="Delete canvas"
                >
                  <Trash2 size={16} className="text-red-400 hover:text-red-600" />
                </button>
              </div>

              <div className="flex items-center gap-4 text-sm text-gray-500">
                <span className="flex items-center gap-1">
                  <User size={14} />
                  {canvas.createdByName}
                </span>
                <span className="flex items-center gap-1">
                  <Clock size={14} />
                  {timeAgo(canvas.updatedAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Canvas Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div
            className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              className="text-lg font-semibold mb-4"
              style={{ color: '#0b1121' }}
            >
              New Canvas
            </h2>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Canvas name..."
              maxLength={100}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent"
              style={{ '--tw-ring-color': '#C9963A' } as React.CSSProperties}
              autoFocus
            />
            <div className="flex justify-end gap-3 mt-5">
              <button
                onClick={() => {
                  setShowNewModal(false);
                  setNewName('');
                }}
                className="px-4 py-2.5 rounded-xl text-gray-600 hover:bg-gray-100 font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || creating}
                className="px-4 py-2.5 rounded-xl text-white font-medium transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: '#C9963A' }}
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div
            className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              className="text-lg font-semibold mb-2"
              style={{ color: '#0b1121' }}
            >
              Delete Canvas
            </h2>
            <p className="text-gray-500 mb-5">
              Are you sure? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2.5 rounded-xl text-gray-600 hover:bg-gray-100 font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                disabled={deleting === deleteConfirm}
                className="px-4 py-2.5 rounded-xl text-white font-medium bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {deleting === deleteConfirm ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
