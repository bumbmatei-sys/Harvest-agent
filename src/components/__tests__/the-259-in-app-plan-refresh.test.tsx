import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-259 — an in-app plan change never armed the refresh, and reloaded anyway.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * THE-217 gave the plan latch the refresh counterpart it never had, but armed it
 * from ONE arrival: the hop back from a checkout. `arrivedFromCheckout` is a
 * `useState` initialiser read once at mount, so nothing on the context could
 * open the window after mount.
 *
 * An in-app plan change never takes that hop. Both callers did this instead:
 *
 *     if (result.ok) { alert(result.message); window.location.reload(); }
 *
 * The reloaded URL carries no `dodo=success`, so `arrivedFromCheckout` was false
 * on the far side too, the window never armed, and the admin landed on the tier
 * they were on BEFORE they paid — the exact defect THE-217 exists to fix,
 * reached through a different door. A church has just been charged.
 *
 * 🔴 A ONE-SHOT `refreshTenantPlan()` IS NOT THE FIX, and this suite is written
 * to prove it. `runDodoPlanChange` resolves when Dodo ACCEPTED the change, not
 * when the `plan_changed` webhook has written `plan` — `on_payment_failure:
 * 'prevent_change'` means Dodo decides after the payment. A single re-read fired
 * on resolution lands early and reads the old tier. What survives that race is
 * the bounded window, so the window is what gets armed.
 *
 * Driven through the REAL `AdminUpgradePage`, the REAL `runDodoPlanChange` and
 * the REAL `TenantProvider`. Only Firebase, `authFetch` and the tenant-id
 * resolver are mocked.
 */

const TENANT = 'grace-chapel';

const { mockGetDoc } = vi.hoisted(() => ({ mockGetDoc: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, coll: string, id: string) => ({ coll, id }),
  getDoc: (...args: any[]) => mockGetDoc(...args),
}));
vi.mock('../../firebase', () => ({ db: {} }));

const { mockHasPlatformOverride } = vi.hoisted(() => ({
  mockHasPlatformOverride: vi.fn(() => false),
}));
vi.mock('../../utils/tenant-scope', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasPlatformOverride: () => mockHasPlatformOverride(),
}));

/** Every request the client makes, in order — the wire, for the THE-226 pin. */
const { calls, wire } = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; method: string; body: any }>,
  wire: { termOnServer: 'monthly' as string, subscriptionPlan: null as string | null },
}));

vi.mock('../../utils/auth-fetch', () => ({
  authFetch: async (url: string, init?: any) => {
    const method = init?.method || 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body) : undefined });

    if (url === '/api/billing/invoices') {
      return {
        ok: true,
        json: async () => ({
          processor: 'dodo',
          // `subscription.plan` is read straight off `tenants/{id}.plan` by the
          // route — the SAME field the context re-reads. Fetched once, at mount.
          subscription: wire.subscriptionPlan
            ? { plan: wire.subscriptionPlan, status: 'active' }
            : null,
          invoices: [],
          historySource: 'portal',
        }),
      } as any;
    }
    if (url.startsWith('/api/dodo/change-plan?')) {
      return { ok: true, json: async () => ({ plan: 'plus', billing: wire.termOnServer }) } as any;
    }
    if (url === '/api/dodo/change-plan' && method === 'POST') {
      const body = JSON.parse(init.body);
      return body.confirm
        ? { ok: true, json: async () => ({ ok: true, message: 'Your plan change is confirmed.' }) } as any
        : {
            ok: true,
            json: async () => ({
              preview: { amountDueNow: 2000, creditMovement: 0, currency: 'USD', addOnsRemoved: [] },
            }),
          } as any;
    }
    if (url === '/api/dodo/first-subscription') {
      return { ok: true, json: async () => ({ url: 'https://checkout.dodo.test/session' }) } as any;
    }
    return { ok: false, json: async () => ({ error: 'unexpected call' }) } as any;
  },
}));

vi.mock('../settings/useTenantId', () => ({ getTenantId: async () => TENANT }));

import {
  TenantProvider,
  useTenant,
  PLAN_REFRESH_ATTEMPTS,
  PLAN_REFRESH_INTERVAL_MS,
  type TenantContextValue,
} from '../../contexts/TenantContext';
import { isReturningFromCheckout } from '../../utils/signup-checkout';
import AdminUpgradePage from '../AdminUpgradePage';
import BillingAndPayments from '../BillingAndPayments';

/** The tenant document every read returns, until it is replaced. */
function tenantDoc(data: Record<string, unknown>) {
  mockGetDoc.mockResolvedValue({ exists: () => true, data: () => data });
}

