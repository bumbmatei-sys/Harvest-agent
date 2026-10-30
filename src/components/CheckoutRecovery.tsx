'use client';
import { AlertCircle } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

export default function CheckoutRecovery({ timedOut, busy, error, onRetry, onTryAgain }: {
  timedOut: boolean; busy: boolean; error: string;
  onRetry: () => void; onTryAgain: () => void;
}) {
  return <main className="flex min-h-screen items-center justify-center bg-surface px-5 py-10">
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <AlertCircle className="mx-auto mb-3 size-10 text-gold" aria-hidden />
        <CardTitle className="font-display text-3xl"><h1>Payment didn&apos;t go through</h1></CardTitle>
        <CardDescription className="pt-3 leading-relaxed">
          {timedOut
            ? 'We could not confirm your payment within a minute. It may still be processing. Retry the status check before starting another checkout.'
            : 'Checkout was declined or cancelled. Your ministry name and chosen plan are saved. You can try checkout again or choose another plan.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <p role="alert" className="text-sm text-strong">{error}</p>}
        {timedOut
          ? <Button className="min-h-11" disabled={busy} onClick={onRetry}>Retry</Button>
          : <Button className="min-h-11" disabled={busy} onClick={onTryAgain}>{busy ? 'Opening checkout…' : 'Try again'}</Button>}
        <Button className="min-h-11" variant="outline" render={<a href="https://theharvest.site/#pricing" />}>Choose another plan</Button>
        <Button className="min-h-11" variant="ghost" render={<a href="https://theharvest.site/contact" />}>Contact support</Button>
      </CardContent>
    </Card>
  </main>;
}
