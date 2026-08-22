/**
 * THE-201 — the refusal copy for the member signup cap, and ONLY the copy.
 *
 * Deliberately its own module with **no Firebase import**, so the server routes
 * (`/api/auth/set-claims`, `/api/tenants/member-capacity`), the React signup
 * screen (`AuthPage`) and a plain unit test can all read the exact same strings.
 * One string, one place — the failure mode this avoids is two near-identical
 * refusal messages drifting apart until the one a new believer actually reads is
 * the one nobody reviewed.
 *
 * 🔴 WHO READS THIS: a person someone just led to Christ, standing on a signup
 * form, on a phone. Not an admin, not a billing contact. So the copy:
 *
 *   • names the MINISTRY, never "Harvest";
 *   • points at THE PERSON WHO INVITED THEM — the evangelist — never at support;
 *   • says, in one short sentence, that it is not their fault;
 *   • says the SAME EMAIL will work once room is made, so nobody burns their
 *     address trying a second one;
 *   • names NO plan, tier, upgrade, add-on, price, limit number, capacity figure
 *     or error code. A test asserts that absence
 *     (`src/utils/__tests__/member-capacity-copy.test.ts`).
 *
 * Contrast `contactLimitMessage` in `./contact-capacity.ts` — that is the ADMIN
 * message for the admin CRM's soft contact cap and it does name the plan. Two
 * audiences, two strings, deliberately not shared.
 */

/** Machine-readable reason returned by both routes on a refusal. */
export const MEMBER_CAP_CODE = 'member_cap_reached' as const;

export interface MemberCapCopy {
  /** Short line for a banner heading. */
  title: string;
  /** The body a new believer actually reads. */
  body: string;
}

/** Used when `tenants/{id}.name` is missing — never the tenant id. */
const FALLBACK_SUBJECT = 'This ministry';

const TITLE = "This ministry can't take new sign-ups right now";

const BODY_TAIL =
  " has room for everyone already signed up, but it can't add a new account at the moment. " +
  "This isn't anything you did wrong. Please tell the person who invited you — they can open " +
  'up a place for you. Once they do, come back and sign up with this same email address.';

/**
 * @param ministryName tenants/{id}.name — falls back to 'this ministry' when absent.
 *        NEVER the tenant id (a slug is not a name a person recognises).
 */
export function memberCapCopy(ministryName?: string | null): MemberCapCopy {
  const trimmed = typeof ministryName === 'string' ? ministryName.trim() : '';
  const subject = trimmed === '' ? FALLBACK_SUBJECT : trimmed;
  return { title: TITLE, body: `${subject}${BODY_TAIL}` };
}

/** One flat string, for a plain-text banner or a test that reads textContent. */
export function memberCapMessage(ministryName?: string | null): string {
  const { title, body } = memberCapCopy(ministryName);
  return `${title} ${body}`;
}
