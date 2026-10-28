'use client';

import { useState } from 'react';
import { Search, Users, Image as ImageIcon, ArrowLeft } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

export type Listing = { tenantId: string; name: string; slug: string; logoUrl: string; shortDescription: string; memberCount: number; coverUrl?: string; galleryUrls?: string[]; longDescription?: string; ownerName?: string; isPublic?: boolean; price?: number };
export type LoadState<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };
export type MemberCommunity = { name: string; logoUrl?: string; href?: string };

function CommunityAvatar({ name, logoUrl }: { name: string; logoUrl?: string }) {
  return <Avatar className="size-12 rounded-xl"><AvatarImage src={logoUrl || undefined} alt="" /><AvatarFallback className="rounded-xl">{name.trim().slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>;
}
function LoadingCards() { return <div aria-label="Loading communities" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}</div>; }

export type PriceFilter = 'all' | 'free' | 'paid';
export function filterListings(listings: Listing[], search: string, price: PriceFilter): Listing[] {
  const term = search.trim().toLowerCase();
  return listings.filter(item => `${item.name} ${item.shortDescription}`.toLowerCase().includes(term) &&
    (price === 'all' || (price === 'paid' ? (item.price ?? 0) > 0 : (item.price ?? 0) === 0)));
}
function priceLabel(item: Listing) { return item.price ? `$${item.price}/month` : 'Free'; }
function Cover({ url, name }: { url?: string; name: string }) {
  return <div className="aspect-video overflow-hidden bg-surface-sunken">{url ? <img src={url} alt={`${name} cover`} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-muted"><ImageIcon aria-hidden="true" size={36} /></div>}</div>;
}
export function CommunityAbout({ listing, onBack }: { listing: Listing; onBack: () => void }) {
  const images = [listing.coverUrl, ...(listing.galleryUrls || [])].filter((url): url is string => Boolean(url));
  const [selected, setSelected] = useState(0);
  return <section className="mx-auto w-full max-w-3xl space-y-5 p-4 pb-28 sm:p-8">
    <Button variant="ghost" className="min-h-11" onClick={onBack}><ArrowLeft size={18} /> Back to discover</Button>
    <h2 className="font-display text-3xl font-semibold">{listing.name}</h2>
    <div className="overflow-hidden rounded-xl border border-line"><Cover url={images[selected]} name={listing.name} /></div>
    {images.length > 1 && <div className="flex gap-2 overflow-x-auto">{images.map((url, index) => <Button key={`${url}-${index}`} variant="outline" aria-label={`Show image ${index + 1}`} aria-pressed={selected === index} onClick={() => setSelected(index)} className="h-16 w-24 shrink-0 overflow-hidden p-0"><img src={url} alt="" className="h-full w-full object-cover" /></Button>)}</div>}
    <div className="grid grid-cols-2 gap-3 text-sm font-medium"><span>{listing.isPublic === false ? 'Private' : 'Public'}</span><span>{listing.memberCount.toLocaleString()} {listing.memberCount === 1 ? 'member' : 'members'} at listing</span><span>{priceLabel(listing)}</span>{listing.ownerName && <span>By {listing.ownerName}</span>}</div>
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface-raised p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:static sm:border-0 sm:bg-transparent sm:p-0"><Button render={<a href={`https://${listing.slug}.theharvest.app`} />} className="min-h-11 w-full">Join {listing.name}</Button></div>
    <p className="whitespace-pre-wrap text-body">{listing.longDescription || listing.shortDescription}</p>
  </section>;
}
export function DiscoverView({ state }: { state: LoadState<Listing[]> }) {
  const [search, setSearch] = useState('');
  const [price, setPrice] = useState<PriceFilter>('all');
  const [selected, setSelected] = useState<Listing | null>(null);
  const matches = state.status === 'ready' ? filterListings(state.data, search, price) : [];
  if (selected) return <CommunityAbout listing={selected} onBack={() => setSelected(null)} />;
  return <section className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-8"><div><h2 className="font-display text-3xl font-semibold">Discover communities</h2><p className="mt-2 text-sm text-muted">Find a community to connect with.</p></div>
    <div className="flex gap-2"><div className="relative max-w-xl flex-1"><Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><Input aria-label="Search communities" placeholder="Search communities" value={search} onChange={event => setSearch(event.target.value)} className="min-h-11 pl-10" /></div><Select value={price} onValueChange={value => { if (value) setPrice(value as PriceFilter); }}><SelectTrigger aria-label="Filter by price" className="min-h-11"><SelectValue>{price === 'all' ? 'All' : price === 'free' ? 'Free' : 'Paid'}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="free">Free</SelectItem><SelectItem value="paid">Paid</SelectItem></SelectContent></Select></div>
    {state.status === 'loading' ? <LoadingCards /> : state.status === 'error' ? <p role="alert" className="text-sm text-muted">{state.message}</p> : matches.length === 0 ? <p className="text-sm text-muted">{search.trim() || price !== 'all' ? 'No communities match your search.' : 'No public communities to discover yet.'}</p> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{matches.map(item => <Card key={item.tenantId} className="overflow-hidden bg-surface-raised p-0"><Button variant="ghost" onClick={() => setSelected(item)} className="h-auto w-full flex-col items-stretch gap-0 whitespace-normal p-0 text-left"><Cover url={item.coverUrl} name={item.name} /><CardContent className="flex flex-col gap-3 p-4"><div className="flex items-center gap-3"><CommunityAvatar name={item.name} logoUrl={item.logoUrl} /><h3 className="font-display text-lg font-semibold">{item.name}</h3></div><p className="line-clamp-3 text-sm text-body">{item.shortDescription}</p><div className="flex items-center gap-3 text-sm text-muted"><span className="flex items-center gap-1"><Users size={16} /> {item.memberCount.toLocaleString()} {item.memberCount === 1 ? 'member' : 'members'} at listing</span><span className="font-semibold text-strong">{priceLabel(item)}</span></div></CardContent></Button></Card>)}</div>}
  </section>;
}

export function CommunitiesView({ state, onEnter, onDiscover }: { state: LoadState<MemberCommunity[]>; onEnter: () => void; onDiscover: () => void }) {
  return <section className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-8"><div><h2 className="font-display text-3xl font-semibold">Your communities</h2><p className="mt-2 text-sm text-muted">Choose a community to enter.</p></div>
    {state.status === 'loading' ? <LoadingCards /> : state.status === 'error' ? <p role="alert" className="text-sm text-muted">{state.message}</p> : state.data.length === 0 ? <p className="text-sm text-muted">You have no communities yet.</p> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{state.data.map(item => <Card key={item.name} className="bg-surface-raised"><CardContent className="flex flex-col gap-4"><div className="flex items-center gap-3"><CommunityAvatar name={item.name} logoUrl={item.logoUrl} /><div><h3 className="font-display text-lg font-semibold">{item.name}</h3><Badge variant="secondary">Your community</Badge></div></div>{item.href ? <Button render={<a href={item.href} />} className="min-h-11">Open community</Button> : <Button className="min-h-11" onClick={onEnter}>Open community</Button>}</CardContent></Card>)}</div>}
    <Button variant="outline" className="min-h-11" onClick={onDiscover}>Discover communities</Button>
  </section>;
}
