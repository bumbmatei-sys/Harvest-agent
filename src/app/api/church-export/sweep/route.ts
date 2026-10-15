import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { sweepChurchExports } from '@/lib/church-export-run';
import { captureHandledError } from '@/lib/money-path-sentry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/church-export/sweep — Vercel Cron. Deletes church exports older than 24 hours.
 *
 * Same authorization as the blog auto-generate cron: `Authorization: Bearer $CRON_SECRET`.
 * An unset secret does not match "Bearer undefined".
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    const reason = secret ? 'cron-secret-mismatch' : 'cron-secret-not-configured';
    captureHandledError(
      new Error(`[church-export] sweep refused: ${reason}`),
      { step: 'church-export-sweep-auth', level: 'warning', diagnostics: { reason } },
    );
    console.error(`[church-export] sweep refused: ${reason}`);
    return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  }

  try {
    const result = await sweepChurchExports(Date.now());
    return NextResponse.json(result);
  } catch (err) {
    console.error('[church-export] sweep failed', err);
    captureHandledError(err, { step: 'church-export-sweep' });
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
