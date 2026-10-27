import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_EMAIL_LIMITS } from '@/lib/email/limits';
import { ImportDialog, IMPORT_CHUNK } from '@/components/email/ImportDialog';
import { PlatformLimitsCard } from '@/components/email/PlatformLimitsCard';
import { SendStep } from '@/components/email/SendStep';
import { SendingNotice } from '@/components/email/SendingNotice';
import { UsageMeter } from '@/components/email/UsageMeter';
import { EmailApiError } from '@/components/email/email-api';
import { byName, click, flush, mount, need, text, type, unmount } from './dom';
import { SETTINGS, USAGE, fakeApi, person } from './fixtures';

afterEach(unmount);

const usage = (over: Partial<typeof USAGE> = {}) => ({ ...USAGE, ...over });

describe('usage meter', () => {
  it('reads "X of Y emails used this month" with a progress bar', async () => {
    await mount(<UsageMeter usage={usage({ used: 1200, percent: 24 })} />);
    expect(text()).toContain('1,200 of 5,000 emails used this month');
    expect(document.querySelector('[role=progressbar]')).not.toBeNull();
    expect(document.querySelector('[data-usage-warning]')).toBeNull();
    expect(text()).toContain('no limit on how many people are on your list');
  });

  it('warns at the configured level and offers Add more emails', async () => {
    await mount(<UsageMeter usage={usage({ used: 4000, percent: 80, warn: true })} />);
    expect(need(document.querySelector('[data-usage-warning]'), 'warning').textContent).toContain('80%');
    await click(need(byName('button', 'Add more emails'), 'cta'));
    expect(text()).toContain('Buying a pack is not available yet');
    expect(text()).toContain('10,000 emails');
  });

  it('at the cap it says new sends are blocked and until when', async () => {
    await mount(<UsageMeter usage={usage({ used: 5000, percent: 100, warn: true })} />);
    expect(text()).toContain('New sends are blocked until');
  });

  it('shows the pack price only when one has been set', async () => {
    await mount(<UsageMeter usage={usage({ used: 4500, percent: 90, warn: true, pack: { size: 10000, priceUsd: 25 } })} />);
    await click(need(byName('button', 'Add more emails'), 'cta'));
    expect(text()).toContain('for $25');
  });

  it('a new ministry sees its daily meter', async () => {
    await mount(<UsageMeter usage={usage({ daily: { used: 120, cap: 500, days: 14 } })} />);
    expect(need(document.querySelector('[data-daily-meter]'), 'daily').textContent).toContain('500 emails a day for their first 14 days');
  });
});

describe('sending paused notice', () => {
  const paused = { paused: true as const, reason: 'bounce' as const, rate: 0.071, threshold: 0.05, pausedAt: '2031-03-10T10:00:00.000Z' };

  it('shows nothing while sending is on', async () => {
    await mount(<SendingNotice sending={{ paused: false }} api={fakeApi()} canResume={false} tenantId="grace" onResumed={() => {}} />);
    expect(document.querySelector('[data-sending-paused]')).toBeNull();
  });

  it('tells a ministry admin why, with no resume button', async () => {
    await mount(<SendingNotice sending={paused} api={fakeApi()} canResume={false} tenantId="grace" onResumed={() => {}} />);
    expect(text()).toContain('Sending is paused');
    expect(text()).toContain('7.1%');
    expect(text()).toContain('5%');
    expect(byName('button', 'Resume sending')).toBeNull();
  });

  it('a super admin can resume', async () => {
    const api = fakeApi();
    const onResumed = vi.fn();
    await mount(<SendingNotice sending={paused} api={api} canResume tenantId="grace" onResumed={onResumed} />);
    await click(need(byName('button', 'Resume sending'), 'resume'));
    await flush();
    expect(api.resumeSending).toHaveBeenCalledWith('grace');
    expect(onResumed).toHaveBeenCalled();
  });
});

function sendStep(api: ReturnType<typeof fakeApi>, over: Partial<Parameters<typeof SendStep>[0]> = {}) {
  return (
    <SendStep
      api={api} broadcastId="b1" subject="Sunday" subjectB={null} preheader="x" bodyHtml="<p>Hello friends of the church</p>"
      filters={[]} onFilters={() => {}} settings={SETTINGS} people={[person('a@x.org'), person('b@x.org')]}
      usage={USAGE} sending={{ paused: false }} onBack={() => {}} onOpenSettings={() => {}} onSeeTips={() => {}} onSent={() => {}}
      {...over}
    />
  );
}

