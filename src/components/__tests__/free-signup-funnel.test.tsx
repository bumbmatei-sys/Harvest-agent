import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'fs';
import path from 'path';

import ChurchOnboarding from '../ChurchOnboarding';
import WorkspaceHandoff, { CONFIRMS_ACCOUNT, CONFIRMS_PAYMENT } from '../WorkspaceHandoff';
import OnboardingGate from '../OnboardingGate';
import { resolvePostAuthFunnelRoute } from '../../utils/post-auth-route';
import {
  PAYMENT_CONFIRMATION_PENDING_KEY,
  PAYMENT_CONFIRMATION_SEEN_KEY,
  beginPaymentConfirmation,
} from '../../utils/paid-arrival';

/**
 * THE-214 — the free signup was a paid signup wearing a disguise.
 *
 * Two defects, and this file is organised around them.
 *
 * 🔴 1. "Thank you for your payment", to someone who paid nothing.
 *
 * The confirmation screen is `WorkspaceHandoff`, and `OnboardingGate` renders
 * it from TWO places with different reasons behind them. One is genuinely keyed
 * off a payment: `readPendingPaymentConfirmation` refuses to fire unless the URL
 * says the user is back from a checkout, so only a payer reaches it. The other
 * is keyed off ARRIVING — it fires when first-run setup finishes, whoever
 * finished it. A Forever Free tenant has no card, no checkout and no webhook,
 * walked into that second render exactly like a paying church, and was
 * congratulated on a payment that never happened. So the bug was NOT that a
 * free signup wrote the paid marker; it was that one of the two renders never
 * asked what it was confirming. It asks now, and the caller answers.
 *
 * 🔴 2. The funnel itself, which free inherited whole.
 *
 * Free was walked through: create account → member app → first-run setup →
 * choose a domain → sign in again. Every step after the first exists because a
 * PAYMENT sits in the middle of the paid funnel: the address is claimed after
 * checkout because checkout is what creates the tenant. Free has no checkout, so
 * it has no reason to defer anything — it now asks for the address at signup and
 * provisions there, which deletes the member-app bounce and the first-run step
 * together.
 *
 * ⚠️ WHAT MUST NOT MOVE, and is pinned here as hard as the fixes: the paid
 * funnel. Its route order, its `?billing=` lane, its pre-hop confirmation and
 * the once-only-ness of that confirmation are all asserted below against the
 * paid path, not merely left untested.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REPO = process.cwd();
const readSrc = (rel: string) => readFileSync(path.join(REPO, 'src', rel), 'utf8');

/* ── Firebase, driven by hand ─────────────────────────────────────────────── */

const setDoc = vi.hoisted(() => vi.fn(async (_ref: unknown, _data: Record<string, unknown>) => {}));
const updateDoc = vi.hoisted(() => vi.fn(async (_ref: unknown, _data: Record<string, unknown>) => {}));
const getDoc = vi.hoisted(() => vi.fn());
const getIdToken = vi.hoisted(() => vi.fn(async () => 'tok'));
const isSubdomainAvailable = vi.hoisted(() => vi.fn(async () => true));
const checkRosterAdmin = vi.hoisted(() => vi.fn(async () => false));
const authFetch = vi.hoisted(() => vi.fn(async () => ({ ok: true, json: async () => ({ tenantId: 'matei' }) })));
/** Live onSnapshot callbacks, keyed by the document path they were opened on. */
const listeners = vi.hoisted(() => new Map<string, (snap: unknown) => void>());
/** The onAuthStateChanged callbacks OnboardingGate registered. */
const authCallbacks = vi.hoisted(() => [] as Array<(user: unknown) => void>);

vi.mock('../../firebase', () => ({
  db: {},
  auth: {
    currentUser: { uid: 'u1', email: 'matei@example.com', displayName: null, getIdToken: async () => 'tok' },
  },
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot: (ref: { path: string }, next: (snap: unknown) => void) => {
    listeners.set(ref.path, next);
    return () => { listeners.delete(ref.path); };
  },
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, cb: (user: unknown) => void) => {
    authCallbacks.push(cb);
    return () => { /* noop */ };
  },
  getIdToken,
}));

vi.mock('../../utils/tenant.utils', () => ({ isSubdomainAvailable, checkRosterAdmin }));
vi.mock('../../utils/auth-fetch', () => ({ authFetch }));

// ⚠️ `../../utils/tenant-scope` is deliberately NOT mocked: the confirmation
// decides cross-origin from the real host resolver, and these tests move the
// actual document URL so that decision is made the way production makes it.

const fetchMock = vi.fn();

let container: HTMLDivElement;
let root: Root | null = null;

