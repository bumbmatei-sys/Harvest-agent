import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const SHELL_STYLE = 'font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:420px;margin:15vh auto;padding:0 20px;color:#171717';

function page(title: string, body: string, status = 200, extra = '') {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>`
    + `<body style="${SHELL_STYLE}"><h1 style="font-size:20px">${title}</h1><p style="color:#6b6b6b">${body}</p>${extra}</body></html>`;
  return new NextResponse(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

async function readPayload(token: string | null) {
  const { verifyUnsubscribe } = await import('@/lib/email/unsubscribe');
  return token ? verifyUnsubscribe(token) : null;
}

async function optOut(token: string | null): Promise<boolean> {
  const payload = await readPayload(token);
  if (!payload) return false;
  const { firestoreEmailStore } = await import('@/lib/email/firestore-store');
  await firestoreEmailStore.recordOptOut(payload.tenantId, payload.email.toLowerCase(), payload.broadcastId, new Date().toISOString());
  return true;
}

function logFailure(error: unknown) {
  console.error(`[email/unsubscribe] ${error instanceof Error ? `${error.name}: ${error.message}` : 'failed'}`);
}

const INVALID = ['This link is not valid', 'The unsubscribe link looks incomplete. Reply to the email and we will remove you by hand.'] as const;
const DONE = ['You are unsubscribed', 'You will not get any more emails from this list.'] as const;
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
    const ok = await optOut(request.nextUrl.searchParams.get('t'));
    if (wantsPage) return ok ? page(...DONE) : page(...INVALID, 400);
    return ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ ok: false, error: 'invalid_token' }, { status: 400 });
  } catch (error) {
    logFailure(error);
    return wantsPage ? page(...RETRY, 503) : NextResponse.json({ ok: false, error: 'unavailable' }, { status: 503 });
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
    if (!(await readPayload(token))) return page(...INVALID, 400);
    const action = `/api/email/unsubscribe?t=${encodeURIComponent(token ?? '')}`;
    const form = `<form method="post" action="${escapeHtml(action)}"><input type="hidden" name="view" value="page">`
      + '<button type="submit" style="min-height:44px;padding:0 20px;font-size:16px;border-radius:8px;border:0;background:#171717;color:#fff;cursor:pointer">Unsubscribe</button></form>';
    return page('Unsubscribe from this list?', 'Press the button to stop getting emails from this list.', 200, form);
  } catch (error) {
    logFailure(error);
    return page(...RETRY, 503);
  }
}
