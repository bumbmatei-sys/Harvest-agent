'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot, runTransaction } from 'firebase/firestore';
import { db } from '@/firebase';
import { readCommunitySettings, type CommunityModule, type CommunitySettings } from '@/lib/community/settings';
import { CommunitySettingsEditor } from './CommunitySettingsEditor';

function settingsFingerprint(settings: CommunitySettings): string {
  return JSON.stringify([
    Object.keys(settings.modules).sort().map(key => [key, settings.modules[key as CommunityModule]]),
    settings.isPublic, settings.rules.enabled, settings.rules.items, settings.rules.version,
    settings.questions.enabled, settings.questions.items.map(q => [q.id, q.type, q.label, q.options, q.required]),
  ]);
}

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
    onSave={(next, previous) => runTransaction(db, async transaction => {
      const ref = doc(db, 'tenants', tenantId, 'settings', 'community');
      const snapshot = await transaction.get(ref);
      const current = readCommunitySettings(snapshot.exists() ? snapshot.data() : undefined);
      if (settingsFingerprint(current) !== settingsFingerprint(previous)) {
        throw new Error('Community settings changed elsewhere. Reload this page before saving.');
      }
      transaction.set(ref, next);
    })} /></>;
}
