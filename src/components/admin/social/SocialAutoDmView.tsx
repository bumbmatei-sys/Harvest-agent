'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  AUTO_DM_LIMITS, AUTO_DM_TRIGGER_LABELS, AUTO_DM_TRIGGERS, autoDmTotals, newAutoDm, triggerAllowed,
  type AutoDmButton, type AutoDmInput, type AutoDmLog, type AutoDmRule, type AutoDmTrigger,
} from '@/lib/social/auto-dm';
import type { AutoDmAccount, AutoDmWorkspace } from '@/lib/social/session';
import { PlatformLogo } from './PlatformLogo';

/** Where the view reads and writes; the preview and tests pass the sample. */
export interface AutoDmApi {
  list(): Promise<AutoDmWorkspace>;
  /** Rejects with an Error whose message is shown on the form. */
  save(id: string | null, input: AutoDmInput): Promise<AutoDmRule>;
  remove(id: string): Promise<void>;
  logs(id: string): Promise<AutoDmLog[]>;
}

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: AutoDmWorkspace };
type Tab = 'overview' | 'automations';

const TAP = 'min-h-11 sm:min-h-0';
const PILL = `${TAP} h-auto rounded-lg px-2.5 text-xs font-semibold aria-pressed:bg-surface-sunken aria-pressed:text-strong`;
const number = (n: number | null) => (n === null ? '—' : n.toLocaleString('en-US'));
const STATUS_LABEL: Record<AutoDmLog['status'], string> = { pending: 'Waiting', sent: 'Sent', failed: 'Failed', skipped: 'Skipped', gated: 'Waiting for follow' };

const handle = (account: AutoDmAccount | undefined) => (account ? `@${account.username}` : 'Disconnected account');
function postLabel(rule: AutoDmInput): string {
  if (rule.trigger === 'story_mention') return 'Any story mention';
  if (rule.trigger === 'live_comment') return 'Any live';
  if (!rule.platformPostId && !rule.postId) return rule.trigger === 'story_reply' ? 'Any story' : 'Any post';
  return rule.postTitle || 'One post';
}

/**
 * Auto-DM (Eden's Auto-DM, docs/prd/screenshots/14-social-scheduler 005–007):
 * an overview of what the automations sent and how many people clicked, and the
 * automations themselves. Each one DMs people who comment a keyword, reply to
 * a story, mention the account or comment on a live, on Instagram or Facebook.
 */
