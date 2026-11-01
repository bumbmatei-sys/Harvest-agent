import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inboxRows, SocialInboxView, type InboxApi } from './SocialInboxView';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
afterEach(async () => { await act(async () => root.render(null)); });

function api(): InboxApi & { reply: ReturnType<typeof vi.fn> } {
  return {
    list: vi.fn(async (kind) => kind === 'message'
      ? { kind, items: [{ id: 'dm1', platform: 'instagram', accountId: 'ig', participantName: 'Jane', lastMessage: 'Hi there', updatedAt: '2026-10-31T10:00:00Z', unread: true }] }
      : kind === 'comment'
        ? { kind, items: [{ postId: 'p1', platform: 'facebook', accountId: 'fb', postText: 'Sunday recap', commentCount: 1, updatedAt: '2026-10-31T09:00:00Z' }] }
        : { kind, items: [{ id: 'r1', platform: 'googlebusiness', accountId: 'g', reviewerName: 'Maria', rating: 4, text: 'Lovely church', createdAt: '2026-10-30T09:00:00Z', reply: null }] }),
    thread: vi.fn(async (kind) => kind === 'message'
      ? { kind, messages: [{ id: 'm1', direction: 'incoming' as const, text: 'Hi there', createdAt: null }] }
      : { kind, comments: [{ id: 'c1', authorName: 'Sam', text: 'Is there parking?', createdAt: null, fromAccount: false, replies: [] }] }),
    reply: vi.fn(async () => {}),
  } as never;
}
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label)!;
async function type(label: string, value: string) {
  const area = host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, value);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const click = async (el: Element) => act(async () => { (el as HTMLElement).click(); });
const ACCOUNTS = [{ id: 'ig', platform: 'instagram' as const, username: 'gracechapel', displayName: 'Grace' }];
async function pick(trigger: string, option: string) {
  await click(host.querySelector(`[aria-label="${trigger}"]`)!);
  const choice = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent === option)!;
  expect(choice, option).toBeTruthy();
  await act(async () => { choice.focus(); choice.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
}
const listed = () => [...host.querySelectorAll<HTMLElement>('[data-inbox-item]')].map((b) => b.dataset.inboxItem);

describe('the unified inbox (#584)', () => {
  it('opens a DM and sends a reply into it', async () => {
    const inbox = api();
    await act(async () => root.render(<SocialInboxView api={inbox} accounts={ACCOUNTS} />));
    // Zernio's layout: one list, newest first, "name · via @account", the network badge, unread dot.
    expect(listed()).toEqual(['dm1', 'p1', 'r1']);
    expect(host.querySelector('[data-inbox-item="dm1"]')?.textContent).toContain('Jane· via @gracechapel');
    expect(host.querySelector('[data-inbox-item="dm1"] [aria-label="Unread"]')).toBeTruthy();
    expect(host.querySelector('[data-inbox-item="dm1"] [data-platform-logo="instagram"]')).toBeTruthy();
    await click(host.querySelector('[data-inbox-item="dm1"]')!);
    expect(inbox.thread).toHaveBeenCalledWith('message', 'dm1');
    expect(host.querySelector('[data-message-direction="incoming"]')?.textContent).toBe('Hi there');
    expect(button('Send').disabled).toBe(true);
    await type('Write a reply', 'See you Friday');
    await click(button('Send'));
    expect(inbox.reply).toHaveBeenCalledWith({ kind: 'message', id: 'dm1', message: 'See you Friday' });
  });
  it('replies to the comment chosen, and to a review', async () => {
    const inbox = api();
    await act(async () => root.render(<SocialInboxView api={inbox} accounts={ACCOUNTS} />));
    await pick('Type', 'Comments');
    expect(listed()).toEqual(['p1']);
    await click(host.querySelector('[data-inbox-item="p1"]')!);
    await click(host.querySelector('[data-comment="c1"] button')!);
    await type('Reply to Sam', 'Yes, behind the hall.');
    await click(button('Send'));
    expect(inbox.reply).toHaveBeenCalledWith({ kind: 'comment', id: 'p1', message: 'Yes, behind the hall.', commentId: 'c1' });
    await pick('Type', 'Reviews');
    await click(host.querySelector('[data-inbox-item="r1"]')!);
    expect(host.querySelector('[data-inbox-review="r1"]')?.textContent).toContain('Lovely church');
    await type('Reply to this review', 'Thank you, Maria!');
    await click(button('Send'));
    expect(inbox.reply).toHaveBeenLastCalledWith({ kind: 'review', id: 'r1', message: 'Thank you, Maria!' });
  });
  it('filters by platform and account, and builds one newest-first list', async () => {
    await act(async () => root.render(<SocialInboxView api={api()} accounts={ACCOUNTS} />));
    await pick('Platform', 'Facebook');
    expect(listed()).toEqual(['p1']);
    await pick('Platform', 'All platforms');
    await pick('Account', '@gracechapel');
    expect(listed()).toEqual(['dm1']);
    expect(inboxRows([
      { kind: 'review', items: [{ id: 'old', platform: 'facebook', accountId: 'a', reviewerName: 'A', rating: null, text: '', createdAt: null, reply: 'done' }] },
      { kind: 'message', items: [{ id: 'new', platform: 'instagram', accountId: 'a', participantName: 'B', lastMessage: '', updatedAt: '2026-10-01T00:00:00Z', unread: false }] },
    ]).map((r) => [r.id, r.unread])).toEqual([['new', false], ['old', false]]);
  });

  it('keeps the text and says so when a reply fails', async () => {
    const inbox = api();
    inbox.reply.mockRejectedValueOnce(new Error('down'));
    await act(async () => root.render(<SocialInboxView api={inbox} />));
    await click(host.querySelector('[data-inbox-item="dm1"]')!);
    await type('Write a reply', 'Hello');
    await click(button('Send'));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Could not send. Please try again.');
    expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Hello');
  });
});
