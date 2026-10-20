'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EMAIL_TEMPLATES, type EmailTemplate } from '@/components/email/templates';
import { TAP } from '@/components/email/kit';

export function TemplatesDialog({ open, onOpenChange, onPick, hasContent }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (template: EmailTemplate) => void;
  hasContent: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Templates</DialogTitle>
          <DialogDescription>
            {hasContent ? 'Picking one replaces what you have written in the body.' : 'Start from a letter that is already half written.'}
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-3 sm:grid-cols-2">
          {EMAIL_TEMPLATES.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => { onPick(t); onOpenChange(false); }}
                className={`${TAP} flex h-full w-full flex-col gap-2 rounded-lg border border-line p-3 text-left hover:bg-muted`}
              >
                <span aria-hidden className="flex h-16 flex-col justify-center gap-1.5 rounded-md bg-surface-sunken px-3">
                  <span className="h-1.5 w-10 rounded bg-strong/70" />
                  <span className="h-1 w-full rounded bg-faint/40" />
                  <span className="h-1 w-2/3 rounded bg-faint/40" />
                </span>
                <span className="text-sm font-semibold text-strong">{t.name}</span>
                <span className="text-xs text-muted">{t.blurb}</span>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
