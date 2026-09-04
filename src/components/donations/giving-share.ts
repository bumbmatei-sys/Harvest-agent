/**
 * THE-281 — sharing the giving page.
 *
 * The founder: a button in the donations section that shares the giving page,
 * carrying all the church's payment links, with Stripe Connect marked as coming
 * soon.
 *
 * ─── 🔴 EVERY URL THIS MODULE EMITS IS ONE THE ALLOW-LIST ALREADY PASSED ────
 *
 * A share payload is the one place in this feature where a URL leaves the app
 * and lands somewhere Harvest does not control — a message, a clipboard, a QR
 * code printed on a flyer. So the rule `giving-providers.ts` exists to enforce
 * has to hold HERE too, and it holds by construction rather than by care:
 *
 *   · `buildGivingSharePayload` takes the RAW tenant config and calls
 *     `readGivingLinks` itself. A caller cannot hand it a link — there is no
 *     parameter to hand one through. `readGivingLinks` re-derives every URL
 *     against its own provider's `hosts` allow-list, so a stored value that no
 *     longer passes simply stops being a URL, exactly as it does on the member
 *     Give page.
 *
 *   · The giving-page URL is not string-concatenated into the payload either.
 *     `buildGivingPageUrl` builds it, re-parses it with `URL`, and refuses
 *     anything that is not a single-label subdomain of `theharvest.app` over
 *     https with no credentials and no port. A `tenantId` read off a document
 *     is untrusted input like any other: `evil.example/x` concatenated into
 *     `https://${id}.theharvest.app` produces a host of `evil.example`, and
 *     that is precisely the shape rule 6 in `validateGivingUrl` refuses for a
 *     provider link.
 *
 * ⚠️ THIS MODULE DOES NOT TOUCH `giving-providers.ts`. It imports from it and
 * adds nothing to it — the allow-list is not extended, relaxed or re-stated
 * here, and `hosts` is read only through `readGivingLinks`.
 */
import {
  readGivingLinks,
  type PublishedGivingLink,
} from './giving-providers';

/**
 * The apex every church's Harvest space is a subdomain of.
 *
 * ⚠️ Written here as the ONE host this module will emit, and deliberately not
 * imported from a component: `AdminQR`, `AdminForms`, `AdminCheckin` and
 * `PublicCalendar` each inline the same string today, and this file is a
 * validator rather than a fifth inliner — it is the only one of the five that
 * checks the result rather than trusting the template.
 */
export const HARVEST_APEX = 'theharvest.app';

/**
 * 🔴 THE PUBLIC GIVING PAGE'S PATH — THE-303.
 *
 * ─── What this used to be, and why it was a bug ─────────────────────────────
 *
 * It was `/?giving=1`: the APP ROOT carrying a query parameter, read by
 * `MainApp` to jump a SIGNED-IN member to the Give tab. So the one URL this
 * module exists to hand a stranger — printed on a flyer, pasted into a WhatsApp
 * group, opened from a QR on a noticeboard — landed on the SPA shell, which has
 * no session for a visitor and bounces them to the auth page. The founder:
 * "I shared the giving page but its not public. It's bringing me to the auth
 * page." A printed QR that demands a login is not a share surface.
 *
 * `/giving` is a REAL route (`src/app/giving/page.tsx`), resolved server-side
 * from the Host header exactly as `/pledge/[campaignId]`, `/campaign/
 * [campaignId]`, `/event/[eventId]`, `/checkin/[sessionId]` and `/form/[formId]`
 * already are — every other destination `AdminQR` prints. It reads the tenant
 * document through the Admin SDK, so no client Firestore call, no session and no
 * `firestore.rules` change is involved.
 *
 * ⚠️ `?giving=1` IS NOT REMOVED and nothing here touches it. It is still the
 * in-app deep link a signed-in member follows to the Give tab, and `MainApp`
 * still honours it — a member already inside the app should stay inside it.
 * What changed is only where a link meant for someone OUTSIDE the app points.
 *
 * 🔴 SPELLED ONCE, so the four producers cannot drift: this module, `AdminQR`'s
 * "Giving Page" QR, `/api/sms/incoming`'s Text-to-Give reply, and the route
 * itself. Three of them used to inline `/?giving=1` separately, which is how one
 * of them would have been fixed and the others left pointing at the auth wall.
 */
export const GIVING_PATH = '/giving';

/**
 * A DNS label: what a tenant id has to be to sit in front of the apex.
 *
 * No dots — a tenant id carrying one would reach a host the church does not
 * own, and this is a share surface where a wrong host is a member's money.
 */
