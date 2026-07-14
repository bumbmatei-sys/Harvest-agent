import type { DocumentReference } from 'firebase-admin/firestore';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { Resend } from 'resend';
import { getReceiptsBucket } from '@/lib/firebase-admin';

/**
 * Per-donation thank-you receipt: generate a PDF, store it to R2, email the donor,
 * and complete the `donation_receipt` invoice record the webhook already created.
 *
 * This runs on the Stripe webhook (money/trust path) so it is STRICTLY best-effort:
 * every step is wrapped in try/catch and any failure is logged and swallowed. The
 * caller must never see this throw — the donation, CRM link and campaign credit are
 * the guarantees; the receipt is a nice-to-have layered on top. A thrown error here
 * would bubble to the webhook, return non-200, and let Stripe redeliver a money event.
 *
 * Amounts are handled in CENTS throughout (the invoices/giving-statements/QuickBooks
 * subsystem stores cents); we only divide by 100 to DISPLAY dollars on the PDF/email.
 */

export interface DonationReceiptInput {
  /** Tenant that received the gift — used for the R2 path. */
  tenantId: string;
  /** Donor's display name for the PDF/email. */
  recipientName: string;
  /** Donor email; email is skipped (but PDF still stored) when absent. */
  donorEmail: string;
  /** Gift amount in CENTS (Stripe). Formatted to dollars for display only. */
  amountCents: number;
  /** ISO currency code, e.g. 'usd'. */
  currency: string;
  /** Human receipt id, e.g. R-1700000000000-AB12CD. */
  receiptNumber: string;
  /** Church name shown on the receipt. */
  tenantName: string;
  /** ISO date the gift was issued. */
  issuedAt: string;
  /** Short line describing the gift, e.g. 'Partnership donation'. */
  description?: string;
  /** The `donation_receipt` invoice doc to complete (pdfUrl + status). */
  invoiceRef: DocumentReference;
}

/**
 * Charitable-receipt disclosure. Kept in sync with the annual giving statement
 * (`giving-statements/generate` DEFAULT_FOOTER) so a per-donation receipt and the
 * year-end statement read consistently.
 */
const RECEIPT_FOOTER =
  'No goods or services were provided in exchange for this contribution.';

/**
 * Build a single-page donation receipt PDF, mirroring the giving-statement's
 * branding (gold ministry name, A4, Helvetica) so receipts and annual statements
 * look like one family of documents.
 */
