import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { actorFromRequest, connectAccount, socialResponse } from '@/lib/social/service';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const actor = await actorFromRequest(request);
  if (actor instanceof NextResponse) return actor;
  const body = await request.json().catch(() => null);
  return socialResponse(await connectAccount(actor, body));
}
