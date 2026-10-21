import { isoTimestamp } from '@/lib/crm-merge';
import type { EmailLimits } from '@/lib/email/limits';

/** Calendar month (UTC): the key the monthly allowance resets on. */
export function monthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Calendar day (UTC): the key the new-ministry daily cap counts on. */
export function dayKey(now: Date): string {
  return `${monthKey(now)}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

/** First instant of next month (UTC), when the allowance resets. */
export function nextMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/**
 * Is this ministry inside its new-ministry window? A creation date that cannot
 * be read counts as NEW: the cap fails closed rather than lifting itself for a
 * tenant nobody can date.
 */
export function isNewChurch(createdAt: unknown, now: Date, days: number): boolean {
  const iso = isoTimestamp(createdAt);
  if (!iso) return true;
  return now.getTime() - Date.parse(iso) < days * 24 * 60 * 60 * 1000;
}

export type SendDecision =
  | { readonly ok: true; readonly remaining: number }
  | { readonly ok: false; readonly code: 'volume_cap' | 'daily_cap'; readonly remaining: number; readonly cap: number };

/**
 * Whether `requested` emails may go out now. The monthly allowance is checked
 * first; the new-ministry daily cap is a second, independent limit.
 */
export function decideSend(input: {
  readonly allowance: number;
  readonly usedMonth: number;
  readonly usedToday: number;
  readonly requested: number;
  readonly newChurch: boolean;
  readonly dailyCap: number;
}): SendDecision {
  const monthLeft = Math.max(0, input.allowance - input.usedMonth);
  if (input.requested > monthLeft) return { ok: false, code: 'volume_cap', remaining: monthLeft, cap: input.allowance };
  if (input.newChurch) {
    const dayLeft = Math.max(0, input.dailyCap - input.usedToday);
    if (input.requested > dayLeft) return { ok: false, code: 'daily_cap', remaining: dayLeft, cap: input.dailyCap };
  }
  return { ok: true, remaining: monthLeft - input.requested };
}

export interface Health { readonly sent: number; readonly bounced: number; readonly complained: number }

export type PauseDecision = { readonly reason: 'bounce' | 'complaint'; readonly rate: number; readonly threshold: number } | null;

/** Pause when a rate passes its threshold, but only on a sample big enough to mean something. */
export function decidePause(health: Health, limits: EmailLimits['autoPause']): PauseDecision {
  if (health.sent < limits.minSent) return null;
  const complaint = health.complained / health.sent;
  if (complaint > limits.complaintRate) return { reason: 'complaint', rate: complaint, threshold: limits.complaintRate };
  const bounce = health.bounced / health.sent;
  if (bounce > limits.bounceRate) return { reason: 'bounce', rate: bounce, threshold: limits.bounceRate };
  return null;
}

export function percentUsed(used: number, allowance: number): number {
  return allowance > 0 ? Math.min(100, Math.round((used / allowance) * 100)) : 0;
}
