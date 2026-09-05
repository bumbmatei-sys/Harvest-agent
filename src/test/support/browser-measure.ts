import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

/**
 * A plain HTTP GET over `node:http`.
 *
 * ⚠️ NOT `fetch`. Callers may run under a DOM-emulating test environment whose
 * global `fetch` enforces browser semantics, and a request to the browser's own
 * debugger port is cross-origin under those rules — it fails with
 * "Cross-Origin Request Blocked" and the browser can never be attached to.
 * `node:http` has no such notion. (The test that uses this also selects the
 * `node` environment, so this is belt and braces — and the belt is cheap.)
 */
function get(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Real layout measurement, in a real browser, with no npm dependency.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────
 *
 * THE-276 shipped a dashboard whose every widget rendered in a 420px column on
 * the right of a 1044px container, and the whole suite stayed green. It stayed
 * green because every layout guard in this repo reasons about CLASS NAMES —
 * `class-inventory.ts` parses `max-w-6xl` into 1044px and the tests do
 * arithmetic on it. That answers "how wide may this box be", which is a real
 * question, and it cannot answer "where did this box actually land", which was
 * the defect.
 *
 * 🔴 happy-dom cannot close that gap, and this was measured rather than assumed:
 * with 22KB of the real compiled stylesheet injected into the document,
 * `getBoundingClientRect()` returns all zeros on every element and
 * `getComputedStyle(el).display` answers `block` for a `flex` container. There
 * is no layout engine and no Tailwind cascade — so no assertion written against
 * happy-dom can distinguish the broken layout from the fixed one.
 *
 * ─── Why CDP and not Playwright ──────────────────────────────────────────────
 *
 * Playwright would be the obvious answer and it costs a devDependency plus a
 * browser download in CI — on a repo whose Actions allowance has already been
 * exhausted once (see the header of .github/workflows/test.yml, and THE-170
 * removing the `push` trigger to save minutes). Everything below uses
 * `node:child_process`, global `fetch` and the global `WebSocket` that Node 22
 * ships — the same protocol Playwright speaks, without the package or the
 * download. `package.json` is unchanged.
 *
 * 🔴 A MISSING BROWSER IS A FAILURE, NOT A SKIP. A test that quietly skips is
 * exactly how the original defect shipped: a green suite that had measured
 * nothing. {@link findBrowser} throws, naming every path it tried.
 */

/** Where a Chrome or Chromium binary is found, in the order worth trying. */
function browserCandidates(): string[] {
  const fromEnv = [process.env.CHROME_PATH, process.env.CHROME_BIN].filter(Boolean) as string[];
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH;
  return [
    ...fromEnv,
    ...(pw ? [path.join(pw, 'chromium'), path.join(pw, 'chrome-linux', 'chrome')] : []),
    '/opt/pw-browsers/chromium',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ];
}

export function findBrowser(): string {
  const tried = browserCandidates();
  const found = tried.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      'No Chrome/Chromium binary found, so layout cannot be measured. This test ' +
      'must not be skipped — a suite that measures no layout is how the THE-276 ' +
      'column bug shipped green. Set CHROME_PATH, or install one. Tried:\n  ' +
      tried.join('\n  '),
    );
  }
  return found;
}

/** The box and the two computed properties that decide whether it stacks. */
export interface Box {
  x: number; y: number; width: number; height: number; right: number; bottom: number;
  display: string; flexDirection: string;
}

export interface Measurement {
  viewport: number;
  /** `document.documentElement.scrollWidth` — greater than the viewport means overflow. */
  scrollWidth: number;
  boxes: Record<string, Box | null>;
  /** Every `[data-kpi]` card, in document order. */
  kpiCards: Box[];
}

/** A headless browser, held open across viewports so one launch serves them all. */
export class MeasuringBrowser {
  private proc: ChildProcess | null = null;
  private ws: WebSocket | null = null;
  private sessionId = '';
  private nextId = 0;
  private pending = new Map<number, (msg: Record<string, unknown>) => void>();
  private stderr = '';
  private exited = '';
  /** This instance's own Chrome profile. Removed by {@link close}. */
  private userDataDir: string | null = null;

