/**
 * THE-351 — 🔴 PAID EVENTS WITH NO PAYMENT RAIL. The church confirms; Harvest
 * records what the church says.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 1. THE ONE PROPOSITION EVERY WORD IN THIS FILE SERVES
 *
 * THE FOUNDER: "Don't let Harvest imply it verified anything. The church
 * confirms; Harvest records what the church says. If a member disputes it, the
 * church's PayPal is the truth, not Harvest."
 *
 * `STRIPE_CONNECT_ENABLED` is false and the platform account is closed as
 * `rejected.fraud`. No rail exists, none is coming this quarter, and THE-345
 * gated paid ticketing for exactly that reason. This module un-gates it on the
 * only honest terms available: the member pays the church DIRECTLY, through the
 * church's own PayPal / Cash App / Venmo / Zelle / Revolut / Wise link, and a
 * named human at the church opens that account, finds the payment, and says so.
 *
 * Harvest's entire role is bookkeeping AFTER a person has vouched. So:
 *
 *   · Nothing here ever says "verified", "confirmed by Harvest", "payment
 *     received" or "payment complete". {@link FORBIDDEN_CLAIM_PHRASES} is that
 *     rule as data, and THE-351's suite sweeps every string below against it.
 *   · A member pressing "I've paid" changes NO money state. It sets a flag that
 *     means "look in your account", and the copy says that to the member in the
 *     same breath as the button.
 *   · A confirmation carries WHO pressed it and WHEN, because if a gift is
 *     disputed the church needs the name of the admin who vouched — not
 *     Harvest's opinion, which it does not have.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 2. WHY THIS IS A REGISTRATION FIELD SET AND NOT A NEW COLLECTION
 *
 * ⚠️ THE INBOX IS DERIVED FROM `tenants/{t}/registrations`, AND THAT IS A
 * SECURITY DECISION BEFORE IT IS A MODELLING ONE.
 *
 * A new `tenants/{t}/inbox` collection would need a `firestore.rules` block, and
 * that file AUTO-DEPLOYS ON MERGE WITH NO EMULATOR TESTS IN CI — THE-313's
 * one-line change turned 46 files red. THE-350 hit the same wall for the money
 * ledger and answered it the same way: no rule change, go through the Admin SDK
 * behind a route that imposes the permission itself.
 *
 * Deriving from `registrations` buys three things a new collection could not:
 *
 *   1. TENANCY COMES FROM THE PATH. `tenants/{tenantId}/registrations` is
 *      already gated `isAuthenticated() && (isTenantAdmin(tenantId) || …)`, so
 *      "a church cannot see another church's inbox" is a rule that already
 *      shipped and is already exercised. No new surface, no new rule, no new
 *      way to get the scoping wrong.
 *   2. GDPR IS ALREADY DONE. `member-erasure.ts` DELETES a member's
 *      registrations (by uid and by email) and `member-export.ts` exports them
 *      whole. An inbox item IS a registration, so it is erased with the member
 *      and exported with them, with no new collection to remember. A separate
 *      collection would have been the tenth thing to remember and the first one
 *      forgotten.
 *   3. THERE IS ONLY EVER ONE RECORD OF ONE SEAT. A claim, its confirmation and
 *      the ticket it belongs to cannot drift apart, because they are fields on
 *      one document that a transaction can hold.
 *
 * 🔵 SO THE INBOX IS PAYMENT-SPECIFIC, DELIBERATELY, AND THE CHOICE IS REPORTED
 * RATHER THAN HIDDEN. A generic tenant inbox — payment confirmations today,
 * form submissions and prayer requests tomorrow — is more useful and is the
 * thing to build the day one of those needs a rules change anyway. Today it
 * would buy a generic collection whose only content is payment claims, at the
 * price of the one file this ticket is forbidden to touch. The COMPONENT is
 * written against {@link InboxItem}, an item-shaped model with a kind
 * discriminator, so a second source that also derives from an existing
 * collection can be added without reshaping the surface.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 3. THE ORDERING, AND WHY THERE IS A SECOND TIMESTAMP FIELD
 *
 * #405 found FORTY-ONE files doing `limit(N)` with no `orderBy`. Firestore has
 * no default order, so an unordered `limit(N)` returns N ARBITRARY rows. An
 * inbox is the worst possible place for that: the row it drops is a person the
 * church owes a seat to.
 *
 * ⚠️ AND A DESCENDING LIMIT IS BARELY BETTER — it drops the OLDEST pending
 * item, which is precisely the one that has been waiting longest and is most
 * likely to have been forgotten. So the queue is read ASCENDING: the oldest
 * claim is first, and truncation can only ever drop the NEWEST — the one that
 * just arrived and is least at risk.
 *
 * 🔴 THAT NEEDS NO COMPOSITE INDEX, AND THE SHAPE IS CHOSEN SO IT NEVER WILL.
 * `firestore.indexes.json` is NOT deployed by `deploy-rules.yml`, so an index
 * added there is INERT and the query throws `failed-precondition` in
 * production. An equality `where` plus an `orderBy` on a DIFFERENT field is a
 * composite index. So the queue filter and the queue order are THE SAME FIELD:
 *
 *     {@link CLAIM_QUEUE_FIELD} — written when a member presses "I've paid",
 *     DELETED when an admin confirms.
 *
 * `orderBy(CLAIM_QUEUE_FIELD, 'asc')` alone is a single-field index, which
 * Firestore maintains automatically for every field. Documents that do not
 * carry the field are excluded by the `orderBy` itself, so the pending set and
 * the queue order fall out of one constraint. Nothing filters, so nothing
 * composites.
 *
 * ⚠️ `claimedAt` IS KEPT SEPARATELY AND IS NEVER DELETED. The queue field is an
 * INDEX KEY whose lifetime is "unresolved"; `claimedAt` is the AUDIT FACT "when
 * this person pressed the button", and the inbox row and the confirmation
 * record both need it after the queue entry is gone. They are written with the
 * same value and they are not the same thing.
 *
 * ⚠️ ISO STRINGS, NOT TIMESTAMPS, for the reason `manual-donation.ts` spells
 * out: Firestore orders ACROSS TYPES BY TYPE FIRST, so one Timestamp written
 * into a column of ISO strings sorts into a different band and a `limit()` can
 * truncate it out of the queue entirely while every test stays green. One
 * representation, chosen once, here.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 4. THIS FILE IMPORTS NOTHING BUT THE PROVIDER TABLE
 *
 * Same discipline as `paid-events-feature.ts` and `giving-providers.ts`: it is
 * read from client components, from three API routes and from the notification
 * builder, so it must not drag `firebase-admin`, `resend` or the pricing matrix
 * into any of them. Everything here is pure.
 */
