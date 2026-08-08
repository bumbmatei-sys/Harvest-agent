import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getMimoChatUrl, MIMO_MODEL } from '@/lib/ai-config';
import { captureHandledError } from '@/lib/money-path-sentry';
import {
  getMinPlanForFeatureCell,
  hasFeature,
  toTenantPlan,
  PLAN_DISPLAY_NAMES,
  TOP_PLAN,
} from '@/utils/plan-features';

/** Cheapest plan whose matrix cell unlocks automated blog, for the 403 copy. */
const AUTOMATED_BLOG_MIN_PLAN =
  PLAN_DISPLAY_NAMES[getMinPlanForFeatureCell('automatedBlog') ?? TOP_PLAN];

export const dynamic = 'force-dynamic';

/**
 * Get the UTC offset (in minutes, added to local time to get UTC) that `timezone`
 * observes at the instant `date`. Uses Intl instead of a fixed table so DST is
 * handled correctly for whatever date is passed in.
 */
function getTimezoneOffsetMinutes(date: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(date).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  // Reinterpret the wall-clock time the zone shows for `date` as if it were UTC —
  // the gap between that and `date` itself is the zone's offset at that instant.
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  return (asUtc - date.getTime()) / 60000;
}

/**
 * Convert a LOCAL wall-clock time (in `timezone`) to its UTC instant. A first
 * guess reads the offset at the naive UTC interpretation of the wall-clock
 * time; that guess can land on the wrong side of a DST transition, so a
 * second pass re-resolves the offset from the guessed instant itself, which
 * is enough to converge for the once/day granularity this scheduler needs.
 */
function zonedTimeToUtc(
  year: number, month: number, day: number, hour: number,
  timezone: string,
): Date {
  const naiveUtc = Date.UTC(year, month, day, hour, 0, 0, 0);
  const offset = getTimezoneOffsetMinutes(new Date(naiveUtc), timezone);
  const candidate = naiveUtc - offset * 60000;
  const refinedOffset = getTimezoneOffsetMinutes(new Date(candidate), timezone);
  return new Date(naiveUtc - refinedOffset * 60000);
}

/**
 * Get the local (in `timezone`) calendar date/weekday for a given instant.
 */
function getZonedDateParts(
  date: Date, timezone: string,
): { year: number; month: number; day: number; weekday: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const parts = dtf.formatToParts(date).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    year: Number(parts.year),
    month: Number(parts.month) - 1,
    day: Number(parts.day),
    weekday: weekdays.indexOf(parts.weekday),
  };
}

/**
 * Compute the next scheduled timestamp from frequency settings. `hour` is the
 * LOCAL hour (0-23) in `timezone`; the result is the corresponding UTC instant.
 * `timezone` defaults to 'UTC', which reproduces the pre-timezone behavior
 * exactly (existing tenants with no stored timezone are unaffected).
 */
export function computeNextScheduled(
  frequency: string,
  dayOfWeek: number,
  hour: number,
  timezone: string = 'UTC',
): Date {
  const now = new Date();
  const nowLocal = getZonedDateParts(now, timezone);

  let targetDay: number; // day-of-month offset from nowLocal, in local calendar terms
  switch (frequency) {
    case 'daily':
      targetDay = nowLocal.day + 1;
      break;
    case 'weekly': {
      const daysUntil = (dayOfWeek - nowLocal.weekday + 7) % 7 || 7;
      targetDay = nowLocal.day + daysUntil;
      break;
    }
    case 'biweekly': {
      const daysUntil = (dayOfWeek - nowLocal.weekday + 7) % 7 || 7;
      targetDay = nowLocal.day + daysUntil + 7;
      break;
    }
    case 'monthly':
      return zonedTimeToUtc(nowLocal.year, nowLocal.month + 1, nowLocal.day, hour, timezone);
    default:
      targetDay = nowLocal.day + 7;
  }
  return zonedTimeToUtc(nowLocal.year, nowLocal.month, targetDay, hour, timezone);
}

/**
 * Why a generation attempt failed, so callers can report the failure that
 * actually happened instead of guessing at one.
 *
 * `no-context` is the only kind that is the tenant's to fix. The other two are
 * ours, and saying otherwise sends someone to spend an afternoon uploading
 * sermons to fix a JSON parsing bug.
 */
export type BlogGenerationFailure = 'no-context' | 'invalid-json' | 'truncated-output';

/**
 * A generation failure that knows which kind it is and carries the bounded
 * diagnostics needed to investigate it.
 *
 * The diagnostics ride on the error rather than being captured where they are
 * discovered, so the failure still produces exactly ONE Sentry event — raised
 * here, reported by whichever caller catches it.
 */
export class BlogGenerationError extends Error {
  readonly kind: BlogGenerationFailure;
  readonly diagnostics: Record<string, string | number>;

