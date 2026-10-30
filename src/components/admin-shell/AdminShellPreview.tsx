'use client';

import { NAV_ICONS } from '@/components/layout/nav-icons';

// THE-555: named classes let the touch-floor guard resolve every state.
const ADMIN_MOBILE_NAV_TAB = 'flex flex-col items-center justify-center gap-1 w-16 h-12 rounded-xl transition-all relative data-[active=false]:text-faint';
import { Button } from '@/components/ui/button';

import { useEffect, useState, type CSSProperties } from 'react';
import {
  Church,
  ClipboardList,
  FileText,
  GraduationCap,
  LayoutDashboard,
  MoreHorizontal,
  User,
} from 'lucide-react';

import { applyTheme } from '@/lib/theme-runtime';
import { THEME_STORAGE_KEY } from '@/lib/theme';
import { NavRailFlyout, NavRailProvider } from '@/components/layout/nav-rail';
import { DESKTOP_GROUP_ICONS, DESKTOP_GROUP_LABELS } from '@/components/layout/nav-rail-groups';
import { SidebarInset, SidebarProvider, useSidebar } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';

import { AdminContentBar, CommunityMenu } from './AdminContentBar';
import { AdminDesktopSidebar, SIDEBAR_ICON_WIDTH, SIDEBAR_WIDTH } from './AdminDesktopSidebar';
import { SegmentedTabs, SegmentedTabsList, SegmentedTabsTrigger } from './SegmentedTabs';
import { AdminHomeView } from './AdminHome';
import { HOME_KPI_ORDER, HOME_KPI_SOURCES } from './home-kpis';
import { useLgUp } from './use-lg';
import { sectionForTab, type ShellSideId, type ShellTabRef } from './shell-nav';

const LOGO = 'https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png';

/** The mobile bar class string as it shipped before this phase, without `lg:hidden`. */
const BEFORE_SHELL =
  'bg-surface-raised border-t lg:border-t-0 lg:border-r border-line lg:border-line flex justify-center lg:justify-start py-2 lg:py-6 px-2 lg:px-2 pb-safe lg:pb-0 fixed lg:relative bottom-0 lg:bottom-auto w-full lg:w-[64px] lg:h-screen z-[100] shadow-[0_-4px_20px_rgba(0,0,0,0.05)] lg:shadow-[2px_0_10px_rgba(0,0,0,0.02)] transition-all duration-300';

/** The same bar after this phase: `lg:hidden` is the only addition. */
const AFTER_SHELL = `${BEFORE_SHELL} lg:hidden`;

const MOBILE_TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'churches', label: 'Campuses', icon: Church },
  { id: 'courses', label: 'Courses', icon: GraduationCap },
  { id: 'blog', label: 'Blog', icon: FileText },
];

const BEFORE_GROUPS: { label: string; items: { id: string; label: string; icon: typeof FileText }[] }[] = [
  { label: 'CONTENT', items: [{ id: 'blog', label: 'Blog', icon: FileText }, { id: 'courses', label: 'Courses', icon: GraduationCap }] },
  { label: 'MINISTRY', items: [{ id: 'churches', label: 'Campuses', icon: Church }, { id: 'crm', label: 'CRM', icon: Church }] },
  { label: 'REACH', items: [{ id: 'events', label: 'Events', icon: FileText }, { id: 'checkin', label: 'Check-In', icon: FileText }] },
  { label: 'GROW', items: [{ id: 'branding', label: 'Branding', icon: FileText }] },
];

const PREVIEW_TABS = new Map<string, ShellTabRef>([
  ['crm', { id: 'crm', label: 'CRM', icon: Church }],
  ['signups', { id: 'signups', label: 'Signups', icon: Church }],
  ['churches', { id: 'churches', label: 'Campuses', icon: Church }],
  ['community', { id: 'community', label: 'Community', icon: NAV_ICONS.communities }],
  ['community-setup', { id: 'community-setup', label: 'Community setup', icon: NAV_ICONS.communities }],
  ['newsletter', { id: 'newsletter', label: 'Newsletter', icon: NAV_ICONS.newsletter }],
  ['services', { id: 'services', label: 'Services', icon: Church }],
  ['docs', { id: 'docs', label: 'Notes', icon: FileText }],
  ['forms', { id: 'forms', label: 'Forms', icon: FileText }],
  ['signup-pages', { id: 'signup-pages', label: 'Sign-up pages', icon: ClipboardList }],
  ['events', { id: 'events', label: 'Events', icon: FileText }],
  ['checkin', { id: 'checkin', label: 'Check-In', icon: FileText }],
  ['fundraising', { id: 'fundraising', label: 'Fundraising', icon: Church }],
  ['donations', { id: 'donations', label: 'Donations', icon: Church }],
  ['accounting', { id: 'accounting', label: 'Giving records', icon: Church }],
  ['blog', { id: 'blog', label: 'Blog', icon: FileText }],
  ['branding', { id: 'branding', label: 'Branding', icon: FileText }],
  ['ai', { id: 'ai', label: 'AI Knowledge', icon: FileText }],
  ['livestream', { id: 'livestream', label: 'Livestream', icon: FileText }],
  ['courses', { id: 'courses', label: 'Courses', icon: GraduationCap }],
]);

