"use client";
/**
 * THE-276 — the dashboard tab shell.
 *
 * ─── This was slice 1 of 6, and the shell said so ────────────────────────────
 *
 * The full design was 28 widgets across six tabs. THE-276 shipped the shell and
 * the Overview tab; the other five rendered an `empty` state naming what will
 * live there. ⚠️ Five tabs remain and all five are built — see THE-299 below,
 * which removes the sixth rather than filling it.
 *
 * 🔴 THE DESIGN'S 28 IS NOT A TARGET. THE-294 DELETED THREE OF THEM — reach and
 * impressions, blog view counts, and course completions over time — because
 * nothing in this database records the fields they would need and nothing
 * later will make them readable without a tracking system that does not exist.
 * They are removed from this table's `upcoming` bookkeeping too; the full
 * decision is in `ContentTab`'s `DELETED_CONTENT_WIDGETS`.
 *
 * Showing an unbuilt tab is deliberate over hiding it: the tab strip is the
 * design's own information architecture, and shipping it whole is what lets the
 * later slices land one tab at a time without re-deciding it. A reader who opens
 * an unbuilt tab sees that it exists and is not built yet — which is true —
 * rather than a tab that quietly is not there.
 *
 * ⚠️ THE-283 (slice 2) fills Growth in, and does it by passing a NODE rather
 * than by teaching this file what a Growth tab contains. `built` below is a map
 * from tab id to the panel someone has supplied; a tab with no entry still gets
 * {@link NotYetBuilt}. So each later slice lands by adding a prop and a caller,
 * and this file keeps having no opinion about what a tab holds — which is also
 * what lets a test mount the strip without mounting a Firestore-backed tab.
 *
 * 🔴 {@link NotYetBuilt} STAYS, and is not dead code to be tidied away. It is
 * the mechanism that makes the map above safe: a sixth tab added later without
 * a panel renders a placeholder naming itself rather than an empty panel, and
 * THE-276's guard derives its claim from `DASHBOARD_TABS` by EXCLUSION so that
 * such a tab is automatically required to carry one.
 *
 * ⚠️ THE-290 (slice 3) fills Giving in and is the proof that the shape holds:
 * it added ONE optional prop and one entry in `built`, and this file learned
 * nothing about campaigns, pledges or receipts.
 *
 * ⚠️ THE-294 (slice 4) fills BOTH Engagement and Content in, which is the shape
 * holding twice over: two more optional props, two more entries in `built`, and
 * this file still knows nothing about check-ins, CRM activity, the prayer wall
 * or course completion. ONE tab remained unbuilt — Platform — and it rendered
 * its own placeholder.
 *
 * ─── 🔴 THE-299 REMOVES THAT TAB. Five tabs, and every one of them is built ──
 *
 * The founder's decision, 2026-09-04: "Remove platform tab. We don't call
 * dodo." The tab's two headline widgets were MRR and plan distribution, and
 * THE-285's audit established that MRR is unknowable from this database: a
 * tenant document stores the PLAN but not the billing interval, so
 * monthly-versus-yearly cannot be derived from anything Firestore holds. The
 * only way to it is a Dodo API call, and that call is ruled out.
 *
 * 🔴 SO THE TAB IS DELETED RATHER THAN LEFT EMPTY. A placeholder is a promise —
 * every other one on this strip was kept, in slices 2 through 5 — and this is
 * the one that cannot be. "Platform is not built yet" told a founder to wait
 * for a number that is not coming. Removing the row is the honest form of the
 * same information, and it is the whole change: the id, the label, the icon and
 * the `upcoming` string go together, because a tab id with no row is exactly
 * the sort of orphan this table's closed-literal shape exists to prevent.
 *
 * ⚠️ `'platform'` AS A TAB ID EXISTED NOWHERE ELSE. The word occurs 40-odd
 * times in `src/`, and every other occurrence is a different concept: an SMS
 * credential source (`source: 'platform'`), the reserved-subdomain lists,
 * `PLATFORM_TENANT_ID`, and prose about the platform tenant. No route, no
 * permission, no `analytics-permission.ts` entry and no test referred to a tab
 * by that id. Nothing outside this file needed changing for the tab to go.
 *
 * 🔴 NOTHING ABOUT THE SUPER-ADMIN CONCEPT MOVES. `analytics-permission.ts` is
 * untouched, `assertConcreteScope` is untouched, and a super admin on the apex
 * still sees "No ministry is in scope" on the tenant-scoped widgets. That is a
 * statement about SCOPE, which is unrelated to whether a tab named Platform
 * exists.
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
  BarChart3, HandCoins, HeartHandshake, LayoutGrid, TrendingUp, type LucideIcon,
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
 * The five tabs, in the design's order.
 *
 * ⚠️ Ids are lowercase feature words and nothing else — no tenant name, no
 * document id, no user-supplied string — for the same reason the admin section
 * table is a closed list of literals. These are not URL segments today and must
 * not become interpolated ones.
 */