  constructor(
    kind: BlogGenerationFailure,
    message: string,
    diagnostics: Record<string, string | number> = {},
  ) {
    super(message);
    this.name = 'BlogGenerationError';
    this.kind = kind;
    this.diagnostics = { failureKind: kind, ...diagnostics };
  }
}

/**
 * Below this much retrieved source material, "there isn't enough to write from"
 * is a fair reading of a failed generation and the add-source-material message
 * is the honest one. Above it, the knowledge base plainly had something to work
 * with and a failure is ours to explain. Roughly a couple of paragraphs — a
 * tenant with real sermon content clears it by an order of magnitude.
 */
const MIN_CONTEXT_CHARS_FOR_ARTICLE = 800;

/** The add-source-material message. Correct ONLY when context is the problem. */
const NO_CONTEXT_MESSAGE =
  "Couldn't generate a post from your current Knowledge Base. Add ministry-focused source material (sermons, devotionals, teaching notes) to the AI Knowledge Base, then try again.";

/**
 * Escape raw control characters that appear INSIDE JSON string literals.
 *
 * JSON forbids a literal newline in a string; `JSON.parse` rejects the whole
 * document over one. A model writing a long `htmlContent` value is very likely
 * to lay it out across lines, and that alone is enough to fail a response whose
 * content is otherwise perfect. Quote tracking mirrors `extractFirstJsonObject`
 * so an escaped `\"` inside a value doesn't end the string early.
 */
