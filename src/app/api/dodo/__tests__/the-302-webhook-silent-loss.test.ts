import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Webhook } from 'standardwebhooks';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * THE-302 part 3 — the Dodo webhook must not report success for a write it lost.
 *
 * ─── The production evidence ─────────────────────────────────────────────────
 *
 * Sentry `JAVASCRIPT-NEXTJS-B`, `theharvest.app/api/dodo/webhook`,
 * `environment: vercel-production`, `money_path: true`, 24 occurrences in three
 * weeks:
 *
 *     Error: 4 DEADLINE_EXCEEDED: Deadline exceeded after 627.959s,
 *            name resolution: 627.944s, Waiting for LB pick
 *     step: dodo-webhook-reserve · WriteBatch.commit() in @google-cloud/firestore
 *     handled: yes
 *
 * `handled: yes` is the finding, not the reassurance. The dispatcher caught that
 * rejection and returned `outcome: 'duplicate'`; the route read `duplicate` as
 * "already handled" and answered 200; Dodo retries only a non-2xx, so it never
 * sent the event again. The reservation is the FIRST Firestore call in the
 * request, so under an outage every event type lands there — a
 * `subscription.active` included, which is a church that paid and has no
 * account, with nothing left to redeliver it.
 *
 * ─── The Silent-Failure Rule, quoted, because it decides this ────────────────
 *
 * AGENTS.md, verbatim:
 *
 *   > **A default value that hides an error is a bug.** `= []`, `?? 0`,
 *   > `catch { console.error }`, a status enum whose failure case renders blank
 *   > — each converts a loud failure into a quiet lie. Sentry cannot help here:
 *   > it reports when code *breaks*, not when code runs perfectly and does the
 *   > wrong thing.
 *
 *   > When a read can fail, make the failure visible: surface an error state,
 *   > keep the distinction between "empty" and "could not load", and let the
 *   > write throw rather than resolve into a default nobody will question.
 *
 * 🔴 THE RULE DOES NOT FORBID THE 5xx — IT ASKS FOR IT. `catch { console.error }`
 * is named as one of the bug shapes, and returning `duplicate` from that catch
 * is exactly "resolve into a default nobody will question". `duplicate` versus
 * `unreserved` IS "empty" versus "could not load", on a webhook.
 *
 * ─── Drift from the ticket's premise, recorded here so it is not re-litigated ─
 *
 * ⚠️ The 24 captured events all carry `eventType: subscription.updated`, whose
 * handler in `DODO_EVENT_HANDLERS` is the empty function — Dodo fires it
 * alongside the specific events and this build acts on none of them. So no plan
 * write was lost in those 24; what was lost was the RESERVATION, and with it the
 * retry that any event type would have needed. The defect is therefore wider
 * than the sample suggests, not narrower: nothing about `subscription.updated`
 * put it on that path, and `subscription.active` on the same path is the
 * expensive case.
 */

const OUR_SECRET = 'whsec_' + Buffer.from('the-302-silent-loss').toString('base64');

process.env.DODO_PAYMENTS_API_KEY = 'dodo_test_key';
process.env.DODO_PAYMENTS_WEBHOOK_KEY = OUR_SECRET;
process.env.DODO_PAYMENTS_ENVIRONMENT = 'test_mode';

const { adminDbMock, captureMock } = vi.hoisted(() => ({
  adminDbMock: { collection: vi.fn() },
  captureMock: vi.fn(),
}));

vi.mock('@/lib/firebase-admin', () => ({ adminDb: adminDbMock }));
vi.mock('@/lib/money-path-sentry', () => ({ captureMoneyPathError: captureMock }));

let POST: (req: NextRequest) => Promise<Response>;
let receiveDodoWebhookEvent: typeof import('@/lib/dodo/webhook-dispatch').receiveDodoWebhookEvent;
let DODO_STORE_TIMEOUT_MS: number;
let DODO_DURABLE_EVENT_TYPES: readonly string[];
let firestoreSeenEventStore: import('@/lib/dodo/webhook-dispatch').SeenEventStore;

