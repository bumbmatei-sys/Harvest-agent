import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockRequireAuth, mockGenerateContent } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockGenerateContent: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  requireAuth: mockRequireAuth,
  verifyAuth: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = { generateContent: mockGenerateContent };
  },
}));

const { POST } = await import('../lesson-generate/route');

function makeRequest(body: object): NextRequest {
  return new NextRequest('https://example.com/api/lesson-generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: 'Bearer token' },
    body: JSON.stringify(body),
  });
}

function geminiResponse(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

const validLessonJson = JSON.stringify({
  title: 'Grace Abounds',
  summary: 'A study of grace.',
  outline: [{ title: 'Grace', text: 'Unmerited favor.' }],
  quiz: [{ q: 'What is grace?', options: [{ text: 'Favor', correct: true }, { text: 'Law', correct: false }] }],
  scripture: 'Ephesians 2:8',
  videoSummary: 'A recap of the teaching on grace.',
});

const user = { uid: 'u1', email: 't@t.com', tenantId: 'tenant1', isAdmin: true, isSuperAdmin: false };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  mockRequireAuth.mockResolvedValue(user);
});

describe('POST /api/lesson-generate', () => {
  it('returns 401 when unauthenticated', async () => {
    mockRequireAuth.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    const res = await POST(makeRequest({ url: 'https://youtu.be/dQw4w9WgXcQ' }));
    expect(res.status).toBe(401);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('returns 500 when GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await POST(makeRequest({ url: 'https://youtu.be/dQw4w9WgXcQ' }));
    expect(res.status).toBe(500);
  });

  it('returns 400 for an unparseable URL', async () => {
    const res = await POST(makeRequest({ url: 'https://vimeo.com/12345' }));
    expect(res.status).toBe(400);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('returns parsed, reviewable lesson content on success', async () => {
    mockGenerateContent.mockResolvedValue(geminiResponse(validLessonJson));
    const res = await POST(makeRequest({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lesson.title).toBe('Grace Abounds');
    expect(body.lesson.scripture).toBe('Ephesians 2:8');
    expect(body.lesson.quiz[0].options).toHaveLength(2);
  });

  it('passes the YouTube URL as a fileData video part (native video input)', async () => {
    mockGenerateContent.mockResolvedValue(geminiResponse(validLessonJson));
    await POST(makeRequest({ url: 'https://youtu.be/dQw4w9WgXcQ' }));
    const arg = mockGenerateContent.mock.calls[0][0];
    const parts = arg.contents[0].parts;
    expect(parts[0].fileData.fileUri).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(arg.config.responseMimeType).toBe('application/json');
  });

  it('strips a leaked verse text down to a bare scripture reference', async () => {
    mockGenerateContent.mockResolvedValue(
      geminiResponse(
        JSON.stringify({
          title: 'T',
          summary: 'S',
          scripture: 'John 1:14 - "And the Word became flesh"',
        }),
      ),
    );
    const res = await POST(makeRequest({ url: 'https://youtu.be/dQw4w9WgXcQ' }));
    const body = await res.json();
    expect(body.lesson.scripture).toBe('John 1:14');
  });

  it('returns 422 when the model returns unusable content', async () => {
    mockGenerateContent.mockResolvedValue(geminiResponse('I cannot watch this video.'));
    const res = await POST(makeRequest({ url: 'https://youtu.be/dQw4w9WgXcQ' }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/fill the lesson in manually/i);
  });

  it('returns 502 with a fill-manually message when Gemini throws (private/unavailable)', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Video is private'));
    const res = await POST(makeRequest({ url: 'https://youtu.be/dQw4w9WgXcQ' }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/fill the lesson in manually/i);
  });
});
