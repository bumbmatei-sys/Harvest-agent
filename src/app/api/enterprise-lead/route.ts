import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

async function getResend() {
  const { Resend } = await import('resend');
  return new Resend(process.env.RESEND_API_KEY);
}

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, churchName, churchCount, message, userId } = body;

    if (!name || !email || !churchName) {
      return NextResponse.json({ error: 'Missing required fields: name, email, churchName' }, { status: 400 });
    }

    const timestamp = new Date().toISOString();

    // 1. Save lead to Firestore
    await adminDb.collection('enterprise_leads').add({
      name,
      email,
      churchName,
      churchCount: churchCount || null,
      message: message || '',
      userId: userId || null,
      status: 'new',
      createdAt: timestamp,
    });

    // 2. Send email notification to admin
    const adminEmail = process.env.SUPER_ADMIN_EMAIL || process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL || 'bumbmatei@gmail.com';

    if (process.env.RESEND_API_KEY) {
      try {
        const resend = await getResend();
        await resend.emails.send({
          from: 'Harvest <noreply@theharvest.app>',
          to: adminEmail,
          subject: `🏢 New Enterprise Lead: ${churchName}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #0b1121;">New Enterprise Plan Request</h2>
              <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr><td style="padding: 8px 0; color: #666; width: 140px;"><strong>Name:</strong></td><td style="padding: 8px 0;">${name}</td></tr>
                <tr><td style="padding: 8px 0; color: #666;"><strong>Email:</strong></td><td style="padding: 8px 0;"><a href="mailto:${email}">${email}</a></td></tr>
                <tr><td style="padding: 8px 0; color: #666;"><strong>Church:</strong></td><td style="padding: 8px 0;">${churchName}</td></tr>
                ${churchCount ? `<tr><td style="padding: 8px 0; color: #666;"><strong># of Churches:</strong></td><td style="padding: 8px 0;">${churchCount}</td></tr>` : ''}
                ${message ? `<tr><td style="padding: 8px 0; color: #666;"><strong>Message:</strong></td><td style="padding: 8px 0;">${message}</td></tr>` : ''}
                <tr><td style="padding: 8px 0; color: #666;"><strong>Submitted:</strong></td><td style="padding: 8px 0;">${timestamp}</td></tr>
              </table>
              <p style="color: #999; font-size: 12px;">Reply directly to this email to respond to ${name}.</p>
            </div>
          `,
          replyTo: email,
        });
      } catch (emailErr) {
        console.error('Failed to send enterprise lead email:', emailErr);
        // Don't fail the request if email fails — lead is already saved
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Enterprise lead error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to submit' }, { status: 500 });
  }
}
