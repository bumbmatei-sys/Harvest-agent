import { LiveSocialClient } from './live-client';
import { MockSocialClient } from './mock-client';
import { SOCIAL_SAMPLE_SCOPE, socialMode } from './mode';
import { commitZernioProfile, releaseZernioProfileClaim, reserveZernioProfile, storedZernioProfileId } from './profile-lock';
import type { SocialAnalytics } from './analytics';
import {
  readCommentThreads, readComments, readConversations, readMessages, readReviews,
  type InboxComment, type InboxCommentThread, type InboxConversation, type InboxKind, type InboxMessage, type InboxReview,
} from './inbox';
import { oncePublish } from './publish-once';
import {
  checkAutoDm, isAutoDmPlatform, readAutoDmLogs, readAutoDmRule, readAutoDmRules, toZernioAutomation,
  type AutoDmInput, type AutoDmLog, type AutoDmPlatform, type AutoDmRule,
} from './auto-dm';
import { readZernioSocialKey } from './zernio-key';
import { dropWorkspaceCache, shareLiveLoad } from './workspace-cache';
import type { SocialPlatform } from './platforms';
import type { SocialPost, SocialPostDraft, SocialWorkspace } from './types';

export type SocialMutation =
  | { readonly ok: true; readonly post: SocialPost }
  | { readonly ok: false; readonly error: 'account_not_owned' | 'social_unavailable' | 'post_not_editable' };

/**
 * The mock client is used only when the mode is mock. `mockOnly` cannot
 * turn production into the sample: if a caller asks for the mock while the
 * mode is live or unavailable, the call fails closed instead of publishing.
 */
function clientKind(mockOnly: boolean): 'mock' | 'refuse' | 'live' {
  if (socialMode() === 'mock') return 'mock';
  if (mockOnly || socialMode() !== 'live') return 'refuse';
  return 'live';
}

function ownsAccounts(workspace: SocialWorkspace, draft: SocialPostDraft): boolean {
  const owned = new Set(workspace.accounts.map((account) => account.id));
  return draft.targets.every((target) => owned.has(target.accountId));
}

/**
 * One profile per ministry, created the first time a live call needs it.
 * The mock never reads or writes Firestore, so a preview cannot surface a
 * real church's accounts.
 */
export async function loadSocialWorkspace(
  tenantId: string,
  now = new Date(),
  mockOnly = false,
): Promise<SocialWorkspace | null> {
  if (clientKind(mockOnly) === 'mock') return new MockSocialClient(tenantId, now).load();
  if (clientKind(mockOnly) !== 'live') return null;
  if (tenantId === SOCIAL_SAMPLE_SCOPE) return null;

  return shareLiveLoad(tenantId, () => loadLiveWorkspace(tenantId));
}

async function loadLiveWorkspace(tenantId: string): Promise<SocialWorkspace | null> {
  const reserved = await reserveZernioProfile(tenantId);
  if (reserved.status === 'busy') return null;
  const key = readZernioSocialKey();
  const live = new LiveSocialClient(key);
  if (reserved.status === 'ready') return live.load(reserved.profileId);

  const created = await live.ensureProfile(reserved.profileName);
  if (!created) {
    await releaseZernioProfileClaim(tenantId, reserved.claim);
    return null;
  }
  const profileId = await commitZernioProfile(tenantId, reserved.claim, created);
  if (!profileId) return null;
  return live.load(profileId);
}

export async function connectSocialAccount(
  tenantId: string,
  platform: SocialPlatform,
  mockOnly = false,
): Promise<{ ok: true; authUrl: string | null; sample: boolean } | { ok: false }> {
  if (clientKind(mockOnly) === 'mock') {
    new MockSocialClient(tenantId, new Date()).connect(platform);
    dropWorkspaceCache(tenantId);
    return { ok: true, authUrl: null, sample: true };
  }
  if (clientKind(mockOnly) !== 'live') return { ok: false };
  const workspace = await loadSocialWorkspace(tenantId, new Date(), mockOnly);
  if (!workspace) return { ok: false };
  const url = await new LiveSocialClient(readZernioSocialKey()).connectUrl(workspace.profileId, platform);
  if (!url) return { ok: false };
  dropWorkspaceCache(tenantId);
  return { ok: true, authUrl: url, sample: false };
}

