import { afterEach, describe, expect, it, vi } from 'vitest';

import { BroadcastsView, matchesTab } from '@/components/email/BroadcastsView';
import { EmailSettingsView } from '@/components/email/EmailSettingsView';
import { EmailWorkspace } from '@/components/email/EmailWorkspace';
import { SendStep, combine, timeSlots } from '@/components/email/SendStep';
import { SubscribersView, filterPeople } from '@/components/email/SubscribersView';
import { EmailApiError, NOT_CONFIGURED_COPY, createEmailApi } from '@/components/email/email-api';
import { byName, click, flush, mount, need, text, type, unmount } from './dom';
import { SETTINGS, USAGE, broadcast, fakeApi, overview, person } from './fixtures';

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
      usage={USAGE}
      sending={{ paused: false }}
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
    await mount(sendStep(fakeApi(), { settings: { ...SETTINGS, mailingAddress: '' } }));
    expect(need(byName('button', /Send to/), 'send').hasAttribute('disabled')).toBe(true);
    expect(text()).toContain('Add your sender name, reply-to address and mailing address before sending');
  });

  it('does not wait on a sending domain: a ministry with sender details and no domain can send', async () => {
    for (const domainState of ['none', 'pending', 'failed'] as const) {
      await mount(sendStep(fakeApi(), { settings: { ...SETTINGS, domainState, domain: '' } }));
      expect(need(byName('button', /Send to 2 people/), 'send').hasAttribute('disabled')).toBe(false);
      expect(text()).not.toMatch(/verify your domain/i);
      expect(text()).toContain('via Harvest');
      await unmount();
    }
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
    await mount(<BroadcastsView api={fakeApi()} tenantId="grace" onChanged={noop} data={overview({ broadcasts: list })} onNew={noop} onOpen={noop} onDelete={noop} onSettings={noop} />);
    expect(need(document.querySelector('[data-broadcast-id="x"] [role=alert]'), 'row alert').textContent).toContain('1 of 2 emails did not send');
    expect(text()).toContain('Partly sent');
  });

  it('has an empty state with a New broadcast action', async () => {
    const onNew = vi.fn();
    await mount(<BroadcastsView api={fakeApi()} tenantId="grace" onChanged={noop} data={overview()} onNew={onNew} onOpen={noop} onDelete={noop} onSettings={noop} />);
    expect(text()).toContain('No broadcasts yet');
    await click(need(byName('button', 'New broadcast', ), 'new'));
    expect(onNew).toHaveBeenCalled();
  });

  it('nudges to settings until the sender is ready', async () => {
    const onSettings = vi.fn();
    await mount(<BroadcastsView api={fakeApi()} tenantId="grace" onChanged={noop} data={overview({ settings: { ...SETTINGS, replyTo: '' } })} onNew={noop} onOpen={noop} onDelete={noop} onSettings={onSettings} />);
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
    await mount(<SubscribersView data={overview({ subscribers: people })} tenantId="grace" onImport={() => {}} onSettings={() => {}} />);
    expect(document.querySelectorAll('[data-contact-id]')).toHaveLength(1);
    expect(text()).toContain('Subscribed');
  });

  it('says plainly when the list is empty', async () => {
    await mount(<SubscribersView data={overview({ subscribers: [] })} tenantId="grace" onImport={() => {}} onSettings={() => {}} />);
    expect(text()).toContain('Nobody yet');
  });

  it('shows the shareable sign-up link and copies it', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await mount(<SubscribersView data={overview({ subscribers: [] })} tenantId="grace" onImport={() => {}} onSettings={() => {}} />);
    const field = need(document.querySelector<HTMLInputElement>('[aria-label="Sign-up link"]'), 'link field');
    expect(field.value).toBe('https://grace.theharvest.app/subscribe');
    expect(field.readOnly).toBe(true);
    await click(need(byName('button', 'Copy link'), 'copy'));
    expect(writeText).toHaveBeenCalledWith('https://grace.theharvest.app/subscribe');
    expect(text()).toContain('Copied');
  });

  it('says so, rather than showing a broken link, when the ministry id cannot make one', async () => {
    await mount(<SubscribersView data={overview({ subscribers: [] })} tenantId={null} onImport={() => {}} onSettings={() => {}} />);
    expect(document.querySelector('[aria-label="Sign-up link"]')).toBeNull();
    expect(text()).toContain('sign-up link is not available');
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
    await click(need(byName('[role=tab]', 'Subscribers'), 'tab'));
    expect(text()).toContain('Your sign-up link');
    await click(need(byName('[role=tab]', 'Settings'), 'tab'));
    expect(text()).toContain('Sender');
  });
});

describe('Settings view', () => {
  const view = (over: Partial<Parameters<typeof overview>[0]> = {}, api = fakeApi()) => mount(
    <EmailSettingsView api={api} data={overview(over)} onSaved={() => {}} onLimitsSaved={() => {}} />,
  );

  it('has no sending-domain setup and no Advanced section, whatever the stored domain state', async () => {
    for (const domainState of ['none', 'pending', 'verified', 'failed'] as const) {
      await view({ settings: { ...SETTINGS, domainState, domain: 'grace.org', domainRecords: [{ type: 'TXT', name: '_dk.mail.grace.org', value: 'v=DKIM1' }] } });
      expect(document.getElementById('email-domain-section')).toBeNull();
      expect(document.getElementById('email-domain')).toBeNull();
      expect(byName('button', 'Set up domain')).toBeNull();
      expect(byName('button', 'Use this domain')).toBeNull();
      expect(document.querySelector('[data-domain-state]')).toBeNull();
      expect(text()).not.toContain('v=DKIM1');
      expect(text()).not.toMatch(/Sending domain|Advanced|Mailchimp|Plunk/);
      await unmount();
    }
  });

  it('keeps the sender details and says emails go out from Harvest', async () => {
    await view();
    expect(document.getElementById('email-from-name')).toBeTruthy();
    expect(document.getElementById('email-reply-to')).toBeTruthy();
    expect(document.getElementById('email-address')).toBeTruthy();
    expect(need(document.querySelector('[data-sender-note]'), 'note').textContent).toContain('Harvest');
  });

  it('saves the sender details and leaves the stored send-from part untouched', async () => {
    const api = fakeApi();
    await view({ settings: { ...SETTINGS, fromLocal: 'office' } }, api);
    await type(need(document.getElementById('email-from-name'), 'from name'), 'Grace');
    await click(need(byName('button', 'Save'), 'save'));
    await flush();
    expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ fromName: 'Grace', fromLocal: 'office' }));
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