function MobileBar({ className }: { className: string }) {
  return (
    <div data-nav-shell className={className}>
      <div className="flex lg:flex-col justify-around lg:justify-start items-center lg:items-center w-full lg:max-w-none lg:gap-2">
        <div className="flex lg:hidden justify-around items-center w-full">
          {MOBILE_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = tab.id === 'dashboard';
            return (
              <Button variant="ghost"
                key={tab.id}
                type="button"
                data-active={active} className={ADMIN_MOBILE_NAV_TAB}
                style={active ? { color: 'var(--brand-color, #C9963A)' } : undefined}
              >
                <Icon size={22} strokeWidth={active ? 2.5 : 2} />
                <span className="text-[10px] font-medium">{tab.label}</span>
              </Button>
            );
          })}
          <Button variant="ghost" type="button" className="flex flex-col items-center justify-center gap-1 w-16 h-12 rounded-xl text-faint">
            <MoreHorizontal size={22} />
            <span className="text-[10px] font-medium">More</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

function BeforeChrome() {
  return (
    <NavRailProvider>
      <div className="flex h-[100dvh] bg-surface font-sans" data-preview-view="before">
        <div data-nav-shell className={BEFORE_SHELL}>
          <div className="flex lg:flex-col justify-around lg:justify-start items-center w-full lg:gap-2">
            <div className="hidden lg:contents">
            <Button variant="ghost" type="button" className="min-h-11 flex items-center mb-6 shrink-0 justify-center w-full">
              <img src={LOGO} alt="Harvest" className="w-9 h-9 object-contain" />
            </Button>
            </div>
            <div className="flex lg:hidden justify-around items-center w-full">
              {MOBILE_TABS.map((tab) => {
                const Icon = tab.icon;
                const active = tab.id === 'dashboard';
                return (
                  <Button variant="ghost"
                    key={tab.id}
                    type="button"
                    data-active={active} className={ADMIN_MOBILE_NAV_TAB}
                    style={active ? { color: 'var(--brand-color, #C9963A)' } : undefined}
                  >
                    <Icon size={22} />
                    <span className="text-[10px] font-medium">{tab.label}</span>
                  </Button>
                );
              })}
              <Button variant="ghost" type="button" className="flex flex-col items-center justify-center gap-1 w-16 h-12 rounded-xl text-faint">
                <MoreHorizontal size={22} />
                <span className="text-[10px] font-medium">More</span>
              </Button>
            </div>
            <div className="hidden lg:flex lg:flex-col lg:items-center lg:w-full lg:flex-1 lg:min-h-0 lg:gap-0.5">
              <Button variant="ghost" type="button" data-nav-rail-tab="dashboard" className="flex flex-col items-center justify-center gap-1 rounded-xl min-h-11 w-full py-2 text-muted">
                <LayoutDashboard size={20} />
                <span className="text-[10px] font-medium leading-none">Home</span>
              </Button>
              {BEFORE_GROUPS.map((group) => {
                const Icon = DESKTOP_GROUP_ICONS[group.label];
                return (
                  <div key={group.label} className="w-full" data-nav-group={group.label}>
                    <NavRailFlyout
                      label={group.label}
                      title={DESKTOP_GROUP_LABELS[group.label] ?? group.label}
                      trigger={
                        <>
                          {Icon && <Icon size={20} />}
                          <span className="text-[10px] font-medium leading-none">{DESKTOP_GROUP_LABELS[group.label]}</span>
                        </>
                      }
                      triggerClassName="flex flex-col items-center justify-center gap-1 rounded-xl min-h-11 w-full py-2 text-muted"
                    >
                      {group.items.map((item) => (
                        <Button variant="ghost" key={item.id} type="button" className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-[13px]">
                          {item.label}
                        </Button>
                      ))}
                    </NavRailFlyout>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <main className="flex min-w-0 flex-1 items-center justify-center p-8 text-muted">
          <p className="font-display text-3xl font-light text-strong">Grace Ministry</p>
        </main>
      </div>
    </NavRailProvider>
  );
}

function ForceMobileSheet() {
  const { isMobile, setOpenMobile } = useSidebar();
  useEffect(() => {
    if (isMobile) setOpenMobile(true);
  }, [isMobile, setOpenMobile]);
  return null;
}

const EVENT_ROWS = [
  ['Sunday gathering', 'Sun 9:30', 'Main hall'],
  ['Youth night', 'Fri 19:00', 'Annex'],
  ['Members meeting', 'Tue 18:30', 'Chapel'],
];

function EventsPreview() {
  return (
    <div className="flex flex-col gap-4 px-4 pb-8">
      <SegmentedTabs defaultValue="list">
        <SegmentedTabsList>
          <SegmentedTabsTrigger value="list">List</SegmentedTabsTrigger>
          <SegmentedTabsTrigger value="month">Month</SegmentedTabsTrigger>
        </SegmentedTabsList>
      </SegmentedTabs>
      <div className="overflow-hidden rounded-xl border border-border">
        {EVENT_ROWS.map(([title, when, where]) => (
          <div key={title} className="flex items-center gap-4 border-b border-border bg-surface-tint px-4 py-3 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] text-foreground">{title}</p>
              <p className="text-[12px] text-muted-foreground">{where}</p>
            </div>
            <span className="text-[13px] text-muted-foreground">{when}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AfterChrome({ side, collapsed, screen, sheet }: { side: ShellSideId; collapsed: boolean; screen: 'home' | 'events'; sheet: boolean }) {
  const lgUp = useLgUp();
  const [current, setCurrent] = useState<ShellSideId>(side);
  useEffect(() => { setCurrent(side); }, [side]);
  const cards = HOME_KPI_ORDER.map((id) => {
    const source = HOME_KPI_SOURCES[id];
    const value = id === 'recordedGiving' ? 105500 : id === 'newMembers' ? 12 : id === 'newContacts' ? 4 : 3;
    return {
      id,
      label: source.label,
      collection: source.collection,
      field: source.field,
      figure: { kind: 'exact' as const, value },
    };
  });
  return (
    <TooltipProvider>
      <SidebarProvider
        key={collapsed ? 'collapsed' : 'open'}
        defaultOpen={!collapsed}
        className="h-[100dvh] min-h-0 bg-surface"
        style={{ '--sidebar-width': SIDEBAR_WIDTH, '--sidebar-width-icon': SIDEBAR_ICON_WIDTH } as CSSProperties}
      >
        <div data-preview-view="after" className="contents">
          {(lgUp || sheet) && (
            <AdminDesktopSidebar
              side={current}
              onSide={setCurrent}
              activeTab={screen === 'events' ? 'events' : 'dashboard'}
              placeholder={null}
              tabs={PREVIEW_TABS}
              tenantName="Grace Ministry"
              logoUrl={LOGO}
              onNavigate={() => {}}
              onPlaceholder={() => {}}
              accountMenu={(
                <Button variant="ghost"
                  type="button"
                  data-nav-rail-account=""
                  aria-label="My account"
                  title="My account"
                  className="flex size-11 items-center justify-center rounded-full border border-sidebar-border bg-sidebar text-sidebar-foreground"
                >
                  <User />
                </Button>
              )}
            />
          )}
          {sheet && <ForceMobileSheet />}
          <MobileBar className={AFTER_SHELL} />
          <SidebarInset className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card">
            <div className="hidden lg:block">
              <AdminContentBar
                crumbs={[{ label: sectionForTab(screen === 'events' ? 'events' : 'dashboard') ?? '' }, { label: screen === 'events' ? 'Events' : 'Home' }]}
                community={<CommunityMenu onOpenDefault={() => {}} />}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pb-24">
            {screen === 'events' ? <EventsPreview /> : (
            <div className="p-6">
            <AdminHomeView
              tenantName="Grace Ministry"
              period={14}
              onPeriod={() => {}}
              loading={false}
              cards={cards}
              givingByDay={{
                kind: 'complete',
                points: [
                  { label: 'Oct 2', value: 2500 },
                  { label: 'Oct 3', value: 0 },
                  { label: 'Oct 4', value: 80000 },
                  { label: 'Oct 5', value: 23000 },
                ],
              }}
              sampleLabel="Sample figures for a layout preview, not a live ministry."
              openTabIds={['courses', 'events']}
              onOpen={() => {}}
            />
            </div>
            )}
            </div>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  );
}

type PreviewBoot = {
  view: 'before' | 'after';
  theme: 'light' | 'dark';
  side: ShellSideId;
  collapsed: boolean;
  screen: 'home' | 'events';
  sheet: boolean;
};

function readBoot(): PreviewBoot {
  const params = new URLSearchParams(window.location.search);
  return {
    view: params.get('view') === 'before' ? 'before' : 'after',
    theme: params.get('theme') === 'dark' ? 'dark' : 'light',
    side: params.get('side') === 'public' ? 'public' : 'people',
    collapsed: params.get('collapsed') === '1',
    screen: params.get('screen') === 'events' ? 'events' : 'home',
    sheet: params.get('sheet') === '1',
  };
}

export function AdminShellPreview() {
  // Null until the query is read, so the sidebar mounts once with the right open state.
  const [boot, setBoot] = useState<PreviewBoot | null>(null);

  useEffect(() => {
    setBoot(readBoot());
  }, []);

  useEffect(() => {
    if (!boot) return;
    try { localStorage.setItem(THEME_STORAGE_KEY, boot.theme); } catch { /* ignore */ }
    applyTheme(boot.theme);
  }, [boot]);

  if (!boot) return null;
  if (boot.view === 'before') return <BeforeChrome />;
  return <AfterChrome side={boot.side} collapsed={boot.collapsed} screen={boot.screen} sheet={boot.sheet} />;
}
