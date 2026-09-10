import { randomBytes } from 'node:crypto';

import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * THE-346 — "Share on web": what makes a church's note public, and what makes
 * it stop being public.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 1. NO `firestore.rules` CHANGE IS NEEDED, AND NONE IS MADE.
 * STOP CONDITION 2, ANSWERED BY THE SHAPE RATHER THAN BY A RULE.
 *
 * `firestore.rules` AUTO-DEPLOYS TO PRODUCTION ON MERGE, CI runs no emulator
 * tests, and THE-313's ONE-LINE change turned 46 files red. So the question is
 * never "which rule authorises the public read" but "how does this feature
 * avoid needing one", and THE-324 already answered it for a signed-out
 * volunteer accepting a rota invitation. This is the same shape:
 *
 * `publicNotes/{token}` HAS NO RULE, AND THEREFORE NO
 * CLIENT READ AND NO CLIENT WRITE. Every access — minting a link, revoking
 * it, and the signed-out reader's own fetch — goes through the Admin SDK
 * in `src/app/api/docs/public-share/` and `src/app/n/[token]/`. The Admin
 * SDK bypasses rules entirely, so no rule is consulted, none is added, and
 * `firestore.rules` is byte-identical after this ticket.
 *
 * AND `/docs/{docId}` IS LEFT EXACTLY AS IT IS. Its read is
 * `isAuthenticated() && (tenant admin || createdBy || uid in sharedWith)`. That
 * is the line a "public link" is naively assumed to need widening, and widening
 * it is the one change that could leak every note in the collection rather than
 * the one being shared. It is not touched. A signed-out reader NEVER holds a
 * Firestore session here — the note reaches them as HTML rendered on the
 * server, from a read this module performs with server credentials after it has
 * checked the token itself.
 *
 * THE RULE THAT WOULD BE NEEDED, IF A LATER TICKET EVER READ THIS COLLECTION
 * FROM A BROWSER — REPORTED, DELIBERATELY UNWRITTEN:
 *
 * match /publicNotes/{token} {
 * allow read:  if isAuthenticated() &&
 * hasPermission('manageDocs', resource.data.tenantId);
 * allow write: if false;
 * }
 *
 * NOTE WHAT THAT RULE STILL COULD NOT DO: authorise the ANONYMOUS read
 * this feature exists for. A rule can see the request, never a secret, so
 * the only shape rules could offer for a signed-out reader is
 * `allow read: if true` on a collection keyed by the token — which publishes
 * the token space itself to anyone who can list it. Moving the read
 * server-side is not a workaround for the rules language; it is the only
 * place the token CAN be checked.  IT IS NOT WRITTEN HERE. Nothing in this
 * ticket needs it.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 2. THE URL IS NOT GUESSABLE. 256 BITS, FROM A CSPRNG.
 * STOP CONDITION 3, ANSWERED WITH A NUMBER.
 *
 * A church's internal note is not a public document by accident, so the link
 * has to be the whole secret. The token is 32 bytes from `node:crypto`'s
 * `randomBytes` — a CSPRNG — rendered base64url, which is 43 characters and
 * exactly the shape THE-324 chose for a rota accept link for this same reason.
 *
 * A SEQUENTIAL OR DOCUMENT ID WOULD NOT DO, and this is the specific trap:
 * the obvious link is `/n/{docId}`, and a Firestore auto-id is 20 characters
 * from a 62-character alphabet with a TIMESTAMP PREFIX — ids minted near each
 * other sort near each other. Sharing one note would then put every note
 * created in the same minute inside a searchable neighbourhood. The token is
 * unrelated to the document, carries no time component, and two links to the
 * same note (share, revoke, share again) are unrelated to each other.
 *
 * AND THE TOKEN IS THE DOCUMENT ID, NOT A FIELD ON IT. A stored field would
 * mean the lookup is a QUERY — `where('token','==',t)` — which is a scan the
 * rules cannot bound and which would need `firestore.indexes.json`, a file this
 * ticket must not touch and which does NOT deploy on merge anyway
 * (`deploy-rules.yml` runs `firestore:rules,storage` only), so an index added
 * there is inert and the query throws `failed-precondition` in production. As
 * the document id it is a single `get()` by primary key: no index, no query, no
 * ordering, and a miss is a miss rather than an empty page of results.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 3. REVOKING ACTUALLY REVOKES, AND HERE IS WHY IT CANNOT NOT.
 * STOP CONDITION 4, ANSWERED BY THERE BEING ONE DOOR.
 *
 * `revokePublicNote` DELETES the `publicNotes/{token}` document. There is no
 * `active: false` flag, no `revokedAt`, and no expiry to compare against —
 * every one of those leaves a record that still resolves and relies on some
 * reader remembering to check a second field. The record is the permission, so
 * removing it removes the permission.
 *
 * AND NOTHING IS CACHED, WHICH IS THE HALF THAT USUALLY LEAKS. The reader
 * resolves the token on EVERY request and then reads the note ITSELF on every
 * request; no note content is ever copied into the share record, so there is no
 * stale copy that could outlive the revocation. `/n/[token]` is
 * `force-dynamic`, so Next renders it per request rather than serving a build
 * artefact.
 *
 * THE TOKEN IS NOT REUSED. Sharing again mints a NEW token, so a link that
 * was revoked cannot be resurrected by re-sharing — the old URL stays dead
 * forever. That is the difference between "off" and "gone", and it is why the
 * doc's own `publicShare` field is REPLACED rather than toggled.
 */

/** 32 bytes, base64url — 43 characters, 256 bits. */
export const PUBLIC_NOTE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const isPublicNoteToken = (v: unknown): v is string =>
  typeof v === 'string' && PUBLIC_NOTE_TOKEN_RE.test(v);

