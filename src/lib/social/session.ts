import { LiveSocialClient } from './live-client';
import { MockSocialClient } from './mock-client';
import { SOCIAL_SAMPLE_SCOPE, socialMode } from './mode';
import { commitZernioProfile, releaseZernioProfileClaim, reserveZernioProfile } from './profile-lock';
import { oncePublish } from './publish-once';
import { readZernioSocialKey } from './zernio-key';
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
    return { ok: true, authUrl: null, sample: true };
  }
  if (clientKind(mockOnly) !== 'live') return { ok: false };
  const workspace = await loadSocialWorkspace(tenantId, new Date(), mockOnly);
  if (!workspace) return { ok: false };
  const url = await new LiveSocialClient(readZernioSocialKey()).connectUrl(workspace.profileId, platform);
  if (!url) return { ok: false };
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
  const post = draft.publishNow && draft.idempotencyKey
    ? await oncePublish(tenantId, draft.idempotencyKey, socialMode() === 'live', create)
    : await create();
  if (!post) return { ok: false, error: 'social_unavailable' };
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
  return { ok: true, post };
}

export async function cancelSocialPost(tenantId: string, id: string, mockOnly = false): Promise<boolean> {
  if (clientKind(mockOnly) === 'mock') return new MockSocialClient(tenantId, new Date()).cancel(id);
  if (clientKind(mockOnly) !== 'live') return false;
  const workspace = await loadSocialWorkspace(tenantId, new Date(), mockOnly);
  if (!workspace || !workspace.posts.some((post) => post.id === id)) return false;
  return new LiveSocialClient(readZernioSocialKey()).cancel(id);
}
