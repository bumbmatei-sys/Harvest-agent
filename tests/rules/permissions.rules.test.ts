import { describe, it, beforeAll, afterAll } from 'vitest';
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  getEnv, seedBase, seedAdmin, seedDoc, teardownEnv,
  superAdmin, owner, rosterAdmin, member, adminB, asUid,
  permsOnly, permsAllBut,
  TENANT_A, MEMBER_UID,
  type PermKey,
} from './helpers';

/**
 * Part 2 — the 23-permission matrix: every admin-feature collection's
 * create/update/delete is gated on the specific permission, while the owner,
 * a fullAccess admin, a legacy adminEmails-roster admin, and the super admin
 * always pass, and cross-tenant admins / plain members are always denied.
 *
 * Each case seeds one admin holding ONLY the mapped permission and one
 * holding every permission EXCEPT it — the pair proves the gate is both
 * sufficient and necessary.
 */

interface FeatureCase {
  /** test label; also used to build unique doc ids */
  name: string;
  /** the permission that must gate this collection's writes */
  perm: PermKey;
  /** doc path for a unique suffix, e.g. s => `blog_posts/post-${s}` */
  path: (suffix: string) => string;
  /** payload used for creates (include tenantId for top-level collections) */
  createData: Record<string, unknown>;
  /** payload for the pre-seeded update/delete target (defaults to createData) */
  seedData?: Record<string, unknown>;
  /** fields changed on update */
  updateData?: Record<string, unknown>;
  /** ops to exercise (default: all three) */
  ops?: Array<'create' | 'update' | 'delete'>;
  /**
   * Docs with no tenantId (shared global library, e.g. authors/categories):
   * an admin of ANY tenant holding the permission may write, so the
   * cross-tenant denial doesn't apply.
   */
  sharedGlobal?: boolean;
}

const T = TENANT_A;
const sub = (rest: string) => `tenants/${T}/${rest}`;

