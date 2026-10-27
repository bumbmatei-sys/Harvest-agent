import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { defaultCommunitySettings } from '@/lib/community/settings';
import { CommunityEntryDialog } from './CommunityEntryDialog';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('community entry', () => {
  it('requires rule acceptance and a required answer before submitting', async () => {
    const settings = defaultCommunitySettings();
    settings.rules = { enabled: true, items: ['Be kind'], version: 1 };
    settings.questions = { enabled: true, items: [{ id: 'q', type: 'short', label: 'Your goal', options: [], required: true }] };
    const submit = vi.fn().mockResolvedValue(undefined);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<CommunityEntryDialog settings={settings} onSubmit={submit} />));
    const button = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Enter community')!;
    expect(button.disabled).toBe(true);
    expect(document.body.textContent).toContain('Be kind');
    await act(async () => root.unmount());
    host.remove();
  });
});
