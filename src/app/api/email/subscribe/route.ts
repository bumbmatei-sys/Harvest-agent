import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { NEWSLETTER_FEATURE_ENABLED } from '@/lib/newsletter-feature';
import { rateLimitKey, rateLimitWindow, rateLimitWindowStart } from '@/lib/ip-rate-limit';
import { captureHandledError } from '@/lib/money-path-sentry';

export const dynamic = 'force-dynamic';

/** Per address of the visitor: this many requests an hour. Fails open, like the other public forms. */
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const ATTEMPTS = 'emailSubscribeAttempts';

async function underRateLimit(ip: string): Promise<boolean> {
  try {
    const { adminDb } = await import('@/lib/firebase-admin');
    const { from, to } = rateLimitWindow(ip, rateLimitWindowStart(RATE_LIMIT_WINDOW_MS));
    const snap = await adminDb.collection(ATTEMPTS).where('rateLimitKey', '>', from).where('rateLimitKey', '<', to).limit(RATE_LIMIT_MAX).get();
    return snap.size < RATE_LIMIT_MAX;
  } catch (error) {
    captureHandledError(error, { step: 'email-subscribe-rate-limit', level: 'warning' });
    return true;
  }
}

async function recordAttempt(ip: string): Promise<void> {
  try {
    const { adminDb } = await import('@/lib/firebase-admin');
    const createdAt = new Date().toISOString();
    await adminDb.collection(ATTEMPTS).add({ createdAt, rateLimitKey: rateLimitKey(ip, createdAt) });
  } catch (error) {
    captureHandledError(error, { step: 'email-subscribe-rate-limit-record', level: 'warning' });
  }
}

/**
 * The public newsletter sign-up. No session: the visitor is a stranger on a
 * ministry's page. The ministry comes from the HOST, never from the body, so a
 * form on one ministry's page cannot write into another's list.
 *
 * Every success answers the same words, whether a confirmation went out or the
 * address was already on the list, so the form cannot be used to find out who
 * subscribes.
 */
export async function POST(request: NextRequest) {
  if (!NEWSLETTER_FEATURE_ENABLED) return NextResponse.json({ error: 'not_available' }, { status: 503 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  // A hidden field no person fills in. A bot that does gets the success answer and nothing happens.
  if (typeof body.website === 'string' && body.website.trim()) return NextResponse.json({ ok: true });

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!(await underRateLimit(ip))) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  await recordAttempt(ip);

  try {
    const { getTenantFromHost } = await import('@/lib/server-tenant');
    const tenant = await getTenantFromHost(request.headers.get('host') || '');
    if (!tenant) return NextResponse.json({ error: 'This ministry is not taking sign-ups right now.' }, { status: 404 });

    const { toTenantPlan, hasFeature } = await import('@/utils/plan-features');
    if (!hasFeature(toTenantPlan(typeof tenant.plan === 'string' ? tenant.plan : null), 'newsletterAutomation')) {
      return NextResponse.json({ error: 'This ministry is not taking sign-ups right now.' }, { status: 404 });
    }

    const [{ requestSubscription }, { firestoreSubscribeStore }, { sendTransactionalEmail }] = await Promise.all([
      import('@/lib/email/subscribe'),
      import('@/lib/email/subscribe-store'),
      import('@/lib/transactional-email'),
    ]);
    const result = await requestSubscription(
      {
        store: firestoreSubscribeStore,
        origin: request.nextUrl.origin,
        sendConfirmation: ({ to, tenantName, confirmUrl }) => sendTransactionalEmail({
          to,
          churchName: tenantName,
          subject: `Confirm your subscription to ${tenantName}`,
          text: `Please confirm that you want to hear from ${tenantName} by email.\n\nConfirm: ${confirmUrl}\n\nIf you did not ask for this, ignore this message and nothing will be sent to you.`,
        }),
      },
      { tenantId: tenant.id, name: typeof body.name === 'string' ? body.name : '', email: typeof body.email === 'string' ? body.email : '' },
    );
    if (!result.ok) {
      const status = result.code === 'send_failed' ? 502 : result.code === 'tenant_unavailable' ? 404 : 400;
      return NextResponse.json({ error: result.message, code: result.code }, { status });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[email/subscribe]', error);
    captureHandledError(error, { step: 'email-subscribe' });
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
