import type { Disposition, MemberDataEntry } from '@/lib/member-erasure';

/**
 * WHAT THE DELETE CONFIRMATION SAYS — derived from MEMBER_DATA_MAP, never
 * written out beside it.
 *
 * ─── 🔴 THE DEFECT THIS MODULE EXISTS TO END (THE-230) ───────────────────────
 *
 * The confirm panel used to tell a member, at the irreversible tap:
 *
 *   "This deletes your profile and your sign-in. Records your ministry holds —
 *    giving history, event registrations, check-ins, prayer requests and
 *    community posts — stay in their records; ask an admin to remove those."
 *
 * Four of those five were DELETED, not kept: `tenants/{t}/registrations`,
 * `tenants/{t}/checkinSessions/{id}/attendees`, `prayer_requests` and
 * `community_posts` are all `disposition: 'delete'`. The sentence was true when
 * it was written — the route removed `users/{uid}` and the Auth account and
 * nothing else — and PR 354 made it false by making the route real, without
 * anybody thinking to walk back down to the copy.
 *
 * That is the failure mode this module is shaped against. A hand-written
 * sentence beside a machine-read map goes stale silently and in the one
 * direction that cannot be forgiven: it promised RETENTION for data that is
 * DESTROYED. A member who wanted their posts to remain for the church, and
 * accepted deletion on that basis, lost them.
 *
 * ─── HOW THE COPY IS DERIVED, AND WHY THIS IS NOT A SECOND ENUMERATION ───────
 *
 * MEMBER_DATA_MAP is the sole enumeration and stays so. What it cannot supply
 * is English: its `collection` is a path (`tenants/{t}/checkinSessions/{id}/
 * attendees`), its `holds` is a field list (`authorId, authorName, ...`) and its
 * `reason` is written for a reviewer. None of the three can go on a member's
 * screen, so a translation has to exist somewhere.
 *
 * {@link MEMBER_COPY_LABELS} is that translation and NOTHING ELSE. It is keyed
 * by the map's own `collection` labels and its values are noun phrases. It
 * carries no disposition, so it cannot disagree with the map about what happens
 * to a collection — only about what to call it. The category a label appears
 * under is read from `entry.disposition` at derivation time, every time.
 *
 * This is the same mechanism `MEMBER_EXPORT_DECISIONS` and
 * `assertExportCoversMap` already use in member-export.ts, and for the same
 * reason: a keyed table plus a both-directions assertion is not a second list,
 * because it cannot be quietly wrong. {@link assertCopyCoversMap} throws, by
 * name, when
 *
 *   • a collection in the map has no label      → the copy would silently omit it
 *   • a label names no collection in the map    → the copy would invent one
 *
 * so adding a sweep breaks the build until somebody says what to call it in
 * front of a member.
 *
 * ─── ⚠️ WHY A DERIVED CONSTANT IS SHIPPED RATHER THAN THE DERIVATION ─────────
 *
 * PersonalInformationModal is `"use client"`. MEMBER_DATA_MAP lives in
 * member-erasure.ts, which imports `@/lib/firebase-admin` — a module that calls
 * `admin.initializeApp` with a service-account private key at import time.
 * Importing the map into the browser bundle is therefore not an option, and no
 * amount of tree-shaking makes it one.
 *
 * So the derivation runs against the real map in the test process and its result
 * is checked in as {@link DELETE_CONFIRM_COPY}, which is what the client
 * renders. That constant is a CACHE, not a second list: 'the shipped copy is
 * exactly what the map derives' asserts it deep-equal to
 * `deriveErasureCopy(MEMBER_DATA_MAP)` in-process, and prints the replacement
 * literal when it drifts. A map edit that does not reach the copy fails CI by
 * name, which is the property the hand-written sentence never had.
 */

/** A category as it is introduced to the member, before its items are filled in. */
export interface ErasureCategory {
  disposition: Disposition;
  /** The heading. Must be readable on its own — a member may read nothing else. */
  heading: string;
  /** One sentence saying what the heading means, in the member's terms. */
  blurb: string;
}

