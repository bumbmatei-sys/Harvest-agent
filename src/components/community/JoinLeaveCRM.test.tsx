import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommunityEntryDialog } from './CommunityEntryDialog';
import { LeaveCommunity } from './LeaveCommunity';
import { CommunityContactBadge } from './CommunityContactBadge';
import { defaultCommunitySettings } from '@/lib/community/settings';
import { membershipRequest } from '@/lib/community/membership-request';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
afterEach(async () => { await act(async () => root.render(null)); });
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent === text)!;
describe('join consent', () => {
  it('requires enabled rules, shows the exact consent, sends consent and exposes the API error', async () => {
    const settings = defaultCommunitySettings(); settings.rules = { enabled: true, version: 3, items: ['Be kind.'] };
    const request = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'This community is not open to join.' }) });
    await act(async () => root.render(<CommunityEntryDialog joining settings={settings} onSubmit={answers => membershipRequest('join', { tenantId: 'a', source: 'discover', consent: true, acceptedConsentVersion: 2, rulesAcceptedVersion: 3, answers }, request)} />));
    expect(document.body.textContent).toContain('By joining, you agree that the community owner can contact you and can see your name, email and answers.');
    expect(button('Join community').disabled).toBe(true);
    await act(async () => document.querySelector<HTMLElement>('label')!.click());
    expect(button('Join community').disabled).toBe(false);
    await act(async () => button('Join community').click());
    expect(request).toHaveBeenCalledWith('/api/community/join', expect.objectContaining({ method: 'POST', body: JSON.stringify({ tenantId: 'a', source: 'discover', consent: true, acceptedConsentVersion: 2, rulesAcceptedVersion: 3, answers: {} }) }));
    expect(document.querySelector('[role=alert]')?.textContent).toBe('This community is not open to join.');
  });
  it('allows joining when rules are disabled and disables repeat clicks while pending', async () => {
    let resolve!: () => void;
    const submit = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    await act(async () => root.render(<CommunityEntryDialog joining settings={defaultCommunitySettings()} onSubmit={submit} />));
    expect(button('Join community').disabled).toBe(false);
    await act(async () => button('Join community').click());
    expect(button('Joining…').disabled).toBe(true);
    await act(async () => resolve());
    expect(submit).toHaveBeenCalledOnce();
  });
});
describe('leave confirmation', () => {
  it('only leaves on confirmation, allows cancel, shows failures and retries', async () => {
    const leave = vi.fn().mockRejectedValueOnce(new Error('Could not update community membership.')).mockResolvedValue(undefined);
    await act(async () => root.render(<LeaveCommunity name="Grace" onLeave={leave} />));
    await act(async () => button('Leave community').click());
    expect(document.querySelector('[role=alertdialog]')).toBeTruthy();
    expect(leave).not.toHaveBeenCalled();
    await act(async () => button('Cancel').click());
    expect(leave).not.toHaveBeenCalled();
    await act(async () => button('Leave community').click());
    await act(async () => button('Confirm leave').click());
    expect(document.querySelector('[role=alert]')?.textContent).toContain('Could not update');
    await act(async () => button('Confirm leave').click());
    expect(leave).toHaveBeenCalledTimes(2);
  });
  it('hides Leave for owners and admins', async () => {
    await act(async () => root.render(<LeaveCommunity isAdmin name="Grace" onLeave={vi.fn()} />));
    expect(host.textContent).toBe('');
  });
});
describe('CRM community badge', () => {
  it.each([['discover', 'Discover'], ['link', 'Link'], ['website', 'Website']] as const)('shows %s source and the retained leave date', async (source, label) => {
    await act(async () => root.render(<CommunityContactBadge contact={{ source: 'community', communitySource: source, communityStatus: 'left', communityLeftAt: new Date('2020-01-02T12:00:00Z') }} />));
    expect(host.textContent).toBe(`Community · ${label} · Left 2 Jan 2020`);
  });
  it('does not label ordinary contacts or conceal an invalid leave date', async () => {
    await act(async () => root.render(<CommunityContactBadge contact={{ source: 'manual' }} />)); expect(host.textContent).toBe('');
    await act(async () => root.render(<CommunityContactBadge contact={{ source: 'community', communityStatus: 'left' }} />));
    expect(host.textContent).toContain('Left (date unavailable)');
  });
});
