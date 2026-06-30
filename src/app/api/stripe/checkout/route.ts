import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';
import { PLAN_PRICES, AI_ASSISTANT_MONTHLY } from '@/lib/stripe-config';

export const dynamic = 'force-dynamic';

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
      if (!tenantId) {
        return NextResponse.json({ error: 'Missing required field: tenantId' }, { status: 400 });
      }
      if (!userOrErr.isSuperAdmin && userOrErr.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Access denied to this tenant' }, { status: 403 });
      }
      if (!AI_ASSISTANT_MONTHLY) {
        return NextResponse.json({ error: 'AI Assistant price not configured — set STRIPE_PRICE_AI_MONTHLY ($200/mo)' }, { status: 500 });
      }
      const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
      const tenantData = tenantDoc.data();
      let customerId = tenantData?.stripeCustomerId;

      if (!customerId) {
        const customer = await stripe.customers.create({
          email: email || undefined,
          name: tenantName || tenantData?.name || tenantId,
          metadata: { tenantId, app: 'harvest' },
        });
        customerId = customer.id;
        await adminDb.collection('tenants').doc(tenantId).update({
          stripeCustomerId: customerId,
          updatedAt: new Date().toISOString(),
        });
      }

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

    const priceId = PLAN_PRICES[plan]?.[billing];
    if (!priceId) {
      return NextResponse.json({ error: `Invalid plan/billing: ${plan}/${billing}` }, { status: 400 });
    }

    // Resolve short affiliate code (<=16 chars) to userId for webhook processing.
    // Shared by both the new-ministry and existing-tenant paths.
    let resolvedReferrerId = referrerId;
    if (referrerId && referrerId.length <= 16) {
      try {
        const affiliateSnap = await adminDb
          .collection('users')
          .where('affiliateCode', '==', referrerId)
          .limit(1)
          .get();
        if (!affiliateSnap.empty) {
          resolvedReferrerId = affiliateSnap.docs[0].id;
        }
      } catch (resolveErr) {
        console.warn('Failed to resolve affiliate code, using as-is:', resolveErr);
      }
    }

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
    if (!userOrErr.isSuperAdmin && userOrErr.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Access denied to this tenant' }, { status: 403 });
    }

    const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
    const tenantData = tenantDoc.data();
    let customerId = tenantData?.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: email || undefined,
        name: tenantName || tenantData?.name || tenantId,
        metadata: { tenantId, app: 'harvest' },
      });
      customerId = customer.id;
      await adminDb.collection('tenants').doc(tenantId).update({
        stripeCustomerId: customerId,
        updatedAt: new Date().toISOString(),
      });
    }

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
    return NextResponse.json({ error: error?.message || 'Failed to create checkout session' }, { status: 500 });
  }
}
