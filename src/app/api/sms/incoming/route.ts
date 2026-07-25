import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { sendSms, resolveTwilioConfig, type ResolvedTwilioConfig } from '@/lib/twilio';
import { captureHandledError } from '@/lib/money-path-sentry';

export const dynamic = 'force-dynamic';

// Twilio sends application/x-www-form-urlencoded for inbound SMS webhooks.
export async function POST(request: NextRequest) {
  try {
    const text = await request.text();
    const params = new URLSearchParams(text);
    const body = (params.get('Body') || '').trim().toUpperCase();
    const from = params.get('From') || '';
    const to = params.get('To') || ''; // The Twilio number that received the message

    if (!body || !from || !to) {
      return twimlResponse(''); // Empty response — don't reply to malformed requests
    }

    // Find the tenant whose Twilio number matches the `to` number via the
    // top-level twilioNumbers/{sanitizedNumber} → { tenantId } index doc.
    const sanitized = to.replace(/\D/g, '');
    const indexSnap = await adminDb.collection('twilioNumbers').doc(sanitized).get();

    let tenantId: string | null = null;
    let t2gConfig: any = null;
    let twilioCfg: ResolvedTwilioConfig | null = null;

    if (indexSnap.exists) {
      tenantId = indexSnap.data()?.tenantId || null;
    }

    if (tenantId) {
      const cfgSnap = await adminDb
        .collection('tenants').doc(tenantId)
        .collection('integrations').doc('twilio')
        .get();

      if (cfgSnap.exists) {
        const d = cfgSnap.data() || {};
        t2gConfig = d.text2give || null;
        // This route already has the integrations doc in hand, so it resolves
        // through the SHARED resolver rather than re-implementing the check —
        // that is what guarantees the credentials it sends with and the source
        // it declares below are the same decision, and it will pick up the
        // platform fallback for free the day that account exists.
        twilioCfg = resolveTwilioConfig(d);
      }
    }

    if (!t2gConfig || !t2gConfig.keyword || !t2gConfig.enabled) {
      return twimlResponse(''); // Not configured — no reply
    }

    const keyword = (t2gConfig.keyword || '').toUpperCase().trim();

    if (body !== keyword) {
      return twimlResponse(''); // Not our keyword — no reply
    }

    // Build giving link
    const givingLink = `https://${tenantId}.theharvest.app/?giving=1`;

    // Render response template
    const template = t2gConfig.responseTemplate || 'Thank you! Give here: {link}';
    const reply = template.replace('{link}', givingLink);

    // The reply used to be returned as a TwiML <Message>, which makes Twilio
    // send a BILLED outbound SMS that never touched sendSms — so it bypassed
    // both the US-only destination gate and the tenant's segment cap. Anyone who
    // knew a tenant's keyword could run their bill up from outside the app.
    // It now goes through sendSms like every other send path (the one funnel),
    // and the webhook answers with EMPTY TwiML so Twilio doesn't send it twice.
    // The message the sender receives is identical.
    //
    // The billing tenant is resolved server-side from the twilioNumbers index on
    // the `To` number, never from anything the texter controls.
    if (!twilioCfg) {
      // Text-to-Give is configured but the credentials are not — nothing to send
      // with. Log it rather than dropping it silently.
      await logInbound(tenantId!, from, 'failed', 'Twilio credentials are not configured.');
      return twimlResponse('');
    }

    const result = await sendSms(twilioCfg, from, reply, { tenantId, source: twilioCfg.source });
    await logInbound(
      tenantId!,
      from,
      result.ok ? 'replied' : (result.code === 'non_us_destination' || result.code === 'sms_cap_reached' ? 'blocked' : 'failed'),
      result.error || null,
      result.ok ? result.segments ?? null : null,
    );

    return twimlResponse('');
  } catch (e) {
    console.error('Inbound SMS error:', e);
    // Text-to-Give is silent by construction — the answer is empty TwiML either
    // way, so a texter who asked for a giving link and got nothing looks identical
    // to a texter who was never meant to get one. Nothing else reports this.
    // No tenantId: it is resolved inside the try, so the catch cannot see it.
    captureHandledError(e, { step: 'text2give-inbound' });
    return twimlResponse('');
  }
}

/** Record a Text-to-Give interaction on the tenant's smsLogs — the surface an
 * admin uses to see why a reply did or didn't go out. Best-effort. */
async function logInbound(
  tenantId: string,
  phone: string,
  status: string,
  errorCode: string | null,
  segments: number | null = null,
): Promise<void> {
  await adminDb.collection('tenants').doc(tenantId).collection('smsLogs').add({
    trigger: 'text2give_inbound',
    phone,
    status,
    errorCode,
    segments,
    sentAt: new Date().toISOString(),
  }).catch((e) => console.warn('Text-to-Give log failed:', e));
}

function twimlResponse(message: string): NextResponse {
  const xml = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new NextResponse(xml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

/** Escape XML special characters so the TwiML body stays well-formed. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