/**
 * The webhook lands only after `afterReads` further reads have been served —
 * how a writer that is slower than the call's resolution is modelled.
 */
function webhookLandsAfter(afterReads: number, before: Record<string, unknown>, after: Record<string, unknown>) {
  let served = 0;
  mockGetDoc.mockImplementation(async () => {
    const data = served++ < afterReads ? before : after;
    return { exists: () => true, data: () => data };
  });
}

let seen: TenantContextValue | null = null;
const Probe: React.FC = () => {
  seen = useTenant();
  return null;
};

let container: HTMLDivElement;
let root: Root;

/** The real upgrade page, under the real provider. */
async function renderUpgradePage(tenantId: string | null = TENANT, currentPlan: any = 'plus') {
  await act(async () => {
    root.render(
      <TenantProvider initialTenantId={tenantId}>
        <Probe />
        <AdminUpgradePage currentPlan={currentPlan} tenantId={tenantId ?? undefined} onBack={() => {}} />
      </TenantProvider>,
    );
  });
}

/** The provider alone — for the arming API and the checkout-hop regressions. */
async function renderProvider(tenantId: string | null = TENANT) {
  await act(async () => {
    root.render(
      <TenantProvider initialTenantId={tenantId}>
        <Probe />
      </TenantProvider>,
    );
  });
}

/** Drain the promise chain inside a click handler without moving the window. */
async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(5); });
}

/** Press a plan button by its visible label, then let its handler finish. */
async function press(label: RegExp) {
  const button = [...container.querySelectorAll('button')]
    .find((b) => label.test(b.textContent || '')) as HTMLButtonElement | undefined;
  expect(button, `no button matching ${label}`).toBeTruthy();
  await act(async () => { button!.click(); });
  await settle();
}

/**
 * The tier `BillingAndPayments` is actually SHOWING, read off its "Current
 * Plan" card.
 *
 * Not `container.textContent`: the upgrade cards below name every tier on the
 * price list, so a substring search finds "Small Team" whatever the page thinks
 * the church is on — a test that cannot fail.
 */
function currentPlanLabel(): string {
  const heading = [...container.querySelectorAll('span')]
    .find((el) => el.textContent?.trim() === 'Current Plan');
  const card = heading?.closest('div.bg-surface-raised');
  return card?.querySelector('.text-2xl')?.textContent?.trim() ?? '';
}

/** Let the whole bounded window elapse, and then some. */
async function runOutTheWindow(multiplier = 3) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(
      PLAN_REFRESH_INTERVAL_MS * (PLAN_REFRESH_ATTEMPTS + 1) * multiplier,
    );
  });
}

