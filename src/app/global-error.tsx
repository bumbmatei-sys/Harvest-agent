'use client';

// Catches render errors anywhere in the App Router tree — including ones that
// escape the root layout — and reports them to Sentry. Without this file a
// client render crash showed Next's default error page and reported nothing.
//
// Intentionally unbranded: NextError is Next.js's own generic error page, so
// this adds reporting without inventing new UI.
import * as Sentry from '@sentry/nextjs';
import NextError from 'next/error';
import { useEffect } from 'react';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        {/* NextError's types require a statusCode, but the App Router does not
            surface one for render errors, so 0 renders a generic message. */}
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
