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
