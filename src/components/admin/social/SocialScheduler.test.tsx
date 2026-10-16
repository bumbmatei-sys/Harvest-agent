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

  it('tells the admin that a YouTube post needs a video and cannot be submitted', async () => {
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
    await act(async () => {
      const youtube = [...container.querySelectorAll('button')].find((button) => button.textContent === 'YouTube');
      youtube?.click();
    });
    expect(container.querySelector('[data-testid="youtube-needs-video"]')?.textContent).toContain('need a video');
    expect(container.textContent).toContain('Short');
    expect(container.textContent).not.toContain('LinkedIn');
    expect(container.textContent).not.toContain('Twitter');
    const schedule = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Schedule');
    expect(schedule?.hasAttribute('disabled')).toBe(true);
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
