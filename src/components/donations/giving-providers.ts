/**
 * THE-246 — the church's OWN payment links: PayPal, Cash App, Venmo, Zelle,
 * and whatever else comes next.
 *
 * ─── 🔴 These are not integrations, and they ARE a money surface ─────────────
 *
 * Nothing here talks to a payment processor. A church pastes a URL, a handle
 * and an email; the member app renders them and opens the URL. Harvest never
 * sees the gift — no fee, no receipt, no giving statement, no liability.
 *
 * That is exactly why the validation below is stricter than anything else in
 * this app applies to a URL. A pasted link is rendered as an anchor to a
 * congregation that trusts its church: a "PayPal" row pointing at `pаypal.me`
 * (Cyrillic а), at `paypal.me.givenow.example`, or at
 * `https://paypal.me@collect.example/` is a phishing page wearing a church's
 * name. `isSafeUrl` in utils/sanitize.ts is a DENY-list — it refuses
 * `javascript:` and friends — and a deny-list cannot answer "is this really
 * PayPal". So this module is an ALLOW-list, per provider, and the two are not
 * interchangeable.
 *
 * ─── The table is the extension point ────────────────────────────────────────
 *
 * The founder wrote "whatever else" twice. Adding a provider is ONE ROW below
 * — id, label, monogram, accent, hosts, and the words its own users know it by.
 * No component, no gate and no test table needs an edit for the fifth provider,
 * because every one of them derives from this array. Same shape, and the same
 * reason, as `INTEGRATION_PROVIDERS` in settings/integration-providers.ts.
 *
 * ⚠️ ARRAY ORDER IS DISPLAY ORDER, and that is the whole of the ordering rule.
 * The founder asked for the links to be "randomized... nicely, beautifully",
 * which is a request to ARRANGE them, not to shuffle them: a giving surface
 * that moves between visits is one a member cannot learn, and a member who
 * meant to tap Cash App and hit Zelle because the tiles swapped has been
 * mis-sent money. So the order is this array's, always — not the church's entry
 * order, not Firestore's key order (which is unspecified), and never random.
 */

/** Every provider this build knows. Add a row; add nothing else. */
export type GivingProviderId = 'paypal' | 'cashapp' | 'venmo' | 'zelle';

export interface GivingProvider {
  id: GivingProviderId;
  /** The name a member reads, and the name the admin field is labelled with. */
  label: string;
  /**
   * 🔴 A MONOGRAM, NOT A LOGO. See `ProviderMark` — the repo carries no
   * licensed brand-mark asset and no icon dependency that has one, so nothing
   * here reproduces a registered mark. One letter, set in the app's own type.
   */
  monogram: string;
  /**
   * The tile fill and the ink on it. In each provider's familiar hue, darkened
   * where the published brand colour could not carry legible text — chosen for
   * contrast, not offered as a reproduction of anyone's colour.
   *
   * ⚠️ Data, not palette. These are the one place in this feature a colour is
   * written down, and they are written HERE rather than in a className because
   * they identify a third party rather than expressing the Harvest or Classic
   * palette. Everything else in the feature spends theme tokens, so all four
   * palettes render from the same source.
   */
  tint: string;
  ink: string;
  /**
   * 🔴 THE ALLOW-LIST. A link for this provider must sit on one of these hosts
   * or on a subdomain of one. Nothing else is accepted — see `validateGivingUrl`.
   */
  hosts: readonly string[];
  /** A real, correctly-shaped link, shown as the field's placeholder. */
  urlExample: string;
  /** What this provider calls the thing a person is found by. */
  handleLabel: string;
  handleExample: string;
  /**
   * Does this provider actually publish per-account links?
   *
   * Zelle does not: a person is reached through their bank by email or mobile
   * number, and `zellepay.com` has no per-church page. Recorded so the admin
   * copy can say so rather than asking a church for a URL that does not exist.
   */
  hasPersonalLink: boolean;
}

