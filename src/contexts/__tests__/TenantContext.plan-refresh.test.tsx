import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * THE-217 — after paying, an admin sat on the plan they were on before.
 *
 * `planInitialized` is a ONE-SHOT LATCH and it had no refresh counterpart. The
 * return hop from a checkout is a full page load, so the tenant doc is read
 * exactly once, racing the `subscription.active` webhook. When the webhook lost
 * that race the latch closed on the pre-purchase tier and nothing ever re-opened
 * it — no error, no spinner, no retry. The product simply looked like the
 * payment had not worked, and the natural response to that is to pay again.
 *
 * The add-on side had already solved this: `setTenantAddons` has
 * `refreshTenantAddons` beside it. The plan side had `setTenantPlan` and
 * nothing. This is the missing half, plus the one arrival that arms it.
 *
 * 🔴 THE DIRECTION MATTERS. This is UNDER-granting after a charge, so every
 * failure path below is asserted to leave the last known tier ALONE. A refresh
 * that could downgrade a church on a dropped request would be a worse bug than
 * the one it replaces.
 *
 * Driven through the REAL `TenantProvider` and the REAL `getEffectiveFeatures`.
 * Only Firebase and the platform-override read are mocked.
 */

const { mockGetDoc } = vi.hoisted(() => ({ mockGetDoc: vi.fn() }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, coll: string, id: string) => ({ coll, id }),
  getDoc: (...args: any[]) => mockGetDoc(...args),
}));
vi.mock('../../firebase', () => ({ db: {} }));

const { mockHasPlatformOverride } = vi.hoisted(() => ({
  mockHasPlatformOverride: vi.fn(() => false),
}));
vi.mock('../../utils/tenant-scope', () => ({
  hasPlatformOverride: () => mockHasPlatformOverride(),
}));

import {
  TenantProvider,
  useTenant,
  PLAN_REFRESH_ATTEMPTS,
  PLAN_REFRESH_INTERVAL_MS,
  type TenantContextValue,
} from '../TenantContext';
import { NO_ADDONS, getPlanFeatures } from '../../utils/plan-features';

const TENANT = 'grace-chapel';

/** The tenant document every read returns, until it is replaced. */
function tenantDoc(data: Record<string, unknown>) {
  mockGetDoc.mockResolvedValue({ exists: () => true, data: () => data });
}

/** A different document per tenant id — for the second validation pass. */
function tenantDocsById(byId: Record<string, Record<string, unknown> | null>) {
  mockGetDoc.mockImplementation(async (ref: { id: string }) => {
    const data = byId[ref.id];
    return data === null || data === undefined
      ? { exists: () => false, data: () => undefined }
      : { exists: () => true, data: () => data };
  });
}

/** The context, captured from inside a real render. */
let seen: TenantContextValue | null = null;

const Probe: React.FC = () => {
  seen = useTenant();
  return null;
};

let container: HTMLDivElement;
let root: Root;

async function renderProvider(tenantId: string | null = TENANT) {
  await act(async () => {
    root.render(
      <TenantProvider initialTenantId={tenantId}>
        <Probe />
      </TenantProvider>,
    );
  });
}

/** The hop back from a payment — what arms the bounded re-read. */
function arriveFromCheckout(flag: 'dodo' | 'stripe' = 'dodo') {
  window.history.replaceState({}, '', `/admin?${flag}=success`);
}

