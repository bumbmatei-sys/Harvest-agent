'use client';

import { useLayoutEffect, useMemo, type CSSProperties } from 'react';
import { Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AdminContentBar } from '@/components/admin-shell/AdminContentBar';
import { AdminDesktopSidebar, SIDEBAR_ICON_WIDTH, SIDEBAR_WIDTH } from '@/components/admin-shell/AdminDesktopSidebar';
import { useLgUp } from '@/components/admin-shell/use-lg';
import { SocialScheduler, type SocialView } from '@/components/admin/social/SocialScheduler';
import { SocialUpgradeWall } from '@/components/admin/social/SocialUpgradeWall';
import { applyTheme } from '@/lib/theme-runtime';
import type { ThemeChoice } from '@/lib/theme';
import { MockSocialClient } from '@/lib/social/mock-client';
import type { ShellTabRef } from '@/components/admin-shell/shell-nav';

const CLOCK = new Date(Date.UTC(2024, 2, 15, 12));
const LOGO = 'https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png';

const VIEWS = ['accounts', 'compose', 'calendar', 'queue'] as const;

export function SocialSchedulerPreview({ view, theme }: { view?: string; theme?: string }) {
  const lg = useLgUp();

  useLayoutEffect(() => {
    const choice: ThemeChoice = theme === 'dark' ? 'dark' : 'light';
    try { localStorage.setItem('harvest-theme', choice); } catch { /* ignore */ }
    applyTheme(choice);
  }, [theme]);

  const workspace = useMemo(() => new MockSocialClient('preview', CLOCK).load(), []);
  const tabs = useMemo(() => new Map<string, ShellTabRef>([
    ['blog', { id: 'blog', label: 'Blog', icon: Radio }],
    ['branding', { id: 'branding', label: 'Branding', icon: Radio }],
    ['social', { id: 'social', label: 'Social', icon: Radio }],
    ['livestream', { id: 'livestream', label: 'Livestream', icon: Radio }],
    ['courses', { id: 'courses', label: 'Courses', icon: Radio }],
  ]), []);
  const wall = view === 'wall';
  const initialView: SocialView = (VIEWS as readonly string[]).includes(view || '')
    ? (view as SocialView)
    : 'compose';
  const viewTitle = initialView === 'accounts' ? 'Accounts'
    : initialView === 'calendar' ? 'Calendar'
    : initialView === 'queue' ? 'Queue'
    : 'Compose';

  return (
    <TooltipProvider>
      <SidebarProvider
        defaultOpen
        className="h-[100dvh] min-h-0 overflow-hidden bg-surface"
        style={{ '--sidebar-width': SIDEBAR_WIDTH, '--sidebar-width-icon': SIDEBAR_ICON_WIDTH } as CSSProperties}
      >
        {lg && (
          <AdminDesktopSidebar
            side="public"
            onSide={() => {}}
            activeTab="social"
            placeholder={null}
            tabs={tabs}
            tenantName="Sample Ministry"
            logoUrl={LOGO}
            onNavigate={() => {}}
            onPlaceholder={() => {}}
            accountMenu={<Button type="button" variant="ghost" className="size-8 text-sidebar-foreground" aria-label="My account">Account</Button>}
          />
        )}
        <SidebarInset className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card">
          <div className="hidden lg:block">
            <AdminContentBar section="Public" title={viewTitle} onOpenApp={() => {}} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {wall ? (
            <SocialUpgradeWall onUpgrade={() => {}} />
          ) : (
            <SocialScheduler
              initial={{ ...workspace, entitled: true }}
              initialView={initialView}
              onUpgrade={() => {}}
            />
          )}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