// ── The mapping under test (mirror of the hasPermission() call sites) ──
const CASES: FeatureCase[] = [
  // Content
  {
    name: 'blog_posts', perm: 'writeArticles',
    path: s => `blog_posts/post-${s}`,
    createData: { tenantId: T, title: 'Hello', content: 'x', authorId: 'a' },
    updateData: { title: 'Edited' },
  },
  {
    name: 'courses', perm: 'createCourses',
    path: s => `courses/course-${s}`,
    createData: { tenantId: T, title: 'Course', levels: [] },
    updateData: { title: 'Edited' },
  },
  {
    name: 'authors (global, course library)', perm: 'createCourses',
    path: s => `authors/author-${s}`,
    createData: { name: 'Author', title: 'Teacher' },
    updateData: { name: 'Renamed' },
    sharedGlobal: true,
  },
  {
    name: 'categories (global, course library)', perm: 'createCourses',
    path: s => `categories/cat-${s}`,
    createData: { name: 'Discipleship' },
    updateData: { name: 'Renamed' },
    sharedGlobal: true,
  },
  {
    name: 'rag_sources', perm: 'uploadRag',
    path: s => `rag_sources/src-${s}`,
    createData: { tenantId: T, name: 'doc.pdf', status: 'processing' },
    updateData: { status: 'ready' },
  },
  {
    name: 'rag_chunks', perm: 'uploadRag',
    path: s => `rag_chunks/chunk-${s}`,
    createData: { tenantId: T, sourceId: 'src', text: 'chunk' },
    updateData: { text: 'edited' },
  },
  {
    name: 'newsletters', perm: 'manageNewsletter',
    path: s => sub(`newsletters/nl-${s}`),
    createData: { subject: 'News', body: 'x' },
    updateData: { subject: 'Edited' },
  },
  {
    name: 'blogAutomation settings', perm: 'writeArticles',
    path: s => sub(`blogAutomation/settings-${s}`),
    createData: { enabled: true, cadence: 'weekly' },
    updateData: { enabled: false },
  },
  {
    name: 'docs', perm: 'manageDocs',
    path: s => `docs/doc-${s}`,
    createData: { tenantId: T, title: 'Note', createdBy: 'someone-else' },
    updateData: { title: 'Edited' },
  },
  {
    name: 'docFolders', perm: 'manageDocs',
    path: s => `docFolders/folder-${s}`,
    createData: { tenantId: T, name: 'Folder' },
    updateData: { name: 'Renamed' },
  },
  // Ministry
  {
    name: 'churches', perm: 'modifyChurches',
    path: s => `churches/church-${s}`,
    createData: { tenantId: T, name: 'Church', status: 'approved' },
    updateData: { status: 'pending' },
  },
  {
    name: 'contacts (top-level CRM)', perm: 'manageCRM',
    path: s => `contacts/contact-${s}`,
    createData: { tenantId: T, name: 'Jane', email: 'j@x.com' },
    updateData: { name: 'Janet' },
  },
  {
    name: 'contactActivities (top-level CRM)', perm: 'manageCRM',
    path: s => `contactActivities/act-${s}`,
    createData: { tenantId: T, contactId: 'c1', type: 'call' },
    updateData: { type: 'email' },
  },
  {
    name: 'tenant contacts (subcollection CRM)', perm: 'manageCRM',
    path: s => sub(`contacts/contact-${s}`),
    createData: { name: 'Jane' },
    updateData: { name: 'Janet' },
  },
  {
    name: 'tenant contactActivities (subcollection CRM)', perm: 'manageCRM',
    path: s => sub(`contactActivities/act-${s}`),
    createData: { contactId: 'c1', type: 'call' },
    updateData: { type: 'email' },
  },
  {
    name: 'forms', perm: 'manageForms',
    path: s => sub(`forms/form-${s}`),
    createData: { title: 'Form', active: true, fields: [] },
    updateData: { active: false },
  },
  {
    name: 'form submissions (admin pipeline)', perm: 'manageForms',
    path: s => sub(`forms/shared-form/submissions/sub-${s}`),
    createData: { data: { a: 1 } },
    updateData: { status: 'reviewed' },
  },
  {
    name: 'fundraising campaigns', perm: 'manageFundraising',
    path: s => `campaigns/camp-${s}`,
    createData: { tenantId: T, title: 'Campaign', goal: 100 },
    updateData: { goal: 200 },
  },
  {
    name: 'pledges', perm: 'manageFundraising',
    path: s => sub(`pledges/pledge-${s}`),
    createData: { amount: 50, name: 'Donor' },
    updateData: { amount: 75 },
  },
  {
    name: 'invoices', perm: 'manageAccounting',
    path: s => sub(`invoices/inv-${s}`),
    createData: { number: 'INV-1', total: 10 },
    updateData: { total: 20 },
  },
  {
    name: 'givingStatements', perm: 'manageGivingStatements',
    path: s => sub(`givingStatements/gs-${s}`),
    createData: { year: 2025, donorId: 'd1' },
    updateData: { year: 2026 },
  },
  // Broadcasting
  {
    name: 'events', perm: 'manageEvents',
    path: s => sub(`events/event-${s}`),
    createData: { title: 'Event', startsAt: '2026-01-01' },
    updateData: { title: 'Edited' },
  },
  {
    name: 'checkinSessions', perm: 'manageCheckin',
    path: s => sub(`checkinSessions/cs-${s}`),
    createData: { name: 'Sunday', status: 'open' },
    updateData: { status: 'closed' },
  },
  {
    name: 'checkin attendees', perm: 'manageCheckin',
    path: s => sub(`checkinSessions/shared-session/attendees/att-${s}`),
    createData: { name: 'Kid A' },
    updateData: { name: 'Kid B' },
  },
  {
    name: 'livestream', perm: 'manageLivestream',
    path: s => sub(`livestream/current-${s}`),
    createData: { active: true, videoId: 'v' },
    updateData: { active: false },
  },
  {
    name: 'livestreamSessions', perm: 'manageLivestream',
    path: s => sub(`livestreamSessions/ls-${s}`),
    createData: { startedAt: 'now' },
    updateData: { endedAt: 'later' },
  },
  {
    name: 'livestream prayers', perm: 'manageLivestream',
    path: s => sub(`livestreamSessions/shared-ls/prayers/prayer-${s}`),
    createData: { request: 'pray', prayed: false },
    updateData: { prayed: true },
  },
  {
    name: 'smsBroadcasts', perm: 'manageSms',
    path: s => sub(`smsBroadcasts/sms-${s}`),
    createData: { message: 'Hi', status: 'draft' },
    updateData: { status: 'sent' },
  },
  {
    name: 'smsLogs', perm: 'manageSms',
    path: s => sub(`smsLogs/log-${s}`),
    createData: { to: '+1', body: 'Hi' },
    updateData: { body: 'Edited' },
  },
  {
    name: 'tenant settings (dormant subcollection)', perm: 'manageSettings',
    path: s => sub(`settings/setting-${s}`),
    createData: { value: 'x' },
    updateData: { value: 'y' },
  },
];

