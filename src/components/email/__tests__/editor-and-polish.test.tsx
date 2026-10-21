import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BroadcastEditor } from '@/components/email/BroadcastEditor';
import { EmailSettingsView } from '@/components/email/EmailSettingsView';
import { EmailWorkspace } from '@/components/email/EmailWorkspace';
import { SendStep } from '@/components/email/SendStep';
import { TemplatesDialog } from '@/components/email/TemplatesDialog';
import { EmailApiError, NOT_CONFIGURED_COPY, createEmailApi } from '@/components/email/email-api';
import { EMAIL_TEMPLATES, templateBlocks } from '@/components/email/templates';
import { all, byName, click, flush, mount, need, text, type as typeInto, unmount } from './dom';
import { SETTINGS, USAGE, broadcast, fakeApi, overview, person } from './fixtures';

afterEach(async () => {
  await unmount();
  vi.restoreAllMocks();
});

const scheduled = (over = {}) => broadcast({ status: 'scheduled', scheduledAt: '2031-03-12T09:00:00.000Z', ...over });

async function editor(initial: ReturnType<typeof broadcast> | null, api = fakeApi(), strict = false) {
  const onBack = vi.fn();
  const onChanged = vi.fn();
  const ui = <BroadcastEditor api={api} data={overview()} initial={initial} onBack={onBack} onOpenSettings={() => {}} onChanged={onChanged} onOpen={() => {}} />;
  await mount(strict ? <StrictMode>{ui}</StrictMode> : ui);
  await flush();
  return { api, onBack, onChanged };
}
const back = () => click(need(byName('button', 'Back to broadcasts'), 'back'));
const subject = () => need(document.querySelector<HTMLElement>('[aria-label="Subject"]'), 'subject');

