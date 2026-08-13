import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import ChurchOnboarding from '../ChurchOnboarding';

/**
 * THE-88 (app half): signup carries the billing period the church chose.
 *
 * The period arrives the same way the plan does — `?billing=` on the URL,
 * chosen upstream on the pricing page, shown here read-only (there is
 * intentionally NO in-app period picker, same recorded decision as the plan).
 * Three things are pinned at this surface:
 *
 *  1. NO REGRESSION. A link carrying no period buys monthly, exactly what
 *     signup sold before annual existed. This is what makes shipping the app
 *     half FIRST safe: the marketing site's links carry no period yet.
 *  2. FAIL CLOSED. `?billing=` is URL-controlled; an unrecognised value
 *     becomes 'monthly' in the client and never travels onward — the Dodo
 *     catalogue has no fallback by design, so nothing invalid may approach it.
 *  3. THE MARKER CARRIES THE PERIOD. `signupBilling` is written next to
 *     `signupPlan` so OnboardingGate's restart (the other signup call site —
 *     see signup-checkout.ts) re-buys the term the church actually chose.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const setDoc = vi.hoisted(() => vi.fn(async (_ref: unknown, _data: Record<string, unknown>) => {}));
const updateDoc = vi.hoisted(() => vi.fn(async (_ref: unknown, _data: Record<string, unknown>) => {}));
const getDoc = vi.hoisted(() => vi.fn());

vi.mock('../../firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'u1', email: 'pastor@grace.org', displayName: 'Pastor', getIdToken: vi.fn(async () => 'tok-1') } },
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join('/') })),
  getDoc,
  setDoc,
  updateDoc,
}));

const fetchMock = vi.fn();

let container: HTMLDivElement;
let root: Root | null = null;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

const mount = (el: React.ReactElement) => {
  act(() => {
    root = createRoot(container);
    root.render(el);
  });
};

/** The body ChurchOnboarding POSTed to the signup endpoint. */
function checkoutBody(): Record<string, unknown> {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return JSON.parse(fetchMock.mock.calls[0][1].body);
}

/** The marker written on the user doc before redirecting to checkout. */
function writtenMarker(): Record<string, unknown> {
  if (setDoc.mock.calls.length > 0) return setDoc.mock.calls[0][1];
  expect(updateDoc).toHaveBeenCalledTimes(1);
  return updateDoc.mock.calls[0][1];
}

async function signUp() {
  const input = container.querySelector('input[placeholder="Grace Community Church"]') as HTMLInputElement;
  expect(input, 'ministry-name input not rendered').toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, 'Grace Chapel');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const continueBtn = Array.from(container.querySelectorAll('button')).find(
    (b) => /continue to payment/i.test(b.textContent || ''),
  );
  expect(continueBtn, 'continue button not rendered').toBeTruthy();
  await act(async () => { continueBtn!.click(); });
  await flush();
  expect(fetchMock).toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/church-onboarding');
  getDoc.mockResolvedValue({ exists: () => false });
  // No `url` in the response: the component stays put (shows an error), which
  // keeps happy-dom from attempting a real navigation. The request body is the
  // subject here, not the redirect.
  fetchMock.mockResolvedValue({ json: async () => ({}) });
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container.remove();
  vi.unstubAllGlobals();
});

describe('signup with no period parameter still buys monthly', () => {
  it('posts billing: monthly when the URL carries no ?billing=', async () => {
    mount(<ChurchOnboarding onComplete={() => {}} />);
    await signUp();
    expect(checkoutBody().billing).toBe('monthly');
  });

  it('persists signupBilling: monthly on the marker too', async () => {
    mount(<ChurchOnboarding onComplete={() => {}} />);
    await signUp();
    expect(writtenMarker().signupBilling).toBe('monthly');
    expect(writtenMarker().signupInProgress).toBe(true);
  });
});

