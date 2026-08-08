import { describe, it, expect, vi } from 'vitest';

// The module under test imports the Firebase client (`../../firebase`). Client
// init is network-free, but stub it so the unit test never touches SDK globals.
vi.mock('../../firebase', () => ({ db: {}, auth: {} }));

import { mergeContactsWithUsers, type Contact } from '../useCRMQueries';

/** Minimal contact factory — only the fields the merge inspects matter. */
const contact = (over: Partial<Contact>): Contact => ({
  id: 'c1', firstName: '', lastName: '', email: '', phone: '',
  type: 'donor', notes: '', totalDonated: 0,
  lastDonationAt: null, memberSince: null, createdAt: null,
  createdBy: '', updatedAt: null, tenantId: 'bumb',
  ...over,
});

const userRow = (id: string, data: Record<string, any>) => ({ id, data });

describe('mergeContactsWithUsers — stable contact identity', () => {
  it('folds a person present in BOTH collections into ONE row keyed by the contacts id', () => {
    // Miriam: a contacts doc linked to her users doc via `userId`.
    const contacts = [
      contact({ id: 'BKzF9ezNrItiLn9wjEEc', email: 'miriambumb@yahoo.com', userId: 'oTIifHUq6fNoJBc1uCKxq9e2GPt2', lastName: 'Bumb' }),
    ];
    const users = [
      userRow('oTIifHUq6fNoJBc1uCKxq9e2GPt2', { email: 'miriambumb@yahoo.com', displayName: 'Miriam Bumb', tenantId: 'bumb' }),
    ];

    const merged = mergeContactsWithUsers(contacts, users, 'bumb');

    const rows = merged.filter(r => r.email.toLowerCase() === 'miriambumb@yahoo.com');
    expect(rows).toHaveLength(1);
    // The surviving id is the contacts id — the same id her activities are keyed
    // under — so read (useContactActivities) and write (addActivity) agree.
    expect(rows[0].id).toBe('BKzF9ezNrItiLn9wjEEc');
  });

  it('write-then-read agree: selected.id from the merged list matches the write key', () => {
    const contacts = [contact({ id: 'contact-1', email: 'a@x.com', userId: 'uid-1' })];
    const users = [userRow('uid-1', { email: 'a@x.com', displayName: 'A' })];

    const merged = mergeContactsWithUsers(contacts, users, 'bumb');
    const selected = merged.find(r => r.email === 'a@x.com')!;

    // addActivity writes `contactId: selected.id`; useContactActivities reads
    // where('contactId','==', selected.id). Same value ⇒ the activity is found.
    const writeKey = selected.id;
    const readKey = selected.id;
    expect(writeKey).toBe('contact-1');
    expect(readKey).toBe(writeKey);
  });

  it('still folds when the two docs differ only by email casing/whitespace (userId link)', () => {
    const contacts = [contact({ id: 'contact-1', email: '  Miriambumb@Yahoo.com ', userId: 'uid-1' })];
    const users = [userRow('uid-1', { email: 'miriambumb@yahoo.com', displayName: 'M' })];

    const merged = mergeContactsWithUsers(contacts, users, 'bumb');
    // One row, keyed by the contacts id — the whitespace/casing no longer splits.
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('contact-1');
  });

  it('folds by normalized email alone when no userId link exists (legacy contacts)', () => {
    const contacts = [contact({ id: 'contact-1', email: 'Miriambumb@yahoo.com ' /* trailing space, no userId */ })];
    const users = [userRow('uid-1', { email: 'miriambumb@yahoo.com', displayName: 'M' })];

    const merged = mergeContactsWithUsers(contacts, users, 'bumb');
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('contact-1');
  });

  it('surfaces a users-only member (no contacts doc) keyed by the users id', () => {
    const contacts: Contact[] = [];
    const users = [userRow('uid-solo', { email: 'solo@x.com', displayName: 'Solo Member', tenantId: 'bumb' })];

    const merged = mergeContactsWithUsers(contacts, users, 'bumb');
    expect(merged).toHaveLength(1);
    // No contacts doc ⇒ keyed by the users id, matching where the webhook writes
    // this member's donation activities.
    expect(merged[0].id).toBe('uid-solo');
    expect(merged[0].type).toBe('member');
  });

  it('does not mutate the caller’s contact rows when stamping `account`', () => {
    // The array handed in is react-query's cached list. Stamping provenance onto
    // it in place would write through to the cache and survive a re-render with
    // stale data.
    const original = contact({ id: 'contact-1', email: 'a@x.com', userId: 'uid-1' });
    const merged = mergeContactsWithUsers([original], [userRow('uid-1', { email: 'a@x.com' })], 'bumb');

    expect(original.account).toBeUndefined();
    expect(merged[0].account).toEqual({ role: '', email: 'a@x.com' });
  });

  it('keeps distinct people separate (no over-folding)', () => {
    const contacts = [contact({ id: 'contact-1', email: 'a@x.com', userId: 'uid-a' })];
    const users = [
      userRow('uid-a', { email: 'a@x.com' }),          // folded
      userRow('uid-b', { email: 'b@x.com' }),          // distinct → surfaced
    ];

    const merged = mergeContactsWithUsers(contacts, users, 'bumb');
    expect(merged.map(r => r.id).sort()).toEqual(['contact-1', 'uid-b']);
  });
});

