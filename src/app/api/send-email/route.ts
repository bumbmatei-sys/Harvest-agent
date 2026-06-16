import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

/**
 * Email notification API route.
 * 
 * Currently logs emails to Firestore for debugging.
 * To integrate a real provider (Resend, SendGrid, etc.):
 * 1. Add the API key as RESEND_API_KEY env var
 * 2. Uncomment the fetch call below
 * 3. Remove the Firestore logging
 */

interface EmailRequest {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: EmailRequest = await request.json();
    const { to, subject, html, from = 'Harvest <noreply@theharvest.app>' } = body;

    if (!to || !subject || !html) {
      return NextResponse.json({ error: 'Missing required fields: to, subject, html' }, { status: 400 });
    }

    // ─── Option 1: Resend (uncomment when ready) ──────────────────
    // const resendKey = process.env.RESEND_API_KEY;
    // if (resendKey) {
    //   const resp = await fetch('https://api.resend.com/emails', {
    //     method: 'POST',
    //     headers: {
    //       'Authorization': `Bearer ${resendKey}`,
    //       'Content-Type': 'application/json',
    //     },
    //     body: JSON.stringify({ from, to, subject, html }),
    //   });
    //   if (!resp.ok) {
    //     const error = await resp.text();
    //     console.error('Resend error:', error);
    //     return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
    //   }
    //   const data = await resp.json();
    //   return NextResponse.json({ success: true, id: data.id });
    // }

    // ─── Option 2: Log to Firestore (default) ─────────────────────
    await adminDb.collection('email_log').add({
      to,
      from,
      subject,
      html,
      status: 'logged', // Change to 'sent' when provider is integrated
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, status: 'logged' });
  } catch (error) {
    console.error('Email API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
