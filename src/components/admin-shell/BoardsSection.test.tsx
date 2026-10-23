import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarProvider } from '@/components/ui/sidebar';

const q = vi.hoisted(() => ({
  folders: { data: undefined as unknown, isLoading: false, isError: false },
  docs: { data: undefined as unknown, isLoading: false, isError: false },
}));
const write = vi.hoisted(() => ({ addDoc: vi.fn(async () => ({ id: 'new' })) }));
vi.mock('@/hooks/queries/useDocsQueries', () => ({ useDocFolders: () => q.folders, useDocs: () => q.docs }));
vi.mock('@/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('firebase/firestore', () => ({ addDoc: write.addDoc, collection: (_db: unknown, name: string) => name, serverTimestamp: () => 'ts' }));
vi.mock('@/utils/notify', () => ({ notifyError: vi.fn() }));

import { BoardsSection } from './BoardsSection';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); write.addDoc.mockClear(); });
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });

const ts = (ms: number) => ({ toMillis: () => ms, seconds: ms / 1000, nanoseconds: 0 });
const note = (id: string, folderId: string | null, ms: number, title: string) => ({ id, title, content: '', folderId, updatedAt: ts(ms), isPrivate: true, sharedWith: [] });

const seed = () => {
  q.folders = { data: { items: [{ id: 'a', name: 'Sermons', parentId: null }, { id: 'b', name: 'Youth', parentId: null }] }, isLoading: false, isError: false };
  q.docs = { data: { items: [
    note('n1', 'a', 5000, 'Easter'), note('n2', 'a', 4000, 'Advent'), note('n3', 'a', 3000, 'Lent'), note('n4', 'a', 2000, 'Pentecost'),
    note('n5', 'b', 1000, 'Camp'),
  ] }, isLoading: false, isError: false };
};

const mount = (props: Partial<React.ComponentProps<typeof BoardsSection>> = {}) => act(async () => {
  root.render(
    <QueryClientProvider client={new QueryClient()}>
      <SidebarProvider>
        <BoardsSection tenantId="grace" enabled activeId={null} onOpenBoard={() => {}} onOpenNote={() => {}} {...props} />
      </SidebarProvider>
    </QueryClientProvider>,
  );
});
const click = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });
const group = () => host.querySelector('[data-boards]')!;

