"use client";
/**
 * The admin home screen — the dashboard's greeting, and the analytics tabs.
 *
 * ─── THE-276: what this file used to do, and why it does not any more ────────
 *
 * It ran three `limit(500)` reads with NO `orderBy` — `users`, `courses`, and
 * `tenants` for a super admin — and then reported:
 *
 *   • `memberCount` as `members.length`, i.e. the size of the sample, capped at
 *     500. A ministry with 800 members was told it had 500.
 *   • "Recent Members" as the newest five of those rows, after a CLIENT-side
 *     sort. Firestore serves an unordered `limit(N)` in `__name__` order and
 *     document ids are random, so those 500 were an arbitrary sample and the
 *     "newest five" were the newest five OF THE SAMPLE.
 *   • "Your ministry gained N new members this week" from the same sample, so N
 *     was however many of this week's joiners happened to fall inside it.
 *   • `courseCount` as the published courses within another arbitrary 500.
 *
 * #405's sweep found that shape in 41 files; this was one of them, and three of
 * its own reads. Every one of those numbers is now either an exact
 * `getCountFromServer()` aggregation or absent — see `dashboard/dashboard-data`
 * for the rule and `useOverviewData` for the reads. 🔴 Nothing here falls back
 * to a zero: an unreadable figure renders as an empty state that says what is
 * missing, because a `0` and a failed read looked identical before and that is
 * how a wrong number reaches a founder's screen.
 *
 * The greeting hero and the quick actions are kept as they were. The stat cards
 * and the Recent Members list are not: both were pure functions of the sampled
 * reads above, and the Overview tab now answers the same questions correctly.
 *
 * ─── The tab shell lives here, not in the admin shell ────────────────────────
 *
 * 🔴 `AdminDashboard.tsx` is NOT touched by this ticket (THE-277 owns it) and
 * needs no change: this component's five props are unchanged, so its call site
 * is byte-identical. The six-tab strip is navigation WITHIN the dashboard
 * section, not a new admin section — see `dashboard/DashboardTabs`.
 */
import React, { useEffect, useState } from 'react';
import { auth } from '../firebase';

import { DashboardTabs } from './dashboard/DashboardTabs';
import { GivingTab } from './dashboard/GivingTab';
import { GrowthTab } from './dashboard/GrowthTab';
import { OverviewTab } from './dashboard/OverviewTab';
import { hasAnalyticsAccess, type AnalyticsAccess } from './dashboard/analytics-permission';
import { useGivingData } from './dashboard/useGivingData';
import { useGrowthData } from './dashboard/useGrowthData';
import { useOverviewData, type OverviewData } from './dashboard/useOverviewData';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './ui/empty';
import { Skeleton } from './ui/skeleton';
import { Lock } from 'lucide-react';

interface AdminDashboardHomeProps {
  tenantId: string | null;
  tenantName?: string;
  isSuperAdmin: boolean;
  unreadCount: number;
  onNavigate: (tabId: string) => void;
}

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
};

