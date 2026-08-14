import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * THE-100 — the returning-church error path on signup.
 *
 * Before this change, every signup failure except auth/operation-not-allowed
 * fell through to `setError(err.message || 'Authentication failed.')` — raw
 * Firebase wording, with auth/email-already-in-use (the case that matters
 * most: someone who already has a Harvest account) offering no route back to
 * sign-in. These tests pin the fix: named codes with copy a church can act
 * on, an actionable "Sign in instead" for the existing-account case that
 * reuses the same mode-switch as the toggle link (so the typed email and the
 * Turnstile remount both survive), and a message — never Firebase's own
 * wording — for anything unrecognised.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { auth, createUser, signIn, setDoc } = vi.hoisted(() => ({
  auth: { currentUser: null },
  createUser: vi.fn(),
  signIn: vi.fn(),
  setDoc: vi.fn(async () => {}),
}));

vi.mock('../../firebase', () => ({ auth, db: {} }));
vi.mock('firebase/auth', () => ({
  signInWithPopup: vi.fn(),
  GoogleAuthProvider: class {},
  createUserWithEmailAndPassword: createUser,
  signInWithEmailAndPassword: signIn,
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  setDoc,
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  updateDoc: vi.fn(async () => {}),
}));
vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'get', WRITE: 'write', UPDATE: 'update' },
  handleFirestoreError: () => {},
}));
vi.mock('../../contexts/TenantContext', () => ({
  useTenant: () => ({ branding: {}, tenantId: null, tenantName: null, tenantPlan: null }),
}));
vi.mock('../AuthShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Manual-solve stand-in for the bot gate: nothing fires until the test clicks
// "solve", and — because AuthPage remounts this widget with a fresh `key`
// after every attempt — a brand-new instance appears each time, exactly like
// a real single-use Turnstile token being spent and reissued.
let turnstileMounts = 0;
vi.mock('@marsidev/react-turnstile', () => ({
  Turnstile: ({ onSuccess }: { onSuccess: (t: string) => void }) => {
    React.useEffect(() => { turnstileMounts += 1; }, []);
    return (
      <button type="button" data-testid="turnstile-solve" onClick={() => onSuccess('solved-token')}>
        solve
      </button>
    );
  },
}));

import React from 'react';
import AuthPage from '../AuthPage';

let container: HTMLDivElement;
let root: Root | null = null;

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

function setURL(url: string) {
  (window as unknown as { happyDOM: { setURL: (u: string) => void } }).happyDOM.setURL(url);
}

const typeInto = async (el: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const byPlaceholder = (p: string) =>
  container.querySelector(`input[placeholder="${p}"]`) as HTMLInputElement;

const solveTurnstile = async () => {
  const btn = container.querySelector('[data-testid="turnstile-solve"]') as HTMLButtonElement;
  await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};

const findButton = (label: string) =>
  Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

const text = () => (container.textContent ?? '').replace(/\s+/g, ' ');

beforeEach(() => {
  vi.clearAllMocks();
  turnstileMounts = 0;
  sessionStorage.clear();
  setURL('https://theharvest.app/auth?signup=plus');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) })));
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

async function fillSignupForm(email = 'pastor@church.org', password = 'Hosanna!2026') {
  await typeInto(byPlaceholder('you@ministry.org'), email);
  await typeInto(byPlaceholder('Create a password'), password);
  await typeInto(byPlaceholder('Re-enter password'), password);
}

