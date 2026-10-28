'use client';

import { useState } from 'react';
import { Bell, ChevronDown, Home, MessageCircle, Search } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
export function MobileCommunitySections({ tabs, active }: { tabs: MobileTab[]; active: string }) {
  return <Tabs value={active} onValueChange={value => tabs.find(tab => tab.id === value)?.onClick()} className="w-full overflow-x-auto border-b border-line bg-surface-raised">
    <TabsList variant="line" className="h-auto min-w-max justify-start px-4">
      {tabs.map(tab => <TabsTrigger key={tab.id} value={tab.id} className="min-h-11 px-3">{tab.label}</TabsTrigger>)}
    </TabsList>
  </Tabs>;
}

export function MobileCommunityHeader({ name, logo, onSwitch, onSearch }: { name: string; logo: string; onSwitch: () => void; onSearch: () => void }) {
  return <div className="flex items-center justify-between border-b border-line bg-surface-raised px-4 pt-[env(safe-area-inset-top)]">
    <Button variant="ghost" className="min-h-11 min-w-0 justify-start gap-2" onClick={onSwitch} aria-label="Switch community"><Avatar className="size-8"><AvatarImage src={logo} alt="" /><AvatarFallback>{name.slice(0, 1)}</AvatarFallback></Avatar><span className="truncate font-display font-semibold">{name}</span><ChevronDown size={16} /></Button>
    <Button variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label="Search communities" onClick={onSearch}><Search size={20} /></Button>
  </div>;
}

export function MobileCommunityTabs({ onHome, onChat, onNotifications, onProfile, photo, initial, homeActive }: { onHome: () => void; onChat?: () => void; onNotifications: () => void; onProfile: () => void; photo?: string | null; initial: string; homeActive: boolean }) {
  return <>
    <Button variant="ghost" className="min-h-11 flex-1" aria-label="Home" aria-current={homeActive ? 'page' : undefined} onClick={onHome}><Home size={20} /></Button>
    {onChat && <Button variant="ghost" className="min-h-11 flex-1" aria-label="Messages" onClick={onChat}><MessageCircle size={20} /></Button>}
    <Button variant="ghost" className="min-h-11 flex-1" aria-label="Notification settings" onClick={onNotifications}><Bell size={20} /></Button>
    <Button variant="ghost" className="min-h-11 flex-1" aria-label="Profile menu" onClick={onProfile}><Avatar className="size-8"><AvatarImage src={photo || undefined} alt="" /><AvatarFallback>{initial}</AvatarFallback></Avatar></Button>
  </>;
}

export function MobileProfileSheet({ open, onOpenChange, isAdmin, onProfile, onAdmin }: { open: boolean; onOpenChange: (open: boolean) => void; isAdmin: boolean; onProfile: () => void; onAdmin: () => void }) {
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="bottom" className="pb-[calc(1rem+env(safe-area-inset-bottom))]"><SheetHeader><SheetTitle>Profile and settings</SheetTitle></SheetHeader>
    <Button variant="ghost" className="min-h-11 justify-start" onClick={() => { onOpenChange(false); onProfile(); }}>My profile and settings</Button>
    {isAdmin && <Button className="min-h-11" onClick={() => { onOpenChange(false); onAdmin(); }}>Admin dashboard</Button>}
  </SheetContent></Sheet>;
}
export function CommunitySwitcher({ open, onOpenChange, state, onEnter, onDiscover }: { open: boolean; onOpenChange: (open: boolean) => void; state: LoadState<MemberCommunity[]>; onEnter: () => void; onDiscover: () => void }) {
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))]"><SheetHeader><SheetTitle>Your communities</SheetTitle></SheetHeader>
    {state.status === 'loading' ? <p className="px-4">Loading communities…</p> : state.status === 'error' ? <p role="alert" className="px-4">{state.message}</p> : state.data.length === 0 ? <p className="px-4">You have no communities yet.</p> : state.data.map(item => item.href ? <a key={item.name} href={item.href} className="flex min-h-11 items-center gap-3 px-4"><Avatar><AvatarImage src={item.logoUrl} alt="" /><AvatarFallback>{item.name.slice(0, 1)}</AvatarFallback></Avatar>{item.name}</a> : <Button variant="ghost" key={item.name} className="flex min-h-11 items-center gap-3 px-4 text-left" onClick={() => { onOpenChange(false); onEnter(); }}><Avatar><AvatarImage src={item.logoUrl} alt="" /><AvatarFallback>{item.name.slice(0, 1)}</AvatarFallback></Avatar>{item.name}</Button>)}
    <Button variant="outline" className="mx-4 min-h-11" onClick={() => { onOpenChange(false); onDiscover(); }}>Discover communities</Button>
  </SheetContent></Sheet>;
}
