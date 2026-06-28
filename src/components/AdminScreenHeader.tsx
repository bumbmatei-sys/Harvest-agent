"use client";
import React, { createContext, useContext } from 'react';
import { ChevronLeft } from 'lucide-react';

/**
 * Brand color used for the back chevron and header action buttons.
 * Resolves to the tenant's custom branding color (`--brand-color`, set from
 * `config.primaryColor` in TenantContext), falling back to the platform gold.
 */
export const HEADER_GOLD = 'var(--brand-color, #B8962E)';

interface AdminScreenHeaderProps {
  /** Centered page title. */
  title: string;
  /** Back handler. When omitted (e.g. Dashboard) no back chevron is shown. */
  onBack?: () => void;
  /** Optional primary action rendered on the right (e.g. "+ New Course"). */
  action?: React.ReactNode;
  /** Optional element rendered just before the title (e.g. a `#` for a channel). */
  titleIcon?: React.ReactNode;
  /** Optional element pinned to the far left (e.g. mobile "View App" shortcut). */
  leftAccessory?: React.ReactNode;
}

/**
 * The single, consistent header used across every admin screen:
 * `←` back chevron (gold) · centered title · optional right-side action.
 * Rendered once per screen — screens must NOT repeat their own title below it.
 */
export const AdminScreenHeader: React.FC<AdminScreenHeaderProps> = ({ title, onBack, action, titleIcon, leftAccessory }) => (
  <div className="relative bg-white px-3 flex items-center justify-between border-b border-gray-100 shadow-sm min-h-[52px] flex-shrink-0 z-20">
    <div className="flex items-center gap-1.5 z-10 min-w-[40px]">
      {onBack && (
        <button
          onClick={onBack}
          aria-label="Back"
          className="p-1 -ml-1 transition-opacity hover:opacity-70 active:opacity-50"
        >
          <ChevronLeft size={24} strokeWidth={2.5} className="text-gold" />
        </button>
      )}
      {leftAccessory}
    </div>

    <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 max-w-[55%]">
      {titleIcon}
      <h1 className="text-[17px] font-bold text-gray-900 truncate">{title}</h1>
    </div>

    <div className="flex items-center z-10 min-w-[40px] justify-end">
      {action}
    </div>
  </div>
);

/** Small gold pill button for the header's primary action. */
export const HeaderActionButton: React.FC<{
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
}> = ({ onClick, label, icon }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white whitespace-nowrap transition-opacity hover:opacity-90 active:opacity-80"
    style={{ backgroundColor: HEADER_GOLD }}
  >
    {icon ?? <span className="text-sm leading-none">+</span>}
    {label}
  </button>
);

/** A full header override (title + back + action + icon) for sub-views like a chat thread. */
export interface AdminHeaderOverride {
  title: string;
  onBack?: () => void;
  action?: React.ReactNode;
  titleIcon?: React.ReactNode;
}

interface AdminHeaderApi {
  /** Register (or clear with null) the active screen's primary header action. */
  setHeaderAction: (node: React.ReactNode) => void;
  /** Fully override the shared header (or clear with null) — e.g. an open chat thread. */
  setHeaderOverride: (override: AdminHeaderOverride | null) => void;
}

/**
 * Lets an admin screen publish its primary action — or a full header override —
 * into the shared header that AdminDashboard renders. Screens register on mount
 * and clear on cleanup.
 */
export const AdminHeaderContext = createContext<AdminHeaderApi>({
  setHeaderAction: () => {},
  setHeaderOverride: () => {},
});
export const useAdminHeader = (): AdminHeaderApi => useContext(AdminHeaderContext);

export default AdminScreenHeader;
