import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

function page(title: string, body: string, status = 200) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>`
    + `<body style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:420px;margin:15vh auto;padding:0 20px;color:#171717"><h1 style="font-size:20px">${title}</h1><p style="color:#6b6b6b">${body}</p></body></html>`;
  return new NextResponse(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

async function optOut(token: string | null): Promise<boolean> {
  const { verifyUnsubscribe } = await import('@/lib/email/unsubscribe');
  const payload = token ? verifyUnsubscribe(token) : null;
  if (!payload) return false;
  const { firestoreEmailStore } = await import('@/lib/email/firestore-store');
  await firestoreEmailStore.recordOptOut(payload.tenantId, payload.email.toLowerCase(), payload.broadcastId, new Date().toISOString());
  return true;
}

/** A mail client's one-click POST (RFC 8058). The token in the URL is the credential. */
export async function POST(request: NextRequest) {
  try {
    const ok = await optOut(request.nextUrl.searchParams.get('t'));
    return ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ ok: false, error: 'invalid_token' }, { status: 400 });
  } catch {
    return NextResponse.json({ ok: false, error: 'unavailable' }, { status: 503 });
  }
}

/**
 * The visible link. A GET unsubscribes immediately, because the person asked
 * to stop and a confirm step is how unsubscribes get lost; it is idempotent.
 */
export async function GET(request: NextRequest) {
  try {
    const ok = await optOut(request.nextUrl.searchParams.get('t'));
    return ok
      ? page('You are unsubscribed', 'You will not get any more emails from this list.')
      : page('This link is not valid', 'The unsubscribe link looks incomplete. Reply to the email and we will remove you by hand.', 400);
  } catch {
    return page('Please try again', 'We could not save that just now. Try the link again in a minute.', 503);
  }
}
