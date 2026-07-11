import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  getEnv, seedBase, seedDoc, teardownEnv,
  member, member2, superAdmin,
  MEMBER_UID, MEMBER2_UID,
} from './helpers';

/**
 * certificates/{uid}_{courseId} is a server-owned TRUST ARTIFACT.
 *
 *  - A learner may READ only their OWN certificate (doc.uid == their uid).
 *  - NOBODY may write from a client — issuance is Admin-SDK-only
 *    (/api/certificate independently recomputes completion first). A client
 *    that could forge this doc could forge "I completed the course."
 */

const CERT_A = `${MEMBER_UID}_course-1`;      // belongs to MEMBER_UID
const CERT_B = `${MEMBER2_UID}_course-1`;     // belongs to MEMBER2_UID

beforeAll(seedBase);
afterAll(teardownEnv);

beforeEach(async () => {
  await seedBase();
  // Two pre-issued certs (written rules-bypassing, as the Admin SDK would).
  await seedDoc(`certificates/${CERT_A}`, {
    uid: MEMBER_UID, courseId: 'course-1', courseTitle: 'Foundations',
    certNumber: 'ABC123DEF456', tenantId: 'tenant-a', issuedAt: '2026-01-01T00:00:00.000Z',
  });
  await seedDoc(`certificates/${CERT_B}`, {
    uid: MEMBER2_UID, courseId: 'course-1', courseTitle: 'Foundations',
    certNumber: 'ZZZ999YYY888', tenantId: 'tenant-a', issuedAt: '2026-01-01T00:00:00.000Z',
  });
});

describe('certificates — owner read', () => {
  it('a learner can READ their own certificate', async () => {
    const db = (await member()).firestore();
    await assertSucceeds(db.doc(`certificates/${CERT_A}`).get());
  });

  it('a learner CANNOT read another user\'s certificate', async () => {
    const db = (await member()).firestore();
    await assertFails(db.doc(`certificates/${CERT_B}`).get());
  });

  it('an unauthenticated client cannot read a certificate', async () => {
    const e = await getEnv();
    const db = e.unauthenticatedContext().firestore();
    await assertFails(db.doc(`certificates/${CERT_A}`).get());
  });
});

describe('certificates — server-only write (no client can forge)', () => {
  it('the owner CANNOT create their own certificate from a client', async () => {
    const db = (await member()).firestore();
    await assertFails(db.doc(`certificates/${MEMBER_UID}_course-2`).set({
      uid: MEMBER_UID, courseId: 'course-2', courseTitle: 'Forged', certNumber: 'HACKED0000', tenantId: 'tenant-a',
    }));
  });

  it('the owner CANNOT update their own certificate from a client', async () => {
    const db = (await member()).firestore();
    await assertFails(db.doc(`certificates/${CERT_A}`).update({ courseTitle: 'Tampered' }));
  });

  it('the owner CANNOT delete their own certificate from a client', async () => {
    const db = (await member()).firestore();
    await assertFails(db.doc(`certificates/${CERT_A}`).delete());
  });

  it('a user cannot forge a certificate carrying ANOTHER user\'s uid', async () => {
    const db = (await member2()).firestore();
    await assertFails(db.doc(`certificates/${MEMBER_UID}_course-9`).set({
      uid: MEMBER_UID, courseId: 'course-9', courseTitle: 'Forged', certNumber: 'FORGED0000', tenantId: 'tenant-a',
    }));
  });

  it('even a super admin cannot write certificates from a client (Admin SDK only)', async () => {
    const db = (await superAdmin()).firestore();
    await assertFails(db.doc(`certificates/${MEMBER_UID}_course-3`).set({
      uid: MEMBER_UID, courseId: 'course-3', courseTitle: 'Nope', certNumber: 'SUPER00000', tenantId: 'tenant-a',
    }));
  });
});
