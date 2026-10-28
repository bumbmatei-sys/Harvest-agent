'use client';

import { lazy, Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
const AdminUpgradePage = lazy(() => import('@/components/AdminUpgradePage'));
import { SignupPagesScreen } from '@/components/signup-pages/SignupPagesScreen';
import { CommunitiesData, DiscoverData } from './DiscoveryData';
import { FREE_MEMBER_TABS, MobileCommunityTabs } from './MobileCommunityNav';
import type { authFetch } from '@/utils/auth-fetch';

export function FreeMemberShell({ uid, tenantId, email, canCreateCommunity, initialTab = 'discover', request }: { uid?: string; tenantId?: string | null; email?: string | null; canCreateCommunity: boolean; initialTab?: string; request?: typeof authFetch }) {
  const [tab, setTab] = useState(initialTab);
  return <div className="flex min-h-dvh bg-surface text-foreground">
    <nav aria-label="Desktop navigation" className="hidden w-56 shrink-0 flex-col gap-2 border-r border-line bg-surface-raised p-4 lg:flex">
      <h1 className="mb-6 font-display text-xl">Harvest</h1>
      {FREE_MEMBER_TABS.map(({ id, label, icon: Icon }) => <Button key={id} variant={tab === id ? 'secondary' : 'ghost'} className="min-h-11 justify-start gap-3" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}><Icon size={20} />{label}</Button>)}
    </nav>
    <main className="min-w-0 flex-1 overflow-auto pb-24">
      {tab === 'discover' ? <DiscoverData /> : tab === 'communities' ? <>
        <CommunitiesData uid={uid} accountTenantId={tenantId} currentTenantId={null} onEnter={() => setTab('discover')} onDiscover={() => setTab('discover')} />
        {!canCreateCommunity && <Card className="mx-4 mb-6 sm:mx-8"><CardContent className="flex flex-wrap items-center gap-4 py-6"><p>Creating a community needs the Church or Ministry plan.</p><Button className="min-h-11" onClick={() => setTab('upgrade')}>Upgrade plan</Button></CardContent></Card>}
      </> : tab === 'signups' ? <div className="p-4 sm:p-8"><SignupPagesScreen request={request} /></div> : <Suspense fallback={<p>Loading upgrade options…</p>}><AdminUpgradePage currentPlan="free" tenantId={tenantId || undefined} email={email || undefined} onBack={() => setTab('communities')} /></Suspense>}
    </main>
    <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface-raised pb-[env(safe-area-inset-bottom)] lg:hidden"><MobileCommunityTabs freeTabs={{ active: tab, onSelect: setTab }} onHome={() => {}} onNotifications={() => {}} onProfile={() => {}} homeActive={false} initial="M" /></div>
  </div>;
}
