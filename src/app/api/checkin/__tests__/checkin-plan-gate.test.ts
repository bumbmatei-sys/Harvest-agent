import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PLAN_ORDER, PLAN_DISPLAY_NAMES, getPlanFeatures } from '@/utils/plan-features';

/**
 * THE-213 · defect 1 — A FREE TENANT CANNOT REACH CHECK-IN, SERVER SIDE.
 *
 * 🔴 THIS IS THE HALF THAT MATTERS, because check-in WRITES. `/api/checkin/submit`
 * appends an `attendees` document, increments `attendeeCount`, adds a
 * `contactActivities` row against a matched CRM contact and can fire an
 * automated SMS — all on a PUBLIC, no-auth endpoint, through the Admin SDK,
 * which bypasses firestore.rules entirely. AdminCheckin has hidden its Check-In
 * sub-tab on tiers without `checkInSystem` since it shipped, and the founder
 * still reached a working check-in: a hidden sub-tab is not a gate (THE-193)
 * and a disabled button is a suggestion.
 *
 * ⚠️ `checkInSystem` IS FALSE ON INDIVIDUAL TOO, not only on free — see the
 * matrix-derived table below, which is read out of `PLAN_FEATURES` rather than
 * typed here so it cannot drift. That is not this PR overreaching; it is the
 * cell doing what it says. Individual has had no Check-In screen all along, so
 * what actually changes for a paying Individual church is that a link kept from
 * before stops working — which is the hole. Small Team and Ministry, the two
 * tiers whose cell is true, are untouched, and section 3 asserts that per tier.
 *
 * ⚠️ REFUSES THE SURFACE, NEVER THE DATA. Section 4 pins that a refusal performs
 * no write of any kind: no session, attendee, activity or SMS. A tenant that
 * upgrades finds every record it ever had, intact.
 */

const h = vi.hoisted(() => {
  const tenantGet = vi.fn();
  const sessionGet = vi.fn();
  const attendeesAdd = vi.fn(async () => ({ id: 'a1' }));
  const sessionSet = vi.fn(async () => {});
  const activitiesAdd = vi.fn(async () => ({ id: 'act1' }));
  const contactsGet = vi.fn(async () => ({ docs: [] as any[] }));
  const sendAutomatedSms = vi.fn(async () => {});
  const capture = vi.fn();

  const sessionRef = {
    get: sessionGet,
    set: sessionSet,
    collection: () => ({ add: attendeesAdd }),
  };

  const collection = vi.fn((name: string) => {
    if (name === 'tenants') {
      return {
        doc: () => ({
          get: tenantGet,
          collection: () => ({ doc: () => sessionRef }),
        }),
      };
    }
    if (name === 'contactActivities') return { add: activitiesAdd };
    if (name === 'contacts') return { where: () => ({ limit: () => ({ get: contactsGet }) }) };
    throw new Error(`unexpected collection ${name}`);
  });

  return {
    tenantGet, sessionGet, attendeesAdd, sessionSet, activitiesAdd, contactsGet,
    sendAutomatedSms, capture, collection,
  };
});

vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: h.collection } }));
vi.mock('@/lib/twilio', () => ({ sendAutomatedSms: h.sendAutomatedSms }));
vi.mock('@/lib/money-path-sentry', () => ({ captureHandledError: h.capture }));

const { GET } = await import('../get/route');
const { POST } = await import('../submit/route');

/** Every write double this suite installs, so "wrote nothing" is one assertion. */
const WRITE_DOUBLES = () => [
  h.attendeesAdd, h.sessionSet, h.activitiesAdd, h.sendAutomatedSms,
];

const onPlan = (plan: string) => {
  h.tenantGet.mockResolvedValue({ exists: true, data: () => ({ plan }) });
};

const anOpenSession = () => {
  h.sessionGet.mockResolvedValue({
    exists: true,
    data: () => ({ name: 'Sunday Service', status: 'active', location: 'Main Hall', date: null }),
  });
};

const getSession = (tenantId = 't1', sessionId = 's1') =>
  GET(new NextRequest(`https://t1.theharvest.app/api/checkin/get?tenantId=${tenantId}&sessionId=${sessionId}`));

const submitCheckin = (body: Record<string, unknown> = {}) =>
  POST(new NextRequest('https://t1.theharvest.app/api/checkin/submit', {
    method: 'POST',
    body: JSON.stringify({ tenantId: 't1', sessionId: 's1', firstName: 'Maria', ...body }),
  }));

beforeEach(() => {
  vi.clearAllMocks();
  anOpenSession();
  h.contactsGet.mockResolvedValue({ docs: [] });
});

// ─── 1. the free tier ────────────────────────────────────────────────────────
describe('a free tenant cannot reach check-in, server side', () => {
  it('🔴 refuses the WRITE endpoint — no attendee is recorded', async () => {
    onPlan('free');

    const res = await submitCheckin();

    expect(res.status).toBe(404);
    for (const write of WRITE_DOUBLES()) {
      expect(write, `${write.getMockName() || 'a write'} ran on a refused check-in`).not.toHaveBeenCalled();
    }
  });

  it('refuses the read endpoint the public form loads itself from', async () => {
    onPlan('free');

    expect((await getSession()).status).toBe(404);
  });

  it('🔴 never reads the session at all — the refusal is BEFORE the fetch', async () => {
    // Not decoration. Checking the plan after fetching means a refused tenant's
    // documents are read on every request, and it is the ordering that decays
    // first when someone moves the gate "somewhere tidier".
    onPlan('free');

    await submitCheckin();
    await getSession();

    expect(h.sessionGet, 'a refused tenant’s session was fetched anyway').not.toHaveBeenCalled();
  });

  it('says only "Session not found" — a visitor is not told the church’s tier', async () => {
    onPlan('free');

    const res = await submitCheckin();
    const body = await res.json();

    expect(body.error).toBe('Session not found');
    expect(JSON.stringify(body).toLowerCase()).not.toContain('plan');
    for (const tier of Object.values(PLAN_DISPLAY_NAMES)) {
      expect(JSON.stringify(body)).not.toContain(tier);
    }
  });

  it('refuses an unknown tenant rather than falling through to a default tier', async () => {
    h.tenantGet.mockResolvedValue({ exists: false, data: () => undefined });

    expect((await submitCheckin()).status).toBe(404);
    expect(h.attendeesAdd).not.toHaveBeenCalled();
  });
});

