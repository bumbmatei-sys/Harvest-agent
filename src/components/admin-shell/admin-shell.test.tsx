import { useState } from 'react';
import { act, type CSSProperties } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { Church, FileText, GraduationCap, Home } from 'lucide-react';

const analyticsGrant = vi.hoisted(() => ({ value: false }));

vi.mock('../dashboard/analytics-permission', () => ({
  hasAnalyticsAccess: () => Promise.resolve(analyticsGrant.value),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { THEME_STORAGE_KEY } from '@/lib/theme';

import { AdminDesktopSidebar, SIDEBAR_ICON_WIDTH } from './AdminDesktopSidebar';
import { AdminHome, AdminHomeView } from './AdminHome';
import { REASON } from '../dashboard/dashboard-data';
import { countDatedInWindow, formatKpi, HOME_KPI_SOURCES, sumCentsInWindow } from './home-kpis';
import { NO_TENANT, READ_FAILED } from './use-home-kpis';
import { groupsForAllSides, groupsForSide, sectionForTab, SHELL_SIDES, sideForTab, type ShellSideId, type ShellTabRef } from './shell-nav';
import { ensureLightDefault } from './use-shell-theme';

const tabs = new Map<string, ShellTabRef>([
  ['crm', { id: 'crm', label: 'CRM', icon: Church }],
  ['events', { id: 'events', label: 'Events', icon: FileText }],
  ['checkin', { id: 'checkin', label: 'Check-In', icon: FileText }],
  ['courses', { id: 'courses', label: 'Courses', icon: GraduationCap }],
  ['blog', { id: 'blog', label: 'Blog', icon: FileText }],
]);

describe('shell nav mapping', () => {
  it('puts people, care, events, check-in and giving on the people side', () => {
    const ids = groupsForSide('people', tabs).flatMap((group) => group.items.map((item) => item.id));
    expect(ids).toContain('crm');
    expect(ids).toContain('events');
    expect(ids).toContain('checkin');
    expect(ids).not.toContain('courses');
    expect(ids).not.toContain('newsletter');
    expect(ids).not.toContain('sms');
  });

  it('keeps live public tabs and hides ministry page and publish until those screens exist', () => {
    const publicIds = groupsForSide('public', tabs).flatMap((group) => group.items.map((item) => item.id));
    expect(publicIds).toContain('blog');
    expect(publicIds).toContain('courses');
    expect(publicIds).not.toContain('church-page');
    expect(publicIds).not.toContain('publish');
    expect(publicIds).not.toContain('newsletter');
  });

  it('does not switch sides when opening Home', () => {
    expect(sideForTab('dashboard')).toBeNull();
    expect(sideForTab('social')).toBeNull();
    expect(sideForTab('courses')).toBe('public');
    expect(sideForTab('crm')).toBe('people');
  });

  it('crumbs Home with no section and every other route with its group', () => {
    expect(sectionForTab('dashboard')).toBeNull();
    expect(sectionForTab('settings')).toBeNull();
    expect(sectionForTab('crm')).toBe('People');
    expect(sectionForTab('signups')).toBe('People');
    expect(sectionForTab('churches')).toBe('People');
    expect(sectionForTab('community')).toBe('Care');
    expect(sectionForTab('services')).toBe('Care');
    expect(sectionForTab('docs')).toBe('Care');
    expect(sectionForTab('forms')).toBe('Care');
    expect(sectionForTab('events')).toBe('Events');
    expect(sectionForTab('checkin')).toBe('Check-in');
    expect(sectionForTab('fundraising')).toBe('Giving');
    expect(sectionForTab('donations')).toBe('Giving');
    expect(sectionForTab('accounting')).toBe('Giving');
    expect(sectionForTab('blog')).toBe('Page');
    expect(sectionForTab('social')).toBe('Channels');
    expect(sectionForTab('newsletter')).toBe('Email');
    expect(sectionForTab('courses')).toBe('Products');
  });

  it('gives every sidebar item its own icon', () => {
    const ids = [
      'crm', 'signups', 'churches', 'community', 'services', 'docs', 'forms',
      'events', 'checkin', 'fundraising', 'donations', 'accounting', 'library',
      'tenants', 'inbox', 'affiliate', 'blog', 'branding', 'ai', 'social',
      'livestream', 'sms', 'newsletter', 'courses',
    ];
    const all = new Map<string, ShellTabRef>(ids.map((id) => [id, { id, label: id, icon: Church }]));
    const itemIcons = groupsForAllSides(all).flatMap((group) => group.items.map((item) => item.icon));
    // Side toggles and the pinned Home row are on screen with the items.
    // Group labels render no icon, so the group glyph is not part of this set.
    const visible = [...itemIcons, ...SHELL_SIDES.map((meta) => meta.icon), Home];
    expect(itemIcons).toHaveLength(ids.length);
    expect(new Set(visible).size).toBe(visible.length);
    expect(itemIcons.filter((icon) => icon === Church)).toHaveLength(1);
  });

  it('does not label the Social item and its group with the same word', () => {
    const withSocial = new Map(tabs);
    withSocial.set('social', { id: 'social', label: 'Social', icon: FileText });
    withSocial.set('livestream', { id: 'livestream', label: 'Livestream', icon: FileText });
    const group = groupsForSide('public', withSocial).find((entry) => entry.items.some((item) => item.id === 'social'));
    expect(group?.items.find((item) => item.id === 'social')?.label).toBe('Social');
    expect(group?.label).not.toBe('Social');
    expect(group?.label).toBe('Channels');
  });
});

describe('home figures', () => {
  const now = Date.UTC(2024, 0, 15, 12);

  it('counts only dated rows inside the window and refuses an undated row', () => {
    expect(countDatedInWindow([new Date(now - 86_400_000)], now, 14)).toEqual({ kind: 'exact', value: 1 });
    const refused = countDatedInWindow([new Date(now - 86_400_000), null], now, 14);
    expect(refused.kind).toBe('unavailable');
  });

  it('uses the same refusal wording as the dashboard read layer', () => {
    expect(READ_FAILED).toBe(REASON.readFailed);
    expect(NO_TENANT).toBe(REASON.noTenant);
  });

  it('sums recorded giving in cents and formats through formatCents', () => {
    const figure = sumCentsInWindow([{ amountCents: 105500, at: new Date(now - 86_400_000) }], now, 14);
    expect(figure).toEqual({ kind: 'exact', value: 105500 });
    expect(formatKpi(HOME_KPI_SOURCES.recordedGiving, figure)).toBe('$1,055.00');
  });
});

function Harness({ onPlaceholder }: { onPlaceholder?: (id: string) => void }) {
  const [side, setSide] = useState<ShellSideId>('people');
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AdminDesktopSidebar
          side={side}
          onSide={setSide}
          activeTab="dashboard"
          placeholder={null}
          tabs={tabs}
          tenantName="Grace Ministry"
          logoUrl="https://example.com/logo.png"
          onNavigate={() => {}}
          onPlaceholder={(id) => onPlaceholder?.(id)}
          accountMenu={<span>Account</span>}
        />
      </SidebarProvider>
    </TooltipProvider>
  );
}

describe('desktop sidebar', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    const modeClass = ['d', 'ark'].join('');
    document.documentElement.classList.remove(modeClass);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => { root?.unmount(); });
    container.remove();
  });

  async function mount() {
    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });
  }

  it('shows one Social link on the people side and opens the social section', async () => {
    const onNavigate = vi.fn();
    const withSocial = new Map(tabs);
    withSocial.set('social', { id: 'social', label: 'Social', icon: FileText });
    await act(async () => {
      root = createRoot(container);
      root.render(
        <TooltipProvider>
          <SidebarProvider>
            <AdminDesktopSidebar
              side="people"
              onSide={() => {}}
              activeTab="social"
              placeholder={null}
              tabs={withSocial}
              tenantName="Grace Ministry"
              logoUrl="https://example.com/logo.png"
              onNavigate={onNavigate}
              onPlaceholder={() => {}}
              accountMenu={<span>Account</span>}
            />
          </SidebarProvider>
        </TooltipProvider>,
      );
    });
    const links = container.querySelectorAll('[data-nav-tab="social"]');
    expect(links).toHaveLength(1);
    expect(links[0]?.textContent).toContain('Social');
    await act(async () => { (links[0] as HTMLButtonElement).click(); });
    expect(onNavigate).toHaveBeenCalledWith('social');
  });

  it('switches between the two icon-only sides', async () => {
    await mount();
    expect(container.querySelector('[data-shell-side]')?.getAttribute('data-shell-side')).toBe('people');
    const people = container.querySelector<HTMLButtonElement>('button[aria-label="People"]')!;
    expect(people.textContent ?? '').not.toMatch(/People/);
    const publicSide = container.querySelector<HTMLButtonElement>('button[aria-label="Public"]')!;
    await act(async () => { publicSide.click(); });
    expect(container.querySelector('[data-shell-side]')?.getAttribute('data-shell-side')).toBe('public');
    expect(container.textContent).toContain('Courses');
  });

  it('persists a light default and then a dark choice on the existing key', async () => {
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    await mount();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="Switch to dark"]')!;
    await act(async () => { toggle.click(); });
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('does not offer ministry page, publish, or the unavailable quick actions', async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <TooltipProvider>
          <SidebarProvider defaultOpen={false} style={{ '--sidebar-width-icon': SIDEBAR_ICON_WIDTH } as CSSProperties}>
            <AdminDesktopSidebar
              side="public"
              onSide={() => {}}
              activeTab="livestream"
              placeholder={null}
              tabs={tabs}
              tenantName="Grace Ministry"
              logoUrl="https://example.com/logo.png"
              onNavigate={() => {}}
              onPlaceholder={() => {}}
              accountMenu={<button type="button" data-nav-rail-account="" aria-label="My account">Account</button>}
            />
          </SidebarProvider>
        </TooltipProvider>,
      );
    });
    expect(container.textContent).not.toContain('Ministry page');
    expect(container.textContent).not.toContain('Publish');
    const trigger = container.querySelector('[data-sidebar="trigger"]');
    const account = container.querySelector('[data-nav-rail-account]');
    expect(trigger).toBeTruthy();
    expect(trigger!.parentElement?.contains(account)).toBe(false);
    const homeLabel = container.querySelector('[data-nav-tab="dashboard"] span');
    expect(homeLabel?.className ?? '').toContain('sr-only');
  });

  it('leaves an explicit system choice in place until the toggle is used', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    ensureLightDefault();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });
});

