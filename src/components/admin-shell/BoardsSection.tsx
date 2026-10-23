'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { ChevronRight, FileText, Folder, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar';
import { auth, db } from '@/firebase';
import { useDocFolders, useDocs } from '@/hooks/queries/useDocsQueries';
import { notifyError } from '@/utils/notify';

import { ALL_NOTES, latestNotes, notesInBoard, topLevelBoards } from './boards-model';
import { ShellErrorBoundary } from './ShellErrorBoundary';

const MENU_BUTTON = 'h-[30px] min-h-0 gap-2 rounded-lg py-0 pr-3 pl-2 text-[14px] font-normal text-sidebar-foreground data-active:font-normal [&_svg]:size-[17px] [&_svg]:stroke-[1.7]';
const SUB_BUTTON = 'h-[28px] min-h-0 w-full min-w-0 overflow-hidden text-[13px] font-normal text-sidebar-foreground';

/**
 * The section is the sidebar's only entry to Notes, so it carries the name the
 * Notes entitlement goes by. Whatever reads which tabs this admin can reach
 * reads it here, the way it reads the label list of every other group.
 */
const GROUP_MODEL = { 'data-nav-group-labels': 'Notes' } as const;

const Note = ({ children, alert }: { children: React.ReactNode; alert?: boolean }) => (
  <li role={alert ? 'alert' : undefined} className={alert ? 'px-2 py-1 text-[12px] text-danger' : 'px-2 py-1 text-[12px] text-sidebar-foreground/70'}>{children}</li>
);

export interface BoardsSectionProps {
  tenantId: string | null | undefined;
  enabled: boolean;
  /** The board whose grid is open: a folder id, or `all`. */
  activeId: string | null;
  onOpenBoard: (id: string) => void;
  onOpenNote: (id: string) => void;
}

function NewBoardDialog({ open, onOpenChange, tenantId, enabled, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string | null | undefined;
  enabled: boolean;
  onCreated: () => void;
}) {
  const queryClient = useQueryClient();
  const folders = useDocFolders(tenantId, enabled);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    const clean = name.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      await addDoc(collection(db, 'docFolders'), {
        name: clean,
        parentId: null,
        tenantId: tenantId || null,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.uid || '',
        order: folders.data?.items.length ?? 0,
      });
      await queryClient.invalidateQueries({ queryKey: ['docFolders', tenantId] });
      setName('');
      onOpenChange(false);
      onCreated();
    } catch (e) {
      notifyError('Failed to create board', e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" data-new-board-dialog>
        <DialogHeader>
          <DialogTitle className="font-display text-xl text-strong">New board</DialogTitle>
          <DialogDescription>A board holds notes on one subject.</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          placeholder="Board name"
          aria-label="Board name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void create(); }}
        />
        <DialogFooter>
          <Button type="button" variant="outline" className="min-h-11 sm:min-h-0" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" className="min-h-11 sm:min-h-0" disabled={!name.trim() || busy} onClick={() => void create()}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The boards and their newest notes. It reads its own data, so it sits behind a boundary. */
function BoardList({ tenantId, enabled, activeId, onOpenBoard, onOpenNote }: BoardsSectionProps) {
  const folders = useDocFolders(tenantId, enabled);
  const docs = useDocs(tenantId, enabled);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  if (folders.isError || docs.isError) return <Note alert>Boards could not be loaded.</Note>;
  if (folders.isLoading || docs.isLoading) return <Note>Loading boards</Note>;

  const folderItems = folders.data?.items ?? [];
  const docItems = docs.data?.items ?? [];
  const boards = topLevelBoards(folderItems);
  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <>
      {boards.length === 0 ? <Note>No boards yet. Press + to add one.</Note> : null}
      {boards.map((board) => {
        const isOpen = expanded.has(board.id);
        const recent = latestNotes(notesInBoard(docItems, folderItems, board.id));
        return (
          <SidebarMenuItem key={board.id}>
            <SidebarMenuButton
              isActive={activeId === board.id}
              className={MENU_BUTTON}
              data-board={board.id}
              aria-expanded={isOpen}
              onClick={() => toggle(board.id)}
            >
              <Folder />
              <span className="min-w-0 flex-1 truncate">{board.name}</span>
              <ChevronRight className={`size-[11px]! transition-transform ${isOpen ? 'rotate-90' : ''}`} />
            </SidebarMenuButton>
            {isOpen ? (
              <SidebarMenuSub data-board-notes={board.id} className="mx-3.5 gap-px py-0.5">
                {recent.length === 0 ? <Note>No notes yet</Note> : recent.map((note) => (
                  <SidebarMenuSubItem key={note.id}>
                    <SidebarMenuSubButton className={SUB_BUTTON} data-board-note={note.id} render={<button type="button" onClick={() => onOpenNote(note.id)} />}>
                      <span className="min-w-0 truncate">{note.title?.trim() || 'Untitled'}</span>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
                <SidebarMenuSubItem>
                  <SidebarMenuSubButton className={`${SUB_BUTTON} text-sidebar-foreground/70`} data-board-see-all={board.id} render={<button type="button" onClick={() => onOpenBoard(board.id)} />}>
                    <span>See all</span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              </SidebarMenuSub>
            ) : null}
          </SidebarMenuItem>
        );
      })}
    </>
  );
}

/**
 * The Boards section of the People sidebar, drawn right under the last group.
 * The label folds the list; "+" starts a new board. Each board opens into its
 * three newest notes and a "See all" that opens the board's grid. "All notes"
 * needs no data, so it is there even when the boards cannot be read, and a read
 * that throws shows a message in the list's place instead of taking the sidebar
 * down.
 */
export function BoardsSection(props: BoardsSectionProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/collapsible">
      <SidebarGroup data-boards {...GROUP_MODEL} className="mt-6 px-[13px] py-0 group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel
          className="h-6 gap-1 px-2 text-[12px] font-normal text-sidebar-foreground/70"
          render={<CollapsibleTrigger data-boards-toggle />}
        >
          <span>Boards</span>
          <ChevronRight className="size-[11px]! transition-transform group-data-open/collapsible:rotate-90" />
        </SidebarGroupLabel>
        <SidebarGroupAction
          type="button"
          aria-label="New board"
          title="New board"
          data-new-board
          className="top-1 right-2"
          onClick={() => setCreating(true)}
        >
          <Plus />
        </SidebarGroupAction>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu className="gap-px">
              <SidebarMenuItem>
                <SidebarMenuButton isActive={props.activeId === ALL_NOTES} className={MENU_BUTTON} data-board-all data-nav-tab="docs" onClick={() => props.onOpenBoard(ALL_NOTES)}>
                  <FileText />
                  <span className="min-w-0 truncate">All notes</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <ShellErrorBoundary label="boards" fallback={<Note alert>Boards could not be loaded.</Note>}>
                <BoardList {...props} />
              </ShellErrorBoundary>
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
      <ShellErrorBoundary label="new board" fallback={null}>
        <NewBoardDialog open={creating} onOpenChange={setCreating} tenantId={props.tenantId} enabled={props.enabled} onCreated={() => setOpen(true)} />
      </ShellErrorBoundary>
    </Collapsible>
  );
}
