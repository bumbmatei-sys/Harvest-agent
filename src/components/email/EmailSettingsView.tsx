'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EmailApiError, type SettingsFocus, type EmailApi, type EmailSettings, type Overview } from '@/components/email/email-api';
import { PlatformLimitsCard } from '@/components/email/PlatformLimitsCard';
import { UsageMeter } from '@/components/email/UsageMeter';
import { ErrorNote, TAP } from '@/components/email/kit';

function Section({ id, title, description, children }: { id?: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-6 flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-strong">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      <Card className="gap-5 p-6">{children}</Card>
    </section>
  );
}

export function EmailSettingsView({ api, data, focus = null, onSaved, onLimitsSaved }: {
  api: Pick<EmailApi, 'saveSettings' | 'saveLimits'>;
  data: Pick<Overview, 'settings' | 'usage' | 'canEditLimits' | 'limits'>;
  /** Scrolls to and focuses this part when the page opens, for a deep link from the send step. */
  focus?: SettingsFocus | null;
  onSaved: (next: EmailSettings) => void;
  onLimitsSaved: () => void;
}) {
  const { settings } = data;
  const [fromName, setFromName] = useState(settings.fromName);
  const [replyTo, setReplyTo] = useState(settings.replyTo);
  const [mailingAddress, setMailingAddress] = useState(settings.mailingAddress);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!focus) return;
    // Both focus targets land on the sender details: there is no domain to set up.
    document.getElementById('email-sender-section')?.scrollIntoView?.({ block: 'start' });
    document.getElementById('email-from-name')?.focus({ preventScroll: true });
  }, [focus]);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      // The send-from part of the address stays whatever it already was: the sender is Harvest's.
      onSaved(await api.saveSettings({ fromName, replyTo, mailingAddress, fromLocal: settings.fromLocal }));
      setSaved(true);
    } catch (e) {
      setError(e instanceof EmailApiError ? e.message : 'Your settings could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <Section id="email-sender-section" title="Sender">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email-from-name">From name</Label>
            <Input id="email-from-name" className={TAP} value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Grace Church" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email-reply-to">Replies go to</Label>
            <Input id="email-reply-to" type="email" className={TAP} value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="office@yourchurch.org" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email-address">Mailing address</Label>
          <Textarea id="email-address" rows={2} value={mailingAddress} onChange={(e) => setMailingAddress(e.target.value)} placeholder="1 Main Street, Springfield" />
          <p className="text-xs text-faint">The law requires a mailing address at the bottom of every marketing email.</p>
        </div>
        <p className="text-sm text-muted" data-sender-note>
          Emails are sent from Harvest&apos;s own sending address, under your name, and replies come to the address above.
        </p>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex items-center gap-3">
          <Button className="min-h-11" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button>
          {saved && <span role="status" className="text-sm text-muted">Saved.</span>}
        </div>
      </Section>

      <Section title="Emails this month" description="Your plan includes a monthly number of emails. Your list can be any size.">
        <UsageMeter usage={data.usage} />
      </Section>

      {/* "Advanced" (bring your own Plunk key) is hidden while it is coming soon. Mailchimp is not
          part of it at all: Harvest replaces Mailchimp, it does not connect to it. */}
      {data.canEditLimits && data.limits && <PlatformLimitsCard api={api} limits={data.limits} onSaved={() => onLimitsSaved()} />}
    </div>
  );
}
