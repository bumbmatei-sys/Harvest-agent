import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { GoogleGenAI } from '@google/genai';

export const dynamic = 'force-dynamic';

/** Compute the next scheduled timestamp from frequency settings. */
export function computeNextScheduled(
  frequency: string,
  dayOfWeek: number,
  hour: number,
): Date {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(hour, 0, 0, 0);

  switch (frequency) {
    case 'daily':
      next.setUTCDate(now.getUTCDate() + 1);
      break;
    case 'weekly': {
      const daysUntil = (dayOfWeek - now.getUTCDay() + 7) % 7 || 7;
      next.setUTCDate(now.getUTCDate() + daysUntil);
      break;
    }
    case 'biweekly': {
      const daysUntil = (dayOfWeek - now.getUTCDay() + 7) % 7 || 7;
      next.setUTCDate(now.getUTCDate() + daysUntil + 7);
      break;
    }
    case 'monthly':
      next.setUTCMonth(now.getUTCMonth() + 1);
      break;
    default:
      next.setUTCDate(now.getUTCDate() + 7);
  }
  return next;
}

export async function POST(request: NextRequest) {
  try {
    const userOrErr = await requireAdmin(request);
    if (userOrErr instanceof Response) return userOrErr;

    const { tenantId } = userOrErr;
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant' }, { status: 400 });
    }

    // Plan gate — max or ultra only
    const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
    const plan = tenantDoc.data()?.plan || 'plus';
    if (!['max', 'ultra'].includes(plan)) {
      return NextResponse.json(
        { error: 'Automated blog requires Community or Ministry plan' },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const topicHint: string = body.topicHint || '';

    return NextResponse.json(await generateAndSavePost(tenantId, topicHint));
  } catch (err: any) {
    console.error('Blog generate error:', err?.message || err);
    return NextResponse.json(
      { error: err?.message || 'Failed to generate article' },
      { status: 500 },
    );
  }
}

/** Shared generation logic used by both the manual POST and the cron. */
export async function generateAndSavePost(
  tenantId: string,
  topicHint: string,
): Promise<{ postId: string; title: string }> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) throw new Error('GEMINI_API_KEY not configured');

  // 1. Fetch up to 25 rag_chunks for this tenant (sample for context)
  const chunksSnap = await adminDb
    .collection('rag_chunks')
    .where('tenantId', '==', tenantId)
    .limit(25)
    .get();

  if (chunksSnap.empty) {
    throw new Error(
      'No knowledge base content found. Please upload documents to the AI Knowledge Base first.',
    );
  }

  const knowledgeContext = chunksSnap.docs
    .map((d, i) => `[${i + 1}] ${d.data().chunk}`)
    .join('\n\n');

  const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
  const ministryName: string = tenantDoc.data()?.name || 'Our Ministry';

  // 2. Build SEO-focused generation prompt
  const prompt = `You are an expert SEO content writer specializing in faith-based ministry content.

Generate a fully SEO-optimized blog article for "${ministryName}" using ONLY the source material below.
Do not invent facts, doctrine, or events not present in the source material.

${topicHint ? `Topic focus: ${topicHint}\n` : ''}

SOURCE MATERIAL (ministry knowledge base):
${knowledgeContext}

Return ONLY a valid JSON object with NO markdown, NO backticks, NO preamble. Schema:
{
  "seoTitle": "string — 50-60 characters, primary keyword near start, compelling",
  "seoDescription": "string — 140-155 characters, includes primary keyword, clear value proposition, encourages clicks",
  "slug": "string — kebab-case, 3-6 words, primary keyword included, no special chars",
  "keywords": ["array", "of", "5-8", "target", "keywords"],
  "title": "string — article headline, can be slightly longer/more creative than seoTitle",
  "category": "string — one of: Faith, Ministry, Discipleship, Community, Worship, Outreach, Leadership",
  "tags": ["array", "of", "3-5", "topic", "tags"],
  "estimatedReadTime": number (minutes, integer),
  "htmlContent": "string — full article HTML with this exact structure:
    <h1>{title}</h1>
    <p>{compelling intro paragraph — include primary keyword naturally in first 100 words}</p>
    <h2>{Section 1 heading — descriptive, keyword-related}</h2>
    <p>{section content}</p>
    ... (3-5 H2 sections total, each with 1-3 paragraphs)
    <h2>Conclusion</h2>
    <p>{summary paragraph}</p>
    <p>{call to action — invite readers to engage with the ministry}</p>

    SEO requirements for htmlContent:
    - Primary keyword used naturally 3-5 times total
    - 2-3 related/LSI keywords used throughout
    - Each H2 contains a relevant keyword or phrase
    - Total length: 800-1200 words
    - Short paragraphs (2-4 sentences max) for mobile readability
    - No keyword stuffing — reads naturally"
}`;

  // 3. Call Gemini for generation
  const ai = new GoogleGenAI({ apiKey: geminiKey });
  const result = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    // responseMimeType keeps the model from wrapping JSON in markdown fences;
    // a higher token ceiling avoids truncating the ~800-1200 word article into
    // invalid JSON.
    config: { temperature: 0.7, maxOutputTokens: 8192, responseMimeType: 'application/json' },
  });

  const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // 4. Parse JSON response — strip any accidental markdown fences
  let parsed: any;
  try {
    const clean = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    parsed = JSON.parse(clean);
  } catch {
    throw new Error('AI returned invalid JSON. Raw: ' + rawText.slice(0, 300));
  }

  // 5. Validate required fields
  const required = ['seoTitle', 'seoDescription', 'slug', 'title', 'htmlContent'];
  for (const field of required) {
    if (!parsed[field]) throw new Error(`AI response missing field: ${field}`);
  }

  // 6. Save to blog_posts
  const now = new Date();
  const ref = await adminDb.collection('blog_posts').add({
    tenantId,
    title: parsed.title,
    category: parsed.category || 'Faith',
    status: 'published',
    content: parsed.htmlContent,
    tags: parsed.tags || parsed.keywords?.slice(0, 5) || [],
    featuredImage: '',
    publishedAt: now.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    authorId: 'system',
    // SEO fields
    seoTitle: parsed.seoTitle,
    seoDescription: parsed.seoDescription,
    slug: parsed.slug,
    keywords: parsed.keywords || [],
    estimatedReadTime: parsed.estimatedReadTime || 5,
    isAiGenerated: true,
  });

  // 7. Update automation stats
  await adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('blogAutomation')
    .doc('settings')
    .set(
      {
        lastGeneratedAt: FieldValue.serverTimestamp(),
        totalGenerated: FieldValue.increment(1),
      },
      { merge: true },
    );

  console.log(`✅ AI blog post generated for ${tenantId}: "${parsed.title}"`);
  return { postId: ref.id, title: parsed.title };
}