// Uids for the per-case seeded admins.
const holderUid = (perm: string) => `holder-${perm}`;
const nonHolderUid = (perm: string) => `nonholder-${perm}`;

beforeAll(async () => {
  await seedBase();
  // One holder/non-holder pair per distinct permission key (plus the perms
  // exercised only by the custom describe blocks below).
  const perms = [...new Set([...CASES.map(c => c.perm), 'manageCommunity' as const, 'createPosts' as const, 'manageBranding' as const])];
  for (const p of perms) {
    await seedAdmin(holderUid(p), TENANT_A, permsOnly(p));
    await seedAdmin(nonHolderUid(p), TENANT_A, permsAllBut(p));
  }
  // Shared parent docs for subcollection cases.
  await seedDoc(sub('forms/shared-form'), { title: 'Shared', active: true });
  await seedDoc(sub('checkinSessions/shared-session'), { name: 'Shared', status: 'open' });
  await seedDoc(sub('livestreamSessions/shared-ls'), { startedAt: 'now' });
});

afterAll(async () => {
  await teardownEnv();
});

/** Seed a fresh target doc and return its path. */
async function seedTarget(c: FeatureCase, suffix: string): Promise<string> {
  const p = c.path(suffix);
  await seedDoc(p, c.seedData ?? c.createData);
  return p;
}

for (const c of CASES) {
  const ops = c.ops ?? ['create', 'update', 'delete'];

  describe(`${c.name} [${c.perm}]`, () => {
    it(`an admin holding ONLY ${c.perm} can write`, async () => {
      const db = (await asUid(holderUid(c.perm))).firestore();
      if (ops.includes('create')) await assertSucceeds(db.doc(c.path('h-create')).set(c.createData));
      if (ops.includes('update')) {
        const p = await seedTarget(c, 'h-update');
        await assertSucceeds(db.doc(p).update(c.updateData ?? { _touched: true }));
      }
      if (ops.includes('delete')) {
        const p = await seedTarget(c, 'h-delete');
        await assertSucceeds(db.doc(p).delete());
      }
    });

    it(`an admin with every permission EXCEPT ${c.perm} is denied`, async () => {
      const db = (await asUid(nonHolderUid(c.perm))).firestore();
      if (ops.includes('create')) await assertFails(db.doc(c.path('n-create')).set(c.createData));
      if (ops.includes('update')) {
        const p = await seedTarget(c, 'n-update');
        await assertFails(db.doc(p).update(c.updateData ?? { _touched: true }));
      }
      if (ops.includes('delete')) {
        const p = await seedTarget(c, 'n-delete');
        await assertFails(db.doc(p).delete());
      }
    });

    it('the tenant owner retains full access', async () => {
      const db = (await owner()).firestore();
      if (ops.includes('create')) await assertSucceeds(db.doc(c.path('o-create')).set(c.createData));
      if (ops.includes('update')) {
        const p = await seedTarget(c, 'o-update');
        await assertSucceeds(db.doc(p).update(c.updateData ?? { _touched: true }));
      }
      if (ops.includes('delete')) {
        const p = await seedTarget(c, 'o-delete');
        await assertSucceeds(db.doc(p).delete());
      }
    });

    it('a legacy adminEmails-roster admin (no users doc) retains full access', async () => {
      const db = (await rosterAdmin()).firestore();
      if (ops.includes('create')) await assertSucceeds(db.doc(c.path('r-create')).set(c.createData));
      if (ops.includes('update')) {
        const p = await seedTarget(c, 'r-update');
        await assertSucceeds(db.doc(p).update(c.updateData ?? { _touched: true }));
      }
    });

    it('a super admin retains full access', async () => {
      const db = (await superAdmin()).firestore();
      if (ops.includes('create')) await assertSucceeds(db.doc(c.path('s-create')).set(c.createData));
      if (ops.includes('delete')) {
        const p = await seedTarget(c, 's-delete');
        await assertSucceeds(db.doc(p).delete());
      }
    });

    it(c.sharedGlobal
      ? 'a plain member is denied (global docs stay open to other tenants\' permission holders)'
      : 'a cross-tenant admin and a plain member are denied', async () => {
      const dbB = (await adminB()).firestore();
      const dbM = (await member()).firestore();
      if (ops.includes('create')) {
        if (!c.sharedGlobal) await assertFails(dbB.doc(c.path('b-create')).set(c.createData));
        await assertFails(dbM.doc(c.path('m-create')).set(c.createData));
      }
      if (ops.includes('update')) {
        const p = await seedTarget(c, 'bm-update');
        if (!c.sharedGlobal) await assertFails(dbB.doc(p).update(c.updateData ?? { _touched: true }));
        await assertFails(dbM.doc(p).update(c.updateData ?? { _touched: true }));
      }
    });
  });
}

