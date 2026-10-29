'use client';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/firebase';
import { TenantProvider } from '@/contexts/TenantContext';
import { useAppStore } from '@/store/useAppStore';
import { COMMUNITY_CONSENT_VERSION, isActiveMember, isCommunityTenantId } from '@/lib/community-membership';
import { readCommunitySettings, type CommunitySettings } from '@/lib/community/settings';
import { communityHref, communityPath, communitySource } from '@/lib/community/navigation';
import { membershipRequest } from '@/lib/community/membership-request';
import { isTenantAdminRole } from '@/lib/roles';
import { checkRosterAdminStatus } from '@/utils/tenant.utils';
import MainApp from '@/components/MainApp';
import { Button } from '@/components/ui/button';
import { CommunityEntryDialog } from './CommunityEntryDialog';
import { LeaveCommunity } from './LeaveCommunity';

type PageState = { name: string; settings: CommunitySettings; active: boolean; alreadyMember: boolean; isAdmin: boolean };
export function CommunityMemberPage() {
  const { tenantId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser } = useAppStore();
  const [state, setState] = useState<PageState | null>(null);
  const [error, setError] = useState('');
  const [entering, setEntering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const joining = new URLSearchParams(location.search).get('join') === '1';
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    setState(null); setError('');
    if (!isCommunityTenantId(tenantId) || !currentUser) return;
    const account = auth.currentUser;
    if (!account) { setError('Sign in to join this community.'); return; }
    const centralPath = communityHref(`${location.pathname}${location.search}`);
    if (centralPath.startsWith('https://')) { window.location.replace(centralPath); return; }
    const uid = currentUser.uid;
    const memberRef = doc(db, 'tenants', tenantId, 'communityMembers', uid);
    Promise.all([
      getDoc(doc(db, 'tenants', tenantId)), getDoc(doc(db, 'users', uid)),
      getDoc(memberRef), getDoc(doc(db, 'tenants', tenantId, 'settings', 'community')),
      checkRosterAdminStatus(tenantId), account.getIdTokenResult(),
    ]).then(([tenant, person, member, settingsDoc, roster, token]) => {
      if (cancelled) return;
      if (!tenant.exists() || typeof tenant.data().name !== 'string') throw new Error('Community not found.');
      if (roster === 'error') throw new Error('Could not check community permissions. Please try again.');
      const profile = person.data();
      const active = isActiveMember(member.data(), profile, tenantId);
      const isAdmin = tenant.data().ownerId === uid || roster === 'admin' ||
        (profile?.tenantId === tenantId && isTenantAdminRole(profile.role)) ||
        (token.claims.tenantId === tenantId && token.claims.admin === true);
      setState({ name: tenant.data().name, settings: readCommunitySettings(settingsDoc.data()), active, alreadyMember: active, isAdmin });
      unsubscribe = onSnapshot(memberRef, snapshot => {
        if (!cancelled) setState(previous => previous && { ...previous, active: isActiveMember(snapshot.data(), profile, tenantId) });
      }, () => { if (!cancelled) setError('Could not load your community membership.'); });
    }).catch(error => { if (!cancelled) setError(error instanceof Error ? error.message : 'Could not load community.'); });
    return () => { cancelled = true; unsubscribe?.(); };
  }, [tenantId, currentUser?.uid]);
  if (!isCommunityTenantId(tenantId)) return <p role="alert">Community not found.</p>;
  if (error) return <div className="space-y-4 p-6"><p role="alert">{error}</p><Button className="min-h-11" onClick={() => window.location.reload()}>Try again</Button></div>;
  if (!state) return <p role="status" className="p-6">Loading community…</p>;
  const enter = () => { setEntering(true); navigate(communityPath(tenantId), { replace: true }); };
  const join = async (answers?: Record<string, string>) => {
    await membershipRequest('join', { tenantId, source: communitySource(location.search), consent: true, acceptedConsentVersion: COMMUNITY_CONSENT_VERSION,
      ...(state.settings.rules.enabled ? { rulesAcceptedVersion: state.settings.rules.version } : {}),
      ...(answers ? { answers } : {}),
    });
    setState(previous => previous && { ...previous, active: true });
    enter();
  };
  if (joining && !entering && state.alreadyMember) return <section className="mx-auto max-w-lg space-y-4 p-6"><h1 className="font-display text-2xl">{state.name}</h1><p>You are already a member of this community.</p><Button className="min-h-11" disabled={saving} onClick={async () => { setSaving(true); try { await join(); } catch (error) { setError(error instanceof Error ? error.message : 'Could not enter community.'); } finally { setSaving(false); } }}>{saving ? 'Opening…' : 'Open community'}</Button></section>;
  if ((joining && !entering) || (!state.active && !leaving)) return <>
    <div className="p-6"><h1 className="font-display text-2xl">{state.name}</h1><p>Join to access this community.</p></div>
    <CommunityEntryDialog key={tenantId} joining communityName={state.name} logoUrl={state.settings.logoUrl} settings={state.settings} onSubmit={join} onCancel={() => navigate('/')} />
  </>;
  return <TenantProvider key={tenantId} initialTenantId={tenantId}>
    <div className="flex items-center justify-between border-b border-line bg-surface-raised px-4"><Button variant="ghost" className="min-h-11" onClick={() => navigate('/?communities=1')}>Your communities</Button><LeaveCommunity name={state.name} isAdmin={state.isAdmin} onLeave={async () => { setLeaving(true); await membershipRequest('leave', { tenantId }); setState(previous => previous && { ...previous, active: false }); navigate('/?communities=1', { replace: true }); }} /></div>
    {leaving ? <p role="status" className="p-6">{state.active ? 'Complete your leave request below.' : 'Your community access has ended. Complete your leave request below.'}</p> : <MainApp accountTenantId={null} onNavigate={page => navigate(page === 'home' ? communityPath(tenantId) : `/${page}`)} />}
  </TenantProvider>;
}
