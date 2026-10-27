'use client';

import { useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

export type Listing = { tenantId: string; name: string; slug: string; logoUrl: string; shortDescription: string; memberCount: number };
export type LoadState<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };
export type MemberCommunity = { name: string; logoUrl?: string; href?: string };

function CommunityAvatar({ name, logoUrl }: { name: string; logoUrl?: string }) {
  return <Avatar className="size-12 rounded-xl"><AvatarImage src={logoUrl || undefined} alt="" /><AvatarFallback className="rounded-xl">{name.trim().slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>;
}
function LoadingCards() { return <div aria-label="Loading communities" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}</div>; }

export function DiscoverView({ state }: { state: LoadState<Listing[]> }) {
  const [search, setSearch] = useState('');
  const matches = state.status === 'ready' ? state.data.filter(item => `${item.name} ${item.shortDescription}`.toLowerCase().includes(search.trim().toLowerCase())) : [];
  return <section className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-8"><div><h2 className="font-display text-3xl font-semibold">Discover communities</h2><p className="mt-2 text-sm text-muted">Find a community to connect with.</p></div>
    <Input aria-label="Search communities" placeholder="Search communities" value={search} onChange={event => setSearch(event.target.value)} className="min-h-11 max-w-xl" />
    {state.status === 'loading' ? <LoadingCards /> : state.status === 'error' ? <p role="alert" className="text-sm text-muted">{state.message}</p> : matches.length === 0 ? <p className="text-sm text-muted">{search.trim() ? 'No communities match your search.' : 'No public communities to discover yet.'}</p> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{matches.map(item => <Card key={item.tenantId} className="bg-surface-raised"><CardContent className="flex h-full flex-col gap-4"><div className="flex items-center gap-3"><CommunityAvatar name={item.name} logoUrl={item.logoUrl} /><div><h3 className="font-display text-lg font-semibold">{item.name}</h3><Badge variant="secondary">{item.memberCount.toLocaleString()} {item.memberCount === 1 ? 'member' : 'members'} at listing</Badge></div></div><p className="flex-1 text-sm text-muted">{item.shortDescription}</p><Button render={<a href={`https://${item.slug}.theharvest.app`} />} className="min-h-11 w-full">Join {item.name}</Button></CardContent></Card>)}</div>}
  </section>;
}

export function CommunitiesView({ state, onEnter, onDiscover }: { state: LoadState<MemberCommunity[]>; onEnter: () => void; onDiscover: () => void }) {
  return <section className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-8"><div><h2 className="font-display text-3xl font-semibold">Your communities</h2><p className="mt-2 text-sm text-muted">Choose a community to enter.</p></div>
    {state.status === 'loading' ? <LoadingCards /> : state.status === 'error' ? <p role="alert" className="text-sm text-muted">{state.message}</p> : state.data.length === 0 ? <p className="text-sm text-muted">You have no communities yet.</p> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{state.data.map(item => <Card key={item.name} className="bg-surface-raised"><CardContent className="flex flex-col gap-4"><div className="flex items-center gap-3"><CommunityAvatar name={item.name} logoUrl={item.logoUrl} /><div><h3 className="font-display text-lg font-semibold">{item.name}</h3><Badge variant="secondary">Your community</Badge></div></div>{item.href ? <Button render={<a href={item.href} />} className="min-h-11">Open community</Button> : <Button className="min-h-11" onClick={onEnter}>Open community</Button>}</CardContent></Card>)}</div>}
    <Button variant="outline" className="min-h-11" onClick={onDiscover}>Discover communities</Button>
  </section>;
}
