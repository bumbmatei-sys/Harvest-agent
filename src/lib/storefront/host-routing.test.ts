import { describe, expect, it } from 'vitest';
import { ministrySubdomain, routeForHost } from './host-routing';

describe('what a ministry subdomain serves (the hard switch)', () => {
  it('knows a ministry subdomain from theharvest.app, platform aliases and other hosts', () => {
    expect(ministrySubdomain('grace.theharvest.app')).toBe('grace');
    expect(ministrySubdomain('Grace.theharvest.app:443')).toBe('grace');
    for (const host of ['theharvest.app', 'www.theharvest.app', 'app.theharvest.app', 'admin.theharvest.app', 'affiliate.theharvest.app', 'a.b.theharvest.app', 'harvest-agent.vercel.app', 'localhost:3000']) {
      expect(ministrySubdomain(host), host).toBeNull();
    }
  });

  it('serves the Storefront at the root and its View all page at /blog', () => {
    expect(routeForHost('grace.theharvest.app', '/')).toEqual({ action: 'rewrite', to: '/storefront' });
    expect(routeForHost('grace.theharvest.app', '/blog')).toEqual({ action: 'rewrite', to: '/storefront/blog' });
  });

  it('lets the public pages through', () => {
    for (const path of ['/blog/abc', '/event/e1', '/form/f1', '/giving', '/calendar', '/calendar/ical', '/courses/c1', '/pledge/x', '/post/p', '/checkin/s', '/rota/t', '/n/t', '/s/handle', '/subscribe', '/p', '/p/rss.xml', '/api/forms/get', '/storefront', '/manifest.webmanifest', '/logo.png']) {
      expect(routeForHost('grace.theharvest.app', path), path).toEqual({ action: 'next' });
    }
  });

  it('no longer serves the app there: admin and member paths land on the Storefront', () => {
    for (const path of ['/admin', '/admin/crm', '/community/grace/youth', '/settings', '/plain', '/postx']) {
      expect(routeForHost('grace.theharvest.app', path), path).toEqual({ action: 'rewrite', to: '/storefront' });
    }
  });

  it('leaves theharvest.app, where the app now lives, untouched', () => {
    for (const path of ['/', '/admin', '/blog', '/community/grace/youth']) {
      expect(routeForHost('theharvest.app', path)).toEqual({ action: 'next' });
    }
  });
});
