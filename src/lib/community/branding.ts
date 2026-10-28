import type { CSSProperties } from 'react';

export const DEFAULT_COMMUNITY_BRAND = '#C9963A';
export const isCommunityBrandColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
export function contrastRatio(a: string, b: string): number {
  if (!isCommunityBrandColor(a) || !isCommunityBrandColor(b)) throw new Error('Invalid colour');
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
export function readableForeground(color: string): '#000000' | '#FFFFFF' {
  return contrastRatio(color, '#000000') >= contrastRatio(color, '#FFFFFF') ? '#000000' : '#FFFFFF';
}
/** Lighten only as much as needed to distinguish the accent from the dark raised surface. */
export function darkBrandColor(color: string): string {
  if (!isCommunityBrandColor(color)) throw new Error('Invalid colour');
  const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  for (let percent = 0; percent <= 100; percent++) {
    const candidate = '#' + rgb.map(v => Math.round(v + (255 - v) * percent / 100).toString(16).padStart(2, '0')).join('').toUpperCase();
    if (contrastRatio(candidate, '#202020') >= 3) return candidate;
  }
  return '#FFFFFF';
}
export function communityBrandStyle(color?: string): CSSProperties {
  const brand = color === undefined || color === '' ? DEFAULT_COMMUNITY_BRAND : color;
  if (!isCommunityBrandColor(brand)) throw new Error('Invalid colour');
  const dark = darkBrandColor(brand);
  return { '--community-brand-light': brand, '--community-brand-dark': dark, '--community-foreground-light': readableForeground(brand), '--community-foreground-dark': readableForeground(dark) } as CSSProperties;
}
