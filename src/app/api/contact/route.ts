import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

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

// IP-based rate limit: max 3 submissions per hour. Single-field Firestore query
// (ip only) + in-memory time window, so no composite index is required — the same
// property /api/enterprise-lead relies on. Only documents written by THIS route
// carry a top-level `ip` field, so authenticated ContactModal submissions living
// in the same platform_inbox collection never match the filter.
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

async function checkRateLimit(ip: string): Promise<boolean> {
  try {
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const snap = await adminDb
      .collection('platform_inbox')
      .where('ip', '==', ip)
      .get();
    // createdAt is an ISO-8601 UTC string, so lexical > compares chronologically.
    const recent = snap.docs.filter((d) => String(d.data().createdAt || '') > windowStart);
    return recent.length < RATE_LIMIT_MAX;
  } catch {
    return true; // fail open — don't block legitimate submissions on a query error
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
    //    are all null. `ip` is an extra top-level field used only for rate
    //    limiting; both PlatformInbox.tsx and notifyPlatformInbox ignore it.
    await adminDb.collection('platform_inbox').add({
      type: 'contact',
      status: 'pending',
      createdAt: new Date().toISOString(),
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
    });

    // 7. No email code here: the notifyPlatformInbox Cloud Function fires on every
    //    platform_inbox create and emails the platform owner.

    return NextResponse.json({ success: true }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error('Contact form error:', error);
    return NextResponse.json({ error: 'Failed to submit' }, { status: 500, headers: CORS_HEADERS });
  }
}
