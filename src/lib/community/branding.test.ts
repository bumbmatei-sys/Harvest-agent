import { describe, expect, it } from 'vitest';
import { communityBrandStyle, contrastRatio, darkBrandColor, isCommunityBrandColor, readableForeground } from './branding';

describe('community branding', () => {
  it('accepts only six digit hex colours', () => {
    expect(isCommunityBrandColor('#aB12ef')).toBe(true);
    for (const value of ['red', '#fff', '#12345678', '', null]) expect(isCommunityBrandColor(value)).toBe(false);
  });
  it('calculates WCAG contrast and chooses readable button text', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21);
    expect(readableForeground('#000000')).toBe('#FFFFFF');
    expect(readableForeground('#FFFFFF')).toBe('#000000');
    expect(contrastRatio(darkBrandColor('#000000'), '#202020')).toBeGreaterThanOrEqual(3);
  });
  it('maps the light and dark variants to scoped variables', () => {
    const style = communityBrandStyle('#000000') as Record<string, string>;
    expect(style['--community-brand-light']).toBe('#000000');
    expect(style['--community-foreground-light']).toBe('#FFFFFF');
    expect(contrastRatio(style['--community-brand-dark'], '#202020')).toBeGreaterThanOrEqual(3);
    expect(style['--community-foreground-dark']).toBe(readableForeground(style['--community-brand-dark']));
  });
});
