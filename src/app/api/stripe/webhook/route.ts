import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { generateAccessCode } from '@/app/api/ai-assistant/route';
import { PLAN_PRICES, getPlanFromPriceId } from '@/lib/stripe-config';

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
        const subscriptionId = session.subscription as string | null;

        if (tenantId && subscriptionId) {
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

              // Affiliate commission: record if checkout has a referrerId
              const referrerId = session.metadata?.referrerId;
              if (referrerId) {
                // P0: Prevent self-referral
                const tenantOwner = tenantDoc.data()?.ownerId || tenantDoc.data()?.createdBy;
                if (referrerId === tenantOwner) {
                  console.log('⚠️ Self-referral blocked for tenant', tenantId);
                } else {
                // P0: Dedup — check if commission already exists for this subscription's first payment
                const existingCommission = await adminDb.collection('affiliate_commissions')
                  .where('stripeSubscriptionId', '==', subscriptionId)
                  .where('type', '==', 'initial')
                  .limit(1)
                  .get();
                if (!existingCommission.empty) {
                  console.log('⚠️ Commission already exists for subscription', subscriptionId);
                } else {
                const commissionAmount = Math.round(
                  (session.amount_total || 0) * 0.10 // 10% commission
                );
                // Look up referrer's Stripe Connect account for payout
                let commissionStatus = 'pending';
                try {
                  const referrerDoc = await adminDb.collection('users').doc(referrerId).get();
                  const connectAccountId = referrerDoc.data()?.affiliateStripeAccountId;
                  const connectStatus = referrerDoc.data()?.affiliateConnectStatus;
                  if (connectAccountId && connectStatus === 'active' && commissionAmount > 0) {
                    await stripe.transfers.create({
                      amount: commissionAmount,
                      currency: 'usd',
                      destination: connectAccountId,
                      metadata: { referrerId, tenantId, plan, type: 'affiliate_commission' },
                    });
                    commissionStatus = 'paid';
                  }
                } catch (transferErr) {
                  console.error('Affiliate transfer failed (will remain pending):', transferErr);
                }
                await adminDb.collection('affiliate_commissions').add({
                  referrerId,
                  tenantId,
                  plan,
                  amount: session.amount_total || 0,
                  commission: commissionAmount,
                  status: commissionStatus,
                  type: 'initial',
                  stripeSubscriptionId: subscriptionId,
                  createdAt: new Date().toISOString(),
                });
                // Increment referrer's earnings and referral count
                await adminDb.collection('users').doc(referrerId).update({
                  affiliateEarnings: FieldValue.increment(commissionAmount),
                  affiliatePendingPayouts: commissionStatus === 'paid'
                    ? FieldValue.increment(0)
                    : FieldValue.increment(commissionAmount),
                  affiliateReferralCount: FieldValue.increment(1),
                  updatedAt: new Date().toISOString(),
                });
                console.log(`💰 Affiliate commission ${commissionStatus} for referrer ${referrerId}: $${(commissionAmount / 100).toFixed(2)}`);
                } // end dedup check
                } // end self-referral check
              }

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

          // Affiliate commission on RECURRING invoice payments only
          // Skip subscription_create (first invoice) — already handled in checkout.session.completed
          const subscriptionId = (invoice as any).subscription as string | null;
          const billingReason = (invoice as any).billing_reason;
          if (subscriptionId && billingReason !== 'subscription_create') {
            try {
              const subscription = await stripe.subscriptions.retrieve(subscriptionId);
              const referrerId = subscription.metadata?.referrerId;
              if (referrerId) {
                // P0: Dedup — check if commission already exists for this invoice
                const existingCommission = await adminDb.collection('affiliate_commissions')
                  .where('stripeInvoiceId', '==', invoice.id)
                  .limit(1)
                  .get();
                if (!existingCommission.empty) {
                  console.log('⚠️ Commission already exists for invoice', invoice.id);
                } else {
                const commissionAmount = Math.round((invoice.amount_paid || 0) * 0.10);
                let commissionStatus = 'pending';
                try {
                  const referrerDoc = await adminDb.collection('users').doc(referrerId).get();
                  const connectAccountId = referrerDoc.data()?.affiliateStripeAccountId;
                  const connectStatus = referrerDoc.data()?.affiliateConnectStatus;
                  if (connectAccountId && connectStatus === 'active' && commissionAmount > 0) {
                    await stripe.transfers.create({
                      amount: commissionAmount,
                      currency: 'usd',
                      destination: connectAccountId,
                      metadata: { referrerId, tenantId, plan: subscription.metadata?.plan || 'unknown', type: 'affiliate_commission_recurring' },
                    });
                    commissionStatus = 'paid';
                  }
                } catch (transferErr) {
                  console.error('Affiliate recurring transfer failed:', transferErr);
                }
                await adminDb.collection('affiliate_commissions').add({
                  referrerId,
                  tenantId,
                  plan: subscription.metadata?.plan || 'unknown',
                  amount: invoice.amount_paid || 0,
                  commission: commissionAmount,
                  status: commissionStatus,
                  type: 'recurring',
                  stripeSubscriptionId: subscriptionId,
                  stripeInvoiceId: invoice.id,
                  createdAt: new Date().toISOString(),
                });
                await adminDb.collection('users').doc(referrerId).update({
                  affiliateEarnings: FieldValue.increment(commissionAmount),
                  affiliatePendingPayouts: commissionStatus === 'paid'
                    ? FieldValue.increment(0)
                    : FieldValue.increment(commissionAmount),
                  updatedAt: new Date().toISOString(),
                });
                console.log(`💰 Recurring affiliate commission ${commissionStatus} for referrer ${referrerId}: $${(commissionAmount / 100).toFixed(2)}`);
                } // end dedup check
              }
            } catch (subErr) {
              console.error('Failed to check subscription for affiliate commission:', subErr);
            }
          }
        }
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        let tenantId = charge.metadata?.tenantId;
        // Fallback: look up tenant by customer ID
        if (!tenantId && charge.customer) {
          const tenantSnap = await adminDb.collection('tenants')
            .where('stripeCustomerId', '==', charge.customer as string)
            .limit(1).get();
          if (!tenantSnap.empty) tenantId = tenantSnap.docs[0].id;
        }
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
        let tenantId = dispute.metadata?.tenantId;
        // Fallback: look up tenant by customer ID (dispute has charge → customer)
        if (!tenantId && (dispute as any).charge) {
          try {
            const charge = await stripe.charges.retrieve((dispute as any).charge as string);
            if (charge.customer) {
              const tenantSnap = await adminDb.collection('tenants')
                .where('stripeCustomerId', '==', charge.customer as string)
                .limit(1).get();
              if (!tenantSnap.empty) tenantId = tenantSnap.docs[0].id;
            }
          } catch (e) { /* charge lookup failed */ }
        }
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
  return PLAN_PRICES[plan]?.monthly || PLAN_PRICES.plus.monthly;
}

function getYearlyPriceId(plan: string): string {
  return PLAN_PRICES[plan]?.yearly || PLAN_PRICES.plus.yearly;
}

// getPlanFromPriceId is now imported from stripe-config
