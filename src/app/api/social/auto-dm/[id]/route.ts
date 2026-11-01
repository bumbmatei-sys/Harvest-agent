import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { actorFromRequest, autoDmDelete, autoDmSave, socialResponse } from '@/lib/social/service';

export const dynamic = 'force-dynamic';

type Context = { params: { id: string } };

/** Auto-DM: change one of the ministry's automations. The account stays the one it runs on. */
export async function PATCH(request: NextRequest, context: Context) {
  const actor = await actorFromRequest(request);
  if (actor instanceof NextResponse) return actor;
  const { id } = context.params;
  const body = await request.json().catch(() => null);
  return socialResponse(await autoDmSave(actor, id, body));
}

/** Auto-DM: delete one of the ministry's automations. */
export async function DELETE(request: NextRequest, context: Context) {
  const actor = await actorFromRequest(request);
  if (actor instanceof NextResponse) return actor;
  const { id } = context.params;
  return socialResponse(await autoDmDelete(actor, id));
}
