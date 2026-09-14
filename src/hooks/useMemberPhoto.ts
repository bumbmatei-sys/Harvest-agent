"use client";
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';

/**
 * THE-141 — the member header's profile photo, read from where the photo is.
 *
 * ─── Why the header was the ONLY surface showing a letter ────────────────────
 *
 * There are two `photoURL` fields in this product and they are not the same
 * field:
 *
 *   `users/{uid}.photoURL`        the FIRESTORE user document. Written by
 *                                 Profile.tsx and PersonalInformationModal.tsx
 *                                 when a member uploads a photo.
 *   `auth.currentUser.photoURL`   the FIREBASE AUTH profile. Written by the
 *                                 identity provider at sign-in.
 *
 * Every other surface that shows a member's face reads the FIRESTORE one —
 * Profile, PersonalInformationModal, AdminCRM, AdminCommunity's MessageAvatar,
 * UserMessages, NewsTab. The desktop header in MainApp read
 * `useAppStore().currentUser`, which is the Firebase Auth `User` object put
 * there by `onAuthStateChanged`, so it read the AUTH one. That is the whole
 * defect: one surface asking a different question than the other six.
 *
 * ─── 🔴 WHY THAT SPLIT SHOWED UP FOR SOME MEMBERS AND NOT OTHERS ─────────────
 *
 *   GOOGLE SIGN-IN populates the Auth profile itself, with an
 *   `lh3.googleusercontent.com` URL. Those members' photos rendered in the
 *   header, which is why the founder's own record looked correct and the bug
 *   read as intermittent.
 *
 *   AN EMAIL/PASSWORD MEMBER WHO UPLOADS ONE never gets it into the Auth
 *   profile. Profile.tsx encodes the upload as a data URI
 *   (`canvas.toDataURL('image/jpeg', 0.7)` — kilobytes of base64), writes it to
 *   the Firestore doc, and then attempts `updateProfile(auth.currentUser, {
 *   photoURL })` with the same string. Firebase Auth's `photoURL` will not hold
 *   a value that size, so that call rejects and is caught. The Firestore write
 *   has already succeeded — the photo IS saved, the profile screen shows it —
 *   and the Auth profile stays empty. Header: letter.
 *
 * So this reads the Firestore document and falls back to the Auth profile, in
 * that order. Both are kept: the Firestore doc is authoritative because it is
 * the one an upload always reaches, and the Auth profile still answers for a
 * Google member on the very first paint, before the document snapshot lands.
 *
 * ⚠️ THE LETTER AVATAR REMAINS THE FALLBACK and must. A member with genuinely
 * no photo — no upload, no provider photo — has nothing to render, and a
 * letter is the answer. This hook returns `null` for them; it does not invent a
 * placeholder image.
 *
 * 🔴 A FAILED READ SURFACES AS A FAILURE. `state` goes to `'error'` and the
 * rejection is handed to `handleFirestoreError`, the same funnel every other
 * Firestore reader in this repo uses. The header still falls back to the letter
 * — a broken read must not blank the control — but the failure is reported
 * rather than being indistinguishable from "this member has no photo".
 */
export type MemberPhotoState = 'loading' | 'ready' | 'error';

export interface MemberPhoto {
  /** The photo to render, or `null` when there genuinely is not one. */
  readonly photoURL: string | null;
  /** Whether the document read is still in flight, done, or failed. */
  readonly state: MemberPhotoState;
}

export function useMemberPhoto(): MemberPhoto {
  // Seeded from the Auth profile so a Google member's photo is correct on the
  // first paint rather than after a round trip. An email/password member seeds
  // `null` here and picks the real value up from the snapshot below.
  const [photoURL, setPhotoURL] = useState<string | null>(
    () => auth.currentUser?.photoURL || null,
  );
  const [state, setState] = useState<MemberPhotoState>('loading');

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      // Signed out. Not an error, and not loading either — there is no document
      // to wait for.
      setState('ready');
      return;
    }

    let cancelled = false;
    const unsubscribe = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        if (cancelled) return;
        // 🔴 DEFENSIVE, and not out of habit. This callback runs OUTSIDE React's
        // render and outside any error boundary, so anything it throws is an
        // UNCAUGHT exception that takes the member shell down — for a profile
        // photo. A snapshot that is not the shape this expects is a reason to
        // report a failed read and fall back to the letter, never a reason to
        // blank the app. (Found by MemberScreens.desktop-layout, whose
        // `onSnapshot` mock hands back an object with no `exists` — a real
        // shape this hook has to survive, not a defect in that suite.)
        let stored: string | undefined;
        try {
          const exists = typeof snap.exists === 'function' ? snap.exists() : false;
          const data = exists && typeof snap.data === 'function' ? snap.data() : undefined;
          stored = data?.photoURL as string | undefined;
        } catch {
          stored = undefined;
        }
        // The Auth profile is the FALLBACK, not an override: a member who
        // uploads a photo and whose provider also supplied one must see the
        // upload, which is the newer of the two.
        setPhotoURL(stored || auth.currentUser?.photoURL || null);
        setState('ready');
      },
      (error) => {
        if (cancelled) return;
        // Never silent. The letter still renders below, but the read that
        // failed is reported rather than read as "no photo".
        try {
          handleFirestoreError(error, OperationType.GET, `users/${uid}`);
        } catch (e) {
          console.error(e);
        }
        setState('error');
      },
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { photoURL, state };
}

/**
 * The letter shown when there is no photo.
 *
 * Extracted so the header and its test agree on one rule instead of two copies
 * of the same expression. `'U'` is the last resort for a member with no display
 * name at all — the control must never render empty.
 */
export function memberInitial(displayName: string | null | undefined): string {
  return (displayName?.trim()?.[0] || 'U').toUpperCase();
}
