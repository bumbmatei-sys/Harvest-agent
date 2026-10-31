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
  communitySource?: unknown;
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

/**
 * How a contact arrived (#577, PRD §6.4). Only a community join (and, for the
 * default community, the path it came by) and the newsletter import record it;
 * everyone else was added another way.
 */
export const CONTACT_SOURCES = ['discover', 'link', 'website', 'community', 'import', 'other'] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];
export type SourceFilter = 'any' | ContactSource;
export type DateField = 'joined' | 'left';

export interface CommunityFilters {
  community: CommunityFilter;
  communityStatus: CommunityStatusFilter;
  email: EmailFilter;
  /** #577 */
  source: SourceFilter;
  /** #577: a joined or left date range, inclusive, as YYYY-MM-DD in UTC; '' is open. */
  dateField: DateField;
  from: string;
  to: string;
}

export const NO_COMMUNITY_FILTERS: CommunityFilters = { community: 'all', communityStatus: 'any', email: 'any', source: 'any', dateField: 'joined', from: '', to: '' };

export function contactSourceOf(contact: CommunityCarrier): ContactSource {
  const path = contact.communitySource;
  if (path === 'discover' || path === 'link' || path === 'website') return path;
  if (contact.source === 'community') return 'community';
  if (contact.source === 'import') return 'import';
  return 'other';
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Midnight UTC of a real calendar day, or NaN (2026-02-31 does not roll into March). */
const dayStart = (day: string) => {
  const at = DAY.test(day) ? Date.parse(`${day}T00:00:00.000Z`) : NaN;
  return !Number.isNaN(at) && new Date(at).toISOString().slice(0, 10) === day ? at : NaN;
};

/** Any filter other than the defaults is set. */
export function communityFiltersActive(filters: CommunityFilters): boolean {
  return filters.community !== 'all' || filters.communityStatus !== 'any' || filters.email !== 'any' ||
    filters.source !== 'any' || Boolean(filters.from) || Boolean(filters.to);
}

const PARAM = { community: 'community', communityStatus: 'communityStatus', email: 'email', source: 'source', dateField: 'dateField', from: 'from', to: 'to' } as const;

/** The filters as query parameters, for the export: only what differs from the defaults. */
export function communityFiltersToParams(filters: CommunityFilters, params = new URLSearchParams()): URLSearchParams {
  for (const key of Object.keys(PARAM) as (keyof CommunityFilters)[]) {
    if (filters[key] !== NO_COMMUNITY_FILTERS[key]) params.set(PARAM[key], filters[key]);
  }
  return params;
}

/** The export's reading of those parameters; null when any is malformed. */
export function readCommunityFilters(params: URLSearchParams): CommunityFilters | null {
  const pick = <T extends string>(key: keyof CommunityFilters, allowed: readonly T[]) => {
    const value = params.get(PARAM[key]);
    return value === null ? NO_COMMUNITY_FILTERS[key] as T : (allowed as readonly string[]).includes(value) ? value as T : null;
  };
  const communityStatus = pick<CommunityStatusFilter>('communityStatus', ['any', 'active', 'left']);
  const email = pick<EmailFilter>('email', ['any', 'subscribed', 'unsubscribed', 'none']);
  const source = pick<SourceFilter>('source', ['any', ...CONTACT_SOURCES]);
  const dateField = pick<DateField>('dateField', ['joined', 'left']);
  const community = params.get(PARAM.community) ?? 'all';
  const from = params.get(PARAM.from) ?? '';
  const to = params.get(PARAM.to) ?? '';
  if (!communityStatus || !email || !source || !dateField) return null;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(community)) return null;
  if ((from && Number.isNaN(dayStart(from))) || (to && Number.isNaN(dayStart(to)))) return null;
  return { community, communityStatus, email, source, dateField, from, to };
}

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
  // #577: one membership must meet both the status and the date range.
  const from = filters.from ? dayStart(filters.from) : -Infinity;
  const to = filters.to ? dayStart(filters.to) + 86_400_000 : Infinity;
  const dated = from !== -Infinity || to !== Infinity;
  const fits = (entry: CommunityEntry) => {
    if (filters.communityStatus !== 'any' && entry.status !== filters.communityStatus) return false;
    if (!dated) return true;
    const at = (filters.dateField === 'left' ? entry.leftAt : entry.joinedAt)?.getTime();
    return at !== undefined && at >= from && at < to;
  };
  if ((filters.communityStatus !== 'any' || dated) && !inScope.some(fits)) return false;
  if (filters.email !== 'any' && emailStatusOf(contact) !== filters.email) return false;
  if (filters.source !== 'any' && contactSourceOf(contact) !== filters.source) return false;
  return true;
}
