import { describe, expect, it } from 'vitest';

import type { Doc } from '@/hooks/queries/useDocsQueries';

import { ALL_NOTES, boardFolderIds, latestNotes, notesInBoard, topLevelBoards } from './boards-model';

const note = (id: string, folderId: string | null, ms: number | null, title = id): Doc => ({
  id, title, content: '', folderId, createdBy: 'u', createdAt: null,
  updatedAt: ms === null ? null : ({ toMillis: () => ms, seconds: ms / 1000, nanoseconds: 0 } as never),
  isPrivate: true, sharedWith: [],
});

const folders = [
  { id: 'a', parentId: null }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'b' }, { id: 'z', parentId: null },
];

describe('topLevelBoards', () => {
  it('keeps top-level folders only, in the order given, and names an unnamed one', () => {
    expect(topLevelBoards([
      { id: 'a', name: 'Sermons', parentId: null },
      { id: 'b', name: 'Series 1', parentId: 'a' },
      { id: 'c', name: '  ', parentId: undefined },
    ])).toEqual([{ id: 'a', name: 'Sermons' }, { id: 'c', name: 'Untitled board' }]);
  });
});

describe('what is on a board', () => {
  it('a board includes the folders nested inside it, however deep, and no others', () => {
    expect([...boardFolderIds(folders, 'a')].sort()).toEqual(['a', 'b', 'c']);
    expect([...boardFolderIds(folders, 'z')]).toEqual(['z']);
  });

  it('lists the notes of the board and of its nested folders, newest first, and leaves other boards out', () => {
    const docs = [note('old', 'a', 1000), note('deep', 'c', 3000), note('mid', 'b', 2000), note('other', 'z', 9000), note('loose', null, 8000)];
    expect(notesInBoard(docs, folders, 'a').map((d) => d.id)).toEqual(['deep', 'mid', 'old']);
    expect(notesInBoard(docs, folders, 'z').map((d) => d.id)).toEqual(['other']);
  });

  it('"all" is every note, loose ones included', () => {
    const docs = [note('x', null, 1), note('y', 'a', 2)];
    expect(notesInBoard(docs, folders, ALL_NOTES).map((d) => d.id)).toEqual(['y', 'x']);
  });

  it('the sidebar shows the three newest', () => {
    const notes = [note('1', 'a', 5), note('2', 'a', 4), note('3', 'a', 3), note('4', 'a', 2)];
    expect(latestNotes(notes).map((d) => d.id)).toEqual(['1', '2', '3']);
  });
});
