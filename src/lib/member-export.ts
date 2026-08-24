import { adminDb } from '@/lib/firebase-admin';
import { assertConcreteScope } from '@/lib/member-deletion';
import {
  MEMBER_DATA_MAP,
  type Disposition,
  type MemberContext,
  type MemberDataEntry,
} from '@/lib/member-erasure';

/**
 * THE-188 — A MEMBER TAKES THEIR OWN DATA WITH THEM.
 *
 * ─── The sequencing error this closes ────────────────────────────────────────
 *
 * 🔴 PR 354 shipped ERASURE. A member can now remove themselves from 25
 * collections, and a super admin can remove a whole church. Nothing shipped that
 * lets either of them take a copy first. PR 354's own audit is the evidence: the
 * only reads that exist are per-surface — a member's own donation history, the
 * admin CSVs inside AdminCheckin and AdminForms, the giving statements. There is
 * no "everything you hold about me" path anywhere in the product.
 *
 * That is the wrong half of the pair to have shipped first. GDPR Art. 20 (data
 * portability) and Art. 15 (subject access) are the rights the DELETE route's
 * Art. 17 counterpart sits beside, and REP-4's archived-tenant decision is built
 * on the same premise — the church is the data controller and its data is never
 * held hostage. This module is the missing half for the MEMBER.
 *
 * ─── 🔴 ONE ENUMERATION, NOT TWO ─────────────────────────────────────────────
 *
 * The export does NOT carry its own list of collections. {@link MEMBER_DATA_MAP}
 * is the app's single enumeration of which of its 58 collections and
 * subcollections hold member data, and {@link buildExportPlan} WALKS IT — every
 * section in an export is an entry in that map, in that map's order.
 *
 * Two enumerations of the same 58 collections would drift, and the drifted one
 * would be the export: erasure is exercised by a member deleting their account
 * and noticing something survived, while an incomplete export looks exactly like
 * a complete one. So {@link MEMBER_EXPORT_DECISIONS} is a lookup keyed by the
 * map's own labels, and {@link assertExportCoversMap} refuses — loudly, at the
 * top of every run — if the two sets differ in either direction:
 *
 *   • a collection in the map with no export decision  → throws by name
 *   • a decision naming a collection not in the map    → throws by name
 *
 * Adding a collection to the erasure therefore breaks the export until somebody
 * writes down what the export does with it. That is the property, and it is
 * checked at runtime rather than trusted.
 *
 * ─── ⚠️ THE EXPORT IS NOT THE MIRROR IMAGE OF THE ERASURE ────────────────────
 *
 * Every asymmetry below is deliberate and each is recorded, per section, in the
 * exported document itself (`erasure` alongside `disposition`), so a reader can
 * see both answers for one collection side by side:
 *
 *   DELETED BUT NOT EXPORTED
 *   • `tenants/{t}/integrations` — the erasure deletes the member's live OAuth
 *     grants. The export returns the FACT of each connection (provider, when,
 *     status) and never `connectedAccountId`. A downloadable file containing a
 *     live credential handle is an exfiltration primitive, not a data right.
 *     Allowlisted field by field, so a new field on that document is omitted by
 *     default rather than leaked by default.
 *   • `certificates` — the erasure deletes the row AND the rendered PDF. The
 *     export returns the row and the PDF's path; it does not inline the bytes.
 *   • other people's comments on the member's own posts — `recursiveDelete`
 *     takes them with the post, because they are unreachable afterwards. They
 *     are somebody else's words and are not the member's to download.
 *   • the other party's half of a DM thread — the erasure keeps the thread and
 *     anonymises it; the export returns thread metadata and the member's OWN
 *     sent messages, never the counterpart's.
 *
 *   EXPORTED BUT NOT DELETED
 *   • `contactActivities` of type 'donation' — RETAINED by the erasure (they are
 *     the church's ledger and carry no name). They are still the member's giving
 *     history, so subject access returns them.
 *   • `affiliate_commissions` — RETAINED by the erasure for the same reason. If
 *     the member is the referrer, those are their earnings.
 *   • `tenants/{t}/invoices`, `givingStatements`, `pledges` — ANONYMISED, never
 *     deleted. Exported in full while the member is still the subject.
 *
 * ─── ⚠️ THE THREE COLLECTIONS THAT CANNOT BE EXPORTED AT ALL ─────────────────
 *
 * PR 354 found three collections holding member data with no usable member key
 * and reported them as gaps rather than guessing: livestream `prayers` (a
 * free-text display name only), `smsLogs` and `smsBroadcasts/{id}/logs` (a phone
 * number only). The export inherits the gap exactly — and DECLARES it, in a
 * `gaps` array on the document, read from `MEMBER_DATA_MAP[].unkeyed`. A
 * truncated or incomplete export that looks complete is worse than no export, so
 * nothing here is silently absent.
 *
 * ─── 🔴 NEVER GATED ──────────────────────────────────────────────────────────
 *
 * No plan check and no subscription check appears in this module or in its
 * route. `export` is on `NEVER_GATED` in tenant-lifecycle.ts, and the route asks
 * `tenantAllows(status, 'export')` rather than reading `status` itself — so an
 * ARCHIVED church, the case REP-4 exists for, exports everything a live one
 * does. See the route header.
 *
 * ─── 🔴 SCOPE ────────────────────────────────────────────────────────────────
 *
 * `getTenantScope()` returns null for a super admin, and on a READ null means
 * EVERY TENANT. On an export that is not a bug, it is a data breach: one
 * response containing every church's members. So every query here is built from
 * a value proven concrete by {@link assertConcreteScope} — the member's own
 * tenant id, their own uid, their own email, or a CRM contact id resolved from
 * those. A member with no tenant gets their profile and an explicit note that
 * the tenant-scoped sections were skipped; no query is ever built with a null
 * scope, exactly as in the erasure.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Bounds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Documents fetched per read. Matches CHUNK_LIMIT in member-deletion.ts so the
 * export pages the same collections at the same granularity the erasure does.
 */
