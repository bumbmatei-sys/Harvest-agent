import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { actorFromRequest, autoDmList, autoDmSave, socialResponse } from '@/lib/social/service';

export const dynamic = 'force-dynamic';

/** Auto-DM: the ministry's comment-to-DM automations, its Instagram and Facebook accounts and its posts. */
export async function GET(request: NextRequest) {
  const actor = await actorFromRequest(request);
  if (actor instanceof NextResponse) return actor;
  return socialResponse(await autoDmList(actor));
}

/** Auto-DM: create an automation on one of the ministry's accounts. */
export async function POST(request: NextRequest) {
  const actor = await actorFromRequest(request);
  if (actor instanceof NextResponse) return actor;
  const body = await request.json().catch(() => null);
  return socialResponse(await autoDmSave(actor, null, body));
}
