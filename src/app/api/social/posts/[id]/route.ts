import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { actorFromRequest, cancel, socialResponse, update } from '@/lib/social/service';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  context: { params: { id: string } },
) {
  const actor = await actorFromRequest(request);
  if (actor instanceof NextResponse) return actor;
  const body = await request.json().catch(() => null);
  return socialResponse(await update(actor, context.params.id, body, request.headers.get('idempotency-key')));
}

export async function DELETE(
  request: NextRequest,
  context: { params: { id: string } },
) {
  const actor = await actorFromRequest(request);
  if (actor instanceof NextResponse) return actor;
  const body = await request.json().catch(() => null);
  return socialResponse(await cancel(actor, context.params.id, body));
}
