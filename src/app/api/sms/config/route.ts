import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { PLATFORM_TENANT_ID } from '@/utils/tenant-scope';

export const dynamic = 'force-dynamic';

const TWILIO_DOC = (tenantId: string) =>
  adminDb.collection('tenants').doc(tenantId).collection('integrations').doc('twilio');

/** GET — return config status + templates (never the auth token). */
export async function GET(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (authResult instanceof NextResponse) return authResult;
  const tenantId = authResult.tenantId || PLATFORM_TENANT_ID;

  const snap = await TWILIO_DOC(tenantId).get();
  const d = snap.exists ? snap.data()! : {};
  return NextResponse.json({
    configured: !!(d.accountSid && d.authToken && d.fromNumber),
    accountSid: d.accountSid || '',
    fromNumber: d.fromNumber || '',
    templates: d.templates || {},
    text2give: d.text2give || { keyword: '', responseTemplate: '', enabled: false },
  });
}

/** POST — save credentials and/or automation templates. */
export async function POST(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (authResult instanceof NextResponse) return authResult;
  const tenantId = authResult.tenantId || PLATFORM_TENANT_ID;

  let body: {
    accountSid?: string;
    authToken?: string;
    fromNumber?: string;
    templates?: Record<string, { enabled: boolean; text: string }>;
    text2give?: { keyword?: string; responseTemplate?: string; enabled?: boolean };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (body.accountSid !== undefined) updates.accountSid = body.accountSid.trim();
  // Only overwrite the token when a non-empty value is provided (keeps the
  // existing one when the admin saves without re-entering it).
  if (body.authToken) updates.authToken = body.authToken.trim();
  if (body.fromNumber !== undefined) updates.fromNumber = body.fromNumber.trim();
  if (body.templates !== undefined) updates.templates = body.templates;
  if (body.text2give !== undefined) {
    updates.text2give = {
      keyword: (body.text2give.keyword || '').toUpperCase().trim(),
      responseTemplate: body.text2give.responseTemplate || '',
      enabled: !!body.text2give.enabled,
    };
  }

  await TWILIO_DOC(tenantId).set(updates, { merge: true });

  // Maintain the top-level number → tenant index used by inbound SMS routing
  // (/api/sms/incoming). Write it whenever a from-number is provided.
  if (body.fromNumber !== undefined) {
    const sanitized = body.fromNumber.replace(/\D/g, '');
    if (sanitized) {
      await adminDb.collection('twilioNumbers').doc(sanitized).set({ tenantId }, { merge: true });
    }
  }

  return NextResponse.json({ success: true });
}
