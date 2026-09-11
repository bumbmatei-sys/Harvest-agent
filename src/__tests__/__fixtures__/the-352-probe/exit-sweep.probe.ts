import { readFileSync, writeFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

import { MeasuringBrowser } from '../../../test/support/browser-measure';

/**
 * THE-352 — a browser that is STILL OPEN when the worker goes away.
 *
 * ⚠️ This is the leak THE-333 counted twenty of, and it cannot be observed from
 * inside the process that leaks: the whole question is what survives that
 * process. So the probe deliberately abandons a spawned browser and then exits
 * hard, and `THE-352.suite-guards.test.ts` — the parent — checks afterwards
 * whether the child's child is still alive.
 *
 * The "browser" is `THE_352_FAKE_BROWSER`, a script the parent writes: it
 * records its own pid and then sleeps, so it is a process that will outlive its
 * parent unless something kills it. `open()` is started and NOT awaited — the
 * spawn has happened by the time the pid file exists, and awaiting it would run
 * the failure path this file is not measuring.
 */
describe('a worker that goes away with a browser still open', () => {
  it('abandons one and exits', async () => {
    const done = process.env.THE_352_PID_FILE!;
    expect(done, 'the parent did not say where to report the pid').toBeTruthy();

    const browser = new MeasuringBrowser();
    // Not awaited, deliberately: see the note above.
    void browser.open('file:///dev/null').catch(() => undefined);

    // Long enough for the spawn and for the fake to write its pid, short enough
    // that a broken probe fails the parent's own timeout rather than hanging.
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 50));
      try { if (readFileSync(done, 'utf8').trim()) break; } catch { /* not yet */ }
    }
    writeFileSync(`${done}.ready`, 'ready');
    // 🔴 The point of the probe: RETURN, leaving the browser open and `open()`
    // still in flight. Vitest intercepts `process.exit` inside a worker and
    // turns it into a test failure, so the natural end of the run is the only
    // real process exit available to observe.
  }, 30_000);
});
