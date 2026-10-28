import { describe, expect, it } from 'vitest';
import { buildCommunityMember, isActiveMember, isCommunityTenantId, normaliseSource } from './community-membership';

describe('community membership model', () => {
  it.each(['discover', 'link', 'website'] as const)('preserves the declared %s source', source => {
    expect(normaliseSource(source)).toBe(source);
  });
  it.each([undefined, null, '', 'Discover', ' link ', 'admin', 1])('rejects undeclared source %s', source => {
    expect(() => normaliseSource(source)).toThrow();
  });
  it.each(['tenant-a', 'free_123', 'A123'])('accepts an opaque tenant id %s', id => {
    expect(isCommunityTenantId(id)).toBe(true);
  });
  it.each(['', '.', '..', 'a/b', ' a', 'a.b', 'a'.repeat(129), null])('rejects invalid tenant id %s', id => {
    expect(isCommunityTenantId(id)).toBe(false);
  });
  it('recognises active membership across communities without a primary tenant match', () => {
    expect(isActiveMember({ status: 'active' }, { tenantId: 'other' }, 'target')).toBe(true);
    expect(isActiveMember({ status: 'active' }, null, 'target')).toBe(true);
  });
  it('permits legacy membership only with an actual user-doc tenant match', () => {
    expect(isActiveMember({}, { tenantId: 'target' }, 'target')).toBe(true);
    expect(isActiveMember(null, { tenantId: 'target' }, 'target')).toBe(true);
    expect(isActiveMember({}, { tenantId: 'other' }, 'target')).toBe(false);
    expect(isActiveMember({}, null, 'target')).toBe(false);
  });
  it.each(['left', null, 'invalid'])('does not resurrect explicit status %s from legacy membership', status => {
    expect(isActiveMember({ status }, { tenantId: 'target' }, 'target')).toBe(false);
  });
  it('builds a complete member with supplied server time and consent', () => {
    expect(buildCommunityMember({ uid: 'u', tenantId: 't', source: 'website', now: 'server-time', rulesAcceptedVersion: 2, answers: { q: 'Yes' } })).toEqual({
      uid: 'u', tenantId: 't', source: 'website', status: 'active', joinedAt: 'server-time',
      leftAt: null, consentAt: 'server-time', updatedAt: 'server-time',
      rulesAcceptedVersion: 2, answers: { q: 'Yes' }, answeredAt: 'server-time',
    });
  });
  it('rejoins with new membership timestamps while retaining prior onboarding', () => {
    const previous = buildCommunityMember({ uid: 'u', tenantId: 't', source: 'link', now: 'old', answers: { q: 'yes' }, rulesAcceptedVersion: 3 });
    const next = buildCommunityMember({ uid: 'u', tenantId: 't', source: 'discover', now: 'new', previous: { ...previous, status: 'left', leftAt: 'left' } });
    expect(next).toMatchObject({ source: 'discover', status: 'active', joinedAt: 'new', leftAt: null, consentAt: 'new', updatedAt: 'new', answers: { q: 'yes' }, answeredAt: 'old', rulesAcceptedVersion: 3 });
    expect(previous.joinedAt).toBe('old');
  });
  it('keeps missing onboarding answers pending for the existing entry flow', () => {
    const member = buildCommunityMember({ uid: 'u', tenantId: 't', source: 'link', now: 'now' });
    expect(member.answers).toEqual({ __community_questions_pending__: 'true' });
    expect(member.rulesAcceptedVersion).toBe(0);
  });
});