describe('send step at the limits', () => {
  it('blocks a send that is over the allowance before anything is asked of the server, and offers Add more emails', async () => {
    const api = fakeApi();
    await mount(sendStep(api, { usage: usage({ used: 4999, percent: 100 }) }));
    expect(need(byName('button', /Send to 2 people/), 'send').hasAttribute('disabled')).toBe(true);
    expect(need(document.querySelector('[data-over-allowance]'), 'note').textContent).toContain('1 of 5,000 left this month');
    await click(need(byName('button', 'Add more emails'), 'cta'));
    expect(text()).toContain('Buying a pack is not available yet');
    expect(api.send).not.toHaveBeenCalled();
  });

  it('a paused ministry cannot send', async () => {
    await mount(sendStep(fakeApi(), { sending: { paused: true, reason: 'complaint', rate: 0.01, threshold: 0.003, pausedAt: '2031-03-10T10:00:00.000Z' } }));
    expect(need(byName('button', /Send to/), 'send').hasAttribute('disabled')).toBe(true);
    expect(text()).toContain('Sending is paused');
  });

  it('a server-side cap refusal shows its message and the CTA', async () => {
    const send = vi.fn(async () => { throw new EmailApiError('This send would pass your monthly allowance.', 'volume_cap', false); });
    await mount(sendStep(fakeApi({ send } as never)));
    await click(need(byName('button', /Send to 2 people/), 'send'));
    await flush();
    expect(need(document.querySelector('[role=alert]'), 'alert').textContent).toContain('monthly allowance');
    expect(byName('button', 'Add more emails')).not.toBeNull();
  });

  it('a daily-cap refusal shows its message without the pack CTA (a pack does not lift a daily cap)', async () => {
    const send = vi.fn(async () => { throw new EmailApiError('New ministries can send up to 500 emails a day.', 'daily_cap', false); });
    await mount(sendStep(fakeApi({ send } as never)));
    await click(need(byName('button', /Send to 2 people/), 'send'));
    await flush();
    expect(text()).toContain('500 emails a day');
    expect(byName('button', 'Add more emails')).toBeNull();
  });
});

describe('platform limits editor (super admin)', () => {
  it('edits numbers, turns rates into fractions and an empty price into null', async () => {
    const api = fakeApi();
    const onSaved = vi.fn();
    await mount(<PlatformLimitsCard api={api} limits={DEFAULT_EMAIL_LIMITS} onSaved={onSaved} />);
    const field = (id: string) => need(document.querySelector<HTMLInputElement>(`#${id}`), id);
    expect(field('limit-monthly-ministry').value).toBe('10000');
    expect(field('limit-bounce').value).toBe('5');
    await type(field('limit-monthly-church'), '7500');
    await type(field('limit-warn'), '90');
    await type(field('limit-bounce'), '2');
    await click(need(byName('button', 'Save limits'), 'save'));
    await flush();
    expect(api.saveLimits).toHaveBeenCalledWith(expect.objectContaining({
      monthlySends: { free: 0, church: 7500, ministry: 10000 },
      warnAtPercent: 90,
      pack: { size: 10000, priceUsd: null },
      autoPause: expect.objectContaining({ bounceRate: 0.02 }),
    }));
    expect(onSaved).toHaveBeenCalled();
  });

  it('shows a refusal instead of pretending to save', async () => {
    const api = fakeApi({ saveLimits: vi.fn(async () => { throw new EmailApiError('The warning level must be a whole number from 1 to 100.', 'invalid', false); }) } as never);
    await mount(<PlatformLimitsCard api={api} limits={DEFAULT_EMAIL_LIMITS} onSaved={() => {}} />);
    await click(need(byName('button', 'Save limits'), 'save'));
    await flush();
    expect(need(document.querySelector('[role=alert]'), 'alert').textContent).toContain('warning level');
    expect(text()).not.toContain('Saved.');
  });
});

describe('import has no list-size limit', () => {
  it('a file bigger than one request goes up in chunks and the totals add up', async () => {
    const rows = Array.from({ length: IMPORT_CHUNK + 5 }, (_, i) => `p${i}@x.org`).join('\n');
    const importContacts = vi.fn(async (r: readonly unknown[]) => ({ added: r.length, merged: 0, alreadySubscribed: 0, blocked: 0, invalid: 0, repeatedInFile: 0 }));
    await mount(<ImportDialog open onOpenChange={() => {}} api={fakeApi({ importContacts } as never)} onImported={() => {}} />);
    const input = need(document.querySelector<HTMLInputElement>('#email-import-file'), 'input');
    Object.defineProperty(input, 'files', { value: [new File([`Email\n${rows}\n`], 'big.csv', { type: 'text/csv' })], configurable: true });
    const { act } = await import('react');
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await flush();
    await click(need(document.querySelector<HTMLElement>('#email-import-consent'), 'consent'));
    await click(need(byName('button', 'Import'), 'import'));
    await flush();
    expect(importContacts).toHaveBeenCalledTimes(2);
    expect(importContacts.mock.calls[0][0]).toHaveLength(IMPORT_CHUNK);
    expect(importContacts.mock.calls[1][0]).toHaveLength(5);
    expect(text()).toContain(`${IMPORT_CHUNK + 5} new CRM people were added`.replace(String(IMPORT_CHUNK + 5), (IMPORT_CHUNK + 5).toLocaleString()));
  });
});
