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
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { calendarDayKey, defaultCalendarDay, postsOnCalendarDay, undatedDrafts } from '@/lib/social/calendar';
import { isoToWallTime, wallTimeInZoneToIso, workspaceTimeZone } from '@/lib/social/schedule-time';
import type { SocialAccount, SocialPost, SocialTarget, SocialWorkspace } from '@/lib/social/types';
import { authFetch } from '@/utils/auth-fetch';
import { SocialUpgradeWall } from './SocialUpgradeWall';

export type SocialView = 'accounts' | 'compose' | 'calendar' | 'queue';

export interface SocialScreenData extends SocialWorkspace {
  readonly entitled: boolean;
}

const CONTROL = 'min-h-11 sm:min-h-[38px]';
/** Same floor as CONTROL, at the select trigger's own attribute specificity so its h-8 does not stick. */
const SELECT_CONTROL = `${CONTROL} w-full data-[size=default]:h-11 sm:data-[size=default]:h-[38px]`;
const FIELD_CONTROL = `${CONTROL} h-11 w-full sm:h-[38px]`;
/** Eden: 12.5px / 600 buttons, 14px inline padding, a near-black primary and a black 5% secondary. */
const ACTION = `${CONTROL} rounded-lg px-3.5 text-[12.5px] font-semibold active:scale-[0.98]`;
const ACTION_PRIMARY = ACTION;
const ACTION_SECONDARY = `${ACTION} border-transparent bg-foreground/5 text-foreground hover:bg-foreground/10 dark:bg-foreground/10 dark:hover:bg-foreground/15`;
/** An Eden option row: bordered, rounded-xl, title on the left and its control on the right. */
const OPTION_ROW = 'flex items-center justify-between gap-3 rounded-xl border border-line bg-card px-3 py-2';
const OPTION_TITLE = 'text-[13px] font-medium text-strong';

/** Platforms that only post a video; upload does not exist yet, so the composer cannot select them. */
const VIDEO_ONLY: readonly string[] = ['youtube', 'tiktok'];

const FRIENDLY_ERROR: Record<string, string> = {
  platform_not_offered: 'That platform is not offered.',
  youtube_needs_video: 'YouTube posts need a video. They cannot be submitted until video upload is available.',
  tiktok_needs_video: 'TikTok posts need a video. They cannot be submitted until video upload is available.',
  media_not_accepted: 'Media upload is not available yet.',
  schedule_invalid: 'Choose a time in the future, within a year.',
  post_incomplete: 'Write the post and choose at least one connected account.',
  account_not_owned: 'That account is not connected to this ministry.',
  idempotency_key_required: 'The post could not be saved. Try again.',
  confirm_token_required: 'Confirm the post before it is sent.',
  confirm_invalid: 'That confirmation expired. Preview the post again.',
  post_not_editable: 'That post can no longer be changed.',
  social_unavailable: 'Social scheduling is not available right now. Nothing was scheduled.',
};

const MAX_SCHEDULE_MS = 366 * 24 * 60 * 60 * 1000;

interface PendingAction {
  title: string;
  description: string;
  url: string;
  method: string;
  payload: Record<string, unknown>;
  headers?: Record<string, string>;
  doneNotice: string;
  applyLocal: () => void;
}

function friendlyError(error: unknown): string {
  if (typeof error === 'string' && FRIENDLY_ERROR[error]) return FRIENDLY_ERROR[error];
  return 'The post could not be saved.';
}

function formatDayHeading(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  const noon = new Date(Date.UTC(year, (month || 1) - 1, day || 1, 12));
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(noon);
}

function futureIso(wall: string, timeZone: string, now = Date.now()): string | null {
  const iso = wallTimeInZoneToIso(wall, timeZone);
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed) || parsed <= now || parsed > now + MAX_SCHEDULE_MS) return null;
  return iso;
}

function dayFromKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function labelFor(platform: SocialPlatform): string {
  return PLATFORM_LABELS[platform];
}

function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone ? zone : 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Named workspace zones stay. UTC is the unset live sentinel. */
function ministryZone(reported: string | null | undefined, requested: string): string {
  return workspaceTimeZone(reported, requested);
}

type FieldValues = Record<string, Record<string, string | boolean>>;

