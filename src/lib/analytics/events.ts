/**
 * THE-36 — the analytics vocabulary, named once.
 *
 * PostHog is installed on an app that holds donor records, member profiles,
 * prayer requests and private messages. The decision that makes that safe is
 * not a setting — it is this file: **analytics has a closed vocabulary**. An
 * event may only be captured if its name is listed here, and it may only carry
 * property keys listed here. Everything else is dropped before it reaches the
 * network.
 *
 * That is the opposite of how autocapture works, which is why autocapture is
 * off (see `config.ts`): autocapture decides what to send by reading the DOM,
 * so the answer to "can this event carry a donor's email?" becomes "whatever
 * happens to be rendered". Here the answer is a list you can read in full.
 *
 * ⚠️ Adding an event or a property means editing THIS file. That is the point.
 * `analytics-privacy.test.ts` walks every label below and fails if one of them
 * is a person-identifying field, so the review question ("what does this
 * send?") is answered by a test rather than by a reviewer's memory.
 */

/* ── what we send ──────────────────────────────────────────────────────────── */

/**
 * Every event name this app may capture.
 *
 * `$pageview` is PostHog's own event, captured by hand: `capture_pageview` is
 * off precisely so the pre-auth funnel can be excluded (see AnalyticsBridge).
 * The SDK's automatic version fires on every history change, including
 * `/auth`, which is the surface we deliberately do not track.
 */
export const ANALYTICS_EVENTS = {
  PAGEVIEW: '$pageview',
} as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

/**
 * PostHog's identity plumbing. These are emitted by `identify()` / `group()`
 * rather than by us, and dropping them would break identification outright —
 * so they are allowed by name, not by a `$`-prefix rule that would also let
 * `$autocapture`, `$exception` and `$copy_autocapture` through.
 *
 * 🔴 `$copy_autocapture` is the reason this is a list and not a prefix: it
 * captures the text the user copied. On `/admin/crm` that is a donor's email
 * address, selected by an admin who is doing their job.
 */
const POSTHOG_IDENTITY_EVENTS = ['$identify', '$groupidentify', '$set'] as const;

/** The complete set of event names permitted to leave the browser. */
export const ALLOWED_EVENT_NAMES: readonly string[] = Object.freeze([
  ...Object.values(ANALYTICS_EVENTS),
  ...POSTHOG_IDENTITY_EVENTS,
]);

/**
 * Property keys Harvest itself attaches to an event. Three, all derived from
 * the URL shape and the signed-in account kind — none reads a document.
 *
 * `app_surface` is the route family ('admin' | 'member' | 'public'), never the
 * route: an id-bearing path like `/admin/docs/:id` is reduced to 'admin' before
 * it is ever a property.
 *
 * ⚠️ `route` is THE-206's one addition to this list, and it is an addition made
 * the way this file intends — by editing it. It carries the normalised route
 * PATTERN and nothing else: `/form/[formId]`, never `/form/aB3xQ…`. The
 * enumeration that produces it is `routes.ts`, which matches a path against a
 * fixed list and answers `/[unrouted]` when it recognises nothing, so a live
 * path segment cannot arrive through it.
 *
 * 🔴 It exists because `app_surface` alone cannot answer the question the
 * public routes were added for. 'public' is one bucket holding a blog, a form,
 * an event page and a check-in screen; "how many people opened a form?" needs
 * the route. Pattern, not path — the count is identical either way, because one
 * pattern is exactly the set of pages it matches.
 */
export const ALLOWED_EVENT_PROPERTY_KEYS: readonly string[] = Object.freeze([
  'app_surface',
  'is_platform_admin',
  'route',
]);

/**
 * Person property keys set on identify.
 *
 * Deliberately not here: name, email, photo, role, tenant. The tenant is a
 * GROUP, not a person property (see identity.ts), and the rest are the donor
 * record this whole file exists to keep out.
 */
export const ALLOWED_PERSON_PROPERTY_KEYS: readonly string[] = Object.freeze([
  'account_kind',
]);

/** The group type churches are separated by. One tenant slug per church. */
export const TENANT_GROUP_TYPE = 'tenant';

