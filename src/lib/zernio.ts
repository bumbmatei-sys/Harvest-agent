import crypto from 'crypto';

/**
 * THE-314 — the telephony provider. Harvest's SMS now runs on the SAME vendor
 * that card 86bbu5q9m picked for the social scheduler, replacing Twilio.
 *
 * ─── 🔴 HARVEST RESELLS. There is exactly ONE account. ───────────────────────
 *
 * Every number and every message in the product sits on HARVEST'S vendor
 * account and is billed to Harvest, which then bills the church. There is no
 * bring-your-own path any more: a church never holds a vendor credential, never
 * sees this API key, and never contracts with the vendor.
 *
 * Two consequences are load-bearing rather than incidental:
 *   · EVERY SEND IS A PLATFORM SEND. `SmsMeter.source` still exists and still
 *     means "whose account paid", but under the reseller model it resolves to
 *     'platform' for every tenant. That is what makes the per-plan segment cap
 *     in sms-usage.ts the real cost control it was always shaped to be — an
 *     unmetered send is now Harvest's money, not a church's.
 *   · CARRIER COMPLAINTS LAND HERE. A church that texts people who never asked
 *     gets HARVEST'S brand registration flagged, not its own. That is why the
 *     STOP path (sms-optout.ts + api/sms/incoming) is a control on this account
 *     and not merely a courtesy to the member.
 *
 * ─── This module is TRANSPORT ONLY ───────────────────────────────────────────
 *
 * It speaks HTTP to the vendor and nothing else: no Firestore, no plan lookup,
 * no metering, no destination policy. Every gate lives in sms-send.ts, which is
 * the single funnel. Keeping them apart is what lets the funnel's tests drive a
 * fake transport without a network, and what stops a future caller reaching the
 * vendor with the gates skipped.
 *
 * ⚠️ NOT a dependency of `sms-feature.ts`, which imports nothing on purpose.
 */

const ZERNIO_API = 'https://api.zernio.com/v1';

/** Read at call time, never at module scope: a route handler is built before
 * the runtime environment exists, and a missing key must fail the ONE call
 * rather than the whole bundle. */
function apiKey(): string | null {
  return process.env.ZERNIO_API_KEY || null;
}

/** The shared secret the vendor signs inbound webhook deliveries with. Its own
 * variable, separate from the API key: the webhook verifier must work in a
 * request that holds no send capability at all. */
export function webhookSecret(): string | null {
  return process.env.ZERNIO_WEBHOOK_SECRET || null;
}

function authHeaders(key: string, extra?: Record<string, string>): Record<string, string> {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(extra || {}) };
}

