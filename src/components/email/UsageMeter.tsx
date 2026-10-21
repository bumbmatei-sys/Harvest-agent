'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import type { Usage } from '@/components/email/email-api';
import { formatDay } from '@/components/email/kit';

/** "Add more emails" and its dialog. Checkout is not built; this says so plainly. */
export function AddEmailsDialog({ open, onOpenChange, usage }: { open: boolean; onOpenChange: (open: boolean) => void; usage: Usage }) {
  const { pack } = usage;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add more emails</DialogTitle>
          <DialogDescription>
            Extra email packs add {pack.size.toLocaleString()} emails{pack.priceUsd != null ? ` for $${pack.priceUsd.toLocaleString()}` : ''}. Buying a pack is not available yet.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted">
          Your {usage.cap.toLocaleString()} emails come back on {formatDay(usage.resetsAt)}. Until then, sends that would go over are held back so nothing is half-sent.
        </p>
        <DialogFooter className="border-line">
          <Button className="min-h-11" onClick={() => onOpenChange(false)}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "X of Y emails used this month". Turns to a warning at the configured level
 * and offers "Add more emails" from there. Contacts are not part of it:
 * only emails sent are counted.
 */
export function UsageMeter({ usage, compact = false }: { usage: Usage; compact?: boolean }) {
  const [adding, setAdding] = useState(false);
  if (usage.cap === 0) return <p className="text-sm text-muted">Email sending is not included in your plan.</p>;
  const atCap = usage.used >= usage.cap;
  return (
    <div className="flex flex-col gap-2" data-usage-meter data-warn={usage.warn || atCap}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-strong">{usage.used.toLocaleString()} of {usage.cap.toLocaleString()} emails used this month</span>
        <span className={usage.warn || atCap ? 'font-medium text-danger' : 'text-muted'}>{usage.percent}%</span>
      </div>
      <Progress value={usage.percent} aria-label="Emails used this month" />
      {(usage.warn || atCap) && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-lg bg-surface-gold px-3 py-2 text-sm text-strong" data-usage-warning>
          <span>
            {atCap
              ? `You have used this month's emails. New sends are blocked until ${formatDay(usage.resetsAt)}.`
              : `You have used ${usage.percent}% of this month's emails.`}
          </span>
          <Button variant="ghost" size="sm" className="min-h-11 font-semibold" onClick={() => setAdding(true)}>Add more emails</Button>
        </div>
      )}
      {!compact && <p className="text-xs text-faint">Resets {formatDay(usage.resetsAt)}. There is no limit on how many people are on your list.</p>}
      {usage.daily && (
        <p className="text-xs text-muted" data-daily-meter>
          New ministries can send {usage.daily.cap.toLocaleString()} emails a day for their first {usage.daily.days} days. {usage.daily.used.toLocaleString()} sent today.
        </p>
      )}
      <AddEmailsDialog open={adding} onOpenChange={setAdding} usage={usage} />
    </div>
  );
}
