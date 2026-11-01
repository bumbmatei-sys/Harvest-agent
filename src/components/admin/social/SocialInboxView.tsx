'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { INBOX_REPLY_MAX, type InboxComment, type InboxKind, type InboxReview } from '@/lib/social/inbox';
import type { InboxListing, InboxThread } from '@/lib/social/session';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SocialAccount } from '@/lib/social/types';
import { hasLogo, LOGO_TITLES, PlatformLogo } from './PlatformLogo';

export interface InboxApi {
  list(kind: InboxKind): Promise<InboxListing>;
  thread(kind: 'message' | 'comment', id: string): Promise<InboxThread>;
  reply(input: { kind: InboxKind; id: string; message: string; commentId?: string }): Promise<void>;
}

type Load<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

const KIND_LABEL: Record<InboxKind, string> = { message: 'Messages', comment: 'Comments', review: 'Reviews' };
const KINDS: InboxKind[] = ['message', 'comment', 'review'];
const ALL = 'all';

const ago = (iso: string | null) => {
  if (!iso) return '';
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(iso));
};

/** One row of the combined list, whatever kind it is. */
export interface InboxRow {
  readonly kind: InboxKind;
  readonly id: string;
  readonly platform: string;
  readonly accountId: string;
  readonly name: string;
  readonly preview: string;
  readonly at: string | null;
  readonly unread: boolean;
  readonly rating: number | null;
}

/** Every listing as one list, newest first (an item with no time sorts last). */
export function inboxRows(listings: readonly InboxListing[]): InboxRow[] {
  const rows: InboxRow[] = [];
  for (const listing of listings) {
    if (listing.kind === 'message') for (const c of listing.items) rows.push({ kind: 'message', id: c.id, platform: c.platform, accountId: c.accountId, name: c.participantName, preview: c.lastMessage, at: c.updatedAt, unread: c.unread, rating: null });
    if (listing.kind === 'comment') for (const t of listing.items) rows.push({ kind: 'comment', id: t.postId, platform: t.platform, accountId: t.accountId, name: `${t.commentCount} ${t.commentCount === 1 ? 'comment' : 'comments'}`, preview: t.postText || 'Your post', at: t.updatedAt, unread: false, rating: null });
    if (listing.kind === 'review') for (const r of listing.items) rows.push({ kind: 'review', id: r.id, platform: r.platform, accountId: r.accountId, name: r.reviewerName, preview: r.text || 'No written review', at: r.createdAt, unread: !r.reply, rating: r.rating });
  }
  return rows.sort((a, b) => (b.at ? Date.parse(b.at) : -Infinity) - (a.at ? Date.parse(a.at) : -Infinity));
}

function Avatar({ name, platform }: { name: string; platform: string }) {
  return <span className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-sm font-semibold text-muted">
    {name.slice(0, 1).toUpperCase()}
    <span className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full border border-line bg-card text-strong">
      {hasLogo(platform) ? <PlatformLogo platform={platform} className="size-3" /> : <span aria-label={platform} className="text-[9px] font-semibold uppercase">{platform.slice(0, 1)}</span>}
    </span>
  </span>;
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return <Select value={value} onValueChange={(next: unknown) => { if (typeof next === 'string') onChange(next); }}>
    <SelectTrigger aria-label={label} className="min-h-11 rounded-lg border-line bg-card px-3 text-sm sm:min-h-[38px]">
      <SelectValue>{() => options.find(([v]) => v === value)?.[1] ?? label}</SelectValue>
    </SelectTrigger>
    <SelectContent>{options.map(([v, text]) => <SelectItem key={v} value={v}>{text}</SelectItem>)}</SelectContent>
  </Select>;
}

/**
 * The unified inbox (#584), laid out as Zernio's (zernio.com/social-media-inbox):
 * filters for type, platform and account across the top, one combined list —
 * avatar with the network badge, "name · via @account", time, preview, unread
 * dot — and the open item on the right, answered without leaving Harvest.
 */
