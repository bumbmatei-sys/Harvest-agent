"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, FileText, Trash2, Clock, FolderOpen, Folder, ChevronRight, ChevronDown,
  PanelLeft, X, ArrowLeft, MoreVertical, Edit2, Move, Pin
} from 'lucide-react';
import {
  collection, query, where, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, limit, serverTimestamp, Timestamp
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { getTenantScope } from '../utils/tenant-scope';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { notifyError } from '../utils/notify';
import RichTextEditor from './RichTextEditor';
import FocusScreen from './FocusScreen';

interface DocFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdBy: string;
  createdAt: Timestamp | null;
  order: number;
}

interface Doc {
  id: string;
  title: string;
  content: string;
  folderId: string | null;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  isPrivate: boolean;
  sharedWith: string[];
  tenantId?: string;
  pinned?: boolean;
}

const fmtDate = (ts: Timestamp | null | undefined) => {
  if (!ts) return '';
  return ts.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// ─── Three-Dot Menu ──────────────────────────────────────────────

const ThreeDotMenu: React.FC<{
  onRename: () => void;
  onDelete: () => void;
  onMove?: () => void;
  onPin?: () => void;
  isPinned?: boolean;
}> = ({ onRename, onDelete, onMove, onPin, isPinned }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-100 transition-all"
      >
        <MoreVertical size={14} className="text-gray-400 hover:text-gray-600" />
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 w-36 bg-white rounded-lg shadow-lg border border-gray-100 z-50 py-1">
          <button
            {onMove && (
              <button
                onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onMove(); }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                <Move size={12} /> Move to Folder
              </button>
            )}
            {onPin && (
              <button
                onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onPin(); }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                <Pin size={12} /> {isPinned ? 'Unpin' : 'Pin to Top'}
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onRename(); }}
            className="w-full flex items-center gap-2 text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
          >
            <Edit2 size={12} /> Rename
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(); }}
            className="w-full flex items-center gap-2 text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50"
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Rename Modal ────────────────────────────────────────────────

const RenameModal: React.FC<{
  title: string;
  initialValue: string;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}> = ({ title, initialValue, onConfirm, onCancel }) => {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.select(); }, []);

  return (
    <div className="fixed inset-0 z-[310] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-5">
        <h3 className="font-bold text-gray-900 mb-4">{title}</h3>
        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onConfirm(value); if (e.key === 'Escape') onCancel(); }}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017] mb-4"
          placeholder="Name"
          autoFocus
        />
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600">Cancel</button>
          <button
            onClick={() => onConfirm(value)}
            disabled={!value.trim()}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Folder Tree Node ─────────────────────────────────────────────

