import { describe, expect, it } from 'vitest';
import type { SocialWorkspace } from '../types';
import { readWorkspaceCache, rememberWorkspace, resetWorkspaceCache } from '../workspace-cache';

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
});
