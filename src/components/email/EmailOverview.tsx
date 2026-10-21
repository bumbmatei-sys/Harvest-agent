'use client';

import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { PageHeader, SetupBanner, TAP, plural, senderReady } from '@/components/email/kit';
import type { Overview } from '@/components/email/email-api';

function Kpi({ label, value, note, children }: { label: string; value: string; note: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-line p-5 not-first:border-l max-md:not-first:border-l-0 max-md:not-first:border-t">
      <span className="text-sm text-muted">{label}</span>
      <span className="font-display text-3xl font-semibold text-strong">{value}</span>
      {children}
      <span className="text-xs text-faint">{note}</span>
    </div>
  );
}

export function EmailOverview({ data, onNew, onSettings, onSubscribers }: {
  data: Overview;
  onNew: () => void;
  onSettings: () => void;
  onSubscribers: () => void;
}) {
  const subscribed = data.subscribers.filter((s) => s.status === 'subscribed').length;
  const suppressed = data.subscribers.filter((s) => s.status === 'unsubscribed' || s.status === 'bounced' || s.status === 'complained').length;
  const notOptedIn = data.subscribers.filter((s) => s.status === 'none').length;
  const sent = data.broadcasts.filter((b) => b.status === 'sent' || b.status === 'partial').length;
  const total = Math.max(1, data.subscribers.length);
  const rows = [
    { label: 'Subscribed', note: 'Can get your emails', count: subscribed },
    { label: 'Unsubscribed or bounced', note: 'Never emailed again', count: suppressed },
    { label: 'In your CRM, not on the list', note: 'Have not opted in to email', count: notOptedIn },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Email"
        subtitle="How your list is growing and what you have sent."
        action={<Button className="min-h-11" onClick={onNew}><Plus data-icon="inline-start" />New broadcast</Button>}
      />
      {!senderReady(data.settings) && (
        <SetupBanner actionLabel="Open settings" onAction={onSettings}>Finish your sender details and verify your domain before you send.</SetupBanner>
      )}
      <Card className="grid gap-0 overflow-hidden p-0 md:grid-cols-4">
        <Kpi label="Subscribers" value={subscribed.toLocaleString()} note={`${plural(data.subscribers.length, 'person', 'people')} in your CRM`} />
        <Kpi label="Sent this month" value={data.usage.used.toLocaleString()} note={data.usage.cap > 0 ? `${data.usage.cap.toLocaleString()} sends a month` : 'Not included in your plan'}>
          {data.usage.cap > 0 && <Progress value={Math.min(100, (data.usage.used / data.usage.cap) * 100)} className="my-1" />}
        </Kpi>
        <Kpi label="Broadcasts sent" value={sent.toLocaleString()} note={`${plural(data.broadcasts.length, 'broadcast', 'broadcasts')} in all`} />
        <Kpi label="Unsubscribed" value={suppressed.toLocaleString()} note="Removed for good" />
      </Card>
      <Card className="gap-0 p-0">
        <div className="flex items-baseline justify-between px-5 pt-5">
          <h2 className="text-base font-semibold text-strong">How your list reads</h2>
          <Button variant="link" className="min-h-11" onClick={onSubscribers}>See subscribers</Button>
        </div>
        <ul className="flex flex-col gap-4 p-5">
          {rows.map((r) => (
            <li key={r.label} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium text-strong">{r.label}</span>
                <span className="text-strong tabular-nums">{r.count.toLocaleString()}</span>
              </div>
              <Progress value={(r.count / total) * 100} />
              <span className="text-xs text-faint">{r.note}</span>
            </li>
          ))}
        </ul>
      </Card>
      <p className="text-xs text-faint">Opens and clicks are not tracked yet, so Harvest does not show an open rate.</p>
    </div>
  );
}
