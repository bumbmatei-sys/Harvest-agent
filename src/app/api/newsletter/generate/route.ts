import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { executeComposioAction } from '@/lib/composio-client';
import { adminDb } from '@/lib/firebase-admin';
import { hasFeature } from '@/utils/plan-features';

export const dynamic = 'force-dynamic';

const MIMO_BASE_URL = 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions';
const MIMO_MODEL = 'mimo-v2.5';
const RATE_LIMIT = 5;

/**
 * POST /api/newsletter/generate
 * Generates a newsletter draft from recent Instagram posts using AI.
 */
export async function POST(request: NextRequest) {
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

    // Get tenant data for plan check and name
    const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
    if (!tenantDoc.exists) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const tenantData = tenantDoc.data();
    if (!tenantData) {
      return NextResponse.json({ error: 'Tenant data missing' }, { status: 404 });
    }

    const tenantPlan = tenantData.plan || 'plus';
    const tenantName = tenantData.name || 'Your Ministry';

    // Plan feature check
    if (!hasFeature(tenantPlan, 'newsletterAutomation')) {
      return NextResponse.json(
        { error: 'Newsletter automation is not available on your current plan. Please upgrade to Pro or higher.' },
        { status: 403 }
      );
    }

    // Rate limit: max 5 per tenant per day
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentNewsletters = await adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('newsletters')
      .where('generatedAt', '>', twentyFourHoursAgo)
      .get();

    if (recentNewsletters.size >= RATE_LIMIT) {
      return NextResponse.json(
        { error: `Rate limit reached. Maximum ${RATE_LIMIT} newsletters per day.` },
        { status: 429 }
      );
    }

    // Get Instagram integration
    const instagramDoc = await adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('integrations')
      .doc('instagram')
      .get();

    if (!instagramDoc.exists) {
      return NextResponse.json(
        { error: 'Instagram is not connected. Please connect Instagram in Settings → Integrations.' },
        { status: 400 }
      );
    }

    const instagramData = instagramDoc.data();
    if (!instagramData || (instagramData.status !== 'active' && instagramData.status !== 'connected')) {
      return NextResponse.json(
        { error: 'Instagram connection is not active. Please reconnect in Settings → Integrations.' },
        { status: 400 }
      );
    }

    const connectedAccountId = instagramData.connectedAccountId;
    if (!connectedAccountId) {
      return NextResponse.json(
        { error: 'No Instagram connected account found' },
        { status: 400 }
      );
    }

    // Fetch posts from last 30 days
    const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);

    let posts: any[] = [];
    try {
      const result = await executeComposioAction(
        'INSTAGRAM_GET_IG_USER_MEDIA',
        {
          ig_user_id: 'me',
          since: thirtyDaysAgo,
          fields: 'id,caption,media_type,permalink,timestamp,like_count,comments_count',
        },
        connectedAccountId
      );

      posts = result?.data?.data || result?.data || [];
      if (!Array.isArray(posts)) {
        posts = [];
      }
    } catch (actionError) {
      console.error('Failed to fetch Instagram posts:', actionError);
      return NextResponse.json(
        { error: 'Failed to fetch Instagram posts. Please try again.' },
        { status: 502 }
      );
    }

    if (posts.length === 0) {
      return NextResponse.json(
        { error: 'No Instagram posts found from the past 30 days. Post some content first!' },
        { status: 404 }
      );
    }

    // Build post summaries for AI
    const postSummaries = posts.slice(0, 20).map((post: any, i: number) => {
      const caption = (post.caption || '').slice(0, 300);
      return `Post ${i + 1}:
- Type: ${post.media_type || 'Unknown'}
- Caption: ${caption}${caption.length >= 300 ? '...' : ''}
- Likes: ${post.like_count || 0}
- Comments: ${post.comments_count || 0}
- Link: ${post.permalink || 'N/A'}
- Date: ${post.timestamp || 'Unknown'}`;
    }).join('\n\n');

    // Generate newsletter with MiMo AI
    const systemPrompt = `You are a newsletter writer for a church/ministry called "${tenantName}". Based on the Instagram posts from the past month, create an engaging newsletter in HTML format.

Include:
1. A warm, personal greeting
2. A compelling subject line (on its own line, prefixed with "SUBJECT:")
3. Top post highlights with engaging descriptions
4. Key themes from the month's content
5. A closing encouragement or call to action

Format the newsletter as clean, inline-styled HTML that works in email clients. Use these design colors:
- Gold accent: #C9963A
- Navy text: #0b1121
- White background
- Font: Arial, sans-serif

After the HTML, add a separator "---PLAIN_TEXT---" and provide a plain text version of the newsletter.

Keep the tone warm, encouraging, and community-focused. Do NOT include <html>, <head>, or <body> tags — just the newsletter content as a div.`;

    const userPrompt = `Here are the Instagram posts from ${tenantName} over the past 30 days:\n\n${postSummaries}\n\nPlease create an engaging newsletter based on these posts.`;

    if (!process.env.MIMO_API_KEY) {
      return NextResponse.json(
        { error: 'AI service is not configured' },
        { status: 500 }
      );
    }

    let aiResponse: string;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60_000);

      const mimoRes = await fetch(MIMO_BASE_URL, {
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
        return NextResponse.json(
          { error: 'AI service error. Please try again.' },
          { status: 502 }
        );
      }

      const mimoData = await mimoRes.json();
      aiResponse = mimoData.choices?.[0]?.message?.content || '';
    } catch (fetchError) {
      console.error('MiMo API fetch error:', fetchError);
      return NextResponse.json(
        { error: 'Failed to reach AI service. Please try again.' },
        { status: 502 }
      );
    }

    if (!aiResponse) {
      return NextResponse.json(
        { error: 'AI returned an empty response. Please try again.' },
        { status: 502 }
      );
    }

    // Parse subject and content from AI response
    let subject = `${tenantName} Monthly Newsletter`;
    let htmlContent = aiResponse;
    let plainText = '';
    let parseWarnings: string[] = [];

    // Extract subject line (case-insensitive, flexible whitespace)
    const subjectMatch = aiResponse.match(/subject:\s*(.+)/i);
    if (subjectMatch) {
      subject = subjectMatch[1].trim();
      htmlContent = htmlContent.replace(/subject:\s*.+/i, '').trim();
    } else {
      parseWarnings.push('Could not extract SUBJECT line from AI response');
    }

    // Split HTML and plain text (flexible dashes: ---, --, ----, etc.)
    const plainTextSplit = htmlContent.split(/-{2,}\s*plain_text\s*-{2,}/i);
    if (plainTextSplit.length >= 2) {
      htmlContent = plainTextSplit[0].trim();
      plainText = plainTextSplit.slice(1).join('---PLAIN_TEXT---').trim();
    } else {
      // Fallback: strip HTML tags for plain text
      plainText = htmlContent.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      parseWarnings.push('Could not find ---PLAIN_TEXT--- separator');
    }

    // Validate HTML contains at least one tag; wrap bare text if missing
    if (!/<[a-z][\s\S]*>/i.test(htmlContent)) {
      htmlContent = `<div style="font-family:Arial,sans-serif;color:#0b1121;">${htmlContent}</div>`;
      parseWarnings.push('AI response had no HTML tags; wrapped in <div>');
    }

    if (parseWarnings.length > 0) {
      console.warn('Newsletter parsing warnings:', parseWarnings);
    }

    // Save newsletter draft to Firestore
    const newsletterRef = adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('newsletters')
      .doc();

    const newsletterDoc = {
      id: newsletterRef.id,
      tenantId,
      tenantName,
      subject,
      htmlContent,
      plainText,
      postsUsed: posts.length,
      postIds: posts.slice(0, 20).map((p: any) => p.id).filter(Boolean),
      status: 'draft',
      generatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await newsletterRef.set(newsletterDoc);

    return NextResponse.json({
      newsletterId: newsletterRef.id,
      subject,
      htmlContent,
      plainText,
      postsUsed: posts.length,
    });
  } catch (error) {
    console.error('Newsletter generate error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
