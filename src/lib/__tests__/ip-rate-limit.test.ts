import { describe, it, expect } from 'vitest';
import { rateLimitKey, rateLimitWindow, rateLimitWindowStart } from '@/lib/ip-rate-limit';

/**
 * The ordering invariants behind the bounded rate-limit read.
 *
 * `/api/contact` (THE-109) and `/api/enterprise-lead` both replaced an UNBOUNDED
 * `.where('ip','==',ip).get()` — every document an address had ever written,
 * read to answer a question about the last hour — with a RANGE on one field
 * plus `.limit(RATE_LIMIT_MAX)`. That range is only correct because of two
 * character-ordering facts, and those facts are the kind of thing that looks
 * arbitrary, gets "tidied", and then fails SILENTLY: the range still returns
 * something, just the wrong something, and both callers fail open.
 *
 * 🔴 So they are asserted directly here, not merely implied by the route
 * suites. Each of the two separator/sentinel choices has a test that fails by
 * name if it is changed to a character that breaks the ordering.
 */

const HOUR_MS = 60 * 60 * 1000;

/** Is `key` inside the half-open range the routes query with `>` and `<`? */
function inWindow(key: string, ip: string, windowStart: string): boolean {
  const { from, to } = rateLimitWindow(ip, windowStart);
  return key > from && key < to;
}

describe('rateLimitKey / rateLimitWindow — the window', () => {
  const IP = '203.0.113.5';
  const NOW = Date.parse('2026-09-01T12:00:00.000Z');
  const windowStart = rateLimitWindowStart(HOUR_MS, NOW);

  it('the window start is exactly one window before now', () => {
    expect(windowStart).toBe('2026-09-01T11:00:00.000Z');
  });

  it('a submission inside the window falls inside the range', () => {
    const key = rateLimitKey(IP, new Date(NOW - 60_000).toISOString());
    expect(inWindow(key, IP, windowStart)).toBe(true);
  });

  it('a submission older than the window falls outside it', () => {
    const key = rateLimitKey(IP, new Date(NOW - HOUR_MS - 1000).toISOString());
    expect(inWindow(key, IP, windowStart)).toBe(false);
  });

  it('the boundary is exclusive, matching the `createdAt > windowStart` it replaced', () => {
    // Exactly at the window start: the old in-memory comparison was `>`, so this
    // did not count. It still does not.
    expect(inWindow(rateLimitKey(IP, windowStart), IP, windowStart)).toBe(false);
    expect(inWindow(rateLimitKey(IP, new Date(NOW - HOUR_MS + 1).toISOString()), IP, windowStart)).toBe(true);
  });

  it('within one address, lexical order is chronological order', () => {
    // The property the in-memory `>` comparison relied on, now load-bearing for
    // the index scan. ISO-8601 UTC is fixed-width, so this holds by construction.
    const times = [0, 1, 1000, 60_000, HOUR_MS, 24 * HOUR_MS, 400 * 24 * HOUR_MS];
    const keys = times.map((t) => rateLimitKey(IP, new Date(NOW - HOUR_MS + t).toISOString()));
    expect([...keys].sort()).toEqual(keys);
  });

  it('a document written now is always inside its own window', () => {
    // The self-consistency the limiter depends on: whatever a route writes, its
    // very next read must be able to see it.
    for (const ip of ['203.0.113.5', 'unknown', '2001:db8::ff00:42:8329', '198.51.100.7']) {
      const createdAt = new Date(NOW).toISOString();
      expect(inWindow(rateLimitKey(ip, createdAt), ip, rateLimitWindowStart(HOUR_MS, NOW))).toBe(true);
    }
  });
});

describe('rateLimitWindow — one address never reaches into another', () => {
  const NOW = Date.parse('2026-09-01T12:00:00.000Z');
  const windowStart = rateLimitWindowStart(HOUR_MS, NOW);
  const createdAt = new Date(NOW - 60_000).toISOString();

  /**
   * 🔴 THE PREFIX CASE IS THE ONE THAT WOULD BITE. If the separator sorted BELOW
   * a character an address can contain, `1.2.3.4|…` would land inside the range
   * built for `1.2.3` — one visitor's submissions counting against another's,
   * or an attacker choosing an address that borrows someone else's quota.
   */
  const NEIGHBOURS: Array<[string, string]> = [
    ['1.2.3', '1.2.3.4'],
    ['1.2.3.4', '1.2.3'],
    ['10.0.0.1', '10.0.0.10'],
    ['203.0.113.5', '203.0.113.50'],
    ['unknown', 'unknown.example'],
    ['2001:db8::1', '2001:db8::10'],
  ];

  it.each(NEIGHBOURS)('%s does not count %s toward its limit', (mine, theirs) => {
    expect(inWindow(rateLimitKey(theirs, createdAt), mine, windowStart)).toBe(false);
    // ...and it still sees its own.
    expect(inWindow(rateLimitKey(mine, createdAt), mine, windowStart)).toBe(true);
  });

  it('every character an address can contain sorts below the separator', () => {
    // Digits, dots, colons and lowercase hex (IPv4, IPv6), plus the letters of
    // the 'unknown' fallback. This is the invariant the prefix case rests on.
    const addressChars = '0123456789.:abcdefghijklmnopqrstuvwxyz';
    const { from } = rateLimitWindow('', '');
    const separator = from; // rateLimitWindow('', '') is exactly the separator
    for (const ch of addressChars) {
      expect(ch < separator).toBe(true);
    }
  });
});

describe('rateLimitWindow — the upper sentinel', () => {
  const IP = '203.0.113.5';

  it('sorts above every character an ISO-8601 timestamp can contain', () => {
    // Sampled across a wide span so every field (year, month, day, hour, the
    // 'T', the '.', the trailing 'Z') is exercised, not just today's shape.
    const chars = new Set<string>();
    for (const t of [0, 1, 1e9, 1.7e12, 1.9e12, 4e12]) {
      for (const ch of new Date(t).toISOString()) chars.add(ch);
    }
    expect(chars.size).toBeGreaterThan(5);

    const { to } = rateLimitWindow(IP, '');
    const sentinel = to.slice(IP.length + 1);
    for (const ch of chars) {
      expect(ch < sentinel).toBe(true);
    }
  });

  it('bounds a timestamp far in the future', () => {
    // The bound must not quietly start excluding real documents as time passes.
    const { to } = rateLimitWindow(IP, '');
    expect(rateLimitKey(IP, new Date(4e12).toISOString()) < to).toBe(true);
  });
});
