"use client";
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db, messaging, VAPID_KEY } from '../firebase';
import { doc, updateDoc, setDoc, getDoc, arrayUnion } from 'firebase/firestore';
import { getToken } from 'firebase/messaging';
import CountrySelect from './CountrySelect';
import { useTenant } from '../contexts/TenantContext';
import { getTenantScope, isSuperAdmin } from '../utils/tenant-scope';
import {
  readAuthTenantFromBrowser,
  tenantIdToWrite,
  TENANT_UNRESOLVED_MESSAGE,
  type AuthTenantResolution,
} from '../utils/auth-tenant-resolution';
import { CheckCircle2, ArrowRight, ArrowLeft, MapPin, Bell, User, Phone } from 'lucide-react';
import type { TenantPlan } from '../types/tenant.types';
import { InstallHeading, InstallPanel, useInstallState } from './install/InstallInstructions';
import { isInstallHandled, isInstalled, isNativeShell, markInstallHandled } from '../lib/pwa-install';
import { handleFirestoreError, OperationType } from '../utils/firestore-errors';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const GOLD = 'var(--brand-color, #B8962E)';
const HARVEST_LOGO = 'https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png';

/* ── The member's own `users` document ──────────────────────────────────────── */

/**
 * 🔴 THE-349 — the code `saveFailureMessage` maps to the refusal below.
 *
 * A string rather than a subclass because that is what `saveFailureMessage`
 * already reads (`'code' in e`), so the refusal travels the path every other
 * Firestore rejection on this screen travels and needs no new plumbing.
 */
export const TENANT_UNRESOLVED_CODE = 'harvest/tenant-unresolved';

/**
 * 🔴 THE-349 — which ministry a document CREATED here belongs to, in three
 * answers rather than two.
 *
 * 🔴 `getTenantScope()` IS STILL THE RESOLVER AND STILL ASKED FIRST. This is
 * not a replacement for it — it reads the HOST first (the authority, not
 * spoofable by the client) and then the super-admin and own-document
 * fallbacks, and everything it can answer it still answers here, unchanged.
 *
 * What changes is what its NULL is taken to mean. A null from it is two
 * different facts wearing one value: "this account legitimately belongs to no
 * ministry" and "I could not work out which ministry this is". The host
 * classifier is asked ONLY to tell those apart — the apex, the
 * www/app/admin/affiliate aliases, a `*.vercel.app` preview and localhost are
 * `platform`, where null is the correct answer and is written; a host that
 * names no ministry is `unresolved`, which is written by nobody.
 *
 * ⚠️ ONE WORD IS MISSING FROM THIS NOTE ON PURPOSE, and it is the word for the
 * kind of host `unresolved` describes. THE-280 counts it to zero in this file
 * to prove the MEMBER funnel asks no such question, exactly as the note below
 * says of its own prose — see `utils/auth-tenant-resolution.ts`, which spends
 * that budget freely because nothing counts it there.
 *
 * ⚠️ A SUPER ADMIN ON SUCH A HOST IS `platform`, NOT `unresolved`. They
 * legitimately carry `tenantId: null` (`PLATFORM_TENANT_ID` is their write-side
 * fallback), and refusing them would be this ticket breaking the very thing its
 * non-negotiables name.
 */
export async function resolveCreateTenant(): Promise<AuthTenantResolution> {
  const scope = await getTenantScope();
  if (scope) {
    // Host slug, middleware cookie, or the member's own document — all three
    // are a named ministry, and getTenantScope prefers them in that order.
    return { kind: 'tenant', tenantId: scope, reason: 'signed-in-user' };
  }
  const fromHost = readAuthTenantFromBrowser();
  if (fromHost.kind === 'platform') return fromHost;
  if (isSuperAdmin()) return { kind: 'platform', reason: 'super-admin' };
  return { kind: 'unresolved', reason: fromHost.reason };
}

