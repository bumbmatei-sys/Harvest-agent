'use client';

import { useLayoutEffect, useMemo, type CSSProperties } from 'react';
import { Radio } from 'lucide-react';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AdminDesktopSidebar, SIDEBAR_ICON_WIDTH } from '@/components/admin-shell/AdminDesktopSidebar';
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
    ['crm', { id: 'crm', label: 'CRM', icon: Radio }],
    ['events', { id: 'events', label: 'Events', icon: Radio }],
    ['donations', { id: 'donations', label: 'Donations', icon: Radio }],
    ['social', { id: 'social', label: 'Social', icon: Radio }],
  ]), []);
  const wall = view === 'wall';
  const initialView: SocialView = (VIEWS as readonly string[]).includes(view || '')
    ? (view as SocialView)
    : 'compose';

  return (
    <TooltipProvider>
      <SidebarProvider
        defaultOpen
        className="min-h-screen bg-background"
        style={{ '--sidebar-width-icon': SIDEBAR_ICON_WIDTH } as CSSProperties}
      >
        {lg && (
          <AdminDesktopSidebar
            side="people"
            onSide={() => {}}
            activeTab="social"
            placeholder={null}
            tabs={tabs}
            tenantName="Sample Ministry"
            logoUrl={LOGO}
            onNavigate={() => {}}
            onPlaceholder={() => {}}
            accountMenu={<button type="button" className="min-h-11 px-3 text-sm">Account</button>}
          />
        )}
        <SidebarInset className="min-w-0 bg-background p-4">
          {wall ? (
            <SocialUpgradeWall onUpgrade={() => {}} />
          ) : (
            <SocialScheduler
              initial={{ ...workspace, entitled: true }}
              initialView={initialView}
              onUpgrade={() => {}}
            />
          )}
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
