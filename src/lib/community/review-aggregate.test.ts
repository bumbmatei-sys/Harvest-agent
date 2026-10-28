import { describe, expect, it } from 'vitest';
import { updateReviewAggregate } from './review-aggregate';

describe('review aggregates', () => {
  it('applies create, edit and delete without counting an edit twice', () => {
    const first = updateReviewAggregate({ ratingSum: 0, ratingCount: 0, ratingAvg: 0 }, null, 5);
    const second = updateReviewAggregate(first, null, 3);
    expect(second).toEqual({ ratingSum: 8, ratingCount: 2, ratingAvg: 4 });
    const edited = updateReviewAggregate(second, 5, 1);
    expect(edited).toEqual({ ratingSum: 4, ratingCount: 2, ratingAvg: 2 });
    expect(updateReviewAggregate(edited, 3, null)).toEqual({ ratingSum: 1, ratingCount: 1, ratingAvg: 1 });
    expect(updateReviewAggregate({ ratingSum: 1, ratingCount: 1, ratingAvg: 1 }, 1, null)).toEqual({ ratingSum: 0, ratingCount: 0, ratingAvg: 0 });
  });
  it('rejects invalid ratings and inconsistent summaries', () => {
    expect(() => updateReviewAggregate({ ratingSum: 0, ratingCount: 0, ratingAvg: 0 }, null, 6)).toThrow();
    expect(() => updateReviewAggregate({ ratingSum: 4, ratingCount: 1, ratingAvg: 5 }, null, 5)).toThrow();
    expect(() => updateReviewAggregate({ ratingSum: 0, ratingCount: 0, ratingAvg: 0 }, 3, null)).toThrow();
  });
});
