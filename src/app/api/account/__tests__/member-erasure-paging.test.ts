import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * 🔴 THE-229 — THE ERASURE REPORTED COMPLETE AFTER DELETING ONE PAGE.
 *
 * Twelve sweeps in member-erasure.ts took a single `.limit(CHUNK_LIMIT).get()`
 * and iterated `snap.docs` with NO OUTER LOOP. Once a collection held more than
 * one page the remainder was never touched — a member who liked more than 400
 * posts kept their uid on the rest, a church with more than 400 check-in
 * sessions kept the member's attendee rows — and the run still returned
 * `status: 'complete'`, because that word was a hardcoded literal on the way
 * out. A silent failure on an irreversible, legally-weighted action.
 *
 * ⚠️ WHY THE EXISTING SUITE NEVER CAUGHT IT. Every fixture in
 * member-erasure.test.ts is three or four documents per collection, so one page
 * always held everything and an unpaged sweep looked identical to a paged one.
 * EVERY FIXTURE HERE EXCEEDS `CHUNK_LIMIT` for that reason: at 401 documents a
 * sweep that fetches one page returns 400 of them, makes exactly one read, and
 * fails the assertion named for it.
 *
 * ⚠️ THE ASSERTIONS THAT ENCODE THE DEFECTS, each failing BY NAME:
 *   - twelve `pages past CHUNK_LIMIT` assertions, one per confirmed site.
 *     Reverting any one sweep to a single `.limit()` fails THAT sweep's test.
 *   - 'a run that could not finish does not report complete' — the honesty
 *     guard. Restoring the hardcoded `'complete' as const` fails THAT test.
 *   - 'every page fetch carries a concrete tenant id and uid' — the breach
 *     guard, extended to the SECOND and later pages, which is new surface: a
 *     cursor page rebuilt without its filters would read across every tenant.
 *
 * The real erasure module runs. Only Firestore and the receipts bucket are
 * faked, and the fake is a store, not a spy rig — a sweep that misses documents
 * leaves them readable in the store afterwards.
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

const {
  eraseMemberData,
  resolveContactIds,
  MEMBER_DATA_MAP,
  SWEEP_SCAN_CAP,
  PARENT_SCAN_CAP,
  DELETED_MEMBER_NAME,
} = await import('@/lib/member-erasure');
const { CHUNK_LIMIT, anonymisedDonorEmail, DELETED_DONOR_NAME } = await import('@/lib/member-deletion');
const { assertExportCoversMap } = await import('@/lib/member-export');

const UID = 'member-1';
const OTHER_UID = 'member-2';
const EMAIL = 'grace@church.org';
const OTHER_EMAIL = 'sam@church.org';
const TENANT = 't1';
const OTHER_TENANT = 't2';

/**
 * One more document than a single page holds.
 *
 * 🔴 THE NUMBER IS THE POINT. At `CHUNK_LIMIT` exactly, an unpaged sweep still
 * clears everything and every assertion below passes with the bug intact — which
 * is precisely how a four-document fixture missed this for two releases.
 */
const OVER = CHUNK_LIMIT + 1;

const range = <T,>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i));

/** The last parent in each two-level collection — the one only a paged walk reaches. */
const FAR = OVER - 1;

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A member whose every collection spans more than one page.
 *
 * The decoys matter as much as the volume: another member's rows, and the same
 * member's rows in ANOTHER church. A sweep that passes by clearing a collection
 * wholesale destroys those, and the breach guard below fails.
 */
