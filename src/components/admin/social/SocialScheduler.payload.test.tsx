import { act } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockSocialClient, resetSocialMock } from '@/lib/social/mock-client';
import { SocialScheduler } from './SocialScheduler';

const authFetch = vi.hoisted(() => vi.fn());

vi.mock('@/utils/auth-fetch', () => ({ authFetch }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const clock = new Date(Date.UTC(2024, 2, 15, 12));

interface Account { id: string; platform: string; username: string; displayName: string }

const TIKTOK: Account = { id: 'tt-1', platform: 'tiktok', username: 'grace', displayName: 'Grace' };
const FACEBOOK: Account = { id: 'fb-1', platform: 'facebook', username: 'grace', displayName: 'Grace' };
const INSTAGRAM: Account = { id: 'ig-1', platform: 'instagram', username: 'grace', displayName: 'Grace' };

interface SentPost {
  headers: Record<string, string> | undefined;
  body: {
    confirmToken?: string;
    targets: { platform: string; fields: Record<string, string | boolean> }[];
  };
}

describe('SocialScheduler payload', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetSocialMock();
    authFetch.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  });

  function serve(accounts: Account[]) {
    authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('bootstrap')) {
        return {
          status: 200,
          ok: true,
          json: async () => ({ entitled: true, sample: false, timezone: 'America/Chicago', accounts, posts: [] }),
        };
      }
      const body = JSON.parse(String(init?.body || '{}')) as { confirmToken?: string };
      if (!body.confirmToken) return { status: 200, ok: true, json: async () => ({ confirmToken: 'tok-1' }) };
      return { status: 503, ok: false, json: async () => ({ error: 'social_unavailable' }) };
    });
  }

  async function mountLive(accounts: Account[]) {
    serve(accounts);
    await act(async () => { root.render(<SocialScheduler onUpgrade={() => {}} />); });
  }

  async function type(copy: string, when = '2027-03-22T10:00') {
    const text = container.querySelector<HTMLTextAreaElement>('textarea');
    const time = container.querySelector<HTMLInputElement>('input[aria-label="Schedule time"]');
    await act(async () => {
      const area = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      const input = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      area?.call(text, copy);
      text?.dispatchEvent(new Event('input', { bubbles: true }));
      input?.call(time, when);
      time?.dispatchEvent(new Event('input', { bubbles: true }));
      time?.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  const button = (label: string, scope: ParentNode = container) =>
    [...scope.querySelectorAll('button')].find((candidate) => candidate.textContent === label);

  async function pressSchedule() {
    await act(async () => { button('Schedule')?.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }

  async function dismissConfirm() {
    const dialog = document.body.querySelector('[data-testid="social-confirm-dialog"]');
    await act(async () => { button('Cancel', dialog ?? document.body)?.click(); });
  }

  const trigger = (label: string) => container.querySelector<HTMLElement>(`[role="combobox"][aria-label="${label}"]`);

  /** Base UI opens a Select on pointer down, the way a mouse does. */
  async function openSelect(label: string) {
    const target = trigger(label);
    await act(async () => {
      target?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
      target?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      target?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
      target?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    });
  }

  const options = () => [...document.body.querySelectorAll<HTMLElement>('[role="option"]')];

  async function choose(label: string) {
    const option = options().find((candidate) => candidate.textContent?.includes(label));
    await act(async () => {
      option?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
      option?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      option?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }));
      option?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
      option?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    });
  }

  /** Every request that goes to the posts route, in order. */
  function postCalls(): SentPost[] {
    return authFetch.mock.calls
      .filter((call) => String(call[0]).includes('/api/social/posts'))
      .map((call) => {
        const init = call[1] as { headers?: Record<string, string>; body?: string } | undefined;
        return { headers: init?.headers, body: JSON.parse(String(init?.body || '{}')) as SentPost['body'] };
      });
  }

  const keys = () => postCalls().map((call) => call.headers?.['Idempotency-Key']);

  it('opens a platform Select, keeps it open, and sends the option that was chosen', async () => {
    await mountLive([INSTAGRAM]);
    expect(trigger('Placement')?.textContent).toContain('Feed');

    await openSelect('Placement');
    expect(options().map((option) => option.textContent)).toEqual(
      expect.arrayContaining(['Feed', 'Story', 'Reel']),
    );
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(options().length).toBe(3);
    expect(trigger('Placement')?.getAttribute('aria-expanded')).toBe('true');

    await choose('Reel');
    expect(trigger('Placement')?.textContent).toContain('Reel');
    expect(trigger('Placement')?.getAttribute('aria-expanded')).toBe('false');

    await type('Sunday at 10.');
    await pressSchedule();
    const [preview] = postCalls();
    expect(preview.body.targets[0].fields.contentType).toBe('reel');
  });

  it('switches the side panel list between drafts, scheduled and sent', async () => {
    const workspace = new MockSocialClient('preview', clock).load();
    await act(async () => {
      root.render(
        <SocialScheduler initial={{ ...workspace, entitled: true }} initialView="compose" onUpgrade={() => {}} />,
      );
    });
    const panel = container.querySelector<HTMLElement>('[data-testid="social-side-panel"]');
    const tab = (label: string) => [...(panel?.querySelectorAll('[role="tab"]') ?? [])]
      .find((candidate) => candidate.textContent === label) as HTMLElement | undefined;

    expect(tab('Drafts')?.getAttribute('aria-selected')).toBe('true');
    expect(panel?.textContent).toContain('This Sunday');
    expect(panel?.textContent).not.toContain('Verse of the day');

    await act(async () => { tab('Scheduled')?.click(); });
    expect(tab('Scheduled')?.getAttribute('aria-selected')).toBe('true');
    expect(panel?.textContent).toContain('Verse of the day');
    expect(panel?.textContent).not.toContain('This Sunday');
    expect(panel?.textContent).not.toContain('Thank you for gathering');

    await act(async () => { tab('Sent')?.click(); });
    expect(tab('Sent')?.getAttribute('aria-selected')).toBe('true');
    expect(panel?.textContent).toContain('Thank you for gathering');
    expect(panel?.textContent).not.toContain('Verse of the day');

    await act(async () => { tab('Drafts')?.click(); });
    expect(panel?.textContent).toContain('This Sunday');
  });

  it('sends the default of a Select the user never touched', async () => {
    await mountLive([INSTAGRAM]);
    expect(trigger('Placement')?.textContent).toContain('Feed');
    await type('Sunday at 10.');
    await pressSchedule();
    const [preview] = postCalls();
    expect(preview.body.targets).toHaveLength(1);
    expect(preview.body.targets[0].platform).toBe('instagram');
    expect(preview.body.targets[0].fields.contentType).toBe('feed');
  });

  it('sends the value the Select shows for a platform chosen after load', async () => {
    await mountLive([FACEBOOK, INSTAGRAM]);
    const platforms = container.querySelector('[aria-label="Platforms"]');
    await act(async () => { button('Instagram', platforms ?? container)?.click(); });
    expect(trigger('Placement')?.textContent).toContain('Feed');
    await act(async () => { button('Facebook', platforms ?? container)?.click(); });
    await type('Sunday at 10.');
    await pressSchedule();
    const [preview] = postCalls();
    expect(preview.body.targets.map((target) => target.platform)).toEqual(['instagram']);
    expect(preview.body.targets[0].fields).toEqual({ contentType: 'feed' });
  });

  it('does not offer TikTok as selectable and never sends it', async () => {
    await mountLive([TIKTOK, INSTAGRAM]);
    const platforms = container.querySelector('[aria-label="Platforms"]');
    expect(button('TikTok', platforms ?? container)).toBeUndefined();
    const tiktok = container.querySelector('[data-testid="tiktok-posting-disabled"]');
    expect(tiktok?.hasAttribute('disabled')).toBe(true);
    expect(container.querySelector('[data-testid="youtube-coming-soon"]')?.textContent).toBe('Video upload coming soon');
    await act(async () => { tiktok?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(trigger('Who can view')).toBeNull();
    await type('Sunday at 10.');
    await pressSchedule();
    const calls = postCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].body.targets.map((target) => target.platform)).toEqual(['instagram']);
  });

  it('selects nothing when the only connected account is TikTok', async () => {
    await mountLive([TIKTOK]);
    expect(trigger('Who can view')).toBeNull();
    await type('Sunday at 10.');
    await pressSchedule();
    expect(postCalls()).toHaveLength(0);
  });

  it('rotates the Idempotency-Key when the draft changes and keeps it for an identical retry', async () => {
    await mountLive([INSTAGRAM]);
    await type('Sunday at 10.');
    await pressSchedule();
    await dismissConfirm();
    await pressSchedule();
    await dismissConfirm();
    const [first, second] = keys();
    expect(first).toBeTruthy();
    expect(second).toBe(first);

    await type('Monday at 10.');
    await pressSchedule();
    await dismissConfirm();
    const afterText = keys().at(-1);
    expect(afterText).toBeTruthy();
    expect(afterText).not.toBe(first);

    await type('Monday at 10.', '2027-03-23T10:00');
    await pressSchedule();
    await dismissConfirm();
    const afterTime = keys().at(-1);
    expect(afterTime).not.toBe(afterText);

    await openSelect('Placement');
    await choose('Story');
    await pressSchedule();
    await dismissConfirm();
    const afterField = keys().at(-1);
    expect(postCalls().at(-1)?.body.targets[0].fields.contentType).toBe('story');
    expect(afterField).not.toBe(afterTime);

    await pressSchedule();
    await dismissConfirm();
    expect(keys().at(-1)).toBe(afterField);
  });

  it('renders the first client pass with the server timezone and reads the browser zone only after mount', async () => {
    const native = Intl.DateTimeFormat.prototype.resolvedOptions;
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function resolve(this: Intl.DateTimeFormat) {
      return { ...native.call(this), timeZone: 'America/Denver' };
    });
    const mismatch = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const unnamed = { ...new MockSocialClient('preview', new Date(Date.UTC(2024, 2, 15, 12))).load(), timezone: 'UTC', entitled: true };
      const html = renderToString(<SocialScheduler initial={unnamed} initialView="compose" onUpgrade={() => {}} />);
      expect(spy).not.toHaveBeenCalled();
      expect(html.replace(/<!-- -->/g, '')).toContain('Timezone UTC');

      authFetch.mockImplementation(() => new Promise(() => {}));
      const server = document.createElement('div');
      document.body.appendChild(server);
      server.innerHTML = html;
      let hydrated: Root | undefined;
      await act(async () => {
        hydrated = hydrateRoot(server, <SocialScheduler initial={unnamed} initialView="compose" onUpgrade={() => {}} />, { onRecoverableError: mismatch });
      });
      expect(mismatch).not.toHaveBeenCalled();
      expect(consoleError.mock.calls.filter((call) => /Hydration failed|did not match|Text content does not match|hydrat\w* error/i.test(String(call[0])))).toEqual([]);
      expect(server.textContent).toContain('Timezone America/Denver');
      await act(async () => { hydrated?.unmount(); });
      server.remove();
    } finally {
      consoleError.mockRestore();
      spy.mockRestore();
    }
  });
});
