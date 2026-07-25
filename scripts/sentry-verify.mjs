/**
 * Send one real error to Sentry and confirm the integration end to end.
 *
 * WHY IT EXISTS
 * The Sentry setup needs a genuine event — with a readable stack trace — before
 * it can be called done. The usual way to get one is the wizard's
 * /sentry-example-page, but this app has an admin-gated surface and a public
 * donation funnel, and a route that throws on purpose has no business shipping to
 * production. This script does the same job from the command line instead: it is
 * never imported by the app, never bundled, and never routable.
 *
 * It verifies the two things unit tests cannot: that events actually reach Sentry
 * over the network, and that the stack trace points back at real source. The PII
 * scrubbing is covered separately by src/lib/sentry-scrub.test.ts.
 *
 * USAGE
 *   node scripts/sentry-verify.mjs
 *
 * Optionally override the project with NEXT_PUBLIC_SENTRY_DSN. Requires outbound
 * network access to <org>.ingest.us.sentry.io — if your network blocks Sentry, the
 * script reports the send as failed rather than exiting silently.
 */

import * as Sentry from '@sentry/node';

const DSN =
  process.env.NEXT_PUBLIC_SENTRY_DSN ||
  'https://8cdb76914bba7360510039572004bc49@o4511793741692928.ingest.us.sentry.io/4511793758404608';

/**
 * Sentry.flush() resolves true once the send queue has drained — which happens
 * whether or not the ingest server actually accepted the envelope. Reporting on
 * flush alone gives a false "delivered" on a blocked network, so the real HTTP
 * outcome is captured here by wrapping the transport.
 */
let sendOutcome = null;

function outcomeTrackingTransport(options) {
  const transport = Sentry.makeNodeTransport(options);
  return {
    ...transport,
    send: async (envelope) => {
      try {
        const response = await transport.send(envelope);
        const statusCode = response?.statusCode ?? 200;
        sendOutcome = { ok: statusCode < 300, detail: `HTTP ${statusCode}` };
        return response;
      } catch (error) {
        sendOutcome = { ok: false, detail: error?.message || String(error) };
        throw error;
      }
    },
  };
}

Sentry.init({
  dsn: DSN,
  sendDefaultPii: false,
  tracesSampleRate: 0,
  environment: process.env.SENTRY_ENVIRONMENT || 'verification',
  transport: outcomeTrackingTransport,
});

// Nested so the event carries a multi-frame stack trace worth reading.
function innerVerificationFrame() {
  throw new Error('Harvest Sentry verification — safe to resolve');
}

function outerVerificationFrame() {
  innerVerificationFrame();
}

let eventId;
try {
  outerVerificationFrame();
} catch (error) {
  eventId = Sentry.captureException(error);
}

await Sentry.flush(15000);

if (!sendOutcome || !sendOutcome.ok) {
  const detail = sendOutcome ? sendOutcome.detail : 'the transport never attempted a send';
  console.error(
    `\n✖ Sentry did NOT accept the event — ${detail}.\n\n` +
      '  The event was queued locally but never acknowledged by Sentry, so it will\n' +
      '  not appear in the dashboard. Usual causes:\n' +
      `    - outbound access to the ingest host is blocked by a network policy\n` +
      '    - the DSN is wrong, or its project was deleted\n' +
      '    - an HTTP proxy is intercepting the request\n',
  );
  process.exit(1);
}

console.log(
  '\n✔ Event sent to Sentry.\n' +
    `  Event ID: ${eventId}\n` +
    '  Issues:   https://harvest-jf.sentry.io/issues/?project=4511793758404608\n\n' +
    '  Confirm the stack trace names outerVerificationFrame / innerVerificationFrame\n' +
    '  and points at scripts/sentry-verify.mjs. Then resolve the issue.\n',
);
