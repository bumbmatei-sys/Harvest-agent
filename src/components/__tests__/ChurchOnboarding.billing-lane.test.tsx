import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import ChurchOnboarding from '../ChurchOnboarding';
import { SIGNUP_BILLING_STORAGE_KEY } from '../../utils/signup-checkout';

/**
 * THE-135, the read-back half: after the /auth redirect has dropped the query
 * string, ChurchOnboarding recovers the billing period from the sessionStorage
 * lane App.tsx captured it into — with the same precedence the plan gets (URL
 * wins over the stored value) and the same fail-closed validation (both
 * sources are untrusted; anything unrecognised becomes 'monthly' and never
 * travels onward).
 *
 * The URL-only behaviour (a link that still carries `?billing=`) is pinned in
 * ChurchOnboarding.billing-period.test.tsx and is unchanged; this file owns
 * the lane.
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
  sessionStorage.clear();
  // The post-redirect reality: the funnel dropped the query string entirely.
  window.history.replaceState({}, '', '/church-onboarding');
  getDoc.mockResolvedValue({ exists: () => false });
  fetchMock.mockResolvedValue({ json: async () => ({}) });
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container.remove();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('the stored period is recovered after the redirect drops the query', () => {
  it('an annual signup link survives the auth redirect and buys the annual product', async () => {
    // What App.tsx stashed before navigate('/auth') wiped the URL.
    sessionStorage.setItem(SIGNUP_BILLING_STORAGE_KEY, 'yearly');
    mount(<ChurchOnboarding onComplete={() => {}} signupPlan="max" />);
    expect(container.textContent).toMatch(/billed annually/i);
    await signUp();
    expect(checkoutBody().billing).toBe('yearly');
    expect(checkoutBody().plan).toBe('max');
  });

  it('the restart-after-abandonment path re-buys the chosen term', async () => {
    // OnboardingGate's restart reads ONLY the signupBilling marker on the user
    // doc (never sessionStorage — the marker survives tabs and devices, and it
    // records what the first checkout was actually started with). So the two
    // sources agree by construction: the marker IS the lane's value at the
    // moment the church continued to payment. The gate's own half — marker in,
    // restarted checkout body out — is pinned in
    // OnboardingGate.restart-period.test.tsx.
    sessionStorage.setItem(SIGNUP_BILLING_STORAGE_KEY, 'yearly');
    mount(<ChurchOnboarding onComplete={() => {}} signupPlan="max" />);
    await signUp();
    expect(writtenMarker().signupBilling).toBe('yearly');
    expect(writtenMarker().signupInProgress).toBe(true);
  });

  it('a monthly signup still buys monthly', async () => {
    sessionStorage.setItem(SIGNUP_BILLING_STORAGE_KEY, 'monthly');
    mount(<ChurchOnboarding onComplete={() => {}} />);
    await signUp();
    expect(checkoutBody().billing).toBe('monthly');
    expect(writtenMarker().signupBilling).toBe('monthly');
  });

  it('no billing period in the link still buys monthly', async () => {
    // Nothing in the URL, nothing in the lane: exactly what signup sold before
    // annual existed.
    mount(<ChurchOnboarding onComplete={() => {}} />);
    expect(container.textContent).toMatch(/billed monthly/i);
    await signUp();
    expect(checkoutBody().billing).toBe('monthly');
  });
});

describe('the stored value is untrusted', () => {
  it.each(['weekly', 'annual', 'YEARLY', ''])(
    'an invalid stored period fails closed to monthly (%j)',
    async (bad) => {
      // sessionStorage is user-writable — the lane is validated on read-back,
      // never trusted raw, and the raw value never travels onward.
      sessionStorage.setItem(SIGNUP_BILLING_STORAGE_KEY, bad);
      mount(<ChurchOnboarding onComplete={() => {}} />);
      await signUp();
      expect(checkoutBody().billing).toBe('monthly');
      if (bad) expect(fetchMock.mock.calls[0][1].body).not.toContain(bad);
    },
  );
});

describe('precedence between the two sources', () => {
  it('the URL period wins over the stored one', async () => {
    sessionStorage.setItem(SIGNUP_BILLING_STORAGE_KEY, 'yearly');
    window.history.replaceState({}, '', '/church-onboarding?billing=monthly');
    mount(<ChurchOnboarding onComplete={() => {}} />);
    await signUp();
    expect(checkoutBody().billing).toBe('monthly');
  });

  it('the URL period wins in the other direction too', async () => {
    sessionStorage.setItem(SIGNUP_BILLING_STORAGE_KEY, 'monthly');
    window.history.replaceState({}, '', '/church-onboarding?billing=yearly');
    mount(<ChurchOnboarding onComplete={() => {}} />);
    await signUp();
    expect(checkoutBody().billing).toBe('yearly');
  });

  it('a URL that carries the parameter decides alone — a mangled URL value does not fall back to the stored one', async () => {
    // ?billing=weekly with 'yearly' in the lane: the URL is the fresher, more
    // explicit statement; a mangled one fails closed to monthly rather than
    // resurrecting a stored annual choice the link did not make.
    sessionStorage.setItem(SIGNUP_BILLING_STORAGE_KEY, 'yearly');
    window.history.replaceState({}, '', '/church-onboarding?billing=weekly');
    mount(<ChurchOnboarding onComplete={() => {}} />);
    await signUp();
    expect(checkoutBody().billing).toBe('monthly');
  });
});