/** One rendered category: its heading, its sentence, and its deduped items. */
export interface ErasureCopyGroup extends ErasureCategory {
  items: string[];
}

/** Everything the confirm panel renders, derived end to end from the map. */
export interface ErasureCopy {
  groups: ErasureCopyGroup[];
  /**
   * The labels for entries carrying `unkeyed` — the collections the sweep
   * declares it cannot reach for want of a member key (THE-188). Kept apart
   * from `groups` because their honesty problem is different; see
   * {@link UNREACHABLE_NOTE}.
   */
  unreachable: string[];
}

/**
 * ⚠️ "ANONYMISED" IS A THIRD THING AND HAS TO READ AS ONE.
 *
 * The heading a member skims must not collapse into either neighbour. "Deleted"
 * would be a lie in the direction THE-230 is about. "Kept" alone reads as "the
 * church still has a record about me", which is equally wrong: the amount, date
 * and receipt number survive, the person does not. So the heading states the
 * survival and the removal in the same breath — "Kept, with your name taken
 * off" — and the sentence closes both readings explicitly: the record still
 * exists (not deleted) and no longer points to the member (not kept about you).
 *
 * The three blurbs are deliberately parallel in shape, so the difference between
 * them is the only thing that stands out.
 */
export const ERASURE_CATEGORIES: readonly ErasureCategory[] = [
  {
    disposition: 'delete',
    heading: 'Deleted',
    blurb: 'Erased from the church’s systems. Nobody can get these back — not you, not an admin.',
  },
  {
    disposition: 'anonymise',
    heading: 'Kept, with your name taken off',
    blurb:
      'These records still exist, because the church’s books and other people’s conversations depend on them. Your name and email are replaced with a placeholder, so they no longer point to you.',
  },
  {
    disposition: 'retain',
    heading: 'Kept as they are',
    blurb: 'These belong to the church and carry no name or email of yours.',
  },
];

/**
 * The GAP note (THE-188), and the answer to "must the copy say so".
 *
 * 🔴 IT MUST. The two gap entries are `retain`, so they sit under "Kept as they
 * are" and the copy is not lying about their disposition — they do stay. But
 * "kept" carries an implication the rest of that category earns and these two
 * do not: that the record is a deliberate keep, and therefore something an admin
 * could go and remove on request. These cannot be found by the member's name at
 * all — a livestream prayer stores a typed display name and nothing else, an SMS
 * log stores a phone number whose owner is about to be deleted. An admin has no
 * more of a handle on them than the sweep does.
 *
 * Leaving that out would send a member to ask for something that cannot be
 * done, on the strength of a sentence that read as a promise. That is the same
 * class of untruth as telling them a deleted post survives, so it is said.
 *
 * Derived, like everything else here: the entries are found by `unkeyed` being
 * present, which member-erasure.ts declares machine-readable ON PURPOSE for
 * exactly this reason, rather than by parsing 'GAP' out of `reason`.
 */
export const UNREACHABLE_NOTE =
  'We cannot find these by your name at all, so they are not removed and an admin cannot pick them out for you either:';

/**
 * Collection label → the words a member sees. THE ONLY THING THIS FILE DECIDES.
 *
 * ⚠️ NO DISPOSITION LIVES HERE. A value is a noun phrase and nothing more; which
 * heading it lands under comes from `entry.disposition` every time the copy is
 * derived. That is what stops this table from becoming the second opinion that
 * MEMBER_DATA_MAP already exists to prevent.
 *
 * Several collections deliberately share one phrase. 30 entries is a schema
 * count, not a reading experience, and a member on a phone needs the three
 * categories far more than the row count: the four community collections are one
 * idea ("posts, comments and prayer requests you wrote"), the three
 * uid-on-someone-else's-document sweeps are another ("likes, prayers and RSVPs
 * you left"). {@link deriveErasureCopy} dedupes them in map order, which takes
 * the DELETED list from nineteen rows to twelve phrases without dropping a
 * single collection out of coverage.
 *
 * Phrases are lower-case noun phrases because they are rendered as list items
 * under a heading, and short because the narrowest supported viewport is 380px.
 */
