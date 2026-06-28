"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, FileText, Trash2, Clock, FolderOpen, Folder, ChevronRight, ChevronDown,
  PanelLeft, X, ArrowLeft, MoreVertical, Edit2, Move, Pin, MoreHorizontal, Share2, Check, Download, Upload, Radio
} from 'lucide-react';
import {
  collection, query, where, addDoc, updateDoc, deleteDoc,
  doc, getDoc, serverTimestamp, Timestamp, getDocs, arrayUnion, arrayRemove
} from 'firebase/firestore';
import { toast } from 'sonner';
import { db, auth } from '../firebase';
import { notifyError } from '../utils/notify';
import { getPlanFeatures } from '../utils/plan-features';
import { hasPlatformOverride } from '../utils/tenant-scope';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../store/useAppStore';
import { useDocs, useDocFolders, useSharedDocs } from '../hooks/queries/useDocsQueries';
import { exportToPDF, exportToDOCX, exportToMarkdown } from '../utils/doc-export';
import { markdownToHtml, titleFromMarkdown } from '../utils/markdown-import';
import RichTextEditor from './RichTextEditor';
import FocusScreen from './FocusScreen';
import { useAdminHeader, HeaderActionButton } from './AdminScreenHeader';

import type { Doc, DocFolder } from '../hooks/queries/useDocsQueries';

interface AdminUser {
  id: string;
  name: string;
  email: string;
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

// ─── Rename Modal ──────────────────────────────────────────────

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
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gold mb-4"
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

// ─── Editor Header Menu ───────────────────────────────────────────

const EditorMenu: React.FC<{
  title: string;
  content: string;
  createdBy: string;
  currentUid: string;
  isPinned: boolean;
  onPin: () => void;
  onRename: () => void;
  onDelete: () => void;
  onShare: () => void;
  onShareToLivestream: () => void;
  canShareToLivestream: boolean;
}> = ({ title, content, createdBy, currentUid, isPinned, onPin, onRename, onDelete, onShare, onShareToLivestream, canShareToLivestream }) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleExportPDF = async () => {
    setOpen(false);
    try {
      await exportToPDF(title || 'Untitled', content);
      toast.success('Exported as PDF');
    } catch { toast.error('Failed to export PDF'); }
  };

  const handleExportDOCX = async () => {
    setOpen(false);
    try {
      await exportToDOCX(title || 'Untitled', content);
      toast.success('Exported as DOCX');
    } catch { toast.error('Failed to export DOCX'); }
  };

