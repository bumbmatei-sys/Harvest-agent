import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('has no Back button and no "Open member app" button', async () => {
    await mount(<AdminContentBar crumbs={[{ label: 'Products', onClick: () => {} }, { label: 'Courses' }]} />);
    const labels = [...host.querySelectorAll('button')].map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim());
    expect(labels).not.toContain('Back');
    expect(host.textContent).not.toContain('Open member app');
  });
});

describe('the Community menu', () => {
  const open = async () => {
    const trigger = host.querySelector<HTMLElement>('[data-community-menu]')!;
    await act(async () => { trigger.click(); });
  };
  const menuItems = () => [...document.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent?.trim());

  it('lists the current communities and ends with "Create new community"', async () => {
    const onOpen = vi.fn();
    const onCreate = vi.fn();
    await mount(<CommunityMenu items={[{ id: 'a', name: 'Young adults' }, { id: 'b', name: 'Prayer team' }]} loaded onOpen={onOpen} onCreate={onCreate} />);
    await open();
    expect(menuItems()).toEqual(['Young adults', 'Prayer team', 'Create new community']);
    await act(async () => { (document.querySelectorAll('[role="menuitem"]')[1] as HTMLElement).click(); });
    expect(onOpen).toHaveBeenCalledWith('b');
  });

  it('"Create new community" is the last item and runs onCreate', async () => {
    const onCreate = vi.fn();
    await mount(<CommunityMenu items={[{ id: 'a', name: 'Young adults' }]} loaded onOpen={() => {}} onCreate={onCreate} />);
    await open();
    const items = [...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[];
    expect(items.at(-1)?.textContent).toContain('Create new community');
    await act(async () => { items.at(-1)!.click(); });
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('says "No communities yet" only once the list has loaded, and "Loading" before', async () => {
    await mount(<CommunityMenu items={[]} loaded={false} onOpen={() => {}} onCreate={() => {}} />);
    await open();
    expect(document.body.textContent).toContain('Loading communities');
    expect(document.body.textContent).not.toContain('No communities yet');
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount(<CommunityMenu items={[]} loaded onOpen={() => {}} onCreate={() => {}} />);
    await open();
    expect(document.body.textContent).toContain('No communities yet');
  });

  it('shows a failed read as a failure, not as an empty list, and still offers Create', async () => {
    await mount(<CommunityMenu items={[]} loaded error="Communities could not be loaded." onOpen={() => {}} onCreate={() => {}} />);
    await open();
    expect(document.body.textContent).toContain('Communities could not be loaded.');
    expect(document.body.textContent).not.toContain('No communities yet');
    expect(menuItems()).toContain('Create new community');
  });

  it('the bar mounts the menu in place of the old member-app button', async () => {
    await mount(<AdminContentBar crumbs={[{ label: 'Home' }]} community={<CommunityMenu items={[]} loaded onOpen={() => {}} onCreate={() => {}} />} />);
    expect(host.querySelector('[data-community-menu]')?.textContent).toContain('Community');
    expect(host.textContent).not.toContain('Open member app');
  });
});
