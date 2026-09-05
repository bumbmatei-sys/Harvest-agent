import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { sendSms, getTenantSmsNumber, type TenantSmsNumber } from '@/lib/sms-send';
import { verifyZernioSignature, webhookSecret } from '@/lib/zernio';
import { isStopKeyword, isStartKeyword, recordOptOut, recordOptIn } from '@/lib/sms-optout';
import { captureHandledError } from '@/lib/money-path-sentry';
import { SMS_FEATURE_ENABLED, SMS_HIDDEN_MESSAGE } from '@/lib/sms-feature';
import { GIVING_PATH } from '@/components/donations/giving-share';

export const dynamic = 'force-dynamic';

/**
 * THE PUBLIC, UNAUTHENTICATED INBOUND WEBHOOK.
 *
 * The provider POSTs a JSON event here whenever one of Harvest's numbers
 * receives a message. Two things happen on this route and nothing else does:
 * STOP is honoured, and a Text-to-Give keyword gets its giving link back.
 *
 * ─── 🔴 IT IS NOW SIGNED, AND IT WAS NOT BEFORE ──────────────────────────────
 *
 * ⚠️ THE TWILIO PATH VERIFIED NOTHING. There was no `X-Twilio-Signature` check
 * on this route — or anywhere in the repository — before THE-314. Anyone who
 * learned a tenant's keyword and this URL could forge an inbound message and
 * make Harvest send a real, billed reply to any number they chose. That was
 * survivable only because SMS_FEATURE_ENABLED was false and this route answered
 * 503 to everyone.
 *
 * Turning SMS on WITHOUT a signature check would have opened that door on a
 * RESELLER account, where the billed reply is Harvest's money and the carrier
 * complaint lands on Harvest's brand registration. So the check is new work,
 * not a port, and it is the first thing that happens after the master switch.
 *
 * It FAILS CLOSED: no secret configured, no header, a malformed header or a
 * mismatch all answer 401 and touch nothing. "We could not check" and "it is
 * genuine" are not the same answer.
 *
 * ─── Why STOP is handled here even though the vendor already does ────────────
 *
 * The vendor opts the sender out at the CARRIER and refuses later sends with a
 * 409. Harvest mirrors it anyway — see sms-optout.ts for the three reasons.
 * This route is where the mirror is written, because this is where the word
 * STOP actually arrives.
 */