export function SocialAutoDmView({ api, onOpenInbox }: { api: AutoDmApi; onOpenInbox?: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [editing, setEditing] = useState<{ id: string | null; input: AutoDmInput } | null>(null);
  const [deleting, setDeleting] = useState<AutoDmRule | null>(null);
  const [notice, setNotice] = useState('');

  const refresh = useCallback(() => {
    api.list().then((data) => setLoad({ status: 'ready', data }), () => setLoad({ status: 'error' }));
  }, [api]);
  useEffect(() => { refresh(); }, [refresh]);

  const data = load.status === 'ready' ? load.data : null;
  const accounts = useMemo(() => data?.accounts ?? [], [data]);
  const rules = data?.rules ?? [];
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const totals = autoDmTotals(rules);

  const replace = (rule: AutoDmRule) => setLoad((current) => current.status !== 'ready' ? current : {
    status: 'ready',
    data: { ...current.data, rules: current.data.rules.some((r) => r.id === rule.id) ? current.data.rules.map((r) => (r.id === rule.id ? rule : r)) : [...current.data.rules, rule] },
  });

  const toggle = async (rule: AutoDmRule, isActive: boolean) => {
    setNotice('');
    try { replace(await api.save(rule.id, { ...rule, isActive })); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not change the automation.'); }
  };

  return (
    <section data-testid="social-auto-dm" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <div role="group" aria-label="Auto-DM sections" className="flex gap-1">
          <Button type="button" variant="ghost" className={PILL} aria-pressed={tab === 'overview'} onClick={() => setTab('overview')}>Overview</Button>
          <Button type="button" variant="ghost" className={PILL} aria-pressed={tab === 'automations'} onClick={() => setTab('automations')}>
            Automations <span className="text-faint">{rules.length}</span>
          </Button>
        </div>
        <Button type="button" className={`ml-auto ${TAP}`} disabled={accounts.length === 0}
          onClick={() => { setNotice(''); setEditing({ id: null, input: newAutoDm(accounts[0]?.id ?? '') }); }}>
          New automation
        </Button>
      </div>

      {load.status === 'loading' && <Skeleton className="h-48 w-full rounded-xl" />}
      {load.status === 'error' && <p role="alert" className="rounded-xl border border-line bg-surface-raised p-4 text-sm">Could not load Auto-DM. Please try again.</p>}
      {notice && <p role="alert" className="text-sm text-danger">{notice}</p>}

      {data && accounts.length === 0 && (
        <div data-testid="auto-dm-no-accounts" className="rounded-xl border border-line bg-surface-raised p-6 text-center">
          <p className="font-semibold text-strong">Connect Instagram or Facebook first</p>
          <p className="mt-1 text-sm text-muted">Auto-DM answers comments, story replies and mentions on those two networks. Connect an account under Accounts.</p>
        </div>
      )}

      {data && accounts.length > 0 && tab === 'overview' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Active automations" value={number(totals.active)} note={`${rules.length} in all`} />
            <Tile label="DMs sent" value={number(totals.sent)} note="Across every automation" />
            <Tile label="Link clicks" value={number(totals.clicks)} note="Tracked links in DMs" />
            <Tile label="Click rate" value={totals.clickRate === null ? '—' : `${totals.clickRate}%`} note="Clicks per DM sent" />
          </div>
          {rules.length === 0 ? (
            <div className="rounded-xl border border-line bg-surface-raised p-6 text-center">
              <p className="font-semibold text-strong">Turn comments into conversations</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted">DM everyone who comments a word on your post, replies to your story or mentions you, with a tracked link so you see every click.</p>
            </div>
          ) : (
            <section className="rounded-xl border border-line bg-surface-raised p-4">
              <h3 className="text-sm font-semibold text-strong">By automation</h3>
              <ul className="mt-2 flex flex-col divide-y divide-line">
                {rules.map((rule) => (
                  <li key={rule.id} data-auto-dm-summary={rule.id} className="flex items-center gap-3 py-2">
                    <PlatformLogo platform={rule.platform} className="size-4" />
                    <span className="min-w-0 flex-1 truncate text-sm text-strong">{rule.name}</span>
                    <span className="text-xs text-muted">{number(rule.stats.sent)} sent</span>
                    <span className="text-xs text-muted">{number(rule.stats.clicks)} clicks</span>
                    {!rule.isActive && <Badge variant="secondary">Paused</Badge>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="text-xs text-faint">
            When people answer a DM, the conversation lands in the {onOpenInbox ? <button type="button" className="underline" onClick={onOpenInbox}>Inbox</button> : 'Inbox'}. Each DM sent counts toward the account&apos;s monthly message allowance.
          </p>
        </>
      )}

      {data && accounts.length > 0 && tab === 'automations' && (
        rules.length === 0
          ? <p className="py-6 text-center text-sm text-faint">No automations yet.</p>
          : <ul className="flex flex-col gap-2">
              {rules.map((rule) => (
                <AutomationRow key={rule.id} rule={rule} account={accountById.get(rule.accountId)} api={api}
                  onToggle={(on) => void toggle(rule, on)}
                  onEdit={() => { setNotice(''); setEditing({ id: rule.id, input: rule }); }}
                  onDelete={() => setDeleting(rule)} />
              ))}
            </ul>
      )}

      {editing && data && (
        <AutoDmEditor
          key={editing.id ?? 'new'}
          initial={editing.input}
          isNew={editing.id === null}
          accounts={accounts}
          posts={data.posts}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            const rule = await api.save(editing.id, input);
            replace(rule);
            setEditing(null);
            setTab('automations');
          }}
        />
      )}

      <Sheet open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <SheetContent side="bottom" className="mx-auto max-w-lg rounded-t-xl">
          <SheetHeader>
            <SheetTitle>Delete {deleting?.name}?</SheetTitle>
            <SheetDescription>It stops answering right away. Links already sent keep working.</SheetDescription>
          </SheetHeader>
          <SheetFooter className="flex-row justify-end">
            <Button type="button" variant="outline" className={TAP} onClick={() => setDeleting(null)}>Keep it</Button>
            <Button type="button" variant="destructive" className={TAP} onClick={async () => {
              const rule = deleting;
              setDeleting(null);
              if (!rule) return;
              try {
                await api.remove(rule.id);
                setLoad((current) => current.status !== 'ready' ? current : { status: 'ready', data: { ...current.data, rules: current.data.rules.filter((r) => r.id !== rule.id) } });
              } catch { setNotice('Could not delete the automation.'); }
            }}>Delete</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div data-auto-dm-tile={label} className="rounded-xl border border-line bg-surface-raised p-4">
      <p className="text-xs text-faint">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold text-strong">{value}</p>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </div>
  );
}

function AutomationRow({ rule, account, api, onToggle, onEdit, onDelete }: {
  rule: AutoDmRule; account: AutoDmAccount | undefined; api: AutoDmApi;
  onToggle: (on: boolean) => void; onEdit: () => void; onDelete: () => void;
}) {
  const [logs, setLogs] = useState<AutoDmLog[] | 'loading' | 'error' | null>(null);
  const showActivity = () => {
    if (logs !== null) { setLogs(null); return; }
    setLogs('loading');
    api.logs(rule.id).then(setLogs, () => setLogs('error'));
  };
  return (
    <li data-auto-dm-rule={rule.id} className="rounded-xl border border-line bg-surface-raised p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-muted"><PlatformLogo platform={rule.platform} className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-strong">{rule.name}</p>
          <p className="text-xs text-muted">{AUTO_DM_TRIGGER_LABELS[rule.trigger]} · {postLabel(rule)} · {handle(account)}</p>
          {rule.keywords.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">{rule.keywords.map((word) => <Badge key={word} variant="outline">{word}</Badge>)}</div>
          )}
          {rule.keywords.length === 0 && rule.trigger !== 'story_mention' && <p className="mt-1 text-xs text-faint">Answers every comment</p>}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>{number(rule.stats.sent)} sent</span>
          <span>{number(rule.stats.clicks)} clicks</span>
          <Switch aria-label={`${rule.name} is on`} checked={rule.isActive} onCheckedChange={onToggle} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" className={TAP} onClick={onEdit}>Edit</Button>
        <Button type="button" variant="outline" className={TAP} aria-expanded={logs !== null} onClick={showActivity}>Activity</Button>
        <Button type="button" variant="ghost" className={TAP} onClick={onDelete}>Delete</Button>
      </div>
      {logs === 'loading' && <Skeleton className="mt-3 h-16 w-full" />}
      {logs === 'error' && <p role="alert" className="mt-3 text-sm text-muted">Could not load the activity.</p>}
      {Array.isArray(logs) && (
        logs.length === 0
          ? <p className="mt-3 text-sm text-faint">Nobody has triggered it yet.</p>
          : <ul data-auto-dm-logs={rule.id} className="mt-3 flex flex-col divide-y divide-line text-sm">
              {logs.map((log) => (
                <li key={log.id} className="flex items-center gap-3 py-1.5">
                  <span className="font-medium text-strong">{log.commenter}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{log.text}</span>
                  <Badge variant={log.status === 'failed' ? 'destructive' : 'secondary'}>{STATUS_LABEL[log.status]}</Badge>
                </li>
              ))}
            </ul>
      )}
    </li>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-strong">{label}</span>
      {children}
      {hint && <span className="text-xs text-faint">{hint}</span>}
    </label>
  );
}

function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div><p className="text-sm font-medium text-strong">{label}</p>{hint && <p className="text-xs text-faint">{hint}</p>}</div>
      <Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

const split = (value: string) => value.split(',').map((word) => word.trim()).filter(Boolean);
const hoursOrNull = (value: string) => (value.trim() === '' ? null : Number(value));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="flex flex-col gap-3 border-t border-line pt-4"><h3 className="text-sm font-semibold text-strong">{title}</h3>{children}</section>;
}

/** Every option Zernio's comment-to-DM offers, grouped the way an admin thinks about it. */
function AutoDmEditor({ initial, isNew, accounts, posts, onClose, onSave }: {
  initial: AutoDmInput; isNew: boolean; accounts: AutoDmAccount[]; posts: AutoDmWorkspace['posts'];
  onClose: () => void; onSave: (input: AutoDmInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState<AutoDmInput>(initial);
  const [keywords, setKeywords] = useState(initial.keywords.join(', '));
  const [exclude, setExclude] = useState(initial.excludeKeywords.join(', '));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<AutoDmInput>) => { setDraft((current) => ({ ...current, ...patch })); setError(''); };
  const account = accounts.find((entry) => entry.id === draft.accountId);
  const platform = account?.platform ?? 'instagram';
  const instagram = platform === 'instagram';
  const trigger = draft.trigger;
  const takesPost = trigger === 'comment' || trigger === 'story_reply';
  const takesReply = trigger === 'comment' || trigger === 'live_comment';
  const takesKeywords = trigger !== 'story_mention';
  const accountPosts = posts.filter((post) => post.accountId === draft.accountId && post.status !== 'failed');
  const [postMode, setPostMode] = useState<'any' | 'network' | 'harvest'>(initial.postId ? 'harvest' : initial.platformPostId ? 'network' : 'any');
  const postValue = postMode === 'harvest' && draft.postId ? `harvest:${draft.postId}` : postMode === 'harvest' ? 'any' : postMode;
  const [platformId, setPlatformId] = useState(initial.platformPostId ?? '');
  const dmLimit = draft.buttons.length > 0 ? AUTO_DM_LIMITS.dmWithButtons : AUTO_DM_LIMITS.dm;

  const setButton = (index: number, patch: Partial<AutoDmButton>) =>
    set({ buttons: draft.buttons.map((button, i) => (i === index ? { ...button, ...patch } as AutoDmButton : button)) });
  const setVersion = (key: 'dmMessageVariations' | 'commentReplyVariations', index: number, value: string) =>
    set({ [key]: draft[key].map((item, i) => (i === index ? value : item)) } as Partial<AutoDmInput>);

  const submit = async () => {
    setSaving(true); setError('');
    try {
      await onSave({
        ...draft,
        keywords: takesKeywords ? split(keywords) : [],
        excludeKeywords: takesKeywords ? split(exclude) : [],
        platformPostId: takesPost && postMode === 'network' ? platformId.trim() || null : null,
        postId: takesPost && postMode === 'harvest' ? draft.postId : null,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the automation.');
    } finally { setSaving(false); }
  };

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl" data-testid="auto-dm-editor">
        <SheetHeader>
          <SheetTitle>{isNew ? 'New automation' : `Edit ${initial.name}`}</SheetTitle>
          <SheetDescription>DM people who comment a keyword, reply to a story or mention you. Personalise with {'{{first_name}}'}, {'{{name}}'} or {'{{username}}'}.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          <Field label="Name"><Input value={draft.name} maxLength={AUTO_DM_LIMITS.name} onChange={(e) => set({ name: e.target.value })} className={TAP} placeholder="Free guide" /></Field>
          <Field label="Account" hint={isNew ? undefined : 'An automation stays on the account it was made for.'}>
            <Select value={draft.accountId} disabled={!isNew} onValueChange={(value) => {
              if (!value) return;
              const next = accounts.find((entry) => entry.id === value);
              setPostMode('any');
              set({ accountId: value, postId: null, platformPostId: null, postTitle: '', ...(next && !triggerAllowed(draft.trigger, next.platform) ? { trigger: 'comment' as AutoDmTrigger } : {}) });
            }}>
              <SelectTrigger aria-label="Account" className={TAP}><SelectValue>{account ? `${account.displayName} (${handle(account)})` : 'Pick an account'}</SelectValue></SelectTrigger>
              <SelectContent>{accounts.map((entry) => <SelectItem key={entry.id} value={entry.id}><PlatformLogo platform={entry.platform} className="size-3.5" decorative />{entry.displayName} ({handle(entry)})</SelectItem>)}</SelectContent>
            </Select>
          </Field>

          <Section title="When">
            <Field label="Trigger">
              <Select value={trigger} onValueChange={(value) => { if (value) { setPostMode('any'); set({ trigger: value as AutoDmTrigger, postId: null, platformPostId: null, postTitle: '' }); } }}>
                <SelectTrigger aria-label="Trigger" className={TAP}><SelectValue>{AUTO_DM_TRIGGER_LABELS[trigger]}</SelectValue></SelectTrigger>
                <SelectContent>{AUTO_DM_TRIGGERS.filter((t) => triggerAllowed(t, platform)).map((t) => <SelectItem key={t} value={t}>{AUTO_DM_TRIGGER_LABELS[t]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            {takesPost && (
              <Field label={trigger === 'story_reply' ? 'Which story' : 'Which post'}>
                <Select value={postValue} onValueChange={(value) => {
                  if (!value) return;
                  if (value === 'any' || value === 'network') { setPostMode(value); set({ postId: null, postTitle: '' }); return; }
                  const id = value.slice('harvest:'.length);
                  const post = accountPosts.find((p) => p.id === id);
                  setPostMode('harvest');
                  set({ postId: id, postTitle: post?.title ?? '' });
                }}>
                  <SelectTrigger aria-label="Which post" className={TAP}><SelectValue>{postValue === 'any' ? (trigger === 'story_reply' ? 'Any story' : 'Any post') : postValue === 'network' ? 'A post already on the network' : draft.postTitle || 'A Harvest post'}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">{trigger === 'story_reply' ? 'Any story' : 'Any post'}</SelectItem>
                    <SelectItem value="network">{trigger === 'story_reply' ? 'One story, by its ID' : 'A post already on the network, by its ID'}</SelectItem>
                    {trigger === 'comment' && accountPosts.map((post) => <SelectItem key={post.id} value={`harvest:${post.id}`}>{post.title || 'Untitled post'}{post.status === 'scheduled' ? ' (scheduled)' : post.status === 'draft' ? ' (draft)' : ''}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {takesPost && postValue === 'network' && (
              <Field label="Post ID" hint="The ID from the post's link or from Zernio.">
                <Input aria-label="Post ID" value={platformId} onChange={(e) => { setPlatformId(e.target.value); setError(''); }} className={TAP} />
              </Field>
            )}
            {postMode === 'harvest' && draft.postId && <p className="text-xs text-faint">A scheduled post arms this automation the moment it publishes.</p>}
          </Section>

          {takesKeywords && (
            <Section title="Keywords">
              <Field label="Keywords" hint="Separate with commas. Leave empty to answer every comment.">
                <Input value={keywords} onChange={(e) => { setKeywords(e.target.value); setError(''); }} className={TAP} placeholder="guide, pdf" />
              </Field>
              <Field label="Match">
                <Select value={draft.matchMode} onValueChange={(value) => { if (value) set({ matchMode: value as AutoDmInput['matchMode'] }); }}>
                  <SelectTrigger aria-label="Match" className={TAP}><SelectValue>{draft.matchMode === 'word' ? 'As a whole word' : draft.matchMode === 'exact' ? 'The whole comment, exactly' : 'Anywhere in the comment'}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="word">As a whole word</SelectItem>
                    <SelectItem value="contains">Anywhere in the comment</SelectItem>
                    <SelectItem value="exact">The whole comment, exactly</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Toggle label="Allow small typos" hint="Whole-word matching only." checked={draft.typoTolerance} disabled={draft.matchMode !== 'word'} onChange={(on) => set({ typoTolerance: on })} />
              <Field label="Skip comments containing" hint="Separate with commas."><Input value={exclude} onChange={(e) => { setExclude(e.target.value); setError(''); }} className={TAP} /></Field>
              {trigger !== 'story_reply' && <Toggle label="Also answer DMs with these keywords" checked={draft.alsoMatchInDms} onChange={(on) => set({ alsoMatchInDms: on })} />}
            </Section>
          )}

          <Section title="The DM">
            <Field label="Message" hint={`${draft.dmMessage.length}/${dmLimit}`}>
              <Textarea value={draft.dmMessage} rows={4} maxLength={dmLimit} onChange={(e) => set({ dmMessage: e.target.value })} placeholder="Hey {{first_name}}! Here is the guide." />
            </Field>
            {draft.dmMessageVariations.map((version, index) => (
              <div key={index} className="flex items-start gap-2">
                <Textarea aria-label={`DM version ${index + 2}`} value={version} rows={2} maxLength={dmLimit} onChange={(e) => setVersion('dmMessageVariations', index, e.target.value)} />
                <Button type="button" variant="ghost" className={TAP} onClick={() => set({ dmMessageVariations: draft.dmMessageVariations.filter((_, i) => i !== index) })}>Remove</Button>
              </div>
            ))}
            {draft.dmMessageVariations.length < AUTO_DM_LIMITS.variations && (
              <Button type="button" variant="outline" className={`self-start ${TAP}`} onClick={() => set({ dmMessageVariations: [...draft.dmMessageVariations, ''] })}>Add another version</Button>
            )}
            <p className="text-xs text-faint">With more than one version, each person gets one at random.</p>
            {draft.buttons.map((button, index) => (
              <div key={index} data-auto-dm-button={index} className="flex flex-col gap-2 rounded-lg border border-line p-3">
                <div className="flex gap-2">
                  <Select value={button.type} onValueChange={(value) => { if (value === 'url' || value === 'phone') setButton(index, { type: value }); }}>
                    <SelectTrigger aria-label={`Button ${index + 1} kind`} className={`w-28 ${TAP}`}><SelectValue>{button.type === 'phone' ? 'Call' : 'Link'}</SelectValue></SelectTrigger>
                    <SelectContent><SelectItem value="url">Link</SelectItem>{platform === 'facebook' && <SelectItem value="phone">Call</SelectItem>}</SelectContent>
                  </Select>
                  <Input aria-label={`Button ${index + 1} label`} value={button.title} maxLength={AUTO_DM_LIMITS.buttonTitle} placeholder="Label" onChange={(e) => setButton(index, { title: e.target.value })} className={TAP} />
                  <Button type="button" variant="ghost" className={TAP} onClick={() => set({ buttons: draft.buttons.filter((_, i) => i !== index) })}>Remove</Button>
                </div>
                {button.type === 'phone'
                  ? <Input aria-label={`Button ${index + 1} phone`} value={button.phone ?? ''} placeholder="+14155551234" onChange={(e) => setButton(index, { phone: e.target.value })} className={TAP} />
                  : <Input aria-label={`Button ${index + 1} link`} value={button.url ?? ''} placeholder="https://" onChange={(e) => setButton(index, { url: e.target.value })} className={TAP} />}
              </div>
            ))}
            {draft.buttons.length < AUTO_DM_LIMITS.buttons && (
              <Button type="button" variant="outline" className={`self-start ${TAP}`} onClick={() => set({ buttons: [...draft.buttons, { type: 'url', title: '', url: '' }] })}>Add a button</Button>
            )}
            <Toggle label="Track link clicks" hint="Links go through a tracked redirect, so clicks show in the overview." checked={draft.linkTracking} onChange={(on) => set({ linkTracking: on })} />
            <Field label="Wait before sending (minutes)" hint="0 sends straight away. Up to 24 hours.">
              <Input type="number" min={0} max={1440} value={Math.round(draft.dmDelaySeconds / 60)} onChange={(e) => set({ dmDelaySeconds: Math.max(0, Math.round(Number(e.target.value) || 0)) * 60 })} className={TAP} />
            </Field>
          </Section>

          {takesReply && (
            <Section title="Public reply">
              <Field label="Reply under the comment" hint="Optional. Lets everyone see you answered.">
                <Textarea value={draft.commentReply} rows={2} maxLength={AUTO_DM_LIMITS.reply} onChange={(e) => set({ commentReply: e.target.value })} placeholder="Check your DMs, {{first_name}}!" />
              </Field>
              {draft.commentReply && draft.commentReplyVariations.map((version, index) => (
                <div key={index} className="flex items-start gap-2">
                  <Textarea aria-label={`Reply version ${index + 2}`} value={version} rows={2} onChange={(e) => setVersion('commentReplyVariations', index, e.target.value)} />
                  <Button type="button" variant="ghost" className={TAP} onClick={() => set({ commentReplyVariations: draft.commentReplyVariations.filter((_, i) => i !== index) })}>Remove</Button>
                </div>
              ))}
              {draft.commentReply && draft.commentReplyVariations.length < AUTO_DM_LIMITS.variations && (
                <Button type="button" variant="outline" className={`self-start ${TAP}`} onClick={() => set({ commentReplyVariations: [...draft.commentReplyVariations, ''] })}>Add another version</Button>
              )}
              {draft.commentReply && (
                <Toggle label="Reply even when no DM goes out" hint="Off: reply only after the DM is sent." checked={draft.publicReplyPolicy === 'always'} onChange={(on) => set({ publicReplyPolicy: on ? 'always' : 'after_dm' })} />
              )}
            </Section>
          )}

          {instagram && (
            <Section title="Who gets it">
              <Field label="Followers">
                <Select value={draft.audience.followerStatus} onValueChange={(value) => { if (value) set({ audience: { ...draft.audience, followerStatus: value as AutoDmInput['audience']['followerStatus'] } }); }}>
                  <SelectTrigger aria-label="Followers" className={TAP}><SelectValue>{draft.audience.followerStatus === 'follower' ? 'Only followers' : draft.audience.followerStatus === 'non_follower' ? 'Only people who do not follow' : 'Everyone'}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Everyone</SelectItem>
                    <SelectItem value="follower">Only followers</SelectItem>
                    <SelectItem value="non_follower">Only people who do not follow</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="When Instagram will not say if they follow">
                <Select value={draft.audience.whenUnknown} onValueChange={(value) => { if (value) set({ audience: { ...draft.audience, whenUnknown: value as AutoDmInput['audience']['whenUnknown'] } }); }}>
                  <SelectTrigger aria-label="When unknown" className={TAP}><SelectValue>{draft.audience.whenUnknown === 'skip' ? 'Do not send' : draft.audience.whenUnknown === 'verify' ? 'Ask them to follow, then send' : 'Send anyway'}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="send">Send anyway</SelectItem>
                    <SelectItem value="skip">Do not send</SelectItem>
                    <SelectItem value="verify">Ask them to follow, then send</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Minimum followers" hint="Skip accounts smaller than this. Leave empty for no minimum.">
                <Input type="number" min={0} value={draft.audience.minFollowerCount ?? ''} onChange={(e) => set({ audience: { ...draft.audience, minFollowerCount: e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value))) } })} className={TAP} />
              </Field>
              <Toggle label="Tap to unlock" hint="Everyone first gets a message with a button; the real DM arrives when they tap it." checked={draft.audience.tapToUnlock} onChange={(on) => set({ audience: { ...draft.audience, tapToUnlock: on } })} />
              {(draft.audience.whenUnknown === 'verify' || draft.audience.tapToUnlock || draft.audience.followerStatus === 'follower') && (
                <>
                  <Field label="Follow message" hint="Leave empty for Zernio's default."><Textarea value={draft.followGate.message} rows={2} maxLength={AUTO_DM_LIMITS.gateText} onChange={(e) => set({ followGate: { ...draft.followGate, message: e.target.value } })} /></Field>
                  <Field label="Confirm button"><Input value={draft.followGate.buttonLabel} maxLength={AUTO_DM_LIMITS.buttonTitle} placeholder="I'm following" onChange={(e) => set({ followGate: { ...draft.followGate, buttonLabel: e.target.value } })} className={TAP} /></Field>
                  <Field label="Profile button" hint="Optional. Opens your profile."><Input value={draft.followGate.profileButtonLabel} maxLength={AUTO_DM_LIMITS.buttonTitle} onChange={(e) => set({ followGate: { ...draft.followGate, profileButtonLabel: e.target.value } })} className={TAP} /></Field>
                  <Field label="Not following yet"><Textarea value={draft.followGate.notFollowingMessage} rows={2} maxLength={AUTO_DM_LIMITS.gateText} onChange={(e) => set({ followGate: { ...draft.followGate, notFollowingMessage: e.target.value } })} /></Field>
                </>
              )}
            </Section>
          )}

          <Section title="Repeats">
            <Toggle label="DM the same person again on a new comment" hint="Off: each person gets this DM once." checked={draft.repeatMode === 'every_comment'} onChange={(on) => set({ repeatMode: on ? 'every_comment' : 'once', cooldownHours: on ? draft.cooldownHours : null })} />
            {draft.repeatMode === 'every_comment' && (
              <Field label="But not within (hours)" hint="Leave empty to answer every new comment.">
                <Input type="number" min={1} max={AUTO_DM_LIMITS.hours} value={draft.cooldownHours ?? ''} onChange={(e) => set({ cooldownHours: hoursOrNull(e.target.value) })} className={TAP} />
              </Field>
            )}
            <Field label="Skip an identical DM sent within (hours)" hint="Across all automations on this account. Leave empty to never skip.">
              <Input type="number" min={1} max={AUTO_DM_LIMITS.hours} value={draft.dedupeSameTextHours ?? ''} onChange={(e) => set({ dedupeSameTextHours: hoursOrNull(e.target.value) })} className={TAP} />
            </Field>
          </Section>

          {takesReply && (
            <Section title="On the comment">
              <Toggle label="Like the comment" hint={instagram ? 'On Instagram this needs the account connected through Facebook.' : undefined} checked={draft.likeComment} onChange={(on) => set({ likeComment: on })} />
              <Toggle label="Hide the comment" hint="After the DM goes out." checked={draft.hideComment} onChange={(on) => set({ hideComment: on })} />
            </Section>
          )}

          <Section title="Status">
            <Toggle label="On" hint="Off saves it paused." checked={draft.isActive} onChange={(on) => set({ isActive: on })} />
          </Section>
        </div>
        <SheetFooter className="sticky bottom-0 flex-row items-center justify-end border-t border-line bg-popover">
          {error && <p role="alert" className="mr-auto text-sm text-danger">{error}</p>}
          <Button type="button" variant="outline" className={TAP} onClick={onClose}>Cancel</Button>
          <Button type="button" className={TAP} disabled={saving} onClick={() => void submit()}>{saving ? 'Saving…' : isNew ? 'Create automation' : 'Save'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
