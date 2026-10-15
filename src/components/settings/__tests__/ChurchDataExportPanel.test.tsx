import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * THE-228 — the Settings control. authFetch is the only network. A 403 on the
 * status read is a refusal, not a broken page; a 403 on Start is shown.
 */

const mockAuthFetch = vi.hoisted(() => vi.fn());

vi.mock('../../../utils/auth-fetch', () => ({ authFetch: mockAuthFetch }));

const { default: ChurchDataExportPanel } = await import('../ChurchDataExportPanel');

interface Reply {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

function reply(status: number, body: unknown): Reply {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function settle() {
  for (let i = 0; i < 6; i++) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ChurchDataExportPanel tenantId="tenant-a" />);
  });
  await settle();
  return host;
}

beforeEach(() => {
  document.body.innerHTML = '';
  mockAuthFetch.mockReset();
  vi.stubGlobal('fetch', vi.fn());
  window.open = vi.fn() as unknown as typeof window.open;
  URL.createObjectURL = () => 'blob:church-export';
  URL.revokeObjectURL = () => {};
});

describe('ChurchDataExportPanel', () => {
  it('starts an export, shows that it is ready, then downloads and removes the copy', async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    let release: (value: Reply) => void = () => {};
    mockAuthFetch.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body });
      if (method === 'GET') return Promise.resolve(reply(200, { export: null }));
      if (url === '/api/church-export' && method === 'POST') {
        return new Promise<Reply>((resolve) => { release = resolve; });
      }
      if (url === '/api/church-export/url') {
        return Promise.resolve(reply(200, { url: 'https://signed.example/church-export', expiresInSeconds: 900 }));
      }
      if (url === '/api/church-export/complete') return Promise.resolve(reply(200, { deleted: true }));
      return Promise.resolve(reply(500, { error: 'unexpected' }));
    });
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['zip']),
    });

    const host = await mount();
    const start = host.querySelector('[aria-label="Export church data"]') as HTMLButtonElement;
    expect(start).toBeTruthy();
    await act(async () => { start.click(); });
    await settle();
    expect(host.textContent).toContain('Preparing export');

    await act(async () => {
      release(reply(200, { exportId: 'exp-1', status: 'ready' }));
    });
    await settle();
    expect(host.textContent).toContain('Ready');
    const download = host.querySelector('[aria-label="Download"]') as HTMLButtonElement;
    expect(download).toBeTruthy();

    await act(async () => { download.click(); });
    await settle();
    expect(calls.some((call) => call.url === '/api/church-export/url' && call.method === 'POST')).toBe(true);
    expect(calls.some((call) => call.url === '/api/church-export/complete')).toBe(true);
    expect(host.textContent).toContain('removed from storage');
    const started = calls.find((call) => call.url === '/api/church-export' && call.method === 'POST');
    expect(JSON.parse(started!.body!)).toEqual({ tenantId: 'tenant-a' });
  });

  it('shows the server refusal when a manageCRM admin starts an export', async () => {
    mockAuthFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if ((init?.method ?? 'GET') === 'GET') return Promise.resolve(reply(403, { error: 'Tenant admin access required' }));
      return Promise.resolve(reply(403, { error: 'Tenant admin access required' }));
    });
    const host = await mount();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    const start = host.querySelector('[aria-label="Export church data"]') as HTMLButtonElement;
    await act(async () => { start.click(); });
    await settle();
    expect(host.textContent).toContain('Tenant admin access required');
    expect(host.textContent).toContain('Export failed');
  });

  it('shows a failed export that was already recorded', async () => {
    mockAuthFetch.mockResolvedValue(reply(200, {
      export: { id: 'exp-1', status: 'failed', error: 'Could not read members.csv' },
    }));
    const host = await mount();
    expect(host.textContent).toContain('Could not read members.csv');
  });

  it('does not remove the stored copy when the browser blocks the download', async () => {
    const calls: string[] = [];
    mockAuthFetch.mockImplementation((url: string, init?: { method?: string }) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if ((init?.method ?? 'GET') === 'GET') return Promise.resolve(reply(200, { export: null }));
      if (url === '/api/church-export') return Promise.resolve(reply(200, { exportId: 'exp-1', status: 'ready' }));
      if (url === '/api/church-export/url') return Promise.resolve(reply(200, { url: 'https://signed.example/church-export' }));
      return Promise.resolve(reply(200, { deleted: true }));
    });
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('cors'));
    (window.open as unknown as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const host = await mount();
    await act(async () => {
      (host.querySelector('[aria-label="Export church data"]') as HTMLButtonElement).click();
    });
    await settle();
    await act(async () => {
      (host.querySelector('[aria-label="Download"]') as HTMLButtonElement).click();
    });
    await settle();
    expect(host.textContent).toContain('blocked');
    expect(calls.some((call) => call.includes('/complete'))).toBe(false);
  });
});
