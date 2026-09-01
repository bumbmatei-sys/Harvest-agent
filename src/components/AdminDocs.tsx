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
import { hasPlatformOverride, PLATFORM_TENANT_ID } from '../utils/tenant-scope';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../store/useAppStore';
import { useDocs, useDocFolders, useSharedDocs } from '../hooks/queries/useDocsQueries';
import { exportToPDF, exportToDOCX, exportToMarkdown } from '../utils/doc-export';
import { markdownToHtml, titleFromMarkdown } from '../utils/markdown-import';
import RichTextEditor from './RichTextEditor';
import { useAdminHeader, HeaderActionButton } from './AdminScreenHeader';
import { AdminPageHeader, AdminPrimaryButton, AdminSecondaryButton, AdminBadge } from './admin/AdminUI';
import { FORM_CONTAINER } from './layout/form-layout';

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
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-surface-sunken transition-all"
      >
        <MoreVertical size={14} className="text-faint hover:text-muted" />
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 w-36 bg-surface-raised rounded-lg shadow-lg border border-line z-50 py-1">
          {onMove && (
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onMove(); }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-body hover:bg-surface-sunken rounded-lg"
            >
              <Move size={12} /> Move to Folder
            </button>
          )}
          {onPin && (
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onPin(); }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-body hover:bg-surface-sunken rounded-lg"
            >
              <Pin size={12} /> {isPinned ? 'Unpin' : 'Pin to Top'}
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onRename(); }}
            className="w-full flex items-center gap-2 text-left px-3 py-2 text-xs text-body hover:bg-surface-sunken"
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
      <div className="bg-surface-raised rounded-2xl w-full max-w-sm p-5">
        <h3 className="font-display font-bold text-strong mb-4">{title}</h3>
        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onConfirm(value); if (e.key === 'Escape') onCancel(); }}
          className="w-full border border-line rounded-xl px-3 py-2.5 text-sm focus:outline-hidden focus:border-gold mb-4"
          placeholder="Name"
          autoFocus
        />
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-line text-sm font-semibold text-muted">Cancel</button>
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
  /** When set, the trigger renders as a labelled button (e.g. "Export") instead of a ⋯ icon. */
  triggerLabel?: string;
}> = ({ title, content, createdBy, currentUid, isPinned, onPin, onRename, onDelete, onShare, onShareToLivestream, canShareToLivestream, triggerLabel }) => {
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
      {triggerLabel ? (
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-brand border border-line text-[13px] font-semibold text-strong hover:bg-surface-sunken transition-colors"
        >
          <Download size={15} /> {triggerLabel}
        </button>
      ) : (
        <button
          onClick={() => setOpen(!open)}
          className="p-1.5 rounded-lg hover:bg-surface-sunken transition-colors"
          aria-label="Document options"
        >
          <MoreHorizontal size={18} className="text-muted" />
        </button>
      )}
      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-surface-raised rounded-xl shadow-lg border border-line z-[250] py-1">
          <div className="px-3 py-1 text-[10px] font-bold text-faint uppercase tracking-wider">Export</div>
          <button onClick={handleExportPDF}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-body hover:bg-surface-sunken">
            <Download size={13} /> Export as PDF
          </button>
          <button onClick={handleExportDOCX}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-body hover:bg-surface-sunken">
            <Download size={13} /> Export as DOCX
          </button>
          <button onClick={handleExportMD}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-body hover:bg-surface-sunken">
            <Download size={13} /> Export as Markdown
          </button>
          {currentUid === createdBy && (
            <>
              <div className="border-t border-line my-1" />
              <button onClick={() => { setOpen(false); onShare(); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-body hover:bg-surface-sunken">
                <Share2 size={13} /> Share with Admins
              </button>
            </>
          )}
          {canShareToLivestream && (
            <button onClick={() => { setOpen(false); onShareToLivestream(); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-body hover:bg-surface-sunken">
              <Radio size={13} /> Share to Livestream
            </button>
          )}
          <div className="border-t border-line my-1" />
          <button onClick={() => { setOpen(false); onPin(); }}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-body hover:bg-surface-sunken">
            <Pin size={13} /> {isPinned ? 'Unpin' : 'Pin to Top'}
          </button>
          <button onClick={() => { setOpen(false); onRename(); }}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-body hover:bg-surface-sunken">
            <Edit2 size={13} /> Rename
          </button>
          <div className="border-t border-line my-1" />
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
        className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer group transition-colors ${isActive ? 'bg-[color-mix(in_srgb,var(--brand-color)_10%,transparent)]' : 'hover:bg-surface-sunken'}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => { setOpen(!open); onSelectFolder(folder.id); }}
      >
        {open ? <ChevronDown size={13} className="text-faint flex-shrink-0" /> : <ChevronRight size={13} className="text-faint flex-shrink-0" />}
        {open ? <FolderOpen size={14} style={{ color: 'var(--brand-color, #d4a017)' }} className="flex-shrink-0" /> : <Folder size={14} className="text-faint flex-shrink-0" />}
        <span className="text-xs font-medium text-body flex-1 truncate">{folder.name}</span>
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
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer group transition-colors ${activeDocId === d.id ? 'bg-[color-mix(in_srgb,var(--brand-color)_10%,transparent)]' : 'hover:bg-surface-sunken'}`}
              style={{ paddingLeft: `${24 + depth * 16}px` }}
            >
              <FileText size={13} className="text-faint flex-shrink-0" />
              <span className="text-xs text-body flex-1 truncate">{d.title || 'Untitled'}</span>
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
  const { setHeaderAction, setHeaderHidden } = useAdminHeader();
  const queryClient = useQueryClient();
  // Fall back to the platform tenant for a super admin if the store value is
  // briefly null so created docs/folders are never orphaned with a null
  // tenantId. On a tenant subdomain currentTenantId is set and takes precedence.
  const { currentTenantId, isAuthReady, tenantPlan, isSuperAdmin } = useAppStore();
  const tenantId = currentTenantId || (isSuperAdmin ? PLATFORM_TENANT_ID : null);

  // "Share to Livestream" is a Small Team (pro) and above feature. Platform-context super
  // admins (apex) always get it; on a tenant subdomain it's gated by the
  // tenant's plan, even for a super admin.
  const canShareToLivestream = hasPlatformOverride() || (tenantPlan ? getPlanFeatures(tenantPlan).sermonNotes : false);

  const { data: docs = [], isLoading: loading } = useDocs(tenantId, isAuthReady);
  const { data: folders = [] } = useDocFolders(tenantId, isAuthReady);
  const { data: sharedDocs = [] } = useSharedDocs(auth.currentUser?.uid);

  const [openDoc, setOpenDoc] = useState<Doc | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  // 'error' is a real, sticky state: without it a failed write fell back to
  // 'idle', which the status chip renders as an empty string — the "Saving…"
  // text simply vanished and a lost save looked exactly like a document nobody
  // had touched.
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'idle' | 'error'>('idle');
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);
  const [deleteFolderId, setDeleteFolderId] = useState<string | null>(null);
  const [moveDocId, setMoveDocId] = useState<string | null>(null);
  const [shareDocId, setShareDocId] = useState<string | null>(null);
  const [shareAdmins, setShareAdmins] = useState<AdminUser[]>([]);
  const [loadingAdmins, setLoadingAdmins] = useState(false);
  const [renameFolderData, setRenameFolderData] = useState<{ id: string; name: string } | null>(null);
  const [renameDocData, setRenameDocData] = useState<{ id: string; name: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Mobile-only presentational UI state: whether the slide-in notes/folders
  // drawer is open. On desktop the same content lives in the always-visible
  // left rail, so this is never used there.
  const [mobileNotesOpen, setMobileNotesOpen] = useState(false);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  // Inline "create folder while moving a doc" (used in the Move-to-Folder modal).
  const [moveCreating, setMoveCreating] = useState(false);
  const [moveFolderName, setMoveFolderName] = useState('');
  const [focusMode, setFocusMode] = useState(false);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  // The exact payload the queued auto-save will write. Held here rather than
  // captured in the setTimeout closure so the title can be kept current while
  // the timer runs: the debounce is scheduled on a CONTENT keystroke, so it
  // carries whatever title existed up to 2s earlier, and writing that would put
  // a stale title back over one the user has since typed — including one a title
  // blur has already saved. `id` travels with it so a payload queued for one
  // document can never be redirected at another.
  const pendingSave = useRef<{ id: string; title: string; content: string } | null>(null);
  // Cleared by the unmount cleanup so the flush it fires can finish its Firestore
  // write — the SDK owns that, not React — without setState-ing a component that
  // is already gone.
  const isMounted = useRef(true);
  // Only the most recently issued write may drive the status chip and the error
  // toast. An older save failing after a newer one succeeded means the newer
  // content is already on the server, so the failure is moot and must not raise
  // an alarm the user cannot act on.
  const saveSeq = useRef(0);

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

  // While a note is open (focus mode) hide the mobile app header so the editor is
  // fullscreen. The editor keeps its own toolbar row (sidebar toggle · back to
  // Notes · broadcast · Export), so there is still a way back. Always restore the
  // header on exit and on unmount so you can never get stuck headerless.
  const editorFullscreen = focusMode && !!openDoc;
  useEffect(() => {
    setHeaderHidden(editorFullscreen);
    return () => setHeaderHidden(false);
  }, [editorFullscreen, setHeaderHidden]);

  /**
   * The single writer for a document. Resolves true only once the write is on
   * the server, so callers can decide what to do about a failure instead of
   * carrying on as though it had worked.
   */
  const saveDoc = useCallback(async (id: string, title: string, content: string): Promise<boolean> => {
    const seq = ++saveSeq.current;
    const isLatest = () => saveSeq.current === seq;
    if (isMounted.current) setSaveStatus('saving');
    try {
      // A whitespace-only title is stored as '' so the `title || 'Untitled'`
      // fallback that every card, sidebar row and export already applies
      // actually fires — ' ' is truthy and would render as a blank name.
      await updateDoc(doc(db, 'docs', id), { title: title.trim(), content, updatedAt: serverTimestamp() });
      if (isLatest() && isMounted.current) setSaveStatus('saved');
      await queryClient.invalidateQueries({ queryKey: ['docs', tenantId] });
      return true;
    } catch (e) {
      console.error('Failed to save note', e);
      if (isLatest()) {
        if (isMounted.current) setSaveStatus('error');
        // The toast is NOT gated on isMounted: the Toaster lives in the root
        // layout, so a save that fails as the screen goes away can still say so.
        // A fixed id means a run of failures (offline) replaces rather than stacks.
        toast.error('Could not save this note — your changes are still here. Try again.', { id: 'doc-save-error' });
      }
      return false;
    }
  }, [queryClient, tenantId]);

  /** Drop the queued auto-save without writing it (the document is going away). */
  const cancelPendingSave = useCallback(() => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    pendingSave.current = null;
  }, []);

  /**
   * Write whatever the debounce has not written yet, now. Resolves true when
   * there was nothing queued or the queued write landed.
   */
  const flushPendingSave = useCallback((): Promise<boolean> => {
    const pending = pendingSave.current;
    cancelPendingSave();
    if (!pending) return Promise.resolve(true);
    return saveDoc(pending.id, pending.title, pending.content);
  }, [cancelPendingSave, saveDoc]);

  // Flush on unmount instead of leaving the timer to fire into a component that
  // no longer exists.
  //
  // What the un-cleared timer actually did: `updateDoc` belongs to the Firestore
  // SDK, not to React, so the write still went out and the text was NOT lost —
  // the opposite of CanvasEditor, which cleared its timer and dropped the work.
  // What it did do is fire up to 2s after the screen was gone, and that window
  // is exactly where a tab close or hard navigation kills the write (no
  // IndexedDB persistence is enabled here, so queued mutations are in memory
  // only). It also ran setSaveStatus on an unmounted component — a no-op under
  // React 18, but only by luck. Flushing closes the window and makes the exit
  // deterministic; `isMounted` goes false first so the flush's own status
  // updates are skipped while its write proceeds.
  const flushRef = useRef(flushPendingSave);
  useEffect(() => { flushRef.current = flushPendingSave; }, [flushPendingSave]);
  useEffect(() => {
    // Re-armed on mount so a StrictMode remount doesn't inherit `false`.
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      void flushRef.current();
    };
  }, []);

  const handleContentChange = (content: string) => {
    setEditContent(content);
    if (openDoc) {
      setSaveStatus('saving');
      pendingSave.current = { id: openDoc.id, title: editTitle, content };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { void flushPendingSave(); }, 2000);
    }
  };

  const handleTitleBlur = () => {
    if (!openDoc) return;
    // No `editTitle.trim()` guard: an untitled note is still the user's work,
    // and skipping the write here also meant clearing a title never persisted.
    // Absorb the queued content save rather than racing it — this write already
    // carries the latest content, and letting the debounce land afterwards would
    // put the pre-blur title back on top of it.
    cancelPendingSave();
    void saveDoc(openDoc.id, editTitle, editContent);
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
    // Drop the queued auto-save before the document goes: flushing it would write
    // to a doc that is about to stop existing and raise a save error for a delete
    // the user asked for.
    if (openDoc?.id === deleteDocId) { cancelPendingSave(); setOpenDoc(null); setFocusMode(false); }
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

  // Create a new folder and move the doc straight into it (from the Move modal).
  const createFolderAndMove = async (docId: string, name: string) => {
    if (!name.trim()) return;
    try {
      const ref = await addDoc(collection(db, 'docFolders'), {
        name: name.trim(),
        parentId: null,
        tenantId: tenantId || null,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.uid || '',
        order: folders.length,
      });
      await updateDoc(doc(db, 'docs', docId), { folderId: ref.id, updatedAt: serverTimestamp() });
      setMoveDocId(null);
      setMoveCreating(false);
      setMoveFolderName('');
      await queryClient.invalidateQueries({ queryKey: ['docFolders', tenantId] });
      await queryClient.invalidateQueries({ queryKey: ['docs', tenantId] });
    } catch (e) { notifyError('Failed to create folder', e); }
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
      <div className="bg-surface-raised rounded-t-2xl sm:rounded-2xl w-full max-w-sm max-h-[65vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line sticky top-0 bg-surface-raised">
          <h3 className="font-display font-bold text-strong">Share with Admins</h3>
          <button onClick={() => setShareDocId(null)} className="p-1 rounded-lg hover:bg-surface-sunken">
            <X size={18} className="text-faint" />
          </button>
        </div>
        {loadingAdmins ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #d4a017)', borderTopColor: 'transparent' }} />
          </div>
        ) : shareAdmins.length === 0 ? (
          <p className="text-sm text-faint text-center py-8">No other admins found.</p>
        ) : (
          <div className="p-3 space-y-1">
            {shareAdmins.map(admin => {
              const currentDoc = docs.find(d => d.id === shareDocId);
              const isShared = currentDoc?.sharedWith?.includes(admin.id) ?? false;
              return (
                <button
                  key={admin.id}
                  onClick={() => toggleShare(shareDocId, admin.id, isShared)}
                  className="flex items-center justify-between w-full px-4 py-3 rounded-xl hover:bg-surface-sunken transition-colors"
                >
                  <div className="text-left">
                    <p className="text-sm font-semibold text-body">{admin.name}</p>
                    {admin.email && <p className="text-xs text-faint">{admin.email}</p>}
                  </div>
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${isShared ? 'bg-gold border-gold' : 'border-line-strong'}`}>
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
          <div className="bg-surface-raised rounded-2xl w-full max-w-sm p-5">
            <h3 className="font-display font-bold text-strong mb-4">New Folder</h3>
            <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createFolder()}
              className="w-full border border-line rounded-xl px-3 py-2.5 text-sm focus:outline-hidden focus:border-gold mb-4"
              placeholder="Folder name" autoFocus />
            <div className="flex gap-3">
              <button onClick={() => setShowNewFolder(false)} className="flex-1 py-2.5 rounded-xl border border-line text-sm font-semibold text-muted">Cancel</button>
              <button onClick={createFolder} disabled={!newFolderName.trim()}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>Create</button>
            </div>
          </div>
        </div>
      )}
      {(deleteDocId || deleteFolderId) && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-surface-raised rounded-2xl p-6 w-full max-w-sm text-center">
            <p className="font-display font-bold text-strong mb-2">Delete {deleteDocId ? 'this document' : 'this folder'}?</p>
            <p className="text-sm text-muted mb-5">This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => { setDeleteDocId(null); setDeleteFolderId(null); }} className="flex-1 py-2.5 rounded-xl border border-line text-sm font-semibold text-muted">Cancel</button>
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
        <div className="fixed inset-0 z-[210] flex items-end sm:items-center justify-center bg-black/50" onClick={() => { setMoveDocId(null); setMoveCreating(false); setMoveFolderName(''); }}>
          <div className="bg-surface-raised rounded-t-2xl sm:rounded-2xl w-full max-w-sm p-5 max-h-[65vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="font-display font-bold text-strong mb-4">Move to Folder</h3>
            <button
              onClick={() => moveDocToFolder(moveDocId, null)}
              className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl hover:bg-surface-sunken transition-colors text-sm text-body mb-1"
            >
              <FileText size={14} className="text-faint" /> No Folder (Root)
            </button>
            {folders.map(f => (
              <button
                key={f.id}
                onClick={() => moveDocToFolder(moveDocId, f.id)}
                className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl hover:bg-surface-sunken transition-colors text-sm text-body mb-1"
              >
                <Folder size={14} style={{ color: 'var(--brand-color, #d4a017)' }} /> {f.name}
              </button>
            ))}

            {/* Create a new folder inline (works even when there are no folders yet) */}
            {moveCreating ? (
              <div className="mt-2 pt-3 border-t border-line">
                <input
                  value={moveFolderName}
                  onChange={e => setMoveFolderName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createFolderAndMove(moveDocId, moveFolderName)}
                  placeholder="New folder name"
                  autoFocus
                  className="w-full border border-line rounded-xl px-3 py-2.5 text-sm focus:outline-hidden focus:border-gold mb-2"
                />
                <div className="flex gap-2">
                  <button onClick={() => { setMoveCreating(false); setMoveFolderName(''); }} className="flex-1 py-2 rounded-xl border border-line text-sm font-semibold text-muted">Back</button>
                  <button onClick={() => createFolderAndMove(moveDocId, moveFolderName)} disabled={!moveFolderName.trim()}
                    className="flex-1 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                    style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}>Create &amp; move</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setMoveCreating(true)}
                className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl hover:bg-[color-mix(in_srgb,var(--brand-color)_10%,transparent)] transition-colors text-sm font-semibold text-gold mb-1 mt-1"
              >
                <Plus size={14} /> New folder…
              </button>
            )}

            <button
              onClick={() => { setMoveDocId(null); setMoveCreating(false); setMoveFolderName(''); }}
              className="w-full py-2.5 rounded-xl border border-line text-sm font-semibold text-muted mt-3"
            >Cancel</button>
          </div>
        </div>
      )}
      {shareModal}
    </>
  );

  // Notes list + folder tree shared by the desktop left rail and the mobile
  // slide-in drawer. Same content, same handlers — the optional `onNavigate`
  // (passed only by the drawer) additionally closes the drawer after a note or
  // folder is chosen. On desktop it is undefined, so behaviour is unchanged.
  const renderNotesSidebar = (onNavigate?: () => void) => (
    <>
      <div className="p-3 border-b border-line flex gap-2">
        <button
          onClick={() => { createDoc(); onNavigate?.(); }}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-brand text-xs font-semibold text-white"
          style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
        >
          <Plus size={13} /> New doc
        </button>
        <button
          onClick={() => setShowNewFolder(true)}
          className="px-3 py-2 rounded-brand border border-line text-muted hover:bg-surface-sunken"
          title="New folder"
        >
          <FolderOpen size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {docs.filter(d => !d.folderId).map(d => {
          const isOpen = openDoc?.id === d.id;
          return (
            <div
              key={d.id}
              onClick={() => { openDocument(d); onNavigate?.(); }}
              className={`flex items-center gap-1.5 px-2.5 py-2 rounded-brand cursor-pointer group transition-colors ${isOpen ? 'bg-[color-mix(in_srgb,var(--brand-color)_10%,transparent)]' : 'hover:bg-surface-sunken'}`}
            >
              <FileText size={13} className={`flex-shrink-0 ${isOpen ? 'text-gold' : 'text-faint'}`} />
              <span className={`text-xs flex-1 truncate ${isOpen ? 'text-strong font-semibold' : 'text-body'}`}>{d.title || 'Untitled'}</span>
              {d.pinned && <Pin size={11} className="text-gold flex-shrink-0" />}
              <ThreeDotMenu
                onRename={() => handleRenameDoc(d)}
                onDelete={() => setDeleteDocId(d.id)}
                onMove={() => setMoveDocId(d.id)}
                onPin={() => togglePinDoc(d.id, !!d.pinned)}
                isPinned={!!d.pinned}
              />
            </div>
          );
        })}
        {rootFolders.map(f => (
          <FolderNode
            key={f.id}
            folder={f}
            folders={folders}
            docs={docs}
            activeFolderId={activeFolderId}
            activeDocId={openDoc?.id || null}
            onSelectFolder={(id) => { setActiveFolderId(id); onNavigate?.(); }}
            onSelectDoc={(d) => { openDocument(d); onNavigate?.(); }}
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
            <p className="text-[10px] font-bold text-faint uppercase tracking-wider px-2 mb-1">Shared with Me</p>
            {sharedDocs.map(d => (
              <div
                key={d.id}
                onClick={() => { openDocument(d); onNavigate?.(); }}
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded-brand cursor-pointer group transition-colors ${openDoc?.id === d.id ? 'bg-[color-mix(in_srgb,var(--brand-color)_10%,transparent)]' : 'hover:bg-surface-sunken'}`}
              >
                <Share2 size={13} className="text-faint flex-shrink-0" />
                <span className="text-xs text-body flex-1 truncate">{d.title || 'Untitled'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );

  // ── Focus mode (full editor) ──
  if (focusMode && openDoc) {
    const closeEditor = async () => {
      // Save what is on screen — not just what the debounce happened to queue —
      // and do NOT leave until it lands. Closing over a failed write dropped the
      // user on a list where the error was no longer visible, while the only copy
      // of the text lived in the editor they had just left. Staying put keeps the
      // work on screen and makes "Notes" a retry button.
      //
      // The `editTitle.trim()` guard is gone: a note with content and a blank
      // title was previously never written on close, so everything typed since
      // the last debounce was silently discarded.
      cancelPendingSave();
      const ok = await saveDoc(openDoc.id, editTitle, editContent);
      if (!ok) return;
      setOpenDoc(null);
      setFocusMode(false);
    };
    return (
      <div className="lg:h-[calc(100dvh-140px)]">
        <div className="lg:flex lg:gap-5 lg:h-full">

          {/* Left rail: New doc + doc list (desktop; hidden on mobile) */}
          <div className={`hidden ${sidebarOpen ? 'lg:flex' : 'lg:hidden'} flex-col lg:w-[300px] lg:shrink-0 lg:min-h-0 bg-surface-raised rounded-brand-lg border border-line shadow-[var(--ds-sh-sm)] overflow-hidden`}>
            {renderNotesSidebar()}
          </div>

          {/* Right: editor pane */}
          <div className="flex-1 min-w-0 flex flex-col lg:min-h-0 bg-surface-raised rounded-brand-lg border border-line shadow-[var(--ds-sh-sm)] overflow-hidden">
            {/* Editor header — back · saved · Share to livestream · Export */}
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line shrink-0">
              <div className="flex items-center gap-1.5 min-w-0">
                {/* Mobile-only: open the slide-in notes/folders drawer (desktop shows the left rail instead). */}
                <button onClick={() => setMobileNotesOpen(true)} className="lg:hidden flex items-center gap-1 p-1.5 rounded-lg hover:bg-surface-sunken text-faint" title="All notes & folders" aria-label="Open notes and folders">
                  <PanelLeft size={16} />
                </button>
                <button onClick={() => setSidebarOpen(v => !v)} className="hidden lg:flex p-1.5 rounded-lg hover:bg-surface-sunken text-faint" title="Toggle document list">
                  <PanelLeft size={16} />
                </button>
                <button onClick={closeEditor} className="flex items-center gap-1.5 text-[13px] font-semibold text-gold hover:opacity-80 transition-opacity">
                  <ArrowLeft size={15} /> Notes
                </button>
              </div>
              {/* A failure stays on screen as "Not saved" rather than reverting to
                  the empty idle string, and — unlike the quiet Saving…/Saved chip —
                  shows on mobile too, where `hidden sm:block` would otherwise make
                  the only in-page signal of a lost save invisible. */}
              <span
                className={`text-xs ${saveStatus === 'error' ? 'block text-[color:var(--brand-danger)] font-semibold' : 'hidden sm:block text-faint'}`}
                role={saveStatus === 'error' ? 'alert' : undefined}
              >
                {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Not saved' : ''}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                {canShareToLivestream && (
                  <button
                    onClick={() => handleShareToLivestream(openDoc.id, editTitle, editContent)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-brand border border-line text-[13px] font-semibold text-strong hover:bg-surface-sunken transition-colors"
                  >
                    <Radio size={15} /> <span className="hidden sm:inline">Share to livestream</span>
                  </button>
                )}
                <EditorMenu
                  triggerLabel="Export"
                  title={editTitle}
                  content={editContent}
                  createdBy={openDoc.createdBy}
                  currentUid={auth.currentUser?.uid || ''}
                  isPinned={!!openDoc.pinned}
                  onPin={() => togglePinDoc(openDoc.id, !!openDoc.pinned)}
                  onRename={() => setRenameDocData({ id: openDoc.id, name: editTitle })}
                  onDelete={() => setDeleteDocId(openDoc.id)}
                  onShare={() => openShareModal(openDoc.id)}
                  canShareToLivestream={false}
                  onShareToLivestream={() => handleShareToLivestream(openDoc.id, editTitle, editContent)}
                />
              </div>
            </div>
            {/* Editor body */}
            <div className="flex-1 lg:overflow-y-auto px-5 lg:px-12 pb-12 docs-editor">
              <input
                ref={titleRef}
                value={editTitle}
                onChange={e => {
                  setEditTitle(e.target.value);
                  // Keep an already-queued auto-save pointed at the title the
                  // user has NOW, so the debounce can't write back the one that
                  // was on screen when the content keystroke scheduled it. Guarded
                  // by id so a payload queued for another document is left alone.
                  if (pendingSave.current && pendingSave.current.id === openDoc?.id) {
                    pendingSave.current.title = e.target.value;
                  }
                }}
                onBlur={handleTitleBlur}
                // THE-136: placeholder-stone-300 was a fixed light beige — 1.55:1
                // on the white card in light, and unthemed in dark. text-faint is
                // the placeholder role and clears AA on both grounds.
                className="w-full font-display text-4xl font-normal tracking-[-0.01em] text-strong bg-transparent border-none outline-hidden placeholder:text-faint mb-6 mt-6"
                placeholder="Untitled"
              />
              <RichTextEditor
                content={editContent}
                onChange={handleContentChange}
                minHeight="calc(100vh - 320px)"
                placeholder="Start writing... Type / for commands"
              />
            </div>
          </div>

        </div>

        {/* Mobile-only slide-in LEFT drawer: the full notes list + folder tree,
            the same content the desktop left rail shows. Selecting a note or
            folder reuses the existing handlers and then closes the drawer. */}
        {mobileNotesOpen && (
          <div className="fixed inset-0 z-[200] lg:hidden">
            <style>{`@keyframes docsDrawerIn { from { transform: translateX(-100%); } to { transform: translateX(0); } }`}</style>
            {/* Dim backdrop — tap to close */}
            <div
              className="absolute inset-0"
              style={{ backgroundColor: 'rgba(15,13,11,0.42)' }}
              onClick={() => setMobileNotesOpen(false)}
            />
            {/* Sliding cream panel */}
            <div
              className="absolute left-0 top-0 h-full w-[300px] max-w-[85%] bg-surface shadow-[12px_0_44px_rgba(0,0,0,0.28)] flex flex-col"
              style={{ animation: 'docsDrawerIn 0.25s ease-out' }}
            >
              <div className="flex items-center justify-between px-4 py-3 shrink-0">
                <h3 className="font-display font-bold text-strong">All Notes</h3>
                <button
                  onClick={() => setMobileNotesOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-surface-sunken text-faint"
                  aria-label="Close notes list"
                >
                  <X size={18} />
                </button>
              </div>
              {/* White card mirrors the desktop rail's look */}
              <div className="flex-1 min-h-0 mx-3 mb-3 flex flex-col bg-surface-raised rounded-brand-lg border border-line shadow-[var(--ds-sh-sm)] overflow-hidden">
                {renderNotesSidebar(() => setMobileNotesOpen(false))}
              </div>
            </div>
          </div>
        )}
        {commonModals}
      </div>
    );
  }

  // ── List view ──
  if (loading) {
    return <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand-color, #d4a017)', borderTopColor: 'transparent' }} /></div>;
  }

  return (
    <div className={`w-full ${FORM_CONTAINER}`}>
      <input
        ref={importInputRef}
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        onChange={importMarkdownFile}
        className="hidden"
      />
      <AdminPageHeader
        className="mb-6"
        eyebrow="Content"
        title="Notes & Docs"
        action={<div className="flex items-center gap-2.5">
          <AdminSecondaryButton onClick={() => importInputRef.current?.click()} title="Import a .md file">
            <Upload size={15} /> Import
          </AdminSecondaryButton>
          <AdminPrimaryButton onClick={() => createDoc()} icon={<Plus size={16} />}>New doc</AdminPrimaryButton>
        </div>}
      />

      {folders.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-[11px] font-semibold text-gold uppercase tracking-[0.14em]">Folders</p>
            <button onClick={() => setShowNewFolder(true)} className="flex items-center gap-1 text-xs font-semibold text-muted hover:text-gold transition-colors">
              <Plus size={13} /> New folder
            </button>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {rootFolders.map(f => {
              const count = docs.filter(d => d.folderId === f.id).length;
              const active = activeFolderId === f.id;
              return (
                <div
                  key={f.id}
                  className={`relative group flex items-center gap-2 pl-3.5 pr-2.5 py-2.5 rounded-brand-lg border transition-all text-left ${active ? 'border-[color-mix(in_srgb,var(--brand-color)_45%,transparent)] bg-[color-mix(in_srgb,var(--brand-color)_7%,transparent)]' : 'border-line bg-surface-raised hover:border-[color-mix(in_srgb,var(--brand-color)_35%,transparent)] shadow-[var(--ds-sh-sm)]'}`}
                >
                  <button
                    onClick={() => setActiveFolderId(active ? null : f.id)}
                    className="flex items-center gap-2 flex-1 min-w-0"
                  >
                    <Folder size={15} style={{ color: 'var(--brand-color, #d4a017)' }} />
                    <span className="text-sm font-semibold text-strong truncate">{f.name}</span>
                    <span className="text-xs text-faint tabular-nums">{count}</span>
                  </button>
                  <ThreeDotMenu
                    onRename={() => handleRenameFolder(f)}
                    onDelete={() => setDeleteFolderId(f.id)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {folders.length === 0 && (
        <div className="mb-6">
          <button onClick={() => setShowNewFolder(true)} className="flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-gold transition-colors">
            <FolderOpen size={14} /> New folder
          </button>
        </div>
      )}

      {sharedDocs.length > 0 && !activeFolderId && (
        <div className="mb-5">
          <p className="text-xs font-bold text-muted uppercase tracking-wider mb-2">Shared with Me</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sharedDocs.map(d => (
              <div
                key={d.id}
                onClick={() => openDocument(d)}
                className="relative bg-surface-raised rounded-2xl p-4 border border-line shadow-xs cursor-pointer hover:border-[color-mix(in_srgb,var(--brand-color)_40%,transparent)] hover:shadow-md transition-all group"
              >
                <div className="flex items-start gap-2 mb-2">
                  <Share2 size={18} className="text-stone-300 flex-shrink-0 mt-0.5" />
                </div>
                <p className="font-semibold text-strong text-sm truncate">{d.title || 'Untitled'}</p>
                {d.updatedAt && (
                  <div className="flex items-center gap-1 mt-3 text-[10px] text-faint">
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
        <div className="text-center py-16 text-faint">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-display font-medium">No documents yet</p>
          <p className="text-sm mt-1">Create your first document</p>
        </div>
      ) : (
        <>
          {activeFolderId && (
            <div className="flex items-center gap-2 mb-3">
              <button onClick={() => setActiveFolderId(null)} className="text-xs text-faint hover:text-muted flex items-center gap-1">
                <ArrowLeft size={12} /> All docs
              </button>
              <span className="text-xs text-faint">/</span>
              <span className="text-xs font-semibold text-body">{folders.find(f => f.id === activeFolderId)?.name}</span>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {folderDocs.map(d => {
              const sharedCount = d.sharedWith?.length || 0;
              return (
                <div
                  key={d.id}
                  onClick={() => openDocument(d)}
                  className="relative bg-surface-raised rounded-brand-lg p-5 border border-line shadow-[var(--ds-sh-sm)] cursor-pointer hover:border-[color-mix(in_srgb,var(--brand-color)_40%,transparent)] hover:shadow-[var(--ds-sh-md)] transition-all group"
                >
                  <div className="flex items-start justify-between gap-2 mb-2.5">
                    <FileText size={18} className="text-stone-300 flex-shrink-0 mt-0.5" />
                    <div className="flex items-center gap-1">
                      {d.pinned && <Pin size={13} className="text-gold" />}
                      <ThreeDotMenu
                        onRename={() => handleRenameDoc(d)}
                        onDelete={() => setDeleteDocId(d.id)}
                        onMove={() => setMoveDocId(d.id)}
                        onPin={() => togglePinDoc(d.id, !!d.pinned)}
                        isPinned={!!d.pinned}
                      />
                    </div>
                  </div>
                  <p className="font-semibold text-strong text-[15px] truncate group-hover:text-gold transition-colors">{d.title || 'Untitled'}</p>
                  {d.content && (
                    <p className="text-xs text-muted mt-1.5 line-clamp-2 leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: d.content.replace(/<[^>]*>/g, ' ').trim() }} />
                  )}
                  <div className="flex items-center gap-2 mt-4">
                    {d.updatedAt && (
                      <div className="flex items-center gap-1 text-[11px] text-faint">
                        <Clock size={11} />
                        {fmtDate(d.updatedAt)}
                      </div>
                    )}
                    {sharedCount > 0 && <AdminBadge tone="sky">Shared · {sharedCount}</AdminBadge>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {commonModals}
    </div>
  );
};

export default AdminDocs;