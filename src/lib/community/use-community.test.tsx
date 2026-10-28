import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCommunityMember, useCommunitySettings } from './use-community';
import { defaultCommunitySettings, needsCommunityEntry } from './settings';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const firestore = vi.hoisted(() => ({ listeners: new Map<string, { next: (s: any) => void; error: () => void }>(), set: vi.fn() }));
vi.mock('@/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  onSnapshot: (path: string, next: (s: any) => void, error: () => void) => { firestore.listeners.set(path, { next, error }); return () => firestore.listeners.delete(path); },
  setDoc: firestore.set,
  serverTimestamp: () => 'timestamp',
}));
const snapshot = (data?: unknown) => ({ exists: () => data !== undefined, data: () => data });
let result: ReturnType<typeof useCommunitySettings>;
let member: ReturnType<typeof useCommunityMember>;
function Probe({ tenant, uid = 'u' }: { tenant: string; uid?: string }) {
  result = useCommunitySettings(tenant);
  member = useCommunityMember(tenant, uid, true);
  return null;
}
afterEach(() => { firestore.listeners.clear(); firestore.set.mockReset(); });
describe('tenant community reads', () => {
  it('uses defaults while loading or missing, changes scope, and surfaces read failures', async () => {
    const host = document.createElement('div'); const root = createRoot(host);
    await act(async () => root.render(<Probe tenant="a" />));
    expect(result.loading).toBe(true); expect(result.settings.modules.news).toBe(true);
    const settings = defaultCommunitySettings(); settings.modules.news = false;
    await act(async () => firestore.listeners.get('tenants/a/settings/community')!.next(snapshot(settings)));
    expect(result.settings.modules.news).toBe(false);
    await act(async () => root.render(<Probe tenant="b" />));
    expect(result.loading).toBe(true); expect(result.settings.modules.news).toBe(true);
    await act(async () => firestore.listeners.get('tenants/b/settings/community')!.next(snapshot()));
    expect(result.loading).toBe(false); expect(result.settings.modules.news).toBe(true);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => firestore.listeners.get('tenants/b/settings/community')!.next(snapshot({ modules: {} })));
    expect(result.settings).toEqual(defaultCommunitySettings());
    expect(log).toHaveBeenCalled();
    await act(async () => firestore.listeners.get('tenants/b/settings/community')!.error());
    expect(result.settings).toEqual(defaultCommunitySettings());
    log.mockRestore();
    expect(result.error).toContain('Could not load');
    await act(async () => root.unmount());
  });
  it('records answers and preserves them on rules-only reacceptance', async () => {
    const host = document.createElement('div'); const root = createRoot(host);
    await act(async () => root.render(<Probe tenant="a" />));
    await act(async () => firestore.listeners.get('tenants/a/communityMembers/u')!.next(snapshot({ rulesAcceptedVersion: 1, answers: { q: 'yes' }, answeredAt: 'time' })));
    const settings = defaultCommunitySettings(); settings.rules = { enabled: true, items: ['Rule'], version: 2 };
    expect(needsCommunityEntry(settings, member.member)).toBe(true);
    await act(async () => member.save(settings, {}));
    expect(firestore.set).toHaveBeenCalledWith('tenants/a/communityMembers/u', { rulesAcceptedVersion: 2, answers: { q: 'yes' }, answeredAt: 'timestamp' });
    settings.questions.enabled = true;
    await act(async () => member.save(settings, { q: 'new', __community_questions_pending__: 'true' }));
    expect(firestore.set.mock.lastCall![1].answers).toEqual({ q: 'new' });
    await act(async () => root.unmount());
  });
  it('asks newly enabled questions after a rules-only entry', () => {
    const settings = defaultCommunitySettings(); settings.questions.enabled = true;
    expect(needsCommunityEntry(settings, { rulesAcceptedVersion: 1, answeredAt: 'time', answers: { __community_questions_pending__: 'true' } })).toBe(true);
  });
});
