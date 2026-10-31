import { describe, expect, it } from 'vitest';
import { communityFiltersActive, communityFiltersToParams, communityOptions, contactCommunities, contactSourceOf, emailStatusOf, matchesCommunityFilters, NO_COMMUNITY_FILTERS, readCommunityFilters, type CommunityFilters } from './crm-communities';

const ana = {
  source: 'community', emailStatus: 'subscribed',
  communities: {
    default: { name: 'Grace Chapel', status: 'active', joinedAt: new Date(1000), leftAt: null },
    youth: { name: 'Youth', status: 'left', joinedAt: new Date(1000), leftAt: new Date(2000) },
  },
};
// Written before the map existed: only the flat default-community fields.
const legacy = { source: 'community', communityStatus: 'left', communityJoinedAt: new Date(1000), communityLeftAt: new Date(3000), emailStatus: 'unsubscribed' };
const donor = { source: 'manual' };

describe('one CRM across every community', () => {
  it('lists every community on a contact, the default first, and reads legacy rows as the default', () => {
    expect(contactCommunities(ana).map(c => [c.id, c.name, c.status])).toEqual([['default', 'Grace Chapel', 'active'], ['youth', 'Youth', 'left']]);
    expect(contactCommunities(legacy, 'Grace Chapel')).toMatchObject([{ id: 'default', name: 'Grace Chapel', status: 'left' }]);
    expect(contactCommunities(donor)).toEqual([]);
    expect(contactCommunities({ communities: { bad: { status: 'pending' }, nope: 7 } })).toEqual([]);
  });

  it('offers each community once in the dropdown', () => {
    expect(communityOptions([ana, legacy, donor], 'Grace Chapel')).toEqual([{ id: 'default', name: 'Grace Chapel' }, { id: 'youth', name: 'Youth' }]);
  });

  it('filters by community, by status in that community, and by email, combined', () => {
    const match = (filters: Partial<typeof NO_COMMUNITY_FILTERS>) =>
      [ana, legacy, donor].filter(c => matchesCommunityFilters(c, { ...NO_COMMUNITY_FILTERS, ...filters })).length;
    expect(match({})).toBe(3);
    expect(match({ community: 'youth' })).toBe(1);
    expect(match({ community: 'none' })).toBe(1);
    expect(match({ community: 'default', communityStatus: 'left' })).toBe(1); // only the legacy row left the default
    expect(match({ community: 'youth', communityStatus: 'active' })).toBe(0);
    // "Everyone who left Youth but is still on the newsletter."
    expect(match({ community: 'youth', communityStatus: 'left', email: 'subscribed' })).toBe(1);
    expect(match({ communityStatus: 'left' })).toBe(2);
    expect(match({ email: 'none' })).toBe(1);
  });

  it('reads bounces and complaints as unsubscribed, and anything unknown as not subscribed', () => {
    expect(emailStatusOf({ emailStatus: 'bounced' })).toBe('unsubscribed');
    expect(emailStatusOf({ emailStatus: 'complained' })).toBe('unsubscribed');
    expect(emailStatusOf({ emailStatus: 'weird' })).toBe('none');
    expect(emailStatusOf({})).toBe('none');
  });
});

// #577 (PRD §6.4): how a contact arrived, and when they joined or left.
describe('source and date filters', () => {
  const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
  const viaDiscover = { source: 'community', communitySource: 'discover', communities: {
    default: { name: 'Grace', status: 'active', joinedAt: day('2026-01-10'), leftAt: null },
    youth: { name: 'Youth', status: 'left', joinedAt: day('2026-02-01'), leftAt: day('2026-03-15') },
  } };
  const viaLink = { source: 'community', communitySource: 'link', communities: { default: { name: 'Grace', status: 'active', joinedAt: day('2026-03-31'), leftAt: null } } };
  const imported = { source: 'import' };
  const spaceOnly = { source: 'community', communities: { youth: { name: 'Youth', status: 'active', joinedAt: day('2026-04-01'), leftAt: null } } };
  const people = { viaDiscover, viaLink, imported, spaceOnly, donor };
  const match = (filters: Partial<CommunityFilters>) =>
    Object.entries(people).filter(([, c]) => matchesCommunityFilters(c, { ...NO_COMMUNITY_FILTERS, ...filters })).map(([name]) => name);

  it('names how each contact arrived', () => {
    expect(Object.values(people).map(contactSourceOf)).toEqual(['discover', 'link', 'import', 'community', 'other']);
    expect(contactSourceOf({ source: 'community', communitySource: 'nonsense' })).toBe('community');
  });

  it('filters by source', () => {
    expect(match({ source: 'discover' })).toEqual(['viaDiscover']);
    expect(match({ source: 'import' })).toEqual(['imported']);
    expect(match({ source: 'other' })).toEqual(['donor']);
  });

  it('filters by joined or left date, inclusive of both days, and needs one membership to fit status and date', () => {
    expect(match({ from: '2026-03-01' })).toEqual(['viaLink', 'spaceOnly']);
    expect(match({ to: '2026-03-31' })).toEqual(['viaDiscover', 'viaLink']);
    expect(match({ from: '2026-03-31', to: '2026-03-31' })).toEqual(['viaLink']);
    expect(match({ dateField: 'left', from: '2026-03-01', to: '2026-03-31' })).toEqual(['viaDiscover']);
    expect(match({ community: 'default', dateField: 'left', from: '2026-03-01' })).toEqual([]);
    // Joined Youth in February, and left it: both on the same membership.
    expect(match({ communityStatus: 'left', from: '2026-02-01', to: '2026-02-28' })).toEqual(['viaDiscover']);
    // The default membership joined in January is active, not left.
    expect(match({ communityStatus: 'left', to: '2026-01-31' })).toEqual([]);
    // Midnight UTC belongs to the day it starts, not the one before.
    const midnight = { source: 'community', communities: { default: { name: 'Grace', status: 'active', joinedAt: new Date('2026-05-01T00:00:00.000Z'), leftAt: null } } };
    expect(matchesCommunityFilters(midnight, { ...NO_COMMUNITY_FILTERS, from: '2026-05-01', to: '2026-05-01' })).toBe(true);
    expect(matchesCommunityFilters(midnight, { ...NO_COMMUNITY_FILTERS, to: '2026-04-30' })).toBe(false);
  });

  it('round-trips through query parameters, sending only what is set, and refuses malformed ones', () => {
    expect(communityFiltersToParams(NO_COMMUNITY_FILTERS).toString()).toBe('');
    const set: CommunityFilters = { community: 'youth', communityStatus: 'left', email: 'subscribed', source: 'discover', dateField: 'left', from: '2026-01-01', to: '2026-02-28' };
    expect(readCommunityFilters(communityFiltersToParams(set))).toEqual(set);
    expect(readCommunityFilters(new URLSearchParams('newsletter=all&type=all'))).toEqual(NO_COMMUNITY_FILTERS);
    for (const bad of ['source=web', 'communityStatus=gone', 'email=yes', 'dateField=born', 'from=2026-02-31', 'to=31/01/2026', 'community=a/b', 'community=']) {
      expect(readCommunityFilters(new URLSearchParams(bad)), bad).toBeNull();
    }
    expect(communityFiltersActive(NO_COMMUNITY_FILTERS)).toBe(false);
    for (const change of [{ source: 'import' }, { from: '2026-01-01' }, { to: '2026-01-01' }, { email: 'none' }] as Partial<CommunityFilters>[]) {
      expect(communityFiltersActive({ ...NO_COMMUNITY_FILTERS, ...change })).toBe(true);
    }
  });
});
