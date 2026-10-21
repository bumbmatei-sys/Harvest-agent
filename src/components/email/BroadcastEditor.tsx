'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, Copy, Eye, LayoutTemplate, Palette, Send, Split, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { DEFAULT_EMAIL_DESIGN, THEME_LABELS, type EmailDesign } from '@/lib/email/design';
import { BodyEditor } from '@/components/email/BodyEditor';
import { DesignDialog } from '@/components/email/DesignDialog';
import { PreviewDialog } from '@/components/email/PreviewDialog';
import { SendStep } from '@/components/email/SendStep';
import { TemplatesDialog } from '@/components/email/TemplatesDialog';
import { ErrorNote, TAP, formatStamp, plural } from '@/components/email/kit';
import { inboxCheck, inboxSummary, plainWords } from '@/components/email/inbox-check';
import { EmailApiError, type AudienceFilter, type Broadcast, type DraftFields, type EmailApi, type Overview, type SendResponse } from '@/components/email/email-api';
import { cn } from '@/lib/utils';

type Step = 'write' | 'send';
type Saving = 'saved' | 'saving' | 'unsaved' | 'error';

const SAVE_LABEL: Record<Saving, string> = { saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved', error: 'Not saved' };

function SideAction({ icon, children, onClick, disabled, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Button
      type="button"
      variant="ghost"
      disabled={disabled}
      onClick={onClick}
      className={cn('min-h-11 w-full justify-start gap-2.5 px-2 text-left text-sm font-normal sm:min-h-9', danger ? 'text-danger' : 'text-strong')}
    >
      <span aria-hidden className="text-muted [&_svg]:size-4">{icon}</span>
      {children}
    </Button>
  );
}

export function BroadcastEditor({ api, data, initial, onBack, onOpenSettings, onChanged, onOpen }: {
  api: EmailApi;
  data: Overview;
  initial: Broadcast | null;
  onBack: () => void;
  onOpenSettings: () => void;
  onChanged: () => void;
  onOpen: (b: Broadcast) => void;
}) {
  const [id, setId] = useState<string | null>(initial?.id ?? null);
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [subjectB, setSubjectB] = useState<string | null>(initial?.subjectB ?? null);
  const [preheader, setPreheader] = useState(initial?.preheader ?? '');
  const [bodyHtml, setBodyHtml] = useState(initial?.bodyHtml ?? '<p>Hi {{first_name}},</p><p></p><p>{{sender_name}}</p>');
  const [design, setDesign] = useState<EmailDesign>(initial?.design ?? DEFAULT_EMAIL_DESIGN);
  const [filters, setFilters] = useState<AudienceFilter[]>([...(initial?.filters ?? [])]);
  const [step, setStep] = useState<Step>('write');
  const [saving, setSaving] = useState<Saving>(initial ? 'saved' : 'unsaved');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [designOpen, setDesignOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [result, setResult] = useState<Extract<SendResponse, { outcome: string }> | null>(null);

  const idRef = useRef(id);
  const wasScheduled = useRef(initial?.status === 'scheduled');
  const dirty = useRef(false);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const draft = (): DraftFields => ({ id: idRef.current, subject, subjectB, preheader, bodyHtml, design, filters });
  const latest = useRef(draft);
  latest.current = draft;

  const persist = useCallback(() => {
    chain.current = chain.current.then(async () => {
      setSaving('saving');
      try {
        const saved = await api.saveDraft(latest.current());
        idRef.current = saved.id;
        setId(saved.id);
        dirty.current = false;
        setSaving('saved');
        setError(null);
        if (wasScheduled.current) {
          wasScheduled.current = false;
          setNotice('This email was scheduled. Editing it took it off the schedule, so schedule it again when you are done.');
        }
      } catch (e) {
        setSaving('error');
        setError(e instanceof EmailApiError ? e.message : 'Your changes could not be saved.');
      }
    });
    return chain.current;
  }, [api]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    dirty.current = true;
    setSaving('unsaved');
    const t = setTimeout(() => { void persist(); }, 800);
    return () => clearTimeout(t);
  }, [subject, subjectB, preheader, bodyHtml, design, filters, persist]);

  const tips = inboxCheck({ subject, preheader, bodyHtml });
  const ready = data.settings.domainState === 'verified' && Boolean(data.settings.fromName && data.settings.replyTo && data.settings.mailingAddress);

  async function next() {
    await persist();
    if (idRef.current) setStep('send');
  }

  async function sendTest() {
    setNotice(null);
    await persist();
    if (!idRef.current) return;
    try {
      await api.sendTest(idRef.current);
      setNotice('A test went to your own email address.');
    } catch (e) {
      setNotice(e instanceof EmailApiError ? e.message : 'The test could not be sent.');
    }
  }

  async function duplicate() {
    try {
      const copy = await api.saveDraft({ ...draft(), id: null, subject: subject ? `${subject} (copy)` : '' });
      onChanged();
      onOpen(copy);
    } catch (e) {
      setError(e instanceof EmailApiError ? e.message : 'The copy could not be made.');
    }
  }

  async function remove() {
    try {
      if (idRef.current) await api.remove(idRef.current);
      onChanged();
      onBack();
    } catch (e) {
      setError(e instanceof EmailApiError ? e.message : 'The broadcast could not be deleted.');
    }
  }

  const header = (
    <div className="flex items-center gap-3 border-b border-line pb-4">
      <Button variant="ghost" size="icon" className="min-h-11" aria-label="Back to broadcasts" onClick={() => { void persist().then(() => { onChanged(); onBack(); }); }}><ArrowLeft /></Button>
      <h1 className="min-w-0 flex-1 truncate font-display text-lg font-semibold text-strong">{subject.trim() || 'Untitled broadcast'}</h1>
      <nav aria-label="Steps" className="flex items-center gap-2 text-sm">
        <span className={step === 'write' ? 'font-medium text-strong' : 'text-faint'} aria-current={step === 'write' ? 'step' : undefined}>Write</span>
        <span aria-hidden className="text-faint">&gt;</span>
        <span className={step === 'send' ? 'font-medium text-strong' : 'text-faint'} aria-current={step === 'send' ? 'step' : undefined}>Send</span>
      </nav>
      <span className="text-sm text-faint" role="status" data-save-state={saving}>{SAVE_LABEL[saving]}</span>
      {step === 'write' && <Button className="min-h-11" onClick={next}>Next<ArrowRight data-icon="inline-end" /></Button>}
    </div>
  );

  if (result) {
    const bad = result.outcome === 'partial' || result.outcome === 'failed';
    return (
      <div className="flex flex-col gap-6">
        {header}
        <section className="mx-auto flex w-full max-w-[640px] flex-col gap-4 rounded-2xl border border-line bg-card p-7">
          <h2 className="font-display text-xl font-semibold text-strong">
            {result.outcome === 'scheduled' ? 'Scheduled' : result.outcome === 'sent' ? 'Sent' : result.outcome === 'partial' ? 'Only part of it went out' : 'Nothing was sent'}
          </h2>
          {bad ? <ErrorNote>{result.message}</ErrorNote> : <p className="text-sm text-muted" role="status">{result.outcome === 'scheduled' ? `It will go out ${formatStamp(result.preview.at)}.` : result.message}</p>}
          {result.stats && (
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div><dt className="text-faint">Sent</dt><dd className="font-display text-xl text-strong">{result.stats.sent}</dd></div>
              <div><dt className="text-faint">Did not send</dt><dd className="font-display text-xl text-strong">{result.stats.failed}</dd></div>
              <div><dt className="text-faint">Skipped</dt><dd className="font-display text-xl text-strong">{result.stats.skippedSuppressed + result.stats.skippedNotOptedIn}</dd></div>
            </dl>
          )}
          <Button className="min-h-11" onClick={() => { onChanged(); onBack(); }}>Back to broadcasts</Button>
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      {error && <ErrorNote>{error}</ErrorNote>}
      {step === 'send' && idRef.current ? (
        <SendStep
          api={api}
          broadcastId={idRef.current}
          subject={subject}
          subjectB={subjectB}
          preheader={preheader}
          bodyHtml={bodyHtml}
          filters={filters}
          onFilters={setFilters}
          settings={data.settings}
          people={data.subscribers}
          usage={data.usage}
          sending={data.sending}
          onBack={() => setStep('write')}
          onOpenSettings={onOpenSettings}
          onSeeTips={() => { setStep('write'); setTipsOpen(true); }}
          onSent={setResult}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <section className="overflow-hidden rounded-2xl border border-line bg-card">
            <div className="flex flex-col gap-1 px-5 pt-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-faint">From <span className="text-strong">{data.settings.fromName || 'Add a sender name in settings'}</span></span>
                {subjectB === null && (
                  <Button variant="ghost" size="sm" className="min-h-11 text-muted" onClick={() => setSubjectB('')}><Split data-icon="inline-start" />Test another subject line</Button>
                )}
              </div>
              <div className="flex items-start gap-3">
                {subjectB !== null && <span aria-hidden className="mt-2.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[11px] font-semibold text-strong">A</span>}
                <div className="flex-1">
                  <Input aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="h-auto border-0 bg-transparent dark:bg-transparent px-0 py-2 text-xl font-semibold shadow-none focus-visible:ring-0" />
                  <Input aria-label="Preview text" value={preheader} onChange={(e) => setPreheader(e.target.value)} placeholder="Add preview text, the line inboxes show after the subject" className="h-auto border-0 bg-transparent dark:bg-transparent px-0 py-1 text-sm text-muted shadow-none focus-visible:ring-0" />
                </div>
              </div>
              {subjectB !== null && (
                <div className="mt-2 flex items-start gap-3 border-t border-dashed border-line pt-3">
                  <span aria-hidden className="mt-2.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-gold text-[11px] font-semibold text-strong">B</span>
                  <div className="flex-1">
                    <Input aria-label="Another subject to try" value={subjectB} onChange={(e) => setSubjectB(e.target.value)} placeholder="Another subject to try" className="h-auto border-0 bg-transparent dark:bg-transparent px-0 py-2 text-xl font-semibold shadow-none focus-visible:ring-0" />
                    <p className="pb-1 text-xs text-faint">Half your list gets A and half gets B.</p>
                  </div>
                  <Button variant="ghost" size="icon" className="min-h-11" aria-label="Remove the second subject" onClick={() => setSubjectB(null)}><X /></Button>
                </div>
              )}
            </div>
            <div className="mt-3 border-t border-line">
              <BodyEditor html={bodyHtml} onChange={setBodyHtml} />
            </div>
            <Collapsible open={tipsOpen} onOpenChange={setTipsOpen} className="border-t border-line">
              <CollapsibleTrigger className={cn(TAP, 'flex w-full items-center gap-2 px-5 py-3 text-left text-sm')}>
                <span aria-hidden className={cn('size-2 rounded-full', tips.some((t) => t.kind === 'fix') ? 'bg-gold' : tips.length ? 'bg-muted-foreground' : 'bg-primary')} />
                <span className="font-medium text-strong">Inbox check</span>
                <span className="text-muted">{inboxSummary(tips)}</span>
                <span className="ml-auto flex items-center gap-1 text-faint">{plural(plainWords(bodyHtml), 'word', 'words')}{tipsOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="flex flex-col gap-3 px-5 pb-4">
                  {tips.map((t) => (
                    <li key={t.id} className="flex gap-2.5 text-sm">
                      <span aria-hidden className={cn('mt-1.5 size-2 shrink-0 rounded-full', t.kind === 'fix' ? 'bg-gold' : 'bg-muted-foreground')} />
                      <span><span className="font-medium text-strong">{t.title}</span>{t.kind === 'tip' && <span className="ml-1.5 text-xs text-faint">Tip</span>}<br /><span className="text-muted">{t.detail}</span></span>
                    </li>
                  ))}
                  <li className="text-xs text-faint">Words alone rarely send an email to spam. What matters most is emailing people who asked to hear from you, and that they open and reply.</li>
                </ul>
              </CollapsibleContent>
            </Collapsible>
            <p className="border-t border-line px-5 py-4 text-xs leading-relaxed text-faint">
              Use <code className="rounded bg-surface-sunken px-1">{'{{first_name}}'}</code> in the subject or message to add a fill-in, like their first name. Add buttons from the toolbar. The unsubscribe link and the mailing address are added at the bottom.
            </p>
          </section>

          <aside className="flex flex-col gap-1 text-sm" aria-label="Broadcast tools">
            <h2 className="px-2 pb-1 text-xs text-faint">Design</h2>
            <Button type="button" variant="ghost" onClick={() => setDesignOpen(true)} className="h-auto min-h-11 w-full justify-start gap-3 whitespace-normal rounded-xl border-line bg-card p-3 text-left font-normal hover:bg-muted">
              <span aria-hidden className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground"><Palette className="size-4" /></span>
              <span className="flex-1"><span className="block font-medium text-strong">{THEME_LABELS[design.theme]} (current look)</span><span className="block text-xs text-muted">Colors, fonts, header, buttons</span></span>
            </Button>
            <Separator />
            <h2 className="px-2 pb-1 pt-3 text-xs text-faint">Check it</h2>
            <SideAction icon={<Eye />} onClick={() => setPreviewOpen(true)}>Preview</SideAction>
            <SideAction icon={<Send />} disabled={!ready || !subject.trim()} onClick={() => void sendTest()}>Send me a test</SideAction>
            {notice && <p role="status" className="px-2 text-xs text-muted">{notice}</p>}
            <Separator />
            <div className="pt-2" />
            <SideAction icon={<LayoutTemplate />} onClick={() => setTemplatesOpen(true)}>Templates</SideAction>
            <SideAction icon={<Copy />} disabled={!idRef.current} onClick={() => void duplicate()}>Duplicate</SideAction>
            <SideAction icon={<Trash2 />} danger onClick={() => void remove()}>Delete broadcast</SideAction>
          </aside>
        </div>
      )}

      <DesignDialog open={designOpen} onOpenChange={setDesignOpen} design={design} onChange={setDesign} />
      <PreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} api={api} draft={{ subject, preheader, bodyHtml, design }} />
      <TemplatesDialog
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        hasContent={plainWords(bodyHtml) > 4}
        onPick={(t) => { setBodyHtml(t.bodyHtml); if (!subject.trim()) setSubject(t.subject); if (!preheader.trim()) setPreheader(t.preheader); }}
      />
    </div>
  );
}

