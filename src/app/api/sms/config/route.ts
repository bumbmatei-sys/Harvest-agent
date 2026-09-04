import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { getTenantSmsNumber, SMS_DOC } from '@/lib/sms-send';
import { PLATFORM_TENANT_ID } from '@/utils/tenant-scope';
import { SMS_FEATURE_ENABLED, SMS_HIDDEN_MESSAGE } from '@/lib/sms-feature';

export const dynamic = 'force-dynamic';

/**
 * The tenant's SMS CONTENT — automation templates and the Text-to-Give keyword.
 *
 * 🔴 IT NO LONGER CARRIES CREDENTIALS (THE-314). Under bring-your-own this
 * route accepted an account SID, an auth token and a from-number. Harvest now
 * resells on ONE account: a church holds no vendor credential, so there is
 * nothing here to enter and nothing to leak. The number itself is bought and
 * released through `/api/sms/numbers`, which is a money path and is separate
 * for that reason.
 *
 * What survives is exactly what was always tenant content rather than vendor
 * configuration — the templates and the keyword — and it survives on purpose:
 * a church that configured Text-to-Give before the swap finds its keyword
 * unchanged afterwards.
 */
export async function GET(request: NextRequest) {
  // THE-245 — refused while the SMS feature is hidden.
  if (!SMS_FEATURE_ENABLED) {
    return NextResponse.json({ error: SMS_HIDDEN_MESSAGE }, { status: 503 });
  }
  const authResult = await requireAdmin(request);
  if (authResult instanceof NextResponse) return authResult;
  const tenantId = authResult.tenantId || PLATFORM_TENANT_ID;

  const number = await getTenantSmsNumber(tenantId);
  return NextResponse.json({
    configured: !!number,
    fromNumber: number?.phoneNumber || '',
    templates: number?.templates || {},
    text2give: number?.text2give || { keyword: '', responseTemplate: '', enabled: false },
  });
}

/** POST — save automation templates and/or the Text-to-Give keyword. */
export async function POST(request: NextRequest) {
  // THE-245 — refused while the SMS feature is hidden.
  if (!SMS_FEATURE_ENABLED) {
    return NextResponse.json({ error: SMS_HIDDEN_MESSAGE }, { status: 503 });
  }
  const authResult = await requireAdmin(request);
  if (authResult instanceof NextResponse) return authResult;
  const tenantId = authResult.tenantId || PLATFORM_TENANT_ID;

  let body: {
    templates?: Record<string, { enabled: boolean; text: string }>;
    text2give?: { keyword?: string; responseTemplate?: string; enabled?: boolean };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (body.templates !== undefined) updates.templates = body.templates;
  if (body.text2give !== undefined) {
    updates.text2give = {
      keyword: (body.text2give.keyword || '').toUpperCase().trim(),
      responseTemplate: body.text2give.responseTemplate || '',
      enabled: !!body.text2give.enabled,
    };
  }

  // 🔴 NO NUMBER IS WRITTEN HERE, and no inbound index entry either. Both are
  // owned by the purchase route: a client that could name its own from-number
  // could point another ministry's inbound traffic at itself.
  await SMS_DOC(tenantId).set(updates, { merge: true });

  return NextResponse.json({ success: true });
}
