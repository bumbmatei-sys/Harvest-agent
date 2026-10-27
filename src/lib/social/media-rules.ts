import { MAX_SOCIAL_IMAGE_UPLOAD_BYTES, MAX_SOCIAL_VIDEO_UPLOAD_BYTES } from '@/utils/upload-limits';
import type { SocialPlatform } from './platforms';

export const SOCIAL_MEDIA_MIME_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  video: ['video/mp4', 'video/quicktime'],
} as const;
export const MAX_SOCIAL_MEDIA_COUNT = 10;

export type MediaRuleError = 'media_invalid' | 'media_too_many' | 'instagram_needs_media' | 'youtube_needs_video' | 'tiktok_needs_video';
export interface MediaRuleItem {
  readonly kind: 'image' | 'video';
  readonly mimeType?: string;
  readonly size?: number;
}

/** Shared file and platform rules. Size is checked when file metadata is available. */
export function validateSocialMedia(media: readonly MediaRuleItem[], platforms: readonly SocialPlatform[]): MediaRuleError | null {
  if (media.length > MAX_SOCIAL_MEDIA_COUNT) return 'media_too_many';
  for (const item of media) {
    if (item.kind !== 'image' && item.kind !== 'video') return 'media_invalid';
    if (item.mimeType !== undefined && !(SOCIAL_MEDIA_MIME_TYPES[item.kind] as readonly string[]).includes(item.mimeType)) return 'media_invalid';
    const cap = item.kind === 'image' ? MAX_SOCIAL_IMAGE_UPLOAD_BYTES : MAX_SOCIAL_VIDEO_UPLOAD_BYTES;
    if (item.size !== undefined && (!Number.isFinite(item.size) || item.size <= 0 || item.size > cap)) return 'media_invalid';
  }
  if (media.some(item => item.kind === 'video') && (media.length !== 1 || media[0].kind !== 'video')) return 'media_invalid';
  if (platforms.includes('youtube') && (media.length !== 1 || media[0].kind !== 'video')) return 'youtube_needs_video';
  if (platforms.includes('tiktok') && (media.length !== 1 || media[0].kind !== 'video')) return 'tiktok_needs_video';
  if (platforms.includes('instagram') && media.length === 0) return 'instagram_needs_media';
  return null;
}
