import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { captureHandledError } from '@/lib/money-path-sentry';
import { rateLimitKey, rateLimitWindow, rateLimitWindowStart } from '@/lib/ip-rate-limit';

export const dynamic = 'force-dynamic';

// The public marketing site (https://theharvest.site) posts to this route
// cross-origin. Mirror the CORS approach already used by /api/plans and
// /api/stripe/standalone-checkout: a single explicit origin (never '*'), plus an
// OPTIONS preflight handler. Every response below carries these headers.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://theharvest.site',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// IP-based rate limit: max 3 submissions per hour.
//
// THE-109 — THE READ IS BOUNDED AT `RATE_LIMIT_MAX` DOCUMENTS, FOREVER.
//
// This was `.where('ip', '==', ip).get()` with the time window applied in memory:
// every document that IP had EVER submitted was read on every request, to answer
// a question about the last hour. The `'unknown'` bucket — shared by every
// visitor arriving without `x-forwarded-for` — is the one key guaranteed to grow
// without bound, and it was re-read in full on each new one.
//
// The window now lives IN the query, and still needs no composite index, because
// one field carries both halves: `rateLimitKey` = `${ip}|${createdAt}`. The key
// construction, the ordering invariants that make the range safe, and why a
// composite index was the wrong trade all live in @/lib/ip-rate-limit — written
// down once because /api/enterprise-lead carries the same limiter.
//
// Only documents written by THIS route carry a top-level `ip` — or a
// `rateLimitKey` — so authenticated ContactModal submissions living in the same
// platform_inbox collection never match. The range makes that property stronger
// than the old equality did: a document without the field has no entry in the
// index the scan walks, so it cannot match at all.
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

async function checkRateLimit(ip: string): Promise<boolean> {
  try {
    const { from, to } = rateLimitWindow(ip, rateLimitWindowStart(RATE_LIMIT_WINDOW_MS));
    const snap = await adminDb
      .collection('platform_inbox')
      .where('rateLimitKey', '>', from)
      .where('rateLimitKey', '<', to)
      .limit(RATE_LIMIT_MAX)
      .get();
    return snap.size < RATE_LIMIT_MAX;
  } catch (error) {
    // Fail open — a query error must not block a legitimate submission. But say
    // so: an unreported fail-open is a limiter that has silently stopped
    // limiting, and silence is exactly how the unbounded read this replaces
    // would have surfaced when it finally got slow or expensive. It didn't.
    // 'warning' because the enquiry itself is unaffected and a single blip needs
    // nobody; a persistent fault (a rejected query, a missing index) fails every
    // request, so volume makes it loud on its own.
    captureHandledError(error, { step: 'contact-rate-limit', level: 'warning' });
    return true;
  }
}

// Length caps — inputs are truncated to these, never rejected for being long.
const MAX_LENGTH = { name: 100, email: 200, subject: 200, message: 5000 };
// The marketing form collects name/email/message only (no subject field), so a
// missing/blank subject falls back to this rather than rendering blank in the
// admin inbox and the notification email.
const DEFAULT_SUBJECT = 'General enquiry';

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  try {
    // 1. Rate limit by client IP (first hop of x-forwarded-for).
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const allowed = await checkRateLimit(ip);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many submissions. Please try again later.' },
        { status: 429, headers: CORS_HEADERS },
      );
    }

    // 2. Parse JSON body.
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: CORS_HEADERS });
    }

    // Only accept string inputs; anything else is treated as absent so it fails
    // the required-field check below rather than being coerced into the document.
    const rawName = typeof body?.name === 'string' ? body.name.trim() : '';
    const rawEmail = typeof body?.email === 'string' ? body.email.trim() : '';
    const rawSubject = typeof body?.subject === 'string' ? body.subject.trim() : '';
    const rawMessage = typeof body?.message === 'string' ? body.message.trim() : '';

    // 3. Required-field validation (subject is optional — defaulted below).
    if (!rawName || !rawEmail || !rawMessage) {
      return NextResponse.json(
        { error: 'Missing required fields: name, email, message' },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    // 4. Email format.
    if (!isValidEmail(rawEmail)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400, headers: CORS_HEADERS });
    }

    // 5. Enforce length caps (truncate, don't reject).
    const safeName = rawName.slice(0, MAX_LENGTH.name);
    const safeEmail = rawEmail.slice(0, MAX_LENGTH.email);
    const safeSubject = (rawSubject || DEFAULT_SUBJECT).slice(0, MAX_LENGTH.subject);
    const safeMessage = rawMessage.slice(0, MAX_LENGTH.message);

    // 6. Write to platform_inbox via the Admin SDK, which bypasses
    //    firestore.rules (create is authenticated-only there). The document shape
    //    mirrors ContactModal.tsx's `type: 'contact'` write exactly, so
    //    PlatformInbox.tsx renders it and notifyPlatformInbox formats the email.
    //    This is an anonymous public visitor → userId / userEmail / fromTenantId
    //    are all null. `ip` and `rateLimitKey` are extra top-level fields used
    //    only for rate limiting; both consumers read
    //    type/status/createdAt/userEmail/fromTenantId/data.* and ignore the pair.
    //
    //    `createdAt` is computed once and used for both the field and the key, so
    //    the value the window is measured against is the value the inbox shows.
    const createdAt = new Date().toISOString();
    await adminDb.collection('platform_inbox').add({
      type: 'contact',
      status: 'pending',
      createdAt,
      userId: null,
      userEmail: null,
      data: {
        name: safeName,
        email: safeEmail,
        subject: safeSubject,
        message: safeMessage,
      },
      fromTenantId: null,
      ip,
      rateLimitKey: rateLimitKey(ip, createdAt),
    });

    // 7. No email code here: the notifyPlatformInbox Cloud Function fires on every
    //    platform_inbox create and emails the platform owner.

    return NextResponse.json({ success: true }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error('Contact form error:', error);
    // The marketing site's only contact channel. A failed write means the enquiry
    // never reaches platform_inbox, so the notifyPlatformInbox function never
    // fires either — the message is gone with no trace.
    captureHandledError(error, { step: 'contact-submit' });
    return NextResponse.json({ error: 'Failed to submit' }, { status: 500, headers: CORS_HEADERS });
  }
}
