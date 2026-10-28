'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';

import { BroadcastEditor } from '@/components/email/BroadcastEditor';
import { DesignDialog } from '@/components/email/DesignDialog';
import { EmailSettingsView } from '@/components/email/EmailSettingsView';
import { PreviewDialog } from '@/components/email/PreviewDialog';
import { ThemeSettingsPanels } from '@/components/email/ThemeSettingsPanels';
import type { Broadcast, DraftFields, EmailApi, EmailSettings, Overview } from '@/components/email/email-api';
import { DEFAULT_EMAIL_DESIGN } from '@/lib/email/design';
import { renderEmail } from '@/lib/email/render';
import {
  getThemePreset,
  type CustomTheme,
  type EmailThemeTokens,
} from '@/lib/email/themes';

/**
 * The real email components with mock data and a fake api: nothing here talks
 * to the network or Firebase, and the preview HTML comes from the real
 * renderer, so the harness shows exactly what a send would carry.
 */

const CLOCK = '2026-10-28T10:00:00.000Z';

const SETTINGS: EmailSettings = {
  fromName: 'Grace Community',
  fromLocal: 'hello',
  replyTo: 'office@grace.org',
  mailingAddress: '1 Main St, Springfield',
  logoUrl: 'https://raw.githubusercontent.com/bumbmatei-sys/pictures/main/doar%20spic.png',
  footerNote: 'Everyone is welcome this Sunday.',
  socialLinks: [
    { platform: 'facebook', url: 'https://facebook.com/gracecommunity' },
    { platform: 'instagram', url: 'https://instagram.com/gracecommunity' },
    { platform: 'website', url: 'https://gracecommunity.org' },
  ],
  defaultThemeId: 'c1',
  domain: 'grace.org',
  domainState: 'verified',
  domainRecords: [],
};

const letterTokens = getThemePreset('letter')!.tokens;
const midnightTokens = getThemePreset('midnight')!.tokens;

/** Two saved themes, so the picker shows saved tiles beside the five presets. */
const CUSTOM_THEMES: readonly CustomTheme[] = [
  { id: 'c1', name: 'Sunday letter', tokens: letterTokens, createdAt: CLOCK },
  { id: 'c2', name: 'Advent night', tokens: midnightTokens, createdAt: CLOCK },
];

const USAGE: Overview['usage'] = {
  used: 1240,
  cap: 5000,
  percent: 25,
  warn: false,
  warnAtPercent: 80,
  resetsAt: '2026-11-01T00:00:00.000Z',
  pack: { size: 10000, priceUsd: null },
  daily: null,
};

const OVERVIEW: Overview = {
  broadcasts: [],
  subscribers: [],
  settings: SETTINGS,
  customThemes: CUSTOM_THEMES,
  usage: USAGE,
  sending: { paused: false },
  canEditLimits: false,
  limits: null,
};

const ISSUE_HEADER_MARKER =
  '<div data-hv-block="issue-header" data-title="The month at Grace" data-subtitle="What we saw, and what is next" data-size="m" data-align="center" data-reading="true"></div>';
const BOX_MARKER =
  '<div data-hv-block="box" data-label="Give" data-title="Sunday supper" data-blurb="Bring a friend with you." data-tint="accent" data-variant="filled" data-button-text="Reserve a seat" data-button-url="https://gracecommunity.org/rsvp"></div>';

const BROADCAST: Broadcast = {
  id: 'b1',
  tenantId: 'grace',
  subject: 'The month at Grace',
  subjectB: null,
  preheader: 'A short look back at October.',
  bodyHtml: `${ISSUE_HEADER_MARKER}<p>Friends,</p><p>It has been a full month: two baptisms, a packed harvest night, and a new small group starting in November.</p>${BOX_MARKER}<p>Grace and peace,<br>Pastor Ana</p>`,
  design: DEFAULT_EMAIL_DESIGN,
  filters: [],
  status: 'draft',
  scheduledAt: null,
  sentAt: null,
  stats: null,
  error: null,
  sendId: null,
  createdBy: 'u',
  createdAt: CLOCK,
  updatedAt: CLOCK,
  themeId: 'letter',
  themeTokens: letterTokens,
};


