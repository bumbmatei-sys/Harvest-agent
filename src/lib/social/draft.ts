import { parseSocialPlatform, supportsMadeWithAi, type SocialPlatform } from './platforms';
import { hasTimeOffset, wallTimeInZoneToIso } from './schedule-time';
import type { SocialMedia, SocialPostDraft, SocialTarget } from './types';
import { isTenantUploadKey } from '@/utils/r2-keys';
import { validateSocialMedia, type MediaRuleError } from './media-rules';

export interface DraftError {
  readonly ok: false;
  readonly error: 'platform_not_offered' | 'post_incomplete' | 'schedule_invalid' | 'media_not_accepted' | MediaRuleError;
}

/** A scheduled post has to be in the future, and not more than a year out. */
const MAX_SCHEDULE_MS = 366 * 24 * 60 * 60 * 1000;

export function isIdempotencyKey(value: string | null): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export type DraftResult = { readonly ok: true; readonly draft: SocialPostDraft } | DraftError;

function readFields(raw: unknown): Record<string, string | boolean> {
  if (!raw || typeof raw !== 'object') return {};
  const fields: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === 'madeWithAi') continue;
    if (typeof value === 'string') fields[key] = value.slice(0, 500);
    else if (typeof value === 'boolean') fields[key] = value;
  }
  return fields;
}

/** Turn an untrusted body into a draft, or refuse it. */
export function parseSocialDraft(body: unknown, now = new Date(), context?: { tenantId: string; publicUrl: string | undefined }): DraftResult {
  if (!body || typeof body !== 'object') return { ok: false, error: 'post_incomplete' };
  const row = body as Record<string, unknown>;
  if (row.media !== undefined && !Array.isArray(row.media)) return { ok: false, error: 'media_invalid' };
  const media: SocialMedia[] = [];
  for (const raw of (row.media as unknown[] | undefined) ?? []) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'media_invalid' };
    const item = raw as Record<string, unknown>;
    if (typeof item.url !== 'string' || (item.kind !== 'image' && item.kind !== 'video') ||
      (item.mimeType !== undefined && typeof item.mimeType !== 'string') ||
      (item.alt !== undefined && typeof item.alt !== 'string')) return { ok: false, error: 'media_invalid' };
    try {
      if (!context?.publicUrl || !context.tenantId) return { ok: false, error: 'media_invalid' };
      const base = new URL(context.publicUrl);
      const url = new URL(item.url);
      const basePath = base.pathname.replace(/\/+$/, '');
      if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash ||
        url.origin !== base.origin || url.username || url.password || url.search || url.hash ||
        !url.pathname.startsWith(`${basePath}/`) ||
        !isTenantUploadKey(url.pathname.slice(basePath.length + 1), context.tenantId)) {
        return { ok: false, error: 'media_invalid' };
      }
    } catch {
      return { ok: false, error: 'media_invalid' };
    }
    media.push({ name: item.url, url: item.url, kind: item.kind,
      ...(typeof item.mimeType === 'string' ? { mimeType: item.mimeType } : {}),
      ...(typeof item.alt === 'string' ? { alt: item.alt.slice(0, 500) } : {}) });
  }
  const content = typeof row.content === 'string' ? row.content.trim() : '';
  const targetsRaw = Array.isArray(row.targets) ? row.targets : [];
  if (!content || targetsRaw.length === 0) return { ok: false, error: 'post_incomplete' };

  const targets: SocialTarget[] = [];
  for (const entry of targetsRaw) {
    if (!entry || typeof entry !== 'object') return { ok: false, error: 'platform_not_offered' };
    const target = entry as Record<string, unknown>;
    const platform = parseSocialPlatform(target.platform);
    if (!platform) return { ok: false, error: 'platform_not_offered' };
    const accountId = typeof target.accountId === 'string' ? target.accountId.trim() : '';
    if (!accountId) return { ok: false, error: 'post_incomplete' };
    const text = typeof target.text === 'string' && target.text.trim() ? target.text.trim() : content;
    const requestedAi = target.madeWithAi === true;
    targets.push({
      platform,
      accountId,
      text,
      fields: readFields(target.fields),
      madeWithAi: requestedAi && supportsMadeWithAi(platform),
    });
  }

  const mediaError = validateSocialMedia(media, targets.map(target => target.platform));
  if (mediaError) return { ok: false, error: mediaError };

  const publishNow = row.publishNow === true;
  const timezone = typeof row.timezone === 'string' && row.timezone ? row.timezone.slice(0, 80) : 'UTC';
  const scheduledRaw = typeof row.scheduledFor === 'string' && row.scheduledFor ? row.scheduledFor.trim() : null;
  let scheduledFor: string | null = null;
  if (!publishNow && scheduledRaw) {
    // A wall time without an offset is read in the ministry timezone. Date.parse
    // of that string is UTC on the server, which moves a west-of-UTC morning
    // onto the previous calendar day.
    const absolute = hasTimeOffset(scheduledRaw)
      ? scheduledRaw
      : wallTimeInZoneToIso(scheduledRaw, timezone);
    const parsed = absolute ? Date.parse(absolute) : Number.NaN;
    if (!Number.isFinite(parsed) || parsed <= now.getTime() || parsed > now.getTime() + MAX_SCHEDULE_MS) {
      return { ok: false, error: 'schedule_invalid' };
    }
    scheduledFor = new Date(parsed).toISOString();
  }
  return {
    ok: true,
    draft: {
      content,
      scheduledFor: publishNow ? null : scheduledFor,
      publishNow,
      timezone,
      targets,
      media,
      idempotencyKey: null,
    },
  };
}

export function parseConnectPlatform(body: unknown): SocialPlatform | null {
  if (!body || typeof body !== 'object') return null;
  return parseSocialPlatform((body as Record<string, unknown>).platform);
}
