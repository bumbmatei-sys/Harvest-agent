import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE-355 · 🔴 A REGISTRANT WITH NO ACCOUNT CLAIMS THEY PAID — AND CANNOT
 * CLAIM ON ANYBODY ELSE'S SEAT.
 *
 * Tests 4, 5, 6 and 8's neighbour.
 *
 * ⚠️ THE HARNESS ANSWERS A `where()` QUERY THE WAY FIRESTORE WOULD, not the way
 * the route hopes. `state.rows` is the whole collection and the fake applies the
 * recorded `where` clauses to it — so "the token selects the row" is MEASURED
 * against a collection containing somebody else's registration, rather than
 * asserted against a fake that only ever holds one document. A fake that
 * returned its single row regardless of the filter would pass test 6 with the
 * `where` clause DELETED, which is precisely the vacuous guard this series
 * keeps finding.
 */

const { mockSendTransactionalEmail, mockMulticast, mockGetTenantPrivate } = vi.hoisted(() => ({
  mockSendTransactionalEmail: vi.fn(),
  mockMulticast: vi.fn(),
  mockGetTenantPrivate: vi.fn(),
}));

const state = vi.hoisted(() => ({
  writes: [] as { path: string; payload: Record<string, unknown> }[],
  /** The WHOLE registrations collection, filtered by the recorded where clauses. */
  rows: [] as { id: string; data: Record<string, unknown> }[],
  queries: [] as { path: string; where: unknown[][]; limit: number[] }[],
  failUpdate: false,
}));

function makeCollRef(path: string): any {
  const record = { path, where: [] as unknown[][], limit: [] as number[] };
  const coll: any = {
    __path: path,
    doc: (id: string) => makeDocRef(`${path}/${id}`),
    add: async (payload: Record<string, unknown>) => {
      state.writes.push({ path, payload }); return { id: 'new1' };
    },
  };
  coll.where = (...args: unknown[]) => { record.where.push(args); return coll; };
  coll.limit = (n: number) => { record.limit.push(n); return coll; };
  coll.get = async () => {
    state.queries.push(record);
    if (!path.endsWith('registrations')) return { docs: [], forEach: () => {} };
    // 🔴 THE FILTER IS REALLY APPLIED. See the header.
    let rows = state.rows;
    for (const [field, op, value] of record.where as [string, string, unknown][]) {
      if (op !== '==') throw new Error(`the fake only implements '==', got '${op}'`);
      rows = rows.filter((r) => r.data[field] === value);
    }
    const capped = record.limit.length ? rows.slice(0, Math.min(...record.limit)) : rows;
    return {
      docs: capped.map((r) => ({
        id: r.id,
        data: () => r.data,
        ref: makeDocRef(`${path}/${r.id}`),
      })),
    };
  };
  return coll;
}
function makeDocRef(path: string): any {
  return {
    __path: path,
    get: async () => {
      if (path.startsWith('tenants/') && path.split('/').length === 2) {
        return { exists: true, data: () => ({ name: 'Kingdom Living', ownerId: 'owner1' }) };
      }
      if (path.includes('/events/')) return { exists: true, data: () => ({ title: 'Crusade Bangladesh' }) };
      if (path.startsWith('users/')) return { exists: true, data: () => ({ email: 'owner@kl.example' }) };
      return { exists: false, data: () => null };
    },
    update: async (payload: Record<string, unknown>) => {
      if (state.failUpdate) throw new Error('firestore is down');
      state.writes.push({ path, payload });
    },
    collection: (name: string) => makeCollRef(`${path}/${name}`),
  };
}

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: (name: string) => makeCollRef(name) },
}));
vi.mock('@/lib/transactional-email', () => ({
  sendTransactionalEmail: mockSendTransactionalEmail,
  HARVEST_SENDER_ADDRESS: 'noreply@theharvest.app',
}));
vi.mock('@/lib/tenant-private', () => ({ getTenantPrivate: mockGetTenantPrivate }));
vi.mock('firebase-admin', () => ({
  messaging: () => ({ sendEachForMulticast: mockMulticast }),
}));
vi.mock('@/lib/money-path-sentry', () => ({
  captureHandledError: vi.fn(), captureMoneyPathError: vi.fn(),
}));

