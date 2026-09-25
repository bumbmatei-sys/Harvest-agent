import { describe, it, expect } from 'vitest';
import { matchesCrmFilters, type CrmFilterable, type CrmFilters } from '../crm-filter';

/**
 * The predicate the CRM list and the CSV export both use. Type and search
 * stay exactly as they were when this lived inline in AdminCRM: a `both` row
 * matches member and donor, and a `both` filter matches only `both`.
 */

const row = (over: Partial<CrmFilterable> & Record<string, unknown> = {}): CrmFilterable & { newsletter?: boolean; newsletterOptIn?: boolean } => ({
  firstName: 'A',
  lastName: 'Person',
  email: 'a@example.com',
  type: 'member',
  ...over,
});

const account = { role: 'user', email: 'a@example.com' };
const profile = (opt: boolean | null) => ({ newsletterOptIn: opt });

const ada = row({
  firstName: 'Ada', lastName: 'In', email: 'ada@example.com', type: 'member',
  account: { role: 'user', email: 'ada@example.com' },
  accountProfile: profile(true),
});
const bob = row({
  firstName: 'Bob', lastName: 'Out', email: 'bob@example.com', type: 'member',
  account: { role: 'admin', email: 'bob@example.com' },
  accountProfile: profile(false),
});
// Legacy `newsletter: true` and a stray contacts-doc `newsletterOptIn` are not consent.
const cara = row({
  firstName: 'Cara', lastName: 'Unknown', email: 'cara@example.com', type: 'member',
  account,
  accountProfile: profile(null),
  newsletter: true,
  newsletterOptIn: true,
});
const legacyOut = row({
  firstName: 'Lee', lastName: 'Legacy', email: 'lee@example.com', type: 'member',
  account: { role: 'user', email: 'lee@example.com' },
  newsletter: false,
});
const dan = row({
  firstName: 'Dan', lastName: 'Donor', email: 'dan@example.com', type: 'donor',
  newsletterOptIn: true,
});
const eve = row({
  firstName: 'Eve', lastName: 'Both', email: 'eve@example.com', type: 'both',
  account: { role: 'user', email: 'eve@example.com' },
  accountProfile: profile(true),
});

const people = [ada, bob, cara, legacyOut, dan, eve];
const ids = (filters: CrmFilters) =>
  people.filter(p => matchesCrmFilters(p, filters)).map(p => p.firstName);

describe('matchesCrmFilters', () => {
  it('keeps every row under All, including donor-only and Unknown', () => {
    expect(ids({ search: '', type: 'all', newsletter: 'all' })).toEqual([
      'Ada', 'Bob', 'Cara', 'Lee', 'Dan', 'Eve',
    ]);
  });

  it.each([
    ['in', ['Ada', 'Eve']],
    ['out', ['Bob']],
    ['unknown', ['Cara', 'Lee']],
  ] as const)('newsletter %s ignores the legacy field and drops donor-only rows', (newsletter, names) => {
    expect(ids({ search: '', type: 'all', newsletter })).toEqual(names);
  });

  it('a both row matches the member filter and the donor filter', () => {
    expect(matchesCrmFilters(eve, { search: '', type: 'member', newsletter: 'all' })).toBe(true);
    expect(matchesCrmFilters(eve, { search: '', type: 'donor', newsletter: 'all' })).toBe(true);
    expect(matchesCrmFilters(ada, { search: '', type: 'donor', newsletter: 'all' })).toBe(false);
    expect(matchesCrmFilters(dan, { search: '', type: 'member', newsletter: 'all' })).toBe(false);
  });

  it('a both filter matches only type both', () => {
    expect(matchesCrmFilters(eve, { search: '', type: 'both', newsletter: 'all' })).toBe(true);
    expect(matchesCrmFilters(ada, { search: '', type: 'both', newsletter: 'all' })).toBe(false);
    expect(matchesCrmFilters(dan, { search: '', type: 'both', newsletter: 'all' })).toBe(false);
  });

  it('ANDs newsletter with type and search', () => {
    expect(ids({ search: 'ada', type: 'member', newsletter: 'in' })).toEqual(['Ada']);
    expect(ids({ search: 'ada', type: 'member', newsletter: 'out' })).toEqual([]);
    expect(ids({ search: 'eve', type: 'donor', newsletter: 'in' })).toEqual(['Eve']);
    expect(ids({ search: 'eve', type: 'member', newsletter: 'out' })).toEqual([]);
    expect(ids({ search: 'dan', type: 'donor', newsletter: 'in' })).toEqual([]);
    expect(ids({ search: 'dan', type: 'all', newsletter: 'all' })).toEqual(['Dan']);
    expect(ids({ search: 'BOB', type: 'all', newsletter: 'out' })).toEqual(['Bob']);
    expect(ids({ search: 'cara@example.com', type: 'all', newsletter: 'unknown' })).toEqual(['Cara']);
    expect(ids({ search: 'nobody', type: 'all', newsletter: 'all' })).toEqual([]);
  });

  it('matches email as well as name, case-insensitively, and a blank search matches', () => {
    expect(matchesCrmFilters(ada, { search: 'ADA@EXAMPLE', type: 'all', newsletter: 'all' })).toBe(true);
    expect(matchesCrmFilters(ada, { search: '', type: 'all', newsletter: 'in' })).toBe(true);
  });
});
