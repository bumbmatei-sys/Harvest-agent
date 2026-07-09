"use client";
import React from 'react';
import { Search } from 'lucide-react';

/**
 * Shared admin desktop UI primitives — the design system extracted from the
 * Harvest admin mockups. Every admin screen composes these so the whole panel
 * reads as one system: gold eyebrow + Fraunces-light page title + gold action,
 * a standalone search bar, branded tables/cards, and status badges.
 *
 * Colors flow through the brand tokens (globals.css / tailwind), and every gold
 * accent uses --brand-color so tenant theming still overrides it.
 */

/** Page header: gold eyebrow + big Fraunces-light title (e.g. "3 courses") +
 *  an optional primary action pinned to the right. Sits inside the content
 *  area (the branded top bar keeps just the screen name). */
export const AdminPageHeader: React.FC<{
  eyebrow?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}> = ({ eyebrow, title, subtitle, action, className = '' }) => (
  <div className={`flex items-start justify-between gap-4 ${className}`}>
    <div className="min-w-0">
      {eyebrow && (
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold mb-1.5">{eyebrow}</p>
      )}
      <h2 className="font-display text-[1.75rem] lg:text-[2rem] leading-[1.1] font-light tracking-[-0.02em] text-earth">
        {title}
      </h2>
      {subtitle && <p className="text-sm text-warm-brown mt-1.5">{subtitle}</p>}
    </div>
    {action && <div className="shrink-0 pt-1">{action}</div>}
  </div>
);

/** Primary (gold) action button — the "+ New …" call to action. */
export const AdminPrimaryButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }> = ({
  children, icon, className = '', ...props
}) => (
  <button
    {...props}
    className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-brand text-[13px] font-semibold text-white transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-40 ${className}`}
    style={{ backgroundColor: 'var(--brand-color, #C9963A)', ...(props.style || {}) }}
  >
    {icon}{children}
  </button>
);

/** Secondary (outline) button. */
export const AdminSecondaryButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({
  children, className = '', ...props
}) => (
  <button
    {...props}
    className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-brand border border-stone-200 bg-white text-[13px] font-semibold text-earth transition-colors hover:bg-stone-100 disabled:opacity-40 ${className}`}
  >
    {children}
  </button>
);

/** Standalone search bar (white card, stone border) rendered above a table. */
export const AdminSearchBar: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}> = ({ value, onChange, placeholder = 'Search…', className = '' }) => (
  <div className={`relative ${className}`}>
    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[color:var(--text-faint)]" size={18} />
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full pl-11 pr-4 py-3 bg-white border border-stone-200 rounded-brand-lg text-sm text-earth placeholder:text-[color:var(--text-faint)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_35%,transparent)] focus:border-transparent outline-none transition-all"
    />
  </div>
);

/** White table/list container card with soft warm elevation. */
export const AdminCard: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, className = '', ...props }) => (
  <div
    {...props}
    className={`bg-white rounded-brand-lg border border-stone-200 shadow-[var(--ds-sh-sm)] overflow-hidden ${className}`}
  >
    {children}
  </div>
);

/** A gold eyebrow section label used inside editor form cards (BASIC INFORMATION…). */
export const AdminSectionLabel: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <p className={`text-[11px] font-semibold uppercase tracking-[0.14em] text-gold ${className}`}>{children}</p>
);

type BadgeTone = 'green' | 'gold' | 'sky' | 'stone' | 'red';
const BADGE_TONES: Record<BadgeTone, string> = {
  green: 'bg-[color-mix(in_srgb,#6E8E52_16%,white)] text-[#40562F]',
  gold: 'bg-[color-mix(in_srgb,var(--brand-color)_16%,white)] text-[color-mix(in_srgb,var(--brand-color)_78%,black)]',
  sky: 'bg-sky-100 text-sky-700',
  stone: 'bg-stone-100 text-warm-brown',
  red: 'bg-[#F7E7E2] text-[#A23C28]',
};

/** Small pill badge (status, tags). */
export const AdminBadge: React.FC<{ tone?: BadgeTone; children: React.ReactNode; className?: string }> = ({
  tone = 'stone', children, className = '',
}) => (
  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold capitalize ${BADGE_TONES[tone]} ${className}`}>
    {children}
  </span>
);

/** Map a common status string → badge tone. */
export const statusTone = (status?: string): BadgeTone => {
  switch ((status || '').toLowerCase()) {
    case 'published': case 'active': case 'live': case 'sent': case 'approved': case 'paid':
      return 'green';
    case 'draft': case 'inactive': case 'archived':
      return 'stone';
    case 'scheduled': case 'pending':
      return 'gold';
    case 'new':
      return 'sky';
    case 'failed': case 'rejected': case 'error':
      return 'red';
    default:
      return 'stone';
  }
};

/** Editor header row: back link · Fraunces-light title · subtitle · status +
 *  actions (Save / Publish) pinned right. Keeps the editor inside the shell. */
export const AdminEditorHeader: React.FC<{
  onBack: () => void;
  backLabel?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ onBack, backLabel = 'Back', title, subtitle, actions }) => (
  <div className="mb-6">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[13px] font-semibold text-gold hover:opacity-80 transition-opacity mb-2"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          {backLabel}
        </button>
        <h1 className="font-display text-[1.75rem] lg:text-[2rem] leading-[1.1] font-light tracking-[-0.02em] text-earth truncate">
          {title}
        </h1>
        {subtitle && <p className="text-sm text-warm-brown mt-1.5">{subtitle}</p>}
      </div>
      {actions && <div className="shrink-0 flex items-center gap-2.5 pt-1">{actions}</div>}
    </div>
  </div>
);
