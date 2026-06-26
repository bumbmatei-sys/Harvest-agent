import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb, adminAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { generateAccessCode } from '@/lib/ai-utils';
import { PLAN_PRICES, getPlanFromPriceId } from '@/lib/stripe-config';
import { Resend } from 'resend';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeKey || !webhookSecret) {
    console.error('Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET');
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const stripe = new Stripe(stripeKey);

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
    const eventId = event.id;
    const eventRef = adminDb.collection('webhook_events').doc(eventId);
    const eventDoc = await eventRef.get();
    if (eventDoc.exists) {
      console.log(`⏭️ Skipping duplicate webhook event ${eventId}`);
      return NextResponse.json({ received: true, duplicate: true });
    }
    await eventRef.set({ type: event.type, processedAt: new Date().toISOString() });

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const subscriptionId = session.subscription as string | null;

        let meta: Record<string, string> = {};
        if (subscriptionId) {
          try {
            const sub = await stripe.subscriptions.retrieve(subscriptionId);
            meta = (sub.metadata || {}) as Record<string, string>;
          } catch (subErr) {
            console.error('Failed to retrieve subscription metadata:', subErr);
          }
        }

        const tenantId = meta.tenantId;
        const userId = meta.userId;

        // Handle AI Chat user subscription
        if (meta.addOn === 'ai-chat' && userId && subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          await adminDb.collection('users').doc(userId).update({
            aiChatSubscription: {
              status: 'active',
              stripeSubscriptionId: subscriptionId,
              stripeCustomerId: session.customer as string,
              currentPeriodEnd: sub.current_period_end
                ? new Date(sub.current_period_end * 1000).toISOString()
                : null,
              createdAt: new Date().toISOString(),
            },
            updatedAt: new Date().toISOString(),
          });
          console.log(`✅ User ${userId} subscribed to AI Chat`);
          break;
        }

        // Handle standalone AI Assistant purchase (from theharvest.site)
        if (meta.type === 'standalone_ai_assistant' && subscriptionId) {
          const standaloneEmail = meta.email;
          if (!standaloneEmail) {
            console.error('Standalone AI checkout: No email in metadata');
            break;
          }

          let standaloneUid: string;
          try {
            const existingUser = await adminAuth.getUserByEmail(standaloneEmail);
            standaloneUid = existingUser.uid;
          } catch {
            const newUser = await adminAuth.createUser({ email: standaloneEmail, emailVerified: true });
            standaloneUid = newUser.uid;
          }

          const platformTenantId = process.env.PLATFORM_TENANT_ID || 'platform';
          const userRef = adminDb.collection('users').doc(standaloneUid);
          const standaloneUserDoc = await userRef.get();
          if (!standaloneUserDoc.exists) {
            await userRef.set({
              email: standaloneEmail,
              hasAIAssistant: true,
              role: 'standalone_ai_user',
              tenantId: platformTenantId,
              aiAssistantConnected: false,
              telegramChatId: null,
              telegramUsername: null,
              aiAssistantSubscriptionItemId: subscriptionId,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          } else {
            await userRef.update({
              hasAIAssistant: true,
              aiAssistantSubscriptionItemId: subscriptionId,
              updatedAt: new Date().toISOString(),
            });
          }

          const customToken = await adminAuth.createCustomToken(standaloneUid);
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';
          const magicLink = `${baseUrl}/ai-assistant?token=${customToken}`;

          const resendKey = process.env.RESEND_API_KEY;
          if (resendKey) {
            const resend = new Resend(resendKey);
            await resend.emails.send({
              from: 'Harvest <noreply@theharvest.app>',
              to: standaloneEmail,
              subject: 'Welcome to your Harvest AI Assistant',
              html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2 style="color:#d4a017;font-size:24px;margin-bottom:8px">Welcome to Harvest AI Assistant</h2><p style="color:#555;margin-bottom:24px">Your subscription is confirmed! Click below to connect your personal AI assistant to Telegram.</p><a href="${magicLink}" style="display:inline-block;background:#d4a017;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Activate My AI Assistant</a><p style="color:#999;font-size:12px;margin-top:24px">This link expires in 1 hour. You can request a new one at <a href="${baseUrl}/ai-assistant" style="color:#d4a017">${baseUrl}/ai-assistant</a></p></div>`,
            });
          }

          console.log(`✅ Standalone AI Assistant activated for ${standaloneEmail}`);
          break;
        }

        if (tenantId && subscriptionId) {
          if (meta.addOn === 'ai-assistant') {
            const accessCode = generateAccessCode();
            await adminDb.collection('tenants').doc(tenantId).update({
              addOnAiAssistant: subscriptionId,
              addOnAiAssistantCode: accessCode,
              updatedAt: new Date().toISOString(),
            });
            // Update per-user hasAIAssistant flag
            if (userId) {
              await adminDb.collection('users').doc(userId).update({
                hasAIAssistant: true,
                aiAssistantSubscriptionItemId: subscriptionId,
                updatedAt: new Date().toISOString(),
              });
            }
            console.log(`✅ Tenant ${tenantId} added AI Assistant add-on (code: ${accessCode})`);
          } else {
            const plan = meta.plan;
            if (plan) {
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
                stripePriceId: meta.billing === 'yearly'
                  ? getYearlyPriceId(plan)
                  : getMonthlyPriceId(plan),
                updatedAt: new Date().toISOString(),
              };

              if (plan === 'ultra' && !tenantDoc.data()?.addOnAiAssistantCode) {
                updateData.addOnAiAssistantCode = generateAccessCode();
                // Grant hasAIAssistant to the first admin
                try {
                  const firstAdminEmail = tenantDoc.data()?.adminEmails?.[0];
                  if (firstAdminEmail) {
                    const firstAdminUser = await adminAuth.getUserByEmail(firstAdminEmail);
                    await adminDb.collection('users').doc(firstAdminUser.uid).update({
                      hasAIAssistant: true,
                      updatedAt: new Date().toISOString(),
                    });
                  }
                } catch (ultraErr) {
                  console.error('Failed to grant AI Assistant to ultra plan first admin:', ultraErr);
                }
              }

              await adminDb.collection('tenants').doc(tenantId).update(updateData);

              const referrerId = meta.referrerId;
              if (referrerId) {
                const tenantOwner = tenantDoc.data()?.ownerId || tenantDoc.data()?.createdBy;
                if (referrerId === tenantOwner) {
                  console.log('⚠️ Self-referral blocked for tenant', tenantId);
                } else {
                  const existingCommissionSnap = await adminDb.collection('affiliate_commissions')
                    .where('stripeSubscriptionId', '==', subscriptionId)
                    .limit(10)
                    .get();
                  const hasInitialCommission = existingCommissionSnap.docs.some(d => d.data().type === 'initial');
                  if (hasInitialCommission) {
                    console.log('⚠️ Commission already exists for subscription', subscriptionId);
                  } else {
                    const commissionAmount = Math.round((session.amount_total || 0) * 0.10);
                    let commissionStatus = 'pending';
                    try {
                      const referrerDoc = await adminDb.collection('users').doc(referrerId).get();
                      const connectAccountId = referrerDoc.data()?.affiliateStripeAccountId;
                      const connectStatus = referrerDoc.data()?.affiliateConnectStatus;
                      if (connectAccountId && connectStatus === 'active' && commissionAmount > 0) {
                        const transfer = await stripe.transfers.create({
                          amount: commissionAmount,
                          currency: 'usd',
                          destination: connectAccountId,
                          metadata: { referrerId, tenantId, plan, type: 'affiliate_commission' },
                        });
                        commissionStatus = 'paid';
                        await adminDb.collection('affiliate_commissions').add({
                          referrerId, tenantId, plan,
                          amount: session.amount_total || 0,
                          commission: commissionAmount,
                          status: commissionStatus,
                          type: 'initial',
                          stripeSubscriptionId: subscriptionId,
                          stripeTransferId: transfer.id,
                          createdAt: new Date().toISOString(),
                        });
                      } else {
                        await adminDb.collection('affiliate_commissions').add({
                          referrerId, tenantId, plan,
                          amount: session.amount_total || 0,
                          commission: commissionAmount,
                          status: 'pending',
                          type: 'initial',
                          stripeSubscriptionId: subscriptionId,
                          createdAt: new Date().toISOString(),
                        });
                      }
                    } catch (transferErr) {
                      console.error('Affiliate transfer failed (will remain pending):', transferErr);
                      await adminDb.collection('affiliate_commissions').add({
                        referrerId, tenantId, plan,
                        amount: session.amount_total || 0,
                        commission: commissionAmount,
                        status: 'pending',
                        type: 'initial',
                        stripeSubscriptionId: subscriptionId,
                        createdAt: new Date().toISOString(),
                      });
                    }
                    await adminDb.collection('users').doc(referrerId).update({
                      affiliateEarnings: FieldValue.increment(commissionAmount),
                      affiliatePendingPayouts: commissionStatus === 'paid'
                        ? FieldValue.increment(0)
                        : FieldValue.increment(commissionAmount),
                      affiliateReferralCount: FieldValue.increment(1),
                      updatedAt: new Date().toISOString(),
                    });
                    console.log(`💰 Affiliate commission ${commissionStatus} for referrer ${referrerId}: $${(commissionAmount / 100).toFixed(2)}`);
                  }
                }
              }

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
        const subUserId = subscription.metadata?.userId;

        if (subscription.metadata?.addOn === 'ai-chat' && subUserId) {
          const status = subscription.status === 'active' ? 'active' :
                         subscription.status === 'past_due' ? 'past_due' : 'cancelled';
          await adminDb.collection('users').doc(subUserId).update({
            'aiChatSubscription.status': status,
            'aiChatSubscription.currentPeriodEnd': subscription.current_period_end
              ? new Date(subscription.current_period_end * 1000).toISOString()
              : null,
            updatedAt: new Date().toISOString(),
          });
          console.log(`📝 AI Chat subscription updated for user ${subUserId}: ${status}`);
          break;
        }

        if (tenantId) {
          const updateData: Record<string, unknown> = {
            stripeSubscriptionId: subscription.id,
            updatedAt: new Date().toISOString(),
          };

          let plan = subscription.metadata?.plan || null;
          if (!plan && subscription.items?.data?.[0]?.price?.id) {
            plan = getPlanFromPriceId(subscription.items.data[0].price.id);
          }
          if (plan) updateData.plan = plan;

          if (subscription.status === 'active') updateData.status = 'active';
          else if (subscription.status === 'past_due') updateData.status = 'past_due';
          else if (subscription.status === 'canceled') updateData.status = 'cancelled';

          await adminDb.collection('tenants').doc(tenantId).update(updateData);

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
        const delUserId = subscription.metadata?.userId;
        const subType = subscription.metadata?.type;

        // Handle AI Chat subscription cancellation
        if (addOn === 'ai-chat' && delUserId) {
          await adminDb.collection('users').doc(delUserId).update({
            'aiChatSubscription.status': 'cancelled',
            updatedAt: new Date().toISOString(),
          });
          console.log(`❌ AI Chat subscription cancelled for user ${delUserId}`);
          break;
        }

        // Handle standalone AI Assistant cancellation
        if (subType === 'standalone_ai_assistant') {
          const standaloneEmail = subscription.metadata?.email;
          if (standaloneEmail) {
            try {
              const standaloneUser = await adminAuth.getUserByEmail(standaloneEmail);
              await adminDb.collection('users').doc(standaloneUser.uid).update({
                hasAIAssistant: false,
                aiAssistantConnected: false,
                telegramChatId: null,
                aiAssistantSubscriptionItemId: null,
                updatedAt: new Date().toISOString(),
              });
              console.log(`❌ Standalone AI Assistant cancelled for ${standaloneEmail}`);
            } catch (standaloneErr) {
              console.error('Failed to revoke standalone AI Assistant:', standaloneErr);
            }
          }
          break;
        }

        // Handle AI Assistant add-on cancellation
        if (addOn === 'ai-assistant') {
          if (delUserId) {
            await adminDb.collection('users').doc(delUserId).update({
              hasAIAssistant: false,
              aiAssistantConnected: false,
              telegramChatId: null,
              aiAssistantSubscriptionItemId: null,
              updatedAt: new Date().toISOString(),
            });
          } else {
            const affectedSnap = await adminDb.collection('users')
              .where('aiAssistantSubscriptionItemId', '==', subscription.id)
              .limit(10).get();
            if (!affectedSnap.empty) {
              const b = adminDb.batch();
              affectedSnap.docs.forEach(d => b.update(d.ref, {
                hasAIAssistant: false, aiAssistantConnected: false,
                telegramChatId: null, aiAssistantSubscriptionItemId: null,
                updatedAt: new Date().toISOString(),
              }));
              await b.commit();
            }
          }

          if (tenantId) {
            const bindingsSnap = await adminDb.collection('ai_assistant_bindings')
              .where('tenantId', '==', tenantId).get();
            if (!bindingsSnap.empty) {
              const b2 = adminDb.batch();
              bindingsSnap.docs.forEach(d => b2.delete(d.ref));
              await b2.commit();
            }
            await adminDb.collection('tenants').doc(tenantId).update({
              addOnAiAssistant: null,
              addOnAiAssistantCode: null,
              updatedAt: new Date().toISOString(),
            });
          }
          console.log(`❌ AI Assistant add-on cancelled (user: ${delUserId || 'unknown'}, tenant: ${tenantId || 'none'})`);
          break;
        }

        if (tenantId) {
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
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const invSubId = invoice.subscription as string | null;
        if (invSubId) {
          try {
            const sub = await stripe.subscriptions.retrieve(invSubId);
            const tenantId = sub.metadata?.tenantId;
            if (tenantId) {
              await adminDb.collection('tenants').doc(tenantId).update({
                status: 'suspended',
                updatedAt: new Date().toISOString(),
              });
              console.log(`⚠️ Payment failed for tenant ${tenantId}`);
            }
          } catch (subErr) {
            console.error('Failed to retrieve subscription for invoice.payment_failed:', subErr);
          }
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const invoiceSubId = invoice.subscription as string | null;
        let tenantId: string | null = null;
        if (invoiceSubId) {
          try {
            const sub = await stripe.subscriptions.retrieve(invoiceSubId);
            tenantId = sub.metadata?.tenantId || null;
          } catch (subErr) {
            console.error('Failed to retrieve subscription for invoice.payment_succeeded:', subErr);
          }
        }
        if (tenantId) {
          const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
          if (!!tenantDoc.exists && tenantDoc.data()?.status === 'suspended') {
            await adminDb.collection('tenants').doc(tenantId).update({
              status: 'active',
              updatedAt: new Date().toISOString(),
            });
            console.log(`✅ Tenant ${tenantId} reactivated after successful payment`);
          }

          const billingReason = (invoice as any).billing_reason;
          if (invoiceSubId && billingReason !== 'subscription_create') {
            try {
              const subscription = await stripe.subscriptions.retrieve(invoiceSubId);
              const referrerId = subscription.metadata?.referrerId;
              if (referrerId) {
                const existingCommission = await adminDb.collection('affiliate_commissions')
                  .where('stripeInvoiceId', '==', invoice.id)
                  .limit(1)
                  .get();
                if (!existingCommission.empty) {
                  console.log('⚠️ Commission already exists for invoice', invoice.id);
                } else {
                  const commissionAmount = Math.round((invoice.amount_paid || 0) * 0.10);
                  let commissionStatus = 'pending';
                  let stripeTransferId: string | undefined;
                  try {
                    const referrerDoc = await adminDb.collection('users').doc(referrerId).get();
                    const connectAccountId = referrerDoc.data()?.affiliateStripeAccountId;
                    const connectStatus = referrerDoc.data()?.affiliateConnectStatus;
                    if (connectAccountId && connectStatus === 'active' && commissionAmount > 0) {
                      const transfer = await stripe.transfers.create({
                        amount: commissionAmount,
                        currency: 'usd',
                        destination: connectAccountId,
                        metadata: { referrerId, tenantId, plan: subscription.metadata?.plan || 'unknown', type: 'affiliate_commission_recurring' },
                      });
                      commissionStatus = 'paid';
                      stripeTransferId = transfer.id;
                    }
                  } catch (transferErr) {
                    console.error('Affiliate recurring transfer failed:', transferErr);
                  }
                  await adminDb.collection('affiliate_commissions').add({
                    referrerId, tenantId,
                    plan: subscription.metadata?.plan || 'unknown',
                    amount: invoice.amount_paid || 0,
                    commission: commissionAmount,
                    status: commissionStatus,
                    type: 'recurring',
                    stripeSubscriptionId: invoiceSubId,
                    stripeInvoiceId: invoice.id,
                    ...(stripeTransferId ? { stripeTransferId } : {}),
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
                }
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

      case 'transfer.failed': {
        const transfer = event.data.object as Stripe.Transfer;
        const referrerId = transfer.metadata?.referrerId;
        if (referrerId) {
          try {
            const commissionsSnap = await adminDb.collection('affiliate_commissions')
              .where('stripeTransferId', '==', transfer.id)
              .limit(1).get();
            if (!commissionsSnap.empty) {
              await commissionsSnap.docs[0].ref.update({ status: 'failed' });
            }
            const commissionAmount = transfer.amount || 0;
            await adminDb.collection('users').doc(referrerId).update({
              affiliatePendingPayouts: FieldValue.increment(-commissionAmount),
              updatedAt: new Date().toISOString(),
            });
            console.log(`❌ Transfer failed for referrer ${referrerId}: $${(commissionAmount / 100).toFixed(2)}`);
          } catch (err) {
            console.error('Error handling transfer.failed:', err);
          }
        }
        break;
      }

      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const meta = pi.metadata || {};

        if (meta.type === 'partnership' && meta.tenantId) {
          const donorEmail = pi.receipt_email || '';
          const amount = pi.amount_received || pi.amount || 0;
          const tenantId = meta.tenantId;

          if (donorEmail) {
            const existingContactSnap = await adminDb.collection('contacts')
              .where('email', '==', donorEmail)
              .limit(20).get();
            const existingContactDoc = existingContactSnap.docs.find(d => d.data().tenantId === tenantId);

            let contactId: string;
            if (existingContactDoc) {
              contactId = existingContactDoc.id;
              const contactData = existingContactDoc.data();
              const newType = contactData.type === 'member' ? 'both' : (contactData.type as string);
              await existingContactDoc.ref.update({
                type: newType,
                totalDonated: FieldValue.increment(amount),
                lastDonationAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });
            } else {
              const ref = await adminDb.collection('contacts').add({
                firstName: '', lastName: '', email: donorEmail, phone: '',
                type: 'donor', userId: '', tenantId,
                totalDonated: amount, lastDonationAt: new Date().toISOString(),
                memberSince: null, notes: '', tags: [],
                createdAt: new Date().toISOString(), createdBy: 'system',
              });
              contactId = ref.id;
            }

            await adminDb.collection('contactActivities').add({
              contactId, type: 'donation',
              description: 'Partnership donation via Stripe',
              amount, createdAt: new Date().toISOString(), createdBy: 'system',
            });

            const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
            const tenantName = tenantDoc.data()?.name || tenantDoc.data()?.displayName || '';
            const contactDoc = await adminDb.collection('contacts').doc(contactId).get();
            const cData = contactDoc.data() || {};
            const recipientName = `${cData.firstName || ''} ${cData.lastName || ''}`.trim() || donorEmail;

            const receiptNumber = `R-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
            await adminDb.collection('tenants').doc(tenantId).collection('invoices').add({
              type: 'donation_receipt', recipientName, recipientEmail: donorEmail,
              amount, currency: pi.currency || 'usd', description: 'Partnership donation',
              relatedId: pi.id, receiptNumber, issuedAt: new Date().toISOString(),
              tenantName, pdfUrl: null, status: 'pending',
            });
          }
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error('Webhook handler error:', error?.message || error);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}

function getMonthlyPriceId(plan: string): string {
  return PLAN_PRICES[plan]?.monthly || '';
}
function getYearlyPriceId(plan: string): string {
  return PLAN_PRICES[plan]?.yearly || '';
}
