import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireChurchExportAdmin } from '@/lib/church-export-auth';
import { isSafeExportId } from '@/lib/church-export';
import { consumeChurchExport, getChurchExport } from '@/lib/church-export-run';
import { captureHandledError } from '@/lib/money-path-sentry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/church-export/complete — delete the object after a successful download.
 *
 * Idempotent once the job is already consumed. A church that never calls this
 * is covered by the 24-hour sweep.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const exportId = typeof body.exportId === 'string' ? body.exportId : '';
  if (!exportId || !isSafeExportId(exportId)) {
    return NextResponse.json({ error: 'exportId is required' }, { status: 400 });
  }

  const auth = await requireChurchExportAdmin(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const job = await getChurchExport(auth.tenantId, exportId);
    if (!job) return NextResponse.json({ error: 'Export not found' }, { status: 404 });
    if (job.status === 'consumed') return NextResponse.json({ deleted: true });
    if (job.status !== 'ready') {
      return NextResponse.json({ error: 'Export is not ready' }, { status: 409 });
    }
    await consumeChurchExport(auth.tenantId, job);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error('[church-export] complete failed', err);
    captureHandledError(err, { step: 'church-export-complete', tenantId: auth.tenantId, ids: { exportId } });
    return NextResponse.json({ error: 'Could not remove the export' }, { status: 500 });
  }
}
