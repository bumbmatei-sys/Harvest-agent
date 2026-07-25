import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { getTwilioConfig, validateTwilio, sendSms } from '@/lib/twilio';
import { PLATFORM_TENANT_ID } from '@/utils/tenant-scope';

export const dynamic = 'force-dynamic';

/**
 * POST — test the tenant's Twilio setup.
 *   { mode: 'connection' }        → verify credentials only
 *   { mode: 'sms', to: '+1555…' } → send a test SMS to the given number
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (authResult instanceof NextResponse) return authResult;
  const tenantId = authResult.tenantId || PLATFORM_TENANT_ID;

  let body: { mode?: string; to?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const cfg = await getTwilioConfig(tenantId);
  if (!cfg) {
    return NextResponse.json({ error: 'Twilio is not configured. Save your credentials first.' }, { status: 400 });
  }

  if (body.mode === 'connection') {
    const ok = await validateTwilio(cfg.accountSid, cfg.authToken);
    return ok
      ? NextResponse.json({ ok: true, message: 'Twilio credentials are valid.' })
      : NextResponse.json({ error: 'Invalid Twilio credentials.' }, { status: 400 });
  }

  const to = (body.to || '').trim();
  if (!to) {
    return NextResponse.json({ error: 'A destination phone number is required.' }, { status: 400 });
  }
  // A test send is a real billed send, so it is metered like any other. Super
  // admins bypass metering (their tenantId is null); every other admin bills to
  // their server-resolved tenant. The source is `cfg.source` — the account these
  // exact credentials belong to — so the send is capped only when it is going
  // out on Harvest's account. The US-only gate and the cap both live inside
  // sendSms, so this route inherits them without its own copy of the rules.
  const result = await sendSms(
    cfg,
    to,
    'Test message from your Harvest ministry app. SMS is working! 🎉',
    { tenantId: authResult.isSuperAdmin ? null : tenantId, source: cfg.source },
  );
  return result.ok
    ? NextResponse.json({ ok: true, message: `Test SMS sent to ${to}.`, segments: result.segments })
    : NextResponse.json(
        { error: result.error || 'Failed to send test SMS.', code: result.code, used: result.used, cap: result.cap },
        { status: result.code === 'sms_cap_reached' ? 403 : 400 },
      );
}
