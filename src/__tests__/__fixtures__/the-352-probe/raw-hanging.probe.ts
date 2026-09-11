import { describe, it, expect, beforeAll } from 'vitest';

/**
 * THE-352 — the CONTROL for a setup that hangs: a plain `beforeAll` that never
 * settles, with the same budget the subject uses.
 *
 * Vitest aborts the hook at its timeout and reports the tests SKIPPED. That is
 * #477 reproduced in miniature — no exception anywhere, 61 assertions absent
 * from the report, and a CI summary that says only "failed files".
 */
describe('a plain beforeAll that never settles', () => {
  beforeAll(() => new Promise<void>(() => { /* never settles */ }), 1_000);
  it('first assertion', () => { expect(1).toBe(1); });
  it('second assertion', () => { expect(2).toBe(2); });
});