function escapeControlCharsInStrings(text: string): string {
  let out = '';
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      out += char;
      escapeNext = false;
      continue;
    }
    if (char === '\\' && inString) {
      out += char;
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      out += char;
      continue;
    }
    if (inString) {
      if (char === '\n') { out += '\\n'; continue; }
      if (char === '\r') { out += '\\r'; continue; }
      if (char === '\t') { out += '\\t'; continue; }
      const code = char.charCodeAt(0);
      if (code < 0x20) {
        out += `\\u${code.toString(16).padStart(4, '0')}`;
        continue;
      }
    }
    out += char;
  }
  return out;
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

    // Plan gate — derived from the `automatedBlog` matrix cell rather than a
    // literal tier list, so the gate follows the matrix instead of drifting from
    // it. Unknown/missing plan fails closed to 'plus' via toTenantPlan.
    const tenantDoc = await adminDb.collection('tenants').doc(tenantId).get();
    const plan = tenantDoc.data()?.plan || 'plus';
    if (!hasFeature(toTenantPlan(plan), 'automatedBlog')) {
      return NextResponse.json(
        { error: `Automated blog requires the ${AUTOMATED_BLOG_MIN_PLAN} plan` },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const topicHint: string = body.topicHint || '';

    return NextResponse.json(await generateAndSavePost(tenantId, topicHint));
  } catch (err: any) {
    console.error('Blog generate error:', err?.message || err);
    // generateAndSavePost publishes the post BEFORE updating the automation
    // stats, so a failure on that last write means a live published article the
    // admin was told failed — and retrying publishes a second one.
    captureHandledError(err, {
      step: 'blog-generate',
      diagnostics: err instanceof BlogGenerationError ? err.diagnostics : undefined,
    });
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

  // 1. Load the tenant's LIVE knowledge sources first, so we can drop any chunk
  //    whose source has been deleted. Orphaned chunks (left behind by an earlier
  //    failed source delete) must never feed generation — otherwise the blog
  //    writes about content the founder already removed from the AI Knowledge UI.
  const sourcesSnap = await adminDb
    .collection('rag_sources')
    .where('tenantId', '==', tenantId)
    .get();
  const liveSourceIds = new Set<string>(
    sourcesSnap.docs.map((d) => d.data().sourceId).filter(Boolean),
  );

  // 2. Fetch the NEWEST 25 rag_chunks for this tenant. Ordering by createdAt
  //    desc uses the founder's most recent content instead of whatever Firestore
  //    returns first (which could be stale). Requires the composite index
  //    rag_chunks(tenantId ASC, createdAt DESC) — see firestore.indexes.json.
  const chunksSnap = await adminDb
    .collection('rag_chunks')
    .where('tenantId', '==', tenantId)
    .orderBy('createdAt', 'desc')
    .limit(25)
    .get();

  // 3. Structurally exclude orphaned chunks (source no longer exists) even if
  //    the cleanup script hasn't been run yet.
  const liveChunks = chunksSnap.docs.filter((d) =>
    liveSourceIds.has(d.data().sourceId),
  );

  if (liveChunks.length === 0) {
    throw new BlogGenerationError(
      'no-context',
      'No knowledge base content found. Please upload documents to the AI Knowledge Base first.',
      { chunksUsed: 0, contextChars: 0 },
    );
  }

  const knowledgeContext = liveChunks
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

ARTICLE STRUCTURE — the HTML that goes in the "htmlContent" field, in this order:
  <h1>the title</h1>
  <p>compelling intro paragraph — include the primary keyword naturally in the first 100 words</p>
  <h2>Section 1 heading — descriptive, keyword-related</h2>
  <p>section content</p>
  ... (3-5 H2 sections total, each with 1-3 paragraphs)
  <h2>Conclusion</h2>
  <p>summary paragraph</p>
  <p>call to action — invite readers to engage with the ministry</p>

SEO requirements for the article HTML:
- Primary keyword used naturally 3-5 times total
- 2-3 related/LSI keywords used throughout
- Each H2 contains a relevant keyword or phrase
- Total length: 800-1200 words
- Short paragraphs (2-4 sentences max) for mobile readability
- No keyword stuffing — reads naturally

Respond with ONLY the JSON object below — no markdown, no backticks, no preamble, no
explanation, and no commentary of any kind, even if you have concerns about the source
material. If the source material is insufficient, still do your best to produce the
JSON object from what is available.

FORMATTING RULES, both mandatory:
1. The response must be ONE valid JSON object that JSON.parse accepts.
2. Every value must be on a SINGLE line. Never put a real line break inside a
   string — the whole article HTML goes in "htmlContent" as one unbroken line.
   Use "\\n" if you need a line break, or no break at all (HTML doesn't need one).

Schema (types shown as values; replace each with real content):
{"seoTitle":"50-60 characters, primary keyword near start, compelling","seoDescription":"140-155 characters, includes primary keyword, clear value proposition, encourages clicks","slug":"kebab-case, 3-6 words, primary keyword included, no special chars","keywords":["5-8","target","keywords"],"title":"article headline, can be slightly longer/more creative than seoTitle","category":"one of: Faith, Ministry, Discipleship, Community, Worship, Outreach, Leadership","tags":["3-5","topic","tags"],"estimatedReadTime":5,"htmlContent":"<h1>…</h1><p>…</p><h2>…</h2><p>…</p><h2>Conclusion</h2><p>…</p><p>…</p>"}`;

  // 3. Call MiMo for generation
  const mimoRes = await fetch(getMimoChatUrl(), {
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
  // 'length' means the model hit the output ceiling mid-article. That produces
  // JSON that never closes its braces, which is indistinguishable from garbage
  // at the parse but entirely distinguishable here.
  const finishReason: string = mimoData.choices?.[0]?.finish_reason || 'unknown';

  // 4. Parse JSON response. Four attempts, cheapest first: as-is (after
  //    stripping accidental markdown fences), then with raw control characters
  //    inside string values escaped, then the same two against the first
  //    balanced {...} object salvaged from surrounding prose.
  const fenceStripped = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const salvaged = extractFirstJsonObject(rawText);

  let parsed: any = null;
  for (const candidate of [
    fenceStripped,
    escapeControlCharsInStrings(fenceStripped),
    salvaged,
    salvaged === null ? null : escapeControlCharsInStrings(salvaged),
  ]) {
    if (!candidate) continue;
    try {
      const result = JSON.parse(candidate);
      // A bare string/number is valid JSON but not an article.
      if (result && typeof result === 'object') {
        parsed = result;
        break;
      }
    } catch {
      // Try the next repair.
    }
  }

  if (!parsed) {
    console.error('AI returned invalid JSON. Raw response:', rawText);

    // Report the failure that actually occurred. The knowledge base was read
    // successfully to get here — `liveChunks` is non-empty and its content went
    // into the prompt — so blaming the tenant's source material is only honest
    // when there was barely any of it.
    const diagnostics = {
      finishReason,
      rawResponseLength: rawText.length,
      contextChars: knowledgeContext.length,
      chunksUsed: liveChunks.length,
      // Bounded and redacted by captureHandledError on the way to Sentry.
      rawResponseExcerpt: rawText,
    };

    if (knowledgeContext.length < MIN_CONTEXT_CHARS_FOR_ARTICLE) {
      throw new BlogGenerationError('no-context', NO_CONTEXT_MESSAGE, diagnostics);
    }
    if (finishReason === 'length') {
      throw new BlogGenerationError(
        'truncated-output',
        'The AI ran out of room and its article was cut off before it finished, so there was nothing complete to publish. This is a length limit on our side, not a problem with your Knowledge Base. Please try again.',
        diagnostics,
      );
    }
    throw new BlogGenerationError(
      'invalid-json',
      "The AI's response came back in a format we couldn't read, so there was nothing to publish. Your Knowledge Base was read fine and this is a fault on our side — please try again, and contact support if it keeps happening.",
      diagnostics,
    );
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
