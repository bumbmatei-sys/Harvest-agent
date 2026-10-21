import 'server-only';

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
import { listUnsubscribeHeaders, signUnsubscribe, unsubscribeUrl } from '@/lib/email/unsubscribe';
import { resolveLimits, validateLimits, type EmailLimits } from '@/lib/email/limits';
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
  saveBroadcast(broadcast: Broadcast): Promise<void>;
  removeBroadcast(tenantId: string, id: string): Promise<void>;
  listBroadcasts(tenantId: string): Promise<readonly Broadcast[]>;
  /** CRM people (`contacts`) for this ministry, with their email status. One list. */
  listContacts(tenantId: string): Promise<readonly EmailContact[]>;
  /** New CRM people created by an import. */
  createContacts(tenantId: string, rows: readonly NewContact[], uid: string): Promise<void>;
  /** Fields merged onto existing CRM people. Never touches status of a suppressed person. */
  updateContacts(tenantId: string, updates: readonly ContactUpdate[]): Promise<void>;
  /** Emails sent under one key: a month ('2031-03') or a day ('2031-03-10'). */
  usage(tenantId: string, key: string): Promise<number>;
  addUsage(tenantId: string, key: string, sent: number): Promise<void>;
  /** Sent, bounced and complained for one month. */
  health(tenantId: string, month: string): Promise<Health>;
  addFeedback(tenantId: string, month: string, kind: 'bounced' | 'complained'): Promise<void>;
  /** Marks every CRM person with this address bounced or complained. Idempotent. */
  markContactStatus(tenantId: string, email: string, status: 'bounced' | 'complained', at: string): Promise<void>;
  queueScheduled(tenantId: string, broadcastId: string, at: string): Promise<void>;
  unqueueScheduled(tenantId: string, broadcastId: string): Promise<void>;
  listDue(nowIso: string): Promise<readonly { tenantId: string; broadcastId: string }[]>;
  /** The opt-out record: marks every CRM person with this address unsubscribed. Idempotent. */
  recordOptOut(tenantId: string, email: string, broadcastId: string, at: string): Promise<void>;
}

export interface SendingState {
  readonly pausedAt: string;
  readonly reason: 'bounce' | 'complaint';
  readonly rate: number;
  readonly threshold: number;
}

