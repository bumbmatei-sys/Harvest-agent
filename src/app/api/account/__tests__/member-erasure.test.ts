import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * 🔴 THE-76 — DELETING AN ACCOUNT MUST NOT LEAVE THE MEMBER BEHIND.
 *
 * /api/account/delete used to remove `users/{uid}` and the Auth account and
 * nothing else. Every other collection that stores a uid, an email, a name or a
 * photo URL kept its copy: the CRM row, the prayer requests, the posts and their
 * comments, the DMs, the registrations, the check-in rows, the form answers, the
 * OAuth grants, the certificate PDF.
 *
 * ⚠️ THE ASSERTIONS THAT ENCODE THE DEFECTS, each failing BY NAME:
 *   - one `it()` per collection in the stated list. Skipping a collection fails
 *     the test named for that collection, not a generic "something is left".
 *   - 'donation records survive an account deletion, anonymised' — hard-deleting
 *     the invoices takes money off the church's books and fails THAT test.
 *   - 'every delete query carries a concrete tenant id, never null' — building
 *     any query from a null scope fails THAT test. That class has produced ten
 *     bugs and this is the one place it could destroy data.
 *   - 'a partial failure reports which collections were cleared' — swallowing a
 *     failed sweep and returning 200 fails THAT test.
 *
 * ⚠️ THE REAL `requireAuth` RUNS. Only Firestore, Auth token verification and R2
 * are mocked; ownership, the recent-sign-in window and the 401/403 shape are the
 * production helper's, not a stub's.
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
vi.mock('@/lib/money-path-sentry', () => ({ captureHandledError: vi.fn() }));

const { POST } = await import('../delete/route');
const { MEMBER_DATA_MAP } = await import('@/lib/member-erasure');
const { anonymisedDonorEmail, assertConcreteScope, deleteByQuery } = await import('@/lib/member-deletion');

const UID = 'member-1';
const OTHER_UID = 'member-2';
const EMAIL = 'grace@church.org';
const TENANT = 't1';
const OTHER_TENANT = 't2';

const nowSeconds = () => Math.floor(Date.now() / 1000);

function request(userId: string = UID): NextRequest {
  return new NextRequest(
    new Request('https://grace.theharvest.app/api/account/delete', {
      method: 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    }),
  );
}

/** Sign the caller in as the member being deleted, with a fresh sign-in. */
function signedInAsMember() {
  tree.mockVerifyIdToken.mockResolvedValue({
    uid: UID, email: EMAIL, tenantId: TENANT, admin: false, superAdmin: false,
    auth_time: nowSeconds() - 5,
  });
}

/**
 * A member who is in EVERYTHING — one row per collection in the stated list,
 * plus a decoy in each: another member's row, or the same member's row in a
 * different tenant. The decoys are what stop a sweep passing by deleting the
 * collection wholesale.
 */
