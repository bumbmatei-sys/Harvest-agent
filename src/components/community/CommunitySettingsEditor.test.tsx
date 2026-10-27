import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { COMMUNITY_MODULES, defaultCommunitySettings, type CommunityModule } from '@/lib/community/settings';
import { CommunitySettingsEditor } from './CommunitySettingsEditor';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('community settings editor', () => {
  it('shows plan locks and saves the draft', async () => {
    const available = Object.fromEntries(COMMUNITY_MODULES.map(key => [key, key !== 'messages'])) as Record<CommunityModule, boolean>;
    const save = vi.fn().mockResolvedValue(undefined);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<CommunitySettingsEditor settings={defaultCommunitySettings()} available={available} onSave={save} />));
    expect(host.textContent).toContain('Not on your plan');
    expect(host.querySelector('[aria-label="Messages and groups"]')?.getAttribute('aria-disabled')).toBe('true');
    const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Save changes')!;
    await act(async () => button.click());
    expect(save).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    host.remove();
  });
});
