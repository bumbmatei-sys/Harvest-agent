import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { AdminNotConfiguredError, assertAdminConfigured } from '@/lib/firebase-admin';
import { isEmailNotConfigured, isEmailProviderError } from '@/lib/email/provider';
import { NEWSLETTER_FEATURE_ENABLED, NEWSLETTER_HIDDEN_MESSAGE } from '@/lib/newsletter-feature';
import type { EmailActionBody } from '@/lib/email/dispatch';

export const dynamic = 'force-dynamic';
// A send runs inside this request; the service stops starting emails before the limit.
export const maxDuration = 300;

const NOT_CONFIGURED = 'Email sending is not set up on this server yet.';
const INTERNAL = 'Something went wrong. Try again.';
const PROVIDER_DOWN = 'The email service did not respond in time. Nothing was changed. Try again in a moment.';

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
  // THE-335: while the newsletter is hidden every action refuses, before auth spends a read.
  // /api/email/unsubscribe is a different route and stays live: an opt-out must always work.
  if (!NEWSLETTER_FEATURE_ENABLED) {
    return NextResponse.json({ ok: false, error: 'newsletter_hidden', message: NEWSLETTER_HIDDEN_MESSAGE }, { status: 503 });
  }
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
    if (needsProvider(body)) {
      await getEmailProvider();
      (await import('@/lib/email/unsubscribe')).assertUnsubscribeConfigured();
    }
    const { buildEmailService } = await import('@/lib/email/runtime');
    const service = buildEmailService(request.nextUrl.origin);
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
    if (isEmailProviderError(error)) {
      return NextResponse.json({ ok: false, error: 'provider_unavailable', message: PROVIDER_DOWN }, { status: 502 });
    }
    return NextResponse.json({ ok: false, error: 'internal', message: INTERNAL }, { status: 500 });
  }
}
