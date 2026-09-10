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
 * THE-351 — THE SECOND PROPOSITION, AND IT IS A DIFFERENT ONE.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY THE-345'S SWITCH IS NOT SIMPLY FLIPPED, AND IS NOT DELETED EITHER
 *
 * THE-345 above states its own proposition exactly: "can a church be paid for a
 * ticket AT ALL". Read that way the answer is now yes — a church can be paid,
 * through its own PayPal, and an admin confirms each payment by hand. So the
 * naive change is `PAID_EVENTS_ENABLED = true`.
 *
 * THAT WOULD BREAK REGISTRATION FOR EVERY PAID TICKET, IMMEDIATELY. The one
 * value gates a SECOND thing the paragraph above does not name: with a non-zero
 * amount, `/api/event-registration/submit` computes `requiresPayment` and goes
 * to STRIPE CHECKOUT, which fails with "This ministry hasn't set up payments
 * yet" because the platform Connect account is closed. Flipping the flag would
 * put a price back on the form and bounce every member off a 400 — the exact
 * state THE-345 was written to remove, one layer further along.
 *
 * So there are two propositions tangled in one name, and THE-345's own argument
 * for not reusing `STRIPE_CONNECT_ENABLED` — "Two propositions, two lines" — is
 * the argument for splitting them here:
 *
 *   `PAID_EVENTS_ENABLED`            HARVEST CAN PROCESS A PAYMENT.
 *                                    Still false. Nothing about that changed:
 *                                    no rail exists, and this is the flag that
 *                                    must gate any charging path.
 *
 *   `MANUAL_EVENT_PAYMENTS_ENABLED`  A CHURCH MAY PRICE A TICKET AND COLLECT IT
 *                                    OUTSIDE HARVEST, confirming each payment
 *                                    itself. True — that is THE-351.
 *
 * NEITHER IMPLIES THE OTHER, WHICH IS THE TEST OF A HONEST SPLIT. The day a
 * rail lands, the first goes true and the second may stay true (a church that
 * prefers its own Revolut) or go false (every church on the rail). Neither
 * value has to move because the other did.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT THIS DOES *NOT* UN-GATE, AND WHY THAT IS NOT AN OVERSIGHT
 *
 * `events/{id}.price` — the "Ticket Price ($)" field on the event itself —
 * STAYS GATED ON `PAID_EVENTS_ENABLED`, i.e. stays hidden. THE-345 established
 * the finding this rests on: that field IS NEVER CHARGED BY ANYTHING. It is not
 * read by `/api/event-registration/submit`, which totals `ticketTypes[].price`
 * alone, and it is not read by `PublicEventRegistration`, which does the same.
 * It is quoted on four screens and collected on none.
 *
 * Manual confirmation does not change that by one line. A church that typed 50
 * into it would still see "$50" on the public calendar, still take a
 * registration for `amount: 0`, and still have nothing to confirm — a price with
 * no ticket behind it is exactly as false when the church collects the money as
 * when Stripe does. So `eventPriceLabel` and the event-level input are
 * UNTOUCHED by this ticket, and THE-345's assertions about them still pass
 * unedited.
 *
 * `ticketTypes[].price` IS UN-GATED, because that is the price that actually
 * charges: it is what the submit route totals into `registrations/{id}.amount`,
 * which is what the member is asked to pay, what the inbox row shows, and what
 * THE-350's writer turns into an invoice. It is real money, so it may be typed.
 */
export const MANUAL_EVENT_PAYMENTS_ENABLED = true;

/**
 * May a TICKET TYPE carry a price on this deployment?
 *
 * ONE FUNCTION, for the same reason `eventPriceLabel` is one: the ticket-type
 * price is gated in THREE places in `AdminEvents` — the input, the quote on a
 * stored row, and the clamp in `saveTicketDraft` — and gating two of them is how
 * a church builds a priced ticket it is then told it cannot have.
 */
export function ticketPricingAvailable(): boolean {
  return PAID_EVENTS_ENABLED || MANUAL_EVENT_PAYMENTS_ENABLED;
}

