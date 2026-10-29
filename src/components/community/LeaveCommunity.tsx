'use client';
import { useState } from 'react';
import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Button } from '@/components/ui/button';

/** Uses the installed Base UI AlertDialog with the shared shadcn Button. */
export function LeaveCommunity({ name, onLeave, isAdmin = false, initiallyOpen = false }: {
  name: string; onLeave: () => Promise<void>; isAdmin?: boolean; initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  if (isAdmin) return null;
  const leave = async () => {
    setSaving(true); setError('');
    try { await onLeave(); setOpen(false); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not leave community. Please try again.'); }
    finally { setSaving(false); }
  };
  return <AlertDialog.Root open={open} onOpenChange={value => { if (!saving) { setOpen(value); setError(''); } }}>
    <AlertDialog.Trigger render={<Button variant="ghost" className="min-h-11" />}>Leave community</AlertDialog.Trigger>
    <AlertDialog.Portal><AlertDialog.Backdrop className="fixed inset-0 z-[101] bg-background/80" />
      <AlertDialog.Popup className="fixed left-1/2 top-1/2 z-[102] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-xl border border-line bg-surface-raised p-6 text-strong shadow-lg">
        <AlertDialog.Title className="font-display text-xl font-semibold">Leave {name}?</AlertDialog.Title>
        <AlertDialog.Description className="text-sm text-body">You will lose access to this community. The owner keeps your contact record and the date you left.</AlertDialog.Description>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><AlertDialog.Close render={<Button variant="outline" className="min-h-11" disabled={saving} />}>Cancel</AlertDialog.Close><Button className="min-h-11" disabled={saving} onClick={leave}>{saving ? 'Leaving…' : 'Confirm leave'}</Button></div>
      </AlertDialog.Popup>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
}