async function submitSignup() {
  const submit = findButton('Create account')!;
  await act(async () => { submit.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await flush();
}

// ── 1 ── existing email is told to sign in, in plain words ─────────────────
describe('an email that already has an account', () => {
  it('is told to sign in, in plain words', async () => {
    createUser.mockRejectedValueOnce({ code: 'auth/email-already-in-use', message: 'Firebase: Error (auth/email-already-in-use).' });
    await mount();
    await fillSignupForm();
    await solveTurnstile();
    await submitSignup();

    expect(text()).toContain('An account with this email already exists.');
    expect(findButton('Sign in instead')).toBeDefined();
  });
});

// ── 2 ── the one that matters most: no raw Firebase wording, ever ──────────
describe('no Firebase error code or raw Firebase wording reaches the screen', () => {
  it('for the existing-account case', async () => {
    createUser.mockRejectedValueOnce({ code: 'auth/email-already-in-use', message: 'Firebase: Error (auth/email-already-in-use).' });
    await mount();
    await fillSignupForm();
    await solveTurnstile();
    await submitSignup();

    expect(text()).not.toMatch(/auth\//);
    expect(text()).not.toMatch(/Firebase:/);
  });

  it('for invalid-email, network-request-failed, and an unrecognised code', async () => {
    const cases: Array<{ code: string; message: string }> = [
      { code: 'auth/invalid-email', message: 'Firebase: Error (auth/invalid-email).' },
      { code: 'auth/network-request-failed', message: 'Firebase: Error (auth/network-request-failed).' },
      { code: 'auth/internal-error', message: 'Firebase: An internal AuthError has occurred (auth/internal-error).' },
    ];
    await mount();
    for (const c of cases) {
      createUser.mockRejectedValueOnce(c);
      await fillSignupForm();
      await solveTurnstile();
      await submitSignup();
      expect(text()).not.toMatch(/auth\//);
      expect(text()).not.toMatch(/Firebase:/);
      expect(text()).not.toContain(c.message);
    }
  });

  it('on the Google sign-in path too', async () => {
    // Same shape of bug as the email/password path — an unrecognised error
    // must not surface Firebase's own wording there either.
    const { signInWithPopup } = await import('firebase/auth');
    (signInWithPopup as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      code: 'auth/internal-error',
      message: 'Firebase: An internal AuthError has occurred (auth/internal-error).',
    });
    await mount();
    const googleBtn = findButton('Sign up with Google')!;
    await act(async () => { googleBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();

    expect(text()).not.toMatch(/auth\//);
    expect(text()).not.toMatch(/Firebase:/);
    expect(text()).toContain('Failed to sign in with Google. Please try again.');
  });
});

// ── 3 ── the typed email survives the switch to sign-in ────────────────────
describe('switching to sign-in after an existing-account error', () => {
  it('keeps the email the person already typed', async () => {
    createUser.mockRejectedValueOnce({ code: 'auth/email-already-in-use', message: 'x' });
    await mount();
    await fillSignupForm('returning.member@church.org');
    await solveTurnstile();
    await submitSignup();

    const cta = findButton('Sign in instead')!;
    await act(async () => { cta.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();

    // Now on the sign-in view (password field relabels, Create account is gone).
    expect(findButton('Sign in')).toBeDefined();
    expect(byPlaceholder('Your password')).toBeDefined();
    expect(byPlaceholder('you@ministry.org').value).toBe('returning.member@church.org');
  });
});

// ── 4 ── an unrecognised error still says something ─────────────────────────
describe('an unrecognised auth error', () => {
  it('still shows something rather than failing silently', async () => {
    createUser.mockRejectedValueOnce({ code: 'auth/internal-error', message: 'Firebase: An internal AuthError has occurred (auth/internal-error).' });
    await mount();
    await fillSignupForm();
    await solveTurnstile();
    await submitSignup();

    expect(text()).toContain('Unable to create your account. Please try again.');
  });
});

// ── 5 ── a retry after the friendly message can still solve the bot gate ───
describe('the bot gate after a friendly error message', () => {
  it('can still be solved for a legitimate retry', async () => {
    createUser.mockRejectedValueOnce({ code: 'auth/email-already-in-use', message: 'x' });
    createUser.mockResolvedValueOnce({
      user: { uid: 'new-uid', email: 'pastor2@church.org', getIdToken: async () => 'tok' },
    });
    await mount();
    await fillSignupForm('pastor2@church.org');
    await solveTurnstile();
    expect(turnstileMounts).toBe(1);

    await submitSignup();
    expect(text()).toContain('An account with this email already exists.');

    // The widget was remounted (fresh instance, single-use token spent) and
    // the submit button must be disabled again until it's solved anew.
    expect(turnstileMounts).toBe(2);
    const submit = findButton('Create account')!;
    expect(submit.disabled).toBe(true);

    await solveTurnstile();
    expect(submit.disabled).toBe(false);

    await submitSignup();
    expect(text()).toContain('Account created successfully!');
    expect(createUser).toHaveBeenCalledTimes(2);
  });
});

// ── 6 ── the password rules are unchanged ───────────────────────────────────
describe('the password rules', () => {
  it('are byte-for-byte unchanged in source', () => {
    const src = readFileSync(path.join(process.cwd(), 'src/components/AuthPage.tsx'), 'utf8');
    expect(src).toContain(
      "const passwordRegex = /^(?=.*[A-Z])(?=.*[!@#$%^&*()_+\\-=\\[\\]{};':\"\\\\|,.<>\\/?]).{10,}$/;"
    );
  });

  it('still reject a weak password before Firebase is ever called', async () => {
    await mount();
    await fillSignupForm('someone@church.org', 'weak');
    await solveTurnstile();
    await submitSignup();

    expect(text()).toContain('Password must be at least 10 characters long, contain at least 1 capital letter, and 1 symbol.');
    expect(createUser).not.toHaveBeenCalled();
  });
});

// ── 7 ── signup intent survives the error ───────────────────────────────────
describe('signup intent', () => {
  it('survives an existing-account error and the switch to sign-in', async () => {
    sessionStorage.setItem('harvest_signup', 'plus');
    setURL('https://theharvest.app/auth');
    createUser.mockRejectedValueOnce({ code: 'auth/email-already-in-use', message: 'x' });
    await mount();
    await fillSignupForm();
    await solveTurnstile();
    await submitSignup();

    const cta = findButton('Sign in instead')!;
    await act(async () => { cta.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();

    expect(sessionStorage.getItem('harvest_signup')).toBe('plus');
  });
});
