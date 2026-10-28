'use client';

import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { CommunityModule } from '@/lib/community/settings';
import type { LoadState, MemberCommunity } from './DiscoveryViews';

export type MobileTab = { id: string; label: string; icon: React.ElementType; onClick: () => void; active: boolean };
const tabModules: Record<string, CommunityModule> = { news: 'news', blog: 'blog', courses: 'courses', events: 'events', messages: 'messages', prayer: 'prayer', partner: 'give', livestream: 'livestream', bible: 'bible', map: 'map' };
export function enabledMobileTabs<T extends { id: string }>(tabs: T[], modules: Record<CommunityModule, boolean>): T[] {
  return tabs.filter(tab => !tabModules[tab.id] || modules[tabModules[tab.id]]);
}
export function splitMobileTabs<T>(tabs: T[]): { primary: T[]; overflow: T[] } {
  return tabs.length > 5 ? { primary: tabs.slice(0, 4), overflow: tabs.slice(4) } : { primary: tabs, overflow: [] };
}
export function MobileCommunityTabs({ tabs }: { tabs: MobileTab[] }) {
  const [open, setOpen] = useState(false);
  const { primary, overflow } = splitMobileTabs(tabs);
  return <>
    {primary.map(({ id, label, icon: Icon, onClick, active }) => <Button variant="ghost" key={id} type="button" onClick={onClick} aria-current={active ? 'page' : undefined} className="flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-xs text-muted aria-[current=page]:text-[var(--brand-color)]"><Icon size={20} /><span className="truncate">{label}</span></Button>)}
    {overflow.length > 0 && <><Button variant="ghost" type="button" onClick={() => setOpen(true)} className="flex min-h-11 flex-1 flex-col items-center justify-center gap-1 text-xs text-muted"><MoreHorizontal size={20} />More</Button><Sheet open={open} onOpenChange={setOpen}><SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))]"><SheetHeader><SheetTitle>More</SheetTitle></SheetHeader>{overflow.map(({ id, label, icon: Icon, onClick }) => <Button key={id} variant="ghost" className="min-h-11 justify-start" onClick={() => { setOpen(false); onClick(); }}><Icon size={20} />{label}</Button>)}</SheetContent></Sheet></>}
  </>;
}
export function CommunitySwitcher({ open, onOpenChange, state, onEnter, onDiscover }: { open: boolean; onOpenChange: (open: boolean) => void; state: LoadState<MemberCommunity[]>; onEnter: () => void; onDiscover: () => void }) {
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))]"><SheetHeader><SheetTitle>Your communities</SheetTitle></SheetHeader>
    {state.status === 'loading' ? <p className="px-4">Loading communities…</p> : state.status === 'error' ? <p role="alert" className="px-4">{state.message}</p> : state.data.length === 0 ? <p className="px-4">You have no communities yet.</p> : state.data.map(item => item.href ? <a key={item.name} href={item.href} className="flex min-h-11 items-center gap-3 px-4"><Avatar><AvatarImage src={item.logoUrl} alt="" /><AvatarFallback>{item.name.slice(0, 1)}</AvatarFallback></Avatar>{item.name}</a> : <Button variant="ghost" key={item.name} className="flex min-h-11 items-center gap-3 px-4 text-left" onClick={() => { onOpenChange(false); onEnter(); }}><Avatar><AvatarImage src={item.logoUrl} alt="" /><AvatarFallback>{item.name.slice(0, 1)}</AvatarFallback></Avatar>{item.name}</Button>)}
    <Button variant="outline" className="mx-4 min-h-11" onClick={() => { onOpenChange(false); onDiscover(); }}>Discover communities</Button>
  </SheetContent></Sheet>;
}
