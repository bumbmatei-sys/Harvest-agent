import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const PLATFORM_TENANT_ID = 'harvest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const { mockRequireAdmin, mockGetDocumentProxy, mockExtractText, mockSend } = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockGetDocumentProxy: vi.fn(),
  mockExtractText: vi.fn(),
  mockSend: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ requireAdmin: mockRequireAdmin }));
vi.mock('unpdf', () => ({
  getDocumentProxy: mockGetDocumentProxy,
  extractText: mockExtractText,
}));
// tenant-scope pulls in the firebase client SDK; only the constant matters here.
vi.mock('@/utils/tenant-scope', () => ({ PLATFORM_TENANT_ID: 'harvest' }));
vi.mock('@/lib/r2', () => ({
  createR2Client: () => ({ send: mockSend }),
  r2Bucket: () => 'test-bucket',
}));
// Tag each command so the fake `send` can tell head/get/delete apart.
vi.mock('@aws-sdk/client-s3', () => {
  class Cmd {
    type = '';
    constructor(public input: any) {}
  }
  class HeadObjectCommand extends Cmd { type = 'head'; }
  class GetObjectCommand extends Cmd { type = 'get'; }
  class DeleteObjectCommand extends Cmd { type = 'delete'; }
  return { HeadObjectCommand, GetObjectCommand, DeleteObjectCommand, S3Client: class {} };
});

const { POST } = await import('../extract/route');

// ── Helpers ────────────────────────────────────────────────────────────────
const OWN_KEY = 'tenants/t1/uploads/abc-123-sermon.pdf';

function makeRequest(body: unknown, { badJson = false } = {}): any {
  return {
    json: async () => {
      if (badJson) throw new SyntaxError('Unexpected token');
      return body;
    },
  };
}

/** Commands the route actually sent, in order. */
const sentTypes = () => mockSend.mock.calls.map(([c]: any[]) => c.type);
const deletedKeys = () =>
  mockSend.mock.calls.filter(([c]: any[]) => c.type === 'delete').map(([c]: any[]) => c.input.Key);

function notFoundError() {
  const e: any = new Error('Not Found');
  e.name = 'NotFound';
  e.$metadata = { httpStatusCode: 404 };
  return e;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mockRequireAdmin.mockResolvedValue({ uid: 'u1', tenantId: 't1', isAdmin: true, isSuperAdmin: false });
  mockSend.mockImplementation(async (cmd: any) => {
    if (cmd.type === 'head') return { ContentLength: 2048 };
    if (cmd.type === 'get') {
      return { Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } };
    }
    return {};
  });
});

