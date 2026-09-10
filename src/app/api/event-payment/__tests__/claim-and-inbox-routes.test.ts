import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE-351 · 🔴 "I'VE PAID" CONFIRMS NOTHING, AND THE INBOX IS ORDERED AND
 * TENANT-SCOPED.
 *
 * Tests 4, 5, 7, 14c, 14d, 14e, 14f, 14g and 20.
 */

const { mockRequireAuth, mockRequireTenantPermission } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockRequireTenantPermission: vi.fn(),
}));
const { mockSendTransactionalEmail, mockMulticast, mockGetTenantPrivate } = vi.hoisted(() => ({
  mockSendTransactionalEmail: vi.fn(),
  mockMulticast: vi.fn(),
  mockGetTenantPrivate: vi.fn(),
}));

const state = vi.hoisted(() => ({
  writes: [] as { path: string; payload: Record<string, unknown> }[],
  reg: {} as Record<string, unknown> | null,
  /** Everything `orderBy`/`limit` was called with, so the QUERY SHAPE is testable. */
  queries: [] as { path: string; orderBy: [string, string][]; limit: number[]; where: unknown[][] }[],
  /** Rows the registrations collection answers a query with. */
  rows: [] as { id: string; data: Record<string, unknown> }[],
  users: [] as Record<string, unknown>[],
  /** Test seam: fires on every document write, so ORDER is assertable. */
  onWrite: null as null | ((path: string) => void),
}));

