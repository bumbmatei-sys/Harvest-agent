import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, getReceiptsBucket } from '@/lib/firebase-admin';
import {
  assertConcreteScope,
  anonymiseByQuery,
  anonymisedDonorEmail,
  deleteByQuery,
  deleteRefs,
  emptyReport,
  record,
  retain,
  DELETED_DONOR_NAME,
  CHUNK_LIMIT,
  type DeletionReport,
} from '@/lib/member-deletion';

/**
 * ERASING ONE MEMBER'S DATA — the enumerated disposition of every collection.
 *
 * The audit that opened THE-76 put the number at "around 21 collections". The
 * schema has moved since. Re-derived here from firestore.rules plus every
 * `collection(...)` call in `src/`, the app has **58 collections and
 * subcollections in total**, of which **37 store a uid, an email, a name or a
 * photo URL**. Those 37 split three ways:
 *
 *   • 25 hold data belonging to a specific member and are ACTED ON — 19 swept,
 *     6 anonymised. Each is an entry in {@link MEMBER_DATA_MAP} below.
 *   • 3 hold member data with NO usable member key, and are named as gaps
 *     rather than guessed at (livestream prayers, the two SMS delivery logs).
 *   • 9 hold only an admin's `createdBy`/`authorId` uid on church-owned content
 *     — blog posts, courses, docs, events, newsletters and the like — which is
 *     an unresolvable reference once the profile is gone, not member data.
 *
 * MEMBER_DATA_MAP is the enumeration, one entry per collection, each carrying
 * its own disposition and the reason for it. The route does not hold a second
 * list — it iterates this one, so a collection cannot be swept without being
 * documented, or documented without being swept.
 *
 * ── The three decisions this file makes ─────────────────────────────────────
 *
 * 1. DONATIONS SURVIVE, ANONYMISED. A church needs its giving history to close
 *    its books and a donor needs the receipt for their tax return; erasing a
 *    donor must not destroy either. So every financial record is kept whole —
 *    amount, currency, date, receipt number, stored PDF — and only the identity
 *    on it is replaced: `recipientName` becomes 'Deleted donor' and
 *    `recipientEmail` becomes a stable one-way pseudonym. NOT blanked: the
 *    giving-statement generator groups by that field and skips empty ones, so a
 *    cleared email would drop the gifts out of the church's year-end statement.
 *    See `anonymisedDonorEmail`.
 *
 * 2. AUTHORED COMMUNITY CONTENT IS DELETED — posts, comments AND prayer
 *    requests, one rule for all three. Keeping them "attributed to a removed
 *    user" sounds gentler but isn't: every one of these documents carries the
 *    author's NAME and PHOTO denormalised into it (`authorName`/`authorPhoto`),
 *    so retention would mean rewriting each doc to strip them — anonymisation
 *    under another name, leaving content whose thread context is already broken.
 *    And unlike a donation there is no accounting or legal duty to keep a prayer
 *    request. The consistency requirement is met by treating the three the same.
 *
 * 3. MESSAGES HAVE TWO PARTIES, so the two halves are treated differently. The
 *    deleted member's own messages (`dmMessages`, `channelMessages` they sent)
 *    are deleted — their words are their data. The THREAD (`directMessages`) is
 *    not: deleting it would destroy the other party's copy of a conversation
 *    they never asked to lose, including their own sent messages. The thread is
 *    anonymised instead — the deleted member's display name becomes 'Deleted
 *    member' and any last-message preview they wrote is cleared, so the surviving
 *    party keeps their history with an unresolvable counterpart.
 *
 * 4. A SWEEP THAT COULD NOT FINISH IS NOT A SUCCESS (THE-229). Twelve sweeps
 *    took a single `.limit(CHUNK_LIMIT)` page and iterated it with no outer
 *    loop, so a member who liked more than one page of posts kept their uid on
 *    the remainder — and the report said 'complete', because that word was a
 *    hardcoded literal. Every sweep is now cursor-paged to a declared cap, and
 *    'complete' has to survive the run: a sweep that stops at a cap is named in
 *    `failures` and flips the status to 'partial', exactly as a throwing one
 *    already was. The route maps 'partial' to a 500 and leaves the profile and
 *    the sign-in alone, so the member keeps the credential that drives a retry —
 *    and every sweep is idempotent, so the retry resumes rather than restarts.
 *
 * ── Scoping ─────────────────────────────────────────────────────────────────
 * Every sweep is bounded by a value proven concrete through
 * {@link assertConcreteScope} — either the member's own tenant id or their own
 * uid/email. Nothing here can run with a null scope; see that function's note on
 * why null is the catastrophic case.
 */

/** How a collection is treated when the member who appears in it is deleted. */
export type Disposition =
  /** Every matching document is hard-deleted. */
  | 'delete'
  /** The document survives; the identifying fields on it are overwritten. */
  | 'anonymise'
  /** Nothing is written — the reason says whether that is by choice or by force. */
  | 'retain';

export interface MemberDataEntry {
  /** Path label as it appears in the report and in the tests. */
  collection: string;
  disposition: Disposition;
  /** Which identifying fields the collection stores. */
  holds: string;
  /** Why this disposition, in the words a reviewer needs. */
  reason: string;
  /**
   * The sweep. Absent for `retain` entries, which by definition write nothing.
   * Returns how many documents it touched.
   */
  sweep?: (ctx: MemberContext) => Promise<number>;
  /**
   * The concrete collection paths this entry covers that hold member data with
   * NO usable member key — the gaps this module reports rather than guesses at.
   *
   * ⚠️ Machine-readable ON PURPOSE (THE-188). The reason text below already says
   * "GAP" in words, and the member EXPORT has to declare the same three
   * collections the erasure cannot reach. Parsing them back out of prose, or
   * splitting the `collection` label on its ' + ', would be a second
   * enumeration one edit away from disagreeing with this one. Present only on
   * the gap entries; absent everywhere else.
   */
  unkeyed?: readonly string[];
}

