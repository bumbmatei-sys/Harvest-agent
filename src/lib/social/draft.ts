import { parseSocialPlatform, supportsMadeWithAi, type SocialPlatform } from './platforms';
import type { SocialMedia, SocialPostDraft, SocialTarget } from './types';

export interface DraftError {
  readonly ok: false;
  readonly error: 'platform_not_offered' | 'post_incomplete';
}

export type DraftResult = { readonly ok: true; readonly draft: SocialPostDraft } | DraftError;

function readMedia(raw: unknown): SocialMedia[] {
  if (!Array.isArray(raw)) return [];
  const media: SocialMedia[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name.slice(0, 180) : '';
    if (!name) continue;
    media.push({ name, kind: row.kind === 'video' ? 'video' : 'image' });
  }
  return media;
}

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

/**
 * Turn an untrusted body into a draft, or refuse it.
 *
 * Every platform string is parsed through the allow-list. A body that names
 * X, Twitter, or any other slug is `platform_not_offered` and produces no
 * draft, so the caller never reaches Zernio. `madeWithAi` is kept only for a
 * platform Zernio documents the flag for, and defaults to false.
 */
export function parseSocialDraft(body: unknown): DraftResult {
  if (!body || typeof body !== 'object') return { ok: false, error: 'post_incomplete' };
  const row = body as Record<string, unknown>;
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

  const publishNow = row.publishNow === true;
  const scheduledFor = typeof row.scheduledFor === 'string' && row.scheduledFor ? row.scheduledFor : null;
  const timezone = typeof row.timezone === 'string' && row.timezone ? row.timezone.slice(0, 80) : 'UTC';
  return {
    ok: true,
    draft: {
      content,
      scheduledFor: publishNow ? null : scheduledFor,
      publishNow,
      timezone,
      targets,
      media: readMedia(row.media),
    },
  };
}

export function parseConnectPlatform(body: unknown): SocialPlatform | null {
  if (!body || typeof body !== 'object') return null;
  return parseSocialPlatform((body as Record<string, unknown>).platform);
}
