import type { SocialPlatform } from './platforms';
import { parseSocialPlatform, supportsMadeWithAi } from './platforms';
import { readAnalyticsPost, type AnalyticsPost, type SocialAnalytics } from './analytics';
import type { InboxKind } from './inbox';
import type { SocialAccount, SocialMedia, SocialPost, SocialPostDraft, SocialTarget, SocialWorkspace } from './types';

/**
 * HTTP to Zernio for the social scheduler. The key is passed in by the
 * session layer, which reads it from the one key module. It is never
 * returned, logged, or placed on a URL.
 *
 * The SMS transport in `src/lib/zernio.ts` is a different module on purpose:
 * social routes must not import it, or they become a second caller of the
 * send funnel's provider module.
 */

const ZERNIO_SOCIAL_API = 'https://api.zernio.com/v1';
const ANALYTICS_PAGE_SIZE = 100;
const ANALYTICS_MAX_PAGES = 5;

export interface ZernioRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

export function buildZernioRequest(
  key: string,
  path: string,
  init: { method?: string; body?: unknown; idempotencyKey?: string | null } = {},
): ZernioRequest {
  const method = init.method || 'GET';
  return {
    url: `${ZERNIO_SOCIAL_API}${path}`,
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(init.idempotencyKey ? { 'Idempotency-Key': init.idempotencyKey } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  };
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

async function call<T>(
  key: string,
  path: string,
  init: { method?: string; body?: unknown; idempotencyKey?: string | null },
  fetchImpl: FetchLike,
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const request = buildZernioRequest(key, path, init);
  try {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body !== undefined ? { body: request.body } : {}),
    });
    const data = (await response.json().catch(() => null)) as T | null;
    if (!response.ok || data === null) {
      return { ok: false, status: response.status, error: 'The social provider refused the request.' };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, status: 0, error: 'The social provider could not be reached.' };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function readAccount(value: unknown): SocialAccount | null {
  const row = asRecord(value);
  const platform = parseSocialPlatform(row.platform);
  const id = typeof row._id === 'string' ? row._id : typeof row.id === 'string' ? row.id : '';
  if (!platform || !id) return null;
  const username = typeof row.username === 'string' ? row.username : platform;
  const displayName = typeof row.displayName === 'string' ? row.displayName : username;
  return { id, platform, username, displayName };
}

function readPost(value: unknown): SocialPost | null {
  const row = asRecord(value);
  const id = typeof row._id === 'string' ? row._id : typeof row.id === 'string' ? row.id : '';
  if (!id) return null;
  const content = typeof row.content === 'string' ? row.content : '';
  const statusRaw = typeof row.status === 'string' ? row.status : 'draft';
  const status = statusRaw === 'published' ? 'sent' : statusRaw === 'scheduled' ? 'scheduled' : statusRaw === 'draft' ? 'draft' : 'failed';
  const platforms = Array.isArray(row.platforms) ? row.platforms : [];
  const targets: SocialTarget[] = [];
  for (const entry of platforms) {
    const item = asRecord(entry);
    const platform = parseSocialPlatform(item.platform);
    const account = asRecord(item.accountId);
    const accountId = typeof item.accountId === 'string'
      ? item.accountId
      : typeof account._id === 'string'
        ? account._id
        : '';
    if (!platform || !accountId) continue;
    const specific = asRecord(item.platformSpecificData);
    const fields: Record<string, string | boolean> = {};
    for (const [key, field] of Object.entries(specific)) {
      if (key === 'madeWithAi') continue;
      if (typeof field === 'string' || typeof field === 'boolean') fields[key] = field;
    }
    targets.push({
      platform,
      accountId,
      text: typeof item.customContent === 'string' ? item.customContent : content,
      fields,
      madeWithAi: specific.madeWithAi === true && supportsMadeWithAi(platform),
    });
  }
  if (platforms.length > 0 && targets.length === 0) return null;
  const media: SocialMedia[] = [];
  if (Array.isArray(row.mediaItems)) {
    for (const item of row.mediaItems) {
      const mediaRow = asRecord(item);
      const kind = mediaRow.type === 'video' ? 'video' : 'image';
      const name = typeof mediaRow.url === 'string' ? mediaRow.url : kind;
      media.push({ name, kind, ...(typeof mediaRow.url === 'string' ? { url: mediaRow.url } : {}) });
    }
  }
  return {
    id,
    content,
    status,
    scheduledFor: typeof row.scheduledFor === 'string' ? row.scheduledFor : null,
    timezone: typeof row.timezone === 'string' ? row.timezone : 'UTC',
    targets,
    media,
  };
}

export class LiveSocialClient {
  readonly mode = 'live' as const;

  constructor(
    private readonly key: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async ensureProfile(profileName: string): Promise<string | null> {
    const created = await call<{ profile?: { _id?: string } }>(
      this.key,
      '/profiles',
      { method: 'POST', body: { name: profileName } },
      this.fetchImpl,
    );
    if (!created.ok) return null;
    const id = created.data.profile?._id;
    return typeof id === 'string' && id ? id : null;
  }

  /**
   * #582: published posts with their metrics, newest window first. Pages are
   * read until the provider has no more, up to ANALYTICS_MAX_PAGES; beyond that
   * the result says it is truncated rather than presenting a partial sum as whole.
   */
  async analytics(profileId: string, fromDate: string, toDate: string): Promise<SocialAnalytics | null> {
    const posts: AnalyticsPost[] = [];
    for (let page = 1; page <= ANALYTICS_MAX_PAGES; page += 1) {
      const query = new URLSearchParams({ profileId, fromDate, toDate, limit: String(ANALYTICS_PAGE_SIZE), page: String(page) });
      const result = await call<{ posts?: unknown[]; pagination?: { pages?: number } }>(this.key, `/analytics?${query}`, {}, this.fetchImpl);
      if (!result.ok) return null;
      for (const row of result.data.posts ?? []) {
        const post = readAnalyticsPost(row);
        if (post) posts.push(post);
      }
      const pages = typeof result.data.pagination?.pages === 'number' ? result.data.pagination.pages : page;
      if (page >= pages) return { fromDate, toDate, posts, truncated: false };
    }
    return { fromDate, toDate, posts, truncated: true };
  }

  /** #584: the unified inbox. Each list is this profile's own; each read and reply names it. */
  async inboxList(profileId: string, kind: InboxKind): Promise<unknown | null> {
    const path = kind === 'message' ? '/inbox/conversations' : kind === 'comment' ? '/inbox/comments' : '/inbox/reviews';
    const query = new URLSearchParams({ profileId, limit: '50' });
    const result = await call<unknown>(this.key, `${path}?${query}`, {}, this.fetchImpl);
    return result.ok ? result.data : null;
  }

  async inboxThread(kind: 'message' | 'comment', id: string, accountId: string): Promise<unknown | null> {
    const query = new URLSearchParams({ accountId });
    const path = kind === 'message'
      ? `/inbox/conversations/${encodeURIComponent(id)}/messages?${query}`
      : `/inbox/comments/${encodeURIComponent(id)}?${query}`;
    const result = await call<unknown>(this.key, path, {}, this.fetchImpl);
    return result.ok ? result.data : null;
  }

  async inboxReply(kind: InboxKind, id: string, accountId: string, message: string, commentId?: string): Promise<boolean> {
    const path = kind === 'message'
      ? `/inbox/conversations/${encodeURIComponent(id)}/messages`
      : kind === 'comment'
        ? `/inbox/comments/${encodeURIComponent(id)}`
        : `/inbox/reviews/${encodeURIComponent(id)}/reply`;
    const body = { accountId, message, ...(kind === 'comment' && commentId ? { commentId } : {}) };
    const result = await call<unknown>(this.key, path, { method: 'POST', body }, this.fetchImpl);
    return result.ok;
  }

  /** Auto-DM: the profile's comment-to-DM automations, with their stats. */
  async autoDmList(profileId: string): Promise<unknown | null> {
    const result = await call<unknown>(this.key, `/comment-automations?${new URLSearchParams({ profileId })}`, {}, this.fetchImpl);
    return result.ok ? result.data : null;
  }

  async autoDmCreate(body: Record<string, unknown>): Promise<unknown | null> {
    const result = await call<unknown>(this.key, '/comment-automations', { method: 'POST', body }, this.fetchImpl);
    return result.ok ? result.data : null;
  }

  /**
   * Zernio documents this update as partial without naming the verb in the
   * reference this client was written from, so PATCH is tried and a 404 or
   * 405 is retried once as PUT. Any other refusal is returned as it is.
   */
  async autoDmUpdate(id: string, body: Record<string, unknown>): Promise<unknown | null> {
    const path = `/comment-automations/${encodeURIComponent(id)}`;
    const patched = await call<unknown>(this.key, path, { method: 'PATCH', body }, this.fetchImpl);
    if (patched.ok) return patched.data;
    if (patched.status !== 404 && patched.status !== 405) return null;
    const put = await call<unknown>(this.key, path, { method: 'PUT', body }, this.fetchImpl);
    return put.ok ? put.data : null;
  }

  async autoDmDelete(id: string): Promise<boolean> {
    const result = await call<unknown>(this.key, `/comment-automations/${encodeURIComponent(id)}`, { method: 'DELETE' }, this.fetchImpl);
    return result.ok;
  }

  async autoDmLogs(id: string): Promise<unknown | null> {
    const result = await call<unknown>(this.key, `/comment-automations/${encodeURIComponent(id)}/logs?limit=50`, {}, this.fetchImpl);
    return result.ok ? result.data : null;
  }

  async load(profileId: string): Promise<SocialWorkspace | null> {
    const [accounts, posts] = await Promise.all([
      call<{ accounts?: unknown[] }>(
        this.key,
        `/accounts?profileId=${encodeURIComponent(profileId)}`,
        {},
        this.fetchImpl,
      ),
      call<{ posts?: unknown[] }>(
        this.key,
        `/posts?profileId=${encodeURIComponent(profileId)}`,
        {},
        this.fetchImpl,
      ),
    ]);
    if (!accounts.ok || !posts.ok) return null;
    return {
      profileId,
      sample: false,
      // UTC means "no zone yet". list() replaces it with the caller's IANA zone.
      // A zone already stored on the workspace, such as the sample ministry, stays.
      timezone: 'UTC',
      accounts: (accounts.data.accounts || []).map(readAccount).filter((row): row is SocialAccount => row !== null),
      posts: (posts.data.posts || []).map(readPost).filter((row): row is SocialPost => row !== null),
    };
  }

  async connectUrl(profileId: string, platform: SocialPlatform): Promise<string | null> {
    const allowed = parseSocialPlatform(platform);
    if (!allowed) return null;
    const result = await call<{ authUrl?: string }>(
      this.key,
      `/connect/${allowed}?profileId=${encodeURIComponent(profileId)}`,
      {},
      this.fetchImpl,
    );
    if (!result.ok || typeof result.data.authUrl !== 'string') return null;
    return result.data.authUrl;
  }

  async create(profileId: string, draft: SocialPostDraft): Promise<SocialPost | null> {
    // POST /v1/posts accepts Idempotency-Key. The same key on a retry within
    // 24 hours returns the original post, for a scheduled time and for publish now.
    const result = await call<{ post?: unknown }>(
      this.key,
      '/posts',
      {
        method: 'POST',
        body: toProviderBody(profileId, draft),
        idempotencyKey: draft.idempotencyKey,
      },
      this.fetchImpl,
    );
    if (!result.ok) return null;
    return readPost(result.data.post);
  }

  async update(id: string, draft: SocialPostDraft): Promise<SocialPost | null> {
    const result = await call<{ post?: unknown }>(
      this.key,
      `/posts/${encodeURIComponent(id)}`,
      { method: 'PUT', body: toProviderBody(null, draft) },
      this.fetchImpl,
    );
    if (!result.ok) return null;
    return readPost(result.data.post);
  }

  async cancel(id: string): Promise<boolean> {
    const result = await call<unknown>(
      this.key,
      `/posts/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      this.fetchImpl,
    );
    return result.ok;
  }
}

export function toProviderBody(profileId: string | null, draft: SocialPostDraft): Record<string, unknown> {
  const platforms = [];
  for (const target of draft.targets) {
    const platform = parseSocialPlatform(target.platform);
    if (!platform) continue;
    const fields = { ...target.fields };
    delete fields.madeWithAi;
    platforms.push({
      platform,
      accountId: target.accountId,
      customContent: target.text,
      platformSpecificData: {
        ...fields,
        ...(target.madeWithAi && supportsMadeWithAi(platform) ? { madeWithAi: true } : {}),
      },
    });
  }
  return {
    ...(profileId ? { profileId } : {}),
    content: draft.content,
    timezone: draft.timezone,
    ...(draft.publishNow ? { publishNow: true } : {}),
    ...(draft.scheduledFor && !draft.publishNow ? { scheduledFor: draft.scheduledFor } : {}),
    mediaItems: draft.media.map(item => {
      if (!item.url) throw new Error('Social media URL is missing');
      return { url: item.url, type: item.kind };
    }),
    platforms,
  };
}
