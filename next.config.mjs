import withPWAInit from "next-pwa";

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
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Force a unique build ID on every deploy so the PWA service worker precache
  // and Next asset hashes change, busting stale caches for installed PWA users.
  generateBuildId: async () => `build-${Date.now()}`,
  typescript: {
    ignoreBuildErrors: true,
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

export default withPWA(nextConfig);
