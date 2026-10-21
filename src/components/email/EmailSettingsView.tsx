'use client';

import { useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { EmailApiError, type EmailApi, type EmailSettings, type Overview } from '@/components/email/email-api';
import { PlatformLimitsCard } from '@/components/email/PlatformLimitsCard';
import { UsageMeter } from '@/components/email/UsageMeter';
import { ErrorNote, PageHeader, TAP } from '@/components/email/kit';

const DOMAIN_BADGE = {
  none: { label: 'Not set up', variant: 'outline' },
  pending: { label: 'Waiting for DNS', variant: 'outline' },
  verified: { label: 'Verified', variant: 'outline' },
  failed: { label: 'Could not verify', variant: 'destructive' },
} as const;

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-strong">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      <Card className="gap-5 p-6">{children}</Card>
    </section>
  );
}

export function EmailSettingsView({ api, data, onSaved, onLimitsSaved }: {
  api: Pick<EmailApi, 'saveSettings' | 'domain' | 'saveLimits'>;
  data: Pick<Overview, 'settings' | 'usage' | 'canEditLimits' | 'limits'>;
  onSaved: (next: EmailSettings) => void;
  onLimitsSaved: () => void;
}) {
  const { settings } = data;
  const [fromName, setFromName] = useState(settings.fromName);
  const [replyTo, setReplyTo] = useState(settings.replyTo);
  const [mailingAddress, setMailingAddress] = useState(settings.mailingAddress);
  const [fromLocal, setFromLocal] = useState(settings.fromLocal);
  const [domain, setDomain] = useState(settings.domain);
  const [busy, setBusy] = useState<'save' | 'register' | 'check' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const badge = DOMAIN_BADGE[settings.domainState];

  async function save() {
    setBusy('save');
    setError(null);
    setSaved(false);
    try {
      onSaved(await api.saveSettings({ fromName, replyTo, mailingAddress, fromLocal }));
      setSaved(true);
    } catch (e) {
      setError(e instanceof EmailApiError ? e.message : 'Your settings could not be saved.');
    } finally {
      setBusy(null);
    }
  }

  async function runDomain(op: 'register' | 'check') {
    setBusy(op);
    setDomainError(null);
    try {
      onSaved(await api.domain(op, domain));
    } catch (e) {
      setDomainError(e instanceof EmailApiError ? e.message : 'The domain could not be checked.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Email settings" subtitle="Who your emails come from and your sending domain." />

      <Section title="Sender">
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email-from-local">Send from</Label>
          <div className="flex items-center gap-2">
            <Input id="email-from-local" className={`${TAP} w-40`} value={fromLocal} onChange={(e) => setFromLocal(e.target.value)} />
            <span className="text-sm text-muted">@mail.{settings.domain || 'yourchurch.org'}</span>
          </div>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex items-center gap-3">
          <Button className="min-h-11" disabled={busy !== null} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : 'Save'}</Button>
          {saved && <span role="status" className="text-sm text-muted">Saved.</span>}
        </div>
      </Section>

      <Section title="Sending domain" description="Emails come from an address on your own domain, so your reputation stays yours.">
        <div className="flex items-center gap-3">
          <Badge variant={badge.variant} data-domain-state={settings.domainState} className={settings.domainState === 'verified' ? 'border-transparent bg-surface-gold text-strong' : undefined}>{badge.label}</Badge>
          {settings.domainState === 'verified' && <span className="text-sm text-muted">Sending from {settings.fromLocal}@mail.{settings.domain}</span>}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email-domain">Your ministry domain</Label>
            <Input id="email-domain" className={`${TAP} w-72`} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="gracechurch.org" />
          </div>
          <Button className="min-h-11" disabled={busy !== null || !domain.trim()} onClick={() => void runDomain('register')}>
            {settings.domainState === 'none' ? 'Set up domain' : 'Use this domain'}
          </Button>
          {settings.domainState !== 'none' && (
            <Button variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => void runDomain('check')}>
              <RefreshCw data-icon="inline-start" />{busy === 'check' ? 'Checking…' : 'Check again'}
            </Button>
          )}
        </div>
        {domainError && <ErrorNote>{domainError}</ErrorNote>}
        {settings.domainRecords.length > 0 && settings.domainState !== 'verified' && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted">Add these records where your domain&apos;s DNS is managed, then check again. It can take a few minutes.</p>
            <div className="overflow-hidden rounded-lg border border-line">
              <Table>
                <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Name</TableHead><TableHead>Value</TableHead><TableHead className="w-10"><span className="sr-only">Copy</span></TableHead></TableRow></TableHeader>
                <TableBody>
                  {settings.domainRecords.map((r) => (
                    <TableRow key={`${r.type}-${r.name}`}>
                      <TableCell className="font-mono text-xs">{r.type}</TableCell>
                      <TableCell className="font-mono text-xs break-all">{r.name}</TableCell>
                      <TableCell className="font-mono text-xs break-all">{r.value}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="min-h-11" aria-label={`Copy ${r.type} value`} onClick={() => void navigator.clipboard?.writeText(r.value)}><Copy /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </Section>

      <Section title="Emails this month" description="Your plan includes a monthly number of emails. Your list can be any size.">
        <UsageMeter usage={data.usage} />
      </Section>

      <Section title="Advanced">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-strong">Use your own Plunk or Mailchimp key</p>
            <p className="text-sm text-muted">Send through an account you already have instead of Harvest&apos;s. Coming soon.</p>
          </div>
          <Switch disabled aria-label="Use your own Plunk or Mailchimp key" />
        </div>
      </Section>
      {data.canEditLimits && data.limits && <PlatformLimitsCard api={api} limits={data.limits} onSaved={() => onLimitsSaved()} />}
    </div>
  );
}