import {
  GIVING_PROVIDERS,
  GIVING_PROVIDER_NAMES_OR,
  isGivingProviderId,
  type GivingProvider,
  type GivingProviderId,
  type PublishedGivingLink,
} from '@/components/donations/giving-providers';

/* ══ The fields, spelled once ══════════════════════════════════════════════ */

/**
 * 🔴 THE QUEUE KEY. Present ⇔ "a member has said they paid and nobody has
 * confirmed it yet". See section 3: this is both the filter and the order, so
 * the inbox needs no composite index and can never require one.
 *
 * Spelled as a constant because THREE places have to agree on it exactly — the
 * write in the claim route, the `orderBy` in the inbox route and the
 * `FieldValue.delete()` in the confirm route — and a typo in any one of them
 * produces an inbox that is silently always empty.
 */
export const CLAIM_QUEUE_FIELD = 'paymentClaimPendingAt';

/** Every field this feature writes onto a registration document. */
export const PAYMENT_CLAIM_FIELDS = Object.freeze({
  /** `'unpaid' | 'confirmed'`. Absent on a free registration. */
  status: 'paymentStatus',
  /** The reference the member is asked to put in the payment note. */
  reference: 'paymentReference',
  /** The queue key — see {@link CLAIM_QUEUE_FIELD}. */
  queue: CLAIM_QUEUE_FIELD,
  /** ISO. When the member pressed "I've paid". Never deleted. */
  claimedAt: 'paymentClaimedAt',
  /** Which provider the MEMBER SAYS they used. Their word, stored as theirs. */
  claimedProvider: 'paymentClaimProvider',
  /** ISO. Set while a confirmation is in flight — the idempotency lock. */
  confirmLock: 'paymentConfirmStartedAt',
  /** ISO. When an admin confirmed. */
  confirmedAt: 'paymentConfirmedAt',
  /** The admin's uid. The audit trail of WHO vouched. */
  confirmedBy: 'paymentConfirmedBy',
  /** The admin's display name, resolved at confirm time. */
  confirmedByName: 'paymentConfirmedByName',
  /** 🔴 The `tenants/{t}/invoices` id THE-350's writer returned. */
  invoiceId: 'paymentInvoiceId',
  /**
   * 🔴 THE-355 — the 256-bit token a LOGGED-OUT registrant claims with. Minted
   * by the submit route for a seat that owes money, handed back once to the
   * person who just registered, and never read by any surface but the public
   * claim route. See {@link PUBLIC_CLAIM_TOKEN_RE}.
   */
  claimToken: 'paymentClaimToken',
} as const);

/**
 * 🔴 THE `source` THE-350's WRITER IS CALLED WITH.
 *
 * `manual-donation.ts` declares `'event_manual'` for exactly this caller and
 * documents the reading: an invoice carrying one of `MANUAL_DONATION_SOURCES`
 * was recorded by a person, and one carrying no `source` at all was processed
 * by the Stripe webhook. So the day a real rail exists, a gift a church vouched
 * for and a gift a processor cleared are separable by a field rather than by a
 * guess — which is the whole reason the field exists.
 *
 * ⚠️ Spelled here as well so this ticket's suite can assert the exact value
 * WITHOUT importing `manual-donation.ts`, which imports `firebase-admin`.
 */
export const EVENT_CONFIRMATION_SOURCE = 'event_manual';

/**
 * How long a half-finished confirmation holds the lock before another admin may
 * retry. Long enough that a slow invoice write is never double-submitted;
 * short enough that a crashed request does not strand a row forever.
 */
export const CONFIRM_LOCK_TTL_MS = 60_000;

/* ══ The reference code ════════════════════════════════════════════════════ */

/**
 * 🔴 THE ALPHABET, AND EVERY CHARACTER MISSING FROM IT IS MISSING ON PURPOSE.
 *
 * This code is READ OFF A BANK LINE BY A HUMAN and TYPED INTO A PAYMENT NOTE BY
 * ANOTHER HUMAN, on a phone, possibly having been written on paper in between.
 * `0`/`O`, `1`/`I`/`L` are the pairs that get transcribed wrong, and a
 * transcription error here is an admin who cannot find a payment that is
 * sitting in front of them. 31 symbols; 31⁶ ≈ 887 million.
 */
export const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** Characters in the random half of a reference. */
export const REFERENCE_BODY_LENGTH = 6;

/**
 * The prefix. Short, and recognisable in a column of bank memos that are
 * otherwise people's names.
 */
export const REFERENCE_PREFIX = 'HV-';

