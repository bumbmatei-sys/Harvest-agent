"use client";
import React, { useEffect, useRef, useState } from 'react';
import { User, Settings, CreditCard, ExternalLink, BookOpen, LogOut } from 'lucide-react';

const GOLD = 'var(--brand-color, #B8962E)';

/**
 * 🔴 EVERY ROW'S CLASS STRING, IN ONE PLACE, AND IT CARRIES THE TOUCH FLOOR.
 *
 * ⚠️ `min-h-11` IS NEW AND IT FIXES A PRE-EXISTING DEFECT, measured in real
 * Chromium with transitions and animations suppressed:
 *
 *     before   380px: 40px      768px: 40px      1024/1280/1440px: 36.25px
 *     after    380px: 44px      768px: 44px      1024/1280/1440px: 39.875px
 *
 * `px-4 py-2.5` around `text-sm` computes to 40px, which is UNDER the 44px
 * touch floor below `sm`; above 1024 globals.css trims the rem base to 14.5px
 * and the same row computes to 36.25px, which is under Rule 4's 38px control
 * floor too. Every row in this menu was under both, and a dropdown row is a tap
 * target. THE-358 adds a row to this menu, so it brings the menu to the floor
 * rather than adding a seventh row that misses it — the sweep THE-357 did for
 * AdminSms's Buttons after #500 measured them.
 *
 * ⚠️ ONE `min-h-11` SERVES BOTH FLOORS, which is why there is no `sm:` variant:
 * 2.75rem is 44px below 1024 and 39.875px above it, inside Rule 4's band. That
 * is the same figure THE-334 measured for this component's rail trigger.
 *
 * 🔴 `w-full` IS LOAD-BEARING — THE-181's guard requires every `[role="menuitem"]`
 * in this file to carry it, on the ground that `w-full` inside a fixed `w-60`
 * menu means "fill the menu" rather than the unbounded-stretch defect the form
 * rules exist for. Keeping one shared string is what stops a new row missing it.
 */
const ROW = 'w-full flex items-center gap-3 px-4 py-2.5 min-h-11 text-left';
const ROW_HOVER = `${ROW} hover:bg-surface-sunken transition-colors`;

/**
 * "May this admin reach Billing & Payments?" — deliberately THREE-state.
 *
 * 'yes'/'no' are settled answers; 'unknown' means the parent is still resolving
 * one. Owner-by-roster membership lives on the server-only tenant_private doc,
 * so part of this answer is an ASYNC lookup where `ownerId` alone was a
 * synchronous field read. A boolean cannot hold that gap: `false` in flight is
 * indistinguishable from a settled "no", and the menu would render a denial it
 * cannot back. That substitution is what THE-64 cost — an async default is a
 * silent claim — so the unknown window gets its own state and its own render.
 */
export type BillingAccess = 'unknown' | 'yes' | 'no';

