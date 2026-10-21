import { vi } from 'vitest';

import { DEFAULT_EMAIL_DESIGN } from '@/lib/email/design';
import type { EmailContact } from '@/lib/email/audience';
import type { Broadcast, EmailApi, EmailSettings, Overview } from '@/components/email/email-api';

export const SETTINGS: EmailSettings = {
  fromName: 'Grace Church',
  fromLocal: 'hello',
  replyTo: 'office@grace.org',
  mailingAddress: '1 Main St, Springfield',
  domain: 'grace.org',
  domainState: 'verified',
  domainRecords: [],
};

export const USAGE: Overview['usage'] = { used: 10, cap: 5000, percent: 0, warn: false, warnAtPercent: 80, resetsAt: '2031-04-01T00:00:00.000Z', pack: { size: 10000, priceUsd: null }, daily: null };

export const person = (email: string, over: Partial<EmailContact> = {}): EmailContact => ({
  id: `c-${email}`, email, name: 'Alex Doe', status: 'subscribed', tags: [], groups: ['Members'], source: 'import', joinedAt: '2031-01-01T00:00:00.000Z', ...over,
});

export const broadcast = (over: Partial<Broadcast> = {}): Broadcast => ({
  id: 'b1', tenantId: 'grace', subject: 'Sunday', subjectB: null, preheader: '', bodyHtml: '<p>Hi {{first_name}}, see you Sunday.</p>',
  design: DEFAULT_EMAIL_DESIGN, filters: [], status: 'draft', scheduledAt: null, sentAt: null, stats: null, error: null, sendId: null,
  createdBy: 'u', createdAt: '2031-01-01T00:00:00.000Z', updatedAt: '2031-01-02T10:00:00.000Z', ...over,
});

export const overview = (over: Partial<Overview> = {}): Overview => ({
  broadcasts: [], subscribers: [person('a@x.org', { tags: ['youth'] }), person('b@x.org')], settings: SETTINGS, usage: USAGE, sending: { paused: false }, canEditLimits: false, limits: null, ...over,
});

export function fakeApi(over: Partial<EmailApi> = {}): EmailApi & { [K in keyof EmailApi]: ReturnType<typeof vi.fn> } {
  const api = {
    overview: vi.fn(async () => overview()),
    saveDraft: vi.fn(async (d) => broadcast({ id: d.id ?? 'b1', subject: d.subject ?? '' })),
    remove: vi.fn(async () => {}),
    preview: vi.fn(async () => '<html><body><p>Hi Alex</p></body></html>'),
    send: vi.fn(),
    sendTest: vi.fn(async () => {}),
    importContacts: vi.fn(async () => ({ added: 1, merged: 0, alreadySubscribed: 0, blocked: 0, invalid: 0, repeatedInFile: 0 })),
    saveSettings: vi.fn(async (s) => ({ ...SETTINGS, ...s })),
    domain: vi.fn(async () => SETTINGS),
    saveLimits: vi.fn(async (l) => l),
    resumeSending: vi.fn(async () => {}),
    ...over,
  };
  return api as never;
}
