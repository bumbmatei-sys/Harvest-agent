import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHeaders = vi.fn();
const mockGetTenantFromHost = vi.fn();

vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}));

vi.mock('@/lib/server-tenant', () => ({
  getTenantFromHost: (host: string) => mockGetTenantFromHost(host),
}));

// Dynamic import so the mocks above are registered first.
const { GET } = await import('@/app/manifest.webmanifest/route');

function setHost(host: string) {
  mockHeaders.mockReturnValue({ get: (k: string) => (k === 'host' ? host : null) });
}

async function getManifest() {
  const res = await GET();
  return { res, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /manifest.webmanifest', () => {
  it('always sends the manifest content-type and never caches', async () => {
    setHost('theharvest.app');
    mockGetTenantFromHost.mockResolvedValue(null);
    const { res } = await getManifest();
    expect(res.headers.get('content-type')).toBe('application/manifest+json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.status).toBe(200);
  });

  it('returns the Harvest fallback for the root/unknown host (no tenant)', async () => {
    setHost('theharvest.app');
    mockGetTenantFromHost.mockResolvedValue(null);
    const { body } = await getManifest();
    expect(body.name).toBe('Harvest App');
    expect(body.short_name).toBe('Harvest');
    expect(body.theme_color).toBe('#C9963A');
    expect(body.icons.some((i: any) => i.src === '/icons/icon-192x192.png')).toBe(true);
  });

  it('returns the Harvest fallback for the platform tenant', async () => {
    setHost('harvest.theharvest.app');
    mockGetTenantFromHost.mockResolvedValue({
      id: 'harvest',
      name: 'Harvest',
      config: { logo: 'https://cdn.example.com/harvest.png' },
    });
    const { body } = await getManifest();
    expect(body.name).toBe('Harvest App');
    expect(body.icons[0].src).toBe('/icons/icon-48x48.png');
  });

  it('returns tenant name, short_name, brand color and logo icons for a white-label tenant', async () => {
    setHost('bumb.theharvest.app');
    mockGetTenantFromHost.mockResolvedValue({
      id: 'bumb',
      name: 'bumb',
      config: { logo: 'https://cdn.example.com/logo.png', primaryColor: '#123456' },
    });
    const { body } = await getManifest();
    expect(body.name).toBe('bumb');
    expect(body.short_name).toBe('bumb');
    expect(body.theme_color).toBe('#123456');
    expect(body.display).toBe('standalone');
    expect(body.icons).toHaveLength(2);
    expect(body.icons.every((i: any) => i.src === 'https://cdn.example.com/logo.png')).toBe(true);
    expect(body.icons.map((i: any) => i.sizes)).toEqual(['192x192', '512x512']);
    expect(body.icons.every((i: any) => i.type === 'image/png')).toBe(true);
    expect(body.icons.every((i: any) => JSON.stringify(i.purpose) === JSON.stringify(['any', 'maskable']))).toBe(true);
  });

  it('falls back to the default theme color when the tenant has no brand color', async () => {
    setHost('bumb.theharvest.app');
    mockGetTenantFromHost.mockResolvedValue({
      id: 'bumb',
      name: 'bumb',
      config: { logo: 'https://cdn.example.com/logo.png' },
    });
    const { body } = await getManifest();
    expect(body.theme_color).toBe('#C9963A');
  });

  it('truncates a very long name for short_name but keeps the full name', async () => {
    setHost('long.theharvest.app');
    mockGetTenantFromHost.mockResolvedValue({
      id: 'long',
      name: 'Grace Community Fellowship Church',
      config: { logo: 'https://cdn.example.com/logo.png' },
    });
    const { body } = await getManifest();
    expect(body.name).toBe('Grace Community Fellowship Church');
    expect(body.short_name).toBe('Grace Commun');
    expect(body.short_name.length).toBeLessThanOrEqual(12);
  });

  it('uses the tenant name but keeps Harvest icons when the tenant has no logo', async () => {
    setHost('nologo.theharvest.app');
    mockGetTenantFromHost.mockResolvedValue({
      id: 'nologo',
      name: 'No Logo Ministry',
      config: {},
    });
    const { body } = await getManifest();
    expect(body.name).toBe('No Logo Ministry');
    expect(body.icons.some((i: any) => i.src === '/icons/icon-512x512.png')).toBe(true);
  });

  it('omits the icon type when the logo URL has no recognizable extension', async () => {
    setHost('extless.theharvest.app');
    mockGetTenantFromHost.mockResolvedValue({
      id: 'extless',
      name: 'Ext Less',
      config: { logo: 'https://firebasestorage.googleapis.com/v0/b/x/o/logo?alt=media&token=abc' },
    });
    const { body } = await getManifest();
    expect(body.icons.every((i: any) => !('type' in i))).toBe(true);
  });

  it('detects webp logos', async () => {
    setHost('webp.theharvest.app');
    mockGetTenantFromHost.mockResolvedValue({
      id: 'webp',
      name: 'Webp',
      config: { logo: 'https://cdn.example.com/logo.webp?v=2' },
    });
    const { body } = await getManifest();
    expect(body.icons.every((i: any) => i.type === 'image/webp')).toBe(true);
  });
});
