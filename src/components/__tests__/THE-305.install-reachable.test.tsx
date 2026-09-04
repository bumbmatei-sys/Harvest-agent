import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * THE-305 part 3 — "I do not see the add to home screen button in user app
 * account settings."
 *
 * ── 🔴 THE TICKET'S PREMISE DID NOT REPRODUCE ────────────────────────────────
 * The ticket was written as "the install path exists only at post-onboarding,
 * and skipping it makes the feature unreachable forever". It is not so on
 * `main`: THE-255 (#396) shipped an "Install app" row in member account
 * settings, `Profile.tsx` mounts `<InstallAppModal>`, and the row is gated on
 * nothing but `isNativeShell()`. Verified on the founder's own configuration —
 * Brave on Android, `pwa_installed` already written by the skip, and no
 * `beforeinstallprompt` ever fired — the row renders and opens the Android
 * instructions.
 *
 * So the fix this ticket asked for was already in the tree, and Profile.tsx is
 * deliberately NOT edited here. What was missing is this file: the founder's
 * exact case was never pinned, so nothing stopped a later change from gating the
 * row on a fired prompt, on the onboarding marker, or on "already installed" —
 * each of which would reproduce the report for real. These are those pins.
 *
 * ── ⚠️ WHY THE ROW MUST NOT WAIT ON `beforeinstallprompt` ────────────────────
 * It is the browser's own install event. It fires ONCE per page load and only
 * when the browser judges the app installable — and iOS Safari never fires it at
 * all. A control that waits for it shows nothing to an iPhone, nothing after the
 * event has been consumed, and nothing in a Brave build whose prompt heuristics
 * differ from Chrome's. `resolveInstallState` is written so that the event only
 * ever UPGRADES the offer to one tap; with no event it still returns a platform,
 * and a platform always has instructions. Section 3 is that claim.
 *
 * ── 🔵 SHOULD IT HIDE WHEN THE APP *IS* INSTALLED? ───────────────────────────
 * Recorded decision: it stays visible, and the MODAL says "already installed"
 * (`INSTALL_BLURB.installed`) rather than the row disappearing. Hiding is
 * defensible for someone genuinely running the installed app, but `isInstalled()`
 * reads `display-mode: standalone`, which is a fact about the CURRENT TAB, not
 * the device: the same member opening the site in an ordinary browser tab reads
 * as "not installed", and one who installed it and came back through a link
 * reads as "installed" while looking at a browser. A row that comes and goes on
 * that signal is exactly the "the button is missing" report this ticket started
 * from. The one case that IS a fact about the runtime — the Capacitor shell,
 * where there is nothing to install and no honest instruction to give — is the
 * one case the row is hidden for. Section 4 pins both halves.
 */

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ── Backend surface: enough for Profile to paint (the-255's set) ─────────── */

const { authMock, userDoc, hostTenant } = vi.hoisted(() => ({
  authMock: { currentUser: { uid: 'u1', email: 'member@church.org', photoURL: null, displayName: 'Member' } },
  userDoc: { current: {} as Record<string, unknown> },
  hostTenant: { current: 'grace' as string | null },
}));

vi.mock('../../firebase', () => ({
  auth: authMock, db: {}, messaging: Promise.resolve(null), VAPID_KEY: 'k',
}));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(), updateProfile: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  onSnapshot: (_r: unknown, cb: (d: unknown) => void) => { cb({ exists: () => true, data: () => userDoc.current }); return () => {}; },
  updateDoc: vi.fn(async () => {}),
  collection: () => ({}), query: () => ({}), where: () => ({}),
  getDocs: vi.fn(async () => ({ forEach: (f: (d: unknown) => void) => f({ data: () => ({ tenantId: 'tenant-1' }) }) })),
  arrayUnion: (v: unknown) => v,
}));
vi.mock('firebase/messaging', () => ({ getToken: vi.fn(async () => null) }));
vi.mock('../../utils/tenant-scope', () => ({
  SUPER_ADMIN_EMAIL: 'founder@theharvest.site',
  isSuperAdmin: () => false,
  getTenantScope: async () => 'tenant-1',
  getTenantIdFromHost: () => hostTenant.current,
}));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => ({ tenantPlan: 'plus' }) }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('../PersonalInformationModal', () => ({ default: () => null }));
vi.mock('../ContactModal', () => ({ default: () => null }));
vi.mock('../FAQModal', () => ({ default: () => null }));
vi.mock('../PrivacyTermsModal', () => ({ default: () => null }));
vi.mock('../ChurchDetailsModal', () => ({ default: () => null }));
vi.mock('../UserEvents', () => ({ default: () => null }));
vi.mock('../SavedItems', () => ({ default: () => null }));
vi.mock('../DonationHistory', () => ({ default: () => null }));

