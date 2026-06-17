/**
 * Authenticated fetch helper for client-side API calls.
 * Gets the current user's Firebase ID token and includes it as a Bearer token.
 * This is required for all API routes that use requireAuth().
 */
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const { auth } = await import('../firebase');
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  const token = await user.getIdToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...(options.headers as Record<string, string> || {}),
  };

  return fetch(url, { ...options, headers });
}
