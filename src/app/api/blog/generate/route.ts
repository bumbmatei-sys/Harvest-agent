import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export const dynamic = 'force-dynamic';

// MiMo (Xiaomi) Token Plan chat-completions endpoint — same provider as the
// newsletter generator and the AI RAG chat. See src/app/api/gemini/route.ts
// for the full contract on MIMO_BASE_URL.
const MIMO_CHAT_URL = `${(
  process.env.MIMO_BASE_URL || 'https://token-plan-cn.xiaomimimo.com/v1'
).replace(/\/+$/, '')}/chat/completions`;
const MIMO_MODEL = 'mimo-v2.5';

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

/** Extract the first balanced {...} substring from text, or null if none found. */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
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
  if (!process.env.MIMO_API_KEY) throw new Error('MIMO_API_KEY not configured');

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

Respond with ONLY the JSON object below — no markdown, no backticks, no preamble, no
explanation, and no commentary of any kind, even if you have concerns about the source
material. If the source material is insufficient, still do your best to produce the
JSON object from what is available. Schema:
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

  // 3. Call MiMo for generation
  const mimoRes = await fetch(MIMO_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.MIMO_API_KEY}`,
    },
    body: JSON.stringify({
      model: MIMO_MODEL,
      messages: [{ role: 'user', content: prompt }],
      // MiMo has no responseMimeType — the prompt instructs strict JSON, and
      // the fence-stripping/parse below handles any accidental wrapping. The
      // higher token ceiling avoids truncating the ~800-1200 word article.
      max_completion_tokens: 8192,
      temperature: 0.7,
    }),
  });

  if (!mimoRes.ok) {
    const errBody = await mimoRes.text();
    console.error('MiMo API error:', mimoRes.status, errBody);
    throw new Error('AI service error while generating the article. Please try again.');
  }

  const mimoData = await mimoRes.json();
  const rawText = mimoData.choices?.[0]?.message?.content || '';

  // 4. Parse JSON response — strip any accidental markdown fences
  let parsed: any;
  try {
    const clean = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    parsed = JSON.parse(clean);
  } catch {
    // Model may have wrapped the JSON in prose (e.g. a refusal/explanation) —
    // salvage the first balanced {...} object before giving up.
    const salvaged = extractFirstJsonObject(rawText);
    if (salvaged) {
      try {
        parsed = JSON.parse(salvaged);
      } catch {
        parsed = null;
      }
    }
    if (!parsed) {
      console.error('AI returned invalid JSON. Raw response:', rawText);
      throw new Error(
        "Couldn't generate a post from your current Knowledge Base. Add ministry-focused source material (sermons, devotionals, teaching notes) to the AI Knowledge Base, then try again.",
      );
    }
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
