import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * 🔴 THE-76 — ANONYMISING A DONOR MUST NOT BREAK THE CHURCH'S YEAR-END STATEMENT.
 *
 * When a member deletes their account their donation invoices are ANONYMISED,
 * not deleted: `recipientEmail` is replaced with a stable `@deleted.invalid`
 * pseudonym so the figures stay on the books. Two things have to hold after
 * that, and this file asserts both:
 *
 *   - the statement is still GENERATED, with the gifts still grouped and the
 *     total intact. A "just clear the field" anonymisation would fail here,
 *     because the generator does `if (!donorEmail) continue` and would silently
 *     drop the gifts out of the church's annual statement.
 *   - the statement is never EMAILED. `.invalid` is reserved (RFC 2606) and can
 *     never be delivered to, so sending would fail every run, inflate the
 *     `failed` count and fire a Sentry event on a statement that is fine.
 *
 * ⚠️ THE ASSERTION THAT ENCODES THE DEFECT: 'never emails a deleted donor' —
 * removing the `!donor.deleted` guard fails THAT test by name.
 */

const mockRequireAdmin = vi.fn();
const mockSendEmail = vi.fn(async (_payload: { to: string }) => ({ error: null }));
const mockFileSave = vi.fn(async () => undefined);
const store = new Map<string, Map<string, Record<string, unknown>>>();

function seed(path: string, docs: Array<Record<string, unknown> & { id: string }>) {
  const m = store.get(path) ?? new Map();
  docs.forEach(({ id, ...rest }) => m.set(id, rest));
  store.set(path, m);
}
const docsOf = (p: string) => [...(store.get(p) ?? new Map()).entries()];

function collection(path: string): Record<string, unknown> {
  const self: Record<string, unknown> = {
    orderBy: () => self,
    limit: () => self,
    where: () => self,
    doc: (id: string) => ({
      id,
      collection: (name: string) => collection(`${path}/${id}/${name}`),
      get: async () => ({ exists: store.get(path)?.has(id) ?? false, data: () => store.get(path)?.get(id) }),
      set: async (data: Record<string, unknown>, opts?: { merge?: boolean }) => {
        const m = store.get(path) ?? new Map();
        m.set(id, opts?.merge ? { ...(m.get(id) ?? {}), ...data } : data);
        store.set(path, m);
      },
    }),
    get: async () => {
      const rows = [...(store.get(path) ?? new Map()).entries()];
      return { docs: rows.map(([id, data]) => ({ id, data: () => data })), size: rows.length, empty: rows.length === 0 };
    },
  };
  return self;
}

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: (name: string) => collection(name) },
  getReceiptsBucket: () => ({ file: () => ({ save: mockFileSave }) }),
}));
vi.mock('@/lib/api-auth', () => ({ requireAdmin: mockRequireAdmin }));
vi.mock('@/lib/money-path-sentry', () => ({ captureHandledError: vi.fn() }));
vi.mock('resend', () => ({ Resend: class { emails = { send: mockSendEmail }; } }));

const { POST } = await import('../generate/route');
const { anonymisedDonorEmail } = await import('@/lib/member-deletion');

const TENANT = 'grace';
const PSEUDONYM = anonymisedDonorEmail('member-1', TENANT);

function request(body: unknown = { year: 2026, send: true }): NextRequest {
  return new NextRequest(
    new Request('https://grace.theharvest.app/api/giving-statements/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  process.env.RESEND_API_KEY = 'test-key';
  mockRequireAdmin.mockResolvedValue({ uid: 'admin-1', email: 'admin@grace.org', tenantId: TENANT, isAdmin: true });
  seed('tenants', [{ id: TENANT, name: 'Grace Chapel' }]);
  seed(`tenants/${TENANT}/invoices`, [
    // A donor who deleted their account: invoices anonymised, figures intact.
    { id: 'inv-1', type: 'donation_receipt', recipientName: 'Deleted donor', recipientEmail: PSEUDONYM, amount: 15000, issuedAt: '2026-01-02', donorDeleted: true },
    { id: 'inv-2', type: 'donation_receipt', recipientName: 'Deleted donor', recipientEmail: PSEUDONYM, amount: 10000, issuedAt: '2026-03-04', donorDeleted: true },
    // A live donor, for contrast.
    { id: 'inv-3', type: 'donation_receipt', recipientName: 'Sam', recipientEmail: 'sam@church.org', amount: 500, issuedAt: '2026-02-02' },
  ]);
});

describe('a deleted donor\'s gifts stay on the church\'s year-end statement', () => {
  it('🔴 still generates a statement for them — the anonymised email keeps the gifts grouped', async () => {
    const res = await POST(request());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalDonors).toBe(2);
    expect(body.generated).toBe(2);
    expect(body.failed).toBe(0);
  });

  it('keeps the full total — both anonymised gifts land on one statement, not zero and not two donors', async () => {
    await POST(request());
    const statements = docsOf(`tenants/${TENANT}/givingStatements`);
    const deleted = statements.find(([, d]) => (d as { donorEmail: string }).donorEmail === PSEUDONYM);
    expect(deleted, 'the deleted donor got no statement at all').toBeDefined();
    expect((deleted![1] as { totalAmount: number }).totalAmount).toBe(25000);
    expect((deleted![1] as { donationCount: number }).donationCount).toBe(2);
  });

  it('stores the PDF, so the church has the document it needs for its books', async () => {
    await POST(request());
    expect(mockFileSave).toHaveBeenCalledTimes(2);
  });

  it('🔴 never emails a deleted donor — the pseudonym is a reserved address that cannot be delivered to', async () => {
    await POST(request());

    const recipients = mockSendEmail.mock.calls.map((c) => c[0].to);
    expect(recipients, 'a statement was emailed to a deleted donor\'s pseudonym').not.toContain(PSEUDONYM);
    expect(recipients).toEqual(['sam@church.org']);
  });

  it('marks the statement generated rather than sent, and says why', async () => {
    await POST(request());
    const [, deleted] = docsOf(`tenants/${TENANT}/givingStatements`)
      .find(([, d]) => (d as { donorEmail: string }).donorEmail === PSEUDONYM)!;
    expect(deleted).toMatchObject({ status: 'generated', sentAt: null, donorDeleted: true });
  });

  it('does not count the skipped email as a failure, so no Sentry event fires for a healthy run', async () => {
    const body = await (await POST(request())).json();
    expect(body.failed).toBe(0);
    expect(body.sent).toBe(1); // only the live donor
  });

  it('still emails and sends normally for a donor who has not been deleted', async () => {
    const body = await (await POST(request())).json();
    const live = docsOf(`tenants/${TENANT}/givingStatements`)
      .find(([, d]) => (d as { donorEmail: string }).donorEmail === 'sam@church.org')!;
    expect(live[1]).toMatchObject({ status: 'sent', donorDeleted: false });
    expect(body.sent).toBe(1);
  });

  it('recognises the pseudonym even on a legacy row written before the donorDeleted flag existed', async () => {
    store.get(`tenants/${TENANT}/invoices`)!.forEach((d) => { delete (d as Record<string, unknown>).donorDeleted; });

    await POST(request());

    const recipients = mockSendEmail.mock.calls.map((c) => c[0].to);
    expect(recipients).toEqual(['sam@church.org']);
  });
});