/**
 * 🔴 THE-336 — write onto the signed-in member's `users` document, CREATING it
 * when it is not there.
 *
 * ── The bug this exists for ─────────────────────────────────────────────────
 *
 * Both writes in this file used `updateDoc`, which REQUIRES the document to
 * exist and rejects with `not-found` when it does not. A member who reached
 * onboarding without one — see below for how — pressed Finish and got
 *
 *   No document to update: projects/…/databases/(default)/documents/users/<uid>
 *
 * rendered inside the card, with no way past it. The account could not be
 * created at all.
 *
 * ⚠️ THE MISSING DOCUMENT IS NOT THIS FILE'S DOING and papering over it here is
 * only the safety net. `AuthPage` is the creating writer, and every one of its
 * Firestore call sites ended in `handleFirestoreError(...)` followed by a bare
 * `return` — and `handleFirestoreError` LOGS AND RETURNS, it does not throw
 * (`src/utils/firestore-errors.ts`). A refused create therefore left a Firebase
 * Auth user with no `users` document, nothing on screen, and `set-claims` never
 * called. `App.tsx` then reads `userDoc.exists() === false` and routes to this
 * funnel. That silent `catch` is fixed in `AuthPage` by the same ticket; this
 * function is what stops the member being stranded when a write is refused for
 * some reason nobody has thought of yet.
 *
 * ── Why the created document carries more than the caller's fields ──────────
 *
 * 🔴 A HALF-CREATED ACCOUNT IS WORSE THAN A CLEAR FAILURE. A bare
 * `setDoc(ref, fields, { merge: true })` would create a document holding only
 * what onboarding writes — no `uid`, no `email`, no `createdAt`, no `role` and,
 * worst of all, no `tenantId`, which is the field that decides which ministry
 * the member belongs to. So the create carries the identity block `AuthPage`
 * writes on the same document, and the caller's fields land on top of it.
 *
 * ⚠️ `tenantId` comes from `resolveCreateTenant()`, which reads the HOST first
 * — the same authority `AuthPage` derives it from, and not spoofable by the
 * client. 🔴 THE-349 REPLACED `getTenantScope()` HERE, and the sentence that
 * stood in its place ("off a tenant host it resolves to null, exactly as
 * `AuthPage` does when the middleware cookie is absent") described the bug
 * rather than the behaviour: BOTH resolved a host that serves one ministry and
 * names none to null and then WROTE that null, and the cookie meant to name it
 * is set by nothing at all. Off a tenant host the answer is now `platform`
 * (null, correctly — the apex, the www/app/admin/affiliate aliases, a preview)
 * or `unresolved`, which is not written: the create throws and the member is
 * told.
 *
 * ⚠️ This note deliberately avoids one word: THE-280 counts it to zero in this
 * file to prove the MEMBER funnel asks no such question, and prose has no
 * business spending that budget.
 *
 * 🔴 NO `termsAccepted` AND NO `newsletter`, for the reason THE-73 already
 * recorded one screen over in `ChurchOnboarding`: this flow displays no terms,
 * no link and no checkbox, so it has no evidence of consent and could only
 * assume it. A consent record asserted by a screen that presented nothing is a
 * claim that did not happen. `AuthPage` is the consent point and stays the only
 * writer of both fields.
 *
 * 🔴 NO `plan`. The billing webhook is its single writer (#434) and nothing on
 * the client may write it. NO theme preference either — pre-auth is light-mode
 * only (THE-85).
 *
 * ⚠️ `country` is never defaulted here or anywhere on this path. It is passed
 * through in `fields` exactly as the caller holds it, because #429's invariant
 * `withCountry + countryUnrecorded === total` depends on there being no third
 * state: no `''` substituted for a missing value, no `'Unknown'`, no sentinel.
 *
 * ── Why the branch, rather than one merge ───────────────────────────────────
 *
 * The same shape `ChurchOnboarding` uses (THE-73), and for a second reason
 * here: `firestore.rules` evaluates a write to a MISSING document under `allow
 * create` and a write to an existing one under `allow update`, and the update
 * rule refuses a self-edit that touches `role` or `tenantId`. Sending the
 * identity block only on the create keeps the update a plain self-edit of the
 * member's own answers, which is what it has always been. No rule changes.
 *
 * ⚠️ `arrayUnion` is valid in both branches — it is a field transform, not an
 * update-only operator — so the notification-token write keeps working either
 * way.
 */
export async function writeUserDoc(
  user: { uid: string; email: string | null; displayName: string | null },
  fields: Record<string, unknown>,
): Promise<void> {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, fields);
    return;
  }
  /**
   * 🔴 THE-349 — was `const tenantId = await getTenantScope();` followed by
   * `tenantId: tenantId || null`. That `|| null` is the same operator, the
   * same lie and the same orphan as the two in `AuthPage`: on a host that
   * serves one ministry and names it nowhere, it recorded "belongs to no
   * church" as a fact rather than reporting that it did not know. A member
   * cannot repair it afterwards — `firestore.rules` refuses a self-edit whose
   * affected keys include `tenantId`, and refuses a tenant admin too — so the
   * moment to fail is now, loudly, before a document exists.
   *
   * ⚠️ The UPDATE branch above is untouched, and deliberately: it writes only
   * the member's own answers onto a document that already carries a tenant,
   * and THE-336's note explains why the two branches must stay apart.
   */
  const resolution = await resolveCreateTenant();
  if (resolution.kind === 'unresolved') {
    throw Object.assign(new Error(TENANT_UNRESOLVED_MESSAGE), { code: TENANT_UNRESOLVED_CODE });
  }
  await setDoc(ref, {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName || (user.email ? user.email.split('@')[0] : ''),
    createdAt: new Date().toISOString(),
    role: 'user',
    tenantId: tenantIdToWrite(resolution),
    ...fields,
  });
}

/**
 * 🔴 THE-336 — what to tell a member whose answers could not be saved.
 *
 * Every branch names a NEXT STEP. The screen this replaces rendered the raw
 * Firestore rejection, which named a Google Cloud project and a document path
 * and left the member with a Finish button that did the same thing again — an
 * error with nothing on the other side of it.
 *
 * ⚠️ Written copy, not the exception's own words, for the reason `AuthPage`
 * already maps its Firebase codes: no raw provider wording reaches the screen.
 * The rejection itself is logged by the caller through `handleFirestoreError`,
 * so nothing is lost to whoever debugs it.
 */
