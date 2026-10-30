import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const state = vi.hoisted(() => ({ docs: {} as Record<string, any> }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('Not found'); } }));
vi.mock('@/components/PublicRouteAnalytics', () => ({ default: () => null }));
vi.mock('@/lib/firebase-admin', () => {
  const collection = (path: string): any => ({
    doc: (id: string) => ({
      collection: (name: string) => collection(`${path}/${id}/${name}`),
      get: async () => ({ exists: !!state.docs[`${path}/${id}`], data: () => state.docs[`${path}/${id}`] }),
    }),
    where: () => ({ count: () => ({ get: async () => ({ data: () => ({ count: 3 }) }) }) }),
  });
  return { adminDb: { collection } };
});

import PublicCommunityPage from '../page';

beforeEach(() => {
  state.docs = {
    'discovery_listings/free-1': undefined,
    'tenants/free-1/settings/community': { isPublic: true, shortDescription: 'Welcome!' },
    'tenants/free-1': { name: 'Free Church' },
  };
});

it('renders a hostless community with a theharvest.app join link', async () => {
  const html = renderToStaticMarkup(await PublicCommunityPage({ params: { tenantId: 'free-1' } }));
  expect(html).toContain('Free Church');
  expect(html).toContain('Welcome!');
  expect(html).toContain('https://theharvest.app');
});

it('404s when the community is not public', async () => {
  state.docs['tenants/free-1/settings/community'] = { isPublic: false };
  await expect(PublicCommunityPage({ params: { tenantId: 'free-1' } })).rejects.toThrow('Not found');
});

it('404s on a malformed tenant id', async () => {
  await expect(PublicCommunityPage({ params: { tenantId: '../etc' } })).rejects.toThrow('Not found');
});
