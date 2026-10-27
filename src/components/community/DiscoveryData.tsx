'use client';

import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '@/firebase';
import { isNonTenantSubdomain } from '@/utils/non-tenant-subdomains';
import { CommunitiesView, DiscoverView, type Listing, type LoadState, type MemberCommunity } from './DiscoveryViews';

function validSlug(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value) && !isNonTenantSubdomain(value);
}
function readListing(value: Record<string, unknown>): Listing {
  if (typeof value.tenantId !== 'string' || !value.tenantId || !validSlug(value.slug) || typeof value.name !== 'string' || !value.name.trim() || typeof value.logoUrl !== 'string' || typeof value.shortDescription !== 'string' || !Number.isSafeInteger(value.memberCount) || (value.memberCount as number) < 0) throw new Error('Invalid listing');
  if (value.logoUrl) { const url = new URL(value.logoUrl); if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid logo'); }
  return value as Listing;
}
export function DiscoverData() {
  const [state, setState] = useState<LoadState<Listing[]>>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    getDocs(collection(db, 'discovery_listings')).then(snapshot => {
      const data = snapshot.docs.map(item => readListing(item.data()));
      data.sort((a, b) => a.name.localeCompare(b.name));
      if (!cancelled) setState({ status: 'ready', data });
    }).catch(() => { if (!cancelled) setState({ status: 'error', message: 'Could not load communities. Please try again later.' }); });
    return () => { cancelled = true; };
  }, []);
  return <DiscoverView state={state} />;
}
export function CommunitiesData({ uid, currentTenantId, onEnter, onDiscover }: { uid?: string; currentTenantId: string | null; onEnter: () => void; onDiscover: () => void }) {
  const [state, setState] = useState<LoadState<MemberCommunity[]>>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!uid) return [];
      const user = await getDoc(doc(db, 'users', uid));
      if (!user.exists()) throw new Error('Missing account');
      const tenantId = user.data().tenantId;
      if (tenantId == null) return [];
      if (typeof tenantId !== 'string' || !tenantId || tenantId.includes('/')) throw new Error('Invalid account');
      const tenant = await getDoc(doc(db, 'tenants', tenantId));
      if (!tenant.exists()) throw new Error('Missing community');
      const data = tenant.data();
      if (typeof data.name !== 'string' || !data.name.trim() || !validSlug(data.subdomain)) throw new Error('Invalid community');
      return [{ name: data.name, logoUrl: typeof data.config?.logo === 'string' ? data.config.logo : undefined, href: tenantId === currentTenantId ? undefined : `https://${data.subdomain}.theharvest.app` }];
    }
    setState({ status: 'loading' });
    load().then(data => { if (!cancelled) setState({ status: 'ready', data }); }).catch(() => { if (!cancelled) setState({ status: 'error', message: 'Could not load your communities. Please try again later.' }); });
    return () => { cancelled = true; };
  }, [uid, currentTenantId]);
  return <CommunitiesView state={state} onEnter={onEnter} onDiscover={onDiscover} />;
}
