import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { GroupList } from './GroupList';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('group list', () => {
  it('pins the all-members group, displays activity and selects a group', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const select = vi.fn();
    await act(async () => root.render(<GroupList channels={[
      { id: 'prayer', name: 'Prayer', lastMessage: 'See you', unreadCount: 3 },
      { id: 'all-members', name: 'All members', lastMessage: 'Welcome' },
    ]} selectedId="all-members" onSelect={select} renderTime={() => '10:30'} />));
    const buttons = host.querySelectorAll('button');
    expect(buttons[0].textContent).toContain('All members');
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1].textContent).toContain('See you');
    expect(buttons[1].textContent).toContain('10:30');
    expect(buttons[1].textContent).toContain('3');
    await act(async () => buttons[1].click());
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: 'prayer' }));
    await act(async () => root.unmount());
    host.remove();
  });
});
