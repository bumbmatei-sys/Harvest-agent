import { describe, expect, it } from 'vitest';

import { DEFAULT_EMAIL_DESIGN, readHexColor, type EmailDesign } from '@/lib/email/design';
import { accentHex, inkOn, renderEmail } from '@/lib/email/render';

const base = {
  bodyHtml: '<p>Hello</p><p><a href="https://x.org" data-button="true">Give</a></p>',
  preheader: '',
  churchName: 'Grace',
  mailingAddress: '1 Main St',
  unsubscribeUrl: 'https://x.org/u',
  firstName: 'Ana',
  senderName: 'Grace',
};
const html = (design: Partial<EmailDesign>, dark = false) => renderEmail({ ...base, design: { ...DEFAULT_EMAIL_DESIGN, ...design }, dark } as never).html;

describe('email accent colours', () => {
  it('navy is Harvest navy, gold is Harvest gold', () => {
    expect(accentHex({ accent: 'navy' })).toBe('#0C1526');
    expect(accentHex({ accent: 'gold' })).toBe('#C9963A');
    expect(html({ accent: 'gold' })).toContain('background:#C9963A');
  });

  it('custom draws in the colour the design carries', () => {
    expect(accentHex({ accent: 'custom', customColor: '#2E7D32' })).toBe('#2E7D32');
    expect(html({ accent: 'custom', customColor: '#2E7D32' })).toContain('background:#2E7D32');
  });

  it('custom with a missing or hostile colour falls back to gold and never writes it into a style', () => {
    for (const customColor of [undefined, '', 'red', 'url(javascript:alert(1))', '#12', '#12345g', '#2E7D32;position:fixed']) {
      expect(accentHex({ accent: 'custom', customColor })).toBe('#C9963A');
    }
    expect(html({ accent: 'custom', customColor: '#2E7D32;position:fixed' })).not.toContain('position:fixed');
  });

  it('an older design that says harbor still renders, as navy, and never as "undefined"', () => {
    const legacy = { accent: 'harbor' } as unknown as Partial<EmailDesign>;
    expect(accentHex(legacy as EmailDesign)).toBe('#0C1526');
    expect(html(legacy)).not.toContain('undefined');
  });

  it('puts readable ink on a filled button: white on dark, near-black on a pale custom colour', () => {
    expect(inkOn('#0C1526')).toBe('#ffffff');
    expect(inkOn('#FFF3B0')).toBe('#1A1A1A');
    expect(html({ accent: 'custom', customColor: '#FFF3B0' })).toContain('color:#1A1A1A');
  });

  it('reads only six-digit hex', () => {
    expect(readHexColor('#abcdef')).toBe('#abcdef');
    expect(readHexColor(' #ABCDEF ')).toBe('#ABCDEF');
    for (const bad of ['#abc', 'abcdef', null, undefined, 12, '#abcdeg']) expect(readHexColor(bad)).toBeNull();
  });
});
