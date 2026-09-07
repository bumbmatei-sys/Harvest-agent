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
  zernioSmsNumberType,
  zernioListCountries,
  zernioAreaOptions,
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
 * THE-330 — THE COUNTRY CATALOGUE CACHE.
 *
 * ─── The strategy, stated because it is a trade about money ──────────────────
 *
 * A short-lived in-process memo, {@link COUNTRY_CACHE_TTL_MS} long, keyed by
 * nothing: the catalogue is Harvest's account-wide rate card and is identical
 * for every tenant, so one entry serves them all. It exists because the picker
 * re-reads the catalogue on every mount of the SMS screen and the answer only
 * moves when the provider's rate card does.
 *
 * 🔴 IT NEVER OUTLIVES ITS TTL, AND IT NEVER COVERS A FAILURE. Two rules, and
 * both are the same rule:
 *   · Past the TTL the entry is DROPPED and the provider is asked again. If
 *     that ask fails the route answers 502 — the church is told the list could
 *     not be loaded. It is never handed an old rate card dressed as a current
 *     one, because it is about to agree to a recurring charge at those prices
 *     and to stock and KYC terms that may have moved.
 *   · Only a SUCCESS is ever written, so a failed fetch cannot poison it.
 *
 * ⚠️ IN-PROCESS, so it is per serverless instance and empties on redeploy. That
 * is a property, not a gap: the worst case is an extra call to the provider,
 * and the alternative — a shared, durable copy of a live rate card — is a
 * second source of truth for prices that would need its own invalidation.
 *
 * How a stale cache surfaces: it cannot become stale. `fetchedAt` rides on the
 * response so the screen can say when the list was read, and `cached` says
 * whether this answer came from the memo.
 */
const COUNTRY_CACHE_TTL_MS = 10 * 60 * 1000;

let countryCache: { countries: unknown[]; fetchedAt: string; at: number } | null = null;

function readCountryCache(): { countries: unknown[]; fetchedAt: string } | null {
  if (!countryCache) return null;
  if (Date.now() - countryCache.at > COUNTRY_CACHE_TTL_MS) {
    // Dropped rather than served. See the note above.
    countryCache = null;
    return null;
  }
  return { countries: countryCache.countries, fetchedAt: countryCache.fetchedAt };
}

