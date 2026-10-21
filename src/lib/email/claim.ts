import { createHash } from 'node:crypto';

import { decideSend } from '@/lib/email/volume-cap';

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * A fingerprint of what a broadcast would send: the parts a person edits. It is
 * compared inside the same transaction that claims or schedules the broadcast, so
 * an edit that lands between "read it" and "send it" is noticed whatever the clock
 * says. Key order does not matter, so a document read back from storage matches.
 */
export function contentHash(b: {
  readonly subject: string;
  readonly subjectB: string | null;
  readonly preheader: string;
  readonly bodyHtml: string;
  readonly design: unknown;
  readonly filters: unknown;
}): string {
  return createHash('sha256')
    .update(stable({ subject: b.subject, subjectB: b.subjectB, preheader: b.preheader, bodyHtml: b.bodyHtml, design: b.design, filters: b.filters }))
    .digest('hex');
}

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
  /** `contentHash` of the broadcast as the caller read and previewed it. An edit that landed since makes the claim refuse. */
  readonly expectedContentHash: string;
}

export type ClaimDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'not_found' | 'not_claimable' | 'changed' }
  | { readonly ok: false; readonly code: 'volume_cap' | 'daily_cap'; readonly remaining: number; readonly cap: number };

export function decideClaim(
  currentStatus: string | null,
  currentContentHash: string | null,
  usedMonth: number,
  usedToday: number,
  req: ClaimRequest,
): ClaimDecision {
  if (currentStatus === null) return { ok: false, code: 'not_found' };
  if (!req.from.includes(currentStatus)) return { ok: false, code: 'not_claimable' };
  if (currentContentHash !== req.expectedContentHash) return { ok: false, code: 'changed' };
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
