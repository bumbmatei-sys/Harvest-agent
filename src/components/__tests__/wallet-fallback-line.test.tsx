import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'fs';
import path from 'path';

import ChurchOnboarding from '../ChurchOnboarding';
import OnboardingGate from '../OnboardingGate';
import { WALLET_FALLBACK_LINE } from '../../utils/signup-checkout';

/**
 * THE-130: tell people a card works when the wallet does not load.
 *
 * The first live Dodo signup had its Google Pay pop-up blocked by the browser —
 * on the processor's hosted page, which Harvest does not own and cannot
 * annotate. The only surface we control is the screen immediately before the
 * handoff, and signup has TWO of those (`signup-checkout.ts` pins why):
 * ChurchOnboarding's first attempt and OnboardingGate's "Complete your payment"
 * restart. Someone restarting an abandoned checkout is disproportionately
 * likely to be the person whose wallet just failed, so the line must be on
 * BOTH — rendered from one shared constant so the two cannot drift.
 *
 * Every assertion targets `WALLET_FALLBACK_LINE` by identity, never a value
 * pattern: the sentence may be re-worded without touching this file, as long
 * as it stays one shared, honest, price-free line.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = path.join(process.cwd(), 'src');

vi.mock('../../firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'u1', email: 'pastor@grace.org', displayName: 'Pastor', getIdToken: vi.fn(async () => 'tok-1') } },
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
  getDoc: vi.fn(async () => ({ exists: () => false })),
  setDoc: vi.fn(async () => {}),
  updateDoc: vi.fn(async () => {}),
  onSnapshot: vi.fn((ref: { collection: string }, cb: (snap: unknown) => void) => {
    if (ref.collection === 'users') {
      cb({
        exists: () => true,
        data: () => ({ signupInProgress: true, signupPlan: 'plus', signupBilling: 'monthly', signupMinistryName: 'Hope' }),
      });
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

let container: HTMLDivElement;
let root: Root | null = null;

const mount = (el: React.ReactElement) => {
  act(() => {
    root = createRoot(container);
    root.render(el);
  });
};

/**
 * Drive OnboardingGate to 'needs-payment': an in-flight signup, no tenant, no
 * processor success marker, and the 30s poll ridden out — the exact state of
 * someone who closed (or lost) the payment tab and came back.
 */
async function mountRestartScreen() {
  vi.useFakeTimers();
  window.history.replaceState({}, '', '/'); // no ?dodo=success / ?stripe=success
  mount(<OnboardingGate><div>app</div></OnboardingGate>);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });
  vi.useRealTimers();
  const restart = Array.from(container.querySelectorAll('button')).find(
    (b) => /continue to payment/i.test(b.textContent || ''),
  );
  expect(restart, 'restart screen ("Complete your payment") not rendered').toBeTruthy();
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/church-onboarding');
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container.remove();
  vi.useRealTimers();
});

describe('the card fallback for a wallet that does not load (THE-130)', () => {
  it('the wallet fallback line appears before the first checkout handoff', () => {
    mount(<ChurchOnboarding onComplete={() => {}} />);
    expect(container.textContent).toContain(WALLET_FALLBACK_LINE);
  });

  it('the wallet fallback line appears on the restart-after-abandonment path', async () => {
    await mountRestartScreen();
    expect(container.textContent).toContain(WALLET_FALLBACK_LINE);
  });

  it('both screens render the same text from one constant', () => {
    // Both call sites must reference the shared constant, and neither may carry
    // its own copy of the sentence — a second literal is exactly the drift the
    // constant exists to prevent (the reprice bugs came from copy number four).
    for (const file of ['components/ChurchOnboarding.tsx', 'components/OnboardingGate.tsx']) {
      const src = readFileSync(path.join(SRC, file), 'utf8');
      expect(src, `${file} does not render WALLET_FALLBACK_LINE`).toContain('WALLET_FALLBACK_LINE');
      expect(src, `${file} inlines its own copy of the sentence`).not.toContain(WALLET_FALLBACK_LINE);
    }
  });

  it('the line names no specific browser and does not claim a wallet is broken', () => {
    // A blocked pop-up has many causes — settings, extensions, in-app browsers.
    // Blaming a browser would be untrue for most readers; calling the wallet
    // broken would be untrue for all of them. The line offers the card, only.
    expect(WALLET_FALLBACK_LINE).not.toMatch(/chrome|safari|firefox|brave|edge|opera|duckduckgo|in-app/i);
    expect(WALLET_FALLBACK_LINE).not.toMatch(/broken|unavailable|not supported|doesn't work|does not work|fail/i);
  });

  it('no price, plan or trial length is restated', () => {
    // Prices, plan names and the trial live elsewhere (the pricing page and the
    // processor catalogue); a fourth copy is how the reprice bugs happened.
    expect(WALLET_FALLBACK_LINE).not.toMatch(/[$€£]\s?\d|\d+\s*(?:[-–]\s*)?day|per\s+(?:month|year)|\/(?:mo|yr)\b/i);
    expect(WALLET_FALLBACK_LINE).not.toMatch(/\btrial\b|\bplus\b|\bpro\b|\bplan\b/i);
  });
});
