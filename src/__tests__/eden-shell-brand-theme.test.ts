import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { applyTheme } from '../lib/theme-runtime';
import { BRAND_THEME, BRAND_THEMES } from '../lib/theme';

const ROOT = path.resolve(__dirname, '../..');
const globals = readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8');
const code = (file: string) =>
  readFileSync(path.join(ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

describe('Harvest is the only brand theme', () => {
  it('names harvest on :root and points the action button at the brand', () => {
    expect(BRAND_THEME).toBe('harvest');
    expect([...BRAND_THEMES]).toEqual(['harvest']);
    expect(globals).toMatch(/--brand-theme:\s*harvest\s*;/);
    expect(globals).toMatch(/--action:\s*var\(--brand-color\)\s*;/);
    expect(globals).toMatch(/--action:\s*var\(--brand-color-on-dark,\s*var\(--brand-color\)\)\s*;/);
    expect(globals).not.toMatch(/--action:\s*#0A0A0A/i);
    expect(globals).not.toMatch(/--action:\s*#F2F2F2/i);
  });

  it('does not add a third custom-property scope or revive the palette family', () => {
    expect(code('src/app/globals.css')).not.toContain('data-palette');
    expect(code('src/lib/theme-runtime.ts')).not.toContain('data-palette');
    expect(code('src/lib/theme.ts')).not.toContain('harvest-theme-family');
    // Comments may name the future hook. A real selector would survive
    // comment stripping and fail here.
    expect(code('src/app/globals.css')).not.toMatch(/\[data-brand-theme/);
  });

  it('stamps data-brand-theme from the one-argument applier', () => {
    expect(applyTheme.length).toBe(1);
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-brand-theme')).toBe('harvest');
    expect(document.documentElement.getAttribute('data-palette')).toBeNull();
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-brand-theme')).toBe('harvest');
  });

  it('the social composer uses the action token, not the foreground workaround', () => {
    const social = code('src/components/admin/social/SocialScheduler.tsx');
    expect(social).toContain('bg-action text-action-foreground hover:bg-action-hover');
    expect(social).not.toContain('bg-foreground text-background');
  });
});
