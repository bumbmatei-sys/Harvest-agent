import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth, requireOwner } from '@/lib/api-auth';
import { captureMoneyPathError } from '@/lib/money-path-sentry';
import { PLAN_PRICES, AI_ASSISTANT_MONTHLY } from '@/lib/billing';
import { logReferralCapture, resolveAffiliateReferrer } from '@/lib/affiliate-referrer';
import { tenantPrivateRef, getTenantPrivate } from '@/lib/tenant-private';
import { billingActionUnavailable, blocksStripeAction, resolveBillingOwnership } from '@/lib/billing-processor';
import { AI_TELEGRAM_ASSISTANT_ENABLED } from '@/utils/plan-features';

export const dynamic = 'force-dynamic';

// Returns a valid customer id for the current Stripe mode. If the stored id is
// missing/deleted/wrong-mode, creates a fresh customer and persists it via `persist`.
async function getValidCustomerId(
  stripe: Stripe,
  storedId: string | undefined | null,
  createParams: Stripe.CustomerCreateParams,
  persist: (id: string) => Promise<void>,
): Promise<string> {
  if (storedId) {
    try {
      const c = await stripe.customers.retrieve(storedId);
      if (c && !(c as any).deleted) return storedId;
    } catch {
      // missing / deleted / wrong-mode → fall through and create a fresh one
    }
  }
  const created = await stripe.customers.create(createParams);
  await persist(created.id);
  return created.id;
}

