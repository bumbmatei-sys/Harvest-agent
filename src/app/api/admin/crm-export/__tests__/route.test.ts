import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FieldPath } from 'firebase-admin/firestore';

const { mockRequireSuperAdmin, cap } = vi.hoisted(() => ({
  mockRequireSuperAdmin: vi.fn(),
  cap: { current: 50_000 },
}));

interface Stored {
  id: string;
  data: Record<string, unknown>;
}

const db = {
  users: [] as Stored[],
  contacts: [] as Stored[],
  tenants: [] as Stored[],
  collections: [] as string[],
  limits: [] as number[],
  orderBys: [] as unknown[],
  failReads: false,
};

function queryOf(rows: Stored[]) {
  return {
    startAfter(cursor: { id: string }) {
      const idx = rows.findIndex(row => row.id === cursor.id);
      return queryOf(idx < 0 ? [] : rows.slice(idx + 1));
    },
    limit(n: number) {
      db.limits.push(n);
      const page = rows.slice(0, n);
      return {
        get: async () => {
          if (db.failReads) throw new Error('firestore unavailable');
          return {
            empty: page.length === 0,
            size: page.length,
            docs: page.map(row => ({ id: row.id, data: () => row.data })),
          };
        },
      };
    },
  };
}

const mockCollection = vi.fn((name: string) => {
  db.collections.push(name);
  const rows = name === 'users' ? db.users : name === 'contacts' ? db.contacts : name === 'tenants' ? db.tenants : [];
  return {
    orderBy(field: unknown) {
      db.orderBys.push(field);
      return queryOf(rows);
    },
    doc(id: string) {
      return { id };
    },
  };
});

const mockGetAll = vi.fn(async (...refs: Array<{ id: string }>) => refs.map(ref => {
  const found = db.tenants.find(tenant => tenant.id === ref.id);
  return { id: ref.id, exists: Boolean(found), data: () => found?.data ?? {} };
}));

vi.mock('@/lib/api-auth', () => ({ requireSuperAdmin: mockRequireSuperAdmin }));
vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: mockCollection, getAll: mockGetAll } }));
vi.mock('@/utils/tenant-scope', () => ({ PLATFORM_TENANT_ID: 'harvest' }));
vi.mock('@/lib/crm-export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/crm-export')>();
  return { ...actual, crmExportRowCap: () => cap.current };
});

const { GET, dynamic: routeDynamic, maxDuration } = await import('../route');

function req(query: string): NextRequest {
  return new NextRequest(`https://example.com/api/admin/crm-export?${query}`, {
    headers: { authorization: 'Bearer token' },
  });
}

const superAdmin = {
  uid: 'sa', email: 'owner@harvest', tenantId: null, isAdmin: true, isSuperAdmin: true,
};

function resetDb() {
  db.users = [];
  db.contacts = [];
  db.tenants = [];
  db.collections = [];
  db.limits = [];
  db.orderBys = [];
  db.failReads = false;
  cap.current = 50_000;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDb();
  mockRequireSuperAdmin.mockResolvedValue(superAdmin);
});

