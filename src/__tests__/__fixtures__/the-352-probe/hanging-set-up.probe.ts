import { describe, it, expect } from 'vitest';

import { setUpOrFail } from '../../../test/support/suite-setup';

/**
 * THE-352 — a setup that HANGS rather than throwing.
 *
 * 🔴 This is #477's actual shape. Nothing threw there: three suites sat in
 * `beforeAll` until their hook ran out of time. A hook aborted at its timeout is
 * aborted by the RUNNER, from outside the callback, so a `try/catch` around the
 * body never sees it — which would leave the tests skipped exactly as before.
 * `setUpOrFail` therefore enforces the caller's budget itself, inside the body,
 * so the deadline it misses is one its own `catch` can observe.
 */
describe('a setUpOrFail whose body never settles', () => {
  setUpOrFail(() => new Promise<void>(() => { /* never settles */ }), 1_000);
  it('first assertion', () => { expect(1).toBe(1); });
  it('second assertion', () => { expect(2).toBe(2); });
});