/** Each Select shows its first option until the user picks, so that option is written into state when the platform is chosen. */
function seedSelectDefaults(current: FieldValues, platforms: readonly string[]): FieldValues {
  let next = current;
  for (const platform of platforms) {
    const specs = PLATFORM_FIELDS[platform as SocialPlatform] || [];
    for (const field of specs) {
      if (field.kind !== 'select') continue;
      const held = next[platform]?.[field.key];
      if (held !== undefined && held !== '') continue;
      const first = field.options[0]?.value;
      if (!first) continue;
      next = { ...next, [platform]: { ...next[platform], [field.key]: first } };
    }
  }
  return next;
}

/** Key order must not matter: the same fields entered in a different order are the same post. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(row[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function targetsFor(
  content: string,
  selected: readonly string[],
  accounts: readonly SocialAccount[],
  fields: FieldValues,
): SocialTarget[] {
  return selected.flatMap((slug) => {
    const platform = slug as SocialPlatform;
    const account = accounts.find((row) => row.platform === platform);
    if (!account) return [];
    return [{
      platform,
      accountId: account.id,
      text: content,
      fields: { ...fields[platform] },
      madeWithAi: false,
    }];
  });
}

export function SocialScheduler({
  initial,
  initialView = 'compose',
  knownEntitled = false,
  onUpgrade,
}: {
  initial?: SocialScreenData;
  initialView?: SocialView;
  /** The shell already knows the add-on or the super-admin bypass, so the composer can render before accounts arrive. */
  knownEntitled?: boolean;
  onUpgrade: () => void;
}) {
  const [data, setData] = useState<SocialScreenData | null>(initial ?? null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<SocialView>(initialView);
  const [content, setContent] = useState(initial?.posts.find((post) => post.status === 'draft')?.content ?? '');
  const [selected, setSelected] = useState<string[]>(
    initial
      ? [initial.accounts.find((account) => !VIDEO_ONLY.includes(account.platform))?.platform].filter(Boolean) as string[]
      : [],
  );
  const [fields, setFields] = useState<FieldValues>(() => seedSelectDefaults({}, selected));
  const [madeWithAi, setMadeWithAi] = useState(false);
  const [when, setWhen] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const publishKey = useRef<{ key: string; payloadHash: string } | null>(null);
  const [editing, setEditing] = useState<SocialPost | null>(null);
  const [editText, setEditText] = useState('');
  const [editWhen, setEditWhen] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmToken, setConfirmToken] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  // UTC matches the server render. The effect fills the browser zone after
  // mount, so the header does not hydrate one zone and paint another.
  const [browserZone, setBrowserZone] = useState('UTC');

  useEffect(() => {
    setBrowserZone(browserTimeZone());
  }, []);

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    authFetch('/api/social/bootstrap', { headers: { 'x-social-timezone': browserTimeZone() } })
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
        const accounts = Array.isArray(body.accounts) ? body.accounts : [];
        const first = accounts.find((account: { platform?: unknown }) => typeof account?.platform === 'string' && !VIDEO_ONLY.includes(account.platform))?.platform;
        if (typeof first === 'string') {
          setSelected([first]);
          setFields((current) => seedSelectDefaults(current, [first]));
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [initial]);

  useEffect(() => {
    if (!pending || initial) return;
    let cancelled = false;
    setPreviewing(true);
    setPreviewError(null);
    setConfirmToken(null);
    authFetch(pending.url, {
      method: pending.method,
      headers: pending.headers,
      body: JSON.stringify(pending.payload),
    }).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (cancelled) return;
      if (!response.ok || typeof body.confirmToken !== 'string') {
        setPreviewError(friendlyError(body.error));
        return;
      }
      setConfirmToken(body.confirmToken);
    }).catch(() => {
      if (!cancelled) setPreviewError('The post could not be saved.');
    }).finally(() => {
      if (!cancelled) setPreviewing(false);
    });
    return () => {
      cancelled = true;
    };
  }, [pending, initial]);

  const accounts = data?.accounts ?? [];
  const posts = data?.posts ?? [];
  const aiPlatforms = platformsSupportingMadeWithAi(selected.filter((slug): slug is SocialPlatform =>
    (SOCIAL_PLATFORMS as readonly string[]).includes(slug)));

  const marked = useMemo(() => {
    const zone = ministryZone(data?.timezone, browserZone);
    return (data?.posts ?? [])
      .map((post) => calendarDayKey(post.scheduledFor, zone))
      .filter((value): value is string => Boolean(value))
      .map((value) => dayFromKey(value));
  }, [browserZone, data?.posts, data?.timezone]);

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

  const accountsLoading = !data && knownEntitled && !initial;
  if (!data && !accountsLoading) {
    return <p className="p-4 text-sm text-faint">Loading social accounts.</p>;
  }

  if (data && !data.entitled && !data.sample) {
    return <SocialUpgradeWall onUpgrade={onUpgrade} />;
  }

  async function refresh() {
    if (initial) return;
    const response = await authFetch('/api/social/bootstrap', { headers: { 'x-social-timezone': browserTimeZone() } });
    if (!response.ok) {
      setNotice('The list could not be refreshed. The post you wrote is still here.');
      return;
    }
    const body = await response.json();
    setData((current) => current && ({
      ...current,
      accounts: body.accounts,
      posts: body.posts,
      sample: body.sample === true,
      timezone: typeof body.timezone === 'string' ? body.timezone : current.timezone,
    }));
  }

  function ask(action: PendingAction) {
    setPreviewError(null);
    setConfirmToken(null);
    setPending(action);
  }

  function schedule(publishNow: boolean) {
    if (saving || pending) return;
    const targets = targetsFor(content, selected, accounts, fields).map((target) => ({
      ...target,
      madeWithAi: madeWithAi && aiPlatforms.includes(target.platform),
    }));
    if (!content.trim() || targets.length === 0) {
      setNotice('Write the post and choose at least one connected account.');
      return;
    }
    const zone = ministryZone(data?.timezone, browserZone);
    let scheduledFor: string | null = null;
    if (!publishNow) {
      scheduledFor = when ? futureIso(when, zone) : null;
      if (!scheduledFor) {
        setNotice('Choose a time in the future, within a year.');
        return;
      }
    }
    const payload = {
      content,
      publishNow,
      scheduledFor,
      timezone: zone,
      targets,
      media: [],
    };
    const payloadHash = canonicalJson(payload);
    if (!publishKey.current || publishKey.current.payloadHash !== payloadHash) {
      publishKey.current = { key: crypto.randomUUID(), payloadHash };
    }
    const headers = { 'Idempotency-Key': publishKey.current.key };
    const doneNotice = data?.sample || initial
      ? 'Saved in this preview. Nothing was published.'
      : (publishNow ? 'Posted.' : 'Scheduled.');
    ask({
      title: publishNow ? 'Post this now?' : 'Schedule this post?',
      description: publishNow
        ? 'Nothing is sent until you confirm.'
        : `Scheduled for ${when.replace('T', ' ')} (${zone}). Nothing is sent until you confirm.`,
      url: '/api/social/posts',
      method: 'POST',
      payload,
      headers,
      doneNotice,
      applyLocal: () => {
        const post: SocialPost = {
          id: `local-${posts.length + 1}`,
          content: content.trim(),
          status: publishNow ? 'sent' : 'scheduled',
          scheduledFor: publishNow ? new Date().toISOString() : scheduledFor,
          timezone: zone,
          targets,
          media: [],
        };
        if (!data) return;
        setData({ ...data, posts: [post, ...posts] });
        setNotice(doneNotice);
      },
    });
  }

  async function confirmPending() {
    if (!pending || saving) return;
    if (initial) {
      pending.applyLocal();
      setPending(null);
      return;
    }
    if (!confirmToken) return;
    setSaving(true);
    try {
      const saved = await authFetch(pending.url, {
        method: pending.method,
        headers: pending.headers,
        body: JSON.stringify({ ...pending.payload, confirmToken }),
      });
      const body = await saved.json().catch(() => ({}));
      if (!saved.ok) {
        setPreviewError(friendlyError(body.error));
        return;
      }
      if (pending.url === '/api/social/posts' && pending.method === 'POST') publishKey.current = null;
      setNotice(pending.doneNotice);
      setPending(null);
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

  const zone = ministryZone(data?.timezone, browserZone);
  const selectedDay = pickedDay ?? defaultCalendarDay(posts, zone, new Date());
  const onDay = postsOnCalendarDay(posts, selectedDay, zone);
  const drafts = undatedDrafts(posts);
  const videoOnlySelected = selected.some((slug) => VIDEO_ONLY.includes(slug));

  return (
    <div className="flex w-full flex-col gap-6 p-4 lg:p-0" data-testid="social-scheduler">
      <header>
        <h1 className="font-display text-4xl font-light tracking-tight text-strong">Social</h1>
        <p className="mt-2 text-sm text-faint">
          Schedule a post to the accounts this ministry has connected. Timezone {zone}.
        </p>
      </header>
      {data?.sample && (
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
          <AccountsPanel accounts={accounts} onConnect={connect} />
        </TabsContent>

        <TabsContent value="compose" className="mt-4">
          <div className="flex w-full flex-col items-center gap-4 lg:flex-row lg:items-start lg:justify-center" data-testid="social-compose-row">
          <Card className="w-full lg:max-w-[640px] lg:shrink-0" data-testid="social-composer">
            <CardHeader>
              <CardTitle className="font-display text-2xl font-semibold">New post</CardTitle>
              <CardDescription>One text, then the accounts that should carry it.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {accountsLoading && (
                <p className="text-sm text-faint" data-testid="social-accounts-loading">Loading social accounts.</p>
              )}
              <Textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="What should this post say?"
                className="min-h-32"
                aria-label="Post text"
              />
              <ToggleGroup
                multiple
                value={selected.filter((slug) => !VIDEO_ONLY.includes(slug))}
                onValueChange={(next) => {
                  const chosen = next.filter((slug) => !VIDEO_ONLY.includes(slug));
                  setSelected(chosen);
                  setFields((current) => seedSelectDefaults(current, chosen));
                }}
                aria-label="Platforms"
                className="flex flex-wrap"
              >
                {accounts.filter((account) => !VIDEO_ONLY.includes(account.platform)).map((account) => (
                  <ToggleGroupItem key={account.id} value={account.platform} className={CONTROL}>
                    {labelFor(account.platform)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" className={CONTROL} disabled data-testid="youtube-posting-disabled">
                  YouTube
                </Button>
                <Button type="button" variant="outline" className={CONTROL} disabled data-testid="tiktok-posting-disabled">
                  TikTok
                </Button>
                <p className="text-sm text-faint" data-testid="youtube-coming-soon">Video upload coming soon</p>
              </div>
              {selected.map((slug) => {
                const platform = slug as SocialPlatform;
                const specs = PLATFORM_FIELDS[platform] || [];
                if (specs.length === 0) return null;
                return (
                  <fieldset key={platform} className="flex flex-col gap-2" data-testid={`fields-${platform}`}>
                    <legend className="mb-2 text-[13px] font-semibold text-strong">{labelFor(platform)}</legend>
                    {specs.map((field) => {
                      const FieldWrap = field.kind === 'select' ? 'div' : 'label';
                      const inline = field.kind !== 'text';
                      return (
                      <FieldWrap
                        key={field.key}
                        className={inline ? OPTION_ROW : 'flex flex-col gap-1.5 rounded-xl border border-line bg-card px-3 py-2'}
                      >
                        <span className={OPTION_TITLE}>{field.label}</span>
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
                          <Select
                            value={String(fields[platform]?.[field.key] ?? '')}
                            onValueChange={(value: unknown) => {
                              if (typeof value !== 'string') return;
                              setFields((current) => ({
                                ...current,
                                [platform]: { ...current[platform], [field.key]: value },
                              }));
                            }}
                          >
                            <SelectTrigger
                              className={`${SELECT_CONTROL} w-44 border-transparent bg-foreground/5 px-3 text-[13px] text-strong dark:bg-foreground/10`}
                              aria-label={field.label}
                            >
                              <SelectValue>
                                {(value: unknown) => {
                                  const current = String(value ?? '');
                                  return field.options.find((option) => option.value === current)?.label ?? current;
                                }}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent alignItemWithTrigger={false} align="end" className="min-w-44 rounded-xl">
                              {field.options.map((option) => (
                                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            className={`${FIELD_CONTROL} border-line bg-background px-3 text-strong`}
                            value={String(fields[platform]?.[field.key] ?? '')}
                            aria-label={field.label}
                            onChange={(event) => setFields((current) => ({
                              ...current,
                              [platform]: { ...current[platform], [field.key]: event.target.value },
                            }))}
                          />
                        )}
                      </FieldWrap>
                      );
                    })}
                  </fieldset>
                );
              })}
              {aiPlatforms.length > 0 && (
                <label className={OPTION_ROW} data-testid="made-with-ai">
                  <span className={OPTION_TITLE}>Made with AI</span>
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
              <label className="flex flex-col gap-1.5 text-[13px] font-medium text-strong">
                Schedule time
                <Input
                  type="datetime-local"
                  className={`${FIELD_CONTROL} border-line bg-card px-3 text-strong`}
                  value={when}
                  onChange={(event) => setWhen(event.target.value)}
                  aria-label="Schedule time"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="button" className={ACTION_PRIMARY} disabled={saving || videoOnlySelected || accountsLoading} onClick={() => schedule(false)}>Schedule</Button>
                <Button type="button" variant="secondary" className={ACTION_SECONDARY} disabled={saving || videoOnlySelected || accountsLoading} onClick={() => schedule(true)}>Post now</Button>
              </div>
              {videoOnlySelected && (
                <p className="text-sm text-faint" data-testid="youtube-needs-video">
                  Video upload coming soon
                </p>
              )}
            </CardContent>
          </Card>
            <SidePanel posts={posts} />
          </div>
        </TabsContent>

        <TabsContent value="calendar" className="mt-4">
          <Card data-testid="social-calendar">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 font-display text-2xl font-semibold">
                <CalendarIcon className="size-5" aria-hidden />
                Calendar
              </CardTitle>
              <CardDescription>Scheduled posts in {zone}.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 lg:flex-row">
              <Calendar
                mode="single"
                selected={dayFromKey(selectedDay)}
                onSelect={(next) => {
                  if (!next) return;
                  const month = String(next.getMonth() + 1).padStart(2, '0');
                  const day = String(next.getDate()).padStart(2, '0');
                  setPickedDay(`${next.getFullYear()}-${month}-${day}`);
                }}
                modifiers={{ scheduled: marked }}
                modifiersClassNames={{ scheduled: 'bg-muted font-semibold' }}
              />
              <div className="flex flex-1 flex-col gap-4">
                <section>
                  <h2 className="mb-2 text-sm font-medium text-strong" data-testid="social-day-heading">{formatDayHeading(selectedDay)}</h2>
                  <ul className="flex flex-col gap-2" data-testid="social-day-posts">
                    {onDay.length === 0 && (
                      <li className="text-sm text-faint">No posts on this day.</li>
                    )}
                    {onDay.map((post) => (
                      <li key={post.id} className="rounded-lg border border-line px-3 py-2 text-sm text-strong">{post.content}</li>
                    ))}
                  </ul>
                </section>
                <section data-testid="social-calendar-drafts">
                  <h2 className="mb-2 text-sm font-medium text-strong">Drafts</h2>
                  <ul className="flex flex-col gap-2">
                    {drafts.length === 0 && (
                      <li className="text-sm text-faint">No undated drafts.</li>
                    )}
                    {drafts.map((post) => (
                      <li key={post.id} className="rounded-lg border border-line px-3 py-2 text-sm text-strong">{post.content}</li>
                    ))}
                  </ul>
                </section>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="queue" className="mt-4">
          <Queue
            posts={posts}
            onEdit={(post) => {
              setEditing(post);
              setEditError(null);
              setEditText(post.content);
              const zone = post.timezone || ministryZone(data?.timezone, browserZone);
              setEditWhen(post.scheduledFor ? isoToWallTime(post.scheduledFor, zone) : '');
            }}
            onCancel={(post) => {
              ask({
                title: 'Cancel this post?',
                description: 'It will leave the queue when you confirm. Nothing is changed before that.',
                url: `/api/social/posts/${post.id}`,
                method: 'DELETE',
                payload: {},
                doneNotice: 'Cancelled.',
                applyLocal: () => {
                  if (!data) return;
                  setData({ ...data, posts: posts.filter((row) => row.id !== post.id) });
                  setNotice('Cancelled.');
                },
              });
            }}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) { setEditing(null); setEditError(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit post</DialogTitle>
            <DialogDescription>A sent post cannot be edited.</DialogDescription>
          </DialogHeader>
          <Textarea value={editText} onChange={(event) => setEditText(event.target.value)} aria-label="Edit post text" className="min-h-24" />
          <Input
            type="datetime-local"
            className={`${FIELD_CONTROL} border-line bg-card px-3`}
            value={editWhen}
            onChange={(event) => setEditWhen(event.target.value)}
            aria-label="New time"
          />
          {editError && (
            <p className="text-sm text-faint" role="alert" data-testid="social-edit-error">{editError}</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              className={CONTROL}
              onClick={() => {
                if (!editing) return;
                const zone = editing.timezone || ministryZone(data?.timezone, browserZone);
                const scheduledFor = editWhen ? futureIso(editWhen, zone) : null;
                if (editWhen && !scheduledFor) {
                  setEditError('Choose a time in the future, within a year.');
                  return;
                }
                if (editing.scheduledFor && !scheduledFor) {
                  setEditError('Choose a time in the future, within a year.');
                  return;
                }
                setEditError(null);
                const post = editing;
                setEditing(null);
                ask({
                  title: 'Save this edit?',
                  description: 'Nothing is changed until you confirm.',
                  url: `/api/social/posts/${post.id}`,
                  method: 'PATCH',
                  payload: {
                    content: editText,
                    scheduledFor,
                    timezone: zone,
                    targets: post.targets,
                    publishNow: false,
                  },
                  doneNotice: 'Saved.',
                  applyLocal: () => {
                    if (!data) return;
                    setData({
                      ...data,
                      posts: posts.map((row) => row.id === post.id ? { ...row, content: editText, scheduledFor } : row),
                    });
                    setNotice('Saved.');
                  },
                });
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(pending)} onOpenChange={(open) => { if (!open) setPending(null); }}>
        <DialogContent data-testid="social-confirm-dialog">
          <DialogHeader>
            <DialogTitle>{pending?.title}</DialogTitle>
            <DialogDescription>{pending?.description}</DialogDescription>
          </DialogHeader>
          {previewError && (
            <p className="text-sm text-faint" role="alert" data-testid="social-confirm-error">{previewError}</p>
          )}
          {previewing && <p className="text-sm text-faint">Checking this post.</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" className={ACTION_SECONDARY} onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              className={ACTION_PRIMARY}
              disabled={saving || previewing || (!initial && !confirmToken)}
              onClick={() => { void confirmPending(); }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SidePanel({ posts }: { posts: readonly SocialPost[] }) {
  const [tab, setTab] = useState<'draft' | 'scheduled' | 'sent'>('draft');
  const labels = { draft: 'Drafts', scheduled: 'Scheduled', sent: 'Sent' } as const;
  const rows = posts.filter((post) => post.status === tab);
  return (
    <aside
      className="hidden w-80 shrink-0 gap-3 rounded-xl border border-line bg-card p-3 lg:flex lg:flex-col"
      data-testid="social-side-panel"
    >
      <Tabs
        value={tab}
        onValueChange={(next) => {
          if (next === 'draft' || next === 'scheduled' || next === 'sent') setTab(next);
        }}
        className="gap-0"
      >
        <TabsList
          aria-label="Drafts, scheduled and sent"
          className="h-auto w-full rounded-xl bg-foreground/[0.045] p-1 group-data-[orientation=horizontal]/tabs:h-auto"
        >
          {(Object.keys(labels) as Array<keyof typeof labels>).map((id) => (
            <TabsTrigger
              key={id}
              value={id}
              className={`${CONTROL} h-auto flex-1 rounded-lg px-2 text-[13px] font-medium text-faint data-active:bg-card data-active:text-strong data-active:shadow-[0_1px_2px_rgba(0,0,0,0.08)] dark:data-active:border-transparent dark:data-active:bg-foreground/10`}
            >
              {labels[id]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <ul className="flex flex-col gap-2">
        {rows.length === 0 && <li className="px-1 text-sm text-faint">Nothing in {labels[tab].toLowerCase()}.</li>}
        {rows.map((post) => (
          <li key={post.id} className="rounded-xl border border-line bg-background px-3 py-2 text-sm text-strong">{post.content}</li>
        ))}
      </ul>
    </aside>
  );
}

function AccountsPanel({
  accounts,
  onConnect,
}: {
  accounts: readonly SocialAccount[];
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
              {account.platform === 'youtube' && (
                <span className="text-sm text-faint">Video upload coming soon</span>
              )}
              <span className="text-sm text-faint">{account.displayName} · @{account.username}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2">
          <p className="text-sm text-faint">Connect another account</p>
          <div className="flex flex-wrap items-center gap-2">
            {SOCIAL_PLATFORMS.map((platform) => (
              platform === 'youtube' ? (
                <Button key={platform} type="button" variant="outline" className={CONTROL} disabled data-testid="connect-youtube">
                  {labelFor(platform)}
                </Button>
              ) : (
                <Button key={platform} type="button" variant="outline" className={CONTROL} data-testid={`connect-${platform}`} onClick={() => onConnect(platform)}>
                  {labelFor(platform)}
                </Button>
              )
            ))}
            <p className="text-sm text-faint" data-testid="connect-youtube-note">Video upload coming soon</p>
          </div>
        </div>
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
                              {post.scheduledFor ? ` · ${isoToWallTime(post.scheduledFor, post.timezone || 'UTC').replace('T', ' ')}` : ''}
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