/**
 * fullAccess sentinel: an admin whose map has every flag FALSE but
 * fullAccess TRUE must pass everywhere (that's how the Roles editor stores
 * "Full Access" — plus all flags true, but the sentinel alone must suffice).
 */
describe('fullAccess sentinel', () => {
  it('fullAccess=true with every specific flag false still writes everywhere', async () => {
    const perms = permsOnly(); // all false
    perms.fullAccess = true;
    await seedAdmin('sentinel-admin', TENANT_A, perms);
    const db = (await asUid('sentinel-admin')).firestore();
    await assertSucceeds(db.doc('blog_posts/sentinel-post').set({ tenantId: T, title: 'x', content: 'y', authorId: 'a' }));
    await assertSucceeds(db.doc(sub('invoices/sentinel-inv')).set({ number: 'INV-9', total: 1 }));
    await assertSucceeds(db.doc(sub('checkinSessions/sentinel-cs')).set({ name: 'x', status: 'open' }));
  });

  it('legacy seeFormsInbox=true still writes forms (normalizePermissions parity)', async () => {
    const perms = permsOnly(); // all false
    (perms as Record<string, unknown>).seeFormsInbox = true;
    await seedAdmin('legacy-forms-admin', TENANT_A, perms);
    const db = (await asUid('legacy-forms-admin')).firestore();
    await assertSucceeds(db.doc(sub('forms/legacy-form')).set({ title: 'Legacy', active: true }));
  });
});

/**
 * Member-level flows that must KEEP working unchanged (reads untouched;
 * member creates in shared collections).
 */
describe('member-flow regressions', () => {
  it('a member can still read tenant content (blog/courses)', async () => {
    await seedDoc('blog_posts/read-check', { tenantId: T, title: 'r', content: 'c', authorId: 'a' });
    const db = (await member()).firestore();
    await assertSucceeds(db.doc('blog_posts/read-check').get());
  });

  it('a member can still create a community post and a prayer request', async () => {
    const db = (await member()).firestore();
    await assertSucceeds(db.doc('community_posts/member-post').set({
      tenantId: T, authorId: MEMBER_UID, content: 'hello', createdAt: 'now',
    }));
    await assertSucceeds(db.doc('prayer_requests/member-prayer').set({
      tenantId: T, authorId: MEMBER_UID, request: 'please pray',
    }));
  });

  it('a member can still submit a top-level form submission', async () => {
    const db = (await member()).firestore();
    await assertSucceeds(db.doc('submissions/member-sub').set({ tenantId: T, data: { a: 1 } }));
  });

  it('a member can still register for an event (self)', async () => {
    const db = (await member()).firestore();
    await assertSucceeds(db.doc(sub('registrations/member-reg')).set({ userId: MEMBER_UID, eventId: 'e1' }));
  });

  it('a member CANNOT update a submission status (admin pipeline)', async () => {
    await seedDoc('submissions/pipeline-sub', { tenantId: T, data: {}, status: 'new' });
    const db = (await member()).firestore();
    await assertFails(db.doc('submissions/pipeline-sub').update({ status: 'done' }));
  });
});

/**
 * Admin-moderation edges on member content.
 */
