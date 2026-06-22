"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, FileText, Trash2, ArrowLeft, Clock } from 'lucide-react';
import {
  collection, query, where, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, doc, limit, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { getTenantScope } from '../utils/tenant-scope';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import RichTextEditor from './RichTextEditor';

interface Doc {
  id: string;
  title: string;
  content: string;
  updatedAt?: { seconds: number } | null;
  tenantId?: string;
}

const AdminDocs: React.FC = () => {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<Doc | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      const tid = await getTenantScope();
      if (cancelled) return;
      setTenantId(tid);
      const q = tid
        ? query(collection(db, 'docs'), where('tenantId', '==', tid), orderBy('updatedAt', 'desc'), limit(100))
        : query(collection(db, 'docs'), orderBy('updatedAt', 'desc'), limit(100));
      unsub = onSnapshot(q, (snap) => {
        setDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Doc));
        setLoading(false);
      }, (err) => {
        try { handleFirestoreError(err, OperationType.GET, 'docs'); } catch (e) { console.error(e); }
        setLoading(false);
      });
    })();
    return () => { cancelled = true; unsub?.(); };
  }, []);

  const openDocument = (d: Doc) => {
    setOpenDoc(d);
    setEditTitle(d.title);
    setEditContent(d.content);
  };

  const saveDoc = useCallback(async (id: string, title: string, content: string) => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'docs', id), { title, content, updatedAt: serverTimestamp() });
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }, []);

  const handleContentChange = (content: string) => {
    setEditContent(content);
    if (openDoc) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => saveDoc(openDoc.id, editTitle, content), 1500);
    }
  };

  const handleTitleBlur = () => {
    if (openDoc && editTitle.trim()) {
      saveDoc(openDoc.id, editTitle, editContent);
    }
  };

  const createDoc = async () => {
    try {
      const ref = await addDoc(collection(db, 'docs'), {
        title: 'Untitled',
        content: '',
        tenantId: tenantId || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const newDoc: Doc = { id: ref.id, title: 'Untitled', content: '', tenantId: tenantId || undefined };
      setOpenDoc(newDoc);
      setEditTitle('Untitled');
      setEditContent('');
    } catch (e) { console.error(e); }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    if (openDoc?.id === deleteId) setOpenDoc(null);
    try { await deleteDoc(doc(db, 'docs', deleteId)); }
    catch (e) { console.error(e); }
    setDeleteId(null);
  };

  const fmtDate = (ts: { seconds: number } | null | undefined) => {
    if (!ts) return '';
    return new Date(ts.seconds * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Document editor view (full tab, no FocusScreen — stays within admin layout)
  if (openDoc) {
    return (
      <div className="flex flex-col h-full max-h-[calc(100vh-160px)]">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => { setOpenDoc(null); if (saveTimer.current) clearTimeout(saveTimer.current); }}
            className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
            <ArrowLeft size={18} className="text-gray-600" />
          </button>
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleTitleBlur}
            className="flex-1 text-xl font-bold text-gray-900 bg-transparent border-none outline-none placeholder-gray-300"
            placeholder="Untitled"
          />
          {saving && <span className="text-xs text-gray-400">Saving...</span>}
        </div>
        <div className="flex-1 bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <RichTextEditor
            content={editContent}
            onChange={handleContentChange}
            minHeight="calc(100vh - 280px)"
            placeholder="Start writing..."
          />
        </div>
      </div>
    );
  }

  // Document list view
  if (loading) {
    return <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #d4a017)', borderTopColor: 'transparent' }} /></div>;
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <FileText size={22} style={{ color: 'var(--brand-color, #d4a017)' }} />
          <h2 className="text-xl font-bold text-gray-900">Docs</h2>
        </div>
        <button
          onClick={createDoc}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
        >
          <Plus size={16} /> New Doc
        </button>
      </div>

      {docs.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No documents yet</p>
          <p className="text-sm mt-1">Create your first document</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {docs.map((d) => (
            <div
              key={d.id}
              onClick={() => openDocument(d)}
              className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm cursor-pointer hover:border-[#d4a017]/40 hover:shadow-md transition-all group"
            >
              <div className="flex items-start justify-between gap-2">
                <FileText size={18} className="text-gray-300 flex-shrink-0 mt-0.5" />
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleteId(d.id); }}
                  className="p-1 rounded-lg hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 size={14} className="text-red-400" />
                </button>
              </div>
              <p className="font-semibold text-gray-900 text-sm mt-2 truncate">{d.title || 'Untitled'}</p>
              {d.content && (
                <p className="text-xs text-gray-400 mt-1 line-clamp-2"
                  dangerouslySetInnerHTML={{ __html: d.content.replace(/<[^>]*>/g, ' ').trim() }} />
              )}
              {d.updatedAt && (
                <div className="flex items-center gap-1 mt-3 text-[10px] text-gray-400">
                  <Clock size={10} />
                  {fmtDate(d.updatedAt)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm text-center">
            <p className="font-bold text-gray-900 mb-2">Delete this document?</p>
            <p className="text-sm text-gray-500 mb-5">This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteId(null)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600">Cancel</button>
              <button onClick={confirmDelete} className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDocs;
