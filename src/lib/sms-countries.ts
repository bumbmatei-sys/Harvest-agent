/**
 * THE-330 — WHAT A CHURCH IS ALLOWED TO BUY, DECIDED IN ONE PLACE.
 *
 * ─── The defect this module exists to make impossible ────────────────────────
 *
 * The founder typed `DE` into a free-text country box and `615` — a Nashville
 * area code — into a free-text area box, pressed Check availability, and was
 * told "local numbers in DE can't send or receive SMS. Pick another type, or
 * buy without SMS." The form had let him name a country that cannot text and
 * only said so afterwards, and the advice it gave him ("pick another type") was
 * about a field the form did not have.
 *
 * 🔴 THE ANSWER IS PER (COUNTRY, TYPE), NEVER PER COUNTRY. The provider's
 * catalogue reports `smsAvailable` at BOTH levels and the two are different
 * claims. The country-level flag documents itself as mirroring the FIRST
 * (default) entry of `types[]`, and the default is "the WhatsApp-safe choice" —
 * a fact about WhatsApp, not about SMS. So the two disagree in both directions
 * and each direction is a live case:
 *
 *   · GB — `mobile` texts; `local`, `national` and `toll_free` do not. Reading
 *     the country flag would offer GB `local` and hand a church a number that
 *     is billed monthly and silently cannot text. That is the subtle failure,
 *     because GB *is* an SMS country and the purchase would succeed.
 *   · US — `local` texts; `toll_free` does not.
 *
 * ⚠️ EVERY FUNCTION HERE IS A PURE READ OF THE FETCHED CATALOGUE. Nothing below
 * holds a list of countries, prices, tiers or capabilities. A hardcoded table
 * would be the same frozen guess the free-text box was, one layer down: the
 * provider's inventory, prices, stock and KYC tiers all move, and a copy in the
 * bundle would keep selling a country that has been withdrawn.
 */
/**
 * ⚠️ THE PROVIDER'S SHAPES LIVE HERE, NOT IN `zernio.ts`, AND THE DIRECTION IS
 * DELIBERATE. `zernio.ts` imports them from this module; this module imports
 * NOTHING from `zernio.ts`.
 *
 * 🔴 That is what keeps THE-314's property intact: "there is exactly ONE module
 * that talks to the provider", enforced by a guard that greps for an import of
 * the transport. This module is pure — no network, no environment, no
 * credential — and the admin screen reads these types and these predicates
 * without pulling the transport into a client bundle. Pointing the arrow the
 * other way would have added this file to that guard's list and made a pure
 * helper look like a second caller.
 */

/** One number type offered in a country. See the note on `smsAvailable`. */
export interface ZernioCountryType {
  /** `local` · `mobile` · `national` · `toll_free`. */
  numberType: string;
  /** 🔴 THE DECIDING FLAG. Per type, never inherited from the country. */
  smsAvailable: boolean;
  whatsappAvailable: boolean;
  callsAvailable: boolean;
  /** Per TYPE, not per country: GB `toll_free` is $3 and HU `toll_free` is $23. */
  monthlyCents: number | null;
  /** Also per type: IL `mobile` needs no identity check and IL `local` does. */
  needsKyc: boolean;
  /** `instant` is buyable now; `request` is sourced by a carrier request and is
   * NOT instantly buyable, which is a constraint only this field states. */
  fulfilment: string | null;
  inStock: boolean;
}

/** One offerable country. `code` is ISO 3166-1 alpha-2.
 *
 * ⚠️ THE PROVIDER SENDS NO COUNTRY NAME — its catalogue carries `code` only.
 * {@link countryName} resolves one through `Intl.DisplayNames`, which is in the
 * platform and adds no dependency; no name table is hardcoded. */
export interface ZernioCountry {
  code: string;
  /** Regulatory tier 1–4. Provider jargon; {@link tierNote} translates its ONE
   * church-visible consequence rather than printing the integer. */
  tier: number | null;
  monthlyCents: number | null;
  needsKyc: boolean;
  callsAvailable: boolean;
  whatsappAvailable: boolean;
  /** ⚠️ MIRRORS THE DEFAULT TYPE, so it is a summary and not the decision. See
   * {@link countryCanSms}. */
  smsAvailable: boolean;
  inStock: boolean;
  types: ZernioCountryType[];
}

/** One area code with live stock, from the availability endpoint's
 * `areaOptions`. `ndc` is what the purchase takes as `areaCode`. */
export interface ZernioAreaOption {
  ndc: string;
  name: string;
  count: number;
}

/** One number in the provider's inventory. `features` is ITS OWN capability
 * list: two numbers of the same country and type can differ. */
export interface ZernioAvailableNumber {
  phoneNumber: string;
  features: string[];
}

/**
 * The types of one country that can actually send SMS.
 *
 * 🔴 THE PREDICATE THE WHOLE TICKET RESTS ON. `wantsSms: true` requires an
 * SMS-capable type (THE-318), so this is also what keeps THE-318's purchase fix
 * satisfiable: the type picker offers only what this returns, and the type it
 * yields is the one the purchase is made with.
 */
export function smsCapableTypes(country: Pick<ZernioCountry, 'types'>): ZernioCountryType[] {
  return country.types.filter((t) => t.smsAvailable === true);
}

/**
 * Can this country text AT ALL — i.e. does ANY of its types text?
 *
 * ⚠️ DELIBERATELY NOT `country.smsAvailable`. That field mirrors the default
 * type only. Substituting it here is the mutation this module is shaped to
 * fail: it would drop GB `mobile` (whose country flag does not speak for it)
 * and would admit a country whose default texts while the type the church picks
 * does not.
 */