/**
 * `Contact.account` — the flag that tells an account-holder from a donor.
 *
 * REP-6's `maxContacts` cap counts ACCOUNTS. Donors who gave through the public
 * donate page have a `contacts` row and no `users` doc; those rows are what
 * giving statements and year-end tax receipts are built from, so they must stay
 * visible AND stay uncounted. `account` is the only thing distinguishing the two
 * once the merge has flattened them into one list — see
 * src/utils/contact-capacity.ts.
 */
describe('mergeContactsWithUsers — who holds an account', () => {
  it('stamps `account` on a users-only member', () => {
    const merged = mergeContactsWithUsers(
      [],
      [userRow('uid-1', { email: 'Member@Church.org', displayName: 'A Member', role: 'user' })],
      'bumb',
    );
    expect(merged[0].account).toEqual({ role: 'user', email: 'Member@Church.org' });
  });

  it('stamps `account` on a contact row that folded a users doc (by userId link)', () => {
    const merged = mergeContactsWithUsers(
      [contact({ id: 'contact-1', email: 'a@x.com', userId: 'uid-1' })],
      [userRow('uid-1', { email: 'a@x.com', role: 'admin' })],
      'bumb',
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('contact-1');   // identity is unchanged…
    expect(merged[0].account).toEqual({ role: 'admin', email: 'a@x.com' });
  });

  it('stamps `account` on a contact row that folded a users doc (by email)', () => {
    const merged = mergeContactsWithUsers(
      [contact({ id: 'contact-1', email: ' Miriambumb@Yahoo.com ' /* no userId */ })],
      [userRow('uid-1', { email: 'miriambumb@yahoo.com', role: 'user' })],
      'bumb',
    );
    expect(merged).toHaveLength(1);
    // The `users` email is carried, not the contact's — the super-admin check
    // must run against the authoritative one, not a mis-cased duplicate.
    expect(merged[0].account).toEqual({ role: 'user', email: 'miriambumb@yahoo.com' });
  });

  it('leaves a donor-only contact row WITHOUT an account — they gave, they never signed up', () => {
    const merged = mergeContactsWithUsers(
      [contact({ id: 'donor-1', email: 'gave-once@example.org', type: 'donor', totalDonated: 250 })],
      [],
      'bumb',
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].account).toBeUndefined();
    // …and they are still in the list. Hiding them would break giving statements.
    expect(merged[0].id).toBe('donor-1');
  });

  it('leaves an unmatched contact row without an account even when other members exist', () => {
    const merged = mergeContactsWithUsers(
      [contact({ id: 'donor-1', email: 'donor@example.org', type: 'donor' })],
      [userRow('uid-1', { email: 'member@church.org' })],
      'bumb',
    );
    const donor = merged.find(r => r.id === 'donor-1')!;
    const member = merged.find(r => r.id === 'uid-1')!;
    expect(donor.account).toBeUndefined();
    expect(member.account).toBeDefined();
  });

  it('carries a missing `role` as an empty string rather than dropping the flag', () => {
    // Legacy `users` docs predate the role field. They still hold an account.
    const merged = mergeContactsWithUsers([], [userRow('uid-1', { email: 'legacy@church.org' })], 'bumb');
    expect(merged[0].account).toEqual({ role: '', email: 'legacy@church.org' });
  });
});
