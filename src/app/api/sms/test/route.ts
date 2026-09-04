import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { getTenantSmsNumber, sendSms } from '@/lib/sms-send';
import { zernioGetNumber } from '@/lib/zernio';
import { PLATFORM_TENANT_ID } from '@/utils/tenant-scope';
import { SMS_FEATURE_ENABLED, SMS_HIDDEN_MESSAGE } from '@/lib/sms-feature';

export const dynamic = 'force-dynamic';

/**
 * POST — test the tenant's SMS setup.
 *   { mode: 'connection' }        → check the number's live status at the vendor
 *   { mode: 'sms', to: '+1555…' } → send a test SMS to the given number
 *
 * ⚠️ THE-314 CHANGED WHAT 'connection' MEANS, and the change is the point.
 * Under bring-your-own it validated the CHURCH'S credentials. There are none
 * now — Harvest resells on one account — so validating anything credential-
 * shaped would be reporting on HARVEST'S account on a screen where an admin is
 * asking about THEIRS. That exact trap is the loose end twilio-platform.ts
 * flagged for the day a shared account went live. It now answers the question
 * the admin is actually asking: is MY number live and able to deliver?
 */
export async function POST(request: NextRequest) {
  // THE-245 — refused while the SMS feature is hidden. A test send is a real
  // billed send, so it is gated like any other.
  if (!SMS_FEATURE_ENABLED) {
    return NextResponse.json({ error: SMS_HIDDEN_MESSAGE }, { status: 503 });
  }
  const authResult = await requireAdmin(request);
  if (authResult instanceof NextResponse) return authResult;
  const tenantId = authResult.tenantId || PLATFORM_TENANT_ID;

  let body: { mode?: string; to?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const number = await getTenantSmsNumber(tenantId);
  if (!number) {
    return NextResponse.json({ error: 'This ministry has no SMS number yet. Buy one first.' }, { status: 400 });
  }

  if (body.mode === 'connection') {
    const live = await zernioGetNumber(number.numberId);
    if (!live.ok || !live.data) {
      return NextResponse.json({ error: live.error || 'Could not reach your number.' }, { status: 400 });
    }
    return live.data.status === 'active'
      ? NextResponse.json({ ok: true, message: `${live.data.phoneNumber} is active and can send.` })
      : NextResponse.json(
          { error: `${live.data.phoneNumber} is not ready to send yet (${live.data.status}).` },
          { status: 400 },
        );
  }

  const to = (body.to || '').trim();
  if (!to) {
    return NextResponse.json({ error: 'A destination phone number is required.' }, { status: 400 });
  }
  // A test send is a real billed send on HARVEST'S account, so it is metered
  // like any other. Super admins bypass metering (their tenantId is null);
  // every other admin bills to their server-resolved tenant. The plan gate, the
  // STOP check, the US-only gate and the cap all live inside sendSms, so this
  // route inherits them without its own copy of the rules.
  const result = await sendSms(
    number,
    to,
    'Test message from your Harvest ministry app. SMS is working.',
    { tenantId: authResult.isSuperAdmin ? null : tenantId, source: 'platform' },
  );
  return result.ok
    ? NextResponse.json({ ok: true, message: `Test SMS sent to ${to}.`, segments: result.segments })
    : NextResponse.json(
        { error: result.error || 'Failed to send test SMS.', code: result.code, used: result.used, cap: result.cap },
        { status: result.code === 'sms_cap_reached' ? 403 : 400 },
      );
}