function seedOverAPage() {
  tree.__seed('users', [
    { id: UID, email: EMAIL, displayName: 'Grace', tenantId: TENANT, totalDonated: 250 },
    { id: OTHER_UID, email: OTHER_EMAIL, displayName: 'Sam', tenantId: TENANT },
  ]);

  // Contacts: more than a page of rows keyed to this member, all but two in a
  // DIFFERENT church. The query spans two pages; the tenant guard keeps the
  // resolved contact-id list small, exactly as it would in production for a
  // member who moved churches.
  tree.__seed('contacts', [
    ...range(OVER, (i) => ({
      id: `c-far-${i}`, userId: UID, email: EMAIL, tenantId: OTHER_TENANT, totalDonated: 0,
    })),
    { id: 'c-plain', userId: UID, email: EMAIL, firstName: 'Grace', phone: '555', tenantId: TENANT, totalDonated: 0 },
    { id: 'c-donor', userId: UID, email: EMAIL, firstName: 'Grace', tenantId: TENANT, totalDonated: 250 },
    { id: 'c-other', userId: OTHER_UID, email: OTHER_EMAIL, tenantId: TENANT, totalDonated: 0 },
  ]);

  tree.__seed('contactActivities', [
    { id: 'a-note', contactId: 'c-plain', tenantId: TENANT, type: 'note', description: `Grace ${EMAIL}` },
    { id: 'a-gift', contactId: 'c-donor', tenantId: TENANT, type: 'donation', amount: 250 },
  ]);

  // Other people's posts the member liked and RSVPd to — the two array sweeps.
  tree.__seed('community_posts', [
    ...range(OVER, (i) => ({
      id: `post-theirs-${i}`,
      authorId: OTHER_UID, authorName: 'Sam', tenantId: TENANT,
      likes: [UID, OTHER_UID],
      eventDetails: {
        attendees: [UID, OTHER_UID],
        attendeeDetails: [
          { uid: UID, name: 'Grace', email: EMAIL },
          { uid: OTHER_UID, name: 'Sam', email: OTHER_EMAIL },
        ],
      },
    })),
    ...range(3, (i) => ({ id: `post-mine-${i}`, authorId: UID, authorName: 'Grace', tenantId: TENANT })),
    { id: 'post-elsewhere', authorId: OTHER_UID, tenantId: OTHER_TENANT, likes: [UID] },
  ]);
  tree.__seed('community_posts/post-theirs-0/comments', [
    { id: 'cm-mine', authorId: UID, authorName: 'Grace', tenantId: TENANT },
    { id: 'cm-theirs', authorId: OTHER_UID, authorName: 'Sam', tenantId: TENANT },
  ]);

  tree.__seed('prayer_requests', [
    ...range(OVER, (i) => ({ id: `pr-${i}`, authorId: OTHER_UID, tenantId: TENANT, prayedBy: [UID, OTHER_UID] })),
    { id: 'pr-mine', authorId: UID, authorName: 'Grace', tenantId: TENANT, request: 'please pray' },
  ]);

  tree.__seed('certificates', [
    ...range(OVER, (i) => ({
      id: `${UID}_course-${i}`, uid: UID, learnerName: 'Grace', tenantId: TENANT,
      pdfPath: `receipts/${TENANT}/certificates/${UID}_course-${i}.pdf`,
    })),
    { id: `${OTHER_UID}_course-0`, uid: OTHER_UID, learnerName: 'Sam', tenantId: TENANT },
  ]);

  tree.__seed('chat_usage', [{ id: UID, count: 12 }]);
  tree.__seed('platform_inbox', [{ id: 'ticket-1', userId: UID, userEmail: EMAIL, message: 'help' }]);
  tree.__seed('churches', [{ id: 'ch-1', userId: UID, tenantId: TENANT, name: 'Grace Chapel' }]);

  // ── Tenant-scoped ──────────────────────────────────────────────────────────
  tree.__seed(`tenants/${TENANT}/channels`, [
    ...range(OVER, (i) => ({ id: `chan-${i}`, name: `#room-${i}`, members: [UID, OTHER_UID] })),
  ]);

  // Two-level collections. The member's row sits in the LAST parent, so only a
  // walk that pages past the first 400 parents ever reaches it.
  tree.__seed(`tenants/${TENANT}/checkinSessions`, range(OVER, (i) => ({ id: `sess-${i}`, date: `2026-01-${i}` })));
  tree.__seed(`tenants/${TENANT}/checkinSessions/sess-${FAR}/attendees`, [
    { id: 'att-mine', firstName: 'Grace', lastName: 'M', email: EMAIL },
    { id: 'att-theirs', firstName: 'Sam', email: OTHER_EMAIL },
  ]);

  tree.__seed(`tenants/${TENANT}/forms`, range(OVER, (i) => ({ id: `form-${i}`, title: `Form ${i}` })));
  tree.__seed(`tenants/${TENANT}/forms/form-${FAR}/submissions`, [
    { id: 'sub-mine', crmContactId: 'c-plain', ipAddress: '10.0.0.1', answers: { email: EMAIL } },
    { id: 'sub-theirs', crmContactId: 'c-other', answers: { email: OTHER_EMAIL } },
  ]);

  tree.__seed(`tenants/${TENANT}/livestreamSessions`, range(OVER, (i) => ({ id: `live-${i}`, title: `Service ${i}` })));
  tree.__seed(`tenants/${TENANT}/livestreamSessions/live-${FAR}/comments`, [
    { id: 'lc-mine', authorId: UID, name: 'Grace', text: 'amen' },
    { id: 'lc-theirs', authorId: OTHER_UID, name: 'Sam', text: 'amen' },
  ]);
  tree.__seed(`tenants/${TENANT}/livestreamSessions/live-${FAR}/prayers`, [
    { id: 'pray-1', name: 'Grace', prayerText: 'for my family' },
  ]);

  // Money. Anonymised, never deleted — and more than a page of it.
  tree.__seed(`tenants/${TENANT}/invoices`, [
    ...range(OVER, (i) => ({
      id: `inv-${i}`, type: 'donation_receipt', recipientEmail: 'Grace@Church.org', recipientName: 'Grace',
      amount: 25, currency: 'usd', issuedAt: '2026-03-01T00:00:00.000Z', receiptNumber: `R-${i}`,
    })),
    { id: 'inv-other', type: 'donation_receipt', recipientEmail: OTHER_EMAIL, recipientName: 'Sam', amount: 40, issuedAt: '2026-03-01T00:00:00.000Z' },
  ]);
  tree.__seed(`tenants/${TENANT}/givingStatements`, [{ id: 'gs-1', donorEmail: EMAIL, donorName: 'Grace', year: 2025 }]);
  tree.__seed(`tenants/${TENANT}/pledges`, [{ id: 'pl-1', donorEmail: EMAIL, donorName: 'Grace', donorPhone: '555', notes: 'monthly', amount: 100 }]);

  tree.__seed(`tenants/${TENANT}/dmMessages`, [{ id: 'dm-1', senderId: UID, senderName: 'Grace', content: 'hello' }]);
  tree.__seed(`tenants/${TENANT}/channelMessages`, [{ id: 'chm-1', senderId: UID, senderName: 'Grace', content: 'hi all' }]);
  tree.__seed(`tenants/${TENANT}/directMessages`, [
    {
      id: 'thread-1', participants: [UID, OTHER_UID],
      participantNames: { [UID]: 'Grace', [OTHER_UID]: 'Sam' },
      lastMessage: 'see you Sunday', lastMessageBy: UID,
    },
  ]);
  tree.__seed(`tenants/${TENANT}/canvases`, [{ id: 'cv-1', createdBy: UID, createdByName: 'Grace' }]);
  tree.__seed(`tenants/${TENANT}/registrations`, [{ id: 'reg-1', userId: UID, email: EMAIL, phone: '555' }]);
  tree.__seed(`tenants/${TENANT}/integrations`, [{ id: `${UID}_gmail`, connectedBy: UID, refreshToken: 'x' }]);
  tree.__seed(`tenants/${TENANT}/smsLogs`, [{ id: 'sms-1', phone: '555', body: 'Sunday service' }]);

  // A whole other church, untouched by anything below.
  tree.__seed(`tenants/${OTHER_TENANT}/invoices`, [
    { id: 'inv-far', type: 'donation_receipt', recipientEmail: EMAIL, recipientName: 'Grace', amount: 99 },
  ]);
  tree.__seed(`tenants/${OTHER_TENANT}/channels`, [{ id: 'chan-far', members: [UID] }]);
}

