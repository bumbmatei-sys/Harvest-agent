"use client";
import React, { useCallback, useMemo, useState } from 'react';
import {
  ChevronDown, ChevronRight, FileText, Folder, FolderOpen, FolderPlus,
  Pin, Plus, Search, Share2, Upload,
} from 'lucide-react';
import {
  SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu,
  SidebarMenuItem, SidebarMenuSkeleton, SidebarMenuSub, SidebarMenuSubItem,
} from '../ui/sidebar';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from '../ui/context-menu';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../ui/empty';
import { Item, ItemContent, ItemMedia, ItemTitle } from '../ui/item';
import { childFolders, docsInFolder, recentDocs, RECENTS_COUNT } from './docs-tree-model';
import type { Doc, DocFolder } from '../../hooks/queries/useDocsQueries';

/**
 * The notes tree — the left pane, always on screen.
 *
 * ── What this replaces ───────────────────────────────────────────────────────
 * The tree used to live inside the editor screen and NOWHERE ELSE, so it only
 * existed once a note was already open: you landed on a flat row of root folder
 * chips, picked a note, and the tree appeared beside it. Nested folders were
 * unreachable from the landing screen entirely — it rendered
 * `folders.filter(f => !f.parentId)` and nothing below that. THE-275 makes the
 * tree the thing you land on, at every width, and leaves the editor as the only
 * pane that swaps.
 *
 * ── Why this component owns its collapse state ───────────────────────────────
 * It is mounted once, unconditionally, for the life of the screen. Opening a
 * note re-renders the MAIN pane and leaves this element in place, so folder
 * collapse survives navigating between notes for free — which is the whole
 * point, and is asserted by identity on the DOM node rather than by a snapshot.
 *
 * ── Shared notes are NOT in the tree, deliberately ───────────────────────────
 * `useSharedDocs` is scoped by the VIEWER (`sharedWith array-contains uid`) and
 * carries no tenant constraint, so a note shared from another church appears in
 * it. Its `folderId` names a folder in the OWNER's tree, which — if these were
 * merged — would file a foreign note inside one of this church's folders under a
 * name the viewer has no read access to. They stay in their own group, exactly
 * as they were before this ticket. See `SHARED_GROUP_LABEL`.
 */

/** The heading the viewer-scoped notes render under, kept out of the tree. */
export const SHARED_GROUP_LABEL = 'Shared with me';

export interface DocsTreeProps {
  /** Tenant-scoped notes — `useDocs(...).items`, unfiltered. */
  docs: Doc[];
  folders: DocFolder[];
  /** Viewer-scoped notes — `useSharedDocs(...).items`. Never merged into the tree. */
  sharedDocs: Doc[];
  /** True when a list read hit the runaway-read ceiling (THE-262, PR 405). */
  truncated: boolean;
  /** The first read is still in flight. Distinct from "this church has none". */
  loading?: boolean;
  openDocId: string | null;
  onOpenDoc: (d: Doc) => void;
  onNewDoc: (folderId?: string | null) => void;
  onNewFolder: () => void;
  /** Open the .md file picker — the import this screen already had. */
  onImport: () => void;
  onOpenSwitcher: () => void;
  onRenameDoc: (d: Doc) => void;
  onDeleteDoc: (id: string) => void;
  onMoveDoc: (id: string) => void;
  onPinDoc: (id: string, pinned: boolean) => void;
  onRenameFolder: (f: DocFolder) => void;
  onDeleteFolder: (id: string) => void;
  /** Folder ids to hold open — the path down to the note currently in the editor. */
  revealFolderIds?: string[];
}

/**
 * The right-click menu on a note.
 *
 * Every entry calls a handler that already existed on this screen and is still
 * reachable from its old button; right-click is a second door onto the same
 * actions, not a second implementation of them.
 */
const DocContextMenu: React.FC<{
  doc: Doc;
  onRename: (d: Doc) => void;
  onDelete: (id: string) => void;
  onMove: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  children: React.ReactNode;
}> = ({ doc, onRename, onDelete, onMove, onPin, children }) => (
  <ContextMenu>
    <ContextMenuTrigger render={<div className="min-w-0" />}>{children}</ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuItem onClick={() => onRename(doc)}>Rename</ContextMenuItem>
      <ContextMenuItem onClick={() => onMove(doc.id)}>Move to folder</ContextMenuItem>
      <ContextMenuItem onClick={() => onPin(doc.id, !!doc.pinned)}>
        {doc.pinned ? 'Unpin' : 'Pin to top'}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onClick={() => onDelete(doc.id)}>Delete</ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
);

