import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutoDmInput, AutoDmRule } from '@/lib/social/auto-dm';
import { SocialScheduler } from './SocialScheduler';
import type { AutoDmApi } from './SocialAutoDmView';

const authFetch = vi.hoisted(() => vi.fn());
vi.mock('@/utils/auth-fetch', () => ({ authFetch }));
vi.mock('@/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'test-token' } } }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FACEBOOK = { id: 'fb-1', platform: 'facebook', username: 'grace', displayName: 'Grace' };
const YOUTUBE = { id: 'yt-1', platform: 'youtube', username: 'grace', displayName: 'Grace' };

describe('Auto-DM from the composer', () => {
  let container: HTMLDivElement;
  let root: Root;
  let saves: { id: string | null; input: AutoDmInput }[];
  let failSave: string | null;
  const autoDmApi: AutoDmApi = {
    list: async () => ({ rules: [], accounts: [], posts: [] }),
    save: async (id, input) => {
      if (failSave) throw new Error(failSave);
      saves.push({ id, input });
      return { ...input, id: 'a1', platform: 'facebook', stats: { triggered: null, sent: null, failed: null, clicks: null } } as AutoDmRule;
    },
    remove: async () => {},
    logs: async () => [],
  };

  beforeEach(() => {
    saves = [];
    failSave = null;
    authFetch.mockReset();
    authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('bootstrap')) {
        return { status: 200, ok: true, json: async () => ({ entitled: true, sample: false, timezone: 'America/Chicago', accounts: [FACEBOOK, YOUTUBE], posts: [] }) };
      }
      const body = JSON.parse(String(init?.body || '{}')) as { confirmToken?: string };
      if (!body.confirmToken) return { status: 200, ok: true, json: async () => ({ confirmToken: 'tok-1' }) };
      return { status: 200, ok: true, json: async () => ({ post: { id: 'post-9', content: 'Free guide below', status: 'scheduled', targets: [], media: [] }, sample: false }) };
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); });

  const button = (label: string, scope: ParentNode = container) => [...scope.querySelectorAll('button')].find((b) => b.textContent === label);
  async function set(selector: string, value: string) {
    const el = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    expect(el, selector).toBeTruthy();
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
  async function schedule() {
    await act(async () => { button('Schedule')?.click(); });
    await settle();
  }
  async function confirm() {
    const dialog = document.body.querySelector('[data-testid="social-confirm-dialog"]')!;
    await act(async () => { button('Confirm', dialog)?.click(); });
    await settle();
  }

  async function mount() {
    await act(async () => { root.render(<SocialScheduler onUpgrade={() => {}} autoDmApi={autoDmApi} />); });
    await settle();
    await set('textarea', 'Free guide below');
    await set('input[aria-label="Schedule time"]', '2027-03-22T10:00');
  }

  it('is offered only when Instagram or Facebook is chosen, and needs a keyword and a DM', async () => {
    await mount();
    const section = () => container.querySelector('[data-testid="composer-auto-dm"]');
    expect(section()).toBeTruthy();
    await act(async () => { (container.querySelector('[aria-label="Auto-DM"]') as HTMLElement).click(); });
    await schedule();
    expect(container.textContent).toContain('Add a keyword and the DM for Auto-DM, or turn it off.');
    expect(authFetch.mock.calls.some((call) => String(call[0]).includes('/api/social/posts'))).toBe(false);
  });

  it('attaches an automation to the saved post, on the Facebook account only', async () => {
    await mount();
    await act(async () => { (container.querySelector('[aria-label="Auto-DM"]') as HTMLElement).click(); });
    await set('input[aria-label="Auto-DM keywords"]', 'guide, pdf');
    await set('textarea[aria-label="Auto-DM message"]', 'Here it is, {{first_name}}!');
    await set('input[aria-label="Auto-DM public reply"]', 'Check your DMs!');
    await schedule();
    expect(saves).toEqual([]);
    await confirm();
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({
      id: null,
      input: { accountId: 'fb-1', keywords: ['guide', 'pdf'], dmMessage: 'Here it is, {{first_name}}!', commentReply: 'Check your DMs!', postId: 'post-9', postTitle: 'Free guide below', trigger: 'comment' },
    });
    expect(container.textContent).toContain('Scheduled.');
  });

  it('keeps the post and says so when the automation is refused', async () => {
    await mount();
    await act(async () => { (container.querySelector('[aria-label="Auto-DM"]') as HTMLElement).click(); });
    await set('input[aria-label="Auto-DM keywords"]', 'guide');
    await set('textarea[aria-label="Auto-DM message"]', 'Here it is');
    failSave = 'That post is not one of this account’s posts.';
    await schedule();
    await confirm();
    expect(container.textContent).toContain('Saved. Auto-DM could not be attached (That post is not one of this account’s posts.). Set it up under Auto-DM.');
  });
});
