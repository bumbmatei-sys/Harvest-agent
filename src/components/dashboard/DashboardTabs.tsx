"use client";
/**
 * THE-276 — the dashboard tab shell.
 *
 * ─── This is slice 1 of 6, and the shell says so ─────────────────────────────
 *
 * The full design is 28 widgets across these six tabs. THE-276 shipped the
 * shell and the Overview tab; the other five rendered an `empty` state naming
 * what will live there. That is deliberate over hiding them: the tab strip is
 * the design's own information architecture, and shipping it whole is what lets
 * the next five slices land one tab at a time without re-deciding it. A reader
 * who opens an unbuilt tab sees that it exists and is not built yet — which is
 * true — rather than a tab that quietly is not there.
 *
 * ⚠️ THE-283 (slice 2) fills Growth in, and does it by passing a NODE rather
 * than by teaching this file what a Growth tab contains. `built` below is a map
 * from tab id to the panel someone has supplied; a tab with no entry still gets
 * {@link NotYetBuilt}. So slices 3 through 6 land by adding a prop and a caller,
 * and this file keeps having no opinion about what a tab holds — which is also
 * what lets a test mount the strip without mounting a Firestore-backed tab.
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
 * The shell. Each panel is passed in rather than imported so this file has no
 * opinion about what a tab contains, and so a test can mount the strip without
 * mounting a Firestore-backed tab.
 *
 * ⚠️ `growth` is OPTIONAL. Omitting it renders the same placeholder the tab had
 * before THE-283, which is what keeps every existing caller and test valid and
 * makes "this tab is built" a property of the call site rather than of this file.
 */
export function DashboardTabs({ overview, growth }: {
  overview: React.ReactNode;
  growth?: React.ReactNode;
}) {
  /** Tab id → the panel supplied for it. A tab absent here is not built yet. */
  const built: Record<string, React.ReactNode> = { overview };
  if (growth !== undefined) built.growth = growth;

  return (
    <Tabs defaultValue={DEFAULT_DASHBOARD_TAB} className="w-full" data-dashboard-tabs>
      {/*
        The strip scrolls rather than wrapping or squeezing: six labels do not
        fit across a 380px phone, and `overflow-x-auto` keeps that overflow
        inside the strip instead of on the page.

        ⚠️ NO NEGATIVE MARGIN. This carried `-mx-1 … px-1` to give the first and
        last tab's focus ring room, and that bled 4px past the wrapper on each
        side. Below `lg` the wrapper's `p-4` absorbed it and at 1440px the
        `max-w-6xl` centring margin did — but at 1024px and 1280px, where
        `lg:p-0` has removed the padding and the cap is not yet binding, it put
        4px of horizontal scroll on the PAGE. Measured, not reasoned about:
        scrollWidth 1028 at 1024 and 1284 at 1280, and clean at the three widths
        either side of them. Non-monotonic, like everything else about width
        here, which is why all five are measured.

        `pb-2` is 8px, which is what the active tab's underline needs: it is an
        `::after` at `bottom-[-5px]` with `h-0.5`, so it reaches 7px below the
        tab, and `overflow-x-auto` computes `overflow-y` to `auto` as well —
        anything less clips the indicator or grows a vertical scrollbar. (It
        needed no room before THE-276-FIX because the rule that gives it its
        geometry never matched, so it was never drawn.)
      */}
      <div className="overflow-x-auto pb-2">
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
          {tab.id in built ? built[tab.id] : <NotYetBuilt tab={tab} />}
        </TabsContent>
      ))}
    </Tabs>
  );
}
