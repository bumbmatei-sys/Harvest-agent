import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { executeComposioAction } from '@/lib/composio-client';
import { adminDb } from '@/lib/firebase-admin';
import { PLATFORM_TENANT_ID } from '@/utils/tenant-scope';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const userOrResponse = await requireAdmin(request);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const { tenantId } = userOrResponse;

    const resolvedTenantId = tenantId || PLATFORM_TENANT_ID;

    const tenantDoc = await adminDb.collection('tenants').doc(resolvedTenantId).get();
    const tenantData = tenantDoc.exists ? tenantDoc.data() : null;

    // Get Mailchimp integration — prefer primary admin's, fall back to legacy
    let mailchimpData: Record<string, any> | undefined;
    if (tenantData) {
      const primaryMailchimpAdmin = tenantData.primaryMailchimpAdmin as string | undefined;
      if (primaryMailchimpAdmin) {
        const adminMcDoc = await adminDb
          .collection('tenants').doc(resolvedTenantId)
          .collection('integrations').doc(`${primaryMailchimpAdmin}_mailchimp`).get();
        if (adminMcDoc.exists) mailchimpData = adminMcDoc.data() ?? undefined;
      }
      if (!mailchimpData) {
        const legacyMcDoc = await adminDb
          .collection('tenants').doc(resolvedTenantId)
          .collection('integrations').doc('mailchimp').get();
        if (legacyMcDoc.exists) mailchimpData = legacyMcDoc.data() ?? undefined;
      }
    }

    // Fetch campaigns from Mailchimp if connected
    let campaigns: any[] = [];
    if (
      mailchimpData &&
      (mailchimpData.status === 'active' || mailchimpData.status === 'connected') &&
      mailchimpData.connectedAccountId
    ) {
      try {
        const result = await executeComposioAction(
          'MAILCHIMP_LIST_CAMPAIGNS',
          { count: 50, sort_dir: 'DESC' },
          mailchimpData.connectedAccountId
        );
        const rawCampaigns = result?.data?.campaigns || result?.campaigns || [];
        if (Array.isArray(rawCampaigns)) {
          campaigns = rawCampaigns.map((c: any) => ({
            id: c.id,
            subject: c.settings?.subject_line || c.subject_line || 'No subject',
            status: c.status || 'unknown',
            send_time: c.send_time || null,
            open_rate: c.report_summary?.open_rate ?? null,
            click_rate: c.report_summary?.click_rate ?? null,
            emails_sent: c.emails_sent || 0,
            list_name: c.recipients?.list_name || '',
            created_at: c.create_time || null,
          }));
        }
      } catch (actionError) {
        console.error('Mailchimp list campaigns error:', actionError);
      }
    }

    // Fetch local newsletter drafts/sent
    let localNewsletters: any[] = [];
    try {
      const localDocs = await adminDb
        .collection('tenants').doc(resolvedTenantId).collection('newsletters')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();

      localNewsletters = localDocs.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: data.mailchimpCampaignId || docSnap.id,
          newsletterId: docSnap.id,
          subject: data.subject || 'No subject',
          status: data.status || 'draft',
          send_time: data.sentAt || null,
          created_at: data.createdAt || data.generatedAt || null,
          open_rate: null,
          click_rate: null,
          posts_used: data.postsUsed || 0,
          is_local: true,
        };
      });
    } catch (localError) {
      console.warn('Failed to fetch local newsletters:', localError);
    }

    return NextResponse.json({ campaigns, localNewsletters });
  } catch (error) {
    console.error('Newsletter campaigns error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
