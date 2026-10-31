import { describe, expect, it } from 'vitest';
import { memberListEntry } from './members';

describe('a member list row (#576)', () => {
  it('shows a name and a photo, never an email used as a name', () => {
    const joinedAt = { toMillis: () => 1000 };
    expect(memberListEntry('u', { joinedAt, status: 'active', consentScope: 'x' }, { displayName: ' Ana ', photoURL: 'https://cdn.test/a.png', email: 'ana@test.com' }))
      .toEqual({ uid: 'u', name: 'Ana', photoURL: 'https://cdn.test/a.png', joinedAt: 1000 });
    expect(memberListEntry('u', {}, { displayName: 'ana@test.com' }).name).toBe('Member');
    expect(memberListEntry('u', undefined, undefined)).toEqual({ uid: 'u', name: 'Member', photoURL: '', joinedAt: null });
  });
  it('drops a photo that is not a plain https URL', () => {
    for (const photoURL of ['http://cdn.test/a.png', 'https://user:pw@cdn.test/a.png', 'javascript:alert(1)', 7]) {
      expect(memberListEntry('u', {}, { displayName: 'Ana', photoURL }).photoURL).toBe('');
    }
  });
});