describe('home copy', () => {
  it('does not print collection paths or unavailable-feature cards', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const local = createRoot(host);
    act(() => {
      local.render(
        <AdminHomeView
          tenantName="Grace Ministry"
          period={14}
          onPeriod={() => {}}
          loading={false}
          cards={[{
            id: 'newMembers',
            label: 'New members',
            collection: 'users',
            field: 'createdAt',
            figure: { kind: 'exact', value: 2 },
          }]}
          givingByDay={{ kind: 'unavailable', reason: 'This read did not complete, so no figure can be shown.' }}
          openTabIds={['courses', 'events']}
          onOpen={() => {}}
        />,
      );
    });
    expect(host.textContent).toContain('New members');
    expect(host.textContent).not.toContain('createdAt');
    expect(host.textContent).not.toContain('users ·');
    expect(host.textContent).not.toContain('Email sending from here is not available');
    expect(host.textContent).not.toContain('Scheduling is not in this version');
    expect(host.textContent).toContain('New program');
    expect(host.textContent).toContain('Your events');
    act(() => { local.unmount(); });
    host.remove();
  });

  it('hides a quick action when that screen is not in the route list', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const local = createRoot(host);
    const open = vi.fn();
    act(() => {
      local.render(
        <AdminHomeView
          tenantName="Grace Ministry"
          period={14}
          onPeriod={() => {}}
          loading={false}
          cards={[]}
          givingByDay={{ kind: 'unavailable', reason: 'This read did not complete, so no figure can be shown.' }}
          openTabIds={['courses', 'dashboard']}
          onOpen={open}
        />,
      );
    });
    expect(host.textContent).toContain('New program');
    expect(host.textContent).not.toContain('Your events');
    const courses = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('New program'));
    act(() => { courses?.click(); });
    expect(open).toHaveBeenCalledWith({ kind: 'tab', id: 'courses' });
    act(() => { local.unmount(); });
    host.remove();

    const denied = document.createElement('div');
    document.body.appendChild(denied);
    const deniedRoot = createRoot(denied);
    act(() => {
      deniedRoot.render(
        <AdminHomeView
          tenantName="Grace Ministry"
          period={14}
          onPeriod={() => {}}
          loading={false}
          cards={[]}
          givingByDay={{ kind: 'unavailable', reason: 'This read did not complete, so no figure can be shown.' }}
          openTabIds={['dashboard', 'services']}
          onOpen={() => {}}
        />,
      );
    });
    expect(denied.textContent).not.toContain('New program');
    expect(denied.textContent).not.toContain('Your events');
    expect(denied.textContent).toContain('Add your service times');
    act(() => { deniedRoot.unmount(); });
    denied.remove();
  });
});

describe('home analytics gate', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    analyticsGrant.value = false;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => { root?.unmount(); });
    container.remove();
  });

  async function mount() {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <AdminHome
          tenantId="grace"
          tenantName="Grace Ministry"
          isSuperAdmin={false}
          unreadCount={0}
          onOpen={() => {}}
        />,
      );
    });
  }

  it('withholds recorded figures and the analytics tabs when access is denied', async () => {
    await mount();
    expect(container.querySelector('[data-analytics-denied]')).toBeTruthy();
    expect(container.querySelector('[data-home-kpi]')).toBeNull();
    expect(container.textContent).not.toContain('Overview');
    expect(container.textContent).not.toContain('Engagement');
  });

  it('shows the analytics tabs once access is granted', async () => {
    analyticsGrant.value = true;
    await mount();
    expect(container.querySelector('[data-analytics-denied]')).toBeNull();
    expect(container.textContent).toContain('Overview');
    expect(container.textContent).toContain('Growth');
    expect(container.textContent).toContain('Giving');
    expect(container.textContent).toContain('Engagement');
    expect(container.textContent).toContain('Content');
  });
});