/**
 * 🔴 IT IS NOT THE TICKET CODE, AND THAT IS A SECURITY FINDING, NOT A
 * PREFERENCE.
 *
 * The obvious economy is to reuse `registrations/{id}.ticketCode` — it is
 * already unique, already searchable in the attendee list, already printed on
 * the ticket. It must not be used, because THE TICKET CODE IS WHAT THE QR
 * ENCODES AND WHAT GETS A PERSON THROUGH THE DOOR, and a reference code's whole
 * job is to be written into a payment note.
 *
 * ⚠️ VENMO'S TRANSACTION FEED IS PUBLIC BY DEFAULT. Putting the ticket code in
 * the note would publish a door credential to a public feed. So this is a
 * SECOND identifier that grants nothing: it opens no door, authorises no read,
 * and is worth precisely one thing to whoever reads it — the ability to find a
 * row in an inbox they must already be an admin to open.
 */
export function isPaymentReference(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!value.startsWith(REFERENCE_PREFIX)) return false;
  const body = value.slice(REFERENCE_PREFIX.length);
  if (body.length !== REFERENCE_BODY_LENGTH) return false;
  return [...body].every((c) => REFERENCE_ALPHABET.includes(c));
}

/**
 * Build a reference from bytes the CALLER supplies.
 *
 * ⚠️ THE RANDOMNESS IS AN ARGUMENT so this module stays pure and so the shape
 * is testable without stubbing a global. The route passes
 * `crypto.randomBytes(REFERENCE_BODY_LENGTH)`.
 *
 * ⚠️ MODULO IS DELIBERATE AND THE BIAS IS ACCOUNTED FOR: 256 mod 31 = 8, so the
 * first eight symbols are drawn ~3% more often than the last twenty-three. This
 * is a MATCHING AID, not a secret — it protects nothing, so a 3% skew across
 * 887 million values costs nothing, and rejection sampling would buy an
 * unbounded loop in a money path for no property anyone relies on.
 */
export function buildPaymentReference(bytes: ArrayLike<number>): string {
  if (bytes.length < REFERENCE_BODY_LENGTH) {
    throw new Error(`buildPaymentReference needs ${REFERENCE_BODY_LENGTH} bytes`);
  }
  let body = '';
  for (let i = 0; i < REFERENCE_BODY_LENGTH; i += 1) {
    body += REFERENCE_ALPHABET[bytes[i] % REFERENCE_ALPHABET.length];
  }
  return `${REFERENCE_PREFIX}${body}`;
}

/* ══ Provider selection ════════════════════════════════════════════════════ */

/**
 * 🔴 WHICH OF THE CHURCH'S LINKS ACCEPT PAYMENT FOR *THIS* EVENT.
 *
 * THE FOUNDER: "maybe just PayPal or just revolut or just whatever or all of
 * them."
 *
 * 🔵 IT IS A SUBSET OF THE CHURCH'S OWN CONFIGURED LINKS, AND IT IS INTERSECTED
 * ON EVERY READ RATHER THAN TRUSTED FROM THE EVENT DOCUMENT. The event stores
 * ids; the church's links live on `tenants/{id}.config.givingLinks` and are
 * re-validated by `readGivingLinks` every time they are read (a stored URL that
 * no longer passes the phishing allow-list simply stops being a link). A church
 * that ticks PayPal for a conference and then DELETES its PayPal link must not
 * leave a member staring at a dead PayPal tile — so the event's selection can
 * only ever narrow what the church currently publishes, never widen it.
 *
 * ⚠️ AN EMPTY SELECTION MEANS "ALL OF THEM", and that is the safe direction
 * rather than a shortcut. An event created before this field existed, or one
 * whose ticked provider was later removed from the church's settings, would
 * otherwise render a paid ticket with nowhere to pay — the one state this
 * feature must never produce. Falling back to every link the church publishes
 * shows the member somewhere real to send money in every case.
 */
export function resolveEventPaymentLinks(
  publishedLinks: readonly PublishedGivingLink[],
  selectedIds: unknown,
): PublishedGivingLink[] {
  const wanted = readEventProviderIds(selectedIds);
  if (wanted.length === 0) return [...publishedLinks];
  const narrowed = publishedLinks.filter((l) => wanted.includes(l.provider.id));
  return narrowed.length > 0 ? narrowed : [...publishedLinks];
}

/**
 * The provider ids stored on an event, cleaned. Walks the TABLE rather than the
 * stored array so the result is in display order whatever order it was saved
 * in — the same rule `readGivingLinks` follows, and for the same reason: a
 * giving surface that moves between visits is one a member cannot learn.
 */
export function readEventProviderIds(raw: unknown): GivingProviderId[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set(raw.filter(isGivingProviderId));
  return GIVING_PROVIDERS.filter((p) => set.has(p.id)).map((p) => p.id);
}

/** The provider a member named, as a table row — or null if they named none. */
export function providerFromClaim(raw: unknown): GivingProvider | null {
  if (!isGivingProviderId(raw)) return null;
  return GIVING_PROVIDERS.find((p) => p.id === raw) ?? null;
}

/* ══ The state of one registration's payment ═══════════════════════════════ */

export type PaymentState =
  /** Free, or an event with no price. This feature is entirely absent. */
  | 'free'
  /** Priced, nobody has said anything. */
  | 'unpaid'
  /** The member pressed "I've paid". 🔴 Confirms NOTHING. */
  | 'claimed'
  /** An admin at the church vouched for it. */
  | 'confirmed';

export interface RegistrationPaymentFields {
  amount?: unknown;
  paymentStatus?: unknown;
  paymentClaimedAt?: unknown;
  paymentConfirmedAt?: unknown;
  paymentInvoiceId?: unknown;
}

