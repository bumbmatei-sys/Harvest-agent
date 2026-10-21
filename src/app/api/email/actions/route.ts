import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { AdminNotConfiguredError, assertAdminConfigured } from '@/lib/firebase-admin';
import { isEmailNotConfigured } from '@/lib/email/provider';
import type { EmailActionBody } from '@/lib/email/dispatch';

export const dynamic = 'force-dynamic';

const NOT_CONFIGURED = 'Email sending is not set up on this server yet.';
const INTERNAL = 'Something went wrong. Try again.';

function isAdminConfigFailure(error: unknown): boolean {
  if (error instanceof AdminNotConfiguredError) return true;
  if (error instanceof Error && error.name === 'AdminNotConfiguredError') return true;
  const message = error instanceof Error ? error.message : '';
  return /could not load the default credentials/i.test(message) || /metadata\.google\.internal/i.test(message);
}

function notConfigured() {
  return NextResponse.json({ ok: false, error: 'not_configured', message: NOT_CONFIGURED }, { status: 503 });
}

/**
 * Thin transport. Auth is verified here; the plan gate, the tenant check,
 * suppression, the volume cap and preview-then-confirm all live in the service.
 * Anything that reaches the vendor answers 503 JSON when PLUNK_API_KEY is
 * missing, before a confirm token can be spent.
 */
export async function POST(request: NextRequest) {
  let body: EmailActionBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid', message: 'The request body is not JSON.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'invalid', message: 'The request body is not JSON.' }, { status: 400 });
  }
  try {
    assertAdminConfigured();
    const { verifyAuth } = await import('@/lib/api-auth');
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ ok: false, error: 'unauthenticated', message: 'Sign in is required.' }, { status: 401 });
    }
    const { dispatchEmailAction, needsProvider } = await import('@/lib/email/dispatch');
    const { getEmailProvider } = await import('@/lib/email/provider');
    if (needsProvider(body)) await getEmailProvider();
    const { firestoreEmailStore } = await import('@/lib/email/firestore-store');
    const { firestoreEmailLedger } = await import('@/lib/email/firestore-confirm');
    const { createEmailService } = await import('@/lib/email/service');
    const service = createEmailService({
      store: firestoreEmailStore,
      ledger: firestoreEmailLedger(),
      getProvider: getEmailProvider,
      appOrigin: request.nextUrl.origin,
      fallbackFrom: process.env.EMAIL_FALLBACK_FROM?.trim() || null,
    });
    const result = await dispatchEmailAction(service, {
      uid: user.uid,
      email: user.email ?? null,
      tenantId: user.tenantId,
      isAdmin: user.isAdmin,
      isSuperAdmin: user.isSuperAdmin,
    }, body);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error(`[email/actions] ${error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error'}`);
    if (isEmailNotConfigured(error) || isAdminConfigFailure(error)) return notConfigured();
    return NextResponse.json({ ok: false, error: 'internal', message: INTERNAL }, { status: 500 });
  }
}
