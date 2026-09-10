/**
 * THE-349 — what the auth screen says when sign-in fails, NAMED PER CAUSE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The lie this replaces ───────────────────────────────────────────────────
 *
 * Two fallbacks carried every unrecognised failure: "Unable to sign in. Please
 * try again." on the email path and "Failed to sign in with Google. Please try
 * again." on the Google one. Both invite a retry. For most of what actually
 * reaches them THE RETRY CANNOT SUCCEED — not once, not ever — because nothing
 * about pressing the button again changes the cause:
 *
 *   · `auth/account-exists-with-different-credential` — the address already
 *     has a password account. Every Google press will fail identically until
 *     the person signs in the way they signed UP. This is the exact shape the
 *     reported case took: Google first, "kicked out", then a password account
 *     made with the same address, after which Google collides with it forever.
 *   · `auth/unauthorized-domain` — the address is not on the Firebase
 *     authorised-domains list. A retry from the same address cannot pass.
 *   · `auth/operation-not-allowed` — the provider is switched off in the
 *     console.
 *   · `auth/invalid-credential` — v10 collapses wrong-password and
 *     user-not-found into one code, so THE MOST COMMON SIGN-IN FAILURE THERE IS
 *     fell through to "Unable to sign in. Please try again." and never once
 *     mentioned the password reset link sitting on the same screen.
 *   · `auth/user-disabled` — an administrator turned the account off.
 *
 * ⚠️ A generic "try again" on an error that will never succeed on retry is a
 * lie, and it is the Silent-Failure Rule wearing a message: the failure is
 * loud enough to see and useless enough to act on. Each branch below names the
 * cause AND the next step; the generic line survives only as the genuine
 * unknown, which is the one case where trying again is real advice.
 *
 * 🔴 STILL NO RAW FIREBASE WORDING. Every string here is written copy, for the
 * reason `AuthPage` has always mapped its codes: a library's sentence names a
 * Google Cloud project and an SDK method at somebody who came to join a
 * church. The code itself is not lost — `console.error` keeps it for whoever
 * debugs.
 */

/** The one honest retry, kept for a cause we genuinely do not recognise. */
export const GENERIC_SIGN_IN_MESSAGE = 'Unable to sign in. Please try again.';
export const GENERIC_SIGN_UP_MESSAGE = 'Unable to create your account. Please try again.';
export const GENERIC_GOOGLE_MESSAGE = 'Failed to sign in with Google. Please try again.';

/** Codes both paths answer the same way, so the two maps cannot drift apart. */
function sharedMessage(code: string): string | null {
  switch (code) {
    case 'auth/network-request-failed':
      return "We couldn’t reach the server. Check your connection and try again.";
    case 'auth/too-many-requests':
      return 'Too many attempts from this device. Wait a few minutes before trying again, or use '
        + '“Forgot your password?” below to set a new password.';
    case 'auth/user-disabled':
      return 'This account has been turned off. Ask whoever administers your ministry to turn it '
        + 'back on — signing in again will not change it.';
    default:
      return null;
  }
}

/**
 * The message for a failed Google sign-in.
 *
 * 🔴 `auth/account-exists-with-different-credential` is the one this ticket was
 * written for, and it is the one branch that must never say "try again": the
 * person's account exists, it just does not open with this key.
 */
export function googleAuthFailureMessage(code: string): string {
  const shared = sharedMessage(code);
  if (shared) return shared;
  switch (code) {
    case 'auth/account-exists-with-different-credential':
      return 'You already have an account with this email address, created with a password. Sign '
        + 'in with your email and password below — pressing Google again will fail the same way '
        + 'every time, because the address is already spoken for.';
    case 'auth/popup-closed-by-user':
      return 'Sign-in was cancelled.';
    case 'auth/cancelled-popup-request':
      return 'Another sign-in window was already open. Close it and press the button again.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in window. Allow pop-ups for this site and '
        + 'press the button again, or use your email and password below, which needs no pop-up.';
    case 'auth/unauthorized-domain':
      return 'Google sign-in is not switched on for this web address yet. Use your email and '
        + 'password below — that works here — and tell whoever runs this site, because a retry '
        + 'from this address cannot succeed until they add it.';
    case 'auth/operation-not-allowed':
      return 'Google sign-in is switched off for this site. Use your email and password below.';
    default:
      return GENERIC_GOOGLE_MESSAGE;
  }
}

