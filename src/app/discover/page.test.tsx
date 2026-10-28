import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { matchAnalyticsRoute } from '@/lib/analytics/routes';

const mocks = vi.hoisted(() => ({ host: 'theharvest.app', get: vi.fn(), collection: vi.fn() }));
vi.mock('next/headers', () => ({ headers: () => ({ get: () => mocks.host }) }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, usePathname: () => '/discover' }));
vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: mocks.collection } }));
vi.mock('@/components/PublicRouteAnalytics', () => ({ default: () => null }));
import DiscoverPage, { metadata, revalidate } from './page';

const listing = { tenantId: 'grace', slug: 'grace', name: 'Grace Community', logoUrl: '', shortDescription: 'Welcome together', memberCount: 42, privateEmail: 'secret@example.test' };

describe('public discover page', () => {
  beforeEach(() => {
    mocks.host = 'theharvest.app';
    mocks.get.mockReset().mockResolvedValue({ docs: [{ data: () => listing }] });
    mocks.collection.mockReset().mockReturnValue({ get: mocks.get });
  });
  it.each(['theharvest.app', 'www.theharvest.app', 'app.theharvest.app:443'])('serves %s with public listing data', async host => {
    mocks.host = host;
    const html = renderToStaticMarkup(await DiscoverPage());
    expect(mocks.collection).toHaveBeenCalledWith('discovery_listings');
    expect(html).toContain('Grace Community');
    expect(html).toContain('Welcome together');
    expect(html).toContain('42');
    expect(html).toContain('Free');
    expect(html).not.toContain('secret@example.test');
    expect(metadata.title).toContain('Discover');
    expect(revalidate).toBe(0);
  });
  it.each(['grace.theharvest.app', 'discover.theharvest.app', 'eviltheharvest.app', 'other.example'])('rejects %s before reading', async host => {
    mocks.host = host;
    await expect(DiscoverPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.collection).not.toHaveBeenCalled();
  });
  it('shows a failure instead of an empty list when the index read fails', async () => {
    mocks.get.mockRejectedValue(new Error('unavailable'));
    expect(renderToStaticMarkup(await DiscoverPage())).toContain('Could not load communities');
  });
  it('rejects unsafe listings instead of rendering an unsafe link', async () => {
    mocks.get.mockResolvedValue({ docs: [{ data: () => ({ ...listing, slug: 'www' }) }] });
    expect(renderToStaticMarkup(await DiscoverPage())).toContain('Could not load communities');
  });
  it('registers the public route', () => {
    expect(matchAnalyticsRoute('/discover')).toMatchObject({ entry: 'next-page', surface: 'public', public: true });
  });
});
