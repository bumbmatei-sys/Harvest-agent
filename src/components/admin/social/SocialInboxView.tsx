'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { INBOX_REPLY_MAX, type InboxComment, type InboxKind, type InboxReview } from '@/lib/social/inbox';
import type { InboxListing, InboxThread } from '@/lib/social/session';
import { hasLogo, PlatformLogo } from './PlatformLogo';

export interface InboxApi {
  list(kind: InboxKind): Promise<InboxListing>;
  thread(kind: 'message' | 'comment', id: string): Promise<InboxThread>;
  reply(input: { kind: InboxKind; id: string; message: string; commentId?: string }): Promise<void>;
}

type Load<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

const TABS: Array<[InboxKind, string]> = [['message', 'Messages'], ['comment', 'Comments'], ['review', 'Reviews']];
const PILL = 'min-h-11 sm:min-h-[34px] h-auto rounded-lg px-3 text-xs font-semibold aria-pressed:bg-surface-sunken aria-pressed:text-strong';

const ago = (iso: string | null) => {
  if (!iso) return '';
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(iso));
};

function Logo({ platform }: { platform: string }) {
  return <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-muted">
    {hasLogo(platform) ? <PlatformLogo platform={platform} className="size-3.5" /> : <span aria-label={platform} className="text-[10px] font-semibold uppercase">{platform.slice(0, 2)}</span>}
  </span>;
}

/**
 * The unified inbox (#584): every DM, comment and review from the ministry's
 * connected accounts in one place, list on the left and the open item on the
 * right, answered without leaving Harvest.
 */
export function SocialInboxView({ api }: { api: InboxApi }) {
  const [kind, setKind] = useState<InboxKind>('message');
  const [listing, setListing] = useState<Load<InboxListing>>({ status: 'loading' });
  const [openId, setOpenId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setListing({ status: 'loading' });
    api.list(kind).then(
      (data) => { if (!cancelled) setListing({ status: 'ready', data }); },
      () => { if (!cancelled) setListing({ status: 'error', message: 'Could not load the inbox. Please try again.' }); },
    );
    return () => { cancelled = true; };
  }, [api, kind, revision]);

  const items = listing.status === 'ready' ? listing.data : null;
  const refresh = useCallback(() => setRevision((n) => n + 1), []);

  return (
    <section data-testid="social-inbox" className="flex flex-col gap-3">
      <div className="flex items-center gap-1" role="group" aria-label="Inbox">
        {TABS.map(([value, label]) => (
          <Button key={value} type="button" variant="ghost" aria-pressed={kind === value} className={PILL}
            onClick={() => { setKind(value); setOpenId(null); }}>{label}</Button>
        ))}
      </div>
      <div className="grid min-h-[32rem] gap-3 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <aside className="rounded-xl border border-line bg-surface-raised p-2">
          {listing.status === 'loading' && <Skeleton className="h-40 w-full rounded-lg" />}
          {listing.status === 'error' && <p role="alert" className="p-3 text-sm">{listing.message}</p>}
          {items && items.items.length === 0 && <p className="p-6 text-center text-sm text-faint">Nothing here yet.</p>}
          {items && <ul className="flex flex-col gap-1">
            {items.kind === 'message' && items.items.map((c) => (
              <ListRow key={c.id} id={c.id} open={openId === c.id} onOpen={setOpenId} platform={c.platform}
                title={c.participantName} preview={c.lastMessage} when={ago(c.updatedAt)} unread={c.unread} />
            ))}
            {items.kind === 'comment' && items.items.map((t) => (
              <ListRow key={t.postId} id={t.postId} open={openId === t.postId} onOpen={setOpenId} platform={t.platform}
                title={`${t.commentCount} ${t.commentCount === 1 ? 'comment' : 'comments'}`} preview={t.postText || 'Your post'} when={ago(t.updatedAt)} />
            ))}
            {items.kind === 'review' && items.items.map((r) => (
              <ListRow key={r.id} id={r.id} open={openId === r.id} onOpen={setOpenId} platform={r.platform}
                title={r.reviewerName} preview={r.text || 'No written review'} when={ago(r.createdAt)} unread={!r.reply}
                badge={r.rating ? `${'★'.repeat(r.rating)}` : undefined} />
            ))}
          </ul>}
        </aside>
        <div className="min-w-0 rounded-xl border border-line bg-surface-raised p-4">
          {!openId || !items ? <p className="py-24 text-center text-sm text-faint">Pick a conversation to read and reply.</p>
            : items.kind === 'review'
              ? <ReviewPane review={items.items.find((r) => r.id === openId)!} api={api} onSent={refresh} />
              : <ThreadPane key={openId} kind={items.kind} id={openId} api={api}
                  title={items.kind === 'message'
                    ? items.items.find((c) => c.id === openId)?.participantName ?? ''
                    : items.items.find((t) => t.postId === openId)?.postText ?? ''}
                  onSent={refresh} />}
        </div>
      </div>
    </section>
  );
}

