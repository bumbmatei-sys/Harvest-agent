import { headers } from 'next/headers';
import { getTenantFromHost } from '@/lib/server-tenant';

// This route reads the Host header to resolve the tenant, so it must never be
// statically rendered or precached — each tenant subdomain gets its own manifest.
export const dynamic = 'force-dynamic';

const PLATFORM_TENANT_ID = process.env.NEXT_PUBLIC_PLATFORM_TENANT_ID || 'harvest';
const DEFAULT_THEME_COLOR = '#C9963A';
// Recommended max length for the home-screen label (short_name).
const SHORT_NAME_MAX = 12;

/**
 * The default Harvest manifest, mirroring public/manifest.json. Served for the
 * root domain, www, unknown hosts, and the platform tenant.
 */
const HARVEST_MANIFEST = {
  id: '/',
  name: 'Harvest App',
  short_name: 'Harvest',
  description: 'Harvest Course Experience — empowering ministries with digital tools',
  start_url: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#ffffff',
  theme_color: DEFAULT_THEME_COLOR,
  categories: ['education', 'social'],
  icons: [
    { src: '/icons/icon-48x48.png', sizes: '48x48', type: 'image/png' },
    { src: '/icons/icon-72x72.png', sizes: '72x72', type: 'image/png' },
    { src: '/icons/icon-96x96.png', sizes: '96x96', type: 'image/png' },
    { src: '/icons/icon-144x144.png', sizes: '144x144', type: 'image/png' },
    { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: ['any', 'maskable'] },
    { src: '/icons/icon-384x384.png', sizes: '384x384', type: 'image/png' },
    { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: ['any', 'maskable'] },
  ],
};

/** Best-effort MIME type from a logo URL's file extension (query string stripped). */
function iconTypeFromUrl(url: string): string | undefined {
  const path = url.split('?')[0].split('#')[0].toLowerCase();
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.gif')) return 'image/gif';
  return undefined;
}

/**
 * Build manifest icons pointing at the tenant's uploaded logo. The square-icon
 * uploader letterboxes onto a square canvas client-side, so declaring it at
 * the install sizes below doesn't stretch it. `purpose: 'any'` (no
 * 'maskable') because we can't guarantee the ~20% safe-zone padding OS
 * maskable cropping expects — 'any' renders it as-is, uncropped.
 */
function buildTenantIcons(logoUrl: string) {
  const type = iconTypeFromUrl(logoUrl);
  const base = type ? { src: logoUrl, type } : { src: logoUrl };
  return [
    { ...base, sizes: '192x192', purpose: 'any' },
    { ...base, sizes: '512x512', purpose: 'any' },
  ];
}

export async function GET() {
  const headersList = await headers();
  const host = headersList.get('host') || '';
  const tenant = await getTenantFromHost(host);

  const isWhiteLabel = !!tenant && tenant.id !== PLATFORM_TENANT_ID;
  // Prefer a dedicated square icon (best fit for the install/home-screen slot);
  // fall back to the logo, which is often a rectangular wordmark.
  const iconSource = tenant?.config?.squareIcon || tenant?.config?.logo;

  let manifest: Record<string, unknown>;

  if (isWhiteLabel && (tenant!.name || iconSource)) {
    const name = tenant!.name || HARVEST_MANIFEST.name;
    const shortName = name.length > SHORT_NAME_MAX ? name.slice(0, SHORT_NAME_MAX).trim() : name;
    manifest = {
      id: '/',
      name,
      short_name: shortName,
      description: tenant!.config?.description || HARVEST_MANIFEST.description,
      start_url: '/',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#ffffff',
      theme_color: tenant!.config?.primaryColor || DEFAULT_THEME_COLOR,
      categories: HARVEST_MANIFEST.categories,
      icons: iconSource ? buildTenantIcons(iconSource) : HARVEST_MANIFEST.icons,
    };
  } else {
    manifest = HARVEST_MANIFEST;
  }

  return new Response(JSON.stringify(manifest), {
    status: 200,
    headers: {
      'Content-Type': 'application/manifest+json',
      // CRITICAL: never cache — tenants share this route path but must each get
      // their OWN manifest (and a re-branded tenant must not see a stale one).
      'Cache-Control': 'no-store',
    },
  });
}