describe('Back in the editor', () => {
  it('leaves an unchanged email alone: nothing is saved', async () => {
    const { api, onBack } = await editor(broadcast());
    await back();
    await flush();
    expect(api.saveDraft).not.toHaveBeenCalled();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('does not create a draft for a new email nobody typed into', async () => {
    const { api, onBack } = await editor(null);
    await back();
    await flush();
    expect(api.saveDraft).not.toHaveBeenCalled();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('does not unschedule a scheduled email that was only opened and closed', async () => {
    const { api, onBack } = await editor(scheduled());
    await back();
    await flush();
    expect(api.saveDraft).not.toHaveBeenCalled();
    expect(text()).not.toContain('Take this email off the schedule?');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('in React strict mode, which runs every effect twice, an untouched email is still untouched', async () => {
    for (const initial of [broadcast(), scheduled(), null]) {
      const { api, onBack } = await editor(initial, fakeApi(), true);
      await back();
      await flush();
      expect(api.saveDraft).not.toHaveBeenCalled();
      expect(text()).not.toContain('Take this email off the schedule?');
      expect(onBack).toHaveBeenCalledTimes(1);
      await unmount();
    }
  });

  it('changing something and changing it back is not an edit', async () => {
    const { api, onBack } = await editor(scheduled());
    await typeInto(subject(), 'Something else');
    await typeInto(subject(), 'Sunday');
    await back();
    await flush();
    expect(api.saveDraft).not.toHaveBeenCalled();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('saves a changed draft before leaving', async () => {
    const { api, onBack, onChanged } = await editor(broadcast());
    await typeInto(subject(), 'Sunday news');
    await back();
    await flush();
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
    expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1', subject: 'Sunday news' }));
    expect(onChanged).toHaveBeenCalled();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('refreshes the list on Back after an autosave, even though nothing is left unsaved', async () => {
    const { api, onBack, onChanged } = await editor(broadcast());
    await typeInto(subject(), 'Sunday news');
    await new Promise((r) => setTimeout(r, 1000));
    await flush();
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
    await back();
    await flush();
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('does not refresh the list on Back when nothing was saved this session', async () => {
    const { onBack, onChanged } = await editor(broadcast());
    await back();
    await flush();
    expect(onChanged).not.toHaveBeenCalled();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('stays put and shows the error when a changed draft cannot be saved', async () => {
    const api = fakeApi({ saveDraft: vi.fn(async () => { throw new EmailApiError('Could not reach the server.', 'network', false); }) });
    const { onBack } = await editor(broadcast(), api);
    await typeInto(subject(), 'Sunday news');
    await back();
    await flush();
    expect(onBack).not.toHaveBeenCalled();
    expect(need(document.querySelector('[role=alert]'), 'alert').textContent).toContain('Could not reach the server.');
  });

  describe('a scheduled email that was edited', () => {
    it('asks first, and "Keep editing" changes nothing', async () => {
      const { api, onBack } = await editor(scheduled());
      await typeInto(subject(), 'New subject');
      await back();
      expect(text()).toContain('Take this email off the schedule?');
      expect(text()).toContain('Saving your changes takes it off the schedule');
      await click(need(byName('button', 'Keep editing'), 'keep'));
      await flush();
      expect(api.saveDraft).not.toHaveBeenCalled();
      expect(onBack).not.toHaveBeenCalled();
    });

    it('"Leave without saving" goes back and the schedule is untouched', async () => {
      const { api, onBack } = await editor(scheduled());
      await typeInto(subject(), 'New subject');
      await back();
      await click(need(byName('button', 'Leave without saving'), 'leave'));
      await flush();
      expect(api.saveDraft).not.toHaveBeenCalled();
      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('"Save and unschedule" saves, then goes back', async () => {
      const { api, onBack } = await editor(scheduled());
      await typeInto(subject(), 'New subject');
      await back();
      await click(need(byName('button', 'Save and unschedule'), 'save'));
      await flush();
      expect(api.saveDraft).toHaveBeenCalledTimes(1);
      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('is never autosaved while the writer is still typing', async () => {
      const { api } = await editor(scheduled());
      await typeInto(subject(), 'New subject');
      await new Promise((r) => setTimeout(r, 1000));
      await flush();
      expect(api.saveDraft).not.toHaveBeenCalled();
      expect(need(document.querySelector('[data-save-state]'), 'state').textContent).toBe('Unsaved');
    });

    it('asks before Next saves it, too', async () => {
      const { api } = await editor(scheduled());
      await typeInto(subject(), 'New subject');
      await click(need(byName('button', /^Next/), 'next'));
      expect(text()).toContain('Take this email off the schedule?');
      expect(api.saveDraft).not.toHaveBeenCalled();
      expect(byName('button', 'Leave without saving')).toBeNull();
    });
  });

  it('Next on an untouched saved email goes to the send step without saving it again', async () => {
    const { api } = await editor(broadcast());
    await click(need(byName('button', /^Next/), 'next'));
    await flush();
    expect(api.saveDraft).not.toHaveBeenCalled();
    expect(document.querySelector('[data-recipient-count]')).toBeTruthy();
  });
});

describe('Send step: a refusal that Email settings can fix', () => {
  const step = (api: ReturnType<typeof fakeApi>, onOpenSettings = vi.fn(), settings = SETTINGS) => mount(
    <SendStep
      api={api} broadcastId="b1" subject="Sunday" subjectB={null} preheader="Doors at 9" bodyHtml="<p>Hi there friends of the church</p>" filters={[]}
      onFilters={() => {}} settings={settings} people={[person('a@x.org')]} usage={USAGE} sending={{ paused: false }} onBack={() => {}}
      onOpenSettings={onOpenSettings} onSeeTips={() => {}} onSent={() => {}}
    />,
  );
  const refuse = (code: string, message: string) => fakeApi({ send: vi.fn(async () => { throw new EmailApiError(message, code, false); }) as never });

  it.each([['domain_required', 'domain'], ['domain_taken', 'domain'], ['domain_reserved', 'domain'], ['sender_not_ready', 'sender']] as const)(
    '%s offers Open settings and opens the %s section',
    async (code, focus) => {
      const onOpenSettings = vi.fn();
      await step(refuse(code, 'Verify your sending domain in Email settings.'), onOpenSettings);
      await click(need(byName('button', /Send to 1 person/), 'send'));
      await flush();
      expect(need(document.querySelector('[role=alert]'), 'alert').textContent).toContain('Email settings');
      await click(need(byName('[role=alert] ~ button', 'Open settings') ?? byName('button', 'Open settings'), 'open settings'));
      expect(onOpenSettings).toHaveBeenCalledWith(focus);
    },
  );

  it('does not offer it for an error Email settings cannot fix', async () => {
    await step(refuse('volume_cap', 'This send would pass your monthly allowance.'));
    await click(need(byName('button', /Send to 1 person/), 'send'));
    await flush();
    expect(byName('button', 'Open settings')).toBeNull();
  });

  it('with the domain not yet verified, the inline Open settings link goes to the domain section', async () => {
    const onOpenSettings = vi.fn();
    await step(fakeApi(), onOpenSettings, { ...SETTINGS, domainState: 'pending' });
    await click(need(byName('button', 'Open settings'), 'open'));
    expect(onOpenSettings).toHaveBeenCalledWith('domain');
  });
});

describe('Email settings deep link', () => {
  const mountSettings = (focus: 'sender' | 'domain' | null) => mount(
    <EmailSettingsView api={fakeApi()} data={overview()} focus={focus} onSaved={() => {}} onLimitsSaved={() => {}} />,
  );

  it('focus=domain scrolls to the sending domain and puts the cursor in its field', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    await mountSettings('domain');
    expect(scroll).toHaveBeenCalledTimes(1);
    expect((scroll.mock.contexts[0] as HTMLElement).id).toBe('email-domain-section');
    expect(document.activeElement?.id).toBe('email-domain');
  });

  it('focus=sender lands on the sender section', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    await mountSettings('sender');
    expect(document.activeElement?.id).toBe('email-from-name');
  });

  it('opened normally it moves nothing', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    await mountSettings(null);
    expect(scroll).not.toHaveBeenCalled();
    expect(document.activeElement?.id).not.toBe('email-domain');
  });

  it('the workspace carries the focus from the send step into Settings', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const send = vi.fn(async () => { throw new EmailApiError('Sending to more than 1,000 people needs a verified sending domain.', 'domain_required', false); });
    const api = fakeApi({ send: send as never, overview: vi.fn(async () => overview({ settings: { ...SETTINGS, domainState: 'none', domain: '' } })) });
    await mount(<EmailWorkspace tenantId="grace" api={api} initialSection="broadcasts" />);
    await flush();
    await click(need(byName('button', 'New broadcast'), 'new'));
    await flush();
    await typeInto(subject(), 'Easter');
    await click(need(byName('button', /^Next/), 'next'));
    await flush();
    await click(need(all('button').find((b) => /Open settings/.test(b.textContent ?? '')), 'open settings'));
    await flush();
    expect(text()).toContain('Email settings');
    expect(document.activeElement?.id).toBe('email-domain');
  });
});

describe('the newsletter switch being off', () => {
  it('reads "Newsletter is temporarily unavailable", not the not-configured copy', async () => {
    const api = createEmailApi('grace', async () => ({ status: 503, json: { ok: false, error: 'newsletter_hidden', message: 'Newsletter is temporarily unavailable.' } }));
    await expect(api.overview()).rejects.toMatchObject({ code: 'newsletter_hidden', notConfigured: false, message: 'Newsletter is temporarily unavailable.' });
  });

  it('a 503 for any other reason keeps the not-configured copy', async () => {
    const api = createEmailApi('grace', async () => ({ status: 503, json: { ok: false, error: 'not_configured' } }));
    await expect(api.overview()).rejects.toMatchObject({ code: 'not_configured', message: NOT_CONFIGURED_COPY });
    const bare = createEmailApi('grace', async () => ({ status: 503, json: {} }));
    await expect(bare.overview()).rejects.toMatchObject({ message: NOT_CONFIGURED_COPY });
  });

  it('a stale tab shows it and nothing about setting up a server', async () => {
    const api = fakeApi({ overview: vi.fn(async () => { throw new EmailApiError('Newsletter is temporarily unavailable.', 'newsletter_hidden', false); }) });
    await mount(<EmailWorkspace tenantId="grace" api={api} />);
    await flush();
    expect(need(document.querySelector('[role=alert]'), 'alert').textContent).toBe('Newsletter is temporarily unavailable.');
    expect(text()).not.toContain('not set up on this server');
  });
});

describe('Templates picker', () => {
  it('draws a thumbnail for every starter template, each from that template\'s own structure', async () => {
    await mount(<TemplatesDialog open onOpenChange={() => {}} onPick={() => {}} hasContent={false} />);
    const thumbs = all('[data-template-thumb]');
    expect(thumbs.map((t) => t.getAttribute('data-template-thumb'))).toEqual(EMAIL_TEMPLATES.map((t) => t.id));
    expect(thumbs).toHaveLength(5);
    const shapes = thumbs.map((t) => t.innerHTML);
    expect(new Set(shapes).size).toBe(5);
  });

  it('shows what each letter holds: headings, a list, a button, a quote', () => {
    const kinds = (id: string) => new Set(templateBlocks(EMAIL_TEMPLATES.find((t) => t.id === id)!.bodyHtml).map((b) => b.kind));
    expect(kinds('weekly')).toEqual(new Set(['text', 'heading', 'list']));
    expect(kinds('event')).toContain('button');
    expect(kinds('prayer')).toContain('quote');
    expect(kinds('thanks')).toEqual(new Set(['text']));
    expect(templateBlocks('<p>Hi</p><p></p><p><a data-button="true" href="https://x">Go</a></p>')).toEqual([{ kind: 'text', lines: 1 }, { kind: 'button' }]);
  });

  it('picking one passes it on and closes, and the picker has no raw button', async () => {
    const onPick = vi.fn();
    const onOpenChange = vi.fn();
    await mount(<TemplatesDialog open onOpenChange={onOpenChange} onPick={onPick} hasContent />);
    const cards = all('[role=dialog] [data-slot=button]').filter((b) => /Weekly update/.test(b.textContent ?? ''));
    expect(cards).toHaveLength(1);
    expect(all('[role=dialog] button:not([data-slot])').filter((b) => !b.getAttribute('aria-label') && b.textContent?.trim() !== 'Close')).toHaveLength(0);
    await click(cards[0]);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'weekly' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
