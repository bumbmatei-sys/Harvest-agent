import { authFetch } from '@/utils/auth-fetch';

export async function membershipRequest(action: 'join' | 'leave', body: Record<string, unknown>, request: typeof authFetch = authFetch) {
  const response = await request(`/api/community/${action}`, { method: 'POST', body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error(typeof result.error === 'string' ? result.error : 'Could not update community membership. Please try again.');
}
