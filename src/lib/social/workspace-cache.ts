import type { SocialWorkspace } from './types';

/**
 * A live workspace is two provider reads. The bootstrap screen waits on both,
 * and a repeat visit was paying that cost again. Fifteen seconds is long
 * enough to cover a reload and short enough that a disconnected account does
 * not stay on screen. A failed read is not stored: the next request still
 * answers 503.
 */
const TTL_MS = 15_000;

const stored = new Map<string, { at: number; workspace: SocialWorkspace }>();
const inflight = new Map<string, Promise<SocialWorkspace | null>>();

export function readWorkspaceCache(tenantId: string, now = Date.now()): SocialWorkspace | null {
  const hit = stored.get(tenantId);
  if (!hit) return null;
  if (now - hit.at >= TTL_MS) {
    stored.delete(tenantId);
    return null;
  }
  return hit.workspace;
}

export function rememberWorkspace(tenantId: string, workspace: SocialWorkspace, now = Date.now()): void {
  stored.set(tenantId, { at: now, workspace });
}

export function dropWorkspaceCache(tenantId: string): void {
  stored.delete(tenantId);
}

export function shareLiveLoad(
  tenantId: string,
  load: () => Promise<SocialWorkspace | null>,
): Promise<SocialWorkspace | null> {
  const cached = readWorkspaceCache(tenantId);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(tenantId);
  if (pending) return pending;
  const promise = load()
    .then((workspace) => {
      if (workspace) rememberWorkspace(tenantId, workspace);
      return workspace;
    })
    .finally(() => {
      if (inflight.get(tenantId) === promise) inflight.delete(tenantId);
    });
  inflight.set(tenantId, promise);
  return promise;
}

export function resetWorkspaceCache(): void {
  stored.clear();
  inflight.clear();
}
