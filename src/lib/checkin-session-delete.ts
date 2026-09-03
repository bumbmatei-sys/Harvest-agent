/**
 * ONE SOURCE FOR WHAT DELETING A CHECK-IN SESSION DESTROYS — THE-288.
 *
 * 🔴 WHY THIS MODULE EXISTS AT ALL, RATHER THAN A STRING IN THE COMPONENT.
 *
 * THE-230 shipped on this same screen family because the delete-confirmation
 * copy and the delete BEHAVIOUR were written in two places and drifted apart:
 * the sentence promised members that their check-ins stayed in the church's
 * records while the route had, by then, been changed to destroy them. A
 * hand-written list beside a machine-read map fails that way every time.
 *
 * THE-288 is the same drift in the OPPOSITE direction — the copy said "This
 * cannot be undone", the admin read that as "gone", and
 * `checkinSessions/{id}/attendees` survived its deleted parent with a first
 * name, last name, email and `crmContactId` for everyone who had checked in.
 * Firestore does not cascade.
 *
 * So the words and the behaviour are pinned to each other HERE. The route below
 * imports {@link SESSION_DELETE_REMOVES} to say what it swept; the component
 * imports {@link deleteSessionConfirmation} to say what it is about to sweep.
 * Neither can be reworded without the other going red.
 *
 * ⚠️ PURE ON PURPOSE — no `firebase-admin`, no `firebase`, no `next/server`.
 * The client component imports this file, so a server-only import here would
 * pull the Admin SDK into the browser bundle.
 */

/**
 * What a session delete destroys, in the church's own words.
 *
 * ⚠️ NOT A COUNT. `attendeeCount` on the session document can drift SHORT —
 * `/api/checkin/submit` adds the attendee row and increments the counter as two
 * separate awaits, so a failure between them leaves the counter permanently one
 * behind (THE-288, second finding; one-directional, it never over-counts). Copy
 * that named a number would therefore under-state what is about to be destroyed,
 * which is precisely the class of lie THE-230 was. The copy names the KIND of
 * record instead, which is true at any count.
 */
export const SESSION_DELETE_REMOVES =
  'every attendee record checked in against it — each person\'s name, email and CRM link';

/** The Firestore path the sweep clears, for messages that must name what remains. */
export const attendeesPath = (tenantId: string, sessionId: string) =>
  `tenants/${tenantId}/checkinSessions/${sessionId}/attendees`;

/**
 * The delete confirmation an admin reads before the irreversible tap.
 *
 * 🔴 THIS SENTENCE MUST BE TRUE OF THE ROUTE BELOW IT. It now names the
 * attendee records because the route now deletes them; before THE-288 it said
 * only "This cannot be undone", which was true of the session and silent about
 * the personal data that outlived it.
 *
 * "This cannot be undone" is KEPT and is now doing more work than it was: the
 * clause it qualifies has widened from the session alone to the session and
 * every attendee record under it. That is why the scope is stated in the same
 * breath rather than left to the reader — an unqualified irreversibility
 * warning that has quietly grown is the THE-230 failure with the polarity
 * flipped.
 */
export function deleteSessionConfirmation(sessionName: string): string {
  return `Delete "${sessionName}"? The session and ${SESSION_DELETE_REMOVES} are permanently deleted. This cannot be undone.`;
}

/** Outcome of one delete attempt. `partial` is never reported as `complete`. */
export interface SessionDeleteResult {
  status: 'complete' | 'partial';
  /**
   * Attendee documents this run removed, or `null` when the sweep threw
   * part-way.
   *
   * ⚠️ NULL IS NOT ZERO AND MUST NOT BE PRINTED AS ONE. `deleteByQuery` returns
   * its running total only on the way out, so a throw on the third page loses a
   * count that was really 800. Reporting that as `0` would understate a
   * destructive act to the admin who has to decide what to do next. The
   * unknown is stated as unknown; what REMAINS is measured either way, and that
   * is the number this ticket is actually about.
   */
  attendeesDeleted: number | null;
  /** Set only on `partial`: the collection path that still holds records. */
  remainingIn?: string;
  /** Set only on `partial`: a lower bound on what survived, never a guess. */
  remainingAtLeast?: number;
}

/**
 * What the admin is told when a sweep did not finish.
 *
 * 🔴 THE SHAPE OF #390's BUG IS A RUN THAT STOPS EARLY AND SAYS `complete`.
 * Twelve sweeps there each took ONE 400-document page, left the remainder, and
 * reported success. So a short run here names the collection that still holds
 * records and says the session was KEPT — because the session document is the
 * only handle those records have, and deleting it would turn a partial sweep
 * into exactly the orphaning this ticket is about.
 *
 * The bound is `at least`, never an exact figure: counting the survivors in
 * full would cost another unbounded read, and an exact-sounding number that is
 * actually a page size is its own small lie.
 */
export function partialDeleteMessage(result: SessionDeleteResult): string {
  const removed = result.attendeesDeleted === null
    ? 'Some attendee records were deleted before it stopped'
    : `${result.attendeesDeleted} attendee record(s) were deleted`;
  return (
    `Incomplete — ${removed}, and at least ${result.remainingAtLeast ?? 0} still remain in ` +
    `${result.remainingIn}. The session was NOT deleted, so those records stay reachable from ` +
    `this screen. Delete it again to continue; the sweep is idempotent.`
  );
}
