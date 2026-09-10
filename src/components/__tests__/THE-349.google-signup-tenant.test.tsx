import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * THE-349 · the signup that produced a member belonging to no church.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What was actually reproduced, against the real component ────────────────
 *
 * A `users` document was found in production carrying `tenantId: null` for a
 * member who had joined a ministry. The brief's hypothesis was an iOS redirect
 * hop: `signInWithRedirect` sending the browser to Firebase's auth domain and
 * back, so `window.location.hostname` was not the tenant subdomain when the
 * document was written.
 *
 * 🔴 THAT IS NOT WHAT HAPPENS, AND THE FIRST THING THIS FILE DOES IS SAY SO.
 * There is no redirect: `signInWithRedirect` and `getRedirectResult` appear
 * nowhere in `src/` — asserted over comment-stripped source in
 * `THE-349.orphan-signup.guards.test.ts` — and the screen reads the hostname
 * of the page it is rendered in, which the Google POP-UP never navigates. On
 * `kingdom-living.theharvest.app` the write was, and still is, correct: the
 * first case below is that measurement.
 *
 * ⚠️ THE NULL IS REAL ANYWAY, and it is written by a host that serves exactly
 * one ministry and names it nowhere: a CUSTOM DOMAIN. The screen's fallback
 * there is a `tenantId=` cookie "set server-side by middleware", and
 * `src/middleware.ts` sets no cookie at all — `lib/custom-domain-feature.ts`
 * already recorded that `api/resolve-domain` "has not called it for some
 * time". So the fallback yielded null, `tenantId || null` recorded that null
 * as a fact, and every signup on such a host was an orphan. That is the case
 * this file reproduces before it is fixed and refuses after.
 *
 * ── Why the assertions read the WRITE, not the screen ───────────────────────
 *
 * Every claim about which ministry a member belongs to is made against the
 * payload handed to `setDoc`, because that payload is the thing Firestore
 * stores and the thing `set-custom-claims.ts` later mints the claim from. A
 * test that read the component's state would pass for a component that
 * computed the right answer and wrote the wrong one.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const {
  auth, createUser, signIn, signInWithPopupMock, setDoc, getDocMock, updateDocMock, tenantCtx,
} = vi.hoisted(() => ({
  auth: { currentUser: null },
  createUser: vi.fn(async () => ({
    user: { uid: 'u-email', email: 'friend@gmail.test', getIdToken: async () => 'tok' },
  })),
  signIn: vi.fn(async () => ({
    user: { uid: 'u-email', email: 'friend@gmail.test', getIdToken: async () => 'tok' },
  })),
  signInWithPopupMock: vi.fn(async () => ({
    user: {
      uid: 'u-google',
      email: 'friend@gmail.test',
      displayName: 'The Friend',
      photoURL: 'https://example.test/p.png',
      getIdToken: async () => 'tok',
    },
  })),
  setDoc: vi.fn(async () => {}),
  getDocMock: vi.fn(async (): Promise<{ exists: () => boolean; data: () => Record<string, unknown> }> =>
    ({ exists: () => false, data: () => ({}) })),
  updateDocMock: vi.fn(async () => {}),
  tenantCtx: {
    branding: {} as Record<string, string>,
    tenantId: 'kingdom-living' as string | null,
    tenantName: 'Kingdom Living' as string | null,
    tenantPlan: 'plus' as string | null,
  },
}));

vi.mock('../../firebase', () => ({ auth, db: {} }));
vi.mock('firebase/auth', () => ({
  signInWithPopup: signInWithPopupMock,
  GoogleAuthProvider: class {},
  createUserWithEmailAndPassword: createUser,
  signInWithEmailAndPassword: signIn,
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  setDoc,
  getDoc: getDocMock,
  updateDoc: updateDocMock,
}));
vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'get', WRITE: 'write', UPDATE: 'update' },
  handleFirestoreError: () => {},
}));
vi.mock('../../contexts/TenantContext', () => ({ useTenant: () => tenantCtx }));
// Hands the page a token immediately, the way a solved widget does — without
// one the submit button stays disabled and no path under test is reachable.
vi.mock('@marsidev/react-turnstile', () => ({
  Turnstile: ({ onSuccess }: { onSuccess: (t: string) => void }) => {
    React.useEffect(() => { onSuccess('turnstile-token'); }, [onSuccess]);
    return null;
  },
}));

