import type { AudienceFilter, EmailContact } from '@/lib/email/audience';
import type { EmailDesign } from '@/lib/email/design';
import type { EmailLimits } from '@/lib/email/limits';
import type { CustomTheme, EmailThemeTokens, SocialLink, SocialPlatform } from '@/lib/email/themes';
import type { Broadcast, EmailSettings, SendPreview, BroadcastStats } from '@/lib/email/service';
import { NEWSLETTER_HIDDEN_MESSAGE } from '@/lib/newsletter-feature';

/**
 * The browser's only view of the email backend. The screens take an
 * `EmailApi` as a prop and never import a vendor, so the provider behind the
 * server is invisible here and a test or screenshot harness can pass a fake.
 */

export type { Broadcast, EmailSettings, SendPreview, BroadcastStats, EmailContact, AudienceFilter, EmailDesign, EmailLimits, CustomTheme, EmailThemeTokens, SocialLink, SocialPlatform };

export interface Usage {
  readonly used: number;
  readonly cap: number;
  readonly percent: number;
  readonly warn: boolean;
  readonly warnAtPercent: number;
  /** ISO instant the monthly allowance resets (start of next month, UTC). */
  readonly resetsAt: string;
  readonly pack: { readonly size: number; readonly priceUsd: number | null };
  /** Present only while the ministry is inside its new-ministry window. */
  readonly daily: { readonly used: number; readonly cap: number; readonly days: number } | null;
}

export type SendingStatus =
  | { readonly paused: false }
  | { readonly paused: true; readonly reason: 'bounce' | 'complaint'; readonly rate: number; readonly threshold: number; readonly pausedAt: string };

export interface Overview {
  readonly broadcasts: readonly Broadcast[];
  readonly subscribers: readonly EmailContact[];
  readonly settings: EmailSettings;
  /** The ministry's saved themes, oldest first. */
  readonly customThemes: readonly CustomTheme[];
  readonly usage: Usage;
  readonly sending: SendingStatus;
  /** True only for a super admin, who may edit the platform-wide limits. */
  readonly canEditLimits: boolean;
  readonly limits: EmailLimits | null;
}

export interface DraftFields {
  readonly id?: string | null;
  readonly subject?: string;
  readonly subjectB?: string | null;
  readonly preheader?: string;
  readonly bodyHtml?: string;
  readonly design?: Partial<EmailDesign>;
  readonly filters?: readonly AudienceFilter[];
  /** The theme this draft renders with, and the token snapshot that goes with it. */
  readonly themeId?: string | null;
  readonly themeTokens?: EmailThemeTokens | null;
}

export interface ImportRowInput {
  readonly email: string;
  readonly name?: string;
  readonly tags?: readonly string[];
}

export interface ImportSummary {
  readonly added: number;
  readonly merged: number;
  readonly alreadySubscribed: number;
  readonly blocked: number;
  readonly invalid: number;
  readonly repeatedInFile: number;
}

export type SendWhen = { readonly mode: 'now' } | { readonly mode: 'at'; readonly at: string };

export type SendResponse =
  | { readonly requiresConfirm: true; readonly confirmToken: string; readonly preview: SendPreview }
  | { readonly outcome: 'sent' | 'partial' | 'failed' | 'scheduled'; readonly preview: SendPreview; readonly stats: BroadcastStats | null; readonly message: string };

/** What a failed call looks like. `notConfigured` is the friendly 503. */
export class EmailApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly notConfigured: boolean,
  ) {
    super(message);
    this.name = 'EmailApiError';
  }
}

/** Where "Open settings" should land inside Email settings. */
export type SettingsFocus = 'sender' | 'domain';

export const NOT_CONFIGURED_COPY = 'Email sending is not set up on this server yet. You can write and save drafts; nothing will be sent until it is.';