describe('moderation edges', () => {
  it("community_posts: only a createPosts admin (or better) can edit someone else's post", async () => {
    await getEnv(); // ensure env
    await seedDoc('community_posts/mod-target-1', { tenantId: T, authorId: 'someone', content: 'x' });
    await seedDoc('community_posts/mod-target-2', { tenantId: T, authorId: 'someone', content: 'x' });
    const holder = (await asUid(holderUid('createPosts'))).firestore();
    await assertSucceeds(holder.doc('community_posts/mod-target-1').update({ content: 'moderated' }));
    const non = (await asUid(nonHolderUid('createPosts'))).firestore();
    await assertFails(non.doc('community_posts/mod-target-2').update({ content: 'hijack' }));
  });

  it('community_posts: the author can still edit/delete their own post', async () => {
    await seedDoc('community_posts/own-post', { tenantId: T, authorId: MEMBER_UID, content: 'mine' });
    const db = (await member()).firestore();
    await assertSucceeds(db.doc('community_posts/own-post').update({ content: 'edited' }));
    await assertSucceeds(db.doc('community_posts/own-post').delete());
  });

  it('prayer_requests: author delete still works; non-author member cannot delete', async () => {
    await seedDoc('prayer_requests/own-prayer', { tenantId: T, authorId: MEMBER_UID, request: 'x' });
    const db = (await member()).firestore();
    await assertSucceeds(db.doc('prayer_requests/own-prayer').delete());
    await seedDoc('prayer_requests/other-prayer', { tenantId: T, authorId: 'someone', request: 'x' });
    await assertFails(db.doc('prayer_requests/other-prayer').delete());
  });
});

/**
 * Community messaging — admin branches move to manageCommunity while every
 * member carve-out keeps working.
 */
describe('community messaging [manageCommunity]', () => {
  it('channels: only a manageCommunity admin can create/manage channels', async () => {
    const holder = (await asUid(holderUid('manageCommunity'))).firestore();
    await assertSucceeds(holder.doc(sub('channels/general')).set({ name: 'general', members: [MEMBER_UID] }));
    const non = (await asUid(nonHolderUid('manageCommunity'))).firestore();
    await assertFails(non.doc(sub('channels/rogue')).set({ name: 'rogue', members: [] }));
  });

  it('channels: a channel member can still bump ONLY the last-message preview', async () => {
    await seedDoc(sub('channels/preview-ch'), { name: 'p', members: [MEMBER_UID], lastMessage: '', lastMessageAt: 0 });
    const db = (await member()).firestore();
    await assertSucceeds(db.doc(sub('channels/preview-ch')).update({ lastMessage: 'hi', lastMessageAt: 1 }));
    await assertFails(db.doc(sub('channels/preview-ch')).update({ name: 'hijacked' }));
  });

  it('channelMessages: channel members post; a manageCommunity admin moderates; others cannot', async () => {
    await seedDoc(sub('channels/chat-ch'), { name: 'c', members: [MEMBER_UID] });
    const db = (await member()).firestore();
    await assertSucceeds(db.doc(sub('channelMessages/m1')).set({ channelId: 'chat-ch', senderId: MEMBER_UID, content: 'hi' }));
    const holder = (await asUid(holderUid('manageCommunity'))).firestore();
    await assertSucceeds(holder.doc(sub('channelMessages/m1')).update({ content: 'moderated' }));
    const non = (await asUid(nonHolderUid('manageCommunity'))).firestore();
    await assertFails(non.doc(sub('channelMessages/m1')).update({ content: 'nope' }));
    await assertFails(db.doc(sub('channelMessages/m1')).delete());
  });

  it('dmMessages: member send + recipient read-receipt keep working; moderation needs manageCommunity', async () => {
    const db = (await member()).firestore();
    await assertSucceeds(db.doc(sub('dmMessages/dm-m1')).set({ dmId: 'd1', senderId: MEMBER_UID, content: 'hey', read: false }));
    await seedDoc(sub('dmMessages/dm-in'), { dmId: 'd1', senderId: 'someone-else', content: 'yo', read: false });
    await assertSucceeds(db.doc(sub('dmMessages/dm-in')).update({ read: true }));
    // A member cannot edit message CONTENT (even one they received)
    await assertFails(db.doc(sub('dmMessages/dm-in')).update({ content: 'tampered' }));
    const holder = (await asUid(holderUid('manageCommunity'))).firestore();
    await assertSucceeds(holder.doc(sub('dmMessages/dm-in')).update({ content: 'moderated' }));
    const non = (await asUid(nonHolderUid('manageCommunity'))).firestore();
    await assertFails(non.doc(sub('dmMessages/dm-in')).delete());
  });

  it('directMessages: members open threads and update previews; deletion needs manageCommunity', async () => {
    const db = (await member()).firestore();
    await assertSucceeds(db.doc(sub('directMessages/t1')).set({ participants: [MEMBER_UID, 'x'], lastMessage: '' }));
    await assertSucceeds(db.doc(sub('directMessages/t1')).update({ lastMessage: 'hi', lastMessageAt: 1 }));
    await assertFails(db.doc(sub('directMessages/t1')).delete());
    const holder = (await asUid(holderUid('manageCommunity'))).firestore();
    await assertSucceeds(holder.doc(sub('directMessages/t1')).delete());
  });
});

