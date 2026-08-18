import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'fs';
import path from 'path';

import ChurchOnboarding from '../ChurchOnboarding';
import OnboardingGate from '../OnboardingGate';
import { SIGNUP_BILLING_STORAGE_KEY } from '../../utils/signup-checkout';

/**
 * THE-92 — `signupInProgress` is written before checkout is attempted.
 *
 * 🔴 THE FINDING, AND WHY NOTHING MOVED. The card reads the early write as the
 * defect: a church that fills the form and closes the tab at the payment step
 * is left flagged mid-signup with no tenant, and only a completed payment
 * clears the flag. All of that is true — and it is exactly what RESCUES that
 * church rather than what strands it.
 *
 * The flag is the only thread back. App.tsx reads it to leave a tenant-less
 * mid-signup user where they are instead of bouncing them into the generic
 * member funnel; OnboardingGate reads it to render "Complete your payment"
 * with a restart button that re-buys the SAME plan, term and ministry name off
 * the same marker. Delete the flag, or write it later than the form submit,
 * and the abandoning church loses every one of those and lands in generic
 * member onboarding with their chosen plan gone.
 *
 * So the first test below is a characterisation of working behaviour, not a
 * repair: it chains the real marker ChurchOnboarding writes into the real gate
 * and pins that the round trip ends somewhere the church can act. The
 * mutation that kills it is moving the write later — the "obvious fix".
 *
 * The remaining tests pin the single-writer rule the flag depends on: two
 * releases, one per processor, both server-side, and none on the client.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(__dirname, '../../..');

const setDoc = vi.hoisted(() => vi.fn(async (_ref: unknown, _data: Record<string, unknown>) => {}));
const updateDoc = vi.hoisted(() => vi.fn(async (_ref: unknown, _data: Record<string, unknown>) => {}));
const getDoc = vi.hoisted(() => vi.fn());
const userDocData = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('../../firebase', () => ({
  db: {},
  auth: {
    currentUser: {
      uid: 'u1',
      email: 'pastor@grace.org',
      displayName: 'Pastor',
      getIdToken: vi.fn(async () => 'tok-1'),
    },
  },
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
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot: vi.fn((ref: { collection: string }, cb: (snap: unknown) => void) => {
    if (ref.collection === 'users') cb({ exists: () => true, data: () => userDocData.current });
    return () => {};
  }),
}));
// Both exports: the gate resolves the host tenant through the shared
// tenant-scope resolver, which reads SUPER_ADMIN_EMAILS at module load.
vi.mock('../../utils/super-admins', () => ({
  isSuperAdminEmail: () => false,
  SUPER_ADMIN_EMAILS: [] as readonly string[],
}));
vi.mock('../../utils/tenant.utils', () => ({ checkRosterAdmin: vi.fn(async () => false) }));
vi.mock('../../lib/theme-runtime', () => ({ useForcedLightTheme: () => {} }));
vi.mock('../FirstRunSetup', () => ({ default: () => null }));
vi.mock('../WorkspaceHandoff', () => ({ default: () => null }));

const fetchMock = vi.fn();

let container: HTMLDivElement;
let root: Root | null = null;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

/** The label the church clicks to leave the signup form for the processor. */
const CONTINUE_TO_PAYMENT = /continue to payment/i;

function buttonByLabel(label: RegExp): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) => label.test(b.textContent || ''));
}

/** The body POSTed to the signup checkout endpoint on a given call. */
function checkoutBody(call = 0): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[call][1].body);
}

/** The marker ChurchOnboarding wrote on the user doc before leaving for checkout. */
function writtenMarker(): Record<string, unknown> {
  if (setDoc.mock.calls.length > 0) return setDoc.mock.calls[0][1];
  expect(updateDoc, 'the signup form wrote no marker at all').toHaveBeenCalled();
  return updateDoc.mock.calls[0][1];
}

/** Fill the ministry name and click through to the processor. */
async function fillFormAndContinue() {
  const input = container.querySelector('input[placeholder="Grace Community Church"]') as HTMLInputElement;
  expect(input, 'ministry-name input not rendered').toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, 'Grace Chapel');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const go = buttonByLabel(CONTINUE_TO_PAYMENT);
  expect(go, 'continue button not rendered on the signup form').toBeTruthy();
  await act(async () => { go!.click(); });
  await flush();
}

function mount(el: React.ReactElement) {
  act(() => {
    root = createRoot(container);
    root.render(el);
  });
}

