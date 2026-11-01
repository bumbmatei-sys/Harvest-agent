'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { ImageUpload } from '@/components/ImageUpload';
import { PageHeader } from '@/components/admin-shell/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  STOREFRONT_ACCENTS, STOREFRONT_BLOCK_INFO, STOREFRONT_BLOCK_TYPES, STOREFRONT_LIMITS, STOREFRONT_SOCIALS,
  blockIsComplete, newStorefrontBlock,
  type Storefront, type StorefrontBlock, type StorefrontBlockType, type StorefrontSocial,
} from '@/lib/storefront/storefront';
import { authFetch } from '@/utils/auth-fetch';
import { StorefrontPage, type StorefrontArticleCard, type StorefrontEventCard } from './StorefrontPage';

export interface StorefrontChoice { readonly id: string; readonly title: string }
export interface StorefrontLoaded {
  readonly storefront: Storefront;
  readonly subdomain: string;
  readonly articles: readonly StorefrontArticleCard[];
  readonly events: readonly StorefrontEventCard[];
  readonly choices: Readonly<Record<'community' | 'course' | 'form', readonly StorefrontChoice[]>>;
}
export interface StorefrontApi {
  load(): Promise<StorefrontLoaded>;
  /** Rejects with an Error whose message is shown. */
  save(storefront: Storefront): Promise<Storefront>;
}

export function liveStorefrontApi(tenantId: string): StorefrontApi {
  const json = async <T,>(response: Response): Promise<T> => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.');
    return body as T;
  };
  return {
    load: async () => json<StorefrontLoaded>(await authFetch(`/api/storefront?tenantId=${encodeURIComponent(tenantId)}`)),
    save: async (storefront) => (await json<{ storefront: Storefront }>(await authFetch('/api/storefront', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, storefront }),
    }))).storefront,
  };
}

const TAP = 'min-h-11 sm:min-h-0';
const SOCIAL_LABEL: Record<StorefrontSocial, string> = {
  instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok', x: 'X', threads: 'Threads', spotify: 'Spotify', website: 'Website',
};
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-strong">{label}</span>
      {children}
      {hint && <span className="text-xs text-faint">{hint}</span>}
    </label>
  );
}