/** Everything a sweep needs, all of it proven concrete before the first write. */
export interface MemberContext {
  uid: string;
  /** Lowercased. Empty when the account carries no email at all. */
  email: string;
  /** The member's own tenant. Concrete — a null tenant never reaches here. */
  tenantId: string;
  /** CRM contact ids resolved for this member, used by the by-contact sweeps. */
  contactIds: string[];
  /**
   * Where a sweep stopped short, if it did. Supplied by {@link eraseMemberData}
   * and read back by it after each sweep; a sweep never reads it. Optional so
   * the route can go on building a context from the four values it knows.
   */
  scan?: ScanState;
}

/**
 * The one thing a sweep has to be able to say other than a count: "there was
 * more, and I did not reach it".
 *
 * 🔴 A COUNT CANNOT CARRY THIS. `clearPostLikes` returning 400 is indis-
 * tinguishable from a member who liked exactly 400 posts and one who liked
 * 40,000 — which is precisely how a sweep that stopped at a page boundary used
 * to be reported as a success. The reason is recorded in words, in the first
 * cap a sweep hits, and {@link eraseMemberData} turns it into a named failure.
 */
export interface ScanState {
  /** Why the sweep could not finish, in the words the report will carry. */
  stoppedAt: string | null;
}

/** The display name a deleted member leaves behind on other people's records. */
export const DELETED_MEMBER_NAME = 'Deleted member';

const lower = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/** `tenants/{tenantId}` — built once from a scope that has been proven concrete. */
function tenantRef(tenantId: string) {
  return adminDb.collection('tenants').doc(assertConcreteScope(tenantId, 'tenantId'));
}

// ─────────────────────────────────────────────────────────────────────────────────
// Paging — THE-229
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Documents a single sweep will visit before it stops and SAYS it stopped.
 *
 * 🔴 A RUNAWAY GUARD, NOT A POLICY. It is deliberately far above any real
 * member's row count in any one collection — the largest realistic figure here
 * is a decade of one person's giving — so in production a sweep finishes and
 * this is never reached. What it buys is the guarantee that a sweep terminates
 * even against a pathological collection, and that when it does stop early the
 * run is reported `partial` rather than `complete`.
 *
 * Same number and same reasoning as `SECTION_ROW_CAP` in member-export.ts, which
 * bounds the read half of the same 25 collections.
 */
export const SWEEP_SCAN_CAP = 5000;

/**
 * Parent documents a two-level sweep will walk before it stops and says so.
 *
 * `checkinSessions/{id}/attendees`, `forms/{id}/submissions` and
 * `livestreamSessions/{id}/comments` have no member key of their own, so the
 * only way to reach them is to walk their parents under the concrete tenant path
 * and sub-query each one. That cost scales with how long the CHURCH has been
 * running, not with how much the member did — which is why it gets a bound of
 * its own, lower than {@link SWEEP_SCAN_CAP} because each parent costs a whole
 * extra query rather than one document. Matches `PARENT_SCAN_CAP` in
 * member-export.ts, which walks the same parents for the same reason.
 */
export const PARENT_SCAN_CAP = 2000;

/** Documents collected by a paged scan, and whether there were more. */
interface Scan {
  docs: FirebaseFirestore.QueryDocumentSnapshot[];
  truncated: boolean;
}

/**
 * Page a query with a cursor and return every document it matches, to a cap.
 *
 * 🔴 THIS IS THE DEFECT THE TICKET NAMES. Twelve sweeps took a single
 * `.limit(CHUNK_LIMIT).get()` and iterated it — no outer loop — so a member who
 * liked more than one page of posts kept their uid on the remainder and was told
 * the erasure was complete.
 *
 * ⚠️ THE PAGE SIZE IS {@link CHUNK_LIMIT} AND THAT IS NOT A READ BOUND.
 * CHUNK_LIMIT is 400 because Firestore's WriteBatch hard-caps at 500 operations;
 * it doubles as the page size so that one page maps to exactly one commit.
 * Paging the read does not lift the write ceiling — it is what keeps the two
 * aligned, so a sweep that now visits 2,000 documents still commits them 400 at
 * a time. Every write below goes through {@link updateInBatches},
 * `deleteRefs` or `deleteByQuery`, all of which chunk at the same bound.
 *
 * Cursor-paged rather than re-queried: the same shape as `anonymiseByQuery` in
 * member-deletion.ts and `pageQuery` in member-export.ts. A re-query loop — the
 * shape `deleteByQuery` and `clearCommunityPosts` use — only terminates because
 * the write REMOVES each match from the result set, which is true of a delete and
 * false of every sweep below that reads before it writes, or that skips documents
 * behind an in-memory tenant guard. Firestore orders a filtered query by document
 * key when nothing else is given, so `startAfter` needs no `orderBy` and no
 * composite index — which matters here, because a missing one fails silently.
 */
async function pageAll(query: FirebaseFirestore.Query, cap: number): Promise<Scan> {
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    const page = cursor ? query.startAfter(cursor).limit(CHUNK_LIMIT) : query.limit(CHUNK_LIMIT);
    const snap = await page.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      if (docs.length >= cap) return { docs, truncated: true };
      docs.push(d as FirebaseFirestore.QueryDocumentSnapshot);
    }
    if (snap.size < CHUNK_LIMIT) break;
    cursor = snap.docs[snap.docs.length - 1] as FirebaseFirestore.QueryDocumentSnapshot;
  }
  return { docs, truncated: false };
}

/**
 * Run a paged scan and, if it hit its cap, record WHY on the run's scan state.
 *
 * The sweep goes on to act on the documents it did reach — clearing 5,000 of a
 * member's likes and saying so beats clearing none — but the run can no longer
 * report itself complete. Only the FIRST cap a sweep hits is kept: it is the one
 * that explains the shortfall, and the ones after it are its consequence.
 */
