import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * 🔴 THE-188 — DELETION SHIPPED WITHOUT AN EXPORT PATH.
 *
 * PR 354 gave a member the right to be forgotten across 25 collections and gave
 * them no way to take a copy first. Everything that existed was per-surface — a
 * member's own donation history, the admin CSVs in AdminCheckin and AdminForms,
 * a giving statement. Nothing answered "give me everything you hold about me",
 * which is the right the erasure needed a partner for.
 *
 * ⚠️ THE ASSERTIONS THAT ENCODE THE DEFECTS, each failing BY NAME:
 *   - 'the export covers every collection the erasure walks' — the export is
 *     DERIVED from MEMBER_DATA_MAP, not written out a second time. Adding a
 *     collection to the erasure without deciding what the export does with it
 *     fails THAT test, by the collection's name.
 *   - 'the three unkeyed collections are declared as gaps, not silently omitted'
 *     — an export that quietly drops what it cannot reach looks complete and is
 *     not. Dropping the declaration fails THAT test.
 *   - 'an archived tenant can still export' — REP-4's promise. Gating the export
 *     on an ACTIVE subscription fails THAT test, not a general one.
 *   - 'every export query carries a concrete tenant id and uid, never null' — on
 *     a READ a null scope means every tenant, so on an export it is a breach and
 *     not merely a bug. Building any query from a null scope fails THAT test.
 *   - 'a member cannot export the tenant's data' — the payload is searched for
 *     another member's rows by their own labels.
 *
 * ⚠️ THE REAL `requireAuth` RUNS. Only Firestore and Auth token verification are
 * mocked; ownership, the recent-sign-in window and the 401/403 shape are the
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

const { POST } = await import('../export/route');
const { MEMBER_DATA_MAP } = await import('@/lib/member-erasure');
const { assertConcreteScope } = await import('@/lib/member-deletion');
const {
  MEMBER_EXPORT_DECISIONS,
  assertExportCoversMap,
  exportGaps,
  EXPORT_PAGE,
} = await import('@/lib/member-export');
const { NEVER_GATED, TENANT_STATUS_ARCHIVED } = await import('@/lib/tenant-lifecycle');

const UID = 'member-1';
const OTHER_UID = 'member-2';
const EMAIL = 'grace@church.org';
const OTHER_EMAIL = 'other@church.org';
const TENANT = 't1';
const OTHER_TENANT = 't2';

const nowSeconds = () => Math.floor(Date.now() / 1000);

function request(userId: string = UID): NextRequest {
  return new NextRequest(
    new Request('https://grace.theharvest.app/api/account/export', {
      method: 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    }),
  );
}

/** Sign the caller in as the member exporting, with a fresh sign-in. */
function signedInAsMember(overrides: Record<string, unknown> = {}) {
  tree.mockVerifyIdToken.mockResolvedValue({
    uid: UID, email: EMAIL, tenantId: TENANT, admin: false, superAdmin: false,
    auth_time: nowSeconds() - 5, ...overrides,
  });
}

interface Section {
  collection: string;
  disposition: string;
  erasure: string;
  count: number;
  truncated: boolean;
  note?: string;
  rows: Record<string, unknown>[];
}
interface ExportBody {
  format?: string;
  version?: number;
  status?: string;
  subject?: { uid: string; email: string; tenantId: string | null };
  sections?: Section[];
  gaps?: { collection: string; reason: string }[];
  omitted?: { collection: string; reason: string }[];
  covered?: { collection: string; coveredBy: string }[];
  failures?: { collection: string }[];
  reads?: number;
  error?: string;
  step?: string;
  code?: string;
}

/** Run the route as the member, and hand back status + parsed body. */
async function exportAccount(userId: string = UID) {
  const res = await POST(request(userId));
  return { status: res.status, body: (await res.json()) as ExportBody };
}

const sectionFor = (body: ExportBody, collection: string): Section => {
  const found = (body.sections ?? []).find((s) => s.collection === collection);
  if (!found) throw new Error(`no section for ${collection}`);
  return found;
};

const rowIds = (body: ExportBody, collection: string) =>
  sectionFor(body, collection).rows.map((r) => String(r.id));

/**
 * The same member as the erasure suite's, in EVERYTHING — one row per collection
 * the map enumerates, plus a decoy in each: another member's row, or the same
 * member's row in a different tenant. The decoys are what stop a section passing
 * by returning the collection wholesale.
 */
