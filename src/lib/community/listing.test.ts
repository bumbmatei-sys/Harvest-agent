import { describe, expect, it } from 'vitest';
import { makeDiscoveryListing } from './listing';
import { defaultCommunitySettings } from './settings';

describe('public listing projection', () => {
  it('includes only public fields and defaults to the ministry logo', () => {
    const settings = { ...defaultCommunitySettings(), shortDescription: ' Hello ' };
    const date = new Date('2020-01-01');
    expect(makeDiscoveryListing('id', { name: 'Ministry', subdomain: 'ministry', config: { logo: 'https://example.com/logo', email: 'private' }, ownerId: 'private' }, settings, 3, date)).toEqual({
      tenantId: 'id', slug: 'ministry', name: 'Ministry', logoUrl: 'https://example.com/logo', shortDescription: 'Hello', memberCount: 3, updatedAt: date,
    });
  });
  it('rejects unsafe slugs and logo URLs', () => {
    const settings = { ...defaultCommunitySettings(), logoUrl: 'javascript:alert(1)' };
    expect(() => makeDiscoveryListing('id', { name: 'Ministry', subdomain: 'ministry' }, settings, 1, new Date())).toThrow();
    expect(() => makeDiscoveryListing('id', { name: 'Ministry', subdomain: 'www' }, defaultCommunitySettings(), 1, new Date())).toThrow();
  });
});
