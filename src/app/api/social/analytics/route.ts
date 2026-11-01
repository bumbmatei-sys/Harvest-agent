import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { actorFromRequest, analytics, socialResponse } from '@/lib/social/service';

export const dynamic = 'force-dynamic';

/** #582: the scheduler's Analytics tab — post metrics for the last 7, 30 or 90 days. */
export async function GET(request: NextRequest) {
  const actor = await actorFromRequest(request);
  if (actor instanceof NextResponse) return actor;
  return socialResponse(await analytics(actor, request.nextUrl.searchParams.get('range')));
}