const flush = async () => {
  await act(async () => {
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
};

const mount = (el: React.ReactElement) => {
  act(() => {
    root = createRoot(container);
    root.render(el);
  });
};

const unmount = () => {
  act(() => { root?.unmount(); });
  root = null;
};

const setURL = (url: string) =>
  (window as unknown as { happyDOM: { setURL: (u: string) => void } }).happyDOM.setURL(url);

const text = () => container.textContent || '';

/* ── Naming targets by label, never by value pattern ──────────────────────── */

/** The visible/accessible name of a control, the way a person reads it. */
const labelOf = (el: Element): string => {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria;
  const ph = el.getAttribute('placeholder');
  if (ph) return ph;
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
};

/** The field sitting under a given visible field label. */
const fieldUnderLabel = (label: string): HTMLInputElement | null => {
  const labelEl = Array.from(container.querySelectorAll('label'))
    .find((l) => (l.textContent || '').trim().toLowerCase() === label.toLowerCase());
  return (labelEl?.parentElement?.querySelector('input') as HTMLInputElement) ?? null;
};

/** A control named by what it says, not by how it is styled. */
const control = (name: RegExp): HTMLElement | null =>
  (Array.from(container.querySelectorAll('button, a')).find((el) => name.test(labelOf(el))) as HTMLElement) ?? null;

const type = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

/** Everything ChurchOnboarding wrote onto the user doc before submitting. */
const writtenMarker = (): Record<string, unknown> => {
  if (setDoc.mock.calls.length > 0) return setDoc.mock.calls[0][1];
  expect(updateDoc, 'no signup marker was written at all').toHaveBeenCalled();
  return updateDoc.mock.calls[0][1];
};

/** The body of the one request the signup screen sent. */
const sentBody = (): Record<string, unknown> => {
  expect(fetchMock).toHaveBeenCalled();
  return JSON.parse(fetchMock.mock.calls[0][1].body);
};

const sentTo = (): string => {
  expect(fetchMock).toHaveBeenCalled();
  return fetchMock.mock.calls[0][0] as string;
};

/* ── Driving the two signup lanes ─────────────────────────────────────────── */

/** Sign up on the FREE lane: choose an address, press the create action. */
const freeSignup = async (address = 'matei') => {
  mount(<ChurchOnboarding onComplete={() => {}} signupPlan={'free' as never} />);
  await flush();
  const field = fieldUnderLabel('Your web address');
  expect(field, 'the free lane rendered no web-address field').toBeTruthy();
  await type(field!, address);
  // The availability check is debounced exactly as first-run setup's is.
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  const create = control(/create my account/i);
  expect(create, 'the free lane rendered no create action').toBeTruthy();
  await act(async () => { create!.click(); });
  await flush();
};

/** Sign up on the PAID lane, untouched: name the ministry, continue to pay. */
const paidSignup = async () => {
  mount(<ChurchOnboarding onComplete={() => {}} signupPlan={'plus' as never} />);
  await flush();
  const field = fieldUnderLabel('Ministry name');
  expect(field, 'the paid lane rendered no ministry-name field').toBeTruthy();
  await type(field!, 'Grace Chapel');
  const go = control(/continue to payment/i);
  expect(go, 'the paid lane rendered no checkout action').toBeTruthy();
  await act(async () => { go!.click(); });
  await flush();
};

/* ── Driving the gate ─────────────────────────────────────────────────────── */

/** A user document, as the gate's own listener would deliver it. */
const userDoc = (data: Record<string, unknown>) => ({ exists: () => true, data: () => data });
/** A tenant document, ditto. */
const tenantDoc = (data: Record<string, unknown>) => ({ exists: () => true, data: () => data });

const signIn = async () => {
  await act(async () => { authCallbacks[0]?.({ uid: 'u1', email: 'matei@example.com' }); });
};
const pushUser = async (data: Record<string, unknown>) => {
  await act(async () => { listeners.get('users/u1')?.(userDoc(data)); });
};
const pushTenant = async (id: string, data: Record<string, unknown>) => {
  await act(async () => { listeners.get(`tenants/${id}`)?.(tenantDoc(data)); });
};

/** The sentinel standing in for the signed-in member app the gate wraps. */
const MEMBER_APP = 'THE MEMBER APP';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  listeners.clear();
  authCallbacks.length = 0;
  sessionStorage.clear();
  localStorage.clear();
  document.documentElement.className = '';
  setURL('https://theharvest.app/church-onboarding');
  getDoc.mockResolvedValue({ exists: () => false });
  isSubdomainAvailable.mockResolvedValue(true);
  authFetch.mockResolvedValue({ ok: true, json: async () => ({ tenantId: 'matei' }) });
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ tenantId: 'matei', created: true }) });
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  unmount();
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* ═══════════════════════════════════════════════════════════════════════════
   1 — the reported bug
   ═══════════════════════════════════════════════════════════════════════════ */

