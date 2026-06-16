import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { generateAccessCode } from '@/app/api/ai-assistant/route';

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
            const accessCode = generateAccessCode();
            await adminDb.collection('tenants').doc(tenantId).update({
              addOnAiAssistant: subscriptionId,
              addOnAiAssistantCode: accessCode,
              updatedAt: new Date().toISOString(),
            });
            console.log(`✅ Tenant ${tenantId} added AI Assistant add-on (code: ${accessCode})`);
          } else {
            const plan = session.metadata?.plan;
            if (plan) {
              // Cancel old subscription if exists (prevents double billing on upgrade)
              const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
              const oldSubId = tenantDoc.data()?.stripeSubscriptionId;
              if (oldSubId && oldSubId !== subscriptionId) {
                try {
                  await stripe.subscriptions.cancel(oldSubId);
                  console.log(`🔄 Cancelled old subscription ${oldSubId} for tenant ${tenantId}`);
                } catch (cancelErr) {
                  console.error(`Failed to cancel old subscription ${oldSubId}:`, cancelErr);
                }
              }

              const updateData: Record<string, any> = {
                plan,
                status: 'active',
                stripeSubscriptionId: subscriptionId,
                stripeCustomerId: session.customer as string,
                stripePriceId: session.metadata?.billing === 'yearly'
                  ? getYearlyPriceId(plan)
                  : getMonthlyPriceId(plan),
                updatedAt: new Date().toISOString(),
              };

              // Ultra/Enterprise: AI assistant is included — auto-generate code if not present
              if ((plan === 'ultra' || plan === 'enterprise') && !tenantDoc.data()?.addOnAiAssistantCode) {
                updateData.addOnAiAssistantCode = generateAccessCode();
              }

              await adminDb.collection('tenants').doc(tenantId).update(updateData);

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

        if (tenantId) {
          const updateData: Record<string, unknown> = {
            stripeSubscriptionId: subscription.id,
            updatedAt: new Date().toISOString(),
          };

          // Detect plan from metadata or price ID (handles portal changes)
          let plan = subscription.metadata?.plan || null;
          if (!plan && subscription.items?.data?.[0]?.price?.id) {
            plan = getPlanFromPriceId(subscription.items.data[0].price.id);
          }
          if (plan) updateData.plan = plan;

          // Sync subscription status
          if (subscription.status === 'active') {
            updateData.status = 'active';
          } else if (subscription.status === 'past_due') {
            updateData.status = 'past_due';
          } else if (subscription.status === 'canceled') {
            updateData.status = 'cancelled';
          }

          await adminDb.collection('tenants').doc(tenantId).update(updateData);

          // Update user docs if plan changed
          if (plan) {
            const usersSnap = await adminDb.collection('users')
              .where('tenantId', '==', tenantId)
              .get();
            const batch = adminDb.batch();
            usersSnap.docs.forEach(doc => {
              batch.update(doc.ref, { plan });
            });
            await batch.commit();
          }

          console.log(`📝 Subscription updated for tenant ${tenantId}`, plan ? `→ ${plan}` : '');
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const tenantId = subscription.metadata?.tenantId;
        const addOn = subscription.metadata?.addOn;

        if (tenantId) {
          if (addOn === 'ai-assistant') {
            // AI Assistant add-on cancelled — revoke access code and bindings
            const bindingsSnap = await adminDb.collection('ai_assistant_bindings')
              .where('tenantId', '==', tenantId)
              .get();
            const batch = adminDb.batch();
            bindingsSnap.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();

            await adminDb.collection('tenants').doc(tenantId).update({
              addOnAiAssistant: null,
              addOnAiAssistantCode: null,
              updatedAt: new Date().toISOString(),
            });
            console.log(`❌ Tenant ${tenantId} AI Assistant add-on cancelled (${bindingsSnap.size} bindings removed)`);
          } else {
            // Downgrade to plus (lowest plan) on cancellation
            await adminDb.collection('tenants').doc(tenantId).update({
              plan: 'plus',
              status: 'cancelled',
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

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const tenantId = (invoice as any).metadata?.tenantId;
        if (tenantId) {
          // Reactivate suspended accounts on successful payment
          const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
          if (!!tenantDoc.exists && tenantDoc.data()?.status === 'suspended') {
            await adminDb.collection('tenants').doc(tenantId).update({
              status: 'active',
              updatedAt: new Date().toISOString(),
            });
            console.log(`✅ Tenant ${tenantId} reactivated after successful payment`);
          }
        }
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        const tenantId = charge.metadata?.tenantId;
        if (tenantId) {
          await adminDb.collection('tenants').doc(tenantId).update({
            lastRefund: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          console.log(`💰 Refund processed for tenant ${tenantId}`);
        }
        break;
      }

      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute;
        const tenantId = dispute.metadata?.tenantId;
        if (tenantId) {
          await adminDb.collection('tenants').doc(tenantId).update({
            status: 'disputed',
            lastDispute: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          console.log(`⚠️ Dispute created for tenant ${tenantId}`);
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
    plus: 'price_1TiydE1YKkcSbTf34ZbpeJjd',
    pro: 'price_1TiydE1YKkcSbTf3pATPgbci',
    max: 'price_1TiycF1YKkcSbTf3gfOoL0Dm',
    ultra: 'price_1TiycG1YKkcSbTf35YIEaVEl',
  };
  return map[plan] || map.plus;
}

function getYearlyPriceId(plan: string): string {
  const map: Record<string, string> = {
    plus: 'price_1TiydE1YKkcSbTf332ZMf8n9',
    pro: 'price_1TiydE1YKkcSbTf31nC69ngk',
    max: 'price_1TiycF1YKkcSbTf3gSUXqzl9',
    ultra: 'price_1TiycG1YKkcSbTf3d54wo7lB',
  };
  return map[plan] || map.plus;
}

function getPlanFromPriceId(priceId: string): string | null {
  const allPrices: Record<string, string> = {
    'price_1TiydE1YKkcSbTf34ZbpeJjd': 'plus',
    'price_1TiydE1YKkcSbTf332ZMf8n9': 'plus',
    'price_1TiydE1YKkcSbTf3pATPgbci': 'pro',
    'price_1TiydE1YKkcSbTf31nC69ngk': 'pro',
    'price_1TiycF1YKkcSbTf3gfOoL0Dm': 'max',
    'price_1TiycF1YKkcSbTf3gSUXqzl9': 'max',
    'price_1TiycG1YKkcSbTf35YIEaVEl': 'ultra',
    'price_1TiycG1YKkcSbTf3d54wo7lB': 'ultra',
  };
  return allPrices[priceId] || null;
}
