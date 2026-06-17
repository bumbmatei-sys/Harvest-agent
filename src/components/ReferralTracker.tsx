'use client';

import { useEffect } from 'react';

/**
 * ReferralTracker — a client-side side-effect component.
 * Checks the URL for a ?ref=XXX parameter and, if found,
 * stores the referrerId in localStorage for later use.
 * Renders nothing visible.
 */
export default function ReferralTracker() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get('ref');
      if (ref && ref.trim().length > 0) {
        localStorage.setItem('affiliateReferrerId', ref.trim());
        // Clean the query param from the URL without reloading
        const url = new URL(window.location.href);
        url.searchParams.delete('ref');
        window.history.replaceState({}, '', url.toString());
      }
    } catch {
      // localStorage may be unavailable in some environments
    }
  }, []);

  return null;
}