describe('a free signup never says thank you for your payment', () => {
  /**
   * The founder's words: "When signing in it still says thank you for your
   * payment." This drives the whole free signup through the gate that owns
   * these screens — marker written, tenant provisioned, confirmation painted —
   * and reads what is actually on the glass at the end of it.
   */
  const runFreeSignupThroughTheGate = async () => {
    mount(<OnboardingGate><div>{MEMBER_APP}</div></OnboardingGate>);
    await signIn();
    // ChurchOnboarding has written the marker; no tenant exists yet.
    await pushUser({ signupInProgress: true, signupPlan: 'free', signupMinistryName: 'matei', signupSubdomain: 'matei' });
    // provision-free answers, and the user doc gains its tenant.
    await pushUser({ tenantId: 'matei', role: 'admin', plan: 'free', signupPlan: 'free', signupInProgress: false, signupMinistryName: 'matei' });
    await pushTenant('matei', { setupCompleted: true, name: 'matei', plan: 'free' });
    await flush();
  };

  it('does not claim a payment on the screen that ends a free signup', async () => {
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ name: 'matei', plan: 'free' }) });
    await runFreeSignupThroughTheGate();

    const copy = text();
    expect(copy, 'a free tenant was thanked for a payment it never made').not.toMatch(/payment/i);
    expect(copy).not.toMatch(/\bpaid\b/i);
    expect(copy).not.toMatch(/\bcharged?\b/i);
  });

  it('confirms the thing that actually happened — the account exists', async () => {
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ name: 'matei', plan: 'free' }) });
    await runFreeSignupThroughTheGate();

    expect(text()).toContain('Account created');
    expect(text()).toContain('Your account is ready.');
  });

  it('still names the address and explains the one sign-in that is left', async () => {
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ name: 'matei', plan: 'free' }) });
    await runFreeSignupThroughTheGate();

    // The reassurance the paid screen gives is owed here too: the workspace
    // really is on another origin and the sign-in really is coming.
    expect(text()).toContain('matei.theharvest.app');
    expect(text()).toContain('sign in once more');
    expect(text()).toContain('nothing was lost');
  });

  it('a free tenant still carrying setupCompleted: false is not congratulated on a payment either', async () => {
    // Provisioned before THE-214, so it still reaches first-run setup — the
    // OTHER surface that said "Payment received" to everyone who got there.
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ plan: 'free', subdomain: 'matei' }) });
    mount(<OnboardingGate><div>{MEMBER_APP}</div></OnboardingGate>);
    await signIn();
    await pushUser({ tenantId: 'matei', role: 'admin', plan: 'free' });
    await pushTenant('matei', { setupCompleted: false, plan: 'free' });
    await flush();

    expect(text(), 'first-run setup rendered nothing').toContain('Finish setting up your ministry');
    expect(text()).not.toMatch(/payment/i);
    expect(text()).toContain('Account created');
  });

  it('the confirmation screen itself says only what it was told to say', async () => {
    // The component's own contract, isolated from any caller: it cannot know
    // whether money moved and must not guess. Both renders below are the SAME
    // screen with one sentence swapped.
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ name: 'matei' }) });
    mount(<WorkspaceHandoff tenantId="matei" confirms={CONFIRMS_ACCOUNT} />);
    await flush();
    expect(text()).toContain('Your account is ready.');
    expect(text()).not.toMatch(/payment/i);

    unmount();
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    mount(<WorkspaceHandoff tenantId="matei" confirms={CONFIRMS_PAYMENT} />);
    await flush();
    expect(text()).toContain('Your payment went through.');
  });

  it('and it fails closed to the payment claim when no reason is given', async () => {
    // 🔴 The direction this fails in. A church that paid and is told nothing is
    // the chargeback the screen exists to prevent; a free tenant shown the
    // payment line is a bug. So an omitted reason still says the payment
    // landed — a caller must KNOW a signup was free to claim it was.
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ name: 'Grace' }) });
    mount(<WorkspaceHandoff tenantId="gracechurch" />);
    await flush();
    expect(text()).toContain('Your payment went through.');
  });

  it('and the waiting screen in between does not confirm a payment either', async () => {
    mount(<OnboardingGate><div>{MEMBER_APP}</div></OnboardingGate>);
    await signIn();
    await pushUser({ signupInProgress: true, signupPlan: 'free', signupMinistryName: 'matei' });
    await flush();

    expect(text(), 'the free signup never reached the waiting screen').toContain('Creating your ministry');
    expect(text()).not.toMatch(/payment/i);
  });

  it('a free tenant with no signup marker left is still not thanked for a payment', async () => {
    /**
     * 🔴 WHY THE ACCOUNT'S OWN PLAN IS READ, not just the signup intent marker.
     * `signupPlan` is written by the signup screen, so it is absent for any
     * free tenant that did not come through it — `/api/tenants/provision-free`
     * is a plain authenticated POST, and a tenant provisioned before the marker
     * existed has none either. Those accounts still finish first-run setup and
     * still reach this screen. Reading `plan` off the user doc is what answers
     * for them; the marker alone would call every one of them a payer.
     */
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ plan: 'free', subdomain: 'matei', name: 'matei' }) });
    mount(<OnboardingGate><div>{MEMBER_APP}</div></OnboardingGate>);
    await signIn();
    await pushUser({ tenantId: 'matei', role: 'admin', plan: 'free' }); // no signupPlan
    await pushTenant('matei', { setupCompleted: false, plan: 'free', subdomain: 'matei' });
    await flush();

    const finish = control(/finish & enter app/i);
    expect(finish, 'first-run setup offered no way to finish').toBeTruthy();
    await act(async () => { finish!.click(); });
    await flush();

    expect(text(), 'a free tenant with no marker was congratulated on a payment')
      .not.toMatch(/payment/i);
    expect(text()).toContain('Your account is ready.');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2 — the no-regression that outranks everything else here
   ═══════════════════════════════════════════════════════════════════════════ */