export function saveFailureMessage(e: unknown): string {
  const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';
  if (code === 'unavailable' || code === 'deadline-exceeded') {
    return 'We could not reach the server. Check your connection and press Finish again — your answers are still here.';
  }
  if (code === TENANT_UNRESOLVED_CODE) {
    // 🔴 THE-349. Not "something went wrong" — nothing went wrong with the
    // save. The address this funnel is being run on names no ministry, so a
    // document created here would belong to none, and no amount of pressing
    // Finish changes that. The next step is a different address, so that is
    // what the sentence gives them.
    return TENANT_UNRESOLVED_MESSAGE;
  }
  if (code === 'permission-denied' || code === 'unauthenticated') {
    return 'Your session is no longer valid, so we could not save your answers. Sign in again and you will be brought straight back here.';
  }
  return 'Something went wrong saving your answers. They are still here, so press Finish to try again. If it keeps failing, sign out and sign in again.';
}

/* ── Shared brand chrome (cream editorial ground, Fraunces display) ─────────── */

/** Cream editorial ground that frames the onboarding flow. */
const OnbShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-14 sm:py-20"
    style={{ background: 'var(--cream, #FAF8F5)' }}
  >
    <div
      aria-hidden
      className="pointer-events-none absolute left-1/2 -translate-x-1/2"
      style={{ top: '-18%', width: 760, height: 540, maxWidth: '160vw', background: 'radial-gradient(circle, color-mix(in srgb, var(--brand-color, #C9963A) 12%, transparent), transparent 68%)' }}
    />
    <div className="absolute left-8 top-8 hidden items-center gap-2 sm:flex" style={{ color: 'var(--text-faint, #A89A87)' }}>
      <span className="h-px w-6" style={{ background: 'var(--stone-300, #D6CCBE)' }} />
      <span className="text-xs font-medium">The digital foundation for ministries</span>
    </div>
    <div className="relative z-[1] w-full" style={{ maxWidth: 452 }}>{children}</div>
  </div>
);

const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-xs font-semibold uppercase" style={{ letterSpacing: '0.19em', color: GOLD }}>{children}</div>
);

const Display: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 28 }) => (
  <h1 className="font-display" style={{ fontWeight: 300, fontSize: size, letterSpacing: '-0.02em', lineHeight: 1.1, color: 'var(--text-heading, #2D2519)', margin: 0 }}>
    {children}
  </h1>
);

