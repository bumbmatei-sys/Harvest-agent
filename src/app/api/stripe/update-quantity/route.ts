import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { getTenantPrivate } from '@/lib/tenant-private';
import { billingActionUnavailable, blocksStripeAction, resolveBillingOwnership } from '@/lib/billing-processor';
import { requireTenantAdmin } from '@/lib/api-auth';
import { captureMoneyPathError } from '@/lib/money-path-sentry';

export const dynamic = 'force-dynamic';

const ENTERPRISE_PRICE_PER_CHURCH = 1000; // $10 in cents

export async function POST(request: NextRequest) {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }
    const stripe = new Stripe(stripeKey);

    const body = await request.json();
    const { tenantId, action } = body;

    if (!tenantId) {
      return NextResponse.json({ error: 'Missing required field: tenantId' }, { status: 400 });
    }

    // 🔴 ADMIN-ONLY, from THE-80. This was `requireAuth` plus a tenant-match, so
    // any member of the congregation could change the church's billed seat count.
    //
    // Admin rather than owner, deliberately: seat quantity is not a discretionary
    // purchase, it is the true-up that FOLLOWS creating or deleting a church —
    // an action a tenant admin is already authorised to take. Gating the true-up
    // above the action it accompanies does not remove the admin's ability to
    // commit the money; it only stops the subscription from being corrected
    // afterwards, leaving churches billed at the wrong count. See the PR body:
    // the plan/cancel paths that ARE discretionary use `requireOwner`.
    //
    // `requireTenantAdmin` (not `requireAdmin`) because it is scoped to THIS
    // tenant and consults `tenant_private.adminEmails`, so an admin who holds
    // their entitlement only through the roster is not locked out.
    const userOrErr = await requireTenantAdmin(request, tenantId);
    if (userOrErr instanceof Response) return userOrErr;

    // Look up tenant
    const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
    if (!tenantDoc.exists) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }
    const tenantData = tenantDoc.data()!;

    // Seat quantity is priced per church, so this writes money. Dodo's equivalent
    // rides on `changePlan`'s `quantity`, which is the same unbuilt plan-change
    // path refused in /api/stripe/checkout — refuse here for the same reason
    // rather than adjusting a Stripe subscription this tenant does not own.
    const privateData = await getTenantPrivate(tenantId);
    const ownership = resolveBillingOwnership(privateData);
    if (blocksStripeAction(ownership)) {
      return billingActionUnavailable('updating your billed church count', ownership);
    }

    const subscriptionId = privateData.stripeSubscriptionId;
    const plan = tenantData.plan;

    if (!subscriptionId) {
      return NextResponse.json({ error: 'No active subscription found for this tenant' }, { status: 400 });
    }

    // Count churches for this tenant
    const churchesSnap = await adminDb.collection('churches')
      .where('tenantId', '==', tenantId)
      .get();
    const churchCount = churchesSnap.size;

    if (plan !== 'ultra') {
      return NextResponse.json({ 
        success: true, 
        churchCount, 
        newAmount: null,
        message: 'Not a Ministry plan — quantity update not applicable' 
      });
    }

    // Get subscription to find the subscription item
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const subscriptionItem = subscription.items.data[0];

    if (!subscriptionItem) {
      return NextResponse.json({ error: 'No subscription item found' }, { status: 400 });
    }

    // Update quantity to match church count (minimum 1)
    const newQuantity = Math.max(churchCount, 1);
    await stripe.subscriptionItems.update(subscriptionItem.id, {
      quantity: newQuantity,
    });

    const newAmount = newQuantity * ENTERPRISE_PRICE_PER_CHURCH;

    return NextResponse.json({ success: true, churchCount, newAmount });
  } catch (error: any) {
    console.error('Update quantity error:', error?.message || error);
    // The enterprise subscription quantity is what the tenant is billed on. If it
    // is not brought in line with the church count, they are charged for the
    // wrong number of churches until someone notices on an invoice.
    captureMoneyPathError(error, { step: 'enterprise-quantity-update', level: 'error' });
    return NextResponse.json({ error: 'Failed to update subscription quantity' }, { status: 500 });
  }
}