describe('a paying church still sees its payment confirmation exactly once, before the hop', () => {
  /**
   * 🔴 PR 327/334's whole reason for existing. A church that has paid must be
   * told so on the origin that took the money — before the apex → subdomain hop
   * ends its session — and must not be told again on the far side.
   */
  const arriveFromCheckout = async () => {
    setURL('https://theharvest.app/?dodo=success');
    // What App.tsx's callback does when it holds the hop back.
    beginPaymentConfirmation('gracechurch');
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ name: 'Grace Community Church', plan: 'plus' }) });
    mount(<OnboardingGate><div>{MEMBER_APP}</div></OnboardingGate>);
    await signIn();
    await pushUser({ tenantId: 'gracechurch', role: 'admin', plan: 'plus', signupPlan: 'plus', signupInProgress: false });
    await pushTenant('gracechurch', { setupCompleted: false, name: 'Grace Community Church' });
    await flush();
  };

  it('says the payment went through, before the app is reachable', async () => {
    await arriveFromCheckout();
    expect(text()).toContain('Your payment went through.');
    expect(text()).toContain('Payment received');
    // Before the hop means: not behind the app, and not behind first-run setup.
    expect(text()).not.toContain(MEMBER_APP);
    expect(text()).not.toContain('Finish setting up your ministry');
  });

  it('and is not shown a second time once acknowledged', async () => {
    await arriveFromCheckout();
    const go = control(/continue to gracechurch\.theharvest\.app/i);
    expect(go, 'the confirmation offered no way onward').toBeTruthy();
    await act(async () => { go!.click(); });

    // A fresh arrival in the same tab — a browser Back, a reopened link.
    unmount();
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    listeners.clear();
    authCallbacks.length = 0;
    await arriveFromCheckout();

    expect(text(), 'the payer was congratulated twice').not.toContain('Your payment went through.');
  });

  it('the acknowledgement rides the hop, so the destination origin does not repeat it', async () => {
    await arriveFromCheckout();
    const go = control(/continue to gracechurch\.theharvest\.app/i);
    expect(go!.getAttribute('href')).toContain('https://gracechurch.theharvest.app/admin');
    expect(go!.getAttribute('href'), 'the hint that suppresses the duplicate was dropped')
      .toContain('payment_confirmed=1');
  });

  it('the pre-hop confirmation is reached only from the paid-arrival lane', () => {
    // Structural, and the point of it: the render that claims a payment is
    // wired to `readPendingPaymentConfirmation`, which refuses unless the URL
    // says the user is back from a checkout. Nothing free can reach it.
    const gate = readSrc('components/OnboardingGate.tsx');
    expect(gate).toMatch(/confirmingTenantId[\s\S]{0,400}confirms=\{CONFIRMS_PAYMENT\}/);
  });

  it('the free lane added no second writer of the paid arrival marker', () => {
    // 🔴 The duplicated-writer problem this project keeps paying for. The free
    // confirmation is reached by a transition the gate's own listener already
    // observes — it writes no storage key, dispatches no event and reads no
    // query parameter. `paid-arrival.ts` still has exactly one writer per fact.
    const gate = readSrc('components/OnboardingGate.tsx');
    const onboarding = readSrc('components/ChurchOnboarding.tsx');
    for (const src of [gate, onboarding]) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(code).not.toContain('beginPaymentConfirmation');
      expect(code).not.toContain(PAYMENT_CONFIRMATION_PENDING_KEY);
      expect(code).not.toContain(PAYMENT_CONFIRMATION_SEEN_KEY);
    }
    // …and the free lane never writes the paid keys by any other spelling.
    expect(sessionStorage.getItem(PAYMENT_CONFIRMATION_PENDING_KEY)).toBeNull();
    expect(sessionStorage.getItem(PAYMENT_CONFIRMATION_SEEN_KEY)).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3 — the church that does not exist
   ═══════════════════════════════════════════════════════════════════════════ */

describe('a free signup asks for a subdomain, not a church name', () => {
  it('offers a web-address field and no ministry-name field', async () => {
    mount(<ChurchOnboarding onComplete={() => {}} signupPlan={'free' as never} />);
    await flush();

    expect(fieldUnderLabel('Your web address'), 'no address field').toBeTruthy();
    expect(fieldUnderLabel('Ministry name'), 'the free lane still asks to name a church').toBeNull();
    expect(text()).toContain('Choose your web address');
    expect(text()).not.toContain('Name your ministry');
  });

  it('provisions at the address that was typed, and names the tenant after it', async () => {
    await freeSignup('matei');

    expect(sentTo()).toBe('/api/tenants/provision-free');
    // Both, from one field: the address the tenant lives at, and the display
    // name every surface reading `tenant.name` falls back on.
    expect(sentBody()).toMatchObject({ subdomain: 'matei', ministryName: 'matei' });
  });

  it('the chosen address travels on the marker, so a restart lands on the same one', async () => {
    await freeSignup('matei');
    expect(writtenMarker()).toMatchObject({ signupSubdomain: 'matei' });
  });

  it('a free tenant is never given a blank display name', async () => {
    // 🔴 The reason the address doubles as the name. `tenant.name` drives the
    // admin header, the white-label PWA manifest and every public page; a blank
    // one is an empty heading on all of them.
    const provisioning = readSrc('lib/free-provisioning.ts');
    expect(provisioning).toMatch(/name:\s*name\s*\|\|\s*'My Ministry'/);
    const body = sentBodyAfter(() => freeSignup('matei'));
    await expect(body).resolves.toMatchObject({ ministryName: 'matei' });
  });

  it('the address is sanitised to something that can actually be a subdomain', async () => {
    mount(<ChurchOnboarding onComplete={() => {}} signupPlan={'free' as never} />);
    await flush();
    const field = fieldUnderLabel('Your web address')!;
    await type(field, 'Matei Bumb!! 42');
    expect(field.value).toBe('mateibumb42');
  });

  it('the paid lane still asks for a ministry name', async () => {
    mount(<ChurchOnboarding onComplete={() => {}} signupPlan={'plus' as never} />);
    await flush();
    expect(fieldUnderLabel('Ministry name')).toBeTruthy();
    expect(fieldUnderLabel('Your web address')).toBeNull();
    expect(text()).toContain('Name your ministry');
  });
});

/** Run a signup and hand back the body it sent. */
async function sentBodyAfter(run: () => Promise<void>): Promise<Record<string, unknown>> {
  await run();
  return sentBody();
}

/* ═══════════════════════════════════════════════════════════════════════════
   4 — the bounce the founder called unclean
   ═══════════════════════════════════════════════════════════════════════════ */

describe('a free signup does not route through the member app', () => {
  it('never lands the browser back on "/" after provisioning', () => {
    // That assignment WAS the bounce: "/" re-enters the SPA with the gate still
    // resolving, so the gate paints `children` — the whole signed-in member app
    // — until the user-doc read finishes.
    const src = readSrc('components/ChurchOnboarding.tsx');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code, 'the free lane still bounces through the member app')
      .not.toMatch(/window\.location\.href\s*=\s*'\/'/);
  });

  it('the member app is never painted between the signup screen and the confirmation', async () => {
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ name: 'matei', plan: 'free' }) });
    mount(<OnboardingGate><div>{MEMBER_APP}</div></OnboardingGate>);
    await signIn();

    await pushUser({ signupInProgress: true, signupPlan: 'free', signupMinistryName: 'matei' });
    await flush();
    expect(text(), 'the member app flashed while the account was being created').not.toContain(MEMBER_APP);

    await pushUser({ tenantId: 'matei', role: 'admin', plan: 'free', signupPlan: 'free', signupInProgress: false });
    await pushTenant('matei', { setupCompleted: true, name: 'matei', plan: 'free' });
    await flush();
    expect(text(), 'the member app was painted instead of the confirmation').not.toContain(MEMBER_APP);
    expect(text()).toContain('Your account is ready.');
  });

  it('and no first-run step is left to walk through', async () => {
    // The address was chosen at signup, so the tenant arrives setup-complete
    // and the screen that used to ask for it is not owed.
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ name: 'matei', plan: 'free' }) });
    mount(<OnboardingGate><div>{MEMBER_APP}</div></OnboardingGate>);
    await signIn();
    await pushUser({ signupInProgress: true, signupPlan: 'free', signupMinistryName: 'matei' });
    await pushUser({ tenantId: 'matei', role: 'admin', plan: 'free', signupInProgress: false });
    await pushTenant('matei', { setupCompleted: true, name: 'matei', plan: 'free' });
    await flush();

    expect(text()).not.toContain('Finish setting up your ministry');
  });

  it('the sign-in that remains is the one the confirmation warns about', async () => {
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ name: 'matei', plan: 'free' }) });
    mount(<OnboardingGate><div>{MEMBER_APP}</div></OnboardingGate>);
    await signIn();
    await pushUser({ signupInProgress: true, signupPlan: 'free', signupMinistryName: 'matei' });
    await pushUser({ tenantId: 'matei', role: 'admin', plan: 'free', signupInProgress: false });
    await pushTenant('matei', { setupCompleted: true, name: 'matei', plan: 'free' });
    await flush();

    // One action, pointing at the new origin — the second sign-in is not
    // removed (it cannot be), it is announced and it happens exactly once.
    const go = control(/continue to matei\.theharvest\.app/i);
    expect(go, 'no way onward from the confirmation').toBeTruthy();
    expect(go!.getAttribute('href')).toBe('https://matei.theharvest.app/admin');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   5 — the stuck-account guard
   ═══════════════════════════════════════════════════════════════════════════ */

