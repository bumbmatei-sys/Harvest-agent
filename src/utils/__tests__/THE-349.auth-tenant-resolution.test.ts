import { describe, it, expect } from 'vitest';

import {
  readTenantCookie,
  resolveAuthTenant,
  tenantIdToWrite,
  TENANT_UNRESOLVED_MESSAGE,
  TENANT_UNRESOLVED_TITLE,
} from '../auth-tenant-resolution';
import {
  emailAuthFailureMessage,
  googleAuthFailureMessage,
  homeScreenGoogleMessage,
  isIOSHomeScreenApp,
  GENERIC_GOOGLE_MESSAGE,
  GENERIC_SIGN_IN_MESSAGE,
  GENERIC_SIGN_UP_MESSAGE,
} from '../auth-failure-copy';
import { getTenantIdFromHost } from '../tenant-scope';
import { NON_TENANT_SUBDOMAINS } from '../non-tenant-subdomains';

/**
 * THE-349 · the tri-state resolver, and the copy that replaced "try again".
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * These are the assertions that do not need a component. Everything about the
 * SIGNUP — which value reaches Firestore, and which host refuses — is measured
 * against the real `AuthPage` in
 * `src/components/__tests__/THE-349.google-signup-tenant.test.tsx`, because a
 * resolver that answers correctly while the screen ignores it would pass every
 * test in this file.
 */

const nullHost = () => null;

describe('1 · a tenant subdomain names its ministry', () => {
  it('kingdom-living.theharvest.app resolves to kingdom-living', () => {
    // The reported host, and it was never the one that lost the tenant.
    expect(resolveAuthTenant('kingdom-living.theharvest.app', nullHost()))
      .toEqual({ kind: 'tenant', tenantId: 'kingdom-living', reason: 'tenant-subdomain' });
  });

  it('and the case of the host does not change the answer', () => {
    expect(resolveAuthTenant('Kingdom-Living.TheHarvest.App', nullHost()))
      .toMatchObject({ kind: 'tenant', tenantId: 'kingdom-living' });
  });
});

/* ── Test 4 ───────────────────────────────────────────────────────────────── */
describe('2 · the APEX resolves to null, and that is CORRECT', () => {
  it('theharvest.app is platform, not a ministry and not an unknown', () => {
    const r = resolveAuthTenant('theharvest.app', nullHost());
    expect(r).toEqual({ kind: 'platform', reason: 'apex' });
    // 🔴 The distinction this ticket exists for: platform WRITES null. It is
    // not the answer that refuses — that is `unresolved`, and only that.
    expect(tenantIdToWrite(r)).toBeNull();
  });
});

/* ── Test 5 ───────────────────────────────────────────────────────────────── */
describe('3 · a non-tenant subdomain still resolves to null — named per subdomain', () => {
  // 🔴 Named one at a time rather than looped over the Set alone: a loop over
  // the source of truth would keep passing if someone emptied it. The literal
  // list is the claim; the Set is then checked against it, so removing a
  // subdomain from either side fails.
  it.each([
    ['www.theharvest.app', 'www'],
    ['app.theharvest.app', 'app'],
    ['admin.theharvest.app', 'admin'],
    ['affiliate.theharvest.app', 'affiliate'],
  ])('%s is a platform alias, not a ministry called %s', (host, label) => {
    const r = resolveAuthTenant(host, nullHost());
    expect(r, `${host} started resolving to a tenant`).toEqual({ kind: 'platform', reason: 'platform-subdomain' });
    expect(tenantIdToWrite(r), `${label} would be written as a tenant slug`).toBeNull();
  });

  it('and the four are exactly the set every other resolver shares', () => {
    expect([...NON_TENANT_SUBDOMAINS].sort()).toEqual(['admin', 'affiliate', 'app', 'www']);
  });
});

/* ── Test 6 ───────────────────────────────────────────────────────────────── */
describe('4 · a Vercel preview host still resolves to null — deliberately', () => {
  it.each([
    'harvest-agent-git-the-349-abc123.vercel.app',
    'harvest-agent.vercel.app',
  ])('%s is a preview, whose single label is not a tenant slug', (host) => {
    const r = resolveAuthTenant(host, nullHost());
    expect(r).toEqual({ kind: 'platform', reason: 'preview-host' });
    expect(tenantIdToWrite(r)).toBeNull();
  });

  it('🔴 and this CLOSED a divergence rather than opening one', () => {
    // `AuthPage` used to accept `.vercel.app` and stamp the first label as a
    // tenant, while `getTenantIdFromHost` — the resolver
    // `non-tenant-subdomains.ts` names as the shared authority — said null.
    // A signup on a preview URL was written into a ministry that never existed.
    const host = 'harvest-agent-git-the-349-abc123.vercel.app';
    expect(resolveAuthTenant(host, nullHost()).kind).toBe('platform');
  });
});

