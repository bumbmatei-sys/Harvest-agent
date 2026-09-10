import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { requireTenantPermission } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { publishPublicNote, revokePublicNote } from '@/lib/public-note';

export const dynamic = 'force-dynamic';

/**
 * THE-346 — the admin's half of "Share on web". Mint a link, and kill one.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A ROUTE AND NOT A CLIENT FIRESTORE WRITE.
 *
 * `publicNotes/{token}` has NO rule in `firestore.rules`, deliberately — see
 * `src/lib/public-note.ts` for the whole argument and for the rule that would
 * be needed if it ever became a browser read. `firestore.rules` auto-deploys to
 * production on merge, CI runs no emulator tests, and THE-313's one-line
 * addition turned 46 test files red. So the collection is server-only and this
 * route is how the Notes screen reaches it.  `firestore.rules` is
 * byte-identical after this ticket.
 *
 * AND THE CLIENT COULD NOT BE TRUSTED WITH THE TOKEN ANYWAY. The doc's own
 * `publicShare.token` field IS client-writable — `/docs/{docId}` already lets
 * its author update it — so a member could plant any string there from the
 * console. That forges NOTHING: the reader resolves the `publicNotes/{token}`
 * record FIRST, and only this route can create one. A planted field resolves to
 * a token with no record, which is a 404. The doc field is a convenience for
 * the admin's own screen, never the permission.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * `manageDocs`, AND THE TENANT COMES OFF THE NOTE, NOT OFF THE REQUEST.
 *
 * TAKING `tenantId` FROM THE BODY IS THE HOLE THIS SHAPE CLOSES. A caller
 * who is an admin of tenant A could otherwise post `{ docId: <a note in B>,
 * tenantId: 'A' }`, pass a permission check against their OWN tenant, and
 * publish another church's note to the open web. So the note is read first, its
 * stored `tenantId` is what the permission is checked against, and the body
 * carries only the document id.
 */

interface Body {
  docId?: unknown;
  action?: unknown;
}

/** Resolve the note and the caller's right to publish it, or the refusal. */
async function authorise(
  request: NextRequest,
): Promise<{ docId: string; tenantId: string; uid: string } | NextResponse> {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const docId = typeof body.docId === 'string' ? body.docId.trim() : '';
  if (!docId) return NextResponse.json({ error: 'docId is required' }, { status: 400 });

  const snap = await adminDb.collection('docs').doc(docId).get();
  const note = snap.data();
  // 404, NOT 403, and the same 404 a caller gets for a note in a tenant they
  // cannot see. Distinguishing them would turn this route into an oracle for
  // which note ids exist.
  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const tenantId = typeof note.tenantId === 'string' ? note.tenantId : '';
  if (!tenantId) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const userOrResponse = await requireTenantPermission(request, tenantId, 'manageDocs');
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  return { docId, tenantId, uid: userOrResponse.uid };
}

/** Start sharing. Returns the path the link lives at — never a full URL. */
export async function POST(request: NextRequest) {
  const authed = await authorise(request);
  if (authed instanceof NextResponse) return authed;

  const token = await publishPublicNote(authed.tenantId, authed.docId, authed.uid);
  /**
   * A PATH, NOT AN ORIGIN. The Notes screen builds the copyable link from
   * `window.location.origin`, so the link a church copies is always on the host
   * they are actually signed in to. Reading a host off the REQUEST here and
   * echoing it back would let a forwarded `Host` header decide what gets copied
   * onto a clipboard, which is a redirect waiting to happen.
   */
  return NextResponse.json({ shared: true, path: `/n/${token}` });
}

/**
 * Stop sharing.
 *
 * IDEMPOTENT ON PURPOSE. Revoking a note that is not shared is a success,
 * not a 404: the caller asked for it to be unreachable and it is. A failure
 * here would invite a retry loop over a state that is already correct.
 */
export async function DELETE(request: NextRequest) {
  const authed = await authorise(request);
  if (authed instanceof NextResponse) return authed;

  await revokePublicNote(authed.docId);
  return NextResponse.json({ shared: false });
}
