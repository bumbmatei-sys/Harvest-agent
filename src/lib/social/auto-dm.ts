/**
 * Auto-DM: Zernio comment-to-DM automations (POST/GET /v1/comment-automations,
 * /comment-automations/{id}, /comment-automations/{id}/logs).
 *
 * When someone comments a keyword on a post or reel, replies to a story,
 * mentions the account in a story or comments during a live, Zernio sends them
 * a private DM and, if asked, a public reply. Instagram and Facebook only:
 * those are the two networks with a private reply to a comment.
 *
 * Every field Zernio offers is here except two that need a Zernio workflow or
 * a product catalogue (postback buttons and product cards). Each DM sent is one
 * Zernio outbound message (10,000 a month free across the account, then $1 per
 * 10,000), the same meter as Inbox replies.
 *
 * The reader accepts only what it needs and drops a row it cannot read, so a
 * provider shape change shows less rather than breaking the page.
 */

export const AUTO_DM_PLATFORMS = ['instagram', 'facebook'] as const;
export type AutoDmPlatform = typeof AUTO_DM_PLATFORMS[number];

export const AUTO_DM_TRIGGERS = ['comment', 'story_reply', 'story_mention', 'live_comment'] as const;
export type AutoDmTrigger = typeof AUTO_DM_TRIGGERS[number];

export const AUTO_DM_TRIGGER_LABELS: Record<AutoDmTrigger, string> = {
  comment: 'Comments on a post or reel',
  story_reply: 'Replies to a story',
  story_mention: 'Story mentions',
  live_comment: 'Comments during a live',
};

export const AUTO_DM_MATCH_MODES = ['contains', 'word', 'exact'] as const;
export type AutoDmMatchMode = typeof AUTO_DM_MATCH_MODES[number];

export const AUTO_DM_LIMITS = {
  name: 80,
  keywords: 20,
  keyword: 50,
  dm: 1000,
  dmWithButtons: 640,
  variations: 5,
  buttons: 3,
  buttonTitle: 20,
  reply: 1000,
  gateText: 640,
  delaySeconds: 86_400,
  hours: 720,
} as const;

export interface AutoDmButton {
  readonly type: 'url' | 'phone';
  readonly title: string;
  readonly url?: string;
  readonly phone?: string;
}

export interface AutoDmAudience {
  readonly followerStatus: 'any' | 'follower' | 'non_follower';
  readonly minFollowerCount: number | null;
  readonly whenUnknown: 'send' | 'skip' | 'verify';
  readonly tapToUnlock: boolean;
}

export interface AutoDmFollowGate {
  readonly message: string;
  readonly buttonLabel: string;
  readonly profileButtonLabel: string;
  readonly notFollowingMessage: string;
}

/** What an admin sets. The account is fixed once the automation exists. */
export interface AutoDmInput {
  readonly accountId: string;
  readonly name: string;
  readonly trigger: AutoDmTrigger;
  /** The live post (platform id) or upcoming Harvest post (Zernio id); both null for any post. */
  readonly platformPostId: string | null;
  readonly postId: string | null;
  readonly postTitle: string;
  readonly keywords: readonly string[];
  readonly matchMode: AutoDmMatchMode;
  readonly excludeKeywords: readonly string[];
  readonly typoTolerance: boolean;
  readonly alsoMatchInDms: boolean;
  readonly dmMessage: string;
  readonly dmMessageVariations: readonly string[];
  readonly buttons: readonly AutoDmButton[];
  readonly linkTracking: boolean;
  readonly dmDelaySeconds: number;
  readonly commentReply: string;
  readonly commentReplyVariations: readonly string[];
  readonly publicReplyPolicy: 'after_dm' | 'always';
  readonly commentReplyDelaySeconds: number;
  readonly audience: AutoDmAudience;
  readonly followGate: AutoDmFollowGate;
  readonly repeatMode: 'once' | 'every_comment';
  readonly cooldownHours: number | null;
  readonly dedupeSameTextHours: number | null;
  readonly likeComment: boolean;
  readonly hideComment: boolean;
  readonly isActive: boolean;
}

export interface AutoDmStats {
  readonly triggered: number | null;
  readonly sent: number | null;
  readonly failed: number | null;
  readonly clicks: number | null;
}

