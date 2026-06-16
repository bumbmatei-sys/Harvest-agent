import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeKey || !webhookSecret) {
    console.error('Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET');
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2026-05-27.dahlia' });

  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = session.metadata?.tenantId;
        const subscriptionId = session.subscription as string;

        if (tenantId) {
          // Handle AI Assistant add-on checkout
          if (session.metadata?.addOn === 'ai-assistant') {
            await adminDb.collection('tenants').doc(tenantId).update({
              addOnAiAssistant: subscriptionId,
              updatedAt: new Date().toISOString(),
            });
            console.log(`✅ Tenant ${tenantId} added AI Assistant add-on`);
          } else {
            const plan = session.metadata?.plan;
            if (plan) {
              await adminDb.collection('tenants').doc(tenantId).update({
                plan,
                stripeSubscriptionId: subscriptionId,
                stripeCustomerId: session.customer as string,
                stripePriceId: session.metadata?.billing === 'yearly'
                  ? getYearlyPriceId(plan)
                  : getMonthlyPriceId(plan),
                updatedAt: new Date().toISOString(),
              });

              // Update all users belonging to this tenant
              const usersSnap = await adminDb.collection('users')
                .where('tenantId', '==', tenantId)
                .get();
              const batch = adminDb.batch();
              usersSnap.docs.forEach(doc => {
                batch.update(doc.ref, { plan });
              });
              await batch.commit();

              console.log(`✅ Tenant ${tenantId} upgraded to ${plan}`);
            }
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const tenantId = subscription.metadata?.tenantId;
        const plan = subscription.metadata?.plan;

        if (tenantId) {
          const updateData: Record<string, unknown> = {
            stripeSubscriptionId: subscription.id,
            updatedAt: new Date().toISOString(),
          };
          if (plan) updateData.plan = plan;

          await adminDb.collection('tenants').doc(tenantId).update(updateData);
          console.log(`📝 Subscription updated for tenant ${tenantId}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const tenantId = subscription.metadata?.tenantId;
        const addOn = subscription.metadata?.addOn;

        if (tenantId) {
          if (addOn === 'ai-assistant') {
            // AI Assistant add-on cancelled
            await adminDb.collection('tenants').doc(tenantId).update({
              addOnAiAssistant: null,
              updatedAt: new Date().toISOString(),
            });
            console.log(`❌ Tenant ${tenantId} AI Assistant add-on cancelled`);
          } else {
            // Downgrade to plus (lowest plan) on cancellation
            await adminDb.collection('tenants').doc(tenantId).update({
              plan: 'plus',
              stripeSubscriptionId: null,
              updatedAt: new Date().toISOString(),
            });

            const usersSnap = await adminDb.collection('users')
              .where('tenantId', '==', tenantId)
              .get();
            const batch = adminDb.batch();
            usersSnap.docs.forEach(doc => {
              batch.update(doc.ref, { plan: 'plus' });
            });
            await batch.commit();

            console.log(`❌ Tenant ${tenantId} subscription cancelled, downgraded to plus`);
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const tenantId = (invoice as any).metadata?.tenantId;
        if (tenantId) {
          await adminDb.collection('tenants').doc(tenantId).update({
            status: 'suspended',
            updatedAt: new Date().toISOString(),
          });
          console.log(`⚠️ Payment failed for tenant ${tenantId}`);
        }
        break;
      }
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

function getMonthlyPriceId(plan: string): string {
  const map: Record<string, string> = {
    plus: 'price_1TipKw1YKkcSbTf3NBKUJQxW',
    pro: 'price_1TipKx1YKkcSbTf3BLNULdsm',
    ultra: 'price_1TipKx1YKkcSbTf3d1QlW8nA',
  };
  return map[plan] || map.plus;
}

function getYearlyPriceId(plan: string): string {
  const map: Record<string, string> = {
    plus: 'price_1TipKw1YKkcSbTf3lxwJrDPb',
    pro: 'price_1TipKx1YKkcSbTf3lYNIc7GB',
    ultra: 'price_1TipKy1YKkcSbTf3dTDBc6iI',
  };
  return map[plan] || map.plus;
}
