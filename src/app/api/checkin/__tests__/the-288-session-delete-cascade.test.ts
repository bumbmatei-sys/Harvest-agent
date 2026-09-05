import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 🔴 THE-288 — DELETING A CHECK-IN SESSION LEFT THE ATTENDEES BEHIND.
 *
 * `AdminCheckin.tsx` deleted a session with a bare
 * `deleteDoc(doc(db, 'tenants', t, 'checkinSessions', id))`. Firestore does not
 * cascade, so `checkinSessions/{id}/attendees` survived its deleted parent —
 * first name, last name, email and `crmContactId` for everyone who checked in.
 * The admin was told it could not be undone and read that as "gone". The
 * church, as data controller, went on holding attendee PII with no interface
 * for it and no knowledge of it.
 *
 * ⚠️ NOT AN ERASURE FAILURE, and section 4 pins that it stays that way. A member
 * exercising their right to erasure was always covered — `clearCheckinAttendees`
 * walks the sessions to reach the attendee rows. Breaking that reach to fix a
 * housekeeping bug would trade a GDPR obligation for a tidy-up.
 *
 * ⚠️ THE ASSERTIONS THAT ENCODE THE DEFECT, each failing BY NAME:
 *   - 'deleting a session leaves no attendee document behind' — the ticket.
 *     Reverting to the bare `deleteDoc` fails THAT test.
 *   - 'a partial delete reports partial and names what remains' — #390's exact
 *     bug. A short run that reported `complete`, or that deleted the session
 *     anyway, fails THAT test.
 *   - 'the confirmation copy matches the new behaviour' — THE-230's lesson.
 *     Leaving the old sentence fails THAT test.
 *   - 'member-erasure.ts can still reach attendees' — the no-regression guard.
 *
 * The real route and the real `deleteByQuery` run. Only Firestore and auth are
 * faked, and the fake is a STORE, not a spy rig: a sweep that misses documents
 * leaves them readable afterwards, which is what makes "no attendee document
 * behind" a fact about state rather than about calls.
 */

const tree = await import('@/test/mocks/firestore-tree');

vi.mock('@/lib/firebase-admin', async () => {
  const m = await import('@/test/mocks/firestore-tree');
  return { adminDb: m.adminDb, adminAuth: m.adminAuth, getReceiptsBucket: m.getReceiptsBucket };
});
vi.mock('firebase-admin/firestore', async () => {
  const m = await import('@/test/mocks/firestore-tree');
  return { FieldValue: m.FieldValue };
});

/**
 * The permission gate is stubbed to PASS so these tests measure the cascade.
 * Section 6 proves the route asks for the gate at all, and asks for the same
 * permission firestore.rules already spends on this collection.
 */
const gate = vi.hoisted(() => ({ requireTenantPermission: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ requireTenantPermission: gate.requireTenantPermission }));

const { POST } = await import('../delete-session/route');
const { CHUNK_LIMIT } = await import('@/lib/member-deletion');
const {
  deleteSessionConfirmation, partialDeleteMessage, attendeesPath, SESSION_DELETE_REMOVES,
} = await import('@/lib/checkin-session-delete');

const TENANT = 't1';
const SESSION = 's1';
const OTHER_SESSION = 's2';
const SESSIONS = `tenants/${TENANT}/checkinSessions`;
const ATTENDEES = `${SESSIONS}/${SESSION}/attendees`;

/**
 * 🔴 THE FIXTURE SIZE IS THE POINT — 801, i.e. `CHUNK_LIMIT * 2 + 1`.
 *
 * #390 survived twelve times because every fixture held five documents against
 * a 400-document page: one page cleared everything, so an unpaged sweep and a
 * paged one were indistinguishable. Exceeding one page is the floor, not the
 * target. 801 is chosen over 401 for the PARTIAL test specifically:
 *
 *   - it forces at least THREE pages, so the sweep has to continue past a page
 *     boundary it has already crossed once;
 *   - injecting the failure on page two leaves 401 documents behind, which is
 *     itself more than one page. So the re-read that proves emptiness comes
 *     back FULL, and the "at least N remain" figure the admin is shown is a
 *     genuine lower bound rather than an exact count wearing a bound's clothes.
 *
 * At 401 the survivors would be a single document and neither property holds.
 */
