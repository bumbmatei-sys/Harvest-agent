import React, { act } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

/**
 * 🔴 DELETE ACCOUNT MUST NEVER FAIL SILENTLY.
 *
 * The bug these tests exist for: `handleDeleteAccount` caught Firebase's
 * 'auth/requires-recent-login' and wrote two `console.error` lines. Nothing
 * rendered. The member tapped Delete on an irreversible action and the screen
 * did not move — no message, no spinner, no error — so they could not tell
 * whether the account was deleted, whether it failed, or whether the tap had
 * registered at all.
 *
 * ⚠️ EVERY ASSERTION BELOW IS ON RENDERED TEXT, DELIBERATELY. A console spy
 * would have passed against the broken code — the old version logged
 * enthusiastically. What was missing was output the member could see, so that
 * is the only thing worth asserting on. Restoring the console.error-only catch
 * must fail these by name.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { authMock, deleteUserMock, deleteDocMock, reauthMock } = vi.hoisted(() => ({
  authMock: {
    currentUser: {
      uid: 'u1',
      email: 'member@church.org',
      displayName: 'Member',
      photoURL: null,
      // Password account by default; the Google case flips this per test.
      providerData: [{ providerId: 'password' }] as { providerId: string }[],
    },
  },
  deleteUserMock: vi.fn(),
  deleteDocMock: vi.fn(),
  reauthMock: vi.fn(),
}));

vi.mock('../../firebase', () => ({ auth: authMock, db: {} }));
vi.mock('firebase/auth', () => ({
  updateProfile: vi.fn(async () => {}),
  updatePassword: vi.fn(async () => {}),
  deleteUser: deleteUserMock,
  EmailAuthProvider: { credential: (email: string, password: string) => ({ email, password }) },
  reauthenticateWithCredential: reauthMock,
  sendPasswordResetEmail: vi.fn(async () => {}),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  updateDoc: vi.fn(async () => {}),
  deleteDoc: deleteDocMock,
}));
vi.mock('../../utils/auth-fetch', () => ({ authFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })) }));
vi.mock('../CountrySelect', () => ({ default: () => null }));

import PersonalInformationModal from '../PersonalInformationModal';
import { MEMBER_FAQS } from '../../lib/member-faqs';

/** A Firebase-shaped rejection: the `code` field is what the handler branches on. */
function authError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

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

beforeEach(() => {
  vi.clearAllMocks();
  authMock.currentUser.providerData = [{ providerId: 'password' }];
  deleteDocMock.mockResolvedValue(undefined);
  deleteUserMock.mockResolvedValue(undefined);
  reauthMock.mockResolvedValue(undefined);
  document.body.innerHTML = '';
});

describe('Delete Account — requires-recent-login is visible, not a console line', () => {
  it('renders an explicit message when Firebase demands a recent sign-in', async () => {
    deleteUserMock.mockRejectedValueOnce(authError('auth/requires-recent-login'));
    await render();
    await tapDelete();

    // THE REGRESSION ASSERTION. Restoring the console.error-only catch leaves
    // the confirm panel exactly as it was and fails here.
    expect(text()).toMatch(/confirm your password/i);
    expect(container.querySelector('[role="alert"]')?.textContent ?? '').toMatch(/security/i);
  });

  it('offers the password field in place, rather than telling them to sign out', async () => {
    deleteUserMock.mockRejectedValueOnce(authError('auth/requires-recent-login'));
    await render();
    await tapDelete();

    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    // The old advice must NOT be what a password account is shown.
    expect(text()).not.toMatch(/sign out, sign back in/i);
  });

  it('re-authenticates in place and completes the deletion', async () => {
    deleteUserMock.mockRejectedValueOnce(authError('auth/requires-recent-login'));
    await render();
    await tapDelete();

    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'hunter2');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('Confirm & Delete');

    expect(reauthMock).toHaveBeenCalledTimes(1);
    expect(deleteUserMock).toHaveBeenCalledTimes(2); // first rejected, retried after re-auth
    expect(text()).toMatch(/has been deleted/i);
  });

  it('says so when the password is wrong, and stays on the password step', async () => {
    deleteUserMock.mockRejectedValueOnce(authError('auth/requires-recent-login'));
    reauthMock.mockRejectedValueOnce(authError('auth/wrong-password'));
    await render();
    await tapDelete();

    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'wrong');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('Confirm & Delete');

    expect(text()).toMatch(/incorrect password/i);
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('gives a Google account the sign-out instruction, since it cannot re-auth in place', async () => {
    authMock.currentUser.providerData = [{ providerId: 'google.com' }];
    deleteUserMock.mockRejectedValueOnce(authError('auth/requires-recent-login'));
    await render();
    await tapDelete();

    expect(text()).toMatch(/sign out, sign back in/i);
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });
});

describe('Delete Account — every other outcome is visible too', () => {
  it('shows a failure state for a generic error', async () => {
    deleteUserMock.mockRejectedValueOnce(authError('auth/internal-error'));
    await render();
    await tapDelete();

    const alert = container.querySelector('[role="alert"]');
    expect(alert, 'a generic failure rendered nothing').not.toBeNull();
    expect(alert!.textContent ?? '').toMatch(/could not be deleted/i);
    // And it must be retryable rather than a dead end.
    expect(text()).toMatch(/try again/i);
  });

  it('names the network as the cause when that is what failed', async () => {
    deleteUserMock.mockRejectedValueOnce(authError('auth/network-request-failed'));
    await render();
    await tapDelete();

    expect(container.querySelector('[role="alert"]')?.textContent ?? '').toMatch(/connection/i);
  });

  it('confirms success before the sign-out redirect', async () => {
    await render();
    await tapDelete();

    const status = container.querySelector('[role="status"]');
    expect(status, 'a successful deletion confirmed nothing').not.toBeNull();
    expect(status!.textContent ?? '').toMatch(/your account has been deleted/i);
    expect(status!.textContent ?? '').toMatch(/signing you out/i);
  });

  it('does not claim the profile was removed when the document delete was denied', async () => {
    // Today's real behaviour for every ordinary member: firestore.rules gives
    // users/{userId} `allow delete: if isSuperAdmin()`, so this write is denied
    // while deleteUser still succeeds. The copy must not say "your account has
    // been deleted" when the profile document is still there.
    deleteDocMock.mockRejectedValueOnce(Object.assign(new Error('permission-denied'), { code: 'permission-denied' }));
    await render();
    await tapDelete();

    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status!.textContent ?? '').toMatch(/could not be removed automatically/i);
    expect(deleteUserMock).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while the deletion is in flight', async () => {
    let resolve!: () => void;
    deleteUserMock.mockReturnValueOnce(new Promise<void>((r) => { resolve = r; }));
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

    await act(async () => { resolve(); });
  });
});

/**
 * The FAQ documented the BUG.
 *
 * While Delete Account failed silently, the honest thing the member FAQ could
 * say was "if nothing appears to happen, sign out, sign back in and try again".
 * Fixing the silence makes that sentence wrong — a password account is now
 * asked for its password in place and never has to sign out at all.
 *
 * These assertions live next to the component tests on purpose: the FAQ answer
 * is a claim about THIS handler, so the two should fail together rather than
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

  it('cites the files the new answer was verified against', () => {
    expect(entry!.sources).toContain('src/components/PersonalInformationModal.tsx');
    // The Google branch is a claim about how those accounts sign in.
    expect(entry!.sources).toContain('src/components/AuthPage.tsx');
  });
});