const FolderNode: React.FC<{
  folder: DocFolder;
  folders: DocFolder[];
  docs: Doc[];
  activeFolderId: string | null;
  activeDocId: string | null;
  onSelectFolder: (id: string | null) => void;
  onSelectDoc: (d: Doc) => void;
  onDeleteFolder: (id: string) => void;
  onDeleteDoc: (id: string) => void;
  onRenameFolder: (folder: DocFolder) => void;
  onRenameDoc: (doc: Doc) => void;
  depth?: number;
}> = ({ folder, folders, docs, activeFolderId, activeDocId, onSelectFolder, onSelectDoc, onDeleteFolder, onDeleteDoc, onRenameFolder, onRenameDoc, depth = 0 }) => {
  const [open, setOpen] = useState(true);
  const childFolders = folders.filter(f => f.parentId === folder.id);
  const folderDocs = docs.filter(d => d.folderId === folder.id);
  const isActive = activeFolderId === folder.id;

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer group transition-colors ${isActive ? 'bg-[#d4a017]/10' : 'hover:bg-gray-100'}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => { setOpen(!open); onSelectFolder(folder.id); }}
      >
        {open ? <ChevronDown size={13} className="text-gray-400 flex-shrink-0" /> : <ChevronRight size={13} className="text-gray-400 flex-shrink-0" />}
        {open ? <FolderOpen size={14} style={{ color: 'var(--brand-color, #d4a017)' }} className="flex-shrink-0" /> : <Folder size={14} className="text-gray-400 flex-shrink-0" />}
        <span className="text-xs font-medium text-gray-800 flex-1 truncate">{folder.name}</span>
        <ThreeDotMenu
          onRename={() => onRenameFolder(folder)}
          onDelete={() => onDeleteFolder(folder.id)}
        />
      </div>
      {open && (
        <div>
          {childFolders.map(cf => (
            <FolderNode
              key={cf.id}
              folder={cf}
              folders={folders}
              docs={docs}
              activeFolderId={activeFolderId}
              activeDocId={activeDocId}
              onSelectFolder={onSelectFolder}
              onSelectDoc={onSelectDoc}
              onDeleteFolder={onDeleteFolder}
              onDeleteDoc={onDeleteDoc}
              onRenameFolder={onRenameFolder}
              onRenameDoc={onRenameDoc}
              depth={depth + 1}
            />
          ))}
          {folderDocs.map(d => (
            <div
              key={d.id}
              onClick={() => onSelectDoc(d)}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer group transition-colors ${activeDocId === d.id ? 'bg-[#d4a017]/10' : 'hover:bg-gray-100'}`}
              style={{ paddingLeft: `${24 + depth * 16}px` }}
            >
              <FileText size={13} className="text-gray-400 flex-shrink-0" />
              <span className="text-xs text-gray-700 flex-1 truncate">{d.title || 'Untitled'}</span>
              <ThreeDotMenu
                onRename={() => onRenameDoc(d)}
                onDelete={() => onDeleteDoc(d.id)}
                onMove={() => onMoveDoc?.(d.id)}
                onPin={() => onPinDoc?.(d.id, !!d.pinned)}
                isPinned={!!d.pinned}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Main AdminDocs ──────────────────────────────────────────────

const AdminDocs: React.FC = () => {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [folders, setFolders] = useState<DocFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<Doc | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'idle'>('idle');
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);
  const [deleteFolderId, setDeleteFolderId] = useState<string | null>(null);
  const [moveDocId, setMoveDocId] = useState<string | null>(null);
  const [renameFolderData, setRenameFolderData] = useState<{ id: string; name: string } | null>(null);
  const [renameDocData, setRenameDocData] = useState<{ id: string; name: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [focusMode, setFocusMode] = useState(false);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let unsubs: (() => void)[] = [];
    let cancelled = false;
    getTenantScope().then(tid => {
      if (cancelled) return;
      setTenantId(tid);
      // Docs
      const qDocs = tid
        ? query(collection(db, 'docs'), where('tenantId', '==', tid), orderBy('updatedAt', 'desc'), limit(200))
        : query(collection(db, 'docs'), orderBy('updatedAt', 'desc'), limit(200));
      unsubs.push(onSnapshot(qDocs, snap => {
        setDocs(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Doc));
        setLoading(false);
      }, err => {
        try { handleFirestoreError(err, OperationType.GET, 'docs'); } catch (e) { console.error(e); }
        setLoading(false);
      }));
      // Folders
      const qFolders = tid
        ? query(collection(db, 'docFolders'), where('tenantId', '==', tid), orderBy('order'), limit(100))
        : query(collection(db, 'docFolders'), orderBy('order'), limit(100));
      unsubs.push(onSnapshot(qFolders, snap => {
        setFolders(snap.docs.map(d => ({ id: d.id, ...d.data() }) as DocFolder));
      }));
    });
    return () => { cancelled = true; unsubs.forEach(u => u()); };
  }, []);

  const openDocument = (d: Doc) => {
    setOpenDoc(d);
    setEditTitle(d.title || '');
    setEditContent(d.content || '');
    setSaveStatus('idle');
    setFocusMode(true);
  };

  const saveDoc = useCallback(async (id: string, title: string, content: string) => {
    setSaveStatus('saving');
    try {
      await updateDoc(doc(db, 'docs', id), { title, content, updatedAt: serverTimestamp() });
      setSaveStatus('saved');
    } catch (e) { console.error(e); setSaveStatus('idle'); }
  }, []);

  const handleContentChange = (content: string) => {
    setEditContent(content);
    if (openDoc) {
      setSaveStatus('saving');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => saveDoc(openDoc.id, editTitle, content), 2000);
    }
  };

  const handleTitleBlur = () => {
    if (openDoc && editTitle.trim()) {
      saveDoc(openDoc.id, editTitle, editContent);
    }
  };

  const createDoc = async (folderId?: string | null) => {
    try {
      const ref = await addDoc(collection(db, 'docs'), {
        title: 'Untitled',
        content: '',
        folderId: folderId ?? activeFolderId ?? null,
        tenantId: tenantId || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: auth.currentUser?.uid || '',
        isPrivate: true,
        sharedWith: [],
        pinned: false,
      });
      const newDoc: Doc = {
        id: ref.id, title: 'Untitled', content: '', folderId: folderId ?? null,
        createdBy: auth.currentUser?.uid || '', createdAt: null, updatedAt: null,
        isPrivate: true, sharedWith: [],
      };
      setOpenDoc(newDoc);
      setEditTitle('Untitled');
      setEditContent('');
      setSaveStatus('idle');
      setFocusMode(true);
      setTimeout(() => { titleRef.current?.select(); }, 100);
    } catch (e) { notifyError('Failed to create document', e); }
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      await addDoc(collection(db, 'docFolders'), {
        name: newFolderName.trim(),
        parentId: null,
        tenantId: tenantId || null,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.uid || '',
        order: folders.length,
      });
      setShowNewFolder(false);
      setNewFolderName('');
    } catch (e) { notifyError('Failed to create folder', e); }
  };

  const confirmDeleteDoc = async () => {
    if (!deleteDocId) return;
    if (openDoc?.id === deleteDocId) { setOpenDoc(null); setFocusMode(false); }
    try { await deleteDoc(doc(db, 'docs', deleteDocId)); }
    catch (e) { notifyError('Failed to delete document', e); }
    setDeleteDocId(null);
  };

  const moveDocToFolder = async (docId: string, folderId: string | null) => {
    try {
      await updateDoc(doc(db, 'docs', docId), { folderId, updatedAt: serverTimestamp() });
      setMoveDocId(null);
    } catch (e) { notifyError('Failed to move document', e); }
  };

  const togglePinDoc = async (docId: string, currentPinned: boolean) => {
    try {
      await updateDoc(doc(db, 'docs', docId), { pinned: !currentPinned });
    } catch (e) { notifyError('Failed to toggle pin', e); }
  };

  const confirmDeleteFolder = async () => {
    if (!deleteFolderId) return;
    try { await deleteDoc(doc(db, 'docFolders', deleteFolderId)); }
    catch (e) { notifyError('Failed to delete folder', e); }
    setDeleteFolderId(null);
  };

  const handleRenameFolder = useCallback((folder: DocFolder) => {
    setRenameFolderData({ id: folder.id, name: folder.name });
  }, []);

  const handleRenameDoc = useCallback((d: Doc) => {
    setRenameDocData({ id: d.id, name: d.title || '' });
  }, []);

  const confirmRenameFolder = async (newName: string) => {
    if (!renameFolderData || !newName.trim()) return;
    try {
      await updateDoc(doc(db, 'docFolders', renameFolderData.id), { name: newName.trim() });
    } catch (e) { notifyError('Failed to rename folder', e); }
    setRenameFolderData(null);
  };

  const confirmRenameDoc = async (newName: string) => {
    if (!renameDocData || !newName.trim()) return;
    try {
      await updateDoc(doc(db, 'docs', renameDocData.id), { title: newName.trim(), updatedAt: serverTimestamp() });
      if (openDoc?.id === renameDocData.id) {
        setEditTitle(newName.trim());
      }
    } catch (e) { notifyError('Failed to rename document', e); }
    setRenameDocData(null);
  };

  const rootFolders = folders.filter(f => !f.parentId);
  const rootDocs = docs.filter(d => !d.folderId).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  const folderDocs = activeFolderId
    ? docs.filter(d => d.folderId === activeFolderId).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
    : rootDocs;

  // ── Focus mode (full editor) ──
  if (focusMode && openDoc) {
    return (
      <FocusScreen
        onBack={() => {
          if (saveTimer.current) clearTimeout(saveTimer.current);
          if (editTitle.trim()) saveDoc(openDoc.id, editTitle, editContent);
          setOpenDoc(null);
          setFocusMode(false);
        }}
        onSidebarToggle={() => setSidebarOpen(!sidebarOpen)}
      >
        <div className="flex h-full bg-white">
          {/* Sidebar */}
          {sidebarOpen && (
            <div className="w-64 flex-shrink-0 border-r border-gray-100 flex flex-col bg-white overflow-hidden">
              <div className="p-3 border-b border-gray-100 flex gap-2 mt-10">
                <button
                  onClick={() => createDoc()}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold text-white"
                  style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
                >
                  <Plus size={12} /> New Doc
                </button>
                <button
                  onClick={() => setShowNewFolder(true)}
                  className="px-3 py-2 rounded-xl text-xs font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50"
                >
                  <FolderOpen size={14} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {/* Root docs */}
                {docs.filter(d => !d.folderId).map(d => (
                  <div
                    key={d.id}
                    onClick={() => openDocument(d)}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer group transition-colors ${openDoc?.id === d.id ? 'bg-[#d4a017]/10' : 'hover:bg-gray-100'}`}
                  >
                    <FileText size={13} className="text-gray-400 flex-shrink-0" />
                    <span className="text-xs text-gray-700 flex-1 truncate">{d.title || 'Untitled'}</span>
                    <ThreeDotMenu
                      onRename={() => handleRenameDoc(d)}
                      onDelete={() => setDeleteDocId(d.id)}
                    />
                  </div>
                ))}
                {/* Folders */}
                {rootFolders.map(f => (
                  <FolderNode
                    key={f.id}
                    folder={f}
                    folders={folders}
                    docs={docs}
                    activeFolderId={activeFolderId}
                    activeDocId={openDoc?.id || null}
                    onSelectFolder={setActiveFolderId}
                    onSelectDoc={openDocument}
                    onDeleteFolder={setDeleteFolderId}
                    onDeleteDoc={setDeleteDocId}
                    onRenameFolder={handleRenameFolder}
                    onRenameDoc={handleRenameDoc}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Editor area */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Save status — offset for floating back/sidebar buttons */}
            <div className="flex items-center justify-center h-8 flex-shrink-0 mt-10">
              {saveStatus === 'saving' && <span className="text-xs text-gray-400">Saving...</span>}
              {saveStatus === 'saved' && <span className="text-xs text-gray-400">Saved</span>}
            </div>
            <div className="flex-1 overflow-y-auto px-4 lg:px-16 pb-12">
              <input
                ref={titleRef}
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onBlur={handleTitleBlur}
                className="w-full text-3xl font-bold text-gray-900 bg-transparent border-none outline-none placeholder-gray-300 mb-6"
                placeholder="Untitled"
              />
              <RichTextEditor
                content={editContent}
                onChange={handleContentChange}
                minHeight="calc(100vh - 200px)"
                placeholder="Start writing... Type / for commands"
              />
            </div>
          </div>
        </div>

        {/* Modals inside focus mode */}
        {showNewFolder && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm p-5">
              <h3 className="font-bold text-gray-900 mb-4">New Folder</h3>
              <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createFolder()}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017] mb-4"
                placeholder="Folder name" autoFocus />
              <div className="flex gap-3">
                <button onClick={() => setShowNewFolder(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600">Cancel</button>
                <button onClick={createFolder} disabled={!newFolderName.trim()}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>Create</button>
              </div>
            </div>
          </div>
        )}
        {(deleteDocId || deleteFolderId) && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl p-6 w-full max-w-sm text-center">
              <p className="font-bold text-gray-900 mb-2">Delete {deleteDocId ? 'this document' : 'this folder'}?</p>
              <p className="text-sm text-gray-500 mb-5">This cannot be undone.</p>
              <div className="flex gap-3">
                <button onClick={() => { setDeleteDocId(null); setDeleteFolderId(null); }} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600">Cancel</button>
                <button onClick={deleteDocId ? confirmDeleteDoc : confirmDeleteFolder} className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold">Delete</button>
              </div>
            </div>
          </div>
        )}
        {renameFolderData && (
          <RenameModal
            title="Rename Folder"
            initialValue={renameFolderData.name}
            onConfirm={confirmRenameFolder}
            onCancel={() => setRenameFolderData(null)}
          />
        )}
        {renameDocData && (
          <RenameModal
            title="Rename Document"
            initialValue={renameDocData.name}
            onConfirm={confirmRenameDoc}
            onCancel={() => setRenameDocData(null)}
          />
        )}
        {moveDocId && (
          <div className="fixed inset-0 z-[210] flex items-end sm:items-center justify-center bg-black/50" onClick={() => setMoveDocId(null)}>
            <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-sm p-5 max-h-[60vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h3 className="font-bold text-gray-900 mb-4">Move to Folder</h3>
              <button
                onClick={() => moveDocToFolder(moveDocId, null)}
                className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl hover:bg-gray-100 transition-colors text-sm text-gray-700 mb-1"
              >
                <FileText size={14} className="text-gray-400" /> No Folder (Root)
              </button>
              {folders.map(f => (
                <button
                  key={f.id}
                  onClick={() => moveDocToFolder(moveDocId, f.id)}
                  className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl hover:bg-gray-100 transition-colors text-sm text-gray-700 mb-1"
                >
                  <Folder size={14} style={{ color: 'var(--brand-color, #d4a017)' }} /> {f.name}
                </button>
              ))}
              <button
                onClick={() => setMoveDocId(null)}
                className="w-full py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 mt-3"
              >Cancel</button>
            </div>
          </div>
        )}
      </FocusScreen>
    );
  }

  // ── List view ──
  if (loading) {
    return <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #d4a017)', borderTopColor: 'transparent' }} /></div>;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <FileText size={22} style={{ color: 'var(--brand-color, #d4a017)' }} />
          <h2 className="text-xl font-bold text-gray-900">Docs</h2>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowNewFolder(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            <FolderOpen size={15} /> New Folder
          </button>
          <button
            onClick={() => createDoc()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
            style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
          >
            <Plus size={16} /> New Doc
          </button>
        </div>
      </div>

      {/* Folders */}
      {folders.length > 0 && (
        <div className="mb-5">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Folders</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {rootFolders.map(f => (
              <div
                key={f.id}
                className={`relative group flex items-center gap-2 p-3 rounded-2xl border transition-all text-left ${activeFolderId === f.id ? 'border-[#d4a017]/40 bg-[#d4a017]/5' : 'border-gray-100 bg-white hover:border-gray-200 shadow-sm'}`}
              >
                <button
                  onClick={() => setActiveFolderId(activeFolderId === f.id ? null : f.id)}
                  className="flex items-center gap-2 flex-1 min-w-0"
                >
                  <Folder size={16} style={{ color: 'var(--brand-color, #d4a017)' }} />
                  <span className="text-xs font-semibold text-gray-800 truncate">{f.name}</span>
                </button>
                <ThreeDotMenu
                  onRename={() => handleRenameFolder(f)}
                  onDelete={() => setDeleteFolderId(f.id)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Docs grid */}
      {folderDocs.length === 0 && docs.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No documents yet</p>
          <p className="text-sm mt-1">Create your first document</p>
        </div>
      ) : (
        <>
          {activeFolderId && (
            <div className="flex items-center gap-2 mb-3">
              <button onClick={() => setActiveFolderId(null)} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                <ArrowLeft size={12} /> All docs
              </button>
              <span className="text-xs text-gray-400">/</span>
              <span className="text-xs font-semibold text-gray-700">{folders.find(f => f.id === activeFolderId)?.name}</span>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {folderDocs.map(d => (
              <div
                key={d.id}
                onClick={() => openDocument(d)}
                className="relative bg-white rounded-2xl p-4 border border-gray-100 shadow-sm cursor-pointer hover:border-[#d4a017]/40 hover:shadow-md transition-all group"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <FileText size={18} className="text-gray-300 flex-shrink-0 mt-0.5" />
                  <ThreeDotMenu
                    onRename={() => handleRenameDoc(d)}
                    onDelete={() => setDeleteDocId(d.id)}
                  />
                </div>
                <p className="font-semibold text-gray-900 text-sm truncate">{d.title || 'Untitled'}</p>
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
        </>
      )}

      {/* New folder modal */}
      {showNewFolder && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5">
            <h3 className="font-bold text-gray-900 mb-4">New Folder</h3>
            <input
              value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createFolder()}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#d4a017] mb-4"
              placeholder="Folder name" autoFocus
            />
            <div className="flex gap-3">
              <button onClick={() => { setShowNewFolder(false); setNewFolderName(''); }} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600">Cancel</button>
              <button onClick={createFolder} disabled={!newFolderName.trim()}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>Create</button>
            </div>
          </div>
        </div>
      )}

      {deleteDocId && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm text-center">
            <p className="font-bold text-gray-900 mb-2">Delete this document?</p>
            <p className="text-sm text-gray-500 mb-5">This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteDocId(null)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600">Cancel</button>
              <button onClick={confirmDeleteDoc} className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold">Delete</button>
            </div>
          </div>
        </div>
      )}

      {deleteFolderId && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm text-center">
            <p className="font-bold text-gray-900 mb-2">Delete this folder?</p>
            <p className="text-sm text-gray-500 mb-5">This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteFolderId(null)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600">Cancel</button>
              <button onClick={confirmDeleteFolder} className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold">Delete</button>
            </div>
          </div>
        </div>
      )}

      {renameFolderData && (
        <RenameModal
          title="Rename Folder"
          initialValue={renameFolderData.name}
          onConfirm={confirmRenameFolder}
          onCancel={() => setRenameFolderData(null)}
        />
      )}
      {renameDocData && (
        <RenameModal
          title="Rename Document"
          initialValue={renameDocData.name}
          onConfirm={confirmRenameDoc}
          onCancel={() => setRenameDocData(null)}
        />
      )}
      {/* Move to Folder bottom sheet */}
      {moveDocId && (
        <div className="fixed inset-0 z-[210] flex items-end sm:items-center justify-center bg-black/50" onClick={() => setMoveDocId(null)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-sm p-5 max-h-[60vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900 mb-4">Move to Folder</h3>
            <button
              onClick={() => moveDocToFolder(moveDocId, null)}
              className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl hover:bg-gray-100 transition-colors text-sm text-gray-700 mb-1"
            >
              <FileText size={14} className="text-gray-400" /> No Folder (Root)
            </button>
            {folders.map(f => (
              <button
                key={f.id}
                onClick={() => moveDocToFolder(moveDocId, f.id)}
                className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl hover:bg-gray-100 transition-colors text-sm text-gray-700 mb-1"
              >
                <Folder size={14} style={{ color: 'var(--brand-color, #d4a017)' }} /> {f.name}
              </button>
            ))}
            <button
              onClick={() => setMoveDocId(null)}
              className="w-full py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 mt-3"
            >Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDocs;