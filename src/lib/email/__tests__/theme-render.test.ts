import { describe, expect, it } from 'vitest';

import { AA_CONTRAST, contrastRatio } from '@/lib/email/theme-contrast';
import {
  DEFAULT_THEME_TOKENS,
  NIGHT_CARD,
  NIGHT_PAGE,
  THEME_PRESETS,
  getThemePreset,
  resolveTheme,
  tokensFromDesign,
} from '@/lib/email/themes';
import { DEFAULT_EMAIL_DESIGN } from '@/lib/email/design';
import { renderEmail } from '@/lib/email/render';

/**
 * Theme rendering: each shipped preset draws its own stable markers (no giant
 * snapshots), the readable-ink fallback fires loudly for a planted
 * low-contrast theme, legacy `EmailDesign` documents still map and render, and
 * the shared brand settings ride every theme's header and footer.
 */

const base = {
  design: DEFAULT_EMAIL_DESIGN,
  preheader: '',
  churchName: 'Grace Community',
  mailingAddress: '1 Main St',
  unsubscribeUrl: 'https://x.org/u',
  firstName: 'Ana',
  senderName: 'Grace',
};

const html = (bodyHtml: string, over: Record<string, unknown> = {}) =>
  renderEmail({ ...base, bodyHtml, ...over } as never);

const forPreset = (id: string, over: Record<string, unknown> = {}) =>
  html('<h1>Head</h1><p>Words</p>', { themeId: id, design: { ...DEFAULT_EMAIL_DESIGN, footerText: '' }, ...over });

describe('each of the five presets renders its own stable markers', () => {
  it('sweeps every preset, so no preset can pass vacuously', () => {
    expect(THEME_PRESETS.map((p) => p.id)).toEqual(['letter', 'essay', 'card', 'midnight', 'minimal']);
  });

  it('Letter: cream page, white card at 12px corners, Fraunces headings, masthead name in navy', () => {
    const out = forPreset('letter').html;
    expect(out).toContain('background:#FAF8F5');
    expect(out).toContain('max-width:560px');
    expect(out).toContain('border-radius:12px');
    expect(out).toContain('font-family:Fraunces, Georgia, "Times New Roman", serif');
    expect(out).toContain('font-size:22px;font-weight:700;color:#0C1526');
  });

  it('Essay: flat white, 480 wide, 18px Georgia body and 15px name line', () => {
    const out = forPreset('essay').html;
    expect(out).toContain('max-width:480px');
    expect(out).toContain('border-radius:0px');
    expect(out).toContain('font-size:18px;line-height:1.7');
    expect(out).toContain('font-family:Georgia, "Times New Roman", serif');
    expect(out).toContain('font-size:15px;font-weight:700;color:#2E2A26');
  });

  it('Card: a cream card on a white page, and a banner picture when a theme sets one', () => {
    const card = getThemePreset('card')!.tokens;
    const out = forPreset('card', {
      themeTokens: { ...card, header: 'banner', bannerUrl: 'https://cdn.example.org/banner.jpg' },
    }).html;
    expect(out).toContain('background:#FFFFFF'); // the page behind
    expect(out).toContain('background:#FAF8F5;border-radius:12px'); // the card itself
    expect(out).toContain('max-width:560px');
    expect(out).toContain('<img src="https://cdn.example.org/banner.jpg" alt="Grace Community" width="560"');
  });

  it('Midnight: night page and card, light words, gold button ink, name line in the light ink', () => {
    const out = forPreset('midnight').html;
    expect(out).toContain(`background:${NIGHT_PAGE}`);
    expect(out).toContain(`background:${NIGHT_CARD}`);
    expect(out).toContain('font-size:15px;font-weight:700;color:#F5F5F5');
    expect(out).toContain('border-radius:12px');
  });

  it('Minimal: flat white, 15px words, and no header at all', () => {
    const out = forPreset('minimal').html;
    expect(out).toContain('background:#FFFFFF');
    expect(out).toContain('border-radius:0px');
    expect(out).toContain('font-size:14px;line-height:1.65');
    expect(out).not.toContain('Grace Community'); // header: 'none', footerText dropped above
    expect(out).not.toContain('Fraunces'); // system stack, not a web font
  });

  it('a preset is stable under a second render: same tokens in, same markup out', () => {
    for (const preset of THEME_PRESETS) {
      expect(forPreset(preset.id).html).toEqual(forPreset(preset.id).html);
    }
  });
});

describe('the readable-ink fallback fires loudly for a low-contrast theme', () => {
  const planted = {
    ...DEFAULT_THEME_TOKENS,
    page: '#FFFFFF',
    card: '#FFFFFF',
    text: '#F2F2F2',
    heading: '#EFEFEF',
    accent: '#C9963A',
  };

  it('planted near-white words on a white card are re-coloured and reported, never silently swapped', () => {
    const out = html('<p>Words</p><h1>Head</h1>', { themeTokens: planted });
    const textFix = out.adjustments.find((a) => a.pair === 'text');
    const headingFix = out.adjustments.find((a) => a.pair === 'heading');
    expect(textFix).toMatchObject({ pair: 'text', from: '#F2F2F2' });
    expect(headingFix).toMatchObject({ pair: 'heading', from: '#EFEFEF' });
    expect(out.html).not.toContain('color:#F2F2F2');
    expect(out.html).toContain(`color:${textFix!.to}`);
    // Every substitution clears AA on its own ground: the fallback is a
    // promise, not a nudge in the right direction.
    for (const fix of out.adjustments) {
      if (fix.pair === 'button') continue;
      expect(contrastRatio(fix.to, planted.card)).toBeGreaterThanOrEqual(AA_CONTRAST);
    }
  });

  it('a healthy preset reports nothing to adjust', () => {
    for (const preset of THEME_PRESETS) {
      expect(forPreset(preset.id).adjustments).toEqual([]);
    }
  });
});

