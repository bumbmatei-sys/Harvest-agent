import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { actorFromRequest, inboxList, socialResponse } from '@/lib/social/service';

export const dynamic = 'force-dynamic';

/** #584: this ministry's DMs, commented posts or reviews (?kind=message|comment|review). */
export async function GET(request: NextRequest) {
  const actor = await actorFromRequest(request);
  if (actor instanceof NextResponse) return actor;
  return socialResponse(await inboxList(actor, request.nextUrl.searchParams.get('kind')));
}
