import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Nunito } from 'next/font/google';
import './globals.css';
import { cn } from "@/lib/utils";

const nunito = Nunito({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-sans',
  display: 'swap',
});

export const viewport: Viewport = {
  themeColor: '#D4AF37',
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: 'Harvest',
  description: 'Harvest App',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Harvest',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={cn("scroll-smooth font-sans", nunito.variable)} suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <link rel="icon" href="/icons/icon-96x96.png" />
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block" rel="stylesheet" />
        <script src="/sw-cache-buster.js" defer />
      </head>
      <body className="bg-background-light text-[#1c1c1e] antialiased">
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
