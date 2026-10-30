import { act } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BodyEditor } from '@/components/email/BodyEditor';
import { DEFAULT_EMAIL_DESIGN } from '@/lib/email/design';
import { renderEmail, sanitizeEmailBody } from '@/lib/email/render';
import { byName, click, flush, mount, need, unmount } from './dom';

/**
 * The "/" slash menu and the two email blocks it inserts: the Issue header and
 * the tinted Box. Typing "/" (a DOM text edit, the way a browser delivers it)
 * must open the menu; picking an item inserts the block; and hostile markup
 * smuggled into a block field dies in the render, never in an inbox.
 */

afterEach(unmount);

const editable = () => need(document.querySelector<HTMLElement>('.ProseMirror'), 'editor body');

/** ProseMirror reads text edits through its DOM observer; give it time to. */
const settle = async () => {
  await flush();
  await new Promise((r) => setTimeout(r, 60));
  await flush();
};

/** Seed a paragraph that ends in a space, then type the slash the way a browser does. */
async function typeSlash(onChange: (html: string) => void) {
  await mount(<BodyEditor html="<p>hello </p>" onChange={onChange} />);
  await settle();
  const el = editable();
  el.focus();
  const p = need(el.querySelector<HTMLElement>('p'), 'seed paragraph');
  (p.firstChild as Text).nodeValue = 'hello /';
  await settle();
}

const menu = () => need(document.querySelector('[role=listbox]'), 'the slash menu');
const item = (title: string) => need(byName('[role=option]', title), `${title} menu item`);

describe('the "/" menu', () => {
  it('opens on the slash and offers the two email blocks among the basics', async () => {
    const onChange = vi.fn();
    await typeSlash(onChange);
    const titles = [...menu().querySelectorAll('[role=option]')].map((o) => o.textContent?.trim());
    expect(titles).toContain('Issue header');
    expect(titles).toContain('Box');
    expect(titles).toContain('Heading 1');
  });

  it('Escape stays dismissed through query edits and cursor moves until a new slash is typed', async () => {
    await typeSlash(vi.fn());
    expect(menu()).toBeTruthy();
    const el = editable();
    const key = async (value: string) => {
      await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })); });
      await settle();
    };
    const edit = async (value: string) => {
      await act(async () => { need(el.querySelector('p'), 'paragraph').textContent = value; });
      await settle();
    };
    await key('Escape');
    expect(document.querySelector('[role=listbox]')).toBeNull();
    // Keep a matching query: without the dismissal this reopens the Box result.
    await key('b');
    await edit('hello /b');
    expect(document.querySelector('[role=listbox]')).toBeNull();
    await key('Backspace');
    await edit('hello /');
    expect(document.querySelector('[role=listbox]')).toBeNull();
    await key('ArrowLeft');
    await key('ArrowRight');
    expect(document.querySelector('[role=listbox]')).toBeNull();
    // Even leaving and returning to the original match must not re-arm it.
    await edit('hello /b ');
    await edit('hello /b');
    expect(document.querySelector('[role=listbox]')).toBeNull();
    await edit('hello /b ');
    await key('/');
    await edit('hello /b /');
    expect(menu()).toBeTruthy();
    expect(item('Box')).toBeTruthy();
  });

  it('picking Issue header inserts the block and consumes the slash', async () => {
    const onChange = vi.fn();
    await typeSlash(onChange);
    await click(item('Issue header'));
    await settle();
    const html = onChange.mock.calls.at(-1)?.[0] as string;
    expect(html).toContain('data-hv-block="issue-header"');
    expect(document.querySelector('[role=listbox]')).toBeNull(); // the menu closes behind the pick
  });

  it('picking Box inserts the tinted box block', async () => {
    const onChange = vi.fn();
    await typeSlash(onChange);
    await click(item('Box'));
    await settle();
    const html = onChange.mock.calls.at(-1)?.[0] as string;
    expect(html).toContain('data-hv-block="box"');
    expect(html).not.toContain('hello /'); // the slash and its query are gone
    await click(need(byName('button', 'Box options'), 'Box settings'));
    await flush();
    const swatch = need(byName('[role=radio]', 'Warm'), 'warm tint');
    expect(swatch.getAttribute('data-slot')).toBe('radio-group-item');
    await click(swatch);
    await settle();
    expect(onChange.mock.calls.at(-1)?.[0]).toContain('data-tint="warm"');
  });
});

