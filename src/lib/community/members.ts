/**
 * #576: one row of a community's member list. Only what a member already shows
 * other members on their posts leaves the server: a name and a photo. An email
 * used as a display name is never shown.
 */
export const MEMBER_LIST_LIMIT = 500;

export type MemberListEntry = { uid: string; name: string; photoURL: string; joinedAt: number | null };

const millis = (value: unknown): number | null => {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === 'function') return (value as { toMillis: () => number }).toMillis();
  return null;
};

function safePhoto(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? value : ''; } catch { return ''; }
}

export function memberListEntry(uid: string, member: Record<string, unknown> | undefined, profile: Record<string, unknown> | undefined): MemberListEntry {
  const raw = typeof profile?.displayName === 'string' ? profile.displayName.trim() : '';
  return {
    uid,
    name: raw && !raw.includes('@') ? raw.slice(0, 120) : 'Member',
    photoURL: safePhoto(profile?.photoURL),
    joinedAt: millis(member?.joinedAt),
  };
}
