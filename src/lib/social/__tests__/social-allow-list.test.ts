import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LiveSocialClient, buildZernioRequest } from '../live-client';
import { MockSocialClient, resetSocialMock } from '../mock-client';
import { socialMode, socialSampleWithoutEntitlement } from '../mode';
import {
  SOCIAL_PLATFORMS,
  parseSocialPlatform,
  platformsSupportingMadeWithAi,
} from '../platforms';
import { parseConnectPlatform, parseSocialDraft } from '../draft';
import type { SocialPostDraft } from '../types';

const ROOT = path.resolve(__dirname, '../../../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue;
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(abs);
  }
  return out;
}

const clock = new Date(Date.UTC(2024, 2, 15, 12));

function draft(platform: string, extra: Record<string, unknown> = {}) {
  return {
    content: 'A short word for Sunday.',
    publishNow: false,
    scheduledFor: '2024-06-02T15:00:00.000Z',
    targets: [{
      platform,
      accountId: 'acct-1',
      text: 'A short word for Sunday.',
      madeWithAi: true,
      ...extra,
    }],
  };
}

describe('the thirteen platforms', () => {
  it('names exactly the offered networks', () => {
    expect([...SOCIAL_PLATFORMS]).toEqual([
      'instagram', 'tiktok', 'youtube', 'linkedin', 'pinterest', 'facebook',
      'threads', 'bluesky', 'snapchat', 'googlebusiness', 'reddit', 'telegram', 'whatsapp',
    ]);
  });

  it('accepts those slugs and rejects everything else, including X', () => {
    for (const slug of SOCIAL_PLATFORMS) {
      expect(parseSocialPlatform(slug)).toBe(slug);
      expect(parseSocialPlatform(`  ${slug.toUpperCase()}  `)).toBe(slug);
    }
    for (const refused of ['twitter', 'x', 'X', 'Twitter', ' TWITTER ', 'discord', 'slack', '', 1, null]) {
      expect(parseSocialPlatform(refused)).toBeNull();
    }
  });

  it('does not offer Made with AI on any allowed platform', () => {
    expect(platformsSupportingMadeWithAi([...SOCIAL_PLATFORMS])).toEqual([]);
  });
});

