import { describe, it, beforeEach, afterAll } from 'vitest';
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  seedBase, seedDoc, teardownEnv,
  superAdmin, member, member2,
  MEMBER_UID, MEMBER2_UID,
} from './helpers';

/**
 * certificates/{uid}_{courseId}: a learner may read ONLY their own cert (the
 * server-written `uid` field must equal their uid); all writes are server-only
 * (Admin SDK). This is the trust boundary that keeps certs un-forgeable and
 * non-enumerable across learners.
 */

const OWN_CERT = `certificates/${MEMBER_UID}_course1`;

beforeEach(async () => {
  await seedBase();
  await seedDoc(OWN_CERT, {
    uid: MEMBER_UID, courseId: 'course1', courseTitle: 'Foundations',
    certNumber: 'HC-ABC1234', issuedAt: '2026-01-01T00:00:00.000Z',
  });
});

afterAll(async () => {
  await teardownEnv();
});

describe('certificates: owner-read', () => {
  it('a learner can read their OWN certificate', async () => {
    const db = (await member()).firestore();
    await assertSucceeds(db.doc(OWN_CERT).get());
  });

  it("a learner CANNOT read another learner's certificate", async () => {
    const db = (await member2()).firestore();
    await assertFails(db.doc(OWN_CERT).get());
  });

  it('a super admin can read any certificate', async () => {
    const db = (await superAdmin()).firestore();
    await assertSucceeds(db.doc(OWN_CERT).get());
  });
});

describe('certificates: server-only writes', () => {
  it('the owner cannot create a certificate from the client', async () => {
    const db = (await member()).firestore();
    await assertFails(db.doc(`certificates/${MEMBER_UID}_course2`).set({ uid: MEMBER_UID, courseId: 'course2' }));
  });

  it('the owner cannot update their own certificate', async () => {
    const db = (await member()).firestore();
    await assertFails(db.doc(OWN_CERT).update({ courseTitle: 'Forged Mastery' }));
  });

  it('the owner cannot delete their own certificate', async () => {
    const db = (await member()).firestore();
    await assertFails(db.doc(OWN_CERT).delete());
  });

  it('a different learner cannot forge a certificate keyed to someone else', async () => {
    const db = (await member2()).firestore();
    await assertFails(db.doc(`certificates/${MEMBER2_UID}_course1`).set({ uid: MEMBER2_UID, courseId: 'course1' }));
  });
});
