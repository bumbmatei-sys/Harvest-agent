import { describe, expect, it } from 'vitest';
import { communityOptions, contactCommunities, emailStatusOf, matchesCommunityFilters, NO_COMMUNITY_FILTERS } from './crm-communities';

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
