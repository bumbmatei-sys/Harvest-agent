import { describe, expect, it } from 'vitest';
import { readPublicListing } from './public-listing';

const listing = { tenantId: 'one', slug: 'grace', name: 'Grace', logoUrl: '', shortDescription: '', memberCount: 2 };
describe('public listing ratings', () => {
  it('projects ratings and accepts older listings without them', () => {
    expect(readPublicListing(listing)).toMatchObject({ ratingCount: 0, ratingAvg: 0 });
    expect(readPublicListing({ ...listing, ratingCount: 2, ratingAvg: 4.5, ratingSum: 9 })).toMatchObject({ ratingCount: 2, ratingAvg: 4.5 });
    expect(readPublicListing({ ...listing, ratingCount: 2, ratingAvg: 4.5, ratingSum: 9 })).not.toHaveProperty('ratingSum');
  });
  it.each([{ ratingCount: 1 }, { ratingCount: 0, ratingAvg: 5 }, { ratingCount: 1, ratingAvg: 6 }, { ratingCount: -1, ratingAvg: 0 }])('rejects malformed rating %o', rating => {
    expect(() => readPublicListing({ ...listing, ...rating })).toThrow();
  });
});
