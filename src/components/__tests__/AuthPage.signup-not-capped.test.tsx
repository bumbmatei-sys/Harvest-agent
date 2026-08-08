import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * REP-6 — `maxContacts` IS A SOFT CAP. SIGNUP IS NEVER BLOCKED.
 *
 * This is the most important test in the change, and it pins an ABSENCE.
 *
 * Accounts arrive by member self-signup on this screen. The cap counts accounts,
 * so the naive enforcement — refuse the 151st `users` doc — would reject A
 * VISITOR: someone who cannot see the church's plan, cannot upgrade it, cannot
 * contact anyone about it from the error, and has no idea why they were turned
 * away. The church loses the member and never finds out. That is the worst
 * outcome available here, and it is strictly worse than the tenant sitting one
 * account over a limit nobody is billed for yet.
 *
 * So the gate is on what the ADMIN controls (the manual add form in AdminCRM),
 * never on what a visitor does. Two independent guards below:
 *
 *   1. BEHAVIOURAL — a member of a church that is far over its Individual
 *      allowance completes signup: the Firebase account is created and the
 *      `users` doc is written, with no error on screen.
 *   2. STRUCTURAL — no member-facing module imports the cap at all. A cap check
 *      wired into signup would fail this even if it silently no-opped for want
 *      of a count, so "it didn't fire in the test" can never be mistaken for
 *      "signup is not gated".
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { auth, createUser, signIn, setDoc, tenantCtx } = vi.hoisted(() => ({
  auth: { currentUser: null },
  createUser: vi.fn(async () => ({
    user: { uid: 'new-member-uid', email: 'newmember@church.org', getIdToken: async () => 'tok' },
  })),
  signIn: vi.fn(),
  setDoc: vi.fn(async () => {}),
  // A church WAY past Individual's 150 accounts. If anything on this screen
  // consulted the cap, this is the tenant it would refuse.
  tenantCtx: {
    branding: {}, tenantId: 'over-cap-church', tenantName: 'Over Cap Church',
    tenantPlan: 'plus' as string | null,
  },
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

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  setURL('https://over-cap-church.theharvest.app/auth?signup=1');
  // Turnstile pre-flight + set-claims both go through fetch.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, json: async () => ({ success: true }),
  })));
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  container.remove();
  vi.unstubAllGlobals();
});

// ── 1 ── THE MOST IMPORTANT TEST ────────────────────────────────────────────
describe('a member of a church that is over its contact cap', () => {
  it('can still create an account — signup is never blocked', async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<AuthPage onNavigate={() => {}} />);
    });
    await flush();

    // Sanity: we are on the SIGNUP form, not the sign-in one.
    const submit = Array.from(container.querySelectorAll('button'))
      .find(b => b.textContent?.trim() === 'Create account') as HTMLButtonElement;
    expect(submit).toBeDefined();
    expect(submit.disabled).toBe(false);

    await typeInto(byPlaceholder('you@ministry.org'), 'newmember@church.org');
    await typeInto(byPlaceholder('Create a password'), 'Hosanna!2026');
    await typeInto(byPlaceholder('Re-enter password'), 'Hosanna!2026');

    await act(async () => {
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    // The account exists…
    expect(createUser).toHaveBeenCalledTimes(1);
    // …and their `users` doc — the very document the cap counts — was written,
    // scoped to the over-cap tenant.
    expect(setDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = setDoc.mock.calls[0] as unknown as [{ __path: string }, Record<string, unknown>];
    expect(ref.__path).toBe('users/new-member-uid');
    expect(data).toMatchObject({ tenantId: 'over-cap-church', role: 'user' });

    // Nothing was said about limits, plans, or upgrading.
    const text = (container.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('Account created successfully!');
    expect(text).not.toMatch(/contact limit|member limit|upgrade your plan|at capacity|is full|too many/i);
  });
});

// ── 1b ── THE SAME RULE, PINNED STRUCTURALLY ────────────────────────────────
describe('the cap is unreachable from anything a visitor touches', () => {
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
   * The cap may only be IMPORTED by the admin CRM surface. Anything else — the
   * auth screen, the donation webhook, the public forms / check-in /
   * event-registration routes, the Cloud Functions bridge — is a path a member
   * or visitor walks, and none of them may consult a plan cap.
   *
   * (A doc comment pointing AT the module is fine and expected; this looks for
   * an actual import.)
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
    const src = readFileSync(path.join(SRC, 'components/AuthPage.tsx'), 'utf8');
    expect(src).not.toMatch(/contact-capacity|maxContacts|ContactLimit|memberAccounts|useCRMCounts/);
  });

  it('nothing that creates a `users` doc consults a cap first', () => {
    // The two writers of a member's account document. Neither may gate on plan
    // capacity: one is the self-signup form, the other the post-signup claims
    // hop that every new account makes.
    for (const rel of ['components/AuthPage.tsx', 'app/api/auth/set-claims/route.ts']) {
      const full = path.join(SRC, rel);
      expect(readFileSync(full, 'utf8')).not.toMatch(/maxContacts|ContactLimit|contact-capacity/);
    }
  });
});
