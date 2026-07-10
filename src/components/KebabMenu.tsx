"use client";
import React, { useEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';

export interface KebabMenuItem {
  label: string;
  onClick: () => void;
  /** Renders the item in red — use for destructive actions. */
  danger?: boolean;
  disabled?: boolean;
}

interface KebabMenuProps {
  items: KebabMenuItem[];
  size?: number;
  ariaLabel?: string;
}

/**
 * Small "..." menu button that opens a floating list of actions. Click-to-
 * toggle (not hover) so it works on touch, closes on outside-click/Esc.
 * Renders nothing when there are no items, so callers can pass a
 * conditionally-built items array without an extra guard at the call site.
 */
const KebabMenu: React.FC<KebabMenuProps> = ({ items, size = 16, ariaLabel = 'More options' }) => {
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

  if (items.length === 0) return null;

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className="p-1.5 -m-1.5 text-[color:var(--text-faint)] hover:text-warm-brown hover:bg-stone-100 rounded-full transition-colors"
      >
        <MoreVertical size={size} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={ariaLabel}
          className="absolute right-0 top-full mt-1 min-w-[170px] max-w-[calc(100vw-2rem)] bg-white rounded-xl border border-stone-200 shadow-[0_8px_30px_rgba(0,0,0,0.12)] overflow-hidden z-20"
        >
          {items.map((item, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={(e) => { e.stopPropagation(); setOpen(false); item.onClick(); }}
              className={`w-full text-left px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                item.danger ? 'text-red-600 hover:bg-red-50' : 'text-[color:var(--text-body)] hover:bg-stone-100'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default KebabMenu;