export const EXPORT_PAGE = 400;

/**
 * Rows a single section will return before it declares itself truncated.
 *
 * 🔴 A CAP THAT LIES IS WORSE THAN NO EXPORT. Every section carries `truncated`
 * and `count`, and a truncated section says so in the document the member
 * downloads — it never comes back looking whole. 5,000 is far above any single
 * member's row count in any collection here (the biggest realistic section is a
 * decade of one person's giving), so this is a runaway guard, not a policy.
 */
export const SECTION_ROW_CAP = 5000;

/**
 * Parent documents scanned when a section lives two levels down —
 * `checkinSessions/{id}/attendees`, `forms/{id}/submissions`,
 * `livestreamSessions/{id}/comments`. Those have no member key of their own, so
 * the only way to reach them is to walk their parents under the concrete tenant
 * path and sub-query each one.
 *
 * ⚠️ Paged with a cursor to this bound and DECLARED when it is hit. (The erasure
 * takes a single `.limit(400)` page of the same parents and says nothing if
 * there are more — see the PR notes.)
 */
export const PARENT_SCAN_CAP = 2000;

// ─────────────────────────────────────────────────────────────────────────────
// Shapes
// ─────────────────────────────────────────────────────────────────────────────

/** What the export does with one collection in {@link MEMBER_DATA_MAP}. */
export type ExportDisposition =
  /** The member's own rows, returned whole. */
  | 'export'
  /** The record exists and is named, but its content is not the member's to take. */
  | 'reference'
  /** Deliberately not exported, with the reason. Declared, never silent. */
  | 'omit'
  /** Holds member data that CANNOT be attributed to a member. Declared as a gap. */
  | 'gap';

/** Rows a collector produced, plus whether it had to stop early. */
export interface CollectResult {
  rows: unknown[];
  truncated?: boolean;
  /** Anything the reader needs to interpret these rows, in words. */
  note?: string;
}

/** Everything a collector needs — every field already proven concrete. */
export type MemberExportContext = MemberContext;

/** Counts documents read across a whole run, so the cost can be reported. */
export interface ReadBudget {
  reads: number;
}

export interface MemberExportDecision {
  disposition: ExportDisposition;
  /** Why this disposition, in the words a reviewer needs. */
  reason: string;
  /** Absent for `omit` and `gap`, which by definition return no rows. */
  collect?: (ctx: MemberExportContext, budget: ReadBudget) => Promise<CollectResult>;
  /**
   * This entry's rows are returned inside another section, named here.
   *
   * Used where the erasure splits one collection into two entries by disposition
   * ('donation' activities are retained, the rest deleted) but the export has no
   * reason to: it returns the member's whole timeline in one place. Recorded
   * rather than dropped, so the map entry still has a visible answer.
   */
  coveredBy?: string;
}

/** One collection's worth of an export, with BOTH dispositions on it. */
export interface MemberExportSection {
  /** The label from {@link MEMBER_DATA_MAP} — never a raw query. */
  collection: string;
  disposition: ExportDisposition;
  /** What the ERASURE does with the same collection. The asymmetry, in the row. */
  erasure: Disposition;
  reason: string;
  count: number;
  truncated: boolean;
  note?: string;
  rows: unknown[];
}

/** A collection holding member data that cannot be attributed to a member. */
export interface MemberExportGap {
  collection: string;
  reason: string;
}

