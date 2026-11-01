import { describe, expect, it } from 'vitest';
import { readCommentThreads, readComments, readConversations, readMessages, readReply, readReviews } from '../inbox';
import { LiveSocialClient } from '../live-client';

describe('the unified inbox readers (#584)', () => {
  it('reads conversations from the documented shape and drops rows it cannot place', () => {
    expect(readConversations({ data: [
      { id: 'c1', platform: 'instagram', accountId: 'a1', participantName: 'Jane', lastMessage: 'Hi', updatedTime: '2026-10-01T10:00:00Z', unreadCount: 2 },
      { id: 'c2', platform: 'facebook', account: { id: 'a2' }, participant: { username: 'sam' }, lastMessage: { text: 'Yo' } },
      { platform: 'instagram' }, { id: 'c3' },
    ] })).toEqual([
      { id: 'c1', platform: 'instagram', accountId: 'a1', participantName: 'Jane', lastMessage: 'Hi', updatedAt: '2026-10-01T10:00:00Z', unread: true },
      { id: 'c2', platform: 'facebook', accountId: 'a2', participantName: 'sam', lastMessage: 'Yo', updatedAt: null, unread: false },
    ]);
  });
  it('orders messages oldest first and reads direction strictly', () => {
    expect(readMessages({ messages: [
      { id: 'b', direction: 'outgoing', text: 'Second', createdAt: '2026-10-01T10:05:00Z' },
      { id: 'a', direction: 'weird', message: 'First', createdAt: '2026-10-01T10:00:00Z' },
    ] }).map((m) => [m.id, m.direction, m.text])).toEqual([['a', 'incoming', 'First'], ['b', 'outgoing', 'Second']]);
  });
  it('reads commented posts, comments with one level of replies, and reviews with Google star words', () => {
    expect(readCommentThreads({ data: [{ postId: 'p1', platform: 'tiktok', accountId: 'a', content: 'Clip', commentCount: 3.2 }] })[0]).toMatchObject({ postId: 'p1', commentCount: 3 });
    const [comment] = readComments({ comments: [{ id: 'c1', from: { name: 'Ruth' }, message: 'Amen', replies: [{ id: 'r1', from: { name: 'You' }, message: 'Thanks', isOwner: true, replies: [{ id: 'deep' }] }] }] });
    expect(comment).toMatchObject({ id: 'c1', authorName: 'Ruth', text: 'Amen', replies: [{ id: 'r1', fromAccount: true, replies: [] }] });
    expect(readReviews({ data: [
      { id: 'accounts/1/locations/2/reviews/3', platform: 'googlebusiness', reviewer: { displayName: 'Maria' }, starRating: 'FOUR', comment: 'Good', reviewReply: { comment: 'Thanks' } },
      { id: 'r2', platform: 'facebook', rating: 9 },
    ] }).map((r) => [r.reviewerName, r.rating, r.reply])).toEqual([['Maria', 4, 'Thanks'], ['Someone', null, null]]);
  });
  it('accepts a reply only when it has text within the limit', () => {
    expect(readReply('  Hello ')).toBe('Hello');
    expect(readReply('   ')).toBeNull();
    expect(readReply('🙏'.repeat(2000))).toBe('🙏'.repeat(2000));
    expect(readReply('a'.repeat(2001))).toBeNull();
    expect(readReply(5)).toBeNull();
  });
  it('calls the documented endpoints, encoding review ids that contain slashes', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const live = new LiveSocialClient('key', async (url, init) => { calls.push({ url, init }); return new Response('{"data":[]}', { status: 200 }); });
    await live.inboxList('prof', 'message');
    await live.inboxThread('comment', 'post/1', 'acc');
    await live.inboxReply('review', 'accounts/1/reviews/3', 'acc', 'Thanks');
    await live.inboxReply('comment', 'p1', 'acc', 'Yes', 'c9');
    expect(calls.map((c) => [c.init.method, new URL(c.url).pathname + new URL(c.url).search])).toEqual([
      ['GET', '/v1/inbox/conversations?profileId=prof&limit=50'],
      ['GET', '/v1/inbox/comments/post%2F1?accountId=acc'],
      ['POST', '/v1/inbox/reviews/accounts%2F1%2Freviews%2F3/reply'],
      ['POST', '/v1/inbox/comments/p1'],
    ]);
    expect(JSON.parse(calls[2].init.body as string)).toEqual({ accountId: 'acc', message: 'Thanks' });
    expect(JSON.parse(calls[3].init.body as string)).toEqual({ accountId: 'acc', message: 'Yes', commentId: 'c9' });
  });
});