describe('POST /api/rag/extract — auth & input', () => {
  it('returns the auth response when not an admin — nothing touches storage', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'Admin access required' }, { status: 403 }));
    const res = await POST(makeRequest({ r2Key: OWN_KEY }));
    expect(res.status).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockGetDocumentProxy).not.toHaveBeenCalled();
  });

  it('returns 400 on a non-JSON body', async () => {
    const res = await POST(makeRequest(null, { badJson: true }));
    expect(res.status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 when no r2Key is provided', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('POST /api/rag/extract — tenant boundary', () => {
  it("403s a key belonging to a DIFFERENT tenant — and never reads from R2", async () => {
    const res = await POST(makeRequest({ r2Key: 'tenants/t2/uploads/abc-123-payroll.pdf' }));
    expect(res.status).toBe(403);
    // The whole point: no HeadObject, no GetObject, nothing.
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockGetDocumentProxy).not.toHaveBeenCalled();
  });

  it('403s a key outside the uploads/ prefix', async () => {
    const res = await POST(makeRequest({ r2Key: 'tenants/t1/private/abc-123-notes.pdf' }));
    expect(res.status).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('403s a traversal-shaped key that merely starts with the prefix', async () => {
    const res = await POST(
      makeRequest({ r2Key: 'tenants/t1/uploads/../../t2/uploads/payroll.pdf' }),
    );
    expect(res.status).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('403s a prefix-collision tenant (t1 vs t10)', async () => {
    const res = await POST(makeRequest({ r2Key: 'tenants/t10/uploads/abc-123-x.pdf' }));
    expect(res.status).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('400s a non-PDF key inside the caller\'s own prefix — never parsed', async () => {
    const res = await POST(makeRequest({ r2Key: 'tenants/t1/uploads/abc-123-gifts.xlsx' }));
    expect(res.status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockGetDocumentProxy).not.toHaveBeenCalled();
  });
});

describe('POST /api/rag/extract — super admin', () => {
  const SUPER_KEY = `tenants/${PLATFORM_TENANT_ID}/uploads/abc-123-sermon.pdf`;

  beforeEach(() => {
    mockRequireAdmin.mockResolvedValue({ uid: 'root', tenantId: null, isAdmin: true, isSuperAdmin: true });
    mockGetDocumentProxy.mockResolvedValue({});
    mockExtractText.mockResolvedValue({ text: 'Platform doc.', totalPages: 1 });
  });

  it('resolves tenantId: null to the platform tenant and extracts', async () => {
    const res = await POST(makeRequest({ r2Key: SUPER_KEY }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'Platform doc.' });
  });

  it('never accepts a tenants/null/... key', async () => {
    const res = await POST(makeRequest({ r2Key: 'tenants/null/uploads/abc-123-sermon.pdf' }));
    expect(res.status).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('POST /api/rag/extract — size, from R2 not the client', () => {
  it('413s when the stored object exceeds the cap, naming the real limit', async () => {
    mockSend.mockImplementation(async (cmd: any) => {
      if (cmd.type === 'head') return { ContentLength: 16 * 1024 * 1024 };
      return {};
    });

    const res = await POST(makeRequest({ r2Key: OWN_KEY }));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('File is too large (max 15MB).');
    // Never downloaded, but still cleaned up.
    expect(sentTypes()).toEqual(['head', 'delete']);
    expect(deletedKeys()).toEqual([OWN_KEY]);
  });

  it('404s when the object is missing', async () => {
    mockSend.mockImplementation(async (cmd: any) => {
      if (cmd.type === 'head') throw notFoundError();
      return {};
    });

    const res = await POST(makeRequest({ r2Key: OWN_KEY }));
    expect(res.status).toBe(404);
    expect(mockGetDocumentProxy).not.toHaveBeenCalled();
  });
});

describe('POST /api/rag/extract — PDF', () => {
  it('returns extracted text and deletes the temp object', async () => {
    mockGetDocumentProxy.mockResolvedValue({});
    mockExtractText.mockResolvedValue({ text: 'Blessed are the peacemakers.', totalPages: 1 });

    const res = await POST(makeRequest({ r2Key: OWN_KEY }));
    expect(res.status).toBe(200);
    expect((await res.json()).text).toBe('Blessed are the peacemakers.');

    expect(sentTypes()).toEqual(['head', 'get', 'delete']);
    expect(deletedKeys()).toEqual([OWN_KEY]);
  });

  it('422 (no_text) for a scanned / image-only PDF — embeds nothing, object deleted', async () => {
    mockGetDocumentProxy.mockResolvedValue({});
    mockExtractText.mockResolvedValue({ text: '   \n  ', totalPages: 3 });

    const res = await POST(makeRequest({ r2Key: OWN_KEY }));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('no_text');
    expect(deletedKeys()).toEqual([OWN_KEY]);
  });

  it('422 (encrypted) for a password-protected PDF — object deleted', async () => {
    const err: any = new Error('needs password');
    err.name = 'PasswordException';
    mockGetDocumentProxy.mockRejectedValue(err);

    const res = await POST(makeRequest({ r2Key: OWN_KEY }));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('encrypted');
    expect(mockExtractText).not.toHaveBeenCalled();
    expect(deletedKeys()).toEqual([OWN_KEY]);
  });

  it('422 (corrupt) for an unreadable PDF — object deleted', async () => {
    mockGetDocumentProxy.mockRejectedValue(new Error('Invalid PDF structure.'));

    const res = await POST(makeRequest({ r2Key: OWN_KEY }));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('corrupt');
    expect(deletedKeys()).toEqual([OWN_KEY]);
  });

  it('500s (and still deletes) when R2 fails unexpectedly on the download', async () => {
    mockSend.mockImplementation(async (cmd: any) => {
      if (cmd.type === 'head') return { ContentLength: 2048 };
      if (cmd.type === 'get') throw new Error('R2 exploded');
      return {};
    });

    const res = await POST(makeRequest({ r2Key: OWN_KEY }));
    expect(res.status).toBe(500);
    expect(deletedKeys()).toEqual([OWN_KEY]);
  });

  it('a failed delete is best-effort — the success response is unchanged', async () => {
    mockGetDocumentProxy.mockResolvedValue({});
    mockExtractText.mockResolvedValue({ text: 'Still fine.', totalPages: 1 });
    mockSend.mockImplementation(async (cmd: any) => {
      if (cmd.type === 'head') return { ContentLength: 2048 };
      if (cmd.type === 'get') {
        return { Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } };
      }
      throw new Error('delete failed');
    });

    const res = await POST(makeRequest({ r2Key: OWN_KEY }));
    expect(res.status).toBe(200);
    expect((await res.json()).text).toBe('Still fine.');
  });
});
