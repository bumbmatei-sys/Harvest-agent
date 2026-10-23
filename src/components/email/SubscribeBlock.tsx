'use client';

import { useId, useState, type FormEvent } from 'react';
import { Mail } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export const SUBSCRIBE_ENDPOINT = '/api/email/subscribe';

export type SubscribeSubmit = (input: { name: string; email: string; website: string }) => Promise<{ ok: true } | { ok: false; message: string }>;

/** Posts to the public subscribe endpoint. The ministry is the host the page is served from. */
export const postSubscribe: SubscribeSubmit = async (input) => {
  try {
    const response = await fetch(SUBSCRIBE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (response.ok) return { ok: true };
    const body = await response.json().catch(() => ({}));
    return { ok: false, message: typeof body?.error === 'string' ? body.error : 'We could not sign you up. Please try again.' };
  } catch {
    return { ok: false, message: 'We could not reach the server. Check your connection and try again.' };
  }
};

type Phase = 'idle' | 'sending' | 'done';

/**
 * The newsletter sign-up form: a name, an address, one button. It is the same
 * form on the public subscribe page and anywhere a page template wants one.
 * Signing up sends a confirmation email; the person is subscribed when they
 * open its link, and the "done" message says exactly that.
 */
export function SubscribeForm({
  onSubmit = postSubscribe,
  buttonLabel = 'Subscribe',
  className,
}: {
  onSubmit?: SubscribeSubmit;
  buttonLabel?: string;
  className?: string;
}) {
  const uid = useId();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (phase === 'sending') return;
    setPhase('sending');
    setError(null);
    const result = await onSubmit({ name, email, website });
    if (result.ok) {
      setPhase('done');
    } else {
      setPhase('idle');
      setError(result.message);
    }
  }

  if (phase === 'done') {
    return (
      <div role="status" data-subscribe-done className={cn('rounded-lg bg-surface-gold px-4 py-3 text-sm text-strong', className)}>
        Check your email. We sent a link to confirm your address, and you are on the list once you open it.
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} className={cn('flex flex-col gap-4', className)} data-subscribe-form noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-name`}>Name</Label>
        <Input id={`${uid}-name`} name="name" autoComplete="name" required maxLength={80} className="min-h-11" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-email`}>Email</Label>
        <Input id={`${uid}-email`} name="email" type="email" autoComplete="email" required maxLength={200} className="min-h-11" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {/* A field no person sees or fills in. A bot that does is ignored by the server. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor={`${uid}-website`}>Website</label>
        <input id={`${uid}-website`} name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <Button type="submit" className="min-h-11 w-full sm:w-fit" disabled={phase === 'sending'}>
        {phase === 'sending' ? 'Sending…' : buttonLabel}
      </Button>
    </form>
  );
}

/**
 * "Subscribe to newsletter" as a block or as a button, for a link-in-bio page or
 * any template to drop in.
 *
 *   variant="block"   the heading, a line of help and the form, in place
 *   variant="button"  one button; the form opens in a dialog
 */
export function SubscribeBlock({
  variant = 'block',
  heading = 'Subscribe to our newsletter',
  description = 'Updates from our ministry, in your inbox. Unsubscribe whenever you like.',
  buttonLabel = 'Subscribe to newsletter',
  onSubmit,
  className,
}: {
  variant?: 'block' | 'button';
  heading?: string;
  description?: string;
  buttonLabel?: string;
  onSubmit?: SubscribeSubmit;
  className?: string;
}) {
  if (variant === 'button') {
    return (
      <Dialog>
        <DialogTrigger className={cn(buttonVariants(), 'min-h-11 gap-2', className)} data-subscribe-button>
          <Mail aria-hidden />
          {buttonLabel}
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-strong">{heading}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <SubscribeForm onSubmit={onSubmit} />
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <section aria-labelledby="subscribe-heading" data-subscribe-block className={cn('flex flex-col gap-4 rounded-brand-lg border border-line bg-surface-raised p-6', className)}>
      <div>
        <h2 id="subscribe-heading" className="font-display text-xl font-semibold text-strong">{heading}</h2>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      <SubscribeForm onSubmit={onSubmit} buttonLabel={buttonLabel === 'Subscribe to newsletter' ? 'Subscribe' : buttonLabel} />
    </section>
  );
}
