'use client';

import { useCallback, useLayoutEffect, useMemo, type CSSProperties } from 'react';
import { Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AdminContentBar } from '@/components/admin-shell/AdminContentBar';
import { AdminDesktopSidebar, SIDEBAR_ICON_WIDTH, SIDEBAR_WIDTH } from '@/components/admin-shell/AdminDesktopSidebar';
import { useLgUp } from '@/components/admin-shell/use-lg';
import { SocialScheduler, type SocialView } from '@/components/admin/social/SocialScheduler';
import { SocialUpgradeWall } from '@/components/admin/social/SocialUpgradeWall';
import { analyticsWindow, type AnalyticsRange } from '@/lib/social/analytics';
import { readCommentThreads, readComments, readConversations, readMessages, readReviews } from '@/lib/social/inbox';
import type { InboxApi } from '@/components/admin/social/SocialInboxView';
import type { AutoDmApi } from '@/components/admin/social/SocialAutoDmView';
import { checkAutoDm, isAutoDmPlatform, readAutoDmLogs, readAutoDmRule, readAutoDmRules, toZernioAutomation } from '@/lib/social/auto-dm';
import type { AutoDmAccount } from '@/lib/social/session';
import { applyTheme } from '@/lib/theme-runtime';
import type { ThemeChoice } from '@/lib/theme';
import { MockSocialClient } from '@/lib/social/mock-client';
import { sectionForTab, type ShellTabRef } from '@/components/admin-shell/shell-nav';

const CLOCK = new Date(Date.UTC(2024, 2, 15, 12));
const LOGO = 'https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png';

const VIEWS = ['accounts', 'compose', 'calendar', 'queue', 'analytics', 'inbox', 'autodm'] as const;

export function SocialSchedulerPreview({ view, theme }: { view?: string; theme?: string }) {
  const lg = useLgUp();

  useLayoutEffect(() => {
    const choice: ThemeChoice = theme === 'dark' ? 'dark' : 'light';
    try { localStorage.setItem('harvest-theme', choice); } catch { /* ignore */ }
    applyTheme(choice);
  }, [theme]);

  const workspace = useMemo(() => new MockSocialClient('preview', CLOCK).load(), []);
  // #582: the Analytics tab reads the mock's sample metrics, never a real ministry's.
  const sampleAnalytics = useCallback(async (range: AnalyticsRange) => {
    const { fromDate, toDate } = analyticsWindow(range, CLOCK);
    return new MockSocialClient('preview', CLOCK).analytics(fromDate, toDate);
  }, []);
  // #584: the sample inbox, parsed by the same readers the server uses; nothing is sent.
  const sampleInbox = useMemo<InboxApi>(() => {
    const mock = new MockSocialClient('preview', CLOCK);
    return {
      list: async (kind) => {
        const body = mock.inboxList(kind);
        if (kind === 'message') return { kind, items: readConversations(body) };
        if (kind === 'comment') return { kind, items: readCommentThreads(body) };
        return { kind, items: readReviews(body) };
      },
      thread: async (kind, id) => (kind === 'message'
        ? { kind, messages: readMessages(mock.inboxThread(kind, id)) }
        : { kind, comments: readComments(mock.inboxThread(kind, id)) }),
      reply: async ({ kind, id, message, commentId }) => { mock.inboxReply(kind, id, message, commentId); },
    };
  }, []);
  // Auto-DM: the sample automations, through the same checks and readers the server uses; nothing is armed.
  const sampleAutoDm = useMemo<AutoDmApi>(() => {
    const mock = new MockSocialClient('preview', CLOCK);
    const accounts = workspace.accounts.filter((account): account is typeof account & AutoDmAccount => isAutoDmPlatform(account.platform));
    const posts = workspace.posts.flatMap((post) => post.targets
      .filter((target) => accounts.some((account) => account.id === target.accountId))
      .map((target) => ({ id: post.id, accountId: target.accountId, title: target.text || post.content, status: post.status, scheduledFor: post.scheduledFor })));
    return {
      list: async () => ({ rules: readAutoDmRules(mock.autoDmList()), accounts, posts }),
      save: async (id, input) => {
        const platform = accounts.find((account) => account.id === input.accountId)?.platform ?? 'instagram';
        const checked = checkAutoDm(input, platform);
        if (!checked.ok) throw new Error(checked.message);
        const body = toZernioAutomation(checked.value, platform, id ? 'update' : { profileId: 'preview' });
        const saved = (id ? mock.autoDmUpdate(id, body) : mock.autoDmCreate(body)) as { automation?: unknown } | null;
        const rule = readAutoDmRule(saved?.automation);
        if (!rule) throw new Error('Could not save the automation.');
        return rule;
      },
      remove: async (id) => { mock.autoDmDelete(id); },
      logs: async (id) => readAutoDmLogs(mock.autoDmLogs(id)),
    };
  }, [workspace]);
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
            accountMenu={<Button type="button" variant="ghost" className="size-8 min-h-11 text-sidebar-foreground sm:min-h-0" aria-label="My account">Account</Button>}
          />
        )}
        <SidebarInset data-admin-content className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card">
          <div className="hidden lg:block">
            <AdminContentBar crumbs={[{ label: sectionForTab('social') ?? '' }, { label: viewTitle }]} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {wall ? (
            <SocialUpgradeWall onUpgrade={() => {}} />
          ) : (
            <SocialScheduler
              initial={{ ...workspace, entitled: true }}
              initialView={initialView}
              onUpgrade={() => {}}
              analyticsLoader={sampleAnalytics}
              inboxApi={sampleInbox}
              autoDmApi={sampleAutoDm}
            />
          )}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
