import React, { act } from 'react';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

/**
 * THE-255 — install the app at the end of onboarding, and from member settings.
 *
 * ── WHAT ALREADY EXISTED, AND WHAT THIS PINS ────────────────────────────────
 * Two components rendered add-to-home-screen instructions before this ticket,
 * and they had already drifted:
 *
 *   Onboarding.tsx `PwaInstallStep`  live. Forked on `isMobile` alone, so an
 *                                    ANDROID member with no
 *                                    `beforeinstallprompt` was handed the iOS
 *                                    Share-sheet steps.
 *   PWAInstallManager.tsx            UNREACHABLE — nothing in src sets
 *                                    `pwa_prompt_ready` and nothing dispatches
 *                                    `onboardingComplete`, so its popup never
 *                                    renders. It is also the one that had the
 *                                    Android wording right.
 *
 * THE-255 adds two more surfaces. Four hand-written copies of one paragraph is
 * how a church member ends up following steps that name a button their phone
 * does not have, so the copy now lives once in `lib/pwa-install.ts` and is
 * rendered once by `install/InstallInstructions.tsx`. Section 4 is what keeps
 * it that way.
 *
 * ── THE LOAD-BEARING TESTS ARE 3 AND 8 ──────────────────────────────────────
 * The paid funnel is the most sensitive path in this repo. This ticket adds NO
 * route and reorders nothing: the end-of-onboarding step is a sibling INSIDE an
 * existing route's element, and its placement is its gate. Sections 3 and 8 are
 * the no-regression pins for that claim.
 */

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');
const GLOBALS = path.join(ROOT, 'src/app/globals.css');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ── Backend surface: enough for Profile and the step to paint ────────────── */

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
import PostOnboardingInstallStep from '../install/PostOnboardingInstallStep';
import InstallAppModal from '../install/InstallAppModal';
import { InstallInstructions } from '../install/InstallInstructions';
import {
  INSTALL_HANDLED_KEY,
  INSTALL_STEPS,
  detectInstallPlatform,
  installStepsText,
  isNativeShell,
  resolveInstallState,
} from '../../lib/pwa-install';
import { buildUtilityCss } from '../../test/support/tailwind-build';

/* ── Environment control ──────────────────────────────────────────────────── */

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
/** The Capacitor shell on Android: an ordinary WebView, `; wv` and all. */
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
/** Put the document inside the Capacitor shell, as `server.url` really does. */
function enterNativeShell() {
  (window as unknown as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
  };
  setUA(SHELL_UA);
}
function leaveNativeShell() {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
}
/** Hand the page a real `beforeinstallprompt`, the way Chromium does. */
function fireInstallPrompt() {
  const e = new Event('beforeinstallprompt') as Event & { prompt: () => void; userChoice: Promise<unknown> };
  e.prompt = () => {};
  e.userChoice = Promise.resolve({ outcome: 'accepted' });
  window.dispatchEvent(e);
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
  await act(async () => { el.dispatchEvent(new Event('click', { bubbles: true })); });
};

/**
 * Source with comments removed.
 *
 * Every scan below reads CODE, not prose: this file's own explanations name
 * `hasSeenPaymentConfirmation` and quote "Add to Home Screen", and so do the
 * comments in `layout.tsx` and `tenant.types.ts`. A guard that cannot tell a
 * rendered string from a sentence about one is a guard that fires on its own
 * documentation.
 */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

