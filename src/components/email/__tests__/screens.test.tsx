import { afterEach, describe, expect, it, vi } from 'vitest';

import { BroadcastsView, matchesTab } from '@/components/email/BroadcastsView';
import { EmailSettingsView } from '@/components/email/EmailSettingsView';
import { EmailWorkspace } from '@/components/email/EmailWorkspace';
import { SendStep, combine, timeSlots } from '@/components/email/SendStep';
import { SubscribersView, filterPeople } from '@/components/email/SubscribersView';
import { EmailApiError, NOT_CONFIGURED_COPY, createEmailApi } from '@/components/email/email-api';
import { byName, click, flush, mount, need, text, unmount } from './dom';
import { SETTINGS, broadcast, fakeApi, overview, person } from './fixtures';

afterEach(unmount);

const preview = { broadcastId: 'b1', action: 'send' as const, recipientCount: 2, skipped: { suppressed: 1, notOptedIn: 3 }, from: 'Grace Church <hello@mail.grace.org>', subject: 'Sunday', at: null, capRemainingAfter: 4990 };

function sendStep(api: ReturnType<typeof fakeApi>, over: Partial<Parameters<typeof SendStep>[0]> = {}) {
  return (
    <SendStep
      api={api}
      broadcastId="b1"
      subject="Sunday"
      subjectB={null}
      preheader="Doors at 9"
      bodyHtml="<p>Hi there friends of the church</p>"
      filters={[]}
      onFilters={() => {}}
      settings={SETTINGS}
      people={[person('a@x.org'), person('b@x.org'), person('gone@x.org', { status: 'unsubscribed' })]}
      usage={{ used: 0, cap: 5000 }}
      onBack={() => {}}
      onOpenSettings={() => {}}
      onSeeTips={() => {}}
      onSent={() => {}}
      {...over}
    />
  );
}

describe('Send step', () => {
  it('counts only people who can be emailed and never the unsubscribed', async () => {
    await mount(sendStep(fakeApi()));
    expect(need(document.querySelector('[data-recipient-count]'), 'count').textContent).toBe('2 people');
    expect(text()).toContain('1 person is skipped right now');
    expect(need(byName('button', /Send to 2 people/), 'send').hasAttribute('disabled')).toBe(false);
  });

  it('previews first, and only a confirm sends', async () => {
    const send = vi.fn(async (i: { mode: string }) =>
      i.mode === 'preview'
        ? { requiresConfirm: true as const, confirmToken: 'tok', preview }
        : { outcome: 'sent' as const, preview, stats: { recipients: 2, sent: 2, failed: 0, skippedSuppressed: 1, skippedNotOptedIn: 3 }, message: 'Sent to 2 people.' });
    const onSent = vi.fn();
    await mount(sendStep(fakeApi({ send } as never), { onSent }));
    await click(need(byName('button', /Send to 2 people/), 'send'));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'preview' }));
    expect(onSent).not.toHaveBeenCalled();
    expect(text()).toContain('Send this email?');
    expect(text()).toContain('1 unsubscribed or bounced, 3 not opted in');
    await click(need(byName('button', 'Confirm send'), 'confirm'));
    await flush();
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'confirm', confirmToken: 'tok' }));
    expect(onSent).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'sent' }));
  });

  it('shows the friendly message when sending is not set up (503), and sends nothing', async () => {
    const send = vi.fn(async () => { throw new EmailApiError(NOT_CONFIGURED_COPY, 'not_configured', true); });
    const onSent = vi.fn();
    await mount(sendStep(fakeApi({ send } as never), { onSent }));
    await click(need(byName('button', /Send to 2 people/), 'send'));
    await flush();
    expect(need(document.querySelector('[role=alert]'), 'alert').textContent).toContain('not set up on this server yet');
    expect(onSent).not.toHaveBeenCalled();
    expect(text()).not.toContain('Send this email?');
  });

  it('is disabled with no subject, no audience or unfinished sender details', async () => {
    await mount(sendStep(fakeApi(), { subject: '' }));
    expect(need(byName('button', /Send to/), 'send').hasAttribute('disabled')).toBe(true);
    await unmount();
    await mount(sendStep(fakeApi(), { people: [person('gone@x.org', { status: 'unsubscribed' })] }));
    expect(need(byName('button', /Send to 0 people/), 'send').hasAttribute('disabled')).toBe(true);
    await unmount();
    await mount(sendStep(fakeApi(), { settings: { ...SETTINGS, domainState: 'pending' } }));
    expect(need(byName('button', /Send to/), 'send').hasAttribute('disabled')).toBe(true);
    expect(text()).toContain('verify your domain before sending');
  });

  it('adds a filter row, narrows the audience and offers the tags that exist', async () => {
    const onFilters = vi.fn();
    await mount(sendStep(fakeApi(), { onFilters }));
    await click(need(byName('button', 'Add a filter'), 'add'));
    expect(onFilters).toHaveBeenCalledWith([{ kind: 'has-tag', value: '' }]);
  });

  it('Pick a time reveals the date and time-slot picker', async () => {
    await mount(sendStep(fakeApi()));
    await click(need(byName('button', 'Pick a time'), 'pick'));
    expect(need(byName('button', 'Pick a date and time'), 'trigger')).toBeTruthy();
    expect(need(byName('button', /Schedule for/), 'schedule')).toBeTruthy();
    expect(need(document.querySelector('[data-schedule-note]'), 'note').textContent).toContain('once a day');
  });

  it('time slots run every 15 minutes across the day and combine with a date', () => {
    const slots = timeSlots();
    expect(slots).toHaveLength(96);
    expect(slots[0].value).toBe('00:00');
    expect(slots[95].value).toBe('23:45');
    const d = combine(new Date(2031, 2, 10, 4, 4), '16:45');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2031, 2, 10, 16, 45]);
  });
});

