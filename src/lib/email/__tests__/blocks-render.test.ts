import { describe, expect, it } from 'vitest';

import { sanitizeEmailBody, renderEmail, DEFAULT_EMAIL_DESIGN } from '@/lib/email/render';
import { BOX_TINTS } from '@/lib/email/blocks';
import { THEME_PRESETS } from '@/lib/email/themes';
import { AA_CONTRAST, boxFillColors, contrastRatio, luminance } from '@/lib/email/theme-contrast';

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

  it('a navy filled Box renders a light title colour and a button whose background contrasts >= 3:1 with the fill', () => {
    const out = html(box({
      'data-tint': 'navy',
      'data-variant': 'filled',
      'data-button-text': 'Reserve a seat',
      'data-button-url': 'https://x.org/rsvp',
    }));

    // The Box cell is the only element painted with a plain `border:1px solid`.
    const cell = /background:(#[0-9A-Fa-f]{6});border:1px solid/.exec(out);
    expect(cell, 'the Box cell carries its fill').not.toBeNull();
    const fill = cell![1];

    const title = /font-weight:700;color:(#[0-9A-Fa-f]{6});margin:0">Sunday supper/.exec(out);
    expect(title, 'the Box title carries its colour').not.toBeNull();
    const titleColor = title![1];
    expect(contrastRatio(titleColor, fill), 'the title is readable on the fill').toBeGreaterThanOrEqual(AA_CONTRAST);
    expect(luminance(titleColor), 'a navy fill draws the light ink').toBeGreaterThan(luminance(fill));

    const button = /font-weight:600;background:(#[0-9A-Fa-f]{6});color:(#[0-9A-Fa-f]{6});border:1.5px solid/.exec(out);
    expect(button, 'the Box button carries its colours').not.toBeNull();
    const [, buttonBg, buttonInk] = button!;
    expect(contrastRatio(buttonBg, fill), 'the button ground clears the 3:1 non-text floor against the fill').toBeGreaterThanOrEqual(3);
    expect(contrastRatio(buttonInk, buttonBg), 'the button words read on their own ground').toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it('the shared derivation the Box node view mirrors swaps a vanishing themed button for a chip', () => {
    // Letter's navy button on a navy filled Box cannot clear 3:1 against the
    // fill, so boxFillColors hands back the inkOn(fill) chip with contrasting
    // text. Box.tsx's node view imports this same helper — one copy of the
    // maths — so the editor preview draws exactly what this asserts.
    const colors = boxFillColors(
      '#0C1526',
      '#FFFFFF',
      { heading: '#0C1526', ink: '#1A1A1A', buttonBg: '#0C1526', buttonInk: '#FFFFFF' },
      true,
    );
    expect(colors.buttonBg).not.toBe('#0C1526'); // the themed navy is gone from the button
    expect(contrastRatio(colors.buttonBg, colors.fill), 'the chip clears 3:1 against the fill').toBeGreaterThanOrEqual(3);
    expect(contrastRatio(colors.buttonInk, colors.buttonBg), 'the chip text reads on the chip').toBeGreaterThanOrEqual(AA_CONTRAST);
    expect(luminance(colors.title), 'the title is the light ink on a navy fill').toBeGreaterThan(luminance(colors.fill));
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

describe('every preset, tint and Box variant keeps all rendered text at AA', () => {
  for (const preset of THEME_PRESETS) {
    for (const tint of BOX_TINTS) {
      for (const variant of ['filled', 'outline'] as const) {
        it.each([false, true])(`${preset.id} / ${tint.key} / ${variant} / dark=%s`, (dark) => {
          const out = html(box({
            'data-label': 'Give',
            'data-tint': tint.key,
            'data-variant': variant,
            'data-button-text': 'Reserve a seat',
            'data-button-url': 'https://x.org/rsvp',
          }), { themeId: preset.id, dark });
          const root = document.createElement('div');
          root.innerHTML = out;
          const cell = [...root.querySelectorAll('td')].find((el) =>
            el.getAttribute('style')?.includes('border:1px solid') && el.textContent?.includes('Sunday supper'));
          expect(cell, 'the rendered Box cell exists').toBeDefined();
          const color = (el: Element, property: string) => {
            const match = new RegExp(`(?:^|;)${property}:(#[0-9a-fA-F]{6}|transparent)(?:;|$)`)
              .exec(el.getAttribute('style')!);
            expect(match, `${property} is explicit in ${el.outerHTML}`).not.toBeNull();
            return match![1];
          };
          const fill = color(cell!, 'background');
          const words = [...cell!.querySelectorAll('div, a')].filter((el) => el.children.length === 0);
          expect(words.map((el) => el.textContent)).toEqual(['GIVE', 'Sunday supper', 'Bring a friend.', 'Reserve a seat']);
          for (const el of words) {
            const background = el.tagName === 'A' ? color(el, 'background') : fill;
            expect(contrastRatio(color(el, 'color'), background === 'transparent' ? fill : background), el.textContent!)
              .toBeGreaterThanOrEqual(AA_CONTRAST);
          }
        });
      }
    }
  }
});
