"use client";
import React, { useEffect, useRef, useState } from 'react';
import { User, Settings, CreditCard, ExternalLink, LogOut } from 'lucide-react';

const GOLD = 'var(--brand-color, #B8962E)';

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
 * `ownerId` OR by the admin roster) · Go to User App · Log out. Closes on
 * outside-click / Esc. Admin-side only — the user app has its own Profile tab.
 */
const MyAccountMenu: React.FC<MyAccountMenuProps> = ({
  photoURL, displayName, email, billingAccess, onOpenProfile, onOpenSettings, onOpenBilling, onGoToUserApp, onLogout,
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
        className="w-9 h-9 rounded-full overflow-hidden border border-line shadow-xs shrink-0 hover:opacity-90 transition-opacity focus:outline-hidden focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color,#B8962E)_35%,transparent)]"
      >
        <Avatar photoURL={photoURL} name={displayName} email={email} className="w-full h-full" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account menu"
          className="absolute right-0 top-11 z-[130] w-60 bg-surface-raised rounded-2xl border border-line shadow-[0_8px_30px_rgba(0,0,0,0.12)] overflow-hidden"
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
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-sunken transition-colors"
            >
              <User size={16} className="text-muted" />
              <span className="text-sm font-medium text-body">My Profile</span>
            </button>

            {onOpenSettings && (
              <button
                role="menuitem"
                onClick={() => run(onOpenSettings)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-sunken transition-colors"
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
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left opacity-60 cursor-default"
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
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-sunken transition-colors"
              >
                <CreditCard size={16} className="text-muted" />
                <span className="text-sm font-medium text-body">Billing &amp; Payments</span>
              </button>
            ) : null}

            {/* Go to User App — gold accent, mirroring the old More-drawer row.
                Hidden on desktop (lg:hidden): the branded top bar already has an
                "Open member app" pill there, so showing it here too would double it. */}
            <button
              role="menuitem"
              onClick={() => run(onGoToUserApp)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-sunken transition-colors lg:hidden"
            >
              <ExternalLink size={16} style={{ color: GOLD }} />
              <span className="text-sm font-semibold" style={{ color: GOLD }}>Go to User App</span>
            </button>

            <div className="my-1 border-t border-line-subtle" />

            <button
              role="menuitem"
              onClick={() => run(onLogout)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-red-50 transition-colors"
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
