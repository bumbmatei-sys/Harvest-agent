"use client";
/**
 * THE-276 — the dashboard tab shell.
 *
 * ─── This is slice 1 of 6, and the shell says so ─────────────────────────────
 *
 * The full design is 28 widgets across these six tabs. This ticket ships the
 * shell and the Overview tab; the other five render an `empty` state naming
 * what will live there. That is deliberate over hiding them: the tab strip is
 * the design's own information architecture, and shipping it whole is what lets
 * the next five slices land one tab at a time without re-deciding it. A reader
 * who opens Growth sees that it exists and is not built yet — which is true —
 * rather than a tab that quietly is not there.
 *
 * 🔴 THE SHELL LIVES HERE, NOT IN `AdminDashboard.tsx`. The admin shell owns
 * the app's OUTER navigation (sidebar → section → URL segment, via
 * lib/admin-sections.ts) and is owned by THE-277; this is a tab strip WITHIN
 * the dashboard section, so it needs nothing from it. Nothing in this file
 * reads or writes a URL segment and no row here is an admin section — adding
 * one would put a second, competing navigation vocabulary next to the closed
 * table in admin-sections.ts.
 */
import React from 'react';
import {
  BarChart3, HandCoins, HeartHandshake, LayoutGrid, Server, TrendingUp, type LucideIcon,
} from 'lucide-react';

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../ui/empty';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

export interface DashboardTabDef {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** What this tab will hold. Shown in its placeholder until it is built. */
  readonly upcoming: string;
}

/**
 * The six tabs, in the design's order.
 *
 * ⚠️ Ids are lowercase feature words and nothing else — no tenant name, no
 * document id, no user-supplied string — for the same reason the admin section
 * table is a closed list of literals. These are not URL segments today and must
 * not become interpolated ones.
 */
export const DASHBOARD_TABS: readonly DashboardTabDef[] = Object.freeze([
  { id: 'overview', label: 'Overview', icon: LayoutGrid, upcoming: 'the tab you are on' },
  { id: 'growth', label: 'Growth', icon: TrendingUp, upcoming: 'attendance, retention cohorts and where your people are' },
  { id: 'giving', label: 'Giving', icon: HandCoins, upcoming: 'campaign progress, donor tiers and recurring gift health' },
  { id: 'engagement', label: 'Engagement', icon: HeartHandshake, upcoming: 'check-ins, event attendance and community activity' },
  { id: 'content', label: 'Content', icon: BarChart3, upcoming: 'course completion, article reach and sermon views' },
  { id: 'platform', label: 'Platform', icon: Server, upcoming: 'tenant health, plan mix and platform-wide totals' },
]);

/** The tab a fresh mount lands on. */
export const DEFAULT_DASHBOARD_TAB = DASHBOARD_TABS[0].id;

function NotYetBuilt({ tab }: { tab: DashboardTabDef }) {
  return (
    <Empty className="py-10" data-tab-placeholder={tab.id}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <tab.icon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{tab.label} is not built yet</EmptyTitle>
        <EmptyDescription>{`This tab will hold ${tab.upcoming}. It ships in a later slice of the dashboard rebuild.`}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/**
 * The shell. `overview` is passed in rather than imported so this file has no
 * opinion about what a tab contains, and so a test can mount the strip without
 * mounting a Firestore-backed tab.
 */
export function DashboardTabs({ overview }: { overview: React.ReactNode }) {
  return (
    <Tabs defaultValue={DEFAULT_DASHBOARD_TAB} className="w-full" data-dashboard-tabs>
      {/* The strip scrolls rather than wrapping or squeezing: six labels do not
          fit across a 380px phone, and `overflow-x-auto` on the strip keeps the
          overflow inside it instead of on the page. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <TabsList variant="line" className="h-9">
          {DASHBOARD_TABS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="gap-1.5 px-3">
              <tab.icon aria-hidden />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {DASHBOARD_TABS.map((tab) => (
        <TabsContent key={tab.id} value={tab.id} className="pt-2">
          {tab.id === DEFAULT_DASHBOARD_TAB ? overview : <NotYetBuilt tab={tab} />}
        </TabsContent>
      ))}
    </Tabs>
  );
}
