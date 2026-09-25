import { describe, it, expect, vi } from 'vitest';

vi.mock('../../firebase', () => ({ db: {}, auth: {} }));

import { mergeContactsWithUsers as mergeFromHook, userDocToMemberContact } from '../../hooks/queries/useCRMQueries';
import { mergeContactsWithUsers, isoTimestamp } from '../crm-merge';
import type { Contact } from '../../hooks/queries/useCRMQueries';

const WHEN = '2020-06-15T08:30:00.000Z';
const when = new Date(WHEN);

const contact = (over: Partial<Contact>): Contact => ({
  id: 'c1', firstName: 'Pat', lastName: 'Donor', email: 'pat@example.com', phone: '',
  type: 'donor', notes: '', totalDonated: 0,
  lastDonationAt: null, memberSince: null, createdAt: null,
  createdBy: '', updatedAt: null, tenantId: 'grace',
  ...over,
});

const userRow = (id: string, data: Record<string, unknown>) => ({ id, data });

describe('isoTimestamp', () => {
  it('normalises an ISO string, a Date, toDate(), and {seconds}', () => {
    expect(isoTimestamp(WHEN)).toBe(WHEN);
    expect(isoTimestamp(when)).toBe(WHEN);
    expect(isoTimestamp({ toDate: () => when })).toBe(WHEN);
    const seconds = Math.floor(when.getTime() / 1000);
    expect(isoTimestamp({ seconds, nanoseconds: 0 })).toBe(new Date(seconds * 1000).toISOString());
    expect(isoTimestamp({ seconds, nanoseconds: 500_000_000 })).toBe(new Date(seconds * 1000 + 500).toISOString());
  });

  it('returns null for anything it cannot read', () => {
    expect(isoTimestamp(undefined)).toBeNull();
    expect(isoTimestamp(null)).toBeNull();
    expect(isoTimestamp('not-a-date')).toBeNull();
    expect(isoTimestamp(1_592_000_000_000)).toBeNull();
    expect(isoTimestamp({ seconds: '1592202600' })).toBeNull();
    expect(isoTimestamp({ nope: true })).toBeNull();
  });
});

describe('mergeContactsWithUsers — accountProfile', () => {
  it('is the same function the CRM hook re-exports', () => {
    expect(mergeFromHook).toBe(mergeContactsWithUsers);
    expect(typeof userDocToMemberContact).toBe('function');
  });

  it('stamps accountProfile on a users-only row and does not read the legacy field', () => {
    const [row] = mergeContactsWithUsers([], [
      userRow('uid-1', {
        email: 'Member@Church.org',
        displayName: 'Ada Member',
        role: 'user',
        createdAt: WHEN,
        newsletter: true,
        newsletterOptInAt: { toDate: () => when },
        newsletterOptInSource: 'signup-email',
      }),
    ], 'grace');

    expect(row.account).toEqual({ role: 'user', email: 'Member@Church.org' });
    expect(row.accountProfile).toEqual({
      createdAt: WHEN,
      newsletterOptIn: null,
      newsletterOptInAt: WHEN,
      newsletterOptInSource: 'signup-email',
    });
    expect(row.accountOnly).toBe(true);
  });

  it('stamps accountProfile from the folded users doc, not from the contact', () => {
    const original = contact({
      id: 'contact-1',
      email: 'ada@example.com',
      userId: 'uid-1',
      firstName: 'Ada',
      lastName: 'Folded',
    });
    (original as Contact & { newsletterOptIn?: boolean }).newsletterOptIn = true;

    const [row] = mergeContactsWithUsers([original], [
      userRow('uid-1', {
        email: 'ada@example.com',
        role: 'admin',
        createdAt: when,
        newsletterOptIn: false,
        newsletterOptInAt: { seconds: Math.floor(when.getTime() / 1000), nanoseconds: 0 },
        newsletterOptInSource: 'signup-google',
        newsletter: true,
      }),
    ], 'grace');

    expect(row.id).toBe('contact-1');
    expect(row.accountOnly).toBeUndefined();
    expect(row.account).toEqual({ role: 'admin', email: 'ada@example.com' });
    expect(row.accountProfile).toEqual({
      createdAt: WHEN,
      newsletterOptIn: false,
      newsletterOptInAt: new Date(Math.floor(when.getTime() / 1000) * 1000).toISOString(),
      newsletterOptInSource: 'signup-google',
    });
    expect(original.accountProfile).toBeUndefined();
    expect(original.account).toBeUndefined();
  });

  it('leaves a donor-only row without an account or an accountProfile', () => {
    const [row] = mergeContactsWithUsers(
      [contact({ id: 'donor-1', email: 'gave@example.com', type: 'donor' })],
      [],
      'grace',
    );
    expect(row.account).toBeUndefined();
    expect(row.accountProfile).toBeUndefined();
    expect(row.id).toBe('donor-1');
  });
});
