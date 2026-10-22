import type { CoursePrice } from '@/types/course-product.types';
import { sanitizeHtml } from '@/utils/sanitize';

export const DEFAULT_INCLUDED: readonly string[] = [
  'Read or watch online any time, on web and phone',
  'A checkmark on every lesson you finish',
  'Pick up exactly where you left off',
  'Updates from your teacher, automatically',
];

export const PAID_COMING_LATER = 'Paid checkout is coming later. You can set a price now; nobody can be charged yet.';

export function priceHeadline(price: CoursePrice | undefined): { amount: string; note: string } {
  if (!price || price.mode === 'free' || !price.amountUsd) return { amount: 'Free', note: 'No payment required' };
  const amount = `$${Number.isInteger(price.amountUsd) ? price.amountUsd : price.amountUsd.toFixed(2)}`;
  return { amount, note: price.mode === 'membership' ? 'Per month' : 'One-time purchase' };
}

/**
 * A description is plain text from the Page step, or HTML from a course written
 * before it. Plain text is returned as paragraphs; HTML is sanitised.
 */
export function descriptionBlocks(description: string | undefined): { html: string } | { paragraphs: string[] } | null {
  const text = (description ?? '').trim();
  if (!text) return null;
  if (/<[a-z][\s\S]*>/i.test(text)) return { html: sanitizeHtml(text) };
  return { paragraphs: text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) };
}