/**
 * The providers, IN DISPLAY ORDER.
 *
 * Ordered by how likely a US congregation is to already have one, so the most
 * reached-for option is first and the order is a decision rather than an
 * accident. It is stable for every church and every render.
 */
export const GIVING_PROVIDERS: readonly GivingProvider[] = Object.freeze([
  {
    id: 'paypal',
    label: 'PayPal',
    monogram: 'P',
    tint: '#003087',
    ink: '#FFFFFF',
    hosts: ['paypal.me', 'paypal.com'],
    urlExample: 'https://paypal.me/gracechapel',
    handleLabel: 'PayPal.Me name',
    handleExample: 'gracechapel',
    hasPersonalLink: true,
  },
  {
    id: 'cashapp',
    label: 'Cash App',
    monogram: 'C',
    tint: '#00873A',
    ink: '#FFFFFF',
    hosts: ['cash.app'],
    urlExample: 'https://cash.app/$gracechapel',
    handleLabel: 'Cashtag',
    handleExample: '$gracechapel',
    hasPersonalLink: true,
  },
  {
    id: 'venmo',
    label: 'Venmo',
    monogram: 'V',
    tint: '#0074DE',
    ink: '#FFFFFF',
    hosts: ['venmo.com'],
    urlExample: 'https://venmo.com/u/gracechapel',
    handleLabel: 'Venmo username',
    handleExample: '@gracechapel',
    hasPersonalLink: true,
  },
  {
    id: 'zelle',
    label: 'Zelle',
    monogram: 'Z',
    tint: '#6D1ED4',
    ink: '#FFFFFF',
    hosts: ['zellepay.com', 'zellepay.org'],
    urlExample: 'https://www.zellepay.com/',
    handleLabel: 'Name on Zelle',
    handleExample: 'Grace Chapel',
    hasPersonalLink: false,
  },
] as const satisfies readonly GivingProvider[]);

/** Provider ids, in display order. */
export const GIVING_PROVIDER_IDS: readonly GivingProviderId[] = Object.freeze(
  GIVING_PROVIDERS.map((p) => p.id),
);

export function getGivingProvider(id: GivingProviderId): GivingProvider {
  const provider = GIVING_PROVIDERS.find((p) => p.id === id);
  if (!provider) throw new Error(`Unknown giving provider: ${id}`);
  return provider;
}

/**
 * ⚠️ A LOOKUP WITH NO PROTOTYPE, for the same reason `admin-sections.ts` uses
 * one: this is keyed with whatever came out of a Firestore document, and
 * `{}['constructor']` is truthy.
 */
const PROVIDER_BY_ID: Readonly<Record<string, GivingProvider>> = (() => {
  const map: Record<string, GivingProvider> = Object.create(null);
  for (const provider of GIVING_PROVIDERS) map[provider.id] = provider;
  return Object.freeze(map);
})();

/** True when a string names a provider this build defines. */
export function isGivingProviderId(value: unknown): value is GivingProviderId {
  return typeof value === 'string' && value in PROVIDER_BY_ID;
}

/* ── What a church stores ─────────────────────────────────────────────────── */

/**
 * One provider's three fields, exactly as the founder asked for them: the URL,
 * the username/handle, and the EMAIL.
 *
 * ⚠️ The email is not decoration. "Some people are being identified by the
 * email not by the username or the phone number" — for Zelle it is usually the
 * ONLY way to send anything at all.
 */
export interface GivingLinkFields {
  url?: string;
  handle?: string;
  email?: string;
}

/** The whole record, as it sits on `tenants/{id}.config.givingLinks`. */
export type GivingLinkRecord = Partial<Record<GivingProviderId, GivingLinkFields>>;

/** One provider's fields, validated, normalised and ready to render. */
export interface PublishedGivingLink {
  provider: GivingProvider;
  /** A normalised https URL on the provider's own host, or null. */
  url: string | null;
  handle: string | null;
  email: string | null;
}

export const MAX_GIVING_URL_LENGTH = 512;
export const MAX_GIVING_HANDLE_LENGTH = 64;
export const MAX_GIVING_EMAIL_LENGTH = 254;