export async function POST(request: NextRequest) {
  // ── THE-245 — the gate that is not about the UI ────────────────────────────
  //
  // FIRST STATEMENT IN THE HANDLER, before the body is even read. 503 rather
  // than an empty 200: the route EXISTS and is coming back, which is what a
  // provider retry and an operator reading the logs should both be told.
  if (!SMS_FEATURE_ENABLED) {
    return NextResponse.json({ error: SMS_HIDDEN_MESSAGE }, { status: 503 });
  }

  // ── 🔴 SIGNATURE — before parsing, before any Firestore read ───────────────
  //
  // The RAW body is what was signed, so it is read as text and verified before
  // anything interprets it. Re-serialising the parsed JSON would change the
  // bytes and reject every genuine delivery.
  const raw = await request.text();
  const signature =
    request.headers.get('x-zernio-signature') ?? request.headers.get('x-late-signature');
  if (!verifyZernioSignature(raw, signature, webhookSecret())) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });
  }

  try {
    const event = JSON.parse(raw) as {
      type?: string;
      event?: string;
      data?: Record<string, any>;
      message?: Record<string, any>;
    };

    // The provider sends one shape for every platform, so an SMS event is
    // identified rather than assumed: anything that is not an inbound SMS is
    // acknowledged and ignored. A 200 here means "received", not "acted on" —
    // answering anything else would make the provider retry an event Harvest
    // has no use for, and disable the webhook after ten failures.
    const kind = event.type || event.event || '';
    const msg = (event.message || event.data?.message || event.data || {}) as Record<string, any>;
    const platform = String(msg.platform || event.data?.platform || '').toLowerCase();
    if (kind && kind !== 'message.received') return ack();
    if (platform && platform !== 'sms') return ack();

    const from = String(msg.from || msg.sender || '').trim();
    const to = String(msg.to || msg.recipient || '').trim();
    const text = String(msg.text || msg.body || '').trim();
    if (!from || !to) return ack();

    // Resolve the tenant from the number that RECEIVED the message, via the
    // top-level smsNumbers/{digits} index. Never from anything the texter
    // controls — the billing tenant is not a field in the payload.
    const sanitized = to.replace(/\D/g, '');
    const indexSnap = await adminDb.collection('smsNumbers').doc(sanitized).get();
    const tenantId: string | null = indexSnap.exists ? indexSnap.data()?.tenantId || null : null;
    if (!tenantId) return ack();

    // ── 🔴 STOP, BEFORE ANYTHING ELSE ────────────────────────────────────────
    //
    // Ahead of the Text-to-Give branch deliberately. A member who texts STOP
    // has asked to stop hearing from this church, and that must be recorded
    // whether or not the church has Text-to-Give configured, whether or not the
    // word matches a keyword, and whether or not anything else on this route
    // works. It is also recorded BEFORE any reply is composed, so no reply can
    // be sent to someone who just opted out.
    //
    // No confirmation text is sent back. The carrier sends its own STOP
    // acknowledgement, and a second one from Harvest would be a message to
    // somebody who just asked for no more messages — billed, and on a number
    // whose reputation this control exists to protect.
    if (isStopKeyword(text)) {
      await recordOptOut(tenantId, from, text);
      await logInbound(tenantId, from, 'opted_out', null);
      return ack();
    }

    // The matching opt-IN. A member who stopped must be able to come back
    // without asking an admin — the carriers require this half too.
    if (isStartKeyword(text)) {
      await recordOptIn(tenantId, from);
      await logInbound(tenantId, from, 'opted_in', null);
      return ack();
    }

    // ── Text-to-Give ─────────────────────────────────────────────────────────
    const number: TenantSmsNumber | null = await getTenantSmsNumber(tenantId);
    const t2g = number?.text2give;
    if (!number || !t2g?.keyword || !t2g.enabled) return ack();

    if (text.toUpperCase() !== String(t2g.keyword).toUpperCase().trim()) return ack();

    // THE-303 — the PUBLIC giving route. A Text-to-Give reply goes to a phone
    // that may have no Harvest session at all, and `/?giving=1` was the SPA
    // root: the texter asked how to give and was shown a sign-in form.
    const givingLink = `https://${tenantId}.theharvest.app${GIVING_PATH}`;
    const template = t2g.responseTemplate || 'Thank you! Give here: {link}';
    const reply = template.replace('{link}', givingLink);

    // The reply goes through the ONE funnel like every other send, so it is
    // plan-gated, STOP-checked, destination-gated and METERED. A reply that
    // reached the provider directly would be an unmetered send billed to
    // Harvest and triggerable by anyone holding the number.
    const result = await sendSms(number, from, reply, { tenantId, source: 'platform' });
    await logInbound(
      tenantId,
      from,
      result.ok ? 'replied' : result.code === 'provider_error' || result.code === 'send_failed' ? 'failed' : 'blocked',
      result.error || null,
      result.ok ? result.segments ?? null : null,
    );
    return ack();
  } catch (e) {
    console.error('Inbound SMS error:', e);
    captureHandledError(e, { step: 'sms-inbound' });
    return ack();
  }
}

/** Acknowledge the delivery. Any 2xx tells the provider the event was received;
 * it retries otherwise and disables the webhook after ten consecutive
 * failures. */
function ack(): NextResponse {
  return NextResponse.json({ received: true });
}

/** Record an inbound interaction on the tenant's smsLogs — the surface an admin
 * uses to see why a reply did or didn't go out, and now also the surface where
 * an opt-out becomes visible. Best-effort. */
async function logInbound(
  tenantId: string,
  phone: string,
  status: string,
  errorCode: string | null,
  segments: number | null = null,
): Promise<void> {
  await adminDb.collection('tenants').doc(tenantId).collection('smsLogs').add({
    trigger: 'sms_inbound',
    phone,
    status,
    errorCode,
    segments,
    sentAt: new Date().toISOString(),
  }).catch((e) => console.warn('Inbound SMS log failed:', e));
}
