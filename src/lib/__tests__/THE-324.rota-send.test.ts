import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * THE-324 — the send path, exercised end to end through THE-314's REAL funnel.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 WHAT IS STUBBED, AND WHAT IS DELIBERATELY NOT.
 *
 * STUBBED: `firebase-admin` (an in-memory document store), `zernio` (the
 * provider's HTTP call) and `composio-client` (Gmail's). Those three are the
 * outside world.
 *
 * 🔴 REAL, AND THIS IS THE WHOLE POINT: `sms-send.ts`, `sms-optout.ts`,
 * `sms-usage.ts`, `plan-features.ts` and `rota-invite.ts`. A stub of any of them
 * would guard NOTHING — a STOP test that passed because `isOptedOut` was mocked
 * to return true proves only that a mock returns what it was told to, and a
 * metering test over a mocked meter proves nothing was billed to a fake. The
 * questions here are "does an opted-out number reach the provider" and "does a
 * delivered message reach the counter", and both are only answerable with the
 * real modules in the path.
 *
 * ⚠️ MUTATION-VERIFIED. Every assertion below was checked to FAIL against a
 * planted defect before being kept — see `THE-324.mutation.md` in the PR body's
 * report. Seven tickets in this series each had a guard of their own pass a
 * planted defect; only mutation found them.
 */

const TENANT = 'grace';
const ADMIN_UID = 'admin-1';
const PERSON = 'user-ben';
const PHONE = '+12125551234';
const EMAIL = 'ben@example.org';
const SERVICE_AT = new Date('2026-09-13T10:00:00.000Z');

/* ── An in-memory Firestore, enough for the funnel and the meter ─────────── */

const {
  docData, mockZernioSend, mockComposio, writes, transactions,
} = vi.hoisted(() => ({
  docData: new Map<string, any>(),
  mockZernioSend: vi.fn(),
  mockComposio: vi.fn(),
  writes: [] as { path: string; value: any }[],
  transactions: [] as string[],
}));

function makeQuery(path: string, field?: string, value?: unknown, cap?: number): any {
  return {
    where: (f: string, _op: string, v: unknown) => makeQuery(path, f, v, cap),
    limit: (n: number) => makeQuery(path, field, value, n),
    async get() {
      const prefix = `${path}/`;
      const docs = [...docData.entries()]
        .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
        .filter(([, d]) => (field === undefined ? true : d?.[field] === value))
        .map(([k, d]) => ({ id: k.slice(prefix.length), data: () => d }));
      return { docs: cap === undefined ? docs : docs.slice(0, cap), empty: docs.length === 0 };
    },
  };
}

function makeDocRef(path: string): any {
  return {
    path,
    async get() {
      const d = docData.get(path);
      return { exists: d !== undefined, data: () => d, id: path.split('/').pop() };
    },
    async set(value: any, options?: any) {
      writes.push({ path, value });
      const prev = options?.merge ? (docData.get(path) ?? {}) : {};
      docData.set(path, { ...prev, ...resolveSentinels(value, prev) });
    },
    collection: (sub: string) => makeColRef(`${path}/${sub}`),
  };
}

function makeColRef(path: string): any {
  const q = makeQuery(path);
  return { ...q, doc: (id: string) => makeDocRef(`${path}/${id}`) };
}

/** Turn the Admin SDK sentinels this code writes into plain values. */
function resolveSentinels(value: any, prev: any): any {
  const out: any = {};
  for (const [k, v] of Object.entries(value ?? {})) {
    if (v && typeof v === 'object' && (v as any).__sentinel === 'serverTimestamp') {
      out[k] = FAKE_TS(new Date());
    } else if (v && typeof v === 'object' && (v as any).__sentinel === 'increment') {
      out[k] = (typeof prev?.[k] === 'number' ? prev[k] : 0) + (v as any).by;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** A minimal stand-in for the Admin SDK `Timestamp` this code reads and writes. */
class FakeTimestamp {
  constructor(public readonly _d: Date) {}
  toDate() { return this._d; }
}
const FAKE_TS = (d: Date) => new FakeTimestamp(d);

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ __sentinel: 'serverTimestamp' }),
    increment: (by: number) => ({ __sentinel: 'increment', by }),
  },
  Timestamp: Object.assign(FakeTimestamp, {
    fromDate: (d: Date) => new FakeTimestamp(d),
  }),
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => makeColRef(name),
    async runTransaction(fn: (tx: any) => Promise<any>) {
      transactions.push('runTransaction');
      return fn({
        get: (ref: any) => ref.get(),
        set: (ref: any, value: any, options?: any) => { void ref.set(value, options); },
      });
    },
  },
}));

