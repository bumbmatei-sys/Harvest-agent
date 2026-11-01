import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newAutoDm, type AutoDmInput, type AutoDmRule } from '@/lib/social/auto-dm';
import type { AutoDmWorkspace } from '@/lib/social/session';
import { SocialAutoDmView, type AutoDmApi } from './SocialAutoDmView';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
afterEach(async () => { await act(async () => root.render(null)); });

const ACCOUNTS: AutoDmWorkspace['accounts'] = [
  { id: 'ig', platform: 'instagram', username: 'gracechapel', displayName: 'Grace' },
  { id: 'fb', platform: 'facebook', username: 'gracechapelfb', displayName: 'Grace FB' },
];
const rule = (patch: Partial<AutoDmRule> = {}): AutoDmRule => ({
  ...newAutoDm('ig'), id: 'r1', platform: 'instagram', name: 'Guide', keywords: ['guide'], dmMessage: 'Here it is',
  stats: { triggered: 12, sent: 10, failed: 0, clicks: 4 }, ...patch,
});

function api(workspace: Partial<AutoDmWorkspace> = {}) {
  const saved: { id: string | null; input: AutoDmInput }[] = [];
  let failNext: string | null = null;
  const value = {
    list: vi.fn(async () => ({ rules: [rule(), rule({ id: 'r2', name: 'Prayer', isActive: false, stats: { triggered: null, sent: 5, failed: null, clicks: 1 } })], accounts: ACCOUNTS, posts: [], ...workspace })),
    save: vi.fn(async (id: string | null, input: AutoDmInput) => {
      if (failNext) { const message = failNext; failNext = null; throw new Error(message); }
      saved.push({ id, input });
      return { ...rule(), ...input, id: id ?? 'new-1', platform: input.accountId === 'fb' ? 'facebook' : 'instagram' } as AutoDmRule;
    }),
    remove: vi.fn(async () => {}),
    logs: vi.fn(async () => [{ id: 'l1', commenter: 'ruth', text: 'guide please', status: 'sent' as const, at: null }]),
  } satisfies AutoDmApi;
  return { api: value, saved, failOnce: (message: string) => { failNext = message; } };
}

