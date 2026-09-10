"use client";
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Plus, FileText, Trash2, Folder, Maximize2, Minimize2,
  X, ArrowLeft, Edit2, Pin, MoreHorizontal, Share2, Check, Download, Radio,
  Globe, Newspaper
} from 'lucide-react';
import {
  collection, query, where, addDoc, updateDoc, deleteDoc,
  doc, getDoc, serverTimestamp, getDocs, arrayUnion, arrayRemove
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
import RichTextEditor, { COMPACT_PROSE_CLASS } from './RichTextEditor';
import { useAdminHeader, HeaderActionButton } from './AdminScreenHeader';
import { Sidebar, SidebarProvider } from './ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './ui/empty';
import { Item, ItemMedia, ItemTitle } from './ui/item';
import DocsTree from './docs/DocsTree';
import DocsBreadcrumb from './docs/DocsBreadcrumb';
import DocsQuickSwitcher, { useQuickSwitcherShortcut } from './docs/DocsQuickSwitcher';
import { folderPathIds } from './docs/docs-tree-model';
import { SHELL_SCREEN_HEIGHT } from './layout/shell-height';

import type { Doc, DocFolder } from '../hooks/queries/useDocsQueries';

interface AdminUser {
  id: string;
  name: string;
  email: string;
}

/**
 * THE-346 — every row of the note menu is a tap target.
 *
 * `min-h-11` IS 44px OFF THE SPACING SCALE, and it is on EVERY row —
 * submenu trigger, submenu rows and top-level rows alike — because the ticket's
 * floor is per tappable element, not per menu. Released at `sm`, where Rule 4
 * owns density and the primitive's own padding is right.
 *
 * `gap-2` RATHER THAN THE PRIMITIVE'S DEFAULT because these rows carry a
 * 15px icon; the icons were 13px in the hand-rolled menu, which is smaller than
 * anything else on the screen.
 */
const MENU_ROW = 'min-h-11 gap-2 sm:min-h-0';

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
  /** THE-346 — toggle the public web link. See `lib/public-note.ts`. */
  onShareOnWeb: () => void;
  /** Whether a public link is live right now, so the row can say which way it goes. */
  isSharedOnWeb: boolean;
  /** THE-346 — copy this note into `blog_posts` as a DRAFT. */
  onShareToBlogDraft: () => void;
}> = ({
  title, content, createdBy, currentUid, isPinned, onPin, onRename, onDelete,
  onShare, onShareToLivestream, canShareToLivestream,
  onShareOnWeb, isSharedOnWeb, onShareToBlogDraft,
}) => {
  /*
     THE-346 — `open`, `menuRef` AND THE OUTSIDE-CLICK EFFECT ARE ALL GONE.
    They were this component hand-rolling what `ui/dropdown-menu` already does:
    open state, dismiss-on-outside-click, dismiss-on-Escape, focus return to the
    trigger, roving focus across the rows, and typeahead. The hand-rolled
    version had the first two and none of the rest — the rows were plain
    `<button>`s in a `<div>`, so a keyboard user tabbed through the whole page
    behind the menu. `setOpen(false)` disappears from the export handlers for
    the same reason: Base UI closes the menu when an item is activated.
  */

  const handleExportPDF = async () => {
    try {
      await exportToPDF(title || 'Untitled', content);
      toast.success('Exported as PDF');
    } catch { toast.error('Failed to export PDF'); }
  };

  const handleExportDOCX = async () => {
    try {
      await exportToDOCX(title || 'Untitled', content);
      toast.success('Exported as DOCX');
    } catch { toast.error('Failed to export DOCX'); }
  };

  const handleExportMD = () => {
    try {
      exportToMarkdown(title || 'Untitled', content);
      toast.success('Exported as Markdown');
    } catch { toast.error('Failed to export Markdown'); }
  };

  return (
    <DropdownMenu>
      {/*
         THE-346 · THE TRIGGER IS THE THREE DOTS, FULL STOP.
        The founder: *"The 'export' button should be just the 3 dots."* The
        labelled `Export` button and the `triggerLabel` prop that produced it
        are both gone; every caller now gets the same ⋯ the note cards in the
        tree always had, so one control means one thing across the screen.

         `min-h-11 min-w-11` released at `sm`: 44px of tap target on a phone,
        Rule 4's density above it. The old trigger was `p-1.5` around an 18px
        glyph — 27px, which is not a target.
      */}
      <DropdownMenuTrigger
        aria-label="Document options"
        className="flex min-h-11 min-w-11 items-center justify-center rounded-lg transition-colors hover:bg-surface-sunken sm:min-h-0 sm:min-w-0 sm:p-1.5"
      >
        <MoreHorizontal size={18} className="text-muted" />
      </DropdownMenuTrigger>

      {/*
         `z-[110]` IS COPIED FROM `AttachMenu` DELIBERATELY, AND WITH ITS
        CAVEAT. THE-337 established that this class lands on the Base UI POPUP
        while `ui/dropdown-menu.tsx` hardcodes the POSITIONER above it as
        `isolate z-50` — and `isolation: isolate` opens a stacking context, so
        110 is painted at the positioner's 50. 110 is still the RIGHT NUMBER
        (it clears the nav's 100 and the dialog primitives' 101/102 and stays
        under the modals' 300); only the element it lands on is wrong, and
        fixing that needs a line in the frozen primitive.

         IT DOES NOT BITE HERE, AND THAT WAS MEASURED RATHER THAN ASSUMED —
        see this ticket's layout suite, which hit-tests the open menu against
        the nav at all five widths and finds zero occluded pixels. This menu
        hangs from a toolbar at the TOP of the editor and the nav is pinned to
        the BOTTOM; they do not intersect. The frozen primitive is therefore
        left alone.
      */}
      <DropdownMenuContent align="end" className="z-[110] w-56">
        {/*
           EXPORT IS A SUBMENU NOW — *"end when pressed on export to give me
          the options. Something like the paperclip from chat"*. The paperclip
          is `attach/AttachMenu.tsx`, and this is its shape: a
          `DropdownMenuSub` whose trigger is a row and whose content is the
          flyout. The three formats moved INSIDE it unchanged; the little
          "EXPORT" caption that used to head the flat list is gone, because a
          submenu that says Export does not need a label saying Export.
        */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={MENU_ROW}>
            <Download size={15} /> Export
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="z-[110] w-52">
            <DropdownMenuItem className={MENU_ROW} onClick={handleExportPDF}>
              <Download size={15} /> PDF
            </DropdownMenuItem>
            <DropdownMenuItem className={MENU_ROW} onClick={handleExportDOCX}>
              <Download size={15} /> DOCX
            </DropdownMenuItem>
            <DropdownMenuItem className={MENU_ROW} onClick={handleExportMD}>
              <Download size={15} /> Markdown
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/*
           `Share with Admins` KEEPS ITS AUTHOR GATE. Sharing a note with the
          rest of the tenant's admins writes `sharedWith` on the doc, which
          `/docs/{docId}`'s update rule allows only the author (or a
          `manageDocs` holder) to do — so offering the row to a reader who was
          shared INTO the note would be offering a write that fails.
        */}
        {currentUid === createdBy && (
          <DropdownMenuItem className={MENU_ROW} onClick={onShare}>
            <Share2 size={15} /> Share with Admins
          </DropdownMenuItem>
        )}

        {/*
           SHARE ON WEB IS THE ONE WITH REAL WEIGHT — it puts a church's
          internal note on the open web. What makes it public, why the URL is
          not guessable, and why pressing it again REVOKES rather than hides,
          are all in `lib/public-note.ts`. Two things belong here:

           THE LABEL SAYS WHICH WAY THE SWITCH GOES. "Stop sharing" while a
          link is live, "Share on web" while it is not — never a single label
          with a tick, because a row that reads `Share on web ` does not say
          whether pressing it shares or unshares, and getting that wrong on
          this particular row publishes a note.

           AND IT IS AUTHOR-GATED like the row above it, for the same reason:
          publishing writes `publicShare` on the doc.
        */}
        {currentUid === createdBy && (
          <DropdownMenuItem className={MENU_ROW} onClick={onShareOnWeb}>
            <Globe size={15} /> {isSharedOnWeb ? 'Stop sharing on web' : 'Share on web'}
          </DropdownMenuItem>
        )}

        {/*
           SHARE TO LIVESTREAM LIVES HERE NOW AND NOWHERE ELSE — *"we have to
          move the button from the headerbar into the more drawer"*. The
          broadcast button is gone from the editor's toolbar; this row is the
          only trigger, and `handleShareToLivestream` behind it is unchanged.

           STILL PLAN-GATED. It is a Small Team (pro) feature, so the row is
          ABSENT rather than disabled below that plan — the same posture the
          header button had.
        */}
        {canShareToLivestream && (
          <DropdownMenuItem className={MENU_ROW} onClick={onShareToLivestream}>
            <Radio size={15} /> Share to Livestream
          </DropdownMenuItem>
        )}

        {/* Share to blog draft — a DRAFT, never a published post. See
            `handleShareToBlogDraft`: the church still has to open Blog and
            publish it, so a sermon note cannot reach the church's public blog
            through a single menu tap. */}
        <DropdownMenuItem className={MENU_ROW} onClick={onShareToBlogDraft}>
          <Newspaper size={15} /> Share to blog draft
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem className={MENU_ROW} onClick={onPin}>
          <Pin size={15} /> {isPinned ? 'Unpin' : 'Pin to Top'}
        </DropdownMenuItem>
        <DropdownMenuItem className={MENU_ROW} onClick={onRename}>
          <Edit2 size={15} /> Rename
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/*
           `variant="destructive"` — NOT `text-red-600 hover:bg-red-50`, which
          is what this row used to carry. Those are raw Tailwind scale colours
          hardcoded into a screen whose palette is a single token family, and
          PR 482 is the ticket about exactly that. The primitive's own destructive
          variant reads the theme.
        */}
        <DropdownMenuItem variant="destructive" className={MENU_ROW} onClick={onDelete}>
          <Trash2 size={15} /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** Stable empty results, so a pending read does not remount the tree. */
const NO_DOCS: Doc[] = [];
const NO_FOLDERS: DocFolder[] = [];

// ─── Main AdminDocs ──────────────────────────────────────────────

interface AdminDocsProps {
  /** Deep-link: open this doc on mount (e.g. from a chat attachment card). */
  initialDocId?: string;
  /** Called once the deep-linked doc has been opened, to clear the URL param. */
  onItemConsumed?: () => void;
}

const AdminDocs: React.FC<AdminDocsProps> = ({ initialDocId, onItemConsumed }) => {
  const { setHeaderAction, setHeaderHidden, setNavHidden } = useAdminHeader();
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

  // These hooks return `{ items, truncated }`, not a bare array: the list is read
  // to completeness, and `truncated` is the only thing that can say so when the
  // runaway-read ceiling stops it (THE-262 — the old `limit(300)` lost notes in
  // silence). Unwrapped here so the rest of this component keeps working with
  // plain arrays.
  const { data: docsRead, isLoading: loading } = useDocs(tenantId, isAuthReady);
  const { data: foldersRead } = useDocFolders(tenantId, isAuthReady);
  const { data: sharedDocsRead } = useSharedDocs(auth.currentUser?.uid);
  // The `?? []` fallbacks resolve to SHARED constants rather than to a fresh
  // array each render. The tree and the quick switcher both derive from these,
  // and a new `[]` on every render would rebuild every branch of the tree on
  // every keystroke in the editor beside it.
  const docs = docsRead?.items ?? NO_DOCS;
  const folders = foldersRead?.items ?? NO_FOLDERS;
  const sharedDocs = sharedDocsRead?.items ?? NO_DOCS;
  const docsTruncated = !!docsRead?.truncated || !!foldersRead?.truncated || !!sharedDocsRead?.truncated;

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
  // ⌘K. The screen had no search at all before THE-275.
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  // Inline "create folder while moving a doc" (used in the Move-to-Folder modal).
  const [moveCreating, setMoveCreating] = useState(false);
  const [moveFolderName, setMoveFolderName] = useState('');
  // Distraction-free writing: hides the tree on a wide screen and the app
  // header everywhere. Kept from before THE-275 — what changed is that opening
  // a note no longer switches it on for you, which is what used to make the
  // tree vanish the instant you picked something to read.
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

  const openDocument = useCallback((d: Doc) => {
    setOpenDoc(d);
    setEditTitle(d.title || '');
    setEditContent(d.content || '');
    setSaveStatus('idle');
    // Deliberately does NOT set focus mode. That single line was the drill-down:
    // every route into a note switched the screen to the editor-only view, and
    // the tree only existed there.
  }, []);

  // Hold the open note's folder chain open so the tree shows where the note in
  // the editor lives — including when it was reached from ⌘K rather than by
  // walking the folders.
  const revealFolderIds = useMemo(
    () => folderPathIds(openDoc?.folderId, folders),
    [openDoc?.folderId, folders],
  );

  useQuickSwitcherShortcut(useCallback(() => setSwitcherOpen(true), []));

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
  // fullscreen. The editor keeps its own toolbar row (back to Notes · expand ·
  // breadcrumb | the three-dot menu), so there is still a way back. Always
  // restore the header on exit and on unmount so you can never get stuck
  // headerless. THE-346 moved the expand toggle into that row's left group and
  // took the broadcast button out of it; the way back is unchanged.
  const editorFullscreen = focusMode && !!openDoc;
  useEffect(() => {
    setHeaderHidden(editorFullscreen);
    return () => setHeaderHidden(false);
  }, [editorFullscreen, setHeaderHidden]);

  /**
   * THE-346 — AND THE BOTTOM NAV, WHICH IS THE HALF THAT CAN TRAP YOU.
   *
   * The founder: *"On phone if I press on expand the bottom nav menu should
   * disappear as well, and reappear when I exit the notes or press the button
   * again."* Two exits, and BOTH have to give it back.
   *
   * THIS IS ONE EFFECT, NOT TWO HANDLERS, and that is what makes both exits
   * work rather than one. `editorFullscreen` is `focusMode && !!openDoc`, so:
   *
   * · pressing expand again  → `focusMode` false → effect re-runs with false
   * · leaving the note       → `openDoc` null    → effect re-runs with false
   * · navigating away        → unmount           → cleanup runs with false
   *
   * Writing it as an onClick on the expand button would have covered the first
   * exit only, and `closeEditor` would have had to remember to do the same — a
   * nav still hidden on a screen that has no expand button to press is a trap
   * with no way out, which is strictly worse than the layout this fixes. There
   * is nothing to remember here: the nav is a function of the same state the
   * fullscreen editor is, so it cannot get out of step with it.
   *
   * THE CLEANUP IS LOAD-BEARING AND IS NOT DEAD CODE. React runs it on
   * unmount, which is the ONLY thing covering a route change that takes the
   * whole screen away while `focusMode` is still true — the case where no
   * re-render with `false` ever happens on this component.
   */
  useEffect(() => {
    setNavHidden(editorFullscreen);
    return () => setNavHidden(false);
  }, [editorFullscreen, setNavHidden]);

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

  /**
   * Close the open note.
   *
   * Save what is on screen — not just what the debounce happened to queue — and
   * do NOT leave until it lands. Closing over a failed write dropped the user on
   * a screen where the error was no longer visible, while the only copy of the
   * text lived in the editor they had just left. Staying put keeps the work on
   * screen and makes "Notes" a retry button.
   *
   * The `editTitle.trim()` guard is gone: a note with content and a blank title
   * was previously never written on close, so everything typed since the last
   * debounce was silently discarded.
   *
   * Hoisted out of the old editor-only return by THE-275 — the behaviour, and
   * the tests that pin it, are unchanged.
   */
  const closeEditor = async () => {
    if (!openDoc) return;
    cancelPendingSave();
    const ok = await saveDoc(openDoc.id, editTitle, editContent);
    if (!ok) return;
    setOpenDoc(null);
    setFocusMode(false);
  };

  const createDoc = async (folderId?: string | null) => {
    try {
      const ref = await addDoc(collection(db, 'docs'), {
        title: 'Untitled',
        content: '',
        folderId: folderId ?? null,
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
  /**
   * THE-346 — "Share on web", from the button's side.
   *
   * THIS IS AN API CALL, NOT A FIRESTORE WRITE, and that is the whole design.
   * The record that makes a note publicly readable lives in `publicNotes`, which
   * has NO rule and so is unreachable from a browser — see `lib/public-note.ts`
   * for why that is the shape rather than a `firestore.rules` change.
   *
   * THE LINK IS BUILT FROM `window.location.origin`, not from anything the
   * server said. The route deliberately returns a PATH: echoing a host derived
   * from the request would let a forwarded `Host` header decide what a church
   * copies onto its clipboard.
   *
   * THE CACHE IS INVALIDATED ON BOTH BRANCHES so the row's label flips. A
   * "Stop sharing" that still reads "Share on web" is how somebody shares twice
   * and believes they have unshared.
   */
  const handleShareOnWeb = async (docId: string, isShared: boolean) => {
    try {
      const res = await fetch('/api/docs/public-share', {
        method: isShared ? 'DELETE' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await auth.currentUser?.getIdToken()}`,
        },
        body: JSON.stringify({ docId }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      await queryClient.invalidateQueries({ queryKey: ['docs', tenantId] });

      if (isShared) {
        toast.success('Link revoked — the note is no longer public');
        return;
      }
      const { path } = (await res.json()) as { path: string };
      const url = `${window.location.origin}${path}`;
      // The clipboard is best-effort: a browser that refuses it must not turn
      // a successful share into an error, so the URL is shown either way.
      try {
        await navigator.clipboard.writeText(url);
        toast.success('Public link copied to clipboard');
      } catch {
        toast.success(`Public link: ${url}`);
      }
    } catch (e) {
      notifyError(isShared ? 'Failed to revoke the link' : 'Failed to share on web', e);
    }
  };

  /**
   * THE-346 — "Share to blog draft".
   *
   * `status: 'draft'`, AND NOTHING PUBLISHES IT. A sermon note is written for
   * a room, not for a church's public blog, so this copies it into `blog_posts`
   * where the Blog screen's own editor and its own publish step are waiting.
   * Writing `'published'` here would put a note on the public web from a single
   * tap in a menu, which is the mistake "Share on web" is careful not to make
   * either.
   *
   * IT IS A COPY, NOT A LINK. Editing the note afterwards does not edit the
   * draft — the church may well want to rewrite it for a different audience,
   * and a live link would fight that. The note is untouched.
   */
  const handleShareToBlogDraft = async (title: string, contentHtml: string) => {
    if (!tenantId) return;
    try {
      await addDoc(collection(db, 'blog_posts'), {
        title: title.trim() || 'Untitled',
        content: contentHtml,
        status: 'draft',
        tenantId,
        author: auth.currentUser?.displayName || '',
        // THE-347 - an ISO STRING, not serverTimestamp(). `blog_posts` has three
        // writers: AdminBlogPostEditor and /api/blog/generate both write
        // `new Date().toISOString()`, the BlogPost interface declares a string,
        // and /blog/[id] puts the value into a <time dateTime> attribute and
        // into schema.org JSON-LD, both of which require ISO 8601 - a Timestamp
        // there serialises as [object Object]. This writer was the only one
        // storing an object, and a mixed field sorts wrong in Firestore (it
        // orders by TYPE first) before it renders wrong. One representation,
        // and this is the one the other two already agreed on.
        createdAt: new Date().toISOString(),
      });
      toast.success('Blog draft created');
    } catch (e) {
      notifyError('Failed to create a blog draft', e);
    }
  };

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

  // The root/child split and the pinned-first order live in docs-tree-model.ts
  // now, so the tree and the quick switcher read the same helpers.

  // Share modal
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

  // ── The one view ──
  //
  // No drill-down. The tree is mounted unconditionally on the left and the MAIN
  // pane is the only thing that swaps — that is the whole of THE-275. What was
  // here before were TWO returns: a landing screen of root-folder chips and doc
  // cards, and a separate editor screen that was the only place the tree existed.
  //
  // ── The layout, and what it does at 380px ───────────────────────────────────
  // One DOM structure at every width; the panes are shown and hidden with
  // classes, never mounted conditionally, so the tree element survives every
  // navigation and every resize.
  //
  //            no note open              note open
  //   < lg     tree, full width          editor, full width (tree `hidden`)
  //   ≥ lg     tree + "pick a note"      tree + editor
  //
  // A phone gets ONE pane because two do not fit: at 380px a 232px rail leaves
  // 148px of editor, which is not a writing surface. It is still not a
  // drill-down — the tree is what you LAND on at every width, with no note open
  // and no folder screen in front of it, which is exactly what the founder asked
  // for. `focusMode` is what hides the rail on a wide screen.
  const editorPane = (
    <div
      data-testid="docs-main-pane"
      className={`min-w-0 flex-1 flex-col overflow-hidden rounded-brand-lg border border-line bg-surface-raised shadow-[var(--ds-sh-sm)] ${openDoc ? 'flex' : 'hidden lg:flex'}`}
    >
      {openDoc ? (
        <>
          {/* Editor header. THE-346 re-ordered it: back · EXPAND · where this note
              lives · saved | the three-dot menu. The expand toggle moved into the
              left group beside "Notes", and the broadcast button that used to sit
              on the right is a row of the menu now. */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <button
                onClick={closeEditor}
                className="flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-gold transition-opacity hover:opacity-80"
              >
                <ArrowLeft size={15} /> Notes
              </button>
              {/*
                 THE-346 · THE EXPAND CONTROL MOVED HERE, and "here" is the
                point. The founder: *"The expand button should be in the left not
                right. Exactly on the right of the notes button."*

                It was the first child of the right-hand group, next to Export.
                It is now the sibling immediately after `← Notes` inside the
                LEFT group, so the two controls that change what the screen IS
                sit together and the right-hand group is left holding only what
                you can DO to the note.

                 `shrink-0` MATTERS ON A PHONE. Its new neighbour is the
                breadcrumb, which is `min-w-0` so it can truncate; without this
                the 44px button would be the thing that gave way to a long
                folder path, and a tap target that shrinks is not one.

                 `min-h-11 min-w-11` IS NEW, and the old `p-1.5` is why: a
                16px icon in 6px of padding measured 28px, which is not a tap
                target on a phone. Released above `sm`, where Rule 4 owns
                density — the same shape the List/Month triggers use.
              */}
              <button
                onClick={() => setFocusMode(v => !v)}
                aria-pressed={focusMode}
                title={focusMode ? 'Exit focus mode' : 'Focus mode'}
                aria-label={focusMode ? 'Exit focus mode' : 'Focus mode'}
                data-testid="docs-expand-toggle"
                className="flex shrink-0 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 items-center justify-center rounded-lg p-1.5 text-faint transition-colors hover:bg-surface-sunken"
              >
                {focusMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
              <div className="hidden min-w-0 sm:block">
                <DocsBreadcrumb folderId={openDoc.folderId} folders={folders} title={editTitle} />
              </div>
            </div>
            {/* A failure stays on screen as "Not saved" rather than reverting to
                the empty idle string, and — unlike the quiet Saving…/Saved chip —
                shows on mobile too, where `hidden sm:block` would otherwise make
                the only in-page signal of a lost save invisible. */}
            <span
              className={`text-xs ${saveStatus === 'error' ? 'block font-semibold text-[color:var(--brand-danger)]' : 'hidden sm:block text-faint'}`}
              role={saveStatus === 'error' ? 'alert' : undefined}
            >
              {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Not saved' : ''}
            </span>
            {/*
               THE-346 · WHAT IS *NOT* HERE ANY MORE.

              Two controls left this group. The expand toggle moved to sit beside
              `← Notes` on the left, where the founder asked for it. And the
              broadcast button — `<Radio /> Share to livestream` — is GONE from
              the header bar entirely: *"we have to move the button from the
              headerbar into the more drawer"*. It is a row in the ⋯ menu now,
              which is what "the more drawer" is on this screen, and it is not
              duplicated here. `handleShareToLivestream` is unchanged and is
              still the one writer; only its trigger moved.

               `triggerLabel` IS GONE TOO, and with it the labelled `Export`
              button: *"The 'export' button should be just the 3 dots."* Dropping
              the prop is what makes `EditorMenu` render its ⋯ trigger, which is
              the same trigger every note card in the tree already uses.
            */}
            <div className="flex shrink-0 items-center gap-2">
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
                // THE-346 — was hard `false` while the header carried its own
                // broadcast button, so a menu row would have been a duplicate.
                // The header button is gone, so the menu is now the ONLY way to
                // reach the livestream and has to be told the truth.
                canShareToLivestream={canShareToLivestream}
                onShareToLivestream={() => handleShareToLivestream(openDoc.id, editTitle, editContent)}
                isSharedOnWeb={!!openDoc.publicShare?.token}
                onShareOnWeb={() => handleShareOnWeb(openDoc.id, !!openDoc.publicShare?.token)}
                onShareToBlogDraft={() => handleShareToBlogDraft(editTitle, editContent)}
              />
            </div>
          </div>
          {/* Editor body */}
          <div className="docs-editor flex-1 px-5 pb-12 lg:overflow-y-auto lg:px-12">
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
              className="mt-6 mb-6 w-full border-none bg-transparent font-display text-4xl font-normal tracking-[-0.01em] text-strong outline-hidden placeholder:text-faint"
              placeholder="Untitled"
            />
            <RichTextEditor
              content={editContent}
              onChange={handleContentChange}
              minHeight="calc(100vh - 320px)"
              placeholder="Start writing... Type / for commands"
              // The shared default ends at `xl:prose-2xl` — a 1.5rem base — so
              // on a monitor a note, and the placeholder that inherits from it,
              // rendered at 24px. A note is not a blog post being read at arm's
              // length; this is the flat, compact measure.
              proseClass={COMPACT_PROSE_CLASS}
            />
          </div>
        </>
      ) : (
        // Nothing open. On a wide screen this is the right-hand pane beside the
        // tree; below `lg` it never shows, because there the tree IS the screen.
        <Empty data-testid="docs-no-selection" className="h-full">
          <EmptyHeader>
            <EmptyMedia variant="icon"><FileText /></EmptyMedia>
            <EmptyTitle>Pick a note</EmptyTitle>
            <EmptyDescription>
              Choose one from the tree, or start a new one.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Item
                render={<button type="button" />}
                size="xs"
                variant="outline"
                onClick={() => createDoc()}
                className="w-auto border-transparent text-white"
                style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
              >
                <ItemMedia variant="icon"><Plus /></ItemMedia>
                <ItemTitle>New doc</ItemTitle>
              </Item>
              <Item
                render={<button type="button" />}
                size="xs"
                variant="outline"
                onClick={() => setSwitcherOpen(true)}
                className="w-auto"
              >
                <ItemTitle className="font-normal text-muted">Search notes…</ItemTitle>
              </Item>
            </div>
          </EmptyContent>
        </Empty>
      )}
    </div>
  );

  return (
    // `min-h-0` undoes SidebarProvider's `min-h-svh`: this screen is mounted
    // INSIDE the admin shell's tab wrapper, and a full-viewport minimum there
    // would push the page taller than the shell it sits in.
    //
    // ── No page measure here, deliberately ──────────────────────────────────
    // This screen carried FORM_CONTAINER, whose job is to stop a DOCUMENT from
    // stretching to whatever width the monitor happens to be. Notes is not a
    // document — it is a rail and a pane — and capping the pair at 1120px and
    // centring them left a band of dead space between the admin nav and the
    // tree on every screen wider than that. The rail is a fixed
    // --sidebar-width either way, so the whole cap fell on the editor, which is
    // the one thing here that WANTS the room.
    //
    // Nothing is minted in its place: the width is the shell's content box.
    <SidebarProvider className="w-full min-h-0">
      <input
        ref={importInputRef}
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        onChange={importMarkdownFile}
        className="hidden"
      />
      <div className={`flex w-full min-w-0 flex-col gap-0 lg:flex-row lg:gap-5 ${SHELL_SCREEN_HEIGHT}`}>
        {/* The tree. Mounted once, for the life of the screen — clicking a note
            re-renders the pane beside it and leaves this element alone, which is
            what keeps folder collapse (and the scroll position) put.

            `collapsible="none"` on purpose: the primitive's other modes render a
            `fixed inset-y-0 h-svh` panel meant for a whole-page shell, which
            inside the admin tab wrapper would sit on top of the admin nav. This
            mode is the plain in-flow rail, and it is the one that composes. Its
            width is the primitive's own `--sidebar-width` (16rem, set by
            SidebarProvider as a React constant, not a token) — no width is
            minted here. */}
        <Sidebar
          collapsible="none"
          data-testid="docs-sidebar"
          className={`w-full min-h-0 shrink-0 overflow-hidden rounded-brand-lg border border-line bg-surface-raised shadow-[var(--ds-sh-sm)] lg:w-(--sidebar-width) ${openDoc ? 'hidden lg:flex' : 'flex'} ${focusMode ? 'lg:hidden' : ''}`}
        >
          <DocsTree
            docs={docs}
            folders={folders}
            sharedDocs={sharedDocs}
            truncated={docsTruncated}
            loading={loading}
            openDocId={openDoc?.id ?? null}
            onOpenDoc={openDocument}
            onNewDoc={createDoc}
            onNewFolder={() => setShowNewFolder(true)}
            onImport={() => importInputRef.current?.click()}
            onOpenSwitcher={() => setSwitcherOpen(true)}
            onRenameDoc={handleRenameDoc}
            onDeleteDoc={setDeleteDocId}
            onMoveDoc={setMoveDocId}
            onPinDoc={togglePinDoc}
            onRenameFolder={handleRenameFolder}
            onDeleteFolder={setDeleteFolderId}
            revealFolderIds={revealFolderIds}
          />
        </Sidebar>

        {editorPane}
      </div>

      <DocsQuickSwitcher
        open={switcherOpen}
        onOpenChange={setSwitcherOpen}
        docs={docs}
        folders={folders}
        sharedDocs={sharedDocs}
        onOpenDoc={openDocument}
      />
      {commonModals}
    </SidebarProvider>
  );
};

export default AdminDocs;
