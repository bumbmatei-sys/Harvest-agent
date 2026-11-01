/**
 * Eden's composer counts characters against each network's limit, and the
 * main preview counts against the strictest selected one
 * (docs/prd/screenshots/14-social-scheduler, 017: "0 / 280", "0 of 2,200").
 * Limits are each network's published caption or post-text maximum.
 */
import type { SocialPlatform } from './platforms';

export const CHARACTER_LIMITS: Record<SocialPlatform, number> = {
  facebook: 63206,
  instagram: 2200,
  threads: 500,
  tiktok: 2200,
  youtube: 5000,
};

/** Characters as a reader counts them: one per emoji or accented letter, not per UTF-16 unit. */
export function characterCount(text: string): number {
  return [...text].length;
}

export interface PlatformCount { readonly platform: SocialPlatform; readonly used: number; readonly limit: number; readonly over: boolean }

export function platformCounts(text: string, platforms: readonly SocialPlatform[]): PlatformCount[] {
  const used = characterCount(text);
  return platforms.map((platform) => ({ platform, used, limit: CHARACTER_LIMITS[platform], over: used > CHARACTER_LIMITS[platform] }));
}

/** The tightest limit among the selected networks, or null when none is selected. */
export function strictestLimit(platforms: readonly SocialPlatform[]): number | null {
  return platforms.length ? Math.min(...platforms.map((platform) => CHARACTER_LIMITS[platform])) : null;
}
