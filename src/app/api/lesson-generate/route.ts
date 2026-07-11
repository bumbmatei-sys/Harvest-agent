import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { requireAuth } from '@/lib/api-auth';
import { extractYouTubeId, canonicalYouTubeUrl } from '@/lib/youtube';
import { parseLessonGenerationJson } from '@/lib/lesson-content';

export const dynamic = 'force-dynamic';
// Video understanding is slow — give Gemini room to watch a full lesson.
export const maxDuration = 300;

// Gemini model with native video (incl. YouTube URL) understanding.
const VIDEO_MODEL = 'gemini-2.5-flash';

// The lesson-content contract. STRICT JSON so the client can map it straight
// onto the lesson editor's fields (title/summary/outline/quiz/scripture) and,
// optionally, feed videoSummary into AI Knowledge.
const GENERATION_PROMPT = `You are helping a Christian ministry admin turn ONE of their OWN teaching videos into structured course-lesson content. Watch the video and draft the lesson fields FROM ITS ACTUAL SPOKEN CONTENT. Do not invent doctrine, facts, or scripture that is not in the video.

Return ONLY a valid JSON object — no markdown, no backticks, no preamble — matching EXACTLY this schema:
{
  "title": "string — a concise, specific lesson title drawn from the video",
  "summary": "string — 2-4 sentence summary of what this lesson teaches",
  "outline": [
    { "title": "string — a teaching point", "text": "string — 1-3 sentence elaboration" }
  ],
  "quiz": [
    {
      "q": "string — a question that checks understanding of the video",
      "options": [ { "text": "string — an answer choice", "correct": true or false } ]
    }
  ],
  "scripture": "string — a SINGLE Bible reference in the form \\"Book Chapter:Verse\\" (e.g. \\"John 1:14\\")",
  "videoSummary": "string — a 1-2 paragraph plain-text recap of the teaching, suitable for a searchable knowledge base"
}

Rules:
- 3 to 6 outline points.
- 3 to 5 quiz questions; each question has 3-4 options with EXACTLY ONE marked "correct": true.
- scripture must be a REFERENCE ONLY (book chapter:verse). NEVER include the verse text itself. If the video centers on no clear passage, use an empty string "".
- Keep everything grounded in what is actually said in the video.`;

/**
 * POST /api/lesson-generate
 *
 * Body: { url: string }  — a YouTube URL of an EXISTING video (input only; this
 * route does NOT create video). Passes the URL to Gemini as a native video part
 * and returns drafted, REVIEWABLE lesson fields. GEMINI_API_KEY stays
 * server-side. Public videos only (a Gemini limitation).
 *
 * Success: { lesson: GeneratedLessonContent }
 * Failure: { error } with 4xx/5xx so the client tells the admin to fill in
 * the lesson manually — we never fabricate content on failure.
 */
export async function POST(request: NextRequest) {
  try {
    const userOrErr = await requireAuth(request);
    if (userOrErr instanceof Response) return userOrErr;

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY is not configured on the server.' },
        { status: 500 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const videoId = extractYouTubeId(body.url || '');
    if (!videoId) {
      return NextResponse.json(
        { error: 'Could not parse a YouTube video ID from the URL.' },
        { status: 400 },
      );
    }
    const youtubeUrl = canonicalYouTubeUrl(videoId);

    let rawText = '';
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const result = await ai.models.generateContent({
        model: VIDEO_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              { fileData: { fileUri: youtubeUrl } },
              { text: GENERATION_PROMPT },
            ],
          },
        ],
        // responseMimeType keeps the model from wrapping JSON in fences; the
        // low temperature keeps it faithful to the video.
        config: { temperature: 0.4, maxOutputTokens: 4096, responseMimeType: 'application/json' },
      });

      rawText =
        result.candidates?.[0]?.content?.parts
          ?.map((p: any) => p?.text || '')
          .join('') || '';
    } catch (genErr: any) {
      // Gemini rejects private/unavailable/unsupported videos — surface a clear
      // "fill manually" message instead of a generic 500.
      const message = genErr?.message || String(genErr);
      console.error('lesson-generate Gemini error:', genErr?.status ?? genErr?.code, message);
      return NextResponse.json(
        {
          error:
            'This video could not be processed (it may be private, unavailable, or too long). Please fill the lesson in manually.',
          detail: message,
        },
        { status: 502 },
      );
    }

    const lesson = parseLessonGenerationJson(rawText);
    if (!lesson) {
      return NextResponse.json(
        {
          error:
            'The AI could not produce structured content for this video. Please fill the lesson in manually.',
        },
        { status: 422 },
      );
    }

    return NextResponse.json({ lesson });
  } catch (err: any) {
    console.error('lesson-generate route error:', err?.message || err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
