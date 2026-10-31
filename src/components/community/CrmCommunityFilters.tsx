'use client';

import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  contactCommunities, type CommunityCarrier, type CommunityFilters, type CommunityStatusFilter, type EmailFilter,
} from '@/lib/crm-communities';

const STATUS_LABELS: Record<CommunityStatusFilter, string> = { any: 'Any status', active: 'Active', left: 'Left' };
const EMAIL_LABELS: Record<EmailFilter, string> = { any: 'Any email', subscribed: 'Subscribed', unsubscribed: 'Unsubscribed', none: 'Not subscribed' };

/** The CRM's community, status and newsletter dropdowns (#573). They combine with search and type. */
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
