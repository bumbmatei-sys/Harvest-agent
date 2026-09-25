import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-336 — a new account could not finish onboarding: "No document to update"
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ── The report ──────────────────────────────────────────────────────────────
 *
 * Creating an account on a tenant host, at step 4 of 4 of onboarding:
 *
 *   No document to update:
 *   projects/harvest-agent-233a1/databases/(default)/documents/users/<uid>
 *
 * rendered inside the card, with a Finish button that did the same thing again.
 * The account could not be created at all.
 *
 * ── 🔴 The root cause, which is NOT in Onboarding.tsx ───────────────────────
 *
 * `src/utils/firestore-errors.ts` — `handleFirestoreError` LOGS A STRUCTURED
 * RECORD AND RETURNS. It does not throw; its own docblock says so. Every
 * Firestore call site in `AuthPage` was written as
 *
 *   catch (err) { handleFirestoreError(err, …); return; }
 *
 * so a refused write was swallowed and the `return` put NOTHING on the screen.
 * That is the Silent-Failure Rule verbatim (AGENTS.md:6 — "`catch {
 * console.error }` … converts a loud failure into a quiet lie").
 *
 * The consequence is the whole ticket. A member left `AuthPage` with a Firebase
 * Auth user and NO `users` document; `App.tsx` reads `userDoc.exists() ===
 * false` and routes them to `/onboarding`; `Onboarding.saveToFirestore` called
 * `updateDoc`, which REQUIRES the document to exist and rejects `not-found`.
 * ⚠️ AND THE TRAP CLOSED BEHIND THEM. Two of the five sites are the
 * `termsAccepted`/`newsletter` refresh on the two SIGN-IN paths, and both were
 * `updateDoc` on the same possibly-missing document. So a member in this state
 * could not sign in far enough to be given a claim either: the refresh rejected
 * `not-found`, the bare `return` skipped `set-claims`, and they were routed
 * back to the funnel that could not finish.
 *
 * 🔴 THE SAFETY NET IS NOT THE FIX. Sections 1-3 prove onboarding can no longer
 * strand anyone; section 5 proves a document it creates is COMPLETE rather than
 * a fragment, because a half-created account is worse than a clear failure;
 * section 4 proves a save that genuinely fails is visible and loses nothing;
 * and section 10 proves the swallowed `catch` in `AuthPage` is gone.
 *
 * ── ⚠️ What this ticket did NOT need ────────────────────────────────────────
 *
 * `firestore.rules` is UNCHANGED and needed no change (section 17 pins it byte
 * for byte). `allow create` on `users/{uid}` already permits a self-write whose
 * `role` is absent or `'user'`, and `allow update` already permits a self-edit
 * that touches none of `role`/`permissions`/`tenantId`/`plan`. A write to a
 * MISSING document is evaluated as a create and to an existing one as an
 * update, so branching on existence — rather than sending one merge — keeps
 * each write under the rule that already allowed it.
 *
 * ── Conventions ─────────────────────────────────────────────────────────────
 *
 * Nothing here pins a LINE NUMBER (section 14 proves it of this file), nothing
 * shells out to `git` at assertion time, and no fixture carries a date near
 * today (section 15). Controls are found by their accessible name or their
 * rendered text, never by a class, so no assertion can pass merely by matching
 * a string this ticket introduced.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ── Mocks: enough backend to let the funnel paint, nothing more ──────────── */

const {
  authMock, setDocMock, updateDocMock, getDocMock, getTokenMock, firestoreErrorMock, tenantScopeMock,
} = vi.hoisted(() => ({
  authMock: {
    currentUser: { uid: 'u-new', email: 'someone@example.test', displayName: null as string | null },
  },
  setDocMock: vi.fn(async () => {}),
  updateDocMock: vi.fn(async () => {}),
  getDocMock: vi.fn(async (): Promise<{ exists: () => boolean; data?: () => Record<string, unknown> }> => ({ exists: () => true, data: () => ({}) })),
  getTokenMock: vi.fn(async () => 'push-token'),
  firestoreErrorMock: vi.fn(),
  tenantScopeMock: vi.fn(async () => 'shadcn' as string | null),
}));

vi.mock('../../firebase', () => ({
  auth: authMock, db: {}, messaging: Promise.resolve(null), VAPID_KEY: 'vapid',
}));
vi.mock('firebase/messaging', () => ({ getToken: getTokenMock }));
vi.mock('firebase/firestore', () => ({
  doc: (_d: unknown, ...s: string[]) => ({ __path: s.join('/'), collection: s[0], id: s[1] }),
  getDoc: getDocMock,
  setDoc: setDocMock,
  updateDoc: updateDocMock,
  // The real sentinel is opaque; this keeps it identifiable so section 6 can
  // prove it survived onto whichever call the write actually took.
  arrayUnion: (...a: unknown[]) => ({ __arrayUnion: a }),
}));
vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'get', WRITE: 'write', UPDATE: 'update' },
  handleFirestoreError: firestoreErrorMock,
}));
vi.mock('../../contexts/TenantContext', () => ({
  useTenant: () => ({ branding: {}, tenantId: 'shadcn', tenantName: 'Shadcn', tenantPlan: 'plus' }),
}));
vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: tenantScopeMock, getWriteTenantScope: tenantScopeMock,
}));
// motion/react animates opacity and transform only — neither bears on which
// document is written or on what the member can read.
vi.mock('motion/react', () => ({
  motion: new Proxy({}, {
    get: () => ({ children, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) =>
      React.createElement('div', { className: (rest as { className?: string }).className }, children),
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, {}, children),
}));

import React from 'react';
import { ownershipFailure, ownershipFailureWithBaseline } from '../../__tests__/__fixtures__/ownership-register';

const REPO = path.resolve(__dirname, '../../..');
const src = (rel: string) => readFileSync(path.join(REPO, rel), 'utf8');
const sha = (rel: string) => createHash('sha256').update(readFileSync(path.join(REPO, rel))).digest('hex');

/**
 * A file's CODE, comments stripped.
 *
 * 🔴 Load-bearing for every "this file must not contain X" assertion here, and
 * this ticket has a first-hand reason to insist on it: THE-292 pinned
 * onboarding's write with a raw-text `toContain`, and THE-336's own docblock
 * quotes the call it replaced — so that guard KEPT PASSING against the
 * quotation after the behaviour underneath it had changed. A guard satisfied by
 * prose is not a guard.
 */
const code = (rel: string) =>
  src(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/* ── Files this ticket may not touch, pinned ─────────────────────── */

const FROZEN_INDEXES = '8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0';
const FROZEN_LAYOUT = 'b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f';
const FROZEN_FUNCTIONS = '95490fe52cc2caa158d978ab48fe8ac94cf3986a19e22bcf4b21c099edb834aa';

/* ── Harness ──────────────────────────────────────────────────────────────── */

let container: HTMLDivElement;
let root: Root | null = null;

const setURL = (url: string) =>
  (window as unknown as { happyDOM?: { setURL: (u: string) => void } }).happyDOM?.setURL(url);

async function settle() {
  await act(async () => {
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
}

/** Mount the member onboarding funnel on a tenant host. */
async function mountOnboarding(): Promise<HTMLDivElement> {
  setURL('https://shadcn.theharvest.app/onboarding');
  const C = (await import('../Onboarding')).default;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<C onComplete={() => {}} />); });
  await settle();
  return container;
}

const texts = (sel: string) =>
  [...container.querySelectorAll(sel)].map((n) => (n.textContent ?? '').trim());

/** The one control whose visible text is `label`. Never found by class. */
function byText(label: string): HTMLElement {
  const el = [...container.querySelectorAll('button')]
    .find((b) => (b.textContent ?? '').trim().startsWith(label));
  if (!el) throw new Error(`no control reading "${label}" — found: ${texts('button').join(' | ')}`);
  return el as HTMLElement;
}

async function click(el: HTMLElement) {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await settle();
}

async function type(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}

/** The text field on the current step, whatever its placeholder. */
const field = () => container.querySelector('input[type="text"], input[type="tel"], input') as HTMLInputElement;

/** The one control whose visible text is exactly `label`, or undefined. */
const maybe = (label: string) =>
  [...container.querySelectorAll('button')]
    .find((b) => (b.textContent ?? '').trim() === label) as HTMLElement | undefined;

/**
 * Walk the four default question steps and press Finish.
 *
 * ⚠️ Every control is found by the text a member reads — "Select Country",
 * "Kenya", "Yes", "Finish" — and never by a class or a test id, so no step here
 * can pass by matching a string this ticket introduced. `country` is chosen
 * through `CountrySelect`'s own list rather than typed, because it is a listbox
 * and refuses free text by design (THE-330).
 */
async function completeQuestions(country = 'Kenya') {
  await type(field(), 'Ada Founder');                            // 1 — name
  await click(byText('Continue'));

  const opener = byText('Select Country');                       // 2 — location
  await click(opener);
  const option = maybe(country);
  if (!option) throw new Error(`${country} is not in CountrySelect's list`);
  await click(option);
  await click(byText('Continue'));

  await type(field(), '+254700000000');                          // 3 — phone
  await click(byText('Continue'));

  // 4 — faith. A radio behind its label, found by the label's own text.
  const yes = [...container.querySelectorAll('label')]
    .find((l) => (l.textContent ?? '').trim() === 'Yes')?.querySelector('input[type="radio"]') as HTMLInputElement | undefined;
  if (!yes) throw new Error(`no "Yes" answer on the faith step — read: ${container.textContent?.slice(0, 200)}`);
  await act(async () => {
    // React tracks `checked` on the node, so assigning it directly makes React
    // treat the change as already handled and skip onChange. Going through the
    // prototype setter clears the tracker, exactly as it does for `value`.
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set?.call(yes, true);
    yes.dispatchEvent(new Event('click', { bubbles: true }));
    yes.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();

  await click(byText('Finish'));
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.currentUser = { uid: 'u-new', email: 'someone@example.test', displayName: null };
  getDocMock.mockResolvedValue({ exists: () => true, data: () => ({}) });
  setDocMock.mockResolvedValue(undefined);
  updateDocMock.mockResolvedValue(undefined);
  tenantScopeMock.mockResolvedValue('shadcn');
  try { localStorage.clear(); } catch { /* happy-dom */ }
});

