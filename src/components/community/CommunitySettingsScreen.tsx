'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/firebase';
import { readCommunitySettings, type CommunityModule, type CommunitySettings } from '@/lib/community/settings';
import { CommunitySettingsEditor } from './CommunitySettingsEditor';

export function CommunitySettingsScreen({ tenantId, available }: {
  tenantId: string | null;
  available: Record<CommunityModule, boolean>;
}) {
  const [settings, setSettings] = useState<CommunitySettings | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setSettings(null);
    setError('');
    if (!tenantId) { setError('Select a ministry to edit community settings.'); return; }
    return onSnapshot(doc(db, 'tenants', tenantId, 'settings', 'community'), snapshot => {
      try { setSettings(readCommunitySettings(snapshot.exists() ? snapshot.data() : undefined)); setError(''); }
      catch { setSettings(null); setError('Community settings are invalid.'); }
    }, () => { setSettings(null); setError('Could not load community settings.'); });
  }, [tenantId]);
  if (error) return <p role="alert" className="p-4">{error}</p>;
  if (!settings || !tenantId) return <p className="p-4">Loading community settings…</p>;
  return <><CommunitySettingsEditor key={tenantId} settings={settings} available={available}
    onSave={async (next, previous) => {
      const user = auth.currentUser;
      if (!user) throw new Error('Sign in to save community settings.');
      const token = await user.getIdToken();
      const response = await fetch('/api/community/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenantId, next, previous }),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Could not save community settings.');
      }
    }} /></>;
}