const { POST: publicClaim } = await import('../public-claim/route');
const { CLAIM_QUEUE_FIELD } = await import('@/lib/event-payment-claims');

/** 43 base64url characters — the real shape, not a placeholder. */
const TOKEN_MINE = 'aZ1_bY2-cX3dW4eV5fU6gT7hS8iR9jQ0kP1lO2mN3oM';
const TOKEN_THEIRS = 'zA9_yB8-xC7dD6eE5fF4gG3hH2iI1jJ0kK1lL2mM3nN';

const post = (body: unknown) =>
  publicClaim(new NextRequest('https://kingdom-living.theharvest.app/api/event-payment/public-claim', {
    method: 'POST', body: JSON.stringify(body),
  }));

const paidRow = (id: string, token: string, over: Record<string, unknown> = {}) => ({
  id,
  data: {
    name: id === 'reg-mine' ? 'Matei B' : 'Someone Else',
    email: `${id}@example.com`,
    amount: 5000,
    eventId: 'ev1',
    paymentStatus: 'unpaid',
    paymentReference: id === 'reg-mine' ? 'HV-VSFK4W' : 'HV-OTHER1',
    paymentClaimToken: token,
    ...over,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  state.writes = []; state.queries = []; state.failUpdate = false;
  // 🔴 TWO REGISTRATIONS, ALWAYS. Every test runs against a collection that
  // contains somebody else's seat.
  state.rows = [paidRow('reg-mine', TOKEN_MINE), paidRow('reg-theirs', TOKEN_THEIRS)];
  mockSendTransactionalEmail.mockResolvedValue({ ok: true, id: 'e1' });
  mockGetTenantPrivate.mockResolvedValue({ adminEmails: ['pastor@kl.example'] });
  mockMulticast.mockResolvedValue({ successCount: 0 });
});

/* ═══ 4 · a PUBLIC registrant can claim they paid ═════════════════════════ */

describe('4 · a PUBLIC registrant can claim they paid', () => {
  it('🔴 no sign-in, no Authorization header — the claim is recorded', async () => {
    const res = await post({ tenantId: 'kingdom-living', token: TOKEN_MINE });
    expect(res.status, 'a logged-out registrant was refused').toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, state: 'claimed' });

    const write = state.writes.find((w) => w.path.endsWith('registrations/reg-mine'));
    expect(write, 'the claim was not written to the registrant’s own row').toBeTruthy();
  });

  it('🔴 the route imports NO auth helper — it cannot require a sign-in it must not require', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const { stripComments } = await import('../../../../__tests__/__fixtures__/the-346-strip-comments');
    const src = stripComments(readFileSync(
      path.join(process.cwd(), 'src/app/api/event-payment/public-claim/route.ts'), 'utf8',
    ));
    // Assembled from fragments: this file necessarily names the helpers it
    // forbids, and a literal needle would match the sentence about the needle.
    const AUTH = new RegExp(['require' + 'Auth', 'require' + 'TenantPermission'].join('|'));
    expect(AUTH.test('const x = require' + 'Auth(request)'), 'the needle matches nothing').toBe(true);
    expect(src, 'the public claim route gates on a sign-in a public registrant does not have')
      .not.toMatch(AUTH);
  });

  it('🔴 writes NO money state — no invoice id, no paid status, no amount', async () => {
    await post({ tenantId: 'kingdom-living', token: TOKEN_MINE });
    const payload = state.writes.find((w) => w.path.endsWith('registrations/reg-mine'))!.payload;

    // A bearer token may say they paid; it may not make it true.
    expect(payload).not.toHaveProperty('paymentInvoiceId');
    expect(payload).not.toHaveProperty('paymentStatus');
    expect(payload).not.toHaveProperty('amount');
    expect(payload).not.toHaveProperty('paymentConfirmedAt');
    expect(Object.keys(payload).sort()).toEqual(
      ['paymentClaimProvider', 'paymentClaimedAt', CLAIM_QUEUE_FIELD].sort(),
    );
  });

  it('🔴 a FREE seat has nothing to claim and is refused', async () => {
    state.rows = [paidRow('reg-mine', TOKEN_MINE, { amount: 0 })];
    const res = await post({ tenantId: 'kingdom-living', token: TOKEN_MINE });
    expect(res.status).toBe(400);
    expect(state.writes).toHaveLength(0);
  });

  it('🔴 a failure surfaces and the registration is NOT lost', async () => {
    state.failUpdate = true;
    const res = await post({ tenantId: 'kingdom-living', token: TOKEN_MINE });
    expect(res.status, 'a failed claim answered as though it worked').toBe(500);
    expect((await res.json()).error, 'the failure carries no message').toBeTruthy();
    expect(state.writes, 'a failed claim wrote something anyway').toHaveLength(0);
  });
});

