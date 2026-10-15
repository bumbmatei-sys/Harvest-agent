import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireChurchExportAdmin } from '@/lib/church-export-auth';
import { SIGNED_URL_TTL_SECONDS, isSafeExportId, parseChurchExportKey } from '@/lib/church-export';
import { getChurchExport, signChurchExportUrl } from '@/lib/church-export-run';
import { captureHandledError } from '@/lib/money-path-sentry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/church-export/url — a 15-minute read URL for one ready export.
 *
 * The object key is the one stored when the export was written. The request
 * supplies an id only, and the id is read from the caller's own tenant.
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
    if (job.status !== 'ready') {
      return NextResponse.json({ error: 'Export is not ready' }, { status: 409 });
    }
    const parsed = parseChurchExportKey(job.objectKey);
    if (!parsed || parsed.tenantId !== auth.tenantId || parsed.exportId !== exportId) {
      return NextResponse.json({ error: 'Failed to generate download link' }, { status: 500 });
    }
    const url = await signChurchExportUrl(job.objectKey);
    return NextResponse.json({ url, expiresInSeconds: SIGNED_URL_TTL_SECONDS });
  } catch (err) {
    console.error('[church-export] url failed', err);
    captureHandledError(err, { step: 'church-export-url', tenantId: auth.tenantId, ids: { exportId } });
    return NextResponse.json({ error: 'Failed to generate download link' }, { status: 500 });
  }
}
