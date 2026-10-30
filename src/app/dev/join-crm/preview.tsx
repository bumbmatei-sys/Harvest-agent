'use client';
import { useEffect, useState } from 'react';
import { applyTheme, readStoredChoice } from '@/lib/theme-runtime';
import { DiscoverView, CommunitiesView } from '@/components/community/DiscoveryViews';
import { CommunityEntryDialog } from '@/components/community/CommunityEntryDialog';
import { CommunityContactBadge } from '@/components/community/CommunityContactBadge';
import { LeaveCommunity } from '@/components/community/LeaveCommunity';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { defaultCommunitySettings } from '@/lib/community/settings';
import { communityJoinPath, communitySignupPath } from '@/lib/community/navigation';

const settings = { ...defaultCommunitySettings(), isPublic: true,
  rules: { enabled: true, version: 1, items: ['Treat every person with kindness and respect.', 'Keep conversations thoughtful and protect each other’s privacy.'] },
  questions: { enabled: true, items: [{ id: 'goal', type: 'short' as const, label: 'What brings you to our community?', options: [], required: true }] },
};
const listings = [{ tenantId: 'mock-grace', slug: 'mock-grace', name: 'Grace Collective', logoUrl: '', shortDescription: 'A place to grow in faith, build friendships and serve together.', memberCount: 128, ownerName: 'Alex Morgan' }];
const contact = { source: 'community', communitySource: 'discover' as const, communityStatus: 'left' as const, communityLeftAt: '2020-01-02T12:00:00Z' };
export function JoinCRMPreview({ view = 'discover', theme }: { view?: string; theme?: string }) {
  const [done, setDone] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  useEffect(() => {
    const previous = readStoredChoice();
    applyTheme(theme === 'dark' ? 'dark' : 'light');
    return () => { applyTheme(previous); };
  }, [theme]);
  return <main className="min-h-dvh bg-surface text-strong">
    <header className="flex items-center justify-between border-b border-line bg-surface-raised p-4"><span className="font-display text-xl">Harvest</span><span className="text-sm text-muted">Community preview</span></header>
    {view === 'discover' ? <DiscoverView state={{ status: 'ready', data: listings }} reviews={<p>No reviews yet.</p>} onJoin={() => setConsentOpen(true)} /> : view === 'crm-contact' ? <Card className="mx-auto mt-8 max-w-2xl"><CardContent className="space-y-4 p-6"><p className="text-sm text-muted">Contact</p><h1 className="font-display text-3xl">Jordan Ellis</h1><p>jordan@example.org</p><CommunityContactBadge contact={contact} /><p className="text-sm text-muted">Joined from Discover. The contact stays in your CRM after leaving.</p></CardContent></Card> : <>
      <CommunitiesView state={{ status: 'ready', data: done ? [] : [{ name: 'Grace Collective' }] }} onEnter={() => {}} onDiscover={() => {}} />
      {(view === 'member' || view === 'leave') && !done && <div className="mx-auto max-w-6xl px-4 sm:px-8"><LeaveCommunity name="Grace Collective" initiallyOpen={view === 'leave'} onLeave={async () => { setDone(true); }} /></div>}
      {view === 'signup-return' && <Card className="mx-auto max-w-lg"><CardContent className="space-y-3 p-6"><h1 className="font-display text-2xl">Your free account is ready</h1><p>Return to Grace Collective to join.</p><Button className="min-h-11" onClick={() => setDone(false)}>Continue to community</Button><p className="break-all text-xs text-muted">{communitySignupPath(communityJoinPath('mock-grace', 'website'))}</p></CardContent></Card>}
      {(view === 'consent' || view === 'signup-return') && !done && <CommunityEntryDialog joining communityName="Grace Collective" settings={settings} onSubmit={async () => { setDone(true); }} onCancel={() => setDone(true)} />}
    </>}
    {view === 'discover' && consentOpen && <CommunityEntryDialog joining communityName="Grace Collective" settings={settings} onSubmit={async () => { setDone(true); setConsentOpen(false); }} onCancel={() => setConsentOpen(false)} />}
    {done && <p role="status" className="p-6">{view === 'leave' || view === 'member' ? 'You have left Grace Collective.' : 'You have joined Grace Collective.'}</p>}
  </main>;
}