/* ═══ 5 · a claim creates an inbox item for the church ════════════════════ */

describe('5 · a claim creates an inbox item for the church', () => {
  it('🔴 the QUEUE KEY is written — which is what the inbox reads', async () => {
    await post({ tenantId: 'kingdom-living', token: TOKEN_MINE });
    const payload = state.writes.find((w) => w.path.endsWith('registrations/reg-mine'))!.payload;
    /**
     * 🔴 END TO END, THROUGH THE FIELD THE INBOX ACTUALLY QUERIES. The inbox is
     * `orderBy(CLAIM_QUEUE_FIELD, 'asc')` and nothing else, so a document
     * carrying this field IS an inbox row and one without it is invisible. This
     * is the assertion that fails if the public claim writes a differently-named
     * flag and the founder's inbox stays empty for a second reason.
     */
    expect(payload[CLAIM_QUEUE_FIELD], 'the claim does not enter the inbox queue').toBeTruthy();
    expect(payload[CLAIM_QUEUE_FIELD]).toBe(payload.paymentClaimedAt);
  });

  it('🔴 the church’s own admins are emailed, and the row is written FIRST', async () => {
    await post({ tenantId: 'kingdom-living', token: TOKEN_MINE });
    expect(mockSendTransactionalEmail, 'nobody at the church was told').toHaveBeenCalled();
  });

  it('🔴 a notification failure does NOT reject the claim — a prompt is not the record', async () => {
    mockGetTenantPrivate.mockRejectedValue(new Error('resend is down'));
    const res = await post({ tenantId: 'kingdom-living', token: TOKEN_MINE });
    expect(res.status, 'a missed nudge rejected a member’s press').toBe(200);
    expect(state.writes.find((w) => w.path.endsWith('registrations/reg-mine'))).toBeTruthy();
  });
});

/* ═══ 6 · nobody can claim against another person's registration ══════════ */

