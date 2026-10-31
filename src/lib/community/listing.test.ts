import { describe, expect, it } from 'vitest';
import { communityListingId, makeCommunitySpaceListing, makeDiscoveryListing } from './listing';
import { newCommunityDraft } from './communities';
import { readPublicListing } from './public-listing';
import { defaultCommunitySettings } from './settings';

describe('public listing projection', () => {
  it('includes only public fields and defaults to the ministry logo', () => {
    const settings = { ...defaultCommunitySettings(), shortDescription: ' Hello ' };
    const date = new Date('2020-01-01');
    expect(makeDiscoveryListing('id', { name: 'Ministry', subdomain: 'ministry', config: { logo: 'https://example.com/logo', email: 'private' }, ownerId: 'private' }, settings, 3, date)).toEqual({
      tenantId: 'id', slug: 'ministry', name: 'Ministry', logoUrl: 'https://example.com/logo', brandColor: '#C9963A', shortDescription: 'Hello', coverUrl: '', galleryUrls: [], longDescription: '', ownerName: '', isPublic: false, memberCount: 3, updatedAt: date,
    });
  });
  it('projects only the public About fields on read', () => {
    const listing = makeDiscoveryListing('id', { name: 'Ministry', subdomain: 'ministry', secret: 'private' }, { ...defaultCommunitySettings(), isPublic: true, ownerName: 'Alex', longDescription: 'Hello\nworld', coverUrl: 'https://cdn.example/image', galleryUrls: ['https://cdn.example/other'] }, 2, new Date());
    expect(readPublicListing({ ...listing, secret: 'private' })).toEqual(expect.objectContaining({ ownerName: 'Alex', longDescription: 'Hello\nworld', galleryUrls: ['https://cdn.example/other'] }));
    expect(readPublicListing({ ...listing, secret: 'private' })).not.toHaveProperty('secret');
  });
  it('rejects unsafe slugs and logo URLs', () => {
    const settings = { ...defaultCommunitySettings(), logoUrl: 'javascript:alert(1)' };
    expect(() => makeDiscoveryListing('id', { name: 'Ministry', subdomain: 'ministry' }, settings, 1, new Date())).toThrow();
    expect(() => makeDiscoveryListing('id', { name: 'Ministry', subdomain: 'www' }, defaultCommunitySettings(), 1, new Date())).toThrow();
  });
});

// #576: the listing of a community other than the default one.
describe('community space listing', () => {
  const record = { id: 'youth', ...newCommunityDraft('Youth'), tagline: ' Teens ', about: 'Fridays', visibility: 'public' as const, status: 'published' as const, isDefault: false };
  it('projects only what the public page shows, and Discover can read it back', () => {
    const date = new Date('2020-01-01');
    const listing = makeCommunitySpaceListing('grace', { name: 'Grace Chapel', ownerId: 'private', config: { email: 'private' } }, record, 4, date);
    expect(listing).toEqual({
      tenantId: 'grace', communityId: 'youth', slug: 'youth', name: 'Youth', logoUrl: '', shortDescription: 'Teens', longDescription: 'Fridays',
      ownerName: 'Grace Chapel', isPublic: true, coverUrl: '', galleryUrls: [], memberCount: 4, ratingCount: 0, ratingAvg: 0, updatedAt: date,
    });
    expect(readPublicListing(listing)).toMatchObject({ communityId: 'youth', memberCount: 4 });
    expect(communityListingId('grace', 'youth')).toBe('grace__youth');
  });
  it('refuses to write a listing Discover would refuse', () => {
    expect(() => makeCommunitySpaceListing('grace', {}, { ...record, iconUrl: 'http://insecure.test/icon.png' }, 1, new Date())).toThrow();
    expect(() => makeCommunitySpaceListing('grace', {}, record, -1, new Date())).toThrow();
    expect(() => makeCommunitySpaceListing('grace', {}, { ...record, id: 'default', isDefault: true }, 1, new Date())).toThrow();
  });
});
