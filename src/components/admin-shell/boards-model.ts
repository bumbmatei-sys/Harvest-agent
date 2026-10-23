import type { Doc, DocFolder } from '@/hooks/queries/useDocsQueries';
import { RECENTS_COUNT, recentDocs } from '@/components/docs/docs-tree-model';

/** The route id of the "all notes" grid. Real boards use their folder id. */
export const ALL_NOTES = 'all';

export interface Board {
  readonly id: string;
  readonly name: string;
}

/** The boards are the top-level folders of Notes. A folder inside a folder is not a board. */
export function topLevelBoards(folders: readonly { id: string; name?: string; parentId?: string | null }[]): Board[] {
  return folders.filter((f) => !f.parentId).map((f) => ({ id: f.id, name: f.name?.trim() || 'Untitled board' }));
}

/** Every folder id inside `boardId`, the board itself included. */
export function boardFolderIds(folders: readonly Pick<DocFolder, 'id' | 'parentId'>[], boardId: string): Set<string> {
  const ids = new Set<string>([boardId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) { ids.add(f.id); grew = true; }
    }
  }
  return ids;
}

/** The notes on a board, newest first: those in the board's folder and in any folder inside it. `all` is every note. */
export function notesInBoard(docs: readonly Doc[], folders: readonly Pick<DocFolder, 'id' | 'parentId'>[], boardId: string): Doc[] {
  if (boardId === ALL_NOTES) return recentDocs([...docs], docs.length);
  const ids = boardFolderIds(folders, boardId);
  return recentDocs(docs.filter((d) => d.folderId && ids.has(d.folderId)), docs.length);
}

/** The few notes the sidebar shows under an open board. */
export const latestNotes = (notes: readonly Doc[]): Doc[] => notes.slice(0, RECENTS_COUNT);