export const DASHBOARD_TABS: readonly DashboardTabDef[] = Object.freeze([
  { id: 'overview', label: 'Overview', icon: LayoutGrid, upcoming: 'the tab you are on' },
  { id: 'growth', label: 'Growth', icon: TrendingUp, upcoming: 'attendance, retention cohorts and where your people are' },
  /*
   * 🔴 `upcoming` no longer promises "recurring gift health". THE-285 and
   * THE-290 established that nothing at the tenant level marks a gift
   * recurring — Stripe Connect is off, `invoices.type` records no cadence, and
   * `users.donationSubscriptionId` is the PLATFORM partnership rather than a
   * church's donor — so this string was advertising a widget that cannot be
   * built honestly. The tab is built now and this text is unreachable, but it
   * is corrected rather than left standing: an accurate promise is what a
   * later reader of this table needs, and #429 left the Growth row accurate
   * for the same reason.
   */
  { id: 'giving', label: 'Giving', icon: HandCoins, upcoming: 'giving over time, campaign progress and pledge fulfilment' },
  /*
   * ⚠️ THE-294 corrects both strings below, for the reason the Giving row was
   * corrected above: they are unreachable now that both tabs are built, and an
   * accurate promise is what a later reader of this table needs.
   *
   * 🔴 `content` NO LONGER PROMISES "article reach and sermon views". THIS IS
   * THE-276 BOOKKEEPING BEING REMOVED, not a wording tidy. Nothing in Firestore
   * records an impression, a view or a reach figure for an article or a sermon,
   * and the product analytics record route PATTERNS rather than which article
   * was opened — so they cannot attribute a view to a piece of content either.
   * This row was advertising two widgets that CANNOT BE BUILT, and a founder
   * who read it would wait for a number that will never arrive. The full
   * decision, with the third deletion, is recorded in `ContentTab`'s
   * `DELETED_CONTENT_WIDGETS`; this is the same removal at the one other place
   * the design's widget list had leaked into the code.
   */
  { id: 'engagement', label: 'Engagement', icon: HeartHandshake, upcoming: 'check-ins, CRM activity and the prayer wall' },
  { id: 'content', label: 'Content', icon: BarChart3, upcoming: 'course completion' },
  /*
   * 🔴 THERE IS NO SIXTH ROW. THE-299 removed `platform`; see this file's
   * header for the founder's decision and THE-285's finding behind it. It is
   * deleted rather than commented out, because a commented-out row is a tab
   * somebody restores without re-reading why it went.
   */
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
 * ⚠️ `growth`, `giving`, `engagement` and `content` are ALL OPTIONAL. Omitting
 * any of them renders the same placeholder that tab had before its slice, which
 * is what keeps every existing caller and test valid and makes "this tab is
 * built" a property of the call site rather than of this file.
 */
export function DashboardTabs({ overview, growth, giving, engagement, content }: {
  overview: React.ReactNode;
  growth?: React.ReactNode;
  giving?: React.ReactNode;
  engagement?: React.ReactNode;
  content?: React.ReactNode;
}) {
  /** Tab id → the panel supplied for it. A tab absent here is not built yet. */
  const built: Record<string, React.ReactNode> = { overview };
  if (growth !== undefined) built.growth = growth;
  if (giving !== undefined) built.giving = giving;
  if (engagement !== undefined) built.engagement = engagement;
  if (content !== undefined) built.content = content;

  return (
    <Tabs defaultValue={DEFAULT_DASHBOARD_TAB} className="w-full" data-dashboard-tabs>
      {/*
        The strip scrolls rather than wrapping or squeezing: five labels still
        do not fit across a 380px phone, and `overflow-x-auto` keeps that
        overflow inside the strip instead of on the page. ⚠️ Dropping to five
        did NOT make this unnecessary and the measurement test re-asserts it:
        the strip still overflows at 380px, and the page body still does not.

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