interface MyAccountMenuProps {
  /** Admin's profile photo — same source Profile.tsx reads (users/{uid}.photoURL). */
  photoURL?: string | null;
  displayName?: string | null;
  email?: string | null;
  /**
   * Gates the Billing item, three-state. 'yes' for each of the three identities
   * the server's `requireOwner` admits (src/lib/api-auth.ts): the super admin,
   * the buyer by `tenants/{id}.ownerId`, and an owner-by-roster from
   * `tenant_private.adminEmails`. While 'unknown' the row renders as a busy
   * placeholder — never as an absence, which would claim a "no" we do not have.
   */
  billingAccess: BillingAccess;
  onOpenProfile: () => void;
  /** When provided, the Settings item is shown. The parent passes this only when
   *  the admin is entitled to Settings (canSettings), so absence hides the row. */
  onOpenSettings?: () => void;
  /**
   * THE-334 — which surface this menu is on: the top BAR (the default, and
   * every pre-existing caller) or the nav RAIL.
   *
   * It sets two things together because they are one decision. On the rail the
   * avatar is pinned to the FLOOR of a full-height column, so the menu opens
   * UPWARD — downward from there is off the bottom of the viewport — and the
   * trigger is `w-11 h-11` rather than `w-9 h-9`, because on the rail it is a
   * NAV TARGET (the only path from the rail to Settings) rather than an
   * identity affordance beside a row of other controls. ⚠️ At 36px it measured
   * 32.6px on desktop, under Rule 4's own `DENSITY_PX.control` floor of 38;
   * at 44px it measures 39.875px, inside the band. The top bar is untouched.
   *
   * `'below'` (the default, and every pre-existing caller's behaviour, byte for
   * byte) drops it under the avatar and right-aligned, which is right for the
   * top bar. `'above'` is for the NAV RAIL, where the avatar is pinned to the
   * FLOOR of a full-height column: a menu opening downward from there would
   * open off the bottom of the viewport. It opens upward and to the right
   * instead, out of the rail rather than across it.
   *
   * ⚠️ The panel stays `w-60` and its rows stay `w-full` in both, so THE-181's
   * guard on this file still holds.
   */
  variant?: 'bar' | 'rail';
  /** When provided AND billingAccess is 'yes', the Billing & Payments item is shown. */
  onOpenBilling?: () => void;
  /** Open the member app (same one-shot-intent action the More drawer used). The
   *  menu row is mobile-only; desktop keeps its "Open member app" top-bar pill. */
  onGoToUserApp: () => void;
  onLogout: () => void;
}

/** Initials fallback derived from the admin's name (or email). */
function initialsOf(name?: string | null, email?: string | null): string {
  const src = (name || '').trim() || (email || '').trim();
  if (!src) return 'A';
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

const Avatar: React.FC<{ photoURL?: string | null; name?: string | null; email?: string | null; className?: string }> = ({
  photoURL, name, email, className,
}) => (
  <div className={`rounded-full overflow-hidden shrink-0 flex items-center justify-center bg-surface-sunken ${className || ''}`}>
    {photoURL ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={photoURL} alt="Profile" className="w-full h-full object-cover" />
    ) : (
      <span className="w-full h-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: GOLD }}>
        {initialsOf(name, email)}
      </span>
    )}
  </div>
);

/**
 * Circular avatar button (admin header, top-right) that opens a small dropdown
 * with My Profile · Settings (if entitled) · Billing & Payments (owners, by
 * `ownerId` OR by the admin roster) · Documentation · Go to User App · Log out.
 * Closes on outside-click / Esc. Admin-side only — the user app has its own
 * Profile tab, and the docs are written for church ADMINS, so the member app
 * does not link them.
 */
