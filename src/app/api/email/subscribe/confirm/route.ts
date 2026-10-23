import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { renderUnsubscribePage } from '@/lib/email/unsubscribe-page';
import { NEWSLETTER_FEATURE_ENABLED } from '@/lib/newsletter-feature';

export const dynamic = 'force-dynamic';

function page(title: string, body: string, status = 200) {
  return new NextResponse(renderUnsubscribePage({ title, body, ministry: null }), {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

/**
 * The link in the confirmation email. The token in the URL is the credential:
 * opening it is the second half of the double opt-in. A GET changes state here
 * on purpose, because the person is clicking a link in their own inbox, and the
 * token is single-purpose (it is deleted when it is used).
 */
export async function GET(request: NextRequest) {
  if (!NEWSLETTER_FEATURE_ENABLED) return page('Not available', 'Email sign-ups are not available right now.', 503);
  try {
    const [{ confirmSubscription }, { firestoreSubscribeStore }] = await Promise.all([
      import('@/lib/email/subscribe'),
      import('@/lib/email/subscribe-store'),
    ]);
    const result = await confirmSubscription(
      { store: firestoreSubscribeStore, origin: request.nextUrl.origin, sendConfirmation: async () => ({ ok: false }) },
      request.nextUrl.searchParams.get('token'),
    );
    if (result === 'confirmed') return page('You are subscribed', 'Thank you. You will now get emails from this list, and every email has an unsubscribe link.');
    if (result === 'already') return page('You are already subscribed', 'This address is already on the list. There is nothing more to do.');
    if (result === 'expired') return page('This link has expired', 'Confirmation links last seven days. Fill in the sign-up form again to get a new one.', 410);
    return page('This link is not valid', 'The confirmation link looks incomplete. Fill in the sign-up form again to get a new one.', 400);
  } catch (error) {
    console.error('[email/subscribe/confirm]', error);
    return page('Please try again', 'We could not save that just now. Try the link again in a minute.', 500);
  }
}