describe('a free tenant is never left with signupInProgress set', () => {
  /**
   * 🔴 THE HIGHEST-PRIORITY CLAIM IN THIS FILE. `signupInProgress` is written
   * before the account exists and is cleared, on the paid lanes, by a webhook.
   * A free signup has no webhook. If nothing cleared it, the evangelist would
   * be shown a payment screen for a plan that cannot be bought, forever.
   */
  it('the free path clears the marker in the same request that sets the tenant', async () => {
    const { mockGet, mockUpdate, mockBatchSet, run } = await freeProvisioningHarness();
    mockGet.mockResolvedValue({ exists: false, data: () => null });
    await run();

    const userUpdate = mockUpdate.mock.calls.at(-1)![0];
    expect(userUpdate).toMatchObject({ signupInProgress: false, tenantId: expect.any(String) });
    // Same request, not a later one: the tenant write and the release are the
    // same server call, so there is no window in which a free signup is "in
    // flight" with nothing coming to finish it.
    expect(mockBatchSet).toHaveBeenCalled();
  });

  it('no webhook is required for it, because none exists', () => {
    const provisioning = readSrc('lib/free-provisioning.ts');
    expect(provisioning).toMatch(/signupInProgress:\s*false/);
    // The release is server-side, on the user's own doc, exactly like both
    // processors' — and there is still no client-side release anywhere.
    for (const rel of ['components/ChurchOnboarding.tsx', 'components/OnboardingGate.tsx', 'App.tsx']) {
      const code = readSrc(rel).replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(code, `${rel} releases the funnel from the client`).not.toMatch(/signupInProgress\s*:\s*false/);
    }
  });

  it('and if provisioning never answers, the way out is a retry — never a payment', async () => {
    mount(<OnboardingGate><div>{MEMBER_APP}</div></OnboardingGate>);
    await signIn();
    await pushUser({ signupInProgress: true, signupPlan: 'free', signupMinistryName: 'matei', signupSubdomain: 'matei' });
    await flush();

    // The gate waits, then stops waiting. No processor is coming back with a
    // success marker on this lane, so it falls through to the resumable screen.
    await act(async () => { await vi.advanceTimersByTimeAsync(31000); });
    await flush();

    expect(text()).toContain('Finish setting up');
    expect(text(), 'a free signup was offered a payment it cannot make').not.toMatch(/complete your payment/i);
    expect(control(/continue to payment/i)).toBeNull();

    const retry = control(/create my ministry/i);
    expect(retry, 'a stalled free signup was left with no way out').toBeTruthy();
    fetchMock.mockClear();
    await act(async () => { retry!.click(); });
    await flush();

    expect(sentTo()).toBe('/api/tenants/provision-free');
    // …at the SAME address, not a fresh one they never chose.
    expect(sentBody()).toMatchObject({ subdomain: 'matei' });
  });

  it('the tenant is created setup-complete when the address was already chosen', async () => {
    // 🔴 What actually removes the extra step. First-run setup exists to ask
    // for a subdomain; when signup already asked, leaving `setupCompleted`
    // false would put that screen back in front of the evangelist — the exact
    // step the founder called out — and would ask them to choose an address
    // they have already chosen.
    const chosen = await freeProvisioningHarness();
    chosen.mockGet.mockResolvedValue({ exists: false, data: () => null });
    await chosen.run();
    expect(tenantWrite(chosen.mockBatchSet)).toMatchObject({ setupCompleted: true, subdomain: 'matei' });
  });

  it('and still gated on first-run when no address was chosen, exactly as before', async () => {
    // The pre-THE-214 shape, still reachable from any caller holding only a
    // name. Nothing about that path changed: the id is generated from the name
    // and first-run setup is still owed.
    const unchosen = await freeProvisioningHarness();
    unchosen.mockGet.mockResolvedValue({ exists: false, data: () => null });
    await unchosen.runWithoutAddress();
    expect(tenantWrite(unchosen.mockBatchSet)).toMatchObject({ setupCompleted: false });
  });

  it('a collision on the chosen address still provisions, rather than refusing', () => {
    // 🔴 The direction this must fail in. Refusing would leave the marker set
    // with no tenant behind it — the stuck account — to protect an exact
    // string. `generateUniqueSubdomain` re-checks and suffixes instead.
    const provisioning = readSrc('lib/free-provisioning.ts');
    expect(provisioning).toMatch(/generateUniqueSubdomain\(chosenAddress \|\| name\)/);
  });
});

