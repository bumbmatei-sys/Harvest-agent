import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const { mockRequireAdmin, mockGetDocumentProxy, mockExtractText } = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockGetDocumentProxy: vi.fn(),
  mockExtractText: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireAdmin: mockRequireAdmin }));
vi.mock('unpdf', () => ({
  getDocumentProxy: mockGetDocumentProxy,
  extractText: mockExtractText,
}));

const { POST } = await import('../extract/route');

// ── Helpers ────────────────────────────────────────────────────────────────
// requireAdmin is mocked, so the route only ever touches request.formData().
function makeRequest(file: File | null): any {
  const form = new FormData();
  if (file) form.append('file', file);
  return { formData: async () => form };
}

function pdf(name = 'sermon.pdf'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'application/pdf' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue({ uid: 'u1', tenantId: 't1', isAdmin: true, isSuperAdmin: false });
});

describe('POST /api/rag/extract — auth & input', () => {
  it('returns the auth response when not an admin', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'Admin access required' }, { status: 403 }));
    const res = await POST(makeRequest(pdf()));
    expect(res.status).toBe(403);
    expect(mockGetDocumentProxy).not.toHaveBeenCalled();
  });

  it('returns 400 when no file is provided', async () => {
    const res = await POST(makeRequest(null));
    expect(res.status).toBe(400);
  });

  it('rejects a non-PDF file (e.g. .xlsx) with 400 — never parsed', async () => {
    const xlsx = new File([new Uint8Array([80, 75, 3, 4])], 'gifts.xlsx');
    const res = await POST(makeRequest(xlsx));
    expect(res.status).toBe(400);
    expect(mockGetDocumentProxy).not.toHaveBeenCalled();
  });
});

describe('POST /api/rag/extract — PDF', () => {
  it('returns extracted text for a text-based PDF', async () => {
    mockGetDocumentProxy.mockResolvedValue({});
    mockExtractText.mockResolvedValue({ text: 'Blessed are the peacemakers.', totalPages: 1 });

    const res = await POST(makeRequest(pdf()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBe('Blessed are the peacemakers.');
  });

  it('422 (no_text) for a scanned / image-only PDF — embeds nothing', async () => {
    mockGetDocumentProxy.mockResolvedValue({});
    mockExtractText.mockResolvedValue({ text: '   \n  ', totalPages: 3 });

    const res = await POST(makeRequest(pdf()));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('no_text');
  });

  it('422 (encrypted) for a password-protected PDF', async () => {
    const err: any = new Error('needs password');
    err.name = 'PasswordException';
    mockGetDocumentProxy.mockRejectedValue(err);

    const res = await POST(makeRequest(pdf()));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('encrypted');
    expect(mockExtractText).not.toHaveBeenCalled();
  });

  it('422 (corrupt) for an unreadable PDF', async () => {
    mockGetDocumentProxy.mockRejectedValue(new Error('Invalid PDF structure.'));

    const res = await POST(makeRequest(pdf()));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('corrupt');
  });
});
