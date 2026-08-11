import React, { act } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

/**
 * 🔴 DELETE ACCOUNT MUST NEVER FAIL SILENTLY, AND MUST NEVER CLAIM MORE THAN IT DID.
 *
 * Two bugs are pinned here, one per era.
 *
 * #287: `handleDeleteAccount` caught Firebase's 'auth/requires-recent-login' and
 * wrote two `console.error` lines. Nothing rendered. The member tapped Delete on
 * an irreversible action and the screen did not move.
 *
 * THIS CHANGE: the deletion itself was half-broken. The client called
 * `deleteDoc(users/{uid})` — denied for every ordinary member, because
 * firestore.rules gives `match /users/{userId}` `allow delete: if isSuperAdmin()`
 * — swallowed the denial, and called `deleteUser` anyway. The sign-in was
 * destroyed and the profile survived. Both halves now happen server-side, in
 * order, at POST /api/account/delete; this component's job is to ask for it and
 * render exactly what came back.
 *
 * ⚠️ EVERY ASSERTION BELOW IS ON RENDERED TEXT, DELIBERATELY. A console spy
 * would have passed against the broken code — the old version logged
 * enthusiastically. What was missing was output the member could see, so that
 * is the only thing worth asserting on.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { authMock, authFetchMock, signOutMock, reauthMock, getIdTokenMock } = vi.hoisted(() => {
  const getIdTokenMock = vi.fn(async () => 'id-token');
  return {
    getIdTokenMock,
    authMock: {
      currentUser: {
        uid: 'u1',
        email: 'member@church.org',
        displayName: 'Member',
        photoURL: null,
        getIdToken: getIdTokenMock,
        // Password account by default; the Google case flips this per test.
        providerData: [{ providerId: 'password' }] as { providerId: string }[],
      },
    },
    authFetchMock: vi.fn(),
    signOutMock: vi.fn(),
    reauthMock: vi.fn(),
  };
});

vi.mock('../../firebase', () => ({ auth: authMock, db: {} }));
vi.mock('firebase/auth', () => ({
  updateProfile: vi.fn(async () => {}),
  updatePassword: vi.fn(async () => {}),
  signOut: signOutMock,
  EmailAuthProvider: { credential: (email: string, password: string) => ({ email, password }) },
  reauthenticateWithCredential: reauthMock,
  sendPasswordResetEmail: vi.fn(async () => {}),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  updateDoc: vi.fn(async () => {}),
}));
vi.mock('../../utils/auth-fetch', () => ({ authFetch: authFetchMock }));
vi.mock('../CountrySelect', () => ({ default: () => null }));

import PersonalInformationModal from '../PersonalInformationModal';
import { MEMBER_FAQS } from '../../lib/member-faqs';

/** What POST /api/account/delete returns, in the shape the handler reads. */
function apiResponse(status: number, body: Record<string, unknown>) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
const OK = () => apiResponse(200, { success: true, documentDeleted: true, authDeleted: true });

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<PersonalInformationModal isOpen onClose={() => {}} />);
  });
}

/** Click the first button (or labelled input) whose visible text matches. */
async function click(text: string | RegExp) {
  const match = (s: string) => (typeof text === 'string' ? s.trim() === text : text.test(s));
  const button = [...container.querySelectorAll('button')].find((b) => match(b.textContent ?? ''));
  if (!button) throw new Error(`no button matching ${text}. Buttons: ${[...container.querySelectorAll('button')].map((b) => `"${b.textContent?.trim()}"`).join(', ')}`);
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

const text = () => container.textContent ?? '';

/** Open the confirm panel and press Delete. */
async function tapDelete() {
  await click('Delete Account');
  await click('Delete');
}

/** Type into the in-place password field and confirm. */
async function typePasswordAndConfirm(password: string) {
  const input = container.querySelector('input[type="password"]') as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, password);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Confirm & Delete');
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.currentUser.providerData = [{ providerId: 'password' }];
  authFetchMock.mockResolvedValue(OK());
  signOutMock.mockResolvedValue(undefined);
  reauthMock.mockResolvedValue(undefined);
  getIdTokenMock.mockResolvedValue('id-token');
  document.body.innerHTML = '';
});

describe('Delete Account — the deletion is one ordered server call, not two client ones', () => {
  it('asks the server to delete the account, naming the caller', async () => {
    await render();
    await tapDelete();

    expect(authFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = authFetchMock.mock.calls[0];
    expect(url).toBe('/api/account/delete');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ userId: 'u1' });
  });

  it('presents a FRESH token, so a re-authenticated retry is not judged on the stale one', async () => {
    // The route gates on `auth_time`, and the cached ID token can be an hour
    // old. Without the forced refresh the retry after re-auth would be rejected
    // for staleness again and loop the member through the password panel.
    await render();
    await tapDelete();

    expect(getIdTokenMock).toHaveBeenCalledWith(true);
  });

  it('signs the member out itself, since the server already removed the auth user', async () => {
    await render();
    await tapDelete();

    expect(signOutMock).toHaveBeenCalledTimes(1);
  });
});

