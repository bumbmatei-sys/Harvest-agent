// Next.js instrumentation hook — runs once per server runtime at startup.
// Requires `experimental.instrumentationHook: true` on Next 14 (see
// next.config.mjs); the flag becomes the default in Next 15.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}

// Sentry's `onRequestError` hook — which reports errors thrown inside nested
// React Server Components — is deliberately absent: Next.js only calls it from
// version 15 onward, and this app is on 14.2.15. Add it as part of the Next 15
// upgrade.