async function providerCreate(
  tenantId: string,
  draft: SocialPostDraft,
  workspace: SocialWorkspace,
): Promise<SocialPost | null> {
  if (socialMode() === 'mock') return new MockSocialClient(tenantId, new Date()).create(draft);
  if (socialMode() !== 'live') return null;
  return new LiveSocialClient(readZernioSocialKey()).create(workspace.profileId, draft);
}

export async function createSocialPost(
  tenantId: string,
  draft: SocialPostDraft,
  mockOnly = false,
): Promise<SocialMutation> {
  const workspace = await loadSocialWorkspace(tenantId, new Date(), mockOnly);
  if (!workspace) return { ok: false, error: 'social_unavailable' };
  if (!ownsAccounts(workspace, draft)) return { ok: false, error: 'account_not_owned' };

  const create = () => providerCreate(tenantId, draft, workspace);
  const post = draft.idempotencyKey
    ? await oncePublish(tenantId, draft.idempotencyKey, socialMode() === 'live', create)
    : await create();
  if (!post) return { ok: false, error: 'social_unavailable' };
  dropWorkspaceCache(tenantId);
  return { ok: true, post };
}

export async function updateSocialPost(
  tenantId: string,
  id: string,
  draft: SocialPostDraft,
  mockOnly = false,
): Promise<SocialMutation> {
  const workspace = await loadSocialWorkspace(tenantId, new Date(), mockOnly);
  if (!workspace) return { ok: false, error: 'social_unavailable' };
  if (!workspace.posts.some((post) => post.id === id)) return { ok: false, error: 'post_not_editable' };
  if (!ownsAccounts(workspace, draft)) return { ok: false, error: 'account_not_owned' };

  if (clientKind(mockOnly) === 'mock') {
    const post = new MockSocialClient(tenantId, new Date()).update(id, draft);
    if (!post) return { ok: false, error: 'post_not_editable' };
    return { ok: true, post };
  }
  if (clientKind(mockOnly) !== 'live') return { ok: false, error: 'social_unavailable' };
  const post = await new LiveSocialClient(readZernioSocialKey()).update(id, draft);
  if (!post) return { ok: false, error: 'social_unavailable' };
  dropWorkspaceCache(tenantId);
  return { ok: true, post };
}

export async function cancelSocialPost(tenantId: string, id: string, mockOnly = false): Promise<boolean> {
  if (clientKind(mockOnly) === 'mock') {
    const cancelled = new MockSocialClient(tenantId, new Date()).cancel(id);
    if (cancelled) dropWorkspaceCache(tenantId);
    return cancelled;
  }
  if (clientKind(mockOnly) !== 'live') return false;
  const workspace = await loadSocialWorkspace(tenantId, new Date(), mockOnly);
  if (!workspace || !workspace.posts.some((post) => post.id === id)) return false;
  const cancelled = await new LiveSocialClient(readZernioSocialKey()).cancel(id);
  if (cancelled) dropWorkspaceCache(tenantId);
  return cancelled;
}

/**
 * #582: the ministry's post metrics for a window. Read only: a ministry with
 * no profile yet has published nothing, so it gets an empty window rather than
 * a profile created on its behalf.
 */
export async function loadSocialAnalytics(
  tenantId: string,
  fromDate: string,
  toDate: string,
  now = new Date(),
  mockOnly = false,
): Promise<SocialAnalytics | null> {
  if (clientKind(mockOnly) === 'mock') return new MockSocialClient(tenantId, now).analytics(fromDate, toDate);
  if (clientKind(mockOnly) !== 'live') return null;
  if (tenantId === SOCIAL_SAMPLE_SCOPE) return null;
  const profileId = await storedZernioProfileId(tenantId);
  if (!profileId) return { fromDate, toDate, posts: [], truncated: false };
  return new LiveSocialClient(readZernioSocialKey()).analytics(profileId, fromDate, toDate);
}

