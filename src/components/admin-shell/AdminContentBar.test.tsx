import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { AdminContentBar, CommunityMenu } from './AdminContentBar';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });

const mount = (ui: React.ReactElement) => act(async () => { root.render(ui); });
const crumbButtons = () => [...host.querySelectorAll<HTMLElement>('nav[aria-label="breadcrumb"] button')];

describe('the top bar breadcrumb', () => {
  it('makes every parent a link and the last step the current page', async () => {
    const products = vi.fn();
    const courses = vi.fn();
    await mount(<AdminContentBar crumbs={[{ label: 'Products', onClick: products }, { label: 'Courses', onClick: courses }, { label: 'Walking with Jesus' }]} />);
    expect(crumbButtons().map((b) => b.textContent)).toEqual(['Products', 'Courses']);
    const current = host.querySelector('[aria-current="page"]');
    expect(current?.textContent).toBe('Walking with Jesus');
    await act(async () => { crumbButtons()[1].click(); });
    expect(courses).toHaveBeenCalledTimes(1);
    expect(products).not.toHaveBeenCalled();
    await act(async () => { crumbButtons()[0].click(); });
    expect(products).toHaveBeenCalledTimes(1);
  });

  it('a step with no page of its own is a label, not a dead link', async () => {
    await mount(<AdminContentBar crumbs={[{ label: 'Channels' }, { label: 'Newsletter' }]} />);
    expect(crumbButtons()).toHaveLength(0);
    expect(host.textContent).toContain('Channels');
  });

  it('has no Back button: the trail is the way back', async () => {
    await mount(<AdminContentBar crumbs={[{ label: 'Products', onClick: () => {} }, { label: 'Courses' }]} />);
    const labels = [...host.querySelectorAll('button')].map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim());
    expect(labels).not.toContain('Back');
  });
});

describe('the Community menu', () => {
  const open = async () => {
    const trigger = host.querySelector<HTMLElement>('[data-community-menu]')!;
    await act(async () => { trigger.click(); });
  };
  const menuItems = () => [...document.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent?.trim());

  it('lists the one default community, then a "Create new community" row that is not available yet', async () => {
    await mount(<CommunityMenu onOpenDefault={() => {}} />);
    await open();
    expect(menuItems()).toEqual(['Default community', 'Create new communitySoon']);
    const create = document.querySelector<HTMLElement>('[data-community-create]')!;
    expect(create.hasAttribute('data-disabled') || create.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('choosing the default community opens the member app', async () => {
    const onOpenDefault = vi.fn();
    await mount(<CommunityMenu onOpenDefault={onOpenDefault} />);
    await open();
    await act(async () => { document.querySelector<HTMLElement>('[data-community-default]')!.click(); });
    expect(onOpenDefault).toHaveBeenCalledTimes(1);
  });

  it('🔴 the trigger is a native button, not `render={<Button />}`: a function component there leaves the menu invisible', () => {
    const source = readFileSync(path.join(__dirname, 'AdminContentBar.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const trigger = source.slice(source.indexOf('<DropdownMenuTrigger'), source.indexOf('</DropdownMenuTrigger>'));
    expect(trigger).toContain('buttonVariants(');
    expect(trigger).not.toContain('render=');
  });

  it('the bar mounts the menu on the right, beside search', async () => {
    await mount(<AdminContentBar crumbs={[{ label: 'Home' }]} community={<CommunityMenu onOpenDefault={() => {}} />} />);
    expect(host.querySelector('[data-community-menu]')?.textContent).toContain('Community');
    expect(host.querySelector('[data-admin-search-pill]')).toBeTruthy();
  });
});
