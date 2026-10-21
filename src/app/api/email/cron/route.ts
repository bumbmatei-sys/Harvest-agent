import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { isEmailNotConfigured } from '@/lib/email/provider';
import { NEWSLETTER_FEATURE_ENABLED, NEWSLETTER_HIDDEN_MESSAGE } from '@/lib/newsletter-feature';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Sends every scheduled broadcast whose time has come. Vercel Cron only. */
export async function GET(request: NextRequest) {
  // THE-335: nothing sends while the newsletter is hidden. Scheduled broadcasts wait where they are.
  if (!NEWSLETTER_FEATURE_ENABLED) {
    return NextResponse.json({ ok: false, error: 'newsletter_hidden', message: NEWSLETTER_HIDDEN_MESSAGE }, { status: 503 });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    console.error('[email/cron] rejected: CRON_SECRET missing or mismatched');
    return NextResponse.json({ ok: false, error: 'unauthorized', message: 'CRON_SECRET is missing or does not match.' }, { status: 401 });
  }
  try {
    const { getEmailProvider } = await import('@/lib/email/provider');
    await getEmailProvider();
    (await import('@/lib/email/unsubscribe')).assertUnsubscribeConfigured();
    const { buildEmailService } = await import('@/lib/email/runtime');
    const service = buildEmailService(process.env.NEXT_PUBLIC_APP_ORIGIN || 'https://theharvest.app');
    const results = await service.runDue();
    const failed = results.filter((r) => r.outcome === 'failed' || r.outcome === 'partial');
    // Housekeeping after the sends, so a failure here never delays one.
    let purged: { tokens: number; feedback: number } | { error: string };
    try {
      purged = await service.purgeExpired();
    } catch (error) {
      console.error(`[email/cron] purge failed: ${error instanceof Error ? error.message : 'unknown'}`);
      purged = { error: 'purge_failed' };
    }
    return NextResponse.json({ ok: failed.length === 0, processed: results.length, failed: failed.length, purged, results }, { status: failed.length ? 207 : 200 });
  } catch (error) {
    console.error(`[email/cron] ${error instanceof Error ? error.message : 'failed'}`);
    if (isEmailNotConfigured(error)) {
      return NextResponse.json({ ok: false, error: 'not_configured', message: 'Email sending is not set up on this server yet.' }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