/* ── what must never be sent ───────────────────────────────────────────────── */

/*
 * The lists below are ENUMERATED FIELD LABELS taken from this codebase, not
 * guesses and not patterns. Each name is a real field on a real document:
 *
 *   Contact          src/hooks/queries/useCRMQueries.ts   firstName, lastName,
 *                                                         email, phone, notes,
 *                                                         tags, photoURL,
 *                                                         totalDonated
 *   CSV import       src/utils/csv-import.ts              street, city, state,
 *                                                         zip, country
 *   Donation webhook src/lib/donation-webhook.ts          donorEmail, donorName,
 *                                                         donorUserId,
 *                                                         amountDollars
 *   PrayerRequest    src/components/PrayerWall.tsx        request, authorName
 *   Messages         src/components/UserMessages.tsx      content, lastMessage,
 *                                                         senderName
 *   ContactActivity  src/hooks/queries/useCRMQueries.ts   description, amount
 *
 * Over-redaction is the intended failure mode, exactly as in `sentry-scrub.ts`:
 * the vocabulary above is three keys wide, so nothing legitimate can collide
 * with these. A generic-looking label (`text`, `state`, `description`) costs us
 * nothing and closes a real field.
 */

/** Names a donor or member would be recognised by. */
export const DONOR_IDENTITY_LABELS: readonly string[] = Object.freeze([
  'donorname', 'donoremail', 'donorphone', 'donoruserid',
  'firstname', 'lastname', 'fullname', 'displayname', 'username',
  'authorname', 'sendername', 'membername', 'attendeename', 'guestname',
  'recipientname', 'payername', 'customername', 'billingname',
  'name', 'photourl', 'avatar', 'avatarurl',
]);

/** Reachability — the fields an email or a phone call would use. */
export const CONTACT_CHANNEL_LABELS: readonly string[] = Object.freeze([
  'email', 'emailaddress', 'useremail', 'contactemail', 'recipientemail',
  'payeremail', 'billingemail', 'customeremail',
  'phone', 'phonenumber', 'contactphone', 'recipientphone', 'mobile', 'tel',
]);

/** The rest of a CRM contact record. */
export const CONTACT_RECORD_LABELS: readonly string[] = Object.freeze([
  'address', 'street', 'city', 'state', 'zip', 'zipcode', 'postcode', 'country',
  'notes', 'tags', 'contact', 'contacts', 'contactid',
]);

/** Money tied to a person. */
export const GIVING_LABELS: readonly string[] = Object.freeze([
  'totaldonated', 'amount', 'amountdollars', 'amountcents', 'amounttotal',
  'donationamount', 'pledgeamount', 'lastgift', 'lastgiftamount', 'giving',
]);

/** Prayer requests — the member app's most sensitive free text. */
export const PRAYER_LABELS: readonly string[] = Object.freeze([
  'request', 'prayerrequest', 'prayer', 'prayedby',
]);

/** Message and note bodies. */
export const MESSAGE_LABELS: readonly string[] = Object.freeze([
  'content', 'body', 'message', 'messagebody', 'lastmessage', 'text',
  'description', 'note',
]);

/**
 * Every forbidden label, lower-cased. `before_send` removes any property whose
 * key matches one of these — at any depth, in `properties`, `$set` and
 * `$set_once` alike.
 */
export const FORBIDDEN_PROPERTY_LABELS: readonly string[] = Object.freeze([
  ...DONOR_IDENTITY_LABELS,
  ...CONTACT_CHANNEL_LABELS,
  ...CONTACT_RECORD_LABELS,
  ...GIVING_LABELS,
  ...PRAYER_LABELS,
  ...MESSAGE_LABELS,
]);

const FORBIDDEN_LOOKUP = new Set(FORBIDDEN_PROPERTY_LABELS);

/**
 * True when a property key names something that must never leave the browser.
 *
 * Underscores and hyphens are stripped before comparison so `donor_email`,
 * `donor-email` and `donorEmail` are one label, not three.
 */
export function isForbiddenPropertyLabel(key: string): boolean {
  return FORBIDDEN_LOOKUP.has(key.toLowerCase().replace(/[_-]/g, ''));
}
