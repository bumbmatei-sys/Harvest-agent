/**
 * THE-345 — the master switch for PAID EVENT TICKETING, across the whole app.
 *
 * ─── The switch ──────────────────────────────────────────────────────────────
 *
 * ONE VALUE. Set `PAID_EVENTS_ENABLED` to `true` and every surface below comes
 * back exactly as it was. Nothing is deleted to hide it: no input, no field, no
 * route, no Firestore key and no stored price. `events/{id}.price`,
 * `ticketTypes[].price`, `discountCodes[]` and `registrations/{id}.amount` all
 * keep their values — the gate sits IN FRONT of all of them, so a church that
 * priced a conference still has that price on the document and gets its ticket
 * pricing back whole the day a rail exists.
 *
 * WHY IT IS ITS OWN FILE, and why it imports nothing. Same idiom as
 * `lib/sms-feature.ts` (THE-245) and `lib/stripe-connect-feature.ts` (THE-256),
 * for the same two reasons: the three older master switches live in
 * `utils/plan-features.ts`, which drags the entire pricing matrix into any
 * module that imports it; and this flag is read from FOUR client components
 * (AdminEvents, PublicCalendar, NewsTab and, through them, the public calendar
 * page). THIS FILE IMPORTS NOTHING and must not start to, so the gate stays
 * free in the bundle.
 *
 * WHY IT IS NOT `STRIPE_CONNECT_ENABLED`. It would be true today — Stripe is
 * the only rail this codebase has ever had — and wrong tomorrow. The proposition
 * here is "can a church be paid for a ticket AT ALL", not "is Stripe Connect
 * available". A replacement rail is being sought (Mangopay, Lemonway; card
 * `86bbnjmw9`), and when one lands, paid ticketing must be able to return
 * WITHOUT Stripe Connect — which is a different, possibly still-dead surface
 * whose platform account is closed as `rejected.fraud`. Gating one proposition
 * on the other's flag would mean paid events could only ever come back through
 * the rail that failed. Two propositions, two lines.
 *
 * ─── Why it is off ────────────────────────────────────────────────────────
 *
 * THE FOUNDER, LOOKING AT A LIVE PUBLISHED EVENT READING "$50 · Registration
 * open": "I should not be able to create paid events with stripe disabled. How
 * are we gonna know if someone paid or not."
 *
 * He is right, and the surface was worse than he knew. `events/{id}.price` — the
 * "Ticket Price ($)" field on the event itself — IS NEVER CHARGED BY ANYTHING.
 * It is not read by `/api/event-registration/submit`, which computes its total
 * from `ticketTypes[].price` alone, and it is not read by
 * `PublicEventRegistration`, which does the same. It is quoted on FOUR screens
 * and collected on none:
 *
 *   · `AdminEvents` list card (phone and desktop) — the founder's screenshot.
 *   · `PublicCalendar` — a member browsing the church's public calendar.
 *   · `NewsTab` — the event card in the member feed, twice.
 *
 * So a church could type 50, publish, and every one of those screens told a
 * member the conference cost $50 while the registration flow charged nothing and
 * confirmed them for free. That is not a payment that failed; it is a price that
 * was never wired to a payment at all.
 *
 * THE TICKET-TYPE PRICE IS A DIFFERENT FAILURE, and it is the one that does
 * reach money. `ticketTypes[].price` IS the charge. With no Connect account
 * `/api/event-registration/submit` refuses it with a 400 ("This ministry hasn't
 * set up payments yet"), so no `registrations` row is written and no phantom
 * `Amount` is recorded — the refusal is clean and THE-256 documents it as
 * deliberate. What it is NOT is honest to the church: the admin could still
 * build a $50 ticket type, publish it, and watch every member bounce off a
 * message telling them to phone the church. Both prices are gated here.
 *
 * ─── What it turns off ───────────────────────────────────────────────────────
 *
 * Client (nothing is deleted; every branch is still in the tree):
 *   · `AdminEvents` — the "Ticket Price ($)" input on the event form and the
 *     "Price ($) — 0 = Free" input on a ticket type. Both are ABSENT rather than
 *     disabled-and-warning: a church that types 50 into a field that warns still
 *     expects money, which is the same lie one click further on.
 *   · `AdminEvents` — `handleSave` will not write a price a church could not
 *     have entered, and `saveTicketDraft` builds every new ticket type at 0.
 *   · `AdminEvents`, `PublicCalendar`, `NewsTab` — no price is QUOTED. A stored
 *     price is not shown as "$50" (the lie) and not shown as "Free" (a different
 *     lie — the church did not decide it was free). It is simply not quoted,
 *     because the platform will not take the money.
 *   · `AdminEvents` — the CSV `Amount` column reports NOT_COLLECTED_LABEL for a
 *     non-zero stored amount rather than a dollar figure.
 *
 * ─── What it deliberately does NOT turn off ───────────────────────────────
 *
 * REGISTRATION, ENTIRELY. This switch does not go near it and must not. A church
 * running a free conference is unaffected in every particular: the public event
 * page, the QR code, check-in, the waitlist, discount codes, capacity, the CSV
 * export and the registration URL shape all work exactly as they did.
 *
 *   · `/api/event-registration/submit` — NOT TOUCHED, for the reason THE-256
 *     already recorded: `requiresPayment = amount > 0 && !waitlisted`, so free
 *     registration, waitlisting and a ticket discounted to $0 bypass payment
 *     entirely, and a paid ticket already fails cleanly on the existing
 *     `connectAccountId` check. Adding a gate there would be a second refusal
 *     for the same state.
 *   · `ticketTypes[].capacity` and the waitlist — independent of price, and kept
 *     whole. A capped free ticket type still waitlists.
 *   · Discount codes — a discount off nothing is harmless, and deleting the
 *     editor would break the flip-back promise.
 *   · The registration URL `https://{tenantId}.theharvest.app/event/{eventId}` —
 *     public, and possibly printed on something. Byte-identical.
 *
 * ─── No data is touched ───────────────────────────────────────────────────
 *
 * NO COLLECTION IS READ, WRITTEN OR MIGRATED BY THIS SWITCH. The founder's
 * tenant has a published event storing `price: 50` and it still stores 50 after
 * this ticket. Suppressing a QUOTE is not rewriting a FIGURE: a migration that
 * zeroed stored prices would be irreversible and is the founder's call, not this
 * ticket's. `handleSave` on an existing event re-writes the price it read, so an
 * edit for an unrelated reason cannot silently zero it either.
 */