export function countryCanSms(country: Pick<ZernioCountry, 'types'>): boolean {
  return smsCapableTypes(country).length > 0;
}

/**
 * Can this (country, type) be bought RIGHT NOW for SMS?
 *
 * Three independent constraints, each of which the provider states in advance
 * and each of which would otherwise be learned from a failed purchase:
 *   · `smsAvailable` — the number would be mute (the founder's failure);
 *   · `inStock` — there is no deliverable inventory, so the purchase fails;
 *   · `fulfilment: 'request'` — sourced by a carrier request rather than held
 *     in stock, so it is not instantly buyable and no date is implied.
 *
 * 🔴 KYC IS NOT ON THIS LIST, and that is deliberate. `needsKyc` does not make a
 * type unbuyable — the provider answers 202 `kyc_required` with an address the
 * church completes (THE-318 surfaces it). It is DISCLOSED before the button
 * rather than blocking it; blocking would remove a country a church can
 * genuinely have.
 */
export function typeIsInstantlyBuyable(t: ZernioCountryType): boolean {
  return t.smsAvailable === true && t.inStock === true && t.fulfilment !== 'request';
}

/** The SMS-capable types of a country that can also be bought this minute. */
export function purchasableSmsTypes(country: Pick<ZernioCountry, 'types'>): ZernioCountryType[] {
  return smsCapableTypes(country).filter(typeIsInstantlyBuyable);
}

/**
 * The country's full name, resolved from its ISO 3166-1 alpha-2 code.
 *
 * 🔴 THE PROVIDER SENDS NO NAME. Its catalogue carries `code` only, so "Germany"
 * cannot be read off the payload — and the founder's complaint was exactly that
 * two letters are not something a person can be expected to know.
 *
 * ⚠️ `Intl.DisplayNames` IS THE PLATFORM, NOT A DEPENDENCY. It ships in Node and
 * in every browser this app supports, so no package is added and no name table
 * is hardcoded — a table would be one more frozen list to drift, and it would
 * drift the moment the provider offers a country nobody thought to add.
 *
 * Returns `null` rather than a guess when the runtime cannot name the code. The
 * caller then shows the bare code, which is worse than a name and better than
 * an invented one: a wrong country name on a screen that spends money is a
 * false claim, and this ticket exists to remove those, not to add one.
 */
export function countryName(code: string): string | null {
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' });
    const name = dn.of(code.toUpperCase());
    // `of()` echoes the input back when it knows no name for it; an echo is not
    // a name, and letting it through would render "DE (DE)" as if it were one.
    return name && name.toUpperCase() !== code.toUpperCase() ? name : null;
  } catch {
    return null;
  }
}

/**
 * 🔴 HOW EVERY COUNTRY IS SPELLED ON SCREEN: "Germany (DE)", never a bare `DE`.
 *
 * The name answers "is this my country"; the code stays because it is what the
 * provider, the invoice and every error message use, so a church reading a
 * support reply can match the two.
 */
export function countryLabel(code: string): string {
  const name = countryName(code);
  return name ? `${name} (${code.toUpperCase()})` : code.toUpperCase();
}

/**
 * The number type, in words a church uses.
 *
 * ⚠️ `toll_free` is not a word, and `national` means nothing to somebody buying
 * a church phone line. The provider's own token is kept alongside in the UI so
 * the two can be matched against a support reply, exactly as the country code is.
 */
export function numberTypeLabel(numberType: string): string {
  if (numberType === 'local') return 'Local';
  if (numberType === 'mobile') return 'Mobile';
  if (numberType === 'national') return 'National';
  if (numberType === 'toll_free') return 'Toll-free';
  return numberType;
}

/**
 * 🔵 THE `tier` JUDGEMENT — WHY THE RAW INTEGER IS NOT ON SCREEN.
 *
 * The provider documents `tier` as a REGULATORY tier, 1–4, whose only stated
 * consequences are that tiers 3 and 4 require end-user KYC and that tier 4
 * countries appear only when enabled for the account. "Tier 3" is a fact about
 * the provider's regulatory bucketing; it is not a fact a church can act on,
 * and printing `3` next to a price on a purchase screen invites the reading
 * that it is a service level or a quality grade, which it is not.
 *
 * 🔴 So the tier is TRANSLATED, not hidden and not shown raw. Its one
 * church-visible consequence is identity documents, and that consequence is
 * already carried precisely — and per type, which the tier is not — by
 * `needsKyc`. This function states the regulatory fact in words for the reader
 * who wants it; the actionable disclosure is the KYC warning next to it.
 */
export function tierNote(tier: number | null): string | null {
  if (tier === null) return null;
  if (tier >= 3) return 'Regulated country — the provider requires identity documents before a number is issued.';
  return 'Standard country — no identity documents required by the regulator.';
}

/**
 * A price in whole cents, as money.
 *
 * 🔴 THIS IS THE PROVIDER'S PRICE, NOT A HARVEST PLAN PRICE. It is deliberately
 * NOT routed through `formatPlanPrice`: that formatter is for Harvest's own plan
 * tiers, and running a carrier's rate card through it would present a pass-
 * through cost as if it were a Harvest price. No plan price literal appears
 * here either — every figure this renders came from the provider's response.
 */
export function formatMonthlyCents(cents: number | null): string {
  // 🔴 "—", never "$0.00". A missing price rendered as free is a false claim on
  // a screen where somebody is agreeing to a recurring charge — the same reason
  // `monthlyCostUsd` is never defaulted in zernio.ts.
  if (cents === null || !Number.isFinite(cents)) return '—';
  const dollars = cents / 100;
  return `$${dollars.toFixed(Number.isInteger(dollars) ? 0 : 2)}/month`;
}
