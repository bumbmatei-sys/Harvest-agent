import { parsePhoneNumberFromString } from 'libphonenumber-js';

// ─────────────────────────────────────────────────────────────────────────────
// HARVEST — SMS destination policy: US NUMBERS ONLY (decision, 2026-07-25)
//
// WHY a country gate exists at all. The per-tenant cap in planLimits.ts is
// measured in SEGMENTS, so it bounds VOLUME — not SPEND. Twilio's price per
// segment varies ~10× by destination (verified: US ~$0.0079 + ~$0.003 carrier
// surcharge ≈ $0.0109; UK ~$0.04; Brazil ~$0.075). The ultra ceiling of 4,000
// segments therefore costs ~$44 to US numbers (9.4% of the $479 plan) but ~$160
// to the UK and ~$300 to Brazil — 63% of the plan price. Capping segments alone
// would let a single international tenant eat most of their plan's revenue, so
// non-US destinations are REJECTED rather than metered. Cost-based metering was
// considered and deliberately deferred.
//
// WHY NOT a `+1` prefix match. `+1` is the NANP country calling code, shared by
// the US, Canada and ~20 Caribbean countries, all at different carrier rates
// (e.g. Canada and the Bahamas are not US rates). The country is decided by the
// AREA CODE inside `+1`, not by the `+1` itself, so the check parses the E.164
// number with libphonenumber and compares the RESOLVED ISO country.
//
// The rule is an ALLOW-list of exactly one country and it fails CLOSED: only a
// number that parses to `US` is allowed. Anything that does not parse, is not
// E.164, resolves to no country, or resolves to any other country is rejected.
// A rejection is loud (it returns an admin-facing reason) — never a silent drop.
//
// KNOWN CONSEQUENCES, deliberate and worth re-confirming with Matei:
//   • US TERRITORIES ARE REJECTED. libphonenumber resolves Puerto Rico (+1 787/
//     939) to `PR`, Guam to `GU`, the US Virgin Islands to `VI`, American Samoa
//     to `AS` and the Northern Marianas to `MP` — none of which are `US`. A
//     ministry in San Juan cannot send. Twilio's rates for those territories were
//     NOT verified here, so they are excluded rather than assumed US-priced.
//   • NANP TOLL-FREE (+1 800/833/844/855/866/877/888) resolves to `US` even
//     though the range is shared with Canada. Texting a toll-free number is not
//     a real member-messaging case, and the mis-attribution can only ever admit
//     a Canadian toll-free number, so it is accepted as-is.
// ─────────────────────────────────────────────────────────────────────────────

/** Admin-facing copy for a rejected destination. Shown verbatim in the UI. */
export const NON_US_MESSAGE = 'SMS is currently available for US numbers only.';

export interface DestinationCheck {
  /** True only when the number parses to ISO country `US`. */
  allowed: boolean;
  /** Resolved ISO 3166-1 alpha-2 country, or null when undeterminable. */
  country: string | null;
  /** Admin-facing reason when `allowed` is false. */
  reason?: string;
}

/**
 * Decide whether an SMS may be sent to `to`.
 *
 * Accepts only a number that libphonenumber parses AND validates AND resolves to
 * country `US`. Everything else is rejected, including a malformed or non-E.164
 * string (e.g. `12125551234` with no `+`, `not-a-number`, or a too-short `+1234`)
 * — those parse to null / no country and get the "not a valid phone number"
 * reason so an admin can tell a bad number from a blocked country.
 */
export function checkDestination(to: string | null | undefined): DestinationCheck {
  const raw = (to || '').trim();
  if (!raw) {
    return { allowed: false, country: null, reason: 'A destination phone number is required.' };
  }

  // parsePhoneNumberFromString returns undefined for unparseable input and never
  // throws, so a garbage `phone` field on a contact can't break a broadcast.
  const parsed = parsePhoneNumberFromString(raw);
  if (!parsed || !parsed.isValid() || !parsed.country) {
    return {
      allowed: false,
      country: parsed?.country ?? null,
      reason: `${raw} is not a valid phone number in international (+1…) format.`,
    };
  }

  if (parsed.country !== 'US') {
    return { allowed: false, country: parsed.country, reason: NON_US_MESSAGE };
  }

  return { allowed: true, country: 'US' };
}
