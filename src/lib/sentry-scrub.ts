/**
 * PII scrubbing for Sentry events and breadcrumbs.
 *
 * Harvest holds donor data — names, emails, phone numbers, donation and pledge
 * amounts. None of that belongs in a third-party error tracker, so every event
 * and every breadcrumb is filtered through here before the SDK transmits it
 * (see `beforeSend` / `beforeBreadcrumb` in the sentry.*.config files).
 *
 * Two passes are needed, because donor PII reaches Sentry in two different
 * shapes:
 *
 *  1. Structured — objects hanging off an event (`extra`, `contexts`,
 *     `request.data`, breadcrumb `data`, stack-frame locals). Handled by
 *     recursive key-name matching.
 *  2. Flattened into a string — the console integration serializes its
 *     arguments into `breadcrumb.message`, so a call like
 *     `console.error('event_registration webhook: missing metadata', meta)`
 *     (src/app/api/stripe/webhook/route.ts) collapses the whole metadata
 *     object — donorEmail and donorName included — into a single line of text.
 *     Key-based recursion cannot see inside that, so string values are
 *     additionally pattern-scrubbed for `key: value` / `key=value` shapes and
 *     for any bare email address.
 *
 * Over-redaction is the intended failure mode: a slightly less informative
 * error beats leaking a donor's identity.
 */

export const REDACTED = '[redacted]';

/**
 * Exact key names (compared lower-case) whose values are always removed.
 * Kept alongside the broader patterns below to document intent explicitly.
 */
const REDACTED_KEYS = new Set([
  'donoremail',
  'donorname',
  'donorphone',
  'recipientemail',
  'recipientname',
  'recipientphone',
  'email',
  'phone',
  'phonenumber',
  'payeremail',
  'payername',
  'billingemail',
  'billingname',
  'customeremail',
  'customername',
]);

/**
 * Key-name patterns.
 *
 * `/amount/i` covers the donor-money fields wholesale — amount, amountCents,
 * donationAmount, pledgeAmount, Stripe's amount_total, and so on.
 *
 * Note the deliberate absence of a bare `/name/i`: `name` is a property of every
 * Error object and appears throughout stack frames, so redacting it blindly
 * would gut the traces this integration exists to provide. Only person-scoped
 * name fields (donorName, recipient_name, guestName, …) are matched.
 */
const REDACTED_KEY_PATTERNS: RegExp[] = [
  /amount/i,
  /email/i,
  /phone/i,
  /(?:donor|recipient|payer|attendee|guest|member)_?name/i,
];

/**
 * A serialized `key: value` / `key=value` / `"key":"value"` pair whose key looks
 * sensitive. Matches the shapes a metadata object takes once console formatting
 * has flattened it into one string.
 */
const SENSITIVE_ASSIGNMENT_RE = new RegExp(
  '(["\']?\\b(?:' +
    '[A-Za-z_]*(?:email|phone|amount)[A-Za-z_]*' +
    '|(?:donor|recipient|payer|attendee|guest|member)_?name' +
    ')\\b["\']?\\s*[:=]\\s*)' +
    '("[^"]*"|\'[^\']*\'|[^,;}\\]\\s]+)',
  'gi',
);

/** Any free-standing email address, wherever it turns up in a string. */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Keys whose string values are left alone by the string pass. These are paths
 * and symbol names — no realistic PII, and mangling them would make stack
 * traces harder to read. They are still subject to key-name redaction.
 */
const SKIP_STRING_SCRUB_KEYS = new Set(['filename', 'abs_path', 'module', 'function', 'type']);

/** Guards against pathological nesting; Sentry events are shallow in practice. */
const MAX_DEPTH = 12;

function shouldRedactKey(key: string): boolean {
  if (REDACTED_KEYS.has(key.toLowerCase())) return true;
  return REDACTED_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Redacts sensitive assignments and bare email addresses inside one string. */
export function scrubString(value: string): string {
  return value
    .replace(SENSITIVE_ASSIGNMENT_RE, `$1${REDACTED}`)
    .replace(EMAIL_RE, REDACTED);
}

/**
 * Recursively copies `value`, redacting sensitive keys and scrubbing strings.
 *
 * Copies rather than mutates: an event can hold references to live application
 * objects, and scrubbing must not corrupt app state as a side effect. Arrays and
 * plain objects are rebuilt; anything exotic (class instances, Date, Map) is
 * passed through untouched, since Sentry normalizes events to plain data before
 * `beforeSend` runs.
 */
function scrubValue(value: unknown, depth: number, seen: WeakSet<object>, key?: string): unknown {
  if (typeof value === 'string') {
    return key !== undefined && SKIP_STRING_SCRUB_KEYS.has(key.toLowerCase())
      ? value
      : scrubString(value);
  }

  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return value;

  const object = value as object;
  // Cycle guard — a repeated reference is returned as-is rather than re-walked.
  if (seen.has(object)) return value;
  seen.add(object);

  if (Array.isArray(value)) {
    return value.map((entry) => scrubValue(entry, depth + 1, seen, key));
  }

  if (!isPlainObject(object)) return value;

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const objectKey of Object.keys(source)) {
    result[objectKey] = shouldRedactKey(objectKey)
      ? REDACTED
      : scrubValue(source[objectKey], depth + 1, seen, objectKey);
  }
  return result;
}

/** Deep-scrubs an arbitrary value. Exported for tests and ad-hoc use. */
export function scrub<T>(value: T): T {
  return scrubValue(value, 0, new WeakSet()) as T;
}

/**
 * `beforeSend` hook — scrubs a whole outgoing event.
 *
 * Typed loosely (rather than against Sentry's `ErrorEvent`) so this module stays
 * importable from tests without pulling in the SDK.
 */
export function scrubEvent<T extends object>(event: T): T {
  return scrub(event);
}

/** `beforeBreadcrumb` hook — scrubs a breadcrumb's message and data payload. */
export function scrubBreadcrumb<T extends object>(breadcrumb: T): T {
  return scrub(breadcrumb);
}