async function buildReceiptPdf(input: DonationReceiptInput): Promise<Uint8Array> {
  const { recipientName, donorEmail, amountCents, currency, receiptNumber, tenantName, issuedAt, description } = input;

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);

  const left = 50;
  let y = 800;

  const church = tenantName || 'Harvest';
  const amountDisplay = `$${(amountCents / 100).toFixed(2)}`;
  const currencyLabel = (currency || 'usd').toUpperCase();
  const issuedDate = (() => {
    const d = new Date(issuedAt);
    return isNaN(d.getTime()) ? issuedAt : d.toLocaleDateString('en-US');
  })();

  // Ministry name (gold, matches buildStatementPdf).
  page.drawText(church, { x: left, y, size: 22, font: boldFont, color: rgb(0.72, 0.59, 0.18) });
  y -= 36;

  page.drawText('Donation Receipt', { x: left, y, size: 13, font: boldFont, color: rgb(0.2, 0.2, 0.2) });
  y -= 18;
  page.drawText(`Receipt no. ${receiptNumber}`, { x: left, y, size: 9, font, color: rgb(0.5, 0.5, 0.5) });
  y -= 14;
  page.drawText(`Date: ${issuedDate}`, { x: left, y, size: 9, font, color: rgb(0.5, 0.5, 0.5) });
  y -= 30;

  // Donor block.
  page.drawText('Received from:', { x: left, y, size: 10, font: boldFont });
  y -= 15;
  page.drawText(recipientName || donorEmail, { x: left, y, size: 10, font });
  if (donorEmail) {
    y -= 13;
    page.drawText(donorEmail, { x: left, y, size: 10, font });
  }
  y -= 30;

  // Amount row.
  page.drawLine({ start: { x: left, y: y + 8 }, end: { x: 545, y: y + 8 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  y -= 10;
  page.drawText(description || 'Donation', { x: left, y, size: 11, font });
  page.drawText(`${amountDisplay} ${currencyLabel}`, { x: 430, y, size: 12, font: boldFont, color: rgb(0.72, 0.59, 0.18) });
  y -= 12;
  page.drawLine({ start: { x: left, y: y + 2 }, end: { x: 545, y: y + 2 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  y -= 34;

  // Thank-you message.
  page.drawText(`Thank you for your generous gift to ${church}.`, { x: left, y, size: 11, font, color: rgb(0.3, 0.3, 0.3) });
  y -= 15;
  page.drawText('Your support makes our ministry possible.', { x: left, y, size: 11, font, color: rgb(0.3, 0.3, 0.3) });

  // Footer: charitable disclosure (matches the giving statement) + signature line.
  page.drawText(RECEIPT_FOOTER, { x: left, y: 90, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
  page.drawLine({ start: { x: left, y: 45 }, end: { x: 230, y: 45 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
  page.drawText('Authorized signature', { x: left, y: 33, size: 8, font, color: rgb(0.5, 0.5, 0.5) });

  return pdf.save();
}

/**
 * Store the receipt PDF, email the donor (if configured), and complete the invoice.
 * Never throws — safe to call directly from the webhook money path.
 */
export async function issueDonationReceipt(input: DonationReceiptInput): Promise<void> {
  try {
    const { tenantId, donorEmail, receiptNumber, tenantName, invoiceRef } = input;

    // Idempotency: if this invoice was already completed (e.g. the helper ran once
    // and Stripe redelivered), do not regenerate or re-email. The webhook also
    // dedupes at the event level (webhook_events marker), so this is belt-and-braces.
    try {
      const existing = await invoiceRef.get();
      if (existing.exists && existing.data()?.status === 'sent') {
        console.log(`⏭️ Donation receipt ${receiptNumber} already sent — skipping`);
        return;
      }
    } catch { /* if the read fails, fall through and attempt the receipt anyway */ }

    const pdfBytes = await buildReceiptPdf(input);

    // Store to R2 (private — served on demand via an authenticated signed URL),
    // matching the giving-statement path convention.
    const filePath = `receipts/${tenantId}/donations/${receiptNumber}.pdf`;
    await getReceiptsBucket().file(filePath).save(Buffer.from(pdfBytes), {
      metadata: { contentType: 'application/pdf' },
    });

    // Email the donor with the PDF attached, when Resend is configured and we have
    // an address. No key / no email → PDF is still stored and the invoice completed.
    let didSend = false;
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey && donorEmail) {
      try {
        const resend = new Resend(resendKey);
        const pdfBase64 = Buffer.from(pdfBytes).toString('base64');
        const amountDisplay = `$${(input.amountCents / 100).toFixed(2)}`;
        const church = tenantName || 'Harvest';
        const { error } = await resend.emails.send({
          from: 'Harvest <noreply@theharvest.app>',
          to: donorEmail,
          subject: `Your donation receipt — ${church}`,
          html:
            `<p>Dear ${input.recipientName || 'friend'},</p>` +
            `<p>Thank you for your generous gift of <strong>${amountDisplay}</strong> to ${church}. ` +
            `Your support makes our ministry possible.</p>` +
            `<p>Your receipt (no. ${receiptNumber}) is attached for your records.</p>` +
            `<br><p>— ${church}</p>`,
          attachments: [{ filename: `donation-receipt-${receiptNumber}.pdf`, content: pdfBase64 }],
        });
        if (error) {
          console.error(`Donation receipt email failed for ${donorEmail}:`, error);
        } else {
          didSend = true;
        }
      } catch (emailErr: any) {
        console.error(`Donation receipt email threw for ${donorEmail}:`, emailErr?.message || emailErr);
      }
    }

    // Complete the invoice record: point pdfUrl at the stored PDF and flip status off
    // the 'pending' placeholder. 'sent' once emailed, 'stored' when email was skipped.
    await invoiceRef.update({
      pdfUrl: filePath,
      status: didSend ? 'sent' : 'stored',
      receiptGeneratedAt: new Date().toISOString(),
    });

    console.log(`🧾 Donation receipt ${receiptNumber} ${didSend ? 'emailed + stored' : 'stored (email skipped)'}`);
  } catch (err: any) {
    // Best-effort: swallow everything so the webhook still returns 200 and the
    // donation stays recorded. Stripe must not redeliver over a receipt failure.
    console.error(`Donation receipt failed (best-effort, swallowed) for ${input.receiptNumber}:`, err?.message || err);
  }
}