describe('legacy EmailDesign documents still map and render', () => {
  it('tokensFromDesign maps the old knobs onto tokens, dark quirks preserved', () => {
    const tokens = tokensFromDesign(
      { ...DEFAULT_EMAIL_DESIGN, theme: 'bold', font: 'serif', accent: 'gold', buttons: 'outline', header: 'none' },
      true,
    );
    expect(tokens.headingFont).toBe('georgia'); // bold headings
    expect(tokens.bodyFont).toBe('georgia'); // serif body
    expect(tokens.accent).toBe('#C9963A'); // gold
    expect(tokens.buttons.fill).toBe('outline');
    expect(tokens.header).toBe('none');
    expect(tokens.page).toBe(NIGHT_PAGE); // the dark mapping
    expect(tokens.card).toBe(NIGHT_CARD);
  });

  it('resolveTheme falls back to the legacy path and says so', () => {
    const resolved = resolveTheme({ design: DEFAULT_EMAIL_DESIGN });
    expect(resolved.source).toBe('legacy');
    expect(resolved.themeId).toBeNull();
    expect(resolved.tokens).toEqual(tokensFromDesign(DEFAULT_EMAIL_DESIGN, false));
  });

  it('a broadcast saved before themes renders with no adjustments and no block residue', () => {
    const out = html('<p>Old words</p>', { design: { ...DEFAULT_EMAIL_DESIGN, footerText: 'Sent with care.' } });
    expect(out.html).toContain('Sent with care.');
    expect(out.html).toContain('Unsubscribe');
    expect(out.html).not.toContain('data-hv');
    expect(out.adjustments).toEqual([]); // legacy colours are historic, never rewritten
  });

  it('a token snapshot on the document wins over the preset its themeId names', () => {
    const letter = getThemePreset('letter')!.tokens;
    const resolved = resolveTheme({ themeId: 'letter', themeTokens: { ...letter, corners: 3 } });
    expect(resolved.tokens.corners).toBe(3);
    expect(html('<p>x</p>', { themeId: 'letter', themeTokens: { ...letter, corners: 3 } }).html)
      .toContain('border-radius:3px');
  });

  it('an unknown themeId with no snapshot still renders, from the legacy design', () => {
    const out = html('<p>x</p>', { themeId: 'gone-with-the-wind' });
    expect(out.html).toContain('Unsubscribe');
    expect(resolveTheme({ themeId: 'gone-with-the-wind' }).source).toBe('legacy');
  });
});

describe('the shared brand settings ride every theme', () => {
  const brand = {
    logoUrl: 'https://cdn.example.org/logo.png',
    footerNote: 'Everyone is welcome this Sunday.',
    socialLinks: [
      { platform: 'facebook', url: 'https://facebook.com/grace' },
      { platform: 'website', url: 'https://grace.org' },
    ],
  } as const;

  it('every preset footer carries the brand note, the social links and the unsubscribe link', () => {
    for (const preset of THEME_PRESETS) {
      const out = html('<p>Hi</p>', { themeId: preset.id, design: { ...DEFAULT_EMAIL_DESIGN, footerText: '' }, ...brand });
      expect(out.html, preset.name).toContain('Everyone is welcome this Sunday.');
      expect(out.html, preset.name).toContain('href="https://facebook.com/grace"');
      expect(out.html, preset.name).toContain('Facebook');
      expect(out.html, preset.name).toContain('Website');
      expect(out.html, preset.name).toContain('Unsubscribe');
      expect(out.text, preset.name).toContain('Facebook: https://facebook.com/grace');
    }
  });

  it('every theme that draws a header draws the brand logo above the name', () => {
    for (const preset of THEME_PRESETS.filter((p) => p.tokens.header !== 'none')) {
      const out = html('<p>Hi</p>', { themeId: preset.id, design: { ...DEFAULT_EMAIL_DESIGN, footerText: '' }, ...brand }).html;
      expect(out, preset.name).toContain('<img src="https://cdn.example.org/logo.png" alt=""');
      expect(out, preset.name).toContain('Grace Community');
    }
  });

  it('Minimal is the exception on purpose: header none means no header, no logo, no name line', () => {
    const out = html('<p>Hi</p>', {
      themeId: 'minimal',
      design: { ...DEFAULT_EMAIL_DESIGN, footerText: '' },
      ...brand,
    }).html;
    expect(out).not.toContain('logo.png');
    expect(out).not.toContain('Grace Community'); // but the footer note still travels
    expect(out).toContain('Everyone is welcome this Sunday.');
  });
});