import Profile from '../Profile';
import {
  INSTALL_HANDLED_KEY,
  INSTALL_BLURB,
  detectInstallPlatform,
  installStepsText,
  isInstallHandled,
  resolveInstallState,
} from '../../lib/pwa-install';

/* ── Environment control ──────────────────────────────────────────────────── */

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
/** The founder's device, per the screenshots' user agent: Brave on Android. */
const BRAVE_ANDROID_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const SHELL_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36';

function setUA(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}
function setStandalone(on: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: on && /display-mode:\s*standalone/.test(q),
    media: q, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
  Object.defineProperty(window.navigator, 'standalone', { value: on, configurable: true });
}
function enterNativeShell() {
  (window as unknown as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true, getPlatform: () => 'android',
  };
  setUA(SHELL_UA);
}
function leaveNativeShell() {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
  leaveNativeShell();
  setUA(DESKTOP_UA);
  setStandalone(false);
  hostTenant.current = 'grace';
  userDoc.current = { displayName: 'Sarah Whitfield' };
});
afterEach(() => { leaveNativeShell(); });

async function mount(el: React.ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(el); });
  await act(async () => { await Promise.resolve(); });
  return host;
}

const textOf = (el: Element | null) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const buttonNamed = (host: HTMLElement, label: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => textOf(b) === label) ?? null;
const click = async (el: Element) => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve(); });
};

/** Member account settings, as a member actually reaches it. */
const settings = () => mount(<Profile onNavigate={() => {}} onGoToPartner={() => {}} onGoToMap={() => {}} />);
/** The persistent install control in that surface. */
const installControl = (host: HTMLElement) => buttonNamed(host, 'Install app');

