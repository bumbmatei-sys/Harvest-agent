import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getTenantPrivate } from '@/lib/tenant-private';
import { adminDb } from '@/lib/firebase-admin';
import { dodoBillingProvider, getDodoCheckoutPaymentStatus } from '@/lib/dodo/dodo-provider';

export const dynamic = 'force-dynamic';

/** A return URL is a navigation hint. Only Dodo and the signed webhook establish success. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (user instanceof Response) return user;
    const member = await adminDb.collection('users').doc(user.uid).get();
    const tenantId = member.data()?.tenantId;
    let subscriptionId = request.nextUrl.searchParams.get('subscription_id');
    if (!subscriptionId && typeof tenantId === 'string' && tenantId) {
      const privateData = await getTenantPrivate(tenantId);
      if (typeof privateData.dodoSubscriptionId === 'string') subscriptionId = privateData.dodoSubscriptionId;
    }
    let status: string | null = null;
    if (subscriptionId) {
      const subscription = await dodoBillingProvider.getSubscription(subscriptionId);
      if (subscription.metadata.userId !== user.uid) {
        return NextResponse.json({ error: 'Checkout does not belong to you.' }, { status: 403 });
      }
      status = subscription.status;
    }
    if (status === 'pending' || status === null) {
      const checkout = await adminDb.collection('signup_checkouts').doc(user.uid).get();
      if (checkout.exists) {
        const paymentStatus = await getDodoCheckoutPaymentStatus(checkout.data()!.reference);
        if (paymentStatus === 'failed' || status === null) status = paymentStatus;
      }
    }
    const failed = status && ['failed', 'declined', 'cancelled', 'canceled', 'expired', 'grace', 'on_hold', 'paused'].includes(status);
    if (failed) return NextResponse.json({ status: 'failed' });
    // Access waits for the webhook's OWN membership write, even if Dodo already says active.
    if (status === 'active' && typeof tenantId === 'string' && tenantId) {
      const tenant = await adminDb.collection('tenants').doc(tenantId).get();
      if (tenant.exists) return NextResponse.json({ status: 'ready', tenantId });
    }
    // A cancellation hint can only lead to a negative screen, never grant access.
    return NextResponse.json({ status: request.nextUrl.searchParams.get('cancelled') === 'true' && status !== 'active' && status !== 'succeeded' ? 'cancelled' : 'pending' });
  } catch {
    return NextResponse.json({ error: 'Could not check your payment. Please retry or contact support.' }, { status: 503 });
  }
}
