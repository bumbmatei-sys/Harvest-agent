import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { Resend } from 'resend';
import { requireAdmin } from '@/lib/api-auth';
import { adminDb, getReceiptsBucket } from '@/lib/firebase-admin';
import { PLATFORM_TENANT_ID } from '@/utils/tenant-scope';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Generate annual giving statements (charitable contribution receipts) for a year.
 *
 * POST body: { year: number, donorEmail?: string, send?: boolean }
 *   - donorEmail omitted → generate for every donor with donations that year
 *   - donorEmail present  → generate (or regenerate / resend) a single donor's statement
 *   - send !== false      → also email the PDF via Resend and mark status "sent"
 *
 * PDFs are stored at receipts/{tenantId}/statements/{year}/{donorId}.pdf and a
 * status doc is written to tenants/{tenantId}/givingStatements/{year}_{donorId}.
 * Ministry-only; gated in the UI + by an authenticated admin here.
 */

interface DonationLine {
  date: Date;
  amount: number; // cents
  description: string;
}
interface DonorAgg {
  name: string;
  email: string;
  total: number; // cents
  donations: DonationLine[];
}

interface StatementConfig {
  ein?: string;
  address?: string;
  footer?: string;
}

const DEFAULT_FOOTER =
  'No goods or services were provided in exchange for these contributions.';

/** Stable, Firestore-safe donor id derived from the email. */
function donorIdFromEmail(email: string): string {
  return email.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 200);
}