/**
 * Cross-screen carve-out: Notes → "Share to Livestream" writes ONLY
 * sermonNote on livestream/current under manageDocs.
 */
describe('livestream sermonNote carve-out [manageDocs]', () => {
  it('a manageDocs-only admin can share sermon notes (sermonNote-only update)', async () => {
    await seedDoc(sub('livestream/current'), { active: true, videoId: 'v', sermonNote: null });
    const db = (await asUid(holderUid('manageDocs'))).firestore();
    await assertSucceeds(db.doc(sub('livestream/current')).update({ sermonNote: { docId: 'd', title: 'T' } }));
    // ...but cannot touch anything else on the stream doc
    await assertFails(db.doc(sub('livestream/current')).update({ active: false }));
    await assertFails(db.doc(sub('livestream/current')).update({ sermonNote: null, videoId: 'hijack' }));
  });

  it('an admin with neither manageDocs nor manageLivestream cannot write sermonNote', async () => {
    await seedDoc(sub('livestream/current-2'), { active: true, sermonNote: null });
    const db = (await asUid(holderUid('manageForms'))).firestore();
    await assertFails(db.doc(sub('livestream/current-2')).update({ sermonNote: { docId: 'd' } }));
  });
});

/**
 * Tenant doc — name/config/branding edits need manageBranding or
 * manageSettings; billing/owner/roster fields stay locked for everyone
 * but the super admin.
 */
describe('tenant doc update [manageBranding || manageSettings]', () => {
  it('a manageBranding admin and a manageSettings admin can edit config fields', async () => {
    const branding = (await asUid(holderUid('manageBranding'))).firestore();
    await assertSucceeds(branding.doc(`tenants/${T}`).update({ 'config.brandColor': '#fff' }));
    const settings = (await asUid(holderUid('manageSettings'))).firestore();
    await assertSucceeds(settings.doc(`tenants/${T}`).update({ 'config.onboardingInitialized': true }));
  });

  it('the owner can still complete first-run/wizard flows', async () => {
    const db = (await owner()).firestore();
    await assertSucceeds(db.doc(`tenants/${T}`).update({ setupWizardCompleted: true }));
  });

  it('an admin with neither branding nor settings permission cannot edit the tenant doc', async () => {
    const db = (await asUid(holderUid('manageCheckin'))).firestore();
    await assertFails(db.doc(`tenants/${T}`).update({ name: 'Hijacked' }));
  });

  it('billing/owner/roster fields stay locked even for a branding admin (and open to super admin)', async () => {
    const branding = (await asUid(holderUid('manageBranding'))).firestore();
    await assertFails(branding.doc(`tenants/${T}`).update({ plan: 'ultra' }));
    await assertFails(branding.doc(`tenants/${T}`).update({ ownerId: 'me' }));
    await assertFails(branding.doc(`tenants/${T}`).update({ adminEmails: ['evil@x.com'] }));
    const sa = (await superAdmin()).firestore();
    await assertSucceeds(sa.doc(`tenants/${T}`).update({ plan: 'ultra' }));
  });
});

/**
 * donations — dead collection; the old unscoped isAdmin() update/delete was a
 * cross-tenant hole. Now super-admin-only.
 */
describe('donations lockdown', () => {
  it('tenant admins (any tenant) can no longer update/delete donation docs', async () => {
    await seedDoc('donations/d1', { tenantId: T, amount: 100 });
    const full = (await asUid(holderUid('manageFundraising'))).firestore();
    await assertFails(full.doc('donations/d1').update({ amount: 1 }));
    const b = (await adminB()).firestore();
    await assertFails(b.doc('donations/d1').update({ amount: 1 }));
    const sa = (await superAdmin()).firestore();
    await assertSucceeds(sa.doc('donations/d1').update({ amount: 100 }));
  });
});