export interface AutoDmRule extends AutoDmInput {
  readonly id: string;
  readonly platform: AutoDmPlatform;
  readonly stats: AutoDmStats;
}

export type AutoDmLogStatus = 'pending' | 'sent' | 'failed' | 'skipped' | 'gated';

export interface AutoDmLog {
  readonly id: string;
  readonly commenter: string;
  readonly text: string;
  readonly status: AutoDmLogStatus;
  readonly at: string | null;
}

export const DEFAULT_AUDIENCE: AutoDmAudience = { followerStatus: 'any', minFollowerCount: null, whenUnknown: 'send', tapToUnlock: false };
export const DEFAULT_FOLLOW_GATE: AutoDmFollowGate = { message: '', buttonLabel: '', profileButtonLabel: '', notFollowingMessage: '' };

/** A blank automation for an account, with Zernio's own defaults. */
export function newAutoDm(accountId: string): AutoDmInput {
  return {
    accountId,
    name: '',
    trigger: 'comment',
    platformPostId: null,
    postId: null,
    postTitle: '',
    keywords: [],
    matchMode: 'word',
    excludeKeywords: [],
    typoTolerance: false,
    alsoMatchInDms: false,
    dmMessage: '',
    dmMessageVariations: [],
    buttons: [],
    linkTracking: true,
    dmDelaySeconds: 0,
    commentReply: '',
    commentReplyVariations: [],
    publicReplyPolicy: 'after_dm',
    commentReplyDelaySeconds: 0,
    audience: DEFAULT_AUDIENCE,
    followGate: DEFAULT_FOLLOW_GATE,
    repeatMode: 'once',
    cooldownHours: null,
    dedupeSameTextHours: null,
    likeComment: false,
    hideComment: false,
    isActive: true,
  };
}

export function isAutoDmPlatform(value: unknown): value is AutoDmPlatform {
  return value === 'instagram' || value === 'facebook';
}

/** Whether a trigger can be used on a network: every trigger but comments is Instagram only. */
export function triggerAllowed(trigger: AutoDmTrigger, platform: AutoDmPlatform): boolean {
  return trigger === 'comment' || platform === 'instagram';
}

export type AutoDmCheck =
  | { readonly ok: true; readonly value: AutoDmInput }
  | { readonly ok: false; readonly message: string };

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

function wholeNumber(value: unknown, min: number, max: number): number | null | 'bad' {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) return 'bad';
  return n;
}

function words(value: unknown, max: number, each: number): string[] | 'bad' {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return 'bad';
  const out: string[] = [];
  for (const item of value) {
    const word = text(item);
    if (!word) continue;
    if (word.length > each) return 'bad';
    if (!out.some((existing) => existing.toLowerCase() === word.toLowerCase())) out.push(word);
  }
  return out.length > max ? 'bad' : out;
}

function texts(value: unknown, max: number, each: number): string[] | 'bad' {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return 'bad';
  const out = value.map(text).filter(Boolean);
  if (out.length > max || out.some((item) => item.length > each)) return 'bad';
  return out;
}

const HTTP_URL = /^https?:\/\/[^\s]+$/i;
const PHONE = /^\+[1-9]\d{6,14}$/;
const PLATFORM_POST_ID = /^[A-Za-z0-9_:.-]{1,120}$/;
const HARVEST_POST_ID = /^[A-Za-z0-9_-]{1,64}$/;

function readButtons(value: unknown, platform: AutoDmPlatform): AutoDmButton[] | string {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return 'Buttons could not be read.';
  if (value.length > AUTO_DM_LIMITS.buttons) return `A DM can carry up to ${AUTO_DM_LIMITS.buttons} buttons.`;
  const out: AutoDmButton[] = [];
  for (const raw of value) {
    const row = asRecord(raw);
    const title = text(row.title);
    if (!title || title.length > AUTO_DM_LIMITS.buttonTitle) return `Each button needs a label of up to ${AUTO_DM_LIMITS.buttonTitle} characters.`;
    if (row.type === 'url') {
      const url = text(row.url);
      if (!HTTP_URL.test(url)) return `The "${title}" button needs a link starting with https://.`;
      out.push({ type: 'url', title, url });
    } else if (row.type === 'phone') {
      if (platform !== 'facebook') return 'Call buttons work on Facebook only.';
      const phone = text(row.phone).replace(/[\s()-]/g, '');
      if (!PHONE.test(phone)) return `The "${title}" button needs a phone number like +14155551234.`;
      out.push({ type: 'phone', title, phone });
    } else {
      return 'A button is a link or, on Facebook, a call.';
    }
  }
  return out;
}

