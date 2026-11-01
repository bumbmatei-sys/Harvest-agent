import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { actorFromRequest, inboxThread, socialResponse } from '@/lib/social/service';

export const dynamic = 'force-dynamic';

/** #584: one owned DM conversation's messages, or one owned post's comments (?kind=&id=). */
export async function GET(request: NextRequest) {
  const actor = await actorFromRequest(request);
  if (actor instanceof NextResponse) return actor;
  const params = request.nextUrl.searchParams;
  return socialResponse(await inboxThread(actor, params.get('kind'), params.get('id')));
}