/** The exact HTML a recipient gets, straight from the real renderer. */
function previewHtml(draft: DraftFields & { dark?: boolean }): string {
  return renderEmail({
    design: { ...DEFAULT_EMAIL_DESIGN, ...(draft.design ?? {}) },
    bodyHtml: draft.bodyHtml ?? BROADCAST.bodyHtml,
    preheader: draft.preheader ?? '',
    churchName: SETTINGS.fromName,
    senderName: SETTINGS.fromName,
    firstName: 'Alex',
    mailingAddress: SETTINGS.mailingAddress,
    unsubscribeUrl: 'https://gracecommunity.theharvest.app/unsubscribe/demo',
    dark: draft.dark === true,
    themeId: draft.themeId ?? null,
    themeTokens: draft.themeTokens ?? null,
    customThemes: CUSTOM_THEMES,
    logoUrl: SETTINGS.logoUrl,
    footerNote: SETTINGS.footerNote,
    socialLinks: SETTINGS.socialLinks,
  } as never).html;
}

/** A fake `EmailApi`: every call answers from memory, nothing reaches a server. */
const fakeApi = {
  overview: async () => OVERVIEW,
  saveDraft: async (draft: DraftFields) => ({ ...BROADCAST, ...draft } as Broadcast),
  remove: async () => {},
  preview: async (draft: DraftFields & { dark?: boolean }) => previewHtml(draft),
  send: async () => ({ outcome: 'sent', preview: { subject: BROADCAST.subject, html: previewHtml(BROADCAST), to: 'alex@example.org' }, stats: null, message: 'Sent (harness).' }),
  sendTest: async () => {},
  importContacts: async () => ({ added: 0, merged: 0, alreadySubscribed: 0, blocked: 0, invalid: 0, repeatedInFile: 0 }),
  saveSettings: async (next: Partial<EmailSettings>) => ({ ...SETTINGS, ...next }),
  saveTheme: async (theme: { name: string; tokens: EmailThemeTokens }) => ({ id: 'c9', name: theme.name, tokens: theme.tokens, createdAt: CLOCK }),
  deleteTheme: async () => {},
  setDefaultTheme: async (themeId: string | null) => ({ ...SETTINGS, defaultThemeId: themeId }),
  saveLimits: async (limits: never) => limits,
  resumeSending: async () => {},
  domain: async () => SETTINGS,
} as unknown as EmailApi;

/**
 * Clicks every collapsed section open, so a screenshot shows the panels
 * expanded. Collapsible content mounts behind its trigger; the triggers all
 * exist up front, so one pass over the closed ones is enough.
 */
function ExpandAll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    for (const btn of [...root.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]')]) btn.click();
  }, []);
  return <div ref={ref}>{children}</div>;
}

export function EmailThemesPreview({ view, mode }: { view?: string; mode?: string }) {
  const which = ['picker', 'panels', 'brand', 'editor', 'preview'].includes(view || '') ? view! : 'picker';
  return (
    <div className="min-h-screen bg-surface p-6 text-strong">
      {which === 'picker' && (
        <DesignDialog
          open
          onOpenChange={() => {}}
          design={DEFAULT_EMAIL_DESIGN}
          onChange={() => {}}
          brandColor="#C9963A"
          themeId="letter"
          themeTokens={letterTokens}
          customThemes={CUSTOM_THEMES}
          defaultThemeId="c1"
          onThemeChange={() => {}}
          onSaveTheme={async () => {}}
          onDeleteTheme={async () => {}}
          onSetDefaultTheme={async () => {}}
        />
      )}
      {which === 'panels' && (
        <div className="mx-auto max-w-xl">
          <ExpandAll>
            <ThemeSettingsPanels tokens={letterTokens} onChange={() => {}} defaults={letterTokens} />
          </ExpandAll>
        </div>
      )}
      {which === 'brand' && (
        <div className="mx-auto max-w-2xl">
          <EmailSettingsView api={fakeApi} data={OVERVIEW} onSaved={() => {}} onLimitsSaved={() => {}} />
        </div>
      )}
      {which === 'editor' && (
        <div className="mx-auto max-w-4xl">
          <p className="mb-2 text-xs text-faint">
            Type / in the email body to open the block menu. An Issue header and a Box are already in the draft below.
          </p>
          <BroadcastEditor
            api={fakeApi}
            data={OVERVIEW}
            initial={BROADCAST}
            onBack={() => {}}
            onOpenSettings={() => {}}
            onChanged={() => {}}
            onOpen={() => {}}
          />
        </div>
      )}
      {which === 'preview' && (
        <>
          <PreviewDialog
            key={mode}
            initialMode={mode === 'phone' || mode === 'dark' ? mode : 'computer'}
            open
            onOpenChange={() => {}}
            api={fakeApi}
            draft={{
              subject: BROADCAST.subject,
              preheader: BROADCAST.preheader,
              bodyHtml: BROADCAST.bodyHtml,
              design: DEFAULT_EMAIL_DESIGN,
              themeId: 'letter',
              themeTokens: letterTokens,
            }}
          />
        </>
      )}
    </div>
  );
}

