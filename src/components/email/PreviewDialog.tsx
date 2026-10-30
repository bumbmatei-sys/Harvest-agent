'use client';

import { useEffect, useState } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Segmented, ErrorNote, EmailDialogClose } from '@/components/email/kit';
import { ThemeWarning } from '@/components/email/ThemeWarning';
import type { DraftFields, EmailApi } from '@/components/email/email-api';
import { getThemePreset } from '@/lib/email/themes';
import { cn } from '@/lib/utils';

type Mode = 'computer' | 'phone' | 'dark';

/**
 * The exact HTML a recipient gets, rendered by the server's own renderer so the
 * preview cannot drift from a send. Sandboxed: the email never runs scripts.
 */
export function PreviewDialog({ open, onOpenChange, api, draft, initialMode = 'computer' }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: Pick<EmailApi, 'preview'>;
  draft: DraftFields;
  /** The mode shown on first mount, including in the screenshot harness. */
  initialMode?: Mode;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The tokens this draft renders with, for the contrast banner above the
  // frame. A draft that carries only a theme id still warns from that theme's
  // own colours; a classic draft has no tokens and no substitutions to report.
  const warningTokens = draft.themeTokens
    ?? (draft.themeId ? getThemePreset(draft.themeId)?.tokens ?? null : null);

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
      <DialogContent showCloseButton={false} className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <EmailDialogClose />
        <DialogHeader className="shrink-0 gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-5 sm:pr-16">
          <div className="pr-10 sm:pr-0">
            <DialogTitle className="font-sans text-sm font-semibold leading-6">Preview</DialogTitle>
            <DialogDescription className="text-xs leading-5">Filled in for a sample person named Alex.</DialogDescription>
          </div>
          <div className="w-fit [&_[data-slot=toggle-group-item]]:px-3 [&_[data-slot=toggle-group-item]]:text-xs">
            <Segmented
              label="Preview as"
              value={mode}
              onChange={setMode}
              options={[{ value: 'computer', label: 'Computer' }, { value: 'phone', label: 'Phone' }, { value: 'dark', label: 'Dark' }]}
            />
          </div>
        </DialogHeader>
        <ThemeWarning tokens={warningTokens} className="mx-4 mt-4 w-auto shrink-0" />
        {error && <div className="p-4"><ErrorNote>{error}</ErrorNote></div>}
        {!error && html === null && <Skeleton className="m-4 h-[60vh]" />}
        {html !== null && (
          <div className={cn('flex min-h-0 justify-center overflow-auto p-2 sm:p-6', mode === 'dark' ? 'bg-surface-night' : 'bg-surface-sunken')}>
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={html}
              className={cn('h-[65dvh] max-w-full shrink-0 bg-card shadow-xs sm:h-[68dvh]', mode === 'phone' ? 'w-[375px] rounded-[24px] border-[6px] border-surface-night shadow-lg' : 'w-full rounded-lg border border-line')}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