const MyAccountMenu: React.FC<MyAccountMenuProps> = ({
  photoURL, displayName, email, billingAccess, onOpenProfile, onOpenSettings, onOpenBilling, onGoToUserApp, onLogout,
  variant = 'bar',
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = (fn?: () => void) => { setOpen(false); fn?.(); };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="My account"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${
          variant === 'rail' ? 'w-11 h-11' : 'w-9 h-9'
        } rounded-full overflow-hidden border border-line shadow-xs shrink-0 hover:opacity-90 transition-opacity focus:outline-hidden focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color,#B8962E)_35%,transparent)]`}
      >
        <Avatar photoURL={photoURL} name={displayName} email={email} className="w-full h-full" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account menu"
          className={`absolute z-[130] w-60 bg-surface-raised rounded-2xl border border-line shadow-[0_8px_30px_rgba(0,0,0,0.12)] overflow-hidden ${
            variant === 'rail' ? 'left-0 bottom-11' : 'right-0 top-11'
          }`}
        >
          {/* Identity header */}
          <div className="px-4 py-3 border-b border-line-subtle flex items-center gap-3">
            <Avatar photoURL={photoURL} name={displayName} email={email} className="w-9 h-9" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-strong truncate">{displayName || 'Admin'}</p>
              {email && <p className="text-xs text-faint truncate">{email}</p>}
            </div>
          </div>

          <div className="py-1">
            <button
              role="menuitem"
              onClick={() => run(onOpenProfile)}
              className={ROW_HOVER}
            >
              <User size={16} className="text-muted" />
              <span className="text-sm font-medium text-body">My Profile</span>
            </button>

            {onOpenSettings && (
              <button
                role="menuitem"
                onClick={() => run(onOpenSettings)}
                className={ROW_HOVER}
              >
                <Settings size={16} className="text-muted" />
                <span className="text-sm font-medium text-body">Settings</span>
              </button>
            )}

            {/* Billing & Payments. The unknown window renders a BUSY row rather
                than nothing: hiding it would tell the admin they have no billing
                access at the one moment we do not yet know, which is the exact
                shape of THE-64. It resolves in place to the real row or to
                nothing once the roster answers. */}
            {billingAccess === 'unknown' ? (
              <div
                role="menuitem"
                aria-disabled="true"
                aria-busy="true"
                className={`${ROW} opacity-60 cursor-default`}
              >
                <CreditCard size={16} className="text-muted" />
                <span className="text-sm font-medium text-body">Billing &amp; Payments</span>
                <span
                  aria-hidden="true"
                  className="ml-auto h-3 w-3 rounded-full border-2 border-line border-t-transparent animate-spin"
                />
              </div>
            ) : billingAccess === 'yes' && onOpenBilling ? (
              <button
                role="menuitem"
                onClick={() => run(onOpenBilling)}
                className={ROW_HOVER}
              >
                <CreditCard size={16} className="text-muted" />
                <span className="text-sm font-medium text-body">Billing &amp; Payments</span>
              </button>
            ) : null}

            {/* 🔴 DOCUMENTATION — the live docs site, docs.theharvest.site.
                It existed for a while with nothing in either product linking to
                it; this is the admin app's link to it.

                ⚠️ BELOW BILLING & PAYMENTS, DELIBERATELY. Billing is a
                destructive-adjacent destination people go to on purpose and
                reach by muscle memory; a new row ABOVE it moves a target they
                already know, and the one time that matters is the time somebody
                is trying to cancel. Documentation is a reference people browse
                to, so it takes the new position rather than displacing the
                item that cannot afford to move.

                🔴 NOT GATED. Every admin can read the docs — there is no
                entitlement to check and nothing to hide, so this row carries no
                condition at all, unlike Settings and Billing above it.

                🔴 AN <a>, NOT A BUTTON, and it does not go through `run()`.
                This leaves the app for another origin: `target="_blank"` so the
                admin's place in the app survives, and `rel="noopener"` so the
                opened page gets no `window.opener` handle back. `onClick` only
                closes the menu — the navigation is the anchor's own, so it
                still works middle-clicked or opened from the keyboard, which a
                button with a handler would not. */}
            <a
              role="menuitem"
              href="https://docs.theharvest.site"
              target="_blank"
              rel="noopener"
              onClick={() => setOpen(false)}
              className={ROW_HOVER}
            >
              <BookOpen size={16} className="text-muted" />
              <span className="text-sm font-medium text-body">Documentation</span>
            </a>

            {/* Go to User App — gold accent, mirroring the old More-drawer row.
                Hidden on desktop (lg:hidden): the branded top bar already has an
                "Open member app" pill there, so showing it here too would double it. */}
            <button
              role="menuitem"
              onClick={() => run(onGoToUserApp)}
              className={`${ROW_HOVER} lg:hidden`}
            >
              <ExternalLink size={16} style={{ color: GOLD }} />
              <span className="text-sm font-semibold" style={{ color: GOLD }}>Go to User App</span>
            </button>

            <div className="my-1 border-t border-line-subtle" />

            <button
              role="menuitem"
              onClick={() => run(onLogout)}
              className={`${ROW} hover:bg-red-50 transition-colors`}
            >
              <LogOut size={16} className="text-red-500" />
              <span className="text-sm font-semibold text-red-600">Log out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MyAccountMenu;
