import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The bounded diagnostics channel on `captureHandledError`.
 *
 * Raw model output was only ever `console.error`'d, which on Vercel is
 * effectively unreadable — which is how JAVASCRIPT-NEXTJS-8 reached 305 events
 * without anyone being able to say what the model had actually returned. The
 * excerpt now rides to Sentry, but it is model output derived from a church's
 * own material, so the cap and the redaction are the load-bearing parts.
 */

const captureException = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

const { captureHandledError, MAX_DIAGNOSTIC_CHARS } = await import('../money-path-sentry');
const { REDACTED } = await import('../sentry-scrub');

/** The `handled_path` context block as it would be transmitted. */
function capturedContext() {
  return captureException.mock.calls[0][1].contexts.handled_path;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('captureHandledError — diagnostics are bounded', () => {
  it('hard-caps a long excerpt and marks that it was cut', () => {
    const huge = 'x'.repeat(5000);

    captureHandledError(new Error('parse failed'), {
      step: 'blog-auto-generate-tenant',
      tenantId: 'bumb',
      diagnostics: { rawResponseExcerpt: huge },
    });

    const excerpt = capturedContext().rawResponseExcerpt;
    expect(excerpt.startsWith('x'.repeat(MAX_DIAGNOSTIC_CHARS))).toBe(true);
    // Capped: the marker is a fixed suffix, so the total stays bounded and well
    // under the 5000 characters handed in.
    expect(excerpt).toMatch(/…\[truncated 4500 chars\]$/);
    expect(excerpt.length).toBeLessThan(MAX_DIAGNOSTIC_CHARS + 40);
  });

  it('passes a short excerpt through unchanged and unmarked', () => {
    captureHandledError(new Error('parse failed'), {
      step: 'blog-auto-generate-tenant',
      diagnostics: { rawResponseExcerpt: 'Sorry, I cannot help with that.' },
    });

    expect(capturedContext().rawResponseExcerpt).toBe('Sorry, I cannot help with that.');
  });

  it('keeps zero-valued diagnostics — an empty response is the finding', () => {
    captureHandledError(new Error('parse failed'), {
      step: 'blog-auto-generate-tenant',
      diagnostics: { rawResponseLength: 0, finishReason: 'stop', missing: null },
    });

    const ctx = capturedContext();
    expect(ctx.rawResponseLength).toBe('0');
    expect(ctx.finishReason).toBe('stop');
    expect(ctx).not.toHaveProperty('missing');
  });
});

describe('captureHandledError — diagnostics are redacted', () => {
  it('strips a member email and phone number out of model-derived prose', () => {
    captureHandledError(new Error('parse failed'), {
      step: 'blog-auto-generate-tenant',
      diagnostics: {
        rawResponseExcerpt:
          'Prayer request from Dana, reach her at dana.smith@example.org or 555-867-5309 anytime.',
      },
    });

    const excerpt = capturedContext().rawResponseExcerpt;
    expect(excerpt).not.toContain('dana.smith@example.org');
    expect(excerpt).not.toContain('555-867-5309');
    expect(excerpt).toContain(REDACTED);
    // Still useful: the surrounding shape survives so the response is diagnosable.
    expect(excerpt).toContain('Prayer request from Dana');
  });

  it('leaves the identifiers-only `ids` contract untouched', () => {
    captureHandledError(new Error('parse failed'), {
      step: 'blog-auto-generate-tenant',
      tenantId: 'bumb',
      ids: { postId: 'post-1' },
      diagnostics: { finishReason: 'length' },
    });

    expect(capturedContext()).toMatchObject({
      step: 'blog-auto-generate-tenant',
      tenantId: 'bumb',
      postId: 'post-1',
      finishReason: 'length',
    });
  });
});
