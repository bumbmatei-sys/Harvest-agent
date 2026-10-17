import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { verifyAuth } from '@/lib/api-auth';
import { createBlogService, dispatchBlogAction, type BlogActionBody, type BlogActor } from '@/lib/blog/service';
import { firestoreBlogStore } from '@/lib/blog/firestore-store';

export const dynamic = 'force-dynamic';

/**
 * Thin transport for the blog service. Auth is verified here; every decision
 * about the post, the time, the church and who may write it lives in the service.
 */
async function run(request: NextRequest, body: BlogActionBody) {
  const user = await verifyAuth(request);
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthenticated', message: 'Sign in is required.' }, { status: 401 });
  }
  const actor: BlogActor = {
    uid: user.uid,
    email: user.email ?? null,
    tenantId: user.tenantId,
    isAdmin: user.isAdmin,
    isSuperAdmin: user.isSuperAdmin,
  };
  const service = createBlogService({ store: firestoreBlogStore });
  const result = await dispatchBlogAction(service, actor, body);
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(request: NextRequest) {
  let body: BlogActionBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid', message: 'The request body is not JSON.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'invalid', message: 'The request body is not JSON.' }, { status: 400 });
  }
  return run(request, body);
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  return run(request, {
    action: 'listByDateRange',
    tenantId: url.searchParams.get('tenantId'),
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
  });
}
