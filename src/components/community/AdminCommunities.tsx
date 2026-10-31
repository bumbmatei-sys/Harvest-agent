'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';

import { PageHeader } from '@/components/admin-shell/PageHeader';
import { AdminPrimaryButton } from '@/components/admin/AdminUI';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { FORM_CONTAINER } from '@/components/layout/form-layout';
import {
  COMMUNITY_LIMITS, formatCommunityPrice, PAID_COMING_SOON_MESSAGE, PAID_COMMUNITIES_ENABLED, publishBlocker,
  type CommunityEdit, type CommunityPriceInterval, type CommunityRecord,
} from '@/lib/community/communities';
import { authFetch } from '@/utils/auth-fetch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

type List = { communities: CommunityRecord[]; limit: number; defaultClosed: boolean };
type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: List };

async function call(url: string, init?: RequestInit) {
  const response = await authFetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.');
  return body;
}

/**
 * The Communities page: every community of the ministry, like Products. The
 * default community opens its existing setup; the others open the editor.
 */
export function AdminCommunities({ tenantId, defaultSetup }: {
  tenantId: string | null;
  /** The default community's existing setup screen. */
  defaultSetup: ReactNode;
}) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CommunityRecord | null>(null);
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    if (!tenantId) { setLoad({ status: 'error', message: 'Select a ministry to manage communities.' }); return; }
    try { setLoad({ status: 'ready', data: await call(`/api/communities?tenantId=${encodeURIComponent(tenantId)}`) }); }
    catch (error) { setLoad({ status: 'error', message: (error as Error).message }); }
  }, [tenantId]);
  useEffect(() => { void refresh(); }, [refresh]);

  if (open === 'default') {
    return <div className="space-y-4">
      <Button variant="ghost" className="min-h-11 sm:min-h-0" onClick={() => { setOpen(null); void refresh(); }}><ArrowLeft /> Communities</Button>
      {defaultSetup}
    </div>;
  }
  const editing = open && load.status === 'ready' ? load.data.communities.find(c => c.id === open) : undefined;
  if (editing && tenantId) {
    return <CommunityEditor tenantId={tenantId} community={editing} onBack={() => { setOpen(null); void refresh(); }} />;
  }

  const data = load.status === 'ready' ? load.data : null;
  const atLimit = !!data && data.limit !== -1 && data.communities.length >= data.limit;
  const limitMessage = data?.limit === 0 ? 'Your plan does not include communities.' : `Your plan includes ${data?.limit} ${data?.limit === 1 ? 'community' : 'communities'}.`;

  return <div className={`w-full ${FORM_CONTAINER} space-y-6`}>
    <PageHeader
      title="Communities"
      subtitle={data ? (data.limit === -1 ? `${data.communities.length} ${data.communities.length === 1 ? 'community' : 'communities'}` : `${data.communities.length} of ${data.limit} used`) : undefined}
      action={<AdminPrimaryButton onClick={() => setCreating(true)} icon={<Plus size={16} />} disabled={!data || atLimit} title={atLimit ? limitMessage : undefined}>New community</AdminPrimaryButton>}
    />
    {notice && <p role="alert" className="text-sm text-danger">{notice}</p>}
    {load.status === 'loading' && <p className="text-sm text-muted">Loading communities…</p>}
    {load.status === 'error' && <p role="alert" className="text-sm text-muted">{load.message}</p>}
    {data?.defaultClosed && tenantId && <Card className="bg-surface-raised"><CardContent className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="font-semibold text-strong">Your default community is deleted</p><p className="text-sm text-muted">Members see it closed. Its posts and members are kept, so you can bring it back.</p></div>
      <Button variant="outline" className="min-h-11 sm:min-h-0" onClick={async () => {
        setNotice('');
        try { await call('/api/communities/default', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, restore: true }) }); await refresh(); }
        catch (error) { setNotice((error as Error).message); }
      }}>Restore</Button>
    </CardContent></Card>}
    {data && data.communities.length === 0 && !data.defaultClosed && <p className="text-sm text-muted">No communities yet.</p>}
    {data && <div className="space-y-3">{data.communities.map(community => <Card key={community.id} data-community-row={community.id} className="bg-surface-raised">
      <CardContent className="flex flex-wrap items-center gap-4">
        <Avatar className="size-12 rounded-xl"><AvatarImage src={community.iconUrl || undefined} alt="" /><AvatarFallback className="rounded-xl">{community.name.trim().slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-strong">{community.name}</p>
            {community.isDefault && <Badge variant="secondary">Default</Badge>}
            <Badge variant="outline">{community.visibility === 'public' ? 'Public' : 'Private'}</Badge>
            <Badge variant="outline">{formatCommunityPrice(community.pricing)}</Badge>
            <Badge variant={community.status === 'published' ? 'default' : 'secondary'}>{community.status === 'published' ? 'Published' : 'Draft'}</Badge>
          </div>
          {community.tagline && <p className="mt-1 line-clamp-2 text-sm text-muted">{community.tagline}</p>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="min-h-11 sm:min-h-0" onClick={() => setOpen(community.id)}>Edit</Button>
          <Button variant="outline" className="min-h-11 sm:min-h-0" onClick={() => setDeleting(community)}>Delete</Button>
        </div>
      </CardContent>
    </Card>)}</div>}

    {tenantId && <NewCommunityDialog open={creating} tenantId={tenantId} onClose={() => setCreating(false)} onCreated={async id => { setCreating(false); await refresh(); setOpen(id); }} />}
    {tenantId && <DeleteCommunityDialog community={deleting} tenantId={tenantId} onClose={() => setDeleting(null)} onDeleted={async () => { setDeleting(null); await refresh(); }} />}
  </div>;
}

function NewCommunityDialog({ open, tenantId, onClose, onCreated }: { open: boolean; tenantId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setName(''); setError(''); } }, [open]);
  return <Dialog open={open} onOpenChange={next => { if (!next && !saving) onClose(); }}>
    <DialogContent className="sm:max-w-md">
      <DialogTitle>New community</DialogTitle>
      <DialogDescription>It starts as a private, free draft. You can set the rest up next.</DialogDescription>
      <label className="space-y-1.5"><span className="text-sm font-medium">Name</span>
        <Input value={name} maxLength={COMMUNITY_LIMITS.name} onChange={event => setName(event.target.value)} className="min-h-11 sm:min-h-0" /></label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <DialogFooter>
        <Button variant="outline" className="min-h-11 sm:min-h-0" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button className="min-h-11 sm:min-h-0" disabled={saving || !name.trim()} onClick={async () => {
          setSaving(true); setError('');
          try { const { id } = await call('/api/communities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, name }) }); onCreated(id); }
          catch (failure) { setError((failure as Error).message); }
          finally { setSaving(false); }
        }}>{saving ? 'Creating…' : 'Create'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function DeleteCommunityDialog({ community, tenantId, onClose, onDeleted }: { community: CommunityRecord | null; tenantId: string; onClose: () => void; onDeleted: () => void }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setError(''); }, [community]);
  return <Dialog open={!!community} onOpenChange={next => { if (!next && !saving) onClose(); }}>
    <DialogContent className="sm:max-w-md">
      <DialogTitle>Delete {community?.name}?</DialogTitle>
      <DialogDescription>{community?.isDefault
        ? 'Members will see this community closed and it leaves Discover. Its posts and members are kept, so you can restore it from this page.'
        : 'This deletes the community and its setup. It cannot be undone.'}</DialogDescription>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <DialogFooter>
        <Button variant="outline" className="min-h-11 sm:min-h-0" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button variant="destructive" className="min-h-11 sm:min-h-0" disabled={saving} onClick={async () => {
          if (!community) return;
          setSaving(true); setError('');
          try { await call(`/api/communities/${community.id}?tenantId=${encodeURIComponent(tenantId)}`, { method: 'DELETE' }); onDeleted(); }
          catch (failure) { setError((failure as Error).message); }
          finally { setSaving(false); }
        }}>{saving ? 'Deleting…' : 'Delete'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

const STEPS = [
  { id: 'offer', label: 'Offer' },
  { id: 'basics', label: 'Basics' },
  { id: 'joining', label: 'Joining' },
  { id: 'publish', label: 'Publish' },
] as const;
type Step = typeof STEPS[number]['id'];

const CURRENCIES = ['usd', 'eur', 'gbp', 'ron', 'cad', 'aud'];

/** Eden's community editor, first steps: the steps on the left, the form beside them. */
export function CommunityEditor({ tenantId, community, onBack }: { tenantId: string; community: CommunityRecord; onBack: () => void }) {
  const [step, setStep] = useState<Step>('offer');
  const [draft, setDraft] = useState<CommunityEdit>(() => ({
    name: community.name, tagline: community.tagline, iconUrl: community.iconUrl, about: community.about,
    visibility: community.visibility, pricing: community.pricing, joining: community.joining,
  }));
  const [price, setPrice] = useState(community.pricing.type === 'paid' ? (community.pricing.amountCents / 100).toFixed(2) : '');
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<CommunityEdit>) => { setDraft(current => ({ ...current, ...patch })); setMessage(null); };
  const paid = draft.pricing.type === 'paid' ? draft.pricing : null;

  const [status, setStatus] = useState(community.status);
  const save = async (nextStatus?: 'published' | 'draft') => {
    setSaving(true); setMessage(null);
    try {
      let pricing = draft.pricing;
      if (pricing.type === 'paid') {
        const amount = Math.round(Number(price) * 100);
        if (!Number.isFinite(amount)) throw new Error('Enter a price, like 15.00.');
        pricing = { ...pricing, amountCents: amount };
      }
      await call(`/api/communities/${community.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, community: { ...draft, pricing }, ...(nextStatus ? { status: nextStatus } : {}) }) });
      if (nextStatus) setStatus(nextStatus);
      setMessage({ kind: 'ok', text: nextStatus === 'published' ? 'Published.' : nextStatus === 'draft' ? 'Unpublished.' : 'Saved.' });
    } catch (error) { setMessage({ kind: 'error', text: (error as Error).message }); }
    finally { setSaving(false); }
  };

  return <div className="space-y-6" data-community-editor={community.id}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button variant="ghost" className="min-h-11 sm:min-h-0" onClick={onBack}><ArrowLeft /> Communities</Button>
      <div className="flex items-center gap-3">
        {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${message.kind === 'error' ? 'text-danger' : 'text-muted'}`}>{message.text}</p>}
        <Button className="min-h-11 sm:min-h-0" disabled={saving} onClick={() => save()}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </div>
    {/* The product editor layout (AGENTS.md): steps, options, live preview. */}
    <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,1fr)_320px]">
      <nav aria-label="Community setup steps" className="flex gap-1 overflow-x-auto lg:flex-col">
        {STEPS.map(item => <Button key={item.id} variant="ghost" data-active={step === item.id} aria-current={step === item.id ? 'step' : undefined}
          className="min-h-11 justify-start data-[active=true]:bg-surface-sunken data-[active=true]:text-strong sm:min-h-0" onClick={() => setStep(item.id)}>{item.label}</Button>)}
      </nav>
      <Card className="bg-surface-raised"><CardContent className="space-y-5">
        {step === 'offer' && <>
          <h2 className="font-display text-2xl text-strong">Offer</h2>
          <Field label="Name"><Input value={draft.name} maxLength={COMMUNITY_LIMITS.name} onChange={e => set({ name: e.target.value })} className="min-h-11 sm:min-h-0" /></Field>
          <Field label="Tagline" hint="One line under the name, on its page and in Discover."><Input value={draft.tagline} maxLength={COMMUNITY_LIMITS.tagline} onChange={e => set({ tagline: e.target.value })} className="min-h-11 sm:min-h-0" /></Field>
          <Field label="Icon URL" hint="An HTTPS image link."><Input value={draft.iconUrl} onChange={e => set({ iconUrl: e.target.value })} className="min-h-11 sm:min-h-0" /></Field>
          <Field label="Price">
            <ToggleGroup value={[draft.pricing.type]} onValueChange={values => {
              const next = values[values.length - 1];
              if (next === 'free') set({ pricing: { type: 'free' } });
              if (next === 'paid') set({ pricing: { type: 'paid', amountCents: paid?.amountCents ?? 1000, currency: paid?.currency ?? 'usd', interval: paid?.interval ?? 'month' } });
            }} variant="outline" aria-label="Free or paid">
              <ToggleGroupItem value="free" className="min-h-11 sm:min-h-0">Free</ToggleGroupItem>
              <ToggleGroupItem value="paid" disabled={!PAID_COMMUNITIES_ENABLED} className="min-h-11 sm:min-h-0">Paid{!PAID_COMMUNITIES_ENABLED && <Badge variant="secondary" className="ml-1.5">Coming soon</Badge>}</ToggleGroupItem>
            </ToggleGroup>
          </Field>
          {paid && <div className="flex flex-wrap gap-3">
            <Field label="Amount"><Input inputMode="decimal" value={price} placeholder="10.00" onChange={e => { setPrice(e.target.value); setMessage(null); }} className="min-h-11 w-32 sm:min-h-0" /></Field>
            <Field label="Currency"><Select value={paid.currency} onValueChange={value => { if (value) set({ pricing: { ...paid, currency: value } }); }}>
              <SelectTrigger aria-label="Currency" className="min-h-11 w-28 sm:min-h-0"><SelectValue>{paid.currency.toUpperCase()}</SelectValue></SelectTrigger>
              <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c.toUpperCase()}</SelectItem>)}</SelectContent>
            </Select></Field>
            <Field label="Billing"><Select value={paid.interval} onValueChange={value => { if (value) set({ pricing: { ...paid, interval: value as CommunityPriceInterval } }); }}>
              <SelectTrigger aria-label="Billing" className="min-h-11 w-36 sm:min-h-0"><SelectValue>{paid.interval === 'month' ? 'Monthly' : paid.interval === 'year' ? 'Yearly' : 'One time'}</SelectValue></SelectTrigger>
              <SelectContent><SelectItem value="month">Monthly</SelectItem><SelectItem value="year">Yearly</SelectItem><SelectItem value="once">One time</SelectItem></SelectContent>
            </Select></Field>
          </div>}
          {!PAID_COMMUNITIES_ENABLED && <p className="text-sm text-muted">{PAID_COMING_SOON_MESSAGE}</p>}
        </>}
        {step === 'basics' && <>
          <h2 className="font-display text-2xl text-strong">Basics</h2>
          <Field label="About" hint="What the community is for and who it is for."><Textarea value={draft.about} maxLength={COMMUNITY_LIMITS.about} rows={8} onChange={e => set({ about: e.target.value })} /></Field>
          <Field label="Who can find it">
            <ToggleGroup value={[draft.visibility]} onValueChange={values => { const next = values[values.length - 1]; if (next === 'public' || next === 'private') set({ visibility: next }); }} variant="outline" aria-label="Visibility">
              <ToggleGroupItem value="public" className="min-h-11 sm:min-h-0">Public</ToggleGroupItem>
              <ToggleGroupItem value="private" className="min-h-11 sm:min-h-0">Private</ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <p className="text-sm text-muted">{draft.visibility === 'public' ? 'Public communities get their own page and a Discover listing once published.' : 'Private communities are only reachable by link or invite.'}</p>
        </>}
        {step === 'joining' && <>
          <h2 className="font-display text-2xl text-strong">Joining</h2>
          <Field label="How people join">
            <ToggleGroup value={[draft.joining.mode]} onValueChange={values => { const next = values[values.length - 1]; if (next === 'open' || next === 'apply') set({ joining: { mode: next } }); }} variant="outline" aria-label="How people join">
              <ToggleGroupItem value="open" className="min-h-11 sm:min-h-0">Anyone can join</ToggleGroupItem>
              <ToggleGroupItem value="apply" className="min-h-11 sm:min-h-0">Apply first</ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <p className="text-sm text-muted">{draft.joining.mode === 'apply' ? 'People answer your questions and you approve them.' : 'People join straight away.'}</p>
        </>}
        {step === 'publish' && <>
          <h2 className="font-display text-2xl text-strong">Publish</h2>
          <div className="flex items-center gap-2"><span className="text-sm text-muted">Status</span><Badge variant={status === 'published' ? 'default' : 'secondary'}>{status === 'published' ? 'Published' : 'Draft'}</Badge></div>
          {status === 'published' ? <>
            <p className="text-sm text-body">Your community is live. Share this link so people can find it and join:</p>
            <p data-community-link className="break-all rounded-lg bg-surface-sunken px-3 py-2 text-sm text-strong">{`${typeof window === 'undefined' ? '' : window.location.origin}/community/${tenantId}/${community.id}`}</p>
            <Button variant="outline" className="min-h-11 sm:min-h-0" disabled={saving} onClick={() => save('draft')}>Unpublish</Button>
          </> : publishBlocker(draft) ? <>
            <p className="text-sm text-body">{publishBlocker(draft)}</p>
            <Button className="min-h-11 sm:min-h-0" disabled>Publish</Button>
          </> : <>
            <p className="text-sm text-body">Publishing saves your setup, opens the community with a General chat, and gives you a link to share.</p>
            <Button className="min-h-11 sm:min-h-0" disabled={saving} onClick={() => save('published')}>{saving ? 'Publishing…' : 'Publish'}</Button>
          </>}
        </>}
      </CardContent></Card>
      <CommunityPreview draft={draft} />
    </div>
  </div>;
}

