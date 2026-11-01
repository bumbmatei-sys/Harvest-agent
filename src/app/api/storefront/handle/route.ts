import { NextRequest, NextResponse } from 'next/server';
import { captureHandledError } from '@/lib/money-path-sentry';
import { isTenantIdParam } from '@/lib/community/communities-server';
import { requireStorefrontEditor } from '@/lib/storefront/access';
import { handleProblem, normalizeHandle } from '@/lib/storefront/handle';
import { changeHandle, isHandleAvailable } from '@/lib/storefront/handle-server';

export const dynamic = 'force-dynamic';

/** Whether a Storefront address is free for this ministry. */
export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get('tenantId');
  if (!isTenantIdParam(tenantId)) return NextResponse.json({ error: 'A ministry is required.' }, { status: 400 });
  const handle = normalizeHandle(request.nextUrl.searchParams.get('handle'));
  const problem = handleProblem(handle);
  if (problem) return NextResponse.json({ available: false, reason: problem });
  try {
    const admin = await requireStorefrontEditor(request, tenantId);
    if (admin instanceof NextResponse) return admin;
    const available = await isHandleAvailable(handle, tenantId);
    return NextResponse.json({ available, reason: available ? null : 'That address is taken.' });
  } catch (error) {
    captureHandledError(error, { step: 'storefront-handle-check', tenantId });
    return NextResponse.json({ error: 'Could not check the address. Please try again.' }, { status: 503 });
  }
}

/** Moves the ministry's Storefront to a new address. Only the address changes; no data moves. */
export async function PUT(request: NextRequest) {
  let body: { tenantId?: unknown; handle?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const tenantId = body?.tenantId;
  if (!isTenantIdParam(tenantId)) return NextResponse.json({ error: 'A ministry is required.' }, { status: 400 });
  const admin = await requireStorefrontEditor(request, tenantId);
  if (admin instanceof NextResponse) return admin;
  const result = await changeHandle(tenantId, normalizeHandle(body.handle));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ handle: result.handle });
}