describe('draft parsing refuses a platform before a provider is asked', () => {
  it.each(['twitter', 'x', 'X', 'Twitter', 'discord', 'slack'])(
    'connect and schedule refuse %s',
    (platform) => {
      expect(parseConnectPlatform({ platform })).toBeNull();
      expect(parseSocialDraft(draft(platform))).toEqual({ ok: false, error: 'platform_not_offered' });
      expect(parseSocialDraft({ ...draft(platform), publishNow: true })).toEqual({
        ok: false,
        error: 'platform_not_offered',
      });
    },
  );

  it('keeps an offered platform and forces the AI flag off', () => {
    const parsed = parseSocialDraft(draft('instagram'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.draft.targets[0]?.platform).toBe('instagram');
    expect(parsed.draft.targets[0]?.madeWithAi).toBe(false);
  });

  it('one refused target refuses the whole post', () => {
    const body = draft('instagram');
    body.targets.push({ platform: 'twitter', accountId: 'x', text: 'no', madeWithAi: false });
    expect(parseSocialDraft(body).ok).toBe(false);
  });
});

describe('mock mode', () => {
  it('preview, a missing key, and an explicit mock never go live', () => {
    expect(socialMode({ VERCEL_ENV: 'preview', ZERNIO_API_KEY: 'secret', ZERNIO_SOCIAL_LIVE: '1' })).toBe('mock');
    expect(socialMode({})).toBe('mock');
    expect(socialMode({ ZERNIO_API_KEY: 'secret' })).toBe('mock');
    expect(socialMode({ ZERNIO_API_KEY: 'secret', ZERNIO_SOCIAL_LIVE: '1' })).toBe('live');
    expect(socialMode({ ZERNIO_SOCIAL_MODE: 'mock', ZERNIO_API_KEY: 'secret', ZERNIO_SOCIAL_LIVE: '1' })).toBe('mock');
  });

  it('sample without entitlement is preview or an explicit sample flag, and still requires mock', () => {
    expect(socialSampleWithoutEntitlement({ VERCEL_ENV: 'preview' })).toBe(true);
    expect(socialSampleWithoutEntitlement({ ZERNIO_SOCIAL_MODE: 'sample' })).toBe(true);
    expect(socialSampleWithoutEntitlement({})).toBe(false);
    expect(socialMode({ VERCEL_ENV: 'preview', ZERNIO_API_KEY: 'secret', ZERNIO_SOCIAL_LIVE: '1' })).toBe('mock');
  });

  it('seeds fiction and does not open a connection', () => {
    resetSocialMock();
    const workspace = new MockSocialClient('grace-chapel', clock).load();
    const visible = JSON.stringify({ accounts: workspace.accounts, posts: workspace.posts });
    expect(visible).not.toContain('grace-chapel');
    expect(workspace.accounts.every((account) => account.displayName === 'Sample Ministry')).toBe(true);
    expect(workspace.posts.some((post) => post.status === 'scheduled')).toBe(true);
    expect(new MockSocialClient('grace-chapel', clock).connect('instagram')).toEqual({
      connected: false,
      reason: 'preview_connect_disabled',
    });
    expect(new MockSocialClient('grace-chapel', clock).load().accounts).toHaveLength(3);
  });
});

describe('the live client', () => {
  const key = 'zernio-secret-not-for-the-browser';

  it('puts the key on the header and never on the URL', () => {
    const request = buildZernioRequest(key, '/profiles', { method: 'POST', body: { name: 'harvest-a' } });
    expect(request.url).toBe('https://api.zernio.com/v1/profiles');
    expect(request.url).not.toContain(key);
    expect(request.headers.Authorization).toBe(`Bearer ${key}`);
    expect(JSON.stringify(request.body)).not.toContain(key);
  });

  it('drops an X-only post and does not send the AI flag for Instagram', async () => {
    const seen: { url: string; body?: string }[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      seen.push({ url, body: typeof init.body === 'string' ? init.body : undefined });
      if (url.endsWith('/posts') && init.method === 'POST') {
        return new Response(JSON.stringify({
          post: {
            id: 'p1',
            content: 'no',
            status: 'draft',
            platforms: [{ platform: 'twitter', accountId: 'x1', platformSpecificData: { madeWithAi: true } }],
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ post: null }), { status: 200 });
    };
    const client = new LiveSocialClient(key, fetchImpl);
    const created = await client.create('profile-1', {
      content: 'Sunday',
      scheduledFor: '2024-06-02T15:00:00.000Z',
      publishNow: false,
      timezone: 'UTC',
      media: [],
      targets: [{
        platform: 'instagram',
        accountId: 'ig',
        text: 'Sunday',
        fields: {},
        madeWithAi: true,
      }],
    });
    expect(created).toBeNull();
    const sent = JSON.parse(seen[0]?.body || '{}');
    expect(sent.platforms[0].platform).toBe('instagram');
    expect(sent.platforms[0].platformSpecificData.madeWithAi).toBeUndefined();
    expect(JSON.stringify(sent)).not.toContain(key);
    expect(seen[0]?.url).not.toContain(key);
  });

  it('refuses a connect URL for a slug outside the allow-list', async () => {
    const fetchImpl = async () => new Response('{}', { status: 200 });
    const client = new LiveSocialClient(key, fetchImpl);
    const url = await client.connectUrl('profile-1', 'twitter' as SocialPostDraft['targets'][number]['platform']);
    expect(url).toBeNull();
  });
});

describe('the key stays on the server', () => {
  const socialTree = [
    ...walk(path.join(ROOT, 'src/lib/social')),
    ...walk(path.join(ROOT, 'src/app/api/social')),
    ...walk(path.join(ROOT, 'src/components/admin/social')),
    ...walk(path.join(ROOT, 'src/app/dev/social-scheduler')),
  ];

  it('the social feature does not import the SMS transport', () => {
    const offenders = socialTree.filter((file) => {
      const text = readFileSync(file, 'utf8');
      return text.includes("from '@/lib/zernio'") || text.includes("from './zernio'");
    });
    expect(offenders).toEqual([]);
  });

  it('the browser surfaces never mention the key', () => {
    const leaked = socialTree
      .filter((file) => !file.endsWith('live-client.ts') && !file.endsWith('mode.ts') && !file.endsWith('session.ts'))
      .filter((file) => readFileSync(file, 'utf8').includes('ZERNIO_API_KEY'));
    expect(leaked).toEqual([]);
  });
});
