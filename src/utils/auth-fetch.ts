/**
 * Authenticated fetch helper for client-side API calls.
 * Gets the current user's Firebase ID token and includes it as a Bearer token.
 * This is required for all API routes that use requireAuth().
 *
 * The token refresh happens before `fetch`. An aborted save has to reject
 * that wait too, or the editor stays on "Saving…" until the refresh returns.
 */
function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function untilAbort<T>(work: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const signal = options.signal;
  const { auth } = await untilAbort(import('../firebase'), signal);
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  const token = await untilAbort(user.getIdToken(), signal);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...(options.headers as Record<string, string> || {}),
  };

  return fetch(url, { ...options, headers });
}
