import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { executeComposioAction } from '@/lib/composio-client';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/newsletter/campaigns
 * Fetches Mailchimp campaigns for the authenticated tenant.
 * Returns campaigns with id, subject, status, send_time, open_rate, click_rate.
 */
export async function GET(request: NextRequest) {
  try {
    // Auth + tenant verification
    const userOrResponse = await requireAdmin(request);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const { tenantId } = userOrResponse;

    if (!tenantId) {
      return NextResponse.json(
        { error: 'No tenant associated with this user' },
        { status: 400 }
      );
    }

    // Get Mailchimp integration
    const mailchimpDoc = await adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('integrations')
      .doc('mailchimp')
      .get();

    if (!mailchimpDoc.exists) {
      return NextResponse.json({ campaigns: [] });
    }

    const mailchimpData = mailchimpDoc.data();
    if (!mailchimpData || mailchimpData.status !== 'active') {
      return NextResponse.json({ campaigns: [] });
    }

    const connectedAccountId = mailchimpData.connectedAccountId;
    if (!connectedAccountId) {
      return NextResponse.json({ campaigns: [] });
    }

    // Fetch campaigns from Mailchimp
    let campaigns: any[] = [];
    try {
      const result = await executeComposioAction(
        'MAILCHIMP_LIST_CAMPAIGNS',
        { count: 50, sort_dir: 'DESC' },
        connectedAccountId
      );

      const rawCampaigns = result?.data?.campaigns || result?.campaigns || [];
      if (!Array.isArray(rawCampaigns)) {
        campaigns = [];
      } else {
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
      return NextResponse.json(
        { error: 'Failed to fetch campaigns from Mailchimp' },
        { status: 502 }
      );
    }

    // Also fetch local newsletter drafts
    let localNewsletters: any[] = [];
    try {
      const localDocs = await adminDb
        .collection('tenants')
        .doc(tenantId)
        .collection('newsletters')
        .orderBy('generatedAt', 'desc')
        .limit(50)
        .get();

      localNewsletters = localDocs.docs.map((doc) => {
        const data = doc.data();
        return {
          id: data.mailchimpCampaignId || doc.id,
          newsletterId: doc.id,
          subject: data.subject || 'No subject',
          status: data.status || 'draft',
          send_time: data.sentAt || null,
          open_rate: null,
          click_rate: null,
          posts_used: data.postsUsed || 0,
          is_local: true,
        };
      });
    } catch (localError) {
      console.warn('Failed to fetch local newsletters:', localError);
    }

    return NextResponse.json({
      campaigns,
      localNewsletters,
    });
  } catch (error) {
    console.error('Newsletter campaigns error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
