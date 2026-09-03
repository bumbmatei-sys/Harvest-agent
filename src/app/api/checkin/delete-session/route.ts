import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireTenantPermission } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { deleteByQuery, CHUNK_LIMIT } from '@/lib/member-deletion';
import { attendeesPath, type SessionDeleteResult } from '@/lib/checkin-session-delete';

export const dynamic = 'force-dynamic';

/**
 * POST /api/checkin/delete-session — THE-288.
 *
 * 🔴 FIRESTORE DOES NOT CASCADE. Deleting `checkinSessions/{id}` leaves
 * `checkinSessions/{id}/attendees` exactly where it was: a first name, last
 * name, email and `crmContactId` for everyone who checked in, now with no
 * parent, unreachable from the admin screen and invisible to the church. The
 * admin who pressed Delete believes it is gone. The church — the data
 * controller — goes on holding attendee PII it has no interface for and no
 * knowledge of.
 *
 * ⚠️ THIS IS NOT AN ERASURE FAILURE, and the fix must not become one. A member
 * exercising their right to erasure was always covered: `clearCheckinAttendees`
 * in member-erasure.ts walks the sessions under the concrete tenant path and
 * sub-queries each one's `attendees` by email. That reach is UNCHANGED here —
 * this route imports `deleteByQuery` and touches nothing else in the erasure
 * library, and the one case where it stops short (below) deliberately KEEPS the
 * session, which is the only handle that walk has.
 *
 * ── Why a route, and not a loop in the component ────────────────────────────
 * firestore.rules already lets a `manageCheckin` admin write the attendee
 * subcollection, so a client-side cascade would have been permitted. It would
 * also have been a NEW paging loop, which is the thing #390 says not to write:
 * twelve sweeps there each took a single 400-document page, left the remainder
 * and reported `complete`. `deleteByQuery` is the loop that already got this
 * right, and it is Admin-SDK, so the cascade lives server-side. No rule
 * changed; `firestore.rules` is not opened by this ticket.
 *
 * ── The order, which is the whole design ────────────────────────────────────
 * Attendees first, session LAST, and the session only once the collection is
 * PROVEN empty. The session document is the sole handle to its attendees, so
 * deleting it on an unfinished sweep would not merely under-report — it would
 * manufacture the exact orphans this ticket exists to remove.
 *
 * ── Gate ────────────────────────────────────────────────────────────────────
 * `manageCheckin`, mirroring the `hasPermission('manageCheckin', tenantId)`
 * write rule on `checkinSessions/{sessionId}` and on its `attendees` subrule,
 * so the route grants exactly what the client already held and nothing more.
 *
 * ⚠️ NO PLAN GATE, deliberately, unlike this folder's other two routes.
 * `/checkin/get` and `/checkin/submit` are PUBLIC, no-auth and WRITE or expose
 * data, so THE-213 refuses them below `checkInSystem`. This route is
 * admin-authenticated and only DESTROYS. Refusing it on a downgraded tenant
 * would strand attendee PII on a church that can no longer reach the screen —
 * the defect, re-created by the gate meant to prevent one.
 */
export async function POST(request: NextRequest) {
  let body: { tenantId?: string; sessionId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { tenantId, sessionId } = body;
  if (!tenantId || !sessionId) {
    return NextResponse.json({ error: 'tenantId and sessionId are required' }, { status: 400 });
  }

  const userOrResponse = await requireTenantPermission(request, tenantId, 'manageCheckin');
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  try {
    const sessionRef = adminDb
      .collection('tenants').doc(tenantId)
      .collection('checkinSessions').doc(sessionId);

    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const attendees = sessionRef.collection('attendees');

    // The sweep. `deleteByQuery` pages at CHUNK_LIMIT (400 — the WriteBatch cap
    // with headroom) and re-queries the same filter after each commit, so the
    // just-deleted page drops out and the next page is the next set of
    // survivors. It is bounded by the request budget rather than by a document
    // cap: a collection large enough to outlast the request throws, and a throw
    // lands in `partial` below, never in `complete`.
    // `attendeesDeleted` stays null on a throw: deleteByQuery returns its
    // running total only on the way out, so the count is genuinely unknown and
    // is reported as unknown rather than as a zero that understates the damage.
    let attendeesDeleted: number | null = null;
    try {
      attendeesDeleted = await deleteByQuery(attendees);
    } catch (e) {
      console.error('Check-in attendee sweep failed:', e);
    }

    // 🔴 THE COUNT IS NOT THE EVIDENCE — #390's sweeps all returned a number
    // and were all wrong. The collection is re-read and must come back EMPTY
    // before the parent goes. One bounded page is enough to disprove emptiness,
    // and its size is the honest lower bound on what survived.
    const survivors = await attendees.limit(CHUNK_LIMIT).get();

    if (attendeesDeleted === null || !survivors.empty) {
      const result: SessionDeleteResult = {
        status: 'partial',
        attendeesDeleted,
        remainingIn: attendeesPath(tenantId, sessionId),
        remainingAtLeast: survivors.size,
      };
      // 500, matching how /api/account/delete maps a `partial` erasure: the
      // caller must not treat a short sweep as a success. The session document
      // is left in place on purpose — it is the only handle the remaining
      // attendee records have, from this screen and from member-erasure.ts.
      return NextResponse.json(result, { status: 500 });
    }

    await sessionRef.delete();

    const result: SessionDeleteResult = { status: 'complete', attendeesDeleted };
    return NextResponse.json(result);
  } catch (e) {
    console.error('Check-in session delete error:', e);
    return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 });
  }
}