  const handleExportMD = () => {
    setOpen(false);
    try {
      exportToMarkdown(title || 'Untitled', content);
      toast.success('Exported as Markdown');
    } catch { toast.error('Failed to export Markdown'); }
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        aria-label="Document options"
      >
        <MoreHorizontal size={18} className="text-gray-500" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-lg border border-gray-100 z-[250] py-1">
          <div className="px-3 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Export</div>
          <button onClick={handleExportPDF}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
            <Download size={13} /> Export as PDF
          </button>
          <button onClick={handleExportDOCX}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
            <Download size={13} /> Export as DOCX
          </button>
          <button onClick={handleExportMD}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
            <Download size={13} /> Export as Markdown
          </button>
          {currentUid === createdBy && (
            <>
              <div className="border-t border-gray-100 my-1" />
              <button onClick={() => { setOpen(false); onShare(); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
                <Share2 size={13} /> Share with Admins
              </button>
            </>
          )}
          {canShareToLivestream && (
            <button onClick={() => { setOpen(false); onShareToLivestream(); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
              <Radio size={13} /> Share to Livestream
            </button>
          )}
          <div className="border-t border-gray-100 my-1" />
          <button onClick={() => { setOpen(false); onPin(); }}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
            <Pin size={13} /> {isPinned ? 'Unpin' : 'Pin to Top'}
          </button>
          <button onClick={() => { setOpen(false); onRename(); }}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
            <Edit2 size={13} /> Rename
          </button>
          <div className="border-t border-gray-100 my-1" />
          <button onClick={() => { setOpen(false); onDelete(); }}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-red-600 hover:bg-red-50">
            <Trash2 size={13} /> Delete
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Folder Tree Node ────────────────────────────────────────────────

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
  onMoveDoc?: (docId: string) => void;
  onPinDoc?: (docId: string, pinned: boolean) => void;
  depth?: number;
}> = ({ folder, folders, docs, activeFolderId, activeDocId, onSelectFolder, onSelectDoc, onDeleteFolder, onDeleteDoc, onRenameFolder, onRenameDoc, onMoveDoc, onPinDoc, depth = 0 }) => {
  const [open, setOpen] = useState(true);
  const childFolders = folders.filter(f => f.parentId === folder.id);
  const folderDocs = docs.filter(d => d.folderId === folder.id);
  const isActive = activeFolderId === folder.id;

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer group transition-colors ${isActive ? 'bg-[color-mix(in_srgb,var(--brand-color)_10%,transparent)]' : 'hover:bg-gray-100'}`}
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
              onMoveDoc={onMoveDoc}
              onPinDoc={onPinDoc}
              depth={depth + 1}
            />
          ))}
          {folderDocs.map(d => (
            <div
              key={d.id}
              onClick={() => onSelectDoc(d)}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer group transition-colors ${activeDocId === d.id ? 'bg-[color-mix(in_srgb,var(--brand-color)_10%,transparent)]' : 'hover:bg-gray-100'}`}
              style={{ paddingLeft: `${24 + depth * 16}px` }}
            >
              <FileText size={13} className="text-gray-400 flex-shrink-0" />
              <span className="text-xs text-gray-700 flex-1 truncate">{d.title || 'Untitled'}</span>
              <ThreeDotMenu
                onRename={() => onRenameDoc(d)}
                onDelete={() => onDeleteDoc(d.id)}
                onMove={onMoveDoc ? () => onMoveDoc(d.id) : undefined}
                onPin={onPinDoc ? () => onPinDoc(d.id, !!d.pinned) : undefined}
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

interface AdminDocsProps {
  /** Deep-link: open this doc on mount (e.g. from a chat attachment card). */
  initialDocId?: string;
  /** Called once the deep-linked doc has been opened, to clear the URL param. */
  onItemConsumed?: () => void;
}

const AdminDocs: React.FC<AdminDocsProps> = ({ initialDocId, onItemConsumed }) => {
  const { setHeaderAction } = useAdminHeader();
  const queryClient = useQueryClient();
  const { currentTenantId: tenantId, isAuthReady, tenantPlan } = useAppStore();

  // "Share to Livestream" is a Ministry-only feature. Platform-context super
  // admins (apex) always get it; on a tenant subdomain it's gated by the
  // tenant's plan, even for a super admin.
  const canShareToLivestream = hasPlatformOverride() || (tenantPlan ? getPlanFeatures(tenantPlan).sermonNotes : false);

  const { data: docs = [], isLoading: loading } = useDocs(tenantId, isAuthReady);
  const { data: folders = [] } = useDocFolders(tenantId, isAuthReady);
  const { data: sharedDocs = [] } = useSharedDocs(auth.currentUser?.uid);

  const [openDoc, setOpenDoc] = useState<Doc | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'idle'>('idle');
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);
  const [deleteFolderId, setDeleteFolderId] = useState<string | null>(null);
  const [moveDocId, setMoveDocId] = useState<string | null>(null);
  const [shareDocId, setShareDocId] = useState<string | null>(null);
  const [shareAdmins, setShareAdmins] = useState<AdminUser[]>([]);
  const [loadingAdmins, setLoadingAdmins] = useState(false);
  const [renameFolderData, setRenameFolderData] = useState<{ id: string; name: string } | null>(null);
  const [renameDocData, setRenameDocData] = useState<{ id: string; name: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [focusMode, setFocusMode] = useState(false);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const openDocument = (d: Doc) => {
    setOpenDoc(d);
    setEditTitle(d.title || '');
    setEditContent(d.content || '');
    setSaveStatus('idle');
    setFocusMode(true);
  };

  // Deep-link: open a specific doc when navigated to /admin/docs/:id
  // (e.g. tapping "Open Doc" on a chat attachment card).
  useEffect(() => {
    if (!initialDocId) return;
    const d = docs.find(x => x.id === initialDocId) || sharedDocs.find(x => x.id === initialDocId);
    if (d) { openDocument(d); onItemConsumed?.(); }
  }, [initialDocId, docs, sharedDocs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Publish the primary "New Doc" action into the shared header.
  useEffect(() => {
    setHeaderAction(<HeaderActionButton label="New Doc" onClick={() => createDoc()} />);
    return () => setHeaderAction(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveDoc = useCallback(async (id: string, title: string, content: string) => {
    setSaveStatus('saving');
    try {
      await updateDoc(doc(db, 'docs', id), { title, content, updatedAt: serverTimestamp() });
      setSaveStatus('saved');
      await queryClient.invalidateQueries({ queryKey: ['docs', tenantId] });
    } catch (e) { console.error(e); setSaveStatus('idle'); }
  }, [queryClient, tenantId]);

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
      await queryClient.invalidateQueries({ queryKey: ['docs', tenantId] });
    } catch (e) { notifyError('Failed to create document', e); }
  };

  const importInputRef = useRef<HTMLInputElement>(null);

  const importMarkdownFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const html = markdownToHtml(text);
      const title = titleFromMarkdown(text, file.name);
      const ref = await addDoc(collection(db, 'docs'), {
        title,
        content: html,
        folderId: null,
        tenantId: tenantId || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: auth.currentUser?.uid || '',
        isPrivate: true,
        sharedWith: [],
        pinned: false,
      });
      const newDoc: Doc = {
        id: ref.id, title, content: html, folderId: null,
        createdBy: auth.currentUser?.uid || '', createdAt: null, updatedAt: null,
        isPrivate: true, sharedWith: [],
      };
      setOpenDoc(newDoc);
      setEditTitle(title);
      setEditContent(html);
      setSaveStatus('idle');
      setFocusMode(true);
      await queryClient.invalidateQueries({ queryKey: ['docs', tenantId] });
      toast.success('Note imported successfully');
    } catch (err) {
      console.error('Markdown import failed', err);
      toast.error('Could not import file — check it is a valid .md file');
    }
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
      await queryClient.invalidateQueries({ queryKey: ['docFolders', tenantId] });
    } catch (e) { notifyError('Failed to create folder', e); }
  };

  const confirmDeleteDoc = async () => {
    if (!deleteDocId) return;
    if (openDoc?.id === deleteDocId) { setOpenDoc(null); setFocusMode(false); }
    try {
      await deleteDoc(doc(db, 'docs', deleteDocId));
      await queryClient.invalidateQueries({ queryKey: ['docs', tenantId] });
    } catch (e) { notifyError('Failed to delete document', e); }
    setDeleteDocId(null);
  };

  const moveDocToFolder = async (docId: string, folderId: string | null) => {
    try {
      await updateDoc(doc(db, 'docs', docId), { folderId, updatedAt: serverTimestamp() });
      setMoveDocId(null);
      await queryClient.invalidateQueries({ queryKey: ['docs', tenantId] });
    } catch (e) { notifyError('Failed to move document', e); }
  };

  const togglePinDoc = async (docId: string, currentPinned: boolean) => {
    try {
      await updateDoc(doc(db, 'docs', docId), { pinned: !currentPinned });
      await queryClient.invalidateQueries({ queryKey: ['docs', tenantId] });
    } catch (e) { notifyError('Failed to toggle pin', e); }
  };

  const confirmDeleteFolder = async () => {
    if (!deleteFolderId) return;
    try {
      await deleteDoc(doc(db, 'docFolders', deleteFolderId));
      await queryClient.invalidateQueries({ queryKey: ['docFolders', tenantId] });
    } catch (e) { notifyError('Failed to delete folder', e); }
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
      await queryClient.invalidateQueries({ queryKey: ['docFolders', tenantId] });
    } catch (e) { notifyError('Failed to rename folder', e); }
    setRenameFolderData(null);
  };

  const confirmRenameDoc = async (newName: string) => {
    if (!renameDocData || !newName.trim()) return;
    try {
      await updateDoc(doc(db, 'docs', renameDocData.id), { title: newName.trim(), updatedAt: serverTimestamp() });
      if (openDoc?.id === renameDocData.id) setEditTitle(newName.trim());
      await queryClient.invalidateQueries({ queryKey: ['docs', tenantId] });
    } catch (e) { notifyError('Failed to rename document', e); }
    setRenameDocData(null);
  };

  const openShareModal = async (docId: string) => {
    setShareDocId(docId);
    setLoadingAdmins(true);
    try {
      if (!tenantId) { setShareAdmins([]); setLoadingAdmins(false); return; }
      // Single-field filter only (tenantId); role filtered in-memory to avoid a composite index.
      const q = query(
        collection(db, 'users'),
        where('tenantId', '==', tenantId)
      );
      const snap = await getDocs(q);
      const admins: AdminUser[] = snap.docs
        .filter(d => d.id !== auth.currentUser?.uid && (d.data() as any).role === 'admin')
        .map(d => ({
          id: d.id,
          name: `${d.data().firstName || ''} ${d.data().lastName || ''}`.trim() || d.data().email || d.id,
          email: d.data().email || '',
        }));
      setShareAdmins(admins);
    } catch (e) {
      console.error('Failed to load admins', e);
      setShareAdmins([]);
    } finally {
      setLoadingAdmins(false);
    }
  };

  const toggleShare = async (docId: string, adminUid: string, isCurrentlyShared: boolean) => {
    try {
      await updateDoc(doc(db, 'docs', docId), {
        sharedWith: isCurrentlyShared ? arrayRemove(adminUid) : arrayUnion(adminUid),
      });
      await queryClient.invalidateQueries({ queryKey: ['docs', tenantId] });
      await queryClient.invalidateQueries({ queryKey: ['sharedDocs', auth.currentUser?.uid] });
    } catch (e) { notifyError('Failed to update sharing', e); }
  };

  // Share this note to the currently-live stream so viewers see it read-only.
  // There is only ever one active stream (livestream/current); if none is live,
  // surface an error instead of silently no-op'ing.
  const handleShareToLivestream = async (docId: string, title: string, contentHtml: string) => {
    if (!tenantId) return;
    try {
      const currentRef = doc(db, 'tenants', tenantId, 'livestream', 'current');
      const snap = await getDoc(currentRef);
      const data = snap.data();

      if (!data?.active) {
        toast.error('No livestream is currently active. Start a stream first.');
        return;
      }

      await updateDoc(currentRef, {
        sermonNote: {
          docId,
          title: title || 'Untitled',
          contentHtml,
          sharedAt: serverTimestamp(),
          sharedBy: auth.currentUser?.uid || '',
        },
      });
      toast.success('Sermon notes shared to livestream');
    } catch (e) {
      notifyError('Failed to share to livestream', e);
    }
  };

  const rootFolders = folders.filter(f => !f.parentId);
  const rootDocs = docs.filter(d => !d.folderId).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  const folderDocs = activeFolderId
    ? docs.filter(d => d.folderId === activeFolderId).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
    : rootDocs;

  // Share modal (used in both focus and list views)
  const shareModal = shareDocId ? (
    <div className="fixed inset-0 z-[320] flex items-end sm:items-center justify-center bg-black/50" onClick={() => setShareDocId(null)}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-sm max-h-[65vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-bold text-gray-900">Share with Admins</h3>
          <button onClick={() => setShareDocId(null)} className="p-1 rounded-lg hover:bg-gray-100">
            <X size={18} className="text-gray-400" />
          </button>
        </div>
        {loadingAdmins ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #d4a017)', borderTopColor: 'transparent' }} />
          </div>
        ) : shareAdmins.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No other admins found.</p>
        ) : (
          <div className="p-3 space-y-1">
            {shareAdmins.map(admin => {
              const currentDoc = docs.find(d => d.id === shareDocId);
              const isShared = currentDoc?.sharedWith?.includes(admin.id) ?? false;
              return (
                <button
                  key={admin.id}
                  onClick={() => toggleShare(shareDocId, admin.id, isShared)}
                  className="flex items-center justify-between w-full px-4 py-3 rounded-xl hover:bg-gray-50 transition-colors"
                >
                  <div className="text-left">
                    <p className="text-sm font-semibold text-gray-800">{admin.name}</p>
                    {admin.email && <p className="text-xs text-gray-400">{admin.email}</p>}
                  </div>
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${isShared ? 'bg-gold border-gold' : 'border-gray-300'}`}>
                    {isShared && <Check size={12} className="text-white" />}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  ) : null;

  // Common modals (rename, delete, move)
  const commonModals = (
    <>
      {showNewFolder && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5">
            <h3 className="font-bold text-gray-900 mb-4">New Folder</h3>
            <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createFolder()}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gold mb-4"
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
      {shareModal}
    </>
  );

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
        headerCenter={<span className="text-xs text-gray-400">{saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : ''}</span>}
        headerRight={
          <EditorMenu
            title={editTitle}
            content={editContent}
            createdBy={openDoc.createdBy}
            currentUid={auth.currentUser?.uid || ''}
            isPinned={!!openDoc.pinned}
            onPin={() => togglePinDoc(openDoc.id, !!openDoc.pinned)}
            onRename={() => setRenameDocData({ id: openDoc.id, name: editTitle })}
            onDelete={() => setDeleteDocId(openDoc.id)}
            onShare={() => openShareModal(openDoc.id)}
            canShareToLivestream={canShareToLivestream}
            onShareToLivestream={() => handleShareToLivestream(openDoc.id, editTitle, editContent)}
          />
        }
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
                {docs.filter(d => !d.folderId).map(d => (
                  <div
                    key={d.id}
                    onClick={() => openDocument(d)}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer group transition-colors ${openDoc?.id === d.id ? 'bg-[color-mix(in_srgb,var(--brand-color)_10%,transparent)]' : 'hover:bg-gray-100'}`}
                  >
                    <FileText size={13} className="text-gray-400 flex-shrink-0" />
                    <span className="text-xs text-gray-700 flex-1 truncate">{d.title || 'Untitled'}</span>
                    <ThreeDotMenu
                      onRename={() => handleRenameDoc(d)}
                      onDelete={() => setDeleteDocId(d.id)}
                      onMove={() => setMoveDocId(d.id)}
                      onPin={() => togglePinDoc(d.id, !!d.pinned)}
                      isPinned={!!d.pinned}
                    />
                  </div>
                ))}
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
                    onMoveDoc={setMoveDocId}
                    onPinDoc={togglePinDoc}
                  />
                ))}
                {sharedDocs.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-2 mb-1">Shared with Me</p>
                    {sharedDocs.map(d => (
                      <div
                        key={d.id}
                        onClick={() => openDocument(d)}
                        className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer group transition-colors ${openDoc?.id === d.id ? 'bg-[color-mix(in_srgb,var(--brand-color)_10%,transparent)]' : 'hover:bg-gray-100'}`}
                      >
                        <Share2 size={13} className="text-gray-400 flex-shrink-0" />
                        <span className="text-xs text-gray-700 flex-1 truncate">{d.title || 'Untitled'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Editor area */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-4 lg:px-16 pb-12">
              <input
                ref={titleRef}
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onBlur={handleTitleBlur}
                className="w-full text-3xl font-bold text-gray-900 bg-transparent border-none outline-none placeholder-gray-300 mb-6 mt-6"
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

        {commonModals}
      </FocusScreen>
    );
  }

  // ── List view ──
  if (loading) {
    return <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #d4a017)', borderTopColor: 'transparent' }} /></div>;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-end gap-2 mb-6">
        <input
          ref={importInputRef}
          type="file"
          accept=".md,.markdown,text/markdown,text/plain"
          onChange={importMarkdownFile}
          className="hidden"
        />
        <button
          onClick={() => importInputRef.current?.click()}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50"
          title="Import a .md file"
        >
          <Upload size={15} /> Import
        </button>
        <button
          onClick={() => setShowNewFolder(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50"
        >
          <FolderOpen size={15} /> New Folder
        </button>
      </div>

      {folders.length > 0 && (
        <div className="mb-5">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Folders</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {rootFolders.map(f => (
              <div
                key={f.id}
                className={`relative group flex items-center gap-2 p-3 rounded-2xl border transition-all text-left ${activeFolderId === f.id ? 'border-[color-mix(in_srgb,var(--brand-color)_40%,transparent)] bg-[color-mix(in_srgb,var(--brand-color)_5%,transparent)]' : 'border-gray-100 bg-white hover:border-gray-200 shadow-sm'}`}
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

      {sharedDocs.length > 0 && !activeFolderId && (
        <div className="mb-5">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Shared with Me</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sharedDocs.map(d => (
              <div
                key={d.id}
                onClick={() => openDocument(d)}
                className="relative bg-white rounded-2xl p-4 border border-gray-100 shadow-sm cursor-pointer hover:border-[color-mix(in_srgb,var(--brand-color)_40%,transparent)] hover:shadow-md transition-all group"
              >
                <div className="flex items-start gap-2 mb-2">
                  <Share2 size={18} className="text-gray-300 flex-shrink-0 mt-0.5" />
                </div>
                <p className="font-semibold text-gray-900 text-sm truncate">{d.title || 'Untitled'}</p>
                {d.updatedAt && (
                  <div className="flex items-center gap-1 mt-3 text-[10px] text-gray-400">
                    <Clock size={10} />
                    {fmtDate(d.updatedAt)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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
                className="relative bg-white rounded-2xl p-4 border border-gray-100 shadow-sm cursor-pointer hover:border-[color-mix(in_srgb,var(--brand-color)_40%,transparent)] hover:shadow-md transition-all group"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <FileText size={18} className="text-gray-300 flex-shrink-0 mt-0.5" />
                  <ThreeDotMenu
                    onRename={() => handleRenameDoc(d)}
                    onDelete={() => setDeleteDocId(d.id)}
                    onMove={() => setMoveDocId(d.id)}
                    onPin={() => togglePinDoc(d.id, !!d.pinned)}
                    isPinned={!!d.pinned}
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

      {commonModals}
    </div>
  );
};

export default AdminDocs;