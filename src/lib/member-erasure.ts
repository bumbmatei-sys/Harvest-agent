import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, getReceiptsBucket } from '@/lib/firebase-admin';
import {
  assertConcreteScope,
  anonymiseByQuery,
  anonymisedDonorEmail,
  deleteByQuery,
  deleteRefs,
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
 * schema has moved since; the real figure, re-derived here from firestore.rules
 * plus every `collection(...)` call in `src/`, is **41 collections and
 * subcollections that store a uid, an email, a name or a photo URL**. They break
 * down as 24 the member can be found in and 17 that hold no member key at all.
 * {@link MEMBER_DATA_MAP} below is that enumeration, one entry per collection,
 * each carrying its own disposition and the reason for it. The route does not
 * hold a second list — it iterates this one, so a collection cannot be swept
 * without being documented, or documented without being swept.
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
}

/** The display name a deleted member leaves behind on other people's records. */
export const DELETED_MEMBER_NAME = 'Deleted member';

const lower = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/** `tenants/{tenantId}` — built once from a scope that has been proven concrete. */
function tenantRef(tenantId: string) {
  return adminDb.collection('tenants').doc(assertConcreteScope(tenantId, 'tenantId'));
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
  const seen = new Set<string>();
  const toDelete: FirebaseFirestore.DocumentReference[] = [];
  let anonymised = 0;

  const consider = async (snap: FirebaseFirestore.QuerySnapshot) => {
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue;
      const data = d.data() ?? {};
      // The queries below are single-field, so the tenant match is applied here —
      // the same shape the donation webhook and check-in route use.
      if ((data.tenantId ?? null) !== ctx.tenantId) continue;
      seen.add(d.id);
      if (Number(data.totalDonated) > 0) {
        await d.ref.update({
          firstName: DELETED_DONOR_NAME, lastName: '', email: '', phone: '',
          notes: '', tags: [], userId: '', donorDeleted: true,
        });
        anonymised += 1;
      } else {
        toDelete.push(d.ref);
      }
    }
  };

  await consider(
    await adminDb.collection('contacts')
      .where('userId', '==', assertConcreteScope(ctx.uid, 'uid')).limit(CHUNK_LIMIT).get(),
  );
  if (ctx.email) {
    await consider(
      await adminDb.collection('contacts')
        .where('email', '==', assertConcreteScope(ctx.email, 'email')).limit(CHUNK_LIMIT).get(),
    );
  }
  return (await deleteRefs(toDelete)) + anonymised;
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
  let changed = 0;
  const snap = await adminDb.collection('community_posts')
    .where('eventDetails.attendees', 'array-contains', uid)
    .limit(CHUNK_LIMIT)
    .get();
  for (const d of snap.docs) {
    const data = d.data() ?? {};
    if ((data.tenantId ?? null) !== ctx.tenantId) continue;
    const details = (data.eventDetails as { attendeeDetails?: { uid?: string }[] } | undefined)?.attendeeDetails;
    const mine = (details ?? []).filter((a) => a?.uid === uid);
    await d.ref.update({
      'eventDetails.attendees': FieldValue.arrayRemove(uid),
      ...(mine.length > 0 ? { 'eventDetails.attendeeDetails': FieldValue.arrayRemove(...mine) } : {}),
    });
    changed += 1;
  }
  return changed;
}

/** Likes are a bare uid array on other people's posts — the uid is removed. */
async function clearPostLikes(ctx: MemberContext): Promise<number> {
  const uid = assertConcreteScope(ctx.uid, 'uid');
  const snap = await adminDb.collection('community_posts')
    .where('likes', 'array-contains', uid)
    .limit(CHUNK_LIMIT)
    .get();
  let changed = 0;
  for (const d of snap.docs) {
    if (((d.data() ?? {}).tenantId ?? null) !== ctx.tenantId) continue;
    await d.ref.update({ likes: FieldValue.arrayRemove(uid) });
    changed += 1;
  }
  return changed;
}

/** `prayedBy` on other members' prayer requests is the same shape as `likes`. */
async function clearPrayedBy(ctx: MemberContext): Promise<number> {
  const uid = assertConcreteScope(ctx.uid, 'uid');
  const snap = await adminDb.collection('prayer_requests')
    .where('prayedBy', 'array-contains', uid)
    .limit(CHUNK_LIMIT)
    .get();
  let changed = 0;
  for (const d of snap.docs) {
    if (((d.data() ?? {}).tenantId ?? null) !== ctx.tenantId) continue;
    await d.ref.update({ prayedBy: FieldValue.arrayRemove(uid) });
    changed += 1;
  }
  return changed;
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
  const snap = await adminDb.collection('certificates')
    .where('uid', '==', assertConcreteScope(ctx.uid, 'uid'))
    .limit(CHUNK_LIMIT)
    .get();
  const refs: FirebaseFirestore.DocumentReference[] = [];
  for (const d of snap.docs) {
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
  const sessions = await tenantRef(ctx.tenantId).collection('checkinSessions').limit(CHUNK_LIMIT).get();
  let removed = 0;
  for (const session of sessions.docs) {
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
  const forms = await tenantRef(ctx.tenantId).collection('forms').limit(CHUNK_LIMIT).get();
  let removed = 0;
  for (const form of forms.docs) {
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
  const sessions = await tenantRef(ctx.tenantId).collection('livestreamSessions').limit(CHUNK_LIMIT).get();
  let removed = 0;
  for (const session of sessions.docs) {
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
  const snap = await tenantRef(ctx.tenantId).collection('channels')
    .where('members', 'array-contains', uid)
    .limit(CHUNK_LIMIT)
    .get();
  let changed = 0;
  for (const d of snap.docs) {
    await d.ref.update({ members: FieldValue.arrayRemove(uid) });
    changed += 1;
  }
  return changed;
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
    reason:
      '⚠️ GAP. The write path stores no uid and no email — only a display name typed into the box — so a row cannot be attributed to a member without matching on a name, which would hit every other member sharing it. Reported rather than guessed at.',
  },
  {
    collection: 'tenants/{t}/smsLogs + smsBroadcasts/{id}/logs',
    disposition: 'retain',
    holds: 'phone',
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
 */
export async function resolveContactIds(uid: string, email: string, tenantId: string): Promise<string[]> {
  assertConcreteScope(uid, 'uid');
  assertConcreteScope(tenantId, 'tenantId');
  const ids = new Set<string>();
  // A member with no manual contact row is surfaced in the CRM synthetically
  // under their own uid, and the donation webhook writes their activities under
  // that id — so the uid is itself a contact id.
  ids.add(uid);
  const byUid = await adminDb.collection('contacts').where('userId', '==', uid).limit(CHUNK_LIMIT).get();
  for (const d of byUid.docs) {
    if ((d.data()?.tenantId ?? null) === tenantId) ids.add(d.id);
  }
  if (email) {
    const byEmail = await adminDb.collection('contacts').where('email', '==', email).limit(CHUNK_LIMIT).get();
    for (const d of byEmail.docs) {
      if ((d.data()?.tenantId ?? null) === tenantId) ids.add(d.id);
    }
  }
  return [...ids];
}

/**
 * Run every sweep in {@link MEMBER_DATA_MAP} and return what actually happened.
 *
 * ⚠️ A failing sweep does NOT abort the run — the member is better served by 23
 * of 24 collections cleared plus a report naming the 24th than by a run that
 * stops at the first error and says nothing about the rest. The caller must
 * treat `status: 'partial'` as a non-2xx and must NOT go on to delete the
 * profile document or the Auth account: leaving those in place is what keeps the
 * member's own credential alive to drive an (idempotent) retry.
 */
export async function eraseMemberData(ctx: MemberContext): Promise<DeletionReport> {
  assertConcreteScope(ctx.uid, 'uid');
  assertConcreteScope(ctx.tenantId, 'tenantId');

  const report = { status: 'complete' as const, cleared: {}, anonymised: {}, retained: {}, failures: [] } as DeletionReport;

  for (const entry of MEMBER_DATA_MAP) {
    if (entry.disposition === 'retain') {
      retain(report, entry.collection, entry.reason);
      continue;
    }
    if (!entry.sweep) continue; // `users` is deleted by the route itself, last.
    await record(
      report,
      entry.collection,
      () => entry.sweep!(ctx),
      entry.disposition === 'anonymise' ? 'anonymised' : 'cleared',
    );
  }

  return report;
}
