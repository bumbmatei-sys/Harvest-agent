'use client';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  CONTACT_SOURCES, contactCommunities, type CommunityCarrier, type CommunityFilters, type CommunityStatusFilter, type DateField, type EmailFilter, type SourceFilter,
} from '@/lib/crm-communities';

const STATUS_LABELS: Record<CommunityStatusFilter, string> = { any: 'Any status', active: 'Active', left: 'Left' };
const EMAIL_LABELS: Record<EmailFilter, string> = { any: 'Any email', subscribed: 'Subscribed', unsubscribed: 'Unsubscribed', none: 'Not subscribed' };
// #577: how a contact arrived, and when they joined or left.
const SOURCE_LABELS: Record<SourceFilter, string> = {
  any: 'Any source', discover: 'Discover', link: 'Direct link', website: 'Website', community: 'Community',
  import: 'Newsletter import', other: 'Added another way',
};
const DATE_LABELS: Record<DateField, string> = { joined: 'Joined', left: 'Left' };

/** The CRM's community, status, newsletter (#573), source and date (#577) filters. They combine with search and type. */
export function CrmCommunityFilters({ value, onChange, communities }: {
  value: CommunityFilters;
  onChange: (next: CommunityFilters) => void;
  communities: { id: string; name: string }[];
}) {
  const communityLabel = value.community === 'all' ? 'All communities'
    : value.community === 'none' ? 'No community'
      : communities.find(c => c.id === value.community)?.name ?? 'Community';
  return <div data-testid="crm-community-filters" className="flex flex-wrap items-center gap-2">
    <Select value={value.community} onValueChange={next => { if (next) onChange({ ...value, community: next }); }}>
      <SelectTrigger aria-label="Filter by community" className="min-h-11 sm:min-h-0"><SelectValue>{communityLabel}</SelectValue></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All communities</SelectItem>
        {communities.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
        <SelectItem value="none">No community</SelectItem>
      </SelectContent>
    </Select>
    <Select value={value.communityStatus} disabled={value.community === 'none'} onValueChange={next => { if (next) onChange({ ...value, communityStatus: next as CommunityStatusFilter }); }}>
      <SelectTrigger aria-label="Filter by community status" className="min-h-11 sm:min-h-0"><SelectValue>{STATUS_LABELS[value.communityStatus]}</SelectValue></SelectTrigger>
      <SelectContent>{(Object.keys(STATUS_LABELS) as CommunityStatusFilter[]).map(key => <SelectItem key={key} value={key}>{STATUS_LABELS[key]}</SelectItem>)}</SelectContent>
    </Select>
    <Select value={value.email} onValueChange={next => { if (next) onChange({ ...value, email: next as EmailFilter }); }}>
      <SelectTrigger aria-label="Filter by newsletter" className="min-h-11 sm:min-h-0"><SelectValue>{EMAIL_LABELS[value.email]}</SelectValue></SelectTrigger>
      <SelectContent>{(Object.keys(EMAIL_LABELS) as EmailFilter[]).map(key => <SelectItem key={key} value={key}>{EMAIL_LABELS[key]}</SelectItem>)}</SelectContent>
    </Select>
    <Select value={value.source} onValueChange={next => { if (next) onChange({ ...value, source: next as SourceFilter }); }}>
      <SelectTrigger aria-label="Filter by source" className="min-h-11 sm:min-h-0"><SelectValue>{SOURCE_LABELS[value.source]}</SelectValue></SelectTrigger>
      <SelectContent>{(['any', ...CONTACT_SOURCES] as SourceFilter[]).map(key => <SelectItem key={key} value={key}>{SOURCE_LABELS[key]}</SelectItem>)}</SelectContent>
    </Select>
    <span className="flex flex-wrap items-center gap-2">
      <Select value={value.dateField} disabled={value.community === 'none'} onValueChange={next => { if (next) onChange({ ...value, dateField: next as DateField }); }}>
        <SelectTrigger aria-label="Date to filter by" className="min-h-11 sm:min-h-0"><SelectValue>{DATE_LABELS[value.dateField]}</SelectValue></SelectTrigger>
        <SelectContent>{(Object.keys(DATE_LABELS) as DateField[]).map(key => <SelectItem key={key} value={key}>{DATE_LABELS[key]}</SelectItem>)}</SelectContent>
      </Select>
      <Input type="date" aria-label="From date" className="min-h-11 w-auto sm:min-h-0" disabled={value.community === 'none'} value={value.from} max={value.to || undefined} onChange={event => onChange({ ...value, from: event.target.value })} />
      <span aria-hidden className="text-sm text-muted">to</span>
      <Input type="date" aria-label="To date" className="min-h-11 w-auto sm:min-h-0" disabled={value.community === 'none'} value={value.to} min={value.from || undefined} onChange={event => onChange({ ...value, to: event.target.value })} />
    </span>
  </div>;
}

const shortDate = (date: Date | null) => date ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';

/** Every community a contact belongs to or left, one badge each. */
export function CommunityMemberships({ contact, defaultName }: { contact: CommunityCarrier; defaultName?: string }) {
  const entries = contactCommunities(contact, defaultName);
  if (entries.length === 0) return null;
  return <span data-testid="crm-communities" className="mt-1 flex flex-wrap gap-1">
    {entries.map(entry => <Badge key={entry.id} variant={entry.status === 'active' ? 'secondary' : 'outline'} className="text-xs">
      {entry.name} · {entry.status === 'active' ? 'Active' : `Left${entry.leftAt ? ` ${shortDate(entry.leftAt)}` : ''}`}
    </Badge>)}
  </span>;
}
