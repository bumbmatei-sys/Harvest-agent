'use client';
import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { membershipRequest } from '@/lib/community/membership-request';

export function DeleteCommunityData({ tenantId, uid, onDeleted }: { tenantId: string; uid?: string; onDeleted: () => void | Promise<void> }) {
  const [access, setAccess] = useState<{ tenantId: string; uid: string; actorUid: string | undefined; owner: boolean; error?: string } | null>(null);
  const actorUid = auth.currentUser?.uid;
  const self = !uid || uid === actorUid;
  useEffect(() => {
    if (self || !uid) return;
    let cancelled = false;
    getDoc(doc(db, 'tenants', tenantId)).then(tenant => {
      if (!tenant.exists()) throw new Error('Community not found.');
      if (!cancelled) setAccess({ tenantId, uid, actorUid, owner: !!actorUid && tenant.data().ownerId === actorUid });
    }).catch(() => {
      if (!cancelled) setAccess({ tenantId, uid, actorUid, owner: false, error: 'Could not check community ownership. Reload to try again.' });
    });
    return () => { cancelled = true; };
  }, [tenantId, uid, actorUid, self]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const checked = access?.tenantId === tenantId && access.uid === uid && access.actorUid === actorUid;
  if (!self && (!checked || !access.owner)) {
    return checked && access.error ? <p role="alert" className="text-destructive">{access.error}</p> : null;
  }
  return <>
    <Button variant="outline" className="min-h-11 sm:min-h-0" onClick={() => { setError(''); setOpen(true); }}>Delete community contact data</Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent showCloseButton={!busy}>
        <DialogTitle>Delete community contact data?</DialogTitle>
        <DialogDescription>This ends community membership and deletes the CRM contact, its activity history and onboarding answers. Financial records, your account and other communities remain. A minimal record keeps community access and email blocked.</DialogDescription>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <Button variant="outline" className="min-h-11 sm:min-h-0" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="destructive" className="min-h-11 sm:min-h-0" disabled={busy} onClick={async () => {
          setBusy(true); setError('');
          try {
            await membershipRequest('delete-data', { tenantId, ...(uid ? { uid } : {}) });
            await onDeleted(); setOpen(false);
          } catch (error) { setError(error instanceof Error ? error.message : 'Could not delete community contact data.'); }
          finally { setBusy(false); }
        }}>{busy ? 'Deleting…' : 'Confirm data deletion'}</Button>
      </DialogContent>
    </Dialog>
  </>;
}
