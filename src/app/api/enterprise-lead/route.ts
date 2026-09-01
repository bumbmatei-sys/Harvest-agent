import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { captureHandledError } from '@/lib/money-path-sentry';
import { rateLimitKey, rateLimitWindow, rateLimitWindowStart } from '@/lib/ip-rate-limit';

async function getResend() {
  const { Resend } = await import('resend');
  return new Resend(process.env.RESEND_API_KEY);
}

export const dynamic = 'force-dynamic';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// IP-based rate limit: max 3 submissions per hour.
//
// THE READ IS BOUNDED AT `RATE_LIMIT_MAX` DOCUMENTS, FOREVER.
//
// This was `.where('ip', '==', ip).get()` with the time window applied in
// memory: every lead that address had EVER submitted was read on every request,
// to answer a question about the last hour. The `'unknown'` bucket — shared by
// every visitor arriving without `x-forwarded-for` — is the one key guaranteed
// to grow, and it was re-read in full on each new one. The same defect THE-109
// fixed in /api/contact, on the route that comment pointed at as precedent.
//
// The window now lives IN the query and still needs no composite index, because
// one field carries both halves: `rateLimitKey` = `${ip}|${createdAt}`. The key
// construction, the ordering invariants that make the range safe, and why a
// composite index was the wrong trade all live in @/lib/ip-rate-limit.
//
// Unlike platform_inbox, this route is the ONLY writer of enterprise_leads, so
// there is no second submission path to exclude — every document here carries
// both fields by construction.
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

async function checkRateLimit(ip: string): Promise<boolean> {
  try {
    const { from, to } = rateLimitWindow(ip, rateLimitWindowStart(RATE_LIMIT_WINDOW_MS));
    const snap = await adminDb.collection('enterprise_leads')
      .where('rateLimitKey', '>', from)
      .where('rateLimitKey', '<', to)
      .limit(RATE_LIMIT_MAX)
      .get();
    return snap.size < RATE_LIMIT_MAX;
  } catch (error) {
    // Fail open — a query error must not block a sales enquiry. But say so: an
    // unreported fail-open is a limiter that has silently stopped limiting,
    // which is exactly how the unbounded read this replaces would have surfaced
    // when it finally got slow or expensive. It didn't.
    captureHandledError(error, { step: 'enterprise-lead-rate-limit', level: 'warning' });
    return true;
  }
}

const MAX_LENGTH = { name: 100, email: 200, churchName: 200, message: 2000 };

export async function POST(request: NextRequest) {
  try {
    // Rate limit by IP
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const allowed = await checkRateLimit(ip);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many submissions. Please try again later.' }, { status: 429 });
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { name, email, churchName, churchCount, message, userId } = body;

    if (!name || !email || !churchName) {
      return NextResponse.json({ error: 'Missing required fields: name, email, churchName' }, { status: 400 });
    }

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    // Enforce length limits
    const safeName = String(name).slice(0, MAX_LENGTH.name);
    const safeEmail = String(email).slice(0, MAX_LENGTH.email);
    const safeChurchName = String(churchName).slice(0, MAX_LENGTH.churchName);
    const safeMessage = message ? String(message).slice(0, MAX_LENGTH.message) : '';
    const safeChurchCount = churchCount && Number(churchCount) > 0 ? Math.floor(Number(churchCount)) : null;

    const timestamp = new Date().toISOString();

    // 1. Save lead to Firestore. `rateLimitKey` is an extra top-level field used
    //    only by checkRateLimit above, derived from the `ip` and `createdAt`
    //    written beside it — one timestamp for both, so the window is measured
    //    against the value the record shows. Nothing renders this collection
    //    in-app: the lead reaches a human through the Resend email built below,
    //    and firestore.rules gates direct reads to super admins.
    await adminDb.collection('enterprise_leads').add({
      name: safeName,
      email: safeEmail,
      churchName: safeChurchName,
      churchCount: safeChurchCount,
      message: safeMessage,
      userId: userId || null,
      ip,
      status: 'new',
      createdAt: timestamp,
      rateLimitKey: rateLimitKey(ip, timestamp),
    });

    // 2. Send email notification to admin
    const adminEmails = ['bumbmatei@proton.me', 'bumbmatei@zohomail.eu'];
    const adminEmail = adminEmails[0];

    if (process.env.RESEND_API_KEY) {
      try {
        const resend = await getResend();
        await resend.emails.send({
          from: 'Harvest <noreply@theharvest.app>',
          to: adminEmail,
          subject: `New Enterprise Lead: ${escapeHtml(safeChurchName)}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #0b1121;">New Enterprise Plan Request</h2>
              <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr><td style="padding: 8px 0; color: #666; width: 140px;"><strong>Name:</strong></td><td style="padding: 8px 0;">${escapeHtml(safeName)}</td></tr>
                <tr><td style="padding: 8px 0; color: #666;"><strong>Email:</strong></td><td style="padding: 8px 0;"><a href="mailto:${escapeHtml(safeEmail)}">${escapeHtml(safeEmail)}</a></td></tr>
                <tr><td style="padding: 8px 0; color: #666;"><strong>Church:</strong></td><td style="padding: 8px 0;">${escapeHtml(safeChurchName)}</td></tr>
                ${safeChurchCount ? `<tr><td style="padding: 8px 0; color: #666;"><strong># of Churches:</strong></td><td style="padding: 8px 0;">${safeChurchCount}</td></tr>` : ''}
                ${safeMessage ? `<tr><td style="padding: 8px 0; color: #666;"><strong>Message:</strong></td><td style="padding: 8px 0;">${escapeHtml(safeMessage)}</td></tr>` : ''}
                <tr><td style="padding: 8px 0; color: #666;"><strong>Submitted:</strong></td><td style="padding: 8px 0;">${timestamp}</td></tr>
              </table>
              <p style="color: #999; font-size: 12px;">Reply directly to this email to respond to ${escapeHtml(safeName)}.</p>
            </div>
          `,
          replyTo: safeEmail,
        });
      } catch (emailErr) {
        // The lead row is already in Firestore, so nothing is lost — but the
        // notification is the only thing that makes anyone look at it.
        console.error('Failed to send enterprise lead email:', emailErr);
        captureHandledError(emailErr, { step: 'enterprise-lead-email', level: 'warning' });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Enterprise lead error:', error);
    // A sales enquiry that never got stored and never got emailed.
    captureHandledError(error, { step: 'enterprise-lead-submit' });
    return NextResponse.json({ error: 'Failed to submit' }, { status: 500 });
  }
}
