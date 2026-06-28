import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

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

    // Log the interaction
    await adminDb.collection('tenants').doc(tenantId!).collection('smsLogs').add({
      trigger: 'text2give_inbound',
      phone: from,
      status: 'replied',
      errorCode: null,
      sentAt: new Date().toISOString(),
    });

    return twimlResponse(reply);
  } catch (e) {
    console.error('Inbound SMS error:', e);
    return twimlResponse('');
  }
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