/**
 * The checks Zernio itself applies, worded for an admin, so a mistake is
 * caught on the form and not as a provider refusal. `platform` is the network
 * of the account the automation runs on.
 */
export function checkAutoDm(raw: unknown, platform: AutoDmPlatform): AutoDmCheck {
  const input = asRecord(raw);
  const fail = (message: string): AutoDmCheck => ({ ok: false, message });

  const accountId = text(input.accountId);
  if (!accountId) return fail('Pick the account this runs on.');
  const name = text(input.name);
  if (!name) return fail('Give the automation a name.');
  if (name.length > AUTO_DM_LIMITS.name) return fail(`Keep the name under ${AUTO_DM_LIMITS.name} characters.`);

  const trigger = (AUTO_DM_TRIGGERS as readonly unknown[]).includes(input.trigger) ? (input.trigger as AutoDmTrigger) : 'comment';
  if (!triggerAllowed(trigger, platform)) return fail(`${AUTO_DM_TRIGGER_LABELS[trigger]} work on Instagram only.`);

  let platformPostId = text(input.platformPostId) || null;
  let postId = text(input.postId) || null;
  if (platformPostId && postId) return fail('Pick one post, not two.');
  if (platformPostId && !PLATFORM_POST_ID.test(platformPostId)) return fail('That post ID does not look right.');
  if (postId && !HARVEST_POST_ID.test(postId)) return fail('That post could not be found.');
  if (trigger === 'story_mention' || trigger === 'live_comment') { platformPostId = null; postId = null; }
  if (trigger === 'story_reply') postId = null;
  const postTitle = platformPostId || postId ? text(input.postTitle).slice(0, 200) : '';

  const keywords = words(input.keywords, AUTO_DM_LIMITS.keywords, AUTO_DM_LIMITS.keyword);
  if (keywords === 'bad') return fail(`Use up to ${AUTO_DM_LIMITS.keywords} keywords of up to ${AUTO_DM_LIMITS.keyword} characters.`);
  if (trigger === 'story_mention' && keywords.length > 0) return fail('A story mention has no text, so it takes no keywords.');
  const excludeKeywords = words(input.excludeKeywords, AUTO_DM_LIMITS.keywords, AUTO_DM_LIMITS.keyword);
  if (excludeKeywords === 'bad') return fail(`Use up to ${AUTO_DM_LIMITS.keywords} words to skip.`);
  const matchMode = (AUTO_DM_MATCH_MODES as readonly unknown[]).includes(input.matchMode) ? (input.matchMode as AutoDmMatchMode) : 'contains';
  const typoTolerance = matchMode === 'word' && bool(input.typoTolerance, false);
  const alsoMatchInDms = bool(input.alsoMatchInDms, false);
  if (alsoMatchInDms && keywords.length === 0) return fail('Add a keyword before answering DMs too, or every message would get a reply.');
  if (alsoMatchInDms && trigger === 'story_reply') return fail('Story replies already arrive as DMs.');

  const buttons = readButtons(input.buttons, platform);
  if (typeof buttons === 'string') return fail(buttons);
  const dmLimit = buttons.length > 0 ? AUTO_DM_LIMITS.dmWithButtons : AUTO_DM_LIMITS.dm;
  const dmMessage = text(input.dmMessage);
  if (!dmMessage) return fail('Write the DM people receive.');
  if (dmMessage.length > dmLimit) return fail(`Keep the DM under ${dmLimit} characters${buttons.length > 0 ? ' when it has buttons' : ''}.`);
  const dmMessageVariations = texts(input.dmMessageVariations, AUTO_DM_LIMITS.variations, dmLimit);
  if (dmMessageVariations === 'bad') return fail(`Add up to ${AUTO_DM_LIMITS.variations} other versions of the DM, each under ${dmLimit} characters.`);

  const dmDelaySeconds = wholeNumber(input.dmDelaySeconds, 0, AUTO_DM_LIMITS.delaySeconds);
  const commentReplyDelaySeconds = wholeNumber(input.commentReplyDelaySeconds, 0, AUTO_DM_LIMITS.delaySeconds);
  if (dmDelaySeconds === 'bad' || commentReplyDelaySeconds === 'bad') return fail('A delay is up to 24 hours.');

  // A story reply arrives as a DM, so there is no comment to answer in public.
  const noPublicReply = trigger === 'story_reply' || trigger === 'story_mention';
  const commentReply = noPublicReply ? '' : text(input.commentReply);
  if (commentReply.length > AUTO_DM_LIMITS.reply) return fail(`Keep the public reply under ${AUTO_DM_LIMITS.reply} characters.`);
  const commentReplyVariations = commentReply ? texts(input.commentReplyVariations, AUTO_DM_LIMITS.variations, AUTO_DM_LIMITS.reply) : [];
  if (commentReplyVariations === 'bad') return fail(`Add up to ${AUTO_DM_LIMITS.variations} other versions of the public reply.`);
  const publicReplyPolicy = input.publicReplyPolicy === 'always' ? 'always' : 'after_dm';

  // Follower rules and the follow gate are Instagram's: Meta does not share follows on Facebook.
  const rawAudience = asRecord(input.audience);
  const minFollowerCount = wholeNumber(rawAudience.minFollowerCount, 0, 1_000_000_000);
  if (minFollowerCount === 'bad') return fail('The follower minimum is a whole number.');
  const audience: AutoDmAudience = platform !== 'instagram' ? DEFAULT_AUDIENCE : {
    followerStatus: rawAudience.followerStatus === 'follower' || rawAudience.followerStatus === 'non_follower' ? rawAudience.followerStatus : 'any',
    minFollowerCount,
    whenUnknown: rawAudience.whenUnknown === 'skip' || rawAudience.whenUnknown === 'verify' ? rawAudience.whenUnknown : 'send',
    tapToUnlock: bool(rawAudience.tapToUnlock, false),
  };
  const rawGate = asRecord(input.followGate);
  const followGate: AutoDmFollowGate = platform !== 'instagram' ? DEFAULT_FOLLOW_GATE : {
    message: text(rawGate.message),
    buttonLabel: text(rawGate.buttonLabel),
    profileButtonLabel: text(rawGate.profileButtonLabel),
    notFollowingMessage: text(rawGate.notFollowingMessage),
  };
  if ([followGate.message, followGate.notFollowingMessage].some((value) => value.length > AUTO_DM_LIMITS.gateText)) {
    return fail(`Keep the follow messages under ${AUTO_DM_LIMITS.gateText} characters.`);
  }
  if ([followGate.buttonLabel, followGate.profileButtonLabel].some((value) => value.length > AUTO_DM_LIMITS.buttonTitle)) {
    return fail(`Keep button labels under ${AUTO_DM_LIMITS.buttonTitle} characters.`);
  }

  const repeatMode = input.repeatMode === 'every_comment' ? 'every_comment' : 'once';
  const cooldownHours = repeatMode === 'every_comment' ? wholeNumber(input.cooldownHours, 1, AUTO_DM_LIMITS.hours) : null;
  const dedupeSameTextHours = wholeNumber(input.dedupeSameTextHours, 1, AUTO_DM_LIMITS.hours);
  if (cooldownHours === 'bad' || dedupeSameTextHours === 'bad') return fail(`Hours are a whole number from 1 to ${AUTO_DM_LIMITS.hours}.`);

  return {
    ok: true,
    value: {
      accountId, name, trigger, platformPostId, postId, postTitle,
      keywords, matchMode, excludeKeywords, typoTolerance, alsoMatchInDms,
      dmMessage, dmMessageVariations, buttons, linkTracking: bool(input.linkTracking, true), dmDelaySeconds: dmDelaySeconds ?? 0,
      commentReply, commentReplyVariations, publicReplyPolicy, commentReplyDelaySeconds: commentReply ? commentReplyDelaySeconds ?? 0 : 0,
      audience, followGate, repeatMode, cooldownHours, dedupeSameTextHours,
      likeComment: bool(input.likeComment, false), hideComment: bool(input.hideComment, false),
      isActive: bool(input.isActive, true),
    },
  };
}