describe('the Boards section of the People sidebar', () => {
  it('is headed "Boards" with a + beside it, and starts folded so the folders appear when it is pressed', async () => {
    seed();
    await mount();
    expect(group().textContent).toContain('Boards');
    expect(host.querySelector('[data-new-board]')).toBeTruthy();
    expect(host.querySelector('[data-board]')).toBeNull();
    await click(host.querySelector('[data-boards-toggle]'));
    expect([...host.querySelectorAll('[data-board]')].map((r) => r.textContent)).toEqual(['Sermons', 'Youth']);
    expect(host.querySelector('[data-board-all]')?.textContent).toContain('All notes');
  });

  it('sits right under the groups, not pushed to the bottom of the sidebar', async () => {
    seed();
    await mount();
    expect(group().className).not.toContain('mt-auto');
  });

  it('a board opens into its three newest notes and a See all; pressing it again closes it', async () => {
    seed();
    await mount();
    await click(host.querySelector('[data-boards-toggle]'));
    expect(host.querySelector('[data-board-notes]')).toBeNull();
    await click(host.querySelector('[data-board="a"]'));
    const list = host.querySelector('[data-board-notes="a"]')!;
    expect([...list.querySelectorAll('[data-board-note]')].map((r) => r.textContent)).toEqual(['Easter', 'Advent', 'Lent']);
    expect(list.querySelector('[data-board-see-all="a"]')?.textContent).toBe('See all');
    expect(list.textContent).not.toContain('Pentecost');
    await click(host.querySelector('[data-board="a"]'));
    expect(host.querySelector('[data-board-notes="a"]')).toBeNull();
  });

  it('a note opens that note; See all opens the board; All notes opens the whole grid', async () => {
    seed();
    const onOpenNote = vi.fn();
    const onOpenBoard = vi.fn();
    await mount({ onOpenNote, onOpenBoard });
    await click(host.querySelector('[data-boards-toggle]'));
    await click(host.querySelector('[data-board="a"]'));
    await click(host.querySelector('[data-board-note="n2"]'));
    expect(onOpenNote).toHaveBeenCalledWith('n2');
    await click(host.querySelector('[data-board-see-all="a"]'));
    expect(onOpenBoard).toHaveBeenCalledWith('a');
    await click(host.querySelector('[data-board-all]'));
    expect(onOpenBoard).toHaveBeenCalledWith('all');
  });

  it('marks the open board active', async () => {
    seed();
    await mount({ activeId: 'b' });
    await click(host.querySelector('[data-boards-toggle]'));
    expect(host.querySelector('[data-board="b"]')?.hasAttribute('data-active')).toBe(true);
    expect(host.querySelector('[data-board="a"]')?.hasAttribute('data-active')).toBe(false);
  });

  it('an empty board says so and still offers See all', async () => {
    q.folders = { data: { items: [{ id: 'a', name: 'Sermons', parentId: null }] }, isLoading: false, isError: false };
    q.docs = { data: { items: [] }, isLoading: false, isError: false };
    await mount();
    await click(host.querySelector('[data-boards-toggle]'));
    await click(host.querySelector('[data-board="a"]'));
    expect(host.querySelector('[data-board-notes="a"]')?.textContent).toContain('No notes yet');
    expect(host.querySelector('[data-board-see-all="a"]')).toBeTruthy();
  });

  it('says it is loading, then that a failed read failed, and never shows an empty list for either', async () => {
    q.folders = { data: undefined, isLoading: true, isError: false };
    q.docs = { data: undefined, isLoading: true, isError: false };
    await mount();
    await click(host.querySelector('[data-boards-toggle]'));
    expect(group().textContent).toContain('Loading boards');
    expect(group().textContent).not.toContain('No boards yet');
    await act(async () => root.unmount());
    root = createRoot(host);
    q.folders = { data: undefined, isLoading: false, isError: true };
    await mount();
    await click(host.querySelector('[data-boards-toggle]'));
    expect(group().querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
    expect(group().textContent).not.toContain('No boards yet');
  });

  it('All notes needs no data: it is there, and it is the Notes tab, when the boards cannot be read', async () => {
    q.folders = { data: undefined, isLoading: false, isError: true };
    q.docs = { data: undefined, isLoading: false, isError: true };
    await mount();
    await click(host.querySelector('[data-boards-toggle]'));
    expect(group().querySelector('[role="alert"]')).toBeTruthy();
    expect(host.querySelector('[data-board-all]')?.getAttribute('data-nav-tab')).toBe('docs');
    expect(group().getAttribute('data-nav-group-labels')).toBe('Notes');
  });

  it('+ asks for a name and writes a top-level folder in this tenant, then unfolds the list', async () => {
    seed();
    await mount();
    await click(host.querySelector('[data-new-board]'));
    const dialog = document.querySelector('[data-new-board-dialog]')!;
    const input = dialog.querySelector<HTMLInputElement>('input')!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(input, 'Prayer');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click([...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Create') ?? null);
    expect(write.addDoc).toHaveBeenCalledTimes(1);
    expect(write.addDoc).toHaveBeenCalledWith('docFolders', expect.objectContaining({ name: 'Prayer', parentId: null, tenantId: 'grace', createdBy: 'u1', order: 2 }));
    expect(host.querySelector('[data-board]')).toBeTruthy();
  });

  it('writes nothing while it is merely rendered', async () => {
    seed();
    await mount();
    expect(write.addDoc).not.toHaveBeenCalled();
  });
});