describe('5 · localhost is platform, so a developer never creates an orphan', () => {
  it.each(['localhost', '127.0.0.1', 'harvest.localhost'])('%s', (host) => {
    expect(resolveAuthTenant(host, nullHost()).kind).toBe('platform');
  });
});

/* ── The defect itself ────────────────────────────────────────────────────── */
describe('6 · 🔴 a custom domain with no cookie is UNRESOLVED, never null', () => {
  it('the host serves one ministry and names none — so nothing may be written', () => {
    const r = resolveAuthTenant('kingdomliving.church', nullHost());
    expect(r).toEqual({ kind: 'unresolved', reason: 'custom-domain' });
  });

  it('🔴 and asking for a value to write THROWS rather than handing back null', () => {
    // This is the assertion that keeps the fix from decaying back into the bug:
    // any future caller that forgets to handle `unresolved` fails loudly at the
    // write site instead of silently orphaning somebody.
    expect(() => tenantIdToWrite(resolveAuthTenant('kingdomliving.church', nullHost())))
      .toThrow(/unresolved/i);
  });

  it('the middleware cookie, when there is one, names the ministry', () => {
    expect(resolveAuthTenant('kingdomliving.church', 'kingdom-living'))
      .toEqual({ kind: 'tenant', tenantId: 'kingdom-living', reason: 'custom-domain-cookie' });
  });

  it('an empty or whitespace cookie is not an answer', () => {
    expect(resolveAuthTenant('kingdomliving.church', '   ').kind).toBe('unresolved');
    expect(resolveAuthTenant('kingdomliving.church', '').kind).toBe('unresolved');
  });

  it('a missing hostname is unresolved too — there is nothing to read', () => {
    expect(resolveAuthTenant('', nullHost()).kind).toBe('unresolved');
    expect(resolveAuthTenant(undefined, nullHost()).kind).toBe('unresolved');
  });
});

describe('7 · the cookie reader', () => {
  it('finds tenantId among other cookies', () => {
    expect(readTenantCookie('foo=1; tenantId=kingdom-living; bar=2')).toBe('kingdom-living');
  });
  it('answers null when the jar has no tenantId', () => {
    expect(readTenantCookie('foo=1; bar=2')).toBeNull();
    expect(readTenantCookie('')).toBeNull();
    expect(readTenantCookie(null)).toBeNull();
  });
  it('does not mistake a cookie whose name merely ends in tenantId', () => {
    expect(readTenantCookie('lastTenantId=other')).toBeNull();
  });
});

/**
 * 🔴 The invariant `non-tenant-subdomains.ts` names as a bug class: the four
 * resolvers must never disagree. Checked by construction over a host table
 * rather than asserted in prose.
 */
describe('8 · this resolver never contradicts getTenantIdFromHost', () => {
  const HOSTS = [
    'kingdom-living.theharvest.app',
    'nations.theharvest.app',
    'theharvest.app',
    'www.theharvest.app',
    'app.theharvest.app',
    'admin.theharvest.app',
    'affiliate.theharvest.app',
    'harvest-agent-git-the-349-abc123.vercel.app',
    'kingdomliving.church',
    'localhost',
  ];

  it.each(HOSTS)('%s', (host) => {
    (window as unknown as { happyDOM: { setURL: (u: string) => void } }).happyDOM.setURL(`https://${host}/auth`);
    const shared = getTenantIdFromHost();
    const mine = resolveAuthTenant(host, nullHost());
    if (shared === null) {
      expect(mine.kind, `${host}: the shared resolver says null and this one named a tenant`)
        .not.toBe('tenant');
    } else {
      expect(mine, `${host}: the two resolvers named different tenants`)
        .toEqual({ kind: 'tenant', tenantId: shared, reason: 'tenant-subdomain' });
    }
  });
});