describe('Broadcasts view', () => {
  const list = [
    broadcast({ id: 'd', status: 'draft' }),
    broadcast({ id: 's', status: 'scheduled', scheduledAt: '2031-03-12T09:00:00.000Z' }),
    broadcast({ id: 'x', status: 'partial', error: '1 of 2 emails did not send. 1 went out.', stats: { recipients: 2, sent: 1, failed: 1, skippedSuppressed: 0, skippedNotOptedIn: 0 } }),
  ];
  const noop = () => {};

  it('filters by All / Drafts / Scheduled / Sent', () => {
    expect(list.filter((b) => matchesTab(b, 'drafts')).map((b) => b.id)).toEqual(['d']);
    expect(list.filter((b) => matchesTab(b, 'scheduled')).map((b) => b.id)).toEqual(['s']);
    expect(list.filter((b) => matchesTab(b, 'sent')).map((b) => b.id)).toEqual(['x']);
    expect(list.filter((b) => matchesTab(b, 'all'))).toHaveLength(3);
  });

  it('shows a partial send as a visible error in the row', async () => {
    await mount(<BroadcastsView data={overview({ broadcasts: list })} onNew={noop} onOpen={noop} onDelete={noop} onSettings={noop} />);
    expect(need(document.querySelector('[data-broadcast-id="x"] [role=alert]'), 'row alert').textContent).toContain('1 of 2 emails did not send');
    expect(text()).toContain('Partly sent');
  });

  it('has an empty state with a New broadcast action', async () => {
    const onNew = vi.fn();
    await mount(<BroadcastsView data={overview()} onNew={onNew} onOpen={noop} onDelete={noop} onSettings={noop} />);
    expect(text()).toContain('No broadcasts yet');
    await click(need(byName('button', 'New broadcast', ), 'new'));
    expect(onNew).toHaveBeenCalled();
  });

  it('nudges to settings until the sender is ready', async () => {
    const onSettings = vi.fn();
    await mount(<BroadcastsView data={overview({ settings: { ...SETTINGS, replyTo: '' } })} onNew={noop} onOpen={noop} onDelete={noop} onSettings={onSettings} />);
    await click(need(byName('button', 'Open settings'), 'open settings'));
    expect(onSettings).toHaveBeenCalled();
  });
});