/**
 * IS THIS DEPLOYMENT ON MANUAL CONFIRMATION — i.e. must the registration
 * route SKIP the payment rail and record the seat unpaid instead?
 *
 * NOT THE SAME QUESTION AS {@link ticketPricingAvailable}, and reading it as
 * such is how a priced ticket ends up at a closed Stripe account. Pricing asks
 * "may a number be typed"; this asks "who collects it". While
 * `PAID_EVENTS_ENABLED` is false, a priced ticket is registered IMMEDIATELY and
 * marked unpaid — never sent to Checkout, never left pending, never refused.
 */
export function manualConfirmationMode(): boolean {
  return !PAID_EVENTS_ENABLED && MANUAL_EVENT_PAYMENTS_ENABLED;
}

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
 * THE-351 — what the `Amount` column says about a payment nobody has confirmed.
 *
 * NOT `$0.00`, for the reason above, and NOT the price either — the price is
 * what was ASKED, and this column is read as what was RECEIVED. A church
 * reconciling against a bank statement needs the row to say "there is no
 * confirmed money here" in a word it cannot mistake for a figure.
 */
export const NOT_CONFIRMED_LABEL = 'Not confirmed';

/**
 * The `Amount` cell for one exported registration row.
 *
 * `amount` is the stored `registrations/{id}.amount`. Zero is a fact the
 * platform can vouch for in every configuration — nobody was charged — so it
 * exports as `$0` whether or not a rail exists. A non-zero amount can only be
 * vouched for while a rail exists.
 *
 * ─── THE-351 — the third case, and it is the common one now ────────────────
 *
 * UNDER MANUAL CONFIRMATION THE COLUMN MEANS SOMETHING TRUE AGAIN, AND WHAT
 * IT MEANS DEPENDS ON THE ROW RATHER THAN ON THE DEPLOYMENT. Money for these
 * tickets is real and does arrive — into the church's own PayPal, unobserved by
 * Harvest — so `NOT_COLLECTED_LABEL` ("Not collected") would now be false: it
 * was collected, by the church, off-platform.
 *
 * What Harvest can stand behind is exactly one fact per row: did somebody at
 * this church open their own account and vouch for this payment?
 *
 *   · CONFIRMED  → the dollar figure. An admin found it and said so, and there
 *     is a `tenants/{t}/invoices` document behind it — the same ledger a
 *     processed gift lands in. The treasurer can tie this cell to a receipt.
 *
 *     AND IT IS FORMATTED FROM CENTS, WHICH THE OTHER TWO BRANCHES ARE NOT.
 *     `registrations/{id}.amount` is CENTS (it is `ticketTypes[].price × qty`,
 *     and that field is cents), while `$${amount}` renders it as though it were
 *     dollars — so a $50 ticket exports as `$5000`. That mismatch is
 *     PRE-EXISTING and THE-345 reported it rather than changing it, because
 *     while the gate is on the branch is unreachable for any non-zero amount.
 *     It is NOT acceptable on a cell this ticket is putting a real, confirmed,
 *     invoice-backed figure into, so this branch — and only this branch —
 *     divides. The other two are left exactly as THE-345 wrote them, so
 *     nothing that was true before this ticket changes shape.
 *
 *     The division is spelled out rather than imported: this file imports
 *     nothing, by the discipline in the header, and reaching for
 *     `event-payment-claims.ts` would put the provider table in every bundle
 *     that reads the gate.
 *   · NOT CONFIRMED → `NOT_CONFIRMED_LABEL`, whether the member has pressed
 *     "I've paid" or not. A CLAIM IS NOT A CONFIRMATION and must not export
 *     as one: "I've paid" is the member's word, and this sheet is reconciled
 *     against a bank statement. A member's assertion in a money column is
 *     precisely the quiet lie this whole ticket exists to remove.
 *   · Rail off AND manual off → `NOT_COLLECTED_LABEL`, exactly as THE-345 left
 *     it. Nothing about that configuration changed.
 *
 * `state` is optional so the two THE-345 callers and its tests read unchanged;
 * a caller that omits it gets THE-345's behaviour verbatim.
 */
export function csvAmountCell(amount: number, state?: 'confirmed' | 'unconfirmed'): string {
  if (amount > 0 && MANUAL_EVENT_PAYMENTS_ENABLED && state !== undefined) {
    if (state !== 'confirmed') return NOT_CONFIRMED_LABEL;
    return `$${(Math.round(amount) / 100).toFixed(2)}`;
  }
  if (!PAID_EVENTS_ENABLED && amount > 0) return NOT_COLLECTED_LABEL;
  return `$${amount}`;
}
