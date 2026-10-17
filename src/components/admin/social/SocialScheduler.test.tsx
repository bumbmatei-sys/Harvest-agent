import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockSocialClient, resetSocialMock } from '@/lib/social/mock-client';
import { SocialScheduler } from './SocialScheduler';

const authFetch = vi.hoisted(() => vi.fn());

vi.mock('@/utils/auth-fetch', () => ({ authFetch }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const clock = new Date(Date.UTC(2024, 2, 15, 12));

describe('SocialScheduler', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetSocialMock();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  });

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
    expect(container.textContent).toContain('not included with any plan');
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

    await act(async () => {
      const accounts = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Accounts');
      accounts?.click();
    });
    expect(container.querySelector('[data-testid="social-accounts"]')).toBeTruthy();
    expect(container.textContent).toContain('Sample Ministry');
    expect(container.textContent).not.toContain('grace');

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
    expect(container.querySelector('[data-testid="social-day-posts"]')?.textContent).not.toContain('This Sunday');
    expect(container.querySelector('[data-testid="social-calendar-drafts"]')?.textContent).toContain('This Sunday');
    expect(container.querySelector('[data-testid="social-day-posts"]')?.textContent).not.toContain('Verse of the day');
  });

  it('centers the composer and docks the drafts panel on desktop classes only', async () => {
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
    const panel = container.querySelector('[data-testid="social-side-panel"]');
    expect(panel?.className).toContain('hidden');
    expect(panel?.className).toContain('lg:flex');
    expect(panel?.textContent).toContain('Drafts');
    expect(panel?.textContent).toContain('Scheduled');
    expect(panel?.textContent).toContain('Sent');
  });

  it('shows YouTube as not selectable until video upload exists', async () => {
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
    const youtube = container.querySelector('[data-testid="youtube-posting-disabled"]');
    expect(youtube?.hasAttribute('disabled')).toBe(true);
    expect(container.querySelector('[data-testid="youtube-coming-soon"]')?.textContent).toBe('Video upload coming soon');
    await act(async () => {
      youtube?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).not.toContain('LinkedIn');
    expect(container.textContent).not.toContain('Twitter');
    const schedule = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Schedule');
    expect(schedule?.hasAttribute('disabled')).toBe(false);
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
    expect(container.querySelector('[data-testid="connect-youtube"]')?.hasAttribute('disabled')).toBe(true);
    expect(container.querySelector('[data-testid="connect-youtube-note"]')?.textContent).toBe('Video upload coming soon');
  });

  it('names the selected calendar day and lists that day\'s post', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(clock);
    try {
      const workspace = new MockSocialClient('preview', clock).load();
      await act(async () => {
        root.render(
          <SocialScheduler initial={{ ...workspace, entitled: true }} initialView="calendar" onUpgrade={() => {}} />,
        );
      });
      const heading = container.querySelector('[data-testid="social-day-heading"]');
      expect(heading?.textContent).toBe('15 March 2024');
      expect(container.querySelector('[data-testid="social-day-posts"]')?.textContent).not.toContain('Verse of the day');
      const day = [...container.querySelectorAll('button')].find((button) => button.textContent === '12');
      await act(async () => { day?.click(); });
      expect(container.querySelector('[data-testid="social-day-heading"]')?.textContent).toBe('12 March 2024');
      expect(container.querySelector('[data-testid="social-day-posts"]')?.textContent).toContain('Verse of the day');
    } finally {
      vi.useRealTimers();
    }
  });

  it('saves an undated draft edit and keeps a scheduled time required', async () => {
    const workspace = new MockSocialClient('preview', clock).load();
    await act(async () => {
      root.render(
        <SocialScheduler initial={{ ...workspace, entitled: true }} initialView="queue" onUpgrade={() => {}} />,
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
    const schedule = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Schedule');
    await act(async () => { schedule?.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-testid="social-unavailable"]')).toBeNull();
    expect(container.querySelector('textarea')?.value).toBe('Sunday at 10.');
    expect(document.body.textContent).toContain('Nothing was scheduled');
    const postsCalls = authFetch.mock.calls.filter((call) => String(call[0]).includes('/api/social/posts'));
    expect(postsCalls).toHaveLength(1);
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