const DNS_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * 🔴 The giving page's URL, or null.
 *
 * The SAME shape `AdminQR` already generates for its "Giving Page" QR type
 * (`https://<tenant>.theharvest.app/giving`), so a church that prints the QR
 * from one screen and shares the link from the other sends people to one page.
 *
 * 🔴 THE SIX RULES BELOW ARE UNCHANGED BY THE-303. Only `GIVING_PATH` moved;
 * every check is still asked of the PARSED url — https, no credentials, no
 * port, and a single-label subdomain of `theharvest.app` — because this is a
 * share surface where a wrong host is a member's money. A public destination
 * is not a reason to accept a wider one.
 *
 * Returns the URL `URL` parsed, never the template that was typed.
 */
export function buildGivingPageUrl(tenantId: unknown): string | null {
  if (typeof tenantId !== 'string') return null;
  const label = tenantId.trim().toLowerCase();
  if (!label || !DNS_LABEL.test(label)) return null;

  let parsed: URL;
  try {
    parsed = new URL(`https://${label}.${HARVEST_APEX}${GIVING_PATH}`);
  } catch {
    return null;
  }

  // Re-asked of the PARSED url rather than assumed from the template, so a
  // label that slipped the regex still cannot produce a foreign host.
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.port) return null;
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  if (!host.endsWith(`.${HARVEST_APEX}`)) return null;
  if (host.split('.').length !== HARVEST_APEX.split('.').length + 1) return null;

  return parsed.toString();
}

/** What the share surface renders and what the share sheet sends. */
export interface GivingSharePayload {
  /** The giving page, validated. Null when the tenant id is unusable. */
  url: string | null;
  /** The church's published links, re-validated by `readGivingLinks`. */
  links: readonly PublishedGivingLink[];
  /** The share sheet's title. */
  title: string;
  /** The body: the page, then each way to give. */
  text: string;
}

/**
 * The payload, built from the RAW config.
 *
 * 🔴 THE RAW CONFIG IS THE ONLY WAY IN. There is no overload taking a
 * `PublishedGivingLink[]`, because that would be a seam a caller could push an
 * unvalidated URL through — and the whole point of this module is that no such
 * seam exists.
 */
export function buildGivingSharePayload(
  tenantId: unknown,
  config: { givingLinks?: unknown } | null | undefined,
  churchName?: string | null,
): GivingSharePayload {
  const url = buildGivingPageUrl(tenantId);
  const links = readGivingLinks(config);

  const name = typeof churchName === 'string' && churchName.trim()
    ? churchName.trim()
    : 'our church';
  const title = `Give to ${name}`;

  const lines: string[] = [`Give to ${name}.`];
  if (url) lines.push(url);

  if (links.length > 0) {
    lines.push('', 'Other ways to give:');
    for (const link of links) {
      // Every field here has been through the validators: `link.url` is a
      // normalised URL on the provider's own host or null, and handle/email
      // are sanitised single-line strings.
      const parts = [link.provider.label];
      if (link.handle) parts.push(link.handle);
      if (link.url) parts.push(link.url);
      else if (link.email) parts.push(link.email);
      lines.push(`· ${parts.join(' — ')}`);
    }
  }

  return { url, links, title, text: lines.join('\n') };
}

/**
 * 🔴 EVERY URL THE PAYLOAD WOULD EMIT, for the test that pins the security
 * property — and for anything else that needs to audit a payload before it
 * leaves. The giving page first, then one per published link that has one.
 *
 * A link with no valid URL contributes nothing: `readGivingLinks` already
 * turned it into a handle-and-email row, which is the Zelle case.
 */
export function givingShareUrls(payload: GivingSharePayload): string[] {
  const urls: string[] = [];
  if (payload.url) urls.push(payload.url);
  for (const link of payload.links) if (link.url) urls.push(link.url);
  return urls;
}

/**
 * ⚠️ STATIC COPY, NOT A CONTROL — THE-256.
 *
 * Stripe Connect is switched off (`STRIPE_CONNECT_ENABLED = false`; the
 * platform account is closed as `rejected.fraud`). The share surface names it
 * because a founder looking at "all the ways people can give" will otherwise
 * wonder where card giving went — but it names it as a SENTENCE. There is no
 * button, no link, no toggle and no gated branch that could become one: this is
 * a string, and the surface renders it as text.
 *
 * 🔴 It deliberately does NOT import `stripe-connect-feature.ts`. Reading the
 * flag here would make this a gated live control the moment the flag flips,
 * which is the half-working money surface THE-256 removed. When Connect comes
 * back it comes back through `PaymentSection`, which already owns that state
 * for both screens that mount it — not through a share sheet.
 */
export const GIVING_SHARE_STRIPE_SOON =
  'Card giving through Stripe Connect is coming soon. Until then, these are the ways your members can give.';
