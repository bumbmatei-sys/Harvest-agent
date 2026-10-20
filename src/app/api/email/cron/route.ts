import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { isEmailNotConfigured } from '@/lib/email/provider';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Sends every scheduled broadcast whose time has come. Vercel Cron only. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    console.error('[email/cron] rejected: CRON_SECRET missing or mismatched');
    return NextResponse.json({ ok: false, error: 'unauthorized', message: 'CRON_SECRET is missing or does not match.' }, { status: 401 });
  }
  try {
    const { getEmailProvider } = await import('@/lib/email/provider');
    await getEmailProvider();
    const { firestoreEmailStore } = await import('@/lib/email/firestore-store');
    const { firestoreEmailLedger } = await import('@/lib/email/firestore-confirm');
    const { createEmailService } = await import('@/lib/email/service');
    const service = createEmailService({
      store: firestoreEmailStore,
      ledger: firestoreEmailLedger(),
      getProvider: getEmailProvider,
      appOrigin: process.env.NEXT_PUBLIC_APP_ORIGIN || 'https://theharvest.app',
    });
    const results = await service.runDue();
    const failed = results.filter((r) => r.outcome === 'failed' || r.outcome === 'partial');
    return NextResponse.json({ ok: failed.length === 0, processed: results.length, failed: failed.length, results }, { status: failed.length ? 207 : 200 });
  } catch (error) {
    console.error(`[email/cron] ${error instanceof Error ? error.message : 'failed'}`);
    if (isEmailNotConfigured(error)) {
      return NextResponse.json({ ok: false, error: 'not_configured', message: 'Email sending is not set up on this server yet.' }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