export type EmailErrorCode =
  | 'not_authorized' | 'cross_tenant' | 'not_found' | 'invalid' | 'plan_required' | 'publishing_closed'
  | 'sender_not_ready' | 'no_recipients' | 'volume_cap' | 'daily_cap' | 'domain_required' | 'sending_paused' | 'time_not_future' | 'already_sent'
  | 'confirm_required' | 'confirm_expired' | 'confirm_reused' | 'confirm_mismatch' | 'provider_unavailable';

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
  now?: () => Date;
  newId?: () => string;
}) {
  const { store, ledger } = deps;
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());

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
  ): Promise<EmailFailure | { ok: true; from: string; remaining: number }> {
    const limits = await loadLimits();
    const state = await store.getSendingState(tenantId);
    if (state) return fail('sending_paused', pauseMessage(state));
    let from = senderAddress(settings);
    if (!from) {
      if (requested > limits.largeSendThreshold) {
        return fail('domain_required', `Sending to more than ${limits.largeSendThreshold.toLocaleString()} people needs a verified sending domain. Verify yours in Email settings.`);
      }
      if (!deps.fallbackFrom) return fail('sender_not_ready', 'Verify your sending domain in Email settings before sending.');
      from = deps.fallbackFrom;
    }
    const plan = toTenantPlan(typeof tenant.plan === 'string' ? tenant.plan : null);
    const at = now();
    const [usedMonth, usedToday] = await Promise.all([store.usage(tenantId, monthKey(at)), store.usage(tenantId, dayKey(at))]);
    const decision = decideSend({
      allowance: limits.monthlySends[plan],
      usedMonth,
      usedToday,
      requested,
      newChurch: isNewChurch(tenant.createdAt, at, limits.newChurch.days),
      dailyCap: limits.newChurch.dailyCap,
    });
    if (!decision.ok) {
      return decision.code === 'volume_cap'
        ? fail('volume_cap', `This send would pass your monthly allowance. You have ${decision.remaining.toLocaleString()} of ${decision.cap.toLocaleString()} emails left this month.`)
        : fail('daily_cap', `New ministries can send up to ${decision.cap.toLocaleString()} emails a day for their first ${limits.newChurch.days} days. You have ${decision.remaining.toLocaleString()} left today.`);
    }
    return { ok: true, from, remaining: decision.remaining };
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
      status: existing?.status ?? 'draft',
      scheduledAt: existing?.scheduledAt ?? null,
      sentAt: existing?.sentAt ?? null,
      stats: existing?.stats ?? null,
      error: existing?.error ?? null,
      createdBy: existing?.createdBy ?? actor.uid,
      createdAt: existing?.createdAt ?? stamp,
      updatedAt: stamp,
    };
  }

  async function audienceFor(broadcast: Broadcast) {
    return resolveAudience(await store.listContacts(broadcast.tenantId), broadcast.filters);
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

  async function deliver(broadcast: Broadcast, settings: EmailSettings): Promise<{ broadcast: Broadcast; outcome: SendOutcome; message: string }> {
    const provider = await deps.getProvider();
    // Re-read at the moment of sending: someone may have unsubscribed since the preview.
    const audience = await audienceFor(broadcast);
    const month = monthKey(now());
    const tenant = await store.getTenant(broadcast.tenantId);
    const stampBase = { ...broadcast, updatedAt: now().toISOString() };
    const check = tenant
      ? await checkSending(broadcast.tenantId, tenant, settings, audience.recipients.length)
      : fail('not_found', 'This ministry could not be read.');
    if (!check.ok) {
      const failed: Broadcast = { ...stampBase, status: 'failed', error: check.message, scheduledAt: null };
      await store.saveBroadcast(failed);
      return { broadcast: failed, outcome: 'failed', message: check.message };
    }
    const fromAddress: string = check.from;
    const tenantName = tenant?.name ?? '';
    const useB = broadcast.subjectB != null;
    let sent = 0;
    let failed = 0;
    const queue = [...audience.recipients.entries()];
    async function worker() {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const [index, person] = next;
        const url = unsubscribeUrl(deps.appOrigin, signUnsubscribe({ tenantId: broadcast.tenantId, email: person.email, broadcastId: broadcast.id }));
        const { html, text } = renderEmail({
          design: broadcast.design,
          bodyHtml: broadcast.bodyHtml,
          preheader: broadcast.preheader,
          churchName: tenantName,
          senderName: settings.fromName,
          firstName: person.name.split(/\s+/)[0] ?? '',
          mailingAddress: settings.mailingAddress,
          unsubscribeUrl: url,
        });
        const result = await provider.send({
          to: person.email,
          subject: fillMergeTags(useB && index % 2 === 1 ? (broadcast.subjectB as string) : broadcast.subject, { firstName: person.name.split(/\s+/)[0] ?? '', senderName: settings.fromName }),
          html,
          text,
          fromName: settings.fromName,
          fromAddress,
          replyTo: settings.replyTo || null,
          headers: listUnsubscribeHeaders(url),
        });
        if (result.ok) sent += 1;
        else failed += 1;
      }
    }
    await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, queue.length) }, worker));
    if (sent > 0) {
      await store.addUsage(broadcast.tenantId, month, sent);
      await store.addUsage(broadcast.tenantId, dayKey(now()), sent);
      await evaluatePause(broadcast.tenantId);
    }
    const stats: BroadcastStats = {
      recipients: audience.recipients.length,
      sent,
      failed,
      skippedSuppressed: audience.skipped.suppressed,
      skippedNotOptedIn: audience.skipped.notOptedIn,
    };
    const outcome: SendOutcome = failed === 0 ? 'sent' : sent === 0 ? 'failed' : 'partial';
    const error = failed === 0 ? null : `${failed} of ${stats.recipients} emails did not send.${sent > 0 ? ` ${sent} went out.` : ''}`;
    const done: Broadcast = {
      ...stampBase,
      status: outcome === 'sent' ? 'sent' : outcome,
      stats,
      error,
      scheduledAt: null,
      sentAt: sent > 0 ? now().toISOString() : null,
    };
    await store.saveBroadcast(done);
    return { broadcast: done, outcome, message: error ?? `Sent to ${sent} ${sent === 1 ? 'person' : 'people'}.` };
  }

  return {
    async saveDraft(actor: EmailActor, tenantId: string | null | undefined, input: DraftInput) {
      const g = await gate(actor, tenantId, { needPlan: true });
      if (!g.ok) return g;
      let existing: Broadcast | null = null;
      if (input.id) {
        existing = await store.getBroadcast(g.tenantId, input.id);
        if (!existing) return fail('not_found', 'That broadcast does not exist.');
        if (existing.status !== 'draft') return fail('already_sent', 'Only drafts can be edited.');
      }
      const draft = normaliseDraft(input, existing, g, actor);
      await store.saveBroadcast(draft);
      return { ok: true as const, broadcast: draft };
    },

    async list(actor: EmailActor, tenantId: string | null | undefined) {
      const g = await gate(actor, tenantId, { needPlan: true });
      if (!g.ok) return g;
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
     * Nothing calls this yet: it is the entry point for a provider webhook.
     */
    async recordFeedback(tenantId: string, email: string, kind: 'bounced' | 'complained') {
      const at = now();
      await store.markContactStatus(tenantId, normalizeEmail(email), kind, at.toISOString());
      await store.addFeedback(tenantId, monthKey(at), kind);
      await evaluatePause(tenantId);
    },

    async remove(actor: EmailActor, tenantId: string | null | undefined, id: string) {
      const g = await gate(actor, tenantId, { needPlan: true });
      if (!g.ok) return g;
      const existing = await store.getBroadcast(g.tenantId, id);
      if (!existing) return fail('not_found', 'That broadcast does not exist.');
      if (existing.status === 'sending' || existing.status === 'sent' || existing.status === 'partial') {
        return fail('already_sent', 'A broadcast that has gone out stays in your history.');
      }
      await store.unqueueScheduled(g.tenantId, id);
      await store.removeBroadcast(g.tenantId, id);
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
        await store.saveBroadcast({ ...broadcast, status: 'scheduled', scheduledAt: when.at, error: null, updatedAt: now().toISOString() });
        await store.queueScheduled(g.tenantId, broadcast.id, when.at);
        return { ok: true, outcome: 'scheduled', preview, stats: null, message: 'Scheduled.' };
      }
      await store.saveBroadcast({ ...broadcast, status: 'sending', updatedAt: now().toISOString() });
      const done = await deliver({ ...broadcast, status: 'sending' }, settings);
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
      const testFrom = senderAddress(settings) ?? deps.fallbackFrom ?? null;
      if (!testFrom) return fail('sender_not_ready', 'Verify your sending domain in Email settings before sending.');
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
      const existing = await store.listContacts(g.tenantId);
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
        if (matches.some((c) => isSuppressed(c.status))) { blocked += 1; continue; }
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
      const provider = await deps.getProvider();
      const status: DomainStatus = input.op === 'register'
        ? await provider.registerDomain(`mail.${domain}`)
        : await provider.getDomainStatus(`mail.${domain}`);
      const next: EmailSettings = { ...current, domain, domainState: status.state, domainRecords: status.records };
      await store.saveSettings(g.tenantId, next);
      return { ok: true as const, settings: next };
    },

    /** Public unsubscribe. Idempotent; the token is the only credential. */
    async optOut(tenantId: string, email: string, broadcastId: string) {
      await store.recordOptOut(tenantId, normalizeEmail(email), broadcastId, now().toISOString());
    },

    /** Cron: sends every scheduled broadcast whose time has come. One failure never blocks the rest. */
    async runDue() {
      const due = await store.listDue(now().toISOString());
      const results: { tenantId: string; broadcastId: string; outcome: SendOutcome | 'skipped'; message: string }[] = [];
      for (const item of due) {
        try {
          const broadcast = await store.getBroadcast(item.tenantId, item.broadcastId);
          await store.unqueueScheduled(item.tenantId, item.broadcastId);
          if (!broadcast || broadcast.status !== 'scheduled') {
            results.push({ ...item, outcome: 'skipped', message: 'No longer scheduled.' });
            continue;
          }
          const tenant = await store.getTenant(item.tenantId);
          const plan = toTenantPlan(typeof tenant?.plan === 'string' ? tenant.plan : null);
          if (!tenant || !hasFeature(plan, 'newsletterAutomation') || !tenantAllows(tenant.status, 'publishing')) {
            const blocked: Broadcast = { ...broadcast, status: 'failed', error: 'Sending is not available for this ministry.', scheduledAt: null, updatedAt: now().toISOString() };
            await store.saveBroadcast(blocked);
            results.push({ ...item, outcome: 'failed', message: blocked.error ?? '' });
            continue;
          }
          const done = await deliver({ ...broadcast, status: 'sending' }, await store.getSettings(item.tenantId));
          results.push({ ...item, outcome: done.outcome, message: done.message });
        } catch (error) {
          results.push({ ...item, outcome: 'failed', message: error instanceof Error ? error.message : 'Send failed.' });
        }
      }
      return results;
    },
  };
}

export type EmailService = ReturnType<typeof createEmailService>;
