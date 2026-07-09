"use client";
import React, { useEffect, useRef, useState } from 'react';
import { User, CreditCard, LogOut } from 'lucide-react';

const GOLD = 'var(--brand-color, #B8962E)';

interface MyAccountMenuProps {
  /** Admin's profile photo — same source Profile.tsx reads (users/{uid}.photoURL). */
  photoURL?: string | null;
  displayName?: string | null;
  email?: string | null;
  /** True only for the plan owner (tenant.ownerId). Gates the Billing item. */
  isOwner: boolean;
  onOpenProfile: () => void;
  /** When provided AND isOwner, the Billing & Payments item is shown. */
  onOpenBilling?: () => void;
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
  <div className={`rounded-full overflow-hidden shrink-0 flex items-center justify-center bg-stone-100 ${className || ''}`}>
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
 * with My Profile · Billing & Payments (owner only) · Log out. Closes on
 * outside-click / Esc. Admin-side only — the user app has its own Profile tab.
 */
const MyAccountMenu: React.FC<MyAccountMenuProps> = ({
  photoURL, displayName, email, isOwner, onOpenProfile, onOpenBilling, onLogout,
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
        className="w-9 h-9 rounded-full overflow-hidden border border-stone-200 shadow-sm shrink-0 hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color,#B8962E)_35%,transparent)]"
      >
        <Avatar photoURL={photoURL} name={displayName} email={email} className="w-full h-full" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account menu"
          className="absolute right-0 top-11 z-[130] w-60 bg-white rounded-2xl border border-stone-200 shadow-[0_8px_30px_rgba(0,0,0,0.12)] overflow-hidden"
        >
          {/* Identity header */}
          <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-3">
            <Avatar photoURL={photoURL} name={displayName} email={email} className="w-9 h-9" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-earth truncate">{displayName || 'Admin'}</p>
              {email && <p className="text-xs text-[color:var(--text-faint)] truncate">{email}</p>}
            </div>
          </div>

          <div className="py-1">
            <button
              role="menuitem"
              onClick={() => run(onOpenProfile)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-stone-100 transition-colors"
            >
              <User size={16} className="text-warm-brown" />
              <span className="text-sm font-medium text-[color:var(--text-body)]">My Profile</span>
            </button>

            {isOwner && onOpenBilling && (
              <button
                role="menuitem"
                onClick={() => run(onOpenBilling)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-stone-100 transition-colors"
              >
                <CreditCard size={16} className="text-warm-brown" />
                <span className="text-sm font-medium text-[color:var(--text-body)]">Billing &amp; Payments</span>
              </button>
            )}

            <div className="my-1 border-t border-gray-50" />

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