function seedEverything(tenant: Record<string, unknown> = { status: 'active', plan: 'pro' }) {
  tree.__seed('tenants', [
    { id: TENANT, name: 'Grace Chapel', ...tenant },
    { id: OTHER_TENANT, name: 'Another Church', status: 'active' },
  ]);

  tree.__seed('users', [
    {
      id: UID, email: EMAIL, displayName: 'Grace', photoURL: 'data:image/png;base64,AAA',
      phone: '555', tenantId: TENANT, totalDonated: 250,
      savedItems: ['course-1'], courseProgress: { 'course-1': 100 },
    },
    { id: OTHER_UID, email: OTHER_EMAIL, displayName: 'Sam', tenantId: TENANT },
  ]);

  tree.__seed('contacts', [
    { id: 'c-plain', userId: UID, email: EMAIL, firstName: 'Grace', phone: '555', tenantId: TENANT, totalDonated: 0 },
    { id: 'c-donor', userId: UID, email: EMAIL, firstName: 'Grace', tenantId: TENANT, totalDonated: 250 },
    { id: 'c-other', userId: OTHER_UID, email: OTHER_EMAIL, tenantId: TENANT, totalDonated: 0 },
    { id: 'c-elsewhere', userId: UID, email: EMAIL, tenantId: OTHER_TENANT, totalDonated: 0 },
  ]);

  tree.__seed('contactActivities', [
    { id: 'a-note', contactId: 'c-plain', tenantId: TENANT, type: 'note', description: `Form submission: Grace ${EMAIL}` },
    { id: 'a-gift', contactId: 'c-donor', tenantId: TENANT, type: 'donation', amount: 250 },
    { id: 'a-other', contactId: 'c-other', tenantId: TENANT, type: 'note', description: 'not mine' },
  ]);

  tree.__seed('prayer_requests', [
    { id: 'p-mine', authorId: UID, authorName: 'Grace', tenantId: TENANT, request: 'please pray' },
    { id: 'p-theirs', authorId: OTHER_UID, authorName: 'Sam', tenantId: TENANT, request: 'a private matter', prayedBy: [UID, OTHER_UID] },
    { id: 'p-elsewhere', authorId: UID, authorName: 'Grace', tenantId: OTHER_TENANT },
  ]);

  tree.__seed('community_posts', [
    { id: 'post-mine', authorId: UID, authorName: 'Grace', tenantId: TENANT, content: 'my post' },
    {
      id: 'post-theirs', authorId: OTHER_UID, authorName: 'Sam', tenantId: TENANT, title: 'Potluck', content: 'their post',
      likes: [UID, OTHER_UID],
      eventDetails: {
        attendees: [UID, OTHER_UID],
        attendeeDetails: [{ uid: UID, name: 'Grace', email: EMAIL }, { uid: OTHER_UID, name: 'Sam', email: OTHER_EMAIL }],
      },
    },
    { id: 'post-elsewhere', authorId: UID, authorName: 'Grace', tenantId: OTHER_TENANT },
  ]);
  tree.__seed('community_posts/post-mine/comments', [
    { id: 'cm-onmine', authorId: OTHER_UID, authorName: 'Sam', tenantId: TENANT, content: 'a reply of theirs' },
  ]);
  tree.__seed('community_posts/post-theirs/comments', [
    { id: 'cm-mine', authorId: UID, authorName: 'Grace', tenantId: TENANT, content: 'my comment' },
    { id: 'cm-theirs', authorId: OTHER_UID, authorName: 'Sam', tenantId: TENANT, content: 'their comment' },
  ]);

  tree.__seed('certificates', [
    { id: `${UID}_course-1`, uid: UID, learnerName: 'Grace', tenantId: TENANT, pdfPath: `receipts/${TENANT}/certificates/${UID}_course-1.pdf` },
    { id: `${OTHER_UID}_course-1`, uid: OTHER_UID, learnerName: 'Sam', tenantId: TENANT },
  ]);

  tree.__seed('chat_usage', [
    { id: UID, tenantId: TENANT, count: 12 },
    { id: OTHER_UID, tenantId: TENANT, count: 3 },
  ]);

  tree.__seed('platform_inbox', [
    { id: 'pi-mine', userId: UID, userEmail: EMAIL, message: 'help' },
    { id: 'pi-theirs', userId: OTHER_UID, userEmail: OTHER_EMAIL },
  ]);

  tree.__seed('churches', [
    { id: 'ch-mine', userId: UID, tenantId: TENANT, name: 'Grace Chapel' },
    { id: 'ch-theirs', userId: OTHER_UID, tenantId: TENANT, name: 'Sam Chapel' },
  ]);

  tree.__seed(`tenants/${TENANT}/invoices`, [
    { id: 'inv-1', type: 'donation_receipt', recipientName: 'Grace Hopper', recipientEmail: 'Grace@Church.org', amount: 15000, receiptNumber: 'R-1' },
    { id: 'inv-2', type: 'donation_receipt', recipientName: 'Grace Hopper', recipientEmail: EMAIL, amount: 10000, receiptNumber: 'R-2' },
    { id: 'inv-other', type: 'donation_receipt', recipientName: 'Sam', recipientEmail: OTHER_EMAIL, amount: 500, receiptNumber: 'R-3' },
    { id: 'inv-sub', type: 'subscription', recipientEmail: EMAIL, amount: 9900 },
  ]);

  tree.__seed(`tenants/${TENANT}/givingStatements`, [
    { id: '2026_grace', donorEmail: EMAIL, donorName: 'Grace Hopper', year: 2026, totalAmount: 25000 },
    { id: '2026_other', donorEmail: OTHER_EMAIL, donorName: 'Sam', year: 2026 },
  ]);

  tree.__seed(`tenants/${TENANT}/pledges`, [
    { id: 'pl-mine', donorName: 'Grace Hopper', donorEmail: EMAIL, pledgeAmount: 500 },
    { id: 'pl-theirs', donorName: 'Sam', donorEmail: OTHER_EMAIL, pledgeAmount: 50 },
  ]);

  tree.__seed(`tenants/${TENANT}/registrations`, [
    { id: 'reg-uid', userId: UID, name: 'Grace Hopper', email: EMAIL, eventId: 'e1' },
    { id: 'reg-email', userId: '', name: 'Grace Hopper', email: EMAIL, eventId: 'e2' },
    { id: 'reg-other', userId: OTHER_UID, email: OTHER_EMAIL, eventId: 'e1' },
  ]);

  tree.__seed(`tenants/${TENANT}/checkinSessions`, [{ id: 'sess-1', name: 'Sunday' }, { id: 'sess-2', name: 'Midweek' }]);
  tree.__seed(`tenants/${TENANT}/checkinSessions/sess-1/attendees`, [
    { id: 'att-mine', firstName: 'Grace', email: EMAIL },
    { id: 'att-other', firstName: 'Sam', email: OTHER_EMAIL },
  ]);
  tree.__seed(`tenants/${TENANT}/checkinSessions/sess-2/attendees`, [
    { id: 'att-mine-2', firstName: 'Grace', email: EMAIL },
  ]);

  tree.__seed(`tenants/${TENANT}/forms`, [{ id: 'form-1', title: 'Connect card' }]);
  tree.__seed(`tenants/${TENANT}/forms/form-1/submissions`, [
    { id: 'sub-mine', crmContactId: 'c-plain', answers: { name: 'Grace Hopper', email: EMAIL }, ipAddress: '10.0.0.1' },
    { id: 'sub-other', crmContactId: 'c-other', answers: { name: 'Sam' }, ipAddress: '10.0.0.2' },
  ]);

  tree.__seed(`tenants/${TENANT}/livestreamSessions`, [{ id: 'ls-1', title: 'Sunday stream' }]);
  tree.__seed(`tenants/${TENANT}/livestreamSessions/ls-1/comments`, [
    { id: 'lc-mine', authorId: UID, name: 'Grace', text: 'amen' },
    { id: 'lc-other', authorId: OTHER_UID, name: 'Sam', text: 'amen too' },
  ]);
  // 🔴 The unkeyed gap: a display name and nothing else.
  tree.__seed(`tenants/${TENANT}/livestreamSessions/ls-1/prayers`, [
    { id: 'lp-1', name: 'Grace', prayerText: 'for my family' },
  ]);

  tree.__seed(`tenants/${TENANT}/directMessages`, [
    { id: 'dm-1', participants: [UID, OTHER_UID], participantNames: { [UID]: 'Grace', [OTHER_UID]: 'Sam' }, lastMessage: 'sounds good', initiatedBy: UID },
    { id: 'dm-2', participants: [OTHER_UID, 'member-3'], lastMessage: 'not my thread' },
  ]);
  tree.__seed(`tenants/${TENANT}/dmMessages`, [
    { id: 'dmm-mine', dmId: 'dm-1', senderId: UID, senderName: 'Grace', content: 'see you Sunday' },
    { id: 'dmm-theirs', dmId: 'dm-1', senderId: OTHER_UID, senderName: 'Sam', content: 'sounds good' },
  ]);
  tree.__seed(`tenants/${TENANT}/channels`, [
    { id: 'chan-1', name: 'general', members: [UID, OTHER_UID] },
    { id: 'chan-2', name: 'elders', members: [OTHER_UID] },
  ]);
  tree.__seed(`tenants/${TENANT}/channelMessages`, [
    { id: 'chm-mine', channelId: 'chan-1', senderId: UID, content: 'hello' },
    { id: 'chm-theirs', channelId: 'chan-1', senderId: OTHER_UID, content: 'their channel message' },
  ]);

  // 🔴 connectedAccountId is a LIVE grant handle. It must never leave in a file.
  tree.__seed(`tenants/${TENANT}/integrations`, [
    { id: `${UID}_gmail`, connectedBy: UID, connectedAccountId: 'ca-secret-1', status: 'active', connectedAt: '2026-01-01' },
    { id: `${UID}_quickbooks`, connectedBy: UID, connectedAccountId: 'ca-secret-2', status: 'active' },
    { id: `${OTHER_UID}_gmail`, connectedBy: OTHER_UID, connectedAccountId: 'ca-secret-3' },
    { id: 'twilio', accountSid: 'AC1' },
  ]);

  tree.__seed(`tenants/${TENANT}/canvases`, [
    { id: 'cv-mine', createdBy: UID, createdByName: 'Grace', title: 'Sermon map' },
    { id: 'cv-other', createdBy: OTHER_UID, createdByName: 'Sam' },
  ]);

  tree.__seed('affiliate_commissions', [
    { id: 'ac-1', referrerId: UID, tenantId: TENANT, amount: 4900 },
    { id: 'ac-other', referrerId: OTHER_UID, tenantId: TENANT, amount: 100 },
  ]);
  // Church-owned content — omitted by name, never exported.
  tree.__seed('blog_posts', [{ id: 'bp-1', authorId: UID, tenantId: TENANT, title: 'A word from the pastor' }]);
  // The other unkeyed gap: a phone number and nothing else.
  tree.__seed(`tenants/${TENANT}/smsLogs`, [{ id: 'sms-1', phone: '555', status: 'delivered' }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  tree.__reset();
  signedInAsMember();
  seedEverything();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. The right
// ─────────────────────────────────────────────────────────────────────────────

describe('a member can export their own data', () => {
  it('🔴 returns every section of their own data, not a per-surface slice of it', async () => {
    const { status, body } = await exportAccount();

    expect(status).toBe(200);
    expect(body.format).toBe('harvest.member-export');
    expect(body.status).toBe('complete');
    expect(body.subject).toMatchObject({ uid: UID, email: EMAIL, tenantId: TENANT });
    expect(body.failures).toEqual([]);
  });

  it('returns the profile itself — name, email, photo, saved items, course progress', async () => {
    const { body } = await exportAccount();
    expect(sectionFor(body, 'users').rows[0]).toMatchObject({
      id: UID, email: EMAIL, displayName: 'Grace', photoURL: 'data:image/png;base64,AAA',
      savedItems: ['course-1'], courseProgress: { 'course-1': 100 },
    });
  });

  it('🔴 returns their giving history — the legally weighted section', async () => {
    const { body } = await exportAccount();
    // Case-insensitively on BOTH sides: the webhook stores whatever casing the
    // donor typed at Stripe checkout.
    expect(rowIds(body, 'tenants/{t}/invoices').sort()).toEqual(['inv-1', 'inv-2']);
    expect(rowIds(body, 'tenants/{t}/givingStatements')).toEqual(['2026_grace']);
    expect(rowIds(body, 'tenants/{t}/pledges')).toEqual(['pl-mine']);
  });

  it('returns what they wrote — posts, comments, prayer requests, messages they sent', async () => {
    const { body } = await exportAccount();
    expect(rowIds(body, 'community_posts')).toEqual(['post-mine']);
    expect(rowIds(body, 'community_posts/{id}/comments')).toEqual(['cm-mine']);
    expect(rowIds(body, 'prayer_requests')).toEqual(['p-mine']);
    expect(rowIds(body, 'tenants/{t}/dmMessages + channelMessages').sort()).toEqual(['chm-mine', 'dmm-mine']);
  });

  it('🔴 a livestream comment is returned once, under its own collection, not twice', async () => {
    const { body } = await exportAccount();
    // A collection group on `comments` matches livestream comments too — they
    // live in a subcollection with the same leaf name. Counting a member's rows
    // has to give one answer, so the feed collector is scoped by path.
    expect(rowIds(body, 'community_posts/{id}/comments')).toEqual(['cm-mine']);
    expect(rowIds(body, 'tenants/{t}/livestreamSessions/{id}/comments')).toEqual(['lc-mine']);
    expect(sectionFor(body, 'community_posts/{id}/comments').rows[0]).toMatchObject({ postId: 'post-theirs' });
  });

  it('returns what the church recorded about them — CRM row, timeline, registrations, check-ins, form answers', async () => {
    const { body } = await exportAccount();
    expect(rowIds(body, 'contacts').sort()).toEqual(['c-donor', 'c-plain']);
    expect(rowIds(body, 'contactActivities').sort()).toEqual(['a-gift', 'a-note']);
    expect(rowIds(body, 'tenants/{t}/registrations').sort()).toEqual(['reg-email', 'reg-uid']);
    expect(rowIds(body, 'tenants/{t}/checkinSessions/{id}/attendees').sort()).toEqual(['att-mine', 'att-mine-2']);
    expect(rowIds(body, 'tenants/{t}/forms/{id}/submissions')).toEqual(['sub-mine']);
    expect(rowIds(body, 'tenants/{t}/livestreamSessions/{id}/comments')).toEqual(['lc-mine']);
  });

  it('reports what the run cost, rather than leaving the reader to estimate it', async () => {
    const { body } = await exportAccount();
    expect(body.reads).toBeGreaterThan(0);
  });

  it('refuses a stale session with the same code the delete flow already answers', async () => {
    signedInAsMember({ auth_time: nowSeconds() - 60 * 60 });
    const { status, body } = await exportAccount();
    expect(status).toBe(401);
    expect(body.code).toBe('auth/requires-recent-login');
    expect(tree.recordedReads).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. 🔴 One enumeration, not two
// ─────────────────────────────────────────────────────────────────────────────

describe('the export covers every collection the erasure walks', () => {
  it('🔴 every entry in MEMBER_DATA_MAP has an export decision, by name', () => {
    expect(() => assertExportCoversMap()).not.toThrow();
    for (const entry of MEMBER_DATA_MAP) {
      expect(MEMBER_EXPORT_DECISIONS[entry.collection], `no export decision for ${entry.collection}`).toBeDefined();
    }
  });

  it('🔴 refuses to run at all when a collection the erasure walks has no decision — naming it', () => {
    const invented = { collection: 'tenants/{t}/somethingNew', disposition: 'delete', holds: 'uid', reason: 'new' } as const;
    expect(() => assertExportCoversMap([...MEMBER_DATA_MAP, invented])).toThrow(/tenants\/\{t\}\/somethingNew/);
  });

  it('🔴 refuses a decision for a collection the erasure does not enumerate — the other direction of drift', () => {
    expect(() => assertExportCoversMap(MEMBER_DATA_MAP.slice(1))).toThrow(new RegExp(MEMBER_DATA_MAP[0].collection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('every collection the erasure ACTS on comes back as a section in the export', async () => {
    const { body } = await exportAccount();
    const acted = MEMBER_DATA_MAP.filter((e) => e.disposition !== 'retain');
    for (const entry of acted) {
      expect(
        (body.sections ?? []).some((s) => s.collection === entry.collection),
        `${entry.collection} is swept by the erasure but has no export section`,
      ).toBe(true);
    }
  });

  it('every collection the erasure RETAINS has a visible answer too — exported, omitted, covered or a declared gap', async () => {
    const { body } = await exportAccount();
    const named = new Set([
      ...(body.sections ?? []).map((s) => s.collection),
      ...(body.omitted ?? []).map((o) => o.collection),
      ...(body.covered ?? []).map((c) => c.collection),
    ]);
    const gapEntries = new Set(MEMBER_DATA_MAP.filter((e) => MEMBER_EXPORT_DECISIONS[e.collection].disposition === 'gap').map((e) => e.collection));
    for (const entry of MEMBER_DATA_MAP.filter((e) => e.disposition === 'retain')) {
      expect(named.has(entry.collection) || gapEntries.has(entry.collection), `${entry.collection} has no answer`).toBe(true);
    }
  });

  it('the sections come back in the map’s own order, because they are built by walking it', async () => {
    const { body } = await exportAccount();
    const expected = MEMBER_DATA_MAP
      .filter((e) => {
        const d = MEMBER_EXPORT_DECISIONS[e.collection];
        return d.disposition !== 'gap' && d.disposition !== 'omit' && !d.coveredBy;
      })
      .map((e) => e.collection);
    expect((body.sections ?? []).map((s) => s.collection)).toEqual(expected);
  });

  it('🔴 carries the ERASURE’s disposition beside its own, so the asymmetries are readable in the file', async () => {
    const { body } = await exportAccount();
    for (const section of body.sections ?? []) {
      const entry = MEMBER_DATA_MAP.find((e) => e.collection === section.collection);
      expect(section.erasure).toBe(entry?.disposition);
    }
    // The two directions of asymmetry, each pinned by name.
    expect(sectionFor(body, 'affiliate_commissions').erasure).toBe('retain');
    expect(sectionFor(body, 'tenants/{t}/invoices').erasure).toBe('anonymise');
  });

  it('exports the giving history the erasure keeps as the church’s ledger', async () => {
    const { body } = await exportAccount();
    // 'donation' activities are RETAINED by the erasure and returned here.
    expect(rowIds(body, 'contactActivities')).toContain('a-gift');
    expect((body.covered ?? []).map((c) => c.collection)).toContain('contactActivities (type: donation)');
    // Affiliate payouts are retained by the erasure and are the member's earnings.
    expect(rowIds(body, 'affiliate_commissions')).toEqual(['ac-1']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. 🔴 The gaps
// ─────────────────────────────────────────────────────────────────────────────

describe('the three unkeyed collections are declared as gaps, not silently omitted', () => {
  it('🔴 names all three, at collection granularity', async () => {
    const { body } = await exportAccount();
    expect((body.gaps ?? []).map((g) => g.collection).sort()).toEqual([
      'tenants/{t}/livestreamSessions/{id}/prayers',
      'tenants/{t}/smsBroadcasts/{id}/logs',
      'tenants/{t}/smsLogs',
    ]);
  });

  it('says WHY each one cannot be reached, in the file the member downloads', async () => {
    const { body } = await exportAccount();
    for (const gap of body.gaps ?? []) expect(gap.reason).toMatch(/CANNOT BE EXPORTED/);
  });

  it('does not quietly return the rows it cannot attribute', async () => {
    const { body } = await exportAccount();
    const serialized = JSON.stringify(body.sections);
    // Seeded rows in both gap collections. Attributing them would mean matching
    // on a display name or a phone number, which over-matches by construction.
    expect(serialized).not.toContain('for my family');
    expect(serialized).not.toContain('delivered');
  });

  it('derives the gap list from the map’s own machine-readable field, not from its prose', () => {
    const unkeyed = MEMBER_DATA_MAP.flatMap((e) => e.unkeyed ?? []);
    expect(exportGaps().map((g) => g.collection).sort()).toEqual([...unkeyed].sort());
  });

  it('declares the church-owned collections as omitted rather than dropping them', async () => {
    const { body } = await exportAccount();
    const omitted = (body.omitted ?? []).map((o) => o.collection);
    expect(omitted.some((o) => o.includes('blog_posts'))).toBe(true);
    expect(JSON.stringify(body.sections)).not.toContain('A word from the pastor');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 & 5. 🔴 One member, their own data
// ─────────────────────────────────────────────────────────────────────────────

describe('a member cannot export another member’s data', () => {
  it('🔴 refuses a userId that is not the caller’s, before reading anything', async () => {
    const { status, body } = await exportAccount(OTHER_UID);
    expect(status).toBe(403);
    expect(body.step).toBe('ownership');
    expect(body.error).toMatch(/only export your own/i);
    expect(tree.recordedReads, 'a refused export must not have queried anything').toEqual([]);
  });

  it('🔴 has no super-admin bypass — the self-service path stays self-service', async () => {
    signedInAsMember({ admin: true, superAdmin: true });
    const { status, body } = await exportAccount(OTHER_UID);
    expect(status).toBe(403);
    expect(body.step).toBe('ownership');
  });

  it('refuses an unauthenticated caller outright', async () => {
    tree.mockVerifyIdToken.mockRejectedValue(new Error('bad token'));
    const { status } = await exportAccount();
    expect(status).toBe(401);
  });
});

describe('a member cannot export the tenant’s data', () => {
  it('🔴 no other member’s row appears anywhere in the file', async () => {
    const { body } = await exportAccount();
    const serialized = JSON.stringify(body.sections);
    for (const theirs of [
      OTHER_EMAIL,            // another member's email, in every collection that stores one
      'their post',           // a post the member did not write
      'their comment',        // a comment the member did not write
      'a reply of theirs',    // a comment on the member's OWN post — somebody else's words
      'a private matter',     // another member's prayer request, which the member prayed for
      'their channel message',
      'Sam Chapel',
      'amen too',
    ]) {
      expect(serialized, `${theirs} leaked into the export`).not.toContain(theirs);
    }
  });

  it('🔴 an RSVP returns only the member’s own attendee entry, not the whole roster', async () => {
    const { body } = await exportAccount();
    const rsvp = sectionFor(body, 'community_posts.eventDetails').rows[0];
    expect(rsvp).toMatchObject({ id: 'post-theirs', postTitle: 'Potluck' });
    expect(rsvp.myAttendeeDetails).toEqual([{ uid: UID, name: 'Grace', email: EMAIL }]);
  });

  it('🔴 a two-party DM thread comes back as metadata — never the other party’s words', async () => {
    const { body } = await exportAccount();
    const threads = sectionFor(body, 'tenants/{t}/directMessages');
    expect(threads.rows.map((r) => r.id)).toEqual(['dm-1']);
    expect(threads.rows[0]).not.toHaveProperty('lastMessage');
    expect(JSON.stringify(threads.rows)).not.toContain('sounds good');
  });

  it('🔴 an OAuth connection is named, and its live credential is not exported', async () => {
    const { body } = await exportAccount();
    const integrations = sectionFor(body, 'tenants/{t}/integrations');
    expect(integrations.rows.map((r) => r.provider).sort()).toEqual(['gmail', 'quickbooks']);
    const serialized = JSON.stringify(body);
    for (const secret of ['ca-secret-1', 'ca-secret-2', 'ca-secret-3']) {
      expect(serialized, 'a live grant handle must never leave in a downloadable file').not.toContain(secret);
    }
  });

  it('returns nothing from another tenant, even for the same member', async () => {
    const { body } = await exportAccount();
    const serialized = JSON.stringify(body.sections);
    expect(serialized).not.toContain('c-elsewhere');
    expect(serialized).not.toContain('p-elsewhere');
    expect(serialized).not.toContain('post-elsewhere');
  });

  it('🔴 a member who is also an admin still exports only themselves', async () => {
    signedInAsMember({ admin: true });
    const { status, body } = await exportAccount();
    expect(status).toBe(200);
    expect(rowIds(body, 'contacts').sort()).toEqual(['c-donor', 'c-plain']);
    expect(JSON.stringify(body.sections)).not.toContain(OTHER_EMAIL);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6 & 7. 🔴 REP-4's promise: never gated
// ─────────────────────────────────────────────────────────────────────────────

describe('an archived tenant can still export', () => {
  it('🔴 a member of an ARCHIVED church gets the whole file, not a paywall', async () => {
    tree.__reset();
    signedInAsMember();
    seedEverything({ status: TENANT_STATUS_ARCHIVED, plan: 'pro' });

    const { status, body } = await exportAccount();

    expect(status).toBe(200);
    expect(body.status).toBe('complete');
    // The sections a church that stopped paying most needs to still reach.
    expect(rowIds(body, 'tenants/{t}/invoices').sort()).toEqual(['inv-1', 'inv-2']);
    expect(rowIds(body, 'tenants/{t}/givingStatements')).toEqual(['2026_grace']);
    expect(sectionFor(body, 'users').count).toBe(1);
  });

  it('🔴 `export` is on NEVER_GATED, which is what makes that structural rather than a state somebody listed', () => {
    expect(NEVER_GATED).toContain('export');
  });

  it('exports for every other lifecycle state too, including ones this build does not know', async () => {
    for (const status of ['active', 'past_due', 'suspended', 'cancelled', 'pending', 'something-new', undefined]) {
      tree.__reset();
      signedInAsMember();
      seedEverything({ status });
      const res = await exportAccount();
      expect(res.status, `status ${String(status)} was gated`).toBe(200);
      expect(sectionFor(res.body, 'tenants/{t}/invoices').count).toBe(2);
    }
  });

  it('exports for a tenant whose document does not exist at all', async () => {
    tree.__reset();
    signedInAsMember();
    seedEverything();
    // Drop the tenant doc; the member's profile still names the tenant.
    tree.__seed('tenants', []);
    const { status, body } = await exportAccount();
    expect(status).toBe(200);
    expect(sectionFor(body, 'tenants/{t}/invoices').count).toBe(2);
  });
});

describe('no export is plan-gated', () => {
  it('🔴 every plan returns exactly the same file', async () => {
    const shapes: Record<string, Record<string, number>> = {};
    for (const plan of ['free', 'starter', 'pro', 'enterprise', undefined]) {
      tree.__reset();
      signedInAsMember();
      seedEverything({ status: 'active', plan });
      const { status, body } = await exportAccount();
      expect(status, `plan ${String(plan)} was gated`).toBe(200);
      shapes[String(plan)] = Object.fromEntries((body.sections ?? []).map((s) => [s.collection, s.count]));
    }
    const [first, ...rest] = Object.values(shapes);
    for (const other of rest) expect(other).toEqual(first);
  });

  it('🔴 the free plan on an ARCHIVED tenant — the case REP-4 exists for — still exports everything', async () => {
    tree.__reset();
    signedInAsMember();
    seedEverything({ status: TENANT_STATUS_ARCHIVED, plan: 'free' });
    const { status, body } = await exportAccount();
    expect(status).toBe(200);
    expect(sectionFor(body, 'tenants/{t}/invoices').count).toBe(2);
    expect(sectionFor(body, 'contactActivities').count).toBe(2);
  });

  it('no export decision is conditioned on a plan or a subscription', () => {
    for (const [label, decision] of Object.entries(MEMBER_EXPORT_DECISIONS)) {
      expect(decision.reason, `${label} names a plan in its reason`).not.toMatch(/\bplan\b|\bsubscription\b|\btier\b|\bupgrade\b/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. 🔴 The catastrophic class — on a READ, null means every tenant
// ─────────────────────────────────────────────────────────────────────────────

describe('every export query carries a concrete tenant id and uid, never null', () => {
  it('🔴 no query anywhere in the run was built with a null, undefined or empty value', async () => {
    await exportAccount();
    expect(tree.recordedWheres.length).toBeGreaterThan(0);
    const bad = tree.recordedWheres.filter((w) => w.value === null || w.value === undefined || w.value === '');
    expect(bad, `queries built from a non-concrete scope: ${JSON.stringify(bad)}`).toEqual([]);
  });

  it('🔴 every tenant-scoped read names THIS tenant and no other', async () => {
    await exportAccount();
    for (const w of tree.recordedWheres.filter((w) => w.field === 'tenantId')) expect(w.value).toBe(TENANT);
    expect(tree.recordedWheres.filter((w) => w.path.startsWith(`tenants/${OTHER_TENANT}`))).toEqual([]);
    expect(tree.recordedReads.filter((r) => r.path.startsWith(`tenants/${OTHER_TENANT}`))).toEqual([]);
  });

  it('🔴 refuses outright to run when the scope is not concrete, instead of matching everything', () => {
    for (const bad of [null, undefined, '', '   ', 0, false]) {
      expect(() => assertConcreteScope(bad, 'tenantId'), String(bad)).toThrow(/non-concrete tenantId/);
    }
  });

  it('the only unscoped-looking read is keyed on the uid, which is tighter than a tenant filter', async () => {
    await exportAccount();
    const groupQueries = tree.recordedWheres.filter((w) => w.group);
    expect(groupQueries.length).toBeGreaterThan(0);
    for (const q of groupQueries) {
      expect(q.field).toBe('authorId');
      expect(q.value).toBe(UID);
    }
  });

  it('🔴 skips the tenant-scoped sections BY NAME for a member with no tenant, rather than scoping them to null', async () => {
    tree.__reset();
    signedInAsMember();
    seedEverything();
    tree.__seed('users', [{ id: UID, email: EMAIL, displayName: 'Grace', tenantId: null }]);

    const { status, body } = await exportAccount();

    expect(status).toBe(200);
    expect(body.subject?.tenantId).toBeNull();
    expect(tree.recordedWheres.filter((w) => w.value === null)).toEqual([]);
    const skipped = (body.sections ?? []).filter((s) => s.collection.startsWith('tenants/{t}/'));
    expect(skipped.length).toBeGreaterThan(0);
    for (const s of skipped) {
      expect(s.count, `${s.collection} ran without a tenant`).toBe(0);
      expect(s.note).toMatch(/no tenant/i);
    }
    // Another tenant's rows are not swept up by a null scope.
    expect(JSON.stringify(body.sections)).not.toContain('c-elsewhere');
  });

  it('a super admin’s null tenant scope can never widen an export, because the scope comes from the profile', async () => {
    signedInAsMember({ admin: true, superAdmin: true, tenantId: null });
    const { status, body } = await exportAccount();
    expect(status).toBe(200);
    // The tenant is read from users/{uid}, never from the token's scope helper.
    expect(body.subject?.tenantId).toBe(TENANT);
    expect(tree.recordedReads.filter((r) => r.path.startsWith(`tenants/${OTHER_TENANT}`))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Scale
// ─────────────────────────────────────────────────────────────────────────────

describe('an export larger than one batch is chunked or streamed', () => {
  const BIG = EXPORT_PAGE * 2 + 137; // 937 — three pages and a short one

  beforeEach(() => {
    tree.__seed(
      `tenants/${TENANT}/invoices`,
      Array.from({ length: BIG }, (_, i) => ({
        id: `bulk-${String(i).padStart(4, '0')}`,
        type: 'donation_receipt',
        recipientEmail: EMAIL,
        amount: 100 + i,
      })),
    );
  });

  it('🔴 returns every row, not just the first page', async () => {
    const { status, body } = await exportAccount();
    expect(status).toBe(200);
    // The four seeded invoices plus the bulk rows; two of the four are the
    // member's, two are decoys.
    expect(sectionFor(body, 'tenants/{t}/invoices').count).toBe(BIG + 2);
    expect(sectionFor(body, 'tenants/{t}/invoices').truncated).toBe(false);
  });

  it('🔴 pages that collection instead of pulling it in one read', async () => {
    await exportAccount();
    const invoiceReads = tree.recordedReads.filter((r) => r.path === `tenants/${TENANT}/invoices`);
    expect(invoiceReads.length).toBeGreaterThan(2);
    for (const r of invoiceReads) expect(r.limit).toBe(EXPORT_PAGE);
    // The cursor moves — a run that re-read the same first page forever would
    // show `after: null` every time.
    expect(invoiceReads.filter((r) => r.after !== null).length).toBeGreaterThan(0);
  });

  it('🔴 no read in the whole run is unbounded', async () => {
    await exportAccount();
    expect(tree.recordedReads.length).toBeGreaterThan(0);
    const unbounded = tree.recordedReads.filter((r) => !Number.isFinite(r.limit));
    expect(unbounded, `unbounded reads: ${JSON.stringify(unbounded)}`).toEqual([]);
  });

  it('a section that had to stop early SAYS so, rather than coming back looking whole', async () => {
    const { body } = await exportAccount();
    for (const section of body.sections ?? []) expect(section).toHaveProperty('truncated');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. The half that already shipped
// ─────────────────────────────────────────────────────────────────────────────

describe('the delete routes are unchanged', () => {
  /**
   * 🔴 THE-188 ADDS AN EXPORT AND TOUCHES NEITHER DELETE ROUTE.
   *
   * Pinned by content digest rather than by a `git show`, which CI's checkout
   * depth has already made a source of failures that have nothing to do with the
   * code under test. Changing either route on purpose means updating the digest
   * here — a deliberate, reviewable edit, which is exactly the point.
   */
  const PINNED: Record<string, string> = {
    'src/app/api/account/delete/route.ts':
      '16ebeaef364cf93356cb4db00a8330ed7125fffc3c0cc0752d12ee64b17d7cda',
    'src/app/api/tenants/delete/route.ts':
      'c92b7848dd354a6e9c1ebed76e4e883216e6cab54fdcd51fc91536288b453834',
  };

  it.each(Object.keys(PINNED))('%s is byte-for-byte what PR 354 shipped', (file) => {
    const contents = readFileSync(path.join(process.cwd(), file));
    expect(createHash('sha256').update(contents).digest('hex')).toBe(PINNED[file]);
  });

  it('the export never writes — no batch is ever committed during a run', async () => {
    await exportAccount();
    expect(tree.mockBatchCommit).not.toHaveBeenCalled();
  });

  it('the member’s data is still there afterwards — an export is a read, not a move', async () => {
    await exportAccount();
    expect(tree.__doc('users', UID)).toBeDefined();
    expect(tree.__count(`tenants/${TENANT}/invoices`)).toBe(4);
    expect(tree.__count('prayer_requests')).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Partial failure
// ─────────────────────────────────────────────────────────────────────────────

describe('a partial export is never reported as whole', () => {
  it('🔴 names the section that failed and returns a non-2xx, with the rows it did read still in the body', async () => {
    tree.__reset();
    signedInAsMember();
    seedEverything();
    // The certificates section throws; every other section still runs.
    const realGet = tree.adminDb.collection;
    vi.spyOn(tree.adminDb, 'collection').mockImplementation((name: string) => {
      if (name === 'certificates') {
        return { where: () => ({ limit: () => ({ get: async () => { throw new Error('index missing'); } }) }) } as never;
      }
      return realGet(name);
    });

    const { status, body } = await exportAccount();

    expect(status).toBe(500);
    expect(body.status).toBe('partial');
    expect((body.failures ?? []).map((f) => f.collection)).toContain('certificates');
    expect(body.error).toMatch(/incomplete/i);
    // Nothing thrown away: the sections that DID read are still in the body.
    expect(sectionFor(body, 'users').count).toBe(1);
    expect(sectionFor(body, 'tenants/{t}/invoices').count).toBe(2);

    vi.mocked(tree.adminDb.collection).mockRestore();
  });
});