afterEach(async () => {
  if (root) { await act(async () => { root!.unmount(); }); root = null; }
  container?.remove();
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 1-3. 🔴 Onboarding completes whether or not the document exists, at BOTH
 *      write sites
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The two writes are exercised through the module's own exported writer rather
 * than only through the funnel, because the notification-token write sits
 * behind an OS permission prompt that happy-dom cannot grant. `writeUserDoc` is
 * the single function BOTH call sites go through — section 3 proves that from
 * source — so exercising it is exercising both.
 */

const loadWriter = async () => (await import('../Onboarding')).writeUserDoc;
const USER = { uid: 'u-new', email: 'someone@example.test', displayName: null };

describe('1. 🔴 the write completes when the users document does NOT exist yet', () => {
  it('creates it instead of rejecting with not-found — this is the bug', async () => {
    getDocMock.mockResolvedValue({ exists: () => false });
    // A bare `updateDoc` against a missing document is what Firestore rejects.
    updateDocMock.mockRejectedValue(Object.assign(new Error('No document to update'), { code: 'not-found' }));

    const writeUserDoc = await loadWriter();
    await expect(writeUserDoc(USER, { onboardingCompleted: true })).resolves.toBeUndefined();

    expect(updateDocMock, 'updateDoc requires the document to exist — it must not be the call made here')
      .not.toHaveBeenCalled();
    expect(setDocMock).toHaveBeenCalledTimes(1);
    const [ref, payload] = setDocMock.mock.calls[0] as unknown as [{ collection: string; id: string }, Record<string, unknown>];
    expect(ref.collection).toBe('users');
    expect(ref.id).toBe('u-new');
    expect(payload.onboardingCompleted).toBe(true);
  });

  it('🔴 the funnel reaches its last step and shows no failure', async () => {
    getDocMock.mockResolvedValue({ exists: () => false });
    updateDocMock.mockRejectedValue(Object.assign(new Error('No document to update'), { code: 'not-found' }));
    await mountOnboarding();
    await completeQuestions();
    expect(container.textContent, 'the reported message reached the member').not.toContain('No document to update');
    expect(container.querySelector('[data-save-error]')).toBeNull();
  });
});

describe('2. 🔴 the write still completes when the document DOES exist', () => {
  it('updates it, and creates nothing — no-regression', async () => {
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ uid: 'u-new' }) });
    const writeUserDoc = await loadWriter();
    await writeUserDoc(USER, { country: 'Kenya', onboardingCompleted: true });

    expect(setDocMock, 'an existing document must not be re-created').not.toHaveBeenCalled();
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const [ref, payload] = updateDocMock.mock.calls[0] as unknown as [{ collection: string; id: string }, Record<string, unknown>];
    expect(ref.collection).toBe('users');
    expect(ref.id).toBe('u-new');
    // 🔴 The identity block is NOT resent. `firestore.rules` refuses a self-edit
    // that touches `role` or `tenantId`, so sending it would fail every update.
    expect(Object.keys(payload).sort()).toEqual(['country', 'onboardingCompleted']);
  });
});

