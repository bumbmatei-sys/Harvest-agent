import { describe, expect, it } from 'vitest';

import {
  Home,
} from 'lucide-react';

import { SECTION_LANDING_TAB, groupsForSide, sectionForTab, sideForTab, tabsOpenedFrom, type ShellTabRef } from './shell-nav';

const ids = [
  'dashboard', 'social', 'newsletter', 'livestream', 'blog', 'forms', 'events', 'checkin', 'products', 'courses', 'ai',
  'crm', 'signups', 'churches', 'services', 'fundraising', 'donations', 'accounting', 'docs', 'community', 'branding', 'sms',
  'library', 'tenants', 'inbox', 'affiliate',
];
const tabs = new Map<string, ShellTabRef>(ids.map((id) => [id, { id, label: id, icon: Home }]));
const shape = (side: 'people' | 'public') => groupsForSide(side, tabs).map((g) => ({ label: g.label, items: g.items.map((i) => i.id) }));

describe('the sidebar, as the founder specified it', () => {
  it('Public: Channels (Social, Newsletter, Livestream, Blog), Engage (Forms, Events, Check-in), Products', () => {
    const groups = shape('public');
    expect(groups[0]).toEqual({ label: 'Channels', items: ['social', 'newsletter', 'livestream', 'blog', 'sms'] });
    expect(groups[1]).toEqual({ label: 'Engage', items: ['forms', 'events', 'checkin'] });
    expect(groups[2]).toEqual({ label: '', items: ['products'] });
  });

  it('Livestream moved into the community: no Channels row while the Communities page is there to open it', () => {
    const withCommunities = new Map(tabs);
    withCommunities.set('community-setup', { id: 'community-setup', label: 'Communities', icon: Home });
    const groups = groupsForSide('public', withCommunities).map((g) => ({ label: g.label, items: g.items.map((i) => i.id) }));
    expect(groups[0]).toEqual({ label: 'Channels', items: ['social', 'newsletter', 'blog', 'sms'] });
    expect(groups.flatMap((g) => g.items)).toContain('community-setup');
    // The Communities row reports what its page opens, so the nav still reaches it.
    expect(tabsOpenedFrom('community-setup', withCommunities)).toEqual([withCommunities.get('livestream')!.label]);
    const noStream = new Map(withCommunities);
    noStream.delete('livestream');
    expect(tabsOpenedFrom('community-setup', noStream)).toEqual([]);
    // An admin who may run the stream but not open Communities keeps the row (above).
    expect(shape('public')[0].items).toContain('livestream');
  });

  it('Livestream opens from Communities: its trail reads Communities > Livestream, linking back', () => {
    expect(sectionForTab('livestream')).toBe('Communities');
    expect(SECTION_LANDING_TAB.Communities).toBe('community-setup');
    expect(sideForTab('livestream')).toBe('public');
  });

  it('SMS is not a row while its tab is absent (it is hidden platform-wide)', () => {
    const without = new Map(tabs);
    without.delete('sms');
    const groups = groupsForSide('public', without).map((g) => g.items.map((i) => i.id));
    expect(groups[0]).toEqual(['social', 'newsletter', 'livestream', 'blog']);
  });

  it('People: People (CRM, Signups, Campuses, Services), Giving (Fundraising, Donations, Accounting), then Platform; Notes is not under Giving', () => {
    const groups = shape('people');
    expect(groups[0]).toEqual({ label: 'People', items: ['crm', 'signups', 'churches', 'services'] });
    expect(groups[1]).toEqual({ label: 'Giving', items: ['fundraising', 'donations', 'accounting'] });
    expect(groups[2].label).toBe('Platform');
    expect(groups.flatMap((g) => g.items)).not.toContain('docs');
  });

  it('Notes live in the Boards section, which the sidebar draws itself: its trail reads Boards > ...', () => {
    expect(sectionForTab('docs')).toBe('Boards');
    expect(sideForTab('docs')).toBe('people');
  });

  it('Community has no sidebar row on either side', () => {
    for (const side of ['people', 'public'] as const) {
      expect(shape(side).flatMap((g) => g.items)).not.toContain('community');
    }
  });

  it('Billing and Branding are not rows: they stay inside Settings', () => {
    for (const side of ['people', 'public'] as const) {
      const flat = shape(side).flatMap((g) => g.items);
      expect(flat).not.toContain('branding');
      expect(flat).not.toContain('upgrade');
      expect(flat).not.toContain('billing');
    }
  });

  it('Courses is not a row; it is opened from Products, and its trail reads Products > Courses', () => {
    for (const side of ['people', 'public'] as const) expect(shape(side).flatMap((g) => g.items)).not.toContain('courses');
    expect(sectionForTab('courses')).toBe('Products');
    expect(sideForTab('courses')).toBe('public');
    expect(SECTION_LANDING_TAB.Products).toBe('products');
  });

  it('Products is a single entry with no heading over it', () => {
    expect(sectionForTab('products')).toBeNull();
  });

  it('every row is reachable from exactly one side', () => {
    const all = [...shape('people'), ...shape('public')].flatMap((g) => g.items);
    expect(new Set(all).size).toBe(all.length);
  });
});