/** Let the whole bounded window elapse, and then some. */
async function runOutTheWindow(multiplier = 3) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(
      PLAN_REFRESH_INTERVAL_MS * (PLAN_REFRESH_ATTEMPTS + 1) * multiplier,
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHasPlatformOverride.mockReturnValue(false);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  seen = null;
  window.history.replaceState({}, '', '/admin');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── Test 1 ───────────────────────────────────────────────────────────────────

describe('a plan that arrives after the first read is picked up without a reload', () => {
  it('applies what the webhook actually wrote, in the same mounted tree', async () => {
    // The read that lost the race: the church has paid, the webhook has not
    // landed, and the tier on the document is still the one they were on.
    tenantDoc({ plan: 'free', status: 'active' });
    await renderProvider();
    expect(seen?.tenantPlan).toBe('free');

    // The webhook — the single writer — has now recorded the purchase.
    tenantDoc({ plan: 'pro', status: 'active' });
    await act(async () => { await seen?.refreshTenantPlan(); });

    // 🔴 Same tree, no remount, no reload: the tier moved in place, and the
    // capability matrix moved with it.
    expect(seen?.tenantPlan).toBe('pro');
    expect(seen?.planFeatures?.maxAdmins).toBe(getPlanFeatures('pro').maxAdmins);
  });

  it('re-reads rather than applying what the purchase asked for', async () => {
    tenantDoc({ plan: 'free', status: 'active' });
    await renderProvider();

    const readsBefore = mockGetDoc.mock.calls.length;
    tenantDoc({ plan: 'pro', status: 'active' });
    await act(async () => { await seen?.refreshTenantPlan(); });

    // 🔴 `on_payment_failure: 'prevent_change'` means Dodo decides whether a
    // change took AFTER the payment, so the purchase route cannot know what the
    // church ended up owning. What is shown always came from the writer, which
    // is why this costs a read.
    expect(mockGetDoc.mock.calls.length).toBe(readsBefore + 1);
  });

  it('🔴 the checkout return hop picks it up on its own — no reload, no user action', async () => {
    vi.useFakeTimers();
    arriveFromCheckout();
    tenantDoc({ plan: 'free', status: 'active' });
    await renderProvider();

    // The whole defect, on screen: paid, and looking at the free dashboard.
    expect(seen?.tenantPlan).toBe('free');

    // The webhook lands a moment later. Nobody reloads anything.
    tenantDoc({ plan: 'pro', status: 'active' });
    await act(async () => { await vi.advanceTimersByTimeAsync(PLAN_REFRESH_INTERVAL_MS); });

    expect(seen?.tenantPlan).toBe('pro');
  });

  it('recognises both spellings of the hop, exactly as the gate does', async () => {
    vi.useFakeTimers();
    arriveFromCheckout('stripe');
    tenantDoc({ plan: 'plus', status: 'active' });
    await renderProvider();

    tenantDoc({ plan: 'max', status: 'active' });
    await act(async () => { await vi.advanceTimersByTimeAsync(PLAN_REFRESH_INTERVAL_MS); });

    // A payer mid-checkout when the processor flag flipped comes back carrying
    // the other processor's marker. Failing to recognise it would leave exactly
    // the church this ticket is about on the tier they were on.
    expect(seen?.tenantPlan).toBe('max');
  });

  it('the latch does not undo the refresh', async () => {
    tenantDoc({ plan: 'free', status: 'active' });
    await renderProvider();

    tenantDoc({ plan: 'pro', status: 'active' });
    await act(async () => { await seen?.refreshTenantPlan(); });
    expect(seen?.tenantPlan).toBe('pro');

    // A later validation pass must not overwrite the newer value with the one it
    // read first — the same guarantee `addonsInitialized` gives the add-on set,
    // and what lets a purchase surface rely on the refresh sticking.
    tenantDoc({ plan: 'free', status: 'active' });
    await renderProvider();

    expect(seen?.tenantPlan).toBe('pro');
  });
});

// ── Test 2 ───────────────────────────────────────────────────────────────────

describe('the retry is bounded', () => {
  it('the bound is a named, finite limit', () => {
    // 🔴 Asserted BY NAME. A test that wrote `5` would keep passing while the
    // window drifted underneath it.
    expect(Number.isInteger(PLAN_REFRESH_ATTEMPTS)).toBe(true);
    expect(PLAN_REFRESH_ATTEMPTS).toBeGreaterThan(0);
    expect(PLAN_REFRESH_ATTEMPTS).toBeLessThanOrEqual(10);
    expect(Number.isFinite(PLAN_REFRESH_INTERVAL_MS)).toBe(true);
    expect(PLAN_REFRESH_INTERVAL_MS).toBeGreaterThan(0);
  });

  it('🔴 stops after PLAN_REFRESH_ATTEMPTS reads even when the tier never moves', async () => {
    vi.useFakeTimers();
    arriveFromCheckout();
    // The webhook never lands. An unbounded poll would read forever, on every
    // dashboard load that carries the marker — a cost and a rate-limit problem
    // rather than a fix.
    tenantDoc({ plan: 'free', status: 'active' });
    await renderProvider();

    const afterFirstRead = mockGetDoc.mock.calls.length;
    await runOutTheWindow(5);

    expect(mockGetDoc.mock.calls.length).toBe(afterFirstRead + PLAN_REFRESH_ATTEMPTS);
  });

  it('stops early the moment the writer answers', async () => {
    vi.useFakeTimers();
    arriveFromCheckout();
    tenantDoc({ plan: 'free', status: 'active' });
    await renderProvider();

    const afterFirstRead = mockGetDoc.mock.calls.length;
    tenantDoc({ plan: 'pro', status: 'active' });
    await runOutTheWindow(5);

    // One re-read learned the answer; the window closes rather than spending the
    // rest of its budget confirming it.
    expect(mockGetDoc.mock.calls.length).toBe(afterFirstRead + 1);
    expect(seen?.tenantPlan).toBe('pro');
  });

  it('stops when the tree unmounts mid-window', async () => {
    vi.useFakeTimers();
    arriveFromCheckout();
    tenantDoc({ plan: 'free', status: 'active' });
    await renderProvider();

    await act(async () => { await vi.advanceTimersByTimeAsync(PLAN_REFRESH_INTERVAL_MS); });
    const beforeUnmount = mockGetDoc.mock.calls.length;
    await act(async () => { root.unmount(); });
    root = createRoot(container);

    await runOutTheWindow(5);

    // A timer firing into an unmounted tree is a Firestore read nobody will use.
    expect(mockGetDoc.mock.calls.length).toBe(beforeUnmount);
  });
});

// ── Test 3 ───────────────────────────────────────────────────────────────────

describe('a failed refresh leaves the last known plan in place', () => {
  it('a rejected read never downgrades', async () => {
    tenantDoc({ plan: 'pro', status: 'active' });
    await renderProvider();

    mockGetDoc.mockRejectedValue(new Error('offline'));
    await act(async () => { await seen?.refreshTenantPlan(); });

    // 🔴 Falling back to a default on a dropped request would strip a tier a
    // church pays for — the exact direction this ticket exists to stop.
    expect(seen?.tenantPlan).toBe('pro');
    expect(seen?.planFeatures?.maxAdmins).toBe(getPlanFeatures('pro').maxAdmins);
  });

  it('a document with no plan field never downgrades', async () => {
    tenantDoc({ plan: 'pro', status: 'active' });
    await renderProvider();

    tenantDoc({ status: 'active' });
    await act(async () => { await seen?.refreshTenantPlan(); });

    // An absent `plan` is silence, not "free" — the same reading the latch takes.
    expect(seen?.tenantPlan).toBe('pro');
  });

  it('a missing document never downgrades', async () => {
    tenantDoc({ plan: 'pro', status: 'active' });
    await renderProvider();

    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
    await act(async () => { await seen?.refreshTenantPlan(); });

    expect(seen?.tenantPlan).toBe('pro');
  });

  it('a failed attempt costs one attempt, not the window', async () => {
    vi.useFakeTimers();
    arriveFromCheckout();
    tenantDoc({ plan: 'free', status: 'active' });
    await renderProvider();

    const afterFirstRead = mockGetDoc.mock.calls.length;
    mockGetDoc.mockRejectedValue(new Error('offline'));
    await runOutTheWindow(5);

    // A dropped request teaches nothing, so the window keeps its shape: the
    // remaining attempts still run, and the bound still holds.
    expect(mockGetDoc.mock.calls.length).toBe(afterFirstRead + PLAN_REFRESH_ATTEMPTS);
    expect(seen?.tenantPlan).toBe('free');
  });
});

// ── Test 4 ───────────────────────────────────────────────────────────────────

/**
 * 🔴 NO CLIENT-SIDE WRITE TO `plan`, ANYWHERE UNDER `src/`.
 *
 * The webhook is the single writer, and that rule has held through every money
 * PR in this repo. It is asserted as a SWEEP rather than a spot check because a
 * guard scoped to one file cannot see the second copy — the whole reason
 * `removed-claims.test.ts` is directory-scoped.
 *
 * Scoped to the BROWSER SDK: a file only counts if it imports from
 * `firebase/firestore`. Server code writes the tier through `firebase-admin`
 * (`lib/dodo/plan-change.ts`, the Stripe webhook, `free-provisioning`) and is
 * supposed to.
 */
const SRC = path.resolve(__dirname, '../..');
const REPO = path.resolve(SRC, '..');
const CODE_EXT = new Set(['.ts', '.tsx']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (CODE_EXT.has(path.extname(entry))) {
      out.push(path.relative(REPO, full).split(path.sep).join('/'));
    }
  }
  return out;
}