/** One block's own fields. */
function BlockFields({ block, choices, onChange }: {
  block: StorefrontBlock; choices: StorefrontLoaded['choices']; onChange: (next: StorefrontBlock) => void;
}) {
  const set = (patch: Record<string, unknown>) => onChange({ ...block, ...patch } as StorefrontBlock);
  const title = <Field label="Title"><Input value={block.title} maxLength={STOREFRONT_LIMITS.title} onChange={(e) => set({ title: e.target.value })} className={TAP} /></Field>;
  const subtitle = 'subtitle' in block
    ? <Field label="Subtitle"><Input value={block.subtitle} maxLength={STOREFRONT_LIMITS.subtitle} onChange={(e) => set({ subtitle: e.target.value })} className={TAP} /></Field>
    : null;
  switch (block.type) {
    case 'category': case 'blog': case 'give': case 'emailCapture':
      return <>{title}{subtitle}{block.type === 'blog' && <p className="text-xs text-faint">Shows your three latest articles and a View all page with search and category filters.</p>}</>;
    case 'link': case 'bookCall': case 'video':
      return <>{title}{subtitle}<Field label="URL"><Input value={block.url} placeholder="https://" onChange={(e) => set({ url: e.target.value })} className={TAP} /></Field></>;
    case 'text':
      return <>{title}<Field label="Text"><Textarea value={block.body} rows={4} maxLength={STOREFRONT_LIMITS.body} onChange={(e) => set({ body: e.target.value })} /></Field></>;
    case 'events':
      return <>{title}<Field label="How many">
        <Select value={String(block.count)} onValueChange={(value) => { if (value) set({ count: Number(value) }); }}>
          <SelectTrigger aria-label="How many events" className={TAP}><SelectValue>{block.count}</SelectValue></SelectTrigger>
          <SelectContent>{[1, 2, 3, 4, 5, 6].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
        </Select>
      </Field></>;
    case 'community': case 'course': case 'form': {
      const options = choices[block.type];
      const picked = options.find((option) => option.id === block.targetId);
      return <>
        <Field label={STOREFRONT_BLOCK_INFO[block.type].label}>
          <Select value={block.targetId || undefined} onValueChange={(value) => {
            if (!value) return;
            const option = options.find((entry) => entry.id === value);
            set({ targetId: value, title: block.title || option?.title || '' });
          }}>
            <SelectTrigger aria-label={`Which ${block.type}`} className={TAP}><SelectValue>{picked?.title ?? (options.length ? 'Pick one' : `No published ${block.type}s yet`)}</SelectValue></SelectTrigger>
            <SelectContent>{options.map((option) => <SelectItem key={option.id} value={option.id}>{option.title}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        {title}{subtitle}
      </>;
    }
    case 'testimonials':
      return <>{title}
        {block.items.map((item, index) => (
          <div key={index} className="flex flex-col gap-2 rounded-lg border border-line p-3">
            <Textarea aria-label={`Testimonial ${index + 1}`} value={item.quote} rows={2} maxLength={STOREFRONT_LIMITS.quote}
              onChange={(e) => set({ items: block.items.map((it, i) => (i === index ? { ...it, quote: e.target.value } : it)) })} />
            <div className="flex gap-2">
              <Input aria-label={`Testimonial ${index + 1} name`} value={item.name} placeholder="Name" maxLength={STOREFRONT_LIMITS.name}
                onChange={(e) => set({ items: block.items.map((it, i) => (i === index ? { ...it, name: e.target.value } : it)) })} className={TAP} />
              <Button type="button" variant="ghost" className={TAP} onClick={() => set({ items: block.items.filter((_, i) => i !== index) })}>Remove</Button>
            </div>
          </div>
        ))}
        {block.items.length < STOREFRONT_LIMITS.testimonials && (
          <Button type="button" variant="outline" className={`self-start ${TAP}`} onClick={() => set({ items: [...block.items, { quote: '', name: '' }] })}>Add a testimonial</Button>
        )}
      </>;
  }
}

/**
 * Storefront editor (Eden 005–010, 016, 017): the blocks, the profile and the
 * look on the left, a live phone preview on the right. One template for now.
 */
export function AdminStorefront({ api }: { api: StorefrontApi }) {
  const [loaded, setLoaded] = useState<StorefrontLoaded | null>(null);
  const [draft, setDraft] = useState<Storefront | null>(null);
  const [saved, setSaved] = useState<Storefront | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.load().then((data) => { setLoaded(data); setDraft(data.storefront); setSaved(data.storefront); }, (e: Error) => setError(e.message));
  }, [api]);
  useEffect(() => { load(); }, [load]);

  if (!draft || !loaded) {
    return <div className="flex flex-col gap-4 p-4 lg:p-0">
      {error ? <p role="alert" className="text-sm text-muted">{error}</p> : <Skeleton className="h-64 w-full rounded-xl" />}
    </div>;
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (patch: Partial<Storefront>) => { setDraft({ ...draft, ...patch }); setError(''); };
  const setBlocks = (blocks: readonly StorefrontBlock[]) => set({ blocks });
  const move = (index: number, by: -1 | 1) => {
    const next = [...draft.blocks];
    const [block] = next.splice(index, 1);
    next.splice(index + by, 0, block);
    setBlocks(next);
  };
  const add = (type: StorefrontBlockType) => {
    const block = newStorefrontBlock(type, newId());
    setBlocks([...draft.blocks, block]);
    setOpen(block.id);
    setAdding(false);
  };
  const url = `https://${loaded.subdomain}.theharvest.app/storefront`;
  const titles = Object.fromEntries(Object.values(loaded.choices).flat().map((c) => [c.id, c.title]));
  const save = async (next = draft) => {
    setSaving(true); setError('');
    try { const result = await api.save(next); setDraft(result); setSaved(result); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="flex w-full flex-col gap-6 p-4 lg:p-0" data-testid="admin-storefront">
      <PageHeader
        title="Storefront"
        subtitle="The one link for your bio. Changes go live when you save."
        action={<div className="flex flex-wrap items-center gap-2">
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button type="button" variant="ghost" className={TAP} render={<a href={url} target="_blank" rel="noopener noreferrer" />}>
            <ExternalLink /> Open page
          </Button>
          <Button type="button" className={TAP} disabled={saving || !dirty} onClick={() => void save()}>{saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}</Button>
        </div>}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-6">
          <section className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface-raised p-4" data-storefront-publish>
            <div>
              <p className="font-semibold text-strong">{draft.published ? 'Your page is live' : 'Your page is off'}</p>
              <p className="break-all text-xs text-muted">{url}</p>
            </div>
            <Switch aria-label="Page is live" checked={draft.published} onCheckedChange={(on) => set({ published: on })} />
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
              <div><h2 className="font-semibold text-strong">Blocks</h2><p className="text-xs text-muted">Move to reorder. Switch off to hide.</p></div>
              <Button type="button" variant="outline" className={TAP} onClick={() => setAdding(true)}><Plus /> Add block</Button>
            </div>
            {draft.blocks.length === 0 && <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-faint">No blocks yet. Add a link, your blog, events, a way to give and more.</p>}
            <ul className="flex flex-col gap-2">
              {draft.blocks.map((block, index) => (
                <li key={block.id} data-storefront-block={block.type} className="rounded-xl border border-line bg-surface-raised">
                  <div className="flex items-center gap-2 p-3">
                    <div className="flex flex-col">
                      <Button type="button" variant="ghost" size="icon-sm" className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp /></Button>
                      <Button type="button" variant="ghost" size="icon-sm" className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0" aria-label="Move down" disabled={index === draft.blocks.length - 1} onClick={() => move(index, 1)}><ArrowDown /></Button>
                    </div>
                    <button type="button" className="min-w-0 flex-1 text-left" aria-expanded={open === block.id} onClick={() => setOpen(open === block.id ? null : block.id)}>
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-strong">{block.title || titles[(block as { targetId?: string }).targetId ?? ''] || STOREFRONT_BLOCK_INFO[block.type].label}</span>
                        {!blockIsComplete(block) && <Badge variant="outline">Needs setup</Badge>}
                      </span>
                      <span className="text-xs text-muted">{STOREFRONT_BLOCK_INFO[block.type].label}</span>
                    </button>
                    <ChevronDown className={`size-4 text-faint transition-transform ${open === block.id ? 'rotate-180' : ''}`} aria-hidden />
                    <Switch aria-label={`Show ${STOREFRONT_BLOCK_INFO[block.type].label}`} checked={block.enabled}
                      onCheckedChange={(on) => setBlocks(draft.blocks.map((b) => (b.id === block.id ? { ...b, enabled: on } : b)))} />
                  </div>
                  {open === block.id && (
                    <div className="flex flex-col gap-3 border-t border-line p-3">
                      <BlockFields block={block} choices={loaded.choices} onChange={(next) => setBlocks(draft.blocks.map((b) => (b.id === block.id ? next : b)))} />
                      <Button type="button" variant="ghost" className={`self-start text-danger ${TAP}`} onClick={() => setBlocks(draft.blocks.filter((b) => b.id !== block.id))}><Trash2 /> Remove block</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface-raised p-4" aria-label="Profile">
            <h2 className="font-semibold text-strong">Profile</h2>
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-strong">Photo</span>
              <span className="text-xs text-faint">Square works best.</span>
              <ImageUpload value={draft.profile.photoUrl} rounded onChange={(photoUrl) => set({ profile: { ...draft.profile, photoUrl } })} label="Add a photo" />
            </div>
            <Field label="Name"><Input value={draft.profile.name} maxLength={STOREFRONT_LIMITS.name} onChange={(e) => set({ profile: { ...draft.profile, name: e.target.value } })} className={TAP} /></Field>
            <Field label="Bio" hint={`${draft.profile.bio.length}/${STOREFRONT_LIMITS.bio}`}>
              <Textarea value={draft.profile.bio} rows={3} maxLength={STOREFRONT_LIMITS.bio} onChange={(e) => set({ profile: { ...draft.profile, bio: e.target.value } })} />
            </Field>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-strong">Social links</span>
              {STOREFRONT_SOCIALS.map((network) => {
                const current = draft.socials.find((s) => s.network === network)?.url ?? '';
                return (
                  <label key={network} className="flex items-center gap-2 text-sm">
                    <span className="w-24 shrink-0 text-muted">{SOCIAL_LABEL[network]}</span>
                    <Input aria-label={`${SOCIAL_LABEL[network]} link`} value={current} placeholder="https://" className={TAP}
                      onChange={(e) => {
                        const others = draft.socials.filter((s) => s.network !== network);
                        set({ socials: e.target.value ? [...others, { network, url: e.target.value }] : others });
                      }} />
                  </label>
                );
              })}
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface-raised p-4" aria-label="Look">
            <div><h2 className="font-semibold text-strong">Look</h2><p className="text-xs text-muted">One design for now; more are coming.</p></div>
            <div className="flex items-center gap-3">
              <span className="rounded-lg border-2 border-strong px-3 py-2 text-sm font-semibold text-strong" aria-current="true">Classic</span>
            </div>
            <div role="group" aria-label="Accent colour" className="flex flex-wrap gap-2">
              {STOREFRONT_ACCENTS.map((accent) => (
                <button key={accent} type="button" aria-label={accent} aria-pressed={draft.look.accent === accent}
                  onClick={() => set({ look: { ...draft.look, accent } })}
                  className="flex size-11 items-center justify-center rounded-full border border-line aria-pressed:ring-2 aria-pressed:ring-strong sm:size-9">
                  <span className="size-6 rounded-full" style={{ backgroundColor: accent }} />
                </button>
              ))}
            </div>
          </section>
        </div>

        <aside className="xl:sticky xl:top-4 xl:self-start" aria-label="Preview">
          <p className="mb-2 text-xs text-faint">Preview{dirty ? ' · not saved' : ' · live'}</p>
          <div data-storefront-preview className="mx-auto h-[720px] w-full max-w-[380px] overflow-y-auto rounded-[2.5rem] border-[10px] border-[#1d1f1e] bg-[#111312]">
            <StorefrontPage storefront={draft} tenantId={loaded.subdomain} articles={loaded.articles} events={loaded.events} titles={titles} preview />
          </div>
        </aside>
      </div>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-3xl">
          <DialogTitle>Add block</DialogTitle>
          <DialogDescription>Pick what goes on your page. You can move it after.</DialogDescription>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {STOREFRONT_BLOCK_TYPES.map((type) => (
              <button key={type} type="button" data-add-block={type} onClick={() => add(type)}
                className="flex min-h-11 flex-col items-start gap-1 rounded-xl border border-line p-4 text-left hover:border-strong">
                <span className="font-semibold text-strong">{STOREFRONT_BLOCK_INFO[type].label}</span>
                <span className="text-xs text-muted">{STOREFRONT_BLOCK_INFO[type].description}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
