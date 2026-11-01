import { describe, expect, it } from 'vitest';
import {
  autoDmTotals, checkAutoDm, newAutoDm, readAutoDmLogs, readAutoDmRules, toZernioAutomation, triggerAllowed,
  type AutoDmInput,
} from '../auto-dm';
import { LiveSocialClient } from '../live-client';

const base = (patch: Partial<AutoDmInput> & Record<string, unknown> = {}) => ({
  ...newAutoDm('acc-ig'), name: 'Guide', keywords: ['guide'], dmMessage: 'Hey {{first_name}}!', ...patch,
});
const check = (patch: Record<string, unknown>, platform: 'instagram' | 'facebook' = 'instagram') => checkAutoDm(base(patch), platform);
const message = (patch: Record<string, unknown>, platform: 'instagram' | 'facebook' = 'instagram') => {
  const result = check(patch, platform);
  return result.ok ? null : result.message;
};

describe('Auto-DM: what an automation may say (Zernio comment-to-DM)', () => {
  it('accepts a plain keyword DM and fills Zernio defaults', () => {
    const result = check({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ trigger: 'comment', matchMode: 'word', linkTracking: true, repeatMode: 'once', isActive: true, platformPostId: null });
  });

  it('needs a name and a DM, and keeps the DM under 1000, or 640 once it has buttons', () => {
    expect(message({ name: ' ' })).toMatch(/name/);
    expect(message({ dmMessage: '' })).toMatch(/Write the DM/);
    expect(message({ dmMessage: 'a'.repeat(1000) })).toBeNull();
    expect(message({ dmMessage: 'a'.repeat(1001) })).toMatch(/1000/);
    expect(message({ dmMessage: 'a'.repeat(641), buttons: [{ type: 'url', title: 'Open', url: 'https://x.test' }] })).toMatch(/640.*buttons/);
  });

  it('keeps every trigger but comments on Instagram', () => {
    for (const trigger of ['story_reply', 'story_mention', 'live_comment'] as const) {
      expect(triggerAllowed(trigger, 'facebook')).toBe(false);
      expect(message({ trigger, keywords: [] }, 'facebook')).toMatch(/Instagram only/);
    }
    expect(triggerAllowed('comment', 'facebook')).toBe(true);
  });

  it('gives a story mention no keywords, and no post or public reply', () => {
    expect(message({ trigger: 'story_mention' })).toMatch(/no keywords/);
    const result = check({ trigger: 'story_mention', keywords: [], platformPostId: '123', commentReply: 'Thanks!' });
    expect(result.ok && [result.value.platformPostId, result.value.commentReply]).toEqual([null, '']);
  });

  it('reads buttons: up to three, labels up to 20, https links, and call buttons on Facebook only', () => {
    const button = (b: Record<string, unknown>) => ({ buttons: [b] });
    expect(message(button({ type: 'url', title: 'Open', url: 'javascript:alert(1)' }))).toMatch(/https/);
    expect(message(button({ type: 'url', title: 'x'.repeat(21), url: 'https://x.test' }))).toMatch(/20/);
    expect(message(button({ type: 'phone', title: 'Call', phone: '+14155551234' }))).toMatch(/Facebook only/);
    expect(message(button({ type: 'phone', title: 'Call', phone: '+1 (415) 555-1234' }), 'facebook')).toBeNull();
    expect(message(button({ type: 'postback', title: 'Go', payload: 'x' }))).toMatch(/link/);
    expect(message({ buttons: Array.from({ length: 4 }, () => ({ type: 'url', title: 'A', url: 'https://x.test' })) })).toMatch(/up to 3/);
  });

  it('caps keywords and versions, drops blanks and duplicates, and only fuzzes whole-word matching', () => {
    const result = check({ keywords: ['Guide', 'guide', ' ', 'pdf'], typoTolerance: true, matchMode: 'contains' });
    expect(result.ok && [result.value.keywords, result.value.typoTolerance]).toEqual([['Guide', 'pdf'], false]);
    expect(message({ keywords: Array.from({ length: 21 }, (_, i) => `k${i}`) })).toMatch(/20 keywords/);
    expect(message({ dmMessageVariations: ['a', 'b', 'c', 'd', 'e', 'f'] })).toMatch(/up to 5/);
  });

  it('refuses to answer every DM: matching DMs needs a keyword, and story replies are already DMs', () => {
    expect(message({ alsoMatchInDms: true, keywords: [] })).toMatch(/every message/);
    expect(message({ alsoMatchInDms: true, trigger: 'story_reply' })).toMatch(/already arrive as DMs/);
  });

  it('bounds delays to a day and hours to 720, and drops a cooldown unless every comment is answered', () => {
    expect(message({ dmDelaySeconds: 86_401 })).toMatch(/24 hours/);
    expect(message({ dedupeSameTextHours: 721 })).toMatch(/720/);
    const once = check({ repeatMode: 'once', cooldownHours: 5 });
    expect(once.ok && once.value.cooldownHours).toBeNull();
    const every = check({ repeatMode: 'every_comment', cooldownHours: '24' });
    expect(every.ok && every.value.cooldownHours).toBe(24);
  });

  it('keeps follower rules and the follow gate to Instagram', () => {
    const audience = { followerStatus: 'follower', minFollowerCount: 100, whenUnknown: 'verify', tapToUnlock: true };
    const ig = check({ audience, followGate: { message: 'Follow us, then tap.' } });
    expect(ig.ok && ig.value.audience).toEqual(audience);
    const fb = check({ accountId: 'acc-fb', audience, followGate: { message: 'x' } }, 'facebook');
    expect(fb.ok && [fb.value.audience.followerStatus, fb.value.followGate.message]).toEqual(['any', '']);
  });
});

