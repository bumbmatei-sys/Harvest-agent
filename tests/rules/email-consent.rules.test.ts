import { describe, it, beforeAll, afterAll } from 'vitest';
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  getEnv, seedBase, seedDoc, teardownEnv,
  owner, superAdmin, adminB, member,
  TENANT_A,
} from './helpers';

/**
 * Email-list consent lives on the CRM contact and is written only by the
 * server. A client CRM admin keeps every other contact write, but cannot set or
 * change the email consent keys, so nobody can re-subscribe a person who
 * unsubscribed, and the newsletter's broadcasts/settings/usage under
 * tenants/{id}/email* are not reachable from a browser at all.
 */

const CONTACT = 'contact-email-1';
const base = { tenantId: TENANT_A, firstName: 'Ruth', lastName: 'Lee', email: 'ruth@test.com', type: 'member' };
const KEYS = ['emailStatus', 'emailOptInAt', 'emailOptInSource', 'emailUnsubscribedAt', 'emailUnsubscribedFrom'] as const;

beforeAll(async () => {
  await getEnv();
  await seedBase();
  await seedDoc(`contacts/${CONTACT}`, { ...base, emailStatus: 'unsubscribed', emailUnsubscribedAt: '2031-01-01T00:00:00.000Z' });
  await seedDoc(`contacts/plain-1`, { ...base, email: 'plain@test.com' });
  await seedDoc(`tenants/${TENANT_A}/emailBroadcasts/b1`, { subject: 'Hi', tenantId: TENANT_A });
});

afterAll(async () => {
  await teardownEnv();
});

describe('contacts: email consent keys are server-only', () => {
  it('a CRM admin can still create and edit an ordinary contact', async () => {
    const db = (await owner()).firestore();
    await assertSucceeds(db.doc('contacts/new-ordinary').set({ ...base, email: 'new@test.com' }));
    await assertSucceeds(db.doc('contacts/plain-1').update({ notes: 'called' }));
    await assertSucceeds(db.doc('contacts/plain-1').set({ tags: ['youth'] }, { merge: true }));
  });

  it.each(KEYS)('a client cannot create a contact carrying %s', async (key) => {
    const db = (await owner()).firestore();
    await assertFails(db.doc(`contacts/forge-${key}`).set({ ...base, [key]: 'subscribed' }));
  });

  it('a client cannot re-subscribe someone who unsubscribed', async () => {
    const db = (await owner()).firestore();
    await assertFails(db.doc(`contacts/${CONTACT}`).update({ emailStatus: 'subscribed' }));
    await assertFails(db.doc(`contacts/${CONTACT}`).set({ emailStatus: 'subscribed' }, { merge: true }));
  });

  it.each(KEYS)('a client cannot add %s to an existing contact', async (key) => {
    const db = (await owner()).firestore();
    await assertFails(db.doc('contacts/plain-1').update({ [key]: 'x' }));
  });

  it('not even a super admin client can; only the Admin SDK writes these keys', async () => {
    const db = (await superAdmin()).firestore();
    await assertFails(db.doc(`contacts/${CONTACT}`).update({ emailStatus: 'subscribed' }));
  });

  it('editing other fields on an unsubscribed contact keeps working', async () => {
    const db = (await owner()).firestore();
    await assertSucceeds(db.doc(`contacts/${CONTACT}`).update({ phone: '555-0100' }));
  });

  it('another ministry admin and a member still cannot read or write contacts', async () => {
    await assertFails((await adminB()).firestore().doc(`contacts/${CONTACT}`).get());
    await assertFails((await member()).firestore().doc(`contacts/${CONTACT}`).get());
  });
});

describe('tenants/{id}/email* is closed to clients', () => {
  it.each(['emailBroadcasts/b1', 'emailConfig/settings', 'emailUsage/2031-03'])('%s: no read or write, even for the owner', async (path) => {
    const db = (await owner()).firestore();
    await assertFails(db.doc(`tenants/${TENANT_A}/${path}`).get());
    await assertFails(db.doc(`tenants/${TENANT_A}/${path}`).set({ sent: 0 }));
  });

  it('the server-only scheduled queue and confirm tokens are closed', async () => {
    const db = (await owner()).firestore();
    await assertFails(db.doc('email_scheduled/x').get());
    await assertFails(db.doc('email_confirm_tokens/x').set({ consumed: false }));
  });
});