import React from 'react';
import AuthPage from '../AuthPage';
import { TENANT_UNRESOLVED_MESSAGE, TENANT_UNRESOLVED_TITLE } from '../../utils/auth-tenant-resolution';
import { googleAuthFailureMessage } from '../../utils/auth-failure-copy';

const TENANT_HOST = 'https://kingdom-living.theharvest.app/auth';
const APEX_HOST = 'https://theharvest.app/auth';
const CUSTOM_HOST = 'https://kingdomliving.church/auth';
const CAP_URL = '/api/tenants/member-capacity';

let container: HTMLDivElement;
let root: Root | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

const flush = async () => {
  await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
};
const setURL = (u: string) =>
  (window as unknown as { happyDOM: { setURL: (u: string) => void } }).happyDOM.setURL(u);

/** happy-dom keeps its cookie jar between cases; a stale one would fake a fix. */
const clearCookies = () => {
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0].trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
};

const byPlaceholder = (p: string) =>
  container.querySelector(`input[placeholder="${p}"]`) as HTMLInputElement;
const buttonLabelled = (label: string) =>
  Array.from(container.querySelectorAll('button'))
    .find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const screenText = () => (container.textContent ?? '').replace(/\s+/g, ' ');

const typeInto = async (el: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const renderPage = async () => {
  await act(async () => {
    root = createRoot(container);
    root.render(<AuthPage onNavigate={() => {}} />);
  });
  await flush();
};

const pressGoogle = async () => {
  const b = buttonLabelled('Sign up with Google') ?? buttonLabelled('Continue with Google');
  expect(b, 'the Google button is not on this screen').toBeDefined();
  await act(async () => { b!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await flush();
};

const submitSignupForm = async (email = 'friend@gmail.test') => {
  const submit = buttonLabelled('Create account');
  expect(submit, 'the sign-up form is not on this screen').toBeDefined();
  await typeInto(byPlaceholder('you@ministry.org'), email);
  await typeInto(byPlaceholder('Create a password'), 'Hosanna!2026');
  await typeInto(byPlaceholder('Re-enter password'), 'Hosanna!2026');
  await act(async () => { submit!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await flush();
};

/** The payload handed to `setDoc` — the thing Firestore would actually store. */
const written = (): Record<string, unknown> | null => {
  const call = setDoc.mock.calls[0] as unknown as [unknown, Record<string, unknown>] | undefined;
  return call ? call[1] : null;
};

const capacityCalls = () =>
  fetchMock.mock.calls.filter(([url]) => typeof url === 'string' && url.includes(CAP_URL));

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  clearCookies();
  getDocMock.mockResolvedValue({ exists: () => false, data: () => ({}) });
  fetchMock = vi.fn(async (url: string) => {
    if (typeof url === 'string' && url.includes(CAP_URL)) {
      return { ok: true, status: 200, json: async () => ({ canAccept: true }) };
    }
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  container.remove();
  clearCookies();
  vi.unstubAllGlobals();
});

/* ═════════════════════════════════════════════════════════════════════════════
 * Test 1 — the whole ticket, on the host it was reported from
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('1 · 🔴 a Google sign-up on a tenant host writes the CORRECT tenantId', () => {
  it('kingdom-living.theharvest.app writes kingdom-living, not null', async () => {
    setURL(`${TENANT_HOST}?signup=1`);
    await renderPage();
    await pressGoogle();

    const doc = written();
    expect(doc, 'no users document was written at all').not.toBeNull();
    expect(doc!.tenantId,
      'the member was written into no ministry — this is the orphan the ticket is about')
      .toBe('kingdom-living');
    expect(doc!.tenantId).not.toBeNull();
    // The rest of the identity block is untouched by this ticket.
    expect(doc).toMatchObject({ uid: 'u-google', role: 'user', termsAccepted: true });
  });

  it('and on the sign-IN view too, where a new member is created just the same', async () => {
    // The default view with no ?signup is sign-in, and its Google button still
    // creates a document for anybody who has none. Same host, same answer.
    setURL(TENANT_HOST);
    await renderPage();
    expect(buttonLabelled('Continue with Google'), 'this is not the sign-in view').toBeDefined();
    await pressGoogle();
    expect(written()!.tenantId).toBe('kingdom-living');
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * Tests 2 and 9 — 🔴 THE DEFECT. Never null when the tenant is merely UNKNOWN.
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('2 · 🔴 a Google sign-up on a tenant host NEVER writes tenantId: null', () => {
  /**
   * `kingdomliving.church` is a tenant host: it serves exactly one ministry.
   * It simply does not NAME it, and the `tenantId=` cookie that was supposed
   * to is set by nothing. Before this ticket that produced
   * `tenantId: null` — silently, permanently, with a green screen.
   */
  it('it refuses, and writes NOTHING, rather than recording "no church" as a fact', async () => {
    setURL(`${CUSTOM_HOST}?signup=1`);
    await renderPage();
    await pressGoogle();

    expect(setDoc, 'a users document was created on a host that names no ministry')
      .not.toHaveBeenCalled();
    // 🔴 And not one written value may be null either — the assertion is on the
    // absence of the WRITE, then on every payload that did occur, so a future
    // change that writes something cannot slip a null past a `toHaveBeenCalled`.
    for (const call of setDoc.mock.calls as unknown as Array<[unknown, Record<string, unknown>]>) {
      expect(call[1].tenantId, 'tenantId: null reached Firestore').not.toBeNull();
    }
    expect(screenText()).toContain(TENANT_UNRESOLVED_MESSAGE);
  });

  it('and the refusal lands BEFORE Firebase — no half-created account', async () => {
    setURL(`${CUSTOM_HOST}?signup=1`);
    await renderPage();
    await pressGoogle();
    expect(signInWithPopupMock, 'an Auth user was created for somebody who cannot be given a tenant')
      .not.toHaveBeenCalled();
  });

  it('the screen says so before a single field is filled in', async () => {
    setURL(`${CUSTOM_HOST}?signup=1`);
    await renderPage();
    const text = screenText();
    expect(text, 'the person types an email and a password before being told').toContain(TENANT_UNRESOLVED_TITLE);
    expect(text).toContain(TENANT_UNRESOLVED_MESSAGE);
  });
});

describe('9 · 🔴 a tenant that cannot be resolved FAILS the signup — it does not orphan', () => {
  it('the email/password path refuses before createUserWithEmailAndPassword', async () => {
    setURL(`${CUSTOM_HOST}?signup=1`);
    await renderPage();
    await submitSignupForm();

    expect(createUser, 'a Firebase Auth user was created with no ministry to put them in')
      .not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
    expect(screenText()).toContain(TENANT_UNRESOLVED_MESSAGE);
    expect(screenText()).not.toContain('Account created successfully!');
  });

  it('🔴 and the create is refused even from the sign-IN view, where no banner shows', async () => {
    // An existing member must still be able to sign in on a custom domain, so
    // sign-in is NOT blocked and the banner is not rendered there. What is
    // blocked is the branch that would CREATE a document — which is the only
    // branch that can orphan anybody.
    setURL(CUSTOM_HOST);
    await renderPage();
    expect(screenText(), 'the sign-in view refuses an existing member up front')
      .not.toContain(TENANT_UNRESOLVED_TITLE);

    await pressGoogle();
    expect(signInWithPopupMock, 'sign-in itself was blocked — an existing member is locked out')
      .toHaveBeenCalled();
    expect(setDoc, 'the create branch still wrote a document with no ministry').not.toHaveBeenCalled();
    expect(screenText()).toContain(TENANT_UNRESOLVED_MESSAGE);
  });

  it('an EXISTING member on a custom domain signs in exactly as before', async () => {
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ tenantId: 'kingdom-living' }) });
    setURL(CUSTOM_HOST);
    await renderPage();
    await pressGoogle();

    expect(signInWithPopupMock).toHaveBeenCalled();
    expect(setDoc, 'an existing document must not be re-created').not.toHaveBeenCalled();
    expect(updateDocMock, 'the consent refresh stopped happening').toHaveBeenCalled();
    expect(screenText(), 'a member who is already in a ministry was shown the refusal')
      .not.toContain(TENANT_UNRESOLVED_MESSAGE);
  });

  it('and the middleware cookie, where one exists, resolves it instead of refusing', async () => {
    document.cookie = 'tenantId=kingdom-living; path=/';
    setURL(`${CUSTOM_HOST}?signup=1`);
    await renderPage();
    await pressGoogle();
    expect(written()!.tenantId).toBe('kingdom-living');
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * Test 3 — no regression on the path the reported member finally used
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('3 · an email/password sign-up on a tenant host writes the correct tenantId', () => {
  it('kingdom-living, from the same host authority as the Google path', async () => {
    setURL(`${TENANT_HOST}?signup=1`);
    await renderPage();
    await submitSignupForm();

    expect(createUser).toHaveBeenCalled();
    const doc = written();
    expect(doc!.tenantId).toBe('kingdom-living');
    expect(doc).toMatchObject({ uid: 'u-email', role: 'user', termsAccepted: true });
    expect(screenText()).toContain('Account created successfully!');
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * Tests 4, 7 and 10 — the nulls that are CORRECT, and must stay
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('4 · a signup on the APEX still writes null legitimately', () => {
  it('theharvest.app writes tenantId: null, and is not refused', async () => {
    tenantCtx.tenantId = null;
    tenantCtx.tenantName = null;
    setURL(`${APEX_HOST}?signup=1`);
    await renderPage();
    await submitSignupForm();

    expect(createUser, 'the apex signup was refused — null is CORRECT there').toHaveBeenCalled();
    const doc = written();
    expect(doc, 'no document was written on the apex').not.toBeNull();
    expect(doc!.tenantId).toBeNull();
    expect(screenText()).not.toContain(TENANT_UNRESOLVED_TITLE);
    tenantCtx.tenantId = 'kingdom-living';
    tenantCtx.tenantName = 'Kingdom Living';
  });

  it('and so does a non-tenant subdomain — www is a platform alias', async () => {
    tenantCtx.tenantId = null;
    setURL('https://www.theharvest.app/auth?signup=1');
    await renderPage();
    await submitSignupForm();
    expect(written()!.tenantId).toBeNull();
    expect(screenText()).not.toContain(TENANT_UNRESOLVED_TITLE);
    tenantCtx.tenantId = 'kingdom-living';
  });
});

describe('7 · a super admin still works with tenantId: null', () => {
  it('the apex account this screen creates for them carries null, unrefused', async () => {
    // AuthPage never asks who is signing up — a super admin reaches it on the
    // apex like anyone else, and the document it creates there is the one whose
    // null `PLATFORM_TENANT_ID` later stands in for on the write paths. If this
    // screen started refusing an apex signup, that account could not be made.
    tenantCtx.tenantId = null;
    setURL(`${APEX_HOST}?signup=1`);
    await renderPage();
    await submitSignupForm('bumbmatei@proton.me');

    expect(createUser).toHaveBeenCalled();
    expect(written()!.tenantId).toBeNull();
    expect(screenText()).not.toContain(TENANT_UNRESOLVED_MESSAGE);
    tenantCtx.tenantId = 'kingdom-living';
  });
});

describe('10 · memberCapRefusal still treats null as "no cap applies"', () => {
  it('no capacity call is made on the apex — D7, unchanged', async () => {
    tenantCtx.tenantId = null;
    setURL(`${APEX_HOST}?signup=1`);
    await renderPage();
    await submitSignupForm();
    expect(capacityCalls(), 'the apex started asking a ministry whether it has room').toHaveLength(0);
    tenantCtx.tenantId = 'kingdom-living';
  });

  it('and it IS asked on a tenant host, with that tenant', async () => {
    setURL(`${TENANT_HOST}?signup=1`);
    await renderPage();
    await submitSignupForm();
    expect(capacityCalls()).toHaveLength(1);
    expect(JSON.parse((capacityCalls()[0][1] as { body: string }).body))
      .toEqual({ tenantId: 'kingdom-living' });
  });

  it('🔴 and an unresolvable host is refused BEFORE the cap is asked', async () => {
    // Not a cap question at all: there is no ministry to ask about. Asking
    // would have sent `null` and been answered "no cap applies", which is the
    // silent yes that let the orphan through.
    setURL(`${CUSTOM_HOST}?signup=1`);
    await renderPage();
    await submitSignupForm();
    expect(capacityCalls()).toHaveLength(0);
    expect(createUser).not.toHaveBeenCalled();
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * Test 8 — the message the person actually reads
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('8 · the generic retry is gone from the screen, not just from a module', () => {
  it('🔴 the Google/password collision reaches the screen naming the password', async () => {
    signInWithPopupMock.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'auth/account-exists-with-different-credential' }),
    );
    setURL(`${TENANT_HOST}?signup=1`);
    await renderPage();
    await pressGoogle();

    const text = screenText();
    expect(text).toContain(googleAuthFailureMessage('auth/account-exists-with-different-credential'));
    expect(text, 'a retry that can never succeed is still being invited')
      .not.toContain('Failed to sign in with Google. Please try again.');
  });

  it('a wrong password names the reset link instead of "Unable to sign in"', async () => {
    signIn.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/invalid-credential' }));
    setURL(TENANT_HOST);
    await renderPage();
    await typeInto(byPlaceholder('you@ministry.org'), 'friend@gmail.test');
    await typeInto(byPlaceholder('Your password'), 'whatever');
    const submit = buttonLabelled('Sign in');
    expect(submit).toBeDefined();
    await act(async () => { submit!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();

    const text = screenText();
    expect(text, 'the lie survived').not.toContain('Unable to sign in. Please try again.');
    expect(text).toMatch(/Forgot your password/);
  });

  it('and auth/email-already-in-use keeps its "Sign in instead" action', async () => {
    createUser.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/email-already-in-use' }));
    setURL(`${TENANT_HOST}?signup=1`);
    await renderPage();
    await submitSignupForm();
    expect(screenText()).toContain('An account with this email already exists.');
    expect(buttonLabelled('Sign in instead'), 'THE-315’s action was lost').toBeDefined();
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * "It kicked him out" — the failure that produced no message at all
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('11 · an iPhone home-screen app is told why Google cannot open', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

  const asHomeScreenApp = () => {
    vi.stubGlobal('navigator', new Proxy(window.navigator, {
      get: (t, k) => (k === 'userAgent' ? IPHONE : k === 'standalone' ? true : Reflect.get(t, k)),
    }));
  };

  it('🔴 signInWithPopup is never called — it would never settle', async () => {
    // `@firebase/auth`'s `_open()` hands the URL to Safari when
    // `_isIOSStandalone` and returns `new AuthPopup(null)`; the close-poller
    // then reads `undefined` forever and the promise neither resolves nor
    // rejects. Calling it is what produced a spinner and no message.
    asHomeScreenApp();
    setURL(`${TENANT_HOST}?signup=1`);
    await renderPage();
    await pressGoogle();

    expect(signInWithPopupMock, 'the call that can never settle was made anyway').not.toHaveBeenCalled();
    const text = screenText();
    expect(text).toContain('kingdom-living.theharvest.app');
    expect(text).toMatch(/Safari/);
  });

  it('and the button is not left spinning', async () => {
    asHomeScreenApp();
    setURL(`${TENANT_HOST}?signup=1`);
    await renderPage();
    await pressGoogle();
    expect(buttonLabelled('Sign up with Google')!.disabled,
      'loading was never cleared — the screen still looks like it is working').toBe(false);
  });
});
