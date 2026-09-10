import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireTenantPermission } from '@/lib/api-auth';
import {
  recordManualDonation,
  type ManualDonationSource,
  MANUAL_DONATION_SOURCES,
} from '@/lib/manual-donation';

export const dynamic = 'force-dynamic';

/**
 * THE-350 — POST /api/donations/manual
 *
 * The ONE seam a browser reaches {@link recordManualDonation} through. The
 * writer itself is in `lib/manual-donation.ts` and is deliberately NOT a route
 * handler: THE-351 calls it in-process from the paid-event confirmation flow,
 * and a caller that had to POST to itself would be a second code path wearing an
 * HTTP request.
 *
 * ─── 🔴 WHY THE WRITE IS HERE AND NOT IN THE CRM COMPONENT ──────────────────
 *
 * `firestore.rules` gates `tenants/{t}/invoices` on
 * `hasPermission('manageAccounting', tenantId)`. The admin recording a gift in
 * the CRM holds `manageCRM`, so a client write would be refused for exactly the
 * people who do the recording. `requireTenantPermission` is the documented
 * answer — "admin-moderation API routes that stand in for a client write the
 * rules can't express" — and it means firestore.rules is untouched by this
 * ticket. That file AUTO-DEPLOYS on merge with no emulator tests in CI, and it
 * guards the money ledger; loosening it so a CRM admin could write an invoice
 * from a browser would hand every CRM admin direct write access to accounting.
 *
 * ⚠️ THE GATE IS `manageCRM`, NOT `manageAccounting`, and that is the point.
 * Recording a gift you received is CRM work; it is the reason THE-249's
 * disclaimer sends churches to Add Activity in the first place. The route
 * enforces it server-side, so the permission a church actually grants its CRM
 * admins is the permission that works.
 *
 * ⚠️ `tenantId` COMES FROM THE BODY AND IS NOT A TRUST BOUNDARY BY ITSELF — it
 * is the argument `requireTenantPermission` is checked against, so a caller can
 * only ever name a church they already administer. Nothing else in the body is
 * trusted: the amount is re-validated as integer cents by the writer, and
 * `recordedBy` is taken from the VERIFIED token rather than the payload, so an
 * admin cannot attribute a gift to somebody else.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : '';
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  const auth = await requireTenantPermission(request, tenantId, 'manageCRM');
  if (auth instanceof NextResponse) return auth;

  const source = body.source as ManualDonationSource;
  if (!MANUAL_DONATION_SOURCES.includes(source)) {
    return NextResponse.json({ error: 'Unknown donation source.' }, { status: 400 });
  }

  const result = await recordManualDonation({
    tenantId,
    amountCents: typeof body.amountCents === 'number' ? body.amountCents : NaN,
    email: typeof body.email === 'string' ? body.email : null,
    description: typeof body.description === 'string' ? body.description : '',
    source,
    recipientName: typeof body.recipientName === 'string' ? body.recipientName : null,
    // 🔴 From the verified token, never the payload.
    recordedBy: auth.uid,
  });

  if (!result.ok) {
    // 400 for anything the admin can fix by retyping, 500 only for a write that
    // actually failed — so the CRM can tell "your input was wrong" from "the
    // ledger did not accept this", and says the right thing in its banner.
    const status = result.code === 'write_failed' ? 500 : 400;
    return NextResponse.json({ error: result.error, code: result.code }, { status });
  }

  return NextResponse.json({
    invoiceId: result.invoiceId,
    receiptNumber: result.receiptNumber,
    // 🔴 Passed through so the CRM can say, on screen, that a gift recorded
    // without an email will never reach its giver's own donation history.
    visibleToMember: result.visibleToMember,
    issuedAt: result.issuedAt,
  });
}
