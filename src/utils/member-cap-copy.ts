/**
 * THE-201 — the copy a refused applicant actually reads.
 *
 * This module holds strings and nothing else. It is deliberately separate from
 * `@/lib/member-capacity`:
 *
 *  • `member-capacity` imports the Firebase Admin SDK. `AuthPage` is a client
 *    component and must be able to render this copy without dragging the Admin
 *    SDK into a browser bundle.
 *  • The copy is asserted by its own test, which must not need Firestore
 *    doubles to run.
 *
 * WHO READS THIS: a new believer someone just led to Christ, standing next to
 * the person who invited them, on a phone. Not an admin. Not a buyer. They
 * cannot see the plan, cannot upgrade it, and did nothing wrong.
 *
 * 🔴 CONSTRAINTS ON EVERY STRING HERE (spec §5 / D10). No error code, no
 * mention of plans, upgrades, billing, subscriptions, tiers, limits, capacity,
 * quotas, or Harvest support. Name the MINISTRY, point at WHOEVER INVITED THEM,
 * say it is not their fault, say the same email will work once room is made.
 * `member-cap-copy.test.ts` pins all of that; do not "improve" a string here
 * without reading it.
 */

/**
 * The body of the refusal. One shared constant so the named and unnamed
 * variants can never drift — the ONLY difference between them is the leading
 * noun phrase.
 */
const REFUSAL_BODY =
  " can't add new accounts right now. " +
  "Nothing went wrong on your end, and you didn't do anything incorrectly. " +
  'Please let the person who invited you know — they can make room for you. ' +
  'When they do, come back and sign up with this same email address and it will work.';

/**
 * The one exported string builder for the refusal a person actually reads.
 *
 * The ministry name is used when we have it, because "Grace Church can't add
 * new accounts" tells the reader exactly who to go and ask. When the tenant doc
 * carried no usable name, the generic noun phrase is used rather than a blank,
 * an id, or the word "Harvest".
 */
export function memberCapRefusalMessage(ministryName?: string | null): string {
  const name = typeof ministryName === 'string' ? ministryName.trim() : '';
  return `${name === '' ? 'This ministry' : name}${REFUSAL_BODY}`;
}

/**
 * Shown when the capacity check itself could not run (CHALLENGE C3).
 *
 * 🔴 This must NEVER say the ministry is full. We do not know that — the count
 * or the tenant read failed. Telling a real new believer that a ministry with
 * room to spare is full, over an infrastructure blip, is the exact silent lie
 * the Silent-Failure Rule exists to prevent. It says the failure is ours and
 * asks them to retry.
 */
export const MEMBER_CAP_UNAVAILABLE_MESSAGE =
  "We couldn't finish setting up your account. This is on our side, not yours. " +
  'Please try again in a minute — your email address is still available.';

/** Stable machine codes returned alongside the copy. Clients key off these, never off the prose. */
export const MEMBER_CAP_REFUSED_CODE = 'member_cap_reached';
export const MEMBER_CAP_UNAVAILABLE_CODE = 'capacity_check_unavailable';
