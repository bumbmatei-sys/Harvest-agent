'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/firebase';
import { defaultCommunitySettings, readCommunitySettings, type CommunitySettings } from './settings';

type MemberEntry = { rulesAcceptedVersion: number; answers: Record<string, string>; answeredAt: unknown };

type SettingsState = { tenantId: string | null; settings: CommunitySettings; loading: boolean; error: string | null };
export function useCommunitySettings(tenantId: string | null): SettingsState {
  const [state, setState] = useState<SettingsState>(() => ({ tenantId, settings: defaultCommunitySettings(), loading: !!tenantId, error: null }));
  useEffect(() => {
    setState({ tenantId, settings: defaultCommunitySettings(), loading: !!tenantId, error: null });
    if (!tenantId) return;
    return onSnapshot(doc(db, 'tenants', tenantId, 'settings', 'community'), snapshot => {
      try { setState({ tenantId, settings: readCommunitySettings(snapshot.exists() ? snapshot.data() : undefined), loading: false, error: null }); }
      catch (error) { console.error('Invalid community settings:', error); setState({ tenantId, settings: defaultCommunitySettings(), loading: false, error: 'Community settings are invalid.' }); }
    }, error => { console.error('Could not load community settings:', error); setState({ tenantId, settings: defaultCommunitySettings(), loading: false, error: 'Could not load community settings.' }); });
  }, [tenantId]);
  return state.tenantId === tenantId ? state : { tenantId, settings: defaultCommunitySettings(), loading: !!tenantId, error: null };
}

export function useCommunityMember(tenantId: string | null, uid: string | undefined, enabled: boolean) {
  const key = enabled && tenantId && uid ? `${tenantId}/${uid}` : null;
  const [state, setState] = useState<{ key: string | null; member: MemberEntry | null; loading: boolean; error: string | null }>({ key: null, member: null, loading: false, error: null });
  useEffect(() => {
    setState({ key, member: null, loading: !!key, error: null });
    if (!key || !tenantId || !uid) return;
    return onSnapshot(doc(db, 'tenants', tenantId, 'communityMembers', uid), snapshot => {
      if (!snapshot.exists()) { setState({ key, member: null, loading: false, error: null }); return; }
      const data = snapshot.data();
      if (!Number.isSafeInteger(data.rulesAcceptedVersion) || data.rulesAcceptedVersion < 0 || !data.answers || typeof data.answers !== 'object' || Array.isArray(data.answers) || Object.values(data.answers).some(value => typeof value !== 'string') || !data.answeredAt) {
        setState({ key, member: null, loading: false, error: 'Community entry record is invalid.' }); return;
      }
      setState({ key, member: data as MemberEntry, loading: false, error: null });
    }, () => setState({ key, member: null, loading: false, error: 'Could not load your community entry.' }));
  }, [key, tenantId, uid]);
  const current = state.key === key ? state : { key, member: null, loading: !!key, error: null };
  const save = async (settings: CommunitySettings, answers: Record<string, string>) => {
    if (!tenantId || !uid) throw new Error('Missing community member');
    const submittedAnswers = { ...answers };
    delete submittedAnswers.__community_questions_pending__;
    await setDoc(doc(db, 'tenants', tenantId, 'communityMembers', uid), {
      rulesAcceptedVersion: settings.rules.enabled ? settings.rules.version : (current.member?.rulesAcceptedVersion ?? 0),
      answers: settings.questions.enabled ? submittedAnswers : (current.member?.answers ?? { __community_questions_pending__: 'true' }),
      answeredAt: serverTimestamp(),
    });
  };
  return { ...current, save };
}