export interface ZernioResponse<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<ZernioResponse<T>> {
  const key = apiKey();
  if (!key) return { ok: false, status: 0, data: null, error: 'SMS is not configured on this deployment.' };
  try {
    const resp = await fetch(`${ZERNIO_API}${path}`, {
      method: init.method || 'GET',
      headers: authHeaders(key, init.headers),
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    const data = (await resp.json().catch(() => null)) as T | null;
    if (!resp.ok) {
      const message =
        (data as { error?: string; message?: string } | null)?.error ||
        (data as { error?: string; message?: string } | null)?.message ||
        `Provider error ${resp.status}`;
      return { ok: false, status: resp.status, data, error: message };
    }
    return { ok: true, status: resp.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: (e as Error)?.message || 'Provider request failed' };
  }
}

// ── Sending ──────────────────────────────────────────────────────────────────

export interface ZernioSendResult {
  ok: boolean;
  id?: string;
  /** Billable segments for the message the vendor accepted. */
  segments?: number;
  error?: string;
  /** True when the vendor refused because the recipient has opted out. The
   * vendor answers 409 for this and NEVER silently drops the message, which is
   * the property the STOP guarantee rests on. */
  optedOut?: boolean;
}

/**
 * 🔴 The segment count is what the meter and therefore the bill are built on,
 * so it is read from the vendor's own response and never estimated from body
 * length — an estimate that disagreed with the invoice would drift the counter
 * permanently in whichever direction it was wrong.
 *
 * A response that carries no count settles as 1 rather than 0. A DELIVERED
 * message is never metered as free: under the reseller model a zero here would
 * be Harvest paying for a segment it did not record.
 */
function parseSegments(data: unknown): number {
  const d = (data || {}) as Record<string, unknown>;
  for (const k of ['segments', 'numSegments', 'segmentCount', 'num_segments']) {
    const n = Number(d[k]);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 1;
}

/** Send one message. `idempotencyKey` makes a retry replay the original send
 * instead of billing a second one — the vendor keys on the header. */
export async function zernioSendSms(args: {
  from: string;
  to: string;
  text: string;
  idempotencyKey?: string;
}): Promise<ZernioSendResult> {
  const r = await call<{ id?: string; _id?: string }>('/sms/messages', {
    method: 'POST',
    body: { from: args.from, to: args.to, text: args.text },
    ...(args.idempotencyKey ? { headers: { 'Idempotency-Key': args.idempotencyKey } } : {}),
  });
  if (!r.ok) {
    // 409 is the opt-out refusal (and, rarely, an idempotency key still in
    // flight). Either way nothing was sent and nothing is billed, so the caller
    // must not meter it — see sms-send.ts, which refunds the reservation.
    return { ok: false, error: r.error, optedOut: r.status === 409 };
  }
  const d = (r.data || {}) as { id?: string; _id?: string };
  return { ok: true, id: d.id || d._id, segments: parseSegments(r.data) };
}

// ── Opt-outs (the STOP list) ─────────────────────────────────────────────────

/** The vendor's authoritative opt-out list for Harvest's account. Mirrored into
 * Firestore by sms-optout.ts so the funnel can refuse a suppressed recipient
 * without a network round trip on every send. */
export async function zernioListOptOuts(): Promise<string[]> {
  const r = await call<{ optOuts?: Array<{ phoneNumber?: string; to?: string }> }>('/sms/opt-outs?format=json');
  if (!r.ok || !r.data?.optOuts) return [];
  return r.data.optOuts.map((o) => o.phoneNumber || o.to || '').filter(Boolean);
}

// ── Numbers ──────────────────────────────────────────────────────────────────

export interface ZernioAvailableNumber {
  phoneNumber: string;
  features: string[];
}

/** Search the vendor's inventory. `sms=true` narrows to numbers that can text —
 * the vendor sells voice capability on every number and SMS per number, so a
 * number found without this filter may not be able to send at all. */
export async function zernioSearchNumbers(args: {
  country?: string;
  prefix?: string;
  locality?: string;
  limit?: number;
}): Promise<ZernioResponse<{ numbers?: ZernioAvailableNumber[] }>> {
  const q = new URLSearchParams({ country: args.country || 'US', sms: 'true' });
  if (args.prefix) q.set('prefix', args.prefix);
  if (args.locality) q.set('locality', args.locality);
  q.set('limit', String(Math.min(Math.max(args.limit || 20, 1), 100)));
  return call<{ numbers?: ZernioAvailableNumber[] }>(`/phone-numbers/available?${q.toString()}`);
}

export interface ZernioPurchasedNumber {
  numberId: string;
  phoneNumber: string;
  status: string;
  /** The vendor's own monthly price, when it reports one. NEVER defaulted to a
   * made-up figure: the admin screen shows "—" rather than a number Harvest
   * invented, because a wrong price on a billing screen is a false claim. */
  monthlyCostUsd: number | null;
  /** Present when a regulated country requires an identity check before the
   * order completes. The admin is sent here; Harvest does not collect the
   * documents itself. */
  kycUrl?: string;
}

function readPurchased(data: unknown): ZernioPurchasedNumber | null {
  const d = (data || {}) as Record<string, any>;
  const phoneNumber = d.phoneNumber || d.number || '';
  const numberId = d.numberId || d._id || d.id || '';
  if (!phoneNumber || !numberId) return null;
  const raw = d.monthlyPrice ?? d.monthlyCost ?? d.price ?? null;
  const n = Number(raw);
  return {
    numberId,
    phoneNumber,
    status: d.status || 'active',
    monthlyCostUsd: Number.isFinite(n) && n > 0 ? n : null,
    ...(d.kycUrl ? { kycUrl: d.kycUrl } : {}),
  };
}

/**
 * Buy a number onto HARVEST'S account.
 *
 * ⚠️ THE VENDOR DOES NOT LET YOU PICK A SPECIFIC NUMBER. The purchase is
 * payment-first: you constrain it (country, area code) and it provisions and
 * assigns one. The search above is therefore an AVAILABILITY PREVIEW — it tells
 * an admin what a country and area code can yield — not a shopping cart. The UI
 * says so; promising a specific number and delivering another would be the
 * false claim this ticket exists to avoid.
 *
 * `purchaseIntentId` is the idempotency key. Without it a retried request buys
 * a SECOND number and starts a second monthly charge, which is real money on
 * Harvest's card.
 */
export async function zernioPurchaseNumber(args: {
  profileId: string;
  country?: string;
  areaCode?: string;
  purchaseIntentId: string;
}): Promise<ZernioResponse<ZernioPurchasedNumber>> {
  const r = await call<unknown>('/phone-numbers/purchase', {
    method: 'POST',
    body: {
      profileId: args.profileId,
      country: args.country || 'US',
      ...(args.areaCode ? { areaCode: args.areaCode } : {}),
      // A standalone Calls/SMS number: skipping the WhatsApp provisioning path
      // activates it immediately instead of waiting on a Meta pre-verify Harvest
      // has no use for here.
      connectWhatsapp: false,
      purchaseIntentId: args.purchaseIntentId,
    },
  });
  if (!r.ok) return { ok: false, status: r.status, data: null, error: r.error };
  return { ok: true, status: r.status, data: readPurchased(r.data) };
}

/** Turn SMS on for a purchased number. Its response reports whether an already
 * approved carrier registration on the account can be reused — which is the
 * whole economics of the reseller model, since a registration is per BRAND
 * (Harvest) and not per church. */
export async function zernioEnableSms(numberId: string): Promise<ZernioResponse<{ registrationStatus?: string; reusable?: boolean }>> {
  return call(`/phone-numbers/${encodeURIComponent(numberId)}/sms`, { method: 'POST' });
}

/** Attach a number to Harvest's existing approved registration — no new brand,
 * no new campaign, no second carrier fee. */
export async function zernioReuseRegistration(numberId: string): Promise<ZernioResponse<{ status?: string }>> {
  return call(`/phone-numbers/${encodeURIComponent(numberId)}/sms/reuse-registration`, { method: 'POST' });
}

export async function zernioGetNumber(numberId: string): Promise<ZernioResponse<ZernioPurchasedNumber>> {
  const r = await call<unknown>(`/phone-numbers/${encodeURIComponent(numberId)}`);
  if (!r.ok) return { ok: false, status: r.status, data: null, error: r.error };
  return { ok: true, status: r.status, data: readPurchased(r.data) };
}

/**
 * Give a number up. Stops the monthly charge and returns the number to the
 * carrier pool.
 *
 * 🔴 IRREVERSIBLE, AND THE CHURCH LOSES THE NUMBER. The vendor documents no
 * port-OUT: a released number cannot be recovered and cannot be moved to an
 * account the church controls. The UI must say that before it calls this.
 */
export async function zernioReleaseNumber(numberId: string): Promise<ZernioResponse<unknown>> {
  return call(`/phone-numbers/${encodeURIComponent(numberId)}`, { method: 'DELETE' });
}

// ── Webhook signature ────────────────────────────────────────────────────────

/**
 * 🔴 THE OPEN-DOOR CONTROL for `/api/sms/incoming`, which is public and
 * unauthenticated.
 *
 * ⚠️ THE TWILIO PATH NEVER HAD ONE. `api/sms/incoming` verified nothing at all
 * before this ticket — no `X-Twilio-Signature` check existed anywhere in the
 * repo — so this is a NEW control, not a port of an old one. Anyone who knew a
 * tenant's keyword could POST a forged inbound message and make Harvest send a
 * billed reply. Under the reseller model that reply is Harvest's money.
 *
 * The signature is the lowercase hex HMAC-SHA256 of the RAW REQUEST BODY keyed
 * by the webhook secret. Raw, not re-serialised JSON: any reordering or
 * whitespace change produces a different digest and would reject every genuine
 * delivery.
 *
 * Fails CLOSED on every ambiguity — no secret configured, no header, a
 * malformed header, a length mismatch. An endpoint that cannot verify must
 * refuse, because "we could not check" and "it is genuine" are not the same
 * answer.
 */
export function verifyZernioSignature(rawBody: string, header: string | null, secret: string | null): boolean {
  if (!secret || !header) return false;
  const provided = header.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(provided)) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  // timingSafeEqual throws on a length mismatch, so the lengths are compared
  // first — and a mismatch is simply "not signed by us".
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'));
}

/**
 * Is Harvest's vendor account configured on this deployment at all?
 *
 * Under the reseller model there is ONE account and it is Harvest's, so this
 * answers "can anything be sent or bought here" — the question the super-admin
 * panel asks before drawing a meter. It deliberately reports on configuration
 * only and never calls the vendor.
 */
export function smsPlatformAvailable(): boolean {
  return apiKey() !== null;
}