function drawWrapped(
  page: any, text: string, x: number, y: number, size: number, font: any, maxChars: number
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

async function buildStatementPdf(
  donor: DonorAgg,
  year: number,
  tenantName: string,
  cfg: StatementConfig
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);

  const left = 50;
  let y = 800;

  // Ministry name (top-left) + address (top-right block)
  page.drawText(tenantName || 'Harvest', { x: left, y, size: 22, font: boldFont, color: rgb(0.72, 0.59, 0.18) });
  if (cfg.address) {
    drawWrapped(page, cfg.address, 360, y, 9, font, 30);
  }
  y -= 36;

  page.drawText(`Charitable Contribution Statement — ${year}`, { x: left, y, size: 13, font: boldFont, color: rgb(0.2, 0.2, 0.2) });
  y -= 18;
  page.drawText(`Statement date: ${new Date().toLocaleDateString('en-US')}`, { x: left, y, size: 9, font, color: rgb(0.5, 0.5, 0.5) });
  y -= 28;

  // Donor block
  page.drawText('Donor:', { x: left, y, size: 10, font: boldFont });
  y -= 15;
  page.drawText(donor.name || donor.email, { x: left, y, size: 10, font });
  y -= 13;
  page.drawText(donor.email, { x: left, y, size: 10, font });
  y -= 28;

  // Table header
  page.drawText('Date', { x: left, y, size: 9, font: boldFont });
  page.drawText('Description', { x: 180, y, size: 9, font: boldFont });
  page.drawText('Amount', { x: 460, y, size: 9, font: boldFont });
  y -= 6;
  page.drawLine({ start: { x: left, y }, end: { x: 545, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  y -= 14;

  const sorted = [...donor.donations].sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const d of sorted) {
    if (y < 120) break;
    page.drawText(d.date.toLocaleDateString('en-US'), { x: left, y, size: 9, font });
    page.drawText((d.description || 'Donation').slice(0, 40), { x: 180, y, size: 9, font });
    page.drawText(`$${(d.amount / 100).toFixed(2)}`, { x: 460, y, size: 9, font });
    y -= 14;
  }

  y -= 6;
  page.drawLine({ start: { x: 350, y }, end: { x: 545, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  y -= 18;
  page.drawText('Total contributions:', { x: 350, y, size: 12, font: boldFont });
  page.drawText(`$${(donor.total / 100).toFixed(2)}`, { x: 460, y, size: 12, font: boldFont, color: rgb(0.72, 0.59, 0.18) });

  // Footer note + EIN + signature line
  let fy = 110;
  fy = drawWrapped(page, cfg.footer || DEFAULT_FOOTER, left, fy, 8, font, 95);
  fy -= 8;
  if (cfg.ein) {
    page.drawText(`EIN: ${cfg.ein}`, { x: left, y: fy, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
    fy -= 14;
  }
  page.drawLine({ start: { x: left, y: 45 }, end: { x: 230, y: 45 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
  page.drawText('Authorized signature', { x: left, y: 33, size: 8, font, color: rgb(0.5, 0.5, 0.5) });

  return pdf.save();
}

export async function POST(request: NextRequest) {
  try {
    const userOrResponse = await requireAdmin(request);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const { uid, tenantId } = userOrResponse;
    const resolvedTenantId = tenantId || PLATFORM_TENANT_ID;

    let body: { year?: number; donorEmail?: string; send?: boolean } = {};
    try {
      body = await request.json();
    } catch { /* defaults below */ }

    const year = Number(body.year) || new Date().getFullYear();
    const send = body.send !== false;
    const onlyEmail = body.donorEmail?.toLowerCase();

    const tenantDoc = await adminDb.collection('tenants').doc(resolvedTenantId).get();
    if (!tenantDoc.exists) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }
    const tData = tenantDoc.data() || {};
    const tenantName = tData.name || tData.displayName || 'Harvest';
    const cfg: StatementConfig = tData.config?.givingStatements || {};

    // Single-field ordering only (no composite query); filter type + year client-side.
    const invoicesSnap = await adminDb
      .collection('tenants').doc(resolvedTenantId)
      .collection('invoices')
      .orderBy('issuedAt', 'desc')
      .limit(5000)
      .get();

    const donorsMap = new Map<string, DonorAgg>();
    for (const doc of invoicesSnap.docs) {
      const inv = doc.data();
      if (inv.type !== 'donation_receipt') continue;
      const issued = inv.issuedAt?.toDate ? inv.issuedAt.toDate() : null;
      if (!issued || issued.getFullYear() !== year) continue;
      const donorEmail = (inv.recipientEmail || '').toLowerCase();
      if (!donorEmail) continue;
      if (onlyEmail && donorEmail !== onlyEmail) continue;
      if (!donorsMap.has(donorEmail)) {
        donorsMap.set(donorEmail, { name: inv.recipientName || donorEmail, email: donorEmail, total: 0, donations: [] });
      }
      const donor = donorsMap.get(donorEmail)!;
      donor.total += inv.amount || 0;
      donor.donations.push({
        date: issued,
        amount: inv.amount || 0,
        description: inv.description || 'Donation',
      });
    }

    if (donorsMap.size === 0) {
      return NextResponse.json({ generated: 0, sent: 0, totalDonors: 0, message: `No donations found for ${year}` });
    }

    const bucket = getReceiptsBucket();
    const resendKey = process.env.RESEND_API_KEY;
    let generated = 0;
    let sent = 0;
    const failures: string[] = [];

    for (const [donorEmail, donor] of donorsMap) {
      const donorId = donorIdFromEmail(donorEmail);
      const statementRef = adminDb
        .collection('tenants').doc(resolvedTenantId)
        .collection('givingStatements').doc(`${year}_${donorId}`);
      try {
        const pdfBytes = await buildStatementPdf(donor, year, tenantName, cfg);
        const filePath = `receipts/${resolvedTenantId}/statements/${year}/${donorId}.pdf`;
        const file = bucket.file(filePath);
        await file.save(Buffer.from(pdfBytes), { metadata: { contentType: 'application/pdf' } });
        await file.makePublic();
        const pdfUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
        generated++;

        let didSend = false;
        if (send && resendKey) {
          const resend = new Resend(resendKey);
          const pdfBase64 = Buffer.from(pdfBytes).toString('base64');
          const { error } = await resend.emails.send({
            from: 'Harvest <noreply@theharvest.app>',
            to: donorEmail,
            subject: `Your ${year} Giving Statement — ${tenantName}`,
            html: `<p>Dear ${donor.name},</p><p>Please find attached your ${year} charitable contribution statement.</p><p>Total contributions: <strong>$${(donor.total / 100).toFixed(2)}</strong></p><p>Thank you for your generosity.</p><br><p>— ${tenantName}</p>`,
            attachments: [{ filename: `giving-statement-${year}.pdf`, content: pdfBase64 }],
          });
          if (error) { failures.push(donorEmail); } else { didSend = true; sent++; }
        }

        await statementRef.set({
          donorId,
          donorEmail,
          donorName: donor.name,
          year,
          totalAmount: donor.total,
          donationCount: donor.donations.length,
          pdfUrl,
          sentAt: didSend ? new Date().toISOString() : null,
          status: didSend ? 'sent' : 'generated',
          generatedAt: new Date().toISOString(),
          generatedBy: uid,
        }, { merge: true });
      } catch (err: any) {
        console.error(`Giving statement failed for ${donorEmail}:`, err?.message || err);
        failures.push(donorEmail);
        try {
          await statementRef.set({
            donorId, donorEmail, donorName: donor.name, year,
            totalAmount: donor.total, donationCount: donor.donations.length,
            status: 'failed', generatedAt: new Date().toISOString(), generatedBy: uid,
          }, { merge: true });
        } catch { /* best-effort */ }
      }
    }

    return NextResponse.json({
      generated,
      sent,
      totalDonors: donorsMap.size,
      failed: failures.length,
      emailConfigured: !!resendKey,
    });
  } catch (error) {
    console.error('Giving statements error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
