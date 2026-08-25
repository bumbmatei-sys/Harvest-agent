import React, { act } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

/**
 * 🔴 THE-188 — THE EXPORT SITS BESIDE THE DELETE, AND IT IS REACHABLE.
 *
 * PR 354 shipped erasure into this exact panel and shipped it alone: a member
 * could destroy 25 collections' worth of their own data and had no way to take a
 * copy first. A route nobody can reach is not a right, so this pins the surface,
 * not just the API.
 *
 * ⚠️ EVERY ASSERTION IS ON RENDERED TEXT OR ON THE FILE THAT LEFT THE PAGE, for
 * the same reason the delete-account suite gives: a console spy passes against
 * code that fails silently.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { authMock, authFetchMock, getIdTokenMock } = vi.hoisted(() => {
  const getIdTokenMock = vi.fn(async () => 'id-token');
  return {
    getIdTokenMock,
    authMock: {
      currentUser: {
        uid: 'u1', email: 'member@church.org', displayName: 'Member', photoURL: null,
        getIdToken: getIdTokenMock,
        providerData: [{ providerId: 'password' }] as { providerId: string }[],
      },
    },
    authFetchMock: vi.fn(),
  };
});

vi.mock('../../firebase', () => ({ auth: authMock, db: {} }));
vi.mock('firebase/auth', () => ({
  updateProfile: vi.fn(async () => {}), updatePassword: vi.fn(async () => {}), signOut: vi.fn(),
  EmailAuthProvider: { credential: vi.fn() }, reauthenticateWithCredential: vi.fn(),
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

const EXPORT_DOC = {
  format: 'harvest.member-export',
  version: 1,
  status: 'complete',
  subject: { uid: 'u1', email: 'member@church.org', tenantId: 't1' },
  sections: [{ collection: 'users', count: 1, rows: [{ id: 'u1' }] }],
  gaps: [{ collection: 'tenants/{t}/smsLogs', reason: '⚠️ CANNOT BE EXPORTED.' }],
};

function apiResponse(status: number, body: Record<string, unknown>) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

let container: HTMLDivElement;

/** The bytes of every file the page tried to hand the member, plus its name. */
const downloads: { name: string; body: string }[] = [];

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(<PersonalInformationModal isOpen onClose={() => {}} />);
  });
}

async function click(text: string | RegExp) {
  const match = (s: string) => (typeof text === 'string' ? s.trim() === text : text.test(s));
  const button = [...container.querySelectorAll('button')].find((b) => match(b.textContent ?? ''));
  if (!button) throw new Error(`no button matching ${text}`);
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

const text = () => container.textContent ?? '';

beforeEach(() => {
  vi.clearAllMocks();
  downloads.length = 0;
  document.body.innerHTML = '';
  authFetchMock.mockResolvedValue(apiResponse(200, EXPORT_DOC));
  getIdTokenMock.mockResolvedValue('id-token');

  // A download is a Blob, an object URL and an anchor click. happy-dom would
  // try to NAVIGATE on that click, so the anchor is intercepted and the bytes
  // are captured instead — which is the thing worth asserting on anyway: what
  // actually left the page, and under what filename.
  const blobText = new WeakMap<Blob, string>();
  const RealBlob = globalThis.Blob;
  vi.stubGlobal('Blob', function StubBlob(parts: BlobPart[], opts?: BlobPropertyBag) {
    const blob = new RealBlob(parts, opts);
    blobText.set(blob, parts.map(String).join(''));
    return blob;
  });
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
    pendingBody = blobText.get(blob as Blob) ?? '';
    return 'blob:export';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, body: pendingBody });
  });
});

let pendingBody = '';

describe('Download My Data — the half that deletion shipped without', () => {
  it('🔴 the member can reach it from the same panel the delete button is in', async () => {
    await render();
    expect(text()).toContain('Download My Data');
    expect(text()).toContain('Delete Account');
  });

  it('asks the server for its own caller’s data, and nobody else’s', async () => {
    await render();
    await click('Download My Data');

    expect(authFetchMock).toHaveBeenCalledWith('/api/account/export', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1' }),
    });
  });

  it('refreshes the token first, so a fresh sign-in is not rejected as stale', async () => {
    await render();
    await click('Download My Data');
    expect(getIdTokenMock).toHaveBeenCalledWith(true);
  });

  it('🔴 hands the member a file, and the file is the export document', async () => {
    await render();
    await click('Download My Data');

    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toMatch(/^harvest-my-data-\d{4}-\d{2}-\d{2}\.json$/);
    const parsed = JSON.parse(downloads[0].body);
    expect(parsed.format).toBe('harvest.member-export');
    // The declared gaps travel WITH the file — that is the whole point of
    // declaring them rather than dropping them.
    expect(parsed.gaps[0].collection).toBe('tenants/{t}/smsLogs');
    expect(text()).toContain('Your data has been downloaded');
  });

  it('🔴 a PARTIAL export still downloads, and says it is incomplete', async () => {
    authFetchMock.mockResolvedValue(
      apiResponse(500, { ...EXPORT_DOC, status: 'partial', failures: [{ collection: 'certificates' }] }),
    );
    await render();
    await click('Download My Data');

    // Nothing is thrown away — twenty-four sections must not be lost to one.
    expect(downloads).toHaveLength(1);
    // And it is never dressed up as whole.
    expect(text()).toMatch(/incomplete/i);
  });

  it('renders the stale-sign-in case instead of failing silently', async () => {
    authFetchMock.mockResolvedValue(apiResponse(401, { code: 'auth/requires-recent-login' }));
    await render();
    await click('Download My Data');

    expect(downloads).toHaveLength(0);
    expect(text()).toMatch(/recent sign-in/i);
  });

  it('renders a network failure instead of failing silently', async () => {
    authFetchMock.mockRejectedValue(new Error('offline'));
    await render();
    await click('Download My Data');
    expect(text()).toMatch(/Could not reach the server/i);
  });

  it('renders a server refusal in the server’s own words', async () => {
    authFetchMock.mockResolvedValue(apiResponse(403, { error: 'You can only export your own data.' }));
    await render();
    await click('Download My Data');
    expect(text()).toContain('You can only export your own data.');
  });
});
