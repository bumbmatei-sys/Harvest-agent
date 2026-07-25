// Sentry — browser SDK initialization.
//
// Loaded by @sentry/nextjs, which injects this file into the client webpack
// entry point. (Next.js only picks up `instrumentation-client.ts` natively from
// 15.3 onward; on Next 14 the SDK's own injection is what wires it up.)
import * as Sentry from '@sentry/nextjs';

import { scrubBreadcrumb, scrubEvent } from '@/lib/sentry-scrub';

// The DSN is a public value — it ships in the client bundle by design. The env
// override exists so a deploy can point at a different project, or disable
// reporting by setting it empty.
const SENTRY_DSN =
  process.env.NEXT_PUBLIC_SENTRY_DSN ??
  'https://8cdb76914bba7360510039572004bc49@o4511793741692928.ingest.us.sentry.io/4511793758404608';

Sentry.init({
  dsn: SENTRY_DSN,

  // Never attach IP addresses, cookies, headers or request bodies. Harvest holds
  // donor records, so nothing user-identifying is sent by default.
  //
  // Note: `sendDefaultPii` is deprecated in SDK v10 and goes away in v11, where
  // `dataCollection` replaces it. It is set here rather than `dataCollection`
  // because setting both causes the SDK to ignore `sendDefaultPii` — one
  // authoritative switch, no ambiguity. Revisit on the v11 upgrade.
  sendDefaultPii: false,

  // Errors are captured in full; traces are sampled at 10% to stay inside the
  // free-tier quota, which tracing consumes fastest.
  tracesSampleRate: 0.1,

  // Last line of defence before anything leaves the browser. `beforeBreadcrumb`
  // matters as much as `beforeSend` here: console breadcrumbs flatten logged
  // objects into strings, and several API routes log metadata wholesale.
  beforeSend: (event) => scrubEvent(event),
  beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),

  // Deliberately not enabled: session replay (it would record donation and
  // pledge forms), profiling, logs, metrics and AI monitoring.
});

// Instruments client-side router navigations. Next.js only calls this hook from
// 15.3 onward, so on 14.2.15 it is inert — exported now because the SDK asks for
// it at build time, and it starts working on the Next 15 upgrade.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
