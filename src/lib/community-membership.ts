/** Flat membership records; timestamps are supplied by the server, never the browser. */
export const COMMUNITY_SOURCES = ['discover', 'link', 'website'] as const;
export type CommunitySource = typeof COMMUNITY_SOURCES[number];
export type MembershipStatus = 'active' | 'left';

export type CommunityMember<T = unknown> = {
  uid: string;
  tenantId: string;
  status: MembershipStatus;
  source: CommunitySource;
  joinedAt: T;
  leftAt: T | null;
  consentAt: T;
  updatedAt: T;
  rulesAcceptedVersion: number;
  answers: Record<string, string>;
  answeredAt: T;
};

/** Server-maintained index at users/{uid}/memberships/{tenantId}. */
export type UserMembership<T = unknown> = {
  tenantId: string;
  status: MembershipStatus;
  // null means the historical join time was never recorded (legacy leave).
  joinedAt: T | null;
  leftAt: T | null;
};

export function normaliseSource(source: unknown): CommunitySource {
  if (!COMMUNITY_SOURCES.includes(source as CommunitySource)) throw new Error('Invalid community source.');
  return source as CommunitySource;
}

export function isCommunityTenantId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}

/** An explicit leave overrides legacy membership, including a stale tenant claim. */
export function isActiveMember(
  member: { status?: unknown } | null | undefined,
  user: { tenantId?: unknown } | null | undefined,
  tenantId: string,
): boolean {
  if (member?.status !== undefined) return member.status === 'active';
  return user?.tenantId === tenantId;
}

export function buildCommunityMember<T>(input: {
  uid: string; tenantId: string; source: CommunitySource; now: T;
  rulesAcceptedVersion?: number; answers?: Record<string, string>;
  previous?: Partial<CommunityMember<T>>;
}): CommunityMember<T> {
  const { uid, tenantId, source, now, previous, answers, rulesAcceptedVersion } = input;
  return {
    uid, tenantId, status: 'active', source: normaliseSource(source),
    joinedAt: now, leftAt: null, consentAt: now, updatedAt: now,
    rulesAcceptedVersion: rulesAcceptedVersion ?? previous?.rulesAcceptedVersion ?? 0,
    answers: answers ?? previous?.answers ?? { __community_questions_pending__: 'true' },
    answeredAt: answers !== undefined ? now : previous?.answeredAt ?? now,
  };
}
