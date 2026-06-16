# Stripe Integration Plan

> Karpathy principles: Simplicity first. Surgical changes. Ship working code.

**Goal:** Connect Harvest's billing to real Stripe — checkout, webhooks, customer portal.

**Account:** `acct_1TioBC1YKkcSbTf3` (bumbmatei@pm.me) — live, USD, charges enabled.

---

## Architecture

```
User clicks "Upgrade" → /api/stripe/checkout → Stripe Checkout Session
→ User pays → Stripe webhook → /api/stripe/webhook → Update Firestore tenant plan
→ User redirected to /settings?success=true

User clicks "Manage Subscription" → /api/stripe/portal → Stripe Customer Portal
→ User manages/cancels → Stripe webhook → /api/stripe/webhook → Update Firestore
```

## Stripe Products & Prices

| Product | Monthly (USD) | Yearly (USD) | Stripe Price IDs |
|---------|--------------|--------------|------------------|
| Plus    | $100/mo      | $1,000/yr    | Created at setup |
| Pro     | $250/mo      | $2,500/yr    | Created at setup |
| Ultra   | $500/mo      | $5,000/yr    | Created at setup |

Enterprise = custom (contact sales) — no Stripe price.

## Files to Create/Modify

### New Files
1. `src/app/api/stripe/checkout/route.ts` — Create checkout session
2. `src/app/api/stripe/webhook/route.ts` — Handle Stripe events
3. `src/app/api/stripe/portal/route.ts` — Create billing portal session
4. `src/utils/stripe-helpers.ts` — Shared Stripe utilities

### Modified Files
5. `src/types/tenant.types.ts` — Add `stripeCustomerId`, `stripeSubscriptionId` to Tenant
6. `src/components/AdminSettings.tsx` — Wire upgrade buttons to checkout, add portal button
7. `src/components/AdminDashboard.tsx` — Pass tenantId to AdminSettings

## Implementation Tasks

### Task 1: Create Stripe products + prices (via Composio)
- Create 3 products: Harvest Plus, Harvest Pro, Harvest Ultra
- Create 6 prices: monthly + yearly for each
- Store price IDs in env vars or constants

### Task 2: Update tenant types
- Add `stripeCustomerId?`, `stripeSubscriptionId?`, `stripePriceId?` to Tenant interface

### Task 3: Create checkout API route
- POST `/api/stripe/checkout`
- Takes: `{ priceId, tenantId, plan }`
- Creates/reuses Stripe customer
- Creates checkout session with success/cancel URLs
- Returns checkout URL

### Task 4: Create webhook handler
- POST `/api/stripe/webhook`
- Handles: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
- On success: update tenant plan in Firestore, store stripeCustomerId + subscriptionId

### Task 5: Create billing portal API route
- POST `/api/stripe/portal`
- Takes: `{ customerId }`
- Creates portal session
- Returns portal URL

### Task 6: Wire AdminSettings
- Upgrade button → calls checkout API → redirects to Stripe
- "Manage Subscription" button → calls portal API → redirects to Stripe Portal
- Handle `?success=true` return from Stripe

### Task 7: Deploy + test
- Set Stripe webhook secret in env vars
- Deploy to Vercel
- Test with Stripe test mode first

## Webhook Events to Handle

- `checkout.session.completed` → New subscription, update tenant plan
- `customer.subscription.updated` → Plan change, update tenant
- `customer.subscription.deleted` → Downgrade to free/cancel
- `invoice.payment_failed` → Mark tenant as at-risk

## Environment Variables Needed

- `STRIPE_SECRET_KEY` — Already connected via Composio
- `STRIPE_WEBHOOK_SECRET` — Set after webhook endpoint creation
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — For client-side Stripe.js (optional)
- `NEXT_PUBLIC_APP_URL` — Already exists

## Verification

1. Click "Upgrade to Plus" → Redirects to Stripe Checkout
2. Complete payment → Redirects back to app with success
3. Tenant plan updates in Firestore
4. "Manage Subscription" → Opens Stripe Portal
5. Cancel in portal → Tenant plan downgrades
