'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar as CalendarIcon, ImagePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  PLATFORM_FIELDS,
  PLATFORM_LABELS,
  SOCIAL_PLATFORMS,
  platformsSupportingMadeWithAi,
  type SocialPlatform,
} from '@/lib/social/platforms';
import type { SocialAccount, SocialPost, SocialTarget, SocialWorkspace } from '@/lib/social/types';
import { authFetch } from '@/utils/auth-fetch';
import { SocialUpgradeWall } from './SocialUpgradeWall';

export type SocialView = 'accounts' | 'compose' | 'calendar' | 'queue';

export interface SocialScreenData extends SocialWorkspace {
  readonly entitled: boolean;
}

const CONTROL = 'min-h-11 sm:min-h-[38px]';

function dayKey(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function labelFor(platform: SocialPlatform): string {
  return PLATFORM_LABELS[platform];
}

function targetsFor(content: string, selected: readonly string[], accounts: readonly SocialAccount[]): SocialTarget[] {
  return selected.flatMap((slug) => {
    const platform = slug as SocialPlatform;
    const account = accounts.find((row) => row.platform === platform);
    if (!account) return [];
    return [{
      platform,
      accountId: account.id,
      text: content,
      fields: {},
      madeWithAi: false,
    }];
  });
}

export function SocialScheduler({
  initial,
  initialView = 'compose',
  onUpgrade,
}: {
  initial?: SocialScreenData;
  initialView?: SocialView;
  onUpgrade: () => void;
}) {
  const [data, setData] = useState<SocialScreenData | null>(initial ?? null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<SocialView>(initialView);
  const [content, setContent] = useState(initial?.posts.find((post) => post.status === 'draft')?.content ?? '');
  const [selected, setSelected] = useState<string[]>(
    initial ? [initial.accounts[0]?.platform].filter(Boolean) as string[] : [],
  );
  const [fields, setFields] = useState<Record<string, Record<string, string | boolean>>>({});
  const [madeWithAi, setMadeWithAi] = useState(false);
  const [when, setWhen] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const publishKey = useRef<string | null>(null);
  const [editing, setEditing] = useState<SocialPost | null>(null);
  const [editText, setEditText] = useState('');
  const [editWhen, setEditWhen] = useState('');
  const [cancelling, setCancelling] = useState<SocialPost | null>(null);
  const seededDay = initial?.posts.find((post) => post.scheduledFor)?.scheduledFor;
  const [day, setDay] = useState<Date | undefined>(
    seededDay ? new Date(seededDay) : initial ? new Date() : undefined,
  );

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    authFetch('/api/social/bootstrap')
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 503) {
          setUnavailable(true);
          return;
        }
        if (response.status === 403) {
          setData({
            entitled: false,
            sample: false,
            profileId: '',
            timezone: 'UTC',
            accounts: [],
            posts: [],
          });
          return;
        }
        if (!response.ok) {
          setFailed(true);
          return;
        }
        const body = await response.json();
        if (cancelled) return;
        setData({
          entitled: body.entitled !== false,
          sample: body.sample === true,
          profileId: '',
          timezone: typeof body.timezone === 'string' ? body.timezone : 'UTC',
          accounts: Array.isArray(body.accounts) ? body.accounts : [],
          posts: Array.isArray(body.posts) ? body.posts : [],
        });
        const first = Array.isArray(body.accounts) ? body.accounts[0]?.platform : null;
        if (typeof first === 'string') setSelected([first]);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [initial]);

  const accounts = data?.accounts ?? [];
  const posts = data?.posts ?? [];
  const aiPlatforms = platformsSupportingMadeWithAi(selected.filter((slug): slug is SocialPlatform =>
    (SOCIAL_PLATFORMS as readonly string[]).includes(slug)));

  const marked = useMemo(() => {
    return (data?.posts ?? [])
      .map((post) => dayKey(post.scheduledFor))
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(`${value}T12:00:00.000Z`));
  }, [data?.posts]);

  if (unavailable) {
    return (
      <Card className="m-4 lg:m-0" data-testid="social-unavailable">
        <CardHeader>
          <CardTitle>Social scheduling is not available</CardTitle>
          <CardDescription>Nothing was scheduled, and nothing was published.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (failed) {
    return (
      <Card className="m-4 lg:m-0" data-testid="social-error">
        <CardHeader>
          <CardTitle>Social posts could not be loaded</CardTitle>
          <CardDescription>Nothing was scheduled. Reload this page to try again.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!data) {
    return <p className="p-4 text-sm text-faint">Loading social accounts.</p>;
  }

  if (!data.entitled && !data.sample) {
    return <SocialUpgradeWall onUpgrade={onUpgrade} />;
  }

  const connected = new Set(accounts.map((account) => account.platform));
  const available = SOCIAL_PLATFORMS.filter((platform) => !connected.has(platform));

  async function refresh() {
    if (initial) return;
    const response = await authFetch('/api/social/bootstrap');
    if (!response.ok) {
      setFailed(true);
      return;
    }
    const body = await response.json();
    setData((current) => current && ({
      ...current,
      accounts: body.accounts,
      posts: body.posts,
      sample: body.sample === true,
    }));
  }

  async function schedule(publishNow: boolean) {
    if (saving) return;
    const targets = targetsFor(content, selected, accounts).map((target) => ({
      ...target,
      fields: fields[target.platform] || {},
      madeWithAi: madeWithAi && aiPlatforms.includes(target.platform),
    }));
    if (!content.trim() || targets.length === 0) {
      setNotice('Write the post and choose at least one connected account.');
      return;
    }
    if (initial) {
      const post: SocialPost = {
        id: `local-${posts.length + 1}`,
        content: content.trim(),
        status: publishNow ? 'sent' : when ? 'scheduled' : 'draft',
        scheduledFor: publishNow ? new Date().toISOString() : when || null,
        timezone: data?.timezone || 'UTC',
        targets,
        media: [],
      };
      setData({ ...data!, posts: [post, ...posts] });
      setNotice(publishNow ? 'Saved in this preview. Nothing was published.' : 'Saved in this preview.');
      return;
    }
    if (publishNow && !publishKey.current) publishKey.current = crypto.randomUUID();
    setSaving(true);
    try {
      const response = await authFetch('/api/social/posts', {
        method: 'POST',
        headers: publishNow && publishKey.current ? { 'Idempotency-Key': publishKey.current } : {},
        body: JSON.stringify({
          content,
          publishNow,
          scheduledFor: when || null,
          timezone: data?.timezone,
          targets,
          media: [],
        }),
      });
      if (response.status === 503) {
        setUnavailable(true);
        return;
      }
      if (!response.ok) {
        setFailed(true);
        return;
      }
      if (publishNow) publishKey.current = null;
      setNotice(data?.sample ? 'Saved in this preview. Nothing was published.' : 'Scheduled.');
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function connect(platform: SocialPlatform) {
    if (initial) {
      setNotice('This preview does not connect a real account.');
      return;
    }
    const response = await authFetch('/api/social/connect', {
      method: 'POST',
      body: JSON.stringify({ platform }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(body.error === 'platform_not_offered' ? 'That platform is not offered.' : 'The account could not be connected.');
      return;
    }
    setNotice(body.authUrl ? 'Continue in the window that opened.' : 'This preview does not connect a real account.');
    if (typeof body.authUrl === 'string' && body.authUrl) window.location.assign(body.authUrl);
  }

  const selectedDay = day ? day.toISOString().slice(0, 10) : null;
  const onDay = posts.filter((post) => dayKey(post.scheduledFor) === selectedDay);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 lg:p-0" data-testid="social-scheduler">
      <header>
        <h1 className="font-display text-4xl font-light tracking-tight text-strong">Social</h1>
        <p className="mt-2 text-sm text-faint">
          Schedule a post to the accounts this ministry has connected. Timezone {data.timezone}.
        </p>
      </header>
      {data.sample && (
        <p className="rounded-lg border border-line bg-card px-4 py-3 text-sm text-faint" data-testid="social-sample-banner">
          Sample accounts and posts. Nothing here is a real ministry, and nothing is published.
        </p>
      )}
      {notice && <p className="text-sm text-faint" role="status">{notice}</p>}

      <Tabs value={view} onValueChange={(next) => setView(next as SocialView)}>
        <TabsList className="h-auto">
          {(['accounts', 'compose', 'calendar', 'queue'] as const).map((id) => (
            <TabsTrigger key={id} value={id} className={CONTROL}>
              {id === 'accounts' ? 'Accounts' : id === 'compose' ? 'Compose' : id === 'calendar' ? 'Calendar' : 'Queue'}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="accounts" className="mt-4">
          <AccountsPanel accounts={accounts} available={available} onConnect={connect} />
        </TabsContent>

        <TabsContent value="compose" className="mt-4">
          <Card data-testid="social-composer">
            <CardHeader>
              <CardTitle className="font-display text-2xl font-semibold">New post</CardTitle>
              <CardDescription>One text, then the accounts that should carry it.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="What should this post say?"
                className="min-h-32"
                aria-label="Post text"
              />
              <ToggleGroup
                multiple
                value={selected}
                onValueChange={(next) => setSelected(next)}
                aria-label="Platforms"
                className="flex flex-wrap"
              >
                {accounts.map((account) => (
                  <ToggleGroupItem key={account.id} value={account.platform} className={CONTROL}>
                    {labelFor(account.platform)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {selected.map((slug) => {
                const platform = slug as SocialPlatform;
                const specs = PLATFORM_FIELDS[platform] || [];
                if (specs.length === 0) return null;
                return (
                  <fieldset key={platform} className="flex flex-col gap-2" data-testid={`fields-${platform}`}>
                    <legend className="text-sm font-medium text-strong">{labelFor(platform)}</legend>
                    {specs.map((field) => (
                      <label key={field.key} className="flex flex-col gap-1 text-sm text-faint">
                        {field.label}
                        {field.kind === 'boolean' ? (
                          <Switch
                            checked={fields[platform]?.[field.key] === true}
                            onCheckedChange={(checked) => setFields((current) => ({
                              ...current,
                              [platform]: { ...current[platform], [field.key]: checked },
                            }))}
                            aria-label={field.label}
                          />
                        ) : field.kind === 'select' ? (
                          <select
                            className={`${CONTROL} rounded-lg border border-line bg-card px-3 text-sm text-strong`}
                            value={String(fields[platform]?.[field.key] ?? field.options[0]?.value ?? '')}
                            aria-label={field.label}
                            onChange={(event) => setFields((current) => ({
                              ...current,
                              [platform]: { ...current[platform], [field.key]: event.target.value },
                            }))}
                          >
                            {field.options.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className={`${CONTROL} rounded-lg border border-line bg-card px-3 text-sm text-strong`}
                            value={String(fields[platform]?.[field.key] ?? '')}
                            aria-label={field.label}
                            onChange={(event) => setFields((current) => ({
                              ...current,
                              [platform]: { ...current[platform], [field.key]: event.target.value },
                            }))}
                          />
                        )}
                      </label>
                    ))}
                  </fieldset>
                );
              })}
              {aiPlatforms.length > 0 && (
                <label className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2" data-testid="made-with-ai">
                  <span className="text-sm text-strong">Made with AI</span>
                  <Switch checked={madeWithAi} onCheckedChange={setMadeWithAi} aria-label="Made with AI" />
                </label>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" className={CONTROL} disabled>
                  <ImagePlus className="size-4" aria-hidden />
                  Add media
                </Button>
                <p className="text-sm text-faint">Media upload is not available yet.</p>
              </div>
              <label className="flex flex-col gap-1 text-sm text-faint">
                Schedule time
                <input
                  type="datetime-local"
                  className={`${CONTROL} rounded-lg border border-line bg-card px-3 text-sm text-strong`}
                  value={when}
                  onChange={(event) => setWhen(event.target.value)}
                  aria-label="Schedule time"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="button" className={CONTROL} disabled={saving} onClick={() => schedule(false)}>Schedule</Button>
                <Button type="button" variant="outline" className={CONTROL} disabled={saving} onClick={() => schedule(true)}>Post now</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calendar" className="mt-4">
          <Card data-testid="social-calendar">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 font-display text-2xl font-semibold">
                <CalendarIcon className="size-5" aria-hidden />
                Calendar
              </CardTitle>
              <CardDescription>Scheduled posts in {data.timezone}.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 lg:flex-row">
              <Calendar
                mode="single"
                selected={day}
                onSelect={setDay}
                modifiers={{ scheduled: marked }}
                modifiersClassNames={{ scheduled: 'bg-muted font-semibold' }}
              />
              <ul className="flex flex-1 flex-col gap-2">
                {onDay.length === 0 && (
                  <li className="text-sm text-faint">No posts on this day.</li>
                )}
                {onDay.map((post) => (
                  <li key={post.id} className="rounded-lg border border-line px-3 py-2 text-sm text-strong">{post.content}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="queue" className="mt-4">
          <Queue
            posts={posts}
            onEdit={(post) => {
              setEditing(post);
              setEditText(post.content);
              setEditWhen(post.scheduledFor ? post.scheduledFor.slice(0, 16) : '');
            }}
            onCancel={setCancelling}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit post</DialogTitle>
            <DialogDescription>A sent post cannot be edited.</DialogDescription>
          </DialogHeader>
          <Textarea value={editText} onChange={(event) => setEditText(event.target.value)} aria-label="Edit post text" className="min-h-24" />
          <input
            type="datetime-local"
            className={`${CONTROL} rounded-lg border border-line bg-card px-3 text-sm`}
            value={editWhen}
            onChange={(event) => setEditWhen(event.target.value)}
            aria-label="New time"
          />
          <DialogFooter>
            <Button
              type="button"
              className={CONTROL}
              onClick={async () => {
                if (!editing) return;
                if (initial) {
                  setData({
                    ...data,
                    posts: posts.map((post) => post.id === editing.id ? { ...post, content: editText, scheduledFor: editWhen || post.scheduledFor } : post),
                  });
                  setEditing(null);
                  return;
                }
                const response = await authFetch(`/api/social/posts/${editing.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({
                    content: editText,
                    scheduledFor: editWhen || null,
                    timezone: data.timezone,
                    targets: editing.targets,
                    publishNow: false,
                  }),
                });
                if (!response.ok) setFailed(true);
                else await refresh();
                setEditing(null);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(cancelling)} onOpenChange={(open) => { if (!open) setCancelling(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this post?</DialogTitle>
            <DialogDescription>It will leave the queue. A sent post stays sent.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="destructive"
              className={CONTROL}
              onClick={async () => {
                if (!cancelling) return;
                if (initial) {
                  setData({ ...data, posts: posts.filter((post) => post.id !== cancelling.id) });
                  setCancelling(null);
                  return;
                }
                const response = await authFetch(`/api/social/posts/${cancelling.id}`, { method: 'DELETE' });
                if (!response.ok) setFailed(true);
                else await refresh();
                setCancelling(null);
              }}
            >
              Cancel post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AccountsPanel({
  accounts,
  available,
  onConnect,
}: {
  accounts: readonly SocialAccount[];
  available: readonly SocialPlatform[];
  onConnect: (platform: SocialPlatform) => void;
}) {
  return (
    <Card data-testid="social-accounts">
      <CardHeader>
        <CardTitle className="font-display text-2xl font-semibold">Connected accounts</CardTitle>
        <CardDescription>There is no limit on how many accounts a ministry connects.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2">
          {accounts.map((account) => (
            <li key={account.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
              <span className="text-sm text-strong">{labelFor(account.platform)}</span>
              <span className="text-sm text-faint">{account.displayName} · @{account.username}</span>
            </li>
          ))}
        </ul>
        {available.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-faint">Connect another account</p>
            <div className="flex flex-wrap gap-2">
              {available.map((platform) => (
                <Button key={platform} type="button" variant="outline" className={CONTROL} onClick={() => onConnect(platform)}>
                  {labelFor(platform)}
                </Button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Queue({
  posts,
  onEdit,
  onCancel,
}: {
  posts: readonly SocialPost[];
  onEdit: (post: SocialPost) => void;
  onCancel: (post: SocialPost) => void;
}) {
  const groups: { id: SocialPost['status']; label: string }[] = [
    { id: 'draft', label: 'Drafts' },
    { id: 'scheduled', label: 'Scheduled' },
    { id: 'sent', label: 'Sent' },
  ];
  return (
    <Card data-testid="social-queue">
      <CardHeader>
        <CardTitle className="font-display text-2xl font-semibold">Queue</CardTitle>
        <CardDescription>Drafts, scheduled posts, and posts that have gone out.</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[28rem]">
          <div className="flex flex-col gap-6">
            {groups.map((group) => {
              const rows = posts.filter((post) => post.status === group.id);
              return (
                <section key={group.id}>
                  <h2 className="mb-2 text-sm font-medium text-strong">{group.label}</h2>
                  {rows.length === 0 ? (
                    <Empty className="border-line">
                      <EmptyHeader>
                        <EmptyTitle>None</EmptyTitle>
                        <EmptyDescription>Nothing in {group.label.toLowerCase()}.</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {rows.map((post) => (
                        <li key={post.id} className="flex flex-col gap-2 rounded-lg border border-line px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm text-strong">{post.content}</p>
                            <p className="text-xs text-faint">
                              {post.targets.map((target) => labelFor(target.platform)).join(', ')}
                              {post.scheduledFor ? ` · ${post.scheduledFor.slice(0, 16).replace('T', ' ')}` : ''}
                            </p>
                          </div>
                          {post.status !== 'sent' && (
                            <div className="flex gap-2">
                              <Button type="button" variant="outline" className={CONTROL} onClick={() => onEdit(post)}>Edit</Button>
                              <Button type="button" variant="outline" className={CONTROL} onClick={() => onCancel(post)}>Cancel</Button>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
