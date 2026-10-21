'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { authFetch } from '@/utils/auth-fetch';
import { BroadcastEditor } from '@/components/email/BroadcastEditor';
import { BroadcastsView } from '@/components/email/BroadcastsView';
import { EmailOverview } from '@/components/email/EmailOverview';
import { EmailSettingsView } from '@/components/email/EmailSettingsView';
import { ImportDialog } from '@/components/email/ImportDialog';
import { SubscribersView } from '@/components/email/SubscribersView';
import { ErrorNote, TAP } from '@/components/email/kit';
import { EmailApiError, authedCall, createEmailApi, type Broadcast, type EmailApi, type Overview } from '@/components/email/email-api';
import { Button } from '@/components/ui/button';

type Section = 'overview' | 'broadcasts' | 'subscribers' | 'settings';
type View = { kind: 'section'; section: Section } | { kind: 'editor'; broadcast: Broadcast | null };

const SECTIONS: readonly { value: Section; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'broadcasts', label: 'Broadcasts' },
  { value: 'subscribers', label: 'Subscribers' },
  { value: 'settings', label: 'Settings' },
];

/**
 * The email workspace: overview, broadcasts, the editor, subscribers and
 * settings. It talks to the server only through `EmailApi`, so it knows nothing
 * about which vendor sends the mail.
 */
export function EmailWorkspace({ tenantId, api: injected, initialSection = 'overview' }: {
  tenantId: string | null;
  api?: EmailApi;
  initialSection?: Section;
}) {
  const api = useMemo(() => injected ?? createEmailApi(tenantId, authedCall(authFetch)), [injected, tenantId]);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'section', section: initialSection });
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.overview());
      setError(null);
    } catch (e) {
      setError(e instanceof EmailApiError ? e.message : 'Email could not be loaded.');
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  const go = (section: Section) => setView({ kind: 'section', section });

  // A failed load is shown as a failure, never as an empty list.
  if (error && !data) {
    return (
      <div className="mx-auto flex w-full max-w-[1200px] flex-col items-start gap-3 px-4 py-8 lg:px-0">
        <ErrorNote>{error}</ErrorNote>
        <Button variant="outline" className="min-h-11" onClick={() => void load()}>Try again</Button>
      </div>
    );
  }
  if (!data) {
    return <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-4 py-8 lg:px-0"><Skeleton className="h-10 w-48" /><Skeleton className="h-32 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  const editing = view.kind === 'editor';
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 py-8 lg:px-0" data-email-workspace>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!editing && (
        <Tabs value={view.section} onValueChange={(v) => go(v as Section)}>
          <TabsList aria-label="Email sections">
            {SECTIONS.map((s) => <TabsTrigger key={s.value} value={s.value} className={TAP}>{s.label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      )}
      {view.kind === 'editor' && (
        <BroadcastEditor
          key={view.broadcast?.id ?? 'new'}
          api={api}
          data={data}
          initial={view.broadcast}
          onBack={() => go('broadcasts')}
          onOpenSettings={() => go('settings')}
          onChanged={() => void load()}
          onOpen={(b) => setView({ kind: 'editor', broadcast: b })}
        />
      )}
      {view.kind === 'section' && view.section === 'overview' && (
        <EmailOverview data={data} onNew={() => setView({ kind: 'editor', broadcast: null })} onSettings={() => go('settings')} onSubscribers={() => go('subscribers')} />
      )}
      {view.kind === 'section' && view.section === 'broadcasts' && (
        <BroadcastsView
          data={data}
          onNew={() => setView({ kind: 'editor', broadcast: null })}
          onOpen={(b) => setView({ kind: 'editor', broadcast: b })}
          onDelete={(b) => { void api.remove(b.id).then(load, (e: unknown) => setError(e instanceof EmailApiError ? e.message : 'The broadcast could not be deleted.')); }}
          onSettings={() => go('settings')}
        />
      )}
      {view.kind === 'section' && view.section === 'subscribers' && (
        <SubscribersView data={data} onImport={() => setImporting(true)} onSettings={() => go('settings')} />
      )}
      {view.kind === 'section' && view.section === 'settings' && (
        <EmailSettingsView api={api} settings={data.settings} onSaved={(settings) => setData({ ...data, settings })} />
      )}
      <ImportDialog open={importing} onOpenChange={setImporting} api={api} onImported={() => void load()} />
    </div>
  );
}
