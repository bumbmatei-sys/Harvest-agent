'use client';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/firebase';
import { useAppStore } from '@/store/useAppStore';
import { communityConsentNotice, isCommunityTenantId } from '@/lib/community-membership';
import { DEFAULT_COMMUNITY_ID, formatCommunityPrice, isCommunityId, type CommunityRecord } from '@/lib/community/communities';
import {
  changeMembership, createPost, sendMessage, useChannels, useCommunityRecord, useIsMember, useMessages, usePosts,
} from '@/lib/community/space';
import { isTenantAdminRole } from '@/lib/roles';
import { checkRosterAdminStatus } from '@/utils/tenant.utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { LeaveCommunity } from './LeaveCommunity';

/**
 * #576: one community other than a ministry's default one, at
 * /community/{tenantId}/{communityId}. Visitors see its public page and join
 * from it; members and the ministry's admins see the space: feed and chat.
 */
export function CommunitySpacePage() {
  const { tenantId, communityId } = useParams();
  if (!isCommunityTenantId(tenantId) || !isCommunityId(communityId)) return <p role="alert" className="p-6">Community not found.</p>;
  if (communityId === DEFAULT_COMMUNITY_ID) return <Navigate to={`/community/${tenantId}`} replace />;
  return <CommunitySpace key={`${tenantId}/${communityId}`} tenantId={tenantId} communityId={communityId} />;
}

type Ministry = { name: string; isAdmin: boolean };

function useMinistry(tenantId: string, uid: string | undefined): Ministry | null {
  const [ministry, setMinistry] = useState<Ministry | null>(null);
  useEffect(() => {
    let cancelled = false;
    const account = auth.currentUser;
    Promise.all([
      getDoc(doc(db, 'tenants', tenantId)),
      uid ? getDoc(doc(db, 'users', uid)) : Promise.resolve(null),
      uid ? checkRosterAdminStatus(tenantId) : Promise.resolve('none' as const),
      account ? account.getIdTokenResult() : Promise.resolve(null),
    ]).then(([tenant, person, roster, token]) => {
      if (cancelled) return;
      const data = tenant.exists() ? tenant.data() : {};
      const profile = person?.exists() ? person.data() : undefined;
      const isAdmin = !!uid && (data.ownerId === uid || roster === 'admin' ||
        (profile?.tenantId === tenantId && isTenantAdminRole(profile?.role)) ||
        (token?.claims.tenantId === tenantId && token?.claims.admin === true));
      setMinistry({ name: typeof data.name === 'string' && data.name.trim() ? data.name : 'this ministry', isAdmin });
    }).catch(() => { if (!cancelled) setMinistry({ name: 'this ministry', isAdmin: false }); });
    return () => { cancelled = true; };
  }, [tenantId, uid]);
  return ministry;
}

function CommunitySpace({ tenantId, communityId }: { tenantId: string; communityId: string }) {
  const { currentUser } = useAppStore();
  const navigate = useNavigate();
  const uid = currentUser?.uid;
  const record = useCommunityRecord(tenantId, communityId);
  const member = useIsMember(tenantId, communityId, uid);
  const ministry = useMinistry(tenantId, uid);
  if (record.status === 'error') return <p role="alert" className="p-6">{record.message}</p>;
  if (member.status === 'error') return <p role="alert" className="p-6">{member.message}</p>;
  if (record.status === 'loading' || member.status === 'loading' || !ministry) return <p role="status" className="p-6">Loading community…</p>;
  const community = record.data;
  if (!community) return <section className="mx-auto max-w-lg space-y-4 p-6">
    <h1 className="font-display text-2xl">This community is private</h1>
    <p className="text-body">It may be invite only, or no longer available.</p>
    <Button variant="outline" className="min-h-11" onClick={() => navigate('/?communities=1')}>Your communities</Button>
  </section>;
  if (member.data || ministry.isAdmin) return <Space tenantId={tenantId} community={community} isAdmin={ministry.isAdmin} />;
  return <PublicPage tenantId={tenantId} community={community} ministryName={ministry.name} />;
}

