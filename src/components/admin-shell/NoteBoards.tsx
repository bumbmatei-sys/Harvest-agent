'use client';

import { Folder } from 'lucide-react';

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { useDocFolders } from '@/hooks/queries/useDocsQueries';

import { ShellErrorBoundary } from './ShellErrorBoundary';

const MENU_BUTTON = 'h-[30px] min-h-0 gap-2 rounded-lg py-0 pr-3 pl-2 text-[14px] font-normal text-sidebar-foreground data-active:font-normal [&_svg]:size-[17px] [&_svg]:stroke-[1.7]';

export interface NoteBoard {
  readonly id: string;
  readonly name: string;
}

/** The boards are the top-level folders of Notes. A folder inside a folder is not a board. */
export function topLevelBoards(folders: readonly { id: string; name?: string; parentId?: string | null }[]): NoteBoard[] {
  return folders.filter((f) => !f.parentId).map((f) => ({ id: f.id, name: f.name?.trim() || 'Untitled board' }));
}

function BoardsGroup({ children }: { children: React.ReactNode }) {
  return (
    <SidebarGroup data-note-boards className="mt-auto px-[13px] pt-6 pb-1 group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel className="h-6 px-2 text-[12px] font-normal text-sidebar-foreground/70">Note boards</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-px">{children}</SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

const Note = ({ children, alert }: { children: React.ReactNode; alert?: boolean }) => (
  <li role={alert ? 'alert' : undefined} className={alert ? 'px-2 py-1 text-[12px] text-danger' : 'px-2 py-1 text-[12px] text-sidebar-foreground/70'}>{children}</li>
);

function Boards({ tenantId, enabled, activeId, onOpen }: {
  tenantId: string | null | undefined;
  enabled: boolean;
  activeId: string | null;
  onOpen: (id: string) => void;
}) {
  const { data, isLoading, isError } = useDocFolders(tenantId, enabled);
  const boards = topLevelBoards(data?.items ?? []);
  return (
    <BoardsGroup>
      {isError ? (
        <Note alert>Boards could not be loaded.</Note>
      ) : isLoading ? (
        <Note>Loading boards</Note>
      ) : boards.length === 0 ? (
        <Note>No boards yet</Note>
      ) : (
        boards.map((board) => (
          <SidebarMenuItem key={board.id}>
            <SidebarMenuButton isActive={activeId === board.id} className={MENU_BUTTON} data-note-board={board.id} onClick={() => onOpen(board.id)}>
              <Folder />
              <span className="min-w-0 truncate">{board.name}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))
      )}
    </BoardsGroup>
  );
}

/**
 * The Notes boards, listed at the bottom of the People side the way Eden lists
 * its boards. It reads its own folders, and a read that throws shows a message
 * in its place instead of taking the sidebar down.
 */
export function NoteBoardsSection(props: {
  tenantId: string | null | undefined;
  enabled: boolean;
  activeId: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <ShellErrorBoundary label="note boards" fallback={<BoardsGroup><Note alert>Boards could not be loaded.</Note></BoardsGroup>}>
      <Boards {...props} />
    </ShellErrorBoundary>
  );
}
