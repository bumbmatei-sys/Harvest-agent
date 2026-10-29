import 'server-only';

import { communitySuppressionId } from '@/lib/email/suppression-key';

import { tenantAllows, ARCHIVED_ACTION_MESSAGE } from '@/lib/tenant-lifecycle';
import { normalizeEmail } from '@/lib/donation-history';
import { hasFeature, toTenantPlan } from '@/utils/plan-features';
import {
  isSuppressed,
  resolveAudience,
  type AudienceFilter,
  type AudienceResult,
  type EmailContact,
  type EmailOptInSource,
} from '@/lib/email/audience';
import {
  hashEmailPayload,
  type EmailConfirmAction,
  type EmailConfirmBinding,
  type EmailConfirmLedger,
} from '@/lib/email/confirm';
import type { DomainStatus, EmailProvider } from '@/lib/email/provider';
import { DEFAULT_EMAIL_DESIGN, fillMergeTags, renderEmail } from '@/lib/email/render';
import type { EmailDesign } from '@/lib/email/design';
import { assertUnsubscribeConfigured, listUnsubscribeHeaders, signUnsubscribe, unsubscribeUrl } from '@/lib/email/unsubscribe';
import { contentHash, type ClaimRequest, type ClaimResult, type Settlement } from '@/lib/email/claim';
import { resolveLimits, validateLimits, type EmailLimits } from '@/lib/email/limits';
import { domainOfAddress, isReservedDomain } from '@/lib/email/reserved-domains';
import { decidePause, decideSend, dayKey, isNewChurch, monthKey, nextMonthStart, percentUsed, type Health } from '@/lib/email/volume-cap';

export type BroadcastStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'partial' | 'failed';

export interface BroadcastStats {
  readonly recipients: number;
  readonly sent: number;
  readonly failed: number;
  readonly skippedSuppressed: number;
  readonly skippedNotOptedIn: number;
}

