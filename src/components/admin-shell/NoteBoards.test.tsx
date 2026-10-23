import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';

const q = vi.hoisted(() => ({ current: { data: undefined as unknown, isLoading: false, isError: false } }));
vi.mock('@/hooks/queries/useDocsQueries', () => ({ useDocFolders: () => q.current }));

import { NoteBoardsSection, topLevelBoards } from './NoteBoards';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });

const mount = (props: Partial<React.ComponentProps<typeof NoteBoardsSection>> = {}) => act(async () => {
  root.render(
    <TooltipProvider><SidebarProvider>
      <NoteBoardsSection tenantId="grace" enabled activeId={null} onOpen={() => {}} {...props} />
    </SidebarProvider></TooltipProvider>,
  );
});

describe('topLevelBoards', () => {
  it('keeps top-level folders only, in the order given, and names an unnamed one', () => {
    expect(topLevelBoards([
      { id: 'a', name: 'Sermons', parentId: null },
      { id: 'b', name: 'Series 1', parentId: 'a' },
      { id: 'c', name: '  ', parentId: undefined },
    ])).toEqual([{ id: 'a', name: 'Sermons' }, { id: 'c', name: 'Untitled board' }]);
  });
});

describe('the Note boards list at the bottom of the People sidebar', () => {
  it('lists the boards and opens one on click; the open one is marked active', async () => {
    const onOpen = vi.fn();
    q.current = { data: { items: [{ id: 'a', name: 'Sermons', parentId: null }, { id: 'b', name: 'Youth', parentId: null }] }, isLoading: false, isError: false };
    await mount({ onOpen, activeId: 'b' });
    const group = host.querySelector('[data-note-boards]')!;
    expect(group.textContent).toContain('Note boards');
    const rows = [...group.querySelectorAll<HTMLElement>('[data-note-board]')];
    expect(rows.map((r) => r.textContent)).toEqual(['Sermons', 'Youth']);
    expect(rows[1].hasAttribute('data-active')).toBe(true);
    expect(rows[0].hasAttribute('data-active')).toBe(false);
    await act(async () => { rows[0].click(); });
    expect(onOpen).toHaveBeenCalledWith('a');
  });

  it('sits at the bottom: its group pushes itself to the end of the sidebar column', async () => {
    q.current = { data: { items: [] }, isLoading: false, isError: false };
    await mount();
    expect(host.querySelector('[data-note-boards]')!.className).toContain('mt-auto');
  });

  it('says it is loading, then that there are no boards, and never mixes the two up', async () => {
    q.current = { data: undefined, isLoading: true, isError: false };
    await mount();
    expect(host.textContent).toContain('Loading boards');
    expect(host.textContent).not.toContain('No boards yet');
    q.current = { data: { items: [] }, isLoading: false, isError: false };
    await mount();
    expect(host.textContent).toContain('No boards yet');
  });

  it('shows a failed read as an error, not as "No boards yet"', async () => {
    q.current = { data: undefined, isLoading: false, isError: true };
    await mount();
    expect(host.querySelector('[role=alert]')?.textContent).toBe('Boards could not be loaded.');
    expect(host.textContent).not.toContain('No boards yet');
  });

  it('a read that throws shows the same message instead of taking the sidebar down', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    q.current = new Proxy({}, { get() { throw new Error('No QueryClient set'); } }) as never;
    await mount();
    expect(host.querySelector('[role=alert]')?.textContent).toBe('Boards could not be loaded.');
    error.mockRestore();
  });
});