/** Why a pasted URL was refused. Each one is shown to the admin verbatim. */
export type GivingUrlRejection =
  | 'empty'
  | 'too-long'
  | 'unparseable'
  | 'not-https'
  | 'has-credentials'
  | 'has-port'
  | 'foreign-host';

export type GivingUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: GivingUrlRejection };

/** The message an admin reads when their paste is refused. */
export function givingUrlRejectionMessage(
  reason: GivingUrlRejection,
  provider: GivingProvider,
): string {
  switch (reason) {
    case 'empty':
      return 'Paste a link, or leave the field blank.';
    case 'too-long':
      return `That link is longer than ${MAX_GIVING_URL_LENGTH} characters.`;
    case 'unparseable':
      return `That is not a web address. It should look like ${provider.urlExample}`;
    case 'not-https':
      return 'Only https:// links are accepted, so your members are never sent somewhere insecure.';
    case 'has-credentials':
      return 'A link with a username in front of the address is not accepted — that is how a fake link is disguised as a real one.';
    case 'has-port':
      return `A real ${provider.label} link has no port number in it.`;
    case 'foreign-host':
      return `This has to be a ${provider.label} link — ${provider.hosts.join(' or ')}. A ${provider.label} button that opens somewhere else is how your members get scammed.`;
  }
}

/**
 * 🔴 THE PHISHING GUARD. Six rules, in this order, and a URL passes only by
 * satisfying all six:
 *
 *   1. LENGTH. Capped before anything parses it.
 *   2. SCHEME. A string that already carries a scheme keeps it; one that
 *      carries none is read as `https://…`. So `javascript:alert(1)` and
 *      `data:text/html,…` arrive at rule 3 WITH their own scheme and are
 *      refused there — they are never silently prefixed into safety — while a
 *      church that typed `paypal.me/grace` is understood.
 *   3. HTTPS ONLY. Not http, not mailto, not tel, not anything else.
 *   4. NO CREDENTIALS. `https://paypal.me@collect.example/` renders as
 *      "paypal.me…" to a person and resolves to `collect.example`. This is the
 *      single most effective look-alike there is, and rule 6 alone would catch
 *      it — this refuses the SHAPE as well, so a link that is trying to
 *      disguise itself never passes even on an allowed host.
 *   5. NO PORT. A real consumer payment link has none.
 *   6. THE HOST IS THE PROVIDER'S. `host === h || host.endsWith('.' + h)` over
 *      that provider's own allow-list — never `includes`, never `startsWith`.
 *      So `paypal.me.givenow.example` fails (it does not END with
 *      `.paypal.me`), `givenow.example/paypal.me` fails (its host is
 *      `givenow.example`), and a Unicode look-alike fails because `URL`
 *      converts it to punycode (`xn--pypal-4ve.me`), which matches nothing.
 *
 * Returns the NORMALISED URL — what `URL` parsed, not what was typed — so the
 * string that reaches an `href` is never the raw one a person pasted.
 */
export function validateGivingUrl(raw: unknown, provider: GivingProvider): GivingUrlResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'empty' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };
  if (trimmed.length > MAX_GIVING_URL_LENGTH) return { ok: false, reason: 'too-long' };

  // Rule 2. `[a-z][a-z0-9+.-]*:` is the RFC 3986 scheme production — anything
  // that already declares one keeps it and is judged on it.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, reason: 'unparseable' };
  }

  if (parsed.protocol !== 'https:') return { ok: false, reason: 'not-https' };
  if (parsed.username || parsed.password) return { ok: false, reason: 'has-credentials' };
  if (parsed.port) return { ok: false, reason: 'has-port' };

  // A trailing dot is a legal FQDN spelling and would otherwise slip the
  // allow-list: `paypal.me.` resolves exactly as `paypal.me` does.
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  const onProviderHost = provider.hosts.some((h) => host === h || host.endsWith(`.${h}`));
  if (!onProviderHost) return { ok: false, reason: 'foreign-host' };

  const normalised = parsed.toString();
  if (normalised.length > MAX_GIVING_URL_LENGTH) return { ok: false, reason: 'too-long' };
  return { ok: true, url: normalised };
}

