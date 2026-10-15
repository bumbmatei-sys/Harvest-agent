import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireChurchExportAdmin } from '@/lib/church-export-auth';
import { latestChurchExport, runChurchExport } from '@/lib/church-export-run';
import { captureHandledError } from '@/lib/money-path-sentry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

function requestedTenant(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/**
 * POST /api/church-export — start a whole-church export.
 * GET  /api/church-export — the caller's latest export, if any.
 *
 * The file is written to R2. This response carries the id and status, not the
 * rows. Only a tenant admin of the caller's own church can start one.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const auth = await requireChurchExportAdmin(request, requestedTenant(body.tenantId));
  if (auth instanceof NextResponse) return auth;

  try {
    const result = await runChurchExport(auth.tenantId, auth.user.uid);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Export failed';
    console.error('[church-export] failed', message);
    captureHandledError(err, { step: 'church-export', tenantId: auth.tenantId });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireChurchExportAdmin(
    request,
    requestedTenant(request.nextUrl.searchParams.get('tenantId')),
  );
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
