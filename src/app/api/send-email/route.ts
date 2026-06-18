import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireAdmin } from '@/lib/api-auth';

async function getResend() {
  const { Resend } = await import('resend');
  return new Resend(process.env.RESEND_API_KEY);
}

interface EmailRequest {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

export async function POST(request: NextRequest) {
  try {
    const userOrErr = await requireAdmin(request);
    if (userOrErr instanceof Response) return userOrErr;

    const body: EmailRequest = await request.json();
    const { to, subject, html, text } = body;
    // Lock from field to prevent admin spoofing
    const from = 'Harvest <noreply@theharvest.app>';

    if (!to || !subject || (!html && !text)) {
      return NextResponse.json({ error: 'Missing required fields: to, subject, and html or text' }, { status: 400 });
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const { data, error } = await (await getResend()).emails.send({
        from,
        to,
        subject,
        ...(html ? { html } : { text: text || subject }),
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