function makeCollRef(path: string): any {
  const record = { path, orderBy: [] as [string, string][], limit: [] as number[], where: [] as unknown[][] };
  const coll: any = {
    __path: path,
    doc: (id: string) => makeDocRef(`${path}/${id}`),
    add: async (payload: Record<string, unknown>) => {
      state.writes.push({ path, payload }); return { id: 'new1' };
    },
  };
  coll.orderBy = (f: string, d: string) => { record.orderBy.push([f, d]); return coll; };
  coll.limit = (n: number) => { record.limit.push(n); return coll; };
  coll.where = (...args: unknown[]) => { record.where.push(args); return coll; };
  coll.get = async () => {
    state.queries.push(record);
    if (path.endsWith('registrations')) {
      return { docs: state.rows.map((r) => ({ id: r.id, data: () => r.data })) };
    }
    if (path === 'users') {
      return {
        docs: state.users.map((u, i) => ({ id: `u${i}`, data: () => u })),
        forEach(cb: (d: { id: string; data: () => unknown }) => void) {
          this.docs.forEach(cb);
        },
      };
    }
    return { docs: [], forEach: () => {} };
  };
  return coll;
}
function makeDocRef(path: string): any {
  return {
    __path: path,
    get: async () => {
      if (path.startsWith('tenants/') && path.split('/').length === 2) {
        return { exists: true, data: () => ({ name: 'Grace Chapel', ownerId: 'owner1' }) };
      }
      if (path.includes('/events/')) return { exists: true, data: () => ({ title: 'Autumn Retreat' }) };
      if (path.startsWith('users/')) return { exists: true, data: () => ({ email: 'owner@grace.example' }) };
      return { exists: state.reg !== null, data: () => state.reg };
    },
    update: async (payload: Record<string, unknown>) => {
      state.writes.push({ path, payload });
      state.onWrite?.(path);
    },
    collection: (name: string) => makeCollRef(`${path}/${name}`),
  };
}

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: (name: string) => makeCollRef(name) },
}));
vi.mock('@/lib/api-auth', () => ({
  requireAuth: mockRequireAuth,
  requireTenantPermission: mockRequireTenantPermission,
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

const { POST: claim } = await import('../claim/route');
const { GET: inbox } = await import('../inbox/route');

const postClaim = (body: unknown) =>
  claim(new NextRequest('https://grace.theharvest.app/api/event-payment/claim', {
    method: 'POST', body: JSON.stringify(body),
  }));
const getInbox = (tenantId: string) =>
  inbox(new NextRequest(`https://grace.theharvest.app/api/event-payment/inbox?tenantId=${tenantId}`));

beforeEach(() => {
  vi.clearAllMocks();
  state.writes = []; state.queries = []; state.rows = []; state.users = []; state.onWrite = null;
  state.reg = {
    userId: 'member-uid', name: 'Dana Okafor', email: 'dana@example.com',
    amount: 5000, eventId: 'ev1', paymentStatus: 'unpaid', paymentReference: 'HV-4KTM9P',
  };
  mockRequireAuth.mockResolvedValue({ uid: 'member-uid', email: 'dana@example.com' });
  mockRequireTenantPermission.mockResolvedValue({ uid: 'admin-uid', email: 'pastor@grace.example' });
  mockSendTransactionalEmail.mockResolvedValue({ ok: true, id: 'e1' });
  mockGetTenantPrivate.mockResolvedValue({ adminEmails: ['pastor@grace.example'] });
  mockMulticast.mockResolvedValue({ successCount: 0 });
});

/* ═══ 5 · "I've paid" confirms NOTHING ════════════════════════════════════ */

describe('5 · "I’ve paid" confirms nothing', () => {
  it('🔴 writes NO money state — no invoice id, no confirmed status, no amount', async () => {
    const res = await postClaim({ tenantId: 'grace', registrationId: 'reg1', provider: 'paypal' });
    expect(res.status).toBe(200);

    const payload = state.writes.find((w) => w.path.endsWith('registrations/reg1'))!.payload;
    /**
     * 🔴 THE WHOLE PREMISE. A member may say they paid; they may not make it
     * true. `paymentStateOf` keys `confirmed` on the INVOICE ID, which only the
     * confirm route can write, so even a member who forged every field this
     * route accepts moves from `unpaid` to `claimed` and no further.
     */
    expect(payload).not.toHaveProperty('paymentInvoiceId');
    expect(payload).not.toHaveProperty('paymentStatus');
    expect(payload).not.toHaveProperty('amount');
    expect(payload).not.toHaveProperty('paymentConfirmedAt');
    expect(payload).not.toHaveProperty('paymentConfirmedBy');
    // What it DOES write: the claim, its time and the provider they named.
    expect(payload.paymentClaimedAt).toBeTruthy();
    expect(payload.paymentClaimProvider).toBe('paypal');
  });

  it('🔴 and the state it produces is `claimed`, never `confirmed`', async () => {
    const { paymentStateOf } = await import('@/lib/event-payment-claims');
    await postClaim({ tenantId: 'grace', registrationId: 'reg1', provider: 'paypal' });
    const payload = state.writes.find((w) => w.path.endsWith('registrations/reg1'))!.payload;
    expect(paymentStateOf({ ...state.reg, ...payload })).toBe('claimed');
  });

  it('a member cannot press it for somebody else’s ticket', async () => {
    mockRequireAuth.mockResolvedValue({ uid: 'a-stranger', email: 'stranger@example.com' });
    const res = await postClaim({ tenantId: 'grace', registrationId: 'reg1' });
    expect(res.status).toBe(403);
    expect(state.writes, 'a stranger wrote to somebody else’s registration').toEqual([]);
  });

  it('but the EMAIL fallback lets a logged-out registrant who later signs in press it', async () => {
    state.reg = { ...state.reg, userId: null };
    mockRequireAuth.mockResolvedValue({ uid: 'other-uid', email: 'DANA@example.com' });
    const res = await postClaim({ tenantId: 'grace', registrationId: 'reg1' });
    expect(res.status).toBe(200);
  });

  it('a free ticket has no payment to claim', async () => {
    state.reg = { ...state.reg, amount: 0 };
    const res = await postClaim({ tenantId: 'grace', registrationId: 'reg1' });
    expect(res.status).toBe(400);
    expect(state.writes).toEqual([]);
  });

  it('and pressing again on an ALREADY CONFIRMED ticket does not re-open it', async () => {
    state.reg = { ...state.reg, paymentInvoiceId: 'inv1' };
    const res = await postClaim({ tenantId: 'grace', registrationId: 'reg1' });
    expect(res.status).toBe(200);
    expect((await res.json()).state).toBe('confirmed');
    expect(state.writes, 'a confirmed gift was put back in the queue').toEqual([]);
  });
});

/* ═══ 14c / 14d / 14e / 14f · the notification ════════════════════════════ */

describe('14c · the church’s admins are emailed through transactional-email.ts', () => {
  it('🔴 goes through THE-340’s funnel, not a second Resend copy', async () => {
    await postClaim({ tenantId: 'grace', registrationId: 'reg1', provider: 'revolut' });
    expect(mockSendTransactionalEmail).toHaveBeenCalled();
    const opts = mockSendTransactionalEmail.mock.calls[0][0];
    expect(opts.churchName).toBe('Grace Chapel');
    expect(opts.subject).toMatch(/says they'?ve paid/i);
  });

  it('🔴 and NO file in this feature constructs a Resend client', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const { stripComments } = await import('../../../../__tests__/__fixtures__/the-346-strip-comments');
    for (const rel of [
      'src/lib/event-payment-notify.ts',
      'src/lib/event-payment-claims.ts',
      'src/app/api/event-payment/claim/route.ts',
      'src/app/api/event-payment/inbox/route.ts',
      'src/app/api/event-payment/confirm/route.ts',
    ]) {
      const code = stripComments(readFileSync(path.join(process.cwd(), rel), 'utf8'));
      expect(code, `${rel} is the TWELFTH inlined Resend copy`).not.toMatch(/new Resend\s*\(/);
      expect(code, `${rel} imports resend directly`).not.toMatch(/from ['"]resend['"]/);
    }
  });

  it('WHO: the CHURCH’s roster and owner — never Harvest’s own address', async () => {
    mockGetTenantPrivate.mockResolvedValue({ adminEmails: ['pastor@grace.example', 'admin@grace.example'] });
    await postClaim({ tenantId: 'grace', registrationId: 'reg1' });
    const to = mockSendTransactionalEmail.mock.calls.map((c) => c[0].to).sort();
    // The roster, plus the tenant owner resolved from `users/{ownerId}`.
    expect(to).toEqual(['admin@grace.example', 'owner@grace.example', 'pastor@grace.example']);
    // 🔴 Harvest's own support addresses — `api/enterprise-lead`'s recipients —
    // appear nowhere: notifying the wrong party is a data-exposure question.
    for (const addr of to) expect(addr).not.toMatch(/bumbmatei|@proton\.me|@zohomail/);
  });

  it('14g · the message carries name, amount, reference and provider', async () => {
    await postClaim({ tenantId: 'grace', registrationId: 'reg1', provider: 'revolut' });
    const text = mockSendTransactionalEmail.mock.calls[0][0].text as string;
    expect(text).toContain('Dana Okafor');
    expect(text, 'the amount is missing — nothing to match a bank line against').toContain('$50.00');
    expect(text, '🔴 THE REFERENCE IS MISSING — the admin cannot match a bank line').toContain('HV-4KTM9P');
    expect(text, 'the provider is missing — the admin opens the wrong account first').toContain('Revolut');
  });

  it('14f · and NOTHING in it implies Harvest verified a payment', async () => {
    const { claimsVerification } = await import('@/lib/event-payment-claims');
    await postClaim({ tenantId: 'grace', registrationId: 'reg1', provider: 'paypal' });
    const { subject, text } = mockSendTransactionalEmail.mock.calls[0][0];
    for (const [label, s] of [['subject', subject], ['body', text]] as const) {
      const bad = claimsVerification(String(s));
      expect(bad, `the notification ${label} claims "${bad}" — Harvest verified nothing`).toBeNull();
    }
    expect(String(text), 'the body never says Harvest cannot check')
      .toMatch(/has not checked this and cannot check it/i);
  });
});

describe('14e · the inbox item exists even when the notification FAILS', () => {
  it('🔴 a Resend outage does not lose the claim', async () => {
    mockSendTransactionalEmail.mockResolvedValue({
      ok: false, error: 'Email is not configured on this deployment, so nothing was sent.',
      code: 'not_configured',
    });
    const res = await postClaim({ tenantId: 'grace', registrationId: 'reg1' });
    expect(res.status, 'a failed notification failed the member’s press').toBe(200);
    const write = state.writes.find((w) => w.path.endsWith('registrations/reg1'));
    expect(write, '🔴 THE PROMPT IS NOT THE RECORD — the claim was lost').toBeTruthy();
  });

  it('🔴 a church with NO admin email still gets the inbox item', async () => {
    mockGetTenantPrivate.mockResolvedValue({ adminEmails: [] });
    const { CLAIM_QUEUE_FIELD } = await import('@/lib/event-payment-claims');
    const res = await postClaim({ tenantId: 'grace', registrationId: 'reg1' });
    expect(res.status).toBe(200);
    const write = state.writes.find((w) => w.path.endsWith('registrations/reg1'))!;
    expect(write.payload[CLAIM_QUEUE_FIELD], 'the person is not in the queue').toBeTruthy();
  });

  it('🔴 and the write happens BEFORE anything is notified', async () => {
    /**
     * 🔴 ORDER, NOT PRESENCE. "The inbox item survives a failed notification" is
     * only structurally true if the row is COMMITTED FIRST — a handler that
     * notified first and wrote afterwards would pass every other case in this
     * block and still lose the claim the day the write threw.
     *
     * Both sides push into one sequence, so what is asserted is that the first
     * thing that happened was the write.
     */
    const order: string[] = [];
    state.onWrite = (path) => { if (path.endsWith('registrations/reg1')) order.push('write'); };
    mockSendTransactionalEmail.mockImplementation(async () => { order.push('email'); return { ok: true }; });

    await postClaim({ tenantId: 'grace', registrationId: 'reg1' });

    expect(order.length, 'neither the write nor the notification happened').toBeGreaterThan(1);
    expect(order[0], 'the church was notified before the claim was saved').toBe('write');
    expect(order.filter((o) => o === 'write'), 'the claim was written more than once').toHaveLength(1);
    expect(order.slice(1).every((o) => o === 'email')).toBe(true);
  });
});

describe('14d · push is an enhancement, and its absence breaks nothing', () => {
  it('no FCM token → no push, and the claim still succeeds', async () => {
    state.users = [{ email: 'pastor@grace.example', tenantId: 'grace' }];
    const res = await postClaim({ tenantId: 'grace', registrationId: 'reg1' });
    expect(res.status).toBe(200);
    expect(mockMulticast, 'a browser admin was pushed to a token they do not have')
      .not.toHaveBeenCalled();
    expect(mockSendTransactionalEmail, '🔴 EMAIL MUST ALWAYS FIRE — it is the reliable channel')
      .toHaveBeenCalled();
  });

  it('a token → a push, addressed only to the CHURCH’s own admins', async () => {
    state.users = [
      { email: 'pastor@grace.example', tenantId: 'grace', fcmTokens: ['tok-admin'] },
      { email: 'member@grace.example', tenantId: 'grace', fcmTokens: ['tok-member'] },
    ];
    await postClaim({ tenantId: 'grace', registrationId: 'reg1' });
    expect(mockMulticast).toHaveBeenCalledTimes(1);
    const arg = mockMulticast.mock.calls[0][0];
    expect(arg.tokens, 'an ordinary member was told about the church’s money').toEqual(['tok-admin']);
    const { claimsVerification } = await import('@/lib/event-payment-claims');
    expect(claimsVerification(`${arg.notification.title} ${arg.notification.body}`)).toBeNull();
  });

  it('🔴 and a push that THROWS does not fail the claim', async () => {
    state.users = [{ email: 'pastor@grace.example', tenantId: 'grace', fcmTokens: ['tok'] }];
    mockMulticast.mockRejectedValue(new Error('FCM is down'));
    const res = await postClaim({ tenantId: 'grace', registrationId: 'reg1' });
    expect(res.status).toBe(200);
    expect(state.writes.find((w) => w.path.endsWith('registrations/reg1'))).toBeTruthy();
  });
});

/* ═══ 20 · the inbox is ordered ═══════════════════════════════════════════ */

describe('20 · the inbox is ordered; no unordered limit(N); the oldest is not dropped', () => {
  it('🔴 orders ASCENDING on the queue field, and filters on nothing else', async () => {
    const { CLAIM_QUEUE_FIELD, INBOX_CEILING } = await import('@/lib/event-payment-claims');
    await getInbox('grace');
    const q = state.queries.find((x) => x.path.endsWith('registrations'))!;

    // #405: an unordered `limit(N)` returns N ARBITRARY rows.
    expect(q.orderBy, 'the inbox read is UNORDERED — #405’s defect').toEqual([[CLAIM_QUEUE_FIELD, 'asc']]);
    // 🔴 ASCENDING. A DESC limit drops the OLDEST pending item — the one that
    // has waited longest and is most likely to have been forgotten.
    expect(q.orderBy[0][1]).not.toBe('desc');
    // 🔴 NO `where`. Filter and order are the SAME field, which is what makes
    // this a single-field index and keeps a composite index impossible.
    expect(q.where, 'an equality filter beside the orderBy — that is a COMPOSITE INDEX').toEqual([]);
    expect(q.limit).toEqual([INBOX_CEILING + 1]);
  });

  it('the count is EXACT under the ceiling', async () => {
    state.rows = [
      { id: 'r1', data: { name: 'A', amount: 1000, eventId: 'ev1', paymentReference: 'HV-AAAAAA', paymentClaimPendingAt: '2031-09-01T00:00:00.000Z' } },
      { id: 'r2', data: { name: 'B', amount: 2000, eventId: 'ev1', paymentReference: 'HV-BBBBBB', paymentClaimPendingAt: '2031-09-02T00:00:00.000Z' } },
    ];
    const body = await (await getInbox('grace')).json();
    expect(body.count).toBe(2);
    expect(body.exact, 'a complete read reported itself as truncated').toBe(true);
  });

  it('🔴 and says so when it is NOT exact — never a bare number over a truncated read', async () => {
    const { INBOX_CEILING, inboxBadgeLabel } = await import('@/lib/event-payment-claims');
    state.rows = Array.from({ length: INBOX_CEILING + 1 }, (_, i) => ({
      id: `r${i}`,
      data: { name: `P${i}`, amount: 1000, eventId: 'ev1', paymentReference: 'HV-AAAAAA', paymentClaimPendingAt: `2031-09-01T00:00:${String(i % 60).padStart(2, '0')}.000Z` },
    }));
    const body = await (await getInbox('grace')).json();
    expect(body.exact).toBe(false);
    expect(body.items.length).toBe(INBOX_CEILING);
    expect(inboxBadgeLabel(body.count, body.exact)).toBe(`${INBOX_CEILING}+`);
    // 🔴 AND THE ROWS KEPT ARE THE OLDEST ONES — `r0` survives, the newest is
    // what falls off. That is the whole reason the order is ascending.
    expect(body.items[0].id).toBe('r0');
  });

  it('14g · every row carries name, amount, reference, provider and timestamp', async () => {
    state.rows = [{
      id: 'r1',
      data: {
        name: 'Dana Okafor', email: 'dana@example.com', amount: 5000, eventId: 'ev1',
        paymentReference: 'HV-4KTM9P', paymentClaimProvider: 'revolut',
        paymentClaimPendingAt: '2031-09-05T10:00:00.000Z',
      },
    }];
    const { inboxRowSummary } = await import('@/lib/event-payment-claims');
    const body = await (await getInbox('grace')).json();
    const row = body.items[0];
    expect(row.memberName).toBe('Dana Okafor');
    expect(row.amountCents).toBe(5000);
    expect(row.reference).toBe('HV-4KTM9P');
    expect(row.providerLabel).toBe('Revolut');
    expect(row.claimedAt).toBe('2031-09-05T10:00:00.000Z');
    expect(row.eventTitle).toBe('Autumn Retreat');
    // And the one line an admin actually reads carries all of it.
    const line = inboxRowSummary(row);
    for (const needed of ['$50.00', 'HV-4KTM9P', 'Revolut']) {
      expect(line, `the row line drops ${needed} — the admin cannot match a bank line`).toContain(needed);
    }
  });
});

/* ═══ 7 · a church CANNOT see another church's inbox ══════════════════════ */

describe('7 · a church CANNOT see another church’s inbox', () => {
  it('🔴 the permission is imposed on the NAMED tenant, before any read', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireTenantPermission.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const res = await getInbox('someone-else');
    expect(res.status).toBe(403);
    expect(mockRequireTenantPermission).toHaveBeenCalledWith(
      expect.anything(), 'someone-else', 'manageEvents',
    );
    expect(state.queries, 'a refused caller still read a collection').toEqual([]);
  });

  it('🔴 and tenancy is a PATH SEGMENT, so no query shape can cross a church', async () => {
    await getInbox('grace');
    const q = state.queries.find((x) => x.path.endsWith('registrations'))!;
    // `tenants/grace/registrations` — a subcollection. There is no
    // `where('tenantId','==',…)` that could be dropped, which is a whole class
    // of bug a top-level collection would have had.
    expect(q.path).toBe('tenants/grace/registrations');
    expect(q.where).toEqual([]);
  });

  it('🔴 and firestore.rules already says the same thing, unedited', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const rules = readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf8');
    // The rule this ticket relies on and does not touch: a registration is
    // readable by an admin OF THAT TENANT, with the tenant taken from the path.
    const block = /match \/registrations\/\{regId\} \{\s*allow read: if isAuthenticated\(\) && \(isTenantAdmin\(tenantId\) \|\| resource\.data\.userId == request\.auth\.uid\);/;
    expect(rules, 'the rule THE-351’s inbox scoping rests on has moved').toMatch(block);
  });
});

/* ═══ 4 · a member registers immediately as UNPAID with a reference ═══════ */

describe('4 · the reference code', () => {
  it('is shaped so a human can read it off a bank line and type it back', async () => {
    const {
      buildPaymentReference, isPaymentReference, REFERENCE_ALPHABET, REFERENCE_PREFIX,
      REFERENCE_BODY_LENGTH,
    } = await import('@/lib/event-payment-claims');

    const ref = buildPaymentReference(new Uint8Array([0, 1, 2, 3, 4, 5]));
    expect(ref.startsWith(REFERENCE_PREFIX)).toBe(true);
    expect(ref.length).toBe(REFERENCE_PREFIX.length + REFERENCE_BODY_LENGTH);
    expect(isPaymentReference(ref)).toBe(true);

    // 🔴 THE AMBIGUOUS GLYPHS ARE ABSENT. A transcription error here is an admin
    // who cannot find a payment that is sitting in front of them.
    for (const c of '01ILO') {
      expect(REFERENCE_ALPHABET, `${c} is in the alphabet — it is misread as its twin`)
        .not.toContain(c);
    }

    // Every byte maps into the alphabet, for all 256 of them.
    for (let b = 0; b < 256; b += 1) {
      const r = buildPaymentReference(new Uint8Array([b, b, b, b, b, b]));
      expect(isPaymentReference(r), `byte ${b} produced ${r}`).toBe(true);
    }
  });

  it('🔴 is NOT the ticket code — that one opens a door and this one goes in a public feed', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const { stripComments } = await import('../../../../__tests__/__fixtures__/the-346-strip-comments');
    const code = stripComments(
      readFileSync(path.join(process.cwd(), 'src/app/api/event-registration/submit/route.ts'), 'utf8'),
    );
    // The reference is built from its own randomness, never from `ticketCode`.
    expect(code).toMatch(/paymentReference:\s*buildPaymentReference\(randomBytes\(/);
    expect(code, 'the payment reference was derived from the QR’s ticket code')
      .not.toMatch(/paymentReference:\s*[`'"]?[^,\n]*ticketCode/);
  });

  it('rejects a malformed reference rather than accepting it loosely', async () => {
    const { isPaymentReference } = await import('@/lib/event-payment-claims');
    for (const bad of ['', 'HV-', 'HV-4KTM9', 'HV-4KTM9PQ', '4KTM9P', 'hv-4ktm9p', 'HV-0OIL11', null, 42]) {
      expect(isPaymentReference(bad), `${String(bad)} was accepted`).toBe(false);
    }
  });
});
