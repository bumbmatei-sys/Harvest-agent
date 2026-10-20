import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { AdminNotConfiguredError, assertAdminConfigured } from '@/lib/firebase-admin';
import type { BlogActionBody, BlogActor } from '@/lib/blog/service';

export const dynamic = 'force-dynamic';

const NOT_CONFIGURED = "Server isn't configured to save posts";
const INTERNAL = 'Something went wrong saving the post. Try again.';

/**
 * Admin SDK init failures. The class covers the Vercel block. The two
 * messages are the metadata-server failure applicationDefault() throws,
 * and nothing broader: a permission error that mentions credentials or
 * UNAUTHENTICATED must stay a 500.
 */
function isAdminConfigFailure(error: unknown): boolean {
  if (error instanceof AdminNotConfiguredError) return true;
  if (error instanceof Error && error.name === 'AdminNotConfiguredError') return true;
  const message = error instanceof Error ? error.message : '';
  return /could not load the default credentials/i.test(message)
    || /metadata\.google\.internal/i.test(message);
}

function logFailure(error: unknown): void {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`[blog/actions] ${name}: ${message}`);
}

/**
 * Thin transport for the blog service. Auth is verified here; every decision
 * about the post, the time, the church and who may write it lives in the service.
 *
 * The store modules are imported inside the try. They pull in firebase-admin,
 * and an init failure at that evaluation has to become a response rather than
 * an uncaught exception that Next turns into an HTML 500.
 */
async function run(request: NextRequest, body: BlogActionBody) {
  try {
    // verifyAuth turns every admin throw into null, which this route would
    // answer as 401. The missing-credential case has to fail before that.
    assertAdminConfigured();
    const { verifyAuth } = await import('@/lib/api-auth');
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
    const { firestoreBlogStore } = await import('@/lib/blog/firestore-store');
    const { firestoreConfirmLedger } = await import('@/lib/blog/firestore-confirm');
    const { createBlogService, dispatchBlogAction } = await import('@/lib/blog/service');
    const service = createBlogService({ store: firestoreBlogStore, ledger: firestoreConfirmLedger() });
    const result = await dispatchBlogAction(service, actor, body);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    logFailure(error);
    if (isAdminConfigFailure(error)) {
      return NextResponse.json({ ok: false, error: NOT_CONFIGURED, message: NOT_CONFIGURED }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: 'internal', message: INTERNAL }, { status: 500 });
  }
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