/** The context the route builds, with the contact ids it resolves first. */
const context = (contactIds: string[] = [UID, 'c-plain', 'c-donor']) => ({
  uid: UID, email: EMAIL, tenantId: TENANT, contactIds,
});

beforeEach(() => {
  tree.__reset();
  tree.mockBatchCommit.mockClear();
  tree.mockRecursiveDelete.mockClear();
  tree.commitShouldThrow.on = null;
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers over the recorded reads
// ─────────────────────────────────────────────────────────────────────────────

/** Every read the run made against one collection, optionally narrowed to a filter field. */
function readsOn(collection: string, field?: string) {
  return tree.recordedReads.filter(
    (r) =>
      (r.path === collection || r.group === collection) &&
      (field === undefined || r.filters.some((f) => f.field === field)),
  );
}

/**
 * The proof a sweep paged: it fetched a second page with a cursor, and more than
 * one page's worth of documents came back across the run.
 *
 * A sweep that takes a single `.limit(CHUNK_LIMIT)` page makes exactly one read
 * with `after: null` and returns exactly `CHUNK_LIMIT` documents — it fails both
 * halves.
 */
function expectPaged(collection: string, field?: string) {
  const reads = readsOn(collection, field);
  const returned = reads.reduce((n, r) => n + r.returned, 0);
  const label = field ? `${collection} (${field})` : collection;
  expect(reads.length, `${label}: only one read — the sweep never asked for a second page`).toBeGreaterThan(1);
  expect(reads.some((r) => r.after !== null), `${label}: no read carried a startAfter cursor`).toBe(true);
  expect(returned, `${label}: fetched ${returned} documents, no more than one page holds`).toBeGreaterThan(CHUNK_LIMIT);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. The twelve sites
// ─────────────────────────────────────────────────────────────────────────────

describe('every sweep pages past CHUNK_LIMIT', () => {
  /**
   * One assertion per confirmed site, named so a revert fails by name rather
   * than as "something is left behind". Eleven of the twelve run inside
   * `eraseMemberData`; `resolveContactIds` is the route's own call and gets its
   * own two below, on a clean read log so its `contacts` reads cannot be
   * confused with `clearContacts`'.
   */
  beforeEach(async () => {
    seedOverAPage();
    await eraseMemberData(context());
  });

  it('clearContacts pages the contacts keyed by uid', () => expectPaged('contacts', 'userId'));
  it('clearContacts pages the contacts keyed by email', () => expectPaged('contacts', 'email'));
  it('clearPostParticipation pages the posts the member RSVPd to', () =>
    expectPaged('community_posts', 'eventDetails.attendees'));
  it('clearPostLikes pages the posts the member liked', () => expectPaged('community_posts', 'likes'));
  it('clearPrayedBy pages the prayer requests the member prayed for', () =>
    expectPaged('prayer_requests', 'prayedBy'));
  it('clearCertificates pages the certificates', () => expectPaged('certificates', 'uid'));
  it('clearCheckinAttendees pages the check-in sessions it walks', () =>
    expectPaged(`tenants/${TENANT}/checkinSessions`));
  it('clearFormSubmissions pages the forms it walks', () => expectPaged(`tenants/${TENANT}/forms`));
  it('clearLivestreamComments pages the livestream sessions it walks', () =>
    expectPaged(`tenants/${TENANT}/livestreamSessions`));
  it('clearChannelMembership pages the channels', () => expectPaged(`tenants/${TENANT}/channels`, 'members'));

  it('resolveContactIds pages the contacts keyed by uid', async () => {
    tree.__reset();
    seedOverAPage();
    await resolveContactIds(UID, EMAIL, TENANT);
    expectPaged('contacts', 'userId');
  });

  it('resolveContactIds pages the contacts keyed by email', async () => {
    tree.__reset();
    seedOverAPage();
    await resolveContactIds(UID, EMAIL, TENANT);
    expectPaged('contacts', 'email');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The consequence
// ─────────────────────────────────────────────────────────────────────────────

describe('a member with more documents than one page is fully erased', () => {
  let report: Awaited<ReturnType<typeof eraseMemberData>>;

  beforeEach(async () => {
    seedOverAPage();
    const contactIds = await resolveContactIds(UID, EMAIL, TENANT);
    report = await eraseMemberData(context(contactIds));
  });

  it('🔴 leaves the member on NONE of the posts they liked, not just the first page', () => {
    const stillLiked = tree
      .__docs('community_posts')
      .filter(([, d]) => (d.tenantId ?? null) === TENANT && ((d.likes as string[]) ?? []).includes(UID));
    expect(stillLiked.map(([id]) => id)).toEqual([]);
  });

  it('🔴 removes the member from every RSVP, name and email included', () => {
    for (const [id, d] of tree.__docs('community_posts')) {
      if ((d.tenantId ?? null) !== TENANT) continue;
      const ev = d.eventDetails as { attendees?: string[]; attendeeDetails?: { uid?: string }[] } | undefined;
      expect(ev?.attendees ?? [], `${id} still lists the member as an attendee`).not.toContain(UID);
      expect((ev?.attendeeDetails ?? []).map((a) => a?.uid), `${id} still holds the member's name and email`)
        .not.toContain(UID);
    }
  });

  it('removes the member from every prayer request they prayed for', () => {
    const left = tree.__docs('prayer_requests').filter(([, d]) => ((d.prayedBy as string[]) ?? []).includes(UID));
    expect(left.map(([id]) => id)).toEqual([]);
  });

  it('deletes every certificate and every stored PDF, past the page boundary', () => {
    expect(tree.__docs('certificates').filter(([, d]) => d.uid === UID)).toEqual([]);
    expect(tree.deletedObjects).toHaveLength(OVER);
  });

  it('removes the member from every channel', () => {
    const left = tree
      .__docs(`tenants/${TENANT}/channels`)
      .filter(([, d]) => ((d.members as string[]) ?? []).includes(UID));
    expect(left.map(([id]) => id)).toEqual([]);
  });

  it('🔴 reaches the check-in row in the LAST session — the one a single page never sees', () => {
    const attendees = tree.__docs(`tenants/${TENANT}/checkinSessions/sess-${FAR}/attendees`);
    expect(attendees.map(([id]) => id)).toEqual(['att-theirs']);
  });

  it('🔴 reaches the form submission in the LAST form', () => {
    const subs = tree.__docs(`tenants/${TENANT}/forms/form-${FAR}/submissions`);
    expect(subs.map(([id]) => id)).toEqual(['sub-theirs']);
  });

  it('🔴 reaches the livestream comment in the LAST session', () => {
    const comments = tree.__docs(`tenants/${TENANT}/livestreamSessions/live-${FAR}/comments`);
    expect(comments.map(([id]) => id)).toEqual(['lc-theirs']);
  });

  it('anonymises every one of the donations, not just the first page', () => {
    const mine = tree
      .__docs(`tenants/${TENANT}/invoices`)
      .filter(([id]) => id.startsWith('inv-') && id !== 'inv-other');
    expect(mine).toHaveLength(OVER);
    for (const [id, d] of mine) {
      expect(d.recipientEmail, `${id} still carries the donor's real address`)
        .toBe(anonymisedDonorEmail(UID, TENANT));
      expect(d.recipientName).toBe(DELETED_DONOR_NAME);
    }
  });

  it('another church is never read from, let alone written to', () => {
    expect(tree.recordedReads.filter((r) => r.path.startsWith(`tenants/${OTHER_TENANT}`))).toEqual([]);
    expect(tree.__docs(`tenants/${OTHER_TENANT}/channels`)).toEqual([['chan-far', { members: [UID] }]]);
    // The far-church rows, the other member's row, and the member's own DONOR
    // row — anonymised in place, because it carries the church's giving history.
    expect(tree.__count('contacts')).toBe(OVER + 2);
    expect(tree.__doc('contacts', 'c-donor')).toMatchObject({ firstName: DELETED_DONOR_NAME, donorDeleted: true });
    expect(tree.__doc('contacts', 'c-plain')).toBeUndefined();
  });

  it('and only then reports complete', () => {
    expect(report.failures).toEqual([]);
    expect(report.status).toBe('complete');
  });

  it('never commits a batch over Firestore’s 500-operation cap', () => {
    const sizes = tree.mockBatchCommit.mock.calls.map((c) => c[0] as number);
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(CHUNK_LIMIT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 & 4. The honesty guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A member whose likes exceed the per-sweep scan cap and whose church has more
 * check-in sessions than the parent-walk cap — the two shapes of "there was more
 * and this run did not reach it".
 */
function seedBeyondTheCaps() {
  tree.__seed('users', [{ id: UID, email: EMAIL, tenantId: TENANT }]);
  tree.__seed(
    'community_posts',
    range(SWEEP_SCAN_CAP + 1, (i) => ({ id: `p-${i}`, authorId: OTHER_UID, tenantId: TENANT, likes: [UID] })),
  );
  tree.__seed(`tenants/${TENANT}/checkinSessions`, range(PARENT_SCAN_CAP + 1, (i) => ({ id: `s-${i}` })));
  tree.__seed(`tenants/${TENANT}/invoices`, [
    { id: 'inv-1', type: 'donation_receipt', recipientEmail: EMAIL, recipientName: 'Grace', amount: 25 },
  ]);
}

describe('a run that could not finish does not report complete', () => {
  let report: Awaited<ReturnType<typeof eraseMemberData>>;

  beforeEach(async () => {
    seedBeyondTheCaps();
    report = await eraseMemberData(context([UID]));
  });

  it('🔴 reports partial, not complete — the status has to survive the run, not be asserted at the end', () => {
    expect(report.status).toBe('partial');
  });

  it('🔴 says so in words, so a caller reading the body sees it without diffing counts', () => {
    expect(report.error).toMatch(/incomplete/i);
  });

  it('still reports the work it DID do — a truthful partial, not a bare failure', () => {
    expect(report.cleared['community_posts.likes']).toBe(SWEEP_SCAN_CAP);
    expect(report.anonymised['tenants/{t}/invoices']).toBe(1);
  });

  it('keeps running every other sweep — one stalled collection never aborts the rest', () => {
    expect(Object.keys(report.cleared).length).toBeGreaterThan(10);
  });
});

describe('a partial run names which sweeps were incomplete', () => {
  let report: Awaited<ReturnType<typeof eraseMemberData>>;

  beforeEach(async () => {
    seedBeyondTheCaps();
    report = await eraseMemberData(context([UID]));
  });

  it('🔴 names the collection BY ITS MAP LABEL, never a raw query', () => {
    const named = report.failures.map((f) => f.collection);
    expect(named).toContain('community_posts.likes');
    expect(named).toContain('tenants/{t}/checkinSessions/{id}/attendees');
    for (const label of named) expect(MEMBER_DATA_MAP.map((e) => e.collection)).toContain(label);
  });

  it('says why it stopped and that a re-run resumes', () => {
    const likes = report.failures.find((f) => f.collection === 'community_posts.likes');
    expect(likes?.message).toMatch(/Incomplete/);
    expect(likes?.message).toMatch(new RegExp(String(SWEEP_SCAN_CAP)));
    expect(likes?.message).toMatch(/idempotent/);
  });

  it('counts the incomplete collections in the error sentence', () => {
    expect(report.error).toContain(`${report.failures.length} collection(s)`);
  });

  it('does not name a sweep that finished', () => {
    expect(report.failures.map((f) => f.collection)).not.toContain('tenants/{t}/invoices');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5 & 6. The money — unchanged by any of this
// ─────────────────────────────────────────────────────────────────────────────

describe('donations are still anonymised with a stable pseudonym, never deleted', () => {
  beforeEach(async () => {
    seedOverAPage();
    await eraseMemberData(context());
  });

  it('🔴 every invoice survives — the count is what it was before the erasure', () => {
    expect(tree.__count(`tenants/${TENANT}/invoices`)).toBe(OVER + 1);
  });

  it('keeps every figure on the record whole', () => {
    const inv = tree.__doc(`tenants/${TENANT}/invoices`, 'inv-7');
    expect(inv).toMatchObject({ amount: 25, currency: 'usd', receiptNumber: 'R-7', type: 'donation_receipt' });
  });

  it('🔴 replaces the address with a stable pseudonym rather than blanking it', () => {
    const inv = tree.__doc(`tenants/${TENANT}/invoices`, 'inv-7');
    expect(inv?.recipientEmail).toBe(anonymisedDonorEmail(UID, TENANT));
    expect(inv?.recipientEmail).not.toBe('');
    expect(String(inv?.recipientEmail)).toMatch(/^deleted-donor-[0-9a-f]{24}@deleted\.invalid$/);
  });

  it('gives every one of the member’s gifts the SAME pseudonym, so they stay one donor', () => {
    const emails = new Set(
      tree.__docs(`tenants/${TENANT}/invoices`)
        .filter(([id]) => id !== 'inv-other')
        .map(([, d]) => d.recipientEmail),
    );
    expect(emails.size).toBe(1);
  });

  it('leaves another donor’s invoice alone', () => {
    expect(tree.__doc(`tenants/${TENANT}/invoices`, 'inv-other')?.recipientEmail).toBe(OTHER_EMAIL);
  });

  it('anonymises the pledges and the issued statements the same way', () => {
    expect(tree.__doc(`tenants/${TENANT}/pledges`, 'pl-1')).toMatchObject({
      donorName: DELETED_DONOR_NAME, donorEmail: anonymisedDonorEmail(UID, TENANT), notes: '',
    });
    expect(tree.__doc(`tenants/${TENANT}/givingStatements`, 'gs-1')?.donorEmail)
      .toBe(anonymisedDonorEmail(UID, TENANT));
  });
});

describe('the year-end statement still groups a deleted donor’s gifts', () => {
  /**
   * The generator's own loop, run over the store the erasure left behind:
   *
   *   const donorEmail = (inv.recipientEmail || '').toLowerCase();
   *   if (!donorEmail) continue;
   *
   * A blanked address would drop every one of these gifts out of the church's
   * year-end statement. Paging the sweep must not change that — so the property
   * is asserted end-to-end here, over more than a page of donations, rather than
   * against a hand-anonymised fixture.
   */
  function groupByDonor() {
    const donors = new Map<string, { total: number; count: number; name: string }>();
    for (const [, inv] of tree.__docs(`tenants/${TENANT}/invoices`)) {
      if (inv.type !== 'donation_receipt') continue;
      const donorEmail = String(inv.recipientEmail || '').toLowerCase();
      if (!donorEmail) continue;
      const donor = donors.get(donorEmail) ?? { total: 0, count: 0, name: String(inv.recipientName ?? '') };
      donor.total += Number(inv.amount ?? 0);
      donor.count += 1;
      donors.set(donorEmail, donor);
    }
    return donors;
  }

  it('🔴 the gifts are still grouped — every one of them, on one statement', async () => {
    seedOverAPage();
    const before = groupByDonor().get(EMAIL);
    expect(before).toMatchObject({ count: OVER, total: OVER * 25 });

    await eraseMemberData(context());

    const after = groupByDonor().get(anonymisedDonorEmail(UID, TENANT));
    expect(after, 'the deleted donor fell out of the statement entirely').toBeDefined();
    expect(after).toMatchObject({ count: OVER, total: OVER * 25 });
  });

  it('the church’s total for the year is unchanged by the erasure', async () => {
    seedOverAPage();
    const totalBefore = [...groupByDonor().values()].reduce((n, d) => n + d.total, 0);
    await eraseMemberData(context());
    const totalAfter = [...groupByDonor().values()].reduce((n, d) => n + d.total, 0);
    expect(totalAfter).toBe(totalBefore);
  });

  it('and the donor is no longer identifiable on the statement', async () => {
    seedOverAPage();
    await eraseMemberData(context());
    expect(groupByDonor().get(EMAIL)).toBeUndefined();
    expect(groupByDonor().get(anonymisedDonorEmail(UID, TENANT))?.name).toBe(DELETED_DONOR_NAME);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. The other party's history
// ─────────────────────────────────────────────────────────────────────────────

describe('the DM thread is still anonymised rather than deleted', () => {
  beforeEach(async () => {
    seedOverAPage();
    await eraseMemberData(context());
  });

  it('🔴 the thread survives — deleting it would take the other party’s messages with it', () => {
    expect(tree.__doc(`tenants/${TENANT}/directMessages`, 'thread-1')).toBeDefined();
  });

  it('replaces the deleted member’s display name and clears the preview they wrote', () => {
    const t = tree.__doc(`tenants/${TENANT}/directMessages`, 'thread-1');
    expect((t?.participantNames as Record<string, string>)[UID]).toBe(DELETED_MEMBER_NAME);
    expect((t?.participantNames as Record<string, string>)[OTHER_UID]).toBe('Sam');
    expect(t?.lastMessage).toBe('');
  });

  it('keeps the participants array, which is how the surviving member finds the thread', () => {
    expect(tree.__doc(`tenants/${TENANT}/directMessages`, 'thread-1')?.participants).toContain(UID);
  });

  it('but the messages the member sent are gone', () => {
    expect(tree.__count(`tenants/${TENANT}/dmMessages`)).toBe(0);
    expect(tree.__count(`tenants/${TENANT}/channelMessages`)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. The gaps
// ─────────────────────────────────────────────────────────────────────────────

describe('the three unkeyed collections are still reported as gaps', () => {
  const UNKEYED = [
    'tenants/{t}/livestreamSessions/{id}/prayers',
    'tenants/{t}/smsLogs',
    'tenants/{t}/smsBroadcasts/{id}/logs',
  ];

  it('🔴 all three are declared, machine-readably, and none is guessed at', () => {
    const declared = MEMBER_DATA_MAP.flatMap((e) => e.unkeyed ?? []);
    expect([...declared].sort()).toEqual([...UNKEYED].sort());
  });

  it('each one reaches the report with the reason a reader needs', async () => {
    seedOverAPage();
    const report = await eraseMemberData(context());
    const gaps = MEMBER_DATA_MAP.filter((e) => e.unkeyed);
    for (const entry of gaps) {
      expect(report.retained[entry.collection]).toBe(entry.reason);
      expect(report.retained[entry.collection]).toMatch(/GAP/);
    }
  });

  it('🔴 and nothing was deleted from them on a guess — the prayers and the SMS log survive', async () => {
    seedOverAPage();
    await eraseMemberData(context());
    expect(tree.__count(`tenants/${TENANT}/livestreamSessions/live-${FAR}/prayers`)).toBe(1);
    expect(tree.__count(`tenants/${TENANT}/smsLogs`)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. The breach guard
// ─────────────────────────────────────────────────────────────────────────────

describe('every page fetch carries a concrete tenant id and uid, never null', () => {
  beforeEach(async () => {
    seedOverAPage();
    const contactIds = await resolveContactIds(UID, EMAIL, TENANT);
    await eraseMemberData(context(contactIds));
  });

  it('🔴 no query was ever built from a null, undefined or empty scope', () => {
    const loose = tree.recordedWheres.filter(
      (w) => w.value === null || w.value === undefined || w.value === '',
    );
    expect(loose).toEqual([]);
  });

  it('🔴 every read is bounded — no sweep ever asked for a collection without a limit', () => {
    const unbounded = tree.recordedReads.filter((r) => !Number.isFinite(r.limit));
    expect(unbounded).toEqual([]);
    for (const r of tree.recordedReads) expect(r.limit).toBeLessThanOrEqual(CHUNK_LIMIT);
  });

  it('🔴 the SECOND page is scoped exactly like the first — a cursor never widens a query', () => {
    const later = tree.recordedReads.filter((r) => r.after !== null);
    expect(later.length).toBeGreaterThan(0);
    for (const r of later) {
      const first = tree.recordedReads.find(
        (f) => f.after === null && f.path === r.path && f.group === r.group &&
          JSON.stringify(f.filters) === JSON.stringify(r.filters),
      );
      expect(first, `a cursor page on ${r.path || r.group} has no first page with the same filters`).toBeDefined();
    }
  });

  it('every read is bounded to this member’s own church, or to the member themselves', () => {
    const memberKeys = new Set([UID, EMAIL, ...['c-plain', 'c-donor']]);
    for (const r of tree.recordedReads) {
      const tenantScoped = r.path.startsWith(`tenants/${TENANT}/`);
      const memberScoped = r.filters.some((f) => memberKeys.has(String(f.value)));
      expect(
        tenantScoped || memberScoped,
        `a read on ${r.path || `group:${r.group}`} was bounded by neither the tenant nor the member`,
      ).toBe(true);
    }
  });

  it('refuses outright rather than half-resolving a runaway contact list', async () => {
    tree.__reset();
    tree.__seed('users', [{ id: UID, email: EMAIL, tenantId: TENANT }]);
    tree.__seed(
      'contacts',
      range(SWEEP_SCAN_CAP + 1, (i) => ({ id: `c-${i}`, userId: UID, tenantId: TENANT })),
    );
    await expect(resolveContactIds(UID, EMAIL, TENANT)).rejects.toThrow(/Refusing to erase/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10 & 11. The things this PR must not have moved
// ─────────────────────────────────────────────────────────────────────────────

describe('MEMBER_DATA_MAP is still the sole enumeration', () => {
  it('🔴 the export and the map still agree, by name', () => {
    expect(() => assertExportCoversMap()).not.toThrow();
  });

  it('🔴 every collection in the report came from the map — the run holds no second list', async () => {
    seedOverAPage();
    const report = await eraseMemberData(context());
    const labels = new Set(MEMBER_DATA_MAP.map((e) => e.collection));
    for (const key of [...Object.keys(report.cleared), ...Object.keys(report.anonymised), ...Object.keys(report.retained)]) {
      expect(labels, `${key} is reported but is not an entry in MEMBER_DATA_MAP`).toContain(key);
    }
  });

  it('and every entry in the map reached the report — nothing was swept without being documented', async () => {
    seedOverAPage();
    const report = await eraseMemberData(context());
    const reported = new Set([
      ...Object.keys(report.cleared), ...Object.keys(report.anonymised), ...Object.keys(report.retained),
    ]);
    for (const entry of MEMBER_DATA_MAP) {
      if (!entry.sweep && entry.disposition !== 'retain') continue; // `users`, deleted by the route
      expect(reported, `${entry.collection} is in the map but never reached the report`).toContain(entry.collection);
    }
  });

  it('the map still holds 25 acted-on collections — 19 swept, 6 anonymised — and 3 declared gaps', () => {
    expect(MEMBER_DATA_MAP.filter((e) => e.disposition === 'delete')).toHaveLength(19);
    expect(MEMBER_DATA_MAP.filter((e) => e.disposition === 'anonymise')).toHaveLength(6);
    expect(MEMBER_DATA_MAP.flatMap((e) => e.unkeyed ?? [])).toHaveLength(3);
    // `users` is the one acted-on entry with no sweep: the route deletes it last,
    // only after every sweep above has reported clean.
    expect(MEMBER_DATA_MAP.filter((e) => e.sweep)).toHaveLength(24);
  });
});

describe('the delete routes and the export are unchanged', () => {
  /**
   * Pinned by content digest, recorded into this fixture, rather than shelling
   * out to `git show` at assertion time — CI's checkout depth has already made
   * that a source of failures that have nothing to do with the code under test.
   * Changing a pinned file on purpose means editing a digest here: deliberate
   * and reviewable, which is the point.
   */
  const PINNED: Record<string, string> = {
    'src/app/api/account/delete/route.ts': '16ebeaef364cf93356cb4db00a8330ed7125fffc3c0cc0752d12ee64b17d7cda',
    'src/app/api/tenants/delete/route.ts': 'c92b7848dd354a6e9c1ebed76e4e883216e6cab54fdcd51fc91536288b453834',
    'src/lib/member-export.ts': 'c06bf188ba7845eb1dc5f112e5f78a7f0d2100ec0032145f9ab87b461f06e0a1',
  };

  it.each(Object.keys(PINNED))('%s is byte-for-byte what THE-229 found', (file) => {
    const contents = readFileSync(path.join(process.cwd(), file));
    expect(createHash('sha256').update(contents).digest('hex')).toBe(PINNED[file]);
  });
});