/* ── Test 8: the message ──────────────────────────────────────────────────── */
describe('9 · 🔴 "Unable to sign in. Please try again." is replaced, named per cause', () => {
  it('the collision the reported member walked into is named, and does not invite a retry', () => {
    const m = googleAuthFailureMessage('auth/account-exists-with-different-credential');
    expect(m).not.toContain('try again');
    expect(m, 'the person is not told which key their account actually opens with')
      .toMatch(/email and password/i);
    expect(m).not.toBe(GENERIC_GOOGLE_MESSAGE);
  });

  it('a blocked pop-up names the pop-up and the way round it', () => {
    const m = googleAuthFailureMessage('auth/popup-blocked');
    expect(m).toMatch(/pop-?ups/i);
    expect(m).toMatch(/email and password/i);
  });

  it('an unauthorised domain says a retry cannot succeed, and who must act', () => {
    const m = googleAuthFailureMessage('auth/unauthorized-domain');
    expect(m).toMatch(/cannot succeed/i);
    expect(m).toMatch(/runs this site/i);
  });

  it('🔴 auth/invalid-credential — the commonest failure of all — points at the reset link', () => {
    // v10 collapses wrong-password and user-not-found into this one code, so it
    // was the single largest consumer of "Unable to sign in. Please try again."
    for (const code of ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found']) {
      const m = emailAuthFailureMessage(code, true);
      expect(m, `${code} still falls through to the generic line`).not.toBe(GENERIC_SIGN_IN_MESSAGE);
      expect(m).toMatch(/Forgot your password/i);
      // And it never says WHICH half was wrong — that is an enumeration hint.
      expect(m).not.toMatch(/no account with|wrong password|that address does not/i);
    }
  });

  it('a disabled account names the administrator, not a retry', () => {
    const m = emailAuthFailureMessage('auth/user-disabled', true);
    expect(m).toMatch(/administers your ministry/i);
    expect(m).toMatch(/will not change it/i);
    expect(googleAuthFailureMessage('auth/user-disabled')).toBe(m);
  });

  it('too-many-requests names the wait and the reset, not "try again"', () => {
    expect(emailAuthFailureMessage('auth/too-many-requests', true)).toMatch(/Wait a few minutes/i);
  });

  it('the branches that were already right are unchanged', () => {
    expect(googleAuthFailureMessage('auth/popup-closed-by-user')).toBe('Sign-in was cancelled.');
    expect(emailAuthFailureMessage('auth/invalid-email', false)).toBe('Please enter a valid email address.');
    expect(emailAuthFailureMessage('auth/operation-not-allowed', false))
      .toBe('Email/Password sign-in is not enabled. Please enable it in the Firebase Console.');
    expect(emailAuthFailureMessage('auth/network-request-failed', true)).toMatch(/reach the server/i);
  });

  it('🔴 and the generic line survives ONLY for a cause nobody recognises', () => {
    // Where a retry genuinely might work, "try again" is honest advice. The
    // ban is on saying it to somebody it can never help.
    expect(emailAuthFailureMessage('auth/some-code-nobody-has-seen', true)).toBe(GENERIC_SIGN_IN_MESSAGE);
    expect(emailAuthFailureMessage('auth/some-code-nobody-has-seen', false)).toBe(GENERIC_SIGN_UP_MESSAGE);
    expect(googleAuthFailureMessage('')).toBe(GENERIC_GOOGLE_MESSAGE);
  });
});

describe('10 · the iPhone home-screen app, which produced no message at all', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36';
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

  it('🔴 iOS + navigator.standalone — the exact pair @firebase/auth reads', () => {
    expect(isIOSHomeScreenApp(IPHONE, true)).toBe(true);
  });

  it('an iPhone in Safari itself is NOT it — the pop-up works there', () => {
    expect(isIOSHomeScreenApp(IPHONE, false)).toBe(false);
    expect(isIOSHomeScreenApp(IPHONE, undefined)).toBe(false);
  });

  it('an installed Android app is NOT it — Chrome opens a real pop-up', () => {
    expect(isIOSHomeScreenApp(ANDROID, true)).toBe(false);
  });

  it('and desktop Safari is not it either', () => {
    expect(isIOSHomeScreenApp(MAC, true)).toBe(false);
  });

  it('the message names the address to open and the way that works here', () => {
    const m = homeScreenGoogleMessage('kingdom-living.theharvest.app');
    expect(m).toContain('kingdom-living.theharvest.app');
    expect(m).toMatch(/Safari/);
    expect(m).toMatch(/email and password/i);
  });
});

describe('11 · the refusal copy names a next step and no error code', () => {
  it('it says nothing was created, where to go, and who to ask', () => {
    expect(TENANT_UNRESOLVED_TITLE).toMatch(/which ministry/i);
    expect(TENANT_UNRESOLVED_MESSAGE).toMatch(/Nothing has been created/);
    expect(TENANT_UNRESOLVED_MESSAGE).toMatch(/\.theharvest\.app/);
    expect(TENANT_UNRESOLVED_MESSAGE).toMatch(/invited you/i);
  });

  it('and names nothing a visitor cannot act on', () => {
    for (const jargon of ['cookie', 'middleware', 'tenantId', 'null', 'subdomain', 'Firestore']) {
      expect(TENANT_UNRESOLVED_MESSAGE, `the refusal says "${jargon}" at somebody joining a church`)
        .not.toContain(jargon);
    }
  });
});
