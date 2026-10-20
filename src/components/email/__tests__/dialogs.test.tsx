import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_EMAIL_DESIGN } from '@/lib/email/design';
import { DesignDialog } from '@/components/email/DesignDialog';
import { PreviewDialog } from '@/components/email/PreviewDialog';
import { TemplatesDialog } from '@/components/email/TemplatesDialog';
import { ImportDialog } from '@/components/email/ImportDialog';
import { EmailApiError } from '@/components/email/email-api';
import { readImportRows } from '@/components/email/import-rows';
import { inboxCheck } from '@/components/email/inbox-check';
import { byName, click, flush, mount, need, text, type, unmount } from './dom';
import { fakeApi } from './fixtures';

afterEach(unmount);

describe('Design dialog', () => {
  it('changes theme, accent and footer through the shadcn controls', async () => {
    const onChange = vi.fn();
    await mount(<DesignDialog open onOpenChange={() => {}} design={DEFAULT_EMAIL_DESIGN} onChange={onChange} />);
    await click(need(byName('[role=radio]', /Bold/), 'Bold'));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_EMAIL_DESIGN, theme: 'bold' });
    await click(need(byName('[role=radio]', /Wheat gold/), 'gold'));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_EMAIL_DESIGN, accent: 'gold' });
    await type(need(byName('input', 'Footer note'), 'footer'), 'Hello');
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_EMAIL_DESIGN, footerText: 'Hello' });
  });

  it('offers only the Harvest accents: navy, gold and harbor', async () => {
    await mount(<DesignDialog open onOpenChange={() => {}} design={DEFAULT_EMAIL_DESIGN} onChange={() => {}} />);
    const names = [...document.querySelectorAll('[aria-label="Accent color"] [role=radio]')].map((e) => e.textContent?.trim());
    expect(names).toEqual(['Harvest navy', 'Wheat gold', 'Harbor blue']);
  });
});

describe('Preview dialog', () => {
  it('renders the server HTML in a sandboxed frame and re-renders for the dark tab', async () => {
    const api = fakeApi();
    await mount(<PreviewDialog open onOpenChange={() => {}} api={api} draft={{ subject: 'S', bodyHtml: '<p>x</p>' }} />);
    await flush();
    const frame = need(document.querySelector('iframe[title="Email preview"]'), 'frame');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(api.preview).toHaveBeenLastCalledWith(expect.objectContaining({ dark: false }));
    await click(need(byName('button', 'Dark'), 'Dark tab'));
    await flush();
    expect(api.preview).toHaveBeenLastCalledWith(expect.objectContaining({ dark: true }));
    await click(need(byName('button', 'Phone'), 'Phone tab'));
    await flush();
    expect(need(document.querySelector('iframe[title="Email preview"]'), 'frame').className).toContain('w-[375px]');
  });

  it('shows a failed preview as an error, not a blank frame', async () => {
    const api = fakeApi({ preview: vi.fn(async () => { throw new EmailApiError('nope', 'x', false); }) });
    await mount(<PreviewDialog open onOpenChange={() => {}} api={api} draft={{}} />);
    await flush();
    expect(need(document.querySelector('[role=alert]'), 'alert').textContent).toContain('nope');
    expect(document.querySelector('iframe')).toBeNull();
  });
});

describe('Templates dialog', () => {
  it('lists the starter letters and hands the pick back', async () => {
    const onPick = vi.fn();
    const onOpenChange = vi.fn();
    await mount(<TemplatesDialog open onOpenChange={onOpenChange} onPick={onPick} hasContent />);
    expect(text()).toContain('replaces what you have written');
    await click(need(byName('button', /Weekly update/), 'weekly'));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'weekly' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('CSV reading', () => {
  it('finds the email, name and tag columns by their headings', () => {
    const r = readImportRows('First Name,Last Name,E-mail,Tags\nRuth,Lee,Ruth@X.org,"youth; women"\n');
    expect(r).toMatchObject({ ok: true, rows: [{ email: 'Ruth@X.org', name: 'Ruth Lee', tags: ['youth', 'women'] }] });
  });

  it('refuses a file with no email column, and an empty one', () => {
    expect(readImportRows('Name,Phone\nA,1\n')).toMatchObject({ ok: false, error: expect.stringMatching(/no email column/) });
    expect(readImportRows('')).toMatchObject({ ok: false });
  });
});

describe('Import dialog', () => {
  it('will not import until consent is ticked, then reports merges and blocks', async () => {
    const api = fakeApi({ importContacts: vi.fn(async () => ({ added: 2, merged: 1, alreadySubscribed: 0, blocked: 1, invalid: 0, repeatedInFile: 0 })) });
    const onImported = vi.fn();
    await mount(<ImportDialog open onOpenChange={() => {}} api={api} onImported={onImported} />);
    const input = need(document.querySelector<HTMLInputElement>('#email-import-file'), 'file input');
    const file = new File(['Email,Name\na@x.org,A\nb@x.org,B\n'], 'list.csv', { type: 'text/csv' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    const { act } = await import('react');
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await flush();
    const run = () => need(byName('button', 'Import'), 'Import') as HTMLButtonElement;
    expect(run().disabled).toBe(true);
    await click(need(document.querySelector<HTMLElement>('#email-import-consent'), 'consent'));
    expect(run().disabled).toBe(false);
    await click(run());
    await flush();
    expect(api.importContacts).toHaveBeenCalledWith([expect.objectContaining({ email: 'a@x.org' }), expect.objectContaining({ email: 'b@x.org' })], true);
    expect(onImported).toHaveBeenCalled();
    expect(text()).toContain('new CRM people were added');
    expect(text()).toContain('unsubscribed or bounced');
  });
});

describe('inbox check', () => {
  it('flags an empty subject as a fix and a missing preview as a tip', () => {
    const tips = inboxCheck({ subject: '', preheader: '', bodyHtml: '<p>Hello there friends of the church</p>' });
    expect(tips.map((t) => [t.id, t.kind])).toEqual([['subject', 'fix'], ['preheader', 'tip']]);
  });
  it('flags shouting', () => {
    expect(inboxCheck({ subject: 'JOIN US THIS SUNDAY', preheader: 'x', bodyHtml: '<p>one two three four five six</p>' }).map((t) => t.id)).toEqual(['caps']);
  });
});
