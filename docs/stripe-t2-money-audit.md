# Pre-Launch Stripe Money Audit — T2 Go-Live

> Read-and-report audit of every money path before flipping Stripe to live mode.
> No code was changed as part of this audit. Every finding cites a real `file:line`
> and a concrete live-mode consequence.

**The one question, asked of every money path:** when `STRIPE_SECRET_KEY` flips
`sk_test_… → sk_live_…`, what silently breaks or does the wrong thing?

**Stripe's documented behavior (the physics behind every finding below):** test and
live are *separate object databases*. The key on the request decides the mode — there
is no in-code mode switch. A **live key + a test-mode object id** (price `price_…`,
account `acct_…`, customer `cus_…`, subscription `sub_…`) returns `resource_missing` /
`"No such price: '…'"` (HTTP 400) **at the moment of the API call** — never at deploy.
Live webhook endpoints get their own new signing secrets; test events are never
delivered to live endpoints or vice-versa.

Sources:
- <https://blog.yunuserturk.com/stripe-live-mode-not-working-7-root-causes-and-fixes/>
- <https://www.sendowl.com/blog/tips-and-advice/stripe-test-mode-going-live>

---

## 1. BLOCKERS — will break real payments on day one

### B1 — The 9 hardcoded price-ID `??` fallbacks silently feed test prices to a live key
`src/lib/stripe-config.ts:10-31`. If any `STRIPE_PRICE_*` env var is unset in prod,
`??` supplies a `price_1TjKT…` **test** id. The consumer does not crash —
`PLAN_PRICES[plan]?.[billing]` returns a truthy test string that *passes* the
`if (!priceId)` guard (`src/app/api/stripe/checkout/route.ts:99-102`), then
`stripe.checkout.sessions.create({ line_items:[{ price: priceId }] })` throws
`No such price` under the live key → route returns **500 at the point of sale**
(`src/app/api/stripe/checkout/route.ts:226-229`). No deploy error; it surfaces the
first time a customer clicks "subscribe."

- **Affected combos:** `plus / pro / max / ultra` × `monthly / yearly` = **8 plan
  prices** (`STRIPE_PRICE_PLUS_MONTHLY … STRIPE_PRICE_ULTRA_YEARLY`), each failing its
  own checkout.
- **AI monthly** (`STRIPE_PRICE_AI_MONTHLY`, `AI_ASSISTANT_MONTHLY`): same flaw, hits
  the AI add-on (`src/app/api/stripe/checkout/route.ts:83`) **and** the standalone AI
  checkout (`src/app/api/stripe/standalone-checkout/route.ts:52`).
- **`STRIPE_PRICE_AI_SETUP`** shares the `??` flaw structurally
  (`src/lib/stripe-config.ts:31`) but **`AI_ASSISTANT_SETUP` is never consumed in
  production** (only in a test-plan doc) — currently zero live impact, but it should be
  deleted or it will mislead the next person.
