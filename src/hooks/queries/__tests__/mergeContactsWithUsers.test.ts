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
