import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { executeComposioAction } from '@/lib/composio-client';
import { adminDb } from '@/lib/firebase-admin';
import { PLATFORM_TENANT_ID } from '@/utils/tenant-scope';

export const dynamic = 'force-dynamic';

/**
 * Sync invoices (donation receipts + event tickets) to QuickBooks as Sales
 * Receipts via Composio. This is the API-route equivalent of the
 * syncDonationToQuickBooks / syncEventPaymentToQuickBooks cloud functions —
 * the app performs all Composio work in routes (see the instagram/mailchimp
 * integrations), so QuickBooks follows the same pattern.
 *
 * POST body: { invoiceId?: string }
 *   - invoiceId present → sync (or retry) just that invoice
 *   - invoiceId absent   → "Sync Now": sync every not-yet-synced invoice
 *
 * Plan gating (Ministry only) is enforced in the UI; this route additionally
 * requires an authenticated admin with an active QuickBooks connection.
 */

interface InvoiceData {
  type?: string;
  recipientName?: string;
  recipientEmail?: string;
  amount?: number;
  currency?: string;
  description?: string;
  relatedId?: string;
  receiptNumber?: string;
  quickbooksSyncStatus?: string;
}

/**
 * Find an active QuickBooks connection for the tenant — caller's own first,
 * then the primary admin's. Returns the connection AND its owner uid: a v3
 * Composio connection is PRIVATE, so execution must use the owner's userId
 * (which may be the primary admin, not the caller).
 */
async function findQuickBooksConnection(
  tenantId: string,
  uid: string
): Promise<{ connectedAccountId: string; ownerUid: string } | null> {
  const integrationsRef = adminDb.collection('tenants').doc(tenantId).collection('integrations');

  const ownDoc = await integrationsRef.doc(`${uid}_quickbooks`).get();
  if (ownDoc.exists && ownDoc.data()?.status === 'active' && ownDoc.data()?.connectedAccountId) {
    return { connectedAccountId: ownDoc.data()!.connectedAccountId, ownerUid: uid };
  }

  const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
  const primaryUid = tenantDoc.data()?.primaryQuickBooksAdmin;
  if (primaryUid) {
    const primaryDoc = await integrationsRef.doc(`${primaryUid}_quickbooks`).get();
    if (primaryDoc.exists && primaryDoc.data()?.status === 'active' && primaryDoc.data()?.connectedAccountId) {
      return { connectedAccountId: primaryDoc.data()!.connectedAccountId, ownerUid: primaryUid };
    }
  }
  return null;
}

function buildSalesReceiptPayload(inv: InvoiceData) {
  return {
    customerName: inv.recipientName || 'Anonymous Donor',
    customerEmail: inv.recipientEmail || '',
    amount: inv.amount || 0,
    currency: (inv.currency || 'usd').toUpperCase(),
    lineDescription: inv.type === 'event_ticket' ? (inv.description || 'Event Registration') : 'Donation',
    paymentRefNum: inv.relatedId || inv.receiptNumber || '',
    memo: inv.description || '',
  };
}

export async function POST(request: NextRequest) {
  try {
    const userOrResponse = await requireAdmin(request);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const { uid, tenantId } = userOrResponse;

    const resolvedTenantId = tenantId || PLATFORM_TENANT_ID;

    let body: { invoiceId?: string } = {};
    try {
      body = await request.json();
    } catch { /* body is optional */ }

    const connection = await findQuickBooksConnection(resolvedTenantId, uid);
    if (!connection) {
      return NextResponse.json(
        { error: 'QuickBooks is not connected. Connect it in the Accounting section first.' },
        { status: 400 }
      );
    }
    const { connectedAccountId, ownerUid } = connection;

    const invoicesRef = adminDb.collection('tenants').doc(resolvedTenantId).collection('invoices');

    // Resolve the set of invoices to sync.
    let toSync: { id: string; data: InvoiceData }[] = [];
    if (body.invoiceId) {
      const snap = await invoicesRef.doc(body.invoiceId).get();
      if (!snap.exists) {
        return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
      }
      toSync = [{ id: snap.id, data: snap.data() as InvoiceData }];
    } else {
      // "Sync Now": pull recent invoices and filter client-side for un-synced ones
      // (single-field ordering only — no compound query).
      const snap = await invoicesRef.orderBy('issuedAt', 'desc').limit(500).get();
      toSync = snap.docs
        .map((d) => ({ id: d.id, data: d.data() as InvoiceData }))
        .filter((inv) =>
          (inv.data.type === 'donation_receipt' || inv.data.type === 'event_ticket') &&
          inv.data.quickbooksSyncStatus !== 'synced'
        );
    }

    let synced = 0;
    let failed = 0;
    const results: { id: string; status: 'synced' | 'failed'; error?: string }[] = [];

    for (const inv of toSync) {
      try {
        const result = await executeComposioAction(
          'QUICKBOOKS_CREATE_SALES_RECEIPT',
          buildSalesReceiptPayload(inv.data),
          connectedAccountId,
          resolvedTenantId,
          ownerUid
        );
        const receiptId =
          result?.data?.SalesReceipt?.Id || result?.data?.Id || result?.id || null;

        await invoicesRef.doc(inv.id).set(
          {
            quickbooksReceiptId: receiptId,
            quickbooksSyncStatus: 'synced',
            quickbooksSyncedAt: new Date().toISOString(),
            quickbooksSyncError: null,
          },
          { merge: true }
        );
        synced++;
        results.push({ id: inv.id, status: 'synced' });
      } catch (e: any) {
        await invoicesRef.doc(inv.id).set(
          {
            quickbooksSyncStatus: 'failed',
            quickbooksSyncError: e?.message ? String(e.message).slice(0, 500) : 'Sync failed',
          },
          { merge: true }
        );
        failed++;
        results.push({ id: inv.id, status: 'failed', error: e?.message });
      }
    }

    return NextResponse.json({ synced, failed, total: toSync.length, results });
  } catch (error) {
    console.error('QuickBooks sync error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
