'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EMAIL_TEMPLATES, type EmailTemplate } from '@/components/email/templates';
import { TemplateThumb } from '@/components/email/TemplateThumb';

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
              <Button
                type="button"
                variant="ghost"
                onClick={() => { onPick(t); onOpenChange(false); }}
                className="h-auto min-h-11 w-full flex-col items-stretch justify-start gap-2 whitespace-normal rounded-lg border-line p-3 text-left font-normal hover:bg-accent"
              >
                <TemplateThumb template={t} />
                <span className="text-sm font-semibold text-strong">{t.name}</span>
                <span className="text-xs text-muted">{t.blurb}</span>
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
