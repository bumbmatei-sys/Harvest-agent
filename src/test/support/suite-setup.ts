import { beforeAll, beforeEach } from 'vitest';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-352 — a `beforeAll` that throws must FAIL its suite's tests, not skip them
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * 🔴 WHAT THIS EXISTS TO STOP.
 *
 * #477 reported three measuring suites dying in `beforeAll` — THE-279's
 * toolbar, THE-286's settings chrome and THE-296's settings sections — and
 * their 61 tests were reported SKIPPED, not failed. A skipped test says nothing
 * whatsoever about the surface it guards: those 61 assertions exist to catch a
 * layout regression in the editor toolbar and the settings panels, and on that
 * run every one of them was silently absent while CI's summary said only
 * "3 failed files". A regression landing in those surfaces on such a run would
 * have gone through unnoticed. That is the same defect as a stripper eating the
 * code a guard greps: a suite advertising protection it is not providing.
 *
 * 🔴 VITEST CANNOT BE CONFIGURED OUT OF THIS, and that was measured rather than
 * assumed (vitest 4.1.9, this repo's config). A probe file with one `beforeAll`
 * that throws and one `beforeEach` that throws reports:
 *
 *     Test Files  1 failed (1)
 *          Tests  2 failed | 2 skipped (4)
 *
 * The two under the throwing `beforeAll` are the SKIPPED pair; the two under
 * the throwing `beforeEach` are the FAILED pair. There is no option that moves
 * the first pair into the second — a suite-level hook failure is a suite error
 * in Vitest's model, and its children are never started. The alternative is
 * therefore to move WHERE the throw happens, which is all this helper does.
 *
 * ─── How ─────────────────────────────────────────────────────────────────────
 *
 * The setup body still runs once, in a `beforeAll`, with the caller's own
 * timeout — nothing about cost or ordering changes. But its failure is CAUGHT
 * and held, and a `beforeEach` rethrows it. A `beforeEach` failure in Vitest
 * fails the individual test, so every test in the file is reported RED, each
 * carrying the original error, instead of a silent skip.
 *
 * ⚠️ THE TIMEOUT IS THE CALLER'S AND IS NOT LOOSENED HERE. `timeoutMs` is
 * forwarded to `beforeAll` verbatim; a suite that passed 180_000 still gets
 * 180_000. A hook that exceeds it is aborted by Vitest with an error, which is
 * exactly the case this helper converts into per-test failures.
 *
 * ⚠️ `afterAll` STILL RUNS. Vitest runs teardown hooks even when setup failed,
 * so a suite that assigns its browser before opening it still closes it.
 *
 * ─── What it deliberately does NOT do ────────────────────────────────────────
 *
 * It does not swallow anything. If the setup succeeds the helper is inert, and
 * if it fails the error surfaces once per test rather than nowhere. A helper
 * that recorded "setup failed" and let the tests run would be worse than the
 * skip — the assertions would then measure an unopened browser and report
 * whatever nonsense that produces.
 */
/**
 * 🔴 HOW MUCH LONGER THE HOOK IS GIVEN THAN THE BODY, and why that is not a
 * loosened timeout.
 *
 * The caller's `timeoutMs` is the body's budget and is enforced here, unchanged
 * — a suite that passed 180_000 fails at 180_000. What the grace buys is WHICH
 * DEADLINE FIRES FIRST. A hook aborted by Vitest at its own timeout is aborted
 * from OUTSIDE the callback: the runner rejects, the suite errors, and the tests
 * are skipped — the exact outcome this helper exists to prevent, and #477's
 * actual shape, since nothing threw there. Giving the hook a slightly later
 * deadline than the body guarantees the body's own deadline lands first, inside
 * the `try`, where it becomes a per-test failure naming the budget it missed.
 *
 * ⚠️ Five seconds, not a proportion: it is a tie-break, and it must not grow
 * with the budget or a slow suite would gain real extra time.
 */
const HOOK_GRACE_MS = 5_000;

export function setUpOrFail(setup: () => Promise<void> | void, timeoutMs?: number): void {
  // A separate flag rather than `failure !== undefined`: a body that throws
  // `undefined` (or `null`) is rare but not impossible, and reading the flag
  // instead of the value means such a throw is still reported.
  let failed = false;
  let failure: unknown;

  beforeAll(async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const body = (async () => setup())();
      if (timeoutMs === undefined) {
        // No budget to enforce — Vitest's default hook timeout still applies,
        // and a suite that hits it still skips. Every caller in this repo
        // passes one; this branch exists so the helper is safe without.
        await body;
      } else {
        await Promise.race([
          body,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`suite setup did not finish within ${timeoutMs}ms`)),
              timeoutMs,
            );
          }),
        ]);
      }
    } catch (e) {
      failed = true;
      failure = e;
    } finally {
      // ⚠️ Cleared on every path. A pending timer holds the worker's event loop
      // open, and a harness that delays the run's exit is its own defect.
      if (timer !== undefined) clearTimeout(timer);
    }
  }, timeoutMs === undefined ? undefined : timeoutMs + HOOK_GRACE_MS);

  beforeEach(() => {
    if (!failed) return;
    // Rethrown as-is when it is an Error, so the stack still points at the line
    // inside the setup body that actually failed rather than at this file.
    if (failure instanceof Error) throw failure;
    throw new Error(`suite setup failed: ${String(failure)}`);
  });
}
