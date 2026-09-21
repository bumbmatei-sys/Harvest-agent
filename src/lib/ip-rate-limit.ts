/**
 * The bounded IP rate-limit key, shared by the public submission routes.
 *
 * CONTACT AND ENTERPRISE-LEAD USED TO READ EVERY DOCUMENT AN ADDRESS HAD EVER
 * WRITTEN. `/api/contact` (THE-109) and `/api/enterprise-lead` each ran
 * `.where('ip', '==', ip).get()` with no `.limit()` and filtered the hour window
 * in memory: to answer "have there been 3 in an hour" they read all of them,
 * forever, on public unauthenticated endpoints. The `'unknown'` bucket — shared
 * by every visitor arriving without `x-forwarded-for` — is the one key
 * guaranteed to grow, and it was re-read in full on each new request. Both fail
 * open, so the day that read got slow or expensive they would have stopped
 * limiting rather than complaining.
 *
 * THE FIX IS A RANGE ON ONE FIELD. Storing `${ip}|${createdAt}` puts both halves
 * of the question into a single value, so the window becomes a range scan and
 * `.limit(RATE_LIMIT_MAX)` bounds the read at a constant, forever. An equality
 * on `ip` plus an inequality on `createdAt` would be two fields and so a
 * COMPOSITE INDEX; a range on a single field is served by the automatic
 * single-field index Firestore maintains for every field at no cost.
 *
 * That distinction is load-bearing, not tidiness. `.github/workflows/
 * deploy-rules.yml` deploys `firestore:rules` and storage only — an entry added
 * to `firestore.indexes.json` does NOT ship on merge. A query needing one would
 * reject in production until somebody ran a manual deploy, and both callers fail
 * open, so it would reject QUIETLY: endpoints advertising a rate limit and
 * enforcing nothing.
 *
 * THE BOUND IS EXACT, NOT A HEURISTIC. The only question asked is whether at
 * least `max` keys fall inside the window, so a max+1-th document could not
 * change the answer. Which documents come back does not matter either — which is
 * why no `orderBy` is needed, and why a naive `.limit()` on the old `ip`
 * equality would NOT have worked: with no ordering Firestore returns documents
 * by `__name__`, those ids are random, and four arbitrary submissions out of a
 * lifetime say nothing about the last hour.
 *
 * This module exists so the two ordering invariants below are written down and
 * tested ONCE. They are the kind of thing that looks arbitrary, gets "tidied" in
 * one of two copies, and fails silently — the range still returns *something*,
 * just the wrong something.
 */

/**
 * Separates the address from the timestamp.
 *
 * INVARIANT: '|' (0x7C) sorts ABOVE every character an address can contain —
 * digits (0x30–0x39), '.' (0x2E), ':' (0x3A), lowercase hex (0x61–0x66) and the
 * 'unknown' fallback (all lowercase letters, ≤ 0x7A). That is what keeps one
 * address's range out of another's: for addresses A and B where B starts with A,
 * B's next character is an address character and therefore below '|', so
 * `B|…` sorts BELOW `A|…` and can never land inside A's window.
 */
const SEP = '|';

/**
 * The exclusive upper bound's suffix.
 *
 * INVARIANT: '~' (0x7E) sorts ABOVE every character `Date.toISOString()` emits —
 * digits, '-' (0x2D), 'T' (0x54), ':' (0x3A), '.' (0x2E) and 'Z' (0x5A, the
 * highest). So `${ip}|~` is an exclusive upper bound on every key belonging to
 * this address, and to no other.
 */
const MAX = '~';

/**
 * The value stored on each document, alongside — never instead of — the `ip` and
 * `createdAt` fields it is built from. Both halves stay readable, so the field is
 * still greppable by address.
 *
 * Callers MUST pass the same `createdAt` string they write to the document, so
 * the window is measured against the value the record shows and the two cannot
 * drift.
 */
export function rateLimitKey(ip: string, createdAt: string): string {
  return `${ip}${SEP}${createdAt}`;
}

/**
 * The exclusive bounds of one address's window, for
 * `.where(field, '>', from).where(field, '<', to)`.
 *
 * `from` is exclusive to match the `createdAt > windowStart` comparison this
 * replaced in both routes — the window boundary is unchanged.
 *
 * `createdAt` is a fixed-width ISO-8601 UTC string, so within one address's
 * prefix lexical order IS chronological. That is the property the in-memory
 * comparison relied on; here it is simply moved into the index.
 */
export function rateLimitWindow(ip: string, windowStart: string): { from: string; to: string } {
  return { from: rateLimitKey(ip, windowStart), to: `${ip}${SEP}${MAX}` };
}

/** The ISO-8601 instant `windowMs` ago — the start of the sliding window. */
export function rateLimitWindowStart(windowMs: number, now: number = Date.now()): string {
  return new Date(now - windowMs).toISOString();
}
