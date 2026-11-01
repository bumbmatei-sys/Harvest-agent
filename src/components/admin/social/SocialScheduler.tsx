'use client';

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { TabsContent } from '@/components/ui/tabs';
import { SegmentedTabs, SegmentedTabsList, SegmentedTabsTrigger } from '@/components/admin-shell/SegmentedTabs';
import { PageHeader, PageTabs } from '@/components/admin-shell/PageHeader';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  PLATFORM_FIELDS,
  PLATFORM_LABELS,
  SOCIAL_PLATFORMS,
  platformsSupportingMadeWithAi,
  type SocialPlatform,
} from '@/lib/social/platforms';
import { calendarDayKey, defaultCalendarDay, undatedDrafts } from '@/lib/social/calendar';
import { queueDate, queueTime, scheduledByDay, sentNewestFirst } from '@/lib/social/queue';
import type { AnalyticsRange, SocialAnalytics } from '@/lib/social/analytics';
import { dayHeader, hourLabel, shiftDay, weekDays, weekHours, weekSlots, weekTitle } from '@/lib/social/week';
import { isoToWallTime, wallTimeInZoneToIso, workspaceTimeZone } from '@/lib/social/schedule-time';
import type { SocialAccount, SocialPost, SocialTarget, SocialWorkspace } from '@/lib/social/types';
import { authFetch } from '@/utils/auth-fetch';
import { validateSocialMedia } from '@/lib/social/media-rules';
import { MediaAttachments, PostMediaThumb, attachmentsFromMedia, type Attachment } from './MediaAttachments';
import { SocialUpgradeWall } from './SocialUpgradeWall';
import { PostPreview } from './PostPreview';
import { SocialAnalyticsView, type AnalyticsLoader } from './SocialAnalyticsView';
import { SocialInboxView, type InboxApi } from './SocialInboxView';
import { SocialAutoDmView, type AutoDmApi } from './SocialAutoDmView';
import { newAutoDm, type AutoDmLog, type AutoDmRule } from '@/lib/social/auto-dm';
import { hasLogo, PlatformLogo, PlatformLogos } from './PlatformLogo';

export type SocialView = 'accounts' | 'compose' | 'calendar' | 'queue' | 'analytics' | 'inbox' | 'autodm';

export interface SocialScreenData extends SocialWorkspace {
  readonly entitled: boolean;
}

const CONTROL = 'min-h-11 sm:min-h-[38px]';
/** Same floor as CONTROL, at the select trigger's own attribute specificity so its h-8 does not stick. */
const SELECT_CONTROL = `${CONTROL} w-full data-[size=default]:h-11 sm:data-[size=default]:h-[38px]`;
const FIELD_CONTROL = `${CONTROL} h-11 w-full sm:h-[38px]`;
/** Eden size: 12.5px / 600, 14px inline padding. Colour is the Harvest action token. Height stays the existing 44/38 floor. */
const ACTION = `${CONTROL} rounded-lg px-3.5 text-[12.5px] font-semibold active:scale-[0.98]`;
const ACTION_PRIMARY = `${ACTION} bg-action text-action-foreground hover:bg-action-hover`;
const ACTION_SECONDARY = `${ACTION} border-transparent bg-action-secondary text-foreground hover:bg-action-secondary-hover`;
/** An Eden option row: bordered, rounded-xl, title on the left and its control on the right. */
const OPTION_ROW = 'flex items-center justify-between gap-3 rounded-xl border border-line bg-card px-3 py-2';
const OPTION_TITLE = 'text-[13px] font-medium text-strong';

const FRIENDLY_ERROR: Record<string, string> = {
  platform_not_offered: 'That platform is not offered.',
  youtube_needs_video: 'YouTube needs exactly one video.',
  tiktok_needs_video: 'TikTok needs exactly one video.',
  instagram_needs_media: 'Instagram needs at least one image or video.',
  media_invalid: 'Choose supported media: one video or images only.',
  media_too_many: 'Choose no more than 10 media files.',
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
  /** Runs once the post is saved, with the server's answer; returns a notice to show instead of doneNotice. */
  afterSave?: (body: unknown) => Promise<string | null>;
}

