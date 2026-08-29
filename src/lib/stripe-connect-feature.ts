/**
 * THE-256 — the master switch for Stripe Connect, across the whole app.
 *
 * ─── The switch ──────────────────────────────────────────────────────────────
 *
 * ONE VALUE. Set `STRIPE_CONNECT_ENABLED` to `true` and every surface below
 * comes back exactly as it was. Nothing is deleted to hide it: no route file, no
 * component, no branch, no Firestore field and no plan-matrix cell.
 * `tenants/{id}.stripeConnectStatus` and `tenant_private/{id}
 * .stripeConnectAccountId` keep their values, `PLATFORM_FEE_MAP` keeps its rate
 * table, and `fundraising` keeps its column — the gate sits IN FRONT of all of
 * them, so a church that is already connected is still connected and gets its
 * panel back whole.
 *
 * ⚠️ WHY IT IS ITS OWN FILE, and why it imports nothing. This is the same idiom
 * as `lib/sms-feature.ts` (THE-245), for the same two reasons. The three older
 * master switches live in `utils/plan-features.ts`, which drags the entire
 * pricing matrix into any module that imports it; and this flag is read from
 * BOTH a route handler and the client bundle — `components/settings/
 * PaymentSection.tsx` ships it to the browser. THIS FILE IMPORTS NOTHING and
 * must not start to, so the gate stays cheap on the server and free in the
 * bundle.
 *
 * ─── Why it is off ───────────────────────────────────────────────────────────
 *
 * 🔴 THE PLATFORM ACCOUNT IS CLOSED. Stripe closed `acct_1U4MOhFzBnH2P7JZ` as
 * `rejected.fraud` on 2026-08-27. The appeal is pending and Stripe quotes 2-10
 * days. NO CHURCH IS CONNECTED AND NO MONEY IS EXPOSED — what was lost is
 * access, not funds.
 *
 * What was NOT lost is the button. `/api/stripe/connect` called
 * `stripe.accounts.create()` against that dead account with no gate at all, so
 * an admin who pressed "Connect Stripe Account" got a raw Stripe API error
 * surfaced through an `alert()`. The app is about to be shown to 8,000
 * evangelists, and a half-working money surface in that demo is worse than an
 * absent one.
 *
 * ⚠️ THE GATE IS SERVER-SIDE FIRST and the UI follows it, exactly as THE-245
 * argued. `/api/stripe/donate` is deliberately unauthenticated so an anonymous
 * donor can give, and `/api/stripe/connect/callback` is a GET a browser lands on
 * coming back from Stripe — neither has a nav entry, a permission or a plan in
 * front of it, so hiding a button would not have been a gate.
 *
 * ─── 🔴 The churches' OWN payment links are not part of this ─────────────────
 *
 * Churches take gifts through their own PayPal / Venmo / Cash App / Zelle / Wise
 * / Revolut links today (THE-246, THE-249, THE-254), and that path never touches
 * Stripe: Harvest is not in the flow, takes no fee and posts to no endpoint. It
 * is a live, independent surface and this switch does not reach it —
 * `components/donations/GivingLinks.tsx` and `donations/giving-providers.ts` are
 * untouched, and the links editor sits on the SAME screen as the hidden Stripe
 * panel and keeps working. That is the whole reason hiding Stripe is survivable.
 *
 * ─── What it turns off ───────────────────────────────────────────────────────
 *
 * Server (each refuses with 503 while off; none of them deletes anything):
 *   · `/api/stripe/connect` — the onboarding call that reaches the dead
 *     platform account. The one this ticket exists for.
 *   · `/api/stripe/connect/callback` — the browser's return hop from Stripe
 *     onboarding. No account can be created while the switch is off, so nothing
 *     can legitimately arrive here; it refuses rather than writing a status.
 *   · `/api/stripe/connect/login-link` — "Manage Stripe Dashboard".
 *   · `/api/stripe/donate` — the donate Checkout Session, for one-time and
 *     monthly alike.
 *
 * Client:
 *   · `components/settings/PaymentSection.tsx` — the ONE component that owns
 *     "are we connected". Its four status branches (active / pending /
 *     restricted / not connected) are all still there, behind the switch, and
 *     it shows `STRIPE_CONNECT_HIDDEN_MESSAGE` instead.
 *
 * ⚠️ TWO SCREENS MOUNT THAT COMPONENT — `AdminDonations` and `AdminFundraising`
 * — so gating it once gates both. `AdminSettings` mounts it nowhere: THE-246
 * turned that row into a POINTER at Donations, and the row keeps working
 * because the links editor it also points at is untouched.
 *
 * ─── 🔴 What it deliberately does NOT turn off ───────────────────────────────
 *
 *   · `/api/stripe/connect/webhook` — NOT GATED. It confirms donations and paid
 *     event tickets, so it must stay live for anything already in flight, and
 *     it is harmless idle: with no new sessions being created, no new events
 *     arrive.
 *   · `/api/event-registration/submit` — NOT TOUCHED. `requiresPayment = amount
 *     > 0 && !waitlisted`, so free registration, waitlisting and a ticket
 *     discounted to $0 already bypass Stripe entirely and keep working. A PAID
 *     ticket already fails cleanly on the existing `connectAccountId` check —
 *     the same refusal every church without Stripe already gets — so it needs
 *     no gate of its own, and adding one would be a second refusal for the same
 *     state.
 *   · The platform's OWN billing — `/api/stripe/checkout`, `/portal`,
 *     `/api/stripe/webhook` and the Dodo paths. Those are how Harvest is paid,
 *     not how a church is; they are a different Stripe surface and out of scope.
 *
 * ─── 🔴 No data is touched ───────────────────────────────────────────────────
 *
 * NO COLLECTION IS READ, WRITTEN OR MIGRATED BY THIS SWITCH. Every gated route
 * refuses BEFORE it authenticates and before it opens Firestore, so
 * `tenants/{id}.stripeConnectStatus`, `tenant_private/{id}
 * .stripeConnectAccountId`, the `users/{uid}.affiliateStripeAccountId` mirror,
 * `donations`, `invoices` and `campaigns` are all left exactly as they are.
 * Nothing migrates, nothing is cleared, and no church's connection is forgotten.
 * A church that is already connected finds its account, its status and its
 * history where it left them when the switch goes back on.
 */
export const STRIPE_CONNECT_ENABLED = false;

/**
 * What every gated route and the payment panel answer with while the switch is
 * off. The founder's wording, verbatim: no explanation, and no pointer to the
 * manual payment links — a church reading this is looking at the Stripe panel,
 * and the links editor is already on the same screen.
 *
 * 503 rather than 404: the route EXISTS and is coming back, which is what a
 * stale admin tab should be told. (The appeal is pending; this is days, not a
 * removal.)
 *
 * Exported as a named const so a route and a component cannot word it
 * differently — the same reason `SMS_HIDDEN_MESSAGE` is one.
 */
export const STRIPE_CONNECT_HIDDEN_MESSAGE = 'Temporarily unavailable';