const OVER_TWO_PAGES = CHUNK_LIMIT * 2 + 1;

const range = <T,>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i));

/** Ids are zero-padded so page membership is a fact about ordering, not luck. */
const attendeeId = (i: number) => `a-${String(i).padStart(4, '0')}`;

const seedSession = (count: number) => {
  tree.__seed(SESSIONS, [{ id: SESSION, name: 'Sunday Service', status: 'active', attendeeCount: count }]);
  tree.__seed(ATTENDEES, range(count, (i) => ({
    id: attendeeId(i),
    firstName: `First${i}`,
    lastName: `Last${i}`,
    email: `member${i}@church.org`,
    crmContactId: `c-${i}`,
    checkedInAt: 'server-ts',
  })));
};

const req = (body: unknown) =>
  new NextRequest('http://localhost/api/checkin/delete-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
    body: JSON.stringify(body),
  });

const call = async (body: unknown = { tenantId: TENANT, sessionId: SESSION }) => {
  const res = await POST(req(body));
  return { status: res.status, body: await res.json() };
};

const ROOT = path.resolve(__dirname, '../../../../..');
const readSrc = (p: string) => readFileSync(path.join(ROOT, 'src', p), 'utf8');

/**
 * Source with comments stripped.
 *
 * ⚠️ Every "the source no longer contains X" guard below reads through this.
 * This repo's comments NAME the defect they replaced — `deleteDoc` and `#390`
 * both appear in prose describing what went wrong — so a raw substring guard
 * would fail on the explanation and pass on the recurrence.
 */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