function ListRow({ id, open, onOpen, platform, title, preview, when, unread, badge }: {
  id: string; open: boolean; onOpen: (id: string) => void; platform: string; title: string; preview: string; when: string; unread?: boolean; badge?: string;
}) {
  return <li>
    <button type="button" data-inbox-item={id} aria-current={open ? 'true' : undefined} onClick={() => onOpen(id)}
      className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-sunken ${open ? 'bg-surface-sunken' : ''}`}>
      <Logo platform={platform} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={`truncate text-sm ${unread ? 'font-semibold text-strong' : 'text-strong'}`}>{title}</span>
          {badge && <span aria-label={`${badge.length} stars`} className="text-xs text-muted">{badge}</span>}
          <span className="ml-auto shrink-0 text-xs text-faint">{when}</span>
        </span>
        <span className="block truncate text-xs text-muted">{preview}</span>
      </span>
      {unread && <span aria-label="Unread" className="size-2 shrink-0 rounded-full bg-[var(--brand-color,currentColor)]" />}
    </button>
  </li>;
}

function ReplyBox({ placeholder, onSend }: { placeholder: string; onSend: (message: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const send = async () => {
    setSending(true); setError('');
    try { await onSend(text.trim()); setText(''); }
    catch { setError('Could not send. Please try again.'); }
    finally { setSending(false); }
  };
  return <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
    <Textarea aria-label={placeholder} placeholder={placeholder} value={text} maxLength={INBOX_REPLY_MAX} onChange={(e) => setText(e.target.value)} className="min-h-20" />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex justify-end"><Button type="button" className="min-h-11 sm:min-h-[38px]" disabled={sending || !text.trim()} onClick={send}>{sending ? 'Sending…' : 'Send'}</Button></div>
  </div>;
}

function ThreadPane({ kind, id, title, api, onSent }: { kind: 'message' | 'comment'; id: string; title: string; api: InboxApi; onSent: () => void }) {
  const [thread, setThread] = useState<Load<InboxThread>>({ status: 'loading' });
  const [replyTo, setReplyTo] = useState<InboxComment | null>(null);
  const load = useCallback(() => {
    let cancelled = false;
    api.thread(kind, id).then(
      (data) => { if (!cancelled) setThread({ status: 'ready', data }); },
      () => { if (!cancelled) setThread({ status: 'error', message: 'Could not open this conversation.' }); },
    );
    return () => { cancelled = true; };
  }, [api, kind, id]);
  useEffect(() => load(), [load]);
  const sent = () => { load(); onSent(); setReplyTo(null); };

  if (thread.status === 'loading') return <Skeleton className="h-48 w-full rounded-lg" />;
  if (thread.status === 'error') return <p role="alert" className="text-sm">{thread.message}</p>;
  const data = thread.data;
  return <div data-inbox-thread={id} className="flex h-full flex-col">
    <h3 className="mb-3 line-clamp-2 text-sm font-semibold text-strong">{title}</h3>
    {data.kind === 'message' ? <>
      <ol className="flex flex-col gap-2">
        {data.messages.map((m) => (
          <li key={m.id} data-message-direction={m.direction}
            className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.direction === 'outgoing' ? 'self-end bg-surface-sunken text-strong' : 'self-start border border-line bg-card text-strong'}`}>
            {m.text}
          </li>
        ))}
      </ol>
      <ReplyBox placeholder="Write a reply" onSend={async (message) => { await api.reply({ kind: 'message', id, message }); sent(); }} />
    </> : <>
      <ul className="flex flex-col gap-3">
        {data.comments.map((c) => (
          <li key={c.id} data-comment={c.id} className="rounded-lg border border-line bg-card p-3">
            <p className="text-sm"><span className="font-semibold text-strong">{c.authorName}</span> <span className="text-xs text-faint">{ago(c.createdAt)}</span></p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-strong">{c.text}</p>
            {c.replies.map((r) => <p key={r.id} className="mt-2 border-l-2 border-line pl-3 text-sm text-muted"><span className="font-semibold">{r.authorName}</span> {r.text}</p>)}
            <Button type="button" variant="ghost" className="mt-1 h-auto min-h-11 px-2 text-xs font-semibold sm:min-h-0" onClick={() => setReplyTo(c)}>Reply</Button>
          </li>
        ))}
      </ul>
      {replyTo && <ReplyBox placeholder={`Reply to ${replyTo.authorName}`}
        onSend={async (message) => { await api.reply({ kind: 'comment', id, message, commentId: replyTo.id }); sent(); }} />}
    </>}
  </div>;
}

function ReviewPane({ review, api, onSent }: { review: InboxReview; api: InboxApi; onSent: () => void }) {
  return <div data-inbox-review={review.id} className="flex flex-col gap-2">
    <p className="text-sm font-semibold text-strong">{review.reviewerName}</p>
    {review.rating && <p aria-label={`${review.rating} out of 5 stars`} className="text-sm text-muted">{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</p>}
    <p className="whitespace-pre-wrap text-sm text-strong">{review.text || 'No written review.'}</p>
    {review.reply && <p className="rounded-lg bg-surface-sunken p-3 text-sm text-muted"><span className="font-semibold">Your reply:</span> {review.reply}</p>}
    <ReplyBox placeholder={review.reply ? 'Replace your reply' : 'Reply to this review'}
      onSend={async (message) => { await api.reply({ kind: 'review', id: review.id, message }); onSent(); }} />
  </div>;
}
