'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { formatCents } from '@/lib/donation-history';

import { DashboardAnalytics } from '../AdminDashboardHome';
import { hasAnalyticsAccess, type AnalyticsAccess } from '../dashboard/analytics-permission';

import { DataTable } from './data-table';
import {
  HOME_KPI_SOURCES,
  HOME_PERIODS,
  formatKpi,
  type HomePeriod,
} from './home-kpis';
import { useHomeKpis, type HomeKpiCard } from './use-home-kpis';
import type { Series } from '../dashboard/dashboard-data';
import type { ShellPlaceholderId } from './shell-nav';

type HomeTarget =
  | { kind: 'tab'; id: string }
  | { kind: 'placeholder'; id: ShellPlaceholderId };

const CHECKLIST: readonly { title: string; target: HomeTarget }[] = [
  { title: 'Add your service times', target: { kind: 'tab', id: 'services' } },
  { title: 'Claim your page address', target: { kind: 'placeholder', id: 'church-page' } },
  { title: 'Connect your social accounts', target: { kind: 'placeholder', id: 'publish' } },
];

const ACTIONS: readonly { title: string; body: string; target: HomeTarget }[] = [
  { title: 'New program', body: 'Open courses', target: { kind: 'tab', id: 'courses' } },
  { title: 'Your events', body: 'Open events', target: { kind: 'tab', id: 'events' } },
  {
    title: 'Send an email',
    body: 'Email sending from here is not available',
    target: { kind: 'placeholder', id: 'send-email' },
  },
  { title: 'Schedule a post', body: 'Scheduling is not in this version', target: { kind: 'placeholder', id: 'publish' } },
];

interface TestimonyRow {
  name: string;
  date: string;
}

const TESTIMONY_COLUMNS: ColumnDef<TestimonyRow>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'date', header: 'Date' },
];

const chartConfig = {
  value: { label: 'Recorded giving', color: 'var(--brand-color)' },
} satisfies ChartConfig;

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export interface AdminHomeViewProps {
  tenantName: string;
  period: HomePeriod;
  onPeriod: (period: HomePeriod) => void;
  loading: boolean;
  cards: readonly HomeKpiCard[];
  givingByDay: Series;
  sampleLabel?: string;
  onOpen: (target: HomeTarget) => void;
  /** Preview shows the figure cards. The live home passes false and gates them. */
  includeFigures?: boolean;
  showPeriod?: boolean;
  after?: ReactNode;
}

export function AdminHomeView({
  tenantName,
  period,
  onPeriod,
  loading,
  cards,
  givingByDay,
  sampleLabel,
  onOpen,
  includeFigures = true,
  showPeriod = true,
  after,
}: AdminHomeViewProps) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8" data-admin-home data-screen="AdminHome">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-light tracking-tight text-strong">
            {greeting(new Date())}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {tenantName}.
            {includeFigures ? ' Figures below are what was recorded.' : ''}
            {sampleLabel ? ` ${sampleLabel}` : ''}
          </p>
        </div>
        {showPeriod && <ToggleGroup
          value={[String(period)]}
          onValueChange={(next) => {
            const picked = Number(next[0]);
            if (picked === 7 || picked === 14 || picked === 30) onPeriod(picked);
          }}
          spacing={0}
          aria-label="Period"
        >
          {HOME_PERIODS.map((days) => (
            <ToggleGroupItem key={days} value={String(days)} className="min-h-11 px-3" aria-label={`${days} days`}>
              {days}d
            </ToggleGroupItem>
          ))}
        </ToggleGroup>}
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-2xl font-semibold">Set up your ministry</CardTitle>
          <CardDescription>0 of 3</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Progress value={0} aria-label="Setup progress">
            <span className="sr-only">0 of 3</span>
          </Progress>
          <ul className="flex flex-col gap-2">
            {CHECKLIST.map((step) => (
              <li key={step.title} className="flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-muted">
                <Checkbox checked={false} aria-label={`${step.title}, not done`} tabIndex={-1} className="pointer-events-none" />
                <button
                  type="button"
                  className="min-h-11 flex-1 text-left text-sm text-strong"
                  onClick={() => onOpen(step.target)}
                >
                  {step.title}
                </button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ACTIONS.map((action) => (
          <button
            key={action.title}
            type="button"
            className="min-h-11 rounded-xl text-left"
            onClick={() => onOpen(action.target)}
          >
            <Card className="h-full">
              <CardHeader>
                <CardTitle>{action.title}</CardTitle>
                <CardDescription>{action.body}</CardDescription>
              </CardHeader>
            </Card>
          </button>
        ))}
      </div>

      {includeFigures && <HomeFigures loading={loading} cards={cards} givingByDay={givingByDay} />}
      {after}
    </div>
  );
}

