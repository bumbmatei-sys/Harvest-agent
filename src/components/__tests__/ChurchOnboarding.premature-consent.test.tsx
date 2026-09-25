import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'fs';
import path from 'path';

import ChurchOnboarding from '../ChurchOnboarding';
import AuthPage from '../AuthPage';
import { PRIVACY_URL, TERMS_URL } from '../../lib/legal-links';

/**
 * THE-73 — `termsAccepted: true` was written by a screen that shows no terms.
 *
 * 🔴 THE DEFECT. ChurchOnboarding renders a plan badge, a ministry-name field
 * and a "Continue to payment" button. No terms, no link, no checkbox. It then
 * recorded that the church had accepted them. That record is not evidence of
 * anything: the screen has no way to know whether the church ever read the
 * terms, so the write is an assumption dressed as a consent record — and a
 * consent record that asserts something which did not happen is worse under
 * audit than no record at all.
 *
 * 🔴 WHY THE WRITE WAS REMOVED RATHER THAN THE TERMS ADDED. Consent is already
 * captured where it is genuinely given. AuthPage shows the sentence and links
 * the canonical Terms and Privacy documents beside the control the user
 * presses, and records `termsAccepted` on all four of its paths (Google
 * new/existing, email signup/login) — every way into the app. Adding a second
 * consent surface to the onboarding screen would add no legal value and would
 * create a SECOND writer of the same consent record, the duplicated-writer
 * shape this project keeps paying for.
 *
 * ⚠️ Nothing stored is touched. The removed write only ever ran when creating
 * a user doc that did not yet exist; a doc that already carries the field is
 * updated with the signup marker alone and keeps whatever it had.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(__dirname, '../../..');

const setDoc = vi.hoisted(() => vi.fn(async (_ref: unknown, _data: Record<string, unknown>) => {}));
const updateDoc = vi.hoisted(() => vi.fn(async (_ref: unknown, _data: Record<string, unknown>) => {}));
const getDoc = vi.hoisted(() => vi.fn());
const signInWithPopup = vi.hoisted(() => vi.fn());

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
  signInWithPopup,
  GoogleAuthProvider: class {},
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, ...p: string[]) => ({ path: p.join('/') })),
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp: () => ({ __serverTimestamp: true }),
}));
vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'get', WRITE: 'write', UPDATE: 'update' },
  handleFirestoreError: () => {},
}));
vi.mock('../../contexts/TenantContext', () => ({
  useTenant: () => ({ branding: {}, tenantId: null, tenantName: null, tenantPlan: null }),
}));
vi.mock('@marsidev/react-turnstile', () => ({ Turnstile: () => null }));

const fetchMock = vi.fn();

let container: HTMLDivElement;
let root: Root | null = null;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

function mount(el: React.ReactElement) {
  act(() => {
    root = createRoot(container);
    root.render(el);
  });
}

function buttonByLabel(label: RegExp): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) => label.test(b.textContent || ''));
}

/** Every payload this screen sent to Firestore, whichever write it used. */
function allWrites(): Record<string, unknown>[] {
  return [
    ...setDoc.mock.calls.map((c) => c[1] as Record<string, unknown>),
    ...updateDoc.mock.calls.map((c) => c[1] as Record<string, unknown>),
  ];
}

/** Fill the ministry name and press the screen's only action. */
async function completeOnboarding() {
  const input = container.querySelector('input[placeholder="Grace Community Church"]') as HTMLInputElement;
  expect(input, 'ministry-name input not rendered').toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, 'Grace Chapel');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const go = buttonByLabel(/continue to payment/i);
  expect(go, 'continue button not rendered').toBeTruthy();
  await act(async () => { go!.click(); });
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
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