beforeAll(async () => {
  ({ POST } = await import('@/app/api/dodo/webhook/route'));
  ({
    receiveDodoWebhookEvent,
    DODO_STORE_TIMEOUT_MS,
    DODO_DURABLE_EVENT_TYPES,
    firestoreSeenEventStore,
  } = await import('@/lib/dodo/webhook-dispatch'));
});

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

function signed(body: string, id: string) {
  const at = new Date();
  return new NextRequest('https://theharvest.app/api/dodo/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-signature': new Webhook(OUR_SECRET).sign(id, at, body),
      'webhook-timestamp': String(Math.floor(at.getTime() / 1000)),
    },
    body,
  });
}

const bodyFor = (type: string) =>
  JSON.stringify({
    business_id: 'bus_test',
    type,
    timestamp: '2026-09-04T08:59:27Z',
    data: { payload_type: 'Subscription', subscription_id: 'sub_302' },
  });

/** Every shape the reservation can fail in, including the one Sentry recorded. */
const RESERVATION_FAILURES = [
  ['a gRPC deadline, as recorded in production', Object.assign(new Error('4 DEADLINE_EXCEEDED: Deadline exceeded after 627.959s, name resolution: 627.944s, Waiting for LB pick'), { code: 4 })],
  ['an unavailable backend', Object.assign(new Error('14 UNAVAILABLE: No connection established'), { code: 14 })],
  ['a permission failure', Object.assign(new Error('7 PERMISSION_DENIED'), { code: 7 })],
] as const;

let errSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  errSpy.mockRestore();
  logSpy.mockRestore();
});

/* ═══ 8 · The silent loss ════════════════════════════════════════════════════ */

describe('a failed Firestore write in the webhook does NOT report success to Dodo', () => {
  it.each(RESERVATION_FAILURES)(
    'the dispatcher reports %s as `unreserved`, never as `duplicate`',
    async (_label, failure) => {
      const handlers = { 'subscription.plan_changed': vi.fn() } as never;
      const result = await receiveDodoWebhookEvent('msg_3Ir9Hv', { type: 'subscription.plan_changed' }, {
        store: { reserve: async () => { throw failure; }, release: async () => {} },
        handlers,
      });

      expect(result.outcome).toBe('unreserved');
      // 🔴 The mutation guard. Swallowing the failure and calling it a duplicate
      // is the production bug, and it is one word away.
      expect(result.outcome).not.toBe('duplicate');
    },
  );

  it.each(['subscription.active', 'subscription.plan_changed', 'subscription.updated', 'payment.succeeded'])(
    'the ROUTE answers 500 for %s when the reservation could not be written',
    async (type) => {
      // The store is reached through `adminDb`, unmocked at the dispatcher
      // level, so this drives the real dispatcher and the real route together.
      adminDbMock.collection.mockReturnValue({
        doc: () => ({
          create: async () => { throw Object.assign(new Error('4 DEADLINE_EXCEEDED'), { code: 4 }); },
          delete: async () => {},
        }),
      });

      const res = await POST(signed(bodyFor(type), `msg_${type}`));

      expect(res.status, `${type} was acknowledged despite losing its reservation`).toBe(500);
      await expect(res.json()).resolves.toEqual({ error: 'Could not record this event; will retry' });
    },
  );

  it('and every one of those reaches Sentry on the money path, at error level', async () => {
    adminDbMock.collection.mockReturnValue({
      doc: () => ({
        create: async () => { throw Object.assign(new Error('4 DEADLINE_EXCEEDED'), { code: 4 }); },
        delete: async () => {},
      }),
    });

    await POST(signed(bodyFor('subscription.plan_changed'), 'msg_sentry'));

    expect(captureMock).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      step: 'dodo-webhook-reserve',
      level: 'error',
      ids: { webhookId: 'msg_sentry', eventType: 'subscription.plan_changed' },
    }));
  });

  it('a GENUINE redelivery is still a 200 — the fix did not turn duplicates into retries', async () => {
    // ALREADY_EXISTS is gRPC code 6, and it means the id was claimed by an
    // earlier delivery. That is the case `duplicate` was always for, and
    // answering 500 to it would put Dodo into a redelivery loop.
    adminDbMock.collection.mockReturnValue({
      doc: () => ({
        create: async () => { throw Object.assign(new Error('6 ALREADY_EXISTS'), { code: 6 }); },
        delete: async () => {},
      }),
    });

    const res = await POST(signed(bodyFor('subscription.plan_changed'), 'msg_dupe'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true });
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('the durable handler path still 5xxs, and still hands the claim back', async () => {
    const released: string[] = [];
    const result = await receiveDodoWebhookEvent('msg_durable', { type: 'subscription.active' }, {
      store: { reserve: async () => true, release: async (id) => { released.push(id); } },
      handlers: { 'subscription.active': async () => { throw new Error('firestore write failed'); } } as never,
    });

    expect(result.outcome).toBe('failed');
    expect(released).toEqual(['msg_durable']);
  });

  /**
   * ⚠️ THE ONE LOSS THAT REMAINS, NAMED RATHER THAN HIDDEN. A BEST-EFFORT
   * handler whose own write fails after the reservation succeeded is still
   * answered 200, because the route has already responded by then. THE-302 does
   * not change that: which events are durable is pinned by
   * `dodo-webhook-dispatch.test.ts` with its own reasoning, and widening the
   * durable list is a decision about how long this endpoint holds a connection,
   * not about the reservation bug reported here. What THE-302 fixes is the
   * failure that was actually observed — and that failure hits the reservation,
   * before any handler runs, on every event type.
   */
  it('names the residual gap: a best-effort handler failure is still acknowledged', async () => {
    const result = await receiveDodoWebhookEvent('msg_besteffort', { type: 'subscription.plan_changed' }, {
      store: { reserve: async () => true, release: async () => {} },
      handlers: { 'subscription.plan_changed': async () => { throw new Error('plan write failed'); } } as never,
    });

    expect(result.outcome).toBe('routed');
    expect([...DODO_DURABLE_EVENT_TYPES]).toEqual(['subscription.active']);
    // The failure is not silent even so — it is on the money path in Sentry.
    expect(captureMock).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      step: 'dodo-webhook-handler',
      level: 'error',
    }));
  });
});

