import { authFetch } from '@/utils/auth-fetch';

type CommunityPerson = { id: string; displayName: string; email: string; role: string };
/** Safe server projection includes joined members without granting profile reads.
 * The server returns the complete, uid-sorted union; pickers retain their cap.
 */
export async function loadScopedUserDocs(tenantId: string, includeNull: boolean, max: number): Promise<Array<{ id: string; data: () => Omit<CommunityPerson, 'id'> }>> {
  const response = await authFetch(`/api/community/settings?tenantId=${encodeURIComponent(tenantId)}&includeNull=${includeNull}`);
  if (!response.ok) throw new Error('Could not load community members');
  const body = await response.json();
  if (!Array.isArray(body.people) || body.people.some((person: Partial<CommunityPerson>) =>
    typeof person?.id !== 'string' || typeof person.displayName !== 'string' || typeof person.email !== 'string' || typeof person.role !== 'string')) throw new Error('Invalid community members');
  return body.people.slice(0, max).map((person: CommunityPerson) => {
    const { id, ...profile } = person;
    return { id, data: () => profile };
  });
}