describe('Auto-DM: the Zernio body and what comes back', () => {
  const value = (() => {
    const result = check({
      buttons: [{ type: 'url', title: 'Get it', url: 'https://x.test/guide' }],
      commentReply: 'Check your DMs!', repeatMode: 'every_comment', cooldownHours: 24, likeComment: true,
      audience: { followerStatus: 'follower', whenUnknown: 'skip' }, followGate: { buttonLabel: 'Done' },
    });
    if (!result.ok) throw new Error(result.message);
    return result.value;
  })();

  it('creates with the profile and account; updates without them', () => {
    const created = toZernioAutomation(value, 'instagram', { profileId: 'prof' });
    expect(created).toMatchObject({
      profileId: 'prof', accountId: 'acc-ig', name: 'Guide', keywords: ['guide'], matchMode: 'word',
      buttons: [{ type: 'url', title: 'Get it', url: 'https://x.test/guide' }], commentReply: 'Check your DMs!',
      repeatPolicy: { mode: 'every_comment', cooldownHours: 24 }, actions: { likeComment: true, hideComment: false },
      audience: { followerStatus: 'follower', whenUnknown: 'skip', tapToUnlock: false }, followGate: { buttonLabel: 'Done' },
    });
    const updated = toZernioAutomation(value, 'instagram', 'update');
    expect(updated).not.toHaveProperty('profileId');
    expect(updated).not.toHaveProperty('accountId');
    expect(toZernioAutomation({ ...value, accountId: 'acc-fb' }, 'facebook', 'update')).not.toHaveProperty('audience');
  });

  it('reads automations back, including stats, and drops one with no account or network', () => {
    const rules = readAutoDmRules({ success: true, automations: [
      { ...toZernioAutomation(value, 'instagram', { profileId: 'prof' }), _id: 'a1', platform: 'instagram', stats: { totalSent: 12, totalClicks: 3 } },
      { _id: 'a2', accountId: { _id: 'acc-fb', platform: 'facebook' }, name: 'FB', dmMessage: 'Hi', isActive: false },
      { _id: 'a3', accountId: 'acc-tt', platform: 'tiktok' },
      { accountId: 'acc-ig', platform: 'instagram' },
    ] });
    expect(rules.map((rule) => rule.id)).toEqual(['a1', 'a2']);
    expect(rules[0]).toMatchObject({ ...value, id: 'a1', platform: 'instagram', stats: { sent: 12, clicks: 3, triggered: null, failed: null } });
    expect(rules[1]).toMatchObject({ accountId: 'acc-fb', platform: 'facebook', isActive: false });
    expect(autoDmTotals(rules)).toEqual({ active: 1, sent: 12, clicks: 3, clickRate: 25 });
    expect(autoDmTotals([rules[1]])).toEqual({ active: 0, sent: null, clicks: null, clickRate: null });
  });

  it('reads trigger logs and drops one with an unknown status', () => {
    expect(readAutoDmLogs({ logs: [
      { _id: 'l1', commenterUsername: 'ruth', commentText: 'guide', status: 'sent', createdAt: '2026-10-01T10:00:00Z' },
      { _id: 'l2', commenter: { name: 'Sam' }, status: 'gated' },
      { _id: 'l3', status: 'exploded' },
    ] })).toEqual([
      { id: 'l1', commenter: 'ruth', text: 'guide', status: 'sent', at: '2026-10-01T10:00:00Z' },
      { id: 'l2', commenter: 'Sam', text: '', status: 'gated', at: null },
    ]);
  });

  it('calls the comment-automation endpoints, and retries an update once as PUT only on 404 or 405', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    let patchStatus = 405;
    const live = new LiveSocialClient('key', async (url, init) => {
      calls.push({ url, init });
      const status = init.method === 'PATCH' ? patchStatus : 200;
      return new Response('{"success":true}', { status });
    });
    await live.autoDmList('prof');
    await live.autoDmCreate({ name: 'x' });
    expect(await live.autoDmUpdate('a/1', { name: 'y' })).toEqual({ success: true });
    await live.autoDmDelete('a1');
    await live.autoDmLogs('a1');
    patchStatus = 400;
    expect(await live.autoDmUpdate('a1', { name: 'z' })).toBeNull();
    expect(calls.map((c) => [c.init.method, new URL(c.url).pathname + new URL(c.url).search])).toEqual([
      ['GET', '/v1/comment-automations?profileId=prof'],
      ['POST', '/v1/comment-automations'],
      ['PATCH', '/v1/comment-automations/a%2F1'],
      ['PUT', '/v1/comment-automations/a%2F1'],
      ['DELETE', '/v1/comment-automations/a1'],
      ['GET', '/v1/comment-automations/a1/logs?limit=50'],
      ['PATCH', '/v1/comment-automations/a1'],
    ]);
  });
});