/** The free-provisioning module, wired to inspectable admin-SDK doubles. */
async function freeProvisioningHarness() {
  vi.resetModules();
  const mockGet = vi.fn();
  const mockUpdate = vi.fn(async (_data: Record<string, unknown>) => {});
  const mockBatchSet = vi.fn((_ref: unknown, _data: Record<string, unknown>) => {});
  const mockBatchCommit = vi.fn(async () => {});
  vi.doMock('@/lib/firebase-admin', () => ({
    adminDb: {
      collection: () => ({ doc: (id: string) => ({ id, get: mockGet, update: mockUpdate }) }),
      batch: () => ({ set: mockBatchSet, commit: mockBatchCommit }),
    },
  }));
  vi.doMock('@/lib/set-custom-claims', () => ({ setCustomClaims: vi.fn(async () => {}) }));
  vi.doMock('@/lib/tenant-private', () => ({ tenantPrivateRef: (id: string) => ({ id }), TENANT_PRIVATE_COLLECTION: 'tenant_private' }));
  vi.doMock('@/lib/tenant-subdomain', () => ({ generateUniqueSubdomain: vi.fn(async (b: string) => b) }));
  vi.doMock('@/lib/tenant-lifecycle', () => ({ TENANT_STATUS_ACTIVE: 'active' }));
  const { provisionFreeTenant } = await import('@/lib/free-provisioning');
  return {
    mockGet, mockUpdate, mockBatchSet, mockBatchCommit,
    run: () => provisionFreeTenant({
      userId: 'u1', ministryName: 'matei', userEmail: 'matei@example.com', requestedSubdomain: 'matei',
    }),
    runWithoutAddress: () => provisionFreeTenant({
      userId: 'u1', ministryName: 'Grace Church', userEmail: 'matei@example.com',
    }),
  };
}