function seedEverything() {
  tree.__seed('users', [
    { id: UID, email: EMAIL, displayName: 'Grace', photoURL: 'data:image/png;base64,AAA', tenantId: TENANT, totalDonated: 250 },
    { id: OTHER_UID, email: 'other@church.org', displayName: 'Sam', tenantId: TENANT },
  ]);

  tree.__seed('contacts', [
    { id: 'c-plain', userId: UID, email: EMAIL, firstName: 'Grace', phone: '555', tenantId: TENANT, totalDonated: 0 },
    { id: 'c-donor', userId: UID, email: EMAIL, firstName: 'Grace', phone: '555', tenantId: TENANT, totalDonated: 250, lastDonationAt: '2026-01-02' },
    { id: 'c-other', userId: OTHER_UID, email: 'other@church.org', tenantId: TENANT, totalDonated: 0 },
    { id: 'c-elsewhere', userId: UID, email: EMAIL, tenantId: OTHER_TENANT, totalDonated: 0 },
  ]);

  tree.__seed('contactActivities', [
    { id: 'a-note', contactId: 'c-plain', tenantId: TENANT, type: 'note', description: `Form submission: Grace ${EMAIL} 555` },
    { id: 'a-gift', contactId: 'c-donor', tenantId: TENANT, type: 'donation', amount: 250 },
    { id: 'a-other', contactId: 'c-other', tenantId: TENANT, type: 'note', description: 'not mine' },
  ]);

  tree.__seed('prayer_requests', [
    { id: 'p-mine', authorId: UID, authorName: 'Grace', tenantId: TENANT, request: 'please pray' },
    { id: 'p-theirs', authorId: OTHER_UID, authorName: 'Sam', tenantId: TENANT, prayedBy: [UID, OTHER_UID] },
    { id: 'p-elsewhere', authorId: UID, authorName: 'Grace', tenantId: OTHER_TENANT },
  ]);

  tree.__seed('community_posts', [
    { id: 'post-mine', authorId: UID, authorName: 'Grace', authorPhoto: 'data:x', tenantId: TENANT },
    {
      id: 'post-theirs', authorId: OTHER_UID, authorName: 'Sam', tenantId: TENANT,
      likes: [UID, OTHER_UID],
      eventDetails: { attendees: [UID, OTHER_UID], attendeeDetails: [{ uid: UID, name: 'Grace', email: EMAIL }, { uid: OTHER_UID, name: 'Sam', email: 'other@church.org' }] },
    },
    { id: 'post-elsewhere', authorId: UID, authorName: 'Grace', tenantId: OTHER_TENANT },
  ]);
  tree.__seed('community_posts/post-mine/comments', [
    { id: 'cm-onmine', authorId: OTHER_UID, authorName: 'Sam', tenantId: TENANT },
  ]);
  tree.__seed('community_posts/post-theirs/comments', [
    { id: 'cm-mine', authorId: UID, authorName: 'Grace', authorPhoto: 'data:x', tenantId: TENANT },
    { id: 'cm-theirs', authorId: OTHER_UID, authorName: 'Sam', tenantId: TENANT },
  ]);

  tree.__seed('certificates', [
    { id: `${UID}_course-1`, uid: UID, learnerName: 'Grace', tenantId: TENANT, pdfPath: `receipts/${TENANT}/certificates/${UID}_course-1.pdf` },
    { id: `${OTHER_UID}_course-1`, uid: OTHER_UID, learnerName: 'Sam', tenantId: TENANT, pdfPath: 'receipts/t1/certificates/other.pdf' },
  ]);

  tree.__seed('chat_usage', [
    { id: UID, tenantId: TENANT, count: 12 },
    { id: OTHER_UID, tenantId: TENANT, count: 3 },
  ]);

  tree.__seed('platform_inbox', [
    { id: 'pi-mine', userId: UID, userEmail: EMAIL, fromTenantId: null, data: { name: 'Grace', email: EMAIL, message: 'help' } },
    { id: 'pi-theirs', userId: OTHER_UID, userEmail: 'other@church.org', fromTenantId: TENANT },
  ]);

  tree.__seed('churches', [
    { id: 'ch-mine', userId: UID, tenantId: TENANT, name: 'Grace Chapel' },
    { id: 'ch-theirs', userId: OTHER_UID, tenantId: TENANT, name: 'Sam Chapel' },
  ]);

  tree.__seed(`tenants/${TENANT}/invoices`, [
    { id: 'inv-1', type: 'donation_receipt', recipientName: 'Grace Hopper', recipientEmail: 'Grace@Church.org', amount: 15000, currency: 'usd', issuedAt: '2026-01-02', receiptNumber: 'R-1', pdfUrl: 'receipts/t1/donations/R-1.pdf', tenantName: 'Grace Chapel', description: 'Partnership donation' },
    { id: 'inv-2', type: 'donation_receipt', recipientName: 'Grace Hopper', recipientEmail: EMAIL, amount: 10000, currency: 'usd', issuedAt: '2026-03-04', receiptNumber: 'R-2', pdfUrl: 'receipts/t1/donations/R-2.pdf' },
    { id: 'inv-other', type: 'donation_receipt', recipientName: 'Sam', recipientEmail: 'other@church.org', amount: 500, receiptNumber: 'R-3' },
    { id: 'inv-sub', type: 'subscription', recipientEmail: EMAIL, amount: 9900 },
  ]);

  tree.__seed(`tenants/${TENANT}/givingStatements`, [
    { id: `2026_grace_church_org`, donorId: 'grace_church_org', donorEmail: EMAIL, donorName: 'Grace Hopper', year: 2026, totalAmount: 25000, pdfPath: 'receipts/t1/statements/2026/grace_church_org.pdf' },
    { id: '2026_other', donorEmail: 'other@church.org', donorName: 'Sam', year: 2026, totalAmount: 500 },
  ]);

  tree.__seed(`tenants/${TENANT}/pledges`, [
    { id: 'pl-mine', donorName: 'Grace Hopper', donorEmail: EMAIL, donorPhone: '555', pledgeAmount: 500, paidAmount: 100, notes: 'monthly', campaignId: 'camp-1' },
    { id: 'pl-theirs', donorName: 'Sam', donorEmail: 'other@church.org', pledgeAmount: 50 },
  ]);

  tree.__seed(`tenants/${TENANT}/registrations`, [
    { id: 'reg-uid', userId: UID, name: 'Grace Hopper', email: EMAIL, phone: '555', eventId: 'e1' },
    { id: 'reg-email', userId: '', name: 'Grace Hopper', email: EMAIL, eventId: 'e2' },
    { id: 'reg-other', userId: OTHER_UID, email: 'other@church.org', eventId: 'e1' },
  ]);

  tree.__seed(`tenants/${TENANT}/checkinSessions`, [{ id: 'sess-1', name: 'Sunday' }, { id: 'sess-2', name: 'Midweek' }]);
  tree.__seed(`tenants/${TENANT}/checkinSessions/sess-1/attendees`, [
    { id: 'att-mine', firstName: 'Grace', lastName: 'Hopper', email: EMAIL, crmContactId: 'c-plain' },
    { id: 'att-other', firstName: 'Sam', lastName: 'S', email: 'other@church.org' },
  ]);
  tree.__seed(`tenants/${TENANT}/checkinSessions/sess-2/attendees`, [
    { id: 'att-mine-2', firstName: 'Grace', email: EMAIL },
  ]);

  tree.__seed(`tenants/${TENANT}/forms`, [{ id: 'form-1', title: 'Connect card' }]);
  tree.__seed(`tenants/${TENANT}/forms/form-1/submissions`, [
    { id: 'sub-mine', crmContactId: 'c-plain', answers: { name: 'Grace Hopper', email: EMAIL, phone: '555' }, ipAddress: '10.0.0.1' },
    { id: 'sub-other', crmContactId: 'c-other', answers: { name: 'Sam' }, ipAddress: '10.0.0.2' },
  ]);

  tree.__seed(`tenants/${TENANT}/livestreamSessions`, [{ id: 'ls-1', title: 'Sunday stream' }]);
  tree.__seed(`tenants/${TENANT}/livestreamSessions/ls-1/comments`, [
    { id: 'lc-mine', authorId: UID, name: 'Grace', text: 'amen' },
    { id: 'lc-other', authorId: OTHER_UID, name: 'Sam', text: 'amen' },
  ]);
  tree.__seed(`tenants/${TENANT}/livestreamSessions/ls-1/prayers`, [
    { id: 'lp-1', name: 'Grace', prayerText: 'for my family' },
  ]);

  tree.__seed(`tenants/${TENANT}/directMessages`, [
    { id: 'dm-1', participants: [UID, OTHER_UID], participantNames: { [UID]: 'Grace', [OTHER_UID]: 'Sam' }, participantRoles: {}, initiatedBy: UID, lastMessage: 'see you Sunday' },
    { id: 'dm-2', participants: [OTHER_UID, 'member-3'], participantNames: { [OTHER_UID]: 'Sam' }, lastMessage: 'hi' },
  ]);
  tree.__seed(`tenants/${TENANT}/dmMessages`, [
    { id: 'dmm-mine', dmId: 'dm-1', senderId: UID, senderName: 'Grace', content: 'see you Sunday' },
    { id: 'dmm-theirs', dmId: 'dm-1', senderId: OTHER_UID, senderName: 'Sam', content: 'sounds good' },
  ]);
  tree.__seed(`tenants/${TENANT}/channels`, [
    { id: 'chan-1', name: 'general', members: [UID, OTHER_UID], createdBy: OTHER_UID },
  ]);
  tree.__seed(`tenants/${TENANT}/channelMessages`, [
    { id: 'chm-mine', channelId: 'chan-1', senderId: UID, senderName: 'Grace', content: 'hello' },
    { id: 'chm-theirs', channelId: 'chan-1', senderId: OTHER_UID, senderName: 'Sam', content: 'hi' },
  ]);

  tree.__seed(`tenants/${TENANT}/integrations`, [
    { id: `${UID}_gmail`, connectedBy: UID, connectedAccountId: 'ca-1', status: 'active' },
    { id: `${UID}_quickbooks`, connectedBy: UID, connectedAccountId: 'ca-2', status: 'active' },
    { id: `${OTHER_UID}_gmail`, connectedBy: OTHER_UID, connectedAccountId: 'ca-3' },
    { id: 'twilio', accountSid: 'AC1' },
  ]);

  tree.__seed(`tenants/${TENANT}/canvases`, [
    { id: 'cv-mine', createdBy: UID, createdByName: 'Grace', title: 'Sermon map' },
    { id: 'cv-other', createdBy: OTHER_UID, createdByName: 'Sam' },
  ]);

  // Retained by design — asserted below, never swept.
  tree.__seed('affiliate_commissions', [{ id: 'ac-1', referrerId: UID, tenantId: TENANT, amount: 4900 }]);
  tree.__seed('blog_posts', [{ id: 'bp-1', authorId: UID, tenantId: TENANT, title: 'A word' }]);
  tree.__seed(`tenants/${TENANT}/smsLogs`, [{ id: 'sms-1', phone: '555', status: 'delivered' }]);
}