/**
 * #584: the unified inbox. The provider key is shared by every ministry, so a
 * conversation, comment thread or review is read or answered only when it is
 * in THIS ministry's own list: an id from another ministry is not found here.
 */
export type InboxListing =
  | { readonly kind: 'message'; readonly items: InboxConversation[] }
  | { readonly kind: 'comment'; readonly items: InboxCommentThread[] }
  | { readonly kind: 'review'; readonly items: InboxReview[] };

type InboxSource = {
  list(kind: InboxKind): Promise<unknown | null>;
  thread(kind: 'message' | 'comment', id: string, accountId: string): Promise<unknown | null>;
  reply(kind: InboxKind, id: string, accountId: string, message: string, commentId?: string): Promise<boolean>;
};

async function inboxSource(tenantId: string, now: Date, mockOnly: boolean): Promise<InboxSource | 'empty' | null> {
  if (clientKind(mockOnly) === 'mock') {
    const mock = new MockSocialClient(tenantId, now);
    return {
      list: async (kind) => mock.inboxList(kind),
      thread: async (kind, id) => mock.inboxThread(kind, id),
      reply: async (kind, id, _accountId, message, commentId) => mock.inboxReply(kind, id, message, commentId),
    };
  }
  if (clientKind(mockOnly) !== 'live' || tenantId === SOCIAL_SAMPLE_SCOPE) return null;
  const profileId = await storedZernioProfileId(tenantId);
  if (!profileId) return 'empty';
  const live = new LiveSocialClient(readZernioSocialKey());
  return {
    list: (kind) => live.inboxList(profileId, kind),
    thread: (kind, id, accountId) => live.inboxThread(kind, id, accountId),
    reply: (kind, id, accountId, message, commentId) => live.inboxReply(kind, id, accountId, message, commentId),
  };
}

function parseListing(kind: InboxKind, body: unknown): InboxListing {
  if (kind === 'message') return { kind, items: readConversations(body) };
  if (kind === 'comment') return { kind, items: readCommentThreads(body) };
  return { kind, items: readReviews(body) };
}

export async function loadSocialInbox(tenantId: string, kind: InboxKind, now = new Date(), mockOnly = false): Promise<InboxListing | null> {
  const source = await inboxSource(tenantId, now, mockOnly);
  if (!source) return null;
  if (source === 'empty') return parseListing(kind, []);
  const body = await source.list(kind);
  return body === null ? null : parseListing(kind, body);
}

/** The owned item for an id, with the account it belongs to, or 'not_found'. */
async function ownedItem(source: InboxSource, kind: InboxKind, id: string) {
  const body = await source.list(kind);
  if (body === null) return null;
  const listing = parseListing(kind, body);
  const item = (listing.items as Array<{ id?: string; postId?: string; accountId: string }>).find((entry) => (entry.id ?? entry.postId) === id);
  return item ?? 'not_found';
}

export type InboxThread =
  | { readonly kind: 'message'; readonly messages: InboxMessage[] }
  | { readonly kind: 'comment'; readonly comments: InboxComment[] };

export async function loadSocialInboxThread(
  tenantId: string, kind: 'message' | 'comment', id: string, now = new Date(), mockOnly = false,
): Promise<InboxThread | 'not_found' | null> {
  const source = await inboxSource(tenantId, now, mockOnly);
  if (!source) return null;
  if (source === 'empty') return 'not_found';
  const item = await ownedItem(source, kind, id);
  if (item === null || item === 'not_found') return item;
  const body = await source.thread(kind, id, item.accountId);
  if (body === null) return null;
  return kind === 'message' ? { kind, messages: readMessages(body) } : { kind, comments: readComments(body) };
}

export async function replySocialInbox(
  tenantId: string, kind: InboxKind, id: string, message: string, commentId: string | undefined, now = new Date(), mockOnly = false,
): Promise<'sent' | 'not_found' | null> {
  const source = await inboxSource(tenantId, now, mockOnly);
  if (!source) return null;
  if (source === 'empty') return 'not_found';
  const item = await ownedItem(source, kind, id);
  if (item === null || item === 'not_found') return item;
  if (kind === 'comment') {
    // The comment answered must be one under this ministry's own post.
    const thread = await source.thread('comment', id, item.accountId);
    if (thread === null) return null;
    if (!commentId || !readComments(thread).some((comment) => comment.id === commentId)) return 'not_found';
  }
  return (await source.reply(kind, id, item.accountId, message, commentId)) ? 'sent' : null;
}

