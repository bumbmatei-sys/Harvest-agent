"use client";
import React, { useState, useEffect } from 'react';
import { Plus, FileText, Trash2, Calendar } from 'lucide-react';
import { collection, query, where, onSnapshot, addDoc, deleteDoc, doc, orderBy, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { getTenantScope } from '../utils/tenant-scope';

interface Canvas {
  id: string;
  name: string;
  createdAt: any;
  updatedAt: any;
}

interface CanvasListProps {
  onOpenCanvas: (id: string, name: string) => void;
}

const CanvasList: React.FC<CanvasListProps> = ({ onOpenCanvas }) => {
  const [canvases, setCanvases] = useState<Canvas[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let unsub: (() => void) | null = null;

    const load = async () => {
      const tenantId = await getTenantScope();
      const baseQuery = tenantId
        ? query(collection(db, 'canvases'), where('tenantId', '==', tenantId), orderBy('updatedAt', 'desc'))
        : query(collection(db, 'canvases'), orderBy('updatedAt', 'desc'));

      unsub = onSnapshot(baseQuery, (snapshot) => {
        setCanvases(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Canvas)));
        setLoading(false);
      }, (error) => {
        console.error('Failed to load canvases:', error);
        setLoading(false);
      });
    };

    load();
    return () => { if (unsub) unsub(); };
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const tenantId = await getTenantScope();
      const docRef = await addDoc(collection(db, 'canvases'), {
        name: 'Untitled Canvas',
        tenantId: tenantId || null,
        userId: auth.currentUser?.uid || null,
        content: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      onOpenCanvas(docRef.id, 'Untitled Canvas');
    } catch (e) {
      console.error('Failed to create canvas:', e);
      alert('Failed to create canvas. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this canvas? This cannot be undone.')) return;
    try {
      await deleteDoc(doc(db, 'canvases', id));
    } catch (e) {
      console.error('Failed to delete canvas:', e);
      alert('Failed to delete canvas.');
    }
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #d4a017)', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Canvas</h2>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="flex items-center gap-2 px-5 py-2 bg-[#d4a017] text-white rounded-xl text-sm font-semibold hover:bg-[#b8941a] transition-colors disabled:opacity-50"
        >
          <Plus size={16} />
          {creating ? 'Creating...' : 'New Canvas'}
        </button>
      </div>

      {canvases.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[#fefce8] flex items-center justify-center mb-4">
            <FileText size={28} style={{ color: 'var(--brand-color, #d4a017)' }} />
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-2">No canvases yet</h3>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
            Create rich content pages for your ministry — announcements, devotionals, event pages, and more.
          </p>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#d4a017] text-white rounded-xl text-sm font-semibold hover:bg-[#b8941a] transition-colors disabled:opacity-50"
          >
            <Plus size={16} />
            Create Your First Canvas
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {canvases.map((canvas) => (
            <div
              key={canvas.id}
              onClick={() => onOpenCanvas(canvas.id, canvas.name)}
              className="bg-white rounded-2xl border border-gray-100 p-5 cursor-pointer hover:shadow-md hover:border-gray-200 transition-all group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                  <FileText size={20} className="text-blue-600" />
                </div>
                <button
                  onClick={(e) => handleDelete(canvas.id, e)}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all p-1"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <h3 className="text-sm font-bold text-gray-900 mb-1 truncate">{canvas.name}</h3>
              <div className="flex items-center gap-1 text-xs text-gray-400">
                <Calendar size={12} />
                {formatDate(canvas.updatedAt || canvas.createdAt)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CanvasList;
