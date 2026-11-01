import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { hasLogo, LOGO_TITLES, PlatformLogo, PlatformLogos } from './PlatformLogo';
import { SOCIAL_PLATFORMS } from '@/lib/social/platforms';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
afterEach(async () => { await act(async () => root.render(null)); });

describe('network logos (#581)', () => {
  it('has a logo for every network the scheduler offers, and for the blog platforms', () => {
    for (const platform of [...SOCIAL_PLATFORMS, 'wordpress', 'wix']) expect(hasLogo(platform), platform).toBe(true);
    expect(hasLogo('myspace')).toBe(false);
  });
  it('names the logo for screen readers, or hides it when the name is already written beside it', async () => {
    await act(async () => root.render(<><PlatformLogo platform="tiktok" /><PlatformLogo platform="threads" decorative /></>));
    const [named, decorative] = [...host.querySelectorAll('svg')];
    expect(named.getAttribute('role')).toBe('img');
    expect(named.getAttribute('aria-label')).toBe('TikTok');
    expect(named.querySelector('title')?.textContent).toBe('TikTok');
    expect(named.getAttribute('fill')).toBe('currentColor');
    expect(decorative.getAttribute('aria-hidden')).toBe('true');
    expect(decorative.querySelector('title')).toBeNull();
    expect(LOGO_TITLES.youtube).toBe('YouTube');
  });
  it('draws a row of logos and skips a network it has no logo for', async () => {
    await act(async () => root.render(<PlatformLogos platforms={['instagram', 'myspace', 'facebook']} />));
    expect([...host.querySelectorAll('[data-platform-logo]')].map((n) => n.getAttribute('data-platform-logo'))).toEqual(['instagram', 'facebook']);
  });
});
