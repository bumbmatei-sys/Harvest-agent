'use client';

import { useState } from 'react';
import { PauseCircle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmailApiError, type EmailApi, type SendingStatus } from '@/components/email/email-api';
import { ErrorNote } from '@/components/email/kit';

const pct = (n: number) => `${(n * 100).toFixed(1).replace(/\.0$/, '')}%`;

/** The admin-visible notice when sending has been paused automatically. */
export function SendingNotice({ sending, api, canResume, tenantId, onResumed }: {
  sending: SendingStatus;
  api: Pick<EmailApi, 'resumeSending'>;
  canResume: boolean;
  tenantId: string | null;
  onResumed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!sending.paused) return null;
  const what = sending.reason === 'complaint' ? 'spam complaints' : 'bounced emails';

  async function resume() {
    setBusy(true);
    setError(null);
    try {
      await api.resumeSending(tenantId);
      onResumed();
    } catch (e) {
      setError(e instanceof EmailApiError ? e.message : 'Sending could not be resumed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Alert variant="destructive" data-sending-paused>
      <PauseCircle />
      <AlertTitle>Sending is paused</AlertTitle>
      <AlertDescription>
        {what.charAt(0).toUpperCase() + what.slice(1)} reached {pct(sending.rate)} of what you sent this month, over the {pct(sending.threshold)} limit.
        No emails will go out until Harvest resumes sending. Check that your list only holds people who asked to hear from you.
        {error && <span className="mt-2 block"><ErrorNote>{error}</ErrorNote></span>}
      </AlertDescription>
      {canResume && (
        <div className="col-start-2 mt-2">
          <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void resume()}>{busy ? 'Resuming…' : 'Resume sending'}</Button>
        </div>
      )}
    </Alert>
  );
}
