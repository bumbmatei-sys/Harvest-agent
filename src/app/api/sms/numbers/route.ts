import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { getTenantSmsNumber, SMS_DOC } from '@/lib/sms-send';
import {
  zernioSearchNumbers,
  zernioPurchaseNumber,
  zernioGetNumber,
  zernioReleaseNumber,
  zernioEnableSms,
  zernioReuseRegistration,
} from '@/lib/zernio';
import { PLATFORM_TENANT_ID } from '@/utils/tenant-scope';
import { SMS_FEATURE_ENABLED, SMS_HIDDEN_MESSAGE } from '@/lib/sms-feature';
import { getEffectiveFeatures, toTenantPlan, readTenantAddons } from '@/utils/plan-features';

export const dynamic = 'force-dynamic';

/**
 * THE-314 — buy, show and release the ministry's phone number.
 *
 * 🔴 A REAL CHARGE TO A REAL CHURCH, on Harvest's card first. Every route here
 * follows the THE-253 purchase discipline:
 *
 *   · THE SERVER IS THE ONLY WRITER. The client asks; this route decides,
 *     performs and records. Nothing about the outcome is sent up from the
 *     browser and stored.
 *   · IT NEVER WRITES ENTITLEMENT. No `plan` field, no feature flag, no add-on
 *     count is touched anywhere below — #434 removed a client-side `plan` write
 *     and THE-259's sweep catches a new one. Buying a NUMBER does not grant a
 *     CAPABILITY: the capability is the Ministry plan, written only by the Dodo
 *     webhook, and this route READS it to decide whether the purchase is even
 *     allowed.
 *   · THE UI RE-READS. Every mutation answers with the record this route just
 *     wrote, read back from the provider — never with an optimistic echo of
 *     what the client asked for.
 */

/** 🔴 The Ministry gate, resolved through `getEffectiveFeatures` so an add-on
 * could lift it later with `||` (THE-253) rather than this becoming a hardcoded
 * `plan === 'max'` the day SMS is sold à la carte. Fails closed. */
async function entitled(tenantId: string): Promise<boolean> {
  try {
    const snap = await adminDb.collection('tenants').doc(tenantId).get();
    if (!snap.exists) return false;
    const d = snap.data() as { plan?: unknown; addons?: unknown } | undefined;
    const plan = toTenantPlan(typeof d?.plan === 'string' ? d.plan : null);
    return getEffectiveFeatures(plan, readTenantAddons(d?.addons)).smsAutomation === true;
  } catch (e) {
    console.error('SMS entitlement lookup failed:', e);
    return false;
  }
}

function hidden(): NextResponse | null {
  return SMS_FEATURE_ENABLED ? null : NextResponse.json({ error: SMS_HIDDEN_MESSAGE }, { status: 503 });
}

/**
 * GET — the ministry's number, or (with `?available=1`) an AVAILABILITY
 * PREVIEW for a country and area code.
 *
 * ⚠️ THE PREVIEW IS NOT A SHOPPING CART. The vendor's purchase is payment-first
 * and assigns a number itself; you constrain the country and area, you do not
 * pick the digits. So this answers "is there anything in stock for 615?" and
 * the UI says exactly that. Listing numbers as if one could be chosen and then
 * delivering a different one is precisely the class of false claim this work is
 * meant to avoid.
 */
export async function GET(request: NextRequest) {
  const off = hidden();
  if (off) return off;
  const authResult = await requireAdmin(request);
  if (authResult instanceof NextResponse) return authResult;
  const tenantId = authResult.tenantId || PLATFORM_TENANT_ID;

  const url = new URL(request.url);
  if (url.searchParams.get('available')) {
    if (!(await entitled(tenantId))) {
      return NextResponse.json({ error: 'SMS is available on the Ministry plan.' }, { status: 403 });
    }
    const r = await zernioSearchNumbers({
      country: url.searchParams.get('country') || 'US',
      prefix: url.searchParams.get('prefix') || undefined,
      locality: url.searchParams.get('locality') || undefined,
    });
    if (!r.ok) return NextResponse.json({ error: r.error || 'Could not search numbers.' }, { status: 502 });
    return NextResponse.json({ available: r.data?.numbers?.length ?? 0, numbers: r.data?.numbers ?? [] });
  }

  const number = await getTenantSmsNumber(tenantId);
  if (!number) return NextResponse.json({ number: null });

  // Read the LIVE status back from the provider rather than trusting the stored
  // copy: a number can move from pending registration to active (or be
  // suspended) without Harvest doing anything, and an admin looking at this
  // screen is asking whether it works right now.
  const live = await zernioGetNumber(number.numberId);
  return NextResponse.json({
    number: {
      phoneNumber: number.phoneNumber,
      status: live.ok && live.data ? live.data.status : number.status,
      monthlyCostUsd: (live.ok && live.data?.monthlyCostUsd) ?? number.monthlyCostUsd,
      country: number.country,
      purchasedAt: number.purchasedAt,
    },
  });
}

