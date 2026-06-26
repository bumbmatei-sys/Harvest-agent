import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb, adminAuth } from '@/lib/firebase-admin';
import { Resend } from 'resend';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Missing email' }, { status: 400 });
    }

    let firebaseUser;
    try {
      firebaseUser = await adminAuth.getUserByEmail(email);
    } catch {
      return NextResponse.json({ error: 'No account found for this email' }, { status: 404 });
    }

    const userDoc = await adminDb.collection('users').doc(firebaseUser.uid).get();
    if (!userDoc.data()?.hasAIAssistant) {
      return NextResponse.json({ error: 'This account does not have an AI Assistant subscription' }, { status: 403 });
    }

    const customToken = await adminAuth.createCustomToken(firebaseUser.uid);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';
    const magicLink = `${baseUrl}/ai-assistant?token=${customToken}`;

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return NextResponse.json({ error: 'Email service not configured' }, { status: 500 });
    }
    const resend = new Resend(resendKey);

    const { error } = await resend.emails.send({
      from: 'Harvest <noreply@theharvest.app>',
      to: email,
      subject: 'Your Harvest AI Assistant link',
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2 style="color:#d4a017;font-size:24px;margin-bottom:8px">Harvest AI Assistant</h2><p style="color:#555;margin-bottom:24px">Here is your link to access your AI assistant. This link expires in 1 hour.</p><a href="${magicLink}" style="display:inline-block;background:#d4a017;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Open AI Assistant</a><p style="color:#999;font-size:12px;margin-top:24px">If you did not request this, you can safely ignore this email.</p></div>`,
    });

    if (error) {
      console.error('Resend error:', error);
      return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Resend link error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to resend link' }, { status: 500 });
  }
}
