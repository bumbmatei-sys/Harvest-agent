import { describe, it, expect, beforeAll } from 'vitest';

/**
 * THE-352 — the CONTROL. A plain `beforeAll` that throws.
 *
 * Vitest reports the two tests below as SKIPPED, which is the whole defect:
 * #477's three measuring suites contributed 61 assertions that never ran while
 * CI's summary said only "3 failed files". This probe exists so that claim is
 * MEASURED on the installed Vitest rather than quoted from a card, and so that
 * the comparison against `setup-or-fail.probe.ts` is like for like.
 */
describe('a plain beforeAll that throws', () => {
  beforeAll(() => { throw new Error('the-352-probe: setup failed'); });
  it('first assertion', () => { expect(1).toBe(1); });
  it('second assertion', () => { expect(2).toBe(2); });
});