/**
 * Auto-DM. The provider key is shared by every ministry, so an automation is
 * read, changed or deleted only when it is in THIS ministry's own profile list
 * and runs on one of its own Instagram or Facebook accounts. A post it is tied
 * to before publishing must be one of the ministry's own posts on that account.
 */
export interface AutoDmAccount {
  readonly id: string;
  readonly platform: AutoDmPlatform;
  readonly username: string;
  readonly displayName: string;
}

export interface AutoDmPostChoice {
  readonly id: string;
  readonly accountId: string;
  readonly title: string;
  readonly status: SocialPost['status'];
  readonly scheduledFor: string | null;
}

export interface AutoDmWorkspace {
  readonly rules: AutoDmRule[];
  readonly accounts: AutoDmAccount[];
  readonly posts: AutoDmPostChoice[];
}

type AutoDmSource = {
  list(): Promise<unknown | null>;
  create(body: Record<string, unknown>): Promise<unknown | null>;
  update(id: string, body: Record<string, unknown>): Promise<unknown | null>;
  remove(id: string): Promise<boolean>;
  logs(id: string): Promise<unknown | null>;
};

async function autoDmSource(tenantId: string, now: Date, mockOnly: boolean): Promise<{ source: AutoDmSource; workspace: SocialWorkspace } | null> {
  const workspace = await loadSocialWorkspace(tenantId, now, mockOnly);
  if (!workspace) return null;
  if (clientKind(mockOnly) === 'mock') {
    const mock = new MockSocialClient(tenantId, now);
    return {
      workspace,
      source: {
        list: async () => mock.autoDmList(),
        create: async (body) => mock.autoDmCreate(body),
        update: async (id, body) => mock.autoDmUpdate(id, body),
        remove: async (id) => mock.autoDmDelete(id),
        logs: async (id) => mock.autoDmLogs(id),
      },
    };
  }
  if (clientKind(mockOnly) !== 'live') return null;
  const live = new LiveSocialClient(readZernioSocialKey());
  return {
    workspace,
    source: {
      list: () => live.autoDmList(workspace.profileId),
      create: (body) => live.autoDmCreate(body),
      update: (id, body) => live.autoDmUpdate(id, body),
      remove: (id) => live.autoDmDelete(id),
      logs: (id) => live.autoDmLogs(id),
    },
  };
}

function autoDmAccounts(workspace: SocialWorkspace): AutoDmAccount[] {
  return workspace.accounts.flatMap((account) => isAutoDmPlatform(account.platform)
    ? [{ id: account.id, platform: account.platform, username: account.username, displayName: account.displayName }]
    : []);
}

function autoDmPosts(workspace: SocialWorkspace, accounts: readonly AutoDmAccount[]): AutoDmPostChoice[] {
  const ids = new Set(accounts.map((account) => account.id));
  return workspace.posts.flatMap((post) => post.targets
    .filter((target) => ids.has(target.accountId))
    .map((target) => ({ id: post.id, accountId: target.accountId, title: (target.text || post.content).slice(0, 120), status: post.status, scheduledFor: post.scheduledFor })));
}

async function ownedRules(source: AutoDmSource, accounts: readonly AutoDmAccount[]): Promise<AutoDmRule[] | null> {
  const body = await source.list();
  if (body === null) return null;
  const ids = new Set(accounts.map((account) => account.id));
  return readAutoDmRules(body).filter((rule) => ids.has(rule.accountId));
}

export async function loadAutoDm(tenantId: string, now = new Date(), mockOnly = false): Promise<AutoDmWorkspace | null> {
  const found = await autoDmSource(tenantId, now, mockOnly);
  if (!found) return null;
  const accounts = autoDmAccounts(found.workspace);
  const rules = await ownedRules(found.source, accounts);
  if (!rules) return null;
  return { rules, accounts, posts: autoDmPosts(found.workspace, accounts) };
}