/**
 * Zernio's request body. Create sends every field; update sends every field
 * but the account and profile, so a cleared field is cleared at Zernio too.
 */
export function toZernioAutomation(input: AutoDmInput, platform: AutoDmPlatform, scope: { profileId: string } | 'update'): Record<string, unknown> {
  const instagram = platform === 'instagram';
  const gate = Object.fromEntries(Object.entries(input.followGate).filter(([, value]) => value));
  return {
    ...(scope === 'update' ? {} : { profileId: scope.profileId, accountId: input.accountId }),
    name: input.name,
    trigger: input.trigger,
    platformPostId: input.platformPostId,
    postId: input.postId,
    postTitle: input.postTitle || null,
    keywords: input.keywords,
    matchMode: input.matchMode,
    excludeKeywords: input.excludeKeywords,
    typoTolerance: input.typoTolerance,
    alsoMatchInDms: input.alsoMatchInDms,
    dmMessage: input.dmMessage,
    dmMessageVariations: input.dmMessageVariations,
    buttons: input.buttons,
    linkTracking: input.linkTracking,
    dmDelaySeconds: input.dmDelaySeconds,
    commentReply: input.commentReply || null,
    commentReplyVariations: input.commentReplyVariations,
    publicReplyPolicy: input.publicReplyPolicy,
    commentReplyDelaySeconds: input.commentReplyDelaySeconds,
    ...(instagram ? {
      audience: {
        followerStatus: input.audience.followerStatus,
        whenUnknown: input.audience.whenUnknown,
        tapToUnlock: input.audience.tapToUnlock,
        ...(input.audience.minFollowerCount !== null ? { minFollowerCount: input.audience.minFollowerCount } : {}),
      },
      followGate: Object.keys(gate).length > 0 ? gate : null,
    } : {}),
    repeatPolicy: input.repeatMode === 'every_comment' && input.cooldownHours !== null
      ? { mode: 'every_comment', cooldownHours: input.cooldownHours }
      : { mode: input.repeatMode },
    dedupeSameTextHours: input.dedupeSameTextHours,
    actions: { likeComment: input.likeComment, hideComment: input.hideComment },
    isActive: input.isActive,
  };
}