export interface Broadcast {
  readonly id: string;
  readonly tenantId: string;
  readonly subject: string;
  readonly subjectB: string | null;
  readonly preheader: string;
  readonly bodyHtml: string;
  readonly design: EmailDesign;
  readonly filters: readonly AudienceFilter[];
  readonly status: BroadcastStatus;
  readonly scheduledAt: string | null;
  readonly sentAt: string | null;
  readonly stats: BroadcastStats | null;
  readonly error: string | null;
  /** Set when a send claims the broadcast; ties the final write to that one claim. */
  readonly sendId: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NewContact {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly tags: readonly string[];
  readonly source: EmailOptInSource;
  readonly at: string;
}

export interface ContactUpdate {
  readonly id: string;
  readonly subscribe: boolean;
  readonly addTags: readonly string[];
  readonly source: EmailOptInSource;
  readonly at: string;
}

export interface EmailSettings {
  readonly fromName: string;
  readonly fromLocal: string;
  readonly replyTo: string;
  readonly mailingAddress: string;
  readonly domain: string;
  readonly domainState: 'none' | 'pending' | 'verified' | 'failed';
  readonly domainRecords: readonly { type: string; name: string; value: string }[];
}

export const EMPTY_SETTINGS: EmailSettings = Object.freeze({
  fromName: '',
  fromLocal: 'hello',
  replyTo: '',
  mailingAddress: '',
  domain: '',
  domainState: 'none',
  domainRecords: [],
});

export interface EmailActor {
  readonly uid: string;
  readonly email: string | null;
  readonly tenantId: string | null;
  readonly isAdmin: boolean;
  readonly isSuperAdmin: boolean;
}

export interface EmailStore {
  getTenant(tenantId: string): Promise<{ name: string; plan: unknown; status: unknown; ownerId: string | null; createdAt: unknown } | null>;
  /** The raw limits document, or null when nobody has saved one (defaults apply). */
  getLimits(): Promise<unknown>;
  saveLimits(limits: EmailLimits): Promise<void>;
  getSendingState(tenantId: string): Promise<SendingState | null>;
  setSendingState(tenantId: string, state: SendingState | null): Promise<void>;
  getAdminEmails(tenantId: string): Promise<readonly string[]>;
  getPermissions(uid: string): Promise<Readonly<Record<string, boolean>>>;
  getSettings(tenantId: string): Promise<EmailSettings>;
  saveSettings(tenantId: string, settings: EmailSettings): Promise<void>;
  getBroadcast(tenantId: string, id: string): Promise<Broadcast | null>;
  /** Creates a draft. Anything that changes an existing broadcast goes through a guarded write below. */
  saveBroadcast(broadcast: Broadcast): Promise<void>;
  /**
   * Writes only if the stored broadcast is still in one of these states and, when
   * given, still has this `contentHash` (nobody edited it since it was read). One transaction.
   */
  saveBroadcastIf(broadcast: Broadcast, statuses: readonly BroadcastStatus[], expectedContentHash?: string): Promise<boolean>;
  /** Deletes only if the stored broadcast is still in one of these states. One transaction. */
  removeBroadcastIf(tenantId: string, id: string, statuses: readonly BroadcastStatus[]): Promise<boolean>;
  /**
   * The atomic start of a send: in ONE transaction, check the broadcast is still
   * in a claimable state, check the allowance, reserve `requested` emails against
   * the month and the day, and move the broadcast to `sending`.
   */
  claimForSend(request: ClaimRequest): Promise<ClaimResult>;
  /**
   * The atomic end of a send: only if the broadcast is still `sending` under this
   * sendId, write the final state, hand back the reserved emails that did not go
   * out, and clear the in-flight marker. False means someone else settled it first.
   */
  settleSend(input: { broadcast: Broadcast; settlement: Settlement | null }): Promise<boolean>;
  /** Sends claimed before `cutoffIso` that never settled: the function timed out or died. */
  listStaleSending(cutoffIso: string): Promise<readonly { tenantId: string; broadcastId: string; sendId: string }[]>;
  /**
   * Server-only registry: one sending domain belongs to one ministry, in one transaction.
   * `fresh` and `own` mean this ministry holds it now. `taken` is held by another ministry.
   * `released` is a placeholder left by a ministry that moved off it: only that ministry may take it back.
   */
  claimDomain(tenantId: string, domain: string): Promise<DomainClaim>;
  /** Leaves a placeholder behind. The domain is not free for anyone else until Harvest support transfers it. */
  releaseDomain(tenantId: string, domain: string): Promise<void>;
  /** Removes a claim this ministry created a moment ago and then could not use. Never a placeholder for a real release. */
  discardClaim(tenantId: string, domain: string): Promise<void>;
  /** The ministry that holds the domain now; null for a free domain or a placeholder. */
  getDomainOwner(domain: string): Promise<string | null>;
  /** Records a bounce or complaint event once. False means this event was already counted. */
  claimFeedbackEvent(tenantId: string, key: string, atIso: string): Promise<boolean>;
  /** Gives a claimed event back, so a retry of the same event is counted. */
  releaseFeedbackEvent(tenantId: string, key: string): Promise<void>;
  /** Deletes dedupe records past their expiry. Returns how many went. */
  purgeExpiredFeedbackEvents(nowIso: string): Promise<number>;
  /** SHA-256 keys of normalized addresses that opted out, bounced or complained.
   * Scoped by tenant; survives CRM contact deletion. */
  listSuppressed(tenantId: string): Promise<ReadonlySet<string>>;
  /** Recheck immediately before delivery: leave/opt-out may follow audience resolution. */
  isSuppressedNow(tenantId: string, email: string): Promise<boolean>;
  listBroadcasts(tenantId: string): Promise<readonly Broadcast[]>;
  /** CRM people (`contacts`) for this ministry, with their email status. One list. */
  listContacts(tenantId: string): Promise<readonly EmailContact[]>;
  /** New CRM people created by an import. */
  createContacts(tenantId: string, rows: readonly NewContact[], uid: string): Promise<void>;
  /** Fields merged onto existing CRM people. Never touches status of a suppressed person. */
  updateContacts(tenantId: string, updates: readonly ContactUpdate[]): Promise<void>;
  /** Emails sent under one key: a month ('2031-03') or a day ('2031-03-10'). */
  usage(tenantId: string, key: string): Promise<number>;
  /** Sent, bounced and complained for one month. */
  health(tenantId: string, month: string): Promise<Health>;
  addFeedback(tenantId: string, month: string, kind: 'bounced' | 'complained'): Promise<void>;
  /** Marks every CRM person with this address bounced or complained AND keeps a suppression record. Idempotent. */
  markContactStatus(tenantId: string, email: string, status: 'bounced' | 'complained', at: string): Promise<void>;
  queueScheduled(tenantId: string, broadcastId: string, at: string): Promise<void>;
  unqueueScheduled(tenantId: string, broadcastId: string): Promise<void>;
  listDue(nowIso: string): Promise<readonly { tenantId: string; broadcastId: string }[]>;
  /** The opt-out record: marks every CRM person with this address unsubscribed AND keeps a suppression record. Idempotent. */
  recordOptOut(tenantId: string, email: string, broadcastId: string, at: string): Promise<void>;
}

export type DomainClaim = 'fresh' | 'own' | 'taken' | 'released';

export interface SendingState {
  readonly pausedAt: string;
  readonly reason: 'bounce' | 'complaint';
  readonly rate: number;
  readonly threshold: number;
}

export type EmailErrorCode =
  | 'not_authorized' | 'cross_tenant' | 'not_found' | 'invalid' | 'plan_required' | 'publishing_closed'
  | 'sender_not_ready' | 'no_recipients' | 'volume_cap' | 'daily_cap' | 'domain_required' | 'sending_paused' | 'time_not_future' | 'already_sent'
  | 'confirm_required' | 'confirm_expired' | 'confirm_reused' | 'confirm_mismatch' | 'provider_unavailable' | 'domain_taken' | 'domain_reserved';

export interface EmailFailure {
  readonly ok: false;
  readonly error: EmailErrorCode;
  readonly message: string;
}

const fail = (error: EmailErrorCode, message: string): EmailFailure => ({ ok: false, error, message });

export interface SendPreview {
  readonly broadcastId: string;
  readonly action: EmailConfirmAction;
  readonly recipientCount: number;
  readonly skipped: AudienceResult['skipped'];
  readonly from: string;
  readonly subject: string;
  readonly at: string | null;
  readonly capRemainingAfter: number;
}

export type SendOutcome = 'sent' | 'partial' | 'failed' | 'scheduled';

export type SendCommitResult =
  | { ok: true; requiresConfirm: true; confirmToken: string; preview: SendPreview }
  | { ok: true; outcome: SendOutcome; preview: SendPreview; stats: BroadcastStats | null; message: string }
  | EmailFailure;

export interface WhenInput {
  readonly mode: 'now' | 'at';
  readonly at?: string | null;
}

export interface DraftInput {
  readonly id?: string | null;
  readonly subject?: string;
  readonly subjectB?: string | null;
  readonly preheader?: string;
  readonly bodyHtml?: string;
  readonly design?: Partial<EmailDesign>;
  readonly filters?: readonly AudienceFilter[];
}

export interface ImportRow {
  readonly email: string;
  readonly name?: string;
  readonly tags?: readonly string[];
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_IMPORT_ROWS = 5000;
const SEND_CONCURRENCY = 5;
/** Stop starting new emails this long after a send began, so the function ends before its 300s limit. */
export const SEND_BUDGET_MS = 240_000;
/** A send still `sending` this long after it was claimed has died with its function. */
export const STALE_SENDING_MS = 15 * 60 * 1000;
const INTERRUPTED = 'This send was interrupted before it finished. Some emails may have gone out; they stay counted against your allowance. Check your list before sending again.';

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function senderAddress(settings: EmailSettings): string | null {
  if (settings.domainState !== 'verified' || !settings.domain || !settings.fromLocal) return null;
  return `${settings.fromLocal}@mail.${settings.domain}`;
}

export function createEmailService(deps: {
  store: EmailStore;
  ledger: EmailConfirmLedger;
  getProvider: () => Promise<EmailProvider>;
  appOrigin: string;
  /** Shared Harvest sender for SMALL sends from a ministry with no verified domain. Unset: a verified domain is always required. */
  fallbackFrom?: string | null;
  /** Harvest's own domains, on top of the built-in list. No ministry may register or send as one of these. */
  reservedDomains?: readonly (string | null | undefined)[];
  now?: () => Date;
  newId?: () => string;
  /** Wall clock for the send time budget; separate from `now` so a test can freeze dates and still run out of time. */
  clockMs?: () => number;
  sendBudgetMs?: number;
}) {
  const { store, ledger } = deps;
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const clockMs = deps.clockMs ?? (() => Date.now());
  const sendBudgetMs = deps.sendBudgetMs ?? SEND_BUDGET_MS;
  const reserved = (domain: string) => isReservedDomain(domain, deps.reservedDomains ?? []);

  async function gate(actor: EmailActor, requested: string | null | undefined, opts: { needPlan: boolean }) {
    const tenantId = clean(requested) || actor.tenantId || '';
    if (!actor.uid) return fail('not_authorized', 'Sign in is required.');
    if (!tenantId) return fail('invalid', 'A ministry is required.');
    if (!actor.isSuperAdmin && actor.tenantId !== tenantId) return fail('cross_tenant', 'That belongs to another ministry.');
    const tenant = await store.getTenant(tenantId);
    if (!tenant) return fail('not_found', 'This ministry could not be read.');
    if (!actor.isSuperAdmin) {
      let allowed = tenant.ownerId === actor.uid;
      const email = (actor.email || '').toLowerCase();
      if (!allowed && email) allowed = (await store.getAdminEmails(tenantId)).some((e) => e.toLowerCase() === email);
      if (!allowed) {
        if (!actor.isAdmin) return fail('not_authorized', 'Email requires the newsletter permission.');
        const perms = await store.getPermissions(actor.uid);
        allowed = perms.fullAccess === true || perms.manageNewsletter === true;
      }
      if (!allowed) return fail('not_authorized', 'Email requires the newsletter permission.');
    }
    const plan = toTenantPlan(typeof tenant.plan === 'string' ? tenant.plan : null);
    if (opts.needPlan && !actor.isSuperAdmin && !hasFeature(plan, 'newsletterAutomation')) {
      return fail('plan_required', 'Email broadcasts are not included in your current plan.');
    }
    return { ok: true as const, tenantId, tenant, plan };
  }

  type Gated = Exclude<Awaited<ReturnType<typeof gate>>, EmailFailure>;

  async function loadLimits(): Promise<EmailLimits> {
    return resolveLimits(await store.getLimits());
  }

  /** The verified sender, but only for a domain this ministry holds in the registry. Plunk's verification is account-wide, so the registry is the tenant boundary. */
  async function ownSenderAddress(tenantId: string, settings: EmailSettings): Promise<string | null> {
    const address = senderAddress(settings);
    if (!address || reserved(settings.domain)) return null;
    return (await store.getDomainOwner(settings.domain)) === tenantId ? address : null;
  }

  function capFailure(code: 'volume_cap' | 'daily_cap', remaining: number, cap: number, limits: EmailLimits): EmailFailure {
    return code === 'volume_cap'
      ? fail('volume_cap', `This send would pass your monthly allowance. You have ${remaining.toLocaleString()} of ${cap.toLocaleString()} emails left this month.`)
      : fail('daily_cap', `New ministries can send up to ${cap.toLocaleString()} emails a day for their first ${limits.newChurch.days} days. You have ${remaining.toLocaleString()} left today.`);
  }

  function pauseMessage(state: SendingState): string {
    const what = state.reason === 'complaint' ? 'spam complaints' : 'bounced emails';
    return `Sending is paused because ${what} passed ${(state.threshold * 100).toFixed(1).replace(/\.0$/, '')}% of what you sent this month (it reached ${(state.rate * 100).toFixed(1)}%). Check that your list only holds people who asked to hear from you, then ask Harvest to resume sending.`;
  }

  /**
   * Every limit a send must clear, in one place, so a preview, a confirmed send
   * and a scheduled send can never disagree: paused, domain, monthly allowance,
   * new-ministry daily cap. Returns the sender address to use on success.
   */
  async function checkSending(
    tenantId: string,
    tenant: { plan: unknown; createdAt: unknown },
    settings: EmailSettings,
    requested: number,
  ): Promise<EmailFailure | { ok: true; from: string; remaining: number; allowance: number; dailyCap: number | null }> {
    const limits = await loadLimits();
    const state = await store.getSendingState(tenantId);
    if (state) return fail('sending_paused', pauseMessage(state));
    let from = await ownSenderAddress(tenantId, settings);
    if (!from) {
      if (requested > limits.largeSendThreshold) {
        return fail('domain_required', `Sending to more than ${limits.largeSendThreshold.toLocaleString()} people at once is not available yet. Send to a smaller group.`);
      }
      if (!deps.fallbackFrom) return fail('sender_not_ready', 'Email sending is not set up on this server yet, so nothing was sent. Contact Harvest.');
      from = deps.fallbackFrom;
    }
    const plan = toTenantPlan(typeof tenant.plan === 'string' ? tenant.plan : null);
    const at = now();
    const [usedMonth, usedToday] = await Promise.all([store.usage(tenantId, monthKey(at)), store.usage(tenantId, dayKey(at))]);
    const allowance = limits.monthlySends[plan];
    const dailyCap = isNewChurch(tenant.createdAt, at, limits.newChurch.days) ? limits.newChurch.dailyCap : null;
    const decision = decideSend({ allowance, usedMonth, usedToday, requested, newChurch: dailyCap !== null, dailyCap: dailyCap ?? 0 });
    if (!decision.ok) return capFailure(decision.code, decision.remaining, decision.cap, limits);
    return { ok: true, from, remaining: decision.remaining, allowance, dailyCap };
  }

  /** After any send or feedback: pause the ministry if a rate has passed its threshold. */
  async function evaluatePause(tenantId: string): Promise<void> {
    if (await store.getSendingState(tenantId)) return;
    const limits = await loadLimits();
    const decision = decidePause(await store.health(tenantId, monthKey(now())), limits.autoPause);
    if (decision) await store.setSendingState(tenantId, { pausedAt: now().toISOString(), ...decision });
  }

  function normaliseDraft(input: DraftInput, existing: Broadcast | null, g: Gated, actor: EmailActor): Broadcast {
    const stamp = now().toISOString();
    return {
      id: existing?.id ?? newId(),
      tenantId: g.tenantId,
      subject: input.subject !== undefined ? clean(input.subject) : existing?.subject ?? '',
      subjectB: input.subjectB !== undefined ? (clean(input.subjectB) || null) : existing?.subjectB ?? null,
      preheader: input.preheader !== undefined ? clean(input.preheader) : existing?.preheader ?? '',
      bodyHtml: input.bodyHtml !== undefined ? String(input.bodyHtml) : existing?.bodyHtml ?? '',
      design: { ...DEFAULT_EMAIL_DESIGN, ...(existing?.design ?? {}), ...(input.design ?? {}) },
      filters: input.filters !== undefined
        ? input.filters.filter((f) => f && clean(f.value) !== '').map((f) => ({ kind: f.kind, value: clean(f.value) }))
        : existing?.filters ?? [],
      status: 'draft',
      scheduledAt: null,
      sentAt: existing?.sentAt ?? null,
      stats: existing?.stats ?? null,
      error: existing?.error ?? null,
      sendId: existing?.sendId ?? null,
      createdBy: existing?.createdBy ?? actor.uid,
      createdAt: existing?.createdAt ?? stamp,
      updatedAt: stamp,
    };
  }

  async function audienceFor(broadcast: Broadcast) {
    const [contacts, suppressed] = await Promise.all([store.listContacts(broadcast.tenantId), store.listSuppressed(broadcast.tenantId)]);
    return resolveAudience(contacts, broadcast.filters, new Set(contacts
      .map(contact => normalizeEmail(contact.email)).filter(email => suppressed.has(communitySuppressionId(email)))));
  }

  function readiness(broadcast: Broadcast, settings: EmailSettings): EmailFailure | null {
    if (!broadcast.subject) return fail('invalid', 'Add a subject before sending.');
    if (!broadcast.bodyHtml.replace(/<[^>]*>/g, '').trim()) return fail('invalid', 'Write something before sending.');
    if (!settings.fromName.trim()) return fail('sender_not_ready', 'Add a sender name in Email settings before sending.');
    if (!settings.replyTo.trim()) return fail('sender_not_ready', 'Add a reply-to email in Email settings before sending.');
    if (!settings.mailingAddress.trim()) return fail('sender_not_ready', 'Add a mailing address in Email settings. It goes at the bottom of every email.');
    return null;
  }

  function parseWhen(when: WhenInput): { at: string | null } | EmailFailure {
    if (when.mode === 'now') return { at: null };
    const at = clean(when.at);
    const ms = Date.parse(at);
    if (!at || Number.isNaN(ms)) return fail('invalid', 'Choose a date and time.');
    if (ms <= now().getTime()) return fail('time_not_future', 'Scheduled time must be in the future.');
    return { at: new Date(ms).toISOString() };
  }

  type Delivered = { broadcast: Broadcast; outcome: SendOutcome; message: string };

  /**
   * Claims the broadcast and reserves its emails against the allowance in one
   * transaction, THEN sends. Whoever loses the claim sends nothing. The
   * reservation counts every recipient up front, so a function that dies mid-send
   * leaves them counted; a clean finish hands back what did not go out.
   */
  async function claimAndDeliver(
    broadcast: Broadcast,
    settings: EmailSettings,
    tenant: { name: string; plan: unknown; createdAt: unknown },
    from: readonly BroadcastStatus[],
  ): Promise<Delivered | EmailFailure> {
    assertUnsubscribeConfigured();
    const provider = await deps.getProvider();
    // Re-read at the moment of sending: someone may have unsubscribed since the preview.
    const audience = await audienceFor(broadcast);
    if (audience.recipients.length === 0) return fail('no_recipients', 'Nobody on this audience can be emailed right now.');
    const check = await checkSending(broadcast.tenantId, tenant, settings, audience.recipients.length);
    if (!check.ok) return check;
    const startedAt = now();
    const sendId = crypto.randomUUID();
    const month = monthKey(startedAt);
    const day = dayKey(startedAt);
    const claim = await store.claimForSend({
      tenantId: broadcast.tenantId,
      broadcastId: broadcast.id,
      from,
      sendId,
      nowIso: startedAt.toISOString(),
      requested: audience.recipients.length,
      allowance: check.allowance,
      dailyCap: check.dailyCap,
      month,
      day,
      expectedContentHash: contentHash(broadcast),
    });
    if (!claim.ok) {
      if (claim.code === 'not_found') return fail('not_found', 'That broadcast does not exist.');
      if (claim.code === 'changed') return fail('confirm_mismatch', 'The email changed after the preview. Preview it again.');
      if (claim.code === 'not_claimable') return fail('already_sent', 'This broadcast has already gone out.');
      if (!('remaining' in claim)) return fail('already_sent', 'This broadcast has already gone out.');
      return capFailure(claim.code, claim.remaining, claim.cap, await loadLimits());
    }

    const sending: Broadcast = { ...broadcast, status: 'sending', sendId, error: null, scheduledAt: null, updatedAt: startedAt.toISOString() };
    const fromAddress: string = check.from;
    const useB = broadcast.subjectB != null;
    const deadline = clockMs() + sendBudgetMs;
    let sent = 0;
    let maybeDelivered = 0;
    const queue = [...audience.recipients.entries()];
    async function worker() {
      for (let next = queue.shift(); next && clockMs() < deadline; next = queue.shift()) {
        const [index, person] = next;
        const firstName = person.name.split(/\s+/)[0] ?? '';
        try {
          if (await store.isSuppressedNow(broadcast.tenantId, person.email)) continue;
          if (clockMs() >= deadline) continue;
          const url = unsubscribeUrl(deps.appOrigin, signUnsubscribe({ tenantId: broadcast.tenantId, email: person.email, broadcastId: broadcast.id }));
          const { html, text } = renderEmail({
            design: broadcast.design,
            bodyHtml: broadcast.bodyHtml,
            preheader: broadcast.preheader,
            churchName: tenant.name,
            senderName: settings.fromName,
            firstName,
            mailingAddress: settings.mailingAddress,
            unsubscribeUrl: url,
          });
          const result = await provider.send({
            to: person.email,
            subject: fillMergeTags(useB && index % 2 === 1 ? (broadcast.subjectB as string) : broadcast.subject, { firstName, senderName: settings.fromName }),
            html,
            text,
            fromName: settings.fromName,
            fromAddress,
            replyTo: settings.replyTo || null,
            headers: listUnsubscribeHeaders(url),
          });
          if (result.ok) sent += 1;
          else if (result.maybeDelivered) maybeDelivered += 1;
        } catch (error) {
          console.error(`[email/send] ${error instanceof Error ? error.message : 'send failed'}`);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, queue.length) }, worker));

    const total = audience.recipients.length;
    const didNotSend = total - sent;
    const stats: BroadcastStats = {
      recipients: total,
      sent,
      failed: didNotSend,
      skippedSuppressed: audience.skipped.suppressed,
      skippedNotOptedIn: audience.skipped.notOptedIn,
    };
    const outcome: SendOutcome = didNotSend === 0 ? 'sent' : sent === 0 ? 'failed' : 'partial';
    const error = didNotSend === 0
      ? null
      : `${didNotSend} of ${total} emails did not send.${sent > 0 ? ` ${sent} went out.` : ''}${maybeDelivered > 0 ? ` ${maybeDelivered} timed out and still count against your allowance, because they may have been delivered.` : ''}`;
    const done: Broadcast = {
      ...sending,
      status: outcome,
      stats,
      error,
      sentAt: sent > 0 ? now().toISOString() : null,
      updatedAt: now().toISOString(),
    };
    const settled = await store.settleSend({ broadcast: done, settlement: { month, day, refund: didNotSend - maybeDelivered } });
    if (sent > 0) await evaluatePause(broadcast.tenantId);
    if (!settled) return { broadcast: done, outcome: 'partial', message: INTERRUPTED };
    return { broadcast: done, outcome, message: error ?? `Sent to ${sent} ${sent === 1 ? 'person' : 'people'}.` };
  }