/**
 * A handle, cleaned. Rendered as text, so React escapes it; what this refuses
 * is a value that would not render as one line — control characters, newlines,
 * and runs of whitespace pasted out of a document.
 */
export function sanitizeGivingHandle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_GIVING_HANDLE_LENGTH);
}

/**
 * An email, cleaned — or null.
 *
 * ⚠️ SHOWN IN PUBLIC, AND STORED IN PUBLIC. `tenants/{id}` is world-readable
 * (`allow read: if true`, firestore.rules), which is what lets a signed-out
 * visitor resolve a subdomain before sign-in. So this address is public the
 * moment it is saved, whatever the member app chooses to draw. The admin copy
 * says exactly that; see AdminDonations. Nothing here obfuscates it, because
 * obfuscating a value that a public read already serves is theatre.
 */
export function sanitizeGivingEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned || cleaned.length > MAX_GIVING_EMAIL_LENGTH) return null;
  // Deliberately conservative rather than RFC-complete: one @, no whitespace,
  // and a dotted domain. A church's giving address is not an edge-case address.
  if (!/^[^\s@,;<>"]+@[^\s@.,;<>"]+(\.[^\s@.,;<>"]+)+$/.test(cleaned)) return null;
  return cleaned;
}

/** True when an email would be accepted — for the admin's inline error. */
export function isGivingEmailAcceptable(raw: string): boolean {
  return !raw.trim() || sanitizeGivingEmail(raw) !== null;
}

/**
 * The links a tenant actually publishes, validated and IN TABLE ORDER.
 *
 * 🔴 VALIDATED ON READ, not only on write. The stored record came off a
 * document, and a document can be older than the rules that now govern it (or
 * written by a super admin, or by a surface that does not exist yet). The
 * member app must never render an `href` this function did not just re-derive,
 * so a value that no longer passes simply stops being a link rather than being
 * trusted because it was accepted once.
 *
 * A provider is published when it has ANY of the three fields. That is not a
 * loophole — it is the Zelle case, which has no per-church URL at all and is
 * reached by email alone. A row with no valid URL renders as a card and not as
 * a link; see `GivingLinks`.
 */
export function readGivingLinks(
  config: { givingLinks?: unknown } | null | undefined,
): PublishedGivingLink[] {
  const record = config?.givingLinks;
  if (!record || typeof record !== 'object' || Array.isArray(record)) return [];
  const source = record as Record<string, unknown>;

  const published: PublishedGivingLink[] = [];
  // Walks the TABLE, never the document's own keys — which is what makes the
  // order independent of how Firestore happens to serialise the object.
  for (const provider of GIVING_PROVIDERS) {
    const entry = source[provider.id];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const fields = entry as GivingLinkFields;

    const urlResult = validateGivingUrl(fields.url, provider);
    const url = urlResult.ok ? urlResult.url : null;
    const handle = sanitizeGivingHandle(fields.handle);
    const email = sanitizeGivingEmail(fields.email);
    if (!url && !handle && !email) continue;

    published.push({ provider, url, handle, email });
  }
  return published;
}

/**
 * The record to WRITE, from what an admin typed — every field validated, and a
 * provider with nothing left in it dropped entirely rather than stored empty.
 */
export function buildGivingLinkRecord(draft: GivingLinkRecord): GivingLinkRecord {
  const out: GivingLinkRecord = {};
  for (const provider of GIVING_PROVIDERS) {
    const entry = draft[provider.id];
    if (!entry) continue;
    const urlResult = validateGivingUrl(entry.url, provider);
    const fields: GivingLinkFields = {};
    if (urlResult.ok) fields.url = urlResult.url;
    const handle = sanitizeGivingHandle(entry.handle);
    if (handle) fields.handle = handle;
    const email = sanitizeGivingEmail(entry.email);
    if (email) fields.email = email;
    if (Object.keys(fields).length > 0) out[provider.id] = fields;
  }
  return out;
}
