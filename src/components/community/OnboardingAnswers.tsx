'use client';

import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/firebase';
import { readCommunitySettings } from '@/lib/community/settings';

type Answer = { id: string; label: string; value: string };
export function OnboardingAnswers({ tenantId, uid }: { tenantId: string; uid: string }) {
  const [state, setState] = useState<{ key: string; answers: Answer[]; error: string | null } | null>(null);
  const key = `${tenantId}/${uid}`;
  useEffect(() => {
    let cancelled = false;
    setState(null);
    Promise.all([
      getDoc(doc(db, 'tenants', tenantId, 'communityMembers', uid)),
      getDoc(doc(db, 'tenants', tenantId, 'settings', 'community')),
    ]).then(([member, settingsDoc]) => {
      const settings = readCommunitySettings(settingsDoc.exists() ? settingsDoc.data() : undefined);
      const raw = member.exists() ? member.data().answers : {};
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.values(raw).some(value => typeof value !== 'string')) throw new Error('Invalid answers');
      const labels = new Map(settings.questions.items.map(q => [q.id, q.label]));
      const answers = Object.entries(raw as Record<string, string>).filter(([id]) => id !== '__community_questions_pending__' && id !== 'communityQuestionsPending').map(([id, value]) => ({ id, label: labels.get(id) || `Question ${id}`, value }));
      if (!cancelled) setState({ key, answers, error: null });
    }).catch(() => { if (!cancelled) setState({ key, answers: [], error: 'Could not load onboarding answers.' }); });
    return () => { cancelled = true; };
  }, [tenantId, uid, key]);
  return <section className="space-y-2 p-4" aria-label="Onboarding answers">
    <h3 className="font-semibold">Onboarding answers</h3>
    {!state || state.key !== key ? <p>Loading answers…</p> : state.error ? <p role="alert">{state.error}</p> : state.answers.length === 0 ? <p>No onboarding answers recorded.</p> : <dl className="space-y-2">{state.answers.map(answer => <div key={answer.id}><dt className="font-medium">{answer.label}</dt><dd>{answer.value || 'No answer'}</dd></div>)}</dl>}
  </section>;
}
