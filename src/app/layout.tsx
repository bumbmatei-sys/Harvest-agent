import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import Script from 'next/script';
import { Inter, Fraunces, Newsreader } from 'next/font/google';
import './globals.css';
import { cn } from "@/lib/utils";
import { getTenantFromHost } from '@/lib/server-tenant';
import ReferralTracker from '@/components/ReferralTracker';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
});

// Serif display face for headings — matches the marketing site.
// 300 (Light) carries the editorial display/hero look per the brand system;
// 600/700 are used for section + card titles.
const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});

// Reading serif — loaded now for a later phase (Bible/reading screens); not yet applied.
const newsreader = Newsreader({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-serif',
  display: 'swap',
});

const PLATFORM_TENANT_ID = process.env.NEXT_PUBLIC_PLATFORM_TENANT_ID || 'harvest';

// A tenant primaryColor is only trusted for injection when it's a plain 6-digit
// hex. Anything else (empty, shorthand, rgb(), or malformed) is ignored so the
// CSS default (Harvest gold) stands and nothing unvalidated is ever interpolated
// into the inline <style> — no injection surface.
const isValidHex = (value: string | undefined): value is string =>
  !!value && /^#[0-9a-fA-F]{6}$/.test(value);

export const viewport: Viewport = {
  themeColor: '#C9963A',
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
};

// Per-tenant metadata: white-label subdomains get THEIR name + logo on the
// install prompt / home-screen icon (Android via the manifest; iOS via
// apple-touch-icon, which ignores the manifest). Root/platform/unknown hosts
// fall back to Harvest branding.
export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers();
  const host = headersList.get('host') || '';
  const tenant = await getTenantFromHost(host);

  const isWhiteLabel = !!tenant && tenant.id !== PLATFORM_TENANT_ID;
  const logo = tenant?.config?.logo;
  const name = isWhiteLabel && tenant!.name ? tenant!.name : 'Harvest';

  return {
    title: name,
    description: 'Harvest App',
    manifest: '/manifest.webmanifest',
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: name,
    },
    icons: {
      // Apple devices use apple-touch-icon (not the manifest) for
      // "Add to Home Screen", so point it at the tenant logo when available.
      icon: isWhiteLabel && logo ? logo : '/icons/icon-96x96.png',
      apple: isWhiteLabel && logo ? logo : '/icons/icon-192x192.png',
    },
  };
}

// RootLayout is async so it can resolve the tenant server-side (same pattern as
// generateMetadata above) and brand the VERY FIRST paint. Without this, the SPA
// (ssr:false) paints Harvest defaults — gold spinner + Harvest logo — until the
// client-side branding fetch resolves, so a white-label tenant's users see a
// Harvest flash on every load/refresh. getTenantFromHost is deduped within a
// request, so the second call here is cheap.
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headersList = await headers();
  const host = headersList.get('host') || '';
  const tenant = await getTenantFromHost(host);

  const isWhiteLabel = !!tenant && tenant.id !== PLATFORM_TENANT_ID;
  // Only white-label tenants override the defaults; apex/platform/unknown hosts
  // (isWhiteLabel === false) inject nothing and keep the Harvest CSS default.
  const brandColor = isWhiteLabel ? tenant?.config?.primaryColor : undefined;
  const brandLogo = isWhiteLabel ? tenant?.config?.logo : undefined;
  const brandColorValid = isValidHex(brandColor);

  return (
    <html lang="en" className={cn("scroll-smooth font-sans", inter.variable, fraunces.variable, newsreader.variable)} suppressHydrationWarning>
      <head>
        {/* apple-touch-icon / icon are emitted dynamically via generateMetadata() */}
        {/* White-label tenant brand color, injected before body paint so the first
            paint (loading spinner included) is already tenant-colored — no Harvest
            gold flash. --color-primary feeds the App shell spinner (border-primary);
            --brand-color feeds MainApp's spinner + active accents. Unlayered, so it
            overrides the @layer base default in globals.css. Only a validated hex is
            interpolated (brandColorValid), so there is no injection surface. */}
        {brandColorValid && (
          <style dangerouslySetInnerHTML={{ __html: `:root{--brand-color:${brandColor};--color-primary:${brandColor};}` }} />
        )}
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block" rel="stylesheet" />
        <script src="/sw-cache-buster.js" defer />
      </head>
      {/* data-tenant-logo lets the client's FIRST render start from the tenant logo
          instead of the Harvest default (see getServerTenantLogo in MainApp). Only
          set for white-label tenants; React escapes the attribute value. */}
      <body
        className="bg-background-light text-[#1c1c1e] antialiased"
        data-tenant-logo={isWhiteLabel && brandLogo ? brandLogo : undefined}
      >
        {/* Capture ?ref=CODE on the FIRST public page load — before login/onboarding
            and independent of the (ssr:false) SPA's auth-driven redirects — so a
            logged-out affiliate visitor's referral survives all the way to checkout.
            Renders nothing; only writes localStorage['affiliateReferrerId']. */}
        <ReferralTracker />
        {children}
        <Script id="sw-register" strategy="afterInteractive">
          {`
            if ('serviceWorker' in navigator) {
              // When a new service worker takes control (new deploy + skipWaiting),
              // reload once so PWA users immediately get the latest UI bundles.
              var swRefreshing = false;
              navigator.serviceWorker.addEventListener('controllerchange', function() {
                if (swRefreshing) return;
                swRefreshing = true;
                window.location.reload();
              });
              navigator.serviceWorker.register('/sw.js').then(function(reg) {
                reg.update();
              }).catch(function(err) {
                console.log('SW registration failed:', err);
              });
            }
          `}
        </Script>
      </body>
    </html>
  );
}