/** What a visitor sees on the community's page, redrawn on every keystroke. */
function CommunityPreview({ draft }: { draft: CommunityEdit }) {
  return <aside aria-label="Preview" data-community-preview className="space-y-2 lg:col-span-2 xl:col-span-1">
    <p className="text-xs font-medium uppercase tracking-wide text-muted">Preview</p>
    <Card className="bg-surface-raised"><CardContent className="space-y-4">
      <div className="flex items-center gap-3">
        <Avatar className="size-12 rounded-xl"><AvatarImage src={draft.iconUrl || undefined} alt="" /><AvatarFallback className="rounded-xl">{draft.name.trim().slice(0, 1).toUpperCase() || '?'}</AvatarFallback></Avatar>
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-semibold text-strong">{draft.name.trim() || 'Community name'}</p>
          <p className="text-xs text-muted">{draft.visibility === 'public' ? 'Public' : 'Private'} · {formatCommunityPrice(draft.pricing)}</p>
        </div>
      </div>
      {draft.tagline.trim() && <p className="text-sm text-body">{draft.tagline}</p>}
      {draft.about.trim() && <p className="line-clamp-6 whitespace-pre-line text-sm text-muted">{draft.about}</p>}
      <Button className="min-h-11 w-full sm:min-h-0" disabled tabIndex={-1}>{draft.joining.mode === 'apply' ? 'Apply to join' : 'Join community'}</Button>
    </CardContent></Card>
  </aside>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-sm font-medium text-strong">{label}</span>{children}{hint && <span className="block text-xs text-muted">{hint}</span>}</label>;
}
