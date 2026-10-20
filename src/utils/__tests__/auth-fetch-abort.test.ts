import { describe, expect, it, vi } from 'vitest';

const getIdToken = vi.hoisted(() => vi.fn(() => new Promise<string>(() => {})));

vi.mock('../../firebase', () => ({
  auth: { currentUser: { getIdToken } },
}));

import { authFetch } from '../auth-fetch';

describe('authFetch abort', () => {
  it('rejects a token refresh that never returns once the save aborts', async () => {
    const controller = new AbortController();
    const pending = authFetch('/api/blog/actions', { method: 'POST', signal: controller.signal, body: '{}' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getIdToken).toHaveBeenCalled();
    const rejected = pending.then(
      () => false,
      (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
    );
    controller.abort();
    await expect(rejected).resolves.toBe(true);
  });
});