describe('THE-73 — consent is only recorded where it is given', () => {
  it('termsAccepted is never written by a screen that displays no terms', async () => {
    mount(<ChurchOnboarding onComplete={() => {}} signupPlan="plus" />);

    // The premise, asserted rather than assumed: this screen presents nothing
    // to consent to. If terms are ever added here the premise changes and this
    // test must be revisited deliberately, not silently.
    const text = container.textContent || '';
    expect(text, 'the onboarding screen now shows terms copy — revisit the consent decision')
      .not.toMatch(/terms of service|privacy policy|\bterms\b/i);
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs, 'the onboarding screen now links the Terms').not.toContain(TERMS_URL);
    expect(hrefs, 'the onboarding screen now links the Privacy Policy').not.toContain(PRIVACY_URL);
    expect(
      container.querySelector('input[type="checkbox"]'),
      'the onboarding screen now has a consent checkbox — revisit the decision',
    ).toBeNull();

    // 🔴 And so it records no consent. Not on the create path, not on any path.
    await completeOnboarding();
    expect(allWrites().length, 'the signup form wrote nothing at all').toBeGreaterThan(0);
    for (const payload of allWrites()) {
      expect(
        Object.keys(payload),
        'a screen that displayed no terms asserted that the church accepted them',
      ).not.toContain('termsAccepted');
    }
  });

  it('no existing termsAccepted value is deleted or overwritten', async () => {
    // The returning church: a user doc already exists, carrying whatever
    // consent AuthPage recorded when they signed in.
    getDoc.mockResolvedValue({ exists: () => true });
    mount(<ChurchOnboarding onComplete={() => {}} signupPlan="plus" />);
    await completeOnboarding();

    expect(setDoc, 'an existing user doc was replaced rather than updated').not.toHaveBeenCalled();
    expect(updateDoc, 'the signup marker was not written').toHaveBeenCalledTimes(1);

    // Only the in-flight signup marker travels. Nothing clears, nulls or
    // re-asserts the stored consent.
    const payload = updateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      ['signupBilling', 'signupInProgress', 'signupMinistryName', 'signupPlan'],
    );

    const src = readFileSync(path.join(ROOT, 'src/components/ChurchOnboarding.tsx'), 'utf8');
    expect(src, 'the signup screen deletes a stored consent record').not.toMatch(/deleteField/);
  });

  it('consent is still recorded where the terms are actually presented', async () => {
    // AuthPage: the consent point. The terms are on screen, linked to the
    // canonical documents, beside the control the user presses.
    signInWithPopup.mockResolvedValue({
      user: { uid: 'u9', email: 'pastor@grace.org', displayName: 'Pastor', photoURL: null, getIdToken: vi.fn(async () => 'tok-9') },
    });
    getDoc.mockResolvedValue({ exists: () => false });

    await act(async () => {
      root = createRoot(container);
      root.render(<AuthPage onNavigate={() => {}} />);
    });
    await flush();

    expect(container.textContent, 'the auth screen no longer states what the user is accepting')
      .toMatch(/by continuing you accept/i);
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs, 'the auth screen does not link the canonical Terms of Service').toContain(TERMS_URL);
    expect(hrefs, 'the auth screen does not link the canonical Privacy Policy').toContain(PRIVACY_URL);

    // …and it is that screen which records the acceptance.
    const google = buttonByLabel(/(continue|sign up) with google/i);
    expect(google, 'the Google sign-in action is not on the auth screen').toBeTruthy();
    await act(async () => { google!.click(); });
    await flush();

    expect(setDoc, 'the consent point recorded no user doc').toHaveBeenCalled();
    const created = setDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(created.termsAccepted, 'the screen that presented the terms stopped recording consent').toBe(true);
  });

  it('consent is recorded on every way in, not just the one under test', () => {
    // The four write sites, one per auth path — Google new, Google existing,
    // email sign-up, email sign-in. Read from source because three of them sit
    // behind Turnstile verification that this suite does not stand up.
    const auth = readFileSync(path.join(ROOT, 'src/components/AuthPage.tsx'), 'utf8');
    const writes = auth.match(/termsAccepted:\s*true/g) ?? [];
    expect(writes.length, 'an authentication path stopped recording consent').toBe(4);
    expect(auth, 'the consent point no longer links the canonical documents').toMatch(/TERMS_URL/);
    expect(auth, 'the consent point no longer links the privacy document').toMatch(/PRIVACY_URL/);
  });

  it('no colour is hardcoded', () => {
    // The repo convention on this pre-auth screen is a token with a fallback:
    // `var(--token, #fallback)`. Those are token-backed and allowed; anything
    // left after they are stripped is a raw literal.
    //
    // 🔴 The set below is FROZEN at what the screen already carried (the error
    // banner's three, and the `white` mixing partner inside color-mix). This
    // change added no UI and so must add nothing here — and any future consent
    // checkbox added to this screen has to use token classes rather than grow
    // this list. THE-85 keeps this screen light-mode only, and the theme layer
    // is owned elsewhere; hardcoding here is how that decision gets undone.
    const src = readFileSync(path.join(ROOT, 'src/components/ChurchOnboarding.tsx'), 'utf8');
    const tokenWithFallback = /var\(\s*--[\w-]+\s*,(?:[^()]|\([^()]*\))*\)/g;
    const raw = src.replace(tokenWithFallback, 'TOKEN');
    const literals = raw.match(/#[0-9A-Fa-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:white|black)\b/g) ?? [];

    expect([...new Set(literals)].sort(), 'a new hardcoded colour entered the signup screen')
      .toEqual(['#B0432B', '#EBD0C7', '#FBEEEA', 'white']);
  });
});