describe('3. 🔴 BOTH write sites in Onboarding.tsx are safe', () => {
  /**
   * Discovered BY PATTERN, never by line number: THE-331 pinned
   * `AdminCommunity.tsx:491`, a deletion moved the subject to `:311`, and the
   * suite would have measured whatever landed there instead of failing.
   */
  it('no `updateDoc(doc(db, ...))` call survives in this file', () => {
    const ob = code('src/components/Onboarding.tsx');
    const direct = [...ob.matchAll(/updateDoc\(\s*doc\(/g)];
    expect(direct.map((m) => m[0]),
      'a direct updateDoc on a doc() reference is the shape that rejects not-found')
      .toEqual([]);
  });

  it('🔴 both writes go through the one writer, which branches on existence', () => {
    const ob = code('src/components/Onboarding.tsx');
    const calls = [...ob.matchAll(/writeUserDoc\(/g)];
    // One definition plus the two call sites the ticket names.
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(ob).toContain('await writeUserDoc(user, updateData);');
    expect(ob).toContain('await writeUserDoc(user, { fcmTokens: arrayUnion(token) });');
    expect(ob).toContain('const snap = await getDoc(ref);');
    expect(ob).toContain('if (snap.exists()) {');
  });

  it('the answer write is still made from saveToFirestore, at the same transition', () => {
    const ob = code('src/components/Onboarding.tsx');
    expect(ob).toMatch(/const saveToFirestore = async \(\) => \{/);
    expect(ob).toContain('if (nextStep && isSystemKind(nextStep.kind)) {');
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 4. 🔴 A genuinely failed save surfaces VISIBLY and does not lose input
 * ═════════════════════════════════════════════════════════════════════════════ */

describe('4. 🔴 a genuinely failed save is visible and loses nothing', () => {
  const failEverything = () => {
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({}) });
    updateDocMock.mockRejectedValue(Object.assign(new Error('PERMISSION_DENIED'), { code: 'permission-denied' }));
    setDocMock.mockRejectedValue(Object.assign(new Error('PERMISSION_DENIED'), { code: 'permission-denied' }));
  };

  it('🔴 renders a banner carrying role="alert", and does not advance', async () => {
    failEverything();
    await mountOnboarding();
    await completeQuestions();
    const banner = container.querySelector('[data-save-error]');
    expect(banner, 'a refused write must not be silent — that is the opposite defect').not.toBeNull();
    expect(banner!.getAttribute('role')).toBe('alert');
    expect((banner!.textContent ?? '').length).toBeGreaterThan(0);
  });

  it('🔴 the message names a NEXT STEP and never quotes the provider', async () => {
    const { saveFailureMessage } = await import('../Onboarding');
    const cases: unknown[] = [
      Object.assign(new Error('x'), { code: 'unavailable' }),
      Object.assign(new Error('x'), { code: 'permission-denied' }),
      Object.assign(new Error('No document to update: projects/harvest-agent-233a1/…'), { code: 'not-found' }),
    ];
    for (const e of cases) {
      const msg = saveFailureMessage(e);
      expect(msg, 'no raw provider wording reaches the screen').not.toMatch(/projects\/|databases\/|PERMISSION_DENIED/);
      expect(msg, 'an error with nothing on the other side of it is a dead end')
        .toMatch(/again|Sign in again/i);
    }
  });

  it('🔴 the typed answers are still in the fields after the failure', async () => {
    failEverything();
    await mountOnboarding();
    await completeQuestions();
    expect(container.querySelector('[data-save-error]'), 'the save did not fail, so this proves nothing')
      .not.toBeNull();
    // 🔴 The step did not advance, and every answer walks back intact. THE-321's
    // rule: banner present, the flow stays where it is, the typed value still in
    // the field.
    expect(container.textContent).toContain('Step 4 of 4');
    await click(byText('Back'));                          // → phone
    expect(field().value).toBe('+254700000000');
    await click(byText('Back'));                          // → location
    expect(container.textContent).toContain('Kenya');
    await click(byText('Back'));                          // → name
    expect(field().value, 'a failed write must never discard work the app failed to save')
      .toBe('Ada Founder');
  });

  it('the raw rejection is still RECORDED, structurally, for whoever debugs it', () => {
    const ob = code('src/components/Onboarding.tsx');
    expect(ob).toContain('handleFirestoreError(e, OperationType.WRITE,');
    expect(ob, 'the state machine, not a console.error, is what the member sees')
      .toContain("setSaveState('error');");
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 5. 🔴 A document CREATED by onboarding is COMPLETE
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * 🔴 A half-created account is worse than a clear failure. `AuthPage` creates a
 * `users` document holding uid / email / displayName / createdAt / role /
 * tenantId / newsletter / termsAccepted (growth-data.ts states the same list).
 * A bare merge from onboarding would have created one holding only the answers.
 */

describe('5. 🔴 the users document is COMPLETE after onboarding creates it', () => {
  /** The identity a member's document is worthless without. */
  const REQUIRED = ['uid', 'email', 'displayName', 'createdAt', 'role', 'tenantId'] as const;

  const createdDoc = async (fields: Record<string, unknown>) => {
    getDocMock.mockResolvedValue({ exists: () => false });
    const writeUserDoc = await loadWriter();
    await writeUserDoc(USER, fields);
    return (setDocMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
  };

  it.each(REQUIRED)('carries %s', async (key) => {
    const payload = await createdDoc({ onboardingCompleted: true });
    expect(Object.keys(payload), `a created document without ${key} is a half-created account`)
      .toContain(key);
    expect(payload[key], `${key} is present but empty`).not.toBe(undefined);
  });

  it('🔴 tenantId comes from the HOST resolver, so the member belongs to a ministry', async () => {
    const payload = await createdDoc({ onboardingCompleted: true });
    expect(payload.tenantId).toBe('shadcn');
    expect(tenantScopeMock).toHaveBeenCalled();
  });

  it('role is exactly `user` — firestore.rules refuses a create with any other', async () => {
    const payload = await createdDoc({ onboardingCompleted: true });
    expect(payload.role).toBe('user');
  });

  it('🔴 no consent is invented — no termsAccepted and no newsletter', async () => {
    const payload = await createdDoc({ onboardingCompleted: true });
    // THE-73 recorded the identical decision one screen over in
    // ChurchOnboarding: this flow displays no terms, no link and no checkbox,
    // so it has no evidence of consent and could only assume it. A consent
    // record asserted by a screen that presented nothing is a claim that did
    // not happen. AuthPage stays the only writer of both.
    expect(Object.keys(payload)).not.toContain('termsAccepted');
    expect(Object.keys(payload)).not.toContain('newsletter');
  });

  it('the caller’s answers land on top of the identity block, not under it', async () => {
    const payload = await createdDoc({ displayName: 'Ada Founder', onboardingCompleted: true });
    expect(payload.displayName).toBe('Ada Founder');
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 6. 🔴 arrayUnion still works on the chosen write
 * ═════════════════════════════════════════════════════════════════════════════ */

describe('6. 🔴 arrayUnion survives on whichever branch the write takes', () => {
  it('on the update branch', async () => {
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({}) });
    const { writeUserDoc } = await import('../Onboarding');
    const { arrayUnion } = await import('firebase/firestore');
    await writeUserDoc(USER, { fcmTokens: arrayUnion('tok') });
    const [, payload] = updateDocMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(payload.fcmTokens).toEqual({ __arrayUnion: ['tok'] });
  });

  it('🔴 and on the create branch — a field transform is not update-only', async () => {
    getDocMock.mockResolvedValue({ exists: () => false });
    const { writeUserDoc } = await import('../Onboarding');
    const { arrayUnion } = await import('firebase/firestore');
    await writeUserDoc(USER, { fcmTokens: arrayUnion('tok') });
    const [, payload] = setDocMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(payload.fcmTokens).toEqual({ __arrayUnion: ['tok'] });
    // Still a whole document, not a fragment holding a push token.
    expect(Object.keys(payload)).toContain('tenantId');
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 7. 🔴 #429's country invariant gains no third state
 * ═════════════════════════════════════════════════════════════════════════════ */

describe("7. 🔴 #429's country invariant holds", () => {
  it('country is written THROUGH, never defaulted, on either branch', async () => {
    const { writeUserDoc } = await import('../Onboarding');
    for (const exists of [true, false]) {
      vi.clearAllMocks();
      getDocMock.mockResolvedValue(exists ? { exists: () => true, data: () => ({}) } : { exists: () => false });
      await writeUserDoc(USER, { country: '', city: '' });
      const mock = exists ? updateDocMock : setDocMock;
      const [, payload] = mock.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      expect(payload.country, 'an unset country stays the empty string the state already holds')
        .toBe('');
      expect(payload.country).not.toBe('Unknown');
      expect(payload.country).not.toBe('Not set');
    }
  });

  it('🔴 nothing on this path substitutes a value for a missing country', () => {
    const ob = code('src/components/Onboarding.tsx');
    expect(ob).not.toMatch(/country\s*(\|\||\?\?)\s*['"]/);
    expect(ob).not.toContain("'Unknown'");
    expect(ob).not.toContain('"Unknown"');
    // The identity block a created document carries must not name country at
    // all — the answers are its only source.
    const creator = /await setDoc\(ref, \{([\s\S]*?)\n  \}\);/.exec(ob)?.[1] ?? '';
    expect(creator, 'the created document must not seed a country of its own').not.toContain('country');
  });

  it('the aggregate still files an empty country as unrecorded, not as a row', async () => {
    const { aggregateLocations, toMemberLocation } = await import('../dashboard/growth-data');
    const rows = [{ country: 'Kenya', city: 'Nairobi' }, { country: '', city: '' }, {}]
      .map((r) => toMemberLocation(r as Record<string, unknown>));
    const b = aggregateLocations(rows);
    expect(b.withCountry + b.countryUnrecorded).toBe(b.total);
    expect(b.countryUnrecorded).toBe(2);
    expect(b.rows.map((r) => r.country)).toEqual(['Kenya']);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 7b. 🔴 The payload the FUNNEL actually sends, end to end
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ Sections 5-9 exercise `writeUserDoc` directly, which proves what the writer
 * does with what it is handed but says nothing about what `saveToFirestore`
 * hands it. This walks the four steps a member walks and reads the ONE payload
 * that reached Firestore, so a field added to `updateData` — a sentinel country,
 * a client-side `plan`, a theme — is caught in the shape it would really ship.
 */

describe('7b. 🔴 the payload the funnel actually sends', () => {
  const capture = async () => {
    getDocMock.mockResolvedValue({ exists: () => false });
    await mountOnboarding();
    await completeQuestions();
    expect(setDocMock, 'the funnel never reached its save').toHaveBeenCalledTimes(1);
    return (setDocMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
  };

  it('carries the four answers, and completes onboarding', async () => {
    const p = await capture();
    expect(p.displayName).toBe('Ada Founder');
    expect(p.country).toBe('Kenya');
    expect(p.phone).toBe('+254700000000');
    expect(p.acceptedJesus).toBe(true);
    expect(p.onboardingCompleted).toBe(true);
  });

  it('🔴 and carries no plan, no theme and no invented consent', async () => {
    const p = await capture();
    for (const forbidden of ['plan', 'termsAccepted', 'newsletter']) {
      expect(Object.keys(p), `the funnel wrote ${forbidden}`).not.toContain(forbidden);
    }
    for (const k of Object.keys(p)) expect(k.toLowerCase()).not.toContain('theme');
  });

  it('🔴 country is the member’s own answer — never a sentinel', async () => {
    const p = await capture();
    expect(p.country).not.toBe('Unknown');
    expect(p.country).not.toBe('Not set');
    expect(p.country).toBe('Kenya');
  });

  it('🔴 and an UNANSWERED country would be written through as the empty string', async () => {
    // Reached through the writer rather than the funnel because `validate`
    // refuses to advance past an empty country — which is why the column is
    // sparse rather than wrong, and is the state #429's `countryUnrecorded`
    // counts. Asserting it here keeps the third state impossible on both paths.
    getDocMock.mockResolvedValue({ exists: () => false });
    const writeUserDoc = await loadWriter();
    await writeUserDoc(USER, { country: '' });
    const [, p] = setDocMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(p.country).toBe('');
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 8-9. No-regression: `plan` and the pre-auth theme
 * ═════════════════════════════════════════════════════════════════════════════ */

describe('8. nothing writes `plan` from the client', () => {
  it('🔴 not from onboarding, on either branch (#434)', async () => {
    getDocMock.mockResolvedValue({ exists: () => false });
    const { writeUserDoc } = await import('../Onboarding');
    await writeUserDoc(USER, { onboardingCompleted: true });
    const [, payload] = setDocMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(Object.keys(payload), 'the billing webhook is the single writer of plan')
      .not.toContain('plan');
  });

  it('and the source names no plan write at all', () => {
    const ob = code('src/components/Onboarding.tsx');
    expect(ob).not.toMatch(/\bplan:\s/);
  });
});

describe('9. no theme preference is written pre-auth', () => {
  it('🔴 THE-85 — the funnel is light-mode only and records no preference', async () => {
    getDocMock.mockResolvedValue({ exists: () => false });
    const { writeUserDoc } = await import('../Onboarding');
    await writeUserDoc(USER, { onboardingCompleted: true });
    const [, payload] = setDocMock.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    for (const k of Object.keys(payload)) expect(k.toLowerCase()).not.toContain('theme');
    const ob = code('src/components/Onboarding.tsx');
    expect(ob).not.toMatch(/theme/i);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 10. 🔴 Every other `updateDoc` on a possibly-missing document, ENUMERATED
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * 🔴 SOME OF THESE SHOULD FAIL LOUDLY, so this is a register with a verdict per
 * site and NOT a blanket conversion. `updateDoc` on a missing document throws
 * `not-found`; that is correct wherever the document is guaranteed to exist,
 * because a create there would invent a record nobody asked for.
 */

/** Every `users/{uid}` update outside this ticket's two sites, with a verdict. */
const USER_DOC_UPDATES: ReadonlyArray<{
  file: string; what: string; verdict: 'correct as written' | 'fixed by this ticket'; why: string;
}> = [
  {
    file: 'src/components/PersonalInformationModal.tsx',
    what: 'handleSave — the member edits their own profile',
    verdict: 'correct as written',
    why: 'Reached only from inside the signed-in app, where the document has already been read to '
      + 'populate the form. A create here would mint a profile for a member who has none, hiding the '
      + 'real fault. THE-321 already made its failure visible through a saveState machine and ui/alert.',
  },
  {
    file: 'src/lib/member-country.ts',
    what: 'saveMemberCountry — the in-app country prompt (THE-292)',
    verdict: 'correct as written',
    why: 'It refuses rather than coerces by design, and it runs behind shouldPromptForCountry, which '
      + 'has already read the document to decide whether to ask. Creating one from here would write a '
      + 'country onto an account that does not exist.',
  },
  {
    file: 'src/components/Profile.tsx',
    what: 'handleToggleNotifications — the preference and the push token',
    verdict: 'correct as written',
    why: 'A signed-in member on their own profile screen, which reads the document to render the '
      + 'toggle it is flipping. It already reverts the optimistic toggle on failure, so the refusal is '
      + 'visible in the control itself.',
  },
  {
    file: 'src/hooks/useCapacitorPush.ts',
    what: 'the native push registration listener',
    verdict: 'correct as written',
    why: 'Registers a device token for an account that must already exist to have signed in on the '
      + 'native shell. A create here would build a document from a push callback, with no tenant '
      + 'context in scope to put a tenantId in it.',
  },
  {
    file: 'src/components/AdminNavCustomizer.tsx',
    what: 'handleSave — an admin re-orders their own nav',
    verdict: 'correct as written',
    why: 'Only an admin inside the dashboard reaches it, and an admin necessarily has a document '
      + 'carrying the role that let them in. A nav layout is not a reason to create an account.',
  },
  {
    file: 'src/components/AdminRoles.tsx',
    what: 'an admin changes another member\u2019s role and permissions',
    verdict: 'correct as written',
    why: 'The subject is a member already listed on the Roles screen, which read the document to draw '
      + 'the row. A create here would mint an account the admin never invited, and would do it while '
      + 'writing a role \u2014 the exact field firestore.rules refuses on a self-edit.',
  },
  {
    file: 'src/components/CoursePage.tsx',
    what: 'lastWatchedVideo and completedLessons for the signed-in member',
    verdict: 'correct as written',
    why: 'Watch progress for a member who is enrolled, on a screen that has already read their '
      + 'document. Progress through a lesson is not a reason to create an account, and a document '
      + 'created from a video position would carry no tenant and no identity at all.',
  },
  {
    file: 'src/contexts/SavedItemsContext.tsx',
    what: 'savedItems.<key> \u2014 bookmarking and un-bookmarking',
    verdict: 'correct as written',
    why: 'A bookmark on an account that does not exist is not a bookmark. The context reads the '
      + 'document to hydrate the saved set before any write, so a rejection here means the account is '
      + 'broken and should say so rather than being papered over by a create.',
  },
  {
    file: 'src/components/ChurchOnboarding.tsx',
    what: 'the signup marker \u2014 already branches on existence',
    verdict: 'correct as written',
    why: 'THE-73 gave this the getDoc/updateDoc-or-setDoc shape this ticket then followed, including '
      + 'the decision to record no consent from a screen that presents none. It is the precedent, not '
      + 'a site needing a fix.',
  },
  {
    file: 'src/components/AuthPage.tsx',
    what: 'the termsAccepted refresh only on both sign-in paths (newsletter was removed because writing it on sign-in overwrote opt-outs)',
    verdict: 'fixed by this ticket',
    why: 'Left as updateDoc deliberately — a consent refresh must not create an account — but its '
      + 'catch no longer returns. Aborting there withheld the set-claims call that follows, so a '
      + 'member whose refresh was refused was signed in with no tenantId claim at all.',
  },
];

describe('10. 🔴 every other updateDoc on a possibly-missing document is reported', () => {
  it('the register names a real file for every entry', () => {
    for (const e of USER_DOC_UPDATES) {
      expect(() => statSync(path.join(REPO, e.file)), `${e.file} does not exist`).not.toThrow();
      expect(src(e.file), `${e.file} carries no updateDoc`).toContain('updateDoc(');
      expect(e.why.length, `${e.file}: a verdict without a reason is a shrug`).toBeGreaterThan(80);
    }
  });

  /**
   * 🔴 THE SWEEP IS CLOSED. Every `users`-document `updateDoc` in the tree is
   * either one of this ticket's two converted sites or a registered entry
   * above. A new one appears in this failure, with nowhere to hide.
   */
  it('🔴 no users-document updateDoc exists that the register does not name', () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        if (e === 'node_modules' || e === '__tests__') continue;
        const p = path.join(dir, e);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.tsx?$/.test(e)) continue;
        const body = code(path.relative(REPO, p));
        if (/updateDoc\(\s*doc\(\s*db,\s*'users'/.test(body) || /userRef/.test(body) && /updateDoc\(userRef/.test(body)) {
          found.push(path.relative(REPO, p).split(path.sep).join('/'));
        }
      }
    };
    walk(path.join(REPO, 'src'));
    const registered = new Set(USER_DOC_UPDATES.map((e) => e.file));
    const unregistered = found.filter((f) => !registered.has(f));
    expect(unregistered,
      'a users-document updateDoc appeared that no entry in USER_DOC_UPDATES gives a verdict for')
      .toEqual([]);
  });

  it('🔴 Onboarding.tsx is NOT among them any more — it was the two that were wrong', () => {
    const ob = code('src/components/Onboarding.tsx');
    expect(/updateDoc\(\s*doc\(\s*db,\s*'users'/.test(ob)).toBe(false);
  });

  it("AuthPage's consent refresh no longer aborts the set-claims call after it", () => {
    const ap = code('src/components/AuthPage.tsx');
    // The two creating writes still return — the account really was not made.
    expect((ap.match(/setError\('Your account could not be created\./g) ?? []).length).toBe(2);
    // 🔴 And neither creating write is silent any more: that was the root cause.
    const silent = /handleFirestoreError\(err, OperationType\.WRITE[^)]*\); \} catch \(e\) \{ console\.error\(e\); \}\s*\n\s*return;/;
    expect(silent.test(ap), 'a swallowed create with a bare return is the Silent-Failure Rule').toBe(false);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 11-13. Primitives, tap targets, colour
 * ═════════════════════════════════════════════════════════════════════════════ */

describe('11. every element that has a primitive uses it', () => {
  it('🔴 the error state is ui/alert, not hand-written markup', () => {
    const ob = code('src/components/Onboarding.tsx');
    expect(ob).toContain("from '@/components/ui/alert'");
    expect(ob).toMatch(/<Alert\s/);
    expect(ob).toContain('<AlertTitle>');
    expect(ob).toContain('<AlertDescription>');
  });

  it('🔴 the hand-written banner it replaced is gone, hexes and all', () => {
    const ob = src('src/components/Onboarding.tsx');
    for (const hex of ['#FBEEEA', '#EBD0C7', '#B0432B']) expect(ob).not.toContain(hex);
  });

  it('role="alert" is the primitive’s, not a hand-added attribute', () => {
    expect(code('src/components/ui/alert.tsx')).toContain('role="alert"');
    expect(code('src/components/Onboarding.tsx')).not.toContain('role="alert"');
  });

  it('⚠️ `accordion` is the one primitive not on disk, so nothing may import it', () => {
    const installed = readdirSync(path.join(REPO, 'src/components/ui'))
      .filter((f) => f.endsWith('.tsx')).map((f) => f.replace(/\.tsx$/, ''));
    expect(installed).toContain('alert');
    expect(installed).not.toContain('accordion');
    expect(code('src/components/Onboarding.tsx')).not.toContain('ui/accordion');
  });
});

describe('12. tap targets', () => {
  it('🔴 the alert is not a tap target and adds no control below sm', async () => {
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({}) });
    updateDocMock.mockRejectedValue(Object.assign(new Error('x'), { code: 'permission-denied' }));
    await mountOnboarding();
    setDocMock.mockRejectedValue(Object.assign(new Error('x'), { code: 'permission-denied' }));
    await completeQuestions();
    const banner = container.querySelector('[data-save-error]');
    expect(banner, 'the banner never rendered, so this measures nothing').not.toBeNull();
    expect(banner!.querySelectorAll('button, a, input, select').length,
      'a banner that adds a control adds a 44px floor with it').toBe(0);
  });

  it('⚠️ Rule 4’s 38px above sm is untouched by this ticket', async () => {
    const { DENSITY_PX } = await import('../layout/form-layout');
    expect(DENSITY_PX.control).toBeLessThan(44);
  });
});

describe('13. no colour hardcoded, no emoji; both palettes resolve', () => {
  const MINE = ['src/components/Onboarding.tsx', 'src/components/AuthPage.tsx'] as const;

  /**
   * ⚠️ CEILINGS AGAINST THE DOCUMENTED BASELINE, not a blanket ban.
   * `preauth-light.test.ts` measured these two files at 3 and 10 bare hexes on
   * a named revision and asserts `<=`: those are the Google mark's brand hexes
   * and the banner pairs that predate all of this. What must not happen is a
   * ticket ADDING one. THE-336 removes three and adds none, so onboarding's
   * ceiling is now zero and is asserted as zero.
   */
  const BARE_HEX_CEILING: Record<string, number> = {
    'src/components/Onboarding.tsx': 0,
    'src/components/AuthPage.tsx': 10,
  };

  const bareHexes = (rel: string) =>
    [...src(rel).replace(/var\(\s*--[a-z0-9-]+\s*,\s*#[0-9A-Fa-f]{3,8}\s*\)/gi, 'var(--x)')
      .matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((m) => m[0]);

  it('🔴 this ticket added no bare hex', () => {
    for (const rel of MINE) {
      const found = bareHexes(rel);
      expect(found.length, `${rel} is at ${found.length} bare hexes: ${found.join(', ')}`)
        .toBeLessThanOrEqual(BARE_HEX_CEILING[rel]);
    }
    expect(bareHexes('src/components/Onboarding.tsx'),
      'the banner hexes are gone and nothing replaced them').toEqual([]);
  });

  /**
   * ⚠️ A CEILING AGAIN, and AuthPage's `1` is real: a toggle's box-shadow has
   * carried an `rgba()` since long before this ticket. Onboarding has none and
   * is held at none.
   */
  const FN_COLOUR_CEILING: Record<string, number> = {
    'src/components/Onboarding.tsx': 0,
    'src/components/AuthPage.tsx': 1,
  };

  it('🔴 this ticket added no rgb()/hsl() literal either', () => {
    for (const rel of MINE) {
      const found = [...code(rel).matchAll(/\brgba?\(|\bhsla?\(/g)].map((m) => m[0]);
      expect(found.length, `${rel} is at ${found.length}: ${found.join(', ')}`)
        .toBeLessThanOrEqual(FN_COLOUR_CEILING[rel]);
    }
    expect([...code('src/components/Onboarding.tsx').matchAll(/\brgba?\(|\bhsla?\(/g)]).toEqual([]);
  });

  it('the alert paints from tokens, so every palette resolves it', () => {
    const a = code('src/components/ui/alert.tsx');
    expect(a).toMatch(/bg-card/);
    expect(a).toMatch(/text-destructive/);
    expect(a).not.toMatch(/#[0-9A-Fa-f]{6}\b/);
  });

  it('🔴 no emoji in anything this ticket renders', () => {
    // ⚠️ Comments carry the repo's 🔴/⚠️ marks by convention, so the check is on
    // the CODE — the strings that actually reach a screen — and not on the raw
    // file, which would fail on documentation working exactly as intended.
    for (const rel of MINE) {
      expect(code(rel), `${rel} renders an emoji`)
        .not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u);
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 14-16. What this suite is not allowed to do
 * ═════════════════════════════════════════════════════════════════════════════ */

const MY_TESTS = ['src/components/__tests__/THE-336.onboarding-user-doc.test.tsx'] as const;

describe('14. 🔴 no test here pins a line number', () => {
  /**
   * THE-331 pinned a component by file-and-line; a deletion elsewhere moved the
   * subject two hundred lines up and the suite would have MEASURED WHATEVER
   * LANDED THERE instead of failing. Everything above discovers by pattern.
   *
   * ⚠️ Checked against the CODE, comments stripped: a docblock may name a site
   * the way a sentence does, and prose is not an assertion. What may not happen
   * is an assertion that reads a line number.
   */
  it('every subject is discovered by pattern, never by file-and-line', () => {
    for (const t of MY_TESTS) {
      const inCode = [...code(t).matchAll(/\.tsx?:\d+/g)].map((m) => m[0]);
      expect(inCode, 'discover by pattern, never by line number').toEqual([]);
    }
  });
});

describe('15. 🔴 no fixture is pinned to a date near today', () => {
  it('#468 turned main red for everyone with a date three days out', () => {
    for (const t of MY_TESTS) {
      const dates = [...code(t).matchAll(/\d{4}-\d{2}-\d{2}/g)].map((m) => m[0]);
      expect(dates, 'use vi.useFakeTimers({ toFake: [Date] }) instead of a literal').toEqual([]);
    }
  });

  it('and the created document’s createdAt is generated, not a literal', () => {
    expect(code('src/components/Onboarding.tsx')).toContain('createdAt: new Date().toISOString()');
  });
});

describe('16. 🔴 no guard here asserts anything about the current branch’s diff', () => {
  /**
   * #454 is a standing sweep and this file is in scope for it. Blind spot on
   * card 86bbvhaky.
   *
   * ⚠️ THE NEEDLES ARE ASSEMBLED, NOT WRITTEN OUT, and that is not decoration:
   * a list of forbidden strings spelled literally appears in the very file it
   * searches, so the guard fails on its own vocabulary and gets deleted by
   * whoever it blocks. Assembling them means the only way this goes red is a
   * real one.
   */
  it('nothing here shells out to git or reads a revision range', () => {
    const needles = [
      ['exec', 'Sync'], ['child_', 'process'], ['git ', 'show'],
      ['git ', 'diff'], ['HEAD', '~'], ['merge-', 'base'], ['rev-', 'parse'],
    ].map(([a, b]) => a + b);
    for (const t of MY_TESTS) {
      const body = code(t);
      for (const needle of needles) {
        expect(body, `${t} reaches for the branch's own diff via "${needle}"`).not.toContain(needle);
      }
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 17. 🔴 The off-limits files, byte-identical
 * ═════════════════════════════════════════════════════════════════════════════ */

describe('17. firestore.rules, firestore.indexes.json, functions/ and layout.tsx are untouched', () => {
  /**
   * 🔴 `firestore.rules` AUTO-DEPLOYS TO PRODUCTION ON MERGE and CI runs no
   * emulator tests, so this ticket establishing that it needed no change is a
   * result in its own right. Recorded through #471's consolidated pin rather
   * than a fresh literal here, so a rule change is still one edit.
   */
  it('🔴 firestore.rules is at its pinned digest', async () => {
    const { rulesDigestFailure } = await import('../../__tests__/__fixtures__/firestore-rules-pin');
    expect(rulesDigestFailure()).toBeNull();
  });

  /**
   * ⚠️ Digests taken at authoring time from the file on disk and compared
   * against the file on disk — never against `git show`, which needs an object
   * database this runner does not always have.
   */
  it('firestore.indexes.json and layout.tsx are byte-identical', () => {
    expect(sha('firestore.indexes.json')).toBe(FROZEN_INDEXES);
    expect(sha('src/app/layout.tsx')).toBe(FROZEN_LAYOUT);
  });

  it('🔴 functions/ is byte-identical, as one digest over the whole tree', () => {
    const digests: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir).sort()) {
        if (e === 'node_modules' || e === 'lib') continue;
        const p = path.join(dir, e);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        const rel = path.relative(REPO, p).split(path.sep).join('/');
        digests.push(`${rel}:${sha(rel)}`);
      }
    };
    walk(path.join(REPO, 'functions', 'src'));
    expect(digests.length, 'functions/src disappeared — the walk found nothing').toBeGreaterThan(0);
    expect(createHash('sha256').update(digests.join('\n')).digest('hex')).toBe(FROZEN_FUNCTIONS);
  });

  it('⚠️ the Gmail scope guard still fails closed', () => {
    const rel = 'src/lib/gmail-scopes.ts';
    const body = src(rel);
    expect(body).toContain('assertSendOnlyGmailScopes');
    expect(body).toMatch(/throw/);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * 18. Ownership — the two files this ticket owns
 * ═════════════════════════════════════════════════════════════════════════════ */

describe('18. this ticket records what it changed', () => {
  it('🔴 Onboarding.tsx and AuthPage.tsx are at a recorded digest', () => {
    for (const f of ['src/components/Onboarding.tsx', 'src/components/AuthPage.tsx']) {
      expect(ownershipFailure(f)).toBeNull();
    }
  });

  it('the baseline-carrying guards still refuse an unrecorded edit', () => {
    expect(ownershipFailureWithBaseline(
      'src/components/Onboarding.tsx',
      'e0d3d0a6d10e0254bb9be0dc7df8cc2d81e1a65c7f65069e900f79142952f057',
    )).toBeNull();
    expect(ownershipFailureWithBaseline(
      'src/components/Onboarding.tsx',
      '0'.repeat(64),
      [],
    ), 'a digest that is neither the baseline nor recorded must still fail').not.toBeNull();
  });
});
