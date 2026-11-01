import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { actorFromRequest, autoDmLogs, socialResponse } from '@/lib/social/service';

export const dynamic = 'force-dynamic';

/** Auto-DM: who triggered one of the ministry's automations, and what happened. */
export async function GET(request: NextRequest, context: { params: { id: string } }) {
  const actor = await actorFromRequest(request);
  if (actor instanceof NextResponse) return actor;
  const { id } = context.params;
  return socialResponse(await autoDmLogs(actor, id));
}
