/**
 * THE-255 — the ONE answer to "how does this device install Harvest?".
 *
 * 🔴 WHY THIS MODULE EXISTS. Before it, the add-to-home-screen instructions
 * were written twice, in two components that had already drifted apart:
 *
 *   Onboarding.tsx `PwaInstallStep`  — the live one. Splits mobile/desktop, and
 *                                      gives an ANDROID user the iOS Share-sheet
 *                                      steps, because its only fork is
 *                                      `isMobile`.
 *   PWAInstallManager.tsx            — unreachable (nothing sets
 *                                      `pwa_prompt_ready`, nothing dispatches
 *                                      `onboardingComplete`), and the one that
 *                                      had the Android wording RIGHT.
 *
 * That is the drift in its purest form: two copies of the same paragraph, each
 * correct about something the other is wrong about. THE-255 adds two more
 * surfaces (the end of the paid onboarding flow, and an Install app button in
 * member settings), which would have made four. So the copy, the platform fork
 * and the "can this device even install?" question all live here, once, and
 * every surface renders `InstallInstructions` over this data.
 *
 * ⚠️ THE PLATFORM FORK IS NOT COSMETIC AND CANNOT BE AVOIDED. iOS Safari has no
 * `beforeinstallprompt` at all — Add to Home Screen is a manual Share-sheet
 * action — while Chromium (Android AND desktop Chrome/Edge) fires a real event
 * and can install in one tap. A church member handed the wrong platform's steps
 * follows them, finds no such button, and concludes the app is broken. Wrong
 * steps are worse than no steps.
 */

/** The three sets of manual instructions that actually differ. */
export type InstallPlatform = 'ios' | 'android' | 'desktop';

/**
 * What an install surface should say right now.
 *
 * The first two are the "say so rather than showing steps that will not work"
 * states; `prompt` is the one-tap path; the last three are the manual forks.
 */
export type InstallState =
  /** Inside the Capacitor shell — this IS the app. Never prompt. */
  | 'native-shell'
  /** Already running as an installed app (standalone display mode). */
  | 'installed'
  /** The browser handed us a real `beforeinstallprompt` — offer one tap. */
  | 'prompt'
  | 'ios'
  | 'android'
  | 'desktop';

/** The inline glyphs the copy below refers to by name. */
export type InstallIcon = 'share' | 'menu' | 'plus';

/** One piece of a step: prose, an emphasised control name, or an inline glyph. */
export type InstallSegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'strong'; readonly value: string }
  | { readonly kind: 'icon'; readonly value: InstallIcon };

const t = (value: string): InstallSegment => ({ kind: 'text', value });
const b = (value: string): InstallSegment => ({ kind: 'strong', value });
const i = (value: InstallIcon): InstallSegment => ({ kind: 'icon', value });

/**
 * The instructions themselves — the single source every surface renders.
 *
 * ⚠️ iOS and Android are DELIBERATELY different lists, not one "mobile" list.
 * That is the bug this module was extracted to fix: iOS installs from the
 * Share sheet at the bottom of Safari, Android from the ⋮ overflow menu, and
 * neither wording survives being shown to the other.
 */
export const INSTALL_STEPS: Record<InstallPlatform, readonly (readonly InstallSegment[])[]> = {
  ios: [
    [t('Tap the '), b('Share'), t(' button at the bottom of your browser '), i('share')],
    [t('Scroll down and tap '), b('Add to Home Screen'), t(' '), i('plus')],
    [t('Tap '), b('Add'), t(' — you’re done!')],
  ],
  android: [
    [t('Tap the menu '), i('menu'), t(' in your browser')],
    [t('Tap '), b('Install app'), t(' (or '), b('Add to Home screen'), t(')')],
    [t('Confirm — you’re done!')],
  ],
  desktop: [
    [t('Open the '), b('install icon'), t(' in your browser’s address bar (or the browser menu)')],
    [t('Choose '), b('Install Harvest'), t(' (or '), b('Add to Dock'), t(')')],
    [t('Confirm — Harvest opens like a native app')],
  ],
} as const;

