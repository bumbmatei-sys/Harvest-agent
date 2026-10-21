import { decideSend } from '@/lib/email/volume-cap';

/**
 * The one place that decides whether a send may start. Both stores run it
 * INSIDE their transaction, so "is this broadcast still unsent" and "is there
 * allowance left" are answered from the same snapshot that is then written.
 */

export interface ClaimRequest {
  readonly tenantId: string;
  readonly broadcastId: string;
  /** Statuses a broadcast may be claimed from: a confirm takes draft or scheduled, the cron only scheduled. */
  readonly from: readonly string[];
  readonly sendId: string;
  readonly nowIso: string;
  readonly requested: number;
  readonly allowance: number;
  /** The new-ministry daily cap, or null for an established ministry. */
  readonly dailyCap: number | null;
  readonly month: string;
  readonly day: string;
}

export type ClaimDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'not_found' | 'not_claimable' }
  | { readonly ok: false; readonly code: 'volume_cap' | 'daily_cap'; readonly remaining: number; readonly cap: number };

export function decideClaim(
  currentStatus: string | null,
  usedMonth: number,
  usedToday: number,
  req: ClaimRequest,
): ClaimDecision {
  if (currentStatus === null) return { ok: false, code: 'not_found' };
  if (!req.from.includes(currentStatus)) return { ok: false, code: 'not_claimable' };
  const decision = decideSend({
    allowance: req.allowance,
    usedMonth,
    usedToday,
    requested: req.requested,
    newChurch: req.dailyCap !== null,
    dailyCap: req.dailyCap ?? 0,
  });
  if (!decision.ok) return decision;
  return { ok: true };
}

export type ClaimResult =
  | { readonly ok: true }
  | Extract<ClaimDecision, { ok: false }>;

/** What a settled send puts back: the reserved emails that did not go out. */
export interface Settlement {
  readonly month: string;
  readonly day: string;
  readonly refund: number;
}

export function sendingMarkerId(tenantId: string, broadcastId: string): string {
  return `${tenantId}__${broadcastId}`;
}
