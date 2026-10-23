// Seeds the Firestore + Auth EMULATORS with a fictional ministry ("Grace Fellowship") and a second one ("Rival")
// so the palette can be shown searching real data under the real security rules. Emulator only.
import { createRequire } from 'node:module';
const require = createRequire('/home/user/Harvest-agent/package.json');
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

initializeApp({ projectId: 'harvest-agent-233a1' });
const db = getFirestore();
const auth = getAuth();
const now = Date.now();
const ago = (days) => Timestamp.fromMillis(now - days * 86400000);
const iso = (days) => new Date(now - days * 86400000).toISOString();

const ADMIN_EMAIL = 'admin@grace.example.org';
const ADMIN_PASSWORD = 'demo-password-1';
const STAFF_EMAIL = 'staff@grace.example.org';

async function user(email, displayName, claims) {
  try { await auth.deleteUser((await auth.getUserByEmail(email)).uid); } catch {}
  const rec = await auth.createUser({ email, password: ADMIN_PASSWORD, displayName, emailVerified: true });
  await auth.setCustomUserClaims(rec.uid, claims);
  return rec.uid;
}

const adminUid = await user(ADMIN_EMAIL, 'Ruth Admin', { tenantId: 'grace', admin: true });
const staffUid = await user(STAFF_EMAIL, 'Sam Staff', { tenantId: 'grace', admin: true });

await db.doc('tenants/grace').set({
  name: 'Grace Fellowship', subdomain: 'grace', plan: 'max', status: 'active', ownerId: adminUid, setupCompleted: true,
  config: { name: 'Grace Fellowship' }, createdAt: iso(400), updatedAt: iso(1),
});
await db.doc('tenant_private/grace').set({ adminEmails: [ADMIN_EMAIL] });
await db.doc('tenants/rival').set({ name: 'Rival Chapel', subdomain: 'rival', plan: 'max', status: 'active', ownerId: 'someone-else', setupCompleted: true, config: { name: 'Rival Chapel' }, createdAt: iso(400), updatedAt: iso(1) });
await db.doc('tenant_private/rival').set({ adminEmails: ['pastor@rival.example.org'] });

await db.doc(`users/${adminUid}`).set({ email: ADMIN_EMAIL, displayName: 'Ruth Admin', role: 'admin', tenantId: 'grace', permissions: { fullAccess: true }, onboardingCompleted: true, country: 'RO', createdAt: iso(400) });
// A staff admin who can run events and forms but has no CRM, Notes or Courses access.
await db.doc(`users/${staffUid}`).set({ email: STAFF_EMAIL, displayName: 'Sam Staff', role: 'admin', tenantId: 'grace', permissions: { manageEvents: true, manageForms: true }, onboardingCompleted: true, country: 'RO', createdAt: iso(300) });

// App members (users) and CRM contacts, all fictional.
const members = [
  ['Maria Ionescu', 'maria.ionescu@grace.example.org', '+40 721 555 014'],
  ['Stefan Popescu', 'stefan.popescu@grace.example.org', '+40 722 555 031'],
  ['Daniel Marin', 'daniel.marin@grace.example.org', ''],
  ['Elena Dumitru', 'elena.dumitru@grace.example.org', '+40 723 555 077'],
];
for (const [i, [name, email, phone]] of members.entries()) {
  await db.doc(`users/member-${i}`).set({ displayName: name, email, phone, role: 'user', tenantId: 'grace', createdAt: iso(200 - i) });
}
const contacts = [
  ['Ștefan', 'Georgescu', 'stefan.georgescu@example.org', '+40 724 555 090', 'donor'],
  ['Anna', 'Whitfield', 'anna.whitfield@example.org', '+1 555 010 2030', 'member'],
  ['Joseph', 'Okafor', 'joseph.okafor@example.org', '', 'both'],
  ['Priya', 'Raman', 'priya.raman@example.org', '+44 20 7946 0958', 'member'],
];
for (const [i, [firstName, lastName, email, phone, type]] of contacts.entries()) {
  await db.doc(`contacts/contact-${i}`).set({ tenantId: 'grace', firstName, lastName, email, phone, type, notes: 'Private pastoral note, never indexed.', tags: [], totalDonated: 0, createdAt: ago(120 - i), updatedAt: ago(10 - i), createdBy: adminUid });
}
await db.doc('contacts/rival-0').set({ tenantId: 'rival', firstName: 'Maria', lastName: 'Ionescu-Rival', email: 'maria@rival.example.org', phone: '', type: 'member', notes: '', totalDonated: 0, createdAt: ago(5), updatedAt: ago(1), createdBy: 'x' });

