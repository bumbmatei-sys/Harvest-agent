/** A server-maintained summary. A missing summary is valid only before the first review. */
export type ReviewAggregate = { ratingSum: number; ratingCount: number; ratingAvg: number };

export function updateReviewAggregate(current: ReviewAggregate, previous: number | null, next: number | null): ReviewAggregate {
  const validRating = (rating: number | null) => rating === null || (Number.isInteger(rating) && rating >= 1 && rating <= 5);
  const { ratingSum, ratingCount, ratingAvg } = current;
  if (!validRating(previous) || !validRating(next) || !Number.isSafeInteger(ratingSum) || !Number.isSafeInteger(ratingCount) ||
      ratingCount < 0 || ratingSum < ratingCount || ratingSum > ratingCount * 5 ||
      !Number.isFinite(ratingAvg) || ratingAvg !== (ratingCount ? ratingSum / ratingCount : 0) ||
      (previous !== null && ratingCount === 0)) throw new Error('Invalid review aggregate');
  const sum = ratingSum - (previous ?? 0) + (next ?? 0);
  const count = ratingCount - (previous === null ? 0 : 1) + (next === null ? 0 : 1);
  if (count < 0 || sum < count || sum > count * 5) throw new Error('Invalid review aggregate');
  return { ratingSum: sum, ratingCount: count, ratingAvg: count ? sum / count : 0 };
}
