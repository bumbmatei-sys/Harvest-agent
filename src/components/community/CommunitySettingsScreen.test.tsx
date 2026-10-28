import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { defaultCommunitySettings } from '@/lib/community/settings';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const fx = vi.hoisted(() => ({ save: null as any }));
vi.mock('@/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'admin', getIdToken: async () => 'token' } } }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  onSnapshot: (_ref: string, next: (s: any) => void) => { next({ exists: () => false }); return () => {}; },
}));
vi.mock('./CommunitySettingsEditor', () => ({ CommunitySettingsEditor: ({ onSave }: any) => { fx.save = onSave; return null; } }));
import { CommunitySettingsScreen } from './CommunitySettingsScreen';

describe('community settings save', () => {
  it('sends settings to the authenticated server transaction', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(<CommunitySettingsScreen tenantId="tenant" available={{} as any} />));
    const settings = defaultCommunitySettings();
    await act(async () => fx.save(settings, settings));
    expect(fetchMock).toHaveBeenCalledWith('/api/community/settings', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      body: JSON.stringify({ tenantId: 'tenant', next: settings, previous: settings }),
    }));
    await act(async () => root.unmount());
    fetchMock.mockRestore();
  });
});