export function SocialInboxView({ api, accounts = [] }: { api: InboxApi; accounts?: readonly SocialAccount[] }) {
  const [state, setState] = useState<Load<InboxRow[]>>({ status: 'loading' });
  const [listings, setListings] = useState<InboxListing[]>([]);
  const [kind, setKind] = useState<string>(ALL);
  const [platform, setPlatform] = useState<string>(ALL);
  const [account, setAccount] = useState<string>(ALL);
  const [open, setOpen] = useState<{ kind: InboxKind; id: string } | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((previous) => (previous.status === 'ready' ? previous : { status: 'loading' }));
    Promise.all(KINDS.map((k) => api.list(k))).then(
      (all) => { if (!cancelled) { setListings(all); setState({ status: 'ready', data: inboxRows(all) }); } },
      () => { if (!cancelled) setState({ status: 'error', message: 'Could not load the inbox. Please try again.' }); },
    );
    return () => { cancelled = true; };
  }, [api, revision]);

  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  const handle = (accountId: string) => {
    const found = accounts.find((a) => a.id === accountId);
    return found ? `@${found.username}` : '';
  };
  const rows = state.status === 'ready' ? state.data : [];
  const shown = rows.filter((r) => (kind === ALL || r.kind === kind) && (platform === ALL || r.platform === platform) && (account === ALL || r.accountId === account));
  const platforms = [...new Set(rows.map((r) => r.platform))];
  const accountIds = [...new Set(rows.map((r) => r.accountId).filter(Boolean))];
  const label = (p: string) => (hasLogo(p) ? LOGO_TITLES[p] : p.replace(/^googlebusiness$/, 'Google'));
  const openRow = open && rows.find((r) => r.kind === open.kind && r.id === open.id);
  const review = open?.kind === 'review' ? listings.find((l) => l.kind === 'review')?.items.find((r) => 'reviewerName' in r && r.id === open.id) as InboxReview | undefined : undefined;

  return (
    <section data-testid="social-inbox" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect label="Type" value={kind} onChange={setKind}
          options={[[ALL, 'All types'], ...KINDS.map((k): [string, string] => [k, KIND_LABEL[k]])]} />
        <FilterSelect label="Platform" value={platform} onChange={setPlatform}
          options={[[ALL, 'All platforms'], ...platforms.map((p): [string, string] => [p, label(p)])]} />
        <FilterSelect label="Account" value={account} onChange={setAccount}
          options={[[ALL, 'All accounts'], ...accountIds.map((id): [string, string] => [id, handle(id) || id])]} />
      </div>
      <div className="grid min-h-[32rem] gap-3 lg:grid-cols-[26rem_minmax(0,1fr)]">
        <aside className="overflow-hidden rounded-xl border border-line bg-card">
          {state.status === 'loading' && <Skeleton className="m-3 h-40 rounded-lg" />}
          {state.status === 'error' && <p role="alert" className="p-4 text-sm">{state.message}</p>}
          {state.status === 'ready' && shown.length === 0 && <p className="p-8 text-center text-sm text-faint">Nothing here yet.</p>}
          <ul className="divide-y divide-line">
            {shown.map((row) => (
              <li key={`${row.kind}:${row.id}`}>
                <button type="button" data-inbox-item={row.id} data-inbox-kind={row.kind} aria-current={open?.id === row.id && open.kind === row.kind ? 'true' : undefined}
                  onClick={() => setOpen({ kind: row.kind, id: row.id })}
                  className="flex min-h-11 w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-sunken aria-[current=true]:bg-surface-sunken">
                  <Avatar name={row.name} platform={row.platform} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5">
                      <span className="truncate text-sm font-medium text-strong">{row.name}</span>
                      {handle(row.accountId) && <span className="truncate text-sm text-faint">· via {handle(row.accountId)}</span>}
                      <span className="ml-auto shrink-0 pl-2 text-xs text-faint">{ago(row.at)}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2">
                      {row.rating && <span aria-label={`${row.rating} out of 5 stars`} className="shrink-0 text-xs text-muted">{'★'.repeat(row.rating)}</span>}
                      <span className="truncate text-sm text-muted">{row.preview}</span>
                      {row.unread && <span aria-label="Unread" className="ml-auto size-2 shrink-0 rounded-full bg-destructive" />}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <div className="min-w-0 rounded-xl border border-line bg-card p-4">
          {!open || !openRow ? <p className="py-24 text-center text-sm text-faint">Pick a conversation to read and reply.</p>
            : open.kind === 'review'
              ? review && <ReviewPane review={review} api={api} onSent={refresh} />
              : <ThreadPane key={`${open.kind}:${open.id}`} kind={open.kind} id={open.id} api={api}
                  title={open.kind === 'message' ? openRow.name : openRow.preview} onSent={refresh} />}
        </div>
      </div>
    </section>
  );
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
