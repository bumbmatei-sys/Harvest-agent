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
        const data = JSON.stringify({ id: ref.trim(), ts: Date.now() });
        localStorage.setItem('affiliateReferrerId', data);
        // Clean the query param from the URL without reloading
        const url = new URL(window.location.href);
        url.searchParams.delete('ref');
        window.history.replaceState({}, '', url.toString());
      } else {
        // Check if stored referral has expired (30 days)
        const stored = localStorage.getItem('affiliateReferrerId');
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (parsed.ts && Date.now() - parsed.ts > 30 * 24 * 60 * 60 * 1000) {
              localStorage.removeItem('affiliateReferrerId');
            }
          } catch {
            // Legacy format (plain string) — migrate it
            localStorage.setItem('affiliateReferrerId', JSON.stringify({ id: stored, ts: Date.now() }));
          }
        }
      }
    } catch {
      // localStorage may be unavailable in some environments
    }
  }, []);

  return null;
}