/** POST — buy a number for this ministry. */
export async function POST(request: NextRequest) {
  const off = hidden();
  if (off) return off;
  const authResult = await requireAdmin(request);
  if (authResult instanceof NextResponse) return authResult;
  const tenantId = authResult.tenantId || PLATFORM_TENANT_ID;

  if (!(await entitled(tenantId))) {
    return NextResponse.json({ error: 'SMS is available on the Ministry plan.' }, { status: 403 });
  }

  // One number per ministry. Checked before spending: a second purchase is a
  // second monthly charge on Harvest's card that no church asked for.
  const existing = await getTenantSmsNumber(tenantId);
  if (existing) {
    return NextResponse.json(
      { error: `This ministry already has ${existing.phoneNumber}. Release it before buying another.` },
      { status: 409 },
    );
  }

  let body: { country?: string; areaCode?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  // 🔴 The idempotency key is derived from the TENANT, not sent by the client.
  // A client-chosen key could be varied on every retry, and each variation buys
  // another number and starts another monthly charge.
  const purchaseIntentId = `harvest-${tenantId}`;

  const bought = await zernioPurchaseNumber({
    profileId: tenantId,
    country: body.country || 'US',
    areaCode: (body.areaCode || '').replace(/\D/g, '') || undefined,
    purchaseIntentId,
  });

  if (!bought.ok || !bought.data) {
    // A regulated country answers with an identity-check URL rather than a
    // number. Passed through so the admin can complete it; Harvest neither
    // collects nor stores the documents.
    return NextResponse.json({ error: bought.error || 'Could not buy a number.' }, { status: 502 });
  }
  const number = bought.data;

  // Enable SMS and attach Harvest's existing approved carrier registration.
  // 🔴 THE REGISTRATION IS PER BRAND, NOT PER CHURCH: reusing it is what makes
  // one church's number cost $3/month instead of another brand approval. Both
  // calls are best-effort — a number that exists but cannot text yet is a
  // `pending_registration` status the admin can see, not a lost purchase.
  await zernioEnableSms(number.numberId).catch(() => null);
  const reuse = await zernioReuseRegistration(number.numberId).catch(() => null);
  const status = reuse && reuse.ok ? number.status : 'pending_registration';

  await SMS_DOC(tenantId).set(
    {
      numberId: number.numberId,
      phoneNumber: number.phoneNumber,
      profileId: tenantId,
      status,
      country: body.country || 'US',
      monthlyCostUsd: number.monthlyCostUsd,
      purchasedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  // The inbound index, written SERVER-SIDE from the number the provider
  // actually assigned. This is the only writer: a client that could name its
  // own number here could point another ministry's inbound traffic — and its
  // Text-to-Give replies — at itself.
  const sanitized = number.phoneNumber.replace(/\D/g, '');
  if (sanitized) {
    await adminDb.collection('smsNumbers').doc(sanitized).set({ tenantId }, { merge: true });
  }

  return NextResponse.json({
    number: {
      phoneNumber: number.phoneNumber,
      status,
      monthlyCostUsd: number.monthlyCostUsd,
      country: body.country || 'US',
    },
    ...(number.kycUrl ? { kycUrl: number.kycUrl } : {}),
  });
}

/**
 * DELETE — release the number.
 *
 * 🔴 IRREVERSIBLE. The number goes back to the carrier pool and cannot be
 * recovered; the vendor documents no port-out, so it also cannot be moved to an
 * account the church controls. The admin screen says so before it calls this.
 */
export async function DELETE(request: NextRequest) {
  const off = hidden();
  if (off) return off;
  const authResult = await requireAdmin(request);
  if (authResult instanceof NextResponse) return authResult;
  const tenantId = authResult.tenantId || PLATFORM_TENANT_ID;

  const number = await getTenantSmsNumber(tenantId);
  if (!number) return NextResponse.json({ error: 'This ministry has no SMS number.' }, { status: 404 });

  const released = await zernioReleaseNumber(number.numberId);
  if (!released.ok) {
    // The provider still holds it, so Harvest is still being charged for it.
    // Leaving the local record in place keeps the two in agreement rather than
    // hiding a number that is still billing.
    return NextResponse.json({ error: released.error || 'Could not release the number.' }, { status: 502 });
  }

  // Clear the number but KEEP the templates and the Text-to-Give keyword: they
  // are tenant content, and a church that buys another number should not have
  // to retype them. Same reasoning THE-245 gave for not deleting them.
  await SMS_DOC(tenantId).set(
    { numberId: null, phoneNumber: null, status: 'released', releasedAt: new Date().toISOString() },
    { merge: true },
  );
  const sanitized = number.phoneNumber.replace(/\D/g, '');
  if (sanitized) await adminDb.collection('smsNumbers').doc(sanitized).delete().catch(() => {});

  return NextResponse.json({ released: true, number: null });
}
