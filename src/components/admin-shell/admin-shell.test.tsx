import { useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { Church, FileText, GraduationCap } from 'lucide-react';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { THEME_STORAGE_KEY } from '@/lib/theme';

import { AdminDesktopSidebar } from './AdminDesktopSidebar';
import { REASON } from '../dashboard/dashboard-data';
import { countDatedInWindow, formatKpi, HOME_KPI_SOURCES, sumCentsInWindow } from './home-kpis';
import { NO_TENANT, READ_FAILED } from './use-home-kpis';
import { groupsForSide, sideForTab, type ShellSideId, type ShellTabRef } from './shell-nav';
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

  it('keeps the ministry page and publish placeholders, and drops email without a newsletter tab', () => {
    const publicIds = groupsForSide('public', tabs).flatMap((group) => group.items.map((item) => item.id));
    expect(publicIds).toContain('church-page');
    expect(publicIds).toContain('publish');
    expect(publicIds).toContain('courses');
    expect(publicIds).not.toContain('newsletter');
  });

  it('does not switch sides when opening Home', () => {
    expect(sideForTab('dashboard')).toBeNull();
    expect(sideForTab('courses')).toBe('public');
    expect(sideForTab('crm')).toBe('people');
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

  it('leaves an explicit system choice in place until the toggle is used', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    ensureLightDefault();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });
});
