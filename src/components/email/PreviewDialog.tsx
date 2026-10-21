'use client';

import { useEffect, useState } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Segmented, ErrorNote } from '@/components/email/kit';
import type { DraftFields, EmailApi } from '@/components/email/email-api';
import { cn } from '@/lib/utils';

type Mode = 'computer' | 'phone' | 'dark';

/**
 * The exact HTML a recipient gets, rendered by the server's own renderer so the
 * preview cannot drift from a send. Sandboxed: the email never runs scripts.
 */
export function PreviewDialog({ open, onOpenChange, api, draft }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: Pick<EmailApi, 'preview'>;
  draft: DraftFields;
}) {
  const [mode, setMode] = useState<Mode>('computer');
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setHtml(null);
    setError(null);
    api.preview({ ...draft, dark: mode === 'dark' }).then(
      (h) => { if (live) setHtml(h); },
      (e: unknown) => { if (live) setError(e instanceof Error ? e.message : 'The preview could not be built.'); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, JSON.stringify(draft)]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] sm:max-w-3xl">
        <DialogHeader className="flex-row items-start justify-between gap-4">
          <div>
            <DialogTitle>Preview</DialogTitle>
            <DialogDescription>Filled in for a sample person named Alex.</DialogDescription>
          </div>
          <Segmented
            label="Preview as"
            value={mode}
            onChange={setMode}
            options={[{ value: 'computer', label: 'Computer' }, { value: 'phone', label: 'Phone' }, { value: 'dark', label: 'Dark' }]}
          />
        </DialogHeader>
        {error && <ErrorNote>{error}</ErrorNote>}
        {!error && html === null && <Skeleton className="h-[60vh] w-full" />}
        {html !== null && (
          <div className="flex justify-center overflow-auto rounded-lg bg-surface-sunken p-4">
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={html}
              className={cn('h-[60vh] rounded-md border border-line bg-white', mode === 'phone' ? 'w-[375px]' : 'w-full')}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
