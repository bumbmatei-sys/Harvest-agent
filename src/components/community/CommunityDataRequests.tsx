'use client';
import { useState } from 'react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { auth, db } from '@/firebase';
import { Button } from '@/components/ui/button';
import { DeleteCommunityData } from './DeleteCommunityData';

/** Account access includes left memberships, which the community switcher omits. */
export function CommunityDataRequests() {
  const [rows, setRows] = useState<Array<{ tenantId: string; name: string }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <section className="space-y-3">
    <Button variant="outline" className="min-h-11 sm:min-h-0" disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try {
        const account = auth.currentUser;
        if (!account) throw new Error('Sign in to manage community data.');
        const memberships = await getDocs(collection(db, 'users', account.uid, 'memberships'));
        const data = await Promise.all(memberships.docs.map(async item => {
          const tenant = await getDoc(doc(db, 'tenants', item.id));
          if (!tenant.exists() || typeof tenant.data().name !== 'string') throw new Error('Could not load a community.');
          return { tenantId: item.id, name: tenant.data().name as string };
        }));
        setRows(data);
      } catch (error) { setError(error instanceof Error ? error.message : 'Could not load community data.'); }
      finally { setBusy(false); }
    }}>{busy ? 'Loading community data…' : 'Manage community data'}</Button>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {rows?.length === 0 && <p className="text-sm text-muted">No retained community memberships.</p>}
    {rows?.map(row => <div key={row.tenantId} className="space-y-2 rounded-lg border border-line p-3"><p>{row.name}</p><DeleteCommunityData tenantId={row.tenantId} onDeleted={() => setRows(previous => previous && previous.filter(item => item.tenantId !== row.tenantId))} /></div>)}
  </section>;
}