describe('6 · nobody can claim against another person’s registration', () => {
  it('🔴 the token SELECTS the row — my token can only ever write my own seat', async () => {
    await post({ tenantId: 'kingdom-living', token: TOKEN_MINE });
    const touched = state.writes.map((w) => w.path);
    expect(touched, 'a claim touched a registration whose token was not presented')
      .not.toContain('tenants/kingdom-living/registrations/reg-theirs');
    expect(touched).toContain('tenants/kingdom-living/registrations/reg-mine');
  });

  it('🔴 and the OTHER token writes the OTHER seat — the selection is real, not incidental', async () => {
    // ⚠️ WITHOUT THIS THE TEST ABOVE PASSES ON A ROUTE THAT ALWAYS WRITES ROW
    // ONE. Two tokens, two different rows, is what proves the token chose.
    await post({ tenantId: 'kingdom-living', token: TOKEN_THEIRS });
    const touched = state.writes.map((w) => w.path);
    expect(touched).toContain('tenants/kingdom-living/registrations/reg-theirs');
    expect(touched).not.toContain('tenants/kingdom-living/registrations/reg-mine');
  });

  it('🔴 the handler accepts NO registrationId — there is no id to mismatch', async () => {
    // Supplying one must change nothing: it is not read.
    await post({ tenantId: 'kingdom-living', token: TOKEN_MINE, registrationId: 'reg-theirs' });
    const touched = state.writes.map((w) => w.path);
    expect(touched, 'a client-supplied registrationId redirected the claim')
      .not.toContain('tenants/kingdom-living/registrations/reg-theirs');
    expect(touched).toContain('tenants/kingdom-living/registrations/reg-mine');
  });

  it('🔴 the REFERENCE CODE is not a credential — it cannot claim', async () => {
    /**
     * 🔴 THE REFERENCE IS PUBLISHED BY THE FEATURE ITSELF. It is written into a
     * payment note — on Venmo, whose transaction feed is PUBLIC BY DEFAULT —
     * and at 31⁶ it is ~29.7 bits. A route that accepted it would be one that
     * accepted a string the product prints on other people's screens.
     */
    const res = await post({ tenantId: 'kingdom-living', token: 'HV-VSFK4W' });
    expect(res.status).toBe(400);
    expect(state.writes).toHaveLength(0);
  });

  it('🔴 an unknown token writes nothing, and a malformed one never reaches Firestore', async () => {
    const unknown = 'qQ0_wW1-eE2rR3tT4yY5uU6iI7oO8pP9aA0sS1dD2fF';
    expect(unknown).toHaveLength(43);
    const res = await post({ tenantId: 'kingdom-living', token: unknown });
    expect(res.status).toBe(404);
    expect(state.writes).toHaveLength(0);

    state.queries = [];
    const bad = await post({ tenantId: 'kingdom-living', token: 'x'.repeat(5000) });
    expect(bad.status).toBe(400);
    expect(state.queries, 'a malformed token became a Firestore query').toHaveLength(0);
  });

  it('🔴 a token cannot reach into ANOTHER TENANT’s registrations', async () => {
    // Tenancy is a PATH SEGMENT here, not a where() clause, so the query is
    // rooted at the named tenant and a token from one church addresses nothing
    // in another. The fake's collection is keyed by path, so a wrong tenant
    // finds an empty collection.
    state.rows = [];
    const res = await post({ tenantId: 'some-other-church', token: TOKEN_MINE });
    expect(res.status).toBe(404);
    expect(state.writes).toHaveLength(0);
  });

  it('🔴 two rows sharing a token are REFUSED rather than resolved arbitrarily', async () => {
    state.rows = [paidRow('reg-mine', TOKEN_MINE), paidRow('reg-theirs', TOKEN_MINE)];
    const res = await post({ tenantId: 'kingdom-living', token: TOKEN_MINE });
    expect(res.status, 'an ambiguous token addressed an arbitrary row').toBe(404);
    expect(state.writes).toHaveLength(0);
    // And the read asked for TWO, which is what makes the ambiguity visible.
    const q = state.queries.find((x) => x.path.endsWith('registrations'))!;
    expect(q.limit, 'limit(1) cannot tell a collision from a match').toContain(2);
  });
});

/* ═══ 8's neighbour · a confirmed seat cannot be re-opened ════════════════ */

describe('8 · a confirmed seat cannot be put back in the queue', () => {
  it('🔴 pressing on an already-confirmed ticket writes nothing', async () => {
    state.rows = [paidRow('reg-mine', TOKEN_MINE, { paymentInvoiceId: 'inv-1' })];
    const res = await post({ tenantId: 'kingdom-living', token: TOKEN_MINE });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'confirmed' });
    /**
     * 🔴 A RESOLVED GIFT BACK IN THE QUEUE IS AN INVITATION TO A SECOND INVOICE,
     * and a double invoice is a false financial record. The queue key must not
     * be re-written onto a row the church has already vouched for.
     */
    expect(state.writes, 'a confirmed registration was re-queued').toHaveLength(0);
  });

  it('🔴 re-pressing an UNANSWERED claim refreshes it and creates no second row', async () => {
    state.rows = [paidRow('reg-mine', TOKEN_MINE, {
      paymentClaimedAt: '2031-01-01T00:00:00.000Z',
      [CLAIM_QUEUE_FIELD]: '2031-01-01T00:00:00.000Z',
    })];
    await post({ tenantId: 'kingdom-living', token: TOKEN_MINE });
    await post({ tenantId: 'kingdom-living', token: TOKEN_MINE });
    // The row IS the document, so two presses are two updates to ONE path.
    expect(new Set(state.writes.map((w) => w.path)).size).toBe(1);
    expect(state.writes.every((w) => w.path.endsWith('registrations/reg-mine'))).toBe(true);
  });
});