function friendlyError(error: unknown): string {
  if (typeof error === 'string' && FRIENDLY_ERROR[error]) return FRIENDLY_ERROR[error];
  return 'The post could not be saved.';
}

function futureIso(wall: string, timeZone: string, now = Date.now()): string | null {
  const iso = wallTimeInZoneToIso(wall, timeZone);
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed) || parsed <= now || parsed > now + MAX_SCHEDULE_MS) return null;
  return iso;
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

/** #584: the Inbox, from the server. */
async function inboxJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error('inbox_unavailable');
  return (await response.json()) as T;
}
const liveInboxApi: InboxApi = {
  list: async (kind) => inboxJson(await authFetch(`/api/social/inbox?kind=${kind}`)),
  thread: async (kind, id) => inboxJson(await authFetch(`/api/social/inbox/thread?kind=${kind}&id=${encodeURIComponent(id)}`)),
  reply: async (input) => { await inboxJson(await authFetch('/api/social/inbox/reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })); },
};

/** Auto-DM, from the server. A form mistake comes back with the server's own wording. */
async function autoDmJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as (T & { message?: unknown }) | null;
  if (!response.ok) throw new Error(typeof body?.message === 'string' ? body.message : 'Could not save the automation. Please try again.');
  return body as T;
}
const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const liveAutoDmApi: AutoDmApi = {
  list: async () => autoDmJson(await authFetch('/api/social/auto-dm')),
  save: async (id, input) => (await autoDmJson<{ rule: AutoDmRule }>(await authFetch(id ? `/api/social/auto-dm/${encodeURIComponent(id)}` : '/api/social/auto-dm', jsonInit(id ? 'PATCH' : 'POST', input)))).rule,
  remove: async (id) => { await autoDmJson(await authFetch(`/api/social/auto-dm/${encodeURIComponent(id)}`, { method: 'DELETE' })); },
  logs: async (id) => (await autoDmJson<{ logs: AutoDmLog[] }>(await authFetch(`/api/social/auto-dm/${encodeURIComponent(id)}/logs`))).logs,
};

/** #582: the Analytics tab's data, from the server. */
async function loadAnalytics(range: AnalyticsRange): Promise<SocialAnalytics> {
  const response = await authFetch(`/api/social/analytics?range=${range}`);
  if (!response.ok) throw new Error('analytics_unavailable');
  return (await response.json()) as SocialAnalytics;
}

export function SocialScheduler({
  initial,
  initialView = 'compose',
  planLoading = false,
  onUpgrade,
  analyticsLoader = loadAnalytics,
  inboxApi = liveInboxApi,
  autoDmApi = liveAutoDmApi,
}: {
  initial?: SocialScreenData;
  initialView?: SocialView;
  /** #582: where the Analytics tab reads from; the preview and tests pass sample data. */
  analyticsLoader?: AnalyticsLoader;
  /** #584: where the Inbox reads and replies; the preview and tests pass the sample inbox. */
  inboxApi?: InboxApi;
  /** Auto-DM's automations; the preview and tests pass the sample. */
  autoDmApi?: AutoDmApi;
  /**
   * The shell has not resolved the tenant's plan yet. The gate shows a loading
   * state until it has; it never guesses, because a guess that the server then
   * overrules is the flash this prop exists to prevent.
   */
  planLoading?: boolean;
  onUpgrade: () => void;
}) {
  const [data, setData] = useState<SocialScreenData | null>(initial ?? null);
  const [failed, setFailed] = useState(false);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [view, setView] = useState<SocialView>(initialView);
  const [content, setContent] = useState(initial?.posts.find((post) => post.status === 'draft')?.content ?? '');
  const [selected, setSelected] = useState<string[]>(
    initial
      ? [initial.accounts[0]?.platform].filter(Boolean) as string[]
      : [],
  );
  const [fields, setFields] = useState<FieldValues>(() => seedSelectDefaults({}, selected));
  const [madeWithAi, setMadeWithAi] = useState(false);
  // Auto-DM from the composer: DM people who comment a keyword on this post.
  const [autoDm, setAutoDm] = useState({ on: false, keywords: '', message: '', reply: '' });
  const [when, setWhen] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const publishKey = useRef<{ key: string; payloadHash: string } | null>(null);
  const [editing, setEditing] = useState<SocialPost | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [editAttachments, setEditAttachments] = useState<Attachment[]>([]);
  const [editText, setEditText] = useState('');
  const [editWhen, setEditWhen] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [showDrafts, setShowDrafts] = useState(true);
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
          // A 403 is three different answers: this ministry does not hold the
          // scheduler, this person may not use it, or the request named another
          // ministry. Only the first is an upgrade wall; showing it for the others
          // told a Ministry-plan admin to buy something their plan already includes.
          const body = await response.json().catch(() => ({}));
          if (cancelled) return;
          if (body?.error === 'social_scheduler_not_entitled') {
            setData({
              entitled: false,
              sample: false,
              profileId: '',
              timezone: 'UTC',
              accounts: [],
              posts: [],
            });
          } else {
            setForbidden(typeof body?.error === 'string' ? body.error : 'forbidden');
          }
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
        const first = accounts.find((account: { platform?: unknown }) => typeof account?.platform === 'string')?.platform;
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

  if (forbidden) {
    return (
      <Card className="m-4 lg:m-0" data-testid="social-forbidden">
        <CardHeader>
          <CardTitle>Social scheduling is not open to this account</CardTitle>
          <CardDescription>
            {forbidden === 'Admin access required'
              ? 'Your plan includes it, but only an admin with full access can open it. Ask the ministry owner, or verify your email address and sign in again.'
              : 'This request was refused for this account. Nothing was scheduled, and nothing was published.'}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!data || planLoading) {
    return (
      <div className="flex w-full flex-col gap-4 p-4 lg:p-0" data-testid="social-gate-loading" role="status" aria-label="Loading social scheduling">
        <span className="sr-only">Loading social accounts.</span>
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-64 w-full max-w-[640px]" />
      </div>
    );
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
    if (saving || pending || mediaBlocked) return;
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
      media: attachments.map(({ media }) => media),
    };
    const dmTargets = targets.filter((target) => target.platform === 'instagram' || target.platform === 'facebook');
    const dmKeywords = autoDm.keywords.split(',').map((word) => word.trim()).filter(Boolean);
    if (autoDm.on && dmTargets.length > 0 && (dmKeywords.length === 0 || !autoDm.message.trim())) {
      setNotice('Add a keyword and the DM for Auto-DM, or turn it off.');
      return;
    }
    const afterSave = autoDm.on && dmTargets.length > 0 ? async (body: unknown): Promise<string | null> => {
      const post = (body as { post?: SocialPost } | null)?.post;
      if (!post?.id) return 'Saved. Auto-DM was not attached; set it up under Auto-DM.';
      const failures: string[] = [];
      for (const target of dmTargets) {
        try {
          await autoDmApi.save(null, {
            ...newAutoDm(target.accountId),
            name: `Auto-DM: ${content.trim().slice(0, 40)}`,
            keywords: dmKeywords,
            dmMessage: autoDm.message.trim(),
            commentReply: autoDm.reply.trim(),
            postId: post.id,
            postTitle: content.trim().slice(0, 120),
          });
        } catch (caught) {
          failures.push(caught instanceof Error ? caught.message : 'unknown');
        }
      }
      if (failures.length === 0) return null;
      return `Saved. Auto-DM could not be attached (${failures[0]}). Set it up under Auto-DM.`;
    } : undefined;
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
      afterSave,
      applyLocal: () => {
        const post: SocialPost = {
          id: `local-${posts.length + 1}`,
          content: content.trim(),
          status: publishNow ? 'sent' : 'scheduled',
          scheduledFor: publishNow ? new Date().toISOString() : scheduledFor,
          timezone: zone,
          targets,
          media: attachments.map(({ media }) => media),
        };
        if (!data) return;
        setData({ ...data, posts: [post, ...posts] });
        setNotice(doneNotice);
        if (afterSave) void afterSave({ post }).then((notice) => { if (notice) setNotice(notice); });
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
      const afterNotice = pending.afterSave ? await pending.afterSave(body) : null;
      if (pending.afterSave) setAutoDm({ on: false, keywords: '', message: '', reply: '' });
      setNotice(afterNotice ?? pending.doneNotice);
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
  const drafts = undatedDrafts(posts);
  const week = weekDays(selectedDay);
  const slots = weekSlots(posts, week, zone);
  const hours = weekHours(slots);
  const media = attachments.map((item) => item.media);
  const mediaError = validateSocialMedia(media, []);
  const platformErrors = selected.map((platform) => validateSocialMedia(media, [platform as SocialPlatform])).filter((error) => error && error !== mediaError);
  const mediaBlocked = Boolean(mediaError || platformErrors.length || attachments.some((item) => item.progress !== undefined || item.error || !item.media.url));
  const editMedia = editAttachments.map((item) => item.media);
  const editMediaError = editing ? validateSocialMedia(editMedia, editing.targets.map((target) => target.platform)) : null;
  const editMediaBlocked = Boolean(editMediaError || editAttachments.some((item) => item.progress !== undefined || item.error || !item.media.url));

  return (
    <div className="flex w-full flex-col gap-6 p-4 lg:p-0" data-testid="social-scheduler">
      <PageHeader
        title="Social"
        subtitle={`Schedule a post to the accounts this ministry has connected. Timezone ${zone}.`}
        tabs={(
          <PageTabs
            label="Social sections"
            value={view}
            onValueChange={setView}
            items={[
              { value: 'accounts', label: 'Accounts' },
              { value: 'compose', label: 'Compose' },
              { value: 'calendar', label: 'Calendar' },
              { value: 'queue', label: 'Queue' },
              { value: 'inbox', label: 'Inbox' },
              { value: 'autodm', label: 'Auto-DM' },
              { value: 'analytics', label: 'Analytics' },
            ]}
          />
        )}
      />
      {data?.sample && (
        <p className="rounded-lg border border-line bg-card px-4 py-3 text-sm text-faint" data-testid="social-sample-banner">
          Sample accounts and posts. Nothing here is a real ministry, and nothing is published.
        </p>
      )}
      {notice && <p className="text-sm text-faint" role="status">{notice}</p>}

      <SegmentedTabs value={view} onValueChange={(next) => setView(next as SocialView)}>
        <TabsContent value="inbox" className="mt-4">
          {view === 'inbox' && <SocialInboxView api={inboxApi} accounts={accounts} />}
        </TabsContent>

        <TabsContent value="autodm" className="mt-4">
          {view === 'autodm' && <SocialAutoDmView api={autoDmApi} onOpenInbox={() => setView('inbox')} />}
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          {view === 'analytics' && <SocialAnalyticsView load={analyticsLoader} />}
        </TabsContent>

        <TabsContent value="accounts" className="mt-4">
          <AccountsPanel accounts={accounts} onConnect={connect} />
        </TabsContent>

        <TabsContent value="compose" className="mt-4">
          <div className="flex w-full flex-col items-center gap-4 lg:flex-row lg:items-start lg:justify-center" data-testid="social-compose-row">
          <Card className="w-full lg:max-w-[640px] lg:shrink-0" data-testid="social-composer">
            {/* #581: Eden's composer (docs/prd/screenshots/14-social-scheduler, 017):
                Post to, then the post itself, then each network's options. */}
            <CardContent className="flex flex-col gap-4 pt-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-semibold text-muted">Post to</span>
              <ToggleGroup
                  multiple
                  value={selected}
                  onValueChange={(next) => {
                    const chosen = next;
                    setSelected(chosen);
                    setFields((current) => seedSelectDefaults(current, chosen));
                  }}
                  aria-label="Platforms"
                  className="flex flex-wrap gap-1.5"
                >
                  {accounts.map((account) => (
                    <ToggleGroupItem key={account.id} value={account.platform} className={`${CONTROL} size-11 rounded-full border border-line p-0 sm:size-10`}>
                      {hasLogo(account.platform) ? <PlatformLogo platform={account.platform} className="size-4" /> : labelFor(account.platform)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              <div className="rounded-xl border border-line bg-card p-3">
                <MediaAttachments items={attachments} setItems={setAttachments}>
                <Textarea
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder="What do you want to say?"
                  className="min-h-32 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                  aria-label="Post text"
                />
                </MediaAttachments>
              </div>
              {selected.map((slug) => {
                const platform = slug as SocialPlatform;
                const specs = PLATFORM_FIELDS[platform] || [];
                if (specs.length === 0) return null;
                return (
                  <fieldset key={platform} className="flex flex-col gap-2" data-testid={`fields-${platform}`}>
                    <legend className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-strong"><PlatformLogo platform={platform} decorative />{labelFor(platform)}</legend>
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
              {(selected.includes('instagram') || selected.includes('facebook')) && (
                <div className="flex flex-col gap-3 rounded-lg border border-line p-3" data-testid="composer-auto-dm">
                  <div className={OPTION_ROW}>
                    <span className={OPTION_TITLE}>Auto-DM people who comment a keyword</span>
                    <Switch checked={autoDm.on} onCheckedChange={(on) => setAutoDm((current) => ({ ...current, on }))} aria-label="Auto-DM" />
                  </div>
                  {autoDm.on && (
                    <>
                      <p className="flex items-center gap-1.5 text-xs text-faint">
                        On <PlatformLogos platforms={selected.filter((slug): slug is SocialPlatform => slug === 'instagram' || slug === 'facebook')} className="size-3" /> once the post is live. More options under Auto-DM.
                      </p>
                      <Input className={`${FIELD_CONTROL} border-line bg-card px-3`} aria-label="Auto-DM keywords" placeholder="Keywords, separated by commas" value={autoDm.keywords} onChange={(event) => setAutoDm((current) => ({ ...current, keywords: event.target.value }))} />
                      <Textarea aria-label="Auto-DM message" rows={3} maxLength={1000} placeholder="Hey {{first_name}}! Here is the link." value={autoDm.message} onChange={(event) => setAutoDm((current) => ({ ...current, message: event.target.value }))} />
                      <Input className={`${FIELD_CONTROL} border-line bg-card px-3`} aria-label="Auto-DM public reply" placeholder="Public reply (optional): Check your DMs!" value={autoDm.reply} onChange={(event) => setAutoDm((current) => ({ ...current, reply: event.target.value }))} />
                    </>
                  )}
                </div>
              )}
              {mediaError && <p className="text-sm text-destructive" role="alert">{friendlyError(mediaError)}</p>}
              {platformErrors.map((error) => error && <p key={error} className="text-sm text-destructive" role="alert">{friendlyError(error)}</p>)}
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
                <Button type="button" className={ACTION_PRIMARY} disabled={saving || mediaBlocked} onClick={() => schedule(false)}>Schedule</Button>
                <Button type="button" variant="secondary" className={ACTION_SECONDARY} disabled={saving || mediaBlocked} onClick={() => schedule(true)}>Post now</Button>
              </div>
            </CardContent>
          </Card>
            <PostPreview
              content={content}
              mediaCount={attachments.length}
              accounts={accounts}
              platforms={selected.filter((slug): slug is SocialPlatform => (SOCIAL_PLATFORMS as readonly string[]).includes(slug))}
            />
          </div>
        </TabsContent>

        <TabsContent value="calendar" className="mt-4">
          {/* #581: Eden's week (docs/prd/screenshots/14-social-scheduler, 013-015). */}
          <section data-testid="social-calendar" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 data-testid="social-week-title" className="font-display text-xl font-semibold text-strong">{weekTitle(selectedDay)}</h2>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <Button type="button" variant="ghost" aria-pressed={showDrafts} className={`${CONTROL} h-auto px-2.5 text-xs font-semibold`} onClick={() => setShowDrafts((open) => !open)}>Drafts</Button>
                <span className="px-1 text-xs text-faint">{(zone.split('/').pop() ?? zone).replace(/_/g, ' ')}</span>
                <Button type="button" variant="ghost" aria-label="Previous week" className={`${CONTROL} h-auto px-2`} onClick={() => setPickedDay(shiftDay(selectedDay, -7))}>‹</Button>
                <Button type="button" variant="ghost" className={`${CONTROL} h-auto px-2.5 text-xs font-semibold`} onClick={() => setPickedDay(calendarDayKey(new Date().toISOString(), zone))}>Today</Button>
                <Button type="button" variant="ghost" aria-label="Next week" className={`${CONTROL} h-auto px-2`} onClick={() => setPickedDay(shiftDay(selectedDay, 7))}>›</Button>
                <Button type="button" className={ACTION_PRIMARY} onClick={() => setView('compose')}>+ New post</Button>
              </div>
            </div>
            <div className="flex flex-col gap-3 lg:flex-row">
              <ScrollArea className="min-w-0 flex-1 rounded-xl border border-line bg-surface-raised">
                <div className="grid min-w-[56rem] grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
                  <div />
                  {week.map((day) => {
                    const header = dayHeader(day);
                    return <div key={day} data-week-day={day} className="border-l border-line px-2 py-2 text-center text-xs text-muted">
                      {header.weekday} <span className="font-semibold text-strong">{header.day}</span>
                    </div>;
                  })}
                  {hours.map((hour) => (
                    <Fragment key={hour}>
                      <div className="border-t border-line px-1.5 py-1 text-right text-[11px] text-faint">{hourLabel(hour)}</div>
                      {week.map((day) => (
                        <div key={day} data-week-slot={`${day}@${hour}`} className="flex min-h-14 flex-col gap-1 border-l border-t border-line p-1">
                          {(slots.get(`${day}@${hour}`) ?? []).map((post) => (
                            <article key={post.id} data-week-post={post.id} className="rounded-md bg-card px-2 py-1.5 shadow-xs">
                              <p className="flex items-center gap-1.5 text-[11px] text-faint">{queueTime(post.scheduledFor, post.timezone || zone)} <PlatformLogos platforms={post.targets.map((target) => target.platform)} className="size-3" /></p>
                              <p className="line-clamp-2 text-xs text-strong">{post.content}</p>
                            </article>
                          ))}
                        </div>
                      ))}
                    </Fragment>
                  ))}
                </div>
              </ScrollArea>
              {showDrafts && <aside className="rounded-xl border border-line bg-surface-raised p-3 lg:w-72">
                <section data-testid="social-calendar-drafts">
                  <h2 className="mb-2 text-sm font-medium text-strong">Drafts</h2>
                  <ul className="flex flex-col gap-2">
                    {drafts.length === 0 && (
                      <li className="text-sm text-faint">No undated drafts.</li>
                    )}
                    {drafts.map((post) => (
                      <li key={post.id} className="rounded-lg border border-line px-3 py-2 text-sm text-strong"><PostMediaThumb media={post.media} />{post.content}</li>
                    ))}
                  </ul>
                </section>
              </aside>}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="queue" className="mt-4">
          <Queue
            posts={posts}
            timeZone={ministryZone(data?.timezone, browserZone)}
            onEdit={(post) => {
              setEditing(post);
              setEditError(null);
              setEditText(post.content);
              setEditAttachments(attachmentsFromMedia(post.media));
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
      </SegmentedTabs>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) { setEditing(null); setEditError(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit post</DialogTitle>
            <DialogDescription>A sent post cannot be edited.</DialogDescription>
          </DialogHeader>
          <Textarea value={editText} onChange={(event) => setEditText(event.target.value)} aria-label="Edit post text" className="min-h-24" />
          <MediaAttachments items={editAttachments} setItems={setEditAttachments} />
          {editMediaError && <p className="text-sm text-destructive" role="alert">{friendlyError(editMediaError)}</p>}
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
              disabled={editMediaBlocked}
              onClick={() => {
                if (!editing || editMediaBlocked) return;
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
                    media: editMedia,
                    publishNow: false,
                  },
                  doneNotice: 'Saved.',
                  applyLocal: () => {
                    if (!data) return;
                    setData({
                      ...data,
                      posts: posts.map((row) => row.id === post.id ? { ...row, content: editText, scheduledFor, media: editMedia } : row),
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
              <span className="flex items-center gap-2 text-sm text-strong"><PlatformLogo platform={account.platform} decorative />{labelFor(account.platform)}</span>
              <span className="text-sm text-faint">{account.displayName} · @{account.username}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2">
          <p className="text-sm text-faint">Connect another account</p>
          <div className="flex flex-wrap items-center gap-2">
            {SOCIAL_PLATFORMS.map((platform) => (
              <Button key={platform} type="button" variant="outline" className={`${CONTROL} gap-2`} data-testid={`connect-${platform}`} onClick={() => onConnect(platform)}>
                <PlatformLogo platform={platform} decorative />{labelFor(platform)}
              </Button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Queue({
  posts,
  timeZone,
  onEdit,
  onCancel,
}: {
  posts: readonly SocialPost[];
  timeZone: string;
  onEdit: (post: SocialPost) => void;
  onCancel: (post: SocialPost) => void;
}) {
  // #581: Eden's Queue — three columns, Drafts · Scheduled (by day) · Sent.
  const drafts = posts.filter((post) => post.status === 'draft');
  const days = scheduledByDay(posts, timeZone, new Date());
  const scheduledCount = days.reduce((n, day) => n + day.posts.length, 0);
  const sent = sentNewestFirst(posts);
  const platforms = (post: SocialPost) => <PlatformLogos platforms={post.targets.map((target) => target.platform)} />;
  // Drafts and scheduled posts only; a sent post has gone out.
  const actions = (post: SocialPost) => (
    <div className="mt-2 flex gap-1">
      <Button type="button" variant="ghost" className={`${CONTROL} h-auto px-2 text-xs font-semibold`} onClick={() => onEdit(post)}>Edit</Button>
      <Button type="button" variant="ghost" className={`${CONTROL} h-auto px-2 text-xs font-semibold text-muted`} onClick={() => onCancel(post)}>Cancel</Button>
    </div>
  );
  const column = (title: string, count: number, body: ReactNode, aside?: ReactNode) => (
    <section data-queue-column={title.toLowerCase()} className="flex min-w-0 flex-col rounded-xl border border-line bg-surface-raised">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-strong">{title}</h2>
        <span className="text-xs text-faint">{count}</span>
        {aside && <span className="ml-auto text-xs text-faint">{aside}</span>}
      </header>
      <ScrollArea className="h-[34rem]"><div className="flex flex-col gap-2 p-3">{body}</div></ScrollArea>
    </section>
  );
  const none = (what: string) => <p className="px-1 py-6 text-center text-sm text-faint">Nothing {what}.</p>;
  return (
    <div data-testid="social-queue" className="grid gap-3 lg:grid-cols-3">
      {column('Drafts', drafts.length, drafts.length === 0 ? none('in drafts') : drafts.map((post) => (
        <article key={post.id} data-queue-post={post.id} className="rounded-lg border border-line bg-card p-3">
          <div className="flex gap-3"><PostMediaThumb media={post.media} /><p className="line-clamp-3 text-sm text-strong">{post.content}</p></div>
          <p className="mt-1.5 text-xs text-faint">{platforms(post)}</p>
          {actions(post)}
        </article>
      )))}
      {column('Scheduled', scheduledCount, scheduledCount === 0 ? none('scheduled') : days.map((day) => (
        <div key={day.key} data-queue-day={day.key} className="flex flex-col gap-2">
          <h3 className="px-1 pt-1 text-sm font-semibold text-strong">{day.label} <span className="font-normal text-faint">{day.date}</span></h3>
          {day.posts.map((post) => (
            <article key={post.id} data-queue-post={post.id} className="rounded-lg border border-line bg-card p-3">
              <p className="text-xs font-semibold text-muted">{queueTime(post.scheduledFor, post.timezone || timeZone)}<span className="ml-1.5 font-normal text-faint">{platforms(post)}</span></p>
              <div className="mt-1 flex gap-3"><PostMediaThumb media={post.media} /><p className="line-clamp-3 text-sm text-strong">{post.content}</p></div>
              {actions(post)}
            </article>
          ))}
        </div>
      )), (timeZone.split('/').pop() ?? timeZone).replace(/_/g, ' '))}
      {column('Sent', sent.length, sent.length === 0 ? none('sent yet') : sent.map((post) => (
        <article key={post.id} data-queue-post={post.id} className="rounded-lg border border-line bg-card p-3">
          <p className="flex items-center gap-2 text-xs text-faint">
            <span className="rounded-md bg-surface-sunken px-1.5 py-0.5 font-semibold text-muted">Posted</span>
            {post.scheduledFor ? `${queueDate(post.scheduledFor, post.timezone || timeZone)}, ${queueTime(post.scheduledFor, post.timezone || timeZone)}` : ''}
          </p>
          <div className="mt-1.5 flex gap-3"><PostMediaThumb media={post.media} /><p className="line-clamp-4 text-sm text-strong">{post.content}</p></div>
          <p className="mt-1.5 text-xs text-faint">{platforms(post)}</p>
        </article>
      )))}
    </div>
  );
}
