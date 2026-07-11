import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { extractYouTubeId, formatIsoDuration } from '@/lib/youtube';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/youtube-meta
 *
 * Body: { url: string }  — a YouTube URL (or bare video id)
 *
 * Reads the video's EXACT length + title via the YouTube Data API v3
 * (videos.list → contentDetails.duration, snippet.title). Used by the course
 * builder's "Generate with AI" so the lesson duration is the real length rather
 * than a Gemini guess. YOUTUBE_API_KEY stays server-side — the browser never
 * sees it.
 *
 * Returns: { videoId, duration, isoDuration, title }
 */
export async function POST(request: NextRequest) {
  try {
    const userOrErr = await requireAuth(request);
    if (userOrErr instanceof Response) return userOrErr;

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'YOUTUBE_API_KEY is not configured on the server.' },
        { status: 500 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const url: string = body.url || body.videoId || '';
    const videoId = extractYouTubeId(url);
    if (!videoId) {
      return NextResponse.json(
        { error: 'Could not parse a YouTube video ID from the URL.' },
        { status: 400 },
      );
    }

    const api = new URL('https://www.googleapis.com/youtube/v3/videos');
    api.searchParams.set('part', 'contentDetails,snippet');
    api.searchParams.set('id', videoId);
    api.searchParams.set('key', apiKey);

    const res = await fetch(api.toString());
    if (!res.ok) {
      const errText = await res.text();
      console.error('YouTube Data API error:', res.status, errText);
      return NextResponse.json(
        { error: `YouTube API error: ${res.status}` },
        { status: 502 },
      );
    }

    const data = await res.json();
    const item = data.items?.[0];
    if (!item) {
      return NextResponse.json(
        { error: 'Video not found — it may be private, deleted, or the URL is wrong.' },
        { status: 404 },
      );
    }

    const isoDuration: string = item.contentDetails?.duration || '';
    return NextResponse.json({
      videoId,
      isoDuration,
      duration: formatIsoDuration(isoDuration),
      title: item.snippet?.title || '',
    });
  } catch (err: any) {
    console.error('youtube-meta route error:', err?.message || err);
    return NextResponse.json({ error: 'Failed to fetch video metadata.' }, { status: 502 });
  }
}
