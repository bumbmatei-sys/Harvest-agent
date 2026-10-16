import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { actorFromRequest, socialResponse, submitPost } from '@/lib/social/service';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const actor = await actorFromRequest(request);
  if (actor instanceof NextResponse) return actor;
  const body = await request.json().catch(() => null);
  return socialResponse(await submitPost(actor, body, request.headers.get('idempotency-key')));
}