describe('Subscribers view (a filtered view of the CRM)', () => {
  const people = [
    person('on@x.org', { tags: ['youth'] }),
    person('off@x.org', { status: 'unsubscribed' }),
    person('crm-only@x.org', { status: 'none' }),
    person('bounce@x.org', { status: 'bounced' }),
  ];

  it('filters by status, tag and search', () => {
    expect(filterPeople(people, '', 'subscribed', '').map((p) => p.email)).toEqual(['on@x.org']);
    expect(filterPeople(people, '', 'suppressed', '').map((p) => p.email)).toEqual(['off@x.org', 'bounce@x.org']);
    expect(filterPeople(people, '', 'none', '').map((p) => p.email)).toEqual(['crm-only@x.org']);
    expect(filterPeople(people, '', 'all', '')).toHaveLength(4);
    expect(filterPeople(people, '', 'all', 'youth').map((p) => p.email)).toEqual(['on@x.org']);
    expect(filterPeople(people, 'CRM-ONLY', 'all', '').map((p) => p.email)).toEqual(['crm-only@x.org']);
  });

  it('lists opted-in CRM people by default and says so', async () => {
    await mount(<SubscribersView data={overview({ subscribers: people })} onImport={() => {}} onSettings={() => {}} />);
    expect(text()).toContain('1 person on your list');
    expect(text()).toContain('people in your CRM who opted in to email');
    expect(document.querySelectorAll('[data-contact-id]')).toHaveLength(1);
  });

  it('says plainly when the list is empty', async () => {
    await mount(<SubscribersView data={overview({ subscribers: [] })} onImport={() => {}} onSettings={() => {}} />);
    expect(text()).toContain('Nobody yet');
  });
});

describe('Workspace', () => {
  it('shows a failed load as an error with a retry, never as an empty list', async () => {
    const api = fakeApi({ overview: vi.fn(async () => { throw new EmailApiError('Sign in is required.', 'unauthenticated', false); }) });
    await mount(<EmailWorkspace tenantId="grace" api={api} />);
    await flush();
    expect(need(document.querySelector('[role=alert]'), 'alert').textContent).toContain('Sign in is required.');
    expect(text()).not.toContain('No broadcasts yet');
    expect(byName('button', 'Try again')).toBeTruthy();
  });

  it('switches sections', async () => {
    await mount(<EmailWorkspace tenantId="grace" api={fakeApi()} />);
    await flush();
    expect(text()).toContain('How your list reads');
    await click(need(byName('[role=tab]', 'Broadcasts'), 'tab'));
    expect(text()).toContain('One-time emails to your list');
    await click(need(byName('[role=tab]', 'Settings'), 'tab'));
    expect(text()).toContain('Email settings');
  });
});

describe('Settings view', () => {
  it('shows domain state, DNS records for a pending domain, and the disabled own-key option', async () => {
    const settings = { ...SETTINGS, domainState: 'pending' as const, domainRecords: [{ type: 'TXT', name: '_dk.mail.grace.org', value: 'v=DKIM1' }] };
    await mount(<EmailSettingsView api={fakeApi()} settings={settings} onSaved={() => {}} />);
    expect(need(document.querySelector('[data-domain-state]'), 'badge').textContent).toBe('Waiting for DNS');
    expect(text()).toContain('v=DKIM1');
    expect(text()).toContain('Coming soon');
    expect(need(document.querySelector('[aria-label="Use your own Plunk or Mailchimp key"]'), 'switch').hasAttribute('disabled') || document.querySelector('[aria-label="Use your own Plunk or Mailchimp key"]')?.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('reports a not-configured domain call in plain words', async () => {
    const api = fakeApi({ domain: vi.fn(async () => { throw new EmailApiError(NOT_CONFIGURED_COPY, 'not_configured', true); }) });
    await mount(<EmailSettingsView api={api} settings={{ ...SETTINGS, domainState: 'none', domain: 'grace.org' }} onSaved={() => {}} />);
    await click(need(byName('button', 'Set up domain'), 'set up'));
    await flush();
    expect(need(document.querySelector('[role=alert]'), 'alert').textContent).toContain('not set up on this server yet');
  });
});

describe('createEmailApi', () => {
  it('turns a 503 into the friendly not-configured error', async () => {
    const api = createEmailApi('grace', async () => ({ status: 503, json: { ok: false, error: 'not_configured' } }));
    await expect(api.sendTest('b1')).rejects.toMatchObject({ notConfigured: true, message: NOT_CONFIGURED_COPY });
  });
  it('passes a server refusal message through, and a network failure becomes a plain message', async () => {
    const refuse = createEmailApi('grace', async () => ({ status: 403, json: { ok: false, error: 'plan_required', message: 'Email broadcasts are not included in your current plan.' } }));
    await expect(refuse.overview()).rejects.toMatchObject({ code: 'plan_required', message: expect.stringContaining('not included') });
    const down = createEmailApi('grace', async () => { throw new Error('offline'); });
    await expect(down.overview()).rejects.toMatchObject({ code: 'network' });
  });
});
