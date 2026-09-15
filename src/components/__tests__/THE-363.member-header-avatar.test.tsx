import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE-363 · THE-141 — a member with a photo saw their initial in the header.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The finding: the photo is READ, from the wrong place ────────────────────
 *
 * Not missing, and not read-and-not-rendered. There are TWO `photoURL` fields
 * and the header was reading the other one:
 *
 *   `users/{uid}.photoURL`       the FIRESTORE user document. Written whenever
 *                                a member uploads a photo.
 *   `auth.currentUser.photoURL`  the FIREBASE AUTH profile. Written by the
 *                                identity provider at sign-in.
 *
 * Six surfaces show a member's face — Profile, PersonalInformationModal,
 * AdminCRM, AdminCommunity's MessageAvatar, UserMessages, NewsTab — and every
 * one reads the FIRESTORE field. The desktop header in MainApp read
 * `useAppStore().currentUser`, which is the Firebase Auth `User` object
 * `onAuthStateChanged` puts in the store. THAT is why the header was the odd
 * one out: one surface asking a different question than the other six.
 *
 * ── 🔴 WHY IT LOOKED INTERMITTENT ───────────────────────────────────────────
 *
 * GOOGLE SIGN-IN populates the Auth profile itself (an
 * `lh3.googleusercontent.com` URL), so those members' photos rendered and the
 * founder's own record looked correct.
 *
 * AN EMAIL/PASSWORD MEMBER WHO UPLOADS ONE never reaches the Auth profile.
 * Profile.tsx encodes the upload as a data URI — `canvas.toDataURL` — writes it
 * to the Firestore document, and then attempts `updateProfile` with the same
 * kilobytes-long string. Firebase Auth will not hold a `photoURL` that size, so
 * that call rejects and is caught; the Firestore write has already landed. The
 * photo IS saved, the profile screen shows it, and the header showed a letter.
 *
 * ⚠️ THE LETTER AVATAR IS THE FALLBACK AND STAYS THE FALLBACK — section 2.
 *
 * NO LINE NUMBER IS PINNED ANYWHERE IN THIS FILE.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const authUser = vi.hoisted(() => ({
  current: null as null | { uid: string; photoURL: string | null; displayName: string | null },
}));
/** What `users/{uid}` holds, or an error to reject the listener with. */
const userDoc = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
  exists: true,
  failWith: null as Error | null,
  /** A snapshot object with no `exists`/`data` methods — the shape another
   *  suite's `onSnapshot` mock really hands back. */
  malformed: false,
}));

vi.mock('../../firebase', () => ({
  db: {},
  get auth() {
    return { currentUser: authUser.current };
  },
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  query: (col: any) => ({ __path: col?.__path }),
  where: () => ({}),
  limit: () => ({}),
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  getDocs: async () => ({ docs: [], forEach: () => {} }),
  onSnapshot: (_ref: unknown, next: (snap: unknown) => void, onError?: (e: Error) => void) => {
    if (userDoc.failWith) {
      onError?.(userDoc.failWith);
      return () => {};
    }
    next(userDoc.malformed
      ? ({} as unknown)
      : { exists: () => userDoc.exists, data: () => userDoc.current ?? {} });
    return () => {};
  },
}));

vi.mock('../../utils/tenant-scope', () => ({
  getTenantScope: async () => 'tenant-1',
  getWriteTenantScope: async () => 'tenant-1',
  hasPlatformOverride: () => false,
  PLATFORM_TENANT_ID: 'harvest',
}));

const firestoreErrors = vi.hoisted(() => ({ handled: [] as string[] }));
vi.mock('../../utils/firestore-errors', () => ({
  OperationType: { GET: 'get', UPDATE: 'update', DELETE: 'delete' },
  handleFirestoreError: (_e: unknown, _op: unknown, path: string) => {
    firestoreErrors.handled.push(path);
  },
}));

