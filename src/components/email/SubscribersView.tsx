'use client';

import { useMemo, useState } from 'react';
import { FileUp, Search } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { EmailContact, EmailStatus } from '@/lib/email/audience';
import { PageHeader, Pick, SetupBanner, TAP, formatDay, plural, senderReady } from '@/components/email/kit';
import type { Overview } from '@/components/email/email-api';

type StatusFilter = 'subscribed' | 'suppressed' | 'none' | 'all';

const STATUS_OPTIONS = [
  { value: 'subscribed', label: 'Subscribed' },
  { value: 'suppressed', label: 'Unsubscribed or bounced' },
  { value: 'none', label: 'Not on the list' },
  { value: 'all', label: 'Everyone in the CRM' },
] as const;

const BADGE: Record<EmailStatus, { label: string; variant: 'secondary' | 'destructive' | 'outline'; tone?: string }> = {
  subscribed: { label: 'Subscribed', variant: 'outline', tone: 'border-transparent bg-surface-gold text-strong' },
  unsubscribed: { label: 'Unsubscribed', variant: 'outline' },
  bounced: { label: 'Bounced', variant: 'destructive' },
  complained: { label: 'Marked spam', variant: 'destructive' },
  none: { label: 'Not on the list', variant: 'outline' },
};

export const ROW_LIMIT = 200;

export function filterPeople(people: readonly EmailContact[], q: string, status: StatusFilter, tag: string): EmailContact[] {
  const needle = q.trim().toLowerCase();
  return people.filter((p) => {
    if (status === 'subscribed' && p.status !== 'subscribed') return false;
    if (status === 'suppressed' && p.status !== 'unsubscribed' && p.status !== 'bounced' && p.status !== 'complained') return false;
    if (status === 'none' && p.status !== 'none') return false;
    if (tag && !p.tags.includes(tag)) return false;
    return !needle || p.email.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle);
  });
}

export function SubscribersView({ data, onImport, onSettings }: { data: Overview; onImport: () => void; onSettings: () => void }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('subscribed');
  const [tag, setTag] = useState('');
  const subscribed = data.subscribers.filter((s) => s.status === 'subscribed').length;
  const tags = useMemo(() => [...new Set(data.subscribers.flatMap((s) => s.tags))].sort(), [data.subscribers]);
  const shown = filterPeople(data.subscribers, q, status, tag);
  const visible = shown.slice(0, ROW_LIMIT);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Subscribers" subtitle={`${plural(subscribed, 'person', 'people')} on your list. They are the people in your CRM who opted in to email.`} />
      {!senderReady(data.settings) && (
        <SetupBanner actionLabel="Open settings" onAction={onSettings}>Finish your sender details and verify your domain before you send.</SetupBanner>
      )}
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted">Bring your list from Mailchimp, Substack, or a CSV. It joins your CRM.</p>
        <Button className={TAP} onClick={onImport}><FileUp data-icon="inline-start" />Import contacts</Button>
      </div>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
        <Input aria-label="Search by email or name" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by email or name" className={`${TAP} bg-surface-sunken pl-9`} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Pick label="Status" value={status} options={STATUS_OPTIONS} onChange={setStatus} className="w-56" />
        <Pick label="Tag" value={tag} options={[{ value: '', label: 'Any tag' }, ...tags.map((t) => ({ value: t, label: t }))]} onChange={setTag} className="w-44" />
        <span className="ml-auto text-sm text-muted">{plural(shown.length, 'person', 'people')} shown</span>
      </div>
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>From</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted">{data.subscribers.length === 0 ? 'Nobody yet. Import a list, or add people in the CRM.' : 'No one matches.'}</TableCell></TableRow>
            ) : visible.map((p) => (
              <TableRow key={p.id} data-contact-id={p.id}>
                <TableCell className="font-medium text-strong">{p.email}</TableCell>
                <TableCell className="text-muted">{p.name}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">{p.tags.map((t) => <Badge key={t} variant="outline">{t}</Badge>)}</div>
                </TableCell>
                <TableCell className="text-muted capitalize">{p.source || 'CRM'}</TableCell>
                <TableCell className="text-muted">{formatDay(p.joinedAt)}</TableCell>
                <TableCell className="text-right"><Badge variant={BADGE[p.status].variant} className={BADGE[p.status].tone}>{BADGE[p.status].label}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {shown.length > ROW_LIMIT && <p className="text-xs text-faint">Showing the first {ROW_LIMIT} of {shown.length.toLocaleString()}. Search or filter to find the rest.</p>}
    </div>
  );
}
