import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { executeComposioAction } from '@/lib/composio-client';
import { adminDb } from '@/lib/firebase-admin';
import { hasFeature } from '@/utils/plan-features';
import { PLATFORM_TENANT_ID } from '@/utils/tenant-scope';

export const dynamic = 'force-dynamic';

// MiMo (Xiaomi) Token Plan chat-completions endpoint.
//
// Contract: `MIMO_BASE_URL` is the REGION base URL exactly as shown on the
// Token Plan subscription page (e.g. https://token-plan-sgp.xiaomimimo.com/v1),
// i.e. everything up to and INCLUDING `/v1` — the code appends
// `/chat/completions`. A Token Plan key only authenticates against its own
// region's base URL, so this must be configurable per deployment. Unset →
// defaults to the China cluster, keeping current behavior byte-for-byte.
const MIMO_CHAT_URL = `${(
  process.env.MIMO_BASE_URL || 'https://token-plan-cn.xiaomimimo.com/v1'
).replace(/\/+$/, '')}/chat/completions`;
const MIMO_MODEL = 'mimo-v2.5';
const RATE_LIMIT = 5;

export async function POST(request: NextRequest) {
  try {
    const userOrResponse = await requireAdmin(request);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const { tenantId, uid, isSuperAdmin } = userOrResponse;

    const resolvedTenantId = tenantId || PLATFORM_TENANT_ID;

    let body: { startDate?: string; endDate?: string } = {};
    try {
      body = await request.json();
    } catch {
      // body is optional
    }
    const { startDate, endDate } = body;

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

    if (!isSuperAdmin && !hasFeature(tenantPlan, 'automatedNewsletter')) {
      return NextResponse.json(
        { error: 'AI newsletter generation requires the Community plan or higher.' },
        { status: 403 }
      );
    }

    // Rate limit: max 5 per tenant per day
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentNewsletters = await adminDb
      .collection('tenants').doc(resolvedTenantId).collection('newsletters')
      .where('createdAt', '>', twentyFourHoursAgo).get();

    if (recentNewsletters.size >= RATE_LIMIT) {
      return NextResponse.json(
        { error: `Rate limit reached. Maximum ${RATE_LIMIT} newsletters per day.` },
        { status: 429 }
      );
    }

    // Get Instagram integration — prefer primary admin's, fall back to legacy.
    // Track the connection OWNER's uid: a v3 Composio connection is PRIVATE, so
    // execution must use the owner's userId (the admin who connected it), which
    // is not necessarily the requesting admin.
    const primaryInstagramAdmin = tenantData.primaryInstagramAdmin as string | undefined;
    let instagramData: Record<string, any> | undefined;
    let instagramOwnerUid: string | undefined;

    if (primaryInstagramAdmin) {
      const adminIgDoc = await adminDb
        .collection('tenants').doc(resolvedTenantId)
        .collection('integrations').doc(`${primaryInstagramAdmin}_instagram`).get();
      if (adminIgDoc.exists) {
        instagramData = adminIgDoc.data() ?? undefined;
        instagramOwnerUid = primaryInstagramAdmin;
      }
    }

    if (!instagramData) {
      const legacyIgDoc = await adminDb
        .collection('tenants').doc(resolvedTenantId)
        .collection('integrations').doc('instagram').get();
      if (legacyIgDoc.exists) {
        instagramData = legacyIgDoc.data() ?? undefined;
        instagramOwnerUid = instagramData?.connectedBy as string | undefined;
      }
    }

    if (!instagramData) {
      return NextResponse.json(
        { error: 'Instagram is not connected. Please connect Instagram in Settings → Integrations.' },
        { status: 400 }
      );
    }

    if (instagramData.status !== 'active' && instagramData.status !== 'connected') {
      return NextResponse.json(
        { error: 'Instagram connection is not active. Please reconnect in Settings → Integrations.' },
        { status: 400 }
      );
    }

    const connectedAccountId = instagramData.connectedAccountId as string;
    if (!connectedAccountId) {
      return NextResponse.json({ error: 'No Instagram connected account found' }, { status: 400 });
    }

    // Compute date range for IG post filtering
    const sinceTs = startDate
      ? Math.floor(new Date(startDate).getTime() / 1000)
      : Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
    const untilTs = endDate
      ? Math.floor(new Date(endDate + 'T23:59:59').getTime() / 1000)
      : Math.floor(Date.now() / 1000);

    let posts: any[] = [];
    try {
      const result = await executeComposioAction(
        'INSTAGRAM_GET_IG_USER_MEDIA',
        {
          ig_user_id: 'me',
          since: sinceTs,
          until: untilTs,
          fields: 'id,caption,media_type,permalink,timestamp,like_count,comments_count',
        },
        connectedAccountId,
        resolvedTenantId,
        instagramOwnerUid || uid
      );
      posts = result?.data?.data || result?.data || [];
      if (!Array.isArray(posts)) posts = [];
    } catch (actionError) {
      console.error('Failed to fetch Instagram posts:', actionError);
      return NextResponse.json(
        { error: 'Failed to fetch Instagram posts. Please try again.' },
        { status: 502 }
      );
    }

    if (posts.length === 0) {
      return NextResponse.json(
        { error: 'No Instagram posts found in the selected date range. Try a wider range or post some content first!' },
        { status: 404 }
      );
    }

    const postSummaries = posts.slice(0, 20).map((post: any, i: number) => {
      const caption = (post.caption || '').slice(0, 300);
      return `Post ${i + 1}:\n- Type: ${post.media_type || 'Unknown'}\n- Caption: ${caption}${caption.length >= 300 ? '...' : ''}\n- Likes: ${post.like_count || 0}\n- Comments: ${post.comments_count || 0}\n- Link: ${post.permalink || 'N/A'}\n- Date: ${post.timestamp || 'Unknown'}`;
    }).join('\n\n');

    const systemPrompt = `You are a newsletter writer for a church/ministry called "${tenantName}". Based on the Instagram posts provided, create an engaging newsletter in HTML format.\n\nInclude:\n1. A warm, personal greeting\n2. A compelling subject line (on its own line, prefixed with "SUBJECT:")\n3. Top post highlights with engaging descriptions\n4. Key themes from the content\n5. A closing encouragement or call to action\n\nFormat the newsletter as clean, inline-styled HTML that works in email clients. Use these design colors:\n- Gold accent: #B8962E\n- Dark text: #1a1a1a\n- White background\n- Font: Arial, sans-serif\n\nAfter the HTML, add a separator "---PLAIN_TEXT---" and provide a plain text version.\n\nKeep the tone warm, encouraging, and community-focused. Do NOT include <html>, <head>, or <body> tags — just the newsletter content as a div.`;

    const userPrompt = `Here are the Instagram posts from ${tenantName}:\n\n${postSummaries}\n\nPlease create an engaging newsletter based on these posts.`;

    if (!process.env.MIMO_API_KEY) {
      return NextResponse.json({ error: 'AI service is not configured' }, { status: 500 });
    }

    let aiResponse: string;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60_000);

      const mimoRes = await fetch(MIMO_CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.MIMO_API_KEY}`,
        },
        body: JSON.stringify({
          model: MIMO_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_completion_tokens: 4096,
          temperature: 0.7,
          top_p: 0.95,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!mimoRes.ok) {
        const errBody = await mimoRes.text();
        console.error('MiMo API error:', mimoRes.status, errBody);
        return NextResponse.json({ error: 'AI service error. Please try again.' }, { status: 502 });
      }

      const mimoData = await mimoRes.json();
      aiResponse = mimoData.choices?.[0]?.message?.content || '';
    } catch (fetchError) {
      console.error('MiMo API fetch error:', fetchError);
      return NextResponse.json({ error: 'Failed to reach AI service. Please try again.' }, { status: 502 });
    }

    if (!aiResponse) {
      return NextResponse.json({ error: 'AI returned an empty response. Please try again.' }, { status: 502 });
    }

    let subject = `${tenantName} Newsletter`;
    let bodyHtml = aiResponse;
    let plainText = '';
    const parseWarnings: string[] = [];

    const subjectMatch = aiResponse.match(/subject:\s*(.+)/i);
    if (subjectMatch) {
      subject = subjectMatch[1].trim();
      bodyHtml = bodyHtml.replace(/subject:\s*.+/i, '').trim();
    } else {
      parseWarnings.push('Could not extract SUBJECT line from AI response');
    }

    const plainTextSplit = bodyHtml.split(/-{2,}\s*plain_text\s*-{2,}/i);
    if (plainTextSplit.length >= 2) {
      bodyHtml = plainTextSplit[0].trim();
      plainText = plainTextSplit.slice(1).join('---PLAIN_TEXT---').trim();
    } else {
      plainText = bodyHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      parseWarnings.push('Could not find ---PLAIN_TEXT--- separator');
    }

    if (!/<[a-z][\s\S]*>/i.test(bodyHtml)) {
      bodyHtml = `<div style="font-family:Arial,sans-serif;color:#1a1a1a;">${bodyHtml}</div>`;
      parseWarnings.push('AI response had no HTML tags; wrapped in <div>');
    }

    if (parseWarnings.length > 0) {
      console.warn('Newsletter parsing warnings:', parseWarnings);
    }

    const newsletterRef = adminDb
      .collection('tenants').doc(resolvedTenantId).collection('newsletters').doc();

    const now = new Date().toISOString();
    const newsletterDoc = {
      id: newsletterRef.id,
      tenantId: resolvedTenantId,
      tenantName,
      subject,
      bodyHtml,
      plainText,
      postsUsed: posts.length,
      postIds: posts.slice(0, 20).map((p: any) => p.id).filter(Boolean),
      status: 'draft',
      createdAt: now,
      createdBy: uid,
      updatedAt: now,
    };

    await newsletterRef.set(newsletterDoc);

    return NextResponse.json({
      newsletterId: newsletterRef.id,
      subject,
      bodyHtml,
      plainText,
      postsUsed: posts.length,
    });
  } catch (error) {
    console.error('Newsletter generate error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
