import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { renderUnsubscribePage } from '@/lib/email/unsubscribe-page';

export const dynamic = 'force-dynamic';

function page(title: string, body: string, ministry: string | null, status = 200, action?: string) {
  return new NextResponse(renderUnsubscribePage({ title, body, ministry, action }), {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

async function readPayload(token: string | null) {
  const { verifyUnsubscribe } = await import('@/lib/email/unsubscribe');
  return token ? verifyUnsubscribe(token) : null;
}

/** The ministry's name for the page. A failed read only costs the name; it never blocks an opt-out. */
async function ministryName(tenantId: string): Promise<string | null> {
  try {
    const { firestoreEmailStore } = await import('@/lib/email/firestore-store');
    const name = (await firestoreEmailStore.getTenant(tenantId))?.name.trim();
    return name || null;
  } catch (error) {
    logFailure(error);
    return null;
  }
}

async function optOut(token: string | null): Promise<{ tenantId: string } | null> {
  const payload = await readPayload(token);
  if (!payload) return null;
  const { firestoreEmailStore } = await import('@/lib/email/firestore-store');
  await firestoreEmailStore.recordOptOut(payload.tenantId, payload.email.toLowerCase(), payload.broadcastId, new Date().toISOString());
  return { tenantId: payload.tenantId };
}

function logFailure(error: unknown) {
  console.error(`[email/unsubscribe] ${error instanceof Error ? `${error.name}: ${error.message}` : 'failed'}`);
}

const INVALID = ['This link is not valid', 'The unsubscribe link looks incomplete. Reply to the email and we will remove you by hand.'] as const;
const RETRY = ['Please try again', 'We could not save that just now. Try the link again in a minute.'] as const;

/**
 * The unsubscribe action. Two callers share it:
 *  - a mail client's one-click POST (RFC 8058), which wants JSON;
 *  - the confirm page below, which posts `view=page` and wants a page back.
 * The token in the URL is the credential in both cases.
 */
export async function POST(request: NextRequest) {
  const wantsPage = await request.text().then((text) => new URLSearchParams(text).get('view') === 'page').catch(() => false);
  try {
    const done = await optOut(request.nextUrl.searchParams.get('t'));
    if (wantsPage) {
      if (!done) return page(...INVALID, null, 400);
      const name = await ministryName(done.tenantId);
      return page('You are unsubscribed', name ? `${name} will not send you any more emails from this list.` : 'You will not get any more emails from this list.', name);
    }
    return done
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ ok: false, error: 'invalid_token' }, { status: 400 });
  } catch (error) {
    logFailure(error);
    return wantsPage ? page(...RETRY, null, 503) : NextResponse.json({ ok: false, error: 'unavailable' }, { status: 503 });
  }
}

/**
 * The visible link. A GET only ASKS: mail scanners, link previews and browser
 * prefetch all issue GETs, and none of them should opt anyone out. The person
 * presses the button, which POSTs.
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('t');
    const payload = await readPayload(token);
    if (!payload) return page(...INVALID, null, 400);
    const name = await ministryName(payload.tenantId);
    const action = `/api/email/unsubscribe?t=${encodeURIComponent(token ?? '')}`;
    return page(
      name ? `Unsubscribe from ${name}?` : 'Unsubscribe from this list?',
      name ? `Press the button to stop getting emails from ${name}.` : 'Press the button to stop getting emails from this list.',
      name,
      200,
      action,
    );
  } catch (error) {
    logFailure(error);
    return page(...RETRY, null, 503);
  }
}
