import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import OnboardingGate from '../OnboardingGate';

/**
 * THE-88: the restarted checkout after an abandoned payment keeps the chosen
 * period.
 *
 * `signup-checkout.ts` is explicit that ChurchOnboarding and OnboardingGate are
 * BOTH signup and both have to move together. ChurchOnboarding writes
 * `signupBilling` onto the same marker as `signupPlan`; this gate reads it back
 * for the "Complete your payment" restart. A church that chose ANNUAL, closed
 * the payment tab, and clicked restart must not be silently restarted on
 * monthly — that is the wrong charge for the term they picked, made without
 * showing them a price again.
 *
 * The marker is a Firestore doc the user can write, so the period is validated
 * on READ-BACK too, not only on write: anything unrecognised fails closed to
 * 'monthly' before it can enter a checkout body.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const userDocData = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('../../firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'u1', email: 'pastor@grace.org', getIdToken: vi.fn(async () => 'tok-1') } },
}));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn((_auth: unknown, cb: (u: unknown) => void) => {
    cb({ uid: 'u1', email: 'pastor@grace.org' });
    return () => {};
  }),
  getIdToken: vi.fn(async () => 'tok-1'),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, collection: string, id: string) => ({ collection, id })),
  onSnapshot: vi.fn((ref: { collection: string }, cb: (snap: unknown) => void) => {
    if (ref.collection === 'users') {
      cb({ exists: () => true, data: () => userDocData.current });
    }
    return () => {};
  }),
}));
// Both exports, not just the predicate: the gate resolves the host tenant
// through the shared `tenant-scope` resolver, which reads `SUPER_ADMIN_EMAILS`
// at module load. A partial stub fails the whole suite on import.
vi.mock('../../utils/super-admins', () => ({
  isSuperAdminEmail: () => false,
  SUPER_ADMIN_EMAILS: [] as readonly string[],
}));
vi.mock('../../utils/tenant.utils', () => ({ checkRosterAdmin: vi.fn(async () => false) }));
vi.mock('../../lib/theme-runtime', () => ({ useForcedLightTheme: () => {} }));
vi.mock('../FirstRunSetup', () => ({ default: () => null }));
// The COMPONENT is stubbed (these suites are about the gate, not the handoff
// screen); its module constants are re-exported for real rather than restated,
// so the gate under test compares against the same values production does.
vi.mock('../WorkspaceHandoff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../WorkspaceHandoff')>()),
  default: () => null,
}));

const fetchMock = vi.fn();

let container: HTMLDivElement;
let root: Root | null = null;

function restartBody(): Record<string, unknown> {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return JSON.parse(fetchMock.mock.calls[0][1].body);
}

/**
 * Mount the gate over an in-flight signup with no processor success marker,
 * ride out the 30s poll into 'needs-payment', and click the restart button.
 */
async function abandonAndRestart(marker: Record<string, unknown>) {
  userDocData.current = { signupInProgress: true, ...marker };
  window.history.replaceState({}, '', '/'); // no ?dodo=success / ?stripe=success

  act(() => {
    root = createRoot(container);
    root.render(<OnboardingGate><div>app</div></OnboardingGate>);
  });

  // The poll only concludes "genuinely abandoned" after 30s without a tenant.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });
  vi.useRealTimers();

  const restart = Array.from(container.querySelectorAll('button')).find(
    (b) => /continue to payment/i.test(b.textContent || ''),
  );
  expect(restart, '"Complete your payment" restart button not rendered').toBeTruthy();
  await act(async () => { restart!.click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  expect(fetchMock).toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  fetchMock.mockResolvedValue({ json: async () => ({}) });
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the restarted checkout after an abandoned payment keeps the chosen period', () => {
  it('restarts an annual signup on the annual term, same plan, same ministry name', async () => {
    await abandonAndRestart({
      signupPlan: 'pro',
      signupBilling: 'yearly',
      signupMinistryName: 'Grace Chapel',
    });
    const body = restartBody();
    expect(body.billing).toBe('yearly');
    expect(body.plan).toBe('pro');
    expect(body.ministryName).toBe('Grace Chapel');
  });

  it('restarts a monthly signup on monthly, unchanged', async () => {
    await abandonAndRestart({ signupPlan: 'plus', signupBilling: 'monthly', signupMinistryName: 'Hope' });
    expect(restartBody().billing).toBe('monthly');
  });

  it('a marker WITHOUT a period (written before this change) restarts on monthly', async () => {
    // Every in-flight signup that predates signupBilling behaves exactly as it
    // would have: the term it was actually sold.
    await abandonAndRestart({ signupPlan: 'plus', signupMinistryName: 'Hope' });
    expect(restartBody().billing).toBe('monthly');
  });

  it('an unrecognised period on the marker fails closed to monthly, never onward', async () => {
    // ⚠️ This case used to use 'quarterly' as its unrecognised value. Quarterly
    // is a REAL term now (THE-195), so the example had to move to something the
    // allowlist genuinely rejects — otherwise the test would have kept passing
    // while asserting the opposite of the truth.
    await abandonAndRestart({ signupPlan: 'plus', signupBilling: 'biennial', signupMinistryName: 'Hope' });
    expect(restartBody().billing).toBe('monthly');
    expect(fetchMock.mock.calls[0][1].body).not.toContain('biennial');
  });

  it("Dodo's own word for the annual term is still refused", async () => {
    // The original silent mis-sell: 'annual' is Dodo's vocabulary, not the
    // app's, and it must fail closed rather than start an annual subscription.
    await abandonAndRestart({ signupPlan: 'plus', signupBilling: 'annual', signupMinistryName: 'Hope' });
    expect(restartBody().billing).toBe('monthly');
  });

  it('a quarterly restart keeps quarterly, now that it is a term the app sells', async () => {
    // 🔴 The other half of the guard. Failing closed must not mean failing
    // ALWAYS: a church that chose quarterly and abandoned checkout has to
    // restart on quarterly, or the restart charges it a different way than the
    // card it clicked.
    await abandonAndRestart({ signupPlan: 'plus', signupBilling: 'quarterly', signupMinistryName: 'Hope' });
    expect(restartBody().billing).toBe('quarterly');
  });
});
