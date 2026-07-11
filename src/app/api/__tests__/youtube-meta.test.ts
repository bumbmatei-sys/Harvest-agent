import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockRequireAuth } = vi.hoisted(() => ({ mockRequireAuth: vi.fn() }));

vi.mock('@/lib/api-auth', () => ({
  requireAuth: mockRequireAuth,
  verifyAuth: vi.fn(),
}));

const { POST } = await import('../youtube-meta/route');

function makeRequest(body: object): NextRequest {
  return new NextRequest('https://example.com/api/youtube-meta', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: 'Bearer token' },
    body: JSON.stringify(body),
  });
}

const user = { uid: 'u1', email: 't@t.com', tenantId: 'tenant1', isAdmin: true, isSuperAdmin: false };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.YOUTUBE_API_KEY = 'yt-test-key';
  mockRequireAuth.mockResolvedValue(user);
});

describe('POST /api/youtube-meta', () => {
  it('returns 401 when unauthenticated', async () => {
    mockRequireAuth.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    const res = await POST(makeRequest({ url: 'https://youtu.be/dQw4w9WgXcQ' }));
    expect(res.status).toBe(401);
  });

  it('returns 500 when YOUTUBE_API_KEY is not set', async () => {
    delete process.env.YOUTUBE_API_KEY;
    const res = await POST(makeRequest({ url: 'https://youtu.be/dQw4w9WgXcQ' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/YOUTUBE_API_KEY/);
  });

  it('returns 400 when the URL has no parseable video id', async () => {
    const res = await POST(makeRequest({ url: 'https://vimeo.com/12345' }));
    expect(res.status).toBe(400);
  });

  it('returns the parsed duration + title on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          items: [
            { contentDetails: { duration: 'PT34M12S' }, snippet: { title: 'My Lesson' } },
          ],
        }),
      }),
    );
    const res = await POST(makeRequest({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      videoId: 'dQw4w9WgXcQ',
      isoDuration: 'PT34M12S',
      duration: '34 min',
      title: 'My Lesson',
    });
  });

  it('returns 404 when the video is not found', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ items: [] }) }),
    );
    const res = await POST(makeRequest({ url: 'https://youtu.be/dQw4w9WgXcQ' }));
    expect(res.status).toBe(404);
  });

  it('returns 502 when the YouTube API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403, text: vi.fn().mockResolvedValue('quota') }),
    );
    const res = await POST(makeRequest({ url: 'https://youtu.be/dQw4w9WgXcQ' }));
    expect(res.status).toBe(502);
  });

  it('never sends the API key to the client (only server-side in the fetch URL)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ items: [{ contentDetails: { duration: 'PT5M' }, snippet: { title: 'x' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await POST(makeRequest({ url: 'https://youtu.be/dQw4w9WgXcQ' }));
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('yt-test-key');
    // Key is used server-side against the Google API host.
    expect(String(fetchMock.mock.calls[0][0])).toContain('key=yt-test-key');
  });
});
