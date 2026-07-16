import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { resolveReturnBaseUrl, apexBaseUrl } from '../connect-return-url';

/**
 * The Connect return/refresh URLs are built from the incoming request's host so a
 * user lands back where they started. This is a money path: an attacker-supplied
 * Host / X-Forwarded-Host header must NEVER become an open redirect, so anything
 * off the Harvest allowlist has to fall back to the apex.
 *
 * The helper only reads `request.headers.get(...)`, so we drive it with a minimal
 * header stub. (A real NextRequest can't carry a `host` header in tests — undici
 * treats `host` as a forbidden header and strips it from a constructed request;
 * the actual Vercel runtime populates it normally.)
 */
function makeRequest(headers: Record<string, string>): NextRequest {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    headers: { get: (name: string) => map.get(name.toLowerCase()) ?? null },
  } as unknown as NextRequest;
}

describe('resolveReturnBaseUrl', () => {
  const OLD_ENV = process.env.NEXT_PUBLIC_APP_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://theharvest.app';
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = OLD_ENV;
  });

  it('returns the affiliate host when the affiliate started there', () => {
    // The exact bug: an affiliate on affiliate.theharvest.app must come back here.
    expect(resolveReturnBaseUrl(makeRequest({ host: 'affiliate.theharvest.app' })))
      .toBe('https://affiliate.theharvest.app');
  });

  it('returns the apex when the request came from the apex', () => {
    expect(resolveReturnBaseUrl(makeRequest({ host: 'theharvest.app' })))
      .toBe('https://theharvest.app');
  });

  it('returns a tenant (church-admin) subdomain unchanged', () => {
    expect(resolveReturnBaseUrl(makeRequest({ host: 'nations.theharvest.app' })))
      .toBe('https://nations.theharvest.app');
  });

  it('prefers X-Forwarded-Host (the real external host set by the proxy)', () => {
    expect(
      resolveReturnBaseUrl(
        makeRequest({ host: 'internal.vercel.app', 'x-forwarded-host': 'affiliate.theharvest.app' }),
      ),
    ).toBe('https://affiliate.theharvest.app');
  });

  it('strips a port and lowercases before matching', () => {
    expect(resolveReturnBaseUrl(makeRequest({ host: 'Affiliate.TheHarvest.app:443' })))
      .toBe('https://affiliate.theharvest.app');
  });

  it('takes the first hop of a comma-separated forwarded chain', () => {
    expect(
      resolveReturnBaseUrl(
        makeRequest({ 'x-forwarded-host': 'affiliate.theharvest.app, evil.com' }),
      ),
    ).toBe('https://affiliate.theharvest.app');
  });

  // ── SECURITY: the crux ──────────────────────────────────────────────────────
  it('falls back to the apex for a malicious foreign Host header (no open redirect)', () => {
    expect(resolveReturnBaseUrl(makeRequest({ host: 'evil.com' })))
      .toBe('https://theharvest.app');
  });

  it('falls back to the apex for a spoofed X-Forwarded-Host', () => {
    expect(
      resolveReturnBaseUrl(
        makeRequest({ host: 'affiliate.theharvest.app', 'x-forwarded-host': 'evil.com' }),
      ),
    ).toBe('https://theharvest.app');
  });

  it('rejects look-alike suffix hosts that try to smuggle the apex', () => {
    expect(resolveReturnBaseUrl(makeRequest({ host: 'theharvest.app.evil.com' })))
      .toBe('https://theharvest.app');
    expect(resolveReturnBaseUrl(makeRequest({ host: 'affiliate.theharvest.app.evil.com' })))
      .toBe('https://theharvest.app');
    expect(resolveReturnBaseUrl(makeRequest({ host: 'eviltheharvest.app' })))
      .toBe('https://theharvest.app');
  });

  it('falls back to the apex when no host header is present', () => {
    expect(resolveReturnBaseUrl(makeRequest({}))).toBe('https://theharvest.app');
  });

  it('honours a custom NEXT_PUBLIC_APP_URL as the fallback', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://staging.example.com';
    expect(resolveReturnBaseUrl(makeRequest({ host: 'evil.com' })))
      .toBe('https://staging.example.com');
    expect(apexBaseUrl()).toBe('https://staging.example.com');
  });
});