export const MEMBER_COPY_LABELS: Record<string, string> = {
  // ── Deleted ───────────────────────────────────────────────────────────────
  community_posts: 'posts, comments and prayer requests you wrote',
  'community_posts/{id}/comments': 'posts, comments and prayer requests you wrote',
  prayer_requests: 'posts, comments and prayer requests you wrote',
  'tenants/{t}/livestreamSessions/{id}/comments': 'posts, comments and prayer requests you wrote',
  'community_posts.eventDetails': 'likes, prayers and RSVPs you left',
  'community_posts.likes': 'likes, prayers and RSVPs you left',
  'prayer_requests.prayedBy': 'likes, prayers and RSVPs you left',
  certificates: 'your course certificates, and the PDFs of them',
  chat_usage: 'your AI assistant usage',
  platform_inbox: 'support messages you sent',
  contacts: 'your contact record in the church’s CRM, and its history',
  contactActivities: 'your contact record in the church’s CRM, and its history',
  'tenants/{t}/registrations': 'your event registrations',
  'tenants/{t}/checkinSessions/{id}/attendees': 'your check-ins',
  'tenants/{t}/forms/{id}/submissions': 'forms you submitted',
  'tenants/{t}/dmMessages + channelMessages': 'messages you sent',
  'tenants/{t}/channels.members': 'your channel memberships',
  'tenants/{t}/integrations': 'accounts you connected, like Gmail or Mailchimp',
  users: 'your profile and your sign-in',

  // ── Anonymised ────────────────────────────────────────────────────────────
  'tenants/{t}/invoices': 'your giving history, receipts and year-end statements',
  'tenants/{t}/givingStatements': 'your giving history, receipts and year-end statements',
  'tenants/{t}/pledges': 'pledges you made',
  'tenants/{t}/directMessages': 'your direct message threads, so the other person keeps their side',
  'tenants/{t}/canvases': 'church documents you worked on',
  churches: 'the church’s own listing that pointed to you',

  // ── Retained ──────────────────────────────────────────────────────────────
  'contactActivities (type: donation)': 'the church’s giving ledger, which carries no name',
  affiliate_commissions: 'referral payout records, which carry no name',
  'blog_posts / courses / docs / docFolders / campaigns / events / newsletters / adoptedCourses':
    'content you published as staff',
  'tenants/{t}/livestreamSessions/{id}/prayers': 'prayers typed into a livestream',
  'tenants/{t}/smsLogs + smsBroadcasts/{id}/logs': 'text-message delivery logs',
};

/** The label for one map entry, or a throw naming the entry that has none. */
export function copyLabelFor(entry: MemberDataEntry): string {
  const label = MEMBER_COPY_LABELS[entry.collection];
  if (!label) {
    throw new Error(
      `No member-facing label for ${entry.collection}. MEMBER_DATA_MAP and MEMBER_COPY_LABELS disagree.`,
    );
  }
  return label;
}

/**
 * Refuse — loudly, by name — if the labels and the map have drifted apart.
 *
 * Modelled on `assertExportCoversMap`, and checking the same two directions plus
 * one this table can fail that the export's cannot: a phrase reused across two
 * DIFFERENT dispositions would print the same words under two headings, which is
 * precisely the "reads as deleted when it is anonymised" confusion the category
 * split exists to prevent.
 */