describe('Delete Account — requires-recent-login is visible, not a console line', () => {
  /** The route's answer to a stale sign-in — the same code the client SDK used. */
  const STALE = () =>
    apiResponse(401, {
      error: 'For your security, deleting an account needs a recent sign-in.',
      code: 'auth/requires-recent-login',
      step: 'reauth',
    });

  it('renders an explicit message when the server demands a recent sign-in', async () => {
    authFetchMock.mockResolvedValueOnce(STALE());
    await render();
    await tapDelete();

    // THE REGRESSION ASSERTION. Restoring the console.error-only catch leaves
    // the confirm panel exactly as it was and fails here.
    expect(text()).toMatch(/confirm your password/i);
    expect(container.querySelector('[role="alert"]')?.textContent ?? '').toMatch(/security/i);
  });

  it('offers the password field in place, rather than telling them to sign out', async () => {
    authFetchMock.mockResolvedValueOnce(STALE());
    await render();
    await tapDelete();

    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    // The old advice must NOT be what a password account is shown.
    expect(text()).not.toMatch(/sign out, sign back in/i);
  });

  it('re-authenticates in place and completes the deletion', async () => {
    authFetchMock.mockResolvedValueOnce(STALE());
    await render();
    await tapDelete();
    await typePasswordAndConfirm('hunter2');

    expect(reauthMock).toHaveBeenCalledTimes(1);
    expect(authFetchMock).toHaveBeenCalledTimes(2); // first refused, retried after re-auth
    expect(text()).toMatch(/have been deleted/i);
  });

  it('says so when the password is wrong, and stays on the password step', async () => {
    authFetchMock.mockResolvedValueOnce(STALE());
    reauthMock.mockRejectedValueOnce(Object.assign(new Error('auth/wrong-password'), { code: 'auth/wrong-password' }));
    await render();
    await tapDelete();
    await typePasswordAndConfirm('wrong');

    expect(text()).toMatch(/incorrect password/i);
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    // And nothing was deleted on the strength of a bad password.
    expect(authFetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives a Google account the sign-out instruction, since it cannot re-auth in place', async () => {
    authMock.currentUser.providerData = [{ providerId: 'google.com' }];
    authFetchMock.mockResolvedValueOnce(STALE());
    await render();
    await tapDelete();

    expect(text()).toMatch(/sign out, sign back in/i);
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });
});

describe('Delete Account — every other outcome is visible too', () => {
  it('shows a failure state for a generic error', async () => {
    authFetchMock.mockResolvedValueOnce(
      apiResponse(500, { error: 'Your account could not be deleted. Please try again, or contact your ministry admin if this keeps happening.', step: 'document' }),
    );
    await render();
    await tapDelete();

    const alert = container.querySelector('[role="alert"]');
    expect(alert, 'a generic failure rendered nothing').not.toBeNull();
    expect(alert!.textContent ?? '').toMatch(/could not be deleted/i);
    // And it must be retryable rather than a dead end.
    expect(text()).toMatch(/try again/i);
  });

  it('names the network as the cause when the request never landed', async () => {
    authFetchMock.mockRejectedValueOnce(new Error('Failed to fetch'));
    await render();
    await tapDelete();

    expect(container.querySelector('[role="alert"]')?.textContent ?? '').toMatch(/connection/i);
  });

  it('confirms success before the sign-out redirect', async () => {
    await render();
    await tapDelete();

    const status = container.querySelector('[role="status"]');
    expect(status, 'a successful deletion confirmed nothing').not.toBeNull();
    expect(status!.textContent ?? '').toMatch(/your account and sign-in have been deleted/i);
    expect(status!.textContent ?? '').toMatch(/signing you out/i);
  });

  it('never reports success for a half-deletion — it says the sign-in is still there', async () => {
    // 🔴 THE ORIGINAL BUG, SEEN FROM THE CLIENT. The profile went, the sign-in
    // did not. Rendering the success panel here is what the old code did in
    // mirror image, and it is what must not happen.
    authFetchMock.mockResolvedValueOnce(
      apiResponse(500, {
        error: 'Your profile was deleted but your sign-in could not be removed. Please try again — you are still signed in.',
        step: 'auth',
        documentDeleted: true,
        authDeleted: false,
      }),
    );
    await render();
    await tapDelete();

    expect(container.querySelector('[role="status"]'), 'a half-deletion rendered the success panel').toBeNull();
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent ?? '').toMatch(/sign-in could not be removed/i);
    // And the member is NOT signed out of a session that still exists.
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it('does not claim the profile was removed when the document delete was refused', async () => {
    // The permission-denied case that used to pass silently. Now the route
    // refuses to touch the sign-in, and the copy says nothing was removed.
    authFetchMock.mockResolvedValueOnce(
      apiResponse(500, {
        error: 'Your profile could not be deleted, so your sign-in was left untouched. Nothing was removed — please try again.',
        step: 'document',
        documentDeleted: false,
        authDeleted: false,
      }),
    );
    await render();
    await tapDelete();

    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent ?? '').toMatch(/nothing was removed/i);
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it('disables both buttons while the deletion is in flight', async () => {
    let resolve!: (v: unknown) => void;
    authFetchMock.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    await render();
    await tapDelete();

    // Scope to the delete panel: the modal carries other Cancel buttons
    // (the partnership confirm, the password flow) that are not part of this.
    const deleting = [...container.querySelectorAll('button')].find(
      (b) => (b.textContent ?? '').trim() === 'Deleting…',
    );
    expect(deleting, 'the Delete button did not enter its in-flight state').toBeDefined();
    const panel = deleting!.closest('div.bg-red-50')!;
    const buttons = [...panel.querySelectorAll('button')];
    expect(buttons).toHaveLength(2);
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(text()).toMatch(/deleting/i);

    await act(async () => { resolve(OK()); });
  });
});

/**
 * The confirm panel must not oversell it either.
 *
 * "Delete my account" reads as full erasure. It is not: the route removes
 * users/{uid} and the Auth account, and nothing else — the CRM row, giving
 * history, registrations, check-ins, prayers and posts all stay. Widening that
 * is a retention decision (a receipted donation is a financial record), so the
 * honest move is to say the boundary out loud.
 */
describe('the confirm panel states what deletion does and does not remove', () => {
  it('names what goes and what stays before the member commits', async () => {
    await render();
    await click('Delete Account');

    expect(text()).toMatch(/deletes your profile and your sign-in/i);
    expect(text()).toMatch(/giving history/i);
    expect(text()).toMatch(/stay in their records/i);
  });
});

/**
 * The FAQ documented the BUG — twice.
 *
 * While Delete Account failed silently, the honest thing the member FAQ could
 * say was "if nothing appears to happen, sign out, sign back in and try again".
 * #287 fixed the silence and made that sentence wrong. It then said deletion
 * "removes your profile and your sign-in", which was HALF UNTRUE for as long as
 * the profile document survived every member deletion. Both are settled now, so
 * the answer must claim exactly what the route delivers — no more.
 *
 * These assertions live next to the component tests on purpose: the FAQ answer
 * is a claim about THIS flow, so the two should fail together rather than
 * drift apart in separate files.
 */
describe('the member FAQ matches what the delete flow now does', () => {
  const entry = MEMBER_FAQS.find((f) => /delete my account/i.test(f.question));
  const answer = () => entry!.answer.join('\n');

  it('still has a leaving/deleting entry', () => {
    expect(entry, 'the leaving/deleting FAQ entry is gone').toBeDefined();
  });

  it('no longer tells everyone to sign out and back in when nothing happens', () => {
    expect(answer()).not.toMatch(/if nothing appears to happen/i);
  });

  it('describes the in-place password confirmation', () => {
    expect(answer()).toMatch(/confirm your password/i);
  });

  it('keeps the sign-out advice only for Google accounts, which still need it', () => {
    expect(answer()).toMatch(/google/i);
    expect(answer()).toMatch(/sign out, sign back in/i);
  });

  it('promises what the handler now guarantees — no silent failure', () => {
    expect(answer()).toMatch(/not fail silently|tells you what happened/i);
  });

  it('claims the profile is removed only because it now actually is', () => {
    expect(answer()).toMatch(/removes your profile/i);
    // The specific promise the route keeps: no success unless BOTH halves went.
    expect(answer()).toMatch(/unless both your profile and your sign-in were actually removed/i);
  });

  it('says plainly which of the member’s data survives deletion', () => {
    // Half-untrue copy is the thing being fixed; an unqualified "removes your
    // profile" would be the same mistake in a smaller font.
    expect(answer()).toMatch(/does not remove everything/i);
    expect(answer()).toMatch(/giving history/i);
    expect(answer()).toMatch(/event registrations/i);
    expect(answer()).toMatch(/financial record/i);
  });

  it('cites the files the new answer was verified against', () => {
    expect(entry!.sources).toContain('src/components/PersonalInformationModal.tsx');
    // The claim about what is and is not deleted is a claim about the route.
    expect(entry!.sources).toContain('src/app/api/account/delete/route.ts');
    // The Google branch is a claim about how those accounts sign in.
    expect(entry!.sources).toContain('src/components/AuthPage.tsx');
  });
});
