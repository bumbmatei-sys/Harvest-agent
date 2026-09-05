import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { headers } from 'next/headers';

import { getTenantFromHost } from '@/lib/server-tenant';
import { captureHandledError } from '@/lib/money-path-sentry';
import { recordResponse } from '@/lib/rota-invite';
import { isRotaToken } from '@/components/events/rota-invitations';

export const dynamic = 'force-dynamic';

/**
 * THE-324 — 🔴 THE ONE PUBLIC WRITE. A volunteer answering, signed out, from a
 * text message.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔵 THE AUTHENTICATION DECISION, AND WHY IT WENT THIS WAY.
 *
 * The ticket puts two options and asks for a decision. It is A TOKEN, AND NO
 * SIGN-IN, and the reasoning is not "one tap is nicer":
 *
 *   · 🔴 REQUIRING SIGN-IN LOSES THE VOLUNTEER, AND THE REPO HAS MEASURED THAT.
 *     THE-289 established that anything before the `theharvest.app` →
 *     `<tenant>.theharvest.app` hop is a step the member never finishes, and
 *     THE-138 is why: the hop ENDS the Firebase session, so a member who signed
 *     in at the apex has to sign in AGAIN at the church's subdomain. An accept
 *     link arriving in an SMS lands on the subdomain, and the person tapping it
 *     is a volunteer on a phone on a Tuesday evening. A rota nobody answers is
 *     a rota that does not work, and the unanswered-slot warning would fill with
 *     people who simply could not get in.
 *
 *   · AND MOST VOLUNTEERS HAVE NO ACCOUNT TO SIGN IN WITH. `personId` is a
 *     `users/{uid}`, but a `users` document is created for a member of the
 *     church — the teenager on the sound desk may never have opened the app.
 *
 * ⚠️ THE COST, STATED PLAINLY BECAUSE IT IS REAL: ANYONE WITH THE LINK CAN
 * ANSWER FOR THAT PERSON. A volunteer who forwards the text, or whose phone is
 * unlocked on a table, has handed over the ability to accept or decline one
 * slot. That is stop condition 4, and it is REPORTED rather than waved away.
 *
 * 🔴 AND IT IS BOUNDED, WHICH IS THE OTHER HALF OF STOP CONDITION 4. The bound
 * is not a promise, it is the shape of the write:
 *
 *   1. THE TOKEN ADDRESSES EXACTLY ONE DOCUMENT. 256 bits of `randomBytes`,
 *      stored on the invitation, found by equality. It is not a signature over
 *      a person, so it cannot be replayed against another slot, another person
 *      or another church.
 *   2. IT AUTHORISES THREE FIELDS. `recordResponse` writes `status` — one of two
 *      values — and `respondedAt`. It cannot move the date, rename the item,
 *      reassign the person, mint a token, read another invitation or touch any
 *      other document. There is no other write on this path.
 *   3. IT EXPIRES BY THE CLOCK. A service that has started is not answerable, so
 *      a link found in an old message thread does nothing.
 *   4. IT IS REVOCABLE. The token lives ON the document, so re-inviting the slot
 *      to a different person regenerates it and the old link stops answering.
 *   5. AND THE WORST CASE IS VISIBLE. A wrong answer shows on the admin's rota
 *      as declined or accepted next to a name, which is the surface an admin
 *      already reads every week. It is not a silent state change.
 *
 * ⚠️ WHAT IT DELIBERATELY DOES NOT AUTHORISE: no session is created, no cookie
 * is set, and the volunteer is not signed in to anything by tapping it. A
 * capability to answer one question is not a login.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 NO `firestore.rules` CHANGE. STOP CONDITION 2 IS NOT REACHED.
 *
 * This write goes through the ADMIN SDK inside this route, which bypasses rules
 * entirely — the same posture `/giving`, `/checkin/[sessionId]` and
 * `/form/[formId]` already have for their own public reads and writes. There is
 * no rule that could express "whoever holds this secret" anyway: a rule sees the
 * request, not a stored token, so the only rule shape available would be
 * `allow write: if true` on a guessable path, which is strictly worse than no
 * client access at all. 🔴 `firestore.rules` is byte-identical after this ticket.
 *
 * ⚠️ THE TENANT COMES FROM THE HOST, NOT THE BODY. `getTenantFromHost` is what
 * every other public route already resolves with, and it means a token minted
 * for one church cannot be spent against another's collection — the lookup
 * simply finds nothing.
 *
 * ⚠️ AND THE TOKEN'S SHAPE IS CHECKED BEFORE FIRESTORE IS. An unauthenticated
 * endpoint must not spend a read on junk, and `TOKEN_RE` costs nothing. Guessing
 * a real one is 256 bits; there is nothing here worth rate-limiting into a new
 * collection that would itself need writing on every attempt.
 */
export async function POST(request: NextRequest) {
  const headersList = await headers();
  const tenant = await getTenantFromHost(headersList.get('host') || '');
  // An anonymous visitor is not told whether a subdomain exists — the same
  // answer every other public route gives.
  if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let payload: { token?: unknown; answer?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!isRotaToken(payload.token)) {
    return NextResponse.json({ error: 'That link is not valid.' }, { status: 400 });
  }
  const answer =
    payload.answer === 'accepted' ? 'accepted' : payload.answer === 'declined' ? 'declined' : null;
  if (!answer) {
    return NextResponse.json({ error: "answer must be 'accepted' or 'declined'" }, { status: 400 });
  }

  try {
    const invitation = await recordResponse(tenant.id, payload.token, answer, new Date());
    if (!invitation) {
      // ⚠️ ONE ANSWER FOR EVERY MISS. A token that never existed, a token for
      // another church, and a service that has already happened are
      // indistinguishable to the caller on purpose: a different message for
      // each would let somebody probe which tokens are real.
      return NextResponse.json(
        { error: 'That link is no longer active. Please ask your church.' },
        { status: 404 },
      );
    }
    return NextResponse.json({ status: invitation.status });
  } catch (e) {
    console.error('rota respond failed:', e);
    captureHandledError(e, { step: 'rota-respond', tenantId: tenant.id });
    return NextResponse.json(
      { error: 'That could not be saved. Please try again.' },
      { status: 502 },
    );
  }
}