async function scan(
  ctx: MemberContext,
  query: FirebaseFirestore.Query,
  cap: number,
  what: string,
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const result = await pageAll(query, cap);
  if (result.truncated && ctx.scan && ctx.scan.stoppedAt === null) {
    ctx.scan.stoppedAt =
      `stopped after ${result.docs.length} ${what} — more matched than one run of this sweep will visit`;
  }
  return result.docs;
}

/**
 * Overwrite fields on a known set of documents, chunked to stay under the cap.
 *
 * The write counterpart of {@link scan}, and the reason paging the reads does not
 * blow the request budget: the sweeps below used to `await` one `update()` per
 * document, so a member with 2,000 likes meant 2,000 sequential round trips.
 * Batched at {@link CHUNK_LIMIT} that is five commits. Same bound, same reason,
 * as `deleteRefs`.
 */
async function updateInBatches(
  targets: Array<{ ref: FirebaseFirestore.DocumentReference; patch: Record<string, unknown> }>,
): Promise<number> {
  for (let i = 0; i < targets.length; i += CHUNK_LIMIT) {
    const slice = targets.slice(i, i + CHUNK_LIMIT);
    const batch = adminDb.batch();
    slice.forEach((t) => batch.update(t.ref, t.patch));
    await batch.commit();
  }
  return targets.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sweeps that need more than a single query
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Anonymise the member's donation invoices in their own tenant.
 *
 * The query is a single-field `type == 'donation_receipt'` under the concrete
 * tenant path; the email match happens in memory because the webhook stores
 * `recipientEmail` only trimmed, never lowercased, so its casing is whatever the
 * donor typed at Stripe checkout. That is exactly how /api/donation-history and
 * the giving-statement generator read the same collection — matching the same
 * way here is what keeps the three consistent.
 *
 * Idempotent: a row already carrying the pseudonym no longer matches the
 * member's real email, so a second run finds nothing and changes nothing.
 */
async function anonymiseDonations(ctx: MemberContext): Promise<number> {
  if (!ctx.email) return 0;
  const pseudonym = anonymisedDonorEmail(ctx.uid, ctx.tenantId);
  return anonymiseByQuery(
    tenantRef(ctx.tenantId).collection('invoices').where('type', '==', 'donation_receipt'),
    (data) => {
      if (lower(data.recipientEmail) !== ctx.email) return null;
      return {
        recipientName: DELETED_DONOR_NAME,
        recipientEmail: pseudonym,
        // The flag the giving-statement generator reads to keep GENERATING the
        // statement while never trying to EMAIL a deleted donor.
        donorDeleted: true,
        donorDeletedAt: new Date().toISOString(),
      };
    },
  );
}

/**
 * Anonymise any giving statements already issued to the member.
 *
 * These are the church's copies of a tax document, so they are kept for the same
 * reason the invoices are. `donorId` (derived from the old email) is left alone:
 * it is the key of the stored PDF's path, and rewriting it would orphan the file
 * without erasing anything — the id is already a one-way slug.
 */
async function anonymiseGivingStatements(ctx: MemberContext): Promise<number> {
  if (!ctx.email) return 0;
  const pseudonym = anonymisedDonorEmail(ctx.uid, ctx.tenantId);
  return anonymiseByQuery(
    tenantRef(ctx.tenantId).collection('givingStatements'),
    (data) => {
      if (lower(data.donorEmail) !== ctx.email) return null;
      return { donorEmail: pseudonym, donorName: DELETED_DONOR_NAME, donorDeleted: true };
    },
  );
}

/** Pledges are a recorded financial commitment to the church — kept, de-identified. */
async function anonymisePledges(ctx: MemberContext): Promise<number> {
  if (!ctx.email) return 0;
  const pseudonym = anonymisedDonorEmail(ctx.uid, ctx.tenantId);
  return anonymiseByQuery(tenantRef(ctx.tenantId).collection('pledges'), (data) => {
    if (lower(data.donorEmail) !== ctx.email) return null;
    return { donorName: DELETED_DONOR_NAME, donorEmail: pseudonym, donorPhone: null, notes: '', donorDeleted: true };
  });
}

/**
 * The CRM contact row.
 *
 * A contact with giving history is the church's donor record — its
 * `totalDonated` and `lastDonationAt` are what the CRM's pipeline and totals are
 * computed from, so deleting it would take money off the church's books to
 * satisfy an erasure request. Those rows are anonymised. A contact with no
 * giving history is nothing but the member's name, email and phone, so it is
 * deleted outright.
 */
async function clearContacts(ctx: MemberContext): Promise<number> {
  // BOTH scans complete before either writes. Anonymising a donor row clears its
  // `userId` and `email`, so a row written during the walk would drop out of the
  // very query still being paged — the reads are finished first so the cursor
  // only ever advances over documents nothing has touched.
  const byUid = await scan(
    ctx,
    adminDb.collection('contacts').where('userId', '==', assertConcreteScope(ctx.uid, 'uid')),
    SWEEP_SCAN_CAP,
    'contact rows keyed by uid',
  );
  const byEmail = ctx.email
    ? await scan(
        ctx,
        adminDb.collection('contacts').where('email', '==', assertConcreteScope(ctx.email, 'email')),
        SWEEP_SCAN_CAP,
        'contact rows keyed by email',
      )
    : [];

  const seen = new Set<string>();
  const toDelete: FirebaseFirestore.DocumentReference[] = [];
  const toAnonymise: Array<{ ref: FirebaseFirestore.DocumentReference; patch: Record<string, unknown> }> = [];

  for (const d of [...byUid, ...byEmail]) {
    if (seen.has(d.id)) continue;
    const data = d.data() ?? {};
    // The queries above are single-field, so the tenant match is applied here —
    // the same shape the donation webhook and check-in route use.
    if ((data.tenantId ?? null) !== ctx.tenantId) continue;
    seen.add(d.id);
    if (Number(data.totalDonated) > 0) {
      toAnonymise.push({
        ref: d.ref,
        patch: {
          firstName: DELETED_DONOR_NAME, lastName: '', email: '', phone: '',
          notes: '', tags: [], userId: '', donorDeleted: true,
        },
      });
    } else {
      toDelete.push(d.ref);
    }
  }
  return (await deleteRefs(toDelete)) + (await updateInBatches(toAnonymise));
}

/**
 * CRM timeline entries.
 *
 * A 'donation' activity is a ledger line — it carries the amount that the
 * church's giving history is read from, so it stays. Everything else (notes,
 * meetings, emails, form submissions) is free text that routinely embeds the
 * member's name, email and phone straight out of a form answer, so it goes.
 */
async function clearContactActivities(ctx: MemberContext): Promise<number> {
  let removed = 0;
  for (const contactId of ctx.contactIds) {
    removed += await deleteByQuery(
      adminDb.collection('contactActivities')
        .where('contactId', '==', assertConcreteScope(contactId, 'contactId')),
      (data) => (data.tenantId ?? null) === ctx.tenantId && data.type !== 'donation',
    );
  }
  return removed;
}

/**
 * The member's own posts, taken with their comment threads.
 *
 * recursiveDelete per matched post rather than a plain batch delete: a post's
 * comments are a SUBcollection, and a batch delete of the parent leaves them
 * orphaned — unreachable, still holding every commenter's name and photo.
 */
async function clearCommunityPosts(ctx: MemberContext): Promise<number> {
  const coll = adminDb.collection('community_posts');
  let removed = 0;
  for (;;) {
    // Page smaller than CHUNK_LIMIT: each match spawns its own recursive walk,
    // so this bounds how many run at once.
    const snap = await coll
      .where('authorId', '==', assertConcreteScope(ctx.uid, 'uid'))
      .limit(50)
      .get();
    if (snap.empty) break;
    const mine = snap.docs.filter((d) => (d.data()?.tenantId ?? null) === ctx.tenantId);
    await Promise.all(mine.map((d) => adminDb.recursiveDelete(d.ref)));
    removed += mine.length;
    if (snap.size < 50 || mine.length === 0) break;
  }
  return removed;
}

/**
 * Comments the member left on OTHER people's posts.
 *
 * A collection-group query keyed on `authorId`, not on tenant. That is
 * deliberate and it is the one shape of unscoped-looking query this module
 * allows: a uid is globally unique and belongs to exactly the member being
 * deleted, so `authorId == uid` cannot over-match by construction — it is a
 * TIGHTER bound than a tenant filter, not a looser one. The alternative, walking
 * every post in the tenant and sub-querying its comments, is thousands of reads
 * for the same result. Single-field collection-group indexes are automatic, so
 * firestore.indexes.json is untouched.
 *
 * ⚠️ THE GROUP ALSO MATCHES `livestreamSessions/{id}/comments`, which carries
 * `authorId` too. On the EXPORT that was a real bug — livestream comments came
 * back inside the feed-comments section. Here the consequence is confined to the
 * report: both collections are 'delete', both are keyed on the same uid, and this
 * entry runs first, so the rows are correctly gone either way — but their count
 * lands under `community_posts/{id}/comments`, and the livestream entry that runs
 * later finds nothing left and reports 0. The map keeps its own livestream sweep
 * regardless: it is the entry that documents the collection, and dropping it
 * would take the collection out of MEMBER_DATA_MAP — the sole enumeration, which
 * the export's `assertExportCoversMap` checks itself against.
 */
async function clearCommunityComments(ctx: MemberContext): Promise<number> {
  return deleteByQuery(
    adminDb.collectionGroup('comments')
      .where('authorId', '==', assertConcreteScope(ctx.uid, 'uid')),
  );
}

/**
 * The member's RSVPs, likes and poll votes on posts that are NOT theirs.
 *
 * `eventDetails.attendeeDetails` is the one that matters: it stores
 * `{uid, name, email}` — a member's full identity embedded inside somebody
 * else's document, which no amount of deleting their own posts would reach.
 */
async function clearPostParticipation(ctx: MemberContext): Promise<number> {
  const uid = assertConcreteScope(ctx.uid, 'uid');
  const docs = await scan(
    ctx,
    adminDb.collection('community_posts').where('eventDetails.attendees', 'array-contains', uid),
    SWEEP_SCAN_CAP,
    'posts the member RSVPd to',
  );
  const updates: Array<{ ref: FirebaseFirestore.DocumentReference; patch: Record<string, unknown> }> = [];
  for (const d of docs) {
    const data = d.data() ?? {};
    if ((data.tenantId ?? null) !== ctx.tenantId) continue;
    const details = (data.eventDetails as { attendeeDetails?: { uid?: string }[] } | undefined)?.attendeeDetails;
    const mine = (details ?? []).filter((a) => a?.uid === uid);
    updates.push({
      ref: d.ref,
      patch: {
        'eventDetails.attendees': FieldValue.arrayRemove(uid),
        ...(mine.length > 0 ? { 'eventDetails.attendeeDetails': FieldValue.arrayRemove(...mine) } : {}),
      },
    });
  }
  return updateInBatches(updates);
}

/** Likes are a bare uid array on other people's posts — the uid is removed. */
async function clearPostLikes(ctx: MemberContext): Promise<number> {
  const uid = assertConcreteScope(ctx.uid, 'uid');
  const docs = await scan(
    ctx,
    adminDb.collection('community_posts').where('likes', 'array-contains', uid),
    SWEEP_SCAN_CAP,
    'posts the member liked',
  );
  return updateInBatches(
    docs
      .filter((d) => ((d.data() ?? {}).tenantId ?? null) === ctx.tenantId)
      .map((d) => ({ ref: d.ref, patch: { likes: FieldValue.arrayRemove(uid) } })),
  );
}

/** `prayedBy` on other members' prayer requests is the same shape as `likes`. */
async function clearPrayedBy(ctx: MemberContext): Promise<number> {
  const uid = assertConcreteScope(ctx.uid, 'uid');
  const docs = await scan(
    ctx,
    adminDb.collection('prayer_requests').where('prayedBy', 'array-contains', uid),
    SWEEP_SCAN_CAP,
    'prayer requests the member prayed for',
  );
  return updateInBatches(
    docs
      .filter((d) => ((d.data() ?? {}).tenantId ?? null) === ctx.tenantId)
      .map((d) => ({ ref: d.ref, patch: { prayedBy: FieldValue.arrayRemove(uid) } })),
  );
}

/**
 * Certificates, and the PDF each one points at.
 *
 * The doc id is `{uid}_{courseId}` and the stored file is
 * `receipts/{tenantId}/certificates/{certId}.pdf`. A certificate carries the
 * learner's name in the document AND rendered into the PDF, so removing the row
 * without the file would leave the name readable to anyone holding a signed URL.
 * The bucket delete is best-effort per file: a storage failure must not strand
 * the Firestore half, and the run reports what it cleared either way.
 */
async function clearCertificates(ctx: MemberContext): Promise<number> {
  const docs = await scan(
    ctx,
    adminDb.collection('certificates').where('uid', '==', assertConcreteScope(ctx.uid, 'uid')),
    SWEEP_SCAN_CAP,
    'certificates',
  );
  const refs: FirebaseFirestore.DocumentReference[] = [];
  for (const d of docs) {
    const data = d.data() ?? {};
    const pdfPath = typeof data.pdfPath === 'string' ? data.pdfPath : '';
    if (pdfPath) {
      try {
        await getReceiptsBucket().file(pdfPath).delete({ ignoreNotFound: true });
      } catch {
        // Reported through the collection's own failure entry if it matters;
        // never a reason to leave the document holding the learner's name.
      }
    }
    refs.push(d.ref);
  }
  return deleteRefs(refs);
}

/** `chat_usage/{uid}` — the doc id IS the uid, so this is a point delete. */
async function clearChatUsage(ctx: MemberContext): Promise<number> {
  await adminDb.collection('chat_usage').doc(assertConcreteScope(ctx.uid, 'uid')).delete();
  return 1;
}

/**
 * Support / feature / bug reports the member filed.
 *
 * ⚠️ `platform_inbox` carries `fromTenantId` but its own write path documents
 * that field as "context only, NOT a scoping key", and the public marketing form
 * writes it as null. So it CANNOT be tenant-scoped — and does not need to be:
 * `userId == uid` is a tighter bound than a tenant filter would be, and these
 * rows carry `userEmail` and a free-text message besides.
 */
async function clearPlatformInbox(ctx: MemberContext): Promise<number> {
  return deleteByQuery(
    adminDb.collection('platform_inbox')
      .where('userId', '==', assertConcreteScope(ctx.uid, 'uid')),
  );
}

/** Per-member OAuth connections. The doc id embeds the uid, so these are point deletes. */
async function clearIntegrations(ctx: MemberContext): Promise<number> {
  const uid = assertConcreteScope(ctx.uid, 'uid');
  const coll = tenantRef(ctx.tenantId).collection('integrations');
  let removed = 0;
  for (const provider of ['gmail', 'instagram', 'mailchimp', 'quickbooks']) {
    const ref = coll.doc(`${uid}_${provider}`);
    const snap = await ref.get();
    if (!snap.exists) continue;
    await ref.delete();
    removed += 1;
  }
  return removed;
}

/** Event registrations — name, email and phone, matched by uid and by email. */
async function clearRegistrations(ctx: MemberContext): Promise<number> {
  const coll = tenantRef(ctx.tenantId).collection('registrations');
  let removed = await deleteByQuery(
    coll.where('userId', '==', assertConcreteScope(ctx.uid, 'uid')),
  );
  if (ctx.email) {
    removed += await deleteByQuery(
      coll.where('email', '==', assertConcreteScope(ctx.email, 'email')),
    );
  }
  return removed;
}

/**
 * Check-in attendee rows.
 *
 * ⚠️ An attendee row has NO uid — check-in is open to walk-ups, so the only
 * handle is the email typed at the door. It is also two levels down
 * (`checkinSessions/{id}/attendees`), and the row carries no tenantId of its
 * own, so a collection-group sweep could not be tenant-scoped. Both problems are
 * solved the same way: walk the sessions under the CONCRETE tenant path and
 * sub-query each one, so every query is bounded by the tenant it came from.
 */
async function clearCheckinAttendees(ctx: MemberContext): Promise<number> {
  if (!ctx.email) return 0;
  const email = assertConcreteScope(ctx.email, 'email');
  const sessions = await scan(
    ctx,
    tenantRef(ctx.tenantId).collection('checkinSessions'),
    PARENT_SCAN_CAP,
    'check-in sessions',
  );
  let removed = 0;
  for (const session of sessions) {
    removed += await deleteByQuery(session.ref.collection('attendees').where('email', '==', email));
  }
  return removed;
}

/**
 * Form submissions.
 *
 * ⚠️ Same shape as check-in: a submission stores the member's answers (name,
 * email, phone — whatever the form asked) plus their IP, but no uid. The handle
 * is `crmContactId`, resolved before the contact rows were touched. Forms are
 * walked under the concrete tenant path for the same reason.
 */
async function clearFormSubmissions(ctx: MemberContext): Promise<number> {
  if (ctx.contactIds.length === 0) return 0;
  const forms = await scan(ctx, tenantRef(ctx.tenantId).collection('forms'), PARENT_SCAN_CAP, 'forms');
  let removed = 0;
  for (const form of forms) {
    for (const contactId of ctx.contactIds) {
      removed += await deleteByQuery(
        form.ref.collection('submissions')
          .where('crmContactId', '==', assertConcreteScope(contactId, 'contactId')),
      );
    }
  }
  return removed;
}

/** Livestream comments carry `authorId` and the display name typed alongside. */
async function clearLivestreamComments(ctx: MemberContext): Promise<number> {
  const uid = assertConcreteScope(ctx.uid, 'uid');
  const sessions = await scan(
    ctx,
    tenantRef(ctx.tenantId).collection('livestreamSessions'),
    PARENT_SCAN_CAP,
    'livestream sessions',
  );
  let removed = 0;
  for (const session of sessions) {
    removed += await deleteByQuery(session.ref.collection('comments').where('authorId', '==', uid));
  }
  return removed;
}

/** Messages the member sent, in DMs and in channels. Their words, their data. */
async function clearSentMessages(ctx: MemberContext): Promise<number> {
  const uid = assertConcreteScope(ctx.uid, 'uid');
  const t = tenantRef(ctx.tenantId);
  return (
    (await deleteByQuery(t.collection('dmMessages').where('senderId', '==', uid))) +
    (await deleteByQuery(t.collection('channelMessages').where('senderId', '==', uid)))
  );
}

/**
 * The DM threads themselves — anonymised, never deleted.
 *
 * The other party did not ask for anything. Deleting the thread would take their
 * own sent messages with it; keeping it whole but stripping the deleted member's
 * display name leaves them their history beside an unresolvable counterpart. The
 * `participants` uid stays because that array is how the surviving member's
 * `array-contains` query finds the thread at all, and a uid with no `users` doc
 * behind it resolves to nothing.
 */
async function anonymiseDmThreads(ctx: MemberContext): Promise<number> {
  const uid = assertConcreteScope(ctx.uid, 'uid');
  return anonymiseByQuery(
    tenantRef(ctx.tenantId).collection('directMessages').where('participants', 'array-contains', uid),
    (data) => {
      const names = (data.participantNames ?? {}) as Record<string, unknown>;
      if (names[uid] === DELETED_MEMBER_NAME) return null; // already anonymised
      return {
        [`participantNames.${uid}`]: DELETED_MEMBER_NAME,
        // A preview the deleted member wrote would otherwise keep their words on
        // the thread list after every message of theirs is gone.
        ...(data.lastMessageBy === uid || data.initiatedBy === uid ? { lastMessage: '' } : {}),
      };
    },
  );
}

/** Channel membership is a uid array — the member is removed from each. */
async function clearChannelMembership(ctx: MemberContext): Promise<number> {
  const uid = assertConcreteScope(ctx.uid, 'uid');
  const docs = await scan(
    ctx,
    tenantRef(ctx.tenantId).collection('channels').where('members', 'array-contains', uid),
    SWEEP_SCAN_CAP,
    'channels the member belongs to',
  );
  return updateInBatches(docs.map((d) => ({ ref: d.ref, patch: { members: FieldValue.arrayRemove(uid) } })));
}

/**
 * Canvases the member drew.
 *
 * The canvas is the church's working document, so it stays; `createdByName`
 * is the member's display name copied onto it, so that goes. `createdBy` keeps
 * the uid, which is unresolvable once `users/{uid}` is gone.
 */
async function anonymiseCanvases(ctx: MemberContext): Promise<number> {
  return anonymiseByQuery(
    tenantRef(ctx.tenantId).collection('canvases')
      .where('createdBy', '==', assertConcreteScope(ctx.uid, 'uid')),
    () => ({ createdByName: DELETED_MEMBER_NAME }),
  );
}

/**
 * A church-directory listing the member enrolled.
 *
 * The listing is the church's record, not the member's, so it survives — but its
 * `userId` points straight back at the person, so that link is cut.
 */
async function anonymiseChurchListings(ctx: MemberContext): Promise<number> {
  return anonymiseByQuery(
    adminDb.collection('churches').where('userId', '==', assertConcreteScope(ctx.uid, 'uid')),
    (data) => ((data.tenantId ?? null) === ctx.tenantId ? { userId: null } : null),
  );
}

/** Prayer requests the member wrote. Deleted, like their posts and comments. */
async function clearPrayerRequests(ctx: MemberContext): Promise<number> {
  return deleteByQuery(
    adminDb.collection('prayer_requests')
      .where('authorId', '==', assertConcreteScope(ctx.uid, 'uid')),
    (data) => (data.tenantId ?? null) === ctx.tenantId,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The enumeration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every collection and subcollection that stores a uid, an email, a name or a
 * photo URL, with its disposition. Tests iterate this list, so an entry cannot
 * be added without an assertion covering it.
 */
export const MEMBER_DATA_MAP: MemberDataEntry[] = [
  // ── Deleted ───────────────────────────────────────────────────────────────
  {
    collection: 'community_posts',
    disposition: 'delete',
    holds: 'authorId, authorName, authorPhoto, content',
    reason: 'Authored content — deleted, consistently with comments and prayer requests.',
    sweep: clearCommunityPosts,
  },
  {
    collection: 'community_posts/{id}/comments',
    disposition: 'delete',
    holds: 'authorId, authorName, authorPhoto, content',
    reason: 'Authored content. Swept by uid across posts the member does not own.',
    sweep: clearCommunityComments,
  },
  {
    collection: 'prayer_requests',
    disposition: 'delete',
    holds: 'authorId, authorName, request text',
    reason: 'Authored content, and the most personal of the three.',
    sweep: clearPrayerRequests,
  },
  {
    collection: 'community_posts.eventDetails',
    disposition: 'delete',
    holds: 'attendees[uid], attendeeDetails[{uid,name,email}]',
    reason: "An RSVP embeds the member's name and email inside somebody else's post.",
    sweep: clearPostParticipation,
  },
  {
    collection: 'community_posts.likes',
    disposition: 'delete',
    holds: 'likes[uid]',
    reason: "The member's uid on other people's posts.",
    sweep: clearPostLikes,
  },
  {
    collection: 'prayer_requests.prayedBy',
    disposition: 'delete',
    holds: 'prayedBy[uid]',
    reason: "The member's uid on other people's prayer requests.",
    sweep: clearPrayedBy,
  },
  {
    collection: 'certificates',
    disposition: 'delete',
    holds: 'uid, learnerName, pdfPath',
    reason: 'Learner name in the doc AND rendered into the stored PDF — both removed.',
    sweep: clearCertificates,
  },
  {
    collection: 'chat_usage',
    disposition: 'delete',
    holds: 'doc id = uid',
    reason: 'Per-member AI usage counter, keyed by uid.',
    sweep: clearChatUsage,
  },
  {
    collection: 'platform_inbox',
    disposition: 'delete',
    holds: 'userId, userEmail, data.name, data.email, message',
    reason: 'Support tickets the member filed. Keyed by uid — fromTenantId is not a scoping key.',
    sweep: clearPlatformInbox,
  },
  {
    collection: 'contacts',
    disposition: 'delete',
    holds: 'firstName, lastName, email, phone, notes, userId',
    reason: 'Deleted when there is no giving history; anonymised when there is (see below).',
    sweep: clearContacts,
  },
  {
    collection: 'contactActivities',
    disposition: 'delete',
    holds: 'contactId, free-text description embedding form answers',
    reason: "Non-donation timeline entries. 'donation' rows are retained — they are the ledger.",
    sweep: clearContactActivities,
  },
  {
    collection: 'tenants/{t}/registrations',
    disposition: 'delete',
    holds: 'userId, name, firstName, lastName, email, phone',
    reason: 'Event registration details, matched by uid and by email.',
    sweep: clearRegistrations,
  },
  {
    collection: 'tenants/{t}/checkinSessions/{id}/attendees',
    disposition: 'delete',
    holds: 'firstName, lastName, email',
    reason: 'No uid on the row — matched by email, walked per session under the tenant path.',
    sweep: clearCheckinAttendees,
  },
  {
    collection: 'tenants/{t}/forms/{id}/submissions',
    disposition: 'delete',
    holds: 'answers (name/email/phone), ipAddress, crmContactId',
    reason: 'No uid on the row — matched by the CRM contact id resolved before contacts were cleared.',
    sweep: clearFormSubmissions,
  },
  {
    collection: 'tenants/{t}/livestreamSessions/{id}/comments',
    disposition: 'delete',
    holds: 'authorId, name, text',
    reason: 'Authored content, same rule as feed comments.',
    sweep: clearLivestreamComments,
  },
  {
    collection: 'tenants/{t}/dmMessages + channelMessages',
    disposition: 'delete',
    holds: 'senderId, senderName, content',
    reason: "Messages the member sent. Their words are their data; the thread is kept for the other party.",
    sweep: clearSentMessages,
  },
  {
    collection: 'tenants/{t}/channels.members',
    disposition: 'delete',
    holds: 'members[uid]',
    reason: 'Channel membership is a bare uid array.',
    sweep: clearChannelMembership,
  },
  {
    collection: 'tenants/{t}/integrations',
    disposition: 'delete',
    holds: 'doc id = {uid}_{provider}, connectedBy, live OAuth grant',
    reason: "The member's own Gmail/Instagram/Mailchimp/QuickBooks connections.",
    sweep: clearIntegrations,
  },
  {
    collection: 'users',
    disposition: 'delete',
    holds: 'email, displayName, photoURL (base64), phone, savedItems, course progress, totalDonated',
    reason: 'The profile itself. Deleted by the route AFTER every sweep above reports clean.',
  },

  // ── Anonymised ────────────────────────────────────────────────────────────
  {
    collection: 'tenants/{t}/invoices',
    disposition: 'anonymise',
    holds: 'recipientName, recipientEmail',
    reason: "🔴 THE BOOKS. Amount, date, receipt number and stored PDF are kept whole; only the identity is replaced, with a stable pseudonym so the giving statement still groups the gifts.",
    sweep: anonymiseDonations,
  },
  {
    collection: 'tenants/{t}/givingStatements',
    disposition: 'anonymise',
    holds: 'donorEmail, donorName',
    reason: "The church's copy of an issued tax document. donorId is left alone — it keys the stored PDF and is already a one-way slug.",
    sweep: anonymiseGivingStatements,
  },
  {
    collection: 'tenants/{t}/pledges',
    disposition: 'anonymise',
    holds: 'donorName, donorEmail, donorPhone, notes',
    reason: 'A recorded financial commitment — kept for the same reason donations are.',
    sweep: anonymisePledges,
  },
  {
    collection: 'tenants/{t}/directMessages',
    disposition: 'anonymise',
    holds: 'participants[uid], participantNames{uid:name}, lastMessage',
    reason: 'Two-party thread. Deleting it would destroy the other party\'s own messages.',
    sweep: anonymiseDmThreads,
  },
  {
    collection: 'tenants/{t}/canvases',
    disposition: 'anonymise',
    holds: 'createdBy, createdByName',
    reason: "The church's working document; only the copied display name is removed.",
    sweep: anonymiseCanvases,
  },
  {
    collection: 'churches',
    disposition: 'anonymise',
    holds: 'userId',
    reason: "A directory listing owned by the church; the link back to the person is cut.",
    sweep: anonymiseChurchListings,
  },

  // ── Retained, on purpose ──────────────────────────────────────────────────
  {
    collection: 'contactActivities (type: donation)',
    disposition: 'retain',
    holds: 'amount, contactId',
    reason: "🔴 Ledger lines. Carry no name or email — deleting them would take money off the church's books.",
  },
  {
    collection: 'affiliate_commissions',
    disposition: 'retain',
    holds: 'referrerId (uid)',
    reason: 'Payout records. Carry no name or email; the uid is unresolvable once the profile is gone.',
  },
  {
    collection: 'blog_posts / courses / docs / docFolders / campaigns / events / newsletters / adoptedCourses',
    disposition: 'retain',
    holds: 'authorId / createdBy / adoptedBy (uid only)',
    reason: "Church-owned content authored by an admin. No name, email or photo — an unresolvable uid reference only.",
  },
  {
    collection: 'tenants/{t}/livestreamSessions/{id}/prayers',
    disposition: 'retain',
    holds: 'name (free text), prayerText',
    unkeyed: ['tenants/{t}/livestreamSessions/{id}/prayers'],
    reason:
      '⚠️ GAP. The write path stores no uid and no email — only a display name typed into the box — so a row cannot be attributed to a member without matching on a name, which would hit every other member sharing it. Reported rather than guessed at.',
  },
  {
    collection: 'tenants/{t}/smsLogs + smsBroadcasts/{id}/logs',
    disposition: 'retain',
    holds: 'phone',
    unkeyed: ['tenants/{t}/smsLogs', 'tenants/{t}/smsBroadcasts/{id}/logs'],
    reason:
      "⚠️ GAP. Delivery logs are keyed by phone number with no uid, and the member's phone lives on the users doc that is about to go. Reported; clearing them needs a phone-indexed sweep this PR does not add.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// The run
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the member's CRM contact ids before anything is deleted.
 *
 * `forms/{id}/submissions` and `checkinSessions/{id}/attendees` are reachable
 * only through `crmContactId`, so this has to run FIRST — once the contact rows
 * are gone the link is gone with them and those submissions become permanently
 * unreachable.
 *
 * ⚠️ THIS ONE REFUSES RATHER THAN TRUNCATES. Every sweep below can stop early
 * and report which collection it left behind, because the collection it stopped
 * in is the collection that is still dirty. A short contact-id list is not like
 * that: it makes the FORM and CHECK-IN sweeps quietly under-reach, and they would
 * report a clean count for rows they never queried — the exact silent failure
 * THE-229 exists to close. So hitting the cap here throws, before a single write,
 * and the route reports that the deletion could not start. The cap is far above
 * any real member: a person with 5,000 CRM rows in one church is a data problem,
 * not an erasure.
 */
export async function resolveContactIds(uid: string, email: string, tenantId: string): Promise<string[]> {
  assertConcreteScope(uid, 'uid');
  assertConcreteScope(tenantId, 'tenantId');
  const ids = new Set<string>();
  // A member with no manual contact row is surfaced in the CRM synthetically
  // under their own uid, and the donation webhook writes their activities under
  // that id — so the uid is itself a contact id.
  ids.add(uid);

  const collect = async (result: Scan, keyedBy: string) => {
    if (result.truncated) {
      throw new Error(
        `Refusing to erase: more than ${SWEEP_SCAN_CAP} CRM contact rows ${keyedBy} for this member. ` +
          'The form and check-in sweeps are reachable only through these ids, so a partial list would ' +
          'leave them silently unswept.',
      );
    }
    for (const d of result.docs) {
      if ((d.data()?.tenantId ?? null) === tenantId) ids.add(d.id);
    }
  };

  await collect(
    await pageAll(adminDb.collection('contacts').where('userId', '==', uid), SWEEP_SCAN_CAP),
    'keyed by uid',
  );
  if (email) {
    await collect(
      await pageAll(adminDb.collection('contacts').where('email', '==', email), SWEEP_SCAN_CAP),
      'keyed by email',
    );
  }
  return [...ids];
}

/**
 * Run every sweep in {@link MEMBER_DATA_MAP} and return what actually happened.
 *
 * ⚠️ A failing sweep does NOT abort the run — the member is better served by 24
 * of 25 collections cleared plus a report naming the 25th than by a run that
 * stops at the first error and says nothing about the rest. The caller must
 * treat `status: 'partial'` as a non-2xx and must NOT go on to delete the
 * profile document or the Auth account: leaving those in place is what keeps the
 * member's own credential alive to drive an (idempotent) retry.
 */
export async function eraseMemberData(ctx: MemberContext): Promise<DeletionReport> {
  assertConcreteScope(ctx.uid, 'uid');
  assertConcreteScope(ctx.tenantId, 'tenantId');

  // 🔴 'complete' IS A STARTING VALUE, NOT A CLAIM. It used to be a hardcoded
  // literal on the way out, which is why a sweep that stopped at a page boundary
  // still reported success. It now has to SURVIVE the loop: a throw flips it
  // through `record`, and a sweep that hit a scan cap flips it through
  // `noteIncomplete` below. Nothing else can leave it where it started.
  const report = emptyReport();

  // Handed to every sweep and read back after each one. Reset per entry so a
  // stop is attributed to the collection that actually stopped.
  const scanState: ScanState = { stoppedAt: null };
  const runCtx: MemberContext = { ...ctx, scan: scanState };

  for (const entry of MEMBER_DATA_MAP) {
    if (entry.disposition === 'retain') {
      retain(report, entry.collection, entry.reason);
      continue;
    }
    if (!entry.sweep) continue; // `users` is deleted by the route itself, last.
    scanState.stoppedAt = null;
    await record(
      report,
      entry.collection,
      () => entry.sweep!(runCtx),
      entry.disposition === 'anonymise' ? 'anonymised' : 'cleared',
    );
    if (scanState.stoppedAt) noteIncomplete(report, entry.collection, scanState.stoppedAt);
  }

  return report;
}

/**
 * Record a sweep that RAN but could not finish, in the same shape as one that threw.
 *
 * 🔴 THE HONESTY GUARD. `record` already turns a thrown sweep into a named
 * failure and a `partial` status; a sweep that stopped at a cap did not throw, so
 * it would otherwise land in the report as a plain count — indistinguishable from
 * one that finished. This is the second door into the same room, and it is
 * deliberately the same room: one `status`, one `failures` list, one `error`
 * sentence, so the route's existing `status === 'partial'` check catches both
 * without knowing there are two ways to get there.
 *
 * The count `record` already stored is KEPT. A run that cleared 5,000 likes and
 * could not reach the rest reports both the 5,000 and the shortfall — a truthful
 * partial, which is the whole point, rather than a zero that understates the work
 * or a success that hides it.
 */
function noteIncomplete(report: DeletionReport, collection: string, why: string): void {
  report.failures.push({
    collection,
    message: `Incomplete — ${why}. Re-run the deletion to continue; every sweep is idempotent.`,
  });
  report.status = 'partial';
  report.error = `Deletion was incomplete — ${report.failures.length} collection(s) could not be cleared.`;
}