/** Text field with a leading line-icon and a brand-coloured focus ring. */
const ObInput: React.FC<{ icon?: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>> = ({ icon, ...props }) => {
  const [focus, setFocus] = useState(false);
  return (
    <div
      className="flex items-center gap-2.5 rounded-lg bg-surface-raised transition-all"
      style={{ height: 48, padding: '0 14px', border: `1px solid ${focus ? GOLD : 'var(--stone-200, #E8E2D9)'}`, boxShadow: focus ? `0 0 0 3px color-mix(in srgb, ${GOLD} 16%, transparent)` : 'none' }}
    >
      {icon && <span className="flex shrink-0" style={{ color: 'var(--text-muted, #8B7355)' }}>{icon}</span>}
      <input
        {...props}
        onFocus={(e) => { setFocus(true); props.onFocus?.(e); }}
        onBlur={(e) => { setFocus(false); props.onBlur?.(e); }}
        className="min-w-0 flex-1 bg-transparent outline-hidden placeholder:text-faint"
        style={{ fontSize: 15, color: 'var(--text-heading, #2D2519)' }}
      />
    </div>
  );
};

const fieldLabel = 'mb-1.5 block text-xs font-semibold';
const cardClass = 'rounded-brand-xl border border-line bg-surface-raised shadow-[var(--ds-sh-md)]';
// Soft brand-tinted disc background for step icons (tenant-aware).
const goldDisc = { background: 'color-mix(in srgb, var(--brand-color, #C9963A) 13%, white)', color: GOLD } as React.CSSProperties;

interface OnboardingQuestion {
  id: string;
  label: string;
  type: 'text' | 'select' | 'radio' | 'textarea';
  options?: string[];
  required: boolean;
  order: number;
}

interface OnboardingProps {
  onComplete: () => void;
  /** Plan the user is signing up for (passed from the router; not required here). */
  signupPlan?: TenantPlan;
}

interface StepDef {
  kind:
    | 'default_name'
    | 'default_location'
    | 'default_phone'
    | 'default_faith'
    | 'custom'
    | 'pwaInstall'
    | 'notifications'
    | 'done';
  question?: OnboardingQuestion;
  faithLabel?: string;
}

/** System steps appear after all admin-configured questions, before entering the app. */
const isSystemKind = (k: StepDef['kind']) =>
  k === 'pwaInstall' || k === 'notifications' || k === 'done';

const DEFAULT_QUESTION_STEPS: StepDef[] = [
  { kind: 'default_name' },
  { kind: 'default_location' },
  { kind: 'default_phone' },
  { kind: 'default_faith', faithLabel: 'Have you accepted Jesus?' },
];

// ─── System Step: Install the App ─────────────────────────────────────────────

/**
 * THE-255. The steps themselves, the platform fork and the "is it already
 * installed?" question now live in `lib/pwa-install` + `install/InstallInstructions`,
 * because this is no longer the only surface that shows them: the end of the
 * paid onboarding flow and the Install app button in member settings render the
 * SAME component over the SAME copy. What stays here is only what is particular
 * to being a step in this funnel — the eyebrow, and Skip.
 *
 * ⚠️ One behaviour changed in the move, deliberately: the manual steps used to
 * fork on `isMobile`, so an Android member with no `beforeinstallprompt` was
 * shown the iOS Share-sheet instructions. iOS and Android are now separate
 * lists. See `INSTALL_STEPS`.
 */
const PwaInstallStep: React.FC<{
  deferredPrompt: React.MutableRefObject<any>;
  onDone: () => void;
}> = ({ deferredPrompt, onDone }) => {
  const { state, promptInstall } = useInstallState(deferredPrompt);

  const finish = () => {
    markInstallHandled();
    onDone();
  };

  return (
    <div className="py-1">
      <Eyebrow>Almost there</Eyebrow>
      <InstallHeading state={state} />
      <InstallPanel
        state={state}
        onInstall={async () => { await promptInstall(); finish(); }}
        onAcknowledge={finish}
        footer={
          <button
            onClick={finish}
            className="w-full py-1 text-center text-sm font-semibold text-body transition-colors hover:opacity-70"
          >
            Skip for now
          </button>
        }
      />
    </div>
  );
};


// ─── System Step: Enable Notifications ────────────────────────────────────────

const NotificationsStep: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [requesting, setRequesting] = useState(false);

  const finish = () => {
    try { localStorage.setItem('notifications_prompted', 'true'); } catch { /* ignore */ }
    onDone();
  };

  const handleEnable = async () => {
    setRequesting(true);
    try {
      if (typeof Notification !== 'undefined') {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          // Best-effort: register the FCM token so push actually reaches this device.
          try {
            const msg = await messaging;
            const user = auth.currentUser;
            if (msg && user) {
              const token = await getToken(msg, { vapidKey: VAPID_KEY });
              if (token) {
                // fcmTokens only — users.tenantId is locked to self-edits by
                // firestore.rules (server-authority; bundling it here used to
                // make the whole write fail whenever the scope differed).
                //
                // 🔴 THE-336 — this was the SECOND `updateDoc` on a document
                // that may not exist. In the flow as written it is reached only
                // after `saveToFirestore` has already created or updated the
                // document, so the create branch is unreachable today; it goes
                // through the same writer anyway so that neither write site in
                // this file can strand a member on a `not-found`, and so that a
                // document created from here is a WHOLE one rather than a
                // fragment holding a push token and nothing else.
                await writeUserDoc(user, { fcmTokens: arrayUnion(token) });
              }
            }
          } catch (e) {
            console.error('Failed to register notification token:', e);
          }
        }
      }
    } catch (e) {
      console.error('Notification permission request failed:', e);
    } finally {
      setRequesting(false);
      finish();
    }
  };

  return (
    <div className="py-1">
      <Eyebrow>One last thing</Eyebrow>
      <div className="mt-4 mb-5 flex justify-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-brand-lg" style={goldDisc}>
          <Bell size={34} />
        </div>
      </div>
      <h1 className="mb-1.5 text-center font-display" style={{ fontWeight: 300, fontSize: 26, letterSpacing: '-0.02em', color: 'var(--text-heading, #2D2519)' }}>Stay connected</h1>
      <p className="mb-6 text-center text-sm leading-relaxed" style={{ color: 'var(--text-body, #4A4038)' }}>
        Turn on notifications for messages, prayer updates and announcements from your ministry.
      </p>

      <button
        onClick={handleEnable}
        disabled={requesting}
        className="mb-3 flex h-12 w-full items-center justify-center gap-2 rounded-lg font-semibold text-white transition-all disabled:opacity-50"
        style={{ backgroundColor: GOLD, boxShadow: `0 10px 30px -8px color-mix(in srgb, ${GOLD} 42%, transparent)` }}
      >
        <Bell size={18} /> {requesting ? 'Enabling…' : 'Enable notifications'}
      </button>
      <button
        onClick={finish}
        className="w-full py-1 text-center text-sm font-semibold transition-colors hover:opacity-70"
        style={{ color: 'var(--text-body, #4A4038)' }}
      >
        Maybe later
      </button>
    </div>
  );
};

// ─── Main Onboarding ──────────────────────────────────────────────────────────