/** The hop back from a payment — what armed the window before this ticket. */
function arriveFromCheckout(flag: 'dodo' | 'stripe' = 'dodo') {
  window.history.replaceState({}, '', `/admin?${flag}=success`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  calls.length = 0;
  wire.termOnServer = 'monthly';
  wire.subscriptionPlan = null;
  mockHasPlatformOverride.mockReturnValue(false);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('confirm', () => true);
  vi.stubGlobal('alert', () => {});
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Test 1 ───────────────────────────────────────────────────────────────────

describe('an in-app plan change reflects the new tier without a manual reload', () => {
  it('🔴 the whole ticket: press Upgrade, and the tier moves in the mounted tree', async () => {
    // The church is on Individual and presses Upgrade to Small Team.
    tenantDoc({ plan: 'plus', status: 'active' });
    await renderUpgradePage();
    expect(seen?.tenantPlan).toBe('plus');

    await press(/Upgrade to Small Team/i);

    // Dodo accepted the change; the webhook — the single writer — records it.
    tenantDoc({ plan: 'pro', status: 'active' });
    await act(async () => { await vi.advanceTimersByTimeAsync(PLAN_REFRESH_INTERVAL_MS); });

    // 🔴 Same tree, no remount, no reload, no user action: the tier moved.
    expect(seen?.tenantPlan).toBe('pro');
  });

  it('🔴 neither in-app caller reloads the page any more', () => {
    // The behavioural test above cannot see a reload: jsdom's `reload` is inert,
    // so a caller that still called it would simply never update. This names the
    // line that was removed, in both files, so it cannot come back quietly.
    for (const file of ['src/components/AdminUpgradePage.tsx', 'src/components/settings/PlanUpgradeSection.tsx']) {
      const source = stripComments(readFileSync(path.join(REPO, file), 'utf8'));
      expect(source, `${file} still reloads to learn one field`).not.toMatch(/location\s*\.\s*reload\s*\(/);
      // …and arms the shared window instead.
      expect(source, `${file} does not arm the re-read`).toMatch(/armPlanRefresh\s*\(\s*\)/);
    }
  });

  it('🔴 the billing page follows the live tier, not the snapshot the reload used to refresh', async () => {
    // ─── WHAT THE RELOAD WAS REALLY DOING ON THIS PAGE ────────────────────
    // `PlanUpgradeSection` renders under `BillingAndPayments`, which fetches
    // `/api/billing/invoices` ONCE, at mount, and took `subscription.plan` —
    // the same `tenants/{id}.plan`, read server-side — ahead of the live tier.
    // Drop the reload without following the context and the bounded re-read
    // would move the tier while this card kept rendering the pre-purchase one.
    wire.subscriptionPlan = 'plus';
    tenantDoc({ plan: 'plus', status: 'active' });

    await act(async () => {
      root.render(
        <TenantProvider initialTenantId={TENANT}>
          <Probe />
          <BillingAndPayments currentPlan="plus" tenantId={TENANT} />
        </TenantProvider>,
      );
    });
    await settle();
    expect(currentPlanLabel()).toBe('Individual');

    // The webhook records the purchase and the window picks it up.
    tenantDoc({ plan: 'pro', status: 'active' });
    await act(async () => { seen?.armPlanRefresh(); });
    await runOutTheWindow();

    expect(seen?.tenantPlan).toBe('pro');
    // The snapshot still says 'plus'; the page must not.
    expect(wire.subscriptionPlan).toBe('plus');
    expect(currentPlanLabel()).toBe('Small Team');
  });

  it('the billing page falls back to the snapshot when the context has no tier', async () => {
    // Platform context, or a tier that has not loaded: the chain is exactly
    // what it was before this ticket. The live value wins only when it exists.
    wire.subscriptionPlan = 'max';
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined });

    await act(async () => {
      root.render(
        <TenantProvider initialTenantId={null}>
          <Probe />
          <BillingAndPayments currentPlan={undefined} tenantId={undefined} />
        </TenantProvider>,
      );
    });
    await settle();

    expect(seen?.tenantPlan).toBeUndefined();
    expect(currentPlanLabel()).toBe('Ministry');
  });

  it('the capability matrix moves with the tier, not just the label', async () => {
    tenantDoc({ plan: 'plus', status: 'active' });
    await renderUpgradePage();
    const before = seen?.planFeatures?.maxAdmins;

    await press(/Upgrade to Small Team/i);
    tenantDoc({ plan: 'pro', status: 'active' });
    await act(async () => { await vi.advanceTimersByTimeAsync(PLAN_REFRESH_INTERVAL_MS); });

    // A tier that moves without its entitlements is a label, not an upgrade.
    expect(seen?.planFeatures?.maxAdmins).not.toBe(before);
    expect(seen?.tenantPlan).toBe('pro');
  });
});

// ── Test 2 ───────────────────────────────────────────────────────────────────

describe('it survives a webhook that lands after the call resolves', () => {
  it('🔴 a webhook slower than the call still reaches the screen', async () => {
    // The race, stated exactly: `runDodoPlanChange` resolves when DODO accepted
    // the change. The webhook has not written `plan` yet, and will not for
    // another two reads. A single re-read fired on resolution would read the old
    // tier and stop — the defect, in a smaller window.
    webhookLandsAfter(3, { plan: 'plus', status: 'active' }, { plan: 'pro', status: 'active' });
    await renderUpgradePage();
    expect(seen?.tenantPlan).toBe('plus');

    await press(/Upgrade to Small Team/i);

    // Nothing was applied on the strength of the request itself.
    expect(seen?.tenantPlan).toBe('plus');

    // The first re-read still loses the race…
    await act(async () => { await vi.advanceTimersByTimeAsync(PLAN_REFRESH_INTERVAL_MS); });
    expect(seen?.tenantPlan).toBe('plus');

    // …and the window keeps going until the writer answers.
    await runOutTheWindow();
    expect(seen?.tenantPlan).toBe('pro');
  });

  it('a single re-read would not have been enough — the window is what saves it', async () => {
    webhookLandsAfter(3, { plan: 'plus', status: 'active' }, { plan: 'pro', status: 'active' });
    await renderProvider();

    // One re-read, exactly what a `refreshTenantPlan()` on resolution would do.
    await act(async () => { await seen?.refreshTenantPlan(); });
    expect(seen?.tenantPlan).toBe('plus');

    // The window, on the same document, gets there.
    await act(async () => { seen?.armPlanRefresh(); });
    await runOutTheWindow();
    expect(seen?.tenantPlan).toBe('pro');
  });

  it('the window closes the moment the writer answers, not after its whole budget', async () => {
    tenantDoc({ plan: 'plus', status: 'active' });
    await renderProvider();

    const afterFirstRead = mockGetDoc.mock.calls.length;
    tenantDoc({ plan: 'pro', status: 'active' });
    await act(async () => { seen?.armPlanRefresh(); });
    await runOutTheWindow(5);

    expect(mockGetDoc.mock.calls.length).toBe(afterFirstRead + 1);
    expect(seen?.tenantPlan).toBe('pro');
  });

  it('a second change in the same tree opens a second window', async () => {
    // A counter, not a flag: re-arming a boolean that is already `true` re-runs
    // no effect, so an admin who changed plan twice without reloading would get
    // no refresh the second time.
    tenantDoc({ plan: 'plus', status: 'active' });
    await renderProvider();

    tenantDoc({ plan: 'pro', status: 'active' });
    await act(async () => { seen?.armPlanRefresh(); });
    await runOutTheWindow();
    expect(seen?.tenantPlan).toBe('pro');

    tenantDoc({ plan: 'max', status: 'active' });
    await act(async () => { seen?.armPlanRefresh(); });
    await runOutTheWindow();
    expect(seen?.tenantPlan).toBe('max');
  });
});

// ── Test 3 ───────────────────────────────────────────────────────────────────

describe('the retry is bounded, on the existing budget', () => {
  it('🔴 an in-app arm spends PLAN_REFRESH_ATTEMPTS reads and no more', async () => {
    // The webhook never lands. An unbounded poll would read forever after every
    // plan change — a rate-limit and billing problem traded for a display one.
    tenantDoc({ plan: 'plus', status: 'active' });
    await renderProvider();

    const afterFirstRead = mockGetDoc.mock.calls.length;
    await act(async () => { seen?.armPlanRefresh(); });
    await runOutTheWindow(5);

    expect(mockGetDoc.mock.calls.length).toBe(afterFirstRead + PLAN_REFRESH_ATTEMPTS);
  });

  it('🔴 it is the SAME budget — the context declares no second one', () => {
    // The named constants, asserted by name. A test that wrote `5` would keep
    // passing while the window drifted underneath it.
    expect(Number.isInteger(PLAN_REFRESH_ATTEMPTS)).toBe(true);
    expect(PLAN_REFRESH_ATTEMPTS).toBeGreaterThan(0);
    expect(PLAN_REFRESH_INTERVAL_MS).toBeGreaterThan(0);

    const source = stripComments(readFileSync(path.join(REPO, CONTEXT_FILE), 'utf8'));

    // Exactly one budget is declared…
    expect(source.match(/export const PLAN_REFRESH_ATTEMPTS\s*=/g)).toHaveLength(1);
    expect(source.match(/export const PLAN_REFRESH_INTERVAL_MS\s*=/g)).toHaveLength(1);
    // …and no rival constant is declared beside them.
    expect(source).not.toMatch(/const\s+(?!PLAN_REFRESH_(?:ATTEMPTS|INTERVAL_MS)\b)\w*(?:ATTEMPTS|INTERVAL_MS)\s*=/);

    // …and it is spent in exactly one place: one bounded series, two doors.
    expect(source.match(/attempt\(PLAN_REFRESH_ATTEMPTS\)/g)).toHaveLength(1);

    // No timer in this file is scheduled on a bare number — the interval a
    // second poller would need cannot be smuggled in as a literal.
    const literalTimers = [...source.matchAll(/setTimeout\s*\([\s\S]*?,\s*([^),]+)\)/g)]
      .map((m) => m[1].trim())
      .filter((delay) => !/PLAN_REFRESH_INTERVAL_MS/.test(delay));
    expect(literalTimers, 'every timer in the context runs on the named interval').toEqual([]);
  });

  it('a failed attempt costs one attempt, not the window', async () => {
    tenantDoc({ plan: 'pro', status: 'active' });
    await renderProvider();

    const afterFirstRead = mockGetDoc.mock.calls.length;
    mockGetDoc.mockRejectedValue(new Error('offline'));
    await act(async () => { seen?.armPlanRefresh(); });
    await runOutTheWindow(5);

    expect(mockGetDoc.mock.calls.length).toBe(afterFirstRead + PLAN_REFRESH_ATTEMPTS);
    expect(seen?.tenantPlan).toBe('pro');
  });

  it('an in-app arm stops when the tree unmounts mid-window', async () => {
    tenantDoc({ plan: 'plus', status: 'active' });
    await renderProvider();

    await act(async () => { seen?.armPlanRefresh(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(PLAN_REFRESH_INTERVAL_MS); });
    const beforeUnmount = mockGetDoc.mock.calls.length;
    await act(async () => { root.unmount(); });
    root = createRoot(container);

    await runOutTheWindow(5);

    expect(mockGetDoc.mock.calls.length).toBe(beforeUnmount);
  });

  it('an ordinary load still arms nothing', async () => {
    tenantDoc({ plan: 'pro', status: 'active' });
    await renderProvider();
    await runOutTheWindow(5);

    // The in-app door must not turn the window on for every admin who opens a
    // dashboard — that is the permanent per-load cost the bound exists to avoid.
    expect(mockGetDoc.mock.calls.length).toBe(1);
  });
});

// ── Test 4 ───────────────────────────────────────────────────────────────────

describe('a failed refresh leaves the last known tier in place', () => {
  it('🔴 a rejected read never downgrades an armed window', async () => {
    tenantDoc({ plan: 'pro', status: 'active' });
    await renderProvider();

    mockGetDoc.mockRejectedValue(new Error('offline'));
    await act(async () => { seen?.armPlanRefresh(); });
    await runOutTheWindow(5);

    // This ticket is about UNDER-granting after a charge. A refresh that could
    // strip a tier on a dropped request would commit the very defect it removes.
    expect(seen?.tenantPlan).toBe('pro');
  });

  it('a document with no plan field never downgrades', async () => {
    tenantDoc({ plan: 'pro', status: 'active' });
    await renderProvider();

    tenantDoc({ status: 'active' });
    await act(async () => { seen?.armPlanRefresh(); });
    await runOutTheWindow(5);

    // An absent `plan` is silence, not "free".
    expect(seen?.tenantPlan).toBe('pro');
  });

  it('a missing document never downgrades', async () => {
    tenantDoc({ plan: 'pro', status: 'active' });
    await renderProvider();

    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
    await act(async () => { seen?.armPlanRefresh(); });
    await runOutTheWindow(5);

    expect(seen?.tenantPlan).toBe('pro');
  });

  it('a plan change whose refresh never succeeds leaves the church where it was', async () => {
    tenantDoc({ plan: 'plus', status: 'active' });
    await renderUpgradePage();

    mockGetDoc.mockRejectedValue(new Error('offline'));
    await press(/Upgrade to Small Team/i);
    await runOutTheWindow(5);

    // Not 'pro' — nobody confirmed that — and not 'free' either.
    expect(seen?.tenantPlan).toBe('plus');
  });
});

// ── Test 5 ───────────────────────────────────────────────────────────────────

/**
 * 🔴 NO CLIENT-SIDE WRITE TO `plan`. The webhook is the single writer.
 *
 * A SWEEP, not a spot check: a guard scoped to one file cannot see the second
 * copy. Two sweeps run below, because they catch different things —
 *
 *   · the BROWSER-SDK sweep (any `plan` write in a file that imports
 *     `firebase/firestore`), inherited from THE-217; and
 *   · the ENTITLEMENT sweep, which follows `await import('firebase/firestore')`
 *     too and looks for a `plan` written to a `tenants` document, shorthand
 *     (`{ plan }`) included.
 */
const SRC = path.resolve(__dirname, '../..');
const REPO = path.resolve(SRC, '..');
const CONTEXT_FILE = 'src/contexts/TenantContext.tsx';
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

/** A `plan` object key, a `{ plan }` shorthand, or `plan` as an update field path. */
const WRITES_PLAN = /(^|[{,\s])(['"`]?)plan\2\s*:/;
const PLAN_SHORTHAND = /[{,]\s*plan\s*[,}]/;
const PLAN_FIELD_PATH = /(^|[,(\s])(['"`])plan\2\s*,/;

const IMPORTS_CLIENT_SDK = /from\s+['"]firebase\/firestore['"]/;
const IMPORTS_CLIENT_SDK_DYNAMIC = /import\s*\(\s*['"]firebase\/firestore['"]\s*\)/;

/** Which browser-SDK writes in this source carry a `plan` field. Empty = clean. */
function planWritesIn(source: string): string[] {
  const clean = stripComments(source);
  if (!IMPORTS_CLIENT_SDK.test(clean)) return [];
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

/**
 * Which writes in this source put a `plan` on a TENANT document — the
 * entitlement itself, wherever the SDK came from.
 */
function tenantPlanWritesIn(source: string): string[] {
  const clean = stripComments(source);
  if (!IMPORTS_CLIENT_SDK.test(clean) && !IMPORTS_CLIENT_SDK_DYNAMIC.test(clean)) return [];
  const offences: string[] = [];
  for (const fn of CLIENT_WRITES) {
    for (const args of callArguments(clean, fn)) {
      const touchesTenantDoc = /['"`]tenants['"`]/.test(args);
      const writesPlan =
        WRITES_PLAN.test(args) || PLAN_SHORTHAND.test(args) || PLAN_FIELD_PATH.test(args);
      if (touchesTenantDoc && writesPlan) {
        offences.push(`${fn}(${args.trim().slice(0, 80)}…)`);
      }
    }
  }
  return offences;
}

const CLIENT_FILES = walk(SRC).filter((f) => !f.includes('__tests__'));

/** The four files this ticket touched. */
const TOUCHED = [
  CONTEXT_FILE,
  'src/components/AdminUpgradePage.tsx',
  'src/components/settings/PlanUpgradeSection.tsx',
  'src/components/BillingAndPayments.tsx',
];

describe('no client-side write to plan exists', () => {
  it('the sweep actually sweeps', () => {
    expect(CLIENT_FILES.length).toBeGreaterThan(200);
    for (const file of TOUCHED) expect(CLIENT_FILES).toContain(file);
  });

  it('both detectors catch a planted violation', () => {
    // A sweep nobody has proven can fail is not a guard.
    const planted = `import { doc, updateDoc } from 'firebase/firestore';
      await updateDoc(doc(db, 'tenants', id), { plan: 'pro', updatedAt: now });`;
    expect(planWritesIn(planted)).toHaveLength(1);
    expect(tenantPlanWritesIn(planted)).toHaveLength(1);

    // The shorthand a `{ plan }` write would use, behind a dynamic import — the
    // shape the browser-SDK sweep alone cannot see.
    const shorthand = `const { updateDoc, doc } = await import('firebase/firestore');
      await updateDoc(doc(db, 'tenants', id), { plan });`;
    expect(tenantPlanWritesIn(shorthand)).toHaveLength(1);

    const fieldPath = `import { updateDoc } from 'firebase/firestore';
      await updateDoc(doc(db, 'tenants', id), 'plan', 'pro');`;
    expect(tenantPlanWritesIn(fieldPath)).toHaveLength(1);

    // …and neither fires on a comment about the rule, nor on the add-on set.
    const innocent = `import { updateDoc } from 'firebase/firestore';
      // never write { plan: 'pro' } from the client
      await updateDoc(doc(db, 'tenants', id), { addons: owned });`;
    expect(planWritesIn(innocent)).toEqual([]);
    expect(tenantPlanWritesIn(innocent)).toEqual([]);
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

  it('🔴 no file under src/ writes plan onto a tenant document, dynamic imports included', () => {
    const offenders = CLIENT_FILES.map((f) => ({
      file: f,
      offences: tenantPlanWritesIn(readFileSync(path.join(REPO, f), 'utf8')),
    })).filter((r) => r.offences.length > 0);

    expect(
      offenders.map((o) => `${o.file}: ${o.offences.join(', ')}`),
      'the tenant entitlement is written by the webhook alone',
    ).toEqual([]);
  });

  it('the files this ticket touched write nothing at all', () => {
    for (const file of TOUCHED) {
      const source = stripComments(readFileSync(path.join(REPO, file), 'utf8'));
      expect(source, `${file} reaches for a Firestore write`).not.toMatch(/\b(setDoc|updateDoc|addDoc)\b/);
    }
  });

  it('🔴 the tier that lands is the writer’s, never the one that was requested', async () => {
    // `on_payment_failure: 'prevent_change'` means Dodo decides AFTER the
    // payment. Here the church asks for Ministry and the webhook records Small
    // Team. A client that applied what it asked for would be claiming an
    // entitlement nobody confirmed.
    tenantDoc({ plan: 'plus', status: 'active' });
    await renderUpgradePage();

    await press(/Upgrade to Ministry/i);
    tenantDoc({ plan: 'pro', status: 'active' });
    await runOutTheWindow();

    expect(seen?.tenantPlan).toBe('pro');
    expect(seen?.tenantPlan).not.toBe('max');
  });
});

// ── Test 6 ───────────────────────────────────────────────────────────────────

describe('nothing runs in platform context where tenantId is null', () => {
  it('🔴 an in-app arm reads nothing when there is no tenant', async () => {
    mockHasPlatformOverride.mockReturnValue(true);
    tenantDoc({ plan: 'pro', status: 'active' });
    await renderProvider(null);

    await act(async () => { seen?.armPlanRefresh(); });
    await runOutTheWindow(5);

    // `tenantId` is null for an apex-domain super admin, and null is NOT "all
    // tenants". There is no tenant to re-read a tier against.
    expect(mockGetDoc).not.toHaveBeenCalled();
    expect(seen?.tenantId).toBeNull();
  });

  it('the guard is on the window itself, not only on what it calls', () => {
    // Counting `if (!tenantId) return` across the file proves nothing — four
    // unrelated functions carry one. This reads the guard out of the WINDOW's
    // own body: a caller that forgot the check must still read nothing, and the
    // window must not lean on `refreshTenantPlan` to hold the line for it.
    const source = stripComments(readFileSync(path.join(REPO, CONTEXT_FILE), 'utf8'));
    const spend = source.indexOf('attempt(PLAN_REFRESH_ATTEMPTS)');
    expect(spend, 'the bounded window is gone').toBeGreaterThan(-1);
    const effectStart = source.lastIndexOf('useEffect(() => {', spend);
    expect(effectStart, 'the window is not in a useEffect').toBeGreaterThan(-1);
    const windowBody = source.slice(effectStart, spend);
    expect(windowBody, 'the window does not guard on a null tenant').toMatch(
      /if\s*\(\s*!tenantId\s*\)\s*return\s*;/,
    );
  });

  it('refreshTenantPlan in platform context still reads nothing', async () => {
    mockHasPlatformOverride.mockReturnValue(true);
    await renderProvider(null);

    await act(async () => { await seen?.refreshTenantPlan(); });

    expect(mockGetDoc).not.toHaveBeenCalled();
  });
});

// ── Test 7 ───────────────────────────────────────────────────────────────────

describe('AdminUpgradePage still sends no billing (THE-226)', () => {
  it('🔴 the page passes no billing to runDodoPlanChange', () => {
    const source = stripComments(readFileSync(path.join(REPO, 'src/components/AdminUpgradePage.tsx'), 'utf8'));
    const args = callArguments(source, 'runDodoPlanChange');
    expect(args).toHaveLength(1);
    // The toggle is a price viewer. Its state was never a statement about what
    // anyone pays, and it must not reappear in this call.
    expect(args[0]).not.toMatch(/\bbilling\b/);
    expect(args[0].replace(/\s+/g, ' ')).toContain('tenantId: tid, plan: planId');
  });

  it('🔴 the wire carries the tenant’s real term while the page browses another', async () => {
    wire.termOnServer = 'monthly';
    tenantDoc({ plan: 'plus', status: 'active' });
    await renderUpgradePage();

    // The owner flips the toggle to compare Ministry's yearly price…
    const yearly = [...container.querySelectorAll('[data-testid="billing-term-segment"]')]
      .find((b) => b.getAttribute('data-term') === 'yearly') as HTMLButtonElement;
    expect(yearly).toBeTruthy();
    await act(async () => { yearly.click(); });

    // …and then presses Upgrade. They never asked to change term.
    await press(/Upgrade to Small Team/i);

    const preview = calls.find((c) => c.url === '/api/dodo/change-plan' && c.method === 'POST' && !c.body?.confirm);
    expect(preview?.body).toEqual({ tenantId: TENANT, plan: 'pro', billing: 'monthly' });
    expect(preview?.body.billing).not.toBe('yearly');
  });
});

// ── Test 8 ───────────────────────────────────────────────────────────────────

describe('the checkout-return path still arms (THE-217 / PR #399)', () => {
  it('🔴 the hop back from a payment picks the tier up on its own', async () => {
    arriveFromCheckout();
    tenantDoc({ plan: 'free', status: 'active' });
    await renderProvider();

    // The whole THE-217 defect, on screen: paid, looking at the free dashboard.
    expect(seen?.tenantPlan).toBe('free');

    tenantDoc({ plan: 'pro', status: 'active' });
    await act(async () => { await vi.advanceTimersByTimeAsync(PLAN_REFRESH_INTERVAL_MS); });

    expect(seen?.tenantPlan).toBe('pro');
  });

  it('the checkout hop is still read once, at mount', () => {
    // Read at USE rather than at mount and the answer is already gone: react
    // -router navigations drop the query string before `tenantId` resolves.
    const source = stripComments(readFileSync(path.join(REPO, CONTEXT_FILE), 'utf8'));
    expect(source).toMatch(/useState\(\s*\(\)\s*=>[\s\S]{0,160}isReturningFromCheckout\(window\.location\.search\)/);
  });

  it('the checkout hop and the in-app arm share one window', () => {
    // Two doors, one bounded series. A second poller for the in-app door would
    // be two windows racing the same document on two budgets.
    const source = stripComments(readFileSync(path.join(REPO, CONTEXT_FILE), 'utf8'));
    expect(source).toMatch(/if\s*\(\s*!arrivedFromCheckout\s*&&\s*planRefreshArm\s*===\s*0\s*\)\s*return\s*;/);
  });

  it('the checkout hop still arms even after an in-app arm has been used', async () => {
    arriveFromCheckout('stripe');
    tenantDoc({ plan: 'plus', status: 'active' });
    await renderProvider();

    tenantDoc({ plan: 'max', status: 'active' });
    await act(async () => { await vi.advanceTimersByTimeAsync(PLAN_REFRESH_INTERVAL_MS); });
    expect(seen?.tenantPlan).toBe('max');
  });
});

// ── Test 9 ───────────────────────────────────────────────────────────────────

describe('the first-subscription path is unchanged', () => {
  it('🔴 a free tenant’s click still goes to first-subscription, never to change-plan', async () => {
    tenantDoc({ plan: 'free', status: 'active' });
    await renderUpgradePage(TENANT, 'free');

    await press(/Upgrade to Small Team|Get Small Team|Choose Small Team/i);

    // The most sensitive funnel in the repo: a free tenant owns no subscription
    // to change, so the tier is the question and not the processor.
    expect(calls.some((c) => c.url === '/api/dodo/first-subscription')).toBe(true);
    expect(calls.some((c) => c.url.startsWith('/api/dodo/change-plan'))).toBe(false);
  });

  it('the first-subscription branch is still checked BEFORE the processor', () => {
    for (const file of ['src/components/AdminUpgradePage.tsx', 'src/components/settings/PlanUpgradeSection.tsx']) {
      // Scoped to the click handler: `AdminUpgradePage` also resolves the
      // processor at mount, which says nothing about the order inside the
      // branch and would make a whole-file comparison meaningless.
      const source = stripComments(readFileSync(path.join(REPO, file), 'utf8'));
      const handler = source.slice(source.indexOf('const handlePlanSelect'));
      expect(handler, `${file}: no handlePlanSelect`).not.toBe('');
      const first = handler.indexOf('isFirstSubscriptionTenant && isPricedPlan');
      const processor = handler.indexOf('fetchBillingProcessor()');
      expect(first, `${file}: no first-subscription branch`).toBeGreaterThan(-1);
      expect(processor, `${file}: no processor branch`).toBeGreaterThan(-1);
      // THE-212: reversing this order sent every free tenant to a Stripe price id.
      expect(first, `${file}: the processor is resolved before the tier`).toBeLessThan(processor);
    }
  });

  it('neither first-subscription helper was touched by this ticket', () => {
    for (const file of ['src/components/AdminUpgradePage.tsx', 'src/components/settings/PlanUpgradeSection.tsx']) {
      const source = stripComments(readFileSync(path.join(REPO, file), 'utf8'));
      expect(source).toMatch(/needsFirstSubscription\(currentPlan\)/);
      expect(source).toMatch(/startFirstSubscription\(\{\s*plan: planId, billing: billingPeriod\s*\}\)/);
      // The arm belongs to the plan-CHANGE branch alone.
      const armAt = source.indexOf('armPlanRefresh()');
      const startAt = source.indexOf('startFirstSubscription(');
      expect(armAt).toBeGreaterThan(startAt);
    }
  });
});

// ── Test 10 ──────────────────────────────────────────────────────────────────

describe('both isReturningFromCheckout spellings still recognised', () => {
  it('🔴 dodo and stripe both count as the hop back from a payment', () => {
    // A payer mid-checkout when the processor flag flipped comes back carrying
    // the OTHER marker. Failing to recognise it leaves exactly the church this
    // ticket is about on the tier they were on.
    expect(isReturningFromCheckout('?dodo=success')).toBe(true);
    expect(isReturningFromCheckout('?stripe=success')).toBe(true);
    expect(isReturningFromCheckout('?dodo=cancelled')).toBe(false);
    expect(isReturningFromCheckout('')).toBe(false);
  });

  for (const flag of ['dodo', 'stripe'] as const) {
    it(`the window still arms on ?${flag}=success`, async () => {
      arriveFromCheckout(flag);
      tenantDoc({ plan: 'plus', status: 'active' });
      await renderProvider();

      tenantDoc({ plan: 'max', status: 'active' });
      await act(async () => { await vi.advanceTimersByTimeAsync(PLAN_REFRESH_INTERVAL_MS); });

      expect(seen?.tenantPlan).toBe('max');
    });
  }

  it('the context still asks the shared helper, not a fourth inline parse', () => {
    const source = stripComments(readFileSync(path.join(REPO, CONTEXT_FILE), 'utf8'));
    expect(source).toMatch(/isReturningFromCheckout\(window\.location\.search\)/);
    // An inline parse here would drift from the gate that decides whether a
    // payer is shown "Complete your payment" — i.e. invited to pay twice.
    expect(source).not.toMatch(/URLSearchParams\([^)]*\)\.get\(\s*['"](?:dodo|stripe)['"]/);
  });
});
