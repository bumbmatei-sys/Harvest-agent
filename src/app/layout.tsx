import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import Script from 'next/script';
import { Analytics } from '@vercel/analytics/next';
import { Inter, Fraunces, Newsreader } from 'next/font/google';
import './globals.css';
import { cn } from "@/lib/utils";
import { getTenantFromHost } from '@/lib/server-tenant';
import {
  deriveOnDarkAccent,
  deriveOnTintAccent,
  DARK_SURFACE,
  CLASSIC_DARK_SURFACE,
  DARK_SURFACE_RAISED,
  CLASSIC_DARK_SURFACE_RAISED,
} from '@/lib/theme';
import { PREAUTH_PATHS } from '@/lib/preauth-theme';
import ReferralTracker from '@/components/ReferralTracker';
import { Toaster } from '@/components/ui/sonner';

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
  // Prefer a dedicated square icon (best fit for "Add to Home Screen"); fall
  // back to the logo, which is often a rectangular wordmark.
  const iconSource = tenant?.config?.squareIcon || tenant?.config?.logo;
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
      // "Add to Home Screen", so point it at the tenant's square icon (or
      // logo, if no square icon was uploaded) when available.
      icon: isWhiteLabel && iconSource ? iconSource : '/icons/icon-96x96.png',
      apple: isWhiteLabel && iconSource ? iconSource : '/icons/icon-192x192.png',
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
        {/* ── Theming stage 2: resolve the theme BEFORE first paint ──────────
            A plain inline <script> (not next/script, which defers) in <head>
            executes synchronously before the body renders, so <html> is already
            stamped when the first pixel lands — no flash of the wrong theme.
            This is the same pre-paint slot the tenant brand colour below uses.

            The SPA shape doesn't get in the way: the catch-all page is
            ssr:false, but <html> belongs to THIS server layout, so the theme is
            stamped without App.tsx or its BrowserRouter being involved at all.

            Both a class and an attribute are set. React never rendered
            data-theme, so it is left alone during hydration; the class is the
            compatibility hook for anything looking for `.dark`. <html> already
            carries suppressHydrationWarning for the tenant-branding case, which
            covers the class the same way.

            Reads a preference; it does not write one — the toggle that persists
            a choice is deliberately not part of this PR.

            Degrades safe under skipWaiting:false, where a stale bundle can pair
            old CSS with new JS: old CSS + new JS stamps an attribute no rule
            matches, new CSS + old JS stamps nothing. Both land on the light
            theme, which is the only theme that exists today anyway. The
            try/catch keeps a blocked localStorage (private mode, sandboxed
            iframe) from throwing before the app ever boots.

            ── THE-85: the pre-auth screens are light mode only ───────────────
            The funnel paths short-circuit to 'light' BEFORE the stored
            preference or the OS is consulted. This is the whole override, and
            it lives here rather than in the components on purpose: the tokens
            still resolve exactly as they always did, they simply resolve to
            their light values because `.dark` is never stamped. Hardcoding
            light colours into the pre-auth components is what caused THE-85 in
            the first place.

            ⚠️ prefers-color-scheme is DELIBERATELY overridden. A visitor whose
            OS is in dark mode still gets a light sign-in page. That is
            intended, not an oversight — these are the only screens a
            prospective customer sees before paying, and a half-themed sign-in
            page reads as a broken product. Do not "fix" this back.

            ⚠️ It READS the preference and never writes it, on any path. A user
            who signs out of dark mode sees light here and is returned to dark
            the moment they sign back in.

            PREAUTH_PATHS is interpolated from @/lib/preauth-theme rather than
            duplicated as a literal (the mistake the storage key above makes),
            so the list physically cannot drift. The three normalising
            statements DO mirror normalizePath() by hand — a test runs this very
            script against the same path table as that function and fails if
            they disagree.

            ── Palette family: a second, independent preference ───────────────
            Stamped as `data-palette` in the SAME script, right beside
            `data-theme` — one pre-paint pass, two attributes, so there is
            still exactly one moment where <html> goes from unstamped to fully
            stamped and no window where a family-only or mode-only flash is
            possible. FAMILY_STORAGE_KEY ('harvest-theme-family') is duplicated
            here as a literal for the same reason THEME_STORAGE_KEY is: this
            script cannot import. `theming-stage3.test.ts`'s existing pin is
            extended to cover this key too.

            On a pre-auth path, family is forced alongside mode being forced
            to 'light' — see applyThemeForLocation's comment for why: a
            returning signed-out user's stored family must not put a
            never-reviewed combination in front of the one audience that has
            not paid yet. The funnel renders exactly ONE presentation.

            🔴 THE-265 made that presentation Classic, matching what a new
            visitor gets once they are inside. In the runtime this is written
            as DEFAULT_PALETTE_FAMILY so it cannot drift from the default; here
            it is a literal for the same reason everything else in this script
            is, and the test below pins BOTH literals in this script to that
            one constant.

            ── THE-265: the DEFAULT family is Classic ─────────────────────────
            🔴 `f==='harvest'?'harvest':'classic'` — a MISSING or garbage
            stored value now resolves to Classic, where it used to resolve to
            Harvest. A stored 'harvest' is still honoured, so nobody who has
            chosen loses their choice; this is only what an absent value means.

            ⚠️ This is the SECOND HOME of a value whose first home is
            DEFAULT_PALETTE_FAMILY in @/lib/theme — and it is a literal here
            because this script is a string that runs before any bundle and
            cannot import, exactly as the two storage keys above cannot.
            The two are not held together by anything the compiler can see, so
            `the-265-classic-default.test.ts` parses this very expression back
            out of this file and fails if it disagrees with the constant. That
            test is the only thing standing between a future edit and a
            first-paint flash: change one and not the other, and a cold load
            paints one family and hydrates into the other.

            ⚠️ BOTH occurrences are pinned — the ternary's default arm here and
            the forced value in the pre-auth branch above. They are the same
            constant for different reasons (one is the default, one is a force
            that follows it), so a test that checked only one would let the
            funnel drift away from the app it leads into. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var e=document.documentElement;var p=(location.pathname||'/').split(/[?#]/)[0].replace(/\\/+$/,'');p=(p===''?'/':p).toLowerCase();if(${JSON.stringify(PREAUTH_PATHS)}.indexOf(p)>-1){e.setAttribute('data-theme','light');e.classList.remove('dark');e.setAttribute('data-palette','classic');return;}var s=localStorage.getItem('harvest-theme');var t=(s==='light'||s==='dark')?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');e.setAttribute('data-theme',t);e.classList.toggle('dark',t==='dark');var f=localStorage.getItem('harvest-theme-family');e.setAttribute('data-palette',f==='harvest'?'harvest':'classic');}catch(_){}})();`,
          }}
        />

        {/* White-label tenant brand color, injected before body paint so the first
            paint (loading spinner included) is already tenant-colored — no Harvest
            gold flash. --color-primary feeds the App shell spinner (border-primary);
            --brand-color feeds MainApp's spinner + active accents. Unlayered, so it
            overrides the @layer base default in globals.css. Only a validated hex is
            interpolated (brandColorValid), so there is no injection surface. */}
        {/* --brand-color-on-dark is derived here, server-side, from the hex the
            tenant ALREADY stores — nothing new is persisted, so this needs no
            change to how branding is saved. An arbitrary tenant colour can
            vanish on a dark ground (deep navy is 1.01:1 on #1A1612); this
            lightens it toward cream by the minimum that clears AA, so a colour
            that already works comes back untouched — Harvest gold is 6.77:1 and
            is not altered at all. CSS has no contrast function, so a blunt
            fixed color-mix would have been the only pure-CSS option, and it
            would have washed gold out to a pale #E2C99B.

            ── Palette family: which ground does the server derive against? ───
            🔴 The trap this PR calls out explicitly. Classic's dark ground
            (#1C1C1C) is not Harvest's (#1A1612) — an accent corrected for one
            can still fail AA on the other — so deriveOnDarkAccent's `ground`
            argument has to match whichever family is actually rendering.

            The server CANNOT know that: family is a client-only localStorage
            preference (like the mode), and this layout renders before any
            client code runs. Resolving it here would mean guessing.

            So it doesn't resolve anything — it does exactly what this file
            already does one line up for --brand-color-on-dark itself, which
            has the identical problem one dimension down (the server doesn't
            know the MODE either, and doesn't need to: the value is injected
            unconditionally and only ever consumed from inside a `.dark`-
            scoped rule, so it is inert in light and correct in dark without
            the server ever asking which one applies). Extended one axis
            further: BOTH possible derivations are computed and injected,
            each scoped to the `data-palette` value the pre-paint script
            above stamps client-side before first paint. Only one selector
            ever matches a given <html>, so exactly one of these two rules is
            ever in effect — the CSS cascade is what "learns" the family, at
            the moment the attribute lands, not this server render. Every
            existing dark-mode consumer of --brand-color-on-dark
            (--surface-gold, --border-gold, --glow-gold, --ring-gold in
            globals.css) needs no changes at all: the variable they already
            reference now resolves differently per family for free.

            ── --brand-color-on-tint: the same correction, one layer up ──────
            --brand-color-on-dark corrects the accent against the PAGE
            GROUND. An accent-tinted chip sits ABOVE that ground — it is the
            accent mixed into the raised surface — so it is lighter, and ink
            that clears AA on the ground can still fail on the chip. Harvest
            gold is comfortable either way; a dark white-label accent is not
            (navy #0C1526 clears 4.54:1 on the ground and only 4.27:1 on the
            chip, in Harvest dark exactly as much as in Classic dark).

            So a second value is derived against the chip itself, per family,
            and injected the same way. Consumed through --ink-on-accent-tint
            in globals.css, which is what makes it mode-aware — this rule
            applies in BOTH modes, exactly like --brand-color-on-dark above,
            and neither is ever read in light. Harvest gold is returned
            unchanged by this derivation too (5.15:1 on its own 12% chip), so
            the default brand renders identically. */}
        {brandColorValid && (
          <style dangerouslySetInnerHTML={{ __html: `:root{--brand-color:${brandColor};--color-primary:${brandColor};}[data-palette="harvest"]{--brand-color-on-dark:${deriveOnDarkAccent(brandColor, DARK_SURFACE)};--brand-color-on-tint:${deriveOnTintAccent(brandColor, DARK_SURFACE_RAISED)};}[data-palette="classic"]{--brand-color-on-dark:${deriveOnDarkAccent(brandColor, CLASSIC_DARK_SURFACE)};--brand-color-on-tint:${deriveOnTintAccent(brandColor, CLASSIC_DARK_SURFACE_RAISED)};}` }} />
        )}
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block" rel="stylesheet" />
      </head>
      {/* data-tenant-logo lets the client's FIRST render start from the tenant logo
          instead of the Harvest default (see getServerTenantLogo in MainApp). Only
          set for white-label tenants; React escapes the attribute value. */}
      <body
        className="bg-background-light text-strong antialiased"
        data-tenant-logo={isWhiteLabel && brandLogo ? brandLogo : undefined}
      >
        {/* Capture ?ref=CODE on the FIRST public page load — before login/onboarding
            and independent of the (ssr:false) SPA's auth-driven redirects — so a
            logged-out affiliate visitor's referral survives all the way to checkout.
            Renders nothing; only writes localStorage['affiliateReferrerId']. */}
        <ReferralTracker />
        {children}
        {/* sonner renders nothing until something calls `toast()`, but WITHOUT it
            mounted every `toast.*` call in the tree is a silent no-op — which is
            exactly what AdminDocs' export / import / share-to-livestream feedback
            had been doing. Mounted here rather than inside the SPA so it also
            covers anything rendered outside App (ssr:false). */}
        <Toaster />
        <Analytics />
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