/**
 * 🔴 THE ONE PLACE A REGISTRATION'S PAYMENT STATE IS DECIDED.
 *
 * Read in the member's ticket, the attendee row the door volunteer looks at,
 * the CSV and the inbox. Four independent ternaries is how THE-345 found the
 * same stored number rendered four different ways with one of them left lying.
 *
 * ⚠️ `confirmed` IS KEYED ON THE INVOICE ID, not on `paymentStatus`. The
 * invoice is the money record; a status field that said "confirmed" without one
 * would be a ticket claiming a gift the ledger has never heard of. If the
 * invoice write failed, this reports `claimed` — which is true — and the ticket
 * stays unpaid, which is the whole of Non-negotiable 2.
 */
export function paymentStateOf(reg: RegistrationPaymentFields): PaymentState {
  const amount = typeof reg.amount === 'number' ? reg.amount : 0;
  if (!(amount > 0)) return 'free';
  if (typeof reg.paymentInvoiceId === 'string' && reg.paymentInvoiceId.length > 0) {
    return 'confirmed';
  }
  if (typeof reg.paymentClaimedAt === 'string' && reg.paymentClaimedAt.length > 0) {
    return 'claimed';
  }
  return 'unpaid';
}

/* ══ The inbox model ═══════════════════════════════════════════════════════ */

/**
 * 🔵 ITEM-SHAPED, WITH A `kind`. One kind ships. The discriminator is here so a
 * second source — one that also derives from a collection whose rules already
 * exist — is a new branch in the renderer rather than a reshaped surface. See
 * section 2 for why a genuinely generic inbox is not this ticket's to build.
 */
export type InboxItemKind = 'event_payment_claim';

/**
 * 🔴 EVERYTHING THE ADMIN NEEDS TO MATCH A BANK LINE, AND THE ROW CARRIES ALL
 * OF IT.
 *
 * THE FOUNDER: "the guy who presses the confirmation button checks the church
 * bank first." So the row is not a notification — it is the left-hand column of
 * a reconciliation. Open PayPal beside it and every field you need to match is
 * on the row: WHO (`memberName`), HOW MUCH (`amountCents`), WHICH LINE
 * (`reference`), WHERE TO LOOK (`providerLabel`) and WHEN (`claimedAt`).
 *
 * ⚠️ DROP ANY ONE OF THEM AND THE ADMIN IS GUESSING. Without the reference they
 * are matching on name and amount, which collides the moment two people from
 * one family pay for the same ticket type. Without the provider they open the
 * wrong account first. Without the timestamp they cannot tell a claim from
 * Friday from one from five minutes ago.
 */
export interface InboxItem {
  kind: InboxItemKind;
  /** The registration document id — the thing Confirm is called with. */
  id: string;
  memberName: string;
  memberEmail: string;
  eventTitle: string;
  /** 🔴 Integer cents, as stored on the registration. */
  amountCents: number;
  reference: string;
  /** The provider the member SAYS they used, or null if they named none. */
  providerId: GivingProviderId | null;
  providerLabel: string | null;
  /** ISO — when they pressed "I've paid". */
  claimedAt: string;
}

/**
 * 🔴 THE CEILING ON ONE INBOX READ, AND WHY THE COUNT IS STILL EXACT.
 *
 * A figure ships only if its read is EXACT or PROVABLY COMPLETE, and the unread
 * badge is a figure. The route reads `CEILING + 1` rows: at most `CEILING` came
 * back ⇒ the queue is exactly that long and the badge is exact; `CEILING + 1`
 * came back ⇒ the badge says `{@link INBOX_COUNT_OVERFLOW_SUFFIX}` and the sheet
 * says how many it is showing. Never a bare number over a truncated read.
 *
 * ⚠️ AND THE ROWS ARE THE OLDEST ONES. Ascending order (section 3) means the
 * rows that fall off the end are the newest arrivals, not the forgotten ones.
 */
export const INBOX_CEILING = 200;

/** Rendered after a count that could not be proven complete, e.g. `200+`. */
export const INBOX_COUNT_OVERFLOW_SUFFIX = '+';

/** What the badge shows. Exact, or an honest overflow — never a bare guess. */
export function inboxBadgeLabel(count: number, exact: boolean): string {
  return exact ? String(count) : `${count}${INBOX_COUNT_OVERFLOW_SUFFIX}`;
}

/* ══ Money formatting ══════════════════════════════════════════════════════ */

/**
 * Cents → `$50.00`. Spelled here so the member's ticket, the inbox row, the
 * notification email and the CSV cannot disagree about one number.
 */
