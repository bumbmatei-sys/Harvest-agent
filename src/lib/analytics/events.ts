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

  /* -- THE-360: the product events -------------------------------------- */
  /**
   * A gift recorded by hand, from the CRM. The action the whole manual-money
   * model rests on, and the one signal that says a church is still getting
   * value: a church that stops recording gifts has stopped using Harvest for
   * the thing it bought Harvest for.
   *
   * Carries NO AMOUNT, bucketed or otherwise. A church with one donor makes any
   * bucket the identity of that donor, and the product question this event
   * exists to answer -- "are they recording gifts at all?" -- is answered by
   * the count. `amount` is a FORBIDDEN label besides (see GIVING_LABELS), so
   * sending one would take a deletion from that list rather than an addition to
   * this one. That asymmetry is deliberate.
   */
  GIFT_RECORDED: 'gift_recorded',

  /**
   * The same money by its other route: an admin confirming that a member paid
   * for a paid event. Writes the same `donation_receipt` invoice through the
   * same `recordManualDonation`, so it is a gift by every definition the
   * ledger uses -- but it is a different ACTION, taken on a different screen by
   * an admin doing a different job, and collapsing the two would hide which of
   * the two ways of getting money in is actually used.
   */
  EVENT_PAYMENT_CONFIRMED: 'event_payment_confirmed',

  /** Discipleship material actually going out, rather than being drafted. */
  COURSE_PUBLISHED: 'course_published',

  /**
   * THE-361 - a church taking a course out of the Harvest LIBRARY and making it
   * their own. The other half of `course_published`: that one says a church
   * WROTE discipleship material, this one says a church is using material the
   * platform wrote. A church that adopts is a church that has found the library
   * worth something, which is the activation question the catalogue exists to
   * answer.
   *
   * ⚠️ THE-360 PROPOSED THIS AND DID NOT ADD IT, on a report that no adopt
   * action could be found. The action was there - `AdminCourses` has posted to
   * `/api/courses/adopt` since #228 - so the omission was a wrong premise
   * rather than a decision, and this ticket corrects it.
   *
   * Carries NO COURSE ID, NO TITLE AND NO AUTHOR NAME, and not because a
   * library title identifies anybody - it does not; the catalogue is the
   * platform's own and every church sees the same rows. It carries none
   * because the product question is "are churches adopting at all", and a
   * COUNT answers that. A title would be a new kind of value on an event -
   * text a document supplies rather than a literal this app wrote - and the
   * seam that fires this has no parameter to carry one through, which is the
   * design working rather than an obstacle to route around.
   *
   * 🔴 SUCCESS ONLY. The route independently refuses an unpublished course and
   * re-checks the plan cap server-side, so a refused adopt that fired this
   * would report an activation that did not happen.
   *
   * NOT ADDED: an un-adopt event. Adoption is the activation signal; dropping
   * a course is noise until there is enough of it to be a pattern, and every
   * event that is not needed is another way for a property to leak.
   */
  COURSE_ADOPTED: 'course_adopted',

  /** Sunday planning being used: an order of service that exists. */
  SERVICE_CREATED: 'service_created',

  /** The other half of Sunday planning: the volunteers actually being asked. */
  ROTA_INVITATIONS_SENT: 'rota_invitations_sent',

  /** A form going live. The Free tier's product, so Free churches are visible. */
  FORM_PUBLISHED: 'form_published',

  /**
   * Somebody filled a form in. The one event here that fires from a PUBLIC
   * surface (`/form/[formId]`), by a visitor with no account -- so it carries
   * no `is_platform_admin`, for the reason `capturePublicPageview` gives.
   */
  SIGNUP_CREATED: 'signup_created',

  /** Fundraising activation: a campaign that exists to be given to. */
  CAMPAIGN_CREATED: 'campaign_created',

  /**
   * A church that hit a cap. The event closest to revenue in this whole file:
   * it is a church about to upgrade, or a church about to leave, and the two
   * look identical until somebody looks.
   *
   * The only event that carries `limit_kind`, which names WHICH cap from a
   * fixed table -- see PLAN_LIMIT_KINDS.
   */
  PLAN_LIMIT_REACHED: 'plan_limit_reached',
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
  'limit_kind',
]);

/**
 * THE-360 - which cap a `plan_limit_reached` was. The ONE property this ticket
 * adds, and the only one it needed.
 *
 * The founder asked for three: `surface`, `plan` and `section`. Two of the
 * three were already shipping and the third does not belong on an event:
 *
 *   - `surface` IS `app_surface`, which has answered 'admin' | 'member' |
 *     'public' since THE-36 and answers it from the ROUTE THAT MATCHED, not
 *     from the user agent. A phone-sized browser on `/admin/crm` matches the
 *     `/admin/crm` row and is 'admin', which is the rule that was wanted.
 *   - `section` is already inside `route`. THE-227 generates one row per admin
 *     section, so `/admin/crm` and `/admin/accounting` are already two values.
 *   - `plan` is a fact about a CHURCH, and churches are already a PostHog
 *     GROUP. It belongs on that group, not stamped onto every event -- see the
 *     note in `client.ts`.
 *
 * So the list grows by one key, for the one question the three existing keys
 * genuinely cannot answer: WHICH cap a church hit.
 *
 * 🔴 WHY THIS IS SAFE, AND IT IS THE SAME ARGUMENT `admin-sections.ts` MAKES.
 * Every value below is a compile-time literal naming a FEATURE -- the same
 * category of word as `app_surface: 'admin'`, from a vocabulary this app
 * defines in its own source. Nothing user-chosen, nothing tenant-specific,
 * nothing a document supplies, no count and no ceiling: a ceiling is a fact
 * about a plan, and a COUNT ("you have 149 of 150 contacts") is a fact about
 * one church's records. Neither is needed to answer "which churches are hitting
 * which wall", and both would be new ways for a number to leak.
 */
export const PLAN_LIMIT_KINDS = ['contacts', 'sms', 'admin_seats'] as const;

export type PlanLimitKind = (typeof PLAN_LIMIT_KINDS)[number];

/*
 * ⚠️ `ai_knowledge` IS DELIBERATELY ABSENT, and it is the one the ticket named
 * that this file does not carry.
 *
 * The RAG cap has no MOMENT. `AdminRAG`'s `UsageMeter` computes `over = used >=
 * limit` while RENDERING, so there is no action that was refused -- only a bar
 * that is full. An event fired from there would fire on every render and on
 * every usage poll, which is not "a church hit a cap" but "a church has a
 * screen open", and `each new event fires exactly once at its moment` would be
 * asserting something untrue. The other three are real refusals: a contact that
 * was not saved, an admin that was not promoted, a broadcast that ran out of
 * segments part-way through.
 *
 * If the RAG upload path ever grows a server-side refusal, it earns a row here
 * the way every other row was earned -- by having a moment to fire at.
 */

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