/** The right-click menu on a folder. Same rule: existing handlers only. */
const FolderContextMenu: React.FC<{
  folder: DocFolder;
  onRename: (f: DocFolder) => void;
  onDelete: (id: string) => void;
  onNewDoc: (folderId: string) => void;
  children: React.ReactNode;
}> = ({ folder, onRename, onDelete, onNewDoc, children }) => (
  <ContextMenu>
    <ContextMenuTrigger render={<div className="min-w-0" />}>{children}</ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuItem onClick={() => onRename(folder)}>Rename</ContextMenuItem>
      <ContextMenuItem onClick={() => onNewDoc(folder.id)}>New note here</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onClick={() => onDelete(folder.id)}>Delete</ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
);

/** One note, as a tree leaf. `data-doc-id` is how the tests address a leaf. */
const DocLeaf: React.FC<{
  doc: Doc;
  active: boolean;
  onOpen: (d: Doc) => void;
}> = ({ doc, active, onOpen }) => (
  <Item
    render={<button type="button" />}
    size="xs"
    data-doc-id={doc.id}
    data-active={active || undefined}
    onClick={() => onOpen(doc)}
    // The selected fill and the two inks are the ones this row already
    // carried. THE-136 established them and theming-inputs-lists.test.ts
    // computes their real contrast in both themes; the fill is a color-mix
    // over `transparent` — over the SURFACE — because mixing the accent over
    // a fixed light colour is the exact bug that ticket fixed.
    className={`text-left ${active ? 'bg-[color-mix(in_srgb,var(--brand-color)_10%,transparent)]' : 'hover:bg-surface-sunken'}`}
  >
    <ItemMedia variant="icon"><FileText className={active ? 'text-gold' : 'text-faint'} /></ItemMedia>
    <ItemContent className="min-w-0 gap-0">
      <ItemTitle className={`truncate ${active ? 'text-strong' : 'text-body'}`}>{doc.title || 'Untitled'}</ItemTitle>
    </ItemContent>
    {doc.pinned && <Pin data-testid={`pinned-${doc.id}`} className="size-3 shrink-0 text-gold" />}
  </Item>
);

/**
 * One folder and everything beneath it, recursively.
 *
 * Depth is expressed by NESTING (`SidebarMenuSub` is a `<ul>` inside the parent
 * `<li>`) rather than by a computed left padding, so an arbitrarily deep
 * `parentId` chain indents itself and there is no depth arithmetic to get
 * wrong. The old tree took a `depth` prop and multiplied it by 16px.
 */
