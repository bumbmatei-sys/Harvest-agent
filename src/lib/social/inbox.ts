/**
 * The scheduler's unified Inbox (#584): DMs, comments and reviews from every
 * connected network, through Zernio's Inbox API
 * (GET /v1/inbox/conversations, /conversations/{id}/messages, /comments,
 * /comments/{postId}, /reviews; replies through the matching POSTs).
 *
 * Readers accept only the fields they need and drop a row they cannot read,
 * so a provider shape change shows less rather than breaking the page.
 * Reading is free; every reply sent is one Zernio "outbound message" (10,000
 * a month free across the account, then $1 per 10,000). Review replies are not
 * counted.
 */

export type InboxKind = 'message' | 'comment' | 'review';

export interface InboxConversation {
  readonly id: string;
  readonly platform: string;
  readonly accountId: string;
  readonly participantName: string;
  readonly lastMessage: string;
  readonly updatedAt: string | null;
  readonly unread: boolean;
}

export interface InboxMessage {
  readonly id: string;
  readonly direction: 'incoming' | 'outgoing';
  readonly text: string;
  readonly createdAt: string | null;
}

export interface InboxCommentThread {
  readonly postId: string;
  readonly platform: string;
  readonly accountId: string;
  readonly postText: string;
  readonly commentCount: number;
  readonly updatedAt: string | null;
}

export interface InboxComment {
  readonly id: string;
  readonly authorName: string;
  readonly text: string;
  readonly createdAt: string | null;
  readonly fromAccount: boolean;
  readonly replies: readonly InboxComment[];
}

export interface InboxReview {
  readonly id: string;
  readonly platform: string;
  readonly accountId: string;
  readonly reviewerName: string;
  readonly rating: number | null;
  readonly text: string;
  readonly createdAt: string | null;
  readonly reply: string | null;
}

export const INBOX_REPLY_MAX = 2000;

type Row = Record<string, unknown>;
const row = (value: unknown): Row => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {});
const str = (value: unknown) => (typeof value === 'string' ? value : '');
const firstStr = (...values: unknown[]) => values.map(str).find(Boolean) ?? '';
const when = (...values: unknown[]) => {
  const found = values.map(str).find((value) => value && !Number.isNaN(Date.parse(value)));
  return found ?? null;
};
const idOf = (value: Row) => firstStr(value.id, value._id);
const list = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  const body = row(value);
  for (const key of ['data', 'conversations', 'messages', 'comments', 'posts', 'reviews']) {
    if (Array.isArray(body[key])) return body[key] as unknown[];
  }
  return [];
};

export function readConversations(body: unknown): InboxConversation[] {
  return list(body).flatMap((raw) => {
    const item = row(raw);
    const id = idOf(item);
    const platform = str(item.platform);
    if (!id || !platform) return [];
    const participant = row(item.participant);
    return [{
      id, platform,
      accountId: firstStr(item.accountId, row(item.account).id),
      participantName: firstStr(item.participantName, participant.name, participant.username) || 'Someone',
      lastMessage: firstStr(item.lastMessage, row(item.lastMessage).text),
      updatedAt: when(item.updatedTime, item.updatedAt, item.lastMessageAt),
      unread: item.unread === true || (typeof item.unreadCount === 'number' && item.unreadCount > 0),
    }];
  });
}

export function readMessages(body: unknown): InboxMessage[] {
  return list(body).flatMap((raw): InboxMessage[] => {
    const item = row(raw);
    const id = idOf(item);
    if (!id) return [];
    return [{
      id,
      direction: item.direction === 'outgoing' ? 'outgoing' : 'incoming',
      text: firstStr(item.text, item.message),
      createdAt: when(item.createdAt, item.createdTime, item.timestamp, item.sentAt),
    }];
  }).sort((a, b) => (a.createdAt ? Date.parse(a.createdAt) : 0) - (b.createdAt ? Date.parse(b.createdAt) : 0));
}

export function readCommentThreads(body: unknown): InboxCommentThread[] {
  return list(body).flatMap((raw) => {
    const item = row(raw);
    const postId = firstStr(item.postId, item.id, item._id);
    const platform = str(item.platform);
    if (!postId || !platform) return [];
    const count = Number(item.commentCount ?? item.commentsCount ?? item.comments ?? 0);
    return [{
      postId, platform,
      accountId: firstStr(item.accountId, row(item.account).id),
      postText: firstStr(item.content, item.text, item.caption, item.message),
      commentCount: Number.isFinite(count) && count > 0 ? Math.round(count) : 0,
      updatedAt: when(item.lastCommentAt, item.updatedAt, item.createdTime, item.publishedAt),
    }];
  });
}

function readComment(raw: unknown, depth = 0): InboxComment | null {
  const item = row(raw);
  const id = idOf(item);
  if (!id) return null;
  const from = row(item.from ?? item.author);
  const replies = depth === 0 ? list(item.replies).map((reply) => readComment(reply, 1)).filter((c): c is InboxComment => c !== null) : [];
  return {
    id,
    authorName: firstStr(from.name, from.username, item.authorName, item.username) || 'Someone',
    text: firstStr(item.message, item.text),
    createdAt: when(item.createdTime, item.createdAt, item.timestamp),
    fromAccount: item.isOwner === true || item.fromAccount === true || from.isOwner === true,
    replies,
  };
}

export function readComments(body: unknown): InboxComment[] {
  return list(body).map((raw) => readComment(raw)).filter((c): c is InboxComment => c !== null);
}

export function readReviews(body: unknown): InboxReview[] {
  return list(body).flatMap((raw) => {
    const item = row(raw);
    const id = idOf(item);
    const platform = str(item.platform);
    if (!id || !platform) return [];
    const reviewer = row(item.reviewer ?? item.author);
    const ratingRaw = item.rating ?? item.starRating;
    const stars: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
    const rating = typeof ratingRaw === 'number' ? ratingRaw : typeof ratingRaw === 'string' ? (stars[ratingRaw] ?? (Number(ratingRaw) || null)) : null;
    const reply = row(item.reply ?? item.reviewReply);
    return [{
      id, platform,
      accountId: firstStr(item.accountId, row(item.account).id),
      reviewerName: firstStr(reviewer.name, reviewer.displayName, item.reviewerName) || 'Someone',
      rating: rating !== null && rating >= 1 && rating <= 5 ? rating : null,
      text: firstStr(item.comment, item.text, item.message),
      createdAt: when(item.createdAt, item.createTime, item.created),
      reply: firstStr(reply.comment, reply.message, reply.text, typeof item.reply === 'string' ? item.reply : '') || null,
    }];
  });
}

/** A reply the provider will accept: trimmed, non-empty, within the limit. */
export function readReply(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && [...text].length <= INBOX_REPLY_MAX ? text : null;
}
