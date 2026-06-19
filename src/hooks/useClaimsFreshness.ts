'use client';
import { useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '@/firebase';

/**
 * Listens for claimsUpdatedAt changes on the user's Firestore doc
 * and force-refreshes the Firebase ID token to pick up new custom claims.
 *
 * This fixes the Firebase limitation where setCustomUserClaims() doesn't
 * propagate until the token is refreshed. By watching the timestamp,
 * we know when to force a refresh.
 *
 * Mount this once in App.tsx so it's active for all pages.
 */
export function useClaimsFreshness() {
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    let lastKnownTimestamp: string | null = null;

    const unsub = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        const ts = data.claimsUpdatedAt;

        if (ts && ts !== lastKnownTimestamp) {
          if (lastKnownTimestamp !== null) {
            // Not the first read — claims changed, force refresh
            user.getIdToken(true).catch((err) => {
              console.error('Failed to refresh token after claims update:', err);
            });
          }
          lastKnownTimestamp = ts;
        }
      },
      (err) => {
        // Silent — don't break the app if the listener fails
        console.error('Claims freshness listener error:', err);
      }
    );

    return () => unsub();
  }, []);
}
