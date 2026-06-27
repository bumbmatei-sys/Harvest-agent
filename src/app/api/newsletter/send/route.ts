import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { executeComposioAction } from '@/lib/composio-client';
import { adminDb } from '@/lib/firebase-admin';
import { hasFeature } from '@/utils/plan-features';
import { PLATFORM_TENANT_ID } from '@/utils/tenant-scope';
import sanitizeHtml from 'sanitize-html';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const userOrResponse = await requireAdmin(request);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const { tenantId, uid, isSuperAdmin } = userOrResponse;

    const resolvedTenantId = tenantId || PLATFORM_TENANT_ID;

    let body: {
      newsletterId?: string;
      schedule?: string;
      action?: string;
      subject?: string;
      bodyHtml?: string;
      bodyJson?: unknown;
      plainText?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { newsletterId, schedule, action } = body;

    if (!newsletterId || typeof newsletterId !== 'string') {
      return NextResponse.json({ error: 'newsletterId is required' }, { status: 400 });
    }

    if (newsletterId.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(newsletterId)) {
      return NextResponse.json({ error: 'Invalid newsletterId format' }, { status: 400 });
    }

    if (schedule) {
      const scheduleDate = new Date(schedule);
      if (isNaN(scheduleDate.getTime())) {
        return NextResponse.json({ error: 'Invalid schedule date. Use ISO 8601 format.' }, { status: 400 });
      }
      if (scheduleDate.getTime() < Date.now()) {
        return NextResponse.json({ error: 'Schedule date must be in the future' }, { status: 400 });
      }
    }

    const newsletterRef = adminDb
      .collection('tenants').doc(resolvedTenantId).collection('newsletters').doc(newsletterId);

    // Handle save_draft — upserts the doc (creates if new, updates if existing)
    if (action === 'save_draft') {
      const now = new Date().toISOString();
      const updates: Record<string, unknown> = {
        tenantId: resolvedTenantId,
        status: 'draft',
        updatedAt: now,
      };
      if (body.subject !== undefined) updates.subject = body.subject;
      if (body.bodyHtml !== undefined) updates.bodyHtml = body.bodyHtml;
      if (body.bodyJson !== undefined) updates.bodyJson = body.bodyJson;
      if (body.plainText !== undefined) updates.plainText = body.plainText;

      // Set createdAt only on first save
      const existing = await newsletterRef.get();
      if (!existing.exists) {
        updates.createdAt = now;
        updates.createdBy = uid;
      }

      await newsletterRef.set(updates, { merge: true });
      return NextResponse.json({ success: true, status: 'draft', message: 'Draft saved' });
    }

    const tenantDoc = await adminDb.collection('tenants').doc(resolvedTenantId).get();
    if (!tenantDoc.exists) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const tenantData = tenantDoc.data();
    if (!tenantData) {
      return NextResponse.json({ error: 'Tenant data missing' }, { status: 404 });
    }

    const tenantPlan = tenantData.plan || 'plus';
    const tenantName = tenantData.name || 'Your Ministry';

    if (!isSuperAdmin && !hasFeature(tenantPlan, 'newsletterAutomation')) {
      return NextResponse.json(
        { error: 'Newsletter is not available on your current plan.' },
        { status: 403 }
      );
    }

    const newsletterDoc = await newsletterRef.get();
    if (!newsletterDoc.exists) {
      return NextResponse.json({ error: 'Newsletter not found' }, { status: 404 });
    }

    const newsletterData = newsletterDoc.data();
    if (!newsletterData) {
      return NextResponse.json({ error: 'Newsletter data missing' }, { status: 404 });
    }

    if (newsletterData.status === 'sent') {
      return NextResponse.json({ error: 'This newsletter has already been sent' }, { status: 400 });
    }

    const { subject } = newsletterData;
    // Support both bodyHtml (new) and htmlContent (legacy) field names
    const htmlContent = newsletterData.bodyHtml || newsletterData.htmlContent;
    if (!htmlContent) {
      return NextResponse.json({ error: 'Newsletter has no content' }, { status: 400 });
    }

    // Get Mailchimp integration — prefer primary admin's, fall back to legacy
    const primaryMailchimpAdmin = tenantData.primaryMailchimpAdmin as string | undefined;
    let mailchimpData: Record<string, any> | undefined;

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

    if (!mailchimpData) {
      return NextResponse.json(
        { error: 'Mailchimp is not connected. Please connect Mailchimp in Settings → Integrations.' },
        { status: 400 }
      );
    }

    if (mailchimpData.status !== 'active' && mailchimpData.status !== 'connected') {
      return NextResponse.json(
        { error: 'Mailchimp connection is not active. Please reconnect in Settings → Integrations.' },
        { status: 400 }
      );
    }

    const connectedAccountId = mailchimpData.connectedAccountId as string;
    const audienceId = mailchimpData.selectedAudienceId as string;

    if (!connectedAccountId) {
      return NextResponse.json({ error: 'No Mailchimp connected account found' }, { status: 400 });
    }

    if (!audienceId) {
      return NextResponse.json(
        { error: 'No Mailchimp audience selected. Please select an audience in Settings → Integrations → Mailchimp.' },
        { status: 400 }
      );
    }

    // Step 1: Create campaign
    let campaignId: string;
    try {
      const campaignResult = await executeComposioAction(
        'MAILCHIMP_ADD_CAMPAIGN',
        {
          type: 'regular',
          'settings__subject__line': subject,
          'settings__from__name': tenantName,
          'recipients__list__id': audienceId,
        },
        connectedAccountId
      );
      campaignId = campaignResult?.data?.id || campaignResult?.id;
      if (!campaignId) {
        console.error('Mailchimp create campaign returned no ID:', campaignResult);
        return NextResponse.json({ error: 'Failed to create Mailchimp campaign' }, { status: 502 });
      }
    } catch (actionError) {
      console.error('Mailchimp create campaign error:', actionError);
      return NextResponse.json({ error: 'Failed to create Mailchimp campaign. Please try again.' }, { status: 502 });
    }

    // Step 2: Set campaign content
    const cleanHtml = sanitizeHtml(htmlContent, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'style', 'h1', 'h2', 'h3']),
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        '*': ['style', 'class'],
      },
    });

    try {
      await executeComposioAction(
        'MAILCHIMP_SET_CAMPAIGN_CONTENT',
        { campaign_id: campaignId, html: cleanHtml },
        connectedAccountId
      );
    } catch (actionError) {
      console.error('Mailchimp set content error:', actionError);
      return NextResponse.json({ error: 'Failed to set campaign content. Please try again.' }, { status: 502 });
    }

    // Step 3: Check readiness (non-fatal)
    try {
      const checklist = await executeComposioAction(
        'MAILCHIMP_GET_CAMPAIGN_SEND_CHECKLIST',
        { campaign_id: campaignId },
        connectedAccountId
      );
      const isReady = checklist?.data?.is_ready ?? checklist?.is_ready ?? true;
      if (!isReady) {
        const issues = checklist?.data?.items || [];
        console.error('Campaign not ready:', issues);
        return NextResponse.json(
          { error: 'Campaign is not ready to send. Please check your Mailchimp settings.' },
          { status: 400 }
        );
      }
    } catch (actionError) {
      console.warn('Mailchimp send checklist check failed (non-fatal):', actionError);
    }

    // Step 4: Send or schedule
    let newStatus: string;
    try {
      if (schedule) {
        await executeComposioAction(
          'MAILCHIMP_SCHEDULE_CAMPAIGN',
          { campaign_id: campaignId, schedule_time: schedule },
          connectedAccountId
        );
        newStatus = 'scheduled';
      } else {
        await executeComposioAction(
          'MAILCHIMP_SEND_CAMPAIGN',
          { campaign_id: campaignId },
          connectedAccountId
        );
        newStatus = 'sent';
      }
    } catch (actionError) {
      console.error('Mailchimp send/schedule error:', actionError);
      return NextResponse.json(
        { error: `Failed to ${schedule ? 'schedule' : 'send'} campaign. Please try again.` },
        { status: 502 }
      );
    }

    await newsletterRef.update({
      status: newStatus,
      mailchimpCampaignId: campaignId,
      sentAt: schedule || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      status: newStatus,
      mailchimpCampaignId: campaignId,
      message: schedule
        ? `Newsletter scheduled for ${new Date(schedule).toLocaleString()}`
        : 'Newsletter sent successfully!',
    });
  } catch (error) {
    console.error('Newsletter send error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