// Every screen the header can open is stubbed; none is under test.
const stub = vi.hoisted(() => (name: string) => ({ default: () => <div data-testid={name} /> }));
vi.mock('../Profile', () => stub('profile'));
vi.mock('../PartnerWithUsTab', () => stub('partner'));
vi.mock('../BlogTab', () => stub('blog'));
vi.mock('../NewsTab', () => stub('news'));
vi.mock('../PrayerWall', () => stub('prayer'));
vi.mock('../AllNews', () => stub('all-news'));
vi.mock('../../components/CoursePage', () => stub('courses'));
vi.mock('../AIChat', () => stub('chat'));
vi.mock('../UserMessages', () => stub('messages'));
vi.mock('../BiblePage', () => stub('bible'));
vi.mock('../ReferralTracker', () => stub('referral'));
vi.mock('../LiveNowBanner', () => stub('live-banner'));
vi.mock('../LivestreamView', () => stub('livestream'));
vi.mock('../ChurchMap', () => stub('map'));
vi.mock('../ErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../layout/DesktopLayout', () => ({
  DesktopContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/dynamic', () => ({ default: () => () => <div data-testid="dynamic" /> }));
vi.mock('framer-motion', () => {
  const passthrough = new Proxy(
    {},
    { get: () => ({ children, ...rest }: any) => <div {...{ className: rest.className }}>{children}</div> },
  );
  return { motion: passthrough, AnimatePresence: ({ children }: any) => <>{children}</> };
});

const store = vi.hoisted(() => ({ tenantPlan: 'plus' as string | null, currentUser: null as any }));
vi.mock('../../store/useAppStore', () => ({ useAppStore: () => store }));

const tenant = vi.hoisted(() => ({
  tenantId: 'tenant-1',
  tenantName: 'Grace Chapel',
  branding: null as any,
  tenantPlan: 'plus' as string | null,
  tenantAddons: null as any,
  isLoading: false,
  stripeConnectStatus: undefined,
}));
vi.mock('../../contexts/TenantContext', () => ({ useTenant: () => tenant }));

import MainApp from '../MainApp';
import { memberInitial } from '../../hooks/useMemberPhoto';
import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';

const SRC = join(process.cwd(), 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/** A Google member: the provider filled the Auth profile in. */
const GOOGLE_PHOTO = 'https://lh3.googleusercontent.com/a/ACg8ocK-example=s96-c';
/** An email/password member's upload: a data URI, as Profile.tsx encodes it. */
const UPLOADED_PHOTO =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD_this_is_kilobytes_long';

let container: HTMLDivElement;
let root: Root;

async function mount() {
  await act(async () => {
    root = createRoot(container);
    root.render(<MainApp onNavigate={() => {}} />);
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

/** The header avatar control. */
const avatar = () => container.querySelector('[data-testid="member-header-avatar"]');
/** The rendered <img>, if the header is showing a photo. */
const avatarImage = () => (avatar()?.querySelector('img') ?? null) as HTMLImageElement | null;
/** The letter fallback, if the header is showing one. */
const avatarFallback = () => avatar()?.querySelector('span') ?? null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  authUser.current = null;
  userDoc.current = null;
  userDoc.exists = true;
  userDoc.failWith = null;
  userDoc.malformed = false;
  firestoreErrors.handled = [];
  store.currentUser = null;
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
});

// ═════════════════════════════════════════════════════════════════════════════
// 1 · A member with a photo sees their photo in the header
// ═════════════════════════════════════════════════════════════════════════════

describe('a member with a photo sees their photo in the header', () => {
  it('renders the photo from the FIRESTORE user document', async () => {
    // The exact shape the defect hid: nothing on the Auth profile, a real photo
    // on the user document. Before this ticket the header showed 'A'.
    authUser.current = { uid: 'u1', photoURL: null, displayName: 'Ana Pop' };
    store.currentUser = { uid: 'u1', photoURL: null, displayName: 'Ana Pop' };
    userDoc.current = { photoURL: UPLOADED_PHOTO, displayName: 'Ana Pop' };

    await mount();

    const img = avatarImage();
    expect(img, 'the header must render an image, not a letter').not.toBeNull();
    expect(img!.getAttribute('src')).toBe(UPLOADED_PHOTO);
  });

  it('renders it through the element the header already had', async () => {
    // 🔴 THE `ui/avatar` ADOPTION IS SPLIT OUT, and this asserts the split held.
    // Swapping this <img>/<span> pair for the primitive is a PRESENTATION change
    // the defect does not need, and it moves this header's tags, class literals,
    // colour tokens and rendered-row inventory — six assertions across three
    // frozen baselines, each needing its own reversible fold. `main` went red
    // for everyone once because a PR replaced a pinned baseline. So the FIELD
    // changed and the markup did not.
    authUser.current = { uid: 'u1', photoURL: null, displayName: 'Ana Pop' };
    store.currentUser = { uid: 'u1', photoURL: null, displayName: 'Ana Pop' };
    userDoc.current = { photoURL: UPLOADED_PHOTO };

    await mount();

    const img = avatarImage()!;
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('referrerPolicy') ?? img.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('prefers the UPLOAD when the provider also supplied one', async () => {
    // A Google member who later uploads their own photo must see the upload —
    // it is the newer of the two, and it is the one they chose.
    authUser.current = { uid: 'u1', photoURL: GOOGLE_PHOTO, displayName: 'Ana Pop' };
    store.currentUser = { uid: 'u1', photoURL: GOOGLE_PHOTO, displayName: 'Ana Pop' };
    userDoc.current = { photoURL: UPLOADED_PHOTO };

    await mount();

    expect(avatarImage()!.getAttribute('src')).toBe(UPLOADED_PHOTO);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · A member with NO photo still sees the letter avatar  (the fallback survives)
// ═════════════════════════════════════════════════════════════════════════════

describe('a member with no photo still sees the letter avatar', () => {
  it('renders the initial when neither field carries a photo', async () => {
    authUser.current = { uid: 'u1', photoURL: null, displayName: 'Ana Pop' };
    store.currentUser = { uid: 'u1', photoURL: null, displayName: 'Ana Pop' };
    userDoc.current = { displayName: 'Ana Pop' };

    await mount();

    expect(avatarImage(), 'no photo means no image element').toBeNull();
    const fallback = avatarFallback();
    expect(fallback, 'the letter avatar must still render').not.toBeNull();
    expect(fallback!.textContent).toBe('A');
  });

  it('falls back to U for a member with no display name at all', async () => {
    authUser.current = { uid: 'u1', photoURL: null, displayName: null };
    store.currentUser = { uid: 'u1', photoURL: null, displayName: null };
    userDoc.current = {};

    await mount();

    expect(avatarFallback()!.textContent).toBe('U');
    // The rule itself, so the header and the helper cannot drift apart.
    expect(memberInitial(null)).toBe('U');
    expect(memberInitial('   ')).toBe('U');
    expect(memberInitial('ana')).toBe('A');
  });

  it('a MALFORMED snapshot does not take the shell down', async () => {
    // 🔴 The snapshot callback runs outside React's render and outside any
    // error boundary, so a throw there is an UNCAUGHT exception that blanks the
    // member app — for a profile photo. A snapshot that is not the expected
    // shape must fall back to the letter, quietly and without crashing.
    authUser.current = { uid: 'u1', photoURL: null, displayName: 'Ana Pop' };
    store.currentUser = { uid: 'u1', photoURL: null, displayName: 'Ana Pop' };
    userDoc.malformed = true;

    await mount();

    expect(avatarFallback()!.textContent).toBe('A');
  });

  it('a FAILED read surfaces as a failure, and still shows the letter', async () => {
    // 🔴 A failed read must never be indistinguishable from "this member has no
    // photo". The control still renders — a broken read must not blank it — but
    // the failure goes through the same funnel every other reader uses.
    authUser.current = { uid: 'u1', photoURL: null, displayName: 'Ana Pop' };
    store.currentUser = { uid: 'u1', photoURL: null, displayName: 'Ana Pop' };
    userDoc.failWith = new Error('permission-denied');

    await mount();

    expect(firestoreErrors.handled, 'the read failure must be reported').toContain('users/u1');
    expect(avatarFallback()!.textContent).toBe('A');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · It works for BOTH Google and email/password sign-ups
// ═════════════════════════════════════════════════════════════════════════════

describe('it works for both Google and email sign-ups', () => {
  it('Google sign-in: the provider photo renders even before the document lands', async () => {
    // The Auth profile is seeded synchronously, so a Google member's photo is
    // correct on the FIRST paint rather than after a round trip.
    authUser.current = { uid: 'u1', photoURL: GOOGLE_PHOTO, displayName: 'Ana Pop' };
    store.currentUser = { uid: 'u1', photoURL: GOOGLE_PHOTO, displayName: 'Ana Pop' };
    // The document has no photo of its own — a Google member who never uploaded.
    userDoc.current = { displayName: 'Ana Pop' };

    await mount();

    expect(avatarImage()!.getAttribute('src')).toBe(GOOGLE_PHOTO);
  });

  it('email/password sign-up: the uploaded photo renders though Auth never got it', async () => {
    // Reproduces the split exactly: Auth empty (the `updateProfile` call with a
    // data URI rejected), Firestore holding the real upload.
    authUser.current = { uid: 'u2', photoURL: null, displayName: 'Ion Radu' };
    store.currentUser = { uid: 'u2', photoURL: null, displayName: 'Ion Radu' };
    userDoc.current = { photoURL: UPLOADED_PHOTO, displayName: 'Ion Radu' };

    await mount();

    expect(avatarImage()!.getAttribute('src')).toBe(UPLOADED_PHOTO);
    expect(avatarFallback()?.textContent ?? '').not.toBe('I');
  });

  it('the header no longer reads the Auth profile as its only source', () => {
    // The defect, pinned by CONTENT. Needles assembled from fragments so they
    // cannot match their own spelling in this file (#504 shipped three guards
    // that did exactly that).
    const src = stripComments(read('components/MainApp.tsx'));
    const authOnly = ['currentUser', '?.', 'photoURL'].join('');
    expect(src, 'the header must not read the Auth photo directly').not.toContain(authOnly);

    const hook = ['useMember', 'Photo'].join('');
    expect(src).toContain(hook);
  });

  it('the hook reads the Firestore user document, not just the Auth profile', () => {
    const src = stripComments(read('hooks/useMemberPhoto.ts'));
    expect(src).toContain(["'", 'users', "'"].join(''));
    const listener = ['onSnap', 'shot'].join('');
    expect(src).toContain(listener);
  });
});