const idOf = (row: Record<string, unknown>): string =>
  typeof row._id === 'string' ? row._id : typeof row.id === 'string' ? row.id : '';
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

function count(...values: unknown[]): number | null {
  for (const value of values) if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  return null;
}

/** One automation as Zernio returns it, or null when it cannot be read. */
export function readAutoDmRule(value: unknown): AutoDmRule | null {
  const row = asRecord(value);
  const id = idOf(row);
  const account = asRecord(row.accountId);
  const accountId = typeof row.accountId === 'string' ? row.accountId : idOf(account);
  const platform = isAutoDmPlatform(row.platform) ? row.platform : isAutoDmPlatform(account.platform) ? account.platform : null;
  if (!id || !accountId || !platform) return null;
  const blank = newAutoDm(accountId);
  const audience = asRecord(row.audience);
  const gate = asRecord(row.followGate);
  const repeat = asRecord(row.repeatPolicy);
  const actions = asRecord(row.actions);
  const stats = asRecord(row.stats);
  const buttons: AutoDmButton[] = [];
  for (const raw of Array.isArray(row.buttons) ? row.buttons : []) {
    const button = asRecord(raw);
    if (button.type === 'url' && typeof button.title === 'string' && typeof button.url === 'string') buttons.push({ type: 'url', title: button.title, url: button.url });
    if (button.type === 'phone' && typeof button.title === 'string' && typeof button.phone === 'string') buttons.push({ type: 'phone', title: button.title, phone: button.phone });
  }
  const trigger = (AUTO_DM_TRIGGERS as readonly unknown[]).includes(row.trigger) ? (row.trigger as AutoDmTrigger) : 'comment';
  const matchMode = (AUTO_DM_MATCH_MODES as readonly unknown[]).includes(row.matchMode) ? (row.matchMode as AutoDmMatchMode) : 'contains';
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    ...blank,
    id,
    platform,
    name: str(row.name) || 'Untitled automation',
    trigger,
    platformPostId: str(row.platformPostId) || null,
    postId: str(row.postId) || null,
    postTitle: str(row.postTitle),
    keywords: strings(row.keywords),
    matchMode,
    excludeKeywords: strings(row.excludeKeywords),
    typoTolerance: row.typoTolerance === true,
    alsoMatchInDms: row.alsoMatchInDms === true,
    dmMessage: str(row.dmMessage),
    dmMessageVariations: strings(row.dmMessageVariations),
    buttons,
    linkTracking: row.linkTracking !== false,
    dmDelaySeconds: count(row.dmDelaySeconds) ?? 0,
    commentReply: str(row.commentReply),
    commentReplyVariations: strings(row.commentReplyVariations),
    publicReplyPolicy: row.publicReplyPolicy === 'always' ? 'always' : 'after_dm',
    commentReplyDelaySeconds: count(row.commentReplyDelaySeconds) ?? 0,
    audience: {
      followerStatus: audience.followerStatus === 'follower' || audience.followerStatus === 'non_follower' ? audience.followerStatus : 'any',
      minFollowerCount: count(audience.minFollowerCount),
      whenUnknown: audience.whenUnknown === 'skip' || audience.whenUnknown === 'verify' ? audience.whenUnknown : 'send',
      tapToUnlock: audience.tapToUnlock === true,
    },
    followGate: {
      message: str(gate.message),
      buttonLabel: str(gate.buttonLabel),
      profileButtonLabel: str(gate.profileButtonLabel),
      notFollowingMessage: str(gate.notFollowingMessage),
    },
    repeatMode: repeat.mode === 'every_comment' ? 'every_comment' : 'once',
    cooldownHours: count(repeat.cooldownHours),
    dedupeSameTextHours: count(row.dedupeSameTextHours),
    likeComment: actions.likeComment === true,
    hideComment: actions.hideComment === true,
    isActive: row.isActive !== false,
    stats: {
      triggered: count(stats.totalTriggered, stats.triggered, row.totalTriggered),
      sent: count(stats.totalSent, stats.sent, stats.dmsSent, row.totalSent),
      failed: count(stats.totalFailed, stats.failed, row.totalFailed),
      clicks: count(stats.totalClicks, stats.linkClicks, stats.clicks, row.totalClicks),
    },
  };
}

