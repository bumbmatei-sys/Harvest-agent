import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockSocialClient, resetSocialMock } from '@/lib/social/mock-client';
import { SocialScheduler } from './SocialScheduler';

const authFetch = vi.hoisted(() => vi.fn());

vi.mock('@/utils/auth-fetch', () => ({ authFetch }));
vi.mock('@/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'test-token' } } }));
vi.mock('@/lib/social/upload-media', () => ({ uploadSocialMedia: async (file: File) => ({ name: file.name, kind: 'image', mimeType: file.type, url: 'https://example.test/image.png' }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const clock = new Date(Date.UTC(2024, 2, 15, 12));

describe('SocialScheduler', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetSocialMock();
    authFetch.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  });

  async function attachImage() {
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Choose media files"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['image'], 'image.png', { type: 'image/png' })] });
    await act(async () => { input?.dispatchEvent(new Event('change', { bubbles: true })); });
  }

  it('shows the upgrade wall when the ministry does not hold the add-on', async () => {
    const workspace = new MockSocialClient('preview', clock).load();
    await act(async () => {
      root.render(
        <SocialScheduler
          initial={{ ...workspace, entitled: false, sample: false }}
          onUpgrade={() => {}}
        />,
      );
    });
    expect(container.querySelector('[data-testid="social-upgrade-wall"]')).toBeTruthy();
    expect(container.textContent).toContain('Social scheduling is an add-on');
    expect(container.textContent).toContain("plan does not include it");
    expect(container.textContent).not.toMatch(/\$\d/);
    expect(container.querySelector('[data-testid="social-scheduler"]')).toBeNull();
  });

  it('renders sample accounts, the composer, the calendar and the queue without an AI toggle', async () => {
    const workspace = new MockSocialClient('preview', clock).load();
    await act(async () => {
      root.render(
        <SocialScheduler
          initial={{ ...workspace, entitled: true }}
          initialView="compose"
          onUpgrade={() => {}}
        />,
      );
    });
    expect(container.querySelector('[data-testid="social-sample-banner"]')?.textContent).toContain('Sample');
    expect(container.querySelector('[data-testid="made-with-ai"]')).toBeNull();
    expect(container.textContent).not.toContain('Twitter');
    expect(container.textContent).not.toContain('X');

    // WAS an Accounts tab beside Compose. The founder moved Accounts to Settings,
    // so the page's tabs are the Planner's own: Compose, Calendar, Queue.
    expect([...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(['Compose', 'Calendar', 'Queue']);
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'Accounts')).toBe(false);
    expect(container.querySelector('h1')?.textContent).toBe('Planner');

    await act(async () => {
      const calendar = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Calendar');
      calendar?.click();
    });
    expect(container.querySelector('[data-testid="social-calendar"]')).toBeTruthy();

    await act(async () => {
      const queue = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Queue');
      queue?.click();
    });
    expect(container.querySelector('[data-testid="social-queue"]')).toBeTruthy();
    expect(container.textContent).toContain('This Sunday');
    // #581: Eden's three columns, each with its count, Scheduled grouped by day.
    const columns = [...container.querySelectorAll<HTMLElement>('[data-queue-column]')];
    expect(columns.map((c) => [c.dataset.queueColumn, c.querySelector('header')?.textContent])).toEqual([
      ['drafts', 'Drafts1'], ['scheduled', 'Scheduled1Chicago'], ['sent', 'Sent1'],
    ]);
    expect(columns[1].querySelector('[data-queue-day] h3')?.textContent).toBe('Tuesday Mar 12');
    expect(columns[1].textContent).toContain('10:00 AM');
    // #581: networks show as logos, as on Eden, each with an accessible name.
    expect(columns[1].querySelector('[data-platform-logo="instagram"]')?.getAttribute('aria-label')).toBe('Instagram');
    expect(columns[2].textContent).toContain('PostedMar 4, 9:00 AM');
    // Sent posts can no longer be edited or cancelled.
    expect([...columns[2].querySelectorAll('button')]).toHaveLength(0);
  });

  it('shows a distinct unavailable state when bootstrap answers 503', async () => {
    authFetch.mockResolvedValue({
      status: 503,
      ok: false,
      json: async () => ({ error: 'social_unavailable' }),
    });
    await act(async () => {
      root.render(<SocialScheduler onUpgrade={() => {}} />);
    });
    expect(container.querySelector('[data-testid="social-unavailable"]')).toBeTruthy();
    expect(container.textContent).toContain('Nothing was scheduled');
    expect(container.querySelector('[data-testid="social-upgrade-wall"]')).toBeNull();
    expect(container.querySelector('[data-testid="social-scheduler"]')).toBeNull();
  });

  it('shows the upgrade wall when bootstrap refuses an unentitled admin', async () => {
    authFetch.mockResolvedValue({
      status: 403,
      ok: false,
      json: async () => ({ error: 'social_scheduler_not_entitled' }),
    });
    await act(async () => {
      root.render(<SocialScheduler onUpgrade={() => {}} />);
    });
    expect(container.querySelector('[data-testid="social-upgrade-wall"]')).toBeTruthy();
    expect(container.textContent).toContain('Social scheduling is an add-on');
    expect(container.querySelector('[data-testid="social-scheduler"]')).toBeNull();
  });

  it('renders Sample Ministry when bootstrap bypasses the wall', async () => {
    const workspace = new MockSocialClient('preview', clock).load();
    authFetch.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        entitled: true,
        sample: true,
        timezone: workspace.timezone,
        accounts: workspace.accounts,
        posts: workspace.posts,
      }),
    });
    await act(async () => {
      root.render(<SocialScheduler onUpgrade={() => {}} />);
    });
    expect(container.querySelector('[data-testid="social-upgrade-wall"]')).toBeNull();
    expect(container.querySelector('[data-testid="social-sample-banner"]')?.textContent).toContain('Sample');
    await act(async () => {
      const accounts = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Accounts');
      accounts?.click();
    });
    expect(container.textContent).toContain('Sample Ministry');
  });

  it('keeps an undated draft out of the selected day', async () => {
    const workspace = new MockSocialClient('preview', clock).load();
    await act(async () => {
      root.render(
        <SocialScheduler
          initial={{ ...workspace, entitled: true }}
          initialView="calendar"
          onUpgrade={() => {}}
        />,
      );
    });
    // #581: a draft has no place on the week grid; it sits in the Drafts panel.
    expect([...container.querySelectorAll('[data-week-slot]')].some((slot) => slot.textContent?.includes('This Sunday'))).toBe(false);
    expect(container.querySelector('[data-testid="social-calendar-drafts"]')?.textContent).toContain('This Sunday');
    // The Drafts button hides and shows the panel.
    const toggle = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Drafts' && button.hasAttribute('aria-pressed'))!;
    await act(async () => { toggle.click(); });
    expect(container.querySelector('[data-testid="social-calendar-drafts"]')).toBeNull();
    await act(async () => { toggle.click(); });
    expect(container.querySelector('[data-testid="social-calendar-drafts"]')).toBeTruthy();
  });

  it('centers the composer with its preview beside it on desktop classes only', async () => {
    const workspace = new MockSocialClient('preview', clock).load();
    await act(async () => {
      root.render(
        <SocialScheduler
          initial={{ ...workspace, entitled: true }}
          initialView="compose"
          onUpgrade={() => {}}
        />,
      );
    });
    const rootEl = container.querySelector('[data-testid="social-scheduler"]');
    expect(rootEl?.className).not.toContain('max-w-5xl');
    expect(container.querySelector('[data-testid="social-composer"]')?.className).toContain('lg:max-w-[640px]');
    const row = container.querySelector('[data-testid="social-compose-row"]');
    expect(row?.className).toContain('lg:justify-center');
    expect(row?.className).not.toContain('justify-end');
    expect(row?.className).not.toContain('flex-1');
    // WAS a docked Drafts / Scheduled / Sent panel; #581 follows Eden: the Queue holds
    // those lists, and the composer's right side is the post's live preview.
    expect(container.querySelector('[data-testid="social-side-panel"]')).toBeNull();
    const preview = container.querySelector('[data-testid="social-preview"]');
    expect(preview?.textContent).toContain('Main preview');
    expect(preview?.textContent).toContain('Each platform');
  });

  it('shows a loading state, never the composer, until the server has answered, then the unavailable card if the load fails', async () => {
    let release: (value: { status: number; ok: boolean; json: () => Promise<unknown> }) => void = () => {};
    authFetch.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    await act(async () => {
      root.render(<SocialScheduler onUpgrade={() => {}} />);
    });
    expect(container.querySelector('[data-testid="social-gate-loading"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="social-composer"]')).toBeNull();
    expect(container.querySelector('[data-testid="social-upgrade-wall"]')).toBeNull();
    await act(async () => {
      release({ status: 503, ok: false, json: async () => ({ error: 'social_unavailable' }) });
    });
    expect(container.querySelector('[data-testid="social-unavailable"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="social-gate-loading"]')).toBeNull();
  });

  it('holds the loading state while the shell has not resolved the plan, even with data in hand', async () => {
    const workspace = new MockSocialClient('preview', clock).load();
    await act(async () => {
      root.render(<SocialScheduler planLoading initial={{ ...workspace, entitled: false, sample: false }} onUpgrade={() => {}} />);
    });
    expect(container.querySelector('[data-testid="social-gate-loading"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="social-upgrade-wall"]')).toBeNull();
    await act(async () => {
      root.render(<SocialScheduler initial={{ ...workspace, entitled: false, sample: false }} onUpgrade={() => {}} />);
    });
    expect(container.querySelector('[data-testid="social-gate-loading"]')).toBeNull();
    expect(container.querySelector('[data-testid="social-upgrade-wall"]')).toBeTruthy();
  });

  it.each([
    ['Admin access required', 'only an admin with full access'],
    ['Access denied to this tenant', 'refused for this account'],
  ])('does not call a %s refusal an upgrade: a Ministry-plan admin is not told to buy the plan', async (error, copy) => {
    authFetch.mockResolvedValue({ status: 403, ok: false, json: async () => ({ error }) });
    await act(async () => {
      root.render(<SocialScheduler onUpgrade={() => {}} />);
    });
    expect(container.querySelector('[data-testid="social-upgrade-wall"]')).toBeNull();
    expect(container.querySelector('[data-testid="social-forbidden"]')?.textContent).toContain(copy);
    expect(container.querySelector('[data-testid="social-gate-loading"]')).toBeNull();
  });

  it('settles on the scheduler without ever painting the wall when the server entitles a Ministry admin', async () => {
    const workspace = new MockSocialClient('preview', clock).load();
    let release: (value: { status: number; ok: boolean; json: () => Promise<unknown> }) => void = () => {};
    authFetch.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const frames: string[] = [];
    const observer = new MutationObserver(() => {
      frames.push(container.querySelector('[data-testid="social-upgrade-wall"]') ? 'wall' : container.querySelector('[data-testid="social-scheduler"]') ? 'scheduler' : 'other');
    });
    observer.observe(container, { childList: true, subtree: true });
    await act(async () => {
      root.render(<SocialScheduler onUpgrade={() => {}} />);
    });
    await act(async () => {
      release({ status: 200, ok: true, json: async () => ({ entitled: true, sample: false, timezone: workspace.timezone, accounts: workspace.accounts, posts: workspace.posts }) });
    });
    observer.disconnect();
    expect(frames).not.toContain('wall');
    expect(container.querySelector('[data-testid="social-scheduler"]')).toBeTruthy();
  });

  it('keeps the loading line in place until entitlement is known', async () => {
    let release: (value: { status: number; ok: boolean; json: () => Promise<unknown> }) => void = () => {};
    authFetch.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    await act(async () => {
      root.render(<SocialScheduler onUpgrade={() => {}} />);
    });
    expect(container.querySelector('[data-testid="social-composer"]')).toBeNull();
    expect(container.textContent).toContain('Loading social accounts.');
    await act(async () => {
      release({ status: 503, ok: false, json: async () => ({ error: 'social_unavailable' }) });
    });
    expect(container.querySelector('[data-testid="social-unavailable"]')).toBeTruthy();
  });

  it('offers connected YouTube and requires a video before scheduling', async () => {
    const workspace = new MockSocialClient('preview', clock).load();
    await act(async () => { root.render(<SocialScheduler initial={{ ...workspace, entitled: true }} onUpgrade={() => {}} />); });
    const platforms = container.querySelector('[aria-label="Platforms"]');
    const youtube = [...(platforms?.querySelectorAll('button') ?? [])].find((button) => button.textContent === 'YouTube');
    await act(async () => { youtube?.click(); });
    expect(container.textContent).not.toContain('LinkedIn');
    expect(container.textContent).not.toContain('Twitter');
    expect(container.textContent).toContain('YouTube needs exactly one video.');
    expect([...container.querySelectorAll('button')].find((button) => button.textContent === 'Schedule')?.disabled).toBe(true);
  });

  it('lists Facebook, Instagram and YouTube even when sample accounts exist', async () => {
    const workspace = new MockSocialClient('preview', clock).load();
    await act(async () => {
      root.render(
        <SocialScheduler initial={{ ...workspace, entitled: true }} initialView="accounts" onUpgrade={() => {}} />,
      );
    });
    expect(container.querySelector('[data-testid="connect-facebook"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="connect-instagram"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="connect-threads"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="connect-tiktok"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="connect-youtube"]')?.hasAttribute('disabled')).toBe(false);
  });

  // WAS 'names the selected calendar day and lists that day's post' (a month picker
  // and one day's list). #581 replaces both with Eden's week grid.
  it('shows the week around the default day, places each post in its day and hour, and pages by week', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(clock);
    try {
      const workspace = new MockSocialClient('preview', clock).load();
      await act(async () => {
        root.render(
          <SocialScheduler initial={{ ...workspace, entitled: true }} initialView="calendar" onUpgrade={() => {}} />,
        );
      });
      const title = () => container.querySelector('[data-testid="social-week-title"]')?.textContent;
      const days = () => [...container.querySelectorAll<HTMLElement>('[data-week-day]')].map((d) => d.dataset.weekDay);
      expect(title()).toBe('Week of March 15');
      expect(days()).toEqual(['2024-03-15', '2024-03-16', '2024-03-17', '2024-03-18', '2024-03-19', '2024-03-20', '2024-03-21']);
      expect(container.querySelector('[data-testid="social-calendar"]')?.textContent).not.toContain('Verse of the day');
      await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Previous week"]')!.click(); });
      expect(title()).toBe('Week of March 8');
      // Verse of the day is scheduled for 10:00 on 12 March in the ministry's zone.
      expect(container.querySelector('[data-week-slot="2024-03-12@10"]')?.textContent).toContain('Verse of the day');
      expect(container.querySelector('[data-week-slot="2024-03-12@10"]')?.textContent).toContain('10:00 AM');
      expect(container.querySelector('[data-week-slot="2024-03-12@10"] [data-platform-logo="instagram"]')).toBeTruthy();
      await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Next week"]')!.click(); });
      expect(title()).toBe('Week of March 15');
    } finally {
      vi.useRealTimers();
    }
  });
  it('saves an undated draft edit and keeps a scheduled time required', async () => {
    const workspace = new MockSocialClient('preview', clock).load();
    await act(async () => {
      root.render(
        <SocialScheduler initial={{ ...workspace, posts: workspace.posts.map((post) => ({ ...post, media: [{ name: 'image.png', kind: 'image' as const, url: 'https://example.test/image.png', mimeType: 'image/png' }] })), entitled: true }} initialView="queue" onUpgrade={() => {}} />,
      );
    });
    const edits = [...container.querySelectorAll('button')].filter((button) => button.textContent === 'Edit');
    await act(async () => { edits[0]?.click(); });
    const save = [...document.body.querySelectorAll('button')].find((button) => button.textContent === 'Save');
    await act(async () => { save?.click(); });
    expect(document.body.querySelector('[data-testid="social-edit-error"]')).toBeNull();
    const confirm = document.body.querySelector('[data-testid="social-confirm-dialog"]');
    expect(confirm?.textContent).toContain('Save this edit?');
    const dismiss = [...(confirm?.querySelectorAll('button') ?? [])].find((button) => button.textContent === 'Cancel');
    await act(async () => { dismiss?.click(); });
    const scheduledEdit = [...container.querySelectorAll('button')].filter((button) => button.textContent === 'Edit')[1];
    await act(async () => { scheduledEdit?.click(); });
    const time = document.body.querySelector<HTMLInputElement>('input[aria-label="New time"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(time, '');
      time?.dispatchEvent(new Event('input', { bubbles: true }));
      time?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const saveScheduled = [...document.body.querySelectorAll('button')].find((button) => button.textContent === 'Save');
    await act(async () => { saveScheduled?.click(); });
    expect(document.body.querySelector('[data-testid="social-edit-error"]')?.textContent).toContain('Choose a time in the future');
    expect(document.body.querySelector('[data-testid="social-confirm-dialog"]')).toBeNull();
  });

  it('asks for a future time before the confirm dialog', async () => {
    const workspace = new MockSocialClient('preview', clock).load();
    await act(async () => {
      root.render(
        <SocialScheduler initial={{ ...workspace, entitled: true }} initialView="compose" onUpgrade={() => {}} />,
      );
    });
    const before = container.textContent;
    await attachImage();
    const schedule = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Schedule');
    await act(async () => { schedule?.click(); });
    expect(document.body.querySelector('[data-testid="social-confirm-dialog"]')).toBeNull();
    expect(container.textContent).toContain('Choose a time in the future');
    expect(container.textContent).toContain(before?.includes('This Sunday') ? 'This Sunday' : 'This Sunday');
  });

  it('opens confirm before writing, and cancel leaves the post unsent', async () => {
    const workspace = new MockSocialClient('preview', clock).load();
    await act(async () => {
      root.render(
        <SocialScheduler initial={{ ...workspace, entitled: true }} initialView="compose" onUpgrade={() => {}} />,
      );
    });
    const time = container.querySelector<HTMLInputElement>('input[aria-label="Schedule time"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(time, '2027-03-22T10:00');
      time?.dispatchEvent(new Event('input', { bubbles: true }));
      time?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await attachImage();
    const schedule = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Schedule');
    await act(async () => { schedule?.click(); });
    expect(document.body.querySelector('[data-testid="social-confirm-dialog"]')?.textContent).toContain('Schedule this post?');
    const cancel = [...document.body.querySelectorAll('button')].find((button) => button.textContent === 'Cancel');
    await act(async () => { cancel?.click(); });
    expect(document.body.querySelector('[data-testid="social-confirm-dialog"]')).toBeNull();
    expect(container.textContent).not.toContain('Saved in this preview');
  });

  it('keeps the composer when the preview call fails', async () => {
    const workspace = new MockSocialClient('live', clock).load();
    authFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('bootstrap')) {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            entitled: true,
            sample: true,
            timezone: workspace.timezone,
            accounts: workspace.accounts,
            posts: workspace.posts,
          }),
        };
      }
      return { status: 503, ok: false, json: async () => ({ error: 'social_unavailable' }) };
    });
    await act(async () => {
      root.render(<SocialScheduler onUpgrade={() => {}} />);
    });
    const text = container.querySelector<HTMLTextAreaElement>('textarea');
    const time = container.querySelector<HTMLInputElement>('input[aria-label="Schedule time"]');
    await act(async () => {
      const area = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      const input = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      area?.call(text, 'Sunday at 10.');
      text?.dispatchEvent(new Event('input', { bubbles: true }));
      input?.call(time, '2027-03-22T10:00');
      time?.dispatchEvent(new Event('input', { bubbles: true }));
      time?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await attachImage();
    const schedule = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Schedule');
    await act(async () => { schedule?.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-testid="social-unavailable"]')).toBeNull();
    expect(container.querySelector('textarea')?.value).toBe('Sunday at 10.');
    expect(document.body.textContent).toContain('Nothing was scheduled');
    const postsCalls = authFetch.mock.calls.filter((call) => String(call[0]).includes('/api/social/posts'));
    expect(postsCalls).toHaveLength(1);
  });

  it('reuses one Idempotency-Key when a schedule confirm is retried', async () => {
    const workspace = new MockSocialClient('live', clock).load();
    let confirms = 0;
    authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('bootstrap')) {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            entitled: true,
            sample: false,
            timezone: workspace.timezone,
            accounts: workspace.accounts,
            posts: workspace.posts,
          }),
        };
      }
      const body = JSON.parse(String(init?.body || '{}')) as { confirmToken?: string };
      if (!body.confirmToken) {
        return { status: 200, ok: true, json: async () => ({ confirmToken: 'tok-1' }) };
      }
      confirms += 1;
      if (confirms === 1) {
        return { status: 503, ok: false, json: async () => ({ error: 'social_unavailable' }) };
      }
      return { status: 200, ok: true, json: async () => ({ post: { id: 'p1' } }) };
    });
    await act(async () => {
      root.render(<SocialScheduler onUpgrade={() => {}} />);
    });
    const text = container.querySelector<HTMLTextAreaElement>('textarea');
    const time = container.querySelector<HTMLInputElement>('input[aria-label="Schedule time"]');
    await act(async () => {
      const area = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      const input = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      area?.call(text, 'Sunday at 10.');
      text?.dispatchEvent(new Event('input', { bubbles: true }));
      input?.call(time, '2027-03-22T10:00');
      time?.dispatchEvent(new Event('input', { bubbles: true }));
      time?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await attachImage();
    const schedule = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Schedule');
    await act(async () => { schedule?.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const confirm = () => [...document.body.querySelectorAll('button')].find((button) => button.textContent === 'Confirm');
    expect(confirm()?.hasAttribute('disabled')).toBe(false);
    await act(async () => { confirm()?.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(document.body.querySelector('[data-testid="social-confirm-error"]')).toBeTruthy();
    await act(async () => { confirm()?.click(); });
    await act(async () => { await Promise.resolve(); });
    const keys = authFetch.mock.calls
      .filter((call) => String(call[0]).includes('/api/social/posts'))
      .map((call) => {
        const init = call[1] as { headers?: Record<string, string> } | undefined;
        return init?.headers?.['Idempotency-Key'];
      })
      .filter((key): key is string => typeof key === 'string' && key.length > 0);
    expect(keys.length).toBeGreaterThanOrEqual(3);
    expect(new Set(keys).size).toBe(1);
  });

  it('sends the placement the menu already shows', async () => {
    const workspace = new MockSocialClient('live', clock).load();
    authFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('bootstrap')) {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            entitled: true,
            sample: false,
            timezone: workspace.timezone,
            accounts: workspace.accounts,
            posts: workspace.posts,
          }),
        };
      }
      return { status: 200, ok: true, json: async () => ({ confirmToken: 'tok-1' }) };
    });
    await act(async () => {
      root.render(<SocialScheduler onUpgrade={() => {}} />);
    });
    const text = container.querySelector<HTMLTextAreaElement>('textarea');
    const time = container.querySelector<HTMLInputElement>('input[aria-label="Schedule time"]');
    await act(async () => {
      const area = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      const input = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      area?.call(text, 'Sunday at 10.');
      text?.dispatchEvent(new Event('input', { bubbles: true }));
      input?.call(time, '2027-03-22T10:00');
      time?.dispatchEvent(new Event('input', { bubbles: true }));
      time?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await attachImage();
    const schedule = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Schedule');
    await act(async () => { schedule?.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const preview = authFetch.mock.calls.find((call) => String(call[0]).includes('/api/social/posts'));
    const init = preview?.[1] as { body?: string } | undefined;
    const body = JSON.parse(String(init?.body || '{}')) as { targets?: { fields?: { contentType?: string } }[] };
    expect(body.targets?.[0]?.fields?.contentType).toBe('feed');
  });

  it('mints a new Idempotency-Key when the draft changes after a failed confirm', async () => {
    const workspace = new MockSocialClient('live', clock).load();
    authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('bootstrap')) {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            entitled: true,
            sample: false,
            timezone: workspace.timezone,
            accounts: workspace.accounts,
            posts: workspace.posts,
          }),
        };
      }
      const body = JSON.parse(String(init?.body || '{}')) as { confirmToken?: string };
      if (!body.confirmToken) {
        return { status: 200, ok: true, json: async () => ({ confirmToken: 'tok-1' }) };
      }
      return { status: 503, ok: false, json: async () => ({ error: 'social_unavailable' }) };
    });
    await act(async () => {
      root.render(<SocialScheduler onUpgrade={() => {}} />);
    });
    const fill = async (copy: string) => {
      const text = container.querySelector<HTMLTextAreaElement>('textarea');
      const time = container.querySelector<HTMLInputElement>('input[aria-label="Schedule time"]');
      await act(async () => {
        const area = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        const input = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        area?.call(text, copy);
        text?.dispatchEvent(new Event('input', { bubbles: true }));
        input?.call(time, '2027-03-22T10:00');
        time?.dispatchEvent(new Event('input', { bubbles: true }));
        time?.dispatchEvent(new Event('change', { bubbles: true }));
      });
    };
    await attachImage();
    const schedule = () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Schedule');
    await fill('Sunday at 10.');
    await act(async () => { schedule()?.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const confirm = () => [...document.body.querySelectorAll('button')].find((button) => button.textContent === 'Confirm');
    await act(async () => { confirm()?.click(); });
    await act(async () => { await Promise.resolve(); });
    const dialog = document.body.querySelector('[data-testid="social-confirm-dialog"]');
    const dismiss = [...(dialog?.querySelectorAll('button') ?? [])].find((button) => button.textContent === 'Cancel');
    await act(async () => { dismiss?.click(); });
    await fill('Monday at 10.');
    await act(async () => { schedule()?.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const keys = authFetch.mock.calls
      .filter((call) => String(call[0]).includes('/api/social/posts'))
      .map((call) => {
        const init = call[1] as { headers?: Record<string, string> } | undefined;
        return init?.headers?.['Idempotency-Key'];
      })
      .filter((key): key is string => typeof key === 'string' && key.length > 0);
    expect(keys.length).toBeGreaterThanOrEqual(3);
    expect(new Set(keys).size).toBe(2);
  });

  it('schedules a UTC workspace in the browser zone and keeps a named zone', async () => {
    const native = Intl.DateTimeFormat.prototype.resolvedOptions;
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function resolve(this: Intl.DateTimeFormat) {
      return { ...native.call(this), timeZone: 'America/Denver' };
    });
    try {
      authFetch.mockImplementation(async (url: string) => {
        if (String(url).includes('bootstrap')) {
          return {
            status: 200,
            ok: true,
            json: async () => ({
              entitled: true,
              sample: false,
              timezone: 'UTC',
              accounts: [{ id: 'ig-1', platform: 'instagram', username: 'grace', displayName: 'Grace' }],
              posts: [],
            }),
          };
        }
        return { status: 200, ok: true, json: async () => ({ confirmToken: 'tok-1' }) };
      });
      await act(async () => {
        root.render(<SocialScheduler onUpgrade={() => {}} />);
      });
      const bootstrap = authFetch.mock.calls.find((call) => String(call[0]).includes('bootstrap'));
      const bootstrapInit = bootstrap?.[1] as { headers?: Record<string, string> } | undefined;
      expect(bootstrapInit?.headers?.['x-social-timezone']).toBe('America/Denver');
      expect(container.textContent).toContain('Timezone America/Denver');
      const text = container.querySelector<HTMLTextAreaElement>('textarea');
      const time = container.querySelector<HTMLInputElement>('input[aria-label="Schedule time"]');
      await act(async () => {
        const area = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        const input = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        area?.call(text, 'Sunday at 10.');
        text?.dispatchEvent(new Event('input', { bubbles: true }));
        input?.call(time, '2027-03-22T10:00');
        time?.dispatchEvent(new Event('input', { bubbles: true }));
        time?.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await attachImage();
    const schedule = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Schedule');
      await act(async () => { schedule?.click(); });
      await act(async () => { await Promise.resolve(); });
      const preview = authFetch.mock.calls.find((call) => String(call[0]).includes('/api/social/posts'));
      const init = preview?.[1] as { body?: string } | undefined;
      const body = JSON.parse(String(init?.body || '{}')) as { timezone?: string };
      expect(body.timezone).toBe('America/Denver');
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps a named workspace zone ahead of the browser zone', async () => {
    const native = Intl.DateTimeFormat.prototype.resolvedOptions;
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function resolve(this: Intl.DateTimeFormat) {
      return { ...native.call(this), timeZone: 'America/Denver' };
    });
    try {
      const workspace = new MockSocialClient('preview', clock).load();
      await act(async () => {
        root.render(
          <SocialScheduler initial={{ ...workspace, entitled: true }} initialView="compose" onUpgrade={() => {}} />,
        );
      });
      expect(workspace.timezone).toBe('America/Chicago');
      expect(container.textContent).toContain('Timezone America/Chicago');
    } finally {
      spy.mockRestore();
    }
  });

  it('renders the timezone label as UTC on the server when the browser zone differs', () => {
    const native = Intl.DateTimeFormat.prototype.resolvedOptions;
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function resolve(this: Intl.DateTimeFormat) {
      return { ...native.call(this), timeZone: 'America/Denver' };
    });
    try {
      const unnamed = { ...new MockSocialClient('preview', clock).load(), timezone: 'UTC', entitled: true };
      const html = renderToString(<SocialScheduler initial={unnamed} initialView="compose" onUpgrade={() => {}} />);
      expect(html.replace(/<!-- -->/g, '')).toContain('Timezone UTC');
      expect(html).not.toContain('America/Denver');
    } finally {
      spy.mockRestore();
    }
  });

  it('does not alert or show a raw credential error', async () => {
    const alertSpy = vi.fn();
    window.alert = alertSpy;
    authFetch.mockResolvedValue({
      status: 500,
      ok: false,
      json: async () => ({
        error: 'Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started for more information.',
      }),
    });
    await act(async () => {
      root.render(<SocialScheduler onUpgrade={() => {}} />);
    });
    expect(alertSpy).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('default credentials');
    expect(container.querySelector('[data-testid="social-error"]')).toBeTruthy();
  });
});