describe('block fields preserve spaces while typing', () => {
  it.each([
    ['box', 'Box options', 'box-label', 'data-label'],
    ['box', 'Box options', 'box-title', 'data-title'],
    ['box', 'Box options', 'box-blurb', 'data-blurb'],
    ['box', 'Box options', 'box-button-text', 'data-button-text'],
    ['box', 'Box options', 'box-button-url', 'data-button-url'],
    ['issue-header', 'Issue header options', 'issue-title', 'data-title'],
    ['issue-header', 'Issue header options', 'issue-subtitle', 'data-subtitle'],
    ['issue-header', 'Issue header options', 'issue-online-url', 'data-read-online'],
  ])('%s: %s / %s keeps word boundaries in the input and saved HTML', async (block, options, id, attribute) => {
    const onChange = vi.fn();
    await mount(<BodyEditor html={`<div data-hv-block="${block}"></div><p></p>`} onChange={onChange} />);
    await settle();
    await click(need(byName('button', options), 'block settings'));
    if (attribute === 'data-read-online') {
      await click(need(document.querySelector<HTMLElement>('#issue-online'), 'online toggle'));
      await flush();
    }
    const field = need(document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null, id);
    const user = userEvent.setup();
    await act(async () => { await user.click(field); field.select(); });
    // userEvent.type delivers each character separately, including the space.
    await act(async () => { await user.type(field, 'Sunday supper', { skipClick: true }); });
    expect(field.value).toBe('Sunday supper');
    await act(async () => { await user.type(field, ' '); });
    expect(field.value).toBe('Sunday supper ');
    const saved = need(onChange.mock.calls.at(-1), 'serialized update')[0] as string;
    const stored = new DOMParser().parseFromString(saved, 'text/html');
    expect(need(stored.querySelector(`[data-hv-block="${block}"]`), 'stored block').getAttribute(attribute)).toBe('Sunday supper');
    if (attribute === 'data-title') {
      const out = renderEmail({
        design: DEFAULT_EMAIL_DESIGN, preheader: '', churchName: 'Grace', mailingAddress: '1 Main St',
        unsubscribeUrl: 'https://x.org/u', firstName: 'Ana', senderName: 'Grace', themeId: 'letter', bodyHtml: saved,
      }).html;
      expect(out).toContain('Sunday supper');
    }
  });
});

describe('hostile markup in a Box field dies in the render', () => {
  const base = {
    design: DEFAULT_EMAIL_DESIGN,
    preheader: '',
    churchName: 'Grace',
    mailingAddress: '1 Main St',
    unsubscribeUrl: 'https://x.org/u',
    firstName: 'Ana',
    senderName: 'Grace',
    themeId: 'letter' as const,
  };
  const box = (blurb: string) =>
    `<div data-hv-block="box" data-title="Give" data-blurb="${blurb}" data-tint="accent" data-variant="filled"></div>`;

  it('a <script> in the Box blurb is stripped and escaped, never emitted', () => {
    const out = renderEmail({ ...base, bodyHtml: box('before <script>steal()</script> after') } as never).html;
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;script&gt;steal()&lt;/script&gt;');
  });

  it('an onerror payload in the Box blurb never reaches a tag or an attribute', () => {
    const out = renderEmail({ ...base, bodyHtml: box('<img src=x onerror=alert(1)>') } as never).html;
    expect(out).not.toMatch(/<[^>]*\bonerror/);
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('the sanitizer keeps the block marker but strips everything else off it', () => {
    const clean = sanitizeEmailBody(
      `<div data-hv-block="box" data-title="t" onclick="steal()" style="position:fixed"><script>evil()</script></div>`,
    );
    expect(clean).toContain('data-hv-block="box"');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('<script');
  });
});
