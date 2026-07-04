import withPWAInit from "next-pwa";

/** @type {import('next-pwa').PWAConfig} */
const withPWA = withPWAInit({
  dest: "public",
  register: true,
  skipWaiting: true,
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
