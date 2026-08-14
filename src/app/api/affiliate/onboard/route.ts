import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { randomBytes } from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';
import { resolveReturnBaseUrl } from '@/lib/connect-return-url';
import { captureHandledError, captureMoneyPathError } from '@/lib/money-path-sentry';
import { tenantPrivateRef, getTenantPrivate } from '@/lib/tenant-private';

export const dynamic = 'force-dynamic';

async function generateUniqueAffiliateCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomBytes(6).toString('base64url').slice(0, 8).toLowerCase();
    const existing = await adminDb.collection('users').where('affiliateCode', '==', code).limit(1).get();
    if (existing.empty) return code;
  }
  throw new Error('Failed to generate unique affiliate code after 10 attempts');
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

    // Send the affiliate back to the host they STARTED on (e.g.
    // affiliate.theharvest.app), not a hardcoded apex — otherwise a tenant-less
    // affiliate completes onboarding and lands on theharvest.app. Derived from
    // the request and allowlist-validated so a spoofed Host can't open-redirect.
    const baseUrl = resolveReturnBaseUrl(request);
    const userRef = adminDb.collection('users').doc(userOrErr.uid);
    const userDoc = await userRef.get();
    const userData = userDoc.data();

    // Backfill an affiliate code if missing — the referral link works without a
    // Connect account (Connect is only needed to RECEIVE payouts).
    if (!userData?.affiliateCode) {
      try {
        const code = await generateUniqueAffiliateCode();
        await userRef.set({
          affiliateCode: code,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      } catch (codeErr) {
        // Swallowed so onboarding still proceeds, but the affiliate leaves with no
        // referral code — their link silently does nothing. /api/affiliate/status
        // retries the backfill on the next dashboard load, hence warning.
        console.error('Failed to backfill affiliate code:', codeErr);
        captureHandledError(codeErr, {
          step: 'affiliate-code-backfill',
          level: 'warning',
          tenantId: userOrErr.tenantId,
          ids: { userId: userOrErr.uid },
        });
      }
    }

    // ── Unified-account backstop (server-authoritative) ──────────────────────
    // The ONE tenant Connect account (tenants/{id}.stripeConnectAccountId) powers
    // affiliate payouts too, so if the caller belongs to a tenant we must NEVER
    // mint a second, user-scoped Express account here. Reuse the tenant's account
    // (or create it AS the canonical account) and mirror it onto the user doc.
    // tenantId comes from requireAuth, which resolves it from the token claim OR
    // the authoritative user-doc read — so a flaky CLIENT-side tenant lookup can't
    // route us into a double-account. Onboarding returns through the shared connect
    // callback so status reconciliation (and the owner mirror) stays unified.
    const tenantId = userOrErr.tenantId;
    if (tenantId) {
      const tenantRef = adminDb.collection('tenants').doc(tenantId);
      const tenantSnap = await tenantRef.get();
      if (tenantSnap.exists) {
        const tData = tenantSnap.data()!;
        // The Connect account id lives on the server-only tenant_private doc;
        // its status stays on the public tenant doc.
        let accountId: string | undefined = (await getTenantPrivate(tenantId)).stripeConnectAccountId;
        let connectStatus: string | undefined = tData.stripeConnectStatus;
        if (!accountId) {
          // ─── 🔴 STANDARD, because this IS the donations account (THE-147) ───
          //
          // ⚠️ THIS CALL SITE IS NOT PAYOUT-ONLY, despite living in the affiliate
          // route. It writes `tenant_private.stripeConnectAccountId` below — the
          // canonical account `/api/stripe/donate` charges, and #316 made those
          // charges DIRECT, so Stripe debits a disputed gift from the CHURCH's
          // balance. Express + direct charges is the exact pairing THE-145 (#317)
          // exists to eliminate: an Express holder has no Stripe credentials and
          // only the Express Dashboard, so the money lands on the church while the
          // dispute and refund tools stay with Harvest. Standard is the church's
          // OWN Stripe account — its own login, its own disputes, its own records.
          //
          // 🔴 THE GAP THIS CLOSES. #317 switched `/api/stripe/connect` to
          // 'standard' and left this site on 'express', so a church owner who
          // clicked "become an affiliate" BEFORE "connect Stripe" still minted an
          // Express donations account and then took direct charges on it. That is
          // the new-customer path, and it reopened the whole defect.
          //
          // ⚠️ KEEP THIS IN LOCKSTEP WITH `/api/stripe/connect`. Two routes create
          // the tenant donations account and each holds its own account type; the
          // types diverging is precisely how THE-147 happened. They are pinned
          // together by `affiliate-onboard-standard-account.test.ts`
          // ("both creation paths agree"), which fails if either side moves alone.
          //
          // ⚠️ Existing accounts are untouched — `accountId` above short-circuits
          // this branch, and Stripe does not allow an account's type to change
          // after creation. This applies to accounts created from now on only.
          const account = await stripe.accounts.create({
            type: 'standard',
            metadata: { tenantId, tenantName: tData.name || '', app: 'harvest' },
          });
          accountId = account.id;
          connectStatus = 'pending';
          const connectNow = new Date().toISOString();
          const connectBatch = adminDb.batch();
          connectBatch.update(tenantRef, {
            stripeConnectStatus: 'pending',
            updatedAt: connectNow,
          });
          connectBatch.set(tenantPrivateRef(tenantId), { stripeConnectAccountId: accountId, updatedAt: connectNow }, { merge: true });
          await connectBatch.commit();
        }
        // Mirror onto the caller's user doc so their affiliate-payout path resolves
        // the SAME account (the payout path reads users/{uid}.affiliateStripeAccountId).
        // Guard: don't repoint/downgrade a DIFFERENT, already-active affiliate account
        // a legacy user still receives payouts on — leave their working payout be.
        const mirrorSafe = !(userData?.affiliateStripeAccountId
          && userData.affiliateStripeAccountId !== accountId
          && userData.affiliateConnectStatus === 'active');
        if (mirrorSafe) {
          await userRef.set({
            affiliateStripeAccountId: accountId,
            ...(connectStatus ? { affiliateConnectStatus: connectStatus } : {}),
            updatedAt: new Date().toISOString(),
          }, { merge: true });
        }
        const accountLink = await stripe.accountLinks.create({
          account: accountId,
          refresh_url: `${baseUrl}/?section=payment`,
          return_url: `${baseUrl}/api/stripe/connect/callback?account_id=${accountId}`,
          type: 'account_onboarding',
        });
        return NextResponse.json({ url: accountLink.url });
      }
      // tenantId set but the tenant doc is missing → fall through to the
      // user-scoped path (defensive; shouldn't happen for a real member).
    }

    // ── Tenant-less affiliate (e.g. platform super admin) ────────────────────
    // No tenant to unify with → keep a user-scoped Connect account. Already has one
    // → just refresh the onboarding link.
    if (userData?.affiliateStripeAccountId) {
      const accountLink = await stripe.accountLinks.create({
        account: userData.affiliateStripeAccountId,
        refresh_url: `${baseUrl}/?section=settings`,
        return_url: `${baseUrl}/api/affiliate/callback?account_id=${userData.affiliateStripeAccountId}`,
        type: 'account_onboarding',
      });
      return NextResponse.json({ url: accountLink.url });
    }

    // ─── 🔴 EXPRESS, AND IT STAYS EXPRESS (THE-147) ──────────────────────────
    //
    // ⚠️ DO NOT "FIX" THIS TO MATCH THE TENANT PATH ABOVE. They are not the same
    // thing and the difference is the whole ticket. This account belongs to a
    // caller with NO tenant: it is written only to
    // `users/{uid}.affiliateStripeAccountId`, never to
    // `tenant_private.stripeConnectAccountId`, so no church's donations resolve
    // to it and `/api/stripe/donate` can never charge it.
    //
    // It is a payout-only RECIPIENT. Money reaches it exactly one way — the
    // platform's `stripe.transfers.create({ destination })` in
    // `sweepPendingAffiliateCommissions` — so it needs the `transfers`
    // capability, not `card_payments`. It takes no charges at all, which means
    // none of the direct-charge reasoning above applies to it: there is no
    // merchant of record to be, no dispute to answer, no donor money held.
    // Standard would be the wrong shape (Stripe lists Standard's supported
    // charge type as direct-only) and a different authorization model, not a
    // one-word change.
    //
    // Pinned by `affiliate-onboard-standard-account.test.ts` test 2 — the
    // regression test. If that test fails, this line was changed by mistake.
    const account = await stripe.accounts.create({
      type: 'express',
      metadata: {
        userId: userOrErr.uid,
        email: userOrErr.email || '',
        role: 'affiliate',
        app: 'harvest',
      },
    });

    await userRef.set({
      affiliateStripeAccountId: account.id,
      affiliateEarnings: userData?.affiliateEarnings || 0,
      affiliatePendingPayouts: userData?.affiliatePendingPayouts || 0,
      affiliateReferralCount: userData?.affiliateReferralCount || 0,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${baseUrl}/?section=settings`,
      return_url: `${baseUrl}/api/affiliate/callback?account_id=${account.id}`,
      type: 'account_onboarding',
    });

    return NextResponse.json({ url: accountLink.url });
  } catch (error: any) {
    console.error('Affiliate onboard error:', error?.message || error);
    // Same failure mode #221 captured on /api/stripe/connect: a live Stripe
    // Express account can be created and then not persisted, leaving an orphaned
    // Connect account no tenant or user doc points at — the affiliate cannot be
    // paid and the account is invisible to the app.
    captureMoneyPathError(error, { step: 'affiliate-connect-onboarding', level: 'error' });
    return NextResponse.json(
      { error: 'Failed to create affiliate account' },
      { status: 500 }
    );
  }
}
