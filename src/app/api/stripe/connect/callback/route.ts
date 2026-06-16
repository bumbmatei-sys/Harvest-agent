import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('account_id');

    if (!accountId) {
      return NextResponse.redirect(new URL('/?error=missing_account', process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app'));
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.redirect(new URL('/?error=stripe_not_configured', process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app'));
    }
    const stripe = new Stripe(stripeKey, { apiVersion: '2026-05-27.dahlia' });

    // Retrieve the account to check its status
    const account = await stripe.accounts.retrieve(accountId);

    // Determine status
    let status: 'pending' | 'active' | 'restricted' = 'pending';
    if (account.charges_enabled && account.payouts_enabled) {
      status = 'active';
    } else if (account.requirements?.currently_due && account.requirements.currently_due.length > 0) {
      status = 'restricted';
    }

    // Find the tenant with this account ID and update status
    const tenantsSnapshot = await adminDb.collection('tenants')
      .where('stripeConnectAccountId', '==', accountId)
      .limit(1)
      .get();

    if (!tenantsSnapshot.empty) {
      await tenantsSnapshot.docs[0].ref.update({
        stripeConnectStatus: status,
        updatedAt: new Date().toISOString(),
      });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';
    return NextResponse.redirect(new URL(`/?stripe_connect=${status}`, baseUrl));
  } catch (error: any) {
    console.error('Stripe Connect callback error:', error?.message || error);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://theharvest.app';
    return NextResponse.redirect(new URL('/?error=connect_callback_failed', baseUrl));
  }
}