export const PAID_EVENTS_ENABLED = false;

/**
 * What the event form says while the switch is off.
 *
 * THE WORDING IS LOAD-BEARING and it is the half of this ticket that is not
 * mechanism. A church opening the event form to charge for a conference must
 * learn TWO things in one breath: that it cannot collect money here, and that
 * registration itself is completely unaffected. A notice that says only the
 * first reads as "events are broken" and a church stops using the feature that
 * still works.
 *
 * "Collect at the door" is named explicitly because it is what a church actually
 * does today, and because it turns a refusal into an instruction.
 *
 * Exported as a named const so the form and the list cannot word it differently
 * — the same reason `SMS_HIDDEN_MESSAGE` and `STRIPE_CONNECT_HIDDEN_MESSAGE`
 * are each one.
 */
export const PAID_EVENTS_HIDDEN_TITLE = 'Ticket pricing is unavailable';

export const PAID_EVENTS_HIDDEN_MESSAGE =
  'Harvest cannot collect event payments at the moment, so events are free to '
  + 'register for. Everything else works as normal — publish the event, take '
  + 'registrations, scan tickets at the door and export your attendee list — and '
  + "collect any fee at the door or through your church's own giving links. "
  + 'Pricing returns here as soon as payments are back.';

/**
 * What the CSV `Amount` column reports for a stored amount the platform did not
 * collect.
 *
 * NOT `$0.00`. A church reading `$0.00` next to a name concludes the person
 * registered for a free event; a church reading a dollar figure concludes money
 * arrived. Neither is true of a row carrying a non-zero amount that no rail was
 * ever able to charge, and the export is the document a treasurer reconciles
 * against a bank statement. A genuinely free registration stores `amount: 0` and
 * still exports `$0` — that row IS true and is left alone.
 */
export const NOT_COLLECTED_LABEL = 'Not collected';

/**
 * The price a surface may QUOTE for an event, or `null` for "quote nothing".
 *
 * ONE FUNCTION FOR ALL FOUR SURFACES. The bug being fixed is that the same
 * stored number was rendered by four independent ternaries, so gating three of
 * them and missing one would leave the lie in the fourth — which is exactly the
 * shape of the `smsAvailable` surface THE-335 found this switch's sibling had
 * missed. A caller renders the string it gets back and renders NOTHING when it
 * gets `null`; it does not decide.
 *
 * `dollars` is the stored `events/{id}.price`, which is whole dollars — unlike
 * `ticketTypes[].price`, which is cents. That mismatch is pre-existing and is
 * reported rather than changed: normalising it would rewrite stored data.
 */
export function eventPriceLabel(dollars: number): string | null {
  if (!PAID_EVENTS_ENABLED) return null;
  return dollars > 0 ? `$${dollars}` : 'Free';
}

/**
 * The `Amount` cell for one exported registration row.
 *
 * `amount` is the stored `registrations/{id}.amount`. Zero is a fact the
 * platform can vouch for in every configuration — nobody was charged — so it
 * exports as `$0` whether or not a rail exists. A non-zero amount can only be
 * vouched for while a rail exists.
 */
export function csvAmountCell(amount: number): string {
  if (!PAID_EVENTS_ENABLED && amount > 0) return NOT_COLLECTED_LABEL;
  return `$${amount}`;
}