- **Remedy (not implemented — founder's call):** fail loud at startup. Replace
  `?? 'price_…'` with a required-env read that throws on boot if any `STRIPE_PRICE_*`
  is missing, so a misconfigured deploy dies immediately instead of at a customer's
  card. Per-request validation is weaker (still lets the app boot "healthy").

### B2 — `STRIPE_WEBHOOK_SECRET` must be the *live endpoint's new* secret, or every paid event silently no-ops
`src/app/api/stripe/webhook/route.ts:685,703`. If this is still the test secret (or
missing), `stripe.webhooks.constructEvent` throws for every live event →
`400 Invalid signature` → Stripe retries, then gives up. **The card is charged, but no
tenant is created, no plan upgraded, no receipt written, no commission paid, no ticket
confirmed.** Missing entirely → hard `500`
(`src/app/api/stripe/webhook/route.ts:687-690`). Highest-blast-radius silent failure
alongside B1.

### B3 — `STRIPE_CONNECT_WEBHOOK_SECRET` is a *second, different* secret for a *second* endpoint
`src/app/api/stripe/connect/webhook/route.ts:22,42`. Same failure mode as B2, scoped to
`account.updated`: Connect onboarding status never syncs and pending affiliate
commissions are never swept. Wrong secret (e.g. accidentally pasting the main
webhook's) fails signature verification on every event.

### B4 — Every existing Connect account in Firestore is a TEST account; live donations & paid tickets fail against it
Connect accounts do **not** cross modes. Money paths that use a stored
`stripeConnectAccountId` as a destination charge:

- Donations: `src/app/api/stripe/donate/route.ts:58,94` (`transfer_data.destination`)
  and its subscription branch `:145`.
- Paid event tickets: `src/app/api/event-registration/submit/route.ts:183` reads the
  tenant's connect account for the destination charge.
- Re-onboarding: `src/app/api/stripe/connect/route.ts:81-86` calls
  `accountLinks.create({ account: <stored test acct_> })`.

Under a live key each of these throws `No such account` / `resource_missing` →
**500 → the donor/attendee cannot pay and the church cannot re-open onboarding.** Every
connected account must be purged and re-onboarded in live mode (see §3, §4).

### B5 — Two webhooks must be recreated in live with *exactly* these event lists
A missed event = payment succeeds, backend never learns.

| Endpoint | Secret | Register EXACTLY these events |
|---|---|---|
| `/api/stripe/webhook` | `STRIPE_WEBHOOK_SECRET` | `checkout.session.completed`, `checkout.session.expired`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.payment_succeeded`, `charge.refunded`, `charge.dispute.created`, `transfer.failed`, `payment_intent.succeeded` |
| `/api/stripe/connect/webhook` | `STRIPE_CONNECT_WEBHOOK_SECRET` | `account.updated` |

What silently breaks if an event is missing (payment still succeeds):

- **`checkout.session.completed`** → no new-ministry tenant, no plan upgrade, no
  partnership pointer, no standalone-AI activation, no initial affiliate commission, no
  ticket confirmation (catastrophic — `src/app/api/stripe/webhook/route.ts:726`).
- **`payment_intent.succeeded`** → one-time donations: money reaches the church but no
  receipt/invoice, no CRM link, no campaign credit (`:1456`).
- **`invoice.payment_succeeded`** → suspended tenants not reactivated, **recurring
  affiliate commissions never paid**, campaign renewals not credited (`:1282`).
- **`customer.subscription.deleted`** → cancellations don't downgrade; cancelled
  customers keep paid features (`:1106`).
- **`customer.subscription.updated`** → portal plan changes not reflected (`:1043`).
- **`invoice.payment_failed`** → non-paying tenants not suspended (`:1261`).
- **`transfer.failed`** → failed affiliate payouts not reconciled (`:1432`).
- **`account.updated`** → Connect status stuck `pending`, activation-time commission
  sweep never runs (`src/app/api/stripe/connect/webhook/route.ts:65`).

---

## 2. SILENT RISKS — wrong-but-successful, no error surfaced

### S1 — `getPlanFromPriceId` silently returns `null` in live mode
`src/app/api/stripe/webhook/route.ts:1072` maps a live subscription's `price.id` back to
a plan by comparing against `PLAN_PRICES` — which hold the **test** fallback ids unless
the env vars are set to live. Mitigated because `subscription.metadata.plan` is read
first (`:1070`) and is set on all our own checkouts, but the price-id fallback path is
dead in live. Setting the `STRIPE_PRICE_*` env vars to live ids (B1) fixes this too.

### S2 — `tenant.stripePriceId` gets written a test-price string
`getMonthlyPriceId/getYearlyPriceId` (`src/app/api/stripe/webhook/route.ts:1529-1533`,
used at `:874-876, :970-972`) store the `PLAN_PRICES` value on the tenant doc. It is
never sent back to the Stripe API, so it is a data-quality wart, not a payment failure —
but it is a stored test id (see §3).

### S3 — Test connect data makes the daily payout cron & recurring commissions fail forever (safely)
A test-era affiliate has `affiliateConnectStatus:'active'` + a test
`affiliateStripeAccountId`. `src/app/api/affiliate/retry-transfers/route.ts:64` sees
status `active`, attempts `transfers.create` to the test `acct_` (`:75`), Stripe 400s,
the error is caught (`:104-107`) → commission **stays `pending`**. Same in the recurring
path (`src/app/api/stripe/webhook/route.ts:1327`, `catch :1336`). No double-pay, no
corruption — but **the affiliate is never paid** until they re-onboard Connect in live.
Purge + re-onboard (see §3).

### S4 — The recurring affiliate transfer has no Stripe idempotency key
`src/app/api/stripe/webhook/route.ts:1327` (unlike the initial path at `:77` and the
sweep at `src/lib/affiliate-payout.ts:107`). It relies on the `stripeInvoiceId`
Firestore dedup (`:1312`) + the `webhook_events` marker. This is identical in test and
live, so it is **not** a go-live blocker — recorded for completeness.

### S5 — Firebase Cloud Functions have a *separate* env from Vercel → split-brain risk
`functions/src/index.ts:344,388` read `process.env.STRIPE_SECRET_KEY` independently. If
Vercel flips to live but the Functions runtime keeps a test key (or vice-versa),
`addChurchBilling` / `removeChurchBilling` operate in the wrong mode on stored
`stripeSubscriptionId` / `stripeSubscriptionItemId`. `removeChurchBilling` on a missing
key **silently returns** (`:389`) rather than 500. These use inline `price_data` (no
price-id dependency — good), but the key mode must be flipped in **both** places.

---

## 3. DATA TO PURGE — Firestore fields holding test-mode Stripe ids

All are invalid against a live key. Do **not** delete blindly — this is the enumeration
for the founder to decide.

| Collection | Field(s) | Writer (example) | Urgency |
|---|---|---|---|
| `tenants` | `stripeConnectAccountId`, `stripeConnectStatus` | `src/app/api/stripe/connect/route.ts:102-103` | **HIGH** — no self-heal; blocks donations/tickets (B4) |
| `tenants` | `stripeSubscriptionId`, `stripePriceId`, `addOnAiAssistant` | `src/app/api/stripe/webhook/route.ts:863-880, 934` | MED — stale plan pointers |
| `tenants` | `stripeCustomerId` | `src/app/api/stripe/webhook/route.ts:872`, `src/app/api/stripe/checkout/route.ts:207` | **LOW** — self-healing (see §5) |
| `users` | `affiliateStripeAccountId`, `affiliateConnectStatus` | `src/app/api/stripe/connect/route.ts:113-116` | **HIGH** — drives payout transfers (S3) |
| `users` | `aiAssistantSubscriptionItemId`, `aiAssistantCustomerId`, `donationSubscriptionId`, `donationChurchId` | `src/app/api/stripe/webhook/route.ts:640-645, 795-796, 945-946` | MED |
| `churches` | `stripeSubscriptionItemId` | `functions/src/index.ts:370` | MED |
| `affiliate_commissions` (collection) | `stripeSubscriptionId`, `stripeInvoiceId`, `stripeTransferId` + all `pending` rows | `src/app/api/stripe/webhook/route.ts:80-89, 1339-1350` | **HIGH** — pending rows keep trying to pay test accounts (S3) |
| `tenants/{id}/invoices` (subcollection) | `relatedId` (test `pi_`/`sub_`), test receipts | `src/app/api/stripe/webhook/route.ts:1490-1493` | LOW — historical records |
| `registrations` | `stripePaymentIntentId` | `src/app/api/stripe/webhook/route.ts:359` | LOW |
| `webhook_events` (collection) | doc ids = test `event.id` | `src/app/api/stripe/webhook/route.ts:713` | LOW — harmless dedup; optional cleanup |

---

## 4. THE T2 CHECKLIST — exact ordered flip

1. **Create live products/prices** in the Stripe live dashboard: 4 plans ×
   monthly/yearly (8) + AI Assistant $200/mo. Record the 9 live `price_…` ids.
2. **Set price env vars to the live ids** in Vercel **and** the Firebase Functions env:
   all 8 `STRIPE_PRICE_*` + `STRIPE_PRICE_AI_MONTHLY`. Do not rely on the `??` fallbacks
   (B1). Verify: a checkout for one plan renders the live price.
3. **Set `STRIPE_SECRET_KEY=sk_live_…`** in **both** Vercel and Firebase Functions
   config (S5).
4. **Create the main live webhook** → `/api/stripe/webhook`, subscribe the **10 events**
   in B5's first row, copy its signing secret → `STRIPE_WEBHOOK_SECRET`.
5. **Create the second live webhook** → `/api/stripe/connect/webhook`, subscribe
   **`account.updated`**, copy its *different* signing secret →
   `STRIPE_CONNECT_WEBHOOK_SECRET`.
6. **Confirm `CRON_SECRET`** is set (the retry-transfers guard rejects when unset —
   `src/app/api/affiliate/retry-transfers/route.ts:19`).
7. **Purge test-mode Stripe ids** (§3) — prioritize connect accounts and pending
   `affiliate_commissions`.
8. **Re-onboard Connect in live** — the platform account and every church that had
   connected in test.
9. **Verify after each:** a real $ plan checkout (card charged → tenant
   created/upgraded); a live donation (destination charge lands in the church's live
   account + receipt written); Stripe dashboard shows webhook deliveries returning
   `200`; one affiliate commission actually transfers.

---

## 5. VERIFIED SAFE — checked and genuinely fine

- **No 200-silent-noop guards.** All Stripe routes return `500` on a missing key
  (loud), e.g. `src/app/api/stripe/donate/route.ts:20-22`,
  `src/app/api/stripe/checkout/route.ts:37-39`,
  `src/app/api/stripe/connect/route.ts:16-18`, `src/app/api/stripe/portal/route.ts:14`,
  `src/app/api/affiliate/retry-transfers/route.ts:24-25`,
  `src/app/api/ai-assistant/portal/route.ts:27-28`;
  `src/app/api/affiliate/callback/route.ts:30` redirects with `?error=` (OAuth path).
  None silently succeeds.
- **Customer ids self-heal.** `getValidCustomerId`
  (`src/app/api/stripe/checkout/route.ts:12-29`) catches a wrong-mode
  `customers.retrieve` and creates a fresh live customer — so a stored `stripeCustomerId`
  does not block checkout.
- **`AFFILIATE_RATE = 0.15` is flat.** `src/app/api/stripe/webhook/route.ts:24`; no
  per-plan commission remnant anywhere (old 20/15/10/10 ladder is gone).
  `PLATFORM_FEE_MAP` (per-plan *fee*, not commission) is intentional and unrelated.
- **Double-pay guards intact.** Self-referral block (`webhook/route.ts:42`),
  duplicate-commission query (`:47-55`), initial-transfer idempotency
  `aff_initial_${sub}` (`:77`), and `affiliateSweepIdempotencyKey` =
  `aff_sweep_${commissionId}` (`src/lib/affiliate-payout.ts:18`) genuinely shared by the
  activation sweep (`src/app/api/stripe/connect/webhook/route.ts:150`) **and** the daily
  cron (`src/app/api/affiliate/retry-transfers/route.ts:87`) — same commission id → same
  key → Stripe returns the original transfer. Confirmed non-double-paying.
- **Amount units correct; the $10.5M bug is fixed.** Invoices store CENTS;
  `src/components/AdminAccounting.tsx:324` normalizes to dollars **once** at read,
  giving-statements divide `/100` at render (`:656`). `totalDonated` /
  `campaigns.raised` / `donationAmount` are dollars end-to-end
  (`webhook/route.ts:490,507,585,642,1469,1507`). No cents/dollars mismatch found.
- **Webhook idempotency + undo-on-failure** intact on both endpoints
  (`webhook/route.ts:713-723, 1519-1524`; `connect/webhook/route.ts:52-62, 176-181`).
- **Cron guard has no `Bearer undefined` bypass**
  (`src/app/api/affiliate/retry-transfers/route.ts:19` rejects when `CRON_SECRET`
  unset).
- **No stray hardcoded Stripe ids in production** beyond the `stripe-config.ts`
  fallbacks — `functions/` uses inline `price_data`, not price ids; the `acct_1TioBC…` /
  `sk_test_stub` literals live only in `.hermes/` plans, `AGENTS.md`, `.env.example`, CI,
  and test files.
- **Blog cron** is off Vercel (`vercel.json` no longer lists
  `/api/blog/auto-generate`; moved to cron-job.org) and `CRON_SECRET`-guarded
  (`src/app/api/blog/auto-generate/route.ts:14`).

---

**Bottom line:** three configuration blockers dominate day one — the price-ID fallbacks
(B1), the two webhook signing secrets (B2/B3), and test Connect accounts in Firestore
(B4). Fix those three via §4 and the money paths themselves are sound: the idempotency,
self-referral, amount-unit, and guard logic all verified clean.