/** Comments removed, so an explanation of the rule cannot trip the rule. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}

const CLIENT_WRITES = ['setDoc', 'updateDoc', 'addDoc'] as const;

/** Every argument list passed to `fn`, paren-balanced rather than regex-guessed. */
function callArguments(source: string, fn: string): string[] {
  const found: string[] = [];
  const opener = new RegExp(`\\b${fn}\\s*\\(`, 'g');
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < source.length && depth > 0) {
      const c = source[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    found.push(source.slice(match.index + match[0].length, i - 1));
  }
  return found;
}

/** A `plan` object key, or `plan` passed as an update field path. */
const WRITES_PLAN = /(^|[{,\s])(['"`]?)plan\2\s*:/;
const PLAN_FIELD_PATH = /(^|[,(\s])(['"`])plan\2\s*,/;

/** Which client-SDK writes in this source carry a `plan` field. Empty = clean. */
function planWritesIn(source: string): string[] {
  const clean = stripComments(source);
  if (!/from\s+['"]firebase\/firestore['"]/.test(clean)) return [];
  const offences: string[] = [];
  for (const fn of CLIENT_WRITES) {
    for (const args of callArguments(clean, fn)) {
      if (WRITES_PLAN.test(args) || PLAN_FIELD_PATH.test(args)) {
        offences.push(`${fn}(${args.trim().slice(0, 80)}…)`);
      }
    }
  }
  return offences;
}

const CLIENT_FILES = walk(SRC).filter((f) => !f.includes('__tests__'));

describe('no client-side write to plan exists', () => {
  it('the sweep actually sweeps', () => {
    // Guards the walker: a broken path or a too-narrow extension set would make
    // the assertion below pass vacuously.
    expect(CLIENT_FILES.length).toBeGreaterThan(200);
    expect(CLIENT_FILES).toContain('src/contexts/TenantContext.tsx');
  });

  it('the detector catches a planted violation', () => {
    // A sweep nobody has proven can fail is not a guard.
    const planted = `import { doc, updateDoc } from 'firebase/firestore';
      await updateDoc(doc(db, 'tenants', id), { plan: 'pro', updatedAt: now });`;
    expect(planWritesIn(planted).length).toBe(1);

    const fieldPath = `import { updateDoc } from 'firebase/firestore';
      await updateDoc(ref, 'plan', 'pro');`;
    expect(planWritesIn(fieldPath).length).toBe(1);

    // …and does not fire on a comment that merely discusses the rule, nor on
    // the add-on set the webhook also owns.
    const innocent = `import { updateDoc } from 'firebase/firestore';
      // never write { plan: 'pro' } from the client
      await updateDoc(ref, { addons: owned, updatedAt: now });`;
    expect(planWritesIn(innocent)).toEqual([]);
  });

  it('🔴 no file under src/ writes plan through the browser SDK', () => {
    const offenders = CLIENT_FILES.map((f) => ({
      file: f,
      offences: planWritesIn(readFileSync(path.join(REPO, f), 'utf8')),
    })).filter((r) => r.offences.length > 0);

    expect(
      offenders.map((o) => `${o.file}: ${o.offences.join(', ')}`),
      'the webhook is the single writer of `plan`',
    ).toEqual([]);
  });

  it('the fix itself writes nothing', () => {
    const source = readFileSync(path.join(REPO, 'src/contexts/TenantContext.tsx'), 'utf8');
    expect(planWritesIn(source)).toEqual([]);
    // The context imports only the read half of the SDK.
    expect(stripComments(source)).not.toMatch(/\b(setDoc|updateDoc|addDoc)\b/);
  });
});

// ── Test 5 ───────────────────────────────────────────────────────────────────

const CONTEXT_SOURCE = stripComments(
  readFileSync(path.join(REPO, 'src/contexts/TenantContext.tsx'), 'utf8'),
);

describe('the add-on latch still guards on the READ', () => {
  it('the guard is `!addonsInitialized.current` alone — no presence check bolted on', () => {
    // An ABSENT `addons` field is a real answer ("owns nothing"), which is what
    // every tenant created before REP-5a genuinely owns. Guarding on presence
    // would leave exactly those tenants permanently unlatched.
    expect(CONTEXT_SOURCE).toMatch(/if\s*\(\s*!addonsInitialized\.current\s*\)\s*\{/);
    expect(CONTEXT_SOURCE).not.toMatch(/!addonsInitialized\.current\s*&&/);
  });

  it('a tenant document with no addons field still latches on the read', async () => {
    tenantDoc({ plan: 'pro', status: 'active' });
    await renderProvider();

    expect(seen?.tenantAddons).toEqual(NO_ADDONS);

    // The plan refresh is the only thing this ticket added, and it moves the
    // tier alone — the add-on set is untouched by it.
    tenantDoc({ plan: 'max', status: 'active', addons: { ...NO_ADDONS, adminSeats: 5 } });
    await act(async () => { await seen?.refreshTenantPlan(); });

    expect(seen?.tenantPlan).toBe('max');
    expect(seen?.tenantAddons).toEqual(NO_ADDONS);
  });
});

// ── Test 6 ───────────────────────────────────────────────────────────────────

describe('tenantStatus and stripeConnectStatus are still unconditional', () => {
  it('neither setter sits behind a latch', () => {
    expect(CONTEXT_SOURCE).toMatch(/^\s*setTenantStatus\(data\.status as/m);
    expect(CONTEXT_SOURCE).toMatch(/^\s*setStripeConnectStatus\(data\.stripeConnectStatus as/m);
    expect(CONTEXT_SOURCE).not.toMatch(/statusInitialized|connectInitialized/);
  });

  it('🔴 both move on a re-read while the latched tier does not', async () => {
    tenantDocsById({
      [TENANT]: { plan: 'pro', status: 'active', stripeConnectStatus: 'active' },
      'second-church': { plan: 'plus', status: 'archived', stripeConnectStatus: 'pending' },
    });
    await renderProvider(TENANT);
    expect(seen?.tenantStatus).toBe('active');
    expect(seen?.stripeConnectStatus).toBe('active');

    await renderProvider('second-church');

    // A stale 'active' is the one value that must not stick, on either field.
    expect(seen?.tenantStatus).toBe('archived');
    expect(seen?.stripeConnectStatus).toBe('pending');
    // …and the tier is still latched, exactly as before this change.
    expect(seen?.tenantPlan).toBe('pro');
  });
});

// ── Test 7 ───────────────────────────────────────────────────────────────────

describe('nothing refreshes in platform context, where tenantId is null', () => {
  it('the bounded re-read never arms, even on the checkout hop', async () => {
    vi.useFakeTimers();
    mockHasPlatformOverride.mockReturnValue(true);
    arriveFromCheckout();
    tenantDoc({ plan: 'pro', status: 'active' });

    await renderProvider(null);
    await runOutTheWindow(5);

    // 🔴 `getTenantScope()` returns null for a super admin and null is NOT "all
    // tenants". There is no tenant to re-read a tier against, so there is no
    // read to make.
    expect(mockGetDoc).not.toHaveBeenCalled();
    expect(seen?.tenantId).toBeNull();
  });

  it('refreshTenantPlan called directly in platform context reads nothing', async () => {
    mockHasPlatformOverride.mockReturnValue(true);
    await renderProvider(null);

    await act(async () => { await seen?.refreshTenantPlan(); });

    expect(mockGetDoc).not.toHaveBeenCalled();
  });
});

// ── Test 8 ───────────────────────────────────────────────────────────────────

describe('an admin who was already on the correct plan sees no extra reads', () => {
  it('🔴 an ordinary dashboard load costs exactly one read', async () => {
    vi.useFakeTimers();
    tenantDoc({ plan: 'pro', status: 'active' });
    await renderProvider();

    await runOutTheWindow(5);

    // No payment behind this arrival, so nothing arms. An unbounded poll — or a
    // poll armed on every load — would put a permanent Firestore cost on every
    // admin in the platform to cover a race that only exists after a checkout.
    expect(mockGetDoc.mock.calls.length).toBe(1);
    expect(seen?.tenantPlan).toBe('pro');
  });

  it('the tier the first read found is left exactly where it is', async () => {
    vi.useFakeTimers();
    tenantDoc({ plan: 'max', status: 'active' });
    await renderProvider();

    await runOutTheWindow(5);

    expect(seen?.tenantPlan).toBe('max');
    expect(seen?.planFeatures?.maxAdmins).toBe(getPlanFeatures('max').maxAdmins);
  });
});
