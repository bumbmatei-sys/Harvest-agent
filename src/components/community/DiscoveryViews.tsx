'use client';

import { useState } from 'react';
import './branding.css';
import { communityBrandStyle } from '@/lib/community/branding';
import { Search, Users, Image as ImageIcon, ArrowLeft, Star } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { CommunityReviews, HarvestFooter, Stars } from './CommunityReviews';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel';

export type Listing = { tenantId: string; name: string; slug: string; logoUrl: string; brandColor?: string; shortDescription: string; memberCount: number; coverUrl?: string; galleryUrls?: string[]; longDescription?: string; ownerName?: string; isPublic?: boolean; price?: number; ratingAvg?: number; ratingCount?: number };
export type LoadState<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };
export type MemberCommunity = { name: string; logoUrl?: string; href?: string };

function CommunityAvatar({ name, logoUrl }: { name: string; logoUrl?: string }) {
  return <Avatar className="size-12 rounded-xl ring-2 ring-[var(--brand-color)]"><AvatarImage src={logoUrl || undefined} alt="" /><AvatarFallback className="rounded-xl">{name.trim().slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>;
}
function LoadingCards() { return <div aria-label="Loading communities" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}</div>; }

export type PriceFilter = 'all' | 'free' | 'paid';
export type RatingFilter = 'any' | 'four' | 'sort';
export function filterListings(listings: Listing[], search: string, price: PriceFilter, rating: RatingFilter = 'any'): Listing[] {
  const term = search.trim().toLowerCase();
  const matches = listings.filter(item => `${item.name} ${item.shortDescription}`.toLowerCase().includes(term) &&
    (price !== 'paid') &&
    (rating !== 'four' || ((item.ratingCount || 0) > 0 && (item.ratingAvg || 0) >= 4)));
  if (rating === 'sort') matches.sort((a, b) => (b.ratingAvg || 0) - (a.ratingAvg || 0));
  return matches;
}
function Rating({ listing }: { listing: Listing }) {
  if (!listing.ratingCount || listing.ratingAvg === undefined) return null;
  return <span aria-label={`${listing.ratingAvg.toFixed(1)} out of 5, ${listing.ratingCount.toLocaleString()} ${listing.ratingCount === 1 ? 'review' : 'reviews'}`} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap"><Star size={16} fill="var(--brand-color)" stroke="var(--brand-color)" aria-hidden="true" /> {listing.ratingAvg.toFixed(1)} ({listing.ratingCount.toLocaleString()})</span>;
}
function priceLabel() { return 'Free'; }
function Cover({ url, name }: { url?: string; name: string }) {
  return <div className="aspect-video overflow-hidden bg-surface-sunken">{url ? <img src={url} alt={`${name} cover`} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-muted"><ImageIcon aria-hidden="true" size={36} /></div>}</div>;
}
export function CommunityAbout({ listing, onBack, access }: { listing: Listing; onBack: () => void; access?: { getToken: () => Promise<string> } }) {
  const [summary, setSummary] = useState({ ratingAvg: listing.ratingAvg || 0, ratingCount: listing.ratingCount || 0 });
  const images = [listing.coverUrl, ...(listing.galleryUrls || [])].filter((url): url is string => Boolean(url));
  return <section style={communityBrandStyle(listing.brandColor)} className="community-brand-scope mx-auto w-full max-w-3xl space-y-5 p-4 pb-[calc(77px+env(safe-area-inset-bottom))] sm:p-8">
    <Button variant="ghost" className="min-h-11" onClick={onBack}><ArrowLeft size={18} /> Back to discover</Button>
    <div className="flex items-start justify-between gap-4"><h2 className="font-display text-3xl font-semibold">{listing.name}</h2><Button render={<a href={`https://${listing.slug}.theharvest.app`} />} className="hidden min-h-11 sm:inline-flex">Join {listing.name}</Button></div>
    {summary.ratingCount ? <div className="flex items-center gap-2 text-sm text-muted"><Stars rating={summary.ratingAvg} /><span>{summary.ratingAvg.toFixed(1)} · {summary.ratingCount.toLocaleString()} {summary.ratingCount === 1 ? 'review' : 'reviews'}</span></div> : <p className="text-sm text-muted">No reviews yet</p>}
    {images.length ? <Carousel aria-label={`${listing.name} gallery`} className="overflow-hidden rounded-xl border border-line"><CarouselContent>{images.map((url, index) => <CarouselItem key={`${url}-${index}`}><Cover url={url} name={listing.name} /></CarouselItem>)}</CarouselContent>{images.length > 1 && <><CarouselPrevious className="left-3 min-h-11 min-w-11" /><CarouselNext className="right-3 min-h-11 min-w-11" /></>}</Carousel> : <div className="overflow-hidden rounded-xl border border-line"><Cover name={listing.name} /></div>}
    <div className="grid grid-cols-2 gap-3 text-sm font-medium"><span>{listing.isPublic === false ? 'Private' : 'Public'}</span><span>{listing.memberCount.toLocaleString()} {listing.memberCount === 1 ? 'member' : 'members'}</span><span>{priceLabel()}</span>{listing.ownerName && <span>By {listing.ownerName}</span>}</div>
    <div className="fixed inset-x-0 bottom-[var(--community-bottom-nav-height,0px)] z-30 border-t border-line bg-surface-raised p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:hidden"><Button render={<a href={`https://${listing.slug}.theharvest.app`} />} className="min-h-11 w-full">Join {listing.name}</Button></div>
    <p className="whitespace-pre-wrap text-body">{listing.longDescription || listing.shortDescription}</p>
    <CommunityReviews tenantId={listing.tenantId} access={access} onRatingChange={setSummary} />
    <HarvestFooter />
  </section>;
}
export function DiscoverView({ state, member, showFooter = false }: { state: LoadState<Listing[]>; member?: { tenantId: string; getToken: () => Promise<string> }; showFooter?: boolean }) {
  const [search, setSearch] = useState('');
  const [price, setPrice] = useState<PriceFilter>('all');
  const [rating, setRating] = useState<RatingFilter>('any');
  const [selected, setSelected] = useState<Listing | null>(null);
  const matches = state.status === 'ready' ? filterListings(state.data, search, price, rating) : [];
  if (selected) return <CommunityAbout listing={selected} onBack={() => setSelected(null)} access={member?.tenantId === selected.tenantId ? member : undefined} />;
  return <section className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-8"><div><h2 className="font-display text-3xl font-semibold">Discover communities</h2><p className="mt-2 text-sm text-muted">Find a community to connect with.</p></div>
    <div className="flex gap-2"><div className="relative max-w-xl flex-1"><Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><Input aria-label="Search communities" placeholder="Search communities" value={search} onChange={event => setSearch(event.target.value)} className="min-h-11 pl-10" /></div><Select value={price} onValueChange={value => { if (value) setPrice(value as PriceFilter); }}><SelectTrigger aria-label="Filter by price" className="min-h-11"><SelectValue>{price === 'all' ? 'All' : price === 'free' ? 'Free' : 'Paid'}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="free">Free</SelectItem><SelectItem value="paid" disabled>Paid <Badge variant="secondary">Soon</Badge></SelectItem></SelectContent></Select><Select value={rating} onValueChange={value => { if (value) setRating(value as RatingFilter); }}><SelectTrigger aria-label="Filter or sort by rating" className="min-h-11"><SelectValue>{rating === 'any' ? 'Any rating' : rating === 'four' ? '4+ stars' : 'Sort by rating'}</SelectValue></SelectTrigger><SelectContent><SelectItem value="any">Any rating</SelectItem><SelectItem value="four">4+ stars</SelectItem><SelectItem value="sort">Sort by rating</SelectItem></SelectContent></Select></div>
    {state.status === 'loading' ? <LoadingCards /> : state.status === 'error' ? <p role="alert" className="text-sm text-muted">{state.message}</p> : matches.length === 0 ? <p className="text-sm text-muted">{search.trim() || price !== 'all' || rating !== 'any' ? 'No communities match your search.' : 'No public communities to discover yet.'}</p> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{matches.map(item => <Card key={item.tenantId} style={communityBrandStyle(item.brandColor)} className="community-brand-scope overflow-hidden border-t-4 border-t-[var(--brand-color)] bg-surface-raised p-0"><Button variant="ghost" onClick={() => setSelected(item)} className="h-auto w-full flex-col items-stretch gap-0 whitespace-normal p-0 text-left"><Cover url={item.coverUrl} name={item.name} /><CardContent className="flex flex-col gap-3 p-4"><div className="flex items-center gap-3"><CommunityAvatar name={item.name} logoUrl={item.logoUrl} /><h3 className="font-display text-lg font-semibold">{item.name}</h3></div><p className="line-clamp-3 text-sm text-body">{item.shortDescription}</p><div className="flex min-w-0 items-center gap-2 whitespace-nowrap text-xs text-muted"><span className="flex min-w-0 items-center gap-1"><Users size={16} className="shrink-0" aria-hidden="true" /><span className="truncate"> {item.memberCount.toLocaleString()} {item.memberCount === 1 ? 'member' : 'members'}</span></span><Rating listing={item} /><Badge className="ml-auto shrink-0 bg-[var(--brand-color)] text-[var(--brand-foreground)]">{priceLabel()}</Badge></div></CardContent></Button></Card>)}</div>}
    {showFooter && <HarvestFooter />}
  </section>;
}

export function CommunitiesView({ state, onEnter, onDiscover }: { state: LoadState<MemberCommunity[]>; onEnter: () => void; onDiscover: () => void }) {
  return <section className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-8"><div><h2 className="font-display text-3xl font-semibold">Your communities</h2><p className="mt-2 text-sm text-muted">Choose a community to enter.</p></div>
    {state.status === 'loading' ? <LoadingCards /> : state.status === 'error' ? <p role="alert" className="text-sm text-muted">{state.message}</p> : state.data.length === 0 ? <p className="text-sm text-muted">You have no communities yet.</p> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{state.data.map(item => <Card key={item.name} className="bg-surface-raised"><CardContent className="flex flex-col gap-4"><div className="flex items-center gap-3"><CommunityAvatar name={item.name} logoUrl={item.logoUrl} /><div><h3 className="font-display text-lg font-semibold">{item.name}</h3><Badge variant="secondary">Your community</Badge></div></div>{item.href ? <Button render={<a href={item.href} />} className="min-h-11">Open community</Button> : <Button className="min-h-11" onClick={onEnter}>Open community</Button>}</CardContent></Card>)}</div>}
    <Button variant="outline" className="min-h-11" onClick={onDiscover}>Discover communities</Button>
  </section>;
}