/** What a member downloads. */
export interface MemberExportDocument {
  format: 'harvest.member-export';
  version: 1;
  generatedAt: string;
  subject: { uid: string; email: string; tenantId: string | null };
  /** 'partial' when any section failed. A partial export is never a 200. */
  status: 'complete' | 'partial';
  sections: MemberExportSection[];
  /** 🔴 The three unkeyed collections. Declared, never silently omitted. */
  gaps: MemberExportGap[];
  /** Collections deliberately not exported, each with its reason. */
  omitted: { collection: string; reason: string }[];
  /** Collections whose rows are returned inside another section. */
  covered: { collection: string; coveredBy: string; reason: string }[];
  failures: { collection: string; message: string }[];
  /** Documents read to build this export. Reported, not estimated. */
  reads: number;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading
// ─────────────────────────────────────────────────────────────────────────────

const lower = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/** `tenants/{tenantId}` — built once from a scope proven concrete. */
function tenantRef(tenantId: string) {
  return adminDb.collection('tenants').doc(assertConcreteScope(tenantId, 'tenantId'));
}

/**
 * Page a query to a cap and return every matching document.
 *
 * 🔴 CURSOR-PAGED, NOT ONE BIG READ. A church with 5,000 donations, or a member
 * with a decade of check-ins, must never land in one `get()` — Firestore would
 * return it, and the request would carry the whole collection in memory at once.
 * Pages of {@link EXPORT_PAGE} with `startAfter` on the last document of each
 * page; same shape as `anonymiseByQuery` in member-deletion.ts, which pages the
 * same collections the same way for the erasure.
 *
 * `pick` maps a document to an exported row and may return null to skip it —
 * that is where the in-memory ownership checks live (case-insensitive email,
 * tenant match) for the collections whose queries cannot express them.
 */
async function pageQuery(
  query: FirebaseFirestore.Query,
  budget: ReadBudget,
  pick: (id: string, data: Record<string, unknown>, path: string) => unknown | null,
  cap: number = SECTION_ROW_CAP,
): Promise<CollectResult> {
  const rows: unknown[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    const page = cursor ? query.startAfter(cursor).limit(EXPORT_PAGE) : query.limit(EXPORT_PAGE);
    const snap = await page.get();
    if (snap.empty) break;
    budget.reads += snap.size;
    for (const d of snap.docs) {
      const row = pick(d.id, (d.data() ?? {}) as Record<string, unknown>, d.ref.path);
      if (row === null || row === undefined) continue;
      if (rows.length >= cap) return { rows, truncated: true };
      rows.push(row);
    }
    if (snap.size < EXPORT_PAGE) break;
    cursor = snap.docs[snap.docs.length - 1] as FirebaseFirestore.QueryDocumentSnapshot;
  }
  return { rows, truncated: false };
}

/** Walk a tenant subcollection's parent documents, cursor-paged and capped. */
async function pageParents(
  query: FirebaseFirestore.Query,
  budget: ReadBudget,
): Promise<{ parents: FirebaseFirestore.QueryDocumentSnapshot[]; truncated: boolean }> {
  const parents: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    const page = cursor ? query.startAfter(cursor).limit(EXPORT_PAGE) : query.limit(EXPORT_PAGE);
    const snap = await page.get();
    if (snap.empty) break;
    budget.reads += snap.size;
    for (const d of snap.docs) {
      if (parents.length >= PARENT_SCAN_CAP) return { parents, truncated: true };
      parents.push(d as FirebaseFirestore.QueryDocumentSnapshot);
    }
    if (snap.size < EXPORT_PAGE) break;
    cursor = snap.docs[snap.docs.length - 1] as FirebaseFirestore.QueryDocumentSnapshot;
  }
  return { parents, truncated: false };
}

/** `{ id, ...data }` — the default row for a collection the member owns outright. */
const whole = (id: string, data: Record<string, unknown>) => ({ id, ...data });

