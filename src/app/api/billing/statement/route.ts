import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import Stripe from 'stripe';
import { requireOwner } from '@/lib/api-auth';
import { getPlanDisplayName } from '@/utils/plan-features';
import type { TenantPlan } from '@/types/tenant.types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/billing/statement — owner-only.
 *
 * Generates a consolidated billing-summary PDF (plan, period, each payment,
 * total paid) for the tenant's OWN subscription and returns it for download.
 * This is admin-facing — distinct from the donor giving statements — but uses
 * the same pdf-lib approach as /api/giving-statements/generate. The owner gate
 * (requireOwner) 403s any non-owner before we touch Stripe.
 */

interface PaymentLine {
  date: Date;
  description: string;
  status: string;
  amount: number; // minor units (cents)
}

function fmtMoney(amountMinor: number, currency: string): string {
  const value = (amountMinor / 100).toFixed(2);
  const cur = (currency || 'usd').toUpperCase();
  return cur === 'USD' ? `$${value}` : `${value} ${cur}`;
}

function drawWrapped(
  page: any, text: string, x: number, y: number, size: number, font: any, maxChars: number,
): number {
  const lines = String(text).split('\n');
  let cursor = y;
  for (const line of lines) {
    let remaining = line;
    while (remaining.length > 0) {
      const chunk = remaining.slice(0, maxChars);
      page.drawText(chunk, { x, y: cursor, size, font, color: rgb(0.4, 0.4, 0.4) });
      remaining = remaining.slice(maxChars);
      cursor -= size + 2;
    }
  }
  return cursor;
}

async function buildBillingSummaryPdf(opts: {
  tenantName: string;
  planLabel: string;
  status: string;
  currency: string;
  payments: PaymentLine[];
  totalPaid: number;
  nextBillingDate: Date | null;
  nextAmount: number | null;
}): Promise<Uint8Array> {
  const { tenantName, planLabel, status, currency, payments, totalPaid, nextBillingDate, nextAmount } = opts;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);

  const left = 50;
  let y = 800;

  // Ministry name + title
  page.drawText(tenantName || 'Harvest', { x: left, y, size: 22, font: boldFont, color: rgb(0.72, 0.59, 0.18) });
  y -= 36;
  page.drawText('Billing Summary', { x: left, y, size: 13, font: boldFont, color: rgb(0.2, 0.2, 0.2) });
  y -= 18;
  page.drawText(`Statement date: ${new Date().toLocaleDateString('en-US')}`, { x: left, y, size: 9, font, color: rgb(0.5, 0.5, 0.5) });
  y -= 28;

  // Plan / status block
  page.drawText('Plan:', { x: left, y, size: 10, font: boldFont });
  page.drawText(planLabel, { x: left + 90, y, size: 10, font });
  y -= 15;
  page.drawText('Status:', { x: left, y, size: 10, font: boldFont });
  page.drawText(status, { x: left + 90, y, size: 10, font });
  y -= 15;
  if (nextBillingDate) {
    page.drawText('Next billing:', { x: left, y, size: 10, font: boldFont });
    const nextStr = nextAmount != null
      ? `${nextBillingDate.toLocaleDateString('en-US')} — ${fmtMoney(nextAmount, currency)}`
      : nextBillingDate.toLocaleDateString('en-US');
    page.drawText(nextStr, { x: left + 90, y, size: 10, font });
    y -= 15;
  }
  y -= 14;

  // Payments table header
  page.drawText('Date', { x: left, y, size: 9, font: boldFont });
  page.drawText('Description', { x: 150, y, size: 9, font: boldFont });
  page.drawText('Status', { x: 360, y, size: 9, font: boldFont });
  page.drawText('Amount', { x: 470, y, size: 9, font: boldFont });
  y -= 6;
  page.drawLine({ start: { x: left, y }, end: { x: 545, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  y -= 14;

  const sorted = [...payments].sort((a, b) => a.date.getTime() - b.date.getTime());
  if (sorted.length === 0) {
    page.drawText('No payments on record yet.', { x: left, y, size: 9, font, color: rgb(0.5, 0.5, 0.5) });
    y -= 14;
  }
  for (const p of sorted) {
    if (y < 120) break;
    page.drawText(p.date.toLocaleDateString('en-US'), { x: left, y, size: 9, font });
    page.drawText((p.description || 'Subscription').slice(0, 34), { x: 150, y, size: 9, font });
    page.drawText(p.status, { x: 360, y, size: 9, font });
    page.drawText(fmtMoney(p.amount, currency), { x: 470, y, size: 9, font });
    y -= 14;
  }

  y -= 6;
  page.drawLine({ start: { x: 360, y }, end: { x: 545, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  y -= 18;
  page.drawText('Total paid:', { x: 360, y, size: 12, font: boldFont });
  page.drawText(fmtMoney(totalPaid, currency), { x: 470, y, size: 12, font: boldFont, color: rgb(0.72, 0.59, 0.18) });

  // Footer
  drawWrapped(
    page,
    'This is a summary of your subscription payments to the Harvest platform. For official tax invoices, download each invoice PDF from your billing history.',
    left, 90, 8, font, 95,
  );

  return pdf.save();
}

export async function POST(request: NextRequest) {
  try {
    const ownerOrResponse = await requireOwner(request);
    if (ownerOrResponse instanceof NextResponse) return ownerOrResponse;
    const { tenantData } = ownerOrResponse;

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }
    const stripe = new Stripe(stripeKey);

    const tenantName = tenantData.name || tenantData.displayName || 'Harvest';
    const plan = (tenantData.plan as TenantPlan) || undefined;
    const planLabel = plan ? getPlanDisplayName(plan) : '—';
    const status = tenantData.status || 'active';

    const customerId: string | undefined = tenantData.stripeCustomerId;
    const subscriptionId: string | undefined = tenantData.stripeSubscriptionId;

    let currency = 'usd';
    let nextBillingDate: Date | null = null;
    let nextAmount: number | null = null;
    const payments: PaymentLine[] = [];
    let totalPaid = 0;

    if (customerId) {
      const list = await stripe.invoices.list({ customer: customerId, limit: 100 });
      for (const inv of list.data) {
        const amount = inv.amount_paid || inv.total;
        if (inv.currency) currency = inv.currency;
        payments.push({
          date: new Date((inv.created || 0) * 1000),
          description: inv.lines?.data?.[0]?.description || 'Subscription',
          status: inv.status || 'unknown',
          amount,
        });
        if (inv.status === 'paid') totalPaid += inv.amount_paid || 0;
      }

      if (subscriptionId) {
        try {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          const item = sub.items?.data?.[0];
          if (sub.current_period_end) nextBillingDate = new Date(sub.current_period_end * 1000);
          if (item?.price?.unit_amount != null) nextAmount = item.price.unit_amount * (item.quantity || 1);
          if (item?.price?.currency) currency = item.price.currency;
        } catch (subErr) {
          console.warn('billing/statement: failed to load subscription:', subErr);
        }
      }
    }

    const pdfBytes = await buildBillingSummaryPdf({
      tenantName, planLabel, status, currency, payments, totalPaid, nextBillingDate, nextAmount,
    });

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="billing-summary.pdf"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('billing/statement error:', error);
    return NextResponse.json({ error: 'Failed to generate billing statement' }, { status: 500 });
  }
}
