import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ChurchExportRejected } from '@/lib/church-export';
import { requireChurchExportAdmin } from '@/lib/church-export-auth';
import { latestChurchExport, runChurchExport } from '@/lib/church-export-run';
import { captureHandledError } from '@/lib/money-path-sentry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/church-export — start a whole-church export.
 * GET  /api/church-export — the caller's latest export, if any.
 *
 * The file is written to R2. This response carries the id and status, not the
 * rows. The tenant is the one on the caller's token. A tenant id in the body
 * or the query is ignored.
 */
export async function POST(request: NextRequest) {
  const auth = await requireChurchExportAdmin(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const result = await runChurchExport(auth.tenantId, auth.user.uid);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ChurchExportRejected) {
      return NextResponse.json({ error: err.message }, { status: err.code === 'active' ? 409 : 429 });
    }
    console.error('[church-export] failed', err);
    captureHandledError(err, { step: 'church-export', tenantId: auth.tenantId });
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireChurchExportAdmin(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const job = await latestChurchExport(auth.tenantId);
    if (!job) return NextResponse.json({ export: null });
    return NextResponse.json({
      export: {
        id: job.id,
        status: job.status,
        createdAtMs: job.createdAtMs,
        error: job.error ?? null,
      },
    });
  } catch (err) {
    console.error('[church-export] status failed', err);
    captureHandledError(err, { step: 'church-export-status', tenantId: auth.tenantId });
    return NextResponse.json({ error: 'Could not load export status' }, { status: 500 });
  }
}