vi.mock('@/lib/sms-feature', () => ({
  SMS_FEATURE_ENABLED: true,
  SMS_HIDDEN_MESSAGE: 'SMS is temporarily unavailable.',
}));

vi.mock('@/lib/zernio', () => ({ zernioSendSms: mockZernioSend }));
vi.mock('@/lib/composio-client', () => ({ executeComposioAction: mockComposio }));

const { sendInvitation, listInvitations, recordResponse, findByToken } =
  await import('../rota-invite');
const { isRotaToken, buildRotaAcceptUrl, reminderDue } =
  await import('@/components/events/rota-invitations');

const ASSIGNMENT = {
  planId: 'plan-1',
  itemId: 'item-a',
  eventId: 'evt-1',
  eventTitle: 'Sunday Morning Gathering',
  itemTitle: 'Welcome and call to worship',
  personId: PERSON,
  personName: 'Benjamin Achterberg',
  startsAt: SERVICE_AT,
};

/** A church on the plan the argument is about. `max` is Ministry. */
function seed(plan: 'plus' | 'pro' | 'max', opts: { optedOut?: boolean; gmail?: boolean } = {}) {
  docData.clear();
  writes.length = 0;
  transactions.length = 0;
  docData.set(`tenants/${TENANT}`, { name: 'Grace Chapel', plan });
  docData.set(`tenants/${TENANT}/integrations/sms`, {
    numberId: 'n1', phoneNumber: '+12125550000', profileId: 'p1', status: 'active',
    country: 'US', purchasedAt: '2026-01-01',
  });
  if (opts.gmail !== false) {
    docData.set(`tenants/${TENANT}/integrations/${ADMIN_UID}_gmail`, {
      status: 'active', connectedAccountId: 'ca-1', senderEmail: 'office@gracechapel.org',
    });
  }
  if (opts.optedOut) {
    docData.set(`tenants/${TENANT}/smsOptOuts/12125551234`, {
      phone: PHONE, keyword: 'STOP', optedOutAt: '2026-08-01T00:00:00.000Z',
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockZernioSend.mockResolvedValue({ ok: true, id: 'sm_1', segments: 1 });
  mockComposio.mockResolvedValue({ successful: true });
});

/* ═══ 1 · An assignment produces an invitation, NAMED PER CHANNEL ══════════ */

describe('an assignment produces an invitation', () => {
  it('🔴 the invitation exists, carries a token and an accept link, and both channels are named', async () => {
    seed('max');
    const report = await sendInvitation(
      TENANT, ADMIN_UID, ASSIGNMENT,
      { email: EMAIL, phone: PHONE }, 'Grace Chapel', 'invite',
    );

    // The record: deterministic id, one per assignment.
    expect(report.invitationId).toBe('plan-1__item-a');
    expect(docData.get(`tenants/${TENANT}/rotaInvitations/plan-1__item-a`)).toBeTruthy();

    // 🔴 NAMED PER CHANNEL — the ticket's own requirement. Not "it sent", but
    // WHICH transport did what, so an admin can tell an unsent email from an
    // unsendable one.
    expect(report.channels).toEqual({ email: 'sent', sms: 'sent' });
    expect(report.delivered).toBe(true);

    // Both transports actually saw a message.
    expect(mockComposio).toHaveBeenCalledTimes(1);
    expect(mockZernioSend).toHaveBeenCalledTimes(1);

    // And the message says the three things the ticket asks for: the day, the
    // slot and the time. "You are on for Sunday 14 September, Welcome, 10:00."
    const body = mockZernioSend.mock.calls[0][0].text as string;
    expect(body).toContain('You are on for');
    expect(body).toContain('Welcome and call to worship');
    expect(body).toMatch(/\d{2}:\d{2}/);

    expect(isRotaToken(report.token)).toBe(true);
    expect(report.url).toBe(buildRotaAcceptUrl(TENANT, report.token));
  });

  it('re-inviting the same slot rewrites ONE document and keeps the link working', async () => {
    seed('max');
    const first = await sendInvitation(
      TENANT, ADMIN_UID, ASSIGNMENT, { email: EMAIL, phone: PHONE }, 'Grace Chapel', 'invite',
    );
    const second = await sendInvitation(
      TENANT, ADMIN_UID, ASSIGNMENT, { email: EMAIL, phone: PHONE }, 'Grace Chapel', 'invite',
    );
    // 🔴 One invitation, one token — a second `addDoc` would have made two
    // accept links for one slot and charged twice for the same message.
    expect(second.invitationId).toBe(first.invitationId);
    expect(second.token).toBe(first.token);
    const read = await listInvitations(TENANT);
    expect(read.invitations).toHaveLength(1);
  });

  it('and reassigning the slot to somebody else REGENERATES the token', async () => {
    seed('max');
    const first = await sendInvitation(
      TENANT, ADMIN_UID, ASSIGNMENT, { email: EMAIL, phone: PHONE }, 'Grace Chapel', 'invite',
    );
    const moved = await sendInvitation(
      TENANT, ADMIN_UID, { ...ASSIGNMENT, personId: 'user-ada', personName: 'Adaeze Okonkwo' },
      { email: 'ada@example.org', phone: null }, 'Grace Chapel', 'invite',
    );
    // 🔴 The previous holder's link must stop answering for the new person.
    expect(moved.token).not.toBe(first.token);
    expect(await findByToken(TENANT, first.token)).toBeNull();
  });
});

/* ═══ 2 · Accept and decline both record ═══════════════════════════════════ */

describe('accept and decline both record', () => {
  it('an accept and a decline each land on the invitation, and only three fields move', async () => {
    seed('max');
    const report = await sendInvitation(
      TENANT, ADMIN_UID, ASSIGNMENT, { email: EMAIL, phone: PHONE }, 'Grace Chapel', 'invite',
    );
    const before = { ...docData.get(`tenants/${TENANT}/rotaInvitations/plan-1__item-a`) };

    const accepted = await recordResponse(TENANT, report.token, 'accepted', new Date('2026-09-10T00:00:00Z'));
    expect(accepted?.status).toBe('accepted');

    const declined = await recordResponse(TENANT, report.token, 'declined', new Date('2026-09-10T00:00:00Z'));
    expect(declined?.status).toBe('declined');

    // 🔴 THE BOUND ON THE BEARER TOKEN, ASSERTED: everything except `status` and
    // `respondedAt` is byte-identical. A holder cannot move the date, rename the
    // item, reassign the person or mint a token.
    const after = docData.get(`tenants/${TENANT}/rotaInvitations/plan-1__item-a`);
    for (const key of Object.keys(before)) {
      if (key === 'status' || key === 'respondedAt') continue;
      expect(after[key], `${key} moved on an unauthenticated write`).toEqual(before[key]);
    }
  });

  it('a token for a service that has already started answers nothing', async () => {
    seed('max');
    const report = await sendInvitation(
      TENANT, ADMIN_UID, ASSIGNMENT, { email: EMAIL, phone: PHONE }, 'Grace Chapel', 'invite',
    );
    // The service is on the 13th; this is the 14th.
    expect(await recordResponse(TENANT, report.token, 'accepted', new Date('2026-09-14T00:00:00Z')))
      .toBeNull();
    expect(docData.get(`tenants/${TENANT}/rotaInvitations/plan-1__item-a`).status).toBe('invited');
  });

  it('a malformed or unknown token answers nothing and spends no read', async () => {
    seed('max');
    await sendInvitation(TENANT, ADMIN_UID, ASSIGNMENT, { email: EMAIL, phone: PHONE }, 'Grace Chapel', 'invite');
    expect(await findByToken(TENANT, '../../etc/passwd')).toBeNull();
    expect(await findByToken(TENANT, 'A'.repeat(43))).toBeNull();
    expect(await findByToken(TENANT, null)).toBeNull();
  });
});

/* ═══ 3 · 🔴 A VOLUNTEER WHO TEXTED STOP RECEIVES NO REMINDER ══════════════ */

describe('a volunteer who texted STOP receives no reminder', () => {
  /**
   * 🔴 CARRIER-MANDATED, AND IT IS HARVEST'S OWN NUMBER THAT GETS BLOCKED.
   * `sms-optout.ts` is the REAL module here and `sendSms` is the REAL funnel;
   * the only thing stubbed is the provider, so "no reminder" is asserted as
   * "the provider was never called".
   */
  it('🔴 the provider is NEVER called, on an invitation or on a reminder', async () => {
    seed('max', { optedOut: true });

    const invited = await sendInvitation(
      TENANT, ADMIN_UID, ASSIGNMENT, { email: EMAIL, phone: PHONE }, 'Grace Chapel', 'invite',
    );
    expect(mockZernioSend, 'an opted-out number reached the provider').not.toHaveBeenCalled();
    expect(invited.channels.sms).toBe('opted_out');

    const reminded = await sendInvitation(
      TENANT, ADMIN_UID, ASSIGNMENT, { email: EMAIL, phone: PHONE }, 'Grace Chapel', 'reminder',
    );
    expect(mockZernioSend, 'an opted-out number reached the provider on a reminder')
      .not.toHaveBeenCalled();
    expect(reminded.channels.sms).toBe('opted_out');
  });

  it('🔴 and NOTHING IS METERED for them — STOP is refused before a segment is reserved', async () => {
    seed('max', { optedOut: true });
    await sendInvitation(
      TENANT, ADMIN_UID, ASSIGNMENT, { email: EMAIL, phone: PHONE }, 'Grace Chapel', 'reminder',
    );
    // The usage document was never even created: the refusal happens before the
    // reservation, so a refused send costs nothing.
    expect([...docData.keys()].some((k) => k.includes(`tenants/${TENANT}/usage/`)))
      .toBe(false);
    expect(transactions, 'a segment was reserved for an opted-out recipient').toHaveLength(0);
  });

  it('the EMAIL still goes — STOP is an SMS consent, not a withdrawal from the rota', async () => {
    seed('max', { optedOut: true });
    const report = await sendInvitation(
      TENANT, ADMIN_UID, ASSIGNMENT, { email: EMAIL, phone: PHONE }, 'Grace Chapel', 'invite',
    );
    expect(report.channels.email).toBe('sent');
    expect(report.delivered).toBe(true);
  });

  it('and `reminderDue` will not retry a channel that never delivered', () => {
    const now = new Date('2026-09-10T00:00:00Z');
    const base = { status: 'invited' as const, startsAt: SERVICE_AT, reminderCount: 0 };
    expect(reminderDue({ ...base, channels: { email: 'sent', sms: 'opted_out' } }, now)).toBe(true);
    // 🔴 Nothing reached them at all, so there is nothing to remind ABOUT and a
    // reminder would be a charge for a message that cannot arrive.
    expect(reminderDue({ ...base, channels: { email: 'unavailable', sms: 'opted_out' } }, now))
      .toBe(false);
  });
});

/* ═══ 4 · 🔴 EVERY SEND IS METERED INTO tenants/{id}/usage/{YYYY-MM} ═══════ */

describe('every send is metered into tenants/{id}/usage/{YYYY-MM}', () => {
  const monthDoc = () =>
    [...docData.entries()].find(([k]) => k.startsWith(`tenants/${TENANT}/usage/`));

  it('🔴 a delivered SMS increments `smsSegments` on the month document', async () => {
    seed('max');
    await sendInvitation(
      TENANT, ADMIN_UID, ASSIGNMENT, { email: EMAIL, phone: PHONE }, 'Grace Chapel', 'invite',
    );
    const doc = monthDoc();
    expect(doc, 'no usage document was written — the send was unmetered').toBeTruthy();
    const [key, value] = doc as [string, any];
    expect(key).toMatch(new RegExp(`^tenants/${TENANT}/usage/\\d{4}-\\d{2}$`));
    expect(value.smsSegments).toBe(1);
  });

  it('🔴 the reservation is ATOMIC — it happens inside a transaction, before the provider', async () => {
    seed('max');
    await sendInvitation(
      TENANT, ADMIN_UID, ASSIGNMENT, { email: EMAIL, phone: PHONE }, 'Grace Chapel', 'invite',
    );
    // Two concurrent near-limit sends must not both pass a naive read-then-write.
    expect(transactions.length).toBe(1);
  });

  it('a multi-segment message settles to the PROVIDER\'S own count, not to one', async () => {
    seed('max');
    mockZernioSend.mockResolvedValue({ ok: true, id: 'sm_2', segments: 3 });
    await sendInvitation(
      TENANT, ADMIN_UID, ASSIGNMENT, { email: EMAIL, phone: PHONE }, 'Grace Chapel', 'invite',
    );
    // 1 reserved + 2 settled. Harvest is billed for three and counts three.
    expect((monthDoc() as [string, any])[1].smsSegments).toBe(3);
  });

  it('a provider failure is REFUNDED, so a send that never happened costs no allotment', async () => {
    seed('max');
    mockZernioSend.mockResolvedValue({ ok: false, error: 'carrier rejected' });
    const report = await sendInvitation(
      TENANT, ADMIN_UID, ASSIGNMENT, { email: EMAIL, phone: PHONE }, 'Grace Chapel', 'invite',
    );
    expect(report.channels.sms).toBe('failed');
    expect((monthDoc() as [string, any])[1].smsSegments).toBe(0);
  });

  it('and a person with no phone number is metered nothing at all', async () => {
    seed('max');
    const report = await sendInvitation(
      TENANT, ADMIN_UID, ASSIGNMENT, { email: EMAIL, phone: null }, 'Grace Chapel', 'invite',
    );
    expect(report.channels.sms).toBe('unavailable');
    expect(monthDoc()).toBeUndefined();
    expect(mockZernioSend).not.toHaveBeenCalled();
  });
});

/* ═══ 6 · 🔴 A TENANT WITHOUT SMS STILL GETS WORKING INVITATIONS ═══════════ */

describe('a tenant without SMS still gets working invitations', () => {
  /**
   * 🔴 INDIVIDUAL (`plus`, $49) AND SMALL TEAM (`pro`, $99) BOTH LOST SMS IN
   * THE-314. The feature must not be useless to them — a church that declined to
   * buy a $199 plan has not bought a broken rota.
   */
  it.each(['plus', 'pro'] as const)('%s: the invitation, its token and its link all exist', async (plan) => {
    seed(plan);
    const report = await sendInvitation(
      TENANT, ADMIN_UID, ASSIGNMENT, { email: EMAIL, phone: PHONE }, 'Grace Chapel', 'invite',
    );

    // 🔴 The invitation is REAL and answerable.
    expect(isRotaToken(report.token)).toBe(true);
    expect(report.url).toBeTruthy();
    const answered = await recordResponse(
      TENANT, report.token, 'accepted', new Date('2026-09-10T00:00:00Z'),
    );
    expect(answered?.status).toBe('accepted');

    // 🔴 The EMAIL carried it, and the email carries the LINK.
    expect(report.channels.email).toBe('sent');
    expect(report.delivered).toBe(true);
    const body = mockComposio.mock.calls[0][1].body as string;
    expect(body).toContain(report.url as string);

    // 🔴 And SMS is `unavailable` — a plan fact, not an error the admin clears.
    expect(report.channels.sms).toBe('unavailable');
    expect(mockZernioSend, 'an unentitled tenant reached the provider').not.toHaveBeenCalled();
    // Nothing was metered, because nothing was spent.
    expect([...docData.keys()].some((k) => k.includes('/usage/'))).toBe(false);
  });

  it('and with no Gmail connection either, the invitation still exists to be shared by hand', async () => {
    seed('plus', { gmail: false });
    const report = await sendInvitation(
      TENANT, ADMIN_UID, ASSIGNMENT, { email: EMAIL, phone: PHONE }, 'Grace Chapel', 'invite',
    );
    // 🔴 THE-194 is open: Google's OAuth app is unverified and capped at 100
    // users, so this is a live state and not a hypothetical.
    expect(report.channels).toEqual({ email: 'unavailable', sms: 'unavailable' });
    expect(report.delivered).toBe(false);
    // The record and its link survive the loss of every transport.
    expect(report.url).toBeTruthy();
    expect(await findByToken(TENANT, report.token)).not.toBeNull();
  });
});

/* ═══ The message names no place ═══════════════════════════════════════════ */

describe('no member is listed alongside a location', () => {
  it('neither channel\'s body mentions a place, even when the event document has one', async () => {
    seed('max');
    docData.set(`tenants/${TENANT}/events/evt-1`, {
      title: 'Sunday Morning Gathering',
      location: '14 Bethel Road, Croydon',
      isOnline: false,
      onlineLink: null,
    });
    await sendInvitation(
      TENANT, ADMIN_UID, ASSIGNMENT, { email: EMAIL, phone: PHONE }, 'Grace Chapel', 'invite',
    );
    const sms = mockZernioSend.mock.calls[0][0].text as string;
    const email = mockComposio.mock.calls[0][1].body as string;

    // ⚠️ THE EMAIL GREETS THE PERSON; THE SMS DOES NOT, AND THAT IS DELIBERATE
    // RATHER THAN AN OMISSION. A text arrives on the recipient's own phone, so a
    // name tells them nothing they do not know and costs characters out of the
    // 160 that decide whether Harvest is billed for one segment or two.
    expect(email).toContain('Benjamin');

    for (const text of [sms, email]) {
      // 🔴 A rota names PEOPLE by necessity. It must never become a directory.
      expect(text).not.toContain('Bethel Road');
      expect(text).not.toContain('Croydon');
    }
    // 🔴 AND THE BODY IS PLAIN ASCII, WHICH IS WORTH ASSERTING BECAUSE IT IS
    // MONEY. One character outside GSM-7 forces the whole message to UCS-2,
    // where a segment is 70 characters rather than 160 — roughly a doubling of
    // the bill for a piece of punctuation.
    expect(/^[\x20-\x7e\n]*$/.test(sms), `a non-GSM-7 character is in: ${sms}`).toBe(true);
    // And the stored record has no place field to leak later.
    const stored = docData.get(`tenants/${TENANT}/rotaInvitations/plan-1__item-a`);
    for (const field of ['location', 'isOnline', 'onlineLink', 'address', 'city', 'postcode']) {
      expect(Object.keys(stored)).not.toContain(field);
    }
  });
});

/* ═══ One timestamp representation ═════════════════════════════════════════ */

describe('only one timestamp representation is ever written', () => {
  it('🔴 every date on the document is a Timestamp — no ISO string, no epoch number', async () => {
    seed('max');
    await sendInvitation(
      TENANT, ADMIN_UID, ASSIGNMENT, { email: EMAIL, phone: PHONE }, 'Grace Chapel', 'invite',
    );
    const stored = docData.get(`tenants/${TENANT}/rotaInvitations/plan-1__item-a`);
    for (const field of ['startsAt', 'invitedAt']) {
      expect(stored[field], `${field} is not a Timestamp`).toBeInstanceOf(FakeTimestamp);
    }
    // ⚠️ Firestore sorts across types by TYPE FIRST, so a collection holding
    // both an ISO string and a Timestamp is unsortable rather than untidy —
    // `invoices.issuedAt` and `contactActivities.createdAt` are both already in
    // that state, and this collection must not become the third.
    for (const [, value] of Object.entries(stored)) {
      expect(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value),
        'an ISO date string reached the document').toBe(false);
    }
  });
});