/** Merge several collect results into one, de-duplicating by a row key. */
function merge(results: CollectResult[], keyOf: (row: unknown) => string): CollectResult {
  const seen = new Set<string>();
  const rows: unknown[] = [];
  let truncated = false;
  const notes: string[] = [];
  for (const r of results) {
    truncated = truncated || Boolean(r.truncated);
    if (r.note) notes.push(r.note);
    for (const row of r.rows) {
      const key = keyOf(row);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }
  return { rows, truncated, ...(notes.length > 0 ? { note: notes.join(' ') } : {}) };
}

const rowId = (row: unknown) => String((row as { id?: unknown })?.id ?? '');

// ─────────────────────────────────────────────────────────────────────────────
// The collectors, one per acted-on entry in MEMBER_DATA_MAP
// ─────────────────────────────────────────────────────────────────────────────

/** The profile itself — name, email, photo, saved items, course progress. */
async function collectProfile(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  const snap = await adminDb.collection('users').doc(assertConcreteScope(ctx.uid, 'uid')).get();
  budget.reads += 1;
  if (!snap.exists) return { rows: [] };
  return { rows: [whole(snap.id, (snap.data() ?? {}) as Record<string, unknown>)] };
}

/** The member's own posts. Their comment threads are other people's words. */
async function collectPosts(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  const result = await pageQuery(
    adminDb.collection('community_posts').where('authorId', '==', assertConcreteScope(ctx.uid, 'uid')),
    budget,
    (id, data) => ((data.tenantId ?? null) === ctx.tenantId ? whole(id, data) : null),
  );
  return {
    ...result,
    note:
      'Comments other members left on these posts are not included — they are those members’ own words. ' +
      'The erasure deletes them with the post because they become unreachable once it is gone.',
  };
}

/**
 * Feed comments the member left, on anybody's post.
 *
 * The same uid-keyed collection-group query the erasure walks — a uid is
 * globally unique and belongs to exactly this member, so `authorId == uid` is a
 * TIGHTER bound than a tenant filter, not a looser one.
 *
 * ⚠️ SCOPED BY PATH AS WELL, and that is not belt-and-braces. A collection group
 * matches EVERY subcollection whose leaf name is `comments` — which includes
 * `tenants/{t}/livestreamSessions/{id}/comments`. The erasure does not care: it
 * deletes both, and the livestream sweep deletes them again harmlessly. An
 * export does care, because the same comment would come back in two sections
 * under two different collection labels, and a member counting their rows would
 * be reading a duplicate. Feed comments live under `community_posts/` and only
 * there; the livestream ones are returned by their own collector.
 */
const FEED_COMMENT_PREFIX = 'community_posts/';

async function collectComments(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  return pageQuery(
    adminDb.collectionGroup('comments').where('authorId', '==', assertConcreteScope(ctx.uid, 'uid')),
    budget,
    (id, data, path) => {
      if (!path.startsWith(FEED_COMMENT_PREFIX)) return null;
      return { id, postId: path.slice(FEED_COMMENT_PREFIX.length).split('/')[0], ...data };
    },
  );
}

/** Prayer requests the member wrote. */
async function collectPrayerRequests(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  return pageQuery(
    adminDb.collection('prayer_requests').where('authorId', '==', assertConcreteScope(ctx.uid, 'uid')),
    budget,
    (id, data) => ((data.tenantId ?? null) === ctx.tenantId ? whole(id, data) : null),
  );
}

/**
 * RSVPs the member made on other people's posts.
 *
 * Reference-only. `attendeeDetails` on such a post is an array of EVERY
 * attendee's `{uid, name, email}`; returning the document whole would hand the
 * member a roster of everyone else who signed up. Only their own entry comes
 * back, beside the post it is on.
 */
async function collectRsvps(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  const uid = assertConcreteScope(ctx.uid, 'uid');
  return pageQuery(
    adminDb.collection('community_posts').where('eventDetails.attendees', 'array-contains', uid),
    budget,
    (id, data) => {
      if ((data.tenantId ?? null) !== ctx.tenantId) return null;
      const details = (data.eventDetails as { attendeeDetails?: { uid?: string }[] } | undefined)?.attendeeDetails;
      return {
        id,
        postTitle: data.title ?? null,
        myAttendeeDetails: (details ?? []).filter((a) => a?.uid === uid),
      };
    },
  );
}

/** Posts the member liked — the post is not theirs, so the row names it and stops. */
async function collectLikes(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  const uid = assertConcreteScope(ctx.uid, 'uid');
  return pageQuery(
    adminDb.collection('community_posts').where('likes', 'array-contains', uid),
    budget,
    (id, data) => ((data.tenantId ?? null) === ctx.tenantId ? { id, postTitle: data.title ?? null } : null),
  );
}

/** Prayer requests the member prayed for. Somebody else's request — named, not returned. */
async function collectPrayedFor(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  const uid = assertConcreteScope(ctx.uid, 'uid');
  return pageQuery(
    adminDb.collection('prayer_requests').where('prayedBy', 'array-contains', uid),
    budget,
    (id, data) => ((data.tenantId ?? null) === ctx.tenantId ? { id } : null),
  );
}

/**
 * Course certificates.
 *
 * The row and the PDF's storage path. NOT the PDF's bytes: a base64 PDF per
 * certificate would push a JSON response into megabytes for a file the member
 * can already download from the certificate surface. Declared in the note rather
 * than left for the reader to notice.
 */
async function collectCertificates(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  const result = await pageQuery(
    adminDb.collection('certificates').where('uid', '==', assertConcreteScope(ctx.uid, 'uid')),
    budget,
    whole,
  );
  return {
    ...result,
    note: 'The rendered PDF is referenced by `pdfPath`, not inlined. Download it from the certificate screen.',
  };
}

/** `chat_usage/{uid}` — the doc id IS the uid, so this is a point read. */
async function collectChatUsage(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  const snap = await adminDb.collection('chat_usage').doc(assertConcreteScope(ctx.uid, 'uid')).get();
  budget.reads += 1;
  return snap.exists ? { rows: [whole(snap.id, (snap.data() ?? {}) as Record<string, unknown>)] } : { rows: [] };
}

/** Support, feature and bug reports the member filed. Keyed by uid, as the erasure keys them. */
async function collectPlatformInbox(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  return pageQuery(
    adminDb.collection('platform_inbox').where('userId', '==', assertConcreteScope(ctx.uid, 'uid')),
    budget,
    whole,
  );
}

/** The member's CRM contact row(s) — matched by uid and by email, as the erasure matches them. */
async function collectContacts(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  const mine = (id: string, data: Record<string, unknown>) =>
    (data.tenantId ?? null) === ctx.tenantId ? whole(id, data) : null;
  const results = [
    await pageQuery(
      adminDb.collection('contacts').where('userId', '==', assertConcreteScope(ctx.uid, 'uid')),
      budget,
      mine,
    ),
  ];
  if (ctx.email) {
    results.push(
      await pageQuery(
        adminDb.collection('contacts').where('email', '==', assertConcreteScope(ctx.email, 'email')),
        budget,
        mine,
      ),
    );
  }
  return merge(results, rowId);
}

/**
 * The member's CRM timeline — INCLUDING the 'donation' rows.
 *
 * 🔴 THE CLEAREST ASYMMETRY. The erasure RETAINS donation activities: they are
 * ledger lines carrying an amount and no name, and deleting them would take
 * money off the church's books. None of that makes them stop being the member's
 * giving history, which is exactly what a subject-access request is for. Kept by
 * the erasure, returned by the export.
 */
async function collectContactActivities(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  const results: CollectResult[] = [];
  for (const contactId of ctx.contactIds) {
    results.push(
      await pageQuery(
        adminDb.collection('contactActivities').where('contactId', '==', assertConcreteScope(contactId, 'contactId')),
        budget,
        (id, data) => ((data.tenantId ?? null) === ctx.tenantId ? whole(id, data) : null),
      ),
    );
  }
  return {
    ...merge(results, rowId),
    note: "Includes 'donation' rows, which the erasure keeps as the church’s ledger.",
  };
}

/** Event registrations — matched by uid and by email, as the erasure matches them. */
async function collectRegistrations(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  const coll = tenantRef(ctx.tenantId).collection('registrations');
  const results = [
    await pageQuery(coll.where('userId', '==', assertConcreteScope(ctx.uid, 'uid')), budget, whole),
  ];
  if (ctx.email) {
    results.push(
      await pageQuery(coll.where('email', '==', assertConcreteScope(ctx.email, 'email')), budget, whole),
    );
  }
  return merge(results, rowId);
}

/**
 * Check-in rows.
 *
 * ⚠️ No uid on an attendee row — check-in is open to walk-ups, so the only handle
 * is the email typed at the door, and the row is two levels down with no
 * tenantId of its own. Both are solved the way the erasure solves them: walk the
 * sessions under the CONCRETE tenant path and sub-query each, so every query is
 * bounded by the tenant it came from.
 */
async function collectCheckins(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  if (!ctx.email) return { rows: [], note: 'This account carries no email, which is the only key a check-in row has.' };
  const email = assertConcreteScope(ctx.email, 'email');
  const { parents, truncated } = await pageParents(tenantRef(ctx.tenantId).collection('checkinSessions'), budget);
  const results: CollectResult[] = [];
  for (const session of parents) {
    results.push(
      await pageQuery(
        session.ref.collection('attendees').where('email', '==', email),
        budget,
        (id, data) => ({ id, sessionId: session.id, ...data }),
      ),
    );
  }
  const merged = merge(results, (row) => `${(row as { sessionId?: string }).sessionId}/${rowId(row)}`);
  return { ...merged, truncated: merged.truncated || truncated };
}

/**
 * Form submissions.
 *
 * ⚠️ Same shape as check-in: the answers carry the member's name, email, phone
 * and IP, but no uid. The handle is `crmContactId`, resolved up front.
 */
async function collectFormSubmissions(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  if (ctx.contactIds.length === 0) return { rows: [] };
  const { parents, truncated } = await pageParents(tenantRef(ctx.tenantId).collection('forms'), budget);
  const results: CollectResult[] = [];
  for (const form of parents) {
    for (const contactId of ctx.contactIds) {
      results.push(
        await pageQuery(
          form.ref.collection('submissions').where('crmContactId', '==', assertConcreteScope(contactId, 'contactId')),
          budget,
          (id, data) => ({ id, formId: form.id, ...data }),
        ),
      );
    }
  }
  const merged = merge(results, (row) => `${(row as { formId?: string }).formId}/${rowId(row)}`);
  return { ...merged, truncated: merged.truncated || truncated };
}

/** Livestream comments the member wrote, walked per session under the tenant path. */
async function collectLivestreamComments(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  const uid = assertConcreteScope(ctx.uid, 'uid');
  const { parents, truncated } = await pageParents(tenantRef(ctx.tenantId).collection('livestreamSessions'), budget);
  const results: CollectResult[] = [];
  for (const session of parents) {
    results.push(
      await pageQuery(
        session.ref.collection('comments').where('authorId', '==', uid),
        budget,
        (id, data) => ({ id, sessionId: session.id, ...data }),
      ),
    );
  }
  const merged = merge(results, (row) => `${(row as { sessionId?: string }).sessionId}/${rowId(row)}`);
  return { ...merged, truncated: merged.truncated || truncated };
}

/**
 * Messages the member SENT, in DMs and in channels.
 *
 * Their words, their data — and only their words. The counterpart's messages in
 * the same thread are that person's, and are not in this file.
 */
async function collectSentMessages(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  const uid = assertConcreteScope(ctx.uid, 'uid');
  const t = tenantRef(ctx.tenantId);
  const results = [
    await pageQuery(t.collection('dmMessages').where('senderId', '==', uid), budget, (id, data) => ({
      id, channel: 'dm', ...data,
    })),
    await pageQuery(t.collection('channelMessages').where('senderId', '==', uid), budget, (id, data) => ({
      id, channel: 'channel', ...data,
    })),
  ];
  return {
    ...merge(results, (row) => `${(row as { channel?: string }).channel}/${rowId(row)}`),
    note: 'Only messages this member sent. The other party’s messages are their own data.',
  };
}

/**
 * DM threads — metadata only.
 *
 * 🔴 The erasure's decision 3 says a thread has TWO parties and the counterpart
 * never asked for anything. The export takes the same line from the other side:
 * who the thread is with and when it started, never `lastMessage`, which may be
 * the other party's words.
 */
async function collectDmThreads(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  const uid = assertConcreteScope(ctx.uid, 'uid');
  const result = await pageQuery(
    tenantRef(ctx.tenantId).collection('directMessages').where('participants', 'array-contains', uid),
    budget,
    (id, data) => ({
      id,
      participants: data.participants ?? [],
      createdAt: data.createdAt ?? null,
      lastMessageAt: data.lastMessageAt ?? null,
    }),
  );
  return { ...result, note: 'Thread metadata only — message text is in the sent-messages section.' };
}

/** Channels the member belongs to. The channel is the church's; the membership is theirs. */
async function collectChannelMembership(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  const uid = assertConcreteScope(ctx.uid, 'uid');
  return pageQuery(
    tenantRef(ctx.tenantId).collection('channels').where('members', 'array-contains', uid),
    budget,
    (id, data) => ({ id, name: data.name ?? null }),
  );
}

/**
 * 🔴 OAUTH CONNECTIONS — THE FACT, NEVER THE CREDENTIAL.
 *
 * The erasure deletes these documents because they are the member's live grants
 * to Gmail, Instagram, Mailchimp and QuickBooks. The export returns that the
 * connection exists and when it was made, and stops there. `connectedAccountId`
 * is a live handle on the provider side; putting it in a file a member
 * downloads, mails to themselves and stores in a cloud drive turns a data right
 * into a credential leak.
 *
 * ⚠️ ALLOWLISTED, not redacted. A field added to this document tomorrow is
 * omitted by default rather than exported by default.
 */
async function collectIntegrations(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  const uid = assertConcreteScope(ctx.uid, 'uid');
  const coll = tenantRef(ctx.tenantId).collection('integrations');
  const rows: unknown[] = [];
  for (const provider of ['gmail', 'instagram', 'mailchimp', 'quickbooks']) {
    const snap = await coll.doc(`${uid}_${provider}`).get();
    budget.reads += 1;
    if (!snap.exists) continue;
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    rows.push({
      id: snap.id,
      provider,
      connectedAt: data.connectedAt ?? null,
      status: data.status ?? null,
      senderEmail: data.senderEmail ?? null,
    });
  }
  return {
    rows,
    note: 'The connection is named; its access credential is deliberately not exported.',
  };
}

/** Donation receipts — the section this whole module is weighted by. */
async function collectDonations(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  if (!ctx.email) return { rows: [], note: 'This account carries no email, which is how a receipt is keyed.' };
  return pageQuery(
    tenantRef(ctx.tenantId).collection('invoices').where('type', '==', 'donation_receipt'),
    budget,
    // Matched in memory, case-insensitively on both sides: the webhook stores
    // `recipientEmail` only trimmed, so its casing is whatever the donor typed at
    // Stripe checkout. Exactly how /api/donation-history and the erasure read the
    // same collection — matching the same way is what keeps the three consistent.
    (id, data) => (lower(data.recipientEmail) === ctx.email ? whole(id, data) : null),
  );
}

/** Year-end giving statements issued to the member. */
async function collectGivingStatements(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  if (!ctx.email) return { rows: [] };
  return pageQuery(
    tenantRef(ctx.tenantId).collection('givingStatements'),
    budget,
    (id, data) => (lower(data.donorEmail) === ctx.email ? whole(id, data) : null),
  );
}

/** Pledges the member made. */
async function collectPledges(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  if (!ctx.email) return { rows: [] };
  return pageQuery(
    tenantRef(ctx.tenantId).collection('pledges'),
    budget,
    (id, data) => (lower(data.donorEmail) === ctx.email ? whole(id, data) : null),
  );
}

/** Canvases the member drew — the church's working document, named not returned. */
async function collectCanvases(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  return pageQuery(
    tenantRef(ctx.tenantId).collection('canvases').where('createdBy', '==', assertConcreteScope(ctx.uid, 'uid')),
    budget,
    (id, data) => ({ id, title: data.title ?? null, createdAt: data.createdAt ?? null }),
  );
}

/** A church-directory listing the member enrolled. The listing is the church's. */
async function collectChurchListings(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  return pageQuery(
    adminDb.collection('churches').where('userId', '==', assertConcreteScope(ctx.uid, 'uid')),
    budget,
    (id, data) =>
      (data.tenantId ?? null) === ctx.tenantId ? { id, name: data.name ?? null, tenantId: data.tenantId ?? null } : null,
  );
}

/**
 * Affiliate commissions the member earned.
 *
 * 🔴 RETAINED by the erasure — a payout record carrying no name, only the
 * referrer's uid. Exported here, because if the member IS that referrer these
 * are their earnings. Keyed on `referrerId`, which is globally unique and
 * belongs to exactly this member, so it is a tighter bound than a tenant filter.
 */
async function collectAffiliateCommissions(ctx: MemberExportContext, budget: ReadBudget): Promise<CollectResult> {
  return pageQuery(
    adminDb.collection('affiliate_commissions').where('referrerId', '==', assertConcreteScope(ctx.uid, 'uid')),
    budget,
    whole,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The decision table — one entry per MEMBER_DATA_MAP label, checked at runtime
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What the export does with each collection the erasure enumerates.
 *
 * 🔴 KEYED BY {@link MEMBER_DATA_MAP}'s OWN LABELS. This is a lookup, not a
 * second list: {@link assertExportCoversMap} fails the run if the key set and
 * the map's label set differ in either direction, so this table cannot quietly
 * fall behind the erasure or quietly get ahead of it.
 */
export const MEMBER_EXPORT_DECISIONS: Record<string, MemberExportDecision> = {
  // ── Exported whole ────────────────────────────────────────────────────────
  users: {
    disposition: 'export',
    reason: 'The profile itself — name, email, photo, phone, saved items, course progress.',
    collect: collectProfile,
  },
  community_posts: {
    disposition: 'export',
    reason: 'Posts the member wrote. Comments on them belong to their authors and are not included.',
    collect: collectPosts,
  },
  'community_posts/{id}/comments': {
    disposition: 'export',
    reason: 'Comments the member left, anywhere. Same uid-keyed group query the erasure walks.',
    collect: collectComments,
  },
  prayer_requests: {
    disposition: 'export',
    reason: 'Prayer requests the member wrote — the most personal section here.',
    collect: collectPrayerRequests,
  },
  certificates: {
    disposition: 'export',
    reason: 'Course certificates. The rendered PDF is referenced by path, not inlined.',
    collect: collectCertificates,
  },
  chat_usage: {
    disposition: 'export',
    reason: "The member's own AI usage counter, keyed by uid.",
    collect: collectChatUsage,
  },
  platform_inbox: {
    disposition: 'export',
    reason: 'Support, feature and bug reports the member filed, with their message text.',
    collect: collectPlatformInbox,
  },
  contacts: {
    disposition: 'export',
    reason: "The member's CRM row — name, email, phone, notes, tags, giving totals.",
    collect: collectContacts,
  },
  contactActivities: {
    disposition: 'export',
    reason:
      "🔴 The member's whole CRM timeline INCLUDING 'donation' rows, which the erasure retains as the church's ledger.",
    collect: collectContactActivities,
  },
  'tenants/{t}/registrations': {
    disposition: 'export',
    reason: 'Event registrations, matched by uid and by email.',
    collect: collectRegistrations,
  },
  'tenants/{t}/checkinSessions/{id}/attendees': {
    disposition: 'export',
    reason: 'Check-in rows. No uid — matched by email, walked per session under the tenant path.',
    collect: collectCheckins,
  },
  'tenants/{t}/forms/{id}/submissions': {
    disposition: 'export',
    reason: 'Form answers the member submitted, matched by the CRM contact id.',
    collect: collectFormSubmissions,
  },
  'tenants/{t}/livestreamSessions/{id}/comments': {
    disposition: 'export',
    reason: 'Livestream comments the member wrote.',
    collect: collectLivestreamComments,
  },
  'tenants/{t}/dmMessages + channelMessages': {
    disposition: 'export',
    reason: 'Messages the member sent. Only theirs — the counterpart’s messages are that person’s data.',
    collect: collectSentMessages,
  },
  'tenants/{t}/invoices': {
    disposition: 'export',
    reason: '🔴 Donation receipts. Anonymised by the erasure, never deleted; exported in full to their subject.',
    collect: collectDonations,
  },
  'tenants/{t}/givingStatements': {
    disposition: 'export',
    reason: 'Year-end giving statements issued to the member.',
    collect: collectGivingStatements,
  },
  'tenants/{t}/pledges': {
    disposition: 'export',
    reason: 'Pledges the member made.',
    collect: collectPledges,
  },
  affiliate_commissions: {
    disposition: 'export',
    reason:
      '🔴 Retained by the erasure as a payout record carrying no name. If the member is the referrer these are their earnings, so subject access returns them.',
    collect: collectAffiliateCommissions,
  },

  // ── Named, not returned whole ─────────────────────────────────────────────
  'community_posts.eventDetails': {
    disposition: 'reference',
    reason:
      "The member's own RSVP on somebody else's post. `attendeeDetails` lists every attendee's name and email, so only their own entry comes back.",
    collect: collectRsvps,
  },
  'community_posts.likes': {
    disposition: 'reference',
    reason: 'Which posts the member liked. The posts are other members’ content.',
    collect: collectLikes,
  },
  'prayer_requests.prayedBy': {
    disposition: 'reference',
    reason: 'Which prayer requests the member prayed for. The requests are other members’ words.',
    collect: collectPrayedFor,
  },
  'tenants/{t}/directMessages': {
    disposition: 'reference',
    reason:
      '🔴 A two-party thread. Metadata only — never `lastMessage`, which may be the other party’s words. Their half of the conversation is not the member’s to download.',
    collect: collectDmThreads,
  },
  'tenants/{t}/channels.members': {
    disposition: 'reference',
    reason: 'Which channels the member belongs to. The channel itself is the church’s.',
    collect: collectChannelMembership,
  },
  'tenants/{t}/canvases': {
    disposition: 'reference',
    reason: 'The church’s working document, named so the member knows it carries their display name.',
    collect: collectCanvases,
  },
  churches: {
    disposition: 'reference',
    reason: 'A directory listing the member enrolled. Owned by the church, named here.',
    collect: collectChurchListings,
  },
  'tenants/{t}/integrations': {
    disposition: 'reference',
    reason:
      '🔴 The FACT of each OAuth connection, never its credential. A live grant handle in a downloadable file is an exfiltration primitive, not a data right.',
    collect: collectIntegrations,
  },

  // ── Covered inside another section ────────────────────────────────────────
  'contactActivities (type: donation)': {
    disposition: 'export',
    reason:
      "Returned inside the CRM timeline section — the export has no reason to split a member's timeline by a disposition that only the erasure needs.",
    coveredBy: 'contactActivities',
  },

  // ── Deliberately not exported ─────────────────────────────────────────────
  'blog_posts / courses / docs / docFolders / campaigns / events / newsletters / adoptedCourses': {
    disposition: 'omit',
    reason:
      "Church-owned content authored by an admin. Carries an unresolvable `createdBy`/`authorId` uid and no name, email or photo — the church's data, not the member's, and the same reason the erasure retains it.",
  },

  // ── 🔴 The gaps, declared ─────────────────────────────────────────────────
  'tenants/{t}/livestreamSessions/{id}/prayers': {
    disposition: 'gap',
    reason:
      '⚠️ CANNOT BE EXPORTED. The write path stores no uid and no email — only a display name typed into the box — so a row cannot be attributed to a member without matching on a name, which would return every other member sharing it. Named here rather than silently absent.',
  },
  'tenants/{t}/smsLogs + smsBroadcasts/{id}/logs': {
    disposition: 'gap',
    reason:
      "⚠️ CANNOT BE EXPORTED. Delivery logs are keyed by phone number with no uid. The member's phone is on their profile, so a phone-indexed sweep is possible — it is not built here, and the gap is reported rather than half-answered.",
  },
};

/**
 * Refuse to run unless the export's decisions and the erasure's map cover
 * exactly the same collections.
 *
 * 🔴 THE ANTI-DRIFT GUARD, and the reason this module has no list of its own.
 * Called at the top of every run and asserted directly by the tests. It throws
 * rather than returning a boolean a caller could forget to check, for the same
 * reason `assertConcreteScope` does.
 */
export function assertExportCoversMap(map: readonly MemberDataEntry[] = MEMBER_DATA_MAP): void {
  const labels = new Set(map.map((e) => e.collection));
  const decided = new Set(Object.keys(MEMBER_EXPORT_DECISIONS));

  const undecided = [...labels].filter((l) => !decided.has(l));
  if (undecided.length > 0) {
    throw new Error(
      `The export has no decision for ${undecided.length} collection(s) the erasure walks: ${undecided.join(', ')}. ` +
        'Every entry in MEMBER_DATA_MAP must say what the export does with it.',
    );
  }

  const orphaned = [...decided].filter((l) => !labels.has(l));
  if (orphaned.length > 0) {
    throw new Error(
      `The export decides ${orphaned.length} collection(s) the erasure does not enumerate: ${orphaned.join(', ')}. ` +
        'MEMBER_DATA_MAP is the enumeration; a decision outside it is a second list.',
    );
  }

  const covers = Object.entries(MEMBER_EXPORT_DECISIONS).filter(([, d]) => d.coveredBy);
  for (const [label, d] of covers) {
    if (!labels.has(d.coveredBy as string)) {
      throw new Error(`${label} says it is covered by ${d.coveredBy}, which is not a collection in MEMBER_DATA_MAP.`);
    }
  }
}

/** The decision for one map entry, or a throw naming the entry that has none. */
export function exportDecisionFor(entry: MemberDataEntry): MemberExportDecision {
  const decision = MEMBER_EXPORT_DECISIONS[entry.collection];
  if (!decision) {
    throw new Error(`No export decision for ${entry.collection}. MEMBER_DATA_MAP and the export table disagree.`);
  }
  return decision;
}

/** The map's gap collections, at COLLECTION granularity — three of them today. */
export function exportGaps(map: readonly MemberDataEntry[] = MEMBER_DATA_MAP): MemberExportGap[] {
  const gaps: MemberExportGap[] = [];
  for (const entry of map) {
    const decision = exportDecisionFor(entry);
    if (decision.disposition !== 'gap') continue;
    // `unkeyed` is the machine-readable list of the actual paths this entry
    // covers; one entry can name two collections (the SMS logs).
    for (const collection of entry.unkeyed ?? [entry.collection]) {
      gaps.push({ collection, reason: decision.reason });
    }
  }
  return gaps;
}

// ─────────────────────────────────────────────────────────────────────────────
// The run
// ─────────────────────────────────────────────────────────────────────────────

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Tenant-scoped labels are skipped, by name, for a member with no tenant. */
const isTenantScoped = (label: string) => label.startsWith('tenants/{t}/');

/**
 * Build the member's export by walking {@link MEMBER_DATA_MAP} in its own order.
 *
 * ⚠️ A FAILING SECTION DOES NOT ABORT THE RUN, and does not pass as success
 * either. It is recorded against the collection BY NAME, the document flips to
 * `status: 'partial'`, and the route maps that to a non-2xx — same contract the
 * erasure's report established. A member is better served by 24 of 25 sections
 * plus a named failure than by a file that stops at the first error, and far
 * better than by one that looks whole and is not.
 */
export async function exportMemberData(ctx: MemberExportContext): Promise<MemberExportDocument> {
  assertExportCoversMap();
  assertConcreteScope(ctx.uid, 'uid');

  const hasTenant = typeof ctx.tenantId === 'string' && ctx.tenantId.trim() !== '';
  const budget: ReadBudget = { reads: 0 };

  const doc: MemberExportDocument = {
    format: 'harvest.member-export',
    version: 1,
    generatedAt: new Date().toISOString(),
    subject: { uid: ctx.uid, email: ctx.email, tenantId: hasTenant ? ctx.tenantId : null },
    status: 'complete',
    sections: [],
    gaps: exportGaps(),
    omitted: [],
    covered: [],
    failures: [],
    reads: 0,
  };

  for (const entry of MEMBER_DATA_MAP) {
    const decision = exportDecisionFor(entry);

    if (decision.disposition === 'gap') continue; // already declared in `gaps`
    if (decision.disposition === 'omit') {
      doc.omitted.push({ collection: entry.collection, reason: decision.reason });
      continue;
    }
    if (decision.coveredBy) {
      doc.covered.push({
        collection: entry.collection,
        coveredBy: decision.coveredBy,
        reason: decision.reason,
      });
      continue;
    }
    if (!decision.collect) continue;

    const section: MemberExportSection = {
      collection: entry.collection,
      disposition: decision.disposition,
      erasure: entry.disposition,
      reason: decision.reason,
      count: 0,
      truncated: false,
      rows: [],
    };

    // 🔴 A tenant-scoped section is SKIPPED BY NAME rather than run with a null
    // scope. Same rule the erasure follows, for the same reason: on a read a
    // null tenant means every tenant, which on an export is a breach.
    if (!hasTenant && isTenantScoped(entry.collection)) {
      section.note = 'Skipped — this account carries no tenant, so it has no tenant-scoped data.';
      doc.sections.push(section);
      continue;
    }

    try {
      const result = await decision.collect(ctx, budget);
      section.rows = result.rows;
      section.count = result.rows.length;
      section.truncated = Boolean(result.truncated);
      if (result.note) section.note = result.note;
    } catch (e) {
      doc.failures.push({ collection: entry.collection, message: errMsg(e) });
      doc.status = 'partial';
    }
    doc.sections.push(section);
  }

  doc.reads = budget.reads;
  if (doc.failures.length > 0) {
    doc.status = 'partial';
    doc.error = `Your export is incomplete — ${doc.failures.length} section(s) could not be read.`;
  }
  return doc;
}
