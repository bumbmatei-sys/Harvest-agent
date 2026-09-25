import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * THE-201 — MEMBER SIGNUP IS GATED. This file REPLACES
 * `AuthPage.signup-not-capped.test.tsx`, which pinned the opposite rule.
 *
 * ── WHAT REP-6 SAID, AND WHY IT WAS RIGHT AT THE TIME ──────────────────────
 * REP-6 pinned an ABSENCE: `maxContacts` is a soft cap and signup is never
 * blocked. Its reasoning was sound — the naive enforcement rejects A VISITOR,
 * someone who cannot see the church's plan, cannot upgrade it, and has no idea
 * why they were turned away. The church loses the member and never finds out.
 *
 * ── WHY THE-201 REVERSED IT ────────────────────────────────────────────────
 * That rule was designed for a product where every tenant paid. The Forever
 * Free tier makes an unbounded member count an existential cost problem: free
 * tenants pay nothing and would otherwise grow without limit, so the cap must
 * bind on signup or "free" is unbounded.
 *
 * REP-6's real concern was never answered by the absence of a gate — it was a
 * concern about the COPY. So it is answered by the copy instead: the refusal
 * names the ministry, points at whoever invited them, says it is not their
 * fault, and promises the same email will work once room is made. It names no
 * plan, no limit and no error code — and the assertion that pins that absence
 * is carried over from REP-6 below, INVERTED IN PURPOSE, IDENTICAL IN TEXT.
 *
 * A test that pins an absence is only as good as the reason for the absence.
 * When the reason reverses, the test is rewritten with the new reason written
 * above it — deleting it would leave the reversal unrecorded.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { auth, createUser, signIn, signInWithPopupMock, setDoc, tenantCtx } = vi.hoisted(() => ({
  auth: { currentUser: null },
  createUser: vi.fn(async () => ({
    user: { uid: 'new-member-uid', email: 'newmember@church.org', getIdToken: async () => 'tok' },
  })),
  signIn: vi.fn(),
  signInWithPopupMock: vi.fn(),
  setDoc: vi.fn(async () => {}),
  // A church WAY past Individual's 150 accounts — the tenant the gate refuses.
  tenantCtx: {
    branding: {}, tenantId: 'over-cap-church', tenantName: 'Over Cap Church',
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
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  updateDoc: vi.fn(async () => {}),
  serverTimestamp: () => ({ __serverTimestamp: true }),
}));
vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'get', WRITE: 'write' },
  handleFirestoreError: () => {},
}));
vi.mock('../../contexts/TenantContext', () => ({ useTenant: () => tenantCtx }));
vi.mock('../AuthShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
// Stand in for the bot gate: hand the page a token immediately, the way a solved
// widget does. Without one the submit button stays disabled.
vi.mock('@marsidev/react-turnstile', () => ({
  Turnstile: ({ onSuccess }: { onSuccess: (t: string) => void }) => {
    React.useEffect(() => { onSuccess('turnstile-token'); }, [onSuccess]);
    return null;
  },
}));

import React from 'react';
import AuthPage from '../AuthPage';
import { memberCapRefusalMessage, MEMBER_CAP_UNAVAILABLE_MESSAGE } from '../../utils/member-cap-copy';

const CAP_URL = '/api/tenants/member-capacity';

let container: HTMLDivElement;
let root: Root | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

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

const buttonLabelled = (label: string) =>
  Array.from(container.querySelectorAll('button'))
    .find(b => b.textContent?.trim() === label) as HTMLButtonElement;

/**
 * The pre-flight and set-claims now mean DIFFERENT things, so a blanket
 * `{ ok: true, json: () => ({ success: true }) }` will not do — it would answer
 * the member-capacity question with a body that has no `canAccept` field.
 * The stub routes by URL.
 */
const stubFetch = (capResponse: { status?: number; body?: unknown } | (() => Promise<never>)) => {
  fetchMock = vi.fn(async (url: string) => {
    if (typeof url === 'string' && url.includes(CAP_URL)) {
      if (typeof capResponse === 'function') return capResponse();
      const status = capResponse.status ?? 200;
      return { ok: status >= 200 && status < 300, status, json: async () => capResponse.body };
    }
    // Turnstile + set-claims: the ordinary happy path.
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  });
  vi.stubGlobal('fetch', fetchMock);
};

const calledCapacity = () =>
  fetchMock.mock.calls.filter(([url]) => typeof url === 'string' && url.includes(CAP_URL));

const renderPage = async () => {
  await act(async () => {
    root = createRoot(container);
    root.render(<AuthPage onNavigate={() => {}} />);
  });
  await flush();
};

const submitSignupForm = async () => {
  const submit = buttonLabelled('Create account');
  expect(submit).toBeDefined();
  expect(submit.disabled).toBe(false);

  await typeInto(byPlaceholder('you@ministry.org'), 'newmember@church.org');
  await typeInto(byPlaceholder('Create a password'), 'Hosanna!2026');
  await typeInto(byPlaceholder('Re-enter password'), 'Hosanna!2026');

  await act(async () => { submit.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await flush();
};

const screenText = () => (container.textContent ?? '').replace(/\s+/g, ' ');

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  setURL('https://over-cap-church.theharvest.app/auth?signup=1');
  stubFetch({ status: 200, body: { canAccept: true } });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  container.remove();
  vi.unstubAllGlobals();
});

// ── AC-11 ── THE MOST IMPORTANT TEST, NOW INVERTED ──────────────────────────
describe('a member of a church that is at its member cap', () => {
  it('is refused before any account is created', async () => {
    const refusal = memberCapRefusalMessage('Over Cap Church');
    stubFetch({
      status: 200,
      body: { canAccept: false, message: refusal, code: 'member_cap_reached' },
    });

    await renderPage();
    await submitSignupForm();

    // No Firebase Auth account, and no `users` doc — the very document the cap
    // counts. The refusal lands before either exists, which is the whole point
    // of the pre-flight (D9): nobody gets a half-created account.
    expect(createUser).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();

    // The person is told, in the ministry's name, what to do next.
    const text = screenText();
    expect(text).toContain('Over Cap Church');
    expect(text).toMatch(/invited you/i);
    expect(text).not.toContain('Account created successfully!');

    // ── CARRIED OVER FROM REP-6, INVERTED IN PURPOSE, IDENTICAL IN TEXT ──
    // REP-6 asserted this of a screen that had just SUCCEEDED. It is asserted
    // here of a screen that has just REFUSED — which is the harder case and the
    // one D10 actually cares about. The copy must still name no plan and no
    // limit, because the reader can act on neither.
    expect(text).not.toMatch(/contact limit|member limit|upgrade your plan|at capacity|is full|too many/i);
  });

  it('renders the refusal from a set-claims 403 too, clearing the success line', async () => {
    // Belt and braces behind the pre-flight: a client that got a stale "yes"
    // still gets refused one hop later, and the screen must not say both
    // "Account created successfully!" and the refusal at once.
    const refusal = memberCapRefusalMessage('Over Cap Church');
    fetchMock = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes(CAP_URL)) {
        return { ok: true, status: 200, json: async () => ({ canAccept: true }) };
      }
      if (typeof url === 'string' && url.includes('/api/auth/set-claims')) {
        return {
          ok: false,
          status: 403,
          json: async () => ({ error: refusal, code: 'member_cap_reached' }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    await renderPage();
    await submitSignupForm();

    const text = screenText();
    expect(text).toContain('Over Cap Church');
    expect(text).not.toContain('Account created successfully!');
  });
});

// ── AC-14 ── a pre-flight failure does NOT fall through to signup ───────────
describe('a pre-flight that cannot answer stops the signup', () => {
  it('a 503 renders the unavailable copy and creates nothing', async () => {
    stubFetch({
      status: 503,
      body: {
        canAccept: false,
        message: MEMBER_CAP_UNAVAILABLE_MESSAGE,
        code: 'capacity_check_unavailable',
      },
    });

    await renderPage();
    await submitSignupForm();

    expect(createUser).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();

    const text = screenText();
    expect(text).toMatch(/couldn't finish setting up your account/i);
    // 🔴 It must NOT say the ministry is full — we do not know that.
    expect(text).not.toMatch(/is full|at capacity|invited you/i);
  });

  it('a rejecting fetch renders the unavailable copy and creates nothing', async () => {
    // A `catch { /* proceed */ }` here is the Silent-Failure Rule violation this
    // spec is most likely to be implemented with: the set-claims gate would then
    // refuse the person AFTER creating their account — exactly the half-account
    // the pre-flight exists to avoid.
    stubFetch(async () => { throw new Error('network down'); });

    await renderPage();
    await submitSignupForm();

    expect(createUser).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
    expect(screenText()).toMatch(/couldn't finish setting up your account/i);
  });

  it('a 400 does not fall through either', async () => {
    stubFetch({ status: 400, body: { error: 'tenantId required' } });

    await renderPage();
    await submitSignupForm();

    expect(createUser).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
  });
});

// ── the happy path still works ──────────────────────────────────────────────
describe('a member of a church with room', () => {
  it('creates the account and writes the users doc, with no refusal on screen', async () => {
    stubFetch({ status: 200, body: { canAccept: true } });

    await renderPage();
    await submitSignupForm();

    expect(createUser).toHaveBeenCalledTimes(1);
    expect(setDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = setDoc.mock.calls[0] as unknown as [{ __path: string }, Record<string, unknown>];
    expect(ref.__path).toBe('users/new-member-uid');
    expect(data).toMatchObject({ tenantId: 'over-cap-church', role: 'user' });

    expect(screenText()).toContain('Account created successfully!');
  });
});

// ── AC-12 ── the pre-flight never fires on sign-in ──────────────────────────
describe('the sign-in path is never gated', () => {
  beforeEach(() => { setURL('https://over-cap-church.theharvest.app/auth'); });

  it('submitting the sign-in form issues NO member-capacity request', async () => {
    await renderPage();

    const submit = buttonLabelled('Sign in');
    expect(submit).toBeDefined();

    await typeInto(byPlaceholder('you@ministry.org'), 'existing@church.org');
    await typeInto(byPlaceholder('Your password'), 'Hosanna!2026');
    await act(async () => { submit.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();

    expect(calledCapacity()).toHaveLength(0);
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it('"Continue with Google" issues NO member-capacity request', async () => {
    await renderPage();

    const google = buttonLabelled('Continue with Google');
    expect(google).toBeDefined(); // proves we are in isLogin mode

    await act(async () => { google.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();

    expect(calledCapacity()).toHaveLength(0);
  });
});

describe('the Google signup path IS gated, before the popup opens', () => {
  it('asks the pre-flight and never opens the popup when refused', async () => {
    setURL('https://over-cap-church.theharvest.app/auth?signup=1');
    stubFetch({
      status: 200,
      body: {
        canAccept: false,
        message: memberCapRefusalMessage('Over Cap Church'),
        code: 'member_cap_reached',
      },
    });

    await renderPage();

    const google = buttonLabelled('Sign up with Google');
    expect(google).toBeDefined(); // proves we are in signup mode

    await act(async () => { google.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();

    expect(calledCapacity()).toHaveLength(1);
    // No Firebase Auth account is created at all — the popup never opens.
    expect(signInWithPopupMock).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
    expect(screenText()).toContain('Over Cap Church');
  });
});

// ── AC-16 ── THE TWO STATEMENTS OF INTENT AGREE, PINNED STRUCTURALLY ────────
describe('the signup path and the admin CRM cap stay separate modules', () => {
  const SRC = path.join(process.cwd(), 'src');

  /** Every .ts/.tsx file under src/. */
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules') continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  };

  /**
   * KEPT UNCHANGED FROM REP-6, and still true — which is the whole reason for
   * two modules. The signup path imports `member-capacity` / `member-cap-copy`;
   * `contact-capacity` remains the ADMIN CRM's cap, over different rows, for a
   * different audience, and no member-facing surface may consult it.
   */
  const ALLOWED = new Set(['components/AdminCRM.tsx'].map(p => path.join(SRC, p)));

  it('only the admin CRM imports contact-capacity', () => {
    const offenders = walk(SRC).filter((f) => {
      if (ALLOWED.has(f) || /__tests__|\.test\.tsx?$/.test(f)) return false;
      return /from\s+['"][^'"]*\/contact-capacity['"]/.test(readFileSync(f, 'utf8'));
    });
    expect(offenders.map(f => path.relative(SRC, f))).toEqual([]);
  });

  it('…and that import really is there, so the check above is not vacuous', () => {
    expect(readFileSync(path.join(SRC, 'components/AdminCRM.tsx'), 'utf8'))
      .toMatch(/from\s+'\.\.\/utils\/contact-capacity'/);
  });

  it('the signup screen names no contact cap at all', () => {
    // KEPT EXACTLY AS-IS from REP-6. AuthPage must still reference none of these
    // five symbols; it references /api/tenants/member-capacity and
    // member-cap-copy instead.
    const src = readFileSync(path.join(SRC, 'components/AuthPage.tsx'), 'utf8');
    expect(src).not.toMatch(/contact-capacity|maxContacts|ContactLimit|memberAccounts|useCRMCounts/);
  });

  it('the claims hop DOES consult the member cap now — the inverted assertion', () => {
    // REP-6 asserted that neither of these files gated on a cap. THE-201
    // reverses exactly half of that: set-claims is now the enforcement point,
    // and it MUST reference the decision. Neither file may reach for the admin
    // CRM's module to do it.
    const setClaims = readFileSync(path.join(SRC, 'app/api/auth/set-claims/route.ts'), 'utf8');
    expect(setClaims).toMatch(/decideMemberCapacity/);
    expect(setClaims).toMatch(/member-capacity/);

    for (const rel of ['components/AuthPage.tsx', 'app/api/auth/set-claims/route.ts']) {
      expect(readFileSync(path.join(SRC, rel), 'utf8'))
        .not.toMatch(/maxContacts|ContactLimit|contact-capacity/);
    }
  });

  it('the old absence-pinning file no longer exists under its old name', () => {
    const old = path.join(SRC, 'components/__tests__/AuthPage.signup-not-capped.test.tsx');
    expect(() => statSync(old)).toThrow();
  });

  it('contact-capacity no longer claims signup is never blocked', () => {
    const src = readFileSync(path.join(SRC, 'utils/contact-capacity.ts'), 'utf8');
    expect(src).not.toMatch(/IT NEVER BLOCKS SIGNUP/);
  });
});
