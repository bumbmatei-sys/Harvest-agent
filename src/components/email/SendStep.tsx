'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, Plus, Send, X } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { resolveAudience, type AudienceFilter, type AudienceFilterKind, type EmailContact } from '@/lib/email/audience';
import { EmailApiError, type EmailApi, type EmailSettings, type SendPreview, type SendResponse, type SendingStatus, type Usage } from '@/components/email/email-api';
import { AddEmailsDialog } from '@/components/email/UsageMeter';
import { ErrorNote, Pick, Segmented, TAP, formatStamp, plural } from '@/components/email/kit';
import { inboxCheck } from '@/components/email/inbox-check';
import { cn } from '@/lib/utils';

const KINDS = [
  { value: 'has-tag', label: 'Has a tag' },
  { value: 'no-tag', label: "Doesn't have a tag" },
  { value: 'member-of', label: 'Is a member of' },
] as const satisfies readonly { value: AudienceFilterKind; label: string }[];

export function timeSlots(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let m = 0; m < 24 * 60; m += 15) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    const d = new Date(2000, 0, 1, h, mm);
    out.push({ value: `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, label: d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) });
  }
  return out;
}

export function combine(date: Date, time: string): Date {
  const [h, m] = time.split(':').map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h || 0, m || 0, 0, 0);
}

function nextQuarterHour(from: Date): Date {
  const d = new Date(from.getTime() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return d;
}

function optionsFor(kind: AudienceFilterKind, people: readonly EmailContact[]): { value: string; label: string }[] {
  const set = new Set<string>();
  for (const p of people) for (const v of kind === 'member-of' ? p.groups : p.tags) set.add(v);
  return [...set].sort().map((v) => ({ value: v, label: v }));
}

export function SendStep({ api, broadcastId, subject, subjectB, preheader, bodyHtml, filters, onFilters, settings, people, usage, sending, onBack, onOpenSettings, onSeeTips, onSent }: {
  api: Pick<EmailApi, 'send'>;
  broadcastId: string;
  subject: string;
  subjectB: string | null;
  preheader: string;
  bodyHtml: string;
  filters: readonly AudienceFilter[];
  onFilters: (next: AudienceFilter[]) => void;
  settings: EmailSettings;
  people: readonly EmailContact[];
  usage: Usage;
  sending: SendingStatus;
  onBack: () => void;
  onOpenSettings: () => void;
  onSeeTips: () => void;
  onSent: (r: Extract<SendResponse, { outcome: string }>) => void;
}) {
  const [mode, setMode] = useState<'now' | 'at'>('now');
  const [when, setWhen] = useState<Date>(() => nextQuarterHour(new Date()));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<{ token: string; preview: SendPreview } | null>(null);

  const audience = useMemo(() => resolveAudience(people, filters), [people, filters]);
  const tips = inboxCheck({ subject, preheader, bodyHtml });
  const fixes = tips.filter((t) => t.kind === 'fix').length;
  const slots = useMemo(timeSlots, []);
  const address = settings.domainState === 'verified' && settings.domain ? `${settings.fromLocal}@mail.${settings.domain}` : null;
  const senderIssue = !settings.fromName.trim() || !settings.replyTo.trim() || !settings.mailingAddress.trim() || !address;
  const count = audience.recipients.length;
  const label = mode === 'now' ? `Send to ${plural(count, 'person', 'people')}` : `Schedule for ${formatStamp(when.toISOString())}`;
  const left = Math.max(0, usage.cap - usage.used);
  const overAllowance = usage.cap > 0 && count > left;
  const blocked = busy || count === 0 || senderIssue || !subject.trim() || overAllowance || sending.paused || (mode === 'at' && when.getTime() <= Date.now());

  const setFilter = (i: number, patch: Partial<AudienceFilter>) => onFilters(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const whenInput = (): { mode: 'now' } | { mode: 'at'; at: string } => (mode === 'now' ? { mode: 'now' } : { mode: 'at', at: when.toISOString() });

  async function preview() {
    setBusy(true);
    setError(null);
    setErrorCode(null);
    try {
      const r = await api.send({ id: broadcastId, when: whenInput(), mode: 'preview' });
      if ('requiresConfirm' in r) setConfirm({ token: r.confirmToken, preview: r.preview });
    } catch (e) {
      setError(e instanceof EmailApiError ? e.message : 'Something went wrong. Try again.');
      setErrorCode(e instanceof EmailApiError ? e.code : null);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!confirm) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.send({ id: broadcastId, when: whenInput(), mode: 'confirm', confirmToken: confirm.token });
      setConfirm(null);
      if ('outcome' in r) onSent(r);
    } catch (e) {
      setConfirm(null);
      setError(e instanceof EmailApiError ? e.message : 'Something went wrong. Try again.');
      setErrorCode(e instanceof EmailApiError ? e.code : null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4">
      <section className="rounded-2xl border border-line bg-card p-7">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-strong">Who gets it</h2>
          <span className="font-display text-2xl font-semibold text-strong" data-recipient-count>{plural(count, 'person', 'people')}</span>
        </div>
        <p className="mt-5 text-sm text-muted">
          {filters.length === 0 ? 'Everyone subscribed. Add a filter to narrow it down.' : 'Only people who match every filter below.'}
        </p>

        {filters.map((f, i) => {
          const opts = optionsFor(f.kind, people);
          return (
            <div key={i} className="mt-4 flex items-center gap-2 rounded-lg border border-line p-2" data-filter-row>
              <Pick label="Filter type" value={f.kind} options={KINDS} onChange={(kind) => setFilter(i, { kind, value: '' })} className="min-w-44" />
              {opts.length > 0 ? (
                <Pick label="Filter value" value={f.value} options={opts} onChange={(value) => setFilter(i, { value })} placeholder={f.kind === 'member-of' ? 'Choose a group' : 'Choose a tag'} />
              ) : (
                <span className="flex-1 px-2 text-sm text-faint">{f.kind === 'member-of' ? 'No groups yet' : 'No tags yet'}</span>
              )}
              <Button variant="ghost" size="icon" className="min-h-11" aria-label="Remove filter" onClick={() => onFilters(filters.filter((_, j) => j !== i))}><X /></Button>
            </div>
          );
        })}

        <div className="mt-4">
          <Button variant="ghost" className="min-h-11" onClick={() => onFilters([...filters, { kind: 'has-tag', value: '' }])}>
            <Plus data-icon="inline-start" />Add a filter
          </Button>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-muted">
          Filters all have to match. People who unsubscribed, bounced, or marked you as spam never get it
          {audience.skipped.suppressed > 0 && ` (${plural(audience.skipped.suppressed, 'person is', 'people are')} skipped right now)`}.
          {audience.skipped.notOptedIn > 0 && ` ${plural(audience.skipped.notOptedIn, 'person', 'people')} in your CRM ${audience.skipped.notOptedIn === 1 ? 'has' : 'have'} not opted in to email.`}
        </p>

        <Separator className="my-6" />

        <h2 className="text-sm font-medium text-strong">When</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Segmented label="When" value={mode} onChange={setMode} options={[{ value: 'now', label: 'Now' }, { value: 'at', label: 'Pick a time' }]} />
          {mode === 'at' && (
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger className={cn(buttonVariants({ variant: 'outline' }), TAP, 'min-w-60 justify-between font-normal')} aria-label="Pick a date and time">
                <span>{when.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                <CalendarDays data-icon="inline-end" />
              </PopoverTrigger>
              <PopoverContent align="start" className="flex w-auto flex-row gap-0 p-0">
                <Calendar
                  mode="single"
                  selected={when}
                  onSelect={(d) => d && setWhen(combine(d, `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`))}
                  disabled={{ before: new Date(new Date().setHours(0, 0, 0, 0)) }}
                />
                <ScrollArea className="h-72 w-28 border-l border-line">
                  <ul aria-label="Time" className="flex flex-col gap-0.5 p-2">
                    {slots.map((s) => {
                      const active = s.value === `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
                      return (
                        <li key={s.value}>
                          <Button
                            type="button"
                            variant="ghost"
                            aria-pressed={active}
                            onClick={() => setWhen(combine(when, s.value))}
                            className={cn('min-h-11 w-full justify-start px-2 text-left text-sm font-normal', active ? 'bg-primary text-primary-foreground hover:bg-primary' : 'text-strong')}
                          >
                            {s.label}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </ScrollArea>
              </PopoverContent>
            </Popover>
          )}
        </div>

        {mode === 'at' && (
          <p className="mt-3 text-xs text-muted" data-schedule-note>
            Scheduled emails are sent by a job that runs once a day, around 09:00 UTC. An email you schedule goes out at the first run after the time you pick, so it can be up to a day late.
          </p>
        )}

        <Separator className="my-6" />

        <dl className="grid grid-cols-[4rem_1fr] gap-y-2 text-sm">
          <dt className="text-faint">From</dt>
          <dd className="text-strong">{settings.fromName || 'No sender name yet'}{address ? <span className="text-muted"> &lt;{address}&gt;</span> : null}</dd>
          <dt className="text-faint">Subject</dt>
          <dd className="text-strong">{subject.trim() || '(no subject)'}{subjectB?.trim() ? <span className="text-muted"> / {subjectB}</span> : null}</dd>
        </dl>
        {senderIssue && (
          <p className="mt-4 text-sm text-muted">
            Finish your sender details and verify your domain before sending.{' '}
            <Button type="button" variant="link" className="h-auto min-h-11 p-0 font-semibold text-strong" onClick={onOpenSettings}>Open settings</Button>
          </p>
        )}
        {fixes > 0 && (
          <div role="status" className="mt-4 rounded-lg bg-surface-gold px-4 py-3 text-sm text-strong">
            The inbox check found {plural(fixes, 'thing', 'things')} that could send this to spam.{' '}
            <Button type="button" variant="link" className="h-auto min-h-11 p-0 font-semibold" onClick={onSeeTips}>See it</Button> under the email.
          </div>
        )}
        {sending.paused && (
          <div className="mt-4"><ErrorNote>Sending is paused because too many emails bounced or were reported as spam. Nothing can go out until Harvest resumes it.</ErrorNote></div>
        )}
        {overAllowance && !sending.paused && (
          <div className="mt-4 flex flex-col gap-2" data-over-allowance>
            <ErrorNote>This send is {plural(count, 'email', 'emails')} and you have {left.toLocaleString()} of {usage.cap.toLocaleString()} left this month. It is blocked until your emails reset on {formatStamp(usage.resetsAt).split(',').slice(0, 2).join(',')}.</ErrorNote>
            <Button variant="outline" className="min-h-11 self-start" onClick={() => setAdding(true)}>Add more emails</Button>
          </div>
        )}
        {error && !overAllowance && (
          <div className="mt-4 flex flex-col gap-2">
            <ErrorNote>{error}</ErrorNote>
            {errorCode === 'volume_cap' && <Button variant="outline" className="min-h-11 self-start" onClick={() => setAdding(true)}>Add more emails</Button>}
          </div>
        )}

        <Button className="mt-5 min-h-11 w-full" disabled={blocked} onClick={preview}>
          <Send data-icon="inline-start" />{label}
        </Button>
        {usage.cap > 0 && !overAllowance && (
          <p className="mt-3 text-center text-xs text-muted">
            Uses {count.toLocaleString()} of your {left.toLocaleString()} emails left this month.
          </p>
        )}
        <p className="mt-3 text-center text-xs text-muted">
          People who unsubscribe or bounce before it goes out are skipped. Scheduled emails can be cancelled before their time.
        </p>
      </section>
      <Button variant="ghost" className="min-h-11" onClick={onBack}>Back to writing</Button>
      <AddEmailsDialog open={adding} onOpenChange={setAdding} usage={usage} />

      <Dialog open={confirm !== null} onOpenChange={(o) => { if (!o && !busy) setConfirm(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirm?.preview.action === 'schedule' ? 'Schedule this email?' : 'Send this email?'}</DialogTitle>
            <DialogDescription>Check the details. Once you confirm, it cannot be recalled.</DialogDescription>
          </DialogHeader>
          {confirm && (
            <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
              <dt className="text-faint">To</dt>
              <dd className="text-strong">{plural(confirm.preview.recipientCount, 'person', 'people')}</dd>
              <dt className="text-faint">Skipped</dt>
              <dd className="text-strong">{confirm.preview.skipped.suppressed} unsubscribed or bounced, {confirm.preview.skipped.notOptedIn} not opted in</dd>
              <dt className="text-faint">From</dt>
              <dd className="text-strong">{confirm.preview.from}</dd>
              <dt className="text-faint">Subject</dt>
              <dd className="text-strong">{confirm.preview.subject}</dd>
              <dt className="text-faint">When</dt>
              <dd className="text-strong">{confirm.preview.at ? formatStamp(confirm.preview.at) : 'Right now'}</dd>
            </dl>
          )}
          <DialogFooter>
            <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => setConfirm(null)}>Cancel</Button>
            <Button className="min-h-11" disabled={busy} onClick={commit}>{confirm?.preview.action === 'schedule' ? 'Confirm schedule' : 'Confirm send'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
