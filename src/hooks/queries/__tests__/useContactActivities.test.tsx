import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The activity timeline read, after it moved server-side.
 *
 * The bug this guards: the hook used to query Firestore directly, and the
 * top-level `contactActivities` rule rejected that query outright
 * (permission-denied — see tests/rules/crm-activities.rules.test.ts). AdminCRM
 * destructured `data = []`, so the rejection rendered as "No activities
 * recorded yet". The contract now is that a failed load REACHES the caller as
 * an error — never as an empty array.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mockAuthFetch, mockCapture } = vi.hoisted(() => ({
  mockAuthFetch: vi.fn(),
  mockCapture: vi.fn(),
}));

vi.mock('../../../utils/auth-fetch', () => ({ authFetch: mockAuthFetch }));
vi.mock('../../../lib/money-path-sentry', () => ({ captureHandledError: mockCapture }));
vi.mock('../../../firebase', () => ({ db: {}, auth: { currentUser: null } }));

const { useContactActivities } = await import('../useCRMQueries');

type Result = ReturnType<typeof useContactActivities>;

let container: HTMLDivElement;
let root: Root;

/** Render the hook and hand back a live view of its latest result. */
async function renderHook(tenantId: string | null, contactId: string | undefined): Promise<{ current: Result }> {
  const ref: { current: Result } = { current: null as unknown as Result };
  function Probe() {
    ref.current = useContactActivities(tenantId, contactId);
    return null;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  return ref;
}

/** Flush microtasks + React work until `predicate` holds, or fail. */
async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (predicate()) return;
    await act(async () => { await new Promise(r => setTimeout(r, 5)); });
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('useContactActivities', () => {
  it('calls the server route with the contactId and no tenant id', async () => {
    mockAuthFetch.mockResolvedValue({ ok: true, json: async () => ({ activities: [] }) });
    const res = await renderHook('bumb', 'G6c04DRQwp2ngo6G9d6K');
    await until(() => res.current.isSuccess, 'success');

    const url = mockAuthFetch.mock.calls[0][0] as string;
    expect(url).toBe('/api/crm/contact-activities?contactId=G6c04DRQwp2ngo6G9d6K');
    // The tenant must never travel from the client — the route reads it off the token.
    expect(url).not.toContain('tenantId');
  });

  it('returns the activities the route sends back', async () => {
    const activities = Array.from({ length: 5 }, (_, i) => ({
      id: `a${i}`, contactId: 'c1', tenantId: 'bumb', type: 'note',
      description: `n${i}`, amount: null, createdAt: '2026-05-01T00:00:00.000Z', createdBy: 'u1',
    }));
    mockAuthFetch.mockResolvedValue({ ok: true, json: async () => ({ activities }) });

    const res = await renderHook('bumb', 'c1');
    await until(() => res.current.isSuccess, 'success');
    expect(res.current.data).toHaveLength(5);
  });

  it('SURFACES a rejected read as an error — never as an empty list', async () => {
    mockAuthFetch.mockResolvedValue({
      ok: false, status: 403,
      json: async () => ({ error: 'Access denied to this tenant' }),
    });

    const res = await renderHook('bumb', 'c1');
    await until(() => res.current.isError, 'error');

    expect(res.current.data).toBeUndefined();
    expect((res.current.error as Error).message).toBe('Access denied to this tenant');
    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ step: 'crm-contact-activities-load', tenantId: 'bumb' }),
    );
  });

  it('surfaces a network failure the same way', async () => {
    mockAuthFetch.mockRejectedValue(new Error('Failed to fetch'));
    const res = await renderHook('bumb', 'c1');
    await until(() => res.current.isError, 'error');
    expect(res.current.data).toBeUndefined();
    expect(mockCapture).toHaveBeenCalled();
  });

  it('stays idle with no contact selected', async () => {
    const res = await renderHook('bumb', undefined);
    expect(res.current.fetchStatus).toBe('idle');
    expect(mockAuthFetch).not.toHaveBeenCalled();
  });
});
