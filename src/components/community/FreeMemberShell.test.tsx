import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getPlanFeatures } from '@/utils/plan-features';
import { FreeMemberShell } from './FreeMemberShell';

vi.mock('./DiscoveryData', () => ({ DiscoverData: () => <div>Discovery</div>, CommunitiesData: () => <div>Your communities</div> }));
vi.mock('@/components/AdminUpgradePage', () => ({ default: () => <div>Upgrade flow</div> }));
vi.mock('@/components/signup-pages/SignupPagesScreen', () => ({ SignupPagesScreen: () => <div>Sign-up pages screen</div> }));

let root: Root; let host: HTMLDivElement;
function mount(element: React.ReactElement) { host = document.createElement('div'); document.body.appendChild(host); act(() => { root = createRoot(host); root.render(element); }); }
function click(button: Element | null) { if (!button) throw new Error('Button missing'); act(() => (button as HTMLButtonElement).click()); }
afterEach(() => { act(() => root?.unmount()); host?.remove(); });
describe('#557 member shell', () => {
  it('offers the exact three tabs on both navigation surfaces and opens sign-ups', () => {
    mount(<FreeMemberShell canCreateCommunity={false} />);
    for (const name of ['Desktop navigation', 'Mobile navigation']) {
      const nav = host.querySelector(`nav[aria-label="${name}"]`)!;
      expect(Array.from(nav.querySelectorAll('button')).map(button => button.getAttribute('aria-label') || button.textContent)).toEqual(['Discover', 'Communities', 'Sign-ups']);
    }
    click(host.querySelector('nav[aria-label="Mobile navigation"] button[aria-label="Sign-ups"]'));
    expect(host.textContent).toContain('Sign-up pages screen');
  });
  it('shows the upgrade action for Free and opens the existing flow', async () => {
    mount(<FreeMemberShell canCreateCommunity={getPlanFeatures('free').createCommunity} />);
    click(Array.from(host.querySelectorAll('nav[aria-label="Desktop navigation"] button')).find(b => b.textContent === 'Communities') || null);
    expect(host.textContent).toContain('Creating a community needs the Church or Ministry plan.');
    click(Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Upgrade plan') || null);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(host.textContent).toContain('Upgrade flow');
  });
  it.each(['church', 'ministry'] as const)('does not show the prompt when %s can create communities', plan => {
    mount(<FreeMemberShell canCreateCommunity={getPlanFeatures(plan).createCommunity} initialTab="communities" />);
    expect(host.textContent).not.toContain('Creating a community needs the Church or Ministry plan.');
  });
  it('keeps dashboard and creation entitlements on paid plans', () => {
    expect(getPlanFeatures('free')).toMatchObject({ adminDashboard: false, createCommunity: false });
    for (const plan of ['church', 'ministry'] as const) expect(getPlanFeatures(plan)).toMatchObject({ adminDashboard: true, createCommunity: true, signups: true });
  });
});