// ─── 2. the add-on rule ──────────────────────────────────────────────────────
describe('the check-in gate reads EFFECTIVE features', () => {
  it('layers the tenant’s add-ons on before answering', async () => {
    // No add-on lifts `checkInSystem` today — only the four capacity cells move
    // — so this asserts the SHAPE: an add-on record on the document neither
    // opens nor closes the gate by accident. The tier still decides.
    h.tenantGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: 'free', addons: { contactPacks: 4, adminSeats: 3, campuses: 2 } }),
    });

    expect((await submitCheckin()).status).toBe(404);

    h.tenantGet.mockResolvedValue({
      exists: true,
      data: () => ({ plan: 'pro', addons: { contactPacks: 4, adminSeats: 3, campuses: 2 } }),
    });

    expect((await submitCheckin()).status).toBe(200);
  });

  it('coerces a corrupt plan field closed rather than throwing mid-request', async () => {
    h.tenantGet.mockResolvedValue({ exists: true, data: () => ({ plan: 'enterprise-999' }) });

    // `toTenantPlan` resolves an unrecognised id to 'plus', whose cell is false.
    expect((await submitCheckin()).status).toBe(404);
  });
});

// ─── 3. every tier, from the matrix ──────────────────────────────────────────
describe('every tier is answered by its own matrix cell', () => {
  // Derived, never typed: a tier whose cell moves moves this table with it, so
  // the assertion can never drift from `PLAN_FEATURES` the way a literal list
  // of tier names would.
  for (const plan of PLAN_ORDER) {
    const allowed = getPlanFeatures(plan).checkInSystem;
    const name = PLAN_DISPLAY_NAMES[plan];

    it(`${name} ${allowed ? 'checks in' : 'is refused'}, matching its checkInSystem cell`, async () => {
      onPlan(plan);

      const res = await submitCheckin();

      expect(res.status).toBe(allowed ? 200 : 404);
      expect(h.attendeesAdd.mock.calls.length).toBe(allowed ? 1 : 0);
    });
  }

  it('🔴 the two tiers that PAY for check-in are untouched', async () => {
    // The regression that would hurt a paying church, stated as itself rather
    // than left implicit in the loop above.
    for (const plan of PLAN_ORDER.filter((p) => getPlanFeatures(p).checkInSystem)) {
      vi.clearAllMocks();
      anOpenSession();
      h.contactsGet.mockResolvedValue({ docs: [] });
      onPlan(plan);

      expect((await getSession()).status, `${PLAN_DISPLAY_NAMES[plan]} lost the read endpoint`).toBe(200);
      expect((await submitCheckin()).status, `${PLAN_DISPLAY_NAMES[plan]} lost check-in`).toBe(200);
      expect(h.attendeesAdd).toHaveBeenCalledTimes(1);
    }
  });

  it('a permitted tier still gets every downstream behaviour — nothing else moved', async () => {
    onPlan('pro');
    h.contactsGet.mockResolvedValue({
      docs: [{ id: 'c1', data: () => ({ tenantId: 't1', phone: '+15550100' }) }],
    });

    const res = await submitCheckin({ email: 'maria@example.com' });

    expect(res.status).toBe(200);
    expect(h.activitiesAdd, 'the CRM "Attended" activity stopped being written').toHaveBeenCalledTimes(1);
    expect(h.sendAutomatedSms, 'the check-in thank-you stopped firing').toHaveBeenCalledTimes(1);
    expect(h.sessionSet, 'the attendee count stopped incrementing').toHaveBeenCalledTimes(1);
  });

  it('a permitted tier keeps the closed-session and missing-session answers', async () => {
    onPlan('max');
    h.sessionGet.mockResolvedValue({ exists: true, data: () => ({ status: 'closed', name: 'x' }) });
    expect((await submitCheckin()).status).toBe(410);

    h.sessionGet.mockResolvedValue({ exists: false, data: () => undefined });
    expect((await submitCheckin()).status).toBe(404);
  });
});

// ─── 4. gate the surface, not the data ───────────────────────────────────────
describe('the refusal deletes nothing and writes nothing', () => {
  it('performs no write of any kind on any refused tier', async () => {
    for (const plan of PLAN_ORDER.filter((p) => !getPlanFeatures(p).checkInSystem)) {
      vi.clearAllMocks();
      anOpenSession();
      onPlan(plan);

      await submitCheckin({ email: 'maria@example.com' });

      for (const write of WRITE_DOUBLES()) {
        expect(write, `a write ran while refusing ${PLAN_DISPLAY_NAMES[plan]}`).not.toHaveBeenCalled();
      }
    }
  });

  it('the routes carry no delete, no cleanup and no downgrade sweep', async () => {
    // The one thing a plan gate must never grow into. A `delete` appearing in
    // either route would mean an upgrade could not restore what a downgrade hid.
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(__dirname, '..');
    for (const file of ['get/route.ts', 'submit/route.ts']) {
      const src = readFileSync(path.join(root, file), 'utf8');
      expect(src, `${file} gained a delete`).not.toMatch(/\.delete\(|deleteDoc|recursiveDelete/);
    }
  });
});
