import { NextRequest, NextResponse } from 'next/server';
import { requireTenantPermission } from '@/lib/api-auth';
import { captureHandledError } from '@/lib/money-path-sentry';
import { cancelEventRegistrations, previewCancellation, CancellationError } from '@/lib/events/cancellation';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handle(request: NextRequest, preview: boolean) {
  let data;
  try { data = preview ? Object.fromEntries(request.nextUrl.searchParams) : await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }); }
  const { tenantId, eventId, runDate = null } = data || {};
  if (typeof tenantId !== 'string' || !tenantId || typeof eventId !== 'string' || !eventId
    || (runDate !== null && (typeof runDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(runDate)))) return NextResponse.json({ error: 'Invalid cancellation' }, { status: 400 });
  try {
    const auth = await requireTenantPermission(request, tenantId, 'manageEvents');
    if (auth instanceof NextResponse) return auth;
    return NextResponse.json(await (preview ? previewCancellation : cancelEventRegistrations)(tenantId, eventId, runDate));
  } catch (error) {
    captureHandledError(error, { step: 'event-cancel', tenantId, ids: { eventId } });
    return NextResponse.json({ error: error instanceof CancellationError ? error.message : 'Could not cancel event or send notices. Please retry.' },
      { status: error instanceof CancellationError ? error.status : 503 });
  }
}

export const GET = (request: NextRequest) => handle(request, true);
export const POST = (request: NextRequest) => handle(request, false);
