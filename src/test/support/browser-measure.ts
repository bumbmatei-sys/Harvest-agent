import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
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

/**
 * 🔴 THE-352 — EVERY LIVE BROWSER, SO NONE OUTLIVES THE WORKER THAT SPAWNED IT.
 *
 * ⚠️ THE-333 counted TWENTY leaked Chromium processes left behind by earlier
 * timeouts, and a leak is not a tidiness problem here: each one holds memory
 * and a shared-memory segment on a two-core runner, so every leak makes the
 * NEXT launch likelier to fail. That is intermittency with a cause.
 *
 * `close()` handles the ordinary path and `open()` now disposes its own
 * half-built browser (see below), but neither runs when Vitest tears the worker
 * down under it — a hook that blows its timeout, a worker killed mid-run. A
 * child spawned without `detached` is NOT killed when its parent dies on Linux;
 * it is reparented and keeps running. So the last resort is synchronous and
 * runs on the way out.
 */
const LIVE = new Set<ChildProcess>();
let sweepInstalled = false;
function installSweep(): void {
  if (sweepInstalled) return;
  sweepInstalled = true;
  // `exit` only permits synchronous work, which `kill` is. SIGKILL rather than
  // SIGTERM: there is no turn of the event loop left in which to observe a
  // graceful shutdown, so asking politely would just let the process survive.
  const sweep = () => { for (const p of LIVE) { try { p.kill('SIGKILL'); } catch { /* gone */ } } };
  // The ordinary end of a run: the loop drains and the process exits normally.
  process.once('exit', sweep);
  //
  // 🔴 AND THE SIGNAL, because `exit` ALONE DOES NOT FIRE ON THE PATH THAT
  // LEAKS — measured, not assumed. Vitest terminates a worker by SIGTERM and
  // registers no handler for it itself, so with no listener here Node's default
  // kills the worker outright and NOTHING runs on the way out. A probe that
  // leaves a browser open and lets the run end confirmed it: the stand-in
  // browser survived, reparented to init.
  //
  // ⚠️ `once` PLUS A RE-RAISE, so this changes nothing about how the process
  // dies. Adding a listener suppresses Node's default for that signal, which
  // would be this module deciding the worker's fate — Vitest's job, not its
  // harness's. `once` removes the listener as it fires, so re-sending the same
  // signal to self lands on the default handler and the worker terminates
  // exactly as it would have, one sweep later.
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sig, () => { sweep(); process.kill(process.pid, sig); });
  }
}

/**
 * 🔴 THE-352 — A CDP REQUEST THAT IS NEVER ANSWERED MUST FAIL, NOT HANG.
 *
 * ⚠️ `send()` used to resolve only when a reply with a matching id arrived, and
 * nothing else. A browser that dies mid-request, or a `Runtime.evaluate` whose
 * awaited promise never settles, therefore left the caller waiting FOREVER —
 * and `settle()` awaits `requestAnimationFrame`, which a headless Chrome that
 * considers itself fully occluded can decline to fire. THE-333 traced the
 * original stall to exactly there. An unbounded wait is what turns a broken
 * browser into a hung job rather than a failing test.
 *
 * This is a NEW bound where there was none, not a loosened one: 60s is far
 * longer than any real CDP round trip and far shorter than a suite timeout, so
 * the failure arrives inside the hook that caused it, naming the method.
 */
const CDP_TIMEOUT_MS = 60_000;

