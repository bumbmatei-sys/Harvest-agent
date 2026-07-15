"use client";
import React from 'react';

/**
 * Harvest Member App — desktop (lg:+) presentational kit.
 *
 * Small, brand-token building blocks used to compose the member app's DESKTOP
 * surfaces to match the "Harvest Member App" design. They are intentionally
 * NOT self-gating: each renders plain brand-token markup and is only ever
 * mounted inside a caller-controlled `hidden lg:block` / `lg:` region, so the
 * mobile experience is never touched. Gold is always the tenant-overridable
 * `var(--brand-color)` — never a hard hex. Serif display = `font-display`
 * (Fraunces). Warm neutrals come from the existing brand palette
 * (earth / warm-brown / stone / cream / navy).
 */

/** Uppercase tracked kicker set above a heading (Inter 600, ~11px, 0.14em). */
export const Eyebrow: React.FC<{
  children: React.ReactNode;
  className?: string;
  /** 'muted' = taupe (default), 'gold' = brand gold, 'glow' = luminous amber on dark. */
  tone?: 'muted' | 'gold' | 'glow';
}> = ({ children, className = '', tone = 'muted' }) => {
  const color =
    tone === 'gold' ? 'var(--brand-color)'
    : tone === 'glow' ? 'var(--wheat-glow)'
    : 'var(--text-faint)';
  return (
    <span
      className={`block text-[11px] font-bold uppercase tracking-[0.14em] ${className}`}
      style={{ color }}
    >
      {children}
    </span>
  );
};

/** Fraunces section heading with the signature gold vertical tick. */
export const SectionTitle: React.FC<{
  children: React.ReactNode;
  className?: string;
  /** heading font-size in px (desktop) */
  size?: number;
  as?: 'h1' | 'h2' | 'h3';
}> = ({ children, className = '', size = 19, as: Tag = 'h2' }) => (
  <div className={`flex items-center gap-2.5 ${className}`}>
    <span
      className="rounded-full shrink-0"
      style={{ width: 4, height: size + 1, background: 'var(--brand-color)' }}
    />
    <Tag
      className="font-display font-light m-0 tracking-[-0.02em] text-earth"
      style={{ fontSize: size }}
    >
      {children}
    </Tag>
  </div>
);

/**
 * Dark hero band — the navy→gold gradient (with ~6% film grain) that stands in
 * for the mockup's wheat-field photography. Children render above the texture.
 */
export const HeroBand: React.FC<
  React.HTMLAttributes<HTMLDivElement> & { radius?: string; overlayOpacity?: number; backdrop?: React.ReactNode }
> = ({ children, className = '', style, radius = 'var(--ds-radius-card)', overlayOpacity = 1, backdrop, ...rest }) => (
  <div
    className={`relative overflow-hidden ${className}`}
    style={{ background: 'var(--surface-night)', borderRadius: radius, ...style }}
    {...rest}
  >
    {backdrop}
    {/* navy→gold diagonal wash */}
    <span
      aria-hidden
      className="absolute inset-0 pointer-events-none"
      style={{
        opacity: overlayOpacity,
        background:
          'radial-gradient(120% 140% at 85% 15%, color-mix(in srgb, var(--brand-color) 34%, transparent), transparent 55%), linear-gradient(135deg, rgba(12,21,38,0) 45%, rgba(12,21,38,0.35))',
      }}
    />
    {/* film grain */}
    <span
      aria-hidden
      className="absolute inset-0 pointer-events-none mix-blend-overlay"
      style={{ backgroundImage: 'var(--grain-url)', opacity: 0.06 }}
    />
    <div className="relative">{children}</div>
  </div>
);

/** Pill filter row (Blog / Courses category chips). */
export const CategoryChips: React.FC<{
  items: string[];
  value: string;
  onChange: (v: string) => void;
  /** active fill: 'gold' (brand) or 'night' (navy). */
  variant?: 'gold' | 'night';
  className?: string;
}> = ({ items, value, onChange, variant = 'gold', className = '' }) => (
  <div className={`flex flex-wrap gap-2 ${className}`}>
    {items.map((c) => {
      const active = c === value;
      const activeBg = variant === 'night' ? 'var(--navy-900)' : 'var(--brand-color)';
      return (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className="px-[15px] py-[7px] rounded-full text-[12.5px] font-semibold transition-colors border"
          style={{
            background: active ? activeBg : 'var(--surface-card, #fff)',
            color: active ? '#fff' : 'var(--text-body)',
            borderColor: active ? activeBg : 'var(--stone-300)',
          }}
        >
          {c}
        </button>
      );
    })}
  </div>
);

/** Oversized Fraunces statistic with an eyebrow label. */
export const Stat: React.FC<{ value: React.ReactNode; label: string; className?: string }> = ({
  value,
  label,
  className = '',
}) => (
  <div className={className}>
    <div className="font-display font-light text-earth tracking-[-0.02em] leading-none text-[clamp(1.75rem,3vw,2.5rem)]">
      {value}
    </div>
    <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--text-faint)' }}>
      {label}
    </div>
  </div>
);

const BADGE_TONES: Record<string, { bg: string; fg: string; bd: string }> = {
  gold: { bg: 'var(--surface-gold)', fg: 'var(--wheat-700)', bd: 'var(--border-gold)' },
  sky: { bg: 'var(--sky-100)', fg: 'var(--sky-700)', bd: 'transparent' },
  green: { bg: 'var(--field-100)', fg: 'var(--field-700)', bd: 'transparent' },
  neutral: { bg: 'var(--surface-sunken)', fg: 'var(--text-body)', bd: 'transparent' },
  outline: { bg: 'transparent', fg: 'var(--text-body)', bd: 'var(--stone-300)' },
};

/** Small pill label — categories, "Pinned", "Featured", status. */
export const Badge: React.FC<{
  children: React.ReactNode;
  tone?: keyof typeof BADGE_TONES;
  className?: string;
  style?: React.CSSProperties;
}> = ({ children, tone = 'neutral', className = '', style }) => {
  const t = BADGE_TONES[tone] || BADGE_TONES.neutral;
  return (
    <span
      className={`inline-flex items-center gap-1.5 h-[22px] px-2.5 rounded-full text-[11.5px] font-semibold leading-none whitespace-nowrap ${className}`}
      style={{ background: t.bg, color: t.fg, border: `1px solid ${t.bd}`, ...style }}
    >
      {children}
    </span>
  );
};
