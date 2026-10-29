'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { loadUserCommunityIds } from '@/lib/community/use-community';
import { auth, db } from '@/firebase';
import { readPublicListing } from '@/lib/community/public-listing';
import { canonicalPlanId } from '@/utils/plan-id';
import { isNonTenantSubdomain } from '@/utils/non-tenant-subdomains';
import { CommunitySwitcher } from './MobileCommunityNav';
import { CommunitiesView, DiscoverView, type Listing, type LoadState, type MemberCommunity } from './DiscoveryViews';

function validSlug(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value) && !isNonTenantSubdomain(value);
}
export function DiscoverData({ currentTenantId }: { currentTenantId?: string | null }) {
  const member = useMemo(() => currentTenantId ? { tenantId: currentTenantId, getToken: async () => { const user = auth.currentUser; if (!user) throw new Error('Sign in to review.'); return user.getIdToken(); } } : undefined, [currentTenantId]);
  const [state, setState] = useState<LoadState<Listing[]>>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    getDocs(collection(db, 'discovery_listings')).then(snapshot => {
      const data = snapshot.docs.map(item => readPublicListing(item.data()));
      data.sort((a, b) => a.name.localeCompare(b.name));
      if (!cancelled) setState({ status: 'ready', data });
    }).catch(() => { if (!cancelled) setState({ status: 'error', message: 'Could not load communities. Please try again later.' }); });
    return () => { cancelled = true; };
  }, []);
  return <DiscoverView state={state} member={member} />;
}
export function CommunitiesData({ uid, currentTenantId, onEnter, onDiscover, switcher }: { uid?: string; currentTenantId: string | null; onEnter: () => void; onDiscover: () => void; switcher?: { open: boolean; onOpenChange: (open: boolean) => void } }) {
  const [state, setState] = useState<LoadState<MemberCommunity[]>>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!uid) return [];
      const ids = await loadUserCommunityIds(uid);
      const communities = await Promise.all(ids.map(async tenantId => {
        const tenant = await getDoc(doc(db, 'tenants', tenantId));
        if (!tenant.exists()) throw new Error('Missing community');
        const data = tenant.data();
        // Free provisioning creates a personal workspace, without a community
        // subdomain. It must not turn an otherwise valid joined list into an error.
        if (canonicalPlanId(data.plan) === 'free' && data.ownerId === uid && data.subdomain == null) return null;
        if (typeof data.name !== 'string' || !data.name.trim() || !validSlug(data.subdomain)) throw new Error('Invalid community');
        return { name: data.name, logoUrl: typeof data.config?.logo === 'string' ? data.config.logo : undefined, href: tenantId === currentTenantId ? undefined : `https://${data.subdomain}.theharvest.app` };
      }));
      return communities.filter((community): community is NonNullable<typeof community> => community !== null);
    }
    setState({ status: 'loading' });
    load().then(data => { if (!cancelled) setState({ status: 'ready', data }); }).catch(() => { if (!cancelled) setState({ status: 'error', message: 'Could not load your communities. Please try again later.' }); });
    return () => { cancelled = true; };
  }, [uid, currentTenantId]);
  if (switcher) return <CommunitySwitcher {...switcher} state={state} onEnter={onEnter} onDiscover={onDiscover} />;
  return <CommunitiesView state={state} onEnter={onEnter} onDiscover={onDiscover} />;
}