const all = () => [...document.querySelectorAll<HTMLButtonElement>('button')];
const button = (label: string) => all().find((b) => b.textContent?.trim() === label)!;
const click = async (el: Element | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); };
async function fill(selector: string, value: string) {
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  expect(el, selector).toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const editor = () => document.querySelector('[data-testid="auto-dm-editor"]');
async function mount(value: AutoDmApi) {
  await act(async () => root.render(<SocialAutoDmView api={value} />));
  await act(async () => { await Promise.resolve(); });
}

describe('Auto-DM (Eden 005–007, Zernio comment-to-DM)', () => {
  it('sums what the automations sent and how many clicked, and leaves an unreported count unknown', async () => {
    await mount(api().api);
    const tile = (label: string) => host.querySelector(`[data-auto-dm-tile="${label}"]`)?.textContent;
    expect(tile('Active automations')).toContain('1');
    expect(tile('DMs sent')).toContain('15');
    expect(tile('Link clicks')).toContain('5');
    expect(tile('Click rate')).toContain('33.3%');
    expect(host.querySelector('[data-auto-dm-summary="r2"]')?.textContent).toContain('Paused');
  });

  it('lists automations with their trigger and keywords, turns one off, and shows who triggered it', async () => {
    const { api: value } = api();
    await mount(value);
    await click(all().find((b) => b.textContent?.startsWith('Automations')));
    const row = host.querySelector('[data-auto-dm-rule="r1"]')!;
    expect(row.textContent).toContain('Comments on a post or reel · Any post · @gracechapel');
    expect(row.textContent).toContain('guide');
    await click(row.querySelector('[role="switch"]')!);
    expect(value.save).toHaveBeenCalledWith('r1', expect.objectContaining({ isActive: false, name: 'Guide' }));
    await click([...row.querySelectorAll('button')].find((b) => b.textContent === 'Activity'));
    expect(value.logs).toHaveBeenCalledWith('r1');
    expect(host.querySelector('[data-auto-dm-logs="r1"]')?.textContent).toContain('ruthguide pleaseSent');
  });

  it('creates an automation with keywords, a link button and a public reply, and shows a refusal on the form', async () => {
    const harness = api();
    await mount(harness.api);
    await click(button('New automation'));
    expect(editor()).toBeTruthy();
    await fill('[data-testid="auto-dm-editor"] input[placeholder="Free guide"]', 'Free guide');
    await fill('[data-testid="auto-dm-editor"] input[placeholder="guide, pdf"]', 'guide, PDF ,');
    await fill('[data-testid="auto-dm-editor"] textarea[placeholder^="Hey"]', 'Hey {{first_name}}!');
    await click(button('Add a button'));
    await fill('input[aria-label="Button 1 label"]', 'Get it');
    await fill('input[aria-label="Button 1 link"]', 'https://grace.test/guide');
    await fill('[data-testid="auto-dm-editor"] textarea[placeholder^="Check your DMs"]', 'Sent!');

    harness.failOnce('Keep the DM under 640 characters when it has buttons.');
    await click(button('Create automation'));
    expect(editor()?.querySelector('[role="alert"]')?.textContent).toBe('Keep the DM under 640 characters when it has buttons.');

    await click(button('Create automation'));
    expect(harness.saved).toHaveLength(1);
    expect(harness.saved[0]).toMatchObject({
      id: null,
      input: {
        accountId: 'ig', name: 'Free guide', keywords: ['guide', 'PDF'], dmMessage: 'Hey {{first_name}}!',
        buttons: [{ type: 'url', title: 'Get it', url: 'https://grace.test/guide' }], commentReply: 'Sent!',
        platformPostId: null, postId: null,
      },
    });
    expect(editor()).toBeNull();
    expect(host.querySelector('[data-auto-dm-rule="new-1"]')).toBeTruthy();
  });

  it('offers follower rules on Instagram only, and keeps an existing automation on its account', async () => {
    const harness = api({ rules: [rule({ id: 'f1', accountId: 'fb', platform: 'facebook', name: 'FB guide' })] });
    await mount(harness.api);
    await click(all().find((b) => b.textContent?.startsWith('Automations')));
    await click([...host.querySelectorAll('[data-auto-dm-rule="f1"] button')].find((b) => b.textContent === 'Edit'));
    expect(editor()?.textContent).not.toContain('Who gets it');
    expect(document.querySelector('[aria-label="Account"]')?.hasAttribute('disabled')).toBe(true);
    await click(button('Cancel'));
    await click(button('New automation'));
    expect(editor()?.textContent).toContain('Who gets it');
    expect(editor()?.textContent).toContain('Tap to unlock');
  });

  it('asks before deleting, then removes the automation', async () => {
    const { api: value } = api();
    await mount(value);
    await click(all().find((b) => b.textContent?.startsWith('Automations')));
    await click([...host.querySelectorAll('[data-auto-dm-rule="r2"] button')].find((b) => b.textContent === 'Delete'));
    expect(document.body.textContent).toContain('Delete Prayer?');
    expect(value.remove).not.toHaveBeenCalled();
    await click(all().filter((b) => b.textContent === 'Delete').at(-1));
    expect(value.remove).toHaveBeenCalledWith('r2');
    expect(host.querySelector('[data-auto-dm-rule="r2"]')).toBeNull();
  });

  it('asks for an Instagram or Facebook account before anything else', async () => {
    await mount(api({ accounts: [], rules: [] }).api);
    expect(host.querySelector('[data-testid="auto-dm-no-accounts"]')?.textContent).toContain('Connect Instagram or Facebook first');
    expect(button('New automation').disabled).toBe(true);
  });
});