/** Run the route as the member, and hand back status + parsed body. */
async function deleteAccount() {
  const res = await POST(request());
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  tree.__reset();
  tree.commitShouldThrow.on = null;
  tree.mockDeleteUser.mockResolvedValue(undefined);
  tree.mockGetUser.mockRejectedValue(Object.assign(new Error('not found'), { code: 'auth/user-not-found' }));
  signedInAsMember();
  seedEverything();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. deleting an account removes the member from every collection in the list
// ─────────────────────────────────────────────────────────────────────────────

describe('deleting an account removes the member from every collection in the stated list', () => {
  /** Runs once; every assertion below reads the resulting store. */
  let result: { status: number; body: Record<string, unknown> };
  beforeEach(async () => {
    result = await deleteAccount();
  });

  it('reports success, having cleared every collection it attempted', () => {
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true, documentDeleted: true, authDeleted: true });
    expect((result.body.report as { status: string }).status).toBe('complete');
    expect((result.body.report as { failures: unknown[] }).failures).toEqual([]);
  });

  it('users — the profile document, with the name, email, base64 photo and course progress on it', () => {
    expect(tree.__doc('users', UID)).toBeUndefined();
    expect(tree.__doc('users', OTHER_UID)).toBeDefined();
  });

  it('community_posts — the posts the member authored', () => {
    expect(tree.__docs('community_posts').map(([id]) => id)).not.toContain('post-mine');
  });

  it('community_posts/{id}/comments — the comments the member left on other people\'s posts', () => {
    const ids = tree.__docs('community_posts/post-theirs/comments').map(([id]) => id);
    expect(ids).not.toContain('cm-mine');
    expect(ids).toContain('cm-theirs');
  });

  it('community_posts.eventDetails — the RSVP that embeds the member\'s name and email in someone else\'s post', () => {
    const post = tree.__doc('community_posts', 'post-theirs') as { eventDetails: { attendees: string[]; attendeeDetails: { uid: string }[] } };
    expect(post.eventDetails.attendees).toEqual([OTHER_UID]);
    expect(post.eventDetails.attendeeDetails.map((a) => a.uid)).toEqual([OTHER_UID]);
    expect(JSON.stringify(post)).not.toContain(EMAIL);
  });

  it('community_posts.likes — the member\'s uid on other people\'s posts', () => {
    expect((tree.__doc('community_posts', 'post-theirs') as { likes: string[] }).likes).toEqual([OTHER_UID]);
  });

  it('prayer_requests — the prayer requests the member wrote', () => {
    expect(tree.__docs('prayer_requests').map(([id]) => id)).not.toContain('p-mine');
  });

  it('prayer_requests.prayedBy — the member\'s uid on other people\'s prayer requests', () => {
    expect((tree.__doc('prayer_requests', 'p-theirs') as { prayedBy: string[] }).prayedBy).toEqual([OTHER_UID]);
  });

  it('certificates — the record AND the stored PDF that renders the learner\'s name', () => {
    expect(tree.__doc('certificates', `${UID}_course-1`)).toBeUndefined();
    expect(tree.__doc('certificates', `${OTHER_UID}_course-1`)).toBeDefined();
    expect(tree.deletedObjects).toContain(`receipts/${TENANT}/certificates/${UID}_course-1.pdf`);
  });

  it('chat_usage — the per-member AI usage counter keyed by uid', () => {
    expect(tree.__doc('chat_usage', UID)).toBeUndefined();
    expect(tree.__doc('chat_usage', OTHER_UID)).toBeDefined();
  });

  it('platform_inbox — the support tickets carrying the member\'s uid, email and message', () => {
    const ids = tree.__docs('platform_inbox').map(([id]) => id);
    expect(ids).not.toContain('pi-mine');
    expect(ids).toContain('pi-theirs');
  });

  it('contacts — the CRM row with the member\'s name, email and phone', () => {
    expect(tree.__doc('contacts', 'c-plain')).toBeUndefined();
    expect(tree.__doc('contacts', 'c-other')).toBeDefined();
  });

  it('contactActivities — the timeline entries whose free text embeds the member\'s form answers', () => {
    expect(tree.__doc('contactActivities', 'a-note')).toBeUndefined();
    expect(tree.__doc('contactActivities', 'a-other')).toBeDefined();
  });

  it('tenants/{t}/registrations — event registrations, matched by uid AND by email', () => {
    const ids = tree.__docs(`tenants/${TENANT}/registrations`).map(([id]) => id);
    expect(ids).not.toContain('reg-uid');
    expect(ids).not.toContain('reg-email');
    expect(ids).toContain('reg-other');
  });

  it('tenants/{t}/checkinSessions/{id}/attendees — check-in rows across every session', () => {
    expect(tree.__docs(`tenants/${TENANT}/checkinSessions/sess-1/attendees`).map(([id]) => id)).toEqual(['att-other']);
    expect(tree.__count(`tenants/${TENANT}/checkinSessions/sess-2/attendees`)).toBe(0);
  });

  it('tenants/{t}/forms/{id}/submissions — form answers holding name, email, phone and IP', () => {
    const ids = tree.__docs(`tenants/${TENANT}/forms/form-1/submissions`).map(([id]) => id);
    expect(ids).not.toContain('sub-mine');
    expect(ids).toContain('sub-other');
  });

  it('tenants/{t}/livestreamSessions/{id}/comments — livestream comments the member posted', () => {
    expect(tree.__docs(`tenants/${TENANT}/livestreamSessions/ls-1/comments`).map(([id]) => id)).toEqual(['lc-other']);
  });

  it('tenants/{t}/dmMessages — the direct messages the member sent', () => {
    const ids = tree.__docs(`tenants/${TENANT}/dmMessages`).map(([id]) => id);
    expect(ids).not.toContain('dmm-mine');
    expect(ids).toContain('dmm-theirs');
  });

  it('tenants/{t}/channelMessages — the channel messages the member sent', () => {
    const ids = tree.__docs(`tenants/${TENANT}/channelMessages`).map(([id]) => id);
    expect(ids).not.toContain('chm-mine');
    expect(ids).toContain('chm-theirs');
  });

  it('tenants/{t}/channels.members — the member\'s uid in the channel roster', () => {
    expect((tree.__doc(`tenants/${TENANT}/channels`, 'chan-1') as { members: string[] }).members).toEqual([OTHER_UID]);
  });

  it('tenants/{t}/integrations — every per-member OAuth grant, and no one else\'s', () => {
    const ids = tree.__docs(`tenants/${TENANT}/integrations`).map(([id]) => id);
    expect(ids).not.toContain(`${UID}_gmail`);
    expect(ids).not.toContain(`${UID}_quickbooks`);
    expect(ids).toContain(`${OTHER_UID}_gmail`);
    expect(ids).toContain('twilio');
  });

  it('tenants/{t}/canvases — the display name copied onto the church\'s canvas', () => {
    const cv = tree.__doc(`tenants/${TENANT}/canvases`, 'cv-mine') as { createdByName: string };
    expect(cv).toBeDefined(); // the canvas is the church's, and survives
    expect(cv.createdByName).toBe('Deleted member');
  });

  it('churches — the link from a directory listing back to the person', () => {
    expect((tree.__doc('churches', 'ch-mine') as { userId: string | null }).userId).toBeNull();
    expect((tree.__doc('churches', 'ch-theirs') as { userId: string }).userId).toBe(OTHER_UID);
  });

  it('leaves another tenant\'s copies of the same member alone — the sweep is tenant-scoped', () => {
    expect(tree.__doc('contacts', 'c-elsewhere')).toBeDefined();
    expect(tree.__doc('prayer_requests', 'p-elsewhere')).toBeDefined();
    expect(tree.__doc('community_posts', 'post-elsewhere')).toBeDefined();
  });

  it('names the two gaps it cannot close instead of pretending they do not exist', () => {
    const retained = (result.body.report as { retained: Record<string, string> }).retained;
    const gaps = Object.entries(retained).filter(([, reason]) => reason.includes('GAP'));
    expect(gaps.map(([k]) => k)).toEqual(
      expect.arrayContaining([
        'tenants/{t}/livestreamSessions/{id}/prayers',
        'tenants/{t}/smsLogs + smsBroadcasts/{id}/logs',
      ]),
    );
  });

  it('covers every entry in MEMBER_DATA_MAP — a documented collection is always swept', () => {
    const report = result.body.report as { cleared: Record<string, number>; anonymised: Record<string, number>; retained: Record<string, string> };
    for (const entry of MEMBER_DATA_MAP) {
      if (entry.disposition === 'retain') {
        expect(report.retained, entry.collection).toHaveProperty(entry.collection);
      } else if (entry.collection === 'users') {
        continue; // deleted by the route itself, asserted above
      } else if (entry.disposition === 'anonymise') {
        expect(report.anonymised, entry.collection).toHaveProperty(entry.collection);
      } else {
        expect(report.cleared, entry.collection).toHaveProperty(entry.collection);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 & 3. The books guard
// ─────────────────────────────────────────────────────────────────────────────

describe('donation records survive an account deletion, anonymised', () => {
  it('🔴 keeps every donation invoice — hard-deleting them takes money off the church\'s books', async () => {
    await deleteAccount();
    const invoices = tree.__docs(`tenants/${TENANT}/invoices`);
    expect(invoices.map(([id]) => id).sort()).toEqual(['inv-1', 'inv-2', 'inv-other', 'inv-sub']);
  });

  it('keeps the figures whole — amount, currency, date, receipt number and stored PDF', async () => {
    await deleteAccount();
    expect(tree.__doc(`tenants/${TENANT}/invoices`, 'inv-1')).toMatchObject({
      amount: 15000,
      currency: 'usd',
      issuedAt: '2026-01-02',
      receiptNumber: 'R-1',
      pdfUrl: 'receipts/t1/donations/R-1.pdf',
      description: 'Partnership donation',
      tenantName: 'Grace Chapel',
      type: 'donation_receipt',
    });
  });

  it('replaces the donor identity, matching case-insensitively the way the webhook stored it', async () => {
    await deleteAccount();
    const pseudonym = anonymisedDonorEmail(UID, TENANT);
    // inv-1 was stored 'Grace@Church.org' — trimmed, never lowercased, by the webhook.
    for (const id of ['inv-1', 'inv-2']) {
      const inv = tree.__doc(`tenants/${TENANT}/invoices`, id) as Record<string, unknown>;
      expect(inv.recipientName).toBe('Deleted donor');
      expect(inv.recipientEmail).toBe(pseudonym);
      expect(inv.donorDeleted).toBe(true);
      expect(JSON.stringify(inv)).not.toContain('Grace Hopper');
    }
  });

  it('leaves another donor\'s invoices untouched', async () => {
    await deleteAccount();
    expect(tree.__doc(`tenants/${TENANT}/invoices`, 'inv-other')).toMatchObject({
      recipientName: 'Sam', recipientEmail: 'other@church.org',
    });
  });

  it('touches only donation receipts, not the church\'s subscription invoices', async () => {
    await deleteAccount();
    expect(tree.__doc(`tenants/${TENANT}/invoices`, 'inv-sub')).toMatchObject({ type: 'subscription', amount: 9900 });
  });

  it('keeps the CRM donor row so `totalDonated` stays on the church\'s books, stripped of identity', async () => {
    await deleteAccount();
    const donor = tree.__doc('contacts', 'c-donor') as Record<string, unknown>;
    expect(donor).toBeDefined();
    expect(donor.totalDonated).toBe(250);
    expect(donor.lastDonationAt).toBe('2026-01-02');
    expect(donor.email).toBe('');
    expect(donor.phone).toBe('');
    expect(donor.firstName).toBe('Deleted donor');
  });

  it('keeps the `donation` ledger entries and deletes only the rest of the timeline', async () => {
    await deleteAccount();
    expect(tree.__doc('contactActivities', 'a-gift')).toMatchObject({ type: 'donation', amount: 250 });
  });

  it('keeps pledges as a financial commitment, de-identified', async () => {
    await deleteAccount();
    const pledge = tree.__doc(`tenants/${TENANT}/pledges`, 'pl-mine') as Record<string, unknown>;
    expect(pledge).toBeDefined();
    expect(pledge.pledgeAmount).toBe(500);
    expect(pledge.paidAmount).toBe(100);
    expect(pledge.donorEmail).toBe(anonymisedDonorEmail(UID, TENANT));
    expect(pledge.donorPhone).toBeNull();
  });

  it('gives each deleted donor a distinct, stable pseudonym so two never merge into one statement line', () => {
    expect(anonymisedDonorEmail(UID, TENANT)).toBe(anonymisedDonorEmail(UID, TENANT));
    expect(anonymisedDonorEmail(UID, TENANT)).not.toBe(anonymisedDonorEmail(OTHER_UID, TENANT));
    expect(anonymisedDonorEmail(UID, TENANT)).not.toBe(anonymisedDonorEmail(UID, OTHER_TENANT));
    // Reserved TLD (RFC 2606) — a pseudonym can never be delivered to a real person.
    expect(anonymisedDonorEmail(UID, TENANT)).toMatch(/@deleted\.invalid$/);
    expect(anonymisedDonorEmail(UID, TENANT)).not.toContain(UID);
    expect(anonymisedDonorEmail(UID, TENANT)).not.toContain(EMAIL);
  });
});

describe('a tax receipt still resolves after the donor is deleted', () => {
  it('the receipt PDF path survives, so the stored document is still fetchable', async () => {
    await deleteAccount();
    const inv = tree.__doc(`tenants/${TENANT}/invoices`, 'inv-1') as { pdfUrl: string; receiptNumber: string };
    expect(inv.pdfUrl).toBe('receipts/t1/donations/R-1.pdf');
    expect(inv.receiptNumber).toBe('R-1');
    // The route never deletes a donation receipt or statement PDF from storage.
    expect(tree.deletedObjects).not.toContain('receipts/t1/donations/R-1.pdf');
    expect(tree.deletedObjects).not.toContain('receipts/t1/statements/2026/grace_church_org.pdf');
  });

  it('the issued giving statement survives with its total, keyed by the same donorId that names its PDF', async () => {
    await deleteAccount();
    const st = tree.__doc(`tenants/${TENANT}/givingStatements`, '2026_grace_church_org') as Record<string, unknown>;
    expect(st).toBeDefined();
    expect(st.totalAmount).toBe(25000);
    expect(st.donorId).toBe('grace_church_org');
    expect(st.pdfPath).toBe('receipts/t1/statements/2026/grace_church_org.pdf');
    expect(st.donorName).toBe('Deleted donor');
    expect(st.donorEmail).toBe(anonymisedDonorEmail(UID, TENANT));
  });

  it('🔴 the anonymised email is non-empty, so the statement generator still GROUPS the gifts', async () => {
    await deleteAccount();
    // `giving-statements/generate` does `if (!donorEmail) continue` — a blanked
    // email would silently drop these gifts out of the church's year-end
    // statement. This is the assertion that a "just clear the field" fix fails.
    for (const id of ['inv-1', 'inv-2']) {
      const email = (tree.__doc(`tenants/${TENANT}/invoices`, id) as { recipientEmail: string }).recipientEmail;
      expect(email).toBeTruthy();
      expect(email.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Authored content — the named behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe('authored community content behaves as decided: DELETED, one rule for posts, comments and prayer requests', () => {
  it('deletes all three, and treats them the same — no per-type exception', async () => {
    await deleteAccount();
    expect(tree.__doc('community_posts', 'post-mine'), 'post').toBeUndefined();
    expect(tree.__doc('community_posts/post-theirs/comments', 'cm-mine'), 'comment').toBeUndefined();
    expect(tree.__doc('prayer_requests', 'p-mine'), 'prayer request').toBeUndefined();
  });

  it('takes a deleted post\'s comment thread with it rather than orphaning it', async () => {
    await deleteAccount();
    // 'post-mine' held a comment by ANOTHER member; a plain batch delete of the
    // parent would leave that subcollection unreachable and still holding their
    // name and photo.
    expect(tree.__count('community_posts/post-mine/comments')).toBe(0);
  });

  it('records the same disposition for all three in MEMBER_DATA_MAP', () => {
    const of = (name: string) => MEMBER_DATA_MAP.find((e) => e.collection === name)?.disposition;
    expect(of('community_posts')).toBe('delete');
    expect(of('community_posts/{id}/comments')).toBe('delete');
    expect(of('prayer_requests')).toBe('delete');
  });
});

describe('messages: the sender\'s words go, the other party\'s thread stays', () => {
  it('keeps the thread and the other party\'s own messages', async () => {
    await deleteAccount();
    expect(tree.__doc(`tenants/${TENANT}/directMessages`, 'dm-1')).toBeDefined();
    expect(tree.__doc(`tenants/${TENANT}/dmMessages`, 'dmm-theirs')).toBeDefined();
  });

  it('strips the deleted member\'s display name and their last-message preview from the thread', async () => {
    await deleteAccount();
    const dm = tree.__doc(`tenants/${TENANT}/directMessages`, 'dm-1') as { participantNames: Record<string, string>; lastMessage: string };
    expect(dm.participantNames[UID]).toBe('Deleted member');
    expect(dm.participantNames[OTHER_UID]).toBe('Sam');
    expect(dm.lastMessage).toBe('');
  });

  it('leaves a thread the member was never in completely alone', async () => {
    await deleteAccount();
    expect(tree.__doc(`tenants/${TENANT}/directMessages`, 'dm-2')).toMatchObject({ lastMessage: 'hi' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. The catastrophic class
// ─────────────────────────────────────────────────────────────────────────────

describe('every delete query carries a concrete tenant id, never null', () => {
  it('🔴 no query anywhere in the run was built with a null, undefined or empty value', async () => {
    await deleteAccount();
    expect(tree.recordedWheres.length).toBeGreaterThan(0);
    const bad = tree.recordedWheres.filter(
      (w) => w.value === null || w.value === undefined || w.value === '',
    );
    expect(bad, `queries built from a non-concrete scope: ${JSON.stringify(bad)}`).toEqual([]);
  });

  it('🔴 every tenant-scoped query names THIS tenant and no other', async () => {
    await deleteAccount();
    const tenantScoped = tree.recordedWheres.filter((w) => w.field === 'tenantId');
    for (const w of tenantScoped) expect(w.value).toBe(TENANT);
    // Every path under `tenants/` is scoped by the path itself, so it can never
    // reach a second tenant either.
    const crossTenant = tree.recordedWheres.filter((w) => w.path.startsWith(`tenants/${OTHER_TENANT}`));
    expect(crossTenant).toEqual([]);
  });

  it('🔴 refuses outright to run when the scope is not concrete, instead of matching everything', () => {
    for (const bad of [null, undefined, '', '   ', 0, false]) {
      expect(() => assertConcreteScope(bad, 'tenantId'), String(bad)).toThrow(/non-concrete tenantId/);
    }
    expect(assertConcreteScope('t1', 'tenantId')).toBe('t1');
  });

  it('the only unscoped-looking sweep is keyed on the uid, which is tighter than a tenant filter', async () => {
    await deleteAccount();
    const groupQueries = tree.recordedWheres.filter((w) => w.group);
    expect(groupQueries.length).toBeGreaterThan(0);
    for (const q of groupQueries) {
      expect(q.field).toBe('authorId');
      expect(q.value).toBe(UID);
    }
  });

  it('skips the tenant-scoped sweep entirely for a member with no tenant, rather than scoping it to null', async () => {
    tree.__reset();
    tree.mockDeleteUser.mockResolvedValue(undefined);
    tree.mockGetUser.mockRejectedValue(Object.assign(new Error('gone'), { code: 'auth/user-not-found' }));
    signedInAsMember();
    tree.__seed('users', [{ id: UID, email: EMAIL, tenantId: null }]);
    tree.__seed('contacts', [{ id: 'c-x', userId: UID, tenantId: OTHER_TENANT }]);

    const { status, body } = await deleteAccount();

    expect(status).toBe(200);
    expect(tree.recordedWheres.filter((w) => w.value === null)).toEqual([]);
    // Another tenant's row is untouched, not swept by a null scope.
    expect(tree.__doc('contacts', 'c-x')).toBeDefined();
    expect((body.report as { retained: Record<string, string> }).retained).toHaveProperty('(tenant-scoped collections)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Partial failure
// ─────────────────────────────────────────────────────────────────────────────

describe('a partial failure reports which collections were cleared', () => {
  it('🔴 returns a non-2xx naming the failed collection — never a 200 for a half-deletion', async () => {
    tree.commitShouldThrow.on = 'platform_inbox';

    const { status, body } = await deleteAccount();

    expect(status).toBe(500);
    const report = body.report as { status: string; failures: { collection: string }[]; cleared: Record<string, number>; error: string };
    expect(report.status).toBe('partial');
    expect(report.failures.map((f) => f.collection)).toContain('platform_inbox');
    expect(report.error).toMatch(/incomplete/i);
  });

  it('still reports, by name and count, everything that DID get cleared', async () => {
    tree.commitShouldThrow.on = 'platform_inbox';
    const { body } = await deleteAccount();
    const report = body.report as { cleared: Record<string, number> };
    expect(report.cleared['prayer_requests']).toBe(1);
    expect(report.cleared['certificates']).toBe(1);
    expect(report.cleared['tenants/{t}/registrations']).toBe(2);
  });

  it('🔴 spares the profile AND the sign-in, so the member keeps the credential that drives a retry', async () => {
    tree.commitShouldThrow.on = 'platform_inbox';

    const { body } = await deleteAccount();

    expect(body.documentDeleted).toBe(false);
    expect(body.authDeleted).toBe(false);
    expect(tree.__doc('users', UID), 'the profile was deleted despite an incomplete sweep').toBeDefined();
    expect(tree.mockDeleteUser, 'the sign-in was destroyed despite an incomplete sweep').not.toHaveBeenCalled();
  });

  it('does not stop at the first failure — later collections are still swept and reported', async () => {
    tree.commitShouldThrow.on = 'prayer_requests';
    const { body } = await deleteAccount();
    const report = body.report as { cleared: Record<string, number>; failures: { collection: string }[] };
    expect(report.failures.map((f) => f.collection)).toContain('prayer_requests');
    // Collections after the failing one still ran.
    expect(tree.__doc('chat_usage', UID)).toBeUndefined();
    expect(report.cleared['tenants/{t}/integrations']).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Idempotence
// ─────────────────────────────────────────────────────────────────────────────

describe('deletion is idempotent — running it twice does not error', () => {
  it('a second run succeeds and finds nothing left to do', async () => {
    const first = await deleteAccount();
    expect(first.status).toBe(200);

    // The profile is gone, so the retry has no tenant to sweep — exactly the
    // state a member is in after a successful run. Re-seeding the profile
    // reproduces the harder case: a retry that DOES re-walk every collection.
    tree.__seed('users', [{ id: UID, email: EMAIL, tenantId: TENANT }]);

    const second = await deleteAccount();

    expect(second.status).toBe(200);
    expect((second.body.report as { failures: unknown[] }).failures).toEqual([]);
    expect((second.body.report as { status: string }).status).toBe('complete');
  });

  it('a re-run does not re-anonymise an already-anonymised donation, or double-count it', async () => {
    await deleteAccount();
    const after1 = tree.__doc(`tenants/${TENANT}/invoices`, 'inv-1');

    tree.__seed('users', [{ id: UID, email: EMAIL, tenantId: TENANT }]);
    const second = await deleteAccount();

    expect(tree.__doc(`tenants/${TENANT}/invoices`, 'inv-1')).toEqual(after1);
    expect((second.body.report as { anonymised: Record<string, number> }).anonymised['tenants/{t}/invoices']).toBe(0);
  });

  it('an already-absent auth user still counts as deleted', async () => {
    tree.mockDeleteUser.mockRejectedValue(Object.assign(new Error('gone'), { code: 'auth/user-not-found' }));
    const { status, body } = await deleteAccount();
    expect(status).toBe(200);
    expect(body.authDeleted).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Chunking
// ─────────────────────────────────────────────────────────────────────────────

describe('a deletion larger than one Firestore batch is chunked', () => {
  it('🔴 clears 2,000 documents without ever committing a batch over the 500-operation cap', async () => {
    tree.__reset();
    signedInAsMember();
    tree.mockDeleteUser.mockResolvedValue(undefined);
    tree.mockGetUser.mockRejectedValue(Object.assign(new Error('gone'), { code: 'auth/user-not-found' }));
    tree.__seed('users', [{ id: UID, email: EMAIL, tenantId: TENANT }]);
    tree.__seed(
      'platform_inbox',
      Array.from({ length: 2000 }, (_, i) => ({ id: `pi-${i}`, userId: UID, userEmail: EMAIL })),
    );

    const { status, body } = await deleteAccount();

    expect(status).toBe(200);
    expect(tree.__count('platform_inbox')).toBe(0);
    expect((body.report as { cleared: Record<string, number> }).cleared['platform_inbox']).toBe(2000);

    // The fake rejects any commit over 500 ops, the way Firestore does — so a
    // route that batched all 2,000 at once would have thrown above. Prove the
    // page size too: 2,000 / 400 = 5 commits, none of them oversized.
    const sizes = tree.mockBatchCommit.mock.calls.map((c) => c[0] as number);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(400);
    expect(sizes.filter((n) => n === 400)).toHaveLength(5);
  });

  it('chunks an anonymise sweep too, not just a delete sweep', async () => {
    tree.__reset();
    signedInAsMember();
    tree.mockDeleteUser.mockResolvedValue(undefined);
    tree.mockGetUser.mockRejectedValue(Object.assign(new Error('gone'), { code: 'auth/user-not-found' }));
    tree.__seed('users', [{ id: UID, email: EMAIL, tenantId: TENANT }]);
    tree.__seed(
      `tenants/${TENANT}/invoices`,
      Array.from({ length: 900 }, (_, i) => ({
        id: `inv-${i}`, type: 'donation_receipt', recipientEmail: EMAIL, recipientName: 'Grace', amount: 100,
      })),
    );

    const { status, body } = await deleteAccount();

    expect(status).toBe(200);
    expect((body.report as { anonymised: Record<string, number> }).anonymised['tenants/{t}/invoices']).toBe(900);
    expect(Math.max(...tree.mockBatchCommit.mock.calls.map((c) => c[0] as number))).toBeLessThanOrEqual(400);
  });

  it('the shared chunker itself never exceeds the cap, whatever the collection', async () => {
    tree.__reset();
    tree.__seed('contacts', Array.from({ length: 1201 }, (_, i) => ({ id: `x-${i}`, userId: UID })));
    const n = await deleteByQuery(tree.adminDb.collection('contacts').where('userId', '==', UID) as never);
    expect(n).toBe(1201);
    expect(tree.__count('contacts')).toBe(0);
    expect(Math.max(...tree.mockBatchCommit.mock.calls.map((c) => c[0] as number))).toBeLessThanOrEqual(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. R2 / object storage
// ─────────────────────────────────────────────────────────────────────────────

describe('R2 objects are removed, or the gap is documented in the report', () => {
  it('deletes the certificate PDF that renders the learner\'s name', async () => {
    await deleteAccount();
    expect(tree.deletedObjects).toEqual([`receipts/${TENANT}/certificates/${UID}_course-1.pdf`]);
  });

  it('a storage failure does not strand the document that names the learner', async () => {
    tree.storageShouldThrow.value = true;
    const { status } = await deleteAccount();
    expect(status).toBe(200);
    expect(tree.__doc('certificates', `${UID}_course-1`)).toBeUndefined();
  });

  it('never deletes a receipt or statement PDF — those are the church\'s books', async () => {
    await deleteAccount();
    expect(tree.deletedObjects.filter((p) => p.includes('/donations/'))).toEqual([]);
    expect(tree.deletedObjects.filter((p) => p.includes('/statements/'))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The gate, driven through the real requireAuth
// ─────────────────────────────────────────────────────────────────────────────

describe('who may call it — the real requireAuth decides', () => {
  it('401s an unauthenticated caller and deletes nothing', async () => {
    tree.mockVerifyIdToken.mockRejectedValue(new Error('bad token'));
    const res = await POST(request());
    expect(res.status).toBe(401);
    expect(tree.__doc('users', UID)).toBeDefined();
    expect(tree.__doc('contacts', 'c-plain')).toBeDefined();
  });

  it('403s a member trying to erase somebody else, and sweeps nothing of theirs', async () => {
    const res = await POST(request(OTHER_UID));
    expect(res.status).toBe(403);
    expect(tree.__doc('users', OTHER_UID)).toBeDefined();
    expect(tree.__doc('contacts', 'c-other')).toBeDefined();
    expect(tree.recordedWheres).toEqual([]);
  });

  it('401s a stale sign-in before touching anything', async () => {
    tree.mockVerifyIdToken.mockResolvedValue({
      uid: UID, email: EMAIL, tenantId: TENANT, auth_time: nowSeconds() - 3600,
    });
    const res = await POST(request());
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'auth/requires-recent-login' });
    expect(tree.__doc('users', UID)).toBeDefined();
  });
});