function HomeFigures({
  loading,
  cards,
  givingByDay,
}: {
  loading: boolean;
  cards: readonly HomeKpiCard[];
  givingByDay: Series;
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const source = HOME_KPI_SOURCES[card.id];
          const shown = formatKpi(source, card.figure);
          return (
            <Card key={card.id} data-home-kpi={card.id}>
              <CardHeader>
                <CardDescription>{card.label}</CardDescription>
                <CardTitle className="font-display text-3xl font-light">
                  {loading ? <Skeleton className="h-9 w-24" /> : shown ?? 'Unavailable'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-4 w-full" />
                ) : card.figure.kind === 'exact' ? (
                  <p className="text-xs text-muted">
                    {card.collection} · {card.field}
                  </p>
                ) : (
                  <p className="text-xs text-muted">{card.figure.reason}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recorded giving</CardTitle>
          <CardDescription>Daily total of recorded gifts, in the currency the records use.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : givingByDay.kind !== 'complete' ? (
            <p className="text-sm text-muted">{givingByDay.reason}</p>
          ) : (
            <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
              <AreaChart data={givingByDay.points}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={72}
                  tickFormatter={(value) => formatCents(Number(value))}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => formatCents(Number(value))}
                    />
                  }
                />
                <Area
                  dataKey="value"
                  type="monotone"
                  stroke="var(--color-value)"
                  fill="var(--color-value)"
                  fillOpacity={0.2}
                />
              </AreaChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Testimonies</CardTitle>
          <CardDescription>No testimonies collection is recorded.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable columns={TESTIMONY_COLUMNS} data={[]} empty="No testimonies recorded." />
        </CardContent>
      </Card>
    </>
  );
}

function AnalyticsDenied() {
  return (
    <section className="rounded-xl border border-dashed border-line px-6 py-10 text-center" data-analytics-denied>
      <h2 className="font-display text-xl font-semibold text-strong">Analytics is not part of your access</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
        Ask an admin who can manage roles to turn on the Analytics permission for your account.
      </p>
    </section>
  );
}

function GrantedAnalytics({
  tenantId,
  period,
  onPeriod,
  isSuperAdmin,
  unreadCount,
}: {
  tenantId: string | null;
  period: HomePeriod;
  onPeriod: (period: HomePeriod) => void;
  isSuperAdmin: boolean;
  unreadCount: number;
}) {
  const state = useHomeKpis(tenantId, period);
  return (
    <>
      <div className="flex justify-end">
        <ToggleGroup
          value={[String(period)]}
          onValueChange={(next) => {
            const picked = Number(next[0]);
            if (picked === 7 || picked === 14 || picked === 30) onPeriod(picked);
          }}
          spacing={0}
          aria-label="Period"
        >
          {HOME_PERIODS.map((days) => (
            <ToggleGroupItem key={days} value={String(days)} className="min-h-11 px-3" aria-label={`${days} days`}>
              {days}d
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <HomeFigures loading={state.loading} cards={state.cards} givingByDay={state.givingByDay} />
      <DashboardAnalytics
        tenantId={tenantId}
        isSuperAdmin={isSuperAdmin}
        unreadCount={unreadCount}
        showInbox={isSuperAdmin && !tenantId}
      />
    </>
  );
}

export function AdminHome({
  tenantId,
  tenantName,
  isSuperAdmin,
  unreadCount,
  onOpen,
}: {
  tenantId: string | null;
  tenantName: string;
  isSuperAdmin: boolean;
  unreadCount: number;
  onOpen: (target: HomeTarget) => void;
}) {
  const [period, setPeriod] = useState<HomePeriod>(14);
  const [access, setAccess] = useState<AnalyticsAccess>('pending');

  useEffect(() => {
    let live = true;
    hasAnalyticsAccess().then((granted) => {
      if (live) setAccess(granted ? 'granted' : 'denied');
    });
    return () => { live = false; };
  }, []);

  return (
    <AdminHomeView
      tenantName={tenantName}
      period={period}
      onPeriod={setPeriod}
      loading={false}
      cards={[]}
      givingByDay={{ kind: 'unavailable', reason: '' }}
      onOpen={onOpen}
      includeFigures={false}
      showPeriod={false}
      after={
        access === 'pending' ? (
          <Skeleton className="h-64 w-full" data-analytics-pending />
        ) : access === 'denied' ? (
          <AnalyticsDenied />
        ) : (
          <GrantedAnalytics
            tenantId={tenantId}
            period={period}
            onPeriod={setPeriod}
            isSuperAdmin={isSuperAdmin}
            unreadCount={unreadCount}
          />
        )
      }
    />
  );
}

export type { HomeTarget };
