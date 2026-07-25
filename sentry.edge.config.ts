// Sentry — Edge runtime initialization (middleware, edge routes).
// Imported from src/instrumentation.ts when NEXT_RUNTIME === 'edge'.
import * as Sentry from '@sentry/nextjs';

import { scrubBreadcrumb, scrubEvent } from '@/lib/sentry-scrub';

const SENTRY_DSN =
  process.env.NEXT_PUBLIC_SENTRY_DSN ??
  'https://8cdb76914bba7360510039572004bc49@o4511793741692928.ingest.us.sentry.io/4511793758404608';

Sentry.init({
  dsn: SENTRY_DSN,

  // See instrumentation-client.ts for why this is `sendDefaultPii` and not
  // `dataCollection`.
  sendDefaultPii: false,

  tracesSampleRate: 0.1,

  beforeSend: (event) => scrubEvent(event),
  beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
});
