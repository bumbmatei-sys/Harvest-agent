import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { captureHandledError } from '@/lib/money-path-sentry';
import { rateLimitKey, rateLimitWindow, rateLimitWindowStart } from '@/lib/ip-rate-limit';

export const dynamic = 'force-dynamic';

// Public marketing site (https://theharvest.site) posts here cross-origin for
// Harvest product-updates / early-interest capture. Same CORS shape as
// /api/contact: a single explicit origin (never '*'), plus OPTIONS preflight.
// Collection is `product_updates` — NEVER church_newsletter / Mailchimp.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://theharvest.site',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const COLLECTION = 'product_updates';
const ALLOWED_SOURCES = new Set(['homepage', 'waitlist']);

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// IP-based rate limit: max 3 submissions per hour.
// Bounded THE-109-style range on `rateLimitKey` = `${ip}|${createdAt}` — see
// @/lib/ip-rate-limit. Fail open on query error so a limiter fault never drops
// a legitimate signup.
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

async function checkRateLimit(ip: string): Promise<boolean> {
  try {
    const { from, to } = rateLimitWindow(ip, rateLimitWindowStart(RATE_LIMIT_WINDOW_MS));
    const snap = await adminDb
      .collection(COLLECTION)
      .where('rateLimitKey', '>', from)
      .where('rateLimitKey', '<', to)
      .limit(RATE_LIMIT_MAX)
      .get();
    return snap.size < RATE_LIMIT_MAX;
  } catch (error) {
    captureHandledError(error, { step: 'waitlist-rate-limit', level: 'warning' });
    return true;
  }
}

const MAX_EMAIL_LENGTH = 200;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const allowed = await checkRateLimit(ip);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many submissions. Please try again later.' },
        { status: 429, headers: CORS_HEADERS },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: CORS_HEADERS });
    }

    const raw = body as Record<string, unknown> | null;
    const rawEmail = typeof raw?.email === 'string' ? raw.email.trim() : '';
    const rawSource = typeof raw?.source === 'string' ? raw.source.trim() : '';

    if (!rawEmail) {
      return NextResponse.json(
        { error: 'Missing required field: email' },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    if (!isValidEmail(rawEmail)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400, headers: CORS_HEADERS });
    }

    const safeEmail = rawEmail.slice(0, MAX_EMAIL_LENGTH);
    const source = ALLOWED_SOURCES.has(rawSource) ? rawSource : 'waitlist';

    // Durable store only — no Mailchimp / newsletter audience, and the
    // newsletter feature switch stays off. Admin notification can come later via a
    // Cloud Function on product_updates create (same pattern as platform_inbox).
    const createdAt = new Date().toISOString();
    await adminDb.collection(COLLECTION).add({
      email: safeEmail,
      source,
      status: 'pending',
      createdAt,
      ip,
      rateLimitKey: rateLimitKey(ip, createdAt),
    });

    return NextResponse.json({ success: true }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error('Waitlist / product-updates form error:', error);
    captureHandledError(error, { step: 'waitlist-submit' });
    return NextResponse.json({ error: 'Failed to submit' }, { status: 500, headers: CORS_HEADERS });
  }
}
