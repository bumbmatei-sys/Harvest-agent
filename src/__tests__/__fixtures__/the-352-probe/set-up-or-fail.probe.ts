import { describe, it, expect } from 'vitest';

import { setUpOrFail } from '../../../test/support/suite-setup';

/**
 * THE-352 — the SUBJECT. The same failing setup, through `setUpOrFail`.
 *
 * Both tests must be reported FAILED, each carrying the original message, and
 * none may be reported skipped.
 */
describe('a setUpOrFail whose body throws', () => {
  setUpOrFail(() => { throw new Error('the-352-probe: setup failed'); }, 30_000);
  it('first assertion', () => { expect(1).toBe(1); });
  it('second assertion', () => { expect(2).toBe(2); });
});
