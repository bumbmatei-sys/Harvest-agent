import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';

/**
 * THE-228 — the daily sweep. Same cron secret as the blog auto-generate job.
 * An unset secret is its own refusal, and a failed sweep is a 500 rather than
 * an empty success.
 */

const mockSweep = vi.hoisted(() => vi.fn());
const mockCapture = vi.hoisted(() => vi.fn());

vi.mock('@/lib/church-export-run', () => ({
  sweepChurchExports: (...args: unknown[]) => mockSweep(...args),
}));
vi.mock('@/lib/money-path-sentry', () => ({
  captureHandledError: (...args: unknown[]) => mockCapture(...args),
}));

const { GET } = await import('../sweep/route');

const previous = process.env.CRON_SECRET;

afterEach(() => {
  mockSweep.mockReset();
  mockCapture.mockReset();
  if (previous === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previous;
});

function cron(authorization: string) {
  return new NextRequest('http://localhost/api/church-export/sweep', { headers: { authorization } });
}

describe('GET /api/church-export/sweep', () => {
  it('is on the Vercel cron schedule, separate from the blog job', () => {
    const vercel = JSON.parse(readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')) as {
      crons: { path: string; schedule: string }[];
    };
    expect(vercel.crons).toContainEqual({ path: '/api/church-export/sweep', schedule: '0 5 * * *' });
  });

  it('deletes when the cron secret matches', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    mockSweep.mockResolvedValue({ deleted: 2, kept: 1, refused: 0 });
    const res = await GET(cron('Bearer test-cron-secret'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 2, kept: 1, refused: 0 });
    expect(mockSweep).toHaveBeenCalledTimes(1);
  });

  it('refuses a wrong secret without putting the reason in the response', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    const wrong = await GET(cron('Bearer something-else'));
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: 'Unauthorized' });
    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        step: 'church-export-sweep-auth',
        level: 'warning',
        diagnostics: { reason: 'cron-secret-mismatch' },
      }),
    );
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it('refuses when CRON_SECRET is missing and does not sweep', async () => {
    delete process.env.CRON_SECRET;
    const missing = await GET(cron('Bearer test-cron-secret'));
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ error: 'Unauthorized' });
    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        diagnostics: { reason: 'cron-secret-not-configured' },
      }),
    );
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it('returns 500 when the sweep fails', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    mockSweep.mockRejectedValue(new Error('Export storage is not configured'));
    const res = await GET(cron('Bearer test-cron-secret'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Sweep failed' });
    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ step: 'church-export-sweep' }),
    );
  });
});
