'use client';
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebase';
import { useAppStore } from '@/store/useAppStore';
import { safeCommunityReturnPath } from '@/lib/community/navigation';

/** Free provisioning completes outside the auth callback. Observe that durable
 * completion too, then reload out of the signup handoff into the member route. */
export function CommunitySignupReturn() {
  const { currentUser } = useAppStore();
  const [error, setError] = useState('');
  useEffect(() => {
    const path = safeCommunityReturnPath(sessionStorage.getItem('harvest_community_return'));
    if (!path || !currentUser) return;
    let returned = false;
    return onSnapshot(doc(db, 'users', currentUser.uid), snapshot => {
      const person = snapshot.data();
      // Re-read the key: onboarding's own completion may already have
      // consumed it and navigated, and a second, full reload must not follow.
      if (!returned && person?.onboardingCompleted === true && person.signupInProgress !== true && person.tenantId
        && sessionStorage.getItem('harvest_community_return') === path) {
        returned = true;
        sessionStorage.removeItem('harvest_community_return');
        window.location.assign(path);
      }
    }, () => setError('Could not return to your community. Reload this page to try again.'));
  }, [currentUser?.uid]);
  return error ? <p role="alert" className="p-4">{error}</p> : null;
}