function listOf(body: unknown, key: string): unknown[] {
  if (Array.isArray(body)) return body;
  const record = asRecord(body);
  for (const candidate of [record[key], record.data]) if (Array.isArray(candidate)) return candidate;
  return [];
}

export function readAutoDmRules(body: unknown): AutoDmRule[] {
  return listOf(body, 'automations').map(readAutoDmRule).filter((rule): rule is AutoDmRule => rule !== null);
}

const LOG_STATUSES: readonly AutoDmLogStatus[] = ['pending', 'sent', 'failed', 'skipped', 'gated'];

export function readAutoDmLogs(body: unknown): AutoDmLog[] {
  const out: AutoDmLog[] = [];
  for (const raw of listOf(body, 'logs')) {
    const row = asRecord(raw);
    const id = idOf(row);
    const status = LOG_STATUSES.includes(row.status as AutoDmLogStatus) ? (row.status as AutoDmLogStatus) : null;
    if (!id || !status) continue;
    const commenter = asRecord(row.commenter);
    const name = [row.commenterName, row.commenterUsername, commenter.name, commenter.username, row.username]
      .find((value): value is string => typeof value === 'string' && value.trim() !== '');
    const said = [row.commentText, row.text, row.message].find((value): value is string => typeof value === 'string');
    const at = [row.createdAt, row.triggeredAt, row.timestamp].find((value): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value)));
    out.push({ id, commenter: name ?? 'Someone', text: said ?? '', status, at: at ?? null });
  }
  return out;
}

/** Overview totals across automations; a count Zernio did not report stays unknown. */
export function autoDmTotals(rules: readonly AutoDmRule[]): { active: number; sent: number | null; clicks: number | null; clickRate: number | null } {
  const sum = (pick: (stats: AutoDmStats) => number | null) => {
    const known = rules.map((rule) => pick(rule.stats)).filter((n): n is number => n !== null);
    return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
  };
  const sent = sum((s) => s.sent);
  const clicks = sum((s) => s.clicks);
  return {
    active: rules.filter((rule) => rule.isActive).length,
    sent,
    clicks,
    clickRate: sent && clicks !== null ? Math.round((clicks / sent) * 1000) / 10 : null,
  };
}
