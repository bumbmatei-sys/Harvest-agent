import { getTenantPrivate, tenantPrivateRef } from '@/lib/tenant-private';
import { LiveSocialClient } from './live-client';
import { MockSocialClient } from './mock-client';
import { socialMode } from './mode';
import type { SocialPlatform } from './platforms';
import type { SocialPost, SocialPostDraft, SocialWorkspace } from './types';

/**
 * One profile per ministry, created the first time a live call needs it.
 * The mock never reads or writes Firestore, so a preview cannot surface a
 * real church's accounts.
 */

export async function loadSocialWorkspace(tenantId: string, now = new Date()): Promise<SocialWorkspace | null> {
  if (socialMode() !== 'live') return new MockSocialClient(tenantId, now).load();
  const key = (process.env.ZERNIO_API_KEY || '').trim();
  const live = new LiveSocialClient(key);
  const privateData = await getTenantPrivate(tenantId);
  const existing = typeof privateData.zernioProfileId === 'string' ? privateData.zernioProfileId : null;
  const profileId = await live.ensureProfile(tenantId, existing);
  if (!profileId) return null;
  if (profileId !== existing) {
    await tenantPrivateRef(tenantId).set({ zernioProfileId: profileId }, { merge: true });
  }
  return live.load(profileId);
}

export async function connectSocialAccount(
  tenantId: string,
  platform: SocialPlatform,
): Promise<{ ok: true; authUrl: string | null; sample: boolean } | { ok: false }> {
  if (socialMode() !== 'live') {
    new MockSocialClient(tenantId, new Date()).connect(platform);
    return { ok: true, authUrl: null, sample: true };
  }
  const workspace = await loadSocialWorkspace(tenantId);
  if (!workspace) return { ok: false };
  const key = (process.env.ZERNIO_API_KEY || '').trim();
  const url = await new LiveSocialClient(key).connectUrl(workspace.profileId, platform);
  if (!url) return { ok: false };
  return { ok: true, authUrl: url, sample: false };
}

export async function createSocialPost(tenantId: string, draft: SocialPostDraft): Promise<SocialPost | null> {
  if (socialMode() !== 'live') return new MockSocialClient(tenantId, new Date()).create(draft);
  const workspace = await loadSocialWorkspace(tenantId);
  if (!workspace) return null;
  const key = (process.env.ZERNIO_API_KEY || '').trim();
  return new LiveSocialClient(key).create(workspace.profileId, draft);
}

export async function updateSocialPost(
  tenantId: string,
  id: string,
  draft: SocialPostDraft,
): Promise<SocialPost | null> {
  if (socialMode() !== 'live') return new MockSocialClient(tenantId, new Date()).update(id, draft);
  const workspace = await loadSocialWorkspace(tenantId);
  if (!workspace || !workspace.posts.some((post) => post.id === id)) return null;
  const key = (process.env.ZERNIO_API_KEY || '').trim();
  return new LiveSocialClient(key).update(id, draft);
}

export async function cancelSocialPost(tenantId: string, id: string): Promise<boolean> {
  if (socialMode() !== 'live') return new MockSocialClient(tenantId, new Date()).cancel(id);
  const workspace = await loadSocialWorkspace(tenantId);
  if (!workspace || !workspace.posts.some((post) => post.id === id)) return false;
  const key = (process.env.ZERNIO_API_KEY || '').trim();
  return new LiveSocialClient(key).cancel(id);
}
