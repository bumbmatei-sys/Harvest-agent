import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

/**
 * THE-36 — where analytics is allowed to run, and where it is not.
 *
 * The privacy configuration is pinned in
 * `src/lib/analytics/__tests__/posthog-privacy.test.ts`. This suite pins the
 * WIRING: that the pre-auth funnel gets nothing, that sign-out forgets the
 * person, and that an in-app screen still gets a pageview — because a gate that
 * blocks everything would pass the first two on its own.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { authState } = vi.hoisted(() => ({
  authState: { callback: null as null | ((user: unknown) => void), unsubscribed: 0 },
}));

vi.mock('../../firebase', () => ({ auth: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => {
    authState.callback = callback;
    return () => {
      authState.unsubscribed += 1;
    };
  },
}));

const { capturePageview, identifyUser, resetIdentity } = vi.hoisted(() => ({
  capturePageview: vi.fn(async () => {}),
  identifyUser: vi.fn(async () => ({ isPlatformAdmin: false })),
  resetIdentity: vi.fn(async () => {}),
}));
vi.mock('../../lib/analytics/client', () => ({ capturePageview, identifyUser, resetIdentity }));

import AnalyticsBridge from '../AnalyticsBridge';
import { PREAUTH_PATHS } from '../../lib/preauth-theme';

let container: HTMLDivElement;
let root: Root | null = null;

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

function mountAt(pathname: string) {
  root = createRoot(container);
  act(() => {
    root!.render(
      React.createElement(MemoryRouter, { initialEntries: [pathname] },
        React.createElement(AnalyticsBridge)),
    );
  });
}

/** Answer Firebase's auth listener the way a real sign-in / sign-out would. */
async function signIn(uid: string, email: string | null) {
  await act(async () => {
    authState.callback?.({ uid, email });
  });
  await flush();
}

async function signOut() {
  await act(async () => {
    authState.callback?.(null);
  });
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.callback = null;
  authState.unsubscribed = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container.remove();
});

describe('9 — no pre-auth surface gained tracking it did not have', () => {
  it.each([...PREAUTH_PATHS])('no pre-auth surface gained tracking it did not have: %s', async (preAuthPath) => {
    mountAt(preAuthPath);
    await signIn('uid-1', 'someone@grace.org');

    // Not "initialised but told not to look" — not initialised. These are the
    // screens built out of email and password inputs, and the only screens a
    // prospective customer sees before paying (THE-85).
    expect(identifyUser).not.toHaveBeenCalled();
    expect(capturePageview).not.toHaveBeenCalled();
  });

  it('a trailing slash or a capital does not open the gate', async () => {
    mountAt('/Auth/');
    await signIn('uid-1', 'someone@grace.org');
    expect(capturePageview).not.toHaveBeenCalled();
  });

  it('an in-app screen still gets a pageview — the gate is not simply "off"', async () => {
    mountAt('/admin/crm');
    await signIn('uid-1', 'admin@grace.org');

    expect(identifyUser).toHaveBeenCalledWith({ uid: 'uid-1', email: 'admin@grace.org' });
    expect(capturePageview).toHaveBeenCalledWith('/admin/crm', false);
  });

  it('renders nothing', () => {
    mountAt('/admin');
    expect(container.innerHTML).toBe('');
  });
});

describe('pageviews wait for auth', () => {
  it('nothing is captured until Firebase has answered', async () => {
    mountAt('/admin');
    await flush();

    // A pageview sent before auth resolves is filed under an anonymous id and,
    // for a church admin, under no tenant group at all.
    expect(capturePageview).not.toHaveBeenCalled();

    await signIn('uid-1', 'admin@grace.org');
    expect(capturePageview).toHaveBeenCalledTimes(1);
  });

  it('a signed-out visitor on an in-app path is counted, but not identified', async () => {
    mountAt('/');
    await signOut();

    expect(identifyUser).not.toHaveBeenCalled();
    expect(capturePageview).toHaveBeenCalledWith('/', false);
  });

  it('a platform admin is flagged on the pageview, not left to be inferred', async () => {
    identifyUser.mockResolvedValueOnce({ isPlatformAdmin: true });
    mountAt('/admin/tenants');
    await signIn('uid-super', 'owner@platform.test');

    expect(capturePageview).toHaveBeenCalledWith('/admin/tenants', true);
  });
});

describe('6 — identity is reset on sign-out', () => {
  it('identity is reset on sign-out', async () => {
    mountAt('/admin');
    await signIn('uid-first', 'first@grace.org');
    expect(identifyUser).toHaveBeenCalledTimes(1);

    await signOut();

    // ⚠️ Otherwise the next person on a shared church office computer inherits
    // the previous user's distinct_id — and their church.
    expect(resetIdentity).toHaveBeenCalledTimes(1);
  });

  it('sign-out is reset even though the landing screen is pre-auth', async () => {
    // Signing out navigates to /auth, which the gate above excludes. Reset must
    // not be excluded with it — and it is safe there, because resetIdentity()
    // acts only if analytics was already running.
    mountAt('/auth');
    await signOut();
    expect(resetIdentity).toHaveBeenCalledTimes(1);
  });

  it('the next sign-in is identified afresh rather than reusing the last person', async () => {
    mountAt('/admin');
    await signIn('uid-first', 'first@grace.org');
    await signOut();
    await signIn('uid-second', 'second@grace.org');

    expect(identifyUser).toHaveBeenLastCalledWith({ uid: 'uid-second', email: 'second@grace.org' });
    expect(identifyUser).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes from the auth listener on unmount', () => {
    mountAt('/admin');
    act(() => {
      root?.unmount();
    });
    root = null;
    expect(authState.unsubscribed).toBe(1);
  });
});
