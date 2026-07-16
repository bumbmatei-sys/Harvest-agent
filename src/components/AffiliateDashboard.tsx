'use client';

import React, { useCallback } from 'react';
import { LogOut } from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import AffiliateSection from './AffiliateSection';

// The same platform logo the auth screen (AuthShell) and OnboardingGate paint, so
// the affiliate surface stays visually continuous with the screen the affiliate
// just came from. No white-label branding here — an affiliate has no tenant.
const HARVEST_LOGO = 'https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png';

/**
 * Standalone shell for the affiliate dashboard on affiliate.theharvest.app.
 *
 * AffiliateSection is a bare section (no header, nav, or page chrome) that
 * AdminDashboard embeds inside its content area. On the affiliate host it has to
 * stand on its own, so this shell supplies the two things it would otherwise
 * inherit from a parent page: a header (logo + sign-out) and page padding on the
 * cream editorial ground — the same ground AuthShell/OnboardingGate use, reusing
 * the existing brand tokens. Nothing more: the founder hasn't asked for an
 * affiliate-specific design, and a marketer needs their link and their numbers,
 * not a landing page.
 *
 * Single-role, hard boundary: App.tsx renders this only for a tenant-less user on
 * the affiliate host, so it makes no tenant/church assumptions.
 */
const AffiliateDashboard: React.FC = () => {
  // Sign out → App.tsx's onAuthStateChanged fires with user=null and routes to
  // /auth, which on the affiliate host renders the affiliate auth copy. That path
  // is tenant-agnostic, so a tenant-less affiliate signs out cleanly.
  const handleSignOut = useCallback(async () => {
    try { await signOut(auth); } catch (e) { console.error('Error signing out:', e); }
  }, []);

  const email = auth.currentUser?.email;

  return (
    <div className="min-h-screen" style={{ background: 'var(--cream, #FAF8F5)' }}>
      <header className="flex items-center justify-between border-b border-stone-200 bg-white px-5 py-3.5 sm:px-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={HARVEST_LOGO} alt="Harvest affiliate" className="h-8 w-auto object-contain" />
        <div className="flex items-center gap-3">
          {email && (
            <span className="hidden text-sm sm:inline" style={{ color: 'var(--text-muted, #8B7355)' }}>
              {email}
            </span>
          )}
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-stone-100"
            style={{ color: 'var(--text-body, #4A4038)' }}
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </header>

      {/* Constrain to the same max-w-3xl AffiliateSection uses for its LOADED
          content, so its (unconstrained) loading skeleton doesn't render full-width
          and then snap to a centered column. Top-weighted padding: the section
          supplies its own bottom padding (pb-8), so we don't double it here. */}
      <main className="mx-auto max-w-3xl px-4 pt-8 sm:px-8 sm:pt-10">
        <AffiliateSection />
      </main>
    </div>
  );
};

export default AffiliateDashboard;