/** A headless browser, held open across viewports so one launch serves them all. */
export class MeasuringBrowser {
  private proc: ChildProcess | null = null;
  private ws: WebSocket | null = null;
  private sessionId = '';
  private nextId = 0;
  private pending = new Map<number, (msg: Record<string, unknown>) => void>();
  private stderr = '';
  private exited = '';

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
     * browsers cannot want the same one however they are scheduled, and the URL
     * it actually bound is read off STDERR — Chrome announces it there as
     * `DevTools listening on ws://…` the moment it is ready, and this class
     * already captures stderr for its failure reports.
     *
     * ⚠️ A first attempt read the port from `DevToolsActivePort` instead, which
     * meant giving each instance its own `--user-data-dir`. That REGRESSED in
     * CI: building a fresh profile is slow enough on a loaded runner that
     * nothing was written inside the 20s budget, and the failure arrived with
     * an empty stderr — less diagnosable than the collision it replaced. The
     * announcement needs no profile, no file and no second HTTP round trip, so
     * it is both simpler and faster than either.
     */
    this.proc = spawn(bin, [
      '--headless=new', '--remote-debugging-port=0', '--no-sandbox',
      '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
      '--force-device-scale-factor=1', 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    LIVE.add(this.proc);
    installSweep();
    // ⚠️ Kept, and reported on failure. A browser that refuses to start in CI
    // says why on stderr; without this the only symptom is a timeout, which is
    // the least diagnosable failure a test can have. (Its dbus warnings on a
    // container with no session bus are noise and are dropped.)
    this.proc.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString();
      if (!/dbus|Failed to connect to the bus/.test(line)) this.stderr += line;
    });
    this.proc.on('exit', (code) => { this.exited = `browser exited with code ${code}`; });

    /**
     * 🔴 THE-352 — EVERYTHING PAST THE SPAWN DISPOSES ITSELF ON FAILURE.
     *
     * ⚠️ A browser that is spawned and then fails to be attached to used to be
     * left running: `open()` threw, and whether anything ever killed the child
     * depended entirely on the caller having assigned its `browser` variable
     * BEFORE awaiting, so that `afterAll` had something to close. Every suite
     * happens to be written that way today, which is a convention and not a
     * guarantee — and it does nothing at all for the case that actually leaked,
     * a hook aborted at its timeout while this method is still awaiting.
     *
     * The `catch` makes disposal this method's own responsibility: whatever
     * goes wrong between the spawn and the first settled page, the browser is
     * killed and waited for before the error is re-thrown. The error itself is
     * untouched — `announcedUrl()`'s stderr dump is the most diagnosable
     * failure this class produces and must survive the cleanup.
     */
    try {
      const wsUrl = await this.announcedUrl();
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
    } catch (e) {
      await this.close();
      throw e;
    }
  }

  /**
   * The debugger URL Chrome announced on stderr, e.g.
   * `DevTools listening on ws://127.0.0.1:41234/devtools/browser/<uuid>`.
   *
   * Used verbatim as the WebSocket URL, so there is no HTTP round trip at all —
   * which also sidesteps the cross-origin trap {@link debuggerUrl} documents.
   * That method is kept for callers that hold a known port.
   *
   * ⚠️ 60s rather than 20s: a loaded CI runner starting a dozen Chromes at once
   * is slower than a laptop starting one, and a budget tuned to the laptop is
   * how a green suite becomes an intermittently red one. It still reports the
   * same way on failure — a browser that refuses to start says why on stderr,
   * and a bare timeout is the least diagnosable failure a test can have.
   */
  private async announcedUrl(): Promise<string> {
    for (let i = 0; i < 600; i++) {
      if (this.exited) break;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(this.stderr);
      if (m) return m[1];
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(
      `the browser never announced its debugging port. ${this.exited}\n${this.stderr.slice(0, 2000)}`,
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
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = ++this.nextId;
      // 🔴 THE-352 — bounded, for the reason CDP_TIMEOUT_MS documents. The
      // timer is cleared on the reply, so a healthy round trip costs one
      // `setTimeout` and nothing else.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(
          `the browser never answered ${method} within ${CDP_TIMEOUT_MS}ms. ` +
          `${this.exited || 'the process is still alive'}\n${this.stderr.slice(0, 2000)}`,
        ));
      }, CDP_TIMEOUT_MS);
      this.pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
      try {
        this.ws!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
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
   * finished suite leaking a live Chrome into the ones after it.
   *
   * SIGKILL after five seconds so a wedged browser cannot hang the run, and
   * every cleanup step is best-effort: `close()` runs in `afterAll`, where a
   * throw would replace a real test failure with a teardown one.
   */
  async close(): Promise<void> {
    try { this.ws?.close(); } catch { /* already gone */ }
    this.ws = null;
    const proc = this.proc;
    if (proc) LIVE.delete(proc);
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
  }
}
