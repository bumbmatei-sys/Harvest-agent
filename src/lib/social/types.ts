import type { SocialPlatform } from './platforms';

export type SocialPostStatus = 'draft' | 'scheduled' | 'sent' | 'failed';

export interface SocialAccount {
  readonly id: string;
  readonly platform: SocialPlatform;
  readonly username: string;
  readonly displayName: string;
}

export interface SocialMedia {
  readonly name: string;
  readonly kind: 'image' | 'video';
}

export interface SocialTarget {
  readonly platform: SocialPlatform;
  readonly accountId: string;
  readonly text: string;
  readonly fields: Readonly<Record<string, string | boolean>>;
  readonly madeWithAi: boolean;
}

export interface SocialPost {
  readonly id: string;
  readonly content: string;
  readonly status: SocialPostStatus;
  readonly scheduledFor: string | null;
  readonly timezone: string;
  readonly targets: readonly SocialTarget[];
  readonly media: readonly SocialMedia[];
}

export interface SocialWorkspace {
  readonly profileId: string;
  readonly sample: boolean;
  readonly timezone: string;
  readonly accounts: readonly SocialAccount[];
  readonly posts: readonly SocialPost[];
}

export interface SocialPostDraft {
  readonly content: string;
  readonly scheduledFor: string | null;
  readonly publishNow: boolean;
  readonly timezone: string;
  readonly targets: readonly SocialTarget[];
  readonly media: readonly SocialMedia[];
}
