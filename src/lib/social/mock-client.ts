import type { SocialPlatform } from './platforms';
import type { SocialAccount, SocialPost, SocialPostDraft, SocialWorkspace } from './types';

/**
 * Seeded fiction. The display name is not a tenant's name and the posts are
 * not a tenant's posts. The tenant id is used only to keep one ministry's
 * mock edits off another's.
 */

const SAMPLE_TIMEZONE = 'America/Chicago';

function seedAccounts(): SocialAccount[] {
  return [
    { id: 'sample-ig', platform: 'instagram', username: 'sampleministry', displayName: 'Sample Ministry' },
    { id: 'sample-fb', platform: 'facebook', username: 'sampleministry', displayName: 'Sample Ministry' },
    { id: 'sample-yt', platform: 'youtube', username: 'sampleministry', displayName: 'Sample Ministry' },
  ];
}

function monthStamp(now: Date, day: number, hour: number): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  const h = String(hour).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:00:00.000Z`;
}

function seedPosts(now: Date): SocialPost[] {
  const ig = { platform: 'instagram' as const, accountId: 'sample-ig', text: '', fields: {}, madeWithAi: false };
  return [
    {
      id: 'sample-draft',
      content: 'This Sunday: a short word on the parable of the sower. Service at 10.',
      status: 'draft',
      scheduledFor: null,
      timezone: SAMPLE_TIMEZONE,
      targets: [{ ...ig, text: 'This Sunday: a short word on the parable of the sower. Service at 10.' }],
      media: [],
    },
    {
      id: 'sample-scheduled',
      content: 'Verse of the day. "The light shines in the darkness."',
      status: 'scheduled',
      scheduledFor: monthStamp(now, 12, 15),
      timezone: SAMPLE_TIMEZONE,
      targets: [{ ...ig, text: 'Verse of the day. "The light shines in the darkness."' }],
      media: [],
    },
    {
      id: 'sample-sent',
      content: 'Thank you for gathering with us last Sunday.',
      status: 'sent',
      scheduledFor: monthStamp(now, 4, 15),
      timezone: SAMPLE_TIMEZONE,
      targets: [{
        platform: 'facebook',
        accountId: 'sample-fb',
        text: 'Thank you for gathering with us last Sunday.',
        fields: {},
        madeWithAi: false,
      }],
      media: [],
    },
  ];
}

interface MutableWorkspace {
  profileId: string;
  accounts: SocialAccount[];
  posts: SocialPost[];
}

const stores = new Map<string, MutableWorkspace>();

function workspace(tenantId: string, now: Date): MutableWorkspace {
  const existing = stores.get(tenantId);
  if (existing) return existing;
  const created: MutableWorkspace = {
    profileId: `sample-${tenantId}`,
    accounts: seedAccounts(),
    posts: seedPosts(now),
  };
  stores.set(tenantId, created);
  return created;
}

export function resetSocialMock(): void {
  stores.clear();
}

function view(tenantId: string, now: Date): SocialWorkspace {
  const state = workspace(tenantId, now);
  return {
    profileId: state.profileId,
    sample: true,
    timezone: SAMPLE_TIMEZONE,
    accounts: state.accounts.map((account) => ({ ...account })),
    posts: state.posts.map((post) => ({
      ...post,
      targets: post.targets.map((target) => ({ ...target, fields: { ...target.fields } })),
      media: post.media.map((item) => ({ ...item })),
    })),
  };
}

export class MockSocialClient {
  readonly mode = 'mock' as const;

  constructor(
    private readonly tenantId: string,
    private readonly now: Date,
  ) {}

  load(): SocialWorkspace {
    return view(this.tenantId, this.now);
  }

  connect(platform: SocialPlatform): { connected: false; reason: 'preview_connect_disabled' } {
    // The platform has already passed the allow-list. The mock still refuses
    // to open a provider consent screen.
    void platform;
    return { connected: false, reason: 'preview_connect_disabled' };
  }

  create(draft: SocialPostDraft): SocialPost {
    const state = workspace(this.tenantId, this.now);
    const post: SocialPost = {
      id: `sample-${state.posts.length + 1}`,
      content: draft.content,
      status: draft.publishNow ? 'sent' : draft.scheduledFor ? 'scheduled' : 'draft',
      scheduledFor: draft.publishNow ? this.now.toISOString() : draft.scheduledFor,
      timezone: draft.timezone || SAMPLE_TIMEZONE,
      targets: draft.targets.map((target) => ({ ...target, fields: { ...target.fields } })),
      media: draft.media.map((item) => ({ ...item })),
    };
    state.posts = [post, ...state.posts];
    return post;
  }

  update(id: string, draft: SocialPostDraft): SocialPost | null {
    const state = workspace(this.tenantId, this.now);
    const current = state.posts.find((post) => post.id === id);
    if (!current || current.status === 'sent') return null;
    const next: SocialPost = {
      ...current,
      content: draft.content,
      status: draft.publishNow ? 'sent' : draft.scheduledFor ? 'scheduled' : 'draft',
      scheduledFor: draft.publishNow ? this.now.toISOString() : draft.scheduledFor,
      timezone: draft.timezone || current.timezone,
      targets: draft.targets.map((target) => ({ ...target, fields: { ...target.fields } })),
      media: draft.media.map((item) => ({ ...item })),
    };
    state.posts = state.posts.map((post) => (post.id === id ? next : post));
    return next;
  }

  cancel(id: string): boolean {
    const state = workspace(this.tenantId, this.now);
    const current = state.posts.find((post) => post.id === id);
    if (!current || current.status === 'sent') return false;
    state.posts = state.posts.filter((post) => post.id !== id);
    return true;
  }
}