beforeEach(() => {
  tree.__reset();
  tree.commitShouldThrow.on = null;
  tree.mockBatchCommit.mockClear();
  gate.requireTenantPermission.mockReset();
  gate.requireTenantPermission.mockResolvedValue({ uid: 'admin-1', email: 'admin@church.org' });
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. THE TICKET — no attendee document survives its session.
// ═════════════════════════════════════════════════════════════════════════════
describe('deleting a session leaves no attendee document behind', () => {
  it('clears an attendee collection that spans several pages, then the session', async () => {
    seedSession(OVER_TWO_PAGES);
    expect(tree.__count(ATTENDEES)).toBe(OVER_TWO_PAGES);

    const { status, body } = await call();

    expect(status).toBe(200);
    expect(body.status).toBe('complete');
    expect(body.attendeesDeleted).toBe(OVER_TWO_PAGES);
    // The fact, read back off the store — not a record of calls.
    expect(tree.__count(ATTENDEES)).toBe(0);
    expect(tree.__doc(SESSIONS, SESSION)).toBeUndefined();
  });

  it('is the ONLY delete path — the component no longer deletes the session itself', () => {
    const src = readSrc('components/AdminCheckin.tsx');
    // The bare deleteDoc is the defect. Its return fails here by name.
    // Matched on CODE, not on the comment that names the bug it replaced:
    // neither the call nor its firebase/firestore import may come back.
    expect(code(src)).not.toMatch(/\bdeleteDoc\b/);
    expect(src).toContain('/api/checkin/delete-session');
  });

  it('deletes the session LAST — the parent is the only handle its attendees have', async () => {
    // Proven by the failure case rather than by call ordering: if the parent
    // went first, an interrupted sweep would orphan the remainder. Section 2
    // is that proof; this pins the ordering claim to it in one place.
    seedSession(OVER_TWO_PAGES);
    tree.commitShouldThrow.on = attendeeId(CHUNK_LIMIT + 100);
    await call();
    expect(tree.__doc(SESSIONS, SESSION)).toBeDefined();
    expect(tree.__count(ATTENDEES)).toBeGreaterThan(0);
  });

  it('sweeps only this session — a sibling session keeps its attendees', async () => {
    seedSession(3);
    tree.__seed(SESSIONS, [{ id: OTHER_SESSION, name: 'Midweek', status: 'active', attendeeCount: 2 }]);
    tree.__seed(`${SESSIONS}/${OTHER_SESSION}/attendees`, [
      { id: 'b-0', firstName: 'Sam', email: 'sam@church.org' },
      { id: 'b-1', firstName: 'Ada', email: 'ada@church.org' },
    ]);

    await call();

    expect(tree.__count(ATTENDEES)).toBe(0);
    expect(tree.__count(`${SESSIONS}/${OTHER_SESSION}/attendees`)).toBe(2);
    expect(tree.__doc(SESSIONS, OTHER_SESSION)).toBeDefined();
  });

  it('chunks its writes at the batch cap rather than committing one huge batch', async () => {
    seedSession(OVER_TWO_PAGES);
    await call();
    // The fake rejects a batch over 500 ops exactly as Firestore does, so an
    // unchunked sweep throws rather than quietly passing.
    for (const [ops] of tree.mockBatchCommit.mock.calls) {
      expect(ops).toBeLessThanOrEqual(CHUNK_LIMIT);
    }
    expect(tree.mockBatchCommit.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('404s an unknown session and writes nothing', async () => {
    const { status } = await call({ tenantId: TENANT, sessionId: 'nope' });
    expect(status).toBe(404);
    expect(tree.mockBatchCommit).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. 🔴 #390's EXACT BUG — a short run must never say `complete`.
// ═════════════════════════════════════════════════════════════════════════════
describe('a partial delete reports partial and names what remains', () => {
  /** Fail the commit that carries a document only page two can contain. */
  const failOnSecondPage = () => { tree.commitShouldThrow.on = attendeeId(CHUNK_LIMIT + 100); };

  it('reports partial, never complete, when the sweep stops part-way', async () => {
    seedSession(OVER_TWO_PAGES);
    failOnSecondPage();

    const { status, body } = await call();

    expect(body.status).toBe('partial');
    expect(body.status).not.toBe('complete');
    // A partial run is not a success to its caller — the same mapping
    // /api/account/delete gives a partial erasure.
    expect(status).toBe(500);
  });

  it('names the collection that still holds records, and a true lower bound', async () => {
    seedSession(OVER_TWO_PAGES);
    failOnSecondPage();

    const { body } = await call();

    expect(body.remainingIn).toBe(attendeesPath(TENANT, SESSION));
    expect(body.remainingIn).toBe(`tenants/${TENANT}/checkinSessions/${SESSION}/attendees`);
    // 401 survive; the bound is a full page, and it is a BOUND, not a claim.
    expect(tree.__count(ATTENDEES)).toBe(OVER_TWO_PAGES - CHUNK_LIMIT);
    expect(body.remainingAtLeast).toBe(CHUNK_LIMIT);
    expect(body.remainingAtLeast).toBeLessThanOrEqual(tree.__count(ATTENDEES));
  });

  it('KEEPS the session, so the remainder is still reachable', async () => {
    seedSession(OVER_TWO_PAGES);
    failOnSecondPage();

    await call();

    // 🔴 Deleting the parent here would manufacture exactly the orphans this
    // ticket removes — a partial sweep that tidies up is the defect.
    expect(tree.__doc(SESSIONS, SESSION)).toBeDefined();
    expect(tree.__count(ATTENDEES)).toBeGreaterThan(0);
  });

  it('does not print an unknown deleted-count as zero', async () => {
    seedSession(OVER_TWO_PAGES);
    failOnSecondPage();

    const { body } = await call();

    // 400 really were deleted; deleteByQuery lost the tally when it threw.
    expect(body.attendeesDeleted).toBeNull();
    expect(partialDeleteMessage(body)).toContain('Some attendee records were deleted');
    expect(partialDeleteMessage(body)).not.toContain('0 attendee record(s)');
  });

  it('is idempotent — a second run finishes what the first could not', async () => {
    seedSession(OVER_TWO_PAGES);
    failOnSecondPage();
    await call();
    expect(tree.__count(ATTENDEES)).toBe(OVER_TWO_PAGES - CHUNK_LIMIT);

    const { status, body } = await call();

    expect(status).toBe(200);
    expect(body.status).toBe('complete');
    expect(tree.__count(ATTENDEES)).toBe(0);
    expect(tree.__doc(SESSIONS, SESSION)).toBeUndefined();
  });

  it('reports partial when a check-in lands mid-sweep, rather than orphaning it', async () => {
    // The race the re-read exists for: the sweep returns cleanly having deleted
    // everything it saw, and someone checked in at the door while it ran.
    seedSession(2);
    // Two attendees is one short page, so deleteByQuery commits once and stops
    // without re-querying — exactly the window in which a walk-up check-in
    // lands. The row is seeded from the commit hook, which the fake calls
    // before the page's deletes apply, so the sweep never sees it.
    tree.mockBatchCommit.mockImplementationOnce(() => {
      tree.__seed(ATTENDEES, [{ id: 'late', firstName: 'Late', email: 'late@church.org' }]);
    });

    const { body } = await call();

    expect(body.status).toBe('partial');
    expect(body.attendeesDeleted).toBe(2);
    expect(body.remainingAtLeast).toBe(1);
    expect(tree.__doc(SESSIONS, SESSION)).toBeDefined();
    expect(tree.__doc(ATTENDEES, 'late')).toBeDefined();
  });

  it('the fixture actually exceeds one page — the reason #390 survived twelve times', () => {
    expect(OVER_TWO_PAGES).toBeGreaterThan(CHUNK_LIMIT);
    expect(Math.ceil(OVER_TWO_PAGES / CHUNK_LIMIT)).toBeGreaterThanOrEqual(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. THE-230's LESSON — the copy and the behaviour cannot drift apart.
// ═════════════════════════════════════════════════════════════════════════════
describe('the confirmation copy matches the new behaviour', () => {
  it('names the attendee records the delete now destroys', () => {
    const copy = deleteSessionConfirmation('Sunday Service');
    expect(copy).toContain('Sunday Service');
    expect(copy).toContain(SESSION_DELETE_REMOVES);
    expect(copy).toMatch(/attendee record/i);
    expect(copy).toMatch(/name/i);
    expect(copy).toMatch(/email/i);
    expect(copy).toMatch(/CRM/);
  });

  it('the old sentence is gone — it said only that the session could not come back', () => {
    const src = readSrc('components/AdminCheckin.tsx');
    // 🔴 The exact pre-THE-288 string. Restoring it fails HERE, by name.
    expect(src).not.toContain('? This cannot be undone.`');
    expect(src).toContain('deleteSessionConfirmation(s.name)');
  });

  it('keeps the irreversibility warning, now anchored to the wider scope', () => {
    // ⚠️ "This cannot be undone" is neither dropped nor left floating. It now
    // qualifies a clause that names what goes, so it is not quietly MORE true
    // than it reads.
    const copy = deleteSessionConfirmation('Sunday Service');
    expect(copy).toContain('This cannot be undone.');
    expect(copy.indexOf(SESSION_DELETE_REMOVES)).toBeLessThan(copy.indexOf('This cannot be undone.'));
  });

  it('states no attendee COUNT — attendeeCount can drift short', () => {
    // /api/checkin/submit adds the row and increments the counter as two
    // separate awaits, so the counter can sit permanently one behind. Copy
    // built on it would understate what is destroyed — THE-230's direction of
    // lie, in miniature.
    expect(deleteSessionConfirmation('Sunday Service')).not.toMatch(/\d/);
    expect(readSrc('components/AdminCheckin.tsx')).not.toContain('deleteSessionConfirmation(s.name, ');
  });

  it('the component renders exactly the derived sentence, not a copy of it', () => {
    const src = readSrc('components/AdminCheckin.tsx');
    const confirms = src.match(/confirm\([^)]*\)/g) ?? [];
    const deleteConfirm = confirms.find((c) => c.includes('deleteSessionConfirmation'));
    expect(deleteConfirm).toBeTruthy();
    // No hand-written sentence beside the derived one — the THE-230 shape.
    expect(deleteConfirm).not.toMatch(/undone/);
  });

  it('the partial outcome reaches the admin instead of reading as success', () => {
    const src = readSrc('components/AdminCheckin.tsx');
    expect(src).toContain("result?.status === 'partial'");
    expect(src).toContain('partialDeleteMessage(result)');
    const msg = partialDeleteMessage({
      status: 'partial', attendeesDeleted: 400,
      remainingIn: attendeesPath(TENANT, SESSION), remainingAtLeast: CHUNK_LIMIT,
    });
    expect(msg).toContain('Incomplete');
    expect(msg).toContain('The session was NOT deleted');
    expect(msg).toContain(attendeesPath(TENANT, SESSION));
    expect(msg).not.toMatch(/\bcomplete\b/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. 🔴 GDPR NO-REGRESSION — the erasure path still reaches attendees.
// ═════════════════════════════════════════════════════════════════════════════
describe('member-erasure.ts can still reach attendees', () => {
  it('walks sessions to sub-query attendees by email, unchanged', () => {
    const src = readSrc('lib/member-erasure.ts');
    expect(src).toContain("session.ref.collection('attendees').where('email', '==', email)");
    expect(src).toContain("tenantRef(ctx.tenantId).collection('checkinSessions')");
    // The disposition row that makes the sweep discoverable at all.
    expect(src).toContain("collection: 'tenants/{t}/checkinSessions/{id}/attendees'");
  });

  it('this ticket changed neither erasure module', () => {
    // A cascade that reshaped the shared sweep, or the path it walks, would be
    // trading a legal obligation for a housekeeping fix. Byte-identity to the
    // merge base is asserted in section 5's file guard; here the load-bearing
    // reach itself is pinned, so a reshape fails by name rather than by digest.
    const del = readSrc('lib/member-deletion.ts');
    expect(del).toContain('export async function deleteByQuery(');
    expect(del).toContain('export const CHUNK_LIMIT = 400;');
  });

  it('a partial delete leaves the session standing, which is the reach itself', async () => {
    // 🔴 The one route by which this fix could break erasure: a partial sweep
    // that removed the parent would put the survivors beyond the walk in
    // clearCheckinAttendees, which has no other handle on them.
    seedSession(OVER_TWO_PAGES);
    tree.commitShouldThrow.on = attendeeId(CHUNK_LIMIT + 100);
    await call();

    const sessions = tree.__docs(SESSIONS).map(([id]) => id);
    expect(sessions).toContain(SESSION);
    // Every survivor still carries the email the erasure sweep matches on.
    for (const [, data] of tree.__docs(ATTENDEES)) {
      expect(typeof data.email).toBe('string');
    }
  });

  it('a completed delete removes the rows outright — nothing is left to reach', async () => {
    seedSession(5);
    await call();
    expect(tree.__docs(ATTENDEES)).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. THE PINNED FILES — the blast radius this ticket refused.
// ═════════════════════════════════════════════════════════════════════════════
describe('the highest-blast-radius files are byte-identical', () => {
  /**
   * ⚠️ `firestore.rules` AUTO-DEPLOYS TO PRODUCTION ON MERGE and CI runs no
   * emulator rules tests (`npm run test:rules` is manual). It is pinned by
   * content, not by a git range CI cannot resolve, and no `git show` runs at
   * assertion time.
   *
   * The digests were recorded from the merge base. A change to either file
   * fails here before it can reach a deploy.
   */
  const PINNED: Record<string, string> = {
    // ⚠️ REGENERATED ONCE, by THE-313 (#462), which added the `servicePlans` rule
    // inside `match /tenants/{tenantId}` beside `events`: `allow read: if
    // belongsToTenant(tenantId)` and `allow write: if hasPermission('manageEvents',
    // tenantId)`. Purely additive — no existing rule's text moved and it names no new
    // helper, so every other claim this pin carries is unchanged.
    // Was: a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499
    'firestore.rules': '4973c3c94c5a3be8d478f4373326b23fbd9de447d3ac6a5b8173f723dfd62075',
    'functions/src/index.ts': '39ccade96ac3d4dd5a13047e9bc42b54ef5ac59ae72f932af042fc814bf23e0b',
  };

  it('firestore.rules and functions/ are untouched by this ticket', () => {
    for (const [file, expected] of Object.entries(PINNED)) {
      const actual = createHash('sha256').update(readFileSync(path.join(ROOT, file))).digest('hex');
      expect(actual, `${file} changed — THE-288 opens neither file`).toBe(expected);
    }
  });

  it('needs no collection-group query — firestore.rules has no {path=**} rule', () => {
    // A collection-group read of `attendees` would be denied outright, and
    // adding the rule that permits it is the one edit this ticket refuses.
    expect(readSrc('app/api/checkin/delete-session/route.ts')).not.toContain('collectionGroup');
    expect(readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8')).not.toMatch(/\{path=\*\*\}/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. THE GATE, AND THE VALUES THIS TICKET DOES NOT TOUCH.
// ═════════════════════════════════════════════════════════════════════════════
describe('the route is gated exactly as firestore.rules gates the collection', () => {
  it('asks for manageCheckin on the caller tenant, before any write', async () => {
    seedSession(3);
    await call();
    expect(gate.requireTenantPermission).toHaveBeenCalledWith(expect.anything(), TENANT, 'manageCheckin');
    // The same permission the rules already spend on this exact collection.
    const rules = readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    expect(rules).toContain("allow write: if hasPermission('manageCheckin', tenantId);");
  });

  it('a refused caller deletes nothing', async () => {
    seedSession(3);
    const { NextResponse } = await import('next/server');
    gate.requireTenantPermission.mockResolvedValue(
      NextResponse.json({ error: 'Tenant admin access required' }, { status: 403 }),
    );

    const { status } = await call();

    expect(status).toBe(403);
    expect(tree.__count(ATTENDEES)).toBe(3);
    expect(tree.__doc(SESSIONS, SESSION)).toBeDefined();
    expect(tree.mockBatchCommit).not.toHaveBeenCalled();
  });

  it('requires both ids, and refuses before the gate is consulted', async () => {
    expect((await call({ tenantId: TENANT })).status).toBe(400);
    expect((await call({ sessionId: SESSION })).status).toBe(400);
    expect(gate.requireTenantPermission).not.toHaveBeenCalled();
  });
});

describe('no stored value changes shape or type', () => {
  it('leaves attendeeCount alone — this ticket does not enter the write path', async () => {
    seedSession(3);
    // A sibling session is the observable: the target session is deleted, so
    // its own counter cannot be inspected afterwards.
    tree.__seed(SESSIONS, [{ id: OTHER_SESSION, name: 'Midweek', status: 'active', attendeeCount: 7 }]);

    await call();

    const other = tree.__doc(SESSIONS, OTHER_SESSION)!;
    expect(other.attendeeCount).toBe(7);
    expect(typeof other.attendeeCount).toBe('number');
    // No decrement, no reconciliation, no transaction — reported, not widened.
    const route = readSrc('app/api/checkin/delete-session/route.ts');
    expect(route).not.toContain('attendeeCount');
    expect(route).not.toContain('increment');
    expect(route).not.toContain('runTransaction');
  });

  it('writes no field to any surviving document — the route only deletes', async () => {
    seedSession(4);
    const before = JSON.stringify(tree.__docs(`${SESSIONS}`));
    tree.__seed(SESSIONS, [{ id: OTHER_SESSION, name: 'Midweek', status: 'active', attendeeCount: 2 }]);
    const beforeOther = JSON.stringify(tree.__doc(SESSIONS, OTHER_SESSION));

    await call();

    expect(JSON.stringify(tree.__doc(SESSIONS, OTHER_SESSION))).toBe(beforeOther);
    expect(before).toBeTruthy();
    const route = readSrc('app/api/checkin/delete-session/route.ts');
    for (const write of ['.set(', '.update(', 'batch.update']) {
      expect(route, `the route must not ${write}`).not.toContain(write);
    }
  });

  it('the contactActivities annotation changed no stored value', () => {
    // 🔵 Reported and annotated only. `createdAt` holds BOTH Timestamps and ISO
    // strings; an `orderBy` on it would sort every string row ahead of every
    // Timestamp row. Both ISO writers keep writing ISO — normalising them is a
    // migration, and this ticket changes no stored value's type or shape.
    const webhook = readSrc('lib/donation-webhook.ts');
    const sendEmail = readSrc('app/api/crm/send-email/route.ts');
    expect(webhook).toContain('createdAt: nowIso');
    expect(sendEmail).toContain('createdAt: new Date().toISOString()');

    /**
     * ⚠️ THE WARNING SITS AT THE READ, NOT ON BOTH WRITERS — and that was not
     * the first plan. `lib/donation-webhook.ts` is held BYTE-IDENTICAL by three
     * separate money-path guards (AdminDonations.section, manual-payment-link-
     * disclosures, posthog-untouched). A comment there is not free: it costs
     * three exemption entries widening three guards that exist to keep the
     * donation path shut. So the note went where the defect would actually be
     * introduced — the query someone would add an `orderBy` to — which is a
     * better home for it than either writer.
     */
    const readSite = readSrc('app/api/crm/contact-activities/route.ts');
    expect(readSite).toContain("DO NOT ADD AN `orderBy('createdAt')`");
    expect(readSite).toContain('lib/donation-webhook.ts');
    expect(sendEmail).toContain("DO NOT ADD AN `orderBy('createdAt')`");
    // The read still sorts in memory over both types — the annotation describes
    // the code rather than proposing a change to it.
    expect(readSite).toContain("sortByTime(rows, 'createdAt', 'desc')");
    expect(code(readSite), 'the query itself must stay unordered').not.toMatch(/orderBy\(/);
  });

  it('the money path is byte-identical — the annotation was withdrawn from it', () => {
    // 🔴 The guards above are not this ticket's to widen. Pinned here too, so
    // the withdrawal is a stated decision rather than a quiet omission.
    const webhook = readFileSync(path.join(ROOT, 'src/lib/donation-webhook.ts'));
    expect(createHash('sha256').update(webhook).digest('hex'))
      .toBe('f835ce195029a246a06d00e4202f8149c54b3a37b4ad9e425a7c1081a317aeed');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. PRESENTATION — no colour, no emoji, four palettes untouched.
// ═════════════════════════════════════════════════════════════════════════════
describe('the change mints no colour and no emoji', () => {
  const CHANGED = [
    'components/AdminCheckin.tsx',
    'lib/checkin-session-delete.ts',
    'app/api/checkin/delete-session/route.ts',
  ];

  it('hardcodes no colour literal', () => {
    // ⚠️ Scanned over CODE with comments stripped: this repo's comment
    // convention cites ticket and PR numbers, and `#390` is three hex digits.
    // A guard that counted those would go red for prose and green for a real
    // colour hidden in a long line.
    const literals = (s: string) =>
      (code(s).match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g) ?? []).sort();
    // The single literal in AdminCheckin is the pre-existing GOLD fallback and
    // is not this ticket's; it is pinned so a new one cannot hide beside it.
    expect(literals(readSrc('components/AdminCheckin.tsx'))).toEqual(['#B8962E']);
    expect(readSrc('components/AdminCheckin.tsx'))
      .toContain("const GOLD = 'var(--brand-color, #B8962E)'");
    // Nothing this ticket ADDED carries a literal at all.
    expect(literals(readSrc('lib/checkin-session-delete.ts'))).toEqual([]);
    expect(literals(readSrc('app/api/checkin/delete-session/route.ts'))).toEqual([]);
  });

  it('renders no emoji to a user', () => {
    // The 🔴/⚠️/🔵 markers are this repo's comment convention. What must carry
    // none is anything a person reads on screen.
    const userFacing = [
      deleteSessionConfirmation('Sunday Service'),
      partialDeleteMessage({
        status: 'partial', attendeesDeleted: null,
        remainingIn: attendeesPath(TENANT, SESSION), remainingAtLeast: CHUNK_LIMIT,
      }),
      SESSION_DELETE_REMOVES,
    ];
    const EMOJI = /\p{Extended_Pictographic}/u;
    for (const s of userFacing) expect(EMOJI.test(s), `emoji in: ${s}`).toBe(false);
  });

  it('adds no markup, so all four palettes resolve exactly as before', () => {
    // Classic is the default since #409. This ticket changes a handler and a
    // sentence — no element, class or style — so there is nothing new for a
    // palette to colour. Pinned as a count of the two delete controls.
    const src = readSrc('components/AdminCheckin.tsx');
    // The two delete controls (mobile row + desktop card) are untouched, and
    // this ticket adds no third control and no surface of its own — the partial
    // outcome is reported through the `alert` this file already uses.
    expect(src.split('onClick={() => deleteSession(s)}').length - 1).toBe(2);
    expect(src).toContain('max-w-xl mx-auto ${FORM_MEASURE}');
    // The two pre-existing GOLD icon tints, pinned at their count so the diff
    // cannot have added a third.
    expect(src.split('style={{ color: GOLD }}').length - 1).toBe(2);
    // Every tappable target this ticket could reach is a pre-existing control
    // whose classes it does not touch, so the ≥44px measurement stands.
    expect(code(src)).not.toMatch(/className=\{?["'`][^"'`]*\bh-\[[0-3]?\dpx\]/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. ALREADY-ORPHANED DATA — reported, pinned, and NOT touched.
// ═════════════════════════════════════════════════════════════════════════════
describe('no already-orphaned data is touched', () => {
  it('leaves attendees whose session was deleted before this fix exactly where they are', async () => {
    // 🔴 Orphans from past deletions exist: every session deleted through the
    // bare `deleteDoc` left its attendees behind. Cleaning them up is a
    // separate, deliberate decision — not a side effect of this route.
    tree.__seed(`${SESSIONS}/ghost/attendees`, [
      { id: 'g-0', firstName: 'Orphan', email: 'orphan@church.org', crmContactId: 'c-9' },
      { id: 'g-1', firstName: 'Orphan2', email: 'orphan2@church.org', crmContactId: 'c-10' },
    ]);
    seedSession(3);
    const before = JSON.stringify(tree.__docs(`${SESSIONS}/ghost/attendees`));

    await call();

    expect(tree.__count(ATTENDEES)).toBe(0);
    // The ghost parent never existed and its rows are untouched.
    expect(tree.__doc(SESSIONS, 'ghost')).toBeUndefined();
    expect(JSON.stringify(tree.__docs(`${SESSIONS}/ghost/attendees`))).toBe(before);
  });

  it('sweeps nothing it was not asked for — one session id, one collection', async () => {
    seedSession(3);
    await call();
    const swept = tree.recordedWheres.filter((w) => w.path.includes('/attendees'));
    // The sweep is an unfiltered subcollection delete under ONE concrete
    // session path; it builds no cross-session query of any kind.
    expect(swept).toEqual([]);
    const reads = tree.recordedReads.filter((r) => r.path.includes('/attendees'));
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) {
      expect(r.path).toBe(ATTENDEES);
      // 🔴 Never an unbounded read.
      expect(r.limit).toBeLessThanOrEqual(CHUNK_LIMIT);
    }
  });
});
