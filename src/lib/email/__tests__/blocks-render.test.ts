import { describe, expect, it } from 'vitest';

import { sanitizeEmailBody, renderEmail, DEFAULT_EMAIL_DESIGN } from '@/lib/email/render';

const base = {
  design: DEFAULT_EMAIL_DESIGN,
  preheader: '',
  churchName: 'Grace',
  mailingAddress: '1 Main St',
  unsubscribeUrl: 'https://x.org/u',
  firstName: 'Ana',
  senderName: 'Grace',
};

const attrs = (pairs: Record<string, string>) =>
  Object.entries(pairs).map(([k, v]) => `${k}="${v}"`).join(' ');

const issue = (over: Record<string, string> = {}) =>
  `<div ${attrs({ 'data-hv-block': 'issue-header', 'data-title': 'This Sunday', 'data-subtitle': 'Why we gather', 'data-size': 'm', 'data-align': 'center', 'data-reading': 'true', ...over })}></div>`;

const box = (over: Record<string, string> = {}) =>
  `<div ${attrs({ 'data-hv-block': 'box', 'data-title': 'Sunday supper', 'data-blurb': 'Bring a friend.', 'data-tint': 'accent', 'data-variant': 'filled', ...over })}></div>`;

// The token path (a real preset), so block colours come from theme tokens.
const theme = { themeId: 'letter' as const };
const html = (bodyHtml: string, over: Record<string, unknown> = {}) =>
  renderEmail({ ...base, bodyHtml, ...theme, ...over } as never).html;

describe('the two slash-menu blocks render as email-safe tables', () => {
  it('the Issue header carries its title, subtitle, reading time and read-online link', () => {
    const out = html(`<p>Hi</p>${issue({ 'data-size': 'l', 'data-read-online': 'https://x.org/issue' })}`);
    expect(out).toContain('<table role="presentation"');
    expect(out).toContain('This Sunday');
    expect(out).toContain('Why we gather');
    expect(out).toContain('1 MIN READ');
    expect(out).toContain('Read this issue online');
    expect(out).toContain('href="https://x.org/issue"');
    expect(out).toContain('font-size:34px'); // size l
  });

  it('the Box carries its label, title, blurb and button as one tinted table cell', () => {
    const out = html(box({ 'data-label': 'Give', 'data-button-text': 'Reserve a seat', 'data-button-url': 'https://x.org/rsvp' }));
    expect(out).toContain('GIVE');
    expect(out).toContain('Sunday supper');
    expect(out).toContain('Bring a friend.');
    expect(out).toContain('Reserve a seat');
    expect(out).toContain('href="https://x.org/rsvp"');
    expect(out).toContain('border:1px solid');
  });

  it('filled and outline boxes draw different grounds', () => {
    const filled = html(box({ 'data-variant': 'filled' }));
    const outline = html(box({ 'data-variant': 'outline' }));
    expect(filled).not.toEqual(outline);
  });

  it('no marker in, byte-identical markup out, and no block residue ever', () => {
    const out = html('<p>Plain body</p>');
    expect(out).not.toContain('data-hv');
    expect(out).not.toContain('MIN READ');
    const legacy = renderEmail({ ...base, bodyHtml: '<p>Plain body</p>' } as never).html;
    expect(legacy).not.toContain('data-hv');
  });

  it('a stray div keeps its children and loses its tag, exactly as it always did', () => {
    const withDiv = renderEmail({ ...base, bodyHtml: '<p>a</p><div class="x"><p>b</p></div>' } as never).html;
    const without = renderEmail({ ...base, bodyHtml: '<p>a</p><p>b</p>' } as never).html;
    expect(withDiv).toEqual(without);
    expect(withDiv).not.toContain('<div class');
  });

  it('the plain-text part carries the blocks too', () => {
    const { text } = renderEmail({ ...base, bodyHtml: `${issue()}${box({ 'data-button-text': 'RSVP', 'data-button-url': 'https://x.org/rsvp' })}`, ...theme } as never);
    expect(text).toContain('This Sunday');
    expect(text).toContain('Sunday supper');
    expect(text).toContain('RSVP: https://x.org/rsvp');
    expect(text).not.toContain('data-hv');
  });
});

describe('block fields can never inject markup', () => {
  it('a <script> in the Box blurb and title is stripped and escaped, never emitted', () => {
    const out = html(box({
      'data-title': '<script>steal()</script>',
      'data-blurb': 'before <script>steal()</script> after',
    }));
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;script&gt;steal()&lt;/script&gt;');
  });

  it('an onerror payload in a Box field never reaches a tag or an attribute', () => {
    const out = html(box({ 'data-blurb': '<img src=x onerror=alert(1)>' }));
    expect(out).not.toMatch(/<[^>]*\bonerror/); // never as markup or an attribute
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;'); // and only ever as escaped words
  });

  it('markup smuggled as a child of a block marker dies with the marker', () => {
    const out = html(
      `<div ${attrs({ 'data-hv-block': 'box', 'data-title': 'T' })}><script>evil()</script><img src=x onerror=alert(1)></div>`,
    );
    expect(out).not.toContain('<script');
    expect(out).not.toContain('onerror');
    expect(out).toContain('>T<');
  });

  it('a hostile attribute on the marker itself is stripped by the sanitizer', () => {
    const clean = sanitizeEmailBody(
      `<div ${attrs({ 'data-hv-block': 'box', 'data-title': 't', class: 'evil', style: 'position:fixed', onclick: 'steal()' })}></div>`,
    );
    expect(clean).toContain('data-hv-block="box"');
    expect(clean).toContain('data-title="t"');
    expect(clean).not.toContain('class=');
    expect(clean).not.toContain('style=');
    expect(clean).not.toContain('onclick');
  });

  it('the Box button and the read-online link take https and mailto and nothing else', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'http://plain.example/x', 'ftp://x.org/f']) {
      // The only anchor in a render with no links is the footer's Unsubscribe.
      expect(html(box({ 'data-button-text': 'Go', 'data-button-url': url }))).not.toContain('>Go<');
      expect(html(issue({ 'data-read-online': url }))).not.toContain('Read this issue online');
    }
    expect(html(box({ 'data-button-text': 'Go', 'data-button-url': 'mailto:office@grace.org' }))).toContain('href="mailto:office@grace.org"');
    expect(html(issue({ 'data-read-online': 'https://x.org/online' }))).toContain('href="https://x.org/online"');
  });

  it('a script dressed up as a link cannot survive as an href', () => {
    const out = html(box({ 'data-button-text': 'Go', 'data-button-url': 'https://x.org/" onload="steal()' }));
    expect(out).not.toContain('onload');
  });
});