/**
 * `randomBytes`, NOT `Math.random()`. The link is the entire access control
 * for this note, so the generator has to be the cryptographic one; `Math.random`
 * is seeded per process and is recoverable from a handful of outputs.
 */
export function newPublicNoteToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Where share records live. Server-only; see the header.
 *
 * TOP-LEVEL, NOT `tenants/{t}/publicNotes`, AND THE URL IS WHY. The link
 * deliberately carries no tenant — putting one in it would tell a stranger
 * which church a link belongs to before they had opened it, and would make the
 * token half of a guess rather than all of it. Under a tenant subcollection the
 * reader would then have to FIND the tenant, and a collection-group lookup by
 * document id does not work: `FieldPath.documentId()` compares against a FULL
 * resource path across a collection group, which is the very thing not known
 * yet. The alternative — a stored `token` FIELD queried with `where` — is a
 * scan needing `firestore.indexes.json`, a file this ticket must not touch and
 * which does NOT deploy on merge anyway (`deploy-rules.yml` runs
 * `firestore:rules,storage` only), so an index added there is inert and the
 * query throws `failed-precondition` in production.
 *
 * Top-level with the token AS THE DOCUMENT ID makes the whole resolution one
 * `get()` by primary key: no query, no index, no ordering, and a miss is a miss
 * rather than an empty page of results. `tenantId` rides along as a FIELD,
 * which is where it is actually needed — after the token has been accepted.
 *
 * THIS COLLECTION HAS NO RULE AND MUST NOT ACQUIRE ONE. `firestore.rules`
 * has no catch-all `match /{document=**}`, so an unruled top-level collection
 * is default-deny for every client — exactly the posture the header describes.
 */
const shareCollection = () => adminDb.collection('publicNotes');

/**
 * A published link, as stored.  NOTE WHAT IS ABSENT: the note's title and its
 * body. Copying either here would create a second copy of the church's material
 * that revoking the link would not remove, and a reader that answered from the
 * copy would keep serving a note after it had been unshared — or after it had
 * been edited, which is the same defect wearing a different hat.
 */
export interface PublicNoteShare {
  docId: string;
  tenantId: string;
  createdBy: string;
}

/** The note as a signed-out reader receives it. */
export interface PublicNote {
  docId: string;
  tenantId: string;
  title: string;
  contentHtml: string;
}

/**
 * Mint a link for `docId`, replacing any link it already had.
 *
 * THE OLD RECORD IS DELETED IN THE SAME BATCH THAT WRITES THE NEW ONE. Two
 * live tokens for one note would mean "stop sharing" had to find them all, and
 * the one it missed would be the leak. One note, at most one live token, always.
 */
export async function publishPublicNote(
  tenantId: string,
  docId: string,
  uid: string,
): Promise<string> {
  const token = newPublicNoteToken();
  const noteRef = adminDb.collection('docs').doc(docId);
  const existing = (await noteRef.get()).data()?.publicShare?.token;

  const batch = adminDb.batch();
  if (isPublicNoteToken(existing)) {
    batch.delete(shareCollection().doc(existing));
  }
  batch.set(shareCollection().doc(token), {
    docId,
    tenantId,
    createdBy: uid,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.update(noteRef, { publicShare: { token, sharedAt: FieldValue.serverTimestamp() } });
  await batch.commit();

  return token;
}

/**
 * Stop sharing `docId`.
 *
 * THE SHARE RECORD GOES FIRST, AND THAT ORDER IS DELIBERATE. It is the only
 * thing a reader consults, so deleting it is the moment the link dies; clearing
 * the doc's own `publicShare` field afterwards is bookkeeping for the admin's
 * screen. If the second write failed, the note would show as shared while being
 * unreachable — visible and wrong, which is the safe way round. The reverse
 * order would show it as private while still resolving, which is the leak.
 */
export async function revokePublicNote(docId: string): Promise<void> {
  const noteRef = adminDb.collection('docs').doc(docId);
  const token = (await noteRef.get()).data()?.publicShare?.token;
  if (isPublicNoteToken(token)) {
    await shareCollection().doc(token).delete();
  }
  await noteRef.update({ publicShare: FieldValue.delete() });
}

/**
 * Resolve a token to a note, or `null`.
 *
 * EVERY `null` BELOW IS THE SAME `null` TO THE CALLER, and that is on
 * purpose: a malformed token, an unknown token, a revoked token and a note that
 * has since been deleted must all answer "no such page". Distinguishing them
 * would let anyone holding a candidate string learn whether it had ever been a
 * real link.
 *
 * THE SECOND CHECK IS NOT REDUNDANT. Having resolved the record, this reads
 * the note and confirms the note STILL POINTS BACK at this token. That is what
 * makes a stale record — one whose deletion half-failed, or whose note was
 * re-shared under a new token — fail closed rather than keep serving.
 */
export async function resolvePublicNote(token: unknown): Promise<PublicNote | null> {
  if (!isPublicNoteToken(token)) return null;

  const shareSnap = await shareCollection().doc(token).get();
  const share = shareSnap.data();
  if (!share || typeof share.docId !== 'string' || typeof share.tenantId !== 'string') return null;

  const noteSnap = await adminDb.collection('docs').doc(share.docId).get();
  const note = noteSnap.data();
  if (!note) return null;
  if (note.publicShare?.token !== token) return null;

  return {
    docId: share.docId,
    tenantId: share.tenantId,
    title: typeof note.title === 'string' && note.title.trim() ? note.title : 'Untitled',
    contentHtml: typeof note.content === 'string' ? note.content : '',
  };
}
