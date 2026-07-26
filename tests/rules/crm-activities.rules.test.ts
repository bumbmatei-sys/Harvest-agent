import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertSucceeds } from '@firebase/rules-unit-testing';
import {
  seedBase, seedDoc, teardownEnv,
  owner, adminB,
  TENANT_A, TENANT_B,
} from './helpers';

/**
 * Why the CRM activity timeline was always empty.
 *
 * `useContactActivities` ran a SINGLE-field query — `where('contactId','==',id)`
 * — and filtered `tenantId` in memory, which is the house pattern for avoiding
 * composite indexes. But the top-level `contactActivities` read rule is
 *
 *     allow read: if isAuthenticated() && isTenantAdmin(resource.data.get('tenantId',''))
 *
 * and rules are NOT filters: for a `list`, Firestore evaluates the rule against
 * the query's POTENTIAL result set, not the documents that happen to match. A
 * query that constrains only `contactId` cannot prove anything about
 * `resource.data.tenantId`, so the whole query is rejected — even though every
 * document it would have returned is individually readable by the caller.
 *
 * These tests pin that down: the same document reads fine by `get()`, the same
 * query passes once `tenantId` is constrained, and only the shape the app
 * actually shipped fails. They are the regression guard for the server-side
 * read route that replaced the client query (`/api/crm/contact-activities`) —
 * if someone moves the read back onto the client, the first case here fails.
 */

const CONTACT_A = 'contact-a-1';

beforeAll(async () => {
  await seedBase();
  // Five activities on one tenant-a contact — the production shape that showed
  // as "No activities recorded yet".
  for (let i = 1; i <= 5; i++) {
    await seedDoc(`contactActivities/act-a-${i}`, {
      contactId: CONTACT_A, tenantId: TENANT_A, type: 'note',
      description: `activity ${i}`, amount: null, createdBy: 'someone',
    });
  }
  await seedDoc(`contactActivities/act-b-1`, {
    contactId: 'contact-b-1', tenantId: TENANT_B, type: 'note',
    description: 'other tenant', amount: null, createdBy: 'someone',
  });
  await seedDoc(`contacts/${CONTACT_A}`, {
    tenantId: TENANT_A, firstName: 'Test', lastName: 'Contact', email: 't@test.com', type: 'member',
  });
});

afterAll(async () => {
  await teardownEnv();
});

describe('contactActivities: the client query the CRM used to run', () => {
  it('is rejected with permission-denied — this is the invisible bug', async () => {
    const db = (await owner()).firestore();
    let code: string | undefined;
    let message = '';
    try {
      await db.collection('contactActivities')
        .where('contactId', '==', CONTACT_A)
        .limit(200)
        .get();
    } catch (e) {
      code = (e as { code?: string }).code;
      message = (e as Error).message;
    }
    expect(code).toBe('permission-denied');
    // Production reports the terse "Missing or insufficient permissions."; the
    // emulator names the operation and the rule line it died on. Assert on the
    // operation, which both agree about — it is a `list` that fails, not a get.
    expect(message).toMatch(/'list'/);
  });

  it('is not a data problem: the same documents read fine one at a time', async () => {
    const db = (await owner()).firestore();
    for (let i = 1; i <= 5; i++) {
      await assertSucceeds(db.doc(`contactActivities/act-a-${i}`).get());
    }
  });

  it('passes only once tenantId is constrained IN the query (the composite-index route)', async () => {
    const db = (await owner()).firestore();
    const snap = await assertSucceeds(
      db.collection('contactActivities')
        .where('contactId', '==', CONTACT_A)
        .where('tenantId', '==', TENANT_A)
        .limit(200)
        .get(),
    );
    expect((snap as { size: number }).size).toBe(5);
  });

  it('never lets another tenant\'s admin read the documents, by any query shape', async () => {
    const db = (await adminB()).firestore();
    let code: string | undefined;
    try {
      await db.collection('contactActivities')
        .where('contactId', '==', CONTACT_A)
        .where('tenantId', '==', TENANT_A)
        .limit(200)
        .get();
    } catch (e) {
      code = (e as { code?: string }).code;
    }
    expect(code).toBe('permission-denied');
  });
});

describe('contactActivities: sibling CRM reads under the same rule', () => {
  it('the contacts list query IS tenant-constrained, so it is allowed', async () => {
    // useContactsWithUsers' tenant branch: where('tenantId','==',tenantId).
    const db = (await owner()).firestore();
    const snap = await assertSucceeds(
      db.collection('contacts').where('tenantId', '==', TENANT_A).limit(500).get(),
    );
    expect((snap as { size: number }).size).toBeGreaterThan(0);
  });

  it('an UNSCOPED contacts list is rejected the same way (super-admin/platform branch)', async () => {
    // useContactsWithUsers' platform branch runs collection('contacts').limit(1000)
    // with no where() at all. A tenant admin hitting that branch gets the same
    // permission-denied — it only works because a super admin passes
    // isTenantAdmin() unconditionally.
    const db = (await owner()).firestore();
    let code: string | undefined;
    try {
      await db.collection('contacts').limit(1000).get();
    } catch (e) {
      code = (e as { code?: string }).code;
    }
    expect(code).toBe('permission-denied');
  });
});
