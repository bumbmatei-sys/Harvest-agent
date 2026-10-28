import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { defaultCommunitySettings } from '@/lib/community/settings';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const fx = vi.hoisted(() => ({ groupExists: false, writes: [] as any[], save: null as any }));
vi.mock('@/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'admin' } } }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => path.join('/'), serverTimestamp: () => 'time',
  onSnapshot: (_ref: string, next: (s: any) => void) => { next({ exists: () => false }); return () => {}; },
  runTransaction: async (_db: unknown, fn: (tx: any) => Promise<void>) => fn({
    get: async (ref: string) => ({ exists: () => ref.endsWith('all-members') && fx.groupExists, data: () => undefined }),
    set: (ref: string, data: unknown) => fx.writes.push([ref, data]),
  }),
}));
vi.mock('./CommunitySettingsEditor', () => ({ CommunitySettingsEditor: ({ onSave }: any) => { fx.save = onSave; return null; } }));
import { CommunitySettingsScreen } from './CommunitySettingsScreen';

describe('community setup group bootstrap', () => {
  it('creates the default group during setup save only when absent', async () => {
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(<CommunitySettingsScreen tenantId="tenant" available={{} as any} />));
    const settings = defaultCommunitySettings();
    await act(async () => fx.save(settings, settings));
    expect(fx.writes).toContainEqual(['tenants/tenant/channels/all-members', expect.objectContaining({ audience: 'all', members: [], createdBy: 'admin' })]);
    fx.writes = []; fx.groupExists = true;
    await act(async () => fx.save(settings, settings));
    expect(fx.writes.map(([path]) => path)).toEqual(['tenants/tenant/settings/community']);
    await act(async () => root.unmount());
  });
});
