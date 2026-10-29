import path from "node:path";
import { fileURLToPath } from "node:url";

import withPWAInit from "next-pwa";
import { withSentryConfig } from "@sentry/nextjs";

// Vendored `server-only` (vendor/server-only). The lockfile cannot take the
// package, and Next resolves it from this directory the same way it resolves
// a real install. The marker throws if a client component imports it.
// node_modules stays first, and a second webpack pass does not add vendor twice.
const vendorDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "vendor");

/** @type {import('next-pwa').PWAConfig} */
const withPWA = withPWAInit({
  dest: "public",
  register: true,
  // false: a new service worker waits for all tabs it controls to close before
  // activating, instead of claiming open tabs immediately. With skipWaiting: true,
  // next-pwa's generated sw.js calls self.skipWaiting() + clientsClaim(), so an
  // in-progress deploy would claim already-open tabs and force them to reload to
  // reconcile assets with the new SW — including tabs mid-sign-up/sign-in, wiping
  // form state. skipWaiting: false defers the update to the user's next fresh visit.
  skipWaiting: false,
  disable: process.env.NODE_ENV === "development",
  // Sentry turns on client source-map generation so production stack traces are
  // readable. next-pwa would otherwise precache every emitted .map file (150 of
  // them), making PWA users download the entire source of the app on install.
  // The maps are still written to disk for Sentry to upload — they are only kept
  // out of the service worker's precache manifest.
  buildExcludes: [/\.map$/],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // Enables src/instrumentation.ts, where the Sentry server and edge SDKs are
  // initialized. Required on Next 14; the default from Next 15 onward.
  experimental: {
    instrumentationHook: true,
    // Release webpack memory between the server, edge and client compiles.
    webpackBuildWorker: true,
  },
  webpack: (config) => {
    const modules = Array.isArray(config.resolve.modules) ? [...config.resolve.modules] : ["node_modules"];
    if (!modules.includes(vendorDir)) modules.push(vendorDir);
    config.resolve.modules = modules;

    // Events screenshot harness ONLY — inert unless EVENTS_HARNESS_MOCK=1 is
    // set, and the harness's own files (src/app/events-harness/) are never
    // committed (see the worktree's git info/exclude), so this alias has no
    // target in a normal checkout either. Lets the harness page render the
    // REAL AdminEvents/UserEvents/PublicEventRegistration against made-up
    // in-memory data instead of a live Firestore project, by swapping the
    // exact module specifiers those files import. Never used outside a dev
    // server started explicitly for events screenshots.
    if (process.env.EVENTS_HARNESS_MOCK === "1") {
      const harnessMocks = path.join(path.dirname(fileURLToPath(import.meta.url)), "src/app/events-harness/_mocks");
      config.resolve.alias = {
        ...config.resolve.alias,
        "../firebase": path.join(harnessMocks, "firebase.ts"),
        "@/firebase$": path.join(harnessMocks, "firebase.ts"),
        "../../firebase": path.join(harnessMocks, "firebase.ts"),
        "../utils/tenant-scope": path.join(harnessMocks, "tenant-scope.ts"),
        "./tenant-scope": path.join(harnessMocks, "tenant-scope.ts"),
        "../contexts/TenantContext": path.join(harnessMocks, "tenant-context.tsx"),
        "firebase/firestore": path.join(harnessMocks, "firestore.ts"),
        "firebase/auth": path.join(harnessMocks, "auth.ts"),
      };
    }
    return config;
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "firebasestorage.googleapis.com",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "*.googleapis.com",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "raw.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
      {
        protocol: "https",
        hostname: "api.cloudinary.com",
      },
      {
        protocol: "https",
        hostname: "pub-c6a60213ef754d66854c27c4a51e6cf5.r2.dev",
      },
    ],
  },
};

// Sentry wraps the *result* of withPWA rather than replacing it, so next-pwa
// still generates public/sw.js with skipWaiting: false intact. Order matters:
// withPWA must run on the inside.
export default withSentryConfig(withPWA(nextConfig), {
  org: "harvest-jf",
  project: "javascript-nextjs",

  // Source-map upload. Without SENTRY_AUTH_TOKEN set in the Vercel project's
  // environment variables, uploads are skipped and production stack traces stay
  // minified — the build still succeeds. The token is a secret and must never be
  // committed.
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  sourcemaps: {
    // Don't leave .map files in the deployed bundle once Sentry has them.
    deleteSourcemapsAfterUpload: true,
  },

  // Keep build output quiet locally, verbose in CI.
  silent: !process.env.CI,
});
