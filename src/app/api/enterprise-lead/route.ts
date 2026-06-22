import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

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

// Simple IP-based rate limit: max 3 submissions per hour
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

async function checkRateLimit(ip: string): Promise<boolean> {
  try {
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const snap = await adminDb.collection('enterprise_leads')
      .where('ip', '==', ip)
      .where('createdAt', '>', windowStart)
      .get();
    return snap.size < RATE_LIMIT_MAX;
  } catch {
    return true; // fail open — don't block on rate limit errors
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

    // 1. Save lead to Firestore
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
        console.error('Failed to send enterprise lead email:', emailErr);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Enterprise lead error:', error);
    return NextResponse.json({ error: 'Failed to submit' }, { status: 500 });
  }
}