describe('GET /api/admin/crm-export — the gate', () => {
  it('exports dynamic and a 300s budget', () => {
    expect(routeDynamic).toBe('force-dynamic');
    expect(maxDuration).toBe(300);
  });

  it('returns 401 when unauthenticated and reads nothing', async () => {
    mockRequireSuperAdmin.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    const res = await GET(req('newsletter=all&type=all'));
    expect(res.status).toBe(401);
    expect(mockCollection).not.toHaveBeenCalled();
  });

  it('returns 403 for a tenant admin and reads nothing', async () => {
    mockRequireSuperAdmin.mockResolvedValue(new Response(
      JSON.stringify({ error: 'Super admin access required' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    ));
    const res = await GET(req('newsletter=all&type=all'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Super admin access required' });
    expect(mockCollection).not.toHaveBeenCalled();
  });

  it('returns 400 for an unknown newsletter or type before reading', async () => {
    const badNewsletter = await GET(req('newsletter=yes&type=all'));
    expect(badNewsletter.status).toBe(400);
    const badType = await GET(req('newsletter=all&type=people'));
    expect(badType.status).toBe(400);
    const missing = await GET(req(''));
    expect(missing.status).toBe(400);
    expect(mockCollection).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/crm-export — the file', () => {
  it('pages past 1,000 users and puts every one in the CSV', async () => {
    db.users = Array.from({ length: 1250 }, (_, i) => {
      const n = String(i).padStart(4, '0');
      return {
        id: `u${n}`,
        data: {
          email: `user${n}@example.com`,
          displayName: `Person ${n}`,
          role: 'user',
          tenantId: 'harvest',
          newsletterOptIn: i % 2 === 0,
          createdAt: '2020-01-15T00:00:00.000Z',
        },
      };
    });
    const res = await GET(req('newsletter=all&type=all&q='));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Disposition')).toMatch(
      /attachment; filename="harvest-crm-newsletter-all-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    expect(db.limits.every(n => n === 400)).toBe(true);
    expect(db.limits.length).toBeGreaterThan(1);
    expect(db.orderBys[0]).toBeInstanceOf(FieldPath);
    const bytes = new Uint8Array(await res.arrayBuffer());
    // response.text() strips a leading BOM; the bytes are what Excel reads.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    const body = text;
    expect(body.split('\n')[0]).toContain('Newsletter');
    for (let i = 0; i < 1250; i += 1) {
      const n = String(i).padStart(4, '0');
      expect(body, `user ${n} missing`).toContain(`user${n}@example.com`);
    }
    expect(db.collections).not.toContain('product_updates');
    expect(db.collections).not.toContain('waitlist');
  });

  it('keeps platform contacts, drops other tenants, and applies newsletter, type and search', async () => {
    db.tenants = [
      { id: 'grace', data: { name: 'Grace Church' } },
      { id: 'harvest', data: { name: 'Harvest Platform' } },
    ];
    db.users = [
      {
        id: 'ada',
        data: {
          email: 'ada@example.com', displayName: 'Ada In', role: 'user', tenantId: 'grace',
          newsletterOptIn: true, newsletterOptInSource: 'signup-email',
          createdAt: '2020-06-15T08:30:00.000Z',
        },
      },
      {
        id: 'bob',
        data: {
          email: 'bob@example.com', displayName: 'Bob Out', role: 'admin', tenantId: 'grace',
          newsletterOptIn: false, newsletter: true,
        },
      },
      {
        id: 'cara',
        data: {
          email: 'cara@example.com', displayName: 'Cara Unknown', role: 'user', tenantId: 'nowhere',
          newsletter: true,
        },
      },
    ];
    db.contacts = [
      { id: 'dan', data: { firstName: 'Dan', lastName: 'Donor', email: 'dan@example.com', type: 'donor', tenantId: 'harvest' } },
      { id: 'frank', data: { firstName: 'Frank', lastName: 'Loose', email: 'frank@example.com', type: 'donor', tenantId: null } },
      { id: 'blank', data: { firstName: 'Bea', lastName: 'Blank', email: 'bea@example.com', type: 'donor', tenantId: '' } },
      { id: 'eve', data: { firstName: 'Eve', lastName: 'Other', email: 'eve@example.com', type: 'donor', tenantId: 'other-church' } },
    ];

    const all = await GET(req('newsletter=all&type=all&q='));
    const allText = await all.text();
    expect(allText).toContain('ada@example.com');
    expect(allText).toContain('bob@example.com');
    expect(allText).toContain('cara@example.com');
    expect(allText).toContain('dan@example.com');
    expect(allText).toContain('frank@example.com');
    expect(allText).toContain('bea@example.com');
    expect(allText).not.toContain('eve@example.com');
    expect(allText).toContain('Grace Church');
    expect(allText).toContain('Harvest Platform');
    expect(allText).toContain('opted_in');
    expect(allText).toContain('opted_out');
    expect(allText).toContain('unknown');
    expect(db.collections).not.toContain('product_updates');

    const onlyIn = await GET(req('newsletter=in&type=all'));
    const inText = await onlyIn.text();
    expect(inText).toContain('ada@example.com');
    expect(inText).not.toContain('bob@example.com');
    expect(inText).not.toContain('cara@example.com');
    expect(inText).not.toContain('dan@example.com');
    expect(onlyIn.headers.get('Content-Disposition')).toMatch(/harvest-crm-newsletter-opted-in-/);

    const membersNamedAda = await GET(req('newsletter=all&type=member&q=ada'));
    const memberText = await membersNamedAda.text();
    expect(memberText).toContain('ada@example.com');
    expect(memberText).not.toContain('bob@example.com');
    expect(memberText).not.toContain('dan@example.com');

    const donors = await GET(req('newsletter=all&type=donor'));
    const donorText = await donors.text();
    expect(donorText).toContain('dan@example.com');
    expect(donorText).not.toContain('ada@example.com');
  });

  it('uses Harvest when the platform tenant doc has no name', async () => {
    db.users = [{
      id: 'p',
      data: { email: 'p@example.com', displayName: 'Pat Platform', role: 'user', tenantId: 'harvest', newsletterOptIn: true },
    }];
    const res = await GET(req('newsletter=all&type=all'));
    const text = await res.text();
    expect(text).toContain('Harvest');
    expect(text).not.toContain('Harvest Platform');
  });

  it('returns 413 JSON instead of a truncated file when the cap is exceeded', async () => {
    cap.current = 2;
    db.users = [0, 1, 2].map(i => ({
      id: `u${i}`,
      data: { email: `u${i}@example.com`, displayName: `U ${i}`, role: 'user', tenantId: 'harvest' },
    }));
    const res = await GET(req('newsletter=all&type=all'));
    expect(res.status).toBe(413);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const body = await res.json();
    expect(body.error).toMatch(/over the limit of 2/);
    expect(body.error).toMatch(/No file was created/);
    expect(JSON.stringify(body)).not.toContain('u0@example.com');
  });

  it('returns 500 JSON when Firestore fails, never an empty 200', async () => {
    db.failReads = true;
    db.users = [{ id: 'u', data: { email: 'u@example.com', displayName: 'U', role: 'user' } }];
    const res = await GET(req('newsletter=all&type=all'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/Could not read contacts/);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });
});