const FolderBranch: React.FC<{
  folder: DocFolder;
  depth: number;
  props: DocsTreeProps;
  collapsed: Set<string>;
  toggle: (id: string) => void;
}> = ({ folder, depth, props, collapsed, toggle }) => {
  const { docs, folders, openDocId, onOpenDoc } = props;
  // Open unless explicitly collapsed, and always open on the path to the note
  // in the editor — so opening a note from the quick switcher reveals where it
  // lives instead of leaving the tree pointing somewhere else.
  const revealed = props.revealFolderIds?.includes(folder.id) ?? false;
  const open = revealed || !collapsed.has(folder.id);
  const kids = childFolders(folders, folder.id);
  const notes = docsInFolder(docs, folder.id);

  return (
    <SidebarMenuItem data-folder-id={folder.id} data-depth={depth}>
      <FolderContextMenu
        folder={folder}
        onRename={props.onRenameFolder}
        onDelete={props.onDeleteFolder}
        onNewDoc={props.onNewDoc}
      >
        <Item
          render={<button type="button" />}
          size="xs"
          data-folder-toggle={folder.id}
          aria-expanded={open}
          onClick={() => toggle(folder.id)}
          className="text-left hover:bg-surface-sunken"
        >
          <ItemMedia variant="icon">
            {open ? <ChevronDown className="text-faint" /> : <ChevronRight className="text-faint" />}
          </ItemMedia>
          <ItemMedia variant="icon">
            {open ? <FolderOpen className="text-gold" /> : <Folder className="text-faint" />}
          </ItemMedia>
          <ItemContent className="min-w-0 gap-0">
            <ItemTitle className="truncate text-body">{folder.name}</ItemTitle>
          </ItemContent>
        </Item>
      </FolderContextMenu>

      {open && (
        <SidebarMenuSub data-folder-children={folder.id}>
          {kids.map(child => (
            <SidebarMenuSubItem key={child.id}>
              <SidebarMenu>
                <FolderBranch
                  folder={child}
                  depth={depth + 1}
                  props={props}
                  collapsed={collapsed}
                  toggle={toggle}
                />
              </SidebarMenu>
            </SidebarMenuSubItem>
          ))}
          {notes.map(d => (
            <SidebarMenuSubItem key={d.id}>
              <DocContextMenu
                doc={d}
                onRename={props.onRenameDoc}
                onDelete={props.onDeleteDoc}
                onMove={props.onMoveDoc}
                onPin={props.onPinDoc}
              >
                <DocLeaf doc={d} active={openDocId === d.id} onOpen={onOpenDoc} />
              </DocContextMenu>
            </SidebarMenuSubItem>
          ))}
          {kids.length === 0 && notes.length === 0 && (
            <SidebarMenuSubItem>
              {/* An open folder with nothing in it says so, rather than
                  rendering as a label with a blank space under it. */}
              <Empty data-empty-folder={folder.id} className="gap-1 p-3">
                <EmptyHeader className="gap-0.5">
                  <EmptyMedia variant="icon"><FileText /></EmptyMedia>
                  <EmptyTitle className="text-xs">Empty folder</EmptyTitle>
                  <EmptyDescription className="text-xs">
                    Right-click to add a note here.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </SidebarMenuSubItem>
          )}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
};

const DocsTree: React.FC<DocsTreeProps> = (props) => {
  const {
    docs, folders, sharedDocs, truncated, loading, openDocId, onOpenDoc,
    onNewDoc, onNewFolder, onImport, onOpenSwitcher,
  } = props;

  // Collapse is stored as the set of folders the user has CLOSED, so a folder
  // that has never been touched — including one that arrives from a later
  // Firestore read — is open by default with nothing to initialise.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const roots = useMemo(() => childFolders(folders, null), [folders]);
  const rootNotes = useMemo(() => docsInFolder(docs, null), [docs]);
  const recents = useMemo(() => recentDocs(docs), [docs]);

  return (
    <>
      <SidebarHeader className="gap-2 border-b border-line">
        <div className="flex items-center gap-2">
          <Item
            render={<button type="button" />}
            size="xs"
            variant="outline"
            onClick={() => onNewDoc()}
            className="flex-1 justify-center border-transparent text-white"
            style={{ backgroundColor: 'var(--brand-color, #d4a017)' }}
          >
            <ItemMedia variant="icon"><Plus /></ItemMedia>
            <ItemTitle>New doc</ItemTitle>
          </Item>
          <Item
            render={<button type="button" aria-label="New folder" title="New folder" />}
            size="xs"
            variant="outline"
            onClick={onNewFolder}
            className="w-auto text-muted hover:bg-surface-sunken"
          >
            <ItemMedia variant="icon"><FolderPlus /></ItemMedia>
          </Item>
          {/* The .md import this screen already had. It used to sit in the page
              header the two-pane layout replaced, so it moves here rather than
              into the empty state — where it would be unreachable with a note
              open. Same handler, same file input. */}
          <Item
            render={<button type="button" aria-label="Import" title="Import a .md file" />}
            size="xs"
            variant="outline"
            onClick={onImport}
            className="w-auto text-muted hover:bg-surface-sunken"
          >
            <ItemMedia variant="icon"><Upload /></ItemMedia>
          </Item>
        </div>
        {/* The only search this screen has. It opens the ⌘K switcher rather
            than filtering in place, so there is one search and one result list. */}
        <Item
          render={<button type="button" />}
          size="xs"
          variant="outline"
          onClick={onOpenSwitcher}
          className="justify-start text-muted hover:bg-surface-sunken"
        >
          <ItemMedia variant="icon"><Search /></ItemMedia>
          <ItemTitle className="font-normal">Search notes…</ItemTitle>
          <kbd className="ms-auto text-xs tracking-widest opacity-60">⌘K</kbd>
        </Item>
      </SidebarHeader>

      <SidebarContent className="gap-0">
        {/* THE-262 (PR 405): the read stops at a ceiling, and a ceiling nobody can
            see is the bug that replaced. Reads run to completeness, so this only
            appears if the runaway-read ceiling actually fired — and it must
            never be silent when it does. Moved with the tree, not dropped. */}
        {truncated && (
          <div
            data-testid="docs-partial-list"
            className="mx-2 mt-2 rounded-brand border border-line bg-surface-sunken px-2.5 py-2"
          >
            <p className="text-[10px] font-bold uppercase tracking-wider text-faint">Partial list</p>
            <p className="text-xs text-muted">
              There are more notes than this view loads at once, so some are not shown.
            </p>
          </div>
        )}

        {/* Recents — exactly RECENTS_COUNT, newest by updatedAt. Data, not a
            component: the same notes are still in the tree below. */}
        {recents.length > 0 && (
          <SidebarGroup data-testid="docs-recents">
            <SidebarGroupLabel>Recents</SidebarGroupLabel>
            <SidebarMenu>
              {recents.map(d => (
                <SidebarMenuItem key={d.id}>
                  <DocContextMenu
                    doc={d}
                    onRename={props.onRenameDoc}
                    onDelete={props.onDeleteDoc}
                    onMove={props.onMoveDoc}
                    onPin={props.onPinDoc}
                  >
                    <DocLeaf doc={d} active={openDocId === d.id} onOpen={onOpenDoc} />
                  </DocContextMenu>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}

        <SidebarGroup data-testid="docs-tree">
          <SidebarGroupLabel>Notes</SidebarGroupLabel>
          <SidebarMenu>
            {roots.map(f => (
              <FolderBranch
                key={f.id}
                folder={f}
                depth={0}
                props={props}
                collapsed={collapsed}
                toggle={toggle}
              />
            ))}
            {rootNotes.map(d => (
              <SidebarMenuItem key={d.id}>
                <DocContextMenu
                  doc={d}
                  onRename={props.onRenameDoc}
                  onDelete={props.onDeleteDoc}
                  onMove={props.onMoveDoc}
                  onPin={props.onPinDoc}
                >
                  <DocLeaf doc={d} active={openDocId === d.id} onOpen={onOpenDoc} />
                </DocContextMenu>
              </SidebarMenuItem>
            ))}
            {/* A read in flight is not an empty church. The old screen showed a
                spinner over the whole list view; here the tree keeps its shape
                and the rows arrive into it, so nothing jumps and nobody is told
                they have no notes while their notes are loading. */}
            {loading && roots.length === 0 && rootNotes.length === 0 &&
              [0, 1, 2].map(i => (
                <SidebarMenuItem key={`skeleton-${i}`} data-testid="docs-loading">
                  <SidebarMenuSkeleton showIcon />
                </SidebarMenuItem>
              ))}
            {!loading && roots.length === 0 && rootNotes.length === 0 && (
              <SidebarMenuItem>
                <Empty data-testid="docs-empty" className="gap-1 p-4">
                  <EmptyHeader className="gap-0.5">
                    <EmptyMedia variant="icon"><FileText /></EmptyMedia>
                    <EmptyTitle className="text-sm">No notes yet</EmptyTitle>
                    <EmptyDescription className="text-xs">
                      Create your first note to get started.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarGroup>

        {/* Viewer-scoped, never merged into the tree above — see the note at the
            top of this file. These notes belong to someone else's folders. */}
        {sharedDocs.length > 0 && (
          <SidebarGroup data-testid="docs-shared">
            <SidebarGroupLabel>{SHARED_GROUP_LABEL}</SidebarGroupLabel>
            <SidebarMenu>
              {sharedDocs.map(d => (
                <SidebarMenuItem key={d.id}>
                  <Item
                    render={<button type="button" />}
                    size="xs"
                    data-shared-doc-id={d.id}
                    data-active={openDocId === d.id || undefined}
                    onClick={() => onOpenDoc(d)}
                    className={`text-left ${openDocId === d.id ? 'bg-[color-mix(in_srgb,var(--brand-color)_10%,transparent)]' : 'hover:bg-surface-sunken'}`}
                  >
                    <ItemMedia variant="icon"><Share2 className="text-faint" /></ItemMedia>
                    <ItemContent className="min-w-0 gap-0">
                      <ItemTitle className="truncate text-body">{d.title || 'Untitled'}</ItemTitle>
                    </ItemContent>
                  </Item>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>
    </>
  );
};

export { RECENTS_COUNT };
export default DocsTree;