export interface EmailApi {
  overview(): Promise<Overview>;
  saveDraft(draft: DraftFields): Promise<Broadcast>;
  remove(id: string): Promise<void>;
  preview(draft: DraftFields & { dark?: boolean }): Promise<string>;
  send(input: { id: string; when: SendWhen; mode: 'preview' | 'confirm'; confirmToken?: string }): Promise<SendResponse>;
  sendTest(id: string): Promise<void>;
  importContacts(rows: readonly ImportRowInput[], consentConfirmed: boolean): Promise<ImportSummary>;
  saveSettings(settings: Partial<EmailSettings>): Promise<EmailSettings>;
  /** Saves a named copy of a token set. Server-side cap: 10 saved themes. */
  saveTheme(input: { id?: string | null; name: string; tokens: EmailThemeTokens }): Promise<CustomTheme>;
  deleteTheme(id: string): Promise<void>;
  /** Sets the theme new emails start with. Null clears the default. */
  setDefaultTheme(themeId: string | null): Promise<EmailSettings>;
  saveLimits(limits: EmailLimits): Promise<EmailLimits>;
  resumeSending(tenantId: string | null): Promise<void>;
  domain(op: 'register' | 'check', domain?: string): Promise<EmailSettings>;
}

type Call = (body: Record<string, unknown>) => Promise<{ status: number; json: Record<string, unknown> }>;

async function run<T>(call: Call, body: Record<string, unknown>): Promise<T> {
  let res: { status: number; json: Record<string, unknown> };
  try {
    res = await call(body);
  } catch {
    throw new EmailApiError('Could not reach the server. Check your connection and try again.', 'network', false);
  }
  if (res.status === 503) {
    // The switch being off is not a setup problem: say so, in the server's own words.
    if (res.json.error === 'newsletter_hidden') throw new EmailApiError(NEWSLETTER_HIDDEN_MESSAGE, 'newsletter_hidden', false);
    // No database: drafts cannot be saved either, so the drafts promise below would be false.
    if (res.json.error === 'database_unavailable' && typeof res.json.message === 'string') throw new EmailApiError(res.json.message, 'database_unavailable', false);
    throw new EmailApiError(NOT_CONFIGURED_COPY, 'not_configured', true);
  }
  if (res.status >= 200 && res.status < 300 && res.json.ok !== false) return res.json as T;
  const message = typeof res.json.message === 'string' ? res.json.message : 'Something went wrong. Try again.';
  throw new EmailApiError(message, typeof res.json.error === 'string' ? res.json.error : 'error', false);
}

export function createEmailApi(tenantId: string | null, call: Call): EmailApi {
  const t = { tenantId };
  return {
    overview: () => run<Overview>(call, { ...t, action: 'overview' }),
    saveDraft: async (draft) => (await run<{ broadcast: Broadcast }>(call, { ...t, action: 'saveDraft', draft })).broadcast,
    remove: async (id) => { await run(call, { ...t, action: 'delete', id }); },
    preview: async (draft) => (await run<{ html: string }>(call, { ...t, action: 'preview', draft })).html,
    send: (input) => run<SendResponse>(call, { ...t, action: 'send', ...input }),
    sendTest: async (id) => { await run(call, { ...t, action: 'sendTest', id }); },
    importContacts: (rows, consentConfirmed) => run<ImportSummary>(call, { ...t, action: 'import', rows, consentConfirmed }),
    saveSettings: async (settings) => (await run<{ settings: EmailSettings }>(call, { ...t, action: 'saveSettings', settings })).settings,
    saveTheme: async (theme) => (await run<{ theme: CustomTheme }>(call, { ...t, action: 'saveTheme', theme })).theme,
    deleteTheme: async (id) => { await run(call, { ...t, action: 'deleteTheme', id }); },
    setDefaultTheme: async (themeId) => (await run<{ settings: EmailSettings }>(call, { ...t, action: 'setDefaultTheme', themeId })).settings,
    saveLimits: async (limits) => (await run<{ limits: EmailLimits }>(call, { ...t, action: 'saveLimits', limits })).limits,
    resumeSending: async (tenantId) => { await run(call, { action: 'resumeSending', tenantId }); },
    domain: async (op, domain) => (await run<{ settings: EmailSettings }>(call, { ...t, action: 'domain', op, domain })).settings,
  };
}

/** The real transport: Firebase-authenticated POST to /api/email/actions. */
export function authedCall(authFetch: (url: string, init?: RequestInit) => Promise<Response>): Call {
  return async (body) => {
    const res = await authFetch('/api/email/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, json };
  };
}
