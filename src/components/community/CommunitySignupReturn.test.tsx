import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ next: undefined as undefined | ((snapshot: any) => void), fail: undefined as undefined | (() => void), stop: vi.fn(), subscribe: vi.fn() }));
vi.mock('@/firebase', () => ({ db: {} }));
vi.mock('@/store/useAppStore', () => ({ useAppStore: () => ({ currentUser: { uid: 'u' } }) }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, ...parts: string[]) => parts.join('/'), onSnapshot: (path: string, next: any, fail: any) => { h.subscribe(path); h.next = next; h.fail = fail; return h.stop; } }));
import { CommunitySignupReturn } from './CommunitySignupReturn';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); h.next = undefined; });
afterEach(async () => { await act(async () => root.render(null)); vi.restoreAllMocks(); });
describe('community return after free provisioning', () => {
  it('waits for durable onboarding completion, then returns to the consent popup once', async () => {
    sessionStorage.setItem('harvest_community_return', '/community/a?join=1&src=website');
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    await act(async () => root.render(<CommunitySignupReturn />));
    expect(h.subscribe).toHaveBeenCalledWith('users/u');
    await act(async () => h.next?.({ data: () => ({ signupInProgress: true, onboardingCompleted: true }) }));
    expect(assign).not.toHaveBeenCalled();
    await act(async () => h.next?.({ data: () => ({ tenantId: 'free-u', onboardingCompleted: true, signupInProgress: false }) }));
    await act(async () => h.next?.({ data: () => ({ tenantId: 'free-u', onboardingCompleted: true }) }));
    expect(assign).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith('/community/a?join=1&src=website');
    expect(sessionStorage.getItem('harvest_community_return')).toBeNull();
  });
  it('ignores unsafe return paths and exposes failed reads', async () => {
    sessionStorage.setItem('harvest_community_return', '//evil.test');
    await act(async () => root.render(<CommunitySignupReturn />));
    expect(h.subscribe).not.toHaveBeenCalled();
    await act(async () => root.render(null));
    sessionStorage.setItem('harvest_community_return', '/community/a?join=1');
    await act(async () => root.render(<CommunitySignupReturn />));
    await act(async () => h.fail?.());
    expect(host.querySelector('[role=alert]')?.textContent).toContain('Could not return');
  });
});