/** The plain-text form of a platform's steps — what a test and a reader see. */
export function installStepsText(platform: InstallPlatform): string[] {
  return INSTALL_STEPS[platform].map((segments) =>
    segments
      .map((s) => (s.kind === 'icon' ? '' : s.value))
      .join('')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

/** The one-line promise above the steps, per state. */
export const INSTALL_BLURB: Record<InstallState, string> = {
  'native-shell': 'You’re already using the Harvest app.',
  installed: 'Harvest is already installed on this device — open it from your home screen.',
  prompt: 'Add Harvest to your device for one-tap access — it works like a native app, offline included.',
  ios: 'Add Harvest to your home screen for one-tap access — it works like a native app, offline included.',
  android: 'Add Harvest to your home screen for one-tap access — it works like a native app, offline included.',
  desktop: 'Install Harvest as a desktop app for one-tap access — it works like a native app, offline included.',
};

/**
 * Is this document running inside the Capacitor native shell?
 *
 * 🔴 WHY THIS IS NOT OPTIONAL. `capacitor.config.ts` sets
 * `server.url = https://theharvest.app`, so the shell's WebView loads the
 * ORDINARY HTTPS SITE — the same bundle, the same code, on a normal origin.
 * Nothing about that origin says "native": `display-mode: standalone` does not
 * match in a WebView, and `beforeinstallprompt` never fires there either. So
 * without this check the install surfaces fall straight through to the manual
 * branch and tell someone who is holding the installed app to go and install
 * the app. That reads as a bug, and it is one.
 *
 * Capacitor injects its bridge into the WebView on every load — including with
 * a remote `server.url`, which is how live-reload works — so `window.Capacitor`
 * is the primary and authoritative signal. Read off the global rather than
 * importing `@capacitor/core`, so this stays synchronous (it is consulted
 * during render) and adds nothing to the browser bundle; `useCapacitorPush`
 * imports the package dynamically for the same reason.
 *
 * The Android WebView user-agent token (`; wv`) is a secondary net for a shell
 * whose bridge has not injected yet on first paint. It is specific to a WebView
 * — Chrome for Android never carries it — so it cannot catch an ordinary
 * browser and wrongly hide the button from someone who could install.
 */
export function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor;
  try {
    if (typeof cap?.isNativePlatform === 'function') return !!cap.isNativePlatform();
    if (typeof cap?.getPlatform === 'function') return cap.getPlatform() !== 'web';
  } catch { /* fall through to the user-agent net */ }
  return typeof navigator !== 'undefined' && /;\s*wv\b/.test(navigator.userAgent);
}

/**
 * Is the app already installed and running as one?
 *
 * Both signals, because neither covers both platforms: `display-mode:
 * standalone` is the standard one and is what Chromium reports, while iOS
 * Safari answers only through the legacy `navigator.standalone`. Checking one
 * alone is how an iOS member who installed the app last week gets asked to
 * install it again.
 */
export function isInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)')?.matches) return true;
  } catch { /* matchMedia unavailable — fall through */ }
  return (navigator as unknown as { standalone?: boolean })?.standalone === true;
}

/** Which set of manual instructions this device needs. */
export function detectInstallPlatform(userAgent?: string): InstallPlatform {
  const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'desktop';
}

/**
 * The whole decision, in the order the states actually override one another.
 *
 * 🔴 ORDER IS THE POINT. `native-shell` outranks everything — inside the shell
 * there is nothing to install and no honest instruction to give. `installed`
 * comes next for the same reason. Only then does a real `beforeinstallprompt`
 * win over the manual steps, and only then does the platform fork decide which
 * manual steps those are.
 */
export function resolveInstallState(args: {
  hasNativePrompt: boolean;
  userAgent?: string;
}): InstallState {
  if (isNativeShell()) return 'native-shell';
  if (isInstalled()) return 'installed';
  if (args.hasNativePrompt) return 'prompt';
  return detectInstallPlatform(args.userAgent);
}

/** States that show manual steps (i.e. have a platform's list to render). */
export function stepsFor(state: InstallState): readonly (readonly InstallSegment[])[] | null {
  return state === 'ios' || state === 'android' || state === 'desktop' ? INSTALL_STEPS[state] : null;
}

/**
 * The one-time marker: the install step has been dealt with in this browser,
 * whether by installing or by skipping.
 *
 * ⚠️ ONE KEY, SHARED WITH THE MEMBER SIGNUP STEP ON PURPOSE. `Onboarding.tsx`
 * has written and read `pwa_installed` since the member step shipped; reusing
 * it means a member who skipped during signup is not asked again at the end of
 * onboarding, and vice versa. A second key would be a second answer to the same
 * question.
 *
 * localStorage rather than sessionStorage: "I already added it" is a fact about
 * the DEVICE, and it has to outlive the tab.
 */
export const INSTALL_HANDLED_KEY = 'pwa_installed';

/** Has this browser already installed or skipped? */
export function isInstallHandled(): boolean {
  try {
    return localStorage.getItem(INSTALL_HANDLED_KEY) === 'true';
  } catch {
    // Storage unavailable → treat as "not handled". The step is skippable, so
    // failing this way costs one dismissible screen; failing the other way
    // silently removes the feature.
    return false;
  }
}

/** Record that the install step has been dealt with. Never throws. */
export function markInstallHandled(): void {
  try { localStorage.setItem(INSTALL_HANDLED_KEY, 'true'); } catch { /* ignore */ }
}
