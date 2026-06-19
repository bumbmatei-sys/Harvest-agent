import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';

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
    const { tenantId, type } = body;

    // Verify tenant membership
    if (!userOrErr.isSuperAdmin && userOrErr.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Access denied to this tenant' }, { status: 403 });
    }

    if (!tenantId) {
      return NextResponse.json({ error: 'Missing required field: tenantId' }, { status: 400 });
    }

    const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
    if (!tenantDoc.exists) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }
    const tenantData = tenantDoc.data()!;

    // Check if already connected
    if (tenantData.stripeConnectAccountId) {
      // Create a new account link for existing account
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';
      const accountLink = await stripe.accountLinks.create({
        account: tenantData.stripeConnectAccountId,
        refresh_url: `${baseUrl}/?section=payment`,
        return_url: `${baseUrl}/api/stripe/connect/callback?account_id=${tenantData.stripeConnectAccountId}`,
        type: 'account_onboarding',
      });
      return NextResponse.json({ url: accountLink.url });
    }

    // Create a new Stripe Connect Express account
    const account = await stripe.accounts.create({
      type: 'express',
      metadata: {
        tenantId,
        tenantName: tenantData.name || '',
        app: 'harvest',
      },
    });

    // Save the account ID and set status to pending
    const updateData: Record<string, any> = {
      stripeConnectAccountId: account.id,
      stripeConnectStatus: 'pending',
      updatedAt: new Date().toISOString(),
    };
    if (type === 'affiliate') {
      updateData.affiliateStatus = 'pending';
      updateData.affiliateAccountId = account.id;
    }
    await adminDb.collection('tenants').doc(tenantId).update(updateData);

    // Create an account link for onboarding
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${baseUrl}/?section=payment`,
      return_url: `${baseUrl}/api/stripe/connect/callback?account_id=${account.id}`,
      type: 'account_onboarding',
    });

    return NextResponse.json({ url: accountLink.url });
  } catch (error: any) {
    console.error('Stripe Connect error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to create Stripe Connect account' }, { status: 500 });
  }
}