describe('signup carrying the annual period buys the annual term', () => {
  it('posts billing: yearly when the URL carries ?billing=yearly', async () => {
    window.history.replaceState({}, '', '/church-onboarding?billing=yearly&plan=pro');
    mount(<ChurchOnboarding onComplete={() => {}} />);
    await signUp();
    expect(checkoutBody().billing).toBe('yearly');
    expect(checkoutBody().plan).toBe('pro');
  });

  it('writes signupBilling: yearly next to signupPlan on the marker, so a restart keeps the term', async () => {
    window.history.replaceState({}, '', '/church-onboarding?billing=yearly&plan=pro');
    mount(<ChurchOnboarding onComplete={() => {}} />);
    await signUp();
    const marker = writtenMarker();
    expect(marker.signupBilling).toBe('yearly');
    expect(marker.signupPlan).toBe('pro');
  });

  it('also persists the period on an existing user doc (updateDoc branch)', async () => {
    window.history.replaceState({}, '', '/church-onboarding?billing=yearly');
    getDoc.mockResolvedValue({ exists: () => true });
    mount(<ChurchOnboarding onComplete={() => {}} />);
    await signUp();
    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(updateDoc.mock.calls[0][1].signupBilling).toBe('yearly');
  });
});

describe('an unrecognised period falls back to monthly and never travels onward', () => {
  it.each(['weekly', 'annual', 'YEARLY'])(
    '?billing=%s posts billing: monthly',
    async (bad) => {
      window.history.replaceState({}, '', `/church-onboarding?billing=${bad}`);
      mount(<ChurchOnboarding onComplete={() => {}} />);
      await signUp();
      // The raw URL value must not appear anywhere in the request: what leaves
      // the browser is always one of the two words the server validates.
      expect(checkoutBody().billing).toBe('monthly');
      expect(fetchMock.mock.calls[0][1].body).not.toContain(bad);
    },
  );

  it('?billing= (empty) posts billing: monthly', async () => {
    window.history.replaceState({}, '', '/church-onboarding?billing=');
    mount(<ChurchOnboarding onComplete={() => {}} />);
    await signUp();
    expect(checkoutBody().billing).toBe('monthly');
  });
});

describe('the chosen term is shown to the church before it pays', () => {
  it('shows "billed annually" read-only when the annual term was chosen upstream', () => {
    window.history.replaceState({}, '', '/church-onboarding?billing=yearly&plan=pro');
    mount(<ChurchOnboarding onComplete={() => {}} />);
    expect(container.textContent).toMatch(/billed annually/i);
    // Read-only, like the plan: no picker, no second control to change it here.
    expect(container.querySelector('input[type="radio"]')).toBeNull();
    expect(container.querySelector('select')).toBeNull();
  });

  it('shows "billed monthly" when no period was chosen', () => {
    mount(<ChurchOnboarding onComplete={() => {}} />);
    expect(container.textContent).toMatch(/billed monthly/i);
  });

  it('restates no price and no trial length — those live on the pricing page and the products', () => {
    window.history.replaceState({}, '', '/church-onboarding?billing=yearly');
    mount(<ChurchOnboarding onComplete={() => {}} />);
    expect(container.textContent).not.toMatch(/\$\s?\d/);
    expect(container.textContent).not.toMatch(/\d+\s*[-–]?\s*day/i);
  });
});

describe('the period survives with DODO_BILLING_ENABLED off', () => {
  it('still posts the chosen term to the Stripe endpoint the rollback selects', async () => {
    // Rebuild the module graph with the flag stubbed OFF, exactly as the
    // cutover test does: what is exercised is the component the rolled-back
    // app would actually build. The Stripe signup route reads the same
    // `billing` word, so the term survives the rollback rather than being a
    // Dodo-only feature.
    vi.resetModules();
    vi.doMock('../../utils/plan-features', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../utils/plan-features')>()),
      DODO_BILLING_ENABLED: false,
    }));
    const { default: RolledBackOnboarding } = await import('../ChurchOnboarding');
    const { SIGNUP_CHECKOUT_ENDPOINT: rolledBackEndpoint } = await import('../../utils/signup-checkout');
    vi.doUnmock('../../utils/plan-features');

    expect(rolledBackEndpoint).toBe('/api/stripe/checkout');

    window.history.replaceState({}, '', '/church-onboarding?billing=yearly&plan=pro');
    mount(<RolledBackOnboarding onComplete={() => {}} />);
    await signUp();

    expect(fetchMock.mock.calls[0][0]).toBe('/api/stripe/checkout');
    expect(checkoutBody().billing).toBe('yearly');

    vi.resetModules();
  });
});
