import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ai-assistant/portal
 * Opens the Stripe billing portal for the CALLING USER's own AI Assistant
 * add-on customer (users/{uid}.aiAssistantCustomerId) — where they see the
 * add-on subscription and its invoices, and can cancel it. Cancellation then
 * flows back through the Stripe webhook (customer.subscription.deleted), which
 * revokes the entitlement.
 *
 * This must only ever open the user's own customer — never the tenant's shared
 * plan customer (/api/stripe/portal) — so a non-owner admin can manage their
 * add-on without reaching tenant billing.
 */
export async function POST(request: NextRequest) {
  try {
    const userOrErr = await requireAuth(request);
    if (userOrErr instanceof Response) return userOrErr;

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }
    const stripe = new Stripe(stripeKey);

    const userRef = adminDb.collection('users').doc(userOrErr.uid);
    const userDoc = await userRef.get();
    const me = userDoc.data();
    let customerId: string | undefined = me?.aiAssistantCustomerId;

    // Legacy purchases predate aiAssistantCustomerId: resolve the customer from
    // the user's own add-on subscription. Never fall back to the tenant's
    // shared customer — if the subscription lives there (oldest purchases), the
    // owner manages it from tenant billing instead.
    if (!customerId && me?.aiAssistantSubscriptionItemId) {
      try {
        const sub = await stripe.subscriptions.retrieve(me.aiAssistantSubscriptionItemId);
        const subCustomer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
        let tenantCustomerId: string | undefined;
        if (me?.tenantId) {
          const tenantDoc = await adminDb.collection('tenants').doc(me.tenantId).get();
          tenantCustomerId = tenantDoc.data()?.stripeCustomerId;
        }
        if (subCustomer && subCustomer !== tenantCustomerId) {
          customerId = subCustomer;
          await userRef.set({
            aiAssistantCustomerId: customerId,
            updatedAt: new Date().toISOString(),
          }, { merge: true });
        }
      } catch {
        // subscription gone / wrong mode — fall through to the error below
      }
    }

    if (!customerId) {
      return NextResponse.json({ error: 'No AI Assistant billing found for your account.' }, { status: 400 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';
    const origin = request.headers.get('origin') || baseUrl;

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/?stripe=portal_return`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error('AI Assistant portal error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to open billing portal' }, { status: 500 });
  }
}
