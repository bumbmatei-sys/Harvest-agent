'use client';

import { useState } from 'react';
import { MailOpen, MoreVertical, Plus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { PageHeader, SetupBanner, TAP, formatStamp, plural, senderReady } from '@/components/email/kit';
import type { Broadcast, Overview } from '@/components/email/email-api';

type Tab = 'all' | 'drafts' | 'scheduled' | 'sent';

const TABS: readonly { value: Tab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'drafts', label: 'Drafts' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'sent', label: 'Sent' },
];

export function matchesTab(b: Broadcast, tab: Tab): boolean {
  if (tab === 'all') return true;
  if (tab === 'drafts') return b.status === 'draft';
  if (tab === 'scheduled') return b.status === 'scheduled';
  return b.status === 'sent' || b.status === 'partial' || b.status === 'failed' || b.status === 'sending';
}

const STATUS_LABEL: Record<Broadcast['status'], string> = {
  draft: 'Draft', scheduled: 'Scheduled', sending: 'Sending', sent: 'Sent', partial: 'Partly sent', failed: 'Not sent',
};

function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex flex-col gap-1 border-line p-5 not-first:border-l max-md:not-first:border-l-0 max-md:not-first:border-t">
      <span className="text-sm text-muted">{label}</span>
      <span className="font-display text-2xl font-semibold text-strong">{value}</span>
      <span className="text-xs text-faint">{note}</span>
    </div>
  );
}

export function BroadcastsView({ data, onNew, onOpen, onDelete, onSettings }: {
  data: Overview;
  onNew: () => void;
  onOpen: (b: Broadcast) => void;
  onDelete: (b: Broadcast) => void;
  onSettings: () => void;
}) {
  const [tab, setTab] = useState<Tab>('all');
  const rows = data.broadcasts.filter((b) => matchesTab(b, tab));
  const subscribed = data.subscribers.filter((s) => s.status === 'subscribed').length;
  const sent = data.broadcasts.filter((b) => b.status === 'sent' || b.status === 'partial').length;
  const scheduled = data.broadcasts.filter((b) => b.status === 'scheduled').length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Broadcasts"
        subtitle="One-time emails to your list, sent now or later."
        action={<Button className={TAP} onClick={onNew}><Plus data-icon="inline-start" />New broadcast</Button>}
      />
      {!senderReady(data.settings) && (
        <SetupBanner actionLabel="Open settings" onAction={onSettings}>Finish your sender details and verify your domain before you send.</SetupBanner>
      )}
      <Card className="grid gap-0 overflow-hidden p-0 md:grid-cols-3">
        <Kpi label="Subscribers" value={subscribed.toLocaleString()} note="Can get your emails" />
        <Kpi label="Scheduled" value={scheduled.toLocaleString()} note="Waiting for their time" />
        <Kpi label="Broadcasts sent" value={sent.toLocaleString()} note={`${plural(data.broadcasts.length, 'broadcast', 'broadcasts')} in all`} />
      </Card>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList aria-label="Broadcast status">
          {TABS.map((t) => <TabsTrigger key={t.value} value={t.value} className={TAP}>{t.label}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      {rows.length === 0 ? (
        <Card>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><MailOpen /></EmptyMedia>
              <EmptyTitle>{tab === 'all' ? 'No broadcasts yet' : `Nothing in ${TABS.find((t) => t.value === tab)?.label.toLowerCase()}`}</EmptyTitle>
              <EmptyDescription>Write one email, pick who gets it, and send it now or schedule it.</EmptyDescription>
            </EmptyHeader>
            <Button className={TAP} onClick={onNew}><Plus data-icon="inline-start" />New broadcast</Button>
          </Empty>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Broadcast</TableHead>
                <TableHead className="text-right">Sent to</TableHead>
                <TableHead className="text-right">Skipped</TableHead>
                <TableHead className="text-right">When</TableHead>
                <TableHead className="w-10"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b) => {
                const editable = b.status === 'draft' || b.status === 'scheduled';
                const skipped = b.stats ? b.stats.skippedSuppressed + b.stats.skippedNotOptedIn : null;
                return (
                  <TableRow key={b.id} data-broadcast-id={b.id}>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          {editable ? (
                            <button type="button" className="min-h-11 text-left font-medium text-strong hover:underline sm:min-h-0" onClick={() => onOpen(b)}>
                              {b.subject || 'Untitled broadcast'}
                            </button>
                          ) : (
                            <span className="font-medium text-strong">{b.subject || 'Untitled broadcast'}</span>
                          )}
                          <Badge variant={b.status === 'failed' || b.status === 'partial' ? 'destructive' : 'outline'} className={b.status === 'scheduled' ? 'border-transparent bg-surface-gold text-strong' : undefined}>{STATUS_LABEL[b.status]}</Badge>
                        </div>
                        {b.error && <span role="alert" className="text-xs text-danger">{b.error}</span>}
                        {!b.error && <span className="text-xs text-faint">Edited {formatStamp(b.updatedAt)}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted">{b.stats ? b.stats.sent.toLocaleString() : '-'}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted">{skipped == null ? '-' : skipped.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-muted">{formatStamp(b.status === 'scheduled' ? b.scheduledAt : b.sentAt) || '-'}</TableCell>
                    <TableCell>
                      {b.status !== 'sent' && b.status !== 'partial' && b.status !== 'sending' && (
                        <DropdownMenu>
                          <DropdownMenuTrigger className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'min-h-11 sm:min-h-0')} aria-label={`Actions for ${b.subject || 'untitled broadcast'}`}>
                            <MoreVertical />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {editable && <DropdownMenuItem onClick={() => onOpen(b)}>Edit</DropdownMenuItem>}
                            <DropdownMenuItem onClick={() => onDelete(b)}>Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
