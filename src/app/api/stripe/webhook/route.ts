import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb, adminAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { generateAccessCode } from '@/lib/ai-utils';
import { PLAN_PRICES, getPlanFromPriceId } from '@/lib/stripe-config';
import { setCustomClaims } from '@/lib/set-custom-claims';
import { Resend } from 'resend';

export const dynamic = 'force-dynamic';

/** Returns the affiliate commission rate for a given plan. */
function getAffiliateRate(plan: string): number {
  switch (plan) {
    case 'ultra': return 0.20;
    case 'max':   return 0.15;
    case 'pro':   return 0.10;
    case 'plus':  return 0.10;
    default:      return 0.10;
  }
}

/**
 * Pay-out the one-time ("initial") affiliate commission for a paid signup/upgrade.
 * Shared by the existing-tenant plan-change path and the build-on-payment new-tenant
 * path. Guards against self-referral and double-paying the same subscription.
 */
async function processInitialAffiliateCommission(opts: {
  stripe: Stripe;
  referrerId: string;
  ownerId: string | null | undefined;
  tenantId: string;
  plan: string;
  amountTotal: number;
  subscriptionId: string;
}): Promise<void> {
  const { stripe, referrerId, ownerId, tenantId, plan, amountTotal, subscriptionId } = opts;

  if (ownerId && referrerId === ownerId) {
    console.log('⚠️ Self-referral blocked for tenant', tenantId);
    return;
  }

  const existingCommissionSnap = await adminDb.collection('affiliate_commissions')
    .where('stripeSubscriptionId', '==', subscriptionId)
    .limit(10)
    .get();
  const hasInitialCommission = existingCommissionSnap.docs.some(d => d.data().type === 'initial');
  if (hasInitialCommission) {
    console.log('⚠️ Commission already exists for subscription', subscriptionId);
    return;
  }

  const commissionAmount = Math.round((amountTotal || 0) * getAffiliateRate(plan));
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
      }, {
        // Idempotency across webhook retries. The initial commission is paid once
        // per subscription, but the transfer moves money BEFORE its dedup record is
        // written — so if the transfer succeeds and the commission-doc write then
        // fails, the retry (now enabled by the marker-undo on failure) re-enters
        // here and the affiliate_commissions guard, seeing no record, would pay
        // again. This key makes Stripe return the original transfer instead of
        // issuing a second one, so the affiliate is paid exactly once.
        idempotencyKey: `aff_initial_${subscriptionId}`,
      });
      commissionStatus = 'paid';
      await adminDb.collection('affiliate_commissions').add({
        referrerId, tenantId, plan,
        amount: amountTotal || 0,
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
        amount: amountTotal || 0,
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
      amount: amountTotal || 0,
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

/**
 * The Ministry (ultra) plan includes ONE AI Assistant for the plan owner. It is
 * not a separate subscription — the entitlement rides with the plan
 * (`aiAssistantSource: 'plan'`, no `aiAssistantSubscriptionItemId`).
 *
 * If the owner had separately PURCHASED the add-on before upgrading, their
 * purchased subscription is cancelled here so they aren't double-charged, and
 * the entitlement is converted to plan-included. The doc is marked
 * `aiAssistantSource: 'plan'` BEFORE the cancel so the resulting
 * customer.subscription.deleted event sees a plan-included entitlement and
 * doesn't revoke it; the subscription pointer is cleared only after the cancel
 * succeeds so a failed cancel is retried on webhook redelivery.
 * Never touches an existing Telegram link (aiAssistantConnected/telegramChatId).
 */
async function grantPlanIncludedAssistant(stripe: Stripe, ownerId: string | null | undefined): Promise<void> {
  if (!ownerId) return;
  const ownerRef = adminDb.collection('users').doc(ownerId);
  const ownerSnap = await ownerRef.get();
  const owner = ownerSnap.exists ? ownerSnap.data() : undefined;
  const purchasedSubId = owner?.aiAssistantSubscriptionItemId;

  if (owner?.hasAIAssistant && owner?.aiAssistantSource === 'plan' && !purchasedSubId) {
    return; // already plan-included (webhook redelivery / repeated plan sync)
  }

  await ownerRef.set({
    hasAIAssistant: true,
    aiAssistantSource: 'plan',
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  if (purchasedSubId) {
    try {
      await stripe.subscriptions.cancel(purchasedSubId);
      console.log(`🔄 Cancelled owner ${ownerId}'s purchased AI Assistant subscription ${purchasedSubId} (now included with ultra plan)`);
    } catch (cancelErr: any) {
      // Already cancelled / gone → fine, just clear the pointer below. Anything
      // else (network, 5xx) must bubble so Stripe redelivers and we retry.
      if (cancelErr?.type !== 'StripeInvalidRequestError' && cancelErr?.code !== 'resource_missing') {
        throw cancelErr;
      }
      console.log(`↩︎ Purchased AI Assistant subscription ${purchasedSubId} already cancelled`);
    }
    await ownerRef.set({
      aiAssistantSubscriptionItemId: null,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  }
  console.log(`✅ Plan-included AI Assistant granted to ultra owner ${ownerId}`);
}

/**
 * Revoke a PLAN-INCLUDED assistant when the tenant's plan leaves ultra
 * (downgrade or plan-subscription cancellation). A separately purchased
 * assistant (`aiAssistantSubscriptionItemId` set) has its own subscription and
 * is left untouched. Legacy ultra grants that predate `aiAssistantSource`
 * (hasAIAssistant with no subscription id) are treated as plan-included.
 */
async function revokePlanIncludedAssistant(ownerId: string | null | undefined): Promise<void> {
  if (!ownerId) return;
  const ownerRef = adminDb.collection('users').doc(ownerId);
  const ownerSnap = await ownerRef.get();
  if (!ownerSnap.exists) return;
  const owner = ownerSnap.data();
  if (!owner?.hasAIAssistant) return;
  const planIncluded = owner.aiAssistantSource === 'plan'
    || (!owner.aiAssistantSource && !owner.aiAssistantSubscriptionItemId);
  if (!planIncluded) return;
  await ownerRef.update({
    hasAIAssistant: false,
    aiAssistantConnected: false,
    telegramUsername: null,
    telegramChatId: null,
    aiAssistantSource: null,
    updatedAt: new Date().toISOString(),
  });
  console.log(`❌ Plan-included AI Assistant revoked for owner ${ownerId} (plan left ultra)`);
}

/**
 * Build-on-payment: turn a ministry name into a unique, free tenant subdomain.
 * Lowercases, keeps [a-z0-9-], collapses whitespace to '-', then appends a short
 * random suffix until no tenant doc exists at that id (and avoids reserved labels).
 */
async function generateUniqueSubdomain(ministryName: string): Promise<string> {
  const RESERVED = new Set(['www', 'app', 'admin', 'api', 'harvest', 'nations', 'platform']);
  const base = (ministryName || 'ministry')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'ministry';

  let candidate = base;
  for (let i = 0; i < 10; i++) {
    const exists = (await adminDb.collection('tenants').doc(candidate).get()).exists;
    if (!RESERVED.has(candidate) && !exists) return candidate;
    const suffix = Math.random().toString(36).slice(2, 6); // 4 random alphanumerics
    candidate = `${base}-${suffix}`.slice(0, 40);
  }
  return candidate;
}

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

  // Idempotency marker + whether THIS invocation wrote it. On failure we undo only
  // a marker of our own — never one left by an earlier successful run (e.g. Stripe
  // redelivers a completed event and the dedup read fails transiently: deleting that
  // marker would let the retry double-process a money event).
  const eventRef = adminDb.collection('webhook_events').doc(event.id);
  let markerWritten = false;

  try {
    const eventDoc = await eventRef.get();
    if (eventDoc.exists) {
      console.log(`⏭️ Skipping duplicate webhook event ${event.id}`);
      return NextResponse.json({ received: true, duplicate: true });
    }
    markerWritten = true; // flipped before the write so an ambiguous set() failure still gets undone
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
            // Without metadata we can't tell a new-ministry signup from an upgrade,
            // and would silently strand a paying customer (no tenant created). Undo
            // the idempotency marker and 5xx so Stripe redelivers this event.
            await eventRef.delete().catch(() => { /* best effort */ });
            return NextResponse.json({ error: 'Could not load subscription metadata; will retry' }, { status: 503 });
          }
        }

        const tenantId = meta.tenantId;
        const userId = meta.userId;

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

        // ── Build-on-payment: CREATE the tenant for a brand-new ministry. ─────
        // Clients can no longer create tenants (firestore.rules); the paying
        // signup arrives here with `newTenant: 'true'` and no tenantId, so the
        // Admin SDK builds the account, makes the payer its admin, and mints
        // their claim. Plan changes on an existing tenant carry `tenantId` and
        // fall through to the block below — unchanged.
        if (meta.newTenant === 'true' && !tenantId && subscriptionId && meta.userId && meta.plan) {
          // Idempotency / safety: if this user already has a tenant (a prior
          // checkout already built one, or they belong to an org), don't build a
          // second one and overwrite their account. The webhook_events dedup
          // covers redelivery of the SAME event; this covers a distinct second
          // paid session for the same user.
          const existingUserSnap = await adminDb.collection('users').doc(meta.userId).get();
          if (existingUserSnap.exists && existingUserSnap.data()?.tenantId) {
            console.log(`⏭️ User ${meta.userId} already has tenant ${existingUserSnap.data()?.tenantId}; skipping new-tenant build`);
            break;
          }

          const newTenantId = await generateUniqueSubdomain(meta.ministryName || '');

          // Paying user's email — from Firebase Auth, falling back to the customer.
          let userEmail = '';
          try {
            const u = await adminAuth.getUser(meta.userId);
            userEmail = u.email || '';
          } catch (userErr) {
            console.error('new-tenant: failed to load paying user:', userErr);
          }
          if (!userEmail && session.customer) {
            try {
              const cust = await stripe.customers.retrieve(session.customer as string);
              if (cust && !(cust as any).deleted) userEmail = (cust as Stripe.Customer).email || '';
            } catch { /* best effort */ }
          }

          const now = new Date().toISOString();
          await adminDb.collection('tenants').doc(newTenantId).set({
            name: meta.ministryName || 'My Ministry',
            subdomain: newTenantId,
            plan: meta.plan,
            status: 'active',
            config: {},
            adminEmails: userEmail ? [userEmail] : [],
            ownerId: meta.userId,
            createdBy: meta.userId,
            stripeCustomerId: session.customer as string,
            stripeSubscriptionId: subscriptionId,
            stripePriceId: meta.billing === 'yearly'
              ? getYearlyPriceId(meta.plan)
              : getMonthlyPriceId(meta.plan),
            setupCompleted: false, // gates the first-run "Finish setup" screen
            createdAt: now,
            updatedAt: now,
          });

          // Tag the subscription with the new tenant id so later lifecycle
          // events (subscription.updated/deleted, invoice.*) resolve to it — the
          // subscription was created before the tenant existed, so it had none.
          try {
            await stripe.subscriptions.update(subscriptionId, { metadata: { tenantId: newTenantId } });
          } catch (metaErr) {
            console.error('new-tenant: failed to tag subscription with tenantId:', metaErr);
          }

          // Assign the paying user as admin and mint their claim.
          await adminDb.collection('users').doc(meta.userId).update({
            tenantId: newTenantId,
            role: 'admin',
            plan: meta.plan,
            onboardingCompleted: true,
            signupInProgress: false,
            updatedAt: now,
          });
          await setCustomClaims(meta.userId);

          // Ministry plan includes one AI Assistant for the plan owner.
          if (meta.plan === 'ultra') {
            await grantPlanIncludedAssistant(stripe, meta.userId);
          }

          // Affiliate commission for this paid signup (owner = the paying user).
          if (meta.referrerId) {
            await processInitialAffiliateCommission({
              stripe,
              referrerId: meta.referrerId,
              ownerId: meta.userId,
              tenantId: newTenantId,
              plan: meta.plan,
              amountTotal: session.amount_total || 0,
              subscriptionId,
            });
          }

          console.log(`✅ Created tenant ${newTenantId} for new ministry "${meta.ministryName}" (admin ${meta.userId})`);
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
            // Update per-user hasAIAssistant flag. The add-on bills the buyer's
            // OWN Stripe customer (not the tenant's) — store it so the buyer's
            // billing portal (/api/ai-assistant/portal) can open it later.
            if (userId) {
              await adminDb.collection('users').doc(userId).update({
                hasAIAssistant: true,
                aiAssistantSubscriptionItemId: subscriptionId,
                ...(session.customer ? { aiAssistantCustomerId: session.customer as string } : {}),
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
              }

              await adminDb.collection('tenants').doc(tenantId).update(updateData);

              const referrerId = meta.referrerId;
              if (referrerId) {
                const tenantOwner = tenantDoc.data()?.ownerId || tenantDoc.data()?.createdBy;
                await processInitialAffiliateCommission({
                  stripe,
                  referrerId,
                  ownerId: tenantOwner,
                  tenantId,
                  plan,
                  amountTotal: session.amount_total || 0,
                  subscriptionId,
                });
              }

              const usersSnap = await adminDb.collection('users')
                .where('tenantId', '==', tenantId)
                .get();
              const batch = adminDb.batch();
              usersSnap.docs.forEach(doc => {
                batch.update(doc.ref, { plan });
              });
              await batch.commit();

              // Ministry plan includes one AI Assistant for the plan owner:
              // grant it on arrival at ultra, revoke a plan-included one when
              // the plan moves anywhere else (a purchased one survives).
              const planOwnerId = tenantDoc.data()?.ownerId || tenantDoc.data()?.createdBy;
              if (plan === 'ultra') {
                await grantPlanIncludedAssistant(stripe, planOwnerId);
              } else {
                await revokePlanIncludedAssistant(planOwnerId);
              }

              console.log(`✅ Tenant ${tenantId} upgraded to ${plan}`);
            }
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const tenantId = subscription.metadata?.tenantId;

        // The per-admin AI Assistant add-on carries tenantId metadata too, but it
        // must never drive tenant plan/status. Updates (e.g. cancel_at_period_end
        // set in the buyer's portal) need no state change — entitlement is revoked
        // by customer.subscription.deleted when the cancellation takes effect.
        if (subscription.metadata?.addOn === 'ai-assistant') {
          console.log(`📝 AI Assistant add-on subscription ${subscription.id} updated (status: ${subscription.status}) — no tenant change`);
          break;
        }

        if (tenantId) {
          // Ignore updates for a stale subscription (e.g. the old plan being cancelled
          // during an upgrade) — only the tenant's current subscription drives state.
          const updTenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
          const updCurrentSubId = updTenantSnap.data()?.stripeSubscriptionId;
          if (updCurrentSubId && updCurrentSubId !== subscription.id) {
            console.log(`↩︎ Ignoring stale subscription update ${subscription.id} for tenant ${tenantId} (current ${updCurrentSubId})`);
            break;
          }
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

            // Keep the owner's plan-included AI Assistant in sync with the plan.
            const updOwnerId = updTenantSnap.data()?.ownerId || updTenantSnap.data()?.createdBy;
            if (plan === 'ultra') {
              await grantPlanIncludedAssistant(stripe, updOwnerId);
            } else {
              await revokePlanIncludedAssistant(updOwnerId);
            }
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

        // Handle AI Assistant add-on cancellation (fired when the buyer cancels
        // in their Stripe portal, or when we cancel a purchased sub on upgrade
        // to ultra). This must never fall through to the tenant-downgrade logic
        // below — that path is only for the plan subscription.
        if (addOn === 'ai-assistant') {
          const revokeFields = {
            hasAIAssistant: false,
            aiAssistantConnected: false,
            telegramUsername: null,
            telegramChatId: null,
            aiAssistantSubscriptionItemId: null,
            updatedAt: new Date().toISOString(),
          };
          if (delUserId) {
            const buyerRef = adminDb.collection('users').doc(delUserId);
            const buyerSnap = await buyerRef.get();
            const buyer = buyerSnap.exists ? buyerSnap.data() : undefined;
            // Skip if the entitlement no longer rides on this subscription: it
            // became plan-included (owner upgraded to ultra — the purchased sub
            // was cancelled deliberately), or the user re-purchased under a
            // newer subscription id.
            const planIncluded = buyer?.aiAssistantSource === 'plan';
            const stale = buyer?.aiAssistantSubscriptionItemId
              && buyer.aiAssistantSubscriptionItemId !== subscription.id;
            if (planIncluded || stale) {
              console.log(`↩︎ Skipping AI Assistant revocation for ${delUserId}: entitlement is ${planIncluded ? 'plan-included' : 'on a newer subscription'}`);
              break;
            }
            await buyerRef.update(revokeFields);
          } else {
            const affectedSnap = await adminDb.collection('users')
              .where('aiAssistantSubscriptionItemId', '==', subscription.id)
              .limit(10).get();
            if (!affectedSnap.empty) {
              const b = adminDb.batch();
              affectedSnap.docs.forEach(d => b.update(d.ref, revokeFields));
              await b.commit();
            }
          }

          // Legacy access-code flow: clear the tenant-level add-on state only if
          // it belongs to THIS subscription — another admin's add-on (or an
          // ultra plan's included code) must survive one buyer's cancellation.
          if (tenantId) {
            const addOnTenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
            if (addOnTenantSnap.exists && addOnTenantSnap.data()?.addOnAiAssistant === subscription.id) {
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
          }
          console.log(`❌ AI Assistant add-on cancelled (user: ${delUserId || 'unknown'}, tenant: ${tenantId || 'none'})`);
          break;
        }

        if (tenantId) {
          // Only the tenant's CURRENT subscription ending should downgrade them.
          // During an upgrade we deliberately cancel the OLD subscription after moving
          // the tenant to the new one — that stale cancellation must NOT reset the plan.
          const delTenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
          const delCurrentSubId = delTenantSnap.data()?.stripeSubscriptionId;
          if (delCurrentSubId && delCurrentSubId !== subscription.id) {
            console.log(`↩︎ Ignoring stale subscription deletion ${subscription.id} for tenant ${tenantId} (current ${delCurrentSubId})`);
            break;
          }
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

          // Cancelling the plan cancels the plan-included assistant with it
          // (a separately purchased one keeps its own subscription).
          await revokePlanIncludedAssistant(
            delTenantSnap.data()?.ownerId || delTenantSnap.data()?.createdBy,
          );

          console.log(`❌ Tenant ${tenantId} subscription cancelled, downgraded to plus`);

          // Mark any pending affiliate commissions for this subscription as inactive
          try {
            const referrerId = subscription.metadata?.referrerId;
            if (referrerId) {
              await adminDb.collection('users').doc(referrerId).update({
                // Decrement active referral count if it's tracked separately in future
                // For now, add a cancellation record for the dashboard
                updatedAt: new Date().toISOString(),
              });
              await adminDb.collection('affiliate_commissions').add({
                referrerId,
                tenantId,
                plan: subscription.metadata?.plan || 'unknown',
                amount: 0,
                commission: 0,
                status: 'cancelled',
                type: 'cancellation',
                stripeSubscriptionId: subscription.id,
                createdAt: new Date().toISOString(),
              });
              console.log(`📭 Affiliate commission stream ended for referrer ${referrerId} (tenant ${tenantId} cancelled)`);
            }
          } catch (cancelCommissionErr) {
            console.error('Failed to record commission cancellation:', cancelCommissionErr);
          }
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
                  const subscriptionPlan = subscription.metadata?.plan || 'plus';
                  const commissionAmount = Math.round((invoice.amount_paid || 0) * getAffiliateRate(subscriptionPlan));
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
    if (markerWritten) {
      // Undo the idempotency marker so Stripe's retry re-processes this event.
      // Without this, a mid-processing failure leaves the event marked "done" and
      // the redelivery is skipped as a duplicate — silently losing the event.
      await eventRef.delete().catch(() => { /* best effort */ });
    }
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}

function getMonthlyPriceId(plan: string): string {
  return PLAN_PRICES[plan]?.monthly || '';
}
function getYearlyPriceId(plan: string): string {
  return PLAN_PRICES[plan]?.yearly || '';
}