const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [acceptedJesus, setAcceptedJesus] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);
  const [error, setError] = useState('');
  /**
   * 🔴 THE-336 — the save, as a state machine, modelled on THE-321's fix to
   * `PersonalInformationModal.handleSave`.
   *
   * `error` above is the VALIDATION message ("Please enter your name.") and is
   * unchanged. This is the separate question of whether the write to Firestore
   * succeeded, and it is separate because the two need different copy and
   * because a failed write — unlike a blank field — is not the member's doing
   * and needs to tell them what to do next.
   *
   * ⚠️ `saveState` never clears the answers. `name`, `country`, `city`,
   * `phone`, `acceptedJesus` and `customAnswers` are left exactly as typed and
   * the step does not advance, so pressing Finish again retries with everything
   * still in the fields.
   */
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const isSaving = saveState === 'saving';
  const [customQuestions, setCustomQuestions] = useState<OnboardingQuestion[]>([]);
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [questionsLoaded, setQuestionsLoaded] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const deferredPrompt = useRef<any>(null);

  // Logo: tenant logo (plan-gated) with the Harvest mark as fallback — same
  // treatment as AuthPage so the auth → onboarding transition feels continuous.
  const { branding, tenantPlan } = useTenant();
  const hasCustomBranding = tenantPlan === 'max';
  const logoSrc = hasCustomBranding && branding.logo ? branding.logo : HARVEST_LOGO;

  // Branded field styling for textarea / select (icon inputs use <ObInput/>).
  const brandFieldClass =
    'w-full rounded-lg bg-surface-raised px-3.5 py-3 outline-hidden transition-all placeholder:text-faint';
  const focusHandlers = {
    onFocus: (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.boxShadow = `0 0 0 3px color-mix(in srgb, ${GOLD} 16%, transparent)`; },
    onBlur: (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = 'var(--stone-200, #E8E2D9)'; e.currentTarget.style.boxShadow = 'none'; },
  };
  const fieldStyle: React.CSSProperties = { border: '1px solid var(--stone-200, #E8E2D9)', color: 'var(--text-heading, #2D2519)', fontSize: 15 };

  const steps = useMemo<StepDef[]>(() => {
    // 1) Build the admin-configured question steps.
    let questionSteps: StepDef[];
    if (!questionsLoaded || customQuestions.length === 0) {
      questionSteps = DEFAULT_QUESTION_STEPS;
    } else {
      questionSteps = [];
      let locationAdded = false;
      for (const q of customQuestions) {
        if (q.id === 'default_name') {
          questionSteps.push({ kind: 'default_name' });
        } else if (q.id === 'default_country' || q.id === 'default_city') {
          if (!locationAdded) { questionSteps.push({ kind: 'default_location' }); locationAdded = true; }
        } else if (q.id === 'default_phone') {
          questionSteps.push({ kind: 'default_phone' });
        } else if (q.id === 'default_accepted_jesus') {
          questionSteps.push({ kind: 'default_faith', faithLabel: q.label || 'Have you accepted Jesus?' });
        } else {
          questionSteps.push({ kind: 'custom', question: q });
        }
      }
    }

    // 2) Append the system steps (install + notifications) unless already handled.
    const result: StepDef[] = [...questionSteps];
    if (typeof window !== 'undefined') {
      // THE-255: the same three questions the other install surfaces ask, and
      // now the same answers. `isNativeShell()` is the new one — inside the
      // Capacitor shell `server.url` points at this very origin, so the step
      // used to render and tell someone holding the app to install the app.
      // `isInstalled()` also consults `navigator.standalone`, which is the only
      // signal iOS gives, so an iOS member who installed last week is no longer
      // asked again.
      if (!isInstallHandled() && !isInstalled() && !isNativeShell()) {
        result.push({ kind: 'pwaInstall' });
      }
      if (
        !localStorage.getItem('notifications_prompted') &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'default'
      ) {
        result.push({ kind: 'notifications' });
      }
    }
    result.push({ kind: 'done' });
    return result;
  }, [customQuestions, questionsLoaded]);

  const currentStep = steps[stepIndex] ?? { kind: 'done' as const };
  const isDone = currentStep.kind === 'done';
  const isSystemStep = currentStep.kind === 'pwaInstall' || currentStep.kind === 'notifications';
  const questionStepCount = steps.filter(s => !isSystemKind(s.kind)).length;

  useEffect(() => {
    if (auth.currentUser?.displayName) setName(auth.currentUser.displayName);

    const loadCustomQuestions = async () => {
      try {
        const tenantId = await getTenantScope();
        if (tenantId) {
          const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));
          if (tenantDoc.exists()) {
            const config = tenantDoc.data().config || {};
            if (config.onboardingQuestions && Array.isArray(config.onboardingQuestions)) {
              const questions = config.onboardingQuestions
                .filter((q: any) => q?.id && q?.label)
                .sort((a: any, b: any) => (a.order || 0) - (b.order || 0)) as OnboardingQuestion[];
              setCustomQuestions(questions);
              const initial: Record<string, string> = {};
              questions.forEach((q: OnboardingQuestion) => { initial[q.id] = ''; });
              setCustomAnswers(initial);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load onboarding questions:', err);
      } finally {
        setQuestionsLoaded(true);
      }
    };
    loadCustomQuestions();

    if (navigator.geolocation) {
      setGpsLoading(true);
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const { latitude, longitude } = pos.coords;
            const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
            const data = await resp.json();
            if (data?.address) {
              if (data.address.country) setCountry(data.address.country);
              const c = data.address.city || data.address.town || data.address.village || data.address.county || '';
              if (c) setCity(c);
            }
          } catch {}
          setGpsLoading(false);
        },
        () => setGpsLoading(false)
      );
    }
  }, []);

  // Cache the Android install prompt so the PWA step can trigger it on demand.
  useEffect(() => {
    const handler = (e: any) => { e.preventDefault(); deferredPrompt.current = e; };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleUseGPS = () => {
    if (!navigator.geolocation) { setError('Geolocation not supported.'); return; }
    setGpsLoading(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
          const data = await resp.json();
          if (data?.address) {
            if (data.address.country) setCountry(data.address.country);
            const c = data.address.city || data.address.town || data.address.village || data.address.county || '';
            if (c) setCity(c);
          }
        } catch { setError('Could not fetch location.'); }
        setGpsLoading(false);
      },
      () => { setError('Location permission denied.'); setGpsLoading(false); }
    );
  };

  const validate = (s: StepDef): string | null => {
    switch (s.kind) {
      case 'default_name': return name.trim() ? null : 'Please enter your name.';
      case 'default_location': return country ? null : 'Please select your country.';
      case 'default_phone': return phone.trim() ? null : 'Please enter your phone number.';
      case 'default_faith': return acceptedJesus ? null : 'Please answer this question.';
      case 'custom':
        if (s.question?.required && !customAnswers[s.question.id]?.trim())
          return `Please answer: ${s.question.label}`;
        return null;
      default: return null;
    }
  };

  const saveToFirestore = async () => {
    const user = auth.currentUser;
    if (!user) throw new Error('No user logged in');
    const updateData: Record<string, any> = {
      displayName: name,
      country,
      city,
      phone,
      acceptedJesus: acceptedJesus === 'yes',
      onboardingCompleted: true,
    };
    // Only persist real custom answers — the default_* ids are stored as
    // top-level fields (displayName/country/city/phone/acceptedJesus), so
    // writing them here too would just pollute onboardingAnswers with blanks.
    const customOnly = Object.fromEntries(
      Object.entries(customAnswers).filter(([k, v]) => !k.startsWith('default_') && !!v?.trim())
    );
    if (Object.keys(customOnly).length > 0) {
      updateData.onboardingAnswers = customOnly;
    }
    // 🔴 THE-336. Was `updateDoc(doc(db, 'users', user.uid), updateData)`,
    // which rejects with `not-found` when the document was never created — the
    // whole ticket. `writeUserDoc` updates it when it is there and creates a
    // COMPLETE one when it is not; see its docblock for why the created
    // document carries an identity block and why it carries no consent record.
    await writeUserDoc(user, updateData);
  };

  // Advance handler used by the self-managed system steps.
  const advanceStep = () => {
    setError('');
    setDir(1);
    setStepIndex(i => i + 1);
  };

  const goNext = async () => {
    // Don't let the user advance until the tenant's question set is finalized,
    // otherwise a fast Enter on the default steps could be invalidated when the
    // (possibly reordered/custom) questions load and the steps array recomputes.
    if (!questionsLoaded) return;
    const err = validate(currentStep);
    if (err) { setError(err); return; }
    setError('');

    const nextIdx = stepIndex + 1;
    const nextStep = steps[nextIdx];

    // Persist answers once, at the transition from the last question step to the
    // first system step (pwaInstall / notifications / done). This means the user
    // can close the browser mid-install without losing their answers.
    if (nextStep && isSystemKind(nextStep.kind)) {
      setSaveState('saving');
      setSaveMessage('');
      try {
        await saveToFirestore();
      } catch (e: unknown) {
        /**
         * 🔴 THE-336 — THE FAILURE IS SHOWN, AND IT IS NOT A DEAD END.
         *
         * ⚠️ The raw rejection is LOGGED, structurally, and does not reach the
         * screen. `No document to update: projects/harvest-agent-233a1/…` is
         * what a member was shown, and it told them nothing they could act on
         * — the same reason `AuthPage` maps its Firebase codes to written
         * copy. `handleFirestoreError` keeps the uid, the path, the operation
         * and the provider list in the console for whoever debugs the next
         * one.
         *
         * 🔴 Making this silent would be the OPPOSITE defect and just as bad:
         * a Finish button that appears to work while nothing is written is the
         * quiet lie the Silent-Failure Rule is about. It stays loud; what
         * changes is that it is legible and that it says what to do next.
         */
        handleFirestoreError(e, OperationType.WRITE, `users/${auth.currentUser?.uid ?? '<none>'}`);
        setSaveState('error');
        setSaveMessage(saveFailureMessage(e));
        return;
      }
      setSaveState('idle');
    }

    setDir(1);
    setStepIndex(nextIdx);
  };

  const goBack = () => {
    if (stepIndex === 0) return;
    setError('');
    setDir(-1);
    setStepIndex(i => i - 1);
  };

  const getHeading = (s: StepDef): { title: string; sub: string } => {
    switch (s.kind) {
      case 'default_name': return { title: "What should we call you?", sub: "We'll use this to personalize your experience across the app." };
      case 'default_location': return { title: 'Where are you based?', sub: "We'll surface posts, groups and events happening near you." };
      case 'default_phone': return { title: 'Your phone number', sub: 'So your ministry can reach you when it matters most.' };
      case 'default_faith': return { title: s.faithLabel || 'Have you accepted Jesus?', sub: "There's no wrong answer — it just helps us walk with you." };
      case 'custom': return { title: s.question?.label || '', sub: '' };
      default: return { title: '', sub: '' };
    }
  };

  const renderField = (s: StepDef) => {
    switch (s.kind) {
      case 'default_name':
        return (
          <ObInput
            type="text" value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !isSaving && goNext()}
            placeholder="Your full name" autoFocus
            icon={<User size={16} />}
          />
        );
      case 'default_location':
        return (
          <div className="space-y-4">
            <button type="button" onClick={handleUseGPS} disabled={gpsLoading}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border bg-surface-raised text-sm font-semibold transition-colors hover:bg-surface-sunken disabled:opacity-50"
              style={{ borderColor: 'var(--stone-300, #D6CCBE)', color: 'var(--text-heading, #2D2519)' }}>
              <MapPin size={15} />
              {gpsLoading ? 'Detecting your location…' : 'Use my current location'}
            </button>
            <div className="relative z-50">
              <label className={fieldLabel} style={{ color: 'var(--text-heading, #2D2519)' }}>Country</label>
              <CountrySelect value={country} onChange={setCountry} className="w-full" />
            </div>
            <div>
              <label className={fieldLabel} style={{ color: 'var(--text-heading, #2D2519)' }}>City</label>
              <ObInput type="text" value={city} onChange={e => setCity(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !isSaving && goNext()}
                placeholder="Your city" icon={<MapPin size={16} />} />
            </div>
          </div>
        );
      case 'default_phone':
        return (
          <ObInput type="tel" value={phone}
            onChange={e => setPhone(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !isSaving && goNext()}
            placeholder="+1 234 567 8900" autoFocus
            icon={<Phone size={16} />}
          />
        );
      case 'default_faith':
        return (
          <div className="flex gap-3.5">
            <label className="flex-1 cursor-pointer">
              <input type="radio" name="acceptedJesus" value="yes" checked={acceptedJesus === 'yes'} onChange={e => setAcceptedJesus(e.target.value)} className="peer sr-only" />
              <div className="w-full rounded-brand-lg border-2 border-line-strong bg-surface-raised px-4 py-6 text-center font-display text-[22px] font-light transition-all peer-checked:bg-[color-mix(in_srgb,var(--brand-color)_12%,white)] peer-checked:border-[var(--brand-color)] peer-checked:text-[var(--brand-color)]" style={{ letterSpacing: '-0.02em', color: 'var(--text-heading, #2D2519)' }}>Yes</div>
            </label>
            <label className="flex-1 cursor-pointer">
              <input type="radio" name="acceptedJesus" value="no" checked={acceptedJesus === 'no'} onChange={e => setAcceptedJesus(e.target.value)} className="peer sr-only" />
              <div className="w-full rounded-brand-lg border-2 border-line-strong bg-surface-raised px-4 py-6 text-center font-display text-[22px] font-light transition-all peer-checked:bg-[color-mix(in_srgb,var(--brand-color)_12%,white)] peer-checked:border-[var(--brand-color)] peer-checked:text-[var(--brand-color)]" style={{ letterSpacing: '-0.02em', color: 'var(--text-heading, #2D2519)' }}>Not yet</div>
            </label>
          </div>
        );
      case 'custom':
        if (!s.question) return null;
        return renderCustomQuestion(s.question);
      default:
        return null;
    }
  };

  const renderCustomQuestion = (question: OnboardingQuestion) => {
    const value = customAnswers[question.id] || '';
    switch (question.type) {
      case 'text':
        return (
          <ObInput type="text" value={value}
            onChange={e => setCustomAnswers(p => ({ ...p, [question.id]: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && !isSaving && goNext()}
            placeholder={question.label} autoFocus />
        );
      case 'textarea':
        return (
          <textarea value={value}
            onChange={e => setCustomAnswers(p => ({ ...p, [question.id]: e.target.value }))}
            className={`${brandFieldClass} resize-none`}
            style={fieldStyle}
            {...focusHandlers}
            placeholder={question.label} rows={3} />
        );
      case 'select':
        return (
          <select value={value}
            onChange={e => setCustomAnswers(p => ({ ...p, [question.id]: e.target.value }))}
            className={`${brandFieldClass} appearance-none`}
            style={fieldStyle}
            {...focusHandlers}>
            <option value="">Select…</option>
            {(question.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        );
      case 'radio':
        return (
          <div className="flex flex-wrap gap-3">
            {(question.options || []).map(opt => (
              <label key={opt} className="min-w-[100px] flex-1 cursor-pointer">
                <input type="radio" name={`custom_${question.id}`} value={opt} checked={value === opt}
                  onChange={e => setCustomAnswers(p => ({ ...p, [question.id]: e.target.value }))} className="peer sr-only" />
                <div className="w-full rounded-lg border border-line-strong bg-surface-raised px-4 py-3 text-center text-sm font-semibold transition-all peer-checked:bg-[color-mix(in_srgb,var(--brand-color)_12%,white)] peer-checked:border-[var(--brand-color)] peer-checked:text-[var(--brand-color)]" style={{ color: 'var(--text-heading, #2D2519)' }}>
                  {opt}
                </div>
              </label>
            ))}
          </div>
        );
      default: return null;
    }
  };

  const heading = getHeading(currentStep);
  // Keep the bar in step with the "Step X of N" counter (which counts only
  // question steps); system steps are the home stretch, so show a full bar.
  const progressPct = isSystemStep
    ? 100
    : Math.min(100, Math.round(((stepIndex + 1) / Math.max(questionStepCount, 1)) * 100));

  return (
    <OnbShell>
      {/* Logo */}
      <div className="mb-6 flex justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc} alt="Harvest logo" className="h-12 w-auto object-contain" />
      </div>

      {/* Progress */}
      {!isDone && (
        <div className="mb-4">
          <div className="mb-1.5 flex justify-between text-xs font-medium" style={{ color: 'var(--text-muted, #8B7355)' }}>
            <span>{isSystemStep ? 'Final steps' : `Step ${stepIndex + 1} of ${questionStepCount}`}</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--stone-200, #E8E2D9)' }}>
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: GOLD }}
              initial={false}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            />
          </div>
        </div>
      )}

      {/* Card. overflowX:clip contains the horizontal slide without clipping the
          country dropdown (the card itself never sets overflow, so the dropdown
          renders freely). */}
      <div className={`${cardClass} px-6 py-8 sm:px-9`}>
        <div style={{ overflowX: 'clip' }}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={stepIndex}
              initial={{ opacity: 0, x: dir * 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * -40 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              {isDone ? (
                <div className="py-4 text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 280, damping: 20, delay: 0.05 }}
                    className="mx-auto mb-6 flex h-[76px] w-[76px] items-center justify-center rounded-full"
                    style={goldDisc}
                  >
                    <CheckCircle2 size={38} />
                  </motion.div>
                  <h1 className="mb-2 font-display" style={{ fontWeight: 300, fontSize: 30, letterSpacing: '-0.02em', color: 'var(--text-heading, #2D2519)' }}>
                    You&apos;re all set{name ? `, ${name.split(' ')[0]}` : ''}.
                  </h1>
                  <p className="mb-8 text-sm leading-relaxed" style={{ color: 'var(--text-body, #4A4038)' }}>
                    Welcome to Harvest. From conversion to devotion — everything&apos;s ready for you.
                  </p>
                  <button onClick={onComplete}
                    className="inline-flex items-center gap-2 rounded-lg px-8 py-3 font-semibold text-white transition-all"
                    style={{ backgroundColor: GOLD, boxShadow: `0 10px 30px -8px color-mix(in srgb, ${GOLD} 42%, transparent)` }}>
                    Enter the app <ArrowRight size={18} />
                  </button>
                </div>
              ) : currentStep.kind === 'pwaInstall' ? (
                <PwaInstallStep deferredPrompt={deferredPrompt} onDone={advanceStep} />
              ) : currentStep.kind === 'notifications' ? (
                <NotificationsStep onDone={advanceStep} />
              ) : (
                <>
                  <Eyebrow>{`Step ${stepIndex + 1} of ${questionStepCount}`}</Eyebrow>
                  <div className="mb-1.5 mt-3">
                    <h1 className="font-display" style={{ fontWeight: 300, fontSize: 28, letterSpacing: '-0.02em', lineHeight: 1.12, color: 'var(--text-heading, #2D2519)' }}>{heading.title}</h1>
                  </div>
                  {heading.sub && <p className="text-sm leading-relaxed" style={{ color: 'var(--text-body, #4A4038)' }}>{heading.sub}</p>}
                  {/*
                    🔴 THE-336 — `ui/alert`, the installed primitive for exactly
                    this: a banner reporting an outcome. What stood here was
                    hand-written markup carrying three bare hex literals — a
                    tint, a border and a text colour, none of them behind a
                    token — and no `role`, so a refused write reached
                    no screen reader at all — the reader least likely to notice
                    that a Finish button simply did nothing. `Alert` carries
                    `role="alert"` itself and paints from `bg-card` /
                    `text-destructive`, so all four palettes resolve and nothing
                    here names a colour.

                    ⚠️ Rejected: `ui/empty` (it announces an absent list, not a
                    failed write), `sonner` (a toast leaves the screen while the
                    thing it described is still broken, and this message has to
                    stay next to the answers it failed to save) and `ui/dialog`
                    (a second modal over a full-screen funnel step, which would
                    hide the very fields the member needs to retry from).

                    ⚠️ It is not a tap target and has no height of its own, so
                    it takes no 44px floor.
                  */}
                  {saveState === 'error' && (
                    <Alert variant="destructive" aria-live="assertive" data-save-error className="mt-4">
                      <AlertTitle>We could not save your answers</AlertTitle>
                      <AlertDescription>{saveMessage}</AlertDescription>
                    </Alert>
                  )}
                  {error && (
                    <Alert variant="destructive" aria-live="assertive" data-validation-error className="mt-4">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                  <div className="mt-6">{renderField(currentStep)}</div>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {!isDone && !isSystemStep && (
          <div className="mt-7 flex items-center justify-between">
            {stepIndex > 0 ? (
              <button onClick={goBack}
                className="flex items-center gap-1.5 text-sm font-semibold transition-colors hover:opacity-70" style={{ color: 'var(--text-body, #4A4038)' }}>
                <ArrowLeft size={16} /> Back
              </button>
            ) : <div />}
            <button onClick={goNext} disabled={isSaving || !questionsLoaded}
              className="flex items-center gap-2 rounded-lg px-6 py-3 font-semibold text-white transition-all disabled:opacity-50"
              style={{ backgroundColor: GOLD, boxShadow: `0 10px 30px -8px color-mix(in srgb, ${GOLD} 42%, transparent)` }}>
              {isSaving ? 'Saving…' : stepIndex === questionStepCount - 1 ? 'Finish' : 'Continue'}
              <ArrowRight size={16} />
            </button>
          </div>
        )}
      </div>
    </OnbShell>
  );
};

export default Onboarding;