function writeCountryCache(countries: unknown[]): string {
  const fetchedAt = new Date().toISOString();
  countryCache = { countries, fetchedAt, at: Date.now() };
  return fetchedAt;
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

  /**
   * THE-330 — `?countries=1`: THE CATALOGUE THE COUNTRY PICKER IS BUILT FROM.
   *
   * 🔴 FETCHED FROM THE PROVIDER, NEVER A LIST IN THE BUNDLE. This is the whole
   * ticket: the country was a free-text box, so a church had to already know
   * which two letters were offerable AND which of them could text. Both answers
   * are in this one response, per country and per type.
   *
   * ⚠️ A FAILURE ANSWERS 502, NOT AN EMPTY LIST. An empty picker reads as "no
   * countries are available", which is a lie about the provider's inventory —
   * the Silent-Failure Rule, on the screen where it costs the most.
   */
  if (url.searchParams.get('countries')) {
    if (!(await entitled(tenantId))) {
      return NextResponse.json({ error: 'SMS is available on the Ministry plan.' }, { status: 403 });
    }
    const cached = readCountryCache();
    if (cached) {
      return NextResponse.json({ countries: cached.countries, fetchedAt: cached.fetchedAt, cached: true });
    }
    const r = await zernioListCountries();
    if (!r.ok || !r.data) {
      // 🔴 NO STALE FALLBACK. A cache older than its TTL is not served to paper
      // over a failed refresh: the church would be shown prices and stock that
      // may have moved, on the screen where it commits to a monthly charge.
      return NextResponse.json(
        { error: r.error || 'Could not load the list of countries from the provider.' },
        { status: 502 },
      );
    }
    const fetchedAt = writeCountryCache(r.data.countries);
    return NextResponse.json({ countries: r.data.countries, fetchedAt, cached: false });
  }

  /**
   * THE-330 — `?areas=1`: THE AREA CODES THAT ACTUALLY HAVE STOCK.
   *
   * 🔴 SO AN AREA CODE IS CHOSEN, NOT TYPED. `areaCode` is a hard constraint on
   * the purchase: an area with no inventory fails with 409
   * `AREA_CODE_UNAVAILABLE` and the provider does NOT substitute another area.
   * The founder typed `615` against Germany. This endpoint is what would have
   * told him, before the money.
   */
  if (url.searchParams.get('areas')) {
    if (!(await entitled(tenantId))) {
      return NextResponse.json({ error: 'SMS is available on the Ministry plan.' }, { status: 403 });
    }
    const r = await zernioAreaOptions({
      country: url.searchParams.get('country') || 'US',
      numberType: url.searchParams.get('type') || undefined,
    });
    if (!r.ok || !r.data) {
      return NextResponse.json({ error: r.error || 'Could not load area codes.' }, { status: 502 });
    }
    return NextResponse.json({ areaOptions: r.data.areaOptions });
  }

  if (url.searchParams.get('available')) {
    if (!(await entitled(tenantId))) {
      return NextResponse.json({ error: 'SMS is available on the Ministry plan.' }, { status: 403 });
    }
    const r = await zernioSearchNumbers({
      country: url.searchParams.get('country') || 'US',
      // 🔴 THE-330 — the TYPE the church chose, carried into the preview so the
      // pool previewed is the pool bought from. Omitting it previews the
      // country's WhatsApp-safe default, which is a different pool in every
      // country whose default is not the SMS-capable one.
      type: url.searchParams.get('type') || undefined,
      prefix: url.searchParams.get('prefix') || undefined,
      locality: url.searchParams.get('locality') || undefined,
    });
    if (!r.ok) return NextResponse.json({ error: r.error || 'Could not search numbers.' }, { status: 502 });
    // `numbers` now carries each number's own `features`, which the UI badges
    // per row: two numbers of the same country and type can differ.
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

  let body: { country?: string; areaCode?: string; numberType?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  // 🔴 The idempotency key is derived from the TENANT, not sent by the client.
  // A client-chosen key could be varied on every retry, and each variation buys
  // another number and starts another monthly charge.
  const purchaseIntentId = `harvest-${tenantId}`;

  const country = body.country || 'US';

  /**
   * 🔴 THE-318 — WHICH TYPE CAN TEXT, asked BEFORE the money is spent.
   *
   * `wantsSms: true` requires an SMS-capable number type, and the type that is
   * SMS-capable is per country. The vendor's availability endpoint answers both
   * questions at once for the SMS pool specifically.
   *
   * ⚠️ A LOOKUP FAILURE DOES NOT BLOCK THE PURCHASE — see `zernioSmsNumberType`.
   * `wantsSms: true` is sent either way, so the worst case is the vendor
   * refusing loudly, never a silent voice-only number. But a definite
   * `available: false` DOES block it: that is the vendor saying it has no
   * SMS-capable stock for this country, and buying anyway would charge a church
   * for a number that cannot text — precisely this ticket's defect.
   */
  const pool = await zernioSmsNumberType(country);

  /**
   * 🔴 THE-330 — THE CHOSEN TYPE IS GATED SERVER-SIDE, not merely narrowed in
   * the picker.
   *
   * The screen now offers a TYPE, and the type is what decides whether a number
   * can text: in GB only `mobile` texts, in the US only `local`. A client that
   * names a type — an old tab, a crafted request, a future caller — must not be
   * able to spend a church's money on a mute number just because the picker
   * would not have offered it. So the server re-asks the question it already
   * trusts for this: `zernioSmsNumberType` IS the SMS pool's type for the
   * country, resolved from the provider's live inventory.
   *
   * ⚠️ THE-318'S RESOLUTION IS UNCHANGED AND STILL THE FALLBACK. This adds a
   * comparison, not a second source: when the client names nothing, the pool's
   * own type is used exactly as before. And when the lookup could not be made
   * (`numberType: null`) NOTHING IS REFUSED — the request goes through with
   * `wantsSms: true` still set, which the provider either fills from the SMS
   * pool or rejects outright. Failing a purchase on a flaky read of a
   * refinement endpoint would trade this ticket's bug for an outage, which is
   * the same reasoning THE-318 recorded on `zernioSmsNumberType` itself.
   */
  const requestedType = typeof body.numberType === 'string' ? body.numberType.trim() : '';
  if (requestedType && pool.numberType && requestedType !== pool.numberType) {
    return NextResponse.json(
      {
        error: `A ${requestedType} number in ${country} cannot send or receive SMS. In ${country} the texting type is ${pool.numberType}. Nothing has been charged.`,
        code: 'TYPE_NOT_SMS_CAPABLE',
      },
      { status: 409 },
    );
  }

  if (pool.available === false) {
    return NextResponse.json(
      {
        error: `There are no SMS-capable numbers available in ${country} right now. Please try another country, or try again later.`,
        code: 'SMS_POOL_UNAVAILABLE',
      },
      { status: 409 },
    );
  }

  const bought = await zernioPurchaseNumber({
    profileId: tenantId,
    country,
    areaCode: (body.areaCode || '').replace(/\D/g, '') || undefined,
    purchaseIntentId,
    /**
     * 🔴 THE-318'S TYPE, UNCHANGED. `pool.numberType` is still what is sent and
     * it is still omitted when the lookup could not be made, so `wantsSms: true`
     * is never paired with a type Harvest guessed.
     *
     * ⚠️ THE CLIENT'S CHOICE DOES NOT WIDEN THIS. The gate above has already
     * established that a named type either MATCHES the SMS pool or was
     * unverifiable; there is no path on which a client-named type reaches the
     * provider in place of the pool's own answer.
     */
    ...(pool.numberType ? { numberType: pool.numberType } : {}),
    /**
     * 🔴 HARVEST IS THE RESELLER: ONE VENDOR ACCOUNT, EVERY CHURCH.
     *
     * The vendor rejects any second purchase within 10 minutes of a previous
     * one with 409 PURCHASE_VELOCITY, as duplicate protection for a single
     * buyer. Under the reseller model that window spans DIFFERENT CUSTOMERS:
     * two churches signing up ten minutes apart is an ordinary Tuesday, and the
     * second one would be told its purchase failed.
     *
     * ⚠️ Harvest does not lose the protection by confirming here, because it
     * never relied on the vendor's window for it. Duplicate protection is
     * enforced ABOVE this call and more precisely: the one-number-per-ministry
     * check a few lines up refuses a second purchase for the same tenant
     * outright, and `purchaseIntentId` is derived from the tenant so a retry
     * replays the original order rather than buying again. What the vendor's
     * window would actually catch here is one church's double-click, which
     * those two already catch — and what it would block is another church.
     */
    allowMultiple: true,
  });

  if (!bought.ok || !bought.data) {
    // 🔴 THE-318 — the vendor's 409s mean opposite things and are answered
    // separately. Collapsed into one "Provider error 409" they told an admin
    // nothing they could act on, and one of them is not even a fault.
    if (bought.code === 'PURCHASE_VELOCITY') {
      return NextResponse.json(
        {
          error:
            'Another number was bought on the platform in the last few minutes, so the provider is holding this order back. Nothing was charged — please try again in about ten minutes.',
          code: 'PURCHASE_VELOCITY',
        },
        { status: 409 },
      );
    }
    if (bought.code === 'AREA_CODE_UNAVAILABLE') {
      // The vendor FAILS rather than assigning a number from another area, so
      // the request is answerable: the area is empty, choose another. Saying so
      // is the difference between an admin retrying usefully and giving up.
      return NextResponse.json(
        {
          error: `There are no numbers available in area code ${(body.areaCode || '').replace(/\D/g, '')}. Nothing was charged — please choose a different area code, or leave it blank for any area.`,
          code: 'AREA_CODE_UNAVAILABLE',
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: bought.error || 'Could not buy a number.', ...(bought.code ? { code: bought.code } : {}) },
      { status: bought.status === 409 ? 409 : 502 },
    );
  }
  const number = bought.data;

  /**
   * 🔴 THE-318 — a regulated country answers 202 `kyc_required`: NOTHING was
   * ordered and nothing is billed, but there IS an address the church must
   * visit. It carries no number, so nothing is recorded — writing a number
   * record here would claim a purchase that did not happen.
   *
   * ⚠️ Before this ticket the whole answer was discarded and the admin was told
   * "could not buy a number", losing the only thing that would have let them
   * finish.
   */
  if (number.kycRequired) {
    return NextResponse.json(
      {
        number: null,
        status: 'kyc_required',
        ...(number.kycUrl ? { kycUrl: number.kycUrl } : {}),
        error:
          'This country needs an identity check before the number can be ordered. Nothing has been charged yet.',
      },
      { status: 202 },
    );
  }

  /**
   * 🔴 THE-318 — THE PROFILE IS THE VENDOR'S ASSIGNMENT, NOT HARVEST'S REQUEST.
   *
   * One number = one profile. `tenantId` above is a PREFERENCE: when that
   * profile already holds a number the vendor assigns the next free profile
   * instead, or creates one, and reports what it actually did here. So the
   * per-church profile is established by RECORDING THE ANSWER, not by assuming
   * the question — which is what the code did before, storing `tenantId`
   * unconditionally.
   *
   * ⚠️ A response with no profile on it is not recorded as `tenantId` "for now".
   * The profile is how the vendor scopes every number and every message, and a
   * binding Harvest invented would attribute one church's traffic to another.
   * Null is stored as null, and the admin screen can show the number without
   * Harvest asserting a profile it was never told.
   */
  //  `?? null` rather than a bare read: Firestore REJECTS an undefined field
  // value outright, so a response shape that carried no profile at all would
  // throw here — after the number was already bought and is already billing.
  const assignedProfileId = number.profileId ?? null;

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
      profileId: assignedProfileId,
      status,
      country,
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
      country,
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
