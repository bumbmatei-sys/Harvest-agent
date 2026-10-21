import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const MAX_BODY = 64 * 1024;

/**
 * Plunk bounce and complaint feedback, from a Plunk workflow webhook step:
 *   POST {origin}/api/email/webhook?kind=bounce      (trigger email.bounce)
 *   POST {origin}/api/email/webhook?kind=complaint   (trigger email.complaint)
 * with the header `Authorization: Bearer <PLUNK_WEBHOOK_SECRET>`.
 *
 * Not behind the newsletter switch, for the reason the unsubscribe route is not:
 * suppressing an address that bounced is protective and must keep working for
 * mail that already went out. It acts on no ministry that did not send the mail:
 * the ministry comes from the sender domain's registry owner.
 */
export async function POST(request: NextRequest) {
  const { WEBHOOK_SECRET_ENV, verifyWebhookSecret, parseFeedback, isTransientBounce, feedbackEventKey } = await import('@/lib/email/webhook');
  const secret = (process.env[WEBHOOK_SECRET_ENV] ?? '').trim();
  if (!secret) {
    console.error(`[email/webhook] refused: ${WEBHOOK_SECRET_ENV} is not set`);
    return NextResponse.json({ ok: false, error: 'not_configured', message: 'The webhook secret is not set on this server.' }, { status: 503 });
  }
  if (!verifyWebhookSecret(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const kind = request.nextUrl.searchParams.get('kind');
  if (kind !== 'bounce' && kind !== 'complaint') {
    return NextResponse.json({ ok: false, error: 'invalid', message: 'kind must be bounce or complaint.' }, { status: 400 });
  }
  let payload: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return NextResponse.json({ ok: false, error: 'invalid', message: 'Body too large.' }, { status: 413 });
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid', message: 'The body is not JSON.' }, { status: 400 });
  }
  const feedback = parseFeedback(payload);
  if (!feedback) {
    return NextResponse.json({ ok: false, error: 'invalid', message: 'The body needs the contact email and the sending address.' }, { status: 400 });
  }
  if (kind === 'bounce' && isTransientBounce(feedback.bounceType)) {
    return NextResponse.json({ ok: true, applied: false, reason: 'transient' });
  }
  try {
    const { assertAdminConfigured } = await import('@/lib/firebase-admin');
    assertAdminConfigured();
    const { buildEmailService } = await import('@/lib/email/runtime');
    const { monthKey } = await import('@/lib/email/volume-cap');
    const service = buildEmailService(request.nextUrl.origin);
    const tenantId = await service.tenantForSender(feedback.from);
    if (!tenantId) {
      console.warn('[email/webhook] no ministry owns the sending domain; nothing applied');
      return NextResponse.json({ ok: true, applied: false, reason: 'unattributed' });
    }
    const applied = await service.recordFeedback(tenantId, feedback.email, kind === 'bounce' ? 'bounced' : 'complained', feedbackEventKey(feedback, monthKey(new Date())));
    return NextResponse.json({ ok: true, applied, reason: applied ? 'recorded' : 'duplicate' });
  } catch (error) {
    console.error(`[email/webhook] ${error instanceof Error ? `${error.name}: ${error.message}` : 'failed'}`);
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