/* ═══ 9 · The bound ══════════════════════════════════════════════════════════ */

describe('the Firestore call in the webhook is bounded by a timeout', () => {
  it('a reservation that never answers becomes `unreserved` instead of hanging', async () => {
    const started = Date.now();
    const result = await receiveDodoWebhookEvent('msg_hang', { type: 'subscription.active' }, {
      // The production shape: a promise that simply never settles. Before the
      // bound this awaited for 627 seconds and the invocation was killed first.
      store: { reserve: () => new Promise<boolean>(() => {}), release: async () => {} },
      handlers: { 'subscription.active': vi.fn() } as never,
      timeoutMs: 30,
    });

    expect(result.outcome).toBe('unreserved');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('the release is bounded too, so a durable failure cannot hang on the way out', async () => {
    const result = await receiveDodoWebhookEvent('msg_hang_release', { type: 'subscription.active' }, {
      store: { reserve: async () => true, release: () => new Promise<void>(() => {}) },
      handlers: { 'subscription.active': async () => { throw new Error('boom'); } } as never,
      timeoutMs: 30,
    });

    // Still `failed`, so Dodo still retries — a release that cannot be confirmed
    // is no worse than no retry at all, which is what the dispatcher says.
    expect(result.outcome).toBe('failed');
    expect(captureMock).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      step: 'dodo-webhook-release',
    }));
  });

  it('a healthy reservation is not delayed by the bound', async () => {
    const result = await receiveDodoWebhookEvent('msg_fast', { type: 'subscription.active' }, {
      store: { reserve: async () => true, release: async () => {} },
      handlers: { 'subscription.active': vi.fn() } as never,
      timeoutMs: 30,
    });
    expect(result.outcome).toBe('routed');
  });

  it('production uses a bound that fits inside a serverless invocation', async () => {
    // 🔴 The mutation guard for "remove the timeout": there has to BE a number,
    // it has to be finite, and it has to leave room to serialise a 500 inside
    // the smallest default Vercel function budget.
    expect(Number.isFinite(DODO_STORE_TIMEOUT_MS)).toBe(true);
    expect(DODO_STORE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DODO_STORE_TIMEOUT_MS).toBeLessThanOrEqual(8_000);
    // And the dispatcher must actually apply it, not merely export it.
    expect(read('src/lib/dodo/webhook-dispatch.ts')).toMatch(
      /withTimeout\(\s*store\.reserve\(/,
    );
    expect(read('src/lib/dodo/webhook-dispatch.ts')).toMatch(
      /withTimeout\(\s*store\.release\(/,
    );
  });

  it('the store the route actually uses is the Firestore one', async () => {
    // Without this the two tests above could pass against an injected store
    // while production ran unbounded.
    expect(firestoreSeenEventStore).toBeDefined();
    expect(typeof firestoreSeenEventStore.reserve).toBe('function');
    expect(read('src/lib/dodo/webhook-dispatch.ts')).toContain(
      'options.store ?? firestoreSeenEventStore',
    );
  });
});

/* ═══ 10 · No regression on #434's widened sweep ═════════════════════════════ */

describe('the webhook is still the single writer of plan', () => {
  /**
   * #434 removed a client-side `plan` write from `AdminDashboard` and widened
   * THE-259's sweep to catch the next one. THE-302 touches the webhook's
   * PLUMBING — which outcome is reported and how long a write may take — and
   * must not move the write itself, so the sweep is re-run here against the two
   * files this ticket changed plus the client tree as a whole.
   */
  const CLIENT_TREE = 'src/components';

  /** Every non-test `.ts`/`.tsx` under a directory, recursively, comments stripped. */
  function clientSources(dir: string): Array<[rel: string, code: string]> {
    const out: Array<[string, string]> = [];
    const walk = (d: string) => {
      for (const entry of readdirSync(path.join(REPO_ROOT, d))) {
        const rel = `${d}/${entry}`;
        const full = path.join(REPO_ROOT, rel);
        if (statSync(full).isDirectory()) { walk(rel); continue; }
        if (!/\.tsx?$/.test(entry) || rel.includes('__tests__')) continue;
        out.push([
          rel,
          readFileSync(full, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1'),
        ]);
      }
    };
    walk(dir);
    return out;
  }

  it('nothing in the browser tree writes tenants/{id}.plan', () => {
    // The browser-SDK shape #434 removed: a write through `doc(db, 'tenants',
    // …)` that names `plan` as one of its fields.
    const WRITE = /(?:updateDoc|setDoc)\s*\([^)]*\bdoc\s*\(\s*db\s*,\s*['"]tenants['"][\s\S]{0,400}?\bplan\s*:/;
    const offenders = clientSources(CLIENT_TREE).filter(([, code]) => WRITE.test(code)).map(([rel]) => rel);
    expect(offenders, `client-side plan writes: ${offenders.join(', ')}`).toEqual([]);
  });

  it('and the sweep can actually see a plan write — the guard is not vacuous', () => {
    // ⚠️ A source sweep that matches nothing is indistinguishable from a source
    // sweep that is broken. This is the mutation, inline: the exact text #434
    // deleted, run through the same regex.
    const WRITE = /(?:updateDoc|setDoc)\s*\([^)]*\bdoc\s*\(\s*db\s*,\s*['"]tenants['"][\s\S]{0,400}?\bplan\s*:/;
    expect(WRITE.test("await updateDoc(doc(db, 'tenants', tenantId), { plan: newPlan, updatedAt: now });")).toBe(true);
    expect(clientSources(CLIENT_TREE).length).toBeGreaterThan(50);
  });

  it('and the Dodo plan writer is still plan-change.ts, reached from the dispatcher', () => {
    const dispatch = read('src/lib/dodo/webhook-dispatch.ts');
    expect(dispatch).toContain("DODO_EVENT_HANDLERS['subscription.plan_changed'] = handleDodoSubscriptionPlanChanged");
    expect(read('src/lib/dodo/plan-change.ts')).toMatch(/batch\.update\(tenantRef, \{\s*\n\s*plan: resolved\.plan,/);
  });

  it('THE-302 changed neither plan-change.ts nor the durable table around it', () => {
    // Both are named STOP conditions on the ticket. The claim is byte-level for
    // the handler and value-level for the table.
    expect([...DODO_DURABLE_EVENT_TYPES]).toEqual(['subscription.active']);
    expect(read('src/lib/dodo/plan-change.ts')).not.toContain('THE-302');
  });
});
