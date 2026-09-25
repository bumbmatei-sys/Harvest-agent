/**
 * The CRM list's in-memory filter, shared with the founder CSV export so the
 * two cannot disagree. Type and search behave exactly as AdminCRM did when
 * this predicate lived inline: a `both` row matches the member filter and the
 * donor filter, and it matches a `both` filter only by being `both`.
 */
import { newsletterStatusOf, type NewsletterFilter } from './newsletter-consent';

export const CRM_TYPE_FILTERS = ['all', 'member', 'donor', 'both'] as const;
export type CrmTypeFilter = (typeof CRM_TYPE_FILTERS)[number];

export function isCrmTypeFilter(value: string | null): value is CrmTypeFilter {
  return value === 'all' || value === 'member' || value === 'donor' || value === 'both';
}

export interface CrmFilterable {
  firstName: string;
  lastName: string;
  email: string;
  type: string;
  account?: unknown;
  accountProfile?: { newsletterOptIn?: boolean | null } | null;
}

export interface CrmFilters {
  search: string;
  type: CrmTypeFilter;
  newsletter: NewsletterFilter;
}

export function matchesCrmFilters(contact: CrmFilterable, filters: CrmFilters): boolean {
  const filter = filters.type;
  const matchType = filter === 'all' || contact.type === filter || (filter !== 'both' && contact.type === 'both');
  const fullName = `${contact.firstName} ${contact.lastName}`.toLowerCase();
  const search = filters.search;
  const matchSearch = !search ||
    fullName.includes(search.toLowerCase()) ||
    (contact.email || '').toLowerCase().includes(search.toLowerCase());
  const matchNewsletter = filters.newsletter === 'all'
    || newsletterStatusOf(contact) === filters.newsletter;
  return matchType && matchSearch && matchNewsletter;
}