// Notes (docs) and boards
await db.doc('docFolders/board-1').set({ tenantId: 'grace', name: 'Sunday', parentId: null, createdBy: adminUid, order: 1, createdAt: ago(100) });
const notes = [
  ['Sunday sermon outline: grace and works', '<h2>Grace and works</h2><p>Opening reading from Ephesians, then three points on how grace changes what we do.</p>'],
  ['Volunteer rota guidelines', '<p>How we schedule greeters, the sound desk and children\'s helpers each month.</p>'],
  ['Sermon series planning 2027', '<p>Draft themes for the next four sermon series, with reading plans.</p>'],
  ['Prayer team handbook', '<p>Confidentiality, follow-up and when to refer to a pastor.</p>'],
  ['Welcome team checklist', '<p>Doors open at nine. Name badges, the welcome desk and first-time guest cards.</p>'],
];
for (const [i, [title, content]] of notes.entries()) {
  await db.doc(`docs/note-${i}`).set({ tenantId: 'grace', title, content, folderId: 'board-1', createdBy: adminUid, createdAt: ago(60 - i), updatedAt: ago(7 - i), isPrivate: true, sharedWith: [] });
}
await db.doc('docs/rival-note').set({ tenantId: 'rival', title: 'Sunday sermon outline (Rival Chapel)', content: '<p>not yours</p>', folderId: null, createdBy: 'x', createdAt: ago(3), updatedAt: ago(1), isPrivate: true, sharedWith: [] });

// Courses
const lesson = (id, title) => ({ id, title, duration: '10:00', authorId: '', summary: '' });
await db.doc('courses/course-1').set({
  tenantId: 'grace', title: 'Foundations of Faith', status: 'published', tagline: 'Six weeks for new believers', author: 'Ruth Admin',
  levels: [{ id: 'l1', title: 'Level 1', sections: [{ id: 's1', title: 'Beginnings', lessons: [lesson('a', 'What is the gospel?'), lesson('b', 'Grace and works'), lesson('c', 'Prayer basics')] }] }],
  createdAt: iso(90), updatedAt: iso(9),
});
await db.doc('courses/course-2').set({
  tenantId: 'grace', title: 'Leading a Small Group', status: 'draft',
  levels: [{ id: 'l1', title: 'Level 1', sections: [{ id: 's1', title: 'Basics', lessons: [lesson('d', 'Hosting your first meeting')] }] }],
  createdAt: iso(40), updatedAt: iso(3),
});
await db.doc('courses/rival-course').set({ tenantId: 'rival', title: 'Foundations of Rival Faith', status: 'published', levels: [], createdAt: iso(5), updatedAt: iso(1) });

// Events, forms, services, blog, campaigns, campuses, community, check-in, knowledge
await db.doc('tenants/grace/events/event-1').set({ tenantId: 'grace', title: 'Easter Sunday Celebration', description: 'Join us for worship.', location: 'Main Sanctuary', startDate: Timestamp.fromMillis(now + 40 * 86400000), status: 'published', createdAt: ago(20), createdBy: adminUid });
await db.doc('tenants/grace/events/event-2').set({ tenantId: 'grace', title: 'Youth Night', description: '', location: 'Annex', startDate: Timestamp.fromMillis(now + 6 * 86400000), status: 'published', createdAt: ago(10), createdBy: adminUid });
await db.doc('tenants/grace/forms/form-1').set({ title: 'Volunteer sign-up', description: 'Tell us where you would like to serve.', fields: [], active: true, submissionCount: 0, createdAt: ago(30), createdBy: adminUid });
await db.doc('tenants/grace/servicePlans/plan-1').set({ tenantId: 'grace', eventId: null, name: 'Sunday Morning', isTemplate: true, items: [], startAt: null, createdAt: ago(80) });
await db.doc('blog_posts/post-1').set({ tenantId: 'grace', title: 'Five ways to pray when you are tired', category: 'Prayer', status: 'published', tags: ['prayer'], content: '<p>…</p>', authorId: adminUid, createdAt: iso(25), updatedAt: iso(20) });
await db.doc('campaigns/campaign-1').set({ tenantId: 'grace', title: 'New roof for the hall', description: 'Help us replace the roof.', goal: 20000, raised: 4500, isActive: true, campaignType: 'fundraising', createdAt: ago(45) });
await db.doc('churches/campus-1').set({ tenantId: 'grace', name: 'Grace Fellowship North Campus', city: 'Cluj-Napoca', country: 'Romania', status: 'active', createdAt: iso(200) });
await db.doc('tenants/grace/channels/channel-1').set({ name: 'Worship team', description: 'Rehearsals and set lists', type: 'announcement', members: [adminUid], createdBy: adminUid, createdAt: ago(100) });
await db.doc('tenants/grace/checkinSessions/session-1').set({ name: 'Sunday service check-in', date: iso(3), location: 'Lobby', status: 'active', attendeeCount: 0, createdAt: ago(3), createdBy: adminUid });
await db.doc('rag_sources/source-1').set({ tenantId: 'grace', title: 'Statement of faith.pdf', type: 'pdf', status: 'ready', chunks: 12, addedAt: ago(70) });

console.log(JSON.stringify({ adminUid, staffUid, adminEmail: ADMIN_EMAIL, staffEmail: STAFF_EMAIL, password: ADMIN_PASSWORD }));
