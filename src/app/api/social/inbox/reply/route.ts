import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { actorFromRequest, inboxReply, socialResponse } from '@/lib/social/service';

export const dynamic = 'force-dynamic';

/** #584: answer an owned DM, comment or review. */
export async function POST(request: NextRequest) {
  const actor = await actorFromRequest(request);
  if (actor instanceof NextResponse) return actor;
  const body = await request.json().catch(() => null);
  return socialResponse(await inboxReply(actor, body));
}