function CommunityIcon({ community, size = 'size-14' }: { community: CommunityRecord; size?: string }) {
  return community.iconUrl
    ? <img src={community.iconUrl} alt="" className={`${size} rounded-xl object-cover`} />
    : <div aria-hidden className={`${size} flex items-center justify-center rounded-xl bg-surface-sunken font-display text-xl text-muted`}>{community.name.slice(0, 1).toUpperCase()}</div>;
}

/** Why a visitor cannot join here, or null when they can. Mirrors the join API. */
export function joinBlocker(community: CommunityRecord): string | null {
  if (community.status !== 'published') return 'This community is not published yet.';
  if (community.visibility !== 'public') return 'This community is private.';
  if (community.pricing.type !== 'free') return 'Paid communities are coming soon.';
  if (community.joining.mode !== 'open') return 'This community reviews applications, which open soon.';
  return null;
}

function PublicPage({ tenantId, community, ministryName }: { tenantId: string; community: CommunityRecord; ministryName: string }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const blocker = joinBlocker(community);
  const join = async () => {
    setSaving(true); setError('');
    // The member snapshot flips the page to the space once the join lands.
    try { await changeMembership(tenantId, community.id, true); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not join. Please try again.'); }
    finally { setSaving(false); }
  };
  return <section data-community-public={community.id} className="mx-auto max-w-2xl space-y-6 p-6">
    <div className="flex items-center gap-4">
      <CommunityIcon community={community} />
      <div><h1 className="font-display text-3xl">{community.name}</h1>{community.tagline && <p className="text-body">{community.tagline}</p>}</div>
    </div>
    <p className="text-sm text-muted">{formatCommunityPrice(community.pricing)} · Run by {ministryName}</p>
    {community.about && <div className="whitespace-pre-wrap text-body">{community.about}</div>}
    <div className="space-y-3 rounded-xl border border-line bg-surface-raised p-4">
      {blocker ? <p>{blocker}</p> : <>
        <p data-consent-notice className="text-sm text-body">{communityConsentNotice(community.name, ministryName)}</p>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <Button className="min-h-11" disabled={saving} onClick={join}>{saving ? 'Joining…' : 'Join community'}</Button>
      </>}
    </div>
  </section>;
}

type Section = 'feed' | 'chat';

function Space({ tenantId, community, isAdmin }: { tenantId: string; community: CommunityRecord; isAdmin: boolean }) {
  const navigate = useNavigate();
  const [section, setSection] = useState<Section>('feed');
  const sections: Array<[Section, string]> = [['feed', 'Feed'], ['chat', 'Chat']];
  return <div data-community-space={community.id} className="flex min-h-dvh flex-col md:flex-row">
    <nav aria-label={`${community.name} sections`} className="flex shrink-0 flex-col gap-1 border-b border-line bg-surface-raised p-3 md:w-60 md:border-b-0 md:border-r">
      <div className="mb-2 flex items-center gap-3"><CommunityIcon community={community} size="size-10" /><span className="font-display text-lg leading-tight">{community.name}</span></div>
      <div className="flex gap-1 md:flex-col">
        {sections.map(([id, label]) => <Button key={id} variant={section === id ? 'secondary' : 'ghost'} aria-current={section === id ? 'page' : undefined} className="min-h-11 justify-start" onClick={() => setSection(id)}>{label}</Button>)}
      </div>
      <div className="mt-auto flex gap-1 pt-2 md:flex-col">
        <Button variant="ghost" className="min-h-11 justify-start" onClick={() => navigate('/?communities=1')}>Your communities</Button>
        <LeaveCommunity name={community.name} isAdmin={isAdmin} onLeave={async () => { await changeMembership(tenantId, community.id, false); navigate('/?communities=1', { replace: true }); }} />
      </div>
    </nav>
    <main className="min-w-0 flex-1 p-4 md:p-6">
      {community.status !== 'published' && <p className="mb-4 rounded-lg border border-line bg-surface-sunken p-3 text-sm">This community is a draft. Only your team can see it until you publish it.</p>}
      {section === 'feed' ? <Feed tenantId={tenantId} communityId={community.id} /> : <Chat tenantId={tenantId} communityId={community.id} />}
    </main>
  </div>;
}

const timeLabel = (date: Date | null) => date ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Just now';

function Composer({ placeholder, action, max, onSubmit }: { placeholder: string; action: string; max: number; onSubmit: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setSaving(true); setError('');
    try { await onSubmit(text); setText(''); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not send. Please try again.'); }
    finally { setSaving(false); }
  };
  return <div className="space-y-2">
    <Textarea aria-label={placeholder} placeholder={placeholder} value={text} maxLength={max} onChange={event => setText(event.target.value)} />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex justify-end"><Button className="min-h-11" disabled={saving || !text.trim()} onClick={submit}>{saving ? 'Sending…' : action}</Button></div>
  </div>;
}

function Feed({ tenantId, communityId }: { tenantId: string; communityId: string }) {
  const posts = usePosts(tenantId, communityId);
  return <section aria-label="Feed" className="mx-auto max-w-2xl space-y-4">
    <div className="rounded-xl border border-line bg-surface-raised p-4"><Composer placeholder="Write something…" action="Post" max={500} onSubmit={text => createPost(tenantId, communityId, text)} /></div>
    {posts.status === 'loading' && <p role="status">Loading posts…</p>}
    {posts.status === 'error' && <p role="alert">{posts.message}</p>}
    {posts.status === 'ready' && (posts.data.length === 0
      ? <p className="text-muted">No posts yet. Start the conversation.</p>
      : posts.data.map(post => <article key={post.id} data-post={post.id} className="rounded-xl border border-line bg-surface-raised p-4">
        <p className="text-sm"><span className="font-semibold">{post.authorName}</span> <span className="text-muted">· {timeLabel(post.createdAt)}</span></p>
        <p className="mt-2 whitespace-pre-wrap">{post.content}</p>
      </article>))}
  </section>;
}

function Chat({ tenantId, communityId }: { tenantId: string; communityId: string }) {
  const channels = useChannels(tenantId, communityId);
  const [picked, setPicked] = useState<string | null>(null);
  const list = channels.status === 'ready' ? channels.data : [];
  const channelId = picked && list.some(c => c.id === picked) ? picked : list[0]?.id ?? null;
  const messages = useMessages(tenantId, communityId, channelId);
  if (channels.status === 'loading') return <p role="status">Loading chats…</p>;
  if (channels.status === 'error') return <p role="alert">{channels.message}</p>;
  if (!channelId) return <p className="text-muted">No chats yet.</p>;
  return <section aria-label="Chat" className="flex flex-col gap-4 md:flex-row">
    <div className="flex gap-1 md:w-48 md:flex-col">
      {list.map(channel => <Button key={channel.id} variant={channel.id === channelId ? 'secondary' : 'ghost'} className="min-h-11 justify-start" onClick={() => setPicked(channel.id)}># {channel.name}</Button>)}
    </div>
    <div className="min-w-0 flex-1 space-y-3 rounded-xl border border-line bg-surface-raised p-4">
      {messages.status === 'loading' && <p role="status">Loading messages…</p>}
      {messages.status === 'error' && <p role="alert">{messages.message}</p>}
      {messages.status === 'ready' && (messages.data.length === 0
        ? <p className="text-muted">No messages yet. Say hello.</p>
        : <ol className="space-y-2">{messages.data.map(message => <li key={message.id} data-message={message.id}>
          <p className="text-sm"><span className="font-semibold">{message.senderName}</span> <span className="text-muted">· {timeLabel(message.createdAt)}</span></p>
          <p className="whitespace-pre-wrap">{message.content}</p>
        </li>)}</ol>)}
      <Composer placeholder="Message" action="Send" max={2000} onSubmit={text => sendMessage(tenantId, communityId, channelId, text)} />
    </div>
  </section>;
}