const AdminDashboardHome: React.FC<AdminDashboardHomeProps> = ({
  tenantId, tenantName, isSuperAdmin, unreadCount, onNavigate,
}) => {
  /**
   * ⚠️ Three states, not a boolean. `pending` renders a skeleton; rendering the
   * denied state while the answer is still in flight would flash "you do not
   * have access" at every admin who does, on every load.
   */
  const [access, setAccess] = useState<AnalyticsAccess>('pending');

  useEffect(() => {
    let cancelled = false;
    hasAnalyticsAccess().then((granted) => {
      if (!cancelled) setAccess(granted ? 'granted' : 'denied');
    });
    return () => { cancelled = true; };
  }, []);

  const adminName = (auth.currentUser?.displayName || '').split(' ')[0] || 'there';
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const ministryLabel = (tenantName || 'Harvest').trim();

  // Platform context = super admin on the apex domain. The Platform Inbox only
  // exists there; tenant admins no longer have an inbox, so we don't surface it.
  const isPlatform = isSuperAdmin && !tenantId;

  const quickActions = [
    { label: 'New Course', tab: 'courses' },
    ...(isPlatform ? [{ label: 'View Inbox', tab: 'inbox' }] : []),
    { label: 'View Members', tab: 'crm' },
  ];

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6 p-4 lg:p-0">
      {/* Greeting hero — unchanged, except that it no longer reports a member
          count derived from an arbitrary 500-row sample. */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold mb-2">
          {ministryLabel} <span className="text-faint">·</span> {today}
        </p>
        <h1 className="font-display text-[2rem] lg:text-[2.4rem] leading-[1.1] font-light tracking-[-0.02em] text-strong">
          {greeting()}, {adminName}.
        </h1>
        <p className="text-[15px] text-muted mt-2">Here&apos;s your ministry at a glance.</p>
      </div>

      {access === 'pending' && <Skeleton className="h-64 w-full" data-analytics-pending />}

      {access === 'denied' && (
        <Empty className="py-10" data-analytics-denied>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Lock aria-hidden />
            </EmptyMedia>
            <EmptyTitle>Analytics is not part of your access</EmptyTitle>
            <EmptyDescription>
              Ask an admin who can manage roles to turn on the Analytics permission for your account.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {access === 'granted' && (
        <AnalyticsDashboard tenantId={tenantId} isSuperAdmin={isSuperAdmin} unreadCount={unreadCount} showInbox={isPlatform} />
      )}

      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold mb-3">Quick Actions</h3>
        <div className="flex flex-wrap gap-2.5">
          {quickActions.map((a) => (
            <button
              key={a.label}
              onClick={() => onNavigate(a.tab)}
              className="px-4 py-2 rounded-brand border border-line bg-surface-raised text-[13px] font-semibold text-strong hover:bg-surface-sunken hover:border-[color-mix(in_srgb,var(--brand-color)_40%,var(--stone-200))] transition-colors"
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

/**
 * The reads live behind the gate, in a child component, so that
 * `useOverviewData` is never mounted for an admin who may not see its output —
 * a denied admin issues no dashboard query at all.
 *
 * ─── THE-283 / THE-290: one shared hook, plus one hook per built tab ─────────
 *
 * ⚠️ `useOverviewData` is held HERE, above the tab strip, and its series are
 * handed to the tabs that plot them. `memberSeries` goes to BOTH Overview and
 * Growth; `givingSeries` goes to BOTH Overview and Giving. Each is one
 * complete, count-gated read, so no two tabs can show different numbers for the
 * same eight weeks and opening a tab costs no second query for a series that
 * has already been read.
 *
 * 🔴 THAT IS WHAT MAKES THE GIVING RELOCATION EXACT rather than merely
 * consistent. The Giving tab is not handed a copy of the giving figures, it is
 * handed the SAME `Series` object the Overview tab plots — there is no second
 * read, no second `readableReceipts` gate and no arithmetic in between, so
 * there is nothing that could drift.
 *
 * `useGrowthData` and `useGivingData` are their tabs' own, and each is mounted
 * inside its own panel component rather than here on purpose: Base UI mounts
 * only the ACTIVE tab panel, so the member-location read fires when someone
 * selects Growth and the campaign and pledge reads fire when someone selects
 * Giving — never on a visit that only looks at Overview.
 */
function AnalyticsDashboard({ tenantId, isSuperAdmin, unreadCount, showInbox }: {
  tenantId: string | null;
  isSuperAdmin: boolean;
  unreadCount: number;
  showInbox: boolean;
}) {
  const data = useOverviewData(tenantId, isSuperAdmin);
  return (
    <DashboardTabs
      overview={<OverviewTab data={data} unreadCount={unreadCount} showInbox={showInbox} />}
      growth={<GrowthPanel data={data} tenantId={tenantId} isSuperAdmin={isSuperAdmin} />}
      giving={<GivingPanel data={data} tenantId={tenantId} />}
    />
  );
}

/** The Growth tab's own read, deferred to the moment the tab is opened. */
function GrowthPanel({ data, tenantId, isSuperAdmin }: {
  data: OverviewData;
  tenantId: string | null;
  isSuperAdmin: boolean;
}) {
  const growth = useGrowthData(tenantId, isSuperAdmin);
  return <GrowthTab data={data} growth={growth} />;
}

/**
 * The Giving tab's own reads, deferred the same way.
 *
 * ⚠️ `isSuperAdmin` is NOT passed, and the omission is deliberate rather than an
 * oversight. `useGivingData` is TENANT-SCOPED ONLY: `tenants/{t}/pledges` is a
 * subcollection with no apex-level counterpart to read at all, and summing
 * every church's campaigns into one progress figure is a number this product
 * does not define. So there is no platform-wide branch for the flag to select,
 * and giving the hook a parameter it must ignore would suggest there is one.
 * On the apex all three widgets report that no ministry is in scope — the same
 * answer the Overview tab's giving widgets already give there.
 */
function GivingPanel({ data, tenantId }: {
  data: OverviewData;
  tenantId: string | null;
}) {
  const giving = useGivingData(tenantId);
  return <GivingTab data={data} giving={giving} />;
}

export default AdminDashboardHome;