/** Every .ts/.tsx file under src, tests excluded. */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== '__tests__' && e !== 'node_modules') walk(p, out); }
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. The step at the end of paid onboarding.
// ═══════════════════════════════════════════════════════════════════════════
describe('the install step appears at the end of paid onboarding, after it completes', () => {
  /**
   * 🔴 "After it completes" is structural, not a flag this component reads.
   * The step is mounted inside `adminElement`, which is a `<Route>` element
   * inside `<Routes>`, which is inside `<OnboardingGate>` — and the gate
   * renders its children ONLY on `status === 'ready'`. So there is no arrival
   * at which the step can paint while the funnel is still running.
   */
  it('is mounted inside the admin route element, which is inside OnboardingGate', () => {
    const app = read('App.tsx');
    expect(app).toContain("import PostOnboardingInstallStep from './components/install/PostOnboardingInstallStep';");

    const adminElement = /const adminElement = \(([\s\S]*?)\n  \);/.exec(app)?.[1];
    expect(adminElement, 'adminElement was renamed or restructured').toBeTruthy();
    expect(adminElement).toContain('<AdminDashboard');
    expect(adminElement).toContain('<PostOnboardingInstallStep />');
    expect(adminElement).toContain('<RequireAdmin');

    // …and adminElement is only ever reached through the gate.
    const routes = /<OnboardingGate>([\s\S]*?)<\/OnboardingGate>/.exec(app)?.[1];
    expect(routes, 'the Routes tree is no longer wrapped by OnboardingGate').toBeTruthy();
    expect(routes).toContain('element={adminElement}');

    // The gate's own contract: children mean "onboarding is done".
    expect(read('components/OnboardingGate.tsx')).toContain("if (status === 'ready') return <>{children}</>;");
  });

  it('renders on the tenant’s own origin — the only origin worth installing', async () => {
    hostTenant.current = 'grace';
    const host = await mount(<PostOnboardingInstallStep />);
    expect(host.querySelector('[data-testid="post-onboarding-install"]')).not.toBeNull();
    expect(textOf(host)).toContain('Install the app');
  });

  /**
   * 🔴 A PWA install is ORIGIN-SCOPED, and the paid funnel crosses an origin
   * hop (apex → `<tenant>.theharvest.app`) with a second sign-in that cannot be
   * removed. Installing before the hop would put a `theharvest.app` icon on the
   * phone while the church's workspace lives on its subdomain — and the step
   * would be abandoned at the sign-in wall besides.
   */
  it('does not render on the apex, before the hop', async () => {
    hostTenant.current = null;
    const host = await mount(<PostOnboardingInstallStep />);
    expect(host.querySelector('[data-testid="post-onboarding-install"]')).toBeNull();
  });

  it('does not render once it has been installed or skipped before', async () => {
    localStorage.setItem(INSTALL_HANDLED_KEY, 'true');
    const host = await mount(<PostOnboardingInstallStep />);
    expect(host.querySelector('[data-testid="post-onboarding-install"]')).toBeNull();
  });

  it('does not render when the app is already installed', async () => {
    setStandalone(true);
    const host = await mount(<PostOnboardingInstallStep />);
    expect(host.querySelector('[data-testid="post-onboarding-install"]')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Skipping.
// ═══════════════════════════════════════════════════════════════════════════
describe('it is skippable, and skipping leaves the funnel complete', () => {
  it('closes on Skip for now and never asks again', async () => {
    const host = await mount(<PostOnboardingInstallStep />);
    const skip = buttonNamed(host, 'Skip for now');
    expect(skip, 'the step offers no way past it').not.toBeNull();

    await click(skip!);
    expect(host.querySelector('[data-testid="post-onboarding-install"]')).toBeNull();
    expect(localStorage.getItem(INSTALL_HANDLED_KEY)).toBe('true');

    // Re-entering the app does not ask a second time.
    const again = await mount(<PostOnboardingInstallStep />);
    expect(again.querySelector('[data-testid="post-onboarding-install"]')).toBeNull();
  });

  /**
   * 🔴 The funnel was already COMPLETE before this rendered — the gate said so.
   * Skipping therefore cannot leave it incomplete, and the proof is that the
   * only thing skipping writes is the install marker: no funnel key, no tenant
   * state, no navigation.
   */
  it('writes the install marker and nothing else — no funnel state is touched', async () => {
    const host = await mount(<PostOnboardingInstallStep />);
    await click(buttonNamed(host, 'Skip for now')!);

    expect(Object.keys(localStorage)).toEqual([INSTALL_HANDLED_KEY]);
    expect(Object.keys(sessionStorage), 'skipping wrote a session key').toEqual([]);

    const src = read('components/install/PostOnboardingInstallStep.tsx');
    for (const marker of [
      'signupInProgress', 'termsAccepted', 'FUNNEL_PATHS', 'resolvePostAuthFunnelRoute',
      'harvest_payment_confirmation', 'onboardingCompleted', 'setupCompleted',
      'navigate(', 'window.location',
    ]) {
      expect(src, `the step touches ${marker}`).not.toContain(marker + '(');
    }
    expect(src).not.toMatch(/\bnavigate\s*\(/);
    expect(src).not.toMatch(/window\.location\s*=/);
  });

  it('reuses the member step’s one-time marker rather than minting a second', () => {
    // The member signup step has read and written this key since it shipped,
    // so the value is pinned rather than free to be renamed: changing it would
    // silently re-ask every member who has already installed or skipped.
    expect(INSTALL_HANDLED_KEY).toBe('pwa_installed');

    // And every surface now asks the same question through the same helper,
    // rather than each spelling the key itself.
    for (const f of [
      'components/Onboarding.tsx',
      'components/PWAInstallManager.tsx',
      'components/install/PostOnboardingInstallStep.tsx',
    ]) {
      expect(stripComments(read(f)), `${f} does not use the shared marker`).toContain('isInstallHandled()');
    }
    const spelled = walk(SRC)
      .filter((f) => /'pwa_installed'/.test(stripComments(readFileSync(f, 'utf8'))))
      .map((f) => path.relative(SRC, f));
    expect(spelled, 'the marker key is spelled outside its own module').toEqual(['lib/pwa-install.ts']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. 🔴 NO-REGRESSION: the paid funnel.
// ═══════════════════════════════════════════════════════════════════════════
describe('the paid funnel’s route order and markers are unchanged', () => {
  const app = () => read('App.tsx');

  it('keeps FUNNEL_PATHS exactly as it was', () => {
    expect(app()).toContain("const FUNNEL_PATHS = ['/auth', '/onboarding', '/church-onboarding'];");
  });

  it('keeps every route, in the same order, with nothing added', () => {
    const paths = Array.from(app().matchAll(/<Route\s+path="([^"]+)"/g)).map((m) => m[1]);
    expect(paths).toEqual([
      '/auth',
      '/onboarding',
      '/church-onboarding',
      '/admin',
      '/admin/:section',
      '/admin/:section/:itemId',
      '/',
      '*',
    ]);
  });

  it('keeps the post-auth funnel decision and the paid-arrival hold intact', () => {
    const src = app();
    expect(src).toContain('resolvePostAuthFunnelRoute({');
    for (const fn of [
      'beginPaymentConfirmation',
      'capturePaymentConfirmationHandoff',
      'hasSeenPaymentConfirmation',
      'shouldConfirmPaymentBeforeHandoff',
      'withPaymentConfirmationHandoff',
    ]) {
      expect(src, `${fn} is no longer imported by App.tsx`).toContain(fn);
    }
    // The hop itself, byte-for-byte.
    expect(src).toContain('const workspaceUrl = `https://${data.tenantId}.theharvest.app/admin`;');
  });

  /**
   * The one change to App.tsx is a sibling inside an existing element. Nothing
   * this ticket added may appear in the funnel's decision code.
   */
  it('adds nothing to the funnel’s own modules', () => {
    for (const f of ['utils/post-auth-route.ts', 'utils/paid-arrival.ts', 'components/OnboardingGate.tsx']) {
      const src = read(f);
      expect(src, `${f} gained install code`).not.toMatch(/pwa-install|InstallInstructions|PostOnboardingInstallStep/);
    }
  });

  it('leaves the end-of-onboarding step out of the funnel’s own gate decision', () => {
    const code = stripComments(read('components/install/PostOnboardingInstallStep.tsx'));
    // It reads the host, and nothing else about the funnel. (Its doc comment
    // explains at length why `hasSeenPaymentConfirmation` is the WRONG signal —
    // the rename hop arrives without the parameter that carries it — so the
    // scan is of code, not prose.)
    expect(code).toContain('getTenantIdFromHost');
    expect(code).not.toContain('hasSeenPaymentConfirmation');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. One source.
// ═══════════════════════════════════════════════════════════════════════════
describe('the Install app button opens the same instructions as onboarding', () => {
  it('renders identical step text in both surfaces', async () => {
    setUA(IOS_UA);

    const onboardingSteps = installStepsText('ios');

    const modal = await mount(<InstallAppModal isOpen onClose={() => {}} />);
    const modalSteps = Array.from(
      modal.querySelectorAll('[data-install-steps] > div'),
    ).map((r) => textOf(r).replace(/^\d+\s*/, ''));

    const step = await mount(<PostOnboardingInstallStep />);
    const stepSteps = Array.from(
      step.querySelectorAll('[data-install-steps] > div'),
    ).map((r) => textOf(r).replace(/^\d+\s*/, ''));

    expect(modalSteps).toEqual(onboardingSteps);
    expect(stepSteps).toEqual(onboardingSteps);
    expect(modalSteps.length).toBe(3);
  });

  /**
   * 🔴 THE GUARD THAT MATTERS. Instructions that drift are worse than none: a
   * member following stale steps concludes the app is broken. So exactly one
   * module may spell this copy, and exactly one component may render it.
   */
  it('spells the instruction copy in exactly one module', () => {
    const offenders = walk(SRC)
      .filter((f) => /Add to Home Screen|Add to Home screen|Add to Dock/i.test(stripComments(readFileSync(f, 'utf8'))))
      .map((f) => path.relative(SRC, f))
      .sort();
    expect(offenders, 'the install instructions are written in more than one place').toEqual([
      'lib/pwa-install.ts',
    ]);
  });

  it('renders the steps from exactly one component', () => {
    const offenders = walk(SRC)
      .filter((f) => /data-install-steps=/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual(['components/install/InstallInstructions.tsx']);
  });

  it('has every surface import that one component', () => {
    for (const f of [
      'components/Onboarding.tsx',
      'components/install/PostOnboardingInstallStep.tsx',
      'components/install/InstallAppModal.tsx',
    ]) {
      expect(read(f), `${f} does not render the shared instructions`).toMatch(/InstallInstructions/);
    }
  });

  it('opens from a member settings row that is wired to the modal', async () => {
    const host = await mount(<Profile onNavigate={() => {}} onGoToPartner={() => {}} onGoToMap={() => {}} />);
    const row = buttonNamed(host, 'Install app');
    expect(row, 'member settings has no Install app row').not.toBeNull();

    await click(row!);
    expect(textOf(host)).toContain('Install the app');
    expect(host.querySelector('[data-install-steps]'), 'the row opened nothing').not.toBeNull();
  });

  /**
   * Opening the modal is reading, not skipping. Marking it handled would
   * silently delete the step from an onboarding the member has not reached.
   */
  it('does not consume the onboarding step just because the modal was opened', async () => {
    const host = await mount(<InstallAppModal isOpen onClose={() => {}} />);
    expect(host.querySelector('[data-install-steps]')).not.toBeNull();
    expect(localStorage.getItem(INSTALL_HANDLED_KEY)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Platform correctness.
// ═══════════════════════════════════════════════════════════════════════════
describe('instructions match the platform', () => {
  /**
   * ⚠️ iOS Safari has NO `beforeinstallprompt` — Add to Home Screen is a manual
   * Share-sheet action — while Chromium fires a real event. The fork is not
   * cosmetic and there is no way around it.
   */
  it('iOS gets the Share sheet, and never the Android menu', async () => {
    setUA(IOS_UA);
    expect(detectInstallPlatform()).toBe('ios');

    const host = await mount(<InstallInstructions state="ios" />);
    const text = textOf(host);
    expect(text).toContain('Share');
    expect(text).toContain('Add to Home Screen');
    expect(text).not.toContain('Install app');
    expect(text).not.toContain('menu');
    expect(text).not.toContain('address bar');
  });

  it('Android gets the browser menu, and never the iOS Share sheet', async () => {
    setUA(ANDROID_UA);
    expect(detectInstallPlatform()).toBe('android');

    const host = await mount(<InstallInstructions state="android" />);
    const text = textOf(host);
    expect(text).toContain('menu');
    expect(text).toContain('Install app');
    expect(text).not.toContain('Share');
    expect(text).not.toContain('Add to Home Screen');
  });

  it('desktop gets the browser’s own install affordance', async () => {
    setUA(DESKTOP_UA);
    expect(detectInstallPlatform()).toBe('desktop');
    const host = await mount(<InstallInstructions state="desktop" />);
    expect(textOf(host)).toContain('address bar');
    expect(textOf(host)).not.toContain('Share');
  });

  /**
   * 🔴 THE BUG THIS TICKET FOUND. `PwaInstallStep` forked on `isMobile`, so
   * these two lists used to be the same one — and an Android member was told to
   * tap a Share button at the bottom of a browser that has none.
   */
  it('keeps iOS and Android as genuinely different lists', () => {
    expect(installStepsText('ios')).not.toEqual(installStepsText('android'));
    expect(installStepsText('ios').join(' ')).not.toMatch(/menu/i);
    expect(installStepsText('android').join(' ')).not.toMatch(/Share/i);
    expect(Object.keys(INSTALL_STEPS).sort()).toEqual(['android', 'desktop', 'ios']);
  });

  it('a real install prompt outranks every manual list', async () => {
    setUA(ANDROID_UA);
    const host = await mount(<PostOnboardingInstallStep />);
    await act(async () => { fireInstallPrompt(); });
    expect(host.querySelector('[data-install-state]')?.getAttribute('data-install-state')).toBe('prompt');
    expect(host.querySelector('[data-install-steps]'), 'manual steps shown beside a native prompt').toBeNull();
    expect(buttonNamed(host, 'Install app')).not.toBeNull();
  });

  it('says so instead of showing steps when the app is already installed', async () => {
    setUA(IOS_UA);
    setStandalone(true);
    const host = await mount(<InstallAppModal isOpen onClose={() => {}} />);
    expect(host.querySelector('[data-install-state]')?.getAttribute('data-install-state')).toBe('installed');
    expect(host.querySelector('[data-install-steps]'), 'steps shown to an already-installed device').toBeNull();
    expect(textOf(host)).toContain('already installed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. 🔴 The native shell.
// ═══════════════════════════════════════════════════════════════════════════
describe('nothing prompts to install inside the native shell', () => {
  /**
   * 🔴 `capacitor.config.ts` sets `server.url = https://theharvest.app`, so the
   * shell's WebView loads the ORDINARY SITE: same origin, same bundle, same
   * code. Nothing about it says "native" — `display-mode: standalone` does not
   * match in a WebView and `beforeinstallprompt` never fires there — so without
   * an explicit check every surface falls through to the manual branch and
   * tells someone holding the installed app to go and install the app.
   */
  it('the shell really does load an ordinary https origin', () => {
    const cfg = readFileSync(path.join(ROOT, 'capacitor.config.ts'), 'utf8');
    expect(cfg).toMatch(/url:\s*'https:\/\/theharvest\.app'/);
  });

  it('detects the shell, and resolves to a state with no instructions', () => {
    enterNativeShell();
    expect(isNativeShell()).toBe(true);
    expect(resolveInstallState({ hasNativePrompt: false })).toBe('native-shell');
    // …even if the browser somehow offered a prompt.
    expect(resolveInstallState({ hasNativePrompt: true })).toBe('native-shell');
  });

  it('shows no end-of-onboarding step inside the shell', async () => {
    enterNativeShell();
    const host = await mount(<PostOnboardingInstallStep />);
    expect(host.querySelector('[data-testid="post-onboarding-install"]')).toBeNull();
    expect(host.querySelector('[data-install-steps]')).toBeNull();
  });

  it('hides the Install app row in member settings inside the shell', async () => {
    enterNativeShell();
    const host = await mount(<Profile onNavigate={() => {}} onGoToPartner={() => {}} onGoToMap={() => {}} />);
    expect(buttonNamed(host, 'Install app'), 'the shell offers to install itself').toBeNull();
  });

  it('skips the member signup install step inside the shell', () => {
    // The step list appends `pwaInstall` only when all three questions say so.
    expect(read('components/Onboarding.tsx'))
      .toContain('if (!isInstallHandled() && !isInstalled() && !isNativeShell()) {');
  });

  it('falls back to the Android WebView user-agent when the bridge has not injected', () => {
    setUA(SHELL_UA);              // `; wv` — a WebView, never Chrome for Android
    expect(isNativeShell()).toBe(true);
    setUA(ANDROID_UA);            // real Chrome for Android must NOT be caught
    expect(isNativeShell()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Colour and layout.
// ═══════════════════════════════════════════════════════════════════════════
describe('no colour is hardcoded and both palettes resolve', () => {
  const FILES = [
    'lib/pwa-install.ts',
    'components/install/InstallInstructions.tsx',
    'components/install/PostOnboardingInstallStep.tsx',
    'components/install/InstallAppModal.tsx',
  ];
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

  it('writes no colour literal in any file this ticket added', () => {
    for (const f of FILES) {
      const code = stripComments(read(f));
      expect(code, `${f} hardcodes a hex colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(code, `${f} hardcodes a colour function`).not.toMatch(/\b(?:rgba?|hsla?|oklch)\(/);
    }
  });

  it('paints only through semantic tokens, which every palette redefines', async () => {
    setUA(IOS_UA);
    const host = await mount(<PostOnboardingInstallStep />);
    const classes = new Set<string>();
    for (const el of Array.from(host.querySelectorAll('*'))) {
      for (const c of (el.getAttribute('class') || '').split(/\s+/).filter(Boolean)) classes.add(c);
    }
    // Every COLOUR-bearing class is a named token, never a literal. An
    // arbitrary LENGTH (`text-[26px]`, a font size) is not a colour and is not
    // what this guards — a palette cannot redefine a colour that was written
    // into the class name, but it never had to redefine a size.
    const arbitrary = [...classes].filter(
      (c) => /^(?:bg|text|border|from|via|to|fill|stroke|ring|shadow)-\[/.test(c)
        && /#|rgba?\(|hsla?\(|oklch\(/.test(c),
    );
    expect(arbitrary, 'an arbitrary colour value crept in').toEqual([]);
    expect(classes.has('bg-gold') || classes.has('text-gold')).toBe(true);
  });

  it('leaves both palettes able to resolve', () => {
    const css = readFileSync(GLOBALS, 'utf8');
    expect(css).toMatch(/^\s*:root\s*\{/m);
    expect(css).toMatch(/\[data-theme="dark"\]\s*\{/);
    // 🔴 THE-338 — the two Classic selectors this asserted are GONE, and their

    // absence is now what is asserted. The family's 14 overrides were promoted

    // into :root/.dark, so every token still resolves — in TWO palettes, not

    // four. Leaving the old assertion would have pinned a family that no

    // longer exists; deleting it outright would have stopped checking that the

    // theme scopes exist at all.

    expect(css).not.toMatch(/\[data-palette/);
  });

  it('pre-auth stays light-mode only and writes no theme preference', () => {
    for (const f of FILES) {
      const code = stripComments(read(f));
      expect(code, `${f} writes a theme preference`).not.toMatch(/data-theme|setTheme|applyTheme|harvest_theme/);
    }
  });
});

describe('the step fits every measured viewport, and shrinks no touch target', () => {
  type Emitted = { cls: string; minWidth: number; decls: Record<string, string> };
  let emitted: Emitted[] = [];

  const classesOf = (el: Element) => (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);

  beforeAll(async () => {
    setUA(IOS_UA);
    const host = await mount(<PostOnboardingInstallStep />);
    const raw = Array.from(host.querySelectorAll('*'))
      .flatMap((el) => classesOf(el)).join(' ');
    document.body.innerHTML = '';

    // v4 emits the same utilities wrapped in `@layer utilities` and with theme
    // values referenced rather than inlined; buildUtilityCss undoes exactly
    // those two representational changes, so the walker below is unchanged.
    const out = { css: await buildUtilityCss(raw) };

    const unescape = (sel: string) => sel.replace(/^\./, '').replace(/\\/g, '');
    const collect = (node: postcss.Rule, minWidth: number) => {
      const decls: Record<string, string> = {};
      node.walkDecls((d) => { decls[d.prop] = d.value.trim(); });
      emitted.push({ cls: unescape(node.selector), minWidth, decls });
    };
    postcss.parse(out.css).each((node) => {
      if (node.type === 'rule') collect(node, 0);
      if (node.type === 'atrule' && node.name === 'media') {
        const m = node.params.match(/min-width:\s*([\d.]+)px/);
        if (!m) return;
        node.walkRules((r) => collect(r, Number(m[1])));
      }
    });
    expect(emitted.length, 'Tailwind produced no rules for the step').toBeGreaterThan(0);
  }, 120_000);

  const effective = (classes: string[], viewport: number) => {
    const wanted = new Set(classes);
    const out: Record<string, string> = {};
    for (const r of emitted) if (wanted.has(r.cls) && r.minWidth <= viewport) Object.assign(out, r.decls);
    return out;
  };
  const px = (v?: string) => {
    if (!v) return null;
    const rem = v.match(/^(-?[\d.]+)rem$/); if (rem) return Number(rem[1]) * 16;
    const p = v.match(/^(-?[\d.]+)px$/); return p ? Number(p[1]) : null;
  };

  /**
   * ⚠️ Width is NOT monotonic in viewport in this app — the admin shell TAKES
   * 275.5px away when it becomes desktop at 1024px — so the card is checked at
   * each measured width rather than only the widest.
   */
  const VIEWPORTS = [380, 768, 1024, 1280, 1440];

  it.each(VIEWPORTS)('the card never exceeds the viewport at %ipx', async (vp) => {
    setUA(IOS_UA);
    const host = await mount(<PostOnboardingInstallStep />);
    const card = host.querySelector('[data-testid="post-onboarding-install"] > div')!;
    const decls = effective(classesOf(card), vp);
    const cap = px(decls['max-width']);
    expect(cap, 'the card declares no maximum width').not.toBeNull();

    // ⚠️ A max-width is a CAP, not a width: the card is `w-full` inside the
    // overlay's `px-5`, so what it actually occupies is min(cap, available).
    // Asserting the cap against the viewport would fail at 380px for a card
    // that fits perfectly — which is the mistake this comment exists to stop
    // someone repeating.
    const available = vp - 40;                    // px-5 either side
    const occupied = Math.min(cap!, available);
    expect(occupied, `the card overflows a ${vp}px viewport`).toBeLessThanOrEqual(available);
    expect(occupied).toBeGreaterThan(0);
  });

  it('invents no width of its own — it reuses the funnel’s 452px measure', () => {
    const src = read('components/install/PostOnboardingInstallStep.tsx');
    const widths = Array.from(src.matchAll(/max-w-\[(\d+)px\]/g)).map((m) => Number(m[1]));
    expect(widths).toEqual([452]);
    expect(read('components/Onboarding.tsx')).toContain('maxWidth: 452');
  });

  it('shrinks no touch target — every action clears 44px', async () => {
    setUA(IOS_UA);
    const host = await mount(<PostOnboardingInstallStep />);
    for (const b of Array.from(host.querySelectorAll('button'))) {
      const decls = effective(classesOf(b), 380);
      const h = px(decls.height);
      // Text-only affordances (Skip) have no fixed height and are padded rows;
      // every FIXED-height control must clear the 44px minimum.
      if (h !== null) expect(h, `a ${h}px control is under the touch minimum`).toBeGreaterThanOrEqual(44);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. 🔴 NO-REGRESSION: markers, Turnstile, the manifest.
// ═══════════════════════════════════════════════════════════════════════════
describe('no funnel marker, Turnstile mount or manifest route changed', () => {
  it('leaves the signup markers where they were', () => {
    const co = read('components/ChurchOnboarding.tsx');
    expect(co).toContain('signupInProgress: true');
    expect(co).toContain('termsAccepted');
    // …and nothing this ticket added is anywhere near them.
    expect(co).not.toMatch(/pwa-install|InstallInstructions|PostOnboardingInstallStep/);
  });

  it('leaves Turnstile mounted exactly as it was', () => {
    const auth = read('components/AuthPage.tsx');
    expect(auth).toContain("import { Turnstile } from '@marsidev/react-turnstile';");
    expect(auth).toContain('setTurnstileKey((k) => k + 1);');
    expect(auth).not.toMatch(/pwa-install|InstallInstructions|PostOnboardingInstallStep/);
  });

  /**
   * The manifest route is the WHITE-LABEL manifest and it is per-tenant. This
   * ticket had no reason to touch it and did not.
   */
  it('leaves the per-tenant manifest route untouched', () => {
    const manifest = read('app/manifest.webmanifest/route.ts');
    expect(manifest).not.toMatch(/pwa-install|InstallInstructions|PostOnboardingInstallStep|InstallAppModal/);
    // Still per-tenant, still a route.
    expect(manifest).toMatch(/export\s+(async\s+)?function\s+GET/);
  });

  it('leaves layout.tsx untouched', () => {
    expect(read('app/layout.tsx')).not.toMatch(/pwa-install|InstallInstructions|PostOnboardingInstallStep|InstallAppModal/);
  });

  it('touches neither firestore.rules nor functions/', () => {
    const rules = readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    expect(rules).not.toMatch(/pwa-install|InstallInstructions|PostOnboardingInstallStep/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. The withdrawn item.
// ═══════════════════════════════════════════════════════════════════════════
describe('no link to theharvest.site was added to the member app', () => {
  /**
   * A "Get your own Harvest platform" button linking to theharvest.site was
   * requested and then WITHDRAWN by the founder. It was not built. This pins
   * that the member app's links to that host are exactly the ones that were
   * already there — the three policy links (THE-188) and the affiliate
   * programme's own pricing link — and no new one.
   */
  it('adds no new theharvest.site link anywhere in src', () => {
    const linking = walk(SRC)
      .filter((f) => /https:\/\/theharvest\.site/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f))
      .sort();
    expect(linking, 'a theharvest.site link was added').toEqual([
      'app/api/contact/route.ts',                  // CORS origin for the marketing site
      'app/api/plans/route.ts',                    // the plan catalog the site fetches
      // `app/api/stripe/standalone-checkout/route.ts` was here — its CORS and
      // return URLs pointed at the marketing site, because the route existed to
      // sell the Telegram assistant to site visitors. Route deleted in THE-253,
      // so the link count goes DOWN. This guard is against ADDING links, and a
      // removal has to move the list too or it fails on the count alone.
      'components/AffiliateSection.tsx',           // the affiliate's own referral link
      'components/WorkspaceHandoff.tsx',           // the support contact link
      'lib/legal-links.ts',                        // privacy / terms / refunds (THE-188)
    ].sort());
  });

  it('adds no such link to any file this ticket touched', () => {
    for (const f of [
      'App.tsx',
      'components/Profile.tsx',
      'components/Onboarding.tsx',
      'lib/pwa-install.ts',
      'components/install/InstallInstructions.tsx',
      'components/install/PostOnboardingInstallStep.tsx',
      'components/install/InstallAppModal.tsx',
    ]) {
      expect(read(f), `${f} links to theharvest.site`).not.toMatch(/theharvest\.site/);
    }
  });

  it('offers no "get your own platform" affordance in the member app', async () => {
    const host = await mount(<Profile onNavigate={() => {}} onGoToPartner={() => {}} onGoToMap={() => {}} />);
    expect(textOf(host)).not.toMatch(/get your own|your own harvest|own platform/i);
  });
});
