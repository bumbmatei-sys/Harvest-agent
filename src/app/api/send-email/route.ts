import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Resend } from 'resend';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';

const resend = new Resend(process.env.RESEND_API_KEY);

interface EmailRequest {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

export async function POST(request: NextRequest) {
  try {
    const userOrErr = await requireAuth(request);
    if (userOrErr instanceof Response) return userOrErr;

    const body: EmailRequest = await request.json();
    const { to, subject, html, text, from = 'Harvest <noreply@theharvest.app>' } = body;

    if (!to || !subject || (!html && !text)) {
      return NextResponse.json({ error: 'Missing required fields: to, subject, and html or text' }, { status: 400 });
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const { data, error } = await resend.emails.send({
        from,
        to,
        subject,
        html: html || undefined,
        text: text || undefined,
      });

      if (error) {
        console.error('Resend error:', error);
        return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
      }

      return NextResponse.json({ success: true, id: data?.id });
    }

    // Fallback: log to Firestore if no API key configured
    await adminDb.collection('email_log').add({
      to,
      from,
      subject,
      html,
      text: text || null,
      status: 'logged',
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, status: 'logged' });
  } catch (error) {
    console.error('Email API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
