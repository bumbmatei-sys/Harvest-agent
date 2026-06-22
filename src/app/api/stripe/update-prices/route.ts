import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * One-time admin-only endpoint to create new Stripe prices for the updated pricing.
 * Creates new Price objects for each plan (monthly + yearly) and stores the IDs in Firestore.
 *
 * New prices:
 *   Individual:  $59/mo,  $590/yr
 *   Small Team:  $119/mo, $1,190/yr
 *   Community:   $239/mo, $2,390/yr
 *   Ministry:    $479/mo, $4,790/yr
 *   Organization: Custom (no auto-charge)
 */
export async function POST(request: NextRequest) {
  try {
    const userOrErr = await requireAuth(request);
    if (userOrErr instanceof Response) return userOrErr;

    // Super admin only
    if (!userOrErr.isSuperAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }
    const stripe = new Stripe(stripeKey);

    // Existing product IDs from AGENTS.md
    const products: Record<string, string> = {
      plus: 'prod_UiFqnOe6b0lhrP',
      pro: 'prod_UiFq52hfQcT8nT',
      max: 'prod_UiFqa2JkBvjtOt',
      ultra: 'prod_UiFqa2JkBvjtOt', // Need to verify — may need a separate product for ultra
    };

    // Try to list all products to find the correct ones
    const allProducts = await stripe.products.list({ limit: 20 });
    const productMap: Record<string, string> = {};
    for (const p of allProducts.data) {
      // Match by name
      const name = (p.name || '').toLowerCase();
      if (name.includes('individual') || name.includes('plus')) productMap.plus = p.id;
      if (name.includes('small team') || name.includes('pro ')) productMap.pro = p.id;
      if (name.includes('community') || name.includes('max')) productMap.max = p.id;
      if (name.includes('ministry') || name.includes('ultra')) productMap.ultra = p.id;
    }
    // Fall back to hardcoded IDs if not found by name
    for (const [plan, fallbackId] of Object.entries(products)) {
      if (!productMap[plan]) productMap[plan] = fallbackId;
    }

    const newPrices: Record<string, { monthly: string; yearly: string; monthlyAmount: number; yearlyAmount: number }> = {
      plus:   { monthly: '', yearly: '', monthlyAmount: 5900,  yearlyAmount: 59000 },   // $59/mo, $590/yr
      pro:    { monthly: '', yearly: '', monthlyAmount: 11900, yearlyAmount: 119000 },  // $119/mo, $1,190/yr
      max:    { monthly: '', yearly: '', monthlyAmount: 23900, yearlyAmount: 239000 },  // $239/mo, $2,390/yr
      ultra:  { monthly: '', yearly: '', monthlyAmount: 47900, yearlyAmount: 479000 },  // $479/mo, $4,790/yr
    };

    const results: any[] = [];

    for (const [plan, config] of Object.entries(newPrices)) {
      const productId = productMap[plan];
      if (!productId) {
        results.push({ plan, error: 'Product not found' });
        continue;
      }

      // Create monthly price
      const monthlyPrice = await stripe.prices.create({
        product: productId,
        unit_amount: config.monthlyAmount,
        currency: 'usd',
        recurring: { interval: 'month' },
        nickname: `${plan} monthly (new)`,
      });

      // Create yearly price (10 months — 2 months free promo)
      const yearlyPrice = await stripe.prices.create({
        product: productId,
        unit_amount: config.yearlyAmount,
        currency: 'usd',
        recurring: { interval: 'year' },
        nickname: `${plan} yearly (new)`,
      });

      newPrices[plan].monthly = monthlyPrice.id;
      newPrices[plan].yearly = yearlyPrice.id;

      results.push({
        plan,
        productId,
        monthlyPriceId: monthlyPrice.id,
        yearlyPriceId: yearlyPrice.id,
        monthlyAmount: `$${config.monthlyAmount / 100}/mo`,
        yearlyAmount: `$${config.yearlyAmount / 100}/yr`,
      });
    }

    // Store the new price IDs in Firestore for reference
    await adminDb.collection('config').doc('stripe-prices').set({
      updatedPrices: newPrices,
      results,
      updatedAt: new Date().toISOString(),
      updatedBy: userOrErr.uid,
    });

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    console.error('Update prices error:', error?.message || error);
    return NextResponse.json({ error: error?.message || 'Failed to update prices' }, { status: 500 });
  }
}