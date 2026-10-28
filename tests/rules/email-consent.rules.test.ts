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
const KEYS = ['emailStatus', 'emailOptInAt', 'emailOptInSource', 'emailUnsubscribedAt', 'emailUnsubscribedFrom', 'emailSuppressedAt'] as const;

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
  it.each(['emailBroadcasts/b1', 'emailConfig/settings', 'emailConfig/sending', 'emailConfig/themes', 'emailUsage/2031-03', 'emailUsage/2031-03-10'])('%s: no read or write, even for the owner', async (path) => {
    const db = (await owner()).firestore();
    await assertFails(db.doc(`tenants/${TENANT_A}/${path}`).get());
    await assertFails(db.doc(`tenants/${TENANT_A}/${path}`).set({ sent: 0 }));
  });

  it('the saved themes under emailConfig/themes are browser-dead: no read, no write, no subdocument', async () => {
    for (const ctx of [await owner(), await superAdmin()]) {
      const db = ctx.firestore();
      for (const path of [`tenants/${TENANT_A}/emailConfig/themes`, `tenants/${TENANT_A}/emailConfig/themes/t1`]) {
        await assertFails(db.doc(path).get());
        await assertFails(db.doc(path).set({ name: 'Sunday letter' }));
        await assertFails(db.doc(path).delete());
      }
    }
  });

  it('the server-only scheduled queue and confirm tokens are closed', async () => {
    const db = (await owner()).firestore();
    await assertFails(db.doc('email_scheduled/x').get());
    await assertFails(db.doc('email_confirm_tokens/x').set({ consumed: false }));
  });

  it('the send-in-flight markers, domain claims and suppression records are closed, even to the owner and a super admin', async () => {
    for (const ctx of [await owner(), await superAdmin()]) {
      const db = ctx.firestore();
      for (const path of ['email_sending/x', 'email_domains/gracechurch.org', `tenants/${TENANT_A}/emailSuppressions/x`]) {
        await assertFails(db.doc(path).get());
        await assertFails(db.doc(path).set({ tenantId: TENANT_A }));
      }
    }
  });

  it('the webhook dedupe records are closed too, and so is a released-domain placeholder', async () => {
    for (const ctx of [await owner(), await superAdmin()]) {
      const db = ctx.firestore();
      for (const path of [`email_feedback_events/${TENANT_A}__bounced:em_1`, 'email_domains/released.example.org']) {
        await assertFails(db.doc(path).get());
        await assertFails(db.doc(path).set({ tenantId: null, releasedBy: TENANT_A }));
        await assertFails(db.doc(path).delete());
      }
    }
  });

  it('the platform limits document is closed to clients, even to a super admin', async () => {
    for (const ctx of [await owner(), await superAdmin()]) {
      const db = ctx.firestore();
      await assertFails(db.doc('platform_config/email_limits').get());
      await assertFails(db.doc('platform_config/email_limits').set({ warnAtPercent: 1 }));
    }
  });
});