/**
 * The message for a failed email/password attempt.
 *
 * `isLogin` only picks between the two generic tails; every named branch reads
 * the same on both, because the cause is the same on both.
 */
export function emailAuthFailureMessage(code: string, isLogin: boolean): string {
  const shared = sharedMessage(code);
  if (shared) return shared;
  switch (code) {
    case 'auth/operation-not-allowed':
      return 'Email/Password sign-in is not enabled. Please enable it in the Firebase Console.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      // 🔴 One message for three codes on purpose: v10 collapses them, and
      // telling a stranger WHICH half was wrong is an account-enumeration hint.
      return 'That email and password do not match an account. Check them both, or use “Forgot '
        + 'your password?” below to set a new one. If you first joined with the Google button '
        + 'above, sign in that way instead.';
    default:
      return isLogin ? GENERIC_SIGN_IN_MESSAGE : GENERIC_SIGN_UP_MESSAGE;
  }
}

/**
 * 🔴 THE ONE THAT NEVER PRODUCED A MESSAGE AT ALL — "it kicked him out".
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `signInWithPopup` CANNOT WORK inside an iPhone home-screen app, and it does
 * not fail either. `@firebase/auth`'s `_open()` reads
 *
 *     if (_isIOSStandalone(ua) && target !== '_self') {
 *       openAsNewWindowIOS(url || '', target);
 *       return new AuthPopup(null);
 *     }
 *
 * `openAsNewWindowIOS` clicks a synthetic `<a target="_blank">`, which on iOS
 * hands the URL to SAFARI — the person watches their app disappear — and the
 * returned `AuthPopup` carries NO window handle. `pollUserCancellation()` then
 * tests `this.authWindow?.window?.closed`, which is `undefined` forever, so
 * the promise NEVER settles: no result, no rejection, no error to map. The
 * button spins until the app is killed. That is the reported first symptom
 * exactly, and no `catch` in this repo could ever have caught it.
 *
 * ⚠️ AND THIS PRODUCT ASKS FOR PRECISELY THAT INSTALL. Onboarding runs a PWA
 * install step (`lib/pwa-install.ts`, `InstallInstructions`), so the iPhone
 * members most likely to press "Continue with Google" are the ones who did
 * what the app told them to do.
 *
 * So the screen refuses BEFORE calling the SDK and says what will work. No new
 * dependency: this is the same two facts `_isIOSStandalone` reads.
 */
export function isIOSHomeScreenApp(
  userAgent: string | null | undefined,
  standalone: boolean | undefined,
): boolean {
  if (standalone !== true) return false;
  return /iPad|iPhone|iPod/.test(userAgent ?? '');
}

/** The same question, for the browser this screen is running in. */
export function browserIsIOSHomeScreenApp(): boolean {
  if (typeof navigator === 'undefined') return false;
  return isIOSHomeScreenApp(
    navigator.userAgent,
    (navigator as unknown as { standalone?: boolean }).standalone,
  );
}

/**
 * What to tell someone whose home-screen app cannot open the Google window.
 * Names the address so they can act on it without knowing what a host is.
 */
export function homeScreenGoogleMessage(hostname: string): string {
  const where = hostname ? `${hostname} in Safari` : 'this site in Safari';
  return 'Google sign-in cannot open from an app on your Home Screen — iPhone hands it to Safari '
    + `and the app never hears back, which is why nothing happened. Open ${where} and press `
    + 'Continue with Google there, or use your email and password below, which works here.';
}