  /** Marks sends that were claimed and never settled as failed, keeping their reservation counted. */
  async function recoverStuck() {
    const cutoff = new Date(now().getTime() - STALE_SENDING_MS).toISOString();
    const recovered: { tenantId: string; broadcastId: string }[] = [];
    for (const stale of await store.listStaleSending(cutoff)) {
      const broadcast = await store.getBroadcast(stale.tenantId, stale.broadcastId);
      if (!broadcast || broadcast.status !== 'sending' || broadcast.sendId !== stale.sendId) continue;
      const failed: Broadcast = { ...broadcast, status: 'failed', error: INTERRUPTED, scheduledAt: null, updatedAt: now().toISOString() };
      if (await store.settleSend({ broadcast: failed, settlement: null })) recovered.push({ tenantId: stale.tenantId, broadcastId: stale.broadcastId });
    }
    return recovered;
  }

  /** Recovery must never block the action it rides along with, but a failure to recover is logged, not hidden. */
  async function recoverQuietly() {
    try {
      await recoverStuck();
    } catch (error) {
      console.error(`[email/recover] ${error instanceof Error ? error.message : 'failed'}`);
    }
  }

  return {
    async saveDraft(actor: EmailActor, tenantId: string | null | undefined, input: DraftInput) {
      const g = await gate(actor, tenantId, { needPlan: true });
      if (!g.ok) return g;
      let existing: Broadcast | null = null;
      if (input.id) {
        existing = await store.getBroadcast(g.tenantId, input.id);
        if (!existing) return fail('not_found', 'That broadcast does not exist.');
        if (existing.status !== 'draft' && existing.status !== 'scheduled') return fail('already_sent', 'Only drafts and scheduled emails can be edited.');
      }
      const draft = normaliseDraft(input, existing, g, actor);
      if (!existing) {
        await store.saveBroadcast(draft);
        return { ok: true as const, broadcast: draft, unscheduled: false };
      }
      // Editing a scheduled email takes it back to a draft: what was previewed is no longer what would go out.
      if (!(await store.saveBroadcastIf(draft, ['draft', 'scheduled']))) return fail('already_sent', 'This broadcast has started sending and can no longer be edited.');
      const unscheduled = existing.status === 'scheduled';
      if (unscheduled) await store.unqueueScheduled(g.tenantId, draft.id);
      return { ok: true as const, broadcast: draft, unscheduled };
    },

    async list(actor: EmailActor, tenantId: string | null | undefined) {
      const g = await gate(actor, tenantId, { needPlan: true });
      if (!g.ok) return g;
      await recoverQuietly();
      const at = now();
      const limits = await loadLimits();
      const [broadcasts, subscribers, settings, usedMonth, usedToday, sending] = await Promise.all([
        store.listBroadcasts(g.tenantId),
        store.listContacts(g.tenantId),
        store.getSettings(g.tenantId),
        store.usage(g.tenantId, monthKey(at)),
        store.usage(g.tenantId, dayKey(at)),
        store.getSendingState(g.tenantId),
      ]);
      const cap = limits.monthlySends[g.plan];
      const percent = percentUsed(usedMonth, cap);
      const newChurch = isNewChurch(g.tenant.createdAt, at, limits.newChurch.days);
      return {
        ok: true as const,
        broadcasts,
        subscribers,
        settings,
        usage: {
          used: usedMonth,
          cap,
          percent,
          warn: cap > 0 && percent >= limits.warnAtPercent,
          warnAtPercent: limits.warnAtPercent,
          resetsAt: nextMonthStart(at).toISOString(),
          pack: limits.pack,
          daily: newChurch ? { used: usedToday, cap: limits.newChurch.dailyCap, days: limits.newChurch.days } : null,
        },
        sending: sending ? { paused: true as const, ...sending } : { paused: false as const },
        canEditLimits: actor.isSuperAdmin,
        limits: actor.isSuperAdmin ? limits : null,
      };
    },

    /** Platform-wide limits. Super admin only: it changes what every ministry may send. */
    async saveLimits(actor: EmailActor, raw: unknown) {
      if (!actor.isSuperAdmin) return fail('not_authorized', 'Only Harvest can change sending limits.');
      const checked = validateLimits(raw);
      if (!checked.ok) return fail('invalid', checked.message);
      await store.saveLimits(checked.limits);
      return { ok: true as const, limits: checked.limits };
    },

    /** Lifts an auto-pause. Super admin only, after someone has looked at the list. */
    async resumeSending(actor: EmailActor, tenantId: string | null | undefined) {
      if (!actor.isSuperAdmin) return fail('not_authorized', 'Only Harvest can resume paused sending.');
      const id = clean(tenantId);
      if (!id) return fail('invalid', 'A ministry is required.');
      await store.setSendingState(id, null);
      return { ok: true as const };
    },

    /**
     * A bounce or spam complaint from the provider. Marks the CRM person, counts
     * it against the month, and pauses sending if a rate has passed its limit.
     * `eventKey` identifies the provider's event: a repeat of it is ignored, so a
     * redelivered webhook cannot push a rate over its limit. Returns false for a repeat.
     * Order matters for retries: the idempotent suppression is written first so a
     * repeat still suppresses; the claim comes next; the claim is given back if the
     * count fails, so the provider's retry of a failed delivery is counted once.
     */
    async recordFeedback(tenantId: string, email: string, kind: 'bounced' | 'complained', eventKey: string) {
      const at = now();
      const claimKey = `${kind}:${eventKey}`;
      await store.markContactStatus(tenantId, normalizeEmail(email), kind, at.toISOString());
      if (!(await store.claimFeedbackEvent(tenantId, claimKey, at.toISOString()))) return false;
      try {
        await store.addFeedback(tenantId, monthKey(at), kind);
      } catch (error) {
        await store.releaseFeedbackEvent(tenantId, claimKey).catch(() => undefined);
        throw error;
      }
      await evaluatePause(tenantId);
      return true;
    },

    /** Which ministry sent from this address. Null when it is not a ministry's verified domain (a shared Harvest sender, or unknown). */
    async tenantForSender(fromAddress: string): Promise<string | null> {
      const domain = (domainOfAddress(fromAddress) ?? '').replace(/^mail\./, '');
      if (!domain || reserved(domain)) return null;
      return store.getDomainOwner(domain);
    },

    /** Housekeeping the daily cron runs: expired confirm tokens and expired dedupe records. */
    async purgeExpired() {
      const [tokens, feedback] = await Promise.all([ledger.purgeExpired(now().getTime()), store.purgeExpiredFeedbackEvents(now().toISOString())]);
      return { tokens, feedback };
    },

    async remove(actor: EmailActor, tenantId: string | null | undefined, id: string) {
      const g = await gate(actor, tenantId, { needPlan: true });
      if (!g.ok) return g;
      const existing = await store.getBroadcast(g.tenantId, id);
      if (!existing) return fail('not_found', 'That broadcast does not exist.');
      if (!(await store.removeBroadcastIf(g.tenantId, id, ['draft', 'scheduled', 'failed']))) {
        return fail('already_sent', 'A broadcast that has gone out stays in your history.');
      }
      await store.unqueueScheduled(g.tenantId, id);
      return { ok: true as const };
    },

    async send(
      actor: EmailActor,
      tenantId: string | null | undefined,
      input: { id: string; when: WhenInput; mode: 'preview' | 'confirm'; confirmToken?: string | null },
    ): Promise<SendCommitResult> {
      const g = await gate(actor, tenantId, { needPlan: true });
      if (!g.ok) return g;
      if (!tenantAllows(g.tenant.status, 'publishing')) return fail('publishing_closed', ARCHIVED_ACTION_MESSAGE);
      await recoverQuietly();
      const broadcast = await store.getBroadcast(g.tenantId, input.id);
      if (!broadcast) return fail('not_found', 'That broadcast does not exist.');
      if (broadcast.status !== 'draft' && broadcast.status !== 'scheduled') return fail('already_sent', 'This broadcast has already gone out.');
      const settings = await store.getSettings(g.tenantId);
      const notReady = readiness(broadcast, settings);
      if (notReady) return notReady;
      const when = parseWhen(input.when);
      if ('ok' in when) return when;
      const audience = await audienceFor(broadcast);
      if (audience.recipients.length === 0) return fail('no_recipients', 'Nobody on this audience can be emailed right now.');
      const check = await checkSending(g.tenantId, g.tenant, settings, audience.recipients.length);
      if (!check.ok) return check;
      const action: EmailConfirmAction = when.at ? 'schedule' : 'send';
      const preview: SendPreview = {
        broadcastId: broadcast.id,
        action,
        recipientCount: audience.recipients.length,
        skipped: audience.skipped,
        from: `${settings.fromName} <${check.from}>`,
        subject: broadcast.subject,
        at: when.at,
        capRemainingAfter: check.remaining,
      };
      const binding: EmailConfirmBinding = {
        action,
        tenantId: g.tenantId,
        uid: actor.uid,
        broadcastId: broadcast.id,
        payloadHash: hashEmailPayload({
          subject: broadcast.subject,
          subjectB: broadcast.subjectB,
          preheader: broadcast.preheader,
          bodyHtml: broadcast.bodyHtml,
          filters: broadcast.filters,
          at: when.at,
          recipientCount: audience.recipients.length,
        }),
      };
      if (input.mode !== 'confirm') {
        const token = await ledger.issue(binding, now().getTime());
        return { ok: true, requiresConfirm: true, confirmToken: token, preview };
      }
      const presented = clean(input.confirmToken);
      if (!presented) return fail('confirm_required', 'Preview this send and confirm it before it goes out.');
      const decision = await ledger.consume(presented, binding, now().getTime());
      if (decision === 'expired') return fail('confirm_expired', 'That confirmation expired. Preview the send again.');
      if (decision === 'reused') return fail('confirm_reused', 'That confirmation was already used.');
      if (decision !== 'ok') return fail('confirm_mismatch', 'The email or audience changed after the preview. Preview it again.');
      if (when.at) {
        const scheduled = await store.saveBroadcastIf({ ...broadcast, status: 'scheduled', scheduledAt: when.at, error: null, updatedAt: now().toISOString() }, ['draft', 'scheduled'], contentHash(broadcast));
        if (!scheduled) {
          const latest = await store.getBroadcast(g.tenantId, broadcast.id);
          if (latest && (latest.status === 'draft' || latest.status === 'scheduled')) return fail('confirm_mismatch', 'The email changed after the preview. Preview it again.');
          return fail('already_sent', 'This broadcast has already gone out.');
        }
        await store.queueScheduled(g.tenantId, broadcast.id, when.at);
        return { ok: true, outcome: 'scheduled', preview, stats: null, message: 'Scheduled.' };
      }
      const done = await claimAndDeliver(broadcast, settings, g.tenant, ['draft', 'scheduled']);
      if ('ok' in done) return done;
      return { ok: true, outcome: done.outcome, preview, stats: done.broadcast.stats, message: done.message };
    },

    /** The exact HTML a recipient would get, filled in for a sample person. Sends nothing. */
    async preview(actor: EmailActor, tenantId: string | null | undefined, input: DraftInput & { dark?: boolean }) {
      const g = await gate(actor, tenantId, { needPlan: true });
      if (!g.ok) return g;
      const settings = await store.getSettings(g.tenantId);
      const design = { ...DEFAULT_EMAIL_DESIGN, ...(input.design ?? {}) };
      const { html } = renderEmail({
        design,
        bodyHtml: String(input.bodyHtml ?? ''),
        preheader: clean(input.preheader),
        churchName: g.tenant.name,
        senderName: settings.fromName,
        firstName: 'Alex',
        mailingAddress: settings.mailingAddress,
        unsubscribeUrl: `${deps.appOrigin.replace(/\/$/, '')}/api/email/unsubscribe`,
        dark: input.dark === true,
      });
      return { ok: true as const, html };
    },

    /** Sends the actor a copy. Not counted against the cap, never reaches the list. */
    async sendTest(actor: EmailActor, tenantId: string | null | undefined, id: string) {
      const g = await gate(actor, tenantId, { needPlan: true });
      if (!g.ok) return g;
      const broadcast = await store.getBroadcast(g.tenantId, id);
      if (!broadcast) return fail('not_found', 'That broadcast does not exist.');
      const settings = await store.getSettings(g.tenantId);
      const notReady = readiness(broadcast, settings);
      if (notReady) return notReady;
      const to = normalizeEmail(actor.email);
      if (!to) return fail('invalid', 'Your account has no email address to send a test to.');
      const testFrom = (await ownSenderAddress(g.tenantId, settings)) ?? deps.fallbackFrom ?? null;
      if (!testFrom) return fail('sender_not_ready', 'Email sending is not set up on this server yet, so nothing was sent. Contact Harvest.');
      const provider = await deps.getProvider();
      const url = unsubscribeUrl(deps.appOrigin, signUnsubscribe({ tenantId: g.tenantId, email: to, broadcastId: broadcast.id }));
      const { html, text } = renderEmail({
        design: broadcast.design, bodyHtml: broadcast.bodyHtml, preheader: broadcast.preheader, churchName: g.tenant.name,
        senderName: settings.fromName, firstName: 'Alex', mailingAddress: settings.mailingAddress, unsubscribeUrl: url,
      });
      const result = await provider.send({
        to, subject: `[Test] ${fillMergeTags(broadcast.subject, { firstName: 'Alex', senderName: settings.fromName })}`, html, text, fromName: settings.fromName,
        fromAddress: testFrom, replyTo: settings.replyTo || null, headers: listUnsubscribeHeaders(url),
      });
      if (!result.ok) return fail('provider_unavailable', 'The test email could not be sent. Try again.');
      return { ok: true as const };
    },

    /**
     * CSV import into the CRM. A row whose address is already a CRM person
     * merges onto that person (opt-in recorded, tags added); otherwise a new
     * CRM person is created. Someone who unsubscribed, bounced or complained is
     * never re-subscribed by an import.
     */
    async importContacts(
      actor: EmailActor,
      tenantId: string | null | undefined,
      input: { rows: readonly ImportRow[]; consentConfirmed: boolean },
    ) {
      const g = await gate(actor, tenantId, { needPlan: true });
      if (!g.ok) return g;
      if (input.consentConfirmed !== true) return fail('invalid', 'Confirm that these people asked to hear from you.');
      if (input.rows.length > MAX_IMPORT_ROWS) return fail('invalid', `Import up to ${MAX_IMPORT_ROWS} people at a time.`);
      const [existing, suppressed] = await Promise.all([store.listContacts(g.tenantId), store.listSuppressed(g.tenantId)]);
      const byEmail = new Map<string, EmailContact[]>();
      for (const c of existing) {
        const key = normalizeEmail(c.email);
        byEmail.set(key, [...(byEmail.get(key) ?? []), c]);
      }
      const at = now().toISOString();
      const creates = new Map<string, NewContact>();
      const updates: ContactUpdate[] = [];
      const touched = new Set<string>();
      let invalid = 0;
      let repeatedInFile = 0;
      let alreadySubscribed = 0;
      let blocked = 0;
      for (const row of input.rows) {
        const email = normalizeEmail(row.email);
        if (!EMAIL_SHAPE.test(email)) { invalid += 1; continue; }
        if (touched.has(email)) { repeatedInFile += 1; continue; }
        touched.add(email);
        const tags = (row.tags ?? []).map(clean).filter(Boolean);
        const matches = byEmail.get(email) ?? [];
        if (suppressed.has(communitySuppressionId(email)) || matches.some((c) => isSuppressed(c.status))) { blocked += 1; continue; }
        if (matches.length === 0) {
          const [first = '', ...rest] = clean(row.name).split(/\s+/);
          creates.set(email, { email, firstName: first, lastName: rest.join(' '), tags, source: 'import', at });
          continue;
        }
        const pending = matches.filter((c) => c.status !== 'subscribed' || tags.some((t) => !c.tags.includes(t)));
        if (pending.length === 0) { alreadySubscribed += 1; continue; }
        for (const c of pending) updates.push({ id: c.id, subscribe: c.status !== 'subscribed', addTags: tags, source: 'import', at });
      }
      if (creates.size > 0) await store.createContacts(g.tenantId, [...creates.values()], actor.uid);
      if (updates.length > 0) await store.updateContacts(g.tenantId, updates);
      return {
        ok: true as const,
        added: creates.size,
        merged: updates.filter((u) => u.subscribe).length,
        alreadySubscribed,
        blocked,
        invalid,
        repeatedInFile,
      };
    },

    async saveSettings(actor: EmailActor, tenantId: string | null | undefined, input: Partial<EmailSettings>) {
      const g = await gate(actor, tenantId, { needPlan: true });
      if (!g.ok) return g;
      const current = await store.getSettings(g.tenantId);
      const replyTo = input.replyTo !== undefined ? clean(input.replyTo) : current.replyTo;
      if (replyTo && !EMAIL_SHAPE.test(replyTo)) return fail('invalid', 'Enter a valid reply-to email.');
      const fromLocal = input.fromLocal !== undefined ? clean(input.fromLocal).toLowerCase() : current.fromLocal;
      if (!/^[a-z0-9._-]{1,40}$/.test(fromLocal)) return fail('invalid', 'The address before @ can use letters, numbers, dots, dashes and underscores.');
      const next: EmailSettings = {
        ...current,
        fromName: input.fromName !== undefined ? clean(input.fromName) : current.fromName,
        fromLocal,
        replyTo,
        mailingAddress: input.mailingAddress !== undefined ? clean(input.mailingAddress) : current.mailingAddress,
      };
      await store.saveSettings(g.tenantId, next);
      return { ok: true as const, settings: next };
    },

    async domain(actor: EmailActor, tenantId: string | null | undefined, input: { op: 'register' | 'check'; domain?: string }) {
      const g = await gate(actor, tenantId, { needPlan: true });
      if (!g.ok) return g;
      const current = await store.getSettings(g.tenantId);
      const domain = (input.op === 'register' ? clean(input.domain) : current.domain).toLowerCase().replace(/^mail\./, '');
      if (!/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return fail('invalid', 'Enter your ministry domain, like gracechurch.org.');
      if (reserved(domain)) return fail('domain_reserved', 'That domain belongs to Harvest and cannot be used for your emails. Use a domain your ministry owns.');
      const previous = current.domain;
      const taken = () => fail('domain_taken', 'That domain is already connected to another ministry on Harvest. If it is yours, contact Harvest support to move it.');
      const claim = await store.claimDomain(g.tenantId, domain);
      if (claim === 'taken' || claim === 'released') return taken();
      const provider = await deps.getProvider();
      let status: DomainStatus;
      try {
        // Plunk's verification is account-wide. A domain nobody here has claimed but that the account
        // already verified was proven by somebody else's DNS: do not hand that proof to this ministry.
        if (claim === 'fresh' && (await provider.findDomain(`mail.${domain}`))?.state === 'verified') {
          await store.discardClaim(g.tenantId, domain);
          return taken();
        }
        status = input.op === 'register'
          ? await provider.registerDomain(`mail.${domain}`)
          : await provider.getDomainStatus(`mail.${domain}`);
      } catch (error) {
        if (claim === 'fresh') await store.discardClaim(g.tenantId, domain);
        throw error;
      }
      const next: EmailSettings = { ...current, domain, domainState: status.state, domainRecords: status.records };
      await store.saveSettings(g.tenantId, next);
      if (previous && previous !== domain) await store.releaseDomain(g.tenantId, previous);
      return { ok: true as const, settings: next };
    },

    /** Public unsubscribe. Idempotent; the token is the only credential. */
    async optOut(tenantId: string, email: string, broadcastId: string) {
      await store.recordOptOut(tenantId, normalizeEmail(email), broadcastId, now().toISOString());
    },

    /**
     * Cron: first recovers sends that died mid-way, then sends every scheduled
     * broadcast whose time has come. Each one is CLAIMED in a transaction before
     * anything is sent, so an overlapping run skips what another run holds. One
     * failure never blocks the rest.
     */
    async runDue() {
      const results: { tenantId: string; broadcastId: string; outcome: SendOutcome | 'skipped'; message: string }[] = [];
      for (const item of await recoverStuck()) results.push({ ...item, outcome: 'failed', message: INTERRUPTED });
      const due = await store.listDue(now().toISOString());
      for (const item of due) {
        try {
          const broadcast = await store.getBroadcast(item.tenantId, item.broadcastId);
          if (!broadcast || broadcast.status !== 'scheduled') {
            await store.unqueueScheduled(item.tenantId, item.broadcastId);
            results.push({ ...item, outcome: 'skipped', message: 'No longer scheduled.' });
            continue;
          }
          const failScheduled = async (message: string) => {
            await store.saveBroadcastIf({ ...broadcast, status: 'failed', error: message, scheduledAt: null, updatedAt: now().toISOString() }, ['scheduled']);
            await store.unqueueScheduled(item.tenantId, item.broadcastId);
            results.push({ ...item, outcome: 'failed', message });
          };
          const tenant = await store.getTenant(item.tenantId);
          const plan = toTenantPlan(typeof tenant?.plan === 'string' ? tenant.plan : null);
          if (!tenant || !hasFeature(plan, 'newsletterAutomation') || !tenantAllows(tenant.status, 'publishing')) {
            await failScheduled('Sending is not available for this ministry.');
            continue;
          }
          const done = await claimAndDeliver(broadcast, await store.getSettings(item.tenantId), tenant, ['scheduled']);
          if (!('ok' in done)) {
            await store.unqueueScheduled(item.tenantId, item.broadcastId);
            results.push({ ...item, outcome: done.outcome, message: done.message });
          } else if (done.error === 'already_sent' || done.error === 'not_found') {
            await store.unqueueScheduled(item.tenantId, item.broadcastId);
            results.push({ ...item, outcome: 'skipped', message: 'Another run already took this one.' });
          } else if (done.error === 'confirm_mismatch') {
            results.push({ ...item, outcome: 'skipped', message: 'It was edited while this run was reading it. It stays queued for the next run.' });
          } else {
            await failScheduled(done.message);
          }
        } catch (error) {
          results.push({ ...item, outcome: 'failed', message: error instanceof Error ? error.message : 'Send failed.' });
        }
      }
      return results;
    },
  };
}

export type EmailService = ReturnType<typeof createEmailService>;