export type AutoDmSave =
  | { readonly ok: true; readonly rule: AutoDmRule }
  | { readonly ok: false; readonly error: 'auto_dm_invalid'; readonly message: string }
  | { readonly ok: false; readonly error: 'account_not_owned' | 'auto_dm_not_found' | 'social_unavailable' };

function readSaved(body: unknown, fallback: { id: string; input: AutoDmInput; platform: AutoDmPlatform }): AutoDmRule {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const parsed = readAutoDmRule(record.automation ?? record.data ?? record);
  if (parsed) return parsed;
  return { ...fallback.input, id: fallback.id, platform: fallback.platform, stats: { triggered: null, sent: null, failed: null, clicks: null } };
}

/** Creates an automation (no id) or replaces one this ministry owns. The account never changes. */
export async function saveAutoDm(
  tenantId: string, id: string | null, raw: unknown, now = new Date(), mockOnly = false,
): Promise<AutoDmSave> {
  const found = await autoDmSource(tenantId, now, mockOnly);
  if (!found) return { ok: false, error: 'social_unavailable' };
  const accounts = autoDmAccounts(found.workspace);
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  let accountId = typeof input.accountId === 'string' ? input.accountId : '';
  if (id) {
    const rules = await ownedRules(found.source, accounts);
    if (!rules) return { ok: false, error: 'social_unavailable' };
    const existing = rules.find((rule) => rule.id === id);
    if (!existing) return { ok: false, error: 'auto_dm_not_found' };
    accountId = existing.accountId;
  }
  const account = accounts.find((entry) => entry.id === accountId);
  if (!account) return { ok: false, error: 'account_not_owned' };
  const checked = checkAutoDm({ ...input, accountId }, account.platform);
  if (!checked.ok) return { ok: false, error: 'auto_dm_invalid', message: checked.message };
  const value = checked.value;
  if (value.postId && !autoDmPosts(found.workspace, [account]).some((post) => post.id === value.postId)) {
    return { ok: false, error: 'auto_dm_invalid', message: 'That post is not one of this account’s posts.' };
  }
  const body = toZernioAutomation(value, account.platform, id ? 'update' : { profileId: found.workspace.profileId });
  const saved = id ? await found.source.update(id, body) : await found.source.create(body);
  if (saved === null) return { ok: false, error: 'social_unavailable' };
  const record = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
  const nested = record.automation && typeof record.automation === 'object' ? (record.automation as Record<string, unknown>) : record;
  const newId = id ?? (typeof nested._id === 'string' ? nested._id : typeof nested.id === 'string' ? nested.id : '');
  if (!newId) return { ok: false, error: 'social_unavailable' };
  return { ok: true, rule: readSaved(saved, { id: newId, input: value, platform: account.platform }) };
}

async function ownedRule(tenantId: string, id: string, now: Date, mockOnly: boolean): Promise<{ source: AutoDmSource } | 'not_found' | null> {
  const found = await autoDmSource(tenantId, now, mockOnly);
  if (!found) return null;
  const rules = await ownedRules(found.source, autoDmAccounts(found.workspace));
  if (!rules) return null;
  return rules.some((rule) => rule.id === id) ? { source: found.source } : 'not_found';
}

export async function deleteAutoDm(tenantId: string, id: string, now = new Date(), mockOnly = false): Promise<'deleted' | 'not_found' | null> {
  const owned = await ownedRule(tenantId, id, now, mockOnly);
  if (owned === null || owned === 'not_found') return owned;
  return (await owned.source.remove(id)) ? 'deleted' : null;
}

export async function loadAutoDmLogs(tenantId: string, id: string, now = new Date(), mockOnly = false): Promise<AutoDmLog[] | 'not_found' | null> {
  const owned = await ownedRule(tenantId, id, now, mockOnly);
  if (owned === null || owned === 'not_found') return owned;
  const body = await owned.source.logs(id);
  return body === null ? null : readAutoDmLogs(body);
}
