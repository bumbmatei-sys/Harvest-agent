import { describe, it, expect } from 'vitest';

import { setUpOrFail } from '../../../test/support/suite-setup';

/**
 * THE-352 — a setup that misses its budget and THEN rejects.
 *
 * ⚠️ The real shape of an abandoned browser open: the race reports the missed
 * deadline, and the body goes on running and eventually fails on its own. That
 * late rejection must not surface as an unhandled rejection, which Vitest turns
 * into a run-level error — a harness that reds the run for its own bookkeeping
 * would be its own defect. `Promise.race` attaches a handler to every input, so
 * the body is never unhandled; this probe is what checks that rather than
 * reasoning about it.
 */
describe('a setUpOrFail whose body rejects after its budget', () => {
  setUpOrFail(() => new Promise<void>((_, reject) => {
    setTimeout(() => reject(new Error('the-352-probe: late rejection')), 400);
  }), 100);
  it('first assertion', () => { expect(1).toBe(1); });
});