  async open(fileUrl: string): Promise<void> {
    const bin = findBrowser();
    /**
     * 🔴 THE OS ASSIGNS THE PORT, AND THE PROFILE IS THIS INSTANCE'S OWN.
     *
     * ⚠️ This used to be `9222 + (process.pid % 900)`, above the comment "a
     * high, deterministic-enough port: the suite runs this file once". That was
     * true when ONE file measured; seventeen do now, and the number is derived
     * from the PROCESS, so it is the SAME port for every browser a worker ever
     * opens. Vitest reuses a worker across files, and `close()` did not wait for
     * the browser to die — so the next file's Chrome raced the previous one's
     * shutdown for the same socket and lost:
     *
     *     bind() failed: Address already in use (98)
     *     Error: the browser never opened its debugging port.
     *
     * That is the collision this module's own callers were warned about. It is
     * not a flake and re-running does not fix it — it fires whenever two
     * measuring suites land in one worker, which gets likelier with every suite
     * added.
     *
     * `--remote-debugging-port=0` makes the kernel pick a free port, so two
     * browsers cannot want the same one however they are scheduled; the real
     * number is read back from `DevToolsActivePort`, which Chrome writes into
     * its profile directory once it is listening. That file is also why the
     * profile has to be this instance's own — and a private profile is worth
     * having anyway, since two Chromes sharing a default one is its own race.
     */
    this.userDataDir = mkdtempSync(path.join(os.tmpdir(), 'measuring-browser-'));
    this.proc = spawn(bin, [
      '--headless=new', '--remote-debugging-port=0',
      `--user-data-dir=${this.userDataDir}`, '--no-sandbox',
      '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
      '--force-device-scale-factor=1', 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    // ⚠️ Kept, and reported on failure. A browser that refuses to start in CI
    // says why on stderr; without this the only symptom is a timeout, which is
    // the least diagnosable failure a test can have. (Its dbus warnings on a
    // container with no session bus are noise and are dropped.)
    this.proc.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString();
      if (!/dbus|Failed to connect to the bus/.test(line)) this.stderr += line;
    });
    this.proc.on('exit', (code) => { this.exited = `browser exited with code ${code}`; });

    const wsUrl = await this.debuggerUrl(await this.assignedPort());
    this.ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      this.ws!.onopen = () => resolve();
      this.ws!.onerror = () => reject(new Error('could not attach to the browser'));
    });
    this.ws.onmessage = (e: MessageEvent) => {
      const msg = JSON.parse(String(e.data)) as { id?: number };
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)!(msg as Record<string, unknown>);
        this.pending.delete(msg.id);
      }
    };

    const target = await this.send('Target.createTarget', { url: 'about:blank' });
    const attached = await this.send('Target.attachToTarget', {
      targetId: (target.result as { targetId: string }).targetId, flatten: true,
    });
    this.sessionId = (attached.result as { sessionId: string }).sessionId;
    await this.send('Page.enable', {}, this.sessionId);
    await this.send('Runtime.enable', {}, this.sessionId);
    await this.send('Page.navigate', { url: fileUrl }, this.sessionId);
    await this.settle();
  }

  /**
   * The port Chrome actually bound, read from `DevToolsActivePort`.
   *
   * Chrome writes that file into its profile directory the moment it is
   * listening: first line the port, second the browser's WebSocket path. Polled
   * on the same 100ms × 200 budget as {@link debuggerUrl}, and it reports the
   * same way on failure — a browser that refuses to start says why on stderr,
   * and a timeout with no reason is the least diagnosable failure a test has.
   */
  private async assignedPort(): Promise<number> {
    const file = path.join(this.userDataDir as string, 'DevToolsActivePort');
    for (let i = 0; i < 200; i++) {
      if (this.exited) break;
      try {
        const port = Number(readFileSync(file, 'utf8').split('\n')[0].trim());
        if (Number.isInteger(port) && port > 0) return port;
      } catch { /* not written yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(
      `the browser never reported its debugging port. ${this.exited}\n${this.stderr.slice(0, 2000)}`,
    );
  }

  private async debuggerUrl(port: number): Promise<string> {
    for (let i = 0; i < 200; i++) {
      if (this.exited) break;
      try {
        const body = await get(`http://127.0.0.1:${port}/json/version`);
        return (JSON.parse(body) as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error(
      `the browser never opened its debugging port. ${this.exited}\n${this.stderr.slice(0, 2000)}`,
    );
  }

  private send(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
    return new Promise<Record<string, unknown>>((resolve) => {
      const id = ++this.nextId;
      this.pending.set(id, resolve);
      this.ws!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  /** Two animation frames plus a beat — enough for a static page to lay out. */
  private async settle(): Promise<void> {
    await this.send('Runtime.evaluate', {
      expression: 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))',
      awaitPromise: true,
    }, this.sessionId);
  }

  /**
   * Lay the page out at `viewport` and read the boxes named by `selectors`.
   *
   * ⚠️ `Emulation.setDeviceMetricsOverride` is what makes a media query change
   * — setting `window.innerWidth` from script would not — so the 14.5px desktop
   * rem base above 1024px really is in effect at 1024 and above.
   */
  async measure(viewport: number, selectors: Record<string, string>): Promise<Measurement> {
    await this.send('Emulation.setDeviceMetricsOverride',
      { width: viewport, height: 1200, deviceScaleFactor: 1, mobile: false }, this.sessionId);
    await this.settle();

    const expression = `(() => {
      const box = (el) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { x: b.x, y: b.y, width: b.width, height: b.height, right: b.right,
                 bottom: b.bottom, display: cs.display, flexDirection: cs.flexDirection };
      };
      const sel = ${JSON.stringify(selectors)};
      const boxes = {};
      for (const k of Object.keys(sel)) boxes[k] = box(document.querySelector(sel[k]));
      return {
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        boxes,
        kpiCards: [...document.querySelectorAll('[data-kpi]')].map(box),
      };
    })()`;
    const res = await this.send('Runtime.evaluate',
      { expression, returnByValue: true }, this.sessionId);
    return (res.result as { result: { value: Measurement } }).result.value;
  }

  /**
   * Lay the page out at `viewport`, then evaluate `expression` and return it.
   *
   * {@link measure} answers a fixed set of questions, which is right for "where
   * did this column land". THE-279 asks ones it has no field for — every
   * button's box in a row, a scroller's scroll metrics, a computed
   * `touch-action`, the same scroller after being scrolled — and a new field
   * per question would grow `Measurement` without bound. So the escape hatch is
   * here once and the questions live with the test that asks them.
   *
   * ⚠️ Same `setDeviceMetricsOverride` as `measure`, for the same reason: it is
   * what makes a media query change, so the 14.5px desktop rem base really is
   * in effect at 1024 and above. `height` is a parameter because a question
   * about a `fixed bottom-0` element is about the viewport's BOTTOM, and 1200px
   * is no phone.
   */
  async evaluateAt<T>(viewport: number, expression: string, height = 1200): Promise<T> {
    await this.send('Emulation.setDeviceMetricsOverride',
      { width: viewport, height, deviceScaleFactor: 1, mobile: false }, this.sessionId);
    await this.settle();
    const res = await this.send('Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true }, this.sessionId);
    const result = res.result as { result?: { value?: T }; exceptionDetails?: { text?: string } };
    if (result.exceptionDetails) {
      throw new Error(`evaluateAt(${viewport}) threw: ${result.exceptionDetails.text ?? 'unknown'}`);
    }
    return result.result?.value as T;
  }

  /**
   * 🔴 AWAITS THE BROWSER'S EXIT, rather than signalling and returning.
   *
   * ⚠️ This used to be `this.proc?.kill()` and nothing else, which returns
   * while Chrome is still tearing down and still holding its socket. With a
   * per-process port that was the second half of the collision described in
   * `open()`. The port is now the kernel's to choose, so a lingering browser
   * can no longer block the next one — but waiting is still right: it stops a
   * finished suite leaking a live Chrome into the ones after it, and it is
   * what lets the profile directory be removed rather than left in /tmp.
   *
   * SIGKILL after five seconds so a wedged browser cannot hang the run, and
   * every cleanup step is best-effort: `close()` runs in `afterAll`, where a
   * throw would replace a real test failure with a teardown one.
   */
  async close(): Promise<void> {
    try { this.ws?.close(); } catch { /* already gone */ }
    const proc = this.proc;
    if (proc && proc.exitCode === null && proc.signalCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch { /* already gone */ }
          resolve();
        }, 5000);
        proc.once('exit', () => { clearTimeout(timer); resolve(); });
        try { proc.kill(); } catch { clearTimeout(timer); resolve(); }
      });
    }
    this.proc = null;
    if (this.userDataDir) {
      try { rmSync(this.userDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
      this.userDataDir = null;
    }
  }
}
