// Sentry — Node.js server runtime initialization.
// Imported from src/instrumentation.ts when NEXT_RUNTIME === 'nodejs'.
import * as Sentry from '@sentry/nextjs';

import { scrubBreadcrumb, scrubEvent } from '@/lib/sentry-scrub';

const SENTRY_DSN =
  process.env.NEXT_PUBLIC_SENTRY_DSN ??
  'https://8cdb76914bba7360510039572004bc49@o4511793741692928.ingest.us.sentry.io/4511793758404608';

Sentry.init({
  dsn: SENTRY_DSN,

  // See instrumentation-client.ts for why this is `sendDefaultPii` and not
  // `dataCollection`. On the server this also keeps request bodies out of
  // events — the Stripe webhook payload carries donor names and amounts.
  sendDefaultPii: false,

  tracesSampleRate: 0.1,

  // The webhook and several API routes log metadata objects wholesale via
  // console.error; the console integration turns those into breadcrumbs, so
  // both hooks are required to keep donor PII out of Sentry.
  beforeSend: (event) => scrubEvent(event),
  beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
});