export function assertCopyCoversMap(map: readonly MemberDataEntry[]): void {
  const collections = new Set(map.map((e) => e.collection));
  const labelled = new Set(Object.keys(MEMBER_COPY_LABELS));

  const unlabelled = [...collections].filter((c) => !labelled.has(c));
  if (unlabelled.length > 0) {
    throw new Error(
      `The delete confirmation has no wording for ${unlabelled.length} collection(s) the erasure acts on: ${unlabelled.join(', ')}. ` +
        'Every entry in MEMBER_DATA_MAP must say what a member should be told about it.',
    );
  }

  const orphaned = [...labelled].filter((l) => !collections.has(l));
  if (orphaned.length > 0) {
    throw new Error(
      `The delete confirmation words ${orphaned.length} collection(s) the erasure does not enumerate: ${orphaned.join(', ')}. ` +
        'MEMBER_DATA_MAP is the enumeration; wording outside it is a second list.',
    );
  }

  const dispositionsByLabel = new Map<string, Set<Disposition>>();
  for (const entry of map) {
    const label = copyLabelFor(entry);
    const seen = dispositionsByLabel.get(label) ?? new Set<Disposition>();
    seen.add(entry.disposition);
    dispositionsByLabel.set(label, seen);
  }
  for (const [label, seen] of dispositionsByLabel) {
    if (seen.size > 1) {
      throw new Error(
        `"${label}" is used for collections with different dispositions (${[...seen].sort().join(', ')}), ` +
          'so it would print under more than one heading. A member cannot tell those apart — give each disposition its own wording.',
      );
    }
  }
}

/**
 * Group the map into what the member reads. Pure, and the only place the copy
 * is decided.
 *
 * Category membership is `entry.disposition` and nothing else, so flipping a
 * disposition in the map moves its phrase to another heading here with no edit
 * to this file — which is the whole point.
 */
export function deriveErasureCopy(map: readonly MemberDataEntry[]): ErasureCopy {
  assertCopyCoversMap(map);

  const groups = ERASURE_CATEGORIES.map((category) => {
    const items: string[] = [];
    for (const entry of map) {
      if (entry.disposition !== category.disposition) continue;
      const label = copyLabelFor(entry);
      // Deduped in map order: several collections are one idea to a member.
      if (!items.includes(label)) items.push(label);
    }
    return { ...category, items };
  }).filter((group) => group.items.length > 0);

  const unreachable: string[] = [];
  for (const entry of map) {
    if (!entry.unkeyed || entry.unkeyed.length === 0) continue;
    const label = copyLabelFor(entry);
    if (!unreachable.includes(label)) unreachable.push(label);
  }

  return { groups, unreachable };
}

/**
 * 🔴 GENERATED — the value of `deriveErasureCopy(MEMBER_DATA_MAP)`, checked in
 * so a `"use client"` component can render it without importing firebase-admin.
 *
 * Do not hand-edit. 'the shipped copy is exactly what the map derives' fails
 * with the replacement literal whenever the map moves.
 */
export const DELETE_CONFIRM_COPY: ErasureCopy = {
  groups: [
    {
      disposition: 'delete',
      heading: 'Deleted',
      blurb: 'Erased from the church’s systems. Nobody can get these back — not you, not an admin.',
      items: [
        'posts, comments and prayer requests you wrote',
        'likes, prayers and RSVPs you left',
        'your course certificates, and the PDFs of them',
        'your AI assistant usage',
        'support messages you sent',
        'your contact record in the church’s CRM, and its history',
        'your event registrations',
        'your check-ins',
        'forms you submitted',
        'messages you sent',
        'your channel memberships',
        'accounts you connected, like Gmail or Mailchimp',
        'your profile and your sign-in',
      ],
    },
    {
      disposition: 'anonymise',
      heading: 'Kept, with your name taken off',
      blurb:
        'These records still exist, because the church’s books and other people’s conversations depend on them. Your name and email are replaced with a placeholder, so they no longer point to you.',
      items: [
        'your giving history, receipts and year-end statements',
        'pledges you made',
        'your direct message threads, so the other person keeps their side',
        'church documents you worked on',
        'the church’s own listing that pointed to you',
      ],
    },
    {
      disposition: 'retain',
      heading: 'Kept as they are',
      blurb: 'These belong to the church and carry no name or email of yours.',
      items: [
        'the church’s giving ledger, which carries no name',
        'referral payout records, which carry no name',
        'content you published as staff',
        'prayers typed into a livestream',
        'text-message delivery logs',
      ],
    },
  ],
  unreachable: ['prayers typed into a livestream', 'text-message delivery logs'],
};
