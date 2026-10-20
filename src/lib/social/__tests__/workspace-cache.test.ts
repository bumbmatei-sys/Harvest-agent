import { describe, expect, it } from 'vitest';
import type { SocialWorkspace } from '../types';
import {
  dropWorkspaceCache,
  readWorkspaceCache,
  rememberWorkspace,
  resetWorkspaceCache,
  shareLiveLoad,
} from '../workspace-cache';

const workspace: SocialWorkspace = {
  profileId: 'profile-1',
  sample: false,
  timezone: 'UTC',
  accounts: [],
  posts: [],
};

describe('workspace cache', () => {
  it('expires a remembered workspace after fifteen seconds', () => {
    resetWorkspaceCache();
    rememberWorkspace('tenant-a', workspace, 1_000);
    expect(readWorkspaceCache('tenant-a', 1_000 + 14_999)).toEqual(workspace);
    expect(readWorkspaceCache('tenant-a', 1_000 + 15_000)).toBeNull();
  });

  it('does not store a load that a write invalidated while it was running', async () => {
    resetWorkspaceCache();
    let release!: (value: SocialWorkspace) => void;
    const pending = new Promise<SocialWorkspace>((resolve) => {
      release = resolve;
    });
    const loading = shareLiveLoad('tenant-a', () => pending);
    dropWorkspaceCache('tenant-a');
    release(workspace);
    await loading;
    expect(readWorkspaceCache('tenant-a')).toBeNull();
  });
});
