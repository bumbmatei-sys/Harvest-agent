/**
 * The Gmail sending address ("who this email is from").
 *
 * WHY THIS EXISTS AT ALL — Composio's `GMAIL_SEND_EMAIL` resolves the sender
 * itself when `from_email` is omitted: its schema says the `From` header falls
 * back to "the authenticated user's primary email address". That resolution is a
 * Gmail API profile lookup, and Google gates every profile read behind a MAILBOX
 * scope (`mail.google.com`, `gmail.modify`, `gmail.readonly`, `gmail.metadata` —
 * `gmail.send` is on none of those lists). So a send-only grant makes Composio's
 * own sender resolution 403, and the send dies before a message is ever built.
 *
 * Harvest must never hold a scope that can read a church's inbox, so the lookup
 * is not something to unblock — it is something to avoid. We pass `from_email`
 * explicitly on every send, which per the same schema is exactly the case where
 * Composio does not go looking for the primary address.
 *
 * That makes this string load-bearing: it IS the `From` header. Hence the
 * validation below is stricter than a display-only email field would need.
 */

/** Generous upper bound; RFC 5321 caps a path at 256 octets. */
const MAX_SENDER_LENGTH = 254;

/**
 * A single, bare addr-spec: `local@domain.tld`.
 *
 * Deliberately rejects everything that is legal in a header but not a bare
 * address — whitespace (including CR/LF, which is header injection), commas and
 * semicolons (multiple recipients), and angle brackets or quotes (display-name
 * forms like `Pastor <a@b.org>`). Anything Harvest cannot vouch for as one plain
 * address is refused rather than normalised into something surprising.
 */
const ADDR_SPEC = /^[^\s@,;<>"']+@[^\s@,;<>"'.]+(\.[^\s@,;<>"'.]+)+$/;

/**
 * Normalise an admin-supplied sending address, or return null if it is not one.
 *
 * Lowercased because a `From` address is case-insensitive in practice and the
 * value is displayed back in Settings, where two casings of one address would
 * read as two different accounts.
 */
export function normalizeSenderEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed.length > MAX_SENDER_LENGTH) return null;
  if (!ADDR_SPEC.test(trimmed)) return null;
  return trimmed;
}

/**
 * Shown when an admin has a live Gmail connection but no recorded sending
 * address — the state every connection made before this existed is in. It is a
 * fixable configuration gap, not a failure, so it must not read like one.
 */
export const NO_SENDER_ADDRESS_MESSAGE =
  'Confirm your Gmail sending address in Settings before sending.';
