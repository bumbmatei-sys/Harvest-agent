import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * Newsletter consent is written only when the switch was on screen, and a
 * later sign-in does not overwrite it.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SENTINEL = { __serverTimestamp: true };

const { auth, createUser, signIn, signInWithPopup, setDoc, getDoc, updateDoc } = vi.hoisted(() => ({
  auth: { currentUser: null as null },
  createUser: vi.fn(),
  signIn: vi.fn(),
  signInWithPopup: vi.fn(),
  setDoc: vi.fn(async () => {}),
  getDoc: vi.fn(async (): Promise<{ exists: () => boolean; data: () => Record<string, unknown> }> => (
    { exists: () => false, data: () => ({}) }
  )),
  updateDoc: vi.fn(async () => {}),
}));

vi.mock('../../firebase', () => ({ auth, db: {} }));
vi.mock('firebase/auth', () => ({
  signInWithPopup,
  GoogleAuthProvider: class {},
  createUserWithEmailAndPassword: createUser,
  signInWithEmailAndPassword: signIn,
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp: () => SENTINEL,
}));
vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'get', WRITE: 'write', UPDATE: 'update' },
  handleFirestoreError: () => {},
}));
vi.mock('../../contexts/TenantContext', () => ({
  useTenant: () => ({ branding: {}, tenantId: null, tenantName: null, tenantPlan: null }),
}));
vi.mock('@marsidev/react-turnstile', () => ({
  Turnstile: ({ onSuccess }: { onSuccess: (t: string) => void }) => {
    React.useEffect(() => { onSuccess('turnstile-token'); }, [onSuccess]);
    return null;
  },
}));

import React from 'react';
import AuthPage from '../AuthPage';

let container: HTMLDivElement;
let root: Root | null = null;

const flush = async () => {
  await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
};

function setURL(url: string) {
  (window as unknown as { happyDOM: { setURL: (u: string) => void } }).happyDOM.setURL(url);
}

const buttonLabelled = (label: string) =>
  Array.from(container.querySelectorAll('button'))
    .find(b => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === label) as HTMLButtonElement | undefined;

const byPlaceholder = (p: string) =>
  container.querySelector(`input[placeholder="${p}"]`) as HTMLInputElement;

const typeInto = async (el: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const written = () => (setDoc.mock.calls[0] as unknown as [unknown, Record<string, unknown>] | undefined)?.[1];
const refreshed = () => (updateDoc.mock.calls[0] as unknown as [unknown, Record<string, unknown>] | undefined)?.[1];

beforeEach(() => {
  createUser.mockReset().mockResolvedValue({
    user: { uid: 'u-email', email: 'friend@gmail.test', getIdToken: async () => 'tok' },
  });
  signIn.mockReset().mockResolvedValue({
    user: { uid: 'u-email', email: 'friend@gmail.test', getIdToken: async () => 'tok' },
  });
  signInWithPopup.mockReset().mockResolvedValue({
    user: {
      uid: 'u-google', email: 'friend@gmail.test', displayName: 'The Friend', photoURL: null,
      getIdToken: async () => 'tok',
    },
  });
  setDoc.mockReset().mockResolvedValue(undefined);
  updateDoc.mockReset().mockResolvedValue(undefined);
  getDoc.mockReset().mockResolvedValue({ exists: () => false, data: () => ({}) });
  sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, canAccept: true }) })));
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  container.remove();
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () => {
    root = createRoot(container);
    root.render(<AuthPage onNavigate={() => {}} />);
  });
  await flush();
}

async function fillSignup() {
  await typeInto(byPlaceholder('you@ministry.org'), 'friend@gmail.test');
  await typeInto(byPlaceholder('Create a password'), 'Hosanna!2026');
  await typeInto(byPlaceholder('Re-enter password'), 'Hosanna!2026');
}

async function submit(label: string) {
  const button = buttonLabelled(label);
  expect(button, label).toBeDefined();
  await act(async () => { button!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await flush();
}

describe('the newsletter switch', () => {
  it('is rendered before the Google button in signup mode, and is absent on sign-in', async () => {
    setURL('https://theharvest.app/auth?signup=1');
    await mount();
    const sw = container.querySelector('[role="switch"]');
    const google = buttonLabelled('Sign up with Google');
    expect(sw).not.toBeNull();
    expect(google).toBeDefined();
    expect(sw!.compareDocumentPosition(google!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sw!.getAttribute('aria-checked')).toBe('true');
    expect(container.textContent).toContain(
      'Send me the Harvest newsletter — product updates and ministry stories. No noise.',
    );

    await act(async () => { root?.unmount(); });
    setURL('https://theharvest.app/auth');
    await mount();
    expect(container.querySelector('[role="switch"]')).toBeNull();
    expect(buttonLabelled('Continue with Google')).toBeDefined();
  });
});

describe('what gets written', () => {
  it('email signup writes the three fields, default true, and not the legacy key', async () => {
    setURL('https://theharvest.app/auth?signup=1');
    await mount();
    await fillSignup();
    await submit('Create account');
    const doc = written();
    expect(doc).toMatchObject({
      newsletterOptIn: true,
      newsletterOptInSource: 'signup-email',
      newsletterOptInAt: SENTINEL,
      termsAccepted: true,
    });
    expect(doc).not.toHaveProperty('newsletter');
  });

  it('email signup writes false after the switch is turned off', async () => {
    setURL('https://theharvest.app/auth?signup=1');
    await mount();
    const sw = container.querySelector('[role="switch"]') as HTMLButtonElement;
    await act(async () => { sw.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await fillSignup();
    await submit('Create account');
    expect(written()).toMatchObject({
      newsletterOptIn: false,
      newsletterOptInSource: 'signup-email',
      newsletterOptInAt: SENTINEL,
    });
    expect(written()).not.toHaveProperty('newsletter');
  });

  it('Google signup writes source signup-google', async () => {
    setURL('https://theharvest.app/auth?signup=1');
    await mount();
    await submit('Sign up with Google');
    expect(written()).toMatchObject({
      newsletterOptIn: true,
      newsletterOptInSource: 'signup-google',
      newsletterOptInAt: SENTINEL,
      termsAccepted: true,
    });
    expect(written()).not.toHaveProperty('newsletter');
  });

  it('Google create from the sign-in tab writes none of the three fields', async () => {
    setURL('https://theharvest.app/auth');
    await mount();
    await submit('Continue with Google');
    const doc = written();
    expect(doc).toBeTruthy();
    expect(doc).not.toHaveProperty('newsletterOptIn');
    expect(doc).not.toHaveProperty('newsletterOptInAt');
    expect(doc).not.toHaveProperty('newsletterOptInSource');
    expect(doc).not.toHaveProperty('newsletter');
    expect(doc).toMatchObject({ termsAccepted: true, role: 'user' });
  });

  it('both sign-in refreshes are exactly { termsAccepted: true }', async () => {
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ newsletterOptIn: false }) });
    setURL('https://theharvest.app/auth');
    await mount();
    await submit('Continue with Google');
    expect(setDoc).not.toHaveBeenCalled();
    expect(refreshed()).toEqual({ termsAccepted: true });

    updateDoc.mockClear();
    await typeInto(byPlaceholder('you@ministry.org'), 'friend@gmail.test');
    await typeInto(byPlaceholder('Your password'), 'Hosanna!2026');
    await submit('Sign in');
    expect(refreshed()).toEqual({ termsAccepted: true });
  });
});