export async function POST(request: NextRequest) {
  try {
    const userOrErr = await requireAuth(request);
    if (userOrErr instanceof Response) return userOrErr;

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }
    const stripe = new Stripe(stripeKey);

    const body = await request.json();
    const { plan, billing, tenantId, tenantName, ministryName, email, addOn, referrerId } = body;

    // Handle AI Assistant add-on checkout — always scoped to an existing tenant.
    if (addOn === 'ai-assistant') {
      // The AI (Telegram) Assistant add-on is retired: no new purchase can be
      // initiated while it is hidden. This closes the money path even if a stale
      // client (the now-dormant AiAssistantSection) still posts here. The Stripe
      // wiring and provisioning code stay intact — flip AI_TELEGRAM_ASSISTANT_ENABLED
      // to bring the add-on back.
      if (!AI_TELEGRAM_ASSISTANT_ENABLED) {
        return NextResponse.json({ error: 'The AI Assistant add-on is no longer available.' }, { status: 410 });
      }
      if (!tenantId) {
        return NextResponse.json({ error: 'Missing required field: tenantId' }, { status: 400 });
      }
      if (!userOrErr.isSuperAdmin && userOrErr.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Access denied to this tenant' }, { status: 403 });
      }
      if (!AI_ASSISTANT_MONTHLY) {
        return NextResponse.json({ error: 'AI Assistant price not configured — set STRIPE_PRICE_AI_MONTHLY ($200/mo)' }, { status: 500 });
      }
      // The add-on is per-admin: it bills the buyer's OWN Stripe customer
      // (users/{uid}.aiAssistantCustomerId), never the tenant's shared plan
      // customer — so each admin can later view/cancel it in their own billing
      // portal (/api/ai-assistant/portal) without reaching tenant billing.
      const buyerRef = adminDb.collection('users').doc(userOrErr.uid);
      const buyerSnap = await buyerRef.get();
      const customerId = await getValidCustomerId(
        stripe,
        buyerSnap.data()?.aiAssistantCustomerId,
        {
          email: email || userOrErr.email || undefined,
          name: userOrErr.email || userOrErr.uid,
          metadata: { userId: userOrErr.uid, tenantId, app: 'harvest' },
        },
        async (id) => {
          await buyerRef.set({
            aiAssistantCustomerId: id,
            updatedAt: new Date().toISOString(),
          }, { merge: true });
        },
      );

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        line_items: [{ price: AI_ASSISTANT_MONTHLY, quantity: 1 }],
        success_url: `${baseUrl}/?stripe=success&session_id={CHECKOUT_SESSION_ID}&addon=ai-assistant`,
        cancel_url: `${baseUrl}/?stripe=cancel`,
        subscription_data: {
          metadata: { tenantId, addOn: 'ai-assistant', userId: userOrErr.uid },
        },
      });

      return NextResponse.json({ url: session.url });
    }

    // Regular plan checkout (new-ministry signup OR existing-tenant plan change).
    if (!plan || !billing) {
      return NextResponse.json({ error: 'Missing required fields: plan, billing' }, { status: 400 });
    }

    // `billing` arrives untyped from the request body, so it cannot index the
    // { monthly, yearly } price record directly. Narrowing to the two real keys
    // keeps the existing outcome: anything else falls through to the 400 below,
    // exactly as an unknown key resolving to undefined did before.
    const billingKey: 'monthly' | 'yearly' | null =
      billing === 'monthly' ? 'monthly' : billing === 'yearly' ? 'yearly' : null;
    const priceId = billingKey ? PLAN_PRICES[plan]?.[billingKey] : undefined;
    if (!priceId) {
      return NextResponse.json({ error: `Invalid plan/billing: ${plan}/${billing}` }, { status: 400 });
    }

    // Resolve short affiliate code (<=16 chars) to userId for webhook processing.
    // Shared by both the new-ministry and existing-tenant paths — and, since
    // REP-4 PR 2, by /api/dodo/checkout, which is why the rule moved into
    // `@/lib/affiliate-referrer` rather than being copied. Both processors'
    // webhooks read `referrerId` from subscription metadata and treat it as a
    // user id, so a route that forwards the raw CODE credits nobody, for good.
    const referralContext = { plan, billing, processor: 'stripe' };
    const resolvedReferral = await resolveAffiliateReferrer(referrerId, referralContext);
    const resolvedReferrerId = resolvedReferral.referrerId;
    logReferralCapture(resolvedReferral, referralContext);

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';

    // ── New-ministry signup: there is NO tenant yet. ─────────────────────────
    // The webhook (Admin SDK) creates the tenant on `checkout.session.completed`,
    // so we don't require/read a tenant here. We carry everything the webhook
    // needs to build the account in the subscription metadata. Return the user to
    // the SAME origin they signed up on (so their Firebase session survives) and
    // mark it ?stripe=success so the first-run gate picks them up.
    if (!tenantId) {
      // A user who already belongs to an organization must NOT self-provision a
      // second tenant via a tenant-less request (the webhook would detach them
      // from their current org). Plan changes for existing members always carry a
      // tenantId and use the path below. Super admins legitimately have no tenant.
      if (userOrErr.tenantId && !userOrErr.isSuperAdmin) {
        return NextResponse.json({ error: 'You already belong to an organization.' }, { status: 400 });
      }

      const origin = request.headers.get('origin') || baseUrl;

      // Reuse an existing Stripe customer for this email so repeated signup
      // attempts (abandoned checkouts) don't pile up orphaned customers.
      const customerEmail = userOrErr.email || email || undefined;
      let customerId: string | undefined;
      if (customerEmail) {
        try {
          const existing = await stripe.customers.list({ email: customerEmail, limit: 1 });
          if (existing.data[0]) customerId = existing.data[0].id;
        } catch { /* fall through to create */ }
      }
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: customerEmail,
          name: ministryName || customerEmail || undefined,
        });
        customerId = customer.id;
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${origin}/?stripe=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/?stripe=cancel`,
        subscription_data: {
          // New ministries get a 7-day free trial with the card captured up
          // front (Checkout still collects payment details). Stripe charges the
          // first real invoice when the trial ends; only then does the affiliate
          // commission fire (see processInitialAffiliateCommission's $0 guard and
          // the recurring invoice.payment_succeeded path in the webhook). This
          // trial is scoped to new-tenant signup ONLY — the AI add-on and the
          // existing-tenant plan-change sessions intentionally have no trial.
          trial_period_days: 7,
          metadata: {
            plan,
            billing,
            ministryName: ministryName || '',
            userId: userOrErr.uid,
            newTenant: 'true',
            ...(resolvedReferrerId ? { referrerId: resolvedReferrerId } : {}),
          },
        },
      });

      return NextResponse.json({ url: session.url });
    }

    // ── Existing-tenant plan change (upgrade / downgrade). ───────────────────
    //
    // 🔴 OWNER-ONLY, from THE-80. This branch used to inherit the `requireAuth`
    // at the top of the handler plus a tenant-match — which is membership, not
    // authority. Anyone who signed up through the church's public subdomain is a
    // member, so the congregation could move their church from $49 to $199. The
    // reads on the same Billing screen (`/api/billing/invoices`, `/statement`)
    // were already `requireOwner`, so the write path was the LOOSER of the two;
    // this makes them the same gate.
    //
    // ⚠️ It is applied HERE and not at the top of the handler on purpose. The
    // new-ministry signup branch above has no tenant at all — the buyer is not
    // an owner, an admin, or a member of anything yet, and the webhook creates
    // the tenant afterwards. Gating the whole route would close the top of the
    // money path to every new church. `requireOwner` also admits the roster
    // admin and the apex super admin, neither of whom the old tenant-match
    // reliably passed.
    const ownerOrErr = await requireOwner(request, { tenantId });
    if (ownerOrErr instanceof NextResponse) return ownerOrErr;

    // ── 🔴 ROUTE TO THE PROCESSOR THAT OWNS THE SUBSCRIPTION. ────────────────
    //
    // THIS IS THE BUG THE WHOLE CHANGE EXISTS FOR. With DODO_BILLING_ENABLED on,
    // signup creates a DODO subscription, and everything below creates a STRIPE
    // one. A church that signed up through Dodo and then upgraded ended up paying
    // two processors for one product — and `getValidCustomerId` would compound it
    // by creating and PERSISTING a Stripe customer on the tenant, so the tenant
    // itself would then look like it belonged to both.
    //
    // The guard therefore runs BEFORE any Stripe call, not just before the
    // checkout session. Dodo's own plan change (`subscriptions.changePlan`) is
    // deliberately NOT wired up here: it is a money decision about proration
    // defaults plus product-collection configuration on Dodo's side, and it needs
    // `subscription.plan_changed` handled to move the tenant's plan afterwards —
    // which is lifecycle, a later part. Refusing is the recoverable outcome;
    // charging twice is not.
    const privateData = await getTenantPrivate(tenantId);
    const ownership = resolveBillingOwnership(privateData);
    if (blocksStripeAction(ownership)) {
      return billingActionUnavailable('changing your plan', ownership);
    }

    // The tenant doc was already read (and proved to exist) by the owner gate.
    const tenantData = ownerOrErr.tenantData;
    const customerId = await getValidCustomerId(
      stripe,
      privateData.stripeCustomerId,
      {
        email: email || undefined,
        name: tenantName || tenantData?.name || tenantId,
        metadata: { tenantId, app: 'harvest' },
      },
      async (id) => {
        await tenantPrivateRef(tenantId).set(
          { stripeCustomerId: id, updatedAt: new Date().toISOString() },
          { merge: true },
        );
      },
    );

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `https://${tenantId}.theharvest.app/?stripe=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://${tenantId}.theharvest.app/?stripe=cancel`,
      subscription_data: {
        metadata: { tenantId, plan, billing, ...(resolvedReferrerId ? { referrerId: resolvedReferrerId } : {}) },
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error('Stripe checkout error:', error?.message || error);
    // No session means the customer cannot pay at all — the top of the money path.
    captureMoneyPathError(error, { step: 'stripe-checkout', level: 'error' });
    return NextResponse.json({ error: error?.message || 'Failed to create checkout session' }, { status: 500 });
  }
}