export function formatCents(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0;
  return `$${(safe / 100).toFixed(2)}`;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* 🔴 EVERY WORD OF USER-FACING COPY IN THIS FEATURE                          */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * 🔴 THE PHRASES NOTHING IN THIS FEATURE MAY SAY, AS DATA.
 *
 * The founder's rule is a rule about WORDS, so it is enforced on words. THE-351's
 * suite greps every string exported below — and the components and routes that
 * render them — for these. A guard that only read a design document would pass
 * a defect the day someone types "Payment received!" into a toast.
 *
 * ⚠️ EACH ONE IS A DIFFERENT LIE.
 *   · "verified" / "we verified" — Harvest checked. It cannot.
 *   · "confirmed by Harvest" — names the wrong party as the voucher.
 *   · "payment received" / "payment complete" — asserts money arrived somewhere
 *     Harvest can see. It arrived in the church's account, unobserved.
 *   · "we've confirmed" / "we have confirmed" — same, in the first person.
 *
 * ⚠️ "confirm" ALONE IS NOT ON THIS LIST AND MUST NOT BE. It is the correct verb
 * for what the CHURCH does, it is the founder's own word for the button, and
 * banning it would leave the feature with no way to name its central act. What
 * is banned is Harvest claiming the act.
 */
export const FORBIDDEN_CLAIM_PHRASES: readonly string[] = Object.freeze([
  'verified',
  'verifies',
  'we verify',
  'confirmed by harvest',
  'harvest confirmed',
  'payment received',
  'payment complete',
  "we've confirmed",
  'we have confirmed',
  'we confirmed',
  'payment successful',
]);

/** Does this string make a claim Harvest is not entitled to make? */
export function claimsVerification(text: string): string | null {
  const haystack = text.toLowerCase();
  for (const phrase of FORBIDDEN_CLAIM_PHRASES) {
    if (haystack.includes(phrase)) return phrase;
  }
  return null;
}

/* ── 1. The admin, creating a paid event ─────────────────────────────────── */

/**
 * 🔴 THE CREATION DISCLAIMER. NOT A FOOTNOTE.
 *
 * It renders as an `alert` at the top of the pricing block, before the price
 * input, so an admin cannot type a number without having read it. Three facts,
 * in the order they bite: Harvest cannot check; YOU will confirm each one by
 * hand; and an unconfirmed member still gets in at the door.
 *
 * ⚠️ THE THIRD SENTENCE IS NOT RESSURANCE, IT IS AN OPERATIONAL WARNING. An
 * admin who does not know that check-in never blocks on payment will plan a
 * door process around a guarantee that does not exist.
 */
export const CREATION_DISCLAIMER_TITLE = 'You will confirm every payment by hand';

export const CREATION_DISCLAIMER_BODY =
  'Harvest cannot take card payments and cannot check whether anyone has paid. '
  + 'People register straight away and are marked unpaid. They pay your church '
  + 'directly through the links you tick below, and then you open that account '
  + 'yourself, find the payment by its reference, and confirm it here. '
  + 'Until you do, the ticket reads unpaid — and anyone holding an unpaid '
  + 'ticket is still let in at the door.';

/**
 * What an admin is told when the church has NO payment links saved at all.
 *
 * 🔵 IT IS A REFUSAL WITH AN INSTRUCTION, NOT AN ERROR. Pricing a ticket with
 * nowhere for the money to go produces a member staring at a price and no way
 * to pay, so the price input is ABSENT rather than disabled — the same
 * reasoning THE-345 used for the field it hid — and the copy names the screen
 * that fixes it.
 */
export const NO_LINKS_TITLE = 'Add a payment link before you charge for an event';

export const NO_LINKS_BODY =
  'Your church has no payment links saved, so there is nowhere for ticket money '
  + `to go. Add a ${GIVING_PROVIDER_NAMES_OR} link under Donations, then come `
  + 'back and price this event. Registration works as normal in the meantime — '
  + 'publish the event, take registrations, scan tickets at the door and export '
  + 'your attendee list.';

/** The heading over the per-event provider checkboxes. */
export const PROVIDER_PICKER_TITLE = 'Which of your links accept payment for this event';

export const PROVIDER_PICKER_HELP =
  'Tick the ones you want people to use. Everyone registering sees exactly '
  + 'these, and a reference code to put in the payment note.';

/* ── 2. The member's ticket ──────────────────────────────────────────────── */

export const MEMBER_UNPAID_BADGE = 'Unpaid';
export const MEMBER_CLAIMED_BADGE = 'Waiting on the church';
export const MEMBER_CONFIRMED_BADGE = 'Marked paid by the church';

/** The instruction on an unpaid ticket. `{church}` and `{amount}` interpolate. */
export function memberUnpaidBody(churchName: string, amountCents: number, reference: string): string {
  return (
    `Your place is booked. Pay ${churchName} ${formatCents(amountCents)} using one of the `
    + `options below, and put ${reference} in the payment note so they can find it. `
    + `Harvest does not handle this money and cannot see it — ${churchName} checks `
    + 'their own account.'
  );
}

/** The button. The founder's own words for it. */
export const MEMBER_CLAIM_BUTTON = "I've paid";

/**
 * 🔴 WHAT THE BUTTON DOES, SAID TO THE MEMBER BEFORE THEY PRESS IT.
 *
 * ⚠️ THE WHOLE PREMISE OF THIS TICKET IS THAT THIS BUTTON CHANGES NO MONEY
 * STATE. A member who thinks pressing it has settled the matter will arrive at
 * the door believing they are paid and be told otherwise, which is the failure
 * this sentence exists to prevent. It is rendered beside the button, not behind
 * a tooltip.
 */
export const MEMBER_CLAIM_HELP =
  'This only tells the church to go and look. It settles nothing on its own '
  + 'and it does not change what you owe.';

export const MEMBER_CLAIMED_TITLE = 'Waiting for the church to check';

export function memberClaimedBody(churchName: string, reference: string): string {
  return (
    `${churchName} has been asked to look for ${reference} in their own account. `
    + 'Harvest has not checked anything and cannot. Until someone there marks it '
    + 'paid, your ticket still reads unpaid — bring it anyway, you will not be '
    + 'turned away at the door.'
  );
}

export function memberConfirmedBody(churchName: string, whenIso: string): string {
  const when = formatClaimTime(whenIso);
  return `${churchName} marked this ticket paid on ${when}. Harvest recorded their word for it.`;
}

/** Shown when the member's own "I've paid" press could not be saved. */
export const MEMBER_CLAIM_FAILED =
  'That could not be sent, so the church has not been told. Nothing changed — try again.';

/* ── 2b. The PUBLIC registrant ─────────────────────────────── */

/**
 * THE-355 — 🔴 THE NORMAL CASE FOR A CRUSADE HAS NO ACCOUNT AT ALL.
 *
 * THE FOUNDER, REGISTERING FOR HIS OWN EVENT: "i pressed on pay but it did not
 * brought me to the payment page but to the payment confirmation directly.
 * there is no confirm button in inbox, only in event page."
 *
 * Both halves of that sentence are the same defect seen from two ends. THE-351
 * built the claim flow and mounted it on `UserEvents` — the LOGGED-IN member
 * app — and its own ownership record names the hole it left: the attendee row
 * "is the only surface that reaches a member who registered LOGGED OUT and can
 * therefore never press 'I've paid' themselves". For a crusade, where most
 * attendees have no account and never will, that is not an edge: it is
 * everybody. No public registrant could claim, so no claim was ever created,
 * so the inbox was empty — correctly, about a thing that never happened.
 *
 * ⚠️ THE COPY BELOW IS THE SAME PROPOSITION AS THE MEMBER'S, SAID TO SOMEONE
 * WITH NO ACCOUNT. It is separate from {@link MEMBER_CLAIM_HELP} and friends
 * rather than reused verbatim because the two audiences differ in one fact that
 * changes the instruction: a signed-in member can come back to this ticket in
 * My Events, and a logged-out registrant cannot — so this copy has to tell them
 * to press now, and has to say what the email they were just sent is for.
 */

/** The heading over the church's own payment links on the public page. */
export const PUBLIC_PAY_TITLE = 'How to pay';

/**
 * 🔴 WHAT THE PUBLIC REGISTRANT IS TOLD BEFORE THE LINKS.
 *
 * Names the CHURCH as the party that collects and the party that decides, and
 * claims nothing about what Harvest has checked, because Harvest checks
 * nothing. The last sentence is the founder's own decision about the door and
 * is repeated here rather than assumed: this screen is the only thing a
 * logged-out registrant is guaranteed to read.
 */
export function publicPayBody(churchName: string, amountCents: number, reference: string): string {
  return (
    `This ticket costs ${formatCents(amountCents)}, and ${churchName} collects it directly `
    + `through their own payment links below. Put ${reference} in the payment note so they `
    + `can find it. Harvest does not handle this money and cannot see it — ${churchName} `
    + 'opens their own account and decides. Bring this ticket either way — you will not be '
    + 'turned away at the door.'
  );
}

/**
 * 🔴 STOP CONDITION 6 — A PRICED EVENT WHOSE CHURCH PUBLISHES NO LINK.
 *
 * ⚠️ AN EVENT WITH A PRICE AND NO WAY TO PAY IS THE ORIGINAL BUG IN A DIFFERENT
 * COSTUME, so the member is never shown an empty space where the links should
 * be. THE-351 made this state hard to reach from the admin side — the price
 * input is ABSENT while a church has no links saved — but it stays reachable
 * two ways that no form validation can close: a church that priced an event
 * first and DELETED its links afterwards, and a stored link that no longer
 * passes `readGivingLinks`'s allow-list on re-validation.
 *
 * 🔴 SO THE HONEST ANSWER IS THE ONLY ONE AVAILABLE: say that the church has not
 * published a way to pay yet, tell them to ask the church, and tell them the
 * one thing that is unambiguously true and useful — their place is booked and
 * the door is not in question. It does NOT invent a fallback, and it does not
 * imply the registration failed, because it did not.
 */
export const PUBLIC_NO_LINKS_TITLE = 'Ask the church how to pay';

export function publicNoLinksBody(churchName: string, amountCents: number, reference: string): string {
  return (
    `Your place is booked. This ticket costs ${formatCents(amountCents)}, but ${churchName} has `
    + 'not published a payment link yet, so there is nowhere for us to send you. Contact them '
    + `and quote ${reference}. Bring this ticket either way — you will not be turned away at `
    + 'the door.'
  );
}

/**
 * 🔴 THE PUBLIC CLAIM HELP, AND IT SAYS MORE THAN THE MEMBER'S DOES.
 *
 * ⚠️ {@link MEMBER_CLAIM_HELP} can be short because a signed-in member can open
 * My Events tomorrow and see what happened. A logged-out registrant cannot come
 * back to this screen — it is gone the moment they close the tab — so the
 * sentence has to carry the same warning AND tell them where the record lives.
 */
export const PUBLIC_CLAIM_HELP =
  'This only tells the church to go and look. It settles nothing on its own and it does '
  + 'not change what you owe. Keep the email with your ticket code.';

/** Shown in place of the button once a public registrant has pressed it. */
export const PUBLIC_CLAIMED_TITLE = 'The church has been asked to look';

export function publicClaimedBody(churchName: string, reference: string): string {
  return (
    `${churchName} has been asked to find ${reference} in their own account. Harvest has not `
    + 'checked anything and cannot. Until someone there marks it paid your ticket still reads '
    + 'unpaid — bring it anyway, you will not be turned away at the door.'
  );
}

/* ── 2c. The claim token a logged-out registrant carries ─────────────── */

/**
 * 🔴 HOW A REGISTRANT WITH NO ACCOUNT PROVES THE REGISTRATION IS THEIRS.
 *
 * ⚠️ THE REFERENCE CODE CANNOT DO THIS JOB, AND THE REASON IS ALREADY WRITTEN
 * DOWN IN THIS FILE. `isPaymentReference`'s note says the reference is
 * deliberately "a SECOND identifier that GRANTS NOTHING", and says why in the
 * same breath: IT IS WRITTEN INTO A PAYMENT NOTE, ON VENMO, WHOSE TRANSACTION
 * FEED IS PUBLIC BY DEFAULT. A reference that authorised a write would be a
 * credential the feature PUBLISHES — and at 31⁶ ≈ 887 million it is ~29.7 bits,
 * which is a guessing target rather than a secret. Either fact alone disqualifies
 * it; together they are STOP condition 3 exactly.
 *
 * 🔴 SO IT IS THE-324's SHAPE, WHICH SOLVED THIS FOR ROTA INVITATIONS: a stored
 * 256-bit token, no sign-in, authorising ONLY the fields it needs. 43 characters
 * of base64url, the same spelling `rota-invitations.ts` pins with `TOKEN_RE`.
 *
 * 🔴 AND THE TOKEN *SELECTS* THE REGISTRATION RATHER THAN ACCOMPANYING AN ID.
 * The public route takes NO `registrationId` at all: it looks the document up
 * BY this field. There is therefore no pair to mismatch and no check to forget
 * — a claim can only ever land on the one registration whose own token was
 * presented, which is stronger than validating a client-supplied id against it
 * and is why this is a query rather than a comparison.
 *
 * ⚠️ THE MINTER IS NOT HERE. This module is imported by client components, so
 * it may not pull in `node:crypto` — the same discipline `buildPaymentReference`
 * follows by taking its bytes as an argument. The route mints
 * `randomBytes(32).toString('base64url')`; this file owns the SHAPE, which is
 * what both ends have to agree on.
 */
export const PUBLIC_CLAIM_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** The field the token is stored under, named once so both ends spell it the same. */
export const PUBLIC_CLAIM_TOKEN_FIELD = 'paymentClaimToken';

/** 32 bytes, base64url — the length the minter must produce. */
export const PUBLIC_CLAIM_TOKEN_BYTES = 32;

export function isPublicClaimToken(value: unknown): value is string {
  return typeof value === 'string' && PUBLIC_CLAIM_TOKEN_RE.test(value);
}

/* ── 3. The tenant inbox ─────────────────────────────────────────────────── */

export const INBOX_TITLE = 'To confirm';

export const INBOX_TRIGGER_LABEL = 'Payments to confirm';

/**
 * 🔴 THE SENTENCE AT THE TOP OF THE SHEET. It is the founder's rule, stated to
 * the person about to press the button.
 */
export const INBOX_INTRO =
  'Everyone below says they have paid. Harvest has not checked any of it. Open '
  + 'your own account, find the payment by its reference, and only then confirm.';

export const INBOX_EMPTY_TITLE = 'Nothing to confirm';

export const INBOX_EMPTY_BODY =
  'When someone says they have paid for a ticket, they appear here with the '
  + 'reference to look for.';

export const INBOX_FAILED_TITLE = 'The list could not be loaded';

export const INBOX_FAILED_BODY =
  'This is not an empty inbox — it is a read that failed, so there may be '
  + 'people waiting. Try again.';

/** The one line under a row's name. Every field an admin needs to match. */
export function inboxRowSummary(item: InboxItem): string {
  const provider = item.providerLabel
    ? `says they paid by ${item.providerLabel}`
    : 'did not say which app they used';
  return `${formatCents(item.amountCents)} · ${item.reference} · ${provider} · ${formatClaimTime(item.claimedAt)}`;
}

export const CONFIRM_BUTTON = 'Confirm';

export const CONFIRM_BUTTON_HELP = 'Only after you have found it in your own account.';

/**
 * 🔴 WHAT AN ADMIN READS AFTER PRESSING. It names the church as the party that
 * vouched, in the same sentence as the word "recorded".
 */
export const CONFIRM_SUCCESS =
  'Recorded on your say-so. The gift is now in your accounting and on the '
  + "member's giving history.";

/**
 * 🔴 A FAILED CONFIRMATION, AND IT MUST BE UNMISTAKABLE THAT NOTHING WAS
 * WRITTEN. THE-321's `saveState` machine is the model: the row stays, the
 * ticket stays unpaid, and the message says both.
 */
export const CONFIRM_FAILED =
  'Nothing was recorded and the ticket is still unpaid. The person is still on '
  + 'this list — try again.';

/** Two admins, one row. The second press is told what the first one did. */
export const CONFIRM_ALREADY =
  'Someone else already confirmed this one. It was recorded once, not twice.';

/* ── 4. The door ─────────────────────────────────────────────────────────── */

/**
 * 🔴 WHAT THE VOLUNTEER ON THE DOOR SEES — AND THE FOUNDER'S DECISION IS THAT
 * IT CHANGES NOTHING ABOUT WHETHER THE PERSON COMES IN.
 *
 * ✅ LET THEM IN, FLAGGED. Check-in does not read payment state at all: the
 * Check In control is gated on `status === 'confirmed'`, which is registration
 * status and has nothing to do with money. Somebody who paid on Friday and was
 * not confirmed until Sunday arrives with an unpaid ticket and walks in.
 *
 * ⚠️ THE WORDING IS DELIBERATELY SHORT AND DELIBERATELY NEUTRAL. It has to be
 * enough for the volunteer to act on and not enough to embarrass the guest if
 * they read it over the volunteer's shoulder — so it names the RECORD's state
 * ("not confirmed"), never the person's ("hasn't paid"), and the instruction
 * sits in the tooltip rather than on the badge.
 */
export const DOOR_UNCONFIRMED_BADGE = 'Payment not confirmed';

export const DOOR_UNCONFIRMED_HELP =
  'Let them in. Nobody at the church has marked this one paid yet — sort it out '
  + 'afterwards, not at the door.';

export const DOOR_CONFIRMED_BADGE = 'Paid';

/* ── 4b. The word "confirmed", which means two things ────────────────── */

/**
 * THE-355 — 🔴 ONE ROW SAID "confirmed" AND "Payment not confirmed" AT ONCE.
 *
 * THE FOUNDER'S SCREENSHOT of his own event page: two attendees, each showing a
 * badge reading `confirmed` AND a warning reading "Payment not confirmed", each
 * with a working Confirm button beside both. Three appearances of one word
 * meaning two different things, on one line.
 *
 * ⚠️ THEY ARE GENUINELY TWO DIFFERENT FACTS AND BOTH WERE TRUE. The badge is
 * REGISTRATION status — `registrations/{id}.status`, the field that decides
 * whether Check In is offered, which has never meant money and which
 * `submit/route.ts` sets to `confirmed` the moment a seat is taken, exactly as
 * it does for a free one. The warning is PAYMENT state, which lives in the
 * separate `payment*` fields no door control reads. Neither was wrong. What was
 * wrong is that they were spelled with the same word, so an admin reading
 * "confirmed · Payment not confirmed" could not tell which of them the Confirm
 * button was about to change.
 *
 * 🔴 SO THE REGISTRATION SIDE GIVES UP THE WORD, AND THE PAYMENT SIDE KEEPS IT.
 * That direction is not arbitrary:
 *
 *   · "Confirm" is the founder's own word for the payment button, it is the
 *     correct verb for what the CHURCH does, and `FORBIDDEN_CLAIM_PHRASES`
 *     deliberately does not ban it. The whole feature is named in it.
 *   · The registration side has a plainer word available that says the same
 *     thing better — a person with a seat is REGISTERED — and it is the word
 *     the product already uses everywhere else for this state.
 *
 * So after this ticket exactly one thing on that row says "confirmed", and it
 * is the payment. The stat above the list is re-labelled in the same breath and
 * for the same reason: it counts `status === 'confirmed'`, i.e. REGISTRATION
 * status, and a header reading "2 Confirmed" over two unpaid seats is the same
 * collision one level up.
 *
 * ⚠️ THE STORED VALUES DO NOT MOVE. This is a display map and nothing else:
 * `status` still stores `confirmed`, every query still filters on it, and
 * check-in still gates on it. Renaming a stored enum to fix a label would be a
 * migration on a live collection to solve a wording problem.
 */
export const REGISTRATION_STATUS_LABEL: Readonly<Record<string, string>> = Object.freeze({
  confirmed: 'Registered',
  attended: 'Attended',
  waitlisted: 'Waitlisted',
  cancelled: 'Cancelled',
});

/**
 * The label for one stored registration status. Falls back to the stored value
 * so a status this map has not met yet renders as itself rather than blank —
 * an unknown state must still be visible to the admin looking at it.
 */
export function registrationStatusLabel(status: unknown): string {
  if (typeof status !== 'string' || !status) return '';
  return REGISTRATION_STATUS_LABEL[status] ?? status;
}

/**
 * 🔴 WHAT THE STAT ABOVE THE ATTENDEE LIST COUNTS, SAID IN ITS OWN LABEL.
 *
 * It counts registrations whose REGISTRATION status is `confirmed` — people who
 * hold a seat. It has never counted payments and does not now; a paid event
 * with two unpaid seats reads 2 here, which is correct and was unreadable while
 * the word was "Confirmed".
 */
export const REGISTERED_STAT_LABEL = 'Registered';

/* ── 5. The notification to the church's admins ──────────────────────────── */

/**
 * 🔴 WHO IS NOTIFIED: THE CHURCH'S OWN ADMINS. NOT HARVEST'S.
 *
 * The founder said "the admin owner of the platform", and read literally that
 * is Harvest — but this is a PER-TENANT event about one church's money, and
 * sending Harvest a member's name, email and payment amount every time somebody
 * presses a button is a data-exposure question rather than a preference. The
 * recipients are `tenant_private/{tenantId}.adminEmails` plus the tenant owner:
 * the same roster `requireTenantPermission` already trusts to READ this data.
 *
 * ⚠️ `api/enterprise-lead/route.ts` hard-codes Harvest's own addresses. That is
 * the right recipient for a sales lead and the wrong one for this, and it is
 * named here so nobody reaches for it as a precedent.
 */
export function claimEmailSubject(eventTitle: string): string {
  return `Someone says they've paid for ${eventTitle}`;
}

/**
 * 🔴 THE BODY, AND IT SAYS "SAYS" THREE TIMES BECAUSE THAT IS WHAT HAPPENED.
 *
 * ⚠️ A notification is a PROMPT, NEVER THE RECORD. The inbox item exists
 * whether or not this ever sends; see the claim route. So this may be terse and
 * may fail, and nothing is lost but promptness.
 */
export function claimEmailBody(args: {
  memberName: string;
  eventTitle: string;
  amountCents: number;
  reference: string;
  providerLabel: string | null;
  inboxUrl: string;
}): string {
  const where = args.providerLabel
    ? `They say they used ${args.providerLabel}.`
    : 'They did not say which app they used.';
  return [
    `${args.memberName} says they have paid ${formatCents(args.amountCents)} for ${args.eventTitle}.`,
    '',
    `${where} Their reference is ${args.reference}.`,
    '',
    'Harvest has not checked this and cannot check it. Open your own account, '
    + `look for a payment carrying ${args.reference}, and confirm it in Harvest `
    + 'only if you find it there.',
    '',
    args.inboxUrl,
  ].join('\n');
}

/** The push title. Short — it lands on a lock screen. */
export const CLAIM_PUSH_TITLE = 'Someone says they have paid';

export function claimPushBody(memberName: string, eventTitle: string, amountCents: number): string {
  return `${memberName} · ${formatCents(amountCents)} · ${eventTitle}. Check your account, then confirm.`;
}

/* ══ Time ══════════════════════════════════════════════════════════════════ */

/**
 * When a claim was pressed, for a human reading a row.
 *
 * ⚠️ DATE AND TIME, ALWAYS. "2 hours ago" is friendlier and useless here: the
 * admin is comparing this against a dated line in a bank statement, and a
 * relative time cannot be compared to a date at all.
 */
export function formatClaimTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'an unknown time';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(d);
}