/** The tenant document out of the batch, found by shape rather than call order. */
const tenantWrite = (
  batchSet: { mock: { calls: Array<[unknown, Record<string, unknown>]> } },
): Record<string, unknown> => {
  const call = batchSet.mock.calls.find((c) => c[1] && 'subdomain' in c[1]);
  expect(call, 'no tenant document was written').toBeTruthy();
  return call![1];
};

/* ═══════════════════════════════════════════════════════════════════════════
   6 — consent
   ═══════════════════════════════════════════════════════════════════════════ */

describe('terms are still recorded where they are shown', () => {
  it('AuthPage records consent on every way in, and the signup screen records none', () => {
    // PR 343's rule, unchanged by either lane here: consent is recorded on the
    // screen that actually presents the terms. A screen that shows no terms has
    // no evidence of consent and must not assert one.
    const auth = readSrc('components/AuthPage.tsx');
    const consentWrites = auth.match(/termsAccepted:\s*true/g) ?? [];
    expect(consentWrites.length, 'AuthPage stopped recording consent on all four ways in')
      .toBeGreaterThanOrEqual(4);
    expect(auth).toContain('Terms');

    // Code only: THE-73's note on that screen EXPLAINS why it records no
    // consent, and prose about the rule must not read as a breach of it.
    const onboarding = readSrc('components/ChurchOnboarding.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(onboarding, 'the signup screen started asserting a consent it never collected')
      .not.toMatch(/termsAccepted/);
  });

  it('neither lane of the signup screen writes a consent record', async () => {
    await freeSignup('matei');
    expect(JSON.stringify(writtenMarker())).not.toContain('termsAccepted');
    vi.clearAllMocks();
    unmount();
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    getDoc.mockResolvedValue({ exists: () => false });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await paidSignup();
    expect(JSON.stringify(writtenMarker())).not.toContain('termsAccepted');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   7 — the billing lane
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the billing lane still fails closed to monthly for a paid signup, and forces no term on a free one', () => {
  it('a paid signup with no period still buys monthly', async () => {
    setURL('https://theharvest.app/church-onboarding');
    await paidSignup();
    expect(sentBody()).toMatchObject({ plan: 'plus', billing: 'monthly' });
    expect(writtenMarker()).toMatchObject({ signupBilling: 'monthly' });
  });

  it('a paid signup carrying a mangled period still fails closed to monthly', async () => {
    setURL('https://theharvest.app/church-onboarding?billing=forever');
    await paidSignup();
    expect(sentBody()).toMatchObject({ billing: 'monthly' });
  });

  it('a paid signup carrying a real term still buys that term', async () => {
    setURL('https://theharvest.app/church-onboarding?billing=yearly');
    await paidSignup();
    expect(sentBody()).toMatchObject({ billing: 'yearly' });
    expect(writtenMarker()).toMatchObject({ signupBilling: 'yearly' });
  });

  it('a free signup is stamped with no term at all', async () => {
    await freeSignup('matei');
    // Free is never billed. 'monthly' is not a harmless default here — it is a
    // term recorded against an account that has no price to attach it to, and
    // the gate reads this marker back to restart a checkout.
    expect(writtenMarker()).not.toHaveProperty('signupBilling');
    expect(sentBody()).not.toHaveProperty('billing');
  });

  it('a free signup carrying ?billing= in the URL is stamped with no term either', async () => {
    setURL('https://theharvest.app/church-onboarding?billing=yearly');
    await freeSignup('matei');
    expect(writtenMarker()).not.toHaveProperty('signupBilling');
    expect(sentBody()).not.toHaveProperty('billing');
  });

  it('and states no term on the screen, where the paid lane states one', async () => {
    setURL('https://theharvest.app/church-onboarding?billing=yearly');
    mount(<ChurchOnboarding onComplete={() => {}} signupPlan={'free' as never} />);
    await flush();
    expect(text()).not.toMatch(/billed (monthly|quarterly|annually)/i);

    unmount();
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    mount(<ChurchOnboarding onComplete={() => {}} signupPlan={'plus' as never} />);
    await flush();
    expect(text(), 'the paid lane stopped showing the term the church is about to be charged for')
      .toMatch(/billed annually/i);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   8 — the ordering three prior tickets already touched
   ═══════════════════════════════════════════════════════════════════════════ */

describe("the paid funnel's route order is unchanged", () => {
  it('the affiliate host still outranks every signup intent', () => {
    expect(resolvePostAuthFunnelRoute({
      onAffiliateHost: true, confirmedTenantless: true,
      churchSignupIntent: true, planSignupIntent: true, isChurchAdminRole: true,
    })).toBe('/');
  });

  it('church and plan intent, and an established church admin, still reach church onboarding', () => {
    const base = { onAffiliateHost: false, confirmedTenantless: true, churchSignupIntent: false, planSignupIntent: false, isChurchAdminRole: false };
    expect(resolvePostAuthFunnelRoute({ ...base, churchSignupIntent: true })).toBe('/church-onboarding');
    expect(resolvePostAuthFunnelRoute({ ...base, planSignupIntent: true })).toBe('/church-onboarding');
    expect(resolvePostAuthFunnelRoute({ ...base, isChurchAdminRole: true })).toBe('/church-onboarding');
  });

  it('everyone else still reaches member onboarding', () => {
    expect(resolvePostAuthFunnelRoute({
      onAffiliateHost: false, confirmedTenantless: true,
      churchSignupIntent: false, planSignupIntent: false, isChurchAdminRole: false,
    })).toBe('/onboarding');
  });

  it('a free signup uses that order rather than a lane of its own', () => {
    // `?signup=free` is a plan intent like any other, so it reaches
    // '/church-onboarding' through the SAME branch a paid plan does. No new
    // precedence rule was introduced, which is what keeps this order safe.
    expect(resolvePostAuthFunnelRoute({
      onAffiliateHost: false, confirmedTenantless: true,
      churchSignupIntent: false, planSignupIntent: true, isChurchAdminRole: false,
    })).toBe('/church-onboarding');
    expect(readSrc('utils/post-auth-route.ts')).not.toMatch(/free/i);
  });

  it('the funnel paths themselves are unchanged, in order', () => {
    const app = readSrc('App.tsx');
    const decl = /const FUNNEL_PATHS = \[([^\]]*)\]/.exec(app);
    expect(decl, 'FUNNEL_PATHS was renamed or removed').toBeTruthy();
    expect(decl![1].match(/'[^']+'/g)).toEqual(["'/auth'", "'/onboarding'", "'/church-onboarding'"]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   9 — the widget PR 308 had to remount by hand
   ═══════════════════════════════════════════════════════════════════════════ */

describe("Turnstile's mount is unchanged", () => {
  const auth = () => readSrc('components/AuthPage.tsx');

  it('is still mounted once, keyed so a remount forces a fresh single-use token', () => {
    const src = auth();
    expect(src.match(/<Turnstile\b/g) ?? [], 'Turnstile is mounted more than once, or not at all')
      .toHaveLength(1);
    expect(src).toMatch(/<Turnstile[\s\S]{0,80}key=\{turnstileKey\}/);
  });

  it('still remounts on every path that consumes a token', () => {
    // PR 308: the tokens are single-use, so every failure path has to bump the
    // key or the next attempt submits a spent token.
    expect(auth().match(/setTurnstileKey\(\(k\) => k \+ 1\)/g) ?? []).toHaveLength(3);
  });

  it('nothing in this change reaches the widget', () => {
    for (const rel of ['components/ChurchOnboarding.tsx', 'components/OnboardingGate.tsx', 'components/WorkspaceHandoff.tsx', 'components/FirstRunSetup.tsx']) {
      expect(readSrc(rel), `${rel} touches Turnstile`).not.toMatch(/[Tt]urnstile/);
    }
  });
});
