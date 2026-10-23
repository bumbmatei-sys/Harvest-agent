'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { Plus } from 'lucide-react';

import { PageHeader } from '@/components/admin-shell/PageHeader';
import { ALL_NOTES, notesInBoard } from '@/components/admin-shell/boards-model';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { auth, db } from '@/firebase';
import { useDocFolders, useDocs, type Doc } from '@/hooks/queries/useDocsQueries';
import { useAppStore } from '@/store/useAppStore';
import { PLATFORM_TENANT_ID } from '@/utils/tenant-scope';
import { notifyError } from '@/utils/notify';
import { stripHtml } from '@/utils/stripHtml';

const PREVIEW_CHARS = 420;

/** The words under a card's title: the note's text with the markup taken out, cut to what fits the card. */
export const notePreview = (html: string | undefined): string => {
  const text = stripHtml(html ?? '').trim();
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS).trimEnd()}...` : text;
};

function NoteCard({ note, onOpen }: { note: Doc; onOpen: (id: string) => void }) {
  const title = note.title?.trim() || 'Untitled';
  const preview = notePreview(note.content);
  return (
    <li>
      <Card className="relative h-72 gap-3 transition-shadow hover:ring-foreground/25" data-board-card={note.id}>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-5">
          <h2 className="font-display text-xl leading-snug font-semibold tracking-tight text-strong line-clamp-3">{title}</h2>
          {preview ? <p className="text-sm leading-relaxed text-muted-foreground">{preview}</p> : <p className="text-sm text-muted-foreground">Empty note</p>}
        </CardContent>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />
        <button
          type="button"
          aria-label={`Open ${title}`}
          data-board-open={note.id}
          className="absolute inset-0 min-h-11 rounded-xl outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onOpen(note.id)}
        />
      </Card>
    </li>
  );
}

/**
 * One board as a grid of its notes, the way Eden shows a space: no notes list
 * beside it, just the cards. `boardId` is a top-level folder id, or `all` for
 * every note. A card opens its note in the editor.
 */
export function BoardGrid({ boardId, onOpenNote, onTitle }: { boardId: string; onOpenNote: (id: string) => void; onTitle?: (title: string) => void }) {
  // The same tenant the Notes editor writes to, including a super admin's platform fallback.
  const { currentTenantId, isAuthReady, isSuperAdmin } = useAppStore();
  const tenantId = currentTenantId || (isSuperAdmin ? PLATFORM_TENANT_ID : null);
  const queryClient = useQueryClient();
  const folders = useDocFolders(tenantId, isAuthReady);
  const docs = useDocs(tenantId, isAuthReady);
  const [creating, setCreating] = useState(false);

  const folderItems = folders.data?.items ?? [];
  const board = boardId === ALL_NOTES ? null : folderItems.find((f) => f.id === boardId);
  const title = boardId === ALL_NOTES ? 'All notes' : board?.name?.trim() || 'Board';
  useEffect(() => { onTitle?.(title); }, [title, onTitle]);
  const notes = notesInBoard(docs.data?.items ?? [], folderItems, boardId);
  const loading = folders.isLoading || docs.isLoading;
  const failed = folders.isError || docs.isError;

  const createNote = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const folderId = boardId === ALL_NOTES ? null : boardId;
      const ref = await addDoc(collection(db, 'docs'), {
        title: 'Untitled',
        content: '',
        folderId,
        tenantId: tenantId || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: auth.currentUser?.uid || '',
        isPrivate: true,
        sharedWith: [],
        pinned: false,
      });
      await queryClient.invalidateQueries({ queryKey: ['docs', tenantId] });
      onOpenNote(ref.id);
    } catch (e) {
      notifyError('Failed to create note', e);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 pb-8 lg:px-0" data-board-grid={boardId}>
      <PageHeader
        title={title}
        subtitle={loading ? undefined : `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}
        action={(
          <Button className="min-h-11" disabled={creating} onClick={() => void createNote()}>
            <Plus data-icon="inline-start" />New note
          </Button>
        )}
      />
      {failed ? (
        <Alert variant="destructive"><AlertDescription>The notes could not be loaded. Try again in a moment.</AlertDescription></Alert>
      ) : loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" aria-busy aria-label="Loading notes">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-72 w-full rounded-xl" />)}
        </div>
      ) : notes.length === 0 ? (
        <Empty className="min-h-64" data-board-empty>
          <EmptyHeader>
            <EmptyTitle>No notes here yet</EmptyTitle>
            <EmptyDescription>Press New note to write the first one.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {notes.map((note) => <NoteCard key={note.id} note={note} onOpen={onOpenNote} />)}
        </ul>
      )}
    </div>
  );
}
