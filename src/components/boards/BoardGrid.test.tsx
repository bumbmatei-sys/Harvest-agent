import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const q = vi.hoisted(() => ({
  folders: { data: undefined as unknown, isLoading: false, isError: false },
  docs: { data: undefined as unknown, isLoading: false, isError: false },
}));
const write = vi.hoisted(() => ({ addDoc: vi.fn(async () => ({ id: 'fresh' })) }));
vi.mock('@/hooks/queries/useDocsQueries', () => ({ useDocFolders: () => q.folders, useDocs: () => q.docs }));
vi.mock('@/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('firebase/firestore', () => ({ addDoc: write.addDoc, collection: (_db: unknown, name: string) => name, serverTimestamp: () => 'ts' }));
vi.mock('@/utils/notify', () => ({ notifyError: vi.fn() }));
vi.mock('@/store/useAppStore', () => ({ useAppStore: () => ({ currentTenantId: 'grace', isAuthReady: true, isSuperAdmin: false }) }));

import { BoardGrid, notePreview } from './BoardGrid';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); write.addDoc.mockClear(); });
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });

const ts = (ms: number) => ({ toMillis: () => ms, seconds: ms / 1000, nanoseconds: 0 });
const note = (id: string, folderId: string | null, ms: number, title: string, content = '') => ({ id, title, content, folderId, updatedAt: ts(ms), isPrivate: true, sharedWith: [] });

const seed = () => {
  q.folders = { data: { items: [{ id: 'a', name: 'Sermons', parentId: null }, { id: 'b', name: 'Youth', parentId: null }] }, isLoading: false, isError: false };
  q.docs = { data: { items: [
    note('n1', 'a', 3000, 'Easter', '<h2>Risen</h2><p>He is <strong>risen</strong>.</p>'),
    note('n2', 'a', 2000, 'Advent'),
    note('n3', 'b', 1000, 'Camp'),
    note('n4', null, 500, 'Loose'),
  ] }, isLoading: false, isError: false };
};

const mount = (boardId: string, onOpenNote = vi.fn(), onTitle = vi.fn()) => act(async () => {
  root.render(<QueryClientProvider client={new QueryClient()}><BoardGrid boardId={boardId} onOpenNote={onOpenNote} onTitle={onTitle} /></QueryClientProvider>);
});
const cards = () => [...host.querySelectorAll('[data-board-card]')].map((c) => c.getAttribute('data-board-card'));

describe('notePreview', () => {
  it('takes the markup out and cuts a long note', () => {
    expect(notePreview('<h2>Risen</h2><p>He is <strong>risen</strong>.</p>')).toContain('He is risen');
    expect(notePreview('<p>' + 'word '.repeat(200) + '</p>').endsWith('...')).toBe(true);
    expect(notePreview(undefined)).toBe('');
  });
});

describe('a board as a grid of its notes', () => {
  it('shows only that board\'s notes as cards, newest first, with the board name as the title and no notes list beside it', async () => {
    seed();
    const onTitle = vi.fn();
    await mount('a', vi.fn(), onTitle);
    expect(host.querySelector('h1')?.textContent).toBe('Sermons');
    expect(cards()).toEqual(['n1', 'n2']);
    expect(host.textContent).toContain('2 notes');
    expect(onTitle).toHaveBeenCalledWith('Sermons');
    expect(host.querySelector('[data-docs-tree], aside, nav')).toBeNull();
    expect(host.querySelector('[data-board-card="n1"]')?.textContent).toContain('He is risen');
  });

  it('"all" shows every note, loose ones too', async () => {
    seed();
    await mount('all');
    expect(host.querySelector('h1')?.textContent).toBe('All notes');
    expect(cards()).toEqual(['n1', 'n2', 'n3', 'n4']);
  });

  it('pressing a card opens that note', async () => {
    seed();
    const onOpenNote = vi.fn();
    await mount('a', onOpenNote);
    await act(async () => { host.querySelector<HTMLElement>('[data-board-open="n2"]')!.click(); });
    expect(onOpenNote).toHaveBeenCalledWith('n2');
  });

  it('New note writes an untitled private note into THIS board and opens it', async () => {
    seed();
    const onOpenNote = vi.fn();
    await mount('b', onOpenNote);
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('New note'))!;
    await act(async () => { button.click(); });
    expect(write.addDoc).toHaveBeenCalledWith('docs', expect.objectContaining({ title: 'Untitled', folderId: 'b', tenantId: 'grace', isPrivate: true, createdBy: 'u1' }));
    expect(onOpenNote).toHaveBeenCalledWith('fresh');
  });

  it('New note on "all" writes an unfiled note', async () => {
    seed();
    await mount('all');
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('New note'))!;
    await act(async () => { button.click(); });
    expect(write.addDoc).toHaveBeenCalledWith('docs', expect.objectContaining({ folderId: null }));
  });

  it('an empty board says so; loading and a failed read are not shown as empty', async () => {
    q.folders = { data: { items: [{ id: 'a', name: 'Sermons', parentId: null }] }, isLoading: false, isError: false };
    q.docs = { data: { items: [] }, isLoading: false, isError: false };
    await mount('a');
    expect(host.querySelector('[data-board-empty]')).toBeTruthy();
    q.docs = { data: undefined, isLoading: true, isError: false };
    await mount('a');
    expect(host.querySelector('[data-board-empty]')).toBeNull();
    expect(host.querySelector('[aria-busy]')).toBeTruthy();
    q.docs = { data: undefined, isLoading: false, isError: true };
    await mount('a');
    expect(host.querySelector('[data-board-empty]')).toBeNull();
    expect(host.textContent).toContain('could not be loaded');
  });

  it('writes nothing while it is merely rendered', async () => {
    seed();
    await mount('a');
    expect(write.addDoc).not.toHaveBeenCalled();
  });
});
