/**
 * One CRM across every community of the ministry (#573). A contact's
 * `communities` map records each community they joined; contacts written before
 * that map existed carry only the flat default-community fields, which read as
 * the default community here so older rows filter the same way.
 */
import { toSafeDate, type DateLike } from '@/utils/format-date';

export const DEFAULT_COMMUNITY_KEY = 'default';

export type CommunityEntry = { id: string; name: string; status: 'active' | 'left'; joinedAt: Date | null; leftAt: Date | null };

export interface CommunityCarrier {
  source?: string;
  communities?: unknown;
  communityStatus?: string;
  communityJoinedAt?: DateLike;
  communityLeftAt?: DateLike;
  emailStatus?: unknown;
}

const isStatus = (value: unknown): value is 'active' | 'left' => value === 'active' || value === 'left';

/** Every community on a contact, the default first, then by name. Malformed entries are skipped. */
export function contactCommunities(contact: CommunityCarrier, defaultName = 'Main community'): CommunityEntry[] {
  const out = new Map<string, CommunityEntry>();
  const raw = contact.communities;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const entry = value as Record<string, unknown>;
      if (!isStatus(entry.status)) continue;
      out.set(id, {
        id,
        name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : (id === DEFAULT_COMMUNITY_KEY ? defaultName : 'Community'),
        status: entry.status,
        joinedAt: toSafeDate(entry.joinedAt as DateLike),
        leftAt: toSafeDate(entry.leftAt as DateLike),
      });
    }
  }
  if (!out.has(DEFAULT_COMMUNITY_KEY) && contact.source === 'community' && isStatus(contact.communityStatus)) {
    out.set(DEFAULT_COMMUNITY_KEY, {
      id: DEFAULT_COMMUNITY_KEY, name: defaultName, status: contact.communityStatus,
      joinedAt: toSafeDate(contact.communityJoinedAt), leftAt: toSafeDate(contact.communityLeftAt),
    });
  }
  return [...out.values()].sort((a, b) => a.id === DEFAULT_COMMUNITY_KEY ? -1 : b.id === DEFAULT_COMMUNITY_KEY ? 1 : a.name.localeCompare(b.name));
}

/** Every community that appears anywhere in the loaded contacts, for the dropdown. */
export function communityOptions(contacts: CommunityCarrier[], defaultName?: string): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const contact of contacts) for (const entry of contactCommunities(contact, defaultName)) if (!seen.has(entry.id)) seen.set(entry.id, entry.name);
  return [...seen].map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.id === DEFAULT_COMMUNITY_KEY ? -1 : b.id === DEFAULT_COMMUNITY_KEY ? 1 : a.name.localeCompare(b.name));
}

export type CommunityFilter = 'all' | 'none' | string;
export type CommunityStatusFilter = 'any' | 'active' | 'left';
export type EmailFilter = 'any' | 'subscribed' | 'unsubscribed' | 'none';

export interface CommunityFilters {
  community: CommunityFilter;
  communityStatus: CommunityStatusFilter;
  email: EmailFilter;
}

export const NO_COMMUNITY_FILTERS: CommunityFilters = { community: 'all', communityStatus: 'any', email: 'any' };

/** Email status as the newsletter reads it: anything other than a recorded opt-in or opt-out is "not subscribed". */
export function emailStatusOf(contact: CommunityCarrier): 'subscribed' | 'unsubscribed' | 'none' {
  const raw = contact.emailStatus;
  if (raw === 'subscribed') return 'subscribed';
  if (raw === 'unsubscribed' || raw === 'bounced' || raw === 'complained') return 'unsubscribed';
  return 'none';
}

/**
 * The filters combine. "Status" applies to the chosen community, or to any of
 * the contact's communities when every community is shown; "No community" is
 * a contact that never joined one.
 */
export function matchesCommunityFilters(contact: CommunityCarrier, filters: CommunityFilters): boolean {
  const entries = contactCommunities(contact);
  let inScope: CommunityEntry[];
  if (filters.community === 'none') {
    if (entries.length > 0) return false;
    inScope = [];
  } else if (filters.community === 'all') {
    inScope = entries;
  } else {
    inScope = entries.filter(entry => entry.id === filters.community);
    if (inScope.length === 0) return false;
  }
  if (filters.communityStatus !== 'any' && !inScope.some(entry => entry.status === filters.communityStatus)) return false;
  if (filters.email !== 'any' && emailStatusOf(contact) !== filters.email) return false;
  return true;
}