function unmount() {
  act(() => { root?.unmount(); });
  root = null;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  userDocData.current = {};
  window.history.replaceState({}, '', '/church-onboarding');
  getDoc.mockResolvedValue({ exists: () => false });
  fetchMock.mockResolvedValue({ json: async () => ({}) });
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  unmount();
  container.remove();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('THE-92 — an abandoned signup stays recoverable', () => {
  it('a church that abandons at the payment step is not left in an unresolvable state', async () => {
    // ── Leg 1: the church fills the form and is sent to the processor. The
    // marker is written here, before checkout exists — that is the behaviour
    // under test, not an accident of ordering.
    sessionStorage.setItem(SIGNUP_BILLING_STORAGE_KEY, 'yearly');
    mount(<ChurchOnboarding onComplete={() => {}} signupPlan="pro" />);
    await fillFormAndContinue();

    const marker = writtenMarker();
    expect(marker.signupInProgress, 'the signup form left no in-flight marker to come back to').toBe(true);
    unmount();

    // ── The church now closes the tab without paying. No tenant is ever
    // created, no webhook ever fires, and it returns later to a bare "/" with
    // no processor success marker in the URL — the abandonment case exactly.
    userDocData.current = { ...marker };
    window.history.replaceState({}, '', '/');
    fetchMock.mockClear();
    vi.useFakeTimers();

    mount(<OnboardingGate><div>signed-in app</div></OnboardingGate>);

    // The gate deliberately opens on the "Setting up…" poll even with no
    // success marker, so a church whose webhook is merely slow is never shown
    // a re-checkout button. Only after the poll gives up is the signup treated
    // as genuinely abandoned.
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    vi.useRealTimers();

    // ── Leg 2: what the church actually sees. Not the app, not the generic
    // member funnel, not a spinner forever — an explanation and a live action.
    expect(container.textContent, 'the abandoning church was dropped into the signed-in app')
      .not.toContain('signed-in app');
    expect(container.textContent, 'no explanation of why the ministry is not active')
      .toMatch(/complete your payment/i);

    const resume = buttonByLabel(CONTINUE_TO_PAYMENT);
    expect(resume, 'the church has no way to resume or restart — this IS the dead end').toBeTruthy();

    await act(async () => { resume!.click(); });
    await flush();

    // ── And the resume is a real one: same plan, same term, same name, taken
    // off the marker the abandoned form left behind.
    expect(fetchMock, 'the resume button started no checkout').toHaveBeenCalled();
    const resumed = checkoutBody();
    expect(resumed.plan).toBe('pro');
    expect(resumed.billing).toBe('yearly');
    expect(resumed.ministryName).toBe('Grace Chapel');
  });

  it('the chosen billing period still reaches checkout unchanged', async () => {
    sessionStorage.setItem(SIGNUP_BILLING_STORAGE_KEY, 'yearly');
    mount(<ChurchOnboarding onComplete={() => {}} signupPlan="max" />);
    expect(container.textContent, 'the annual term is not shown before the church commits to it')
      .toMatch(/billed annually/i);
    await fillFormAndContinue();
    expect(checkoutBody().billing).toBe('yearly');
    expect(checkoutBody().plan).toBe('max');
    // The marker carries the term too, so the restart above re-buys annual.
    expect(writtenMarker().signupBilling).toBe('yearly');
  });
});

/**
 * The release side. Two writers of `signupInProgress: false`, one per
 * processor, both server-side — the shape this project chose deliberately.
 * These read the source rather than re-drive the webhooks (whose own suites
 * own that): the point here is that this change left both releases standing
 * and added no third.
 */
describe('THE-92 — the funnel is still released, by the processors only', () => {
  const dodoProvisioning = () =>
    readFileSync(path.join(ROOT, 'src/lib/dodo/provisioning.ts'), 'utf8');
  const stripeWebhook = () =>
    readFileSync(path.join(ROOT, 'src/app/api/stripe/webhook/route.ts'), 'utf8');

  it('signupInProgress still releases on a completed Dodo payment', () => {
    const src = dodoProvisioning();
    expect(src, 'Dodo provisioning no longer releases the signup funnel')
      .toMatch(/signupInProgress:\s*false/);
    // Released on the paying user's own doc, in the same update that grants
    // them the tenant — the two can never disagree.
    expect(src, 'the Dodo release is no longer written onto the paying user doc')
      .toMatch(/collection\('users'\)[\s\S]{0,200}signupInProgress:\s*false/);
  });

  it('signupInProgress still releases on a completed Stripe payment', () => {
    const src = stripeWebhook();
    expect(src, 'the Stripe webhook no longer releases the signup funnel')
      .toMatch(/signupInProgress:\s*false/);
    expect(src, 'the Stripe release is no longer written onto the paying user doc')
      .toMatch(/collection\('users'\)[\s\S]{0,200}signupInProgress:\s*false/);
  });

  it('no client path writes signupInProgress false', () => {
    // Everything the browser runs. The two legitimate releases live in
    // server-only modules: the Stripe webhook route, and the Dodo provisioning
    // module (firebase-admin, reached only from the Dodo webhook route).
    const clientFiles = [
      'src/components/ChurchOnboarding.tsx',
      'src/components/OnboardingGate.tsx',
      'src/App.tsx',
      'src/utils/signup-checkout.ts',
    ];
    for (const rel of clientFiles) {
      const src = readFileSync(path.join(ROOT, rel), 'utf8');
      // Comments explain the rule and must stay readable; only real code is
      // inspected, so prose about `signupInProgress: false` never trips this.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .join('\n');
      expect(code, `${rel} releases the signup funnel from the client — a third writer, and a double-charge invitation`)
        .not.toMatch(/signupInProgress\s*:\s*false/);
      expect(code, `${rel} clears the signup funnel marker from the client`)
        .not.toMatch(/signupInProgress\s*:\s*(?:deleteField|null|undefined)/);
    }
  });
});