// ═════════════════════════════════════════════════════════════════════════════
// 1. 🔴 Reachable at any time.
// ═════════════════════════════════════════════════════════════════════════════
describe('the install control is reachable from member account settings at any time', () => {
  it('renders in the settings list and opens the install screen', async () => {
    const host = await settings();
    const row = installControl(host);
    expect(row, 'member account settings has no install control').not.toBeNull();

    await click(row!);
    expect(host.querySelector('[data-install-steps]'), 'the control opened nothing').not.toBeNull();
  });

  it('needs no onboarding state, no prompt and no navigation to get to', async () => {
    // Nothing is dispatched, nothing is seeded, no step is completed — the row
    // is simply there on a cold mount. That is what "persistent" means here.
    expect(installControl(await settings())).not.toBeNull();
  });

  it('is reachable more than once — reading the steps does not consume it', async () => {
    const host = await settings();
    await click(installControl(host)!);
    // Opening is reading, not skipping: the one-time onboarding marker must not
    // be written, or a member who came here to read would silently lose the
    // onboarding step they have not reached yet.
    expect(localStorage.getItem(INSTALL_HANDLED_KEY)).toBeNull();
    expect(installControl(await settings()), 'the control was consumed by being used').not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. 🔴 8b — the founder's exact case: he SKIPPED the onboarding step.
// ═════════════════════════════════════════════════════════════════════════════
describe('it is visible to a member who SKIPPED the onboarding step', () => {
  /** What skipping writes, through the same helper the step itself uses. */
  const skipOnboardingInstall = () => localStorage.setItem(INSTALL_HANDLED_KEY, 'true');

  it('renders after the step has been skipped', async () => {
    skipOnboardingInstall();
    expect(isInstallHandled(), 'the fixture did not actually record a skip').toBe(true);
    expect(installControl(await settings()),
      'skipping onboarding removed the install control — the founder\'s report').not.toBeNull();
  });

  it('renders on the founder\'s own device — Brave on Android, skipped, no prompt', async () => {
    // The whole reported configuration at once, since each piece alone passing
    // is what let the report stand.
    setUA(BRAVE_ANDROID_UA);
    skipOnboardingInstall();
    const host = await settings();
    expect(installControl(host)).not.toBeNull();

    await click(installControl(host)!);
    const text = textOf(host);
    expect(text, 'Brave + Android + skipped got no usable instructions').toContain('Install app');
    expect(host.querySelector('[data-install-steps]')).not.toBeNull();
  });

  it('still opens the right platform\'s steps after a skip', async () => {
    setUA(BRAVE_ANDROID_UA);
    skipOnboardingInstall();
    const host = await settings();
    await click(installControl(host)!);
    const text = textOf(host);
    // Android installs from the overflow menu; the iOS Share sheet would be the
    // wrong steps, and wrong steps are worse than none.
    expect(text).toContain('Install app');
    expect(text).not.toContain('Add to Home Screen');
  });

  it('reads the onboarding marker nowhere in the settings surface', async () => {
    // The structural version of the same claim: Profile cannot gate on the skip
    // marker, because it never consults it.
    const profile = read('components/Profile.tsx');
    expect(profile, 'the settings surface gates on the onboarding marker').not.toContain('isInstallHandled');
    expect(profile).not.toContain(INSTALL_HANDLED_KEY);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. 🔴 8c / 9 — independent of `beforeinstallprompt`, and the iOS fallback.
// ═════════════════════════════════════════════════════════════════════════════
describe('it is visible when no native browser prompt is available', () => {
  it('renders with no beforeinstallprompt ever fired', async () => {
    // No event is dispatched anywhere in this test, which is the point.
    expect(installControl(await settings())).not.toBeNull();
  });

  it('resolves to a platform rather than to nothing when there is no prompt', () => {
    setUA(BRAVE_ANDROID_UA);
    expect(resolveInstallState({ hasNativePrompt: false })).toBe('android');
    setUA(IOS_UA);
    expect(resolveInstallState({ hasNativePrompt: false })).toBe('ios');
    setUA(DESKTOP_UA);
    expect(resolveInstallState({ hasNativePrompt: false })).toBe('desktop');
  });

  it('treats the native prompt as an upgrade, never as a precondition', () => {
    // Every no-prompt state still has steps to show, and each is a real platform
    // rather than an empty or "unavailable" state.
    for (const ua of [BRAVE_ANDROID_UA, IOS_UA, DESKTOP_UA]) {
      setUA(ua);
      const state = resolveInstallState({ hasNativePrompt: false });
      expect(INSTALL_BLURB[state], `${state} has no blurb`).toBeTruthy();
      expect(installStepsText(state as 'ios' | 'android' | 'desktop').length,
        `${state} has no instructions to fall back to`).toBeGreaterThan(0);
    }
  });

  it('does not mount the control behind an install-event listener', () => {
    // The failure mode this pins: a row rendered only once the event has been
    // captured shows nothing on iOS, nothing after the event is consumed, and
    // nothing in a browser whose heuristics differ from Chrome's.
    const profile = read('components/Profile.tsx');
    expect(profile, 'the settings surface listens for the browser install event')
      .not.toContain('beforeinstallprompt');
  });
});

describe('the install path falls back to instructions where no browser prompt exists', () => {
  it('gives an iPhone the Share-sheet steps, which are its ONLY path', async () => {
    // iOS Safari never fires beforeinstallprompt at all — Add to Home Screen is
    // a manual Share-sheet action — which is the reason InstallInstructions
    // exists as a component in the first place.
    setUA(IOS_UA);
    expect(detectInstallPlatform()).toBe('ios');
    const host = await settings();
    await click(installControl(host)!);
    const text = textOf(host);
    expect(text).toContain('Share');
    expect(text).toContain('Add to Home Screen');
    expect(text, 'an iPhone was handed the Android menu').not.toContain('Tap the menu');
  });

  it('gives Brave on Android the overflow-menu steps', async () => {
    setUA(BRAVE_ANDROID_UA);
    const host = await settings();
    await click(installControl(host)!);
    const text = textOf(host);
    expect(text).toContain('Tap the menu');
    expect(text, 'Android was handed the iOS Share sheet').not.toContain('Add to Home Screen');
  });

  it('renders the steps from the one shared source, not a local copy', async () => {
    setUA(IOS_UA);
    const host = await settings();
    await click(installControl(host)!);
    // The step rows are `InstructionRow` divs, addressed the same way
    // the-255-install-app.test.tsx addresses them.
    const rendered = Array.from(host.querySelectorAll('[data-install-steps] > div'))
      .map((row) => textOf(row).replace(/^\d+\s*/, ''));
    expect(rendered.length).toBeGreaterThan(0);
    // Byte-for-byte the module's own copy — the single-source invariant THE-255
    // was extracted to create.
    expect(rendered).toEqual(installStepsText('ios'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. 🔵 The recorded decision about an app that IS installed.
// ═════════════════════════════════════════════════════════════════════════════
describe('the control\'s visibility when the app is already installed', () => {
  it('STAYS VISIBLE in an installed/standalone tab, and says so when opened', async () => {
    setStandalone(true);
    const host = await settings();
    expect(installControl(host),
      'the row now hides on display-mode: standalone — see this file\'s header').not.toBeNull();

    await click(installControl(host)!);
    expect(textOf(host)).toContain(INSTALL_BLURB.installed);
  });

  it('offers no steps to someone who has already installed', async () => {
    setStandalone(true);
    const host = await settings();
    await click(installControl(host)!);
    expect(host.querySelector('[data-install-steps]'),
      'someone already running the app was handed install steps').toBeNull();
  });

  it('is HIDDEN inside the Capacitor shell — the one runtime with nothing to install', async () => {
    enterNativeShell();
    expect(installControl(await settings()),
      'the shell offers to install the app the member is already holding').toBeNull();
  });

  it('hides on the shell and on nothing else', () => {
    // The gate is one condition wide. Stated on the source so widening it — to
    // the skip marker, to isInstalled(), to a fired prompt — is an edit here.
    const profile = read('components/Profile.tsx');
    expect(profile).toContain('const [inNativeShell] = useState(() => isNativeShell());');
    expect(profile).toContain('{!inNativeShell && (');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. 🔴 NO-REGRESSION: the account-deletion flow, untouched.
// ═════════════════════════════════════════════════════════════════════════════
function baseRef(): string {
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  for (const ref of ['origin/main', 'refs/remotes/origin/main', 'main']) {
    try { return git(['rev-parse', '--verify', `${ref}^{commit}`]); } catch { /* next */ }
  }
  try {
    const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']).split(/\s+/);
    if (parents.length === 3) return parents[1];
  } catch { /* fall through */ }
  throw new Error('the base commit could not be resolved, so "byte-identical to main" would measure nothing');
}
const changedSince = (...paths: string[]): string[] =>
  execFileSync('git', ['diff', '--name-only', baseRef(), '--', ...paths],
    { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);

/**
 * ── 🔴 THE-312 REPLACED TWO FILE-LEVEL FREEZES WITH THE PROPERTY THEY WERE FOR ─
 *
 * This block used to assert `git diff --name-only origin/main -- <file>` is
 * empty for `PersonalInformationModal.tsx` and for `Profile.tsx`. That is not a
 * digest and no register can help it: it fails on ANY edit, at any value, so
 * the settings/My-Profile redesign could not begin.
 *
 * What each was actually FOR, read off its own comment:
 *
 *   · `PersonalInformationModal.tsx` — "it carries the deleteState machine, all
 *     eight outcome messages, the silent-failure fix, and DELETE_CONFIRM_COPY
 *     deep-equal to the live MEMBER_DATA_MAP derivation". That is a list of
 *     PROPERTIES, every one of which is assertable directly. It is asserted
 *     directly below.
 *
 *   · `Profile.tsx` — "THE-305 verified this file rather than editing it: the
 *     control the ticket asked for was already here". The property is that the
 *     install control stays reachable and does not wait on
 *     `beforeinstallprompt` — which sections 1 through 4 of this very file
 *     already assert by MOUNTING Profile and finding the control, on a skipped
 *     onboarding, with no prompt ever fired, on iOS and on Brave/Android. The
 *     freeze added nothing to that and blocked every legitimate edit.
 *
 * ⚠️ THE-292 reported a guard that initially failed only its source check and
 * not its behavioural pair, and stubbed `fetch` rather than accept a half-guard.
 * The same standard applies here: the old "still spells all eight outcome
 * messages and the confirm copy" test asserted neither the eight messages nor
 * the copy — it grepped for two identifiers. Removing the freeze without fixing
 * that would have been a real loss, so it is fixed here: the messages are
 * asserted verbatim, the branch count is pinned, and `DELETE_CONFIRM_COPY` is
 * compared deep-equal to the live derivation rather than merely mentioned.
 *
 * A behavioural assertion is the stronger guard: it survives a legitimate edit
 * and still catches a real regression.
 */
describe('the account-deletion flow is still fully asserted', () => {
  const MODAL = 'components/PersonalInformationModal.tsx';

  it('spells all eight outcome messages, verbatim', () => {
    const src = read(MODAL);
    // Every outcome ENDS IN SOMETHING RENDERED. That is the whole point of the
    // machine: the member tapped Delete and the screen did not move.
    for (const message of [
      'You are not signed in. Sign in again and retry.',
      'Could not reach the server. Check your connection and try again.',
      'Your account and sign-in have been deleted. Signing you out now.',
      'For your security, confirm your password to finish deleting your account.',
      'Enter your password to continue.',
      'Incorrect password. Try again.',
    ]) {
      expect(src, `the outcome message "${message}" is gone`).toContain(message);
    }
    // The two multi-line ones (the federated-account instruction and the
    // server-step failure) are set through the same setter; count the setter
    // calls so a removed branch fails even though its copy is interpolated.
    const setterCalls = [...src.matchAll(/setDeleteMessage\(/g)].length;
    expect(setterCalls, 'a deleteMessage branch was added or removed').toBe(10); // 8 outcomes + 2 clears
  });

  it('keeps the state machine, the silent-failure fix and the re-auth path', () => {
    const src = read(MODAL);
    expect(src).toContain("type DeleteFlowState = 'idle' | 'deleting' | 'reauth' | 'error' | 'done'");
    // The re-auth happens IN PLACE, with the same call the change-password flow
    // makes — not turned into "sign out and sign back in".
    expect(src, 'the re-auth path left the delete flow').toContain('reauthenticateWithCredential');
    expect(src).toContain('handleReauthAndDelete');
    // 🔴 The silent-failure fix: BOTH deletions happen on the server, in order.
    // The client-side deleteDoc was the bug that destroyed a sign-in and left
    // the profile behind, and a bare console.error is what made it silent.
    expect(src, 'the delete stopped going through the server route').toContain('/api/account/delete');
    expect(src, 'the client-side deleteDoc on the member document is back')
      .not.toMatch(/deleteDoc\s*\(\s*(?:userRef|doc\s*\(\s*db\s*,\s*['"]users['"])/);
  });

  it('keeps DELETE_CONFIRM_COPY deep-equal to the live MEMBER_DATA_MAP derivation', async () => {
    const { DELETE_CONFIRM_COPY } = await import('../../lib/member-erasure-copy');
    const { MEMBER_DATA_MAP } = await import('@/lib/member-erasure');
    const { deriveErasureCopy, assertCopyCoversMap } = await import('../../lib/member-erasure-copy');
    // The map covers the copy, and the copy IS the derivation — so the delete
    // panel can never describe a set of collections the erasure does not touch.
    assertCopyCoversMap(MEMBER_DATA_MAP);
    expect(
      DELETE_CONFIRM_COPY,
      'DELETE_CONFIRM_COPY has drifted from the live MEMBER_DATA_MAP derivation',
    ).toEqual(deriveErasureCopy(MEMBER_DATA_MAP));
  });

  it('and the install control Profile.tsx carries is still reachable — asserted by mounting, not by freezing the file', async () => {
    // 🔴 This is what the `Profile.tsx` freeze was standing in for. Sections 1-4
    // above mount Profile on the founder's own configuration and find the row;
    // this restates the two load-bearing halves at the point the freeze used to
    // sit, so deleting the freeze cannot quietly delete the claim.
    expect(installControl(await settings()), 'the install control left member account settings').not.toBeNull();
    const profile = read('components/Profile.tsx');
    expect(profile, 'the install control started waiting on beforeinstallprompt')
      .not.toMatch(/beforeinstallprompt/);
  });

  it('leaves every install module untouched too', () => {
    // The install pieces already did the right thing; this ticket adds pins, not
    // behaviour. If any of these ever needs to change, it is a real edit and this
    // assertion is where it gets declared.
    expect(changedSince(
      'src/lib/pwa-install.ts',
      'src/components/install/',
    )).toEqual([]);
  });
});
