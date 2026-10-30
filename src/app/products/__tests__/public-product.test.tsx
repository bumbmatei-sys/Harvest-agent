import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const state = vi.hoisted(() => ({ status: 'published', failed: false, tenant: 'a', productTenant: 'a', subdomain: 'grace' as string | undefined, host: 'a' as string | null }));
vi.mock('next/headers', () => ({ headers: () => new Headers({ host: 'grace.theharvest.app' }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/products/download', notFound: () => { throw new Error('Not found'); } }));
vi.mock('@/lib/server-tenant', () => ({ getTenantFromHostOrId: async (_host: string, idHint?: string) => (state.host ? { id: state.tenant, name: 'Grace' } : (idHint ? { id: idHint, name: 'Grace' } : null)) }));
vi.mock('@/lib/firebase-admin', () => {
  const collection = (path: string): any => ({ doc: (id: string) => ({
    collection: (name: string) => collection(`${path}/${id}/${name}`),
    get: async () => {
      if (state.failed) throw new Error('Read unavailable');
      if (path === 'tenants') return { exists: true, data: () => ({ subdomain: state.subdomain }) };
      return { exists: path === `tenants/${state.productTenant}/digitalProducts`, data: () => ({ title: 'Welcome download', description: 'Read together', coverUrl: '', status: state.status, objectKey: 'secret-file-key', entitlements: ['private-user'] }) };
    },
  }) });
  return { adminDb: { collection } };
});
import PublicDigitalProduct from '../[id]/page';
beforeEach(() => { state.status = 'published'; state.failed = false; state.tenant = 'a'; state.productTenant = 'a'; state.subdomain = 'grace'; state.host = 'a'; });
it('renders only published metadata and links into the existing ministry', async () => {
  const html = renderToStaticMarkup(await PublicDigitalProduct({ params: { id: 'download' }, searchParams: {} }));
  expect(html).toContain('Welcome download');
  expect(html).toContain('Read together');
  expect(html).toContain('https://grace.theharvest.app');
  expect(html).not.toContain('secret-file-key');
  expect(html).not.toContain('private-user');
});
it('rejects unpublished or cross-tenant products and propagates read failures', async () => {
  state.status = 'draft';
  await expect(PublicDigitalProduct({ params: { id: 'download' }, searchParams: {} })).rejects.toThrow('Not found');
  state.status = 'published'; state.tenant = 'b';
  await expect(PublicDigitalProduct({ params: { id: 'download' }, searchParams: {} })).rejects.toThrow('Not found');
  state.failed = true;
  await expect(PublicDigitalProduct({ params: { id: 'download' }, searchParams: {} })).rejects.toThrow('Read unavailable');
});
it('falls back to the ?t= tenant id and a theharvest.app link when the host resolves nobody (a hostless tenant)', async () => {
  state.host = null; state.productTenant = 'free-1'; state.subdomain = undefined;
  const html = renderToStaticMarkup(await PublicDigitalProduct({ params: { id: 'download' }, searchParams: { t: 'free-1' } }));
  expect(html).toContain('Welcome download');
  expect(html).toContain('https://theharvest.app');
  expect(html).not.toContain('undefined.theharvest.app');
});
