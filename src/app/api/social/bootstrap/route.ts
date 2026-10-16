import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { actorFromRequest, list, socialResponse } from '@/lib/social/service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const actor = await actorFromRequest(request);
  if (actor instanceof NextResponse) return actor;
  return socialResponse(await list(actor));
}
