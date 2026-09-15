/**
 * THE-325 · one accepted-digest set for `firestore.rules`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 *
 * 54 suites pinned `firestore.rules` by digest to prove their own ticket did
 * not touch it: 49 spelled the digest inline, four read it from THE-286's JSON
 * fixture, and THE-319 asserted it appeared in `the-299-retention-guards`. Every
 * one of them said the same thing, so THE-313's ONE-LINE `servicePlans` rule
 * turned 45 of them red at once and needed a second PR (#463) that changed
 * nothing but pins.
 *
 * 🔴 WHAT THIS TICKET MOVED, AND WHAT IT DID NOT. The accepted VALUES moved into
 * the per-ticket register at `__fixtures__/ownership/`. The ASSERTIONS did not
 * move: all 54 suites still assert, each in its own case, that the rules file on
 * disk is at a digest some ticket recorded — and therefore that its own ticket
 * did not touch a file which AUTO-DEPLOYS TO PRODUCTION with no emulator tests
 * in CI. Nothing was deleted but 49 copies of a two-item list.
 *
 * ── Why this is not a hole ──────────────────────────────────────────────────
 *
 * A shared accepted set would be a loosening if it accepted anything a ticket
 * had not written down. It does not, and section 2 proves it on the pure entry
 * point rather than asserting it: a digest no ticket recorded is refused, an
 * empty accepted set is a FAILURE rather than a pass, and every entry must carry
 * a ticket and an 80-character reason or `validateOwnership` refuses it.
 *
 * ⚠️ NOTHING HERE ASKS WHAT THIS BRANCH CHANGED. Section 9 is the sweep for
 * that, and it is scoped by the BASE REF — `git cat-file -e <base>:<path>` —
 * never by a diff, because four expiring diff-guards have already blocked
 * unrelated PRs in this repo and THE-315 (#454) is the standing sweep for them.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  loadOwnership,
  validateOwnership,
  ownershipFailureFor,
  OWNERSHIP_DIR,
  MIN_REASON_LENGTH,
  type OwnershipEntry,
} from './__fixtures__/ownership-register';
import {
  RULES_FILE,
  rulesDigestOnDisk,
  rulesDigestFailure,
  rulesDigestFailureFor,
  acceptedRulesDigests,
} from './__fixtures__/firestore-rules-pin';

const ROOT = path.resolve(__dirname, '../..');
const SELF = 'src/__tests__/THE-325.rules-digest-register.test.ts';
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');
const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

/** The shared module every pinning suite imports. Spelled once, and greppable. */
const PIN_MODULE = 'firestore-rules-pin';

/** THE-325's own record: the file this ticket added the accepted set to. */
const REGISTER_RECORD = 'src/__tests__/__fixtures__/ownership/THE-325.json';

/** The two files THE-325 added besides this suite. */
const THE_325_NEW_FIXTURES = [
  'src/__tests__/__fixtures__/firestore-rules-pin.ts',
  REGISTER_RECORD,
];

/**
 * 🔴 THE ACCEPTED VALUES AS THEY WERE BEFORE THIS TICKET, counted and named from
 * the tree at `main` (12503e2) before anything moved. Both were already accepted
 * somewhere: `a1fb6148` by the seven tuple-table guards and the four
 * `RULES_ACCEPTED` arrays, `4973c3c9` by all 49 inline pins, THE-286's fixture
 * and THE-319's deferral. Section 3 is what makes "append, never substitute"
 * checkable rather than a promise — drop either and it fails, naming it.
 *
 * ⚠️ THESE TWO LITERALS ARE A MIGRATION RECORD, NOT A PIN. They are the "before"
 * side of a before/after count and do not move when the rules legitimately
 * change: a later ticket APPENDS a third value to the register and edits nothing
 * here. That is why section 1 exempts this file by name from the one-edit sweep.
 */
const ACCEPTED_BEFORE: ReadonlyArray<readonly [digest: string, what: string]> = [
  ['a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499',
    'main before #462, unchanged since 5e06c67'],
  ['4973c3c94c5a3be8d478f4373326b23fbd9de447d3ac6a5b8173f723dfd62075',
    "main + THE-313 (#462) — the servicePlans rule; the state on disk at THE-325's branch point"],
];

/** Every test file and fixture under `src/`, repo-relative and sorted. */
function suiteFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.name === 'node_modules' || e.name === '.next') return [];
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      return /\.test\.[cm]?[jt]sx?$/.test(e.name) || e.name.endsWith('.json') ? [p] : [];
    });
  return walk(path.join(ROOT, 'src'))
    .map((p) => path.relative(ROOT, p).split(path.sep).join('/'))
    .sort();
}

/** Every SUITE that pins `firestore.rules` — measured from the tree. */
const pinningSuites = (): string[] =>
  suiteFiles().filter((p) => /\.test\.[cm]?[jt]sx?$/.test(p) && read(p).includes(PIN_MODULE));

/** Every file under `src/` carrying `digest` verbatim. */
const filesSpelling = (digest: string): string[] =>
  suiteFiles().filter((p) => read(p).includes(digest));

/** The measured population, named in one place so a change to it is one edit.
 *
 * 🔴 56 → 57, APPENDED BY THE-330. Its guard suite reaches the accepted set
 * through the same module as every other pinner, to assert that rebuilding the
 * number-purchase form left `firestore.rules` untouched. The count is a
 * MEASURED population, so a new pinner raises it by one — what the assertion
 * catches is a suite quietly DROPPING its pin, and that still fails.
 *
 * 🔴 57 → 58, APPENDED BY THE-336, through the same module and for the same
 * reason. Its suite asserts that fixing a member onboarding funnel which could
 * not create an account — both writes used `updateDoc` on a document a
 * swallowed `AuthPage` failure had left uncreated — needed NO rule change: the
 * deployed `users/{userId}` block already permits a self-create whose `role` is
 * absent or 'user', and a write to a missing document is evaluated as a create.
 * Nothing above is removed and no accepted value is widened.
 *
 * 🔴 58 → 59, APPENDED BY THE-337, through the same module and for the same
 * reason. Its measured suite asserts that fixing the composer's paperclip —
 * which opened a menu nobody could see, because `render={<Button …/>}` on a
 * React 18 function component handed `Menu.Positioner` a null ref and the
 * positioner never left `opacity: 0` — needed NO rule change: the fix is one
 * trigger element in one component and reads nothing new from Firestore. The
 * suite reaches the accepted set through this module rather than spelling the
 * digest, so a real rules change still costs exactly one edit. Nothing above is
 * removed and no accepted value is widened. */
/* ⚠️ APPENDED BY THE-340. It moves rota invitations off the church's own Gmail
 * onto Resend so a church that has connected nothing can still reach its
 * volunteers — a transport change that needed NO rule, because every access to
 * `tenants/{t}/rotaInvitations` goes through the Admin SDK, which bypasses
 * rules entirely. Its suite reaches the accepted set through this module rather
 * than spelling the digest, so a real rules change still costs exactly one
 * edit. Nothing above is removed and no accepted value is widened. */
/* ⚠️ APPENDED BY THE-341. It renames the nav group BROADCASTING to REACH and
 * moves `forms` into it, on both shells — a label-and-membership change in two
 * array literals that reads nothing from Firestore and needed NO rule. Its
 * suite reaches the accepted set through this module rather than spelling the
 * digest, so a real rules change still costs exactly one edit. Nothing above is
 * removed and no accepted value is widened. */
/* ⚠️ APPENDED BY THE-342. It replaces the unordered, unbounded and
 * failure-swallowing reads in CoursePage, AdminCourses, ChurchMap and
 * useCRMQueries with counted, ordered, ceiling-shared ones — a READ-SHAPE
 * change that needed NO rule. The unfiltered /courses read it investigated is
 * already rejected wholesale for a non-super-admin by the existing
 * `belongsToTenant(resource.data...)` rule (rules are not filters), so the fix
 * was to stop swallowing that rejection rather than to change what the rule
 * allows. Its suite reaches the accepted set through this module rather than
 * spelling the digest — its first draft DID spell it, and section 1 above
 * caught that before review — so a real rules change still costs exactly one
 * edit. Nothing above is removed and no accepted value is widened. */
/* APPENDED BY THE-345. It gates paid event ticketing behind one value after the
 * founder said "I should not be able to create paid events with stripe
 * disabled", and stops a dangling adoption pointer counting towards the course
 * figure and the plan cap - a CLIENT-SIDE gate and a COUNTING fix, both of which
 * needed NO rule. `adoptedCourses` is already `allow write: if false` and stays
 * that way: the leftover pointer is cleared through the DELETE
 * /api/courses/adopt route that already exists, is already permission-checked
 * and is already documented idempotent, so no route and no migration were added
 * and nothing about the rule had to move. Its suite reaches the accepted set
 * through this module rather than spelling the digest, so a real rules change
 * still costs exactly one edit. Nothing above is removed and no accepted value
 * is widened. */
/* APPENDED BY THE-346. It fixes six UI defects the founder found on a phone,
 * and the only one that could have needed a rule is "Share on web", which
 * creates a PUBLIC link to a church's internal note. It needed none, for the
 * reason THE-324 established: the share record lives at the top-level
 * `publicNotes/{token}`, which has NO RULE and therefore no client read and no
 * client write, and every access - minting, revoking and the signed-out
 * reader's own fetch - goes through the Admin SDK in `app/api/docs/public-share`
 * and `app/n/[token]`. `/docs/{docId}`'s read is UNTOUCHED, which is the point:
 * widening that one line is the change that would expose every note in the
 * collection rather than the one being shared. Its suite reaches the accepted
 * set through this module rather than spelling the digest, so a real rules
 * change still costs exactly one edit. Nothing above is removed and no accepted
 * value is widened. */
/* 🔴 THE-348 — the member chat's composer, attach menu and admin gate. 64 -> 65.
 * Its suite pins the rules for a reason worth recording HERE as well as in
 * THE-322: it FOUND a gap and deliberately did not close it. `dmMessages` and
 * `channelMessages` create carry no field allowlist, so the rules permit a
 * member to write an `attachments` array by a route that is not the paperclip
 * the founder asked to hide — and hiding a button is not a permission. Closing
 * it means constraining two of the hottest write paths in the product, in a
 * file that AUTO-DEPLOYS on merge with no emulator tests, so the gap is
 * REPORTED as assertions that go red the day someone closes it rather than
 * closed by a UI ticket. THE-348 records NO rules digest and reaches the
 * accepted set through this module like every other pinner, so a real rules
 * change still costs exactly one edit. Nothing above is removed and no
 * accepted value is widened. */
/* 🔴 THE-349 — Google sign-up created a user who belonged to no church. 65 -> 66.
 * Its suite pins the rules for the reason THE-348's did: it FOUND something in
 * them and deliberately did not change it. The repair a stranded member needs
 * is a `tenantId` write, and the `users` update rule refuses one to the member
 * (`tenantId` is in the self-edit blocklist) AND to their own church's admin
 * (immutable on that branch) — only `isSuperAdmin()` or the Admin SDK can make
 * it. Loosening that would open a tenant-hopping surface in a file that
 * AUTO-DEPLOYS on merge with no emulator tests, so the rule is ASSERTED as it
 * stands — the suite goes red the day it moves and the console repair written
 * into that PR becomes stale — and the repair is reported to the founder
 * instead of shipped. THE-349 records NO rules digest and reaches the accepted
 * set through this module like every other pinner, so a real rules change still
 * costs exactly one edit. Nothing above is removed and no accepted value is
 * widened. */
/* 🔴 THE-350 — a manual donation wrote a CRM note and nothing else. 66 -> 67.
 * Its suite pins the rules for the reason THE-348's and THE-349's did: it FOUND
 * something in them and deliberately did not change it. `tenants/{t}/invoices`
 * is gated on `hasPermission('manageAccounting', tenantId)`, and the admin who
 * records a gift in the CRM holds `manageCRM` — so a CLIENT write would be
 * refused for exactly the people doing the recording, which is the founder's
 * bug wearing a permission error. Loosening the rule would hand every CRM admin
 * direct write access to the money ledger, in a file that AUTO-DEPLOYS on merge
 * with no emulator tests. So the write goes through the Admin SDK behind
 * `/api/donations/manual`, which imposes `requireTenantPermission(request,
 * tenantId, 'manageCRM')` itself, and the rule is ASSERTED as it stands — the
 * suite goes red the day it moves and that reasoning becomes stale. THE-350
 * records NO rules digest and reaches the accepted set through this module like
 * every other pinner, so a real rules change still costs exactly one edit.
 * Nothing above is removed and no accepted value is widened.
 *
 * ─── 67 -> 68, THE-351 ──────────────────────────────────────────────────────
 *
 * PAID EVENTS WITH NO PAYMENT RAIL: a church prices a ticket, a member pays the
 * church's OWN PayPal / Revolut / Wise link with a reference in the payment
 * note, and a named admin at that church opens that account, finds the payment
 * and confirms it. `THE-351.manual-payment.guards.test.ts` joins the population.
 *
 * ⚠️ A PER-TENANT INBOX IS THE SHAPE THAT USUALLY NEEDS A RULE — a new
 * collection, scoped to one church, readable by its admins — and this one needed
 * none, which is a finding rather than luck. A claim and its confirmation are
 * FIELDS on `tenants/{t}/registrations/{id}`, whose read rule already says
 * `isAuthenticated() && (isTenantAdmin(tenantId) || …)` with the tenant taken
 * from the PATH rather than from a `where()` clause that could be dropped. The
 * WRITE side needed none either, for THE-350's reason one layer along: the
 * registration update rule requires `manageEvents`, which a MEMBER pressing
 * "I've paid" does not hold, so rather than loosen a rule on a document carrying
 * a money amount the write goes through the Admin SDK behind a route whose own
 * ownership check — verified uid OR verified token email — is STRICTER than the
 * rule would have been. THE-351 records NO rules digest and reaches the accepted
 * set through this module like every other pinner, so a real rules change still
 * costs exactly one edit. Nothing above is removed and no accepted value is
 * widened.
 *
 * ─── 68 -> 69, THE-355 ───────────────────────────────────────────────────────
 *
 * THE PUBLIC EVENT PAGE: no payment link, no way to claim, and a button that
 * promised a processor that no longer exists. THE-351 built the claim flow
 * behind `requireAuth` and mounted it on the LOGGED-IN member app; for a
 * crusade, where most attendees have no account and never will, that reached
 * nobody — so no claim was ever created and the founder's inbox was correctly
 * empty about a thing that had never happened.
 * `THE-355.public-payment.guards.test.ts` joins the population.
 *
 * ⚠️ A PUBLIC, UNAUTHENTICATED WRITE AGAINST A DOCUMENT CARRYING A MONEY AMOUNT
 * IS THE SHAPE THAT MOST OBVIOUSLY NEEDS A RULE, and it needed none — the same
 * finding THE-351 made one layer in. The public claim is the Admin SDK inside a
 * route, exactly as THE-351's authenticated one is, so the registration UPDATE
 * rule requiring `manageEvents` is untouched and nothing is loosened in a file
 * that AUTO-DEPLOYS with no emulator tests. What stands in place of a rule is a
 * STRONGER shape rather than a weaker one: the route accepts no
 * `registrationId` at all and finds the document BY a stored 256-bit token —
 * THE-324's rota-invitation pattern, no sign-in, authorising only the fields it
 * needs — so there is no pair to mismatch and no expressible request that names
 * somebody else's seat. THE-355 records NO rules digest and reaches the accepted
 * set through this module like every other pinner, so a real rules change still
 * costs exactly one edit. Nothing above is removed and no accepted value is
 * widened.
 *
 * ─── 69 -> 70, THE-357 ───────────────────────────────────────────────────────
 *
 * THREE THINGS REPORTED AND NEVER SWEPT: THE-311 §8's expired branch-diff
 * freezes, the giving share sheet still promising card giving was "coming soon"
 * while the platform Connect account is closed as `rejected.fraud`, and
 * `AdminSms`'s five Buttons measuring 25.38-36.25px above `sm` under Rule 4's
 * 38px floor. `THE-357.guards.test.ts` joins the population.
 *
 * ⚠️ IT TOUCHES NO RULE AND RECORDS NO RULES DIGEST. Its three parts open a
 * test file, a copy constant and five className strings; none of them adds a
 * read, a write or a collection, so there is nothing for a rule to govern. It
 * reaches the accepted set through this module like every other pinner —
 * `rulesDigestFailure()` and nothing else — so a real rules change still costs
 * exactly one edit. Nothing above is removed and no accepted value is widened.
 *
 * 🔴 ITS OWN OWNERSHIP RECORD DELIBERATELY CARRIES NO `firestore.rules`
 * ENTRY, which is the register's rule for a ticket that does not change the
 * file: `THE-357.json` records `AdminSms.tsx` alone. */
/**
 * 🔵 71 SINCE THE-358, which adds `THE-358.account-menu.test.tsx` to the
 * population.
 *
 * ⚠️ IT TOUCHES NO RULE AND RECORDS NO RULES DIGEST. It adds a LINK — one <a>
 * to the live documentation site in the admin account menu, below Billing &
 * Payments — so it opens no read, no write and no collection, and there is
 * nothing for a rule to govern. It reaches the accepted set through this module
 * like every other pinner — `rulesDigestFailure()` and nothing else — so a real
 * rules change still costs exactly one edit. Nothing above is removed and no
 * accepted value is widened.
 *
 * 🔴 ITS OWN OWNERSHIP RECORD DELIBERATELY CARRIES NO `firestore.rules` ENTRY,
 * which is the register's rule for a ticket that does not change the file:
 * `THE-358.json` records `MyAccountMenu.tsx` and the two suites it edits, and
 * no rules digest. */
/**
 * 🔵 72 SINCE THE-359, which adds `THE-359.paid-event-copy.guards.test.ts` to
 * the population.
 *
 * ⚠️ IT TOUCHES NO RULE AND RECORDS NO RULES DIGEST, and unlike the two above it
 * is worth saying WHY, because this one does add a WRITE. Confirming a paid
 * event ticket now also writes a DONATION activity onto the giver's CRM contact
 * — the founder: "in crm it doesnt show that i have paid for an event after i
 * confirmed but it appears in the accounting." That write goes through the
 * Admin SDK inside a route that already imposes `manageEvents` on a verified
 * token, exactly as THE-350's money write does and for the same reason, so no
 * client reaches `contactActivities` by a path a rule would have to govern.
 * Both collections it touches are ones `member-erasure.ts` and
 * `member-export.ts` already enumerate, including the donation-activity
 * retention carve-out, so no GDPR path learns a new name either. The contact
 * lookup is ONE equality `where` with no `orderBy` — a single-field index
 * Firestore maintains automatically — so `firestore.indexes.json`, which
 * `deploy-rules.yml` does not deploy and where an added index would be INERT
 * while the query threw in production, is untouched as well. It reaches the
 * accepted set through this module like every other pinner —
 * `rulesDigestFailure()` and nothing else — so a real rules change still costs
 * exactly one edit. Nothing above is removed and no accepted value is widened.
 *
 * 🔴 ITS OWN OWNERSHIP RECORD DELIBERATELY CARRIES NO `firestore.rules` ENTRY,
 * which is the register's rule for a ticket that does not change the file:
 * `THE-359.json` records the seven shipped files it edits and THE-322's suite,
 * and no rules digest.
 *
 * 🔴 72 → 73, APPENDED BY THE-360, through the same module and for the same
 * reason. Its suite widens the analytics vocabulary from one event to ten —
 * `gift_recorded`, `plan_limit_reached` and seven more — and pins that doing so
 * needed NO rule change: every one of the nine is a client-side `capture()`
 * fired beside a write that already existed, on a screen whose permissions
 * already governed it. The one money path among them, a manual gift, still
 * reaches `tenants/{t}/invoices` through `/api/donations/manual` on the Admin
 * SDK, exactly as THE-350 left it, so the `manageAccounting` gate on that
 * collection is neither read nor relaxed by this ticket. The vocabulary lives
 * in `src/lib/analytics/events.ts`, which Firestore never sees.
 *
 * ⚠️ THE FIRST DRAFT OF THAT SUITE SPELLED THE LIVE DIGEST AS A LITERAL, and
 * the assertion above caught it. It now reaches the accepted set through
 * `acceptedRulesDigests()` like every other pinner, so a real rules change
 * still costs exactly one edit. Nothing above is removed and no accepted value
 * is widened.
 *
 * 🔴 ITS OWN OWNERSHIP RECORD CARRIES NO `firestore.rules` ENTRY either, for
 * the reason this register states: `THE-360.json` records the ten shipped files
 * it edits, and no rules digest.
 *
 * 73 -> 74, APPENDED BY THE-361, through the same module and for the same
 * reason. Its suite adds ONE name to the analytics vocabulary -
 * `course_adopted`, the event THE-360 proposed and dropped on a wrong premise -
 * and pins that doing so needed NO rule change: the event is a single
 * client-side `capture()` fired beside a request that already existed, on a
 * screen whose permissions already governed it. `adoptedCourses` remains
 * `allow write: if false` and the adoption pointer is still written only by the
 * Admin SDK behind `/api/courses/adopt`, so neither half of that rule is read
 * or relaxed here. The vocabulary lives in `src/lib/analytics/events.ts`, which
 * Firestore never sees.
 *
 * ITS OWN OWNERSHIP RECORD CARRIES NO `firestore.rules` ENTRY either, for the
 * reason this register states and for the reason THE-342, THE-345 and THE-360
 * each recorded after THE-333 and THE-341 turned it red: `THE-361.json` records
 * the files it edits, and no rules digest. It reaches the accepted set through
 * `acceptedRulesDigests()` like every other pinner, so a real rules change
 * still costs exactly one edit. Nothing above is removed and no accepted value
 * is widened.
 *
 * 74 -> 75, APPENDED BY THE-362, through the same module and for the same
 * reason. Its suite pins the rules while fixing four founder bugs on four
 * surfaces - a cents series drawn as dollars on both giving charts, the
 * processor's name still standing on the giving screens, a livestream button
 * that opened a second tab onto the news feed, and a CRM delete that aimed at
 * a document which has never existed.
 *
 * ITS STOP CONDITION 4 WAS "the CRM delete needs a firestore.rules change",
 * AND THE ANSWER IS THAT IT DOES NOT - which is why it pins rather than edits.
 * The top-level `contacts` rule already allows delete to a holder of
 * `manageCRM`, and the founder's bug was never a permission one: the CRM list
 * MERGES `contacts` with `users`, an app member's row is keyed by their `users`
 * id, and the delete named a `contacts` document that does not exist. The fix
 * PREVENTS two writes and adds no Firestore operation of any kind, so there is
 * nothing here a rule could have expressed.
 *
 * ITS OWN OWNERSHIP RECORD CARRIES NO `firestore.rules` ENTRY either, for the
 * reason this register states: `THE-362.json` records the six files it edits,
 * and no rules digest. It reaches the accepted set through
 * `rulesDigestFailure()` like every other pinner - never as a literal, which is
 * the mistake this register caught #504 making - so a real rules change still
 * costs exactly one edit. Nothing above is removed and no accepted value is
 * widened.
 *
 * THE-364 IS THE SEVENTY-SIXTH, and it is the clearest case this register has
 * had for existing. It bundles eight backlog cards, and TWO of them ended at
 * this file rather than going through it:
 *
 *   · THE-107 - `isSuperAdmin()` accepts `tokenEmail()` against a frozen list
 *     with NO `email_verified` test anywhere, so the leg that identifies a
 *     platform owner trusts an address Firebase never made anyone prove. The
 *     replacement rule is one line and it is written out in the pull request,
 *     NOT applied: requiring verification could lock the founder out of their
 *     own platform if their Auth record is unverified, and no test here can
 *     read that.
 *   · THE-52 - a message cap on Community Groups. A cap is only a cap where it
 *     BINDS, which is this file; a client `maxLength` is display, exactly as
 *     86bbtx3dj settled. So the recommended number, its reasoning and the rule
 *     text are reported, and nothing ships.
 *
 * ITS OWN OWNERSHIP RECORD CARRIES NO `firestore.rules` ENTRY, per #464: it
 * records the one suite it edits and no rules digest, because it opened the
 * rules file to READ it and left it byte-identical. It reaches the accepted set
 * through `rulesDigestFailure()` like every other pinner. */
const PINNING_SUITES = 76;

/**
 * A digest no ticket has recorded and none ever will — the planted change.
 * Assembled rather than spelled so this file cannot be found by a sweep for it.
 */
const UNRECORDED = 'f'.repeat(48) + '0123456789abcdef';

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 — a legitimate rules change needs ONE edit
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('1 · a legitimate rules change is one edit', () => {
  /**
   * 🔴 PLANTED FOR REAL, against a COPY of the register. `firestore.rules`
   * itself is byte-identical on this branch (section 8), so the change is
   * planted where it can be: a digest that is not on disk and is not recorded,
   * run through the same pure entry point all 54 suites reach through. It fails
   * against the register as it stands, and passes as soon as ONE per-ticket
   * record accepts it — which is the whole claim, demonstrated rather than said.
   */
  it('🔴 one new per-ticket record makes a planted rules change acceptable', () => {
    const planted = sha256(read(RULES_FILE) + "\n// a rule a later ticket legitimately added\n");
    const before = loadOwnership();

    expect(ownershipFailureFor(RULES_FILE, planted, before),
      'a rules state nobody recorded is already accepted — that would be the hole')
      .not.toBeNull();

    // THE ONE EDIT: a new `__fixtures__/ownership/THE-nnn.json`, written to a
    // temp directory so this test adds no record of its own to the tree.
    const dir = mkdtempSync(path.join(tmpdir(), 'the-325-'));
    try {
      for (const name of readdirSync(OWNERSHIP_DIR)) {
        writeFileSync(path.join(dir, name), readFileSync(path.join(OWNERSHIP_DIR, name)));
      }
      writeFileSync(path.join(dir, 'THE-999.json'), JSON.stringify({
        ticket: 'THE-999',
        entries: [{
          file: RULES_FILE,
          digest: planted,
          why: 'A later ticket legitimately changing firestore.rules records the state it leaves '
            + 'the file in, here, and edits nothing else in the tree. This is that edit.',
        }],
      }, null, 2));
      const after = loadOwnership(dir);
      expect(validateOwnership(after), 'the one new record does not validate').toEqual([]);
      expect(ownershipFailureFor(RULES_FILE, planted, after),
        'one recorded value was not enough — the consolidation did not achieve its point')
        .toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * ⚠️ TWO FILES ARE EXEMPT, BY NAME AND WITH REASONS, because neither has to be
   * edited when a rules change lands — which is the property under test:
   *
   *   • THIS SUITE holds `ACCEPTED_BEFORE`, the "before" half of the before/after
   *     count in section 3. It is a migration record and does not grow.
   *   • `the-313-guards` holds `RULES_BEFORE_462`, which asks WHICH of the two
   *     states a merge ref is at so its readable half knows whether the rule
   *     should be present yet. It is a selector, not an accepted-value list.
   *
   * 🔴 A THIRD would be a regression, so the list is exactly two lines long and
   * widening it is an edit visible in review.
   */
  const SPELLING_EXEMPT = [SELF, 'src/__tests__/the-313-guards.test.ts'];

  it('🔴 and that edit is ONE file, because no suite carries a copy of the set', () => {
    expect(SPELLING_EXEMPT).toHaveLength(2);
    for (const [digest] of acceptedRulesDigests()) {
      const carriers = filesSpelling(digest).filter((p) => !SPELLING_EXEMPT.includes(p));
      expect(carriers,
        `${digest} is written outside the register, so a rules change would cost more than one edit`)
        .toEqual([REGISTER_RECORD]);
    }
    // 🔴 AND THE LIVE STATE — the one a rules change actually supersedes — is
    // spelled in no suite at all, exemptions included but for this record.
    expect(filesSpelling(rulesDigestOnDisk()).filter((p) => p !== SELF),
      'a suite still spells the digest on disk, so a rules change would cost it an edit too')
      .toEqual([REGISTER_RECORD]);
    // The exemptions are real files that really do carry a value, so the list
    // cannot quietly become a pair of names that exempt nothing.
    for (const rel of SPELLING_EXEMPT) {
      expect(acceptedRulesDigests().some(([d]) => read(rel).includes(d)),
        `${rel} is exempt from the sweep but carries no accepted value — drop it from the list`)
        .toBe(true);
    }
  });

  it('every pinning suite reaches the accepted set through the one module', () => {
    const suites = pinningSuites();
    expect(suites.length, `pinning suites:\n  ${suites.join('\n  ')}`).toBe(PINNING_SUITES);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 — an UNRECORDED rules change still fails
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('2 · an unrecorded rules change still fails', () => {
  it('🔴 the register refuses a digest no ticket recorded', () => {
    expect(rulesDigestFailureFor(UNRECORDED),
      'the shared set accepts an unrecorded value — this is a hole, not a simplification')
      .not.toBeNull();
    expect(rulesDigestFailureFor(UNRECORDED)).toContain(RULES_FILE);
  });

  it('🔴 and an EMPTY accepted set is a failure, not a blanket exemption', () => {
    // The way a consolidation could quietly stop checking: lose the records and
    // answer "fine" because there is nothing left to compare against.
    expect(ownershipFailureFor(RULES_FILE, rulesDigestOnDisk(), []),
      'a file no ticket recorded is being treated as acceptable')
      .not.toBeNull();
  });

  it('the mechanism is named, and it is the one every suite calls', () => {
    // Per-suite proof is the population count in section 5; what is named here
    // is the single point every one of them goes through, so a hole would be a
    // hole for all 54 at once and is tested as such above.
    expect(read('src/__tests__/__fixtures__/firestore-rules-pin.ts'))
      .toContain('ownershipFailure(RULES_FILE)');
    expect(rulesDigestFailure(),
      'firestore.rules on disk is at a digest no ticket recorded').toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3 — every accepted value that existed before exists after
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('3 · every accepted value survived the move', () => {
  it('🔴 both values the tree accepted before are accepted now, by name', () => {
    const now = acceptedRulesDigests().map(([digest]) => digest);
    for (const [digest, what] of ACCEPTED_BEFORE) {
      expect(now, `the accepted value for ${what} (${digest}) was LOST — append, never substitute`)
        .toContain(digest);
    }
  });

  it('the count before equals the count after', () => {
    expect(new Set(acceptedRulesDigests().map(([d]) => d)).size,
      'the accepted set changed size — THE-325 migrates values, it does not add or drop them')
      .toBe(ACCEPTED_BEFORE.length);
  });

  it('and each carries the provenance it had', () => {
    const why = Object.fromEntries(acceptedRulesDigests());
    expect(why[ACCEPTED_BEFORE[0][0]]).toContain('main before #462');
    expect(why[ACCEPTED_BEFORE[1][0]]).toContain('THE-313');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 — every entry carries a ticket and a reason
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('4 · every entry is a record, not a bare hash', () => {
  it('the register validates clean', () => {
    const problems = validateOwnership();
    expect(problems, `the ownership register is not a record:\n  ${problems.join('\n  ')}`)
      .toEqual([]);
  });

  it.each(loadOwnership().filter((e) => e.file === RULES_FILE)
    .map((e) => [`${e.source} · ${e.digest.slice(0, 12)}`, e] as const))(
    '%s names a ticket, a reason and a digest',
    (_name, entry: OwnershipEntry) => {
      expect(entry.ticket).toMatch(/^(?:THE-\d+|#\d+)$/);
      expect(entry.why.length,
        'a reason under the floor is a shrug, not a record').toBeGreaterThan(MIN_REASON_LENGTH - 1);
      expect(entry.digest).toMatch(/^[0-9a-f]{64}$/);
    },
  );

  it('🔴 and dropping the ticket or the reason from a rules entry is refused', () => {
    const good = loadOwnership().find((e) => e.file === RULES_FILE) as OwnershipEntry;
    expect(validateOwnership([good])).toEqual([]);
    expect(validateOwnership([{ ...good, ticket: '' }]).join(' ')).toContain('anonymous');
    expect(validateOwnership([{ ...good, why: 'rules' }]).join(' '))
      .toContain('a bare hash is a loophole, not a record');
    expect(validateOwnership([{ ...good, digest: '' }]).join(' '))
      .toContain('exempts the file from its pin entirely');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5 — each pinning suite still asserts its own ticket did not touch the file
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('5 · each pinning suite kept its own assertion', () => {
  it.each(pinningSuites())('%s still asserts it', (suite) => {
    const body = read(suite);
    expect(body, `${suite} imports the register but never asks it anything`)
      .toMatch(/rulesDigestFailure\(\)|acceptedRulesDigests\(\)/);
  });

  it('and every one of them is a suite, where its reviewer reads it', () => {
    for (const suite of pinningSuites()) {
      expect(/(^|\/)__tests__\//.test(suite), `${suite} is not under __tests__`).toBe(true);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6 — the eight content-asserting suites are byte-identical
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ THESE ARE NOT PINS AND THE-325 DOES NOT TOUCH THEM. Each reads
 * `firestore.rules` and asserts something about its CONTENT — line endings, the
 * `isSuperAdmin` literal list, that no rule keys off a plan, that the file does
 * not mention a ticket that does not own it. Consolidating a digest set has
 * nothing to say to any of them, so they are frozen here byte for byte.
 */
const CONTENT_ASSERTING: ReadonlyArray<readonly [string, string]> = [
  ['src/__tests__/the-268-line-endings.test.ts',
    '9285b31bcfb8c3739c39cedb8858a60e3068c635784cf8b8b4b4e9ea93a2a01c'],
  /**
   * ⚠️ EDITED SINCE MEASUREMENT — THE-330, and the digest is APPENDED here as a
   * REPLACEMENT of the recorded value rather than as a second accepted one,
   * because this list pins ONE state per file and THE-330 is the ticket that
   * moved it.
   *
   * 🔴 WHAT THE-330 CHANGED IN IT, AND WHY EACH WAS FORCED: this suite pinned
   * the SMS number panel's country and area fields as `ui/input` text boxes and
   * pinned their `slice(0, 2)` / `slice(0, 4)` length caps as figures that may
   * not move. Replacing those free-text boxes with pickers IS THE-330 — a
   * church could not be expected to know that `DE` is offerable, that it cannot
   * text, and that `615` is not a German area code. The claims were not dropped:
   * the input assertion became an assertion that the field is a `<select>` and
   * that no `input#sms-country` exists, which fails on the revert this ticket
   * exists to prevent; the two `slice` figures describe a field that no longer
   * takes typing at all; and `skeleton`/`item` moved out of REJECTED_OUTRIGHT
   * (their call-site rejections stand, and `select` replaced them there) for
   * exactly the reason `card` was never in that list — the rejection is per
   * element, so file-level absence is the wrong question.
   *
   * It still asserts CONTENT and still pins no digest, so it remains out of
   * THE-325's own bounds; this record only says which ticket last moved it.
   */
  /* 🔵 REPINNED AT THE-335, which is the ticket that last moved each of these
     four. None of them was loosened; each followed a matrix cell or a switch:
       · THE-320.sms-composition — the master switch is mocked ON at the head of
         the file, because `AdminSms` renders `null` while it is off and every
         composition assertion would otherwise measure an empty string.
       · plan-features.crm-individual, plan-features.news-feed and
         plan-flag-surface-guard — free's `crm` went false and a new `signups`
         cell went true, on the founder's split, so each file's transcription of
         the matrix moved with it. `plan-flag-surface-guard` also gained the
         registry entry that proves the new cell is READ rather than inert.
     They still assert CONTENT and still pin no digest, so they remain out of
     THE-325's own bounds; this record only says which ticket last moved them. */
  ['src/components/__tests__/THE-320.sms-composition.test.tsx',
    '4c5729f359d64519f504f5f73287a2c730ebab34359b8399e2cf557bf8ffdca9'],
  /* 🔴 MOVED BY THE-338, which removes the Harvest palette FAMILY. This suite
     asserted that globals.css still declared the family's two
     `[data-palette="classic"]` selectors, as its way of saying "all four
     palettes still resolve". The family's 14 overrides were promoted into
     :root/.dark and its selectors deleted, so the assertion now reads the two
     theme scopes and requires that no family selector came back. It still
     asserts CONTENT and still pins no digest, so it remains out of THE-325's
     own bounds; this record only says which ticket last moved it. */
  ['src/components/__tests__/the-255-install-app.test.tsx',
    'fc60a87f7b7d0396129963c43df16d3122788e461c65c90361da1566ad6dfcd2'],
  ['src/lib/__tests__/super-admin-consistency.test.ts',
    '2e5e38006a0c0da07b38bef1eac0fbc093fe722d5406dd1cf27aa5cb452f9a35'],
  ['src/lib/dodo/__tests__/dodo-subscription-lifecycle.test.ts',
    '3fa216c7ce56ffb0a54092b82a4552f11ce76efa3ff3fcf755cc7222f99c0390'],
  ['src/utils/__tests__/plan-features.crm-individual.test.ts',
    'b4d6c211ae5260da6b6866529f58bb0c003863ea583e3824791836c2608c73d8'],
  ['src/utils/__tests__/plan-features.news-feed.test.ts',
    '76eed2ae08d7c4b52220b27d23fad5456b844b33822cdfb43813d85db49f828f'],
  ['src/utils/__tests__/plan-flag-surface-guard.test.ts',
    '75e67239ed7798bc2995c99c965843f03bffd162748532c159dfa142930584d7'],
];

describe('6 · the content-asserting suites are untouched', () => {
  it('there are eight of them', () => {
    expect(CONTENT_ASSERTING).toHaveLength(8);
  });

  it.each(CONTENT_ASSERTING)('%s is byte-identical', (rel, digest) => {
    expect(sha256(readFileSync(path.join(ROOT, rel))),
      `${rel} was edited — it asserts CONTENT, not a digest, and is out of THE-325's bounds`)
      .toBe(digest);
  });

  it('and none of them was quietly turned into a digest pin', () => {
    for (const [rel] of CONTENT_ASSERTING) {
      expect(read(rel), `${rel} now routes to the register — it never pinned a digest`)
        .not.toContain(PIN_MODULE);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7 — THE-322's population pin still works
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("7 · THE-322's population pin still works", () => {
  const THE322 = 'src/__tests__/THE-322.ownership-register.test.ts';

  it('it counts the same population, by the marker that survived the move', () => {
    const body = read(THE322);
    expect(body, "THE-322's section 5 no longer counts anything")
      .toContain('the population never shrank — nothing was consolidated away');
    expect(body, 'the count was not updated to the population THE-325 leaves')
      .toContain(`const RULES_PINNERS_NOW = ${PINNING_SUITES};`);
  });

  it('and THE-322 is itself one of the pinners it counts', () => {
    expect(pinningSuites(), 'THE-322 stopped pinning firestore.rules').toContain(THE322);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8 — no source file in this change, and firestore.rules is byte-identical
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('8 · test and fixture files only', () => {
  it('🔴 firestore.rules is byte-identical to the state THE-325 found it in', () => {
    expect(rulesDigestOnDisk(),
      'firestore.rules was edited — this ticket may not open it, and it auto-deploys to production')
      .toBe(ACCEPTED_BEFORE[1][0]);
  });

  it('every file THE-325 touched is a test or a fixture under __tests__', () => {
    const touched = [...pinningSuites(), ...THE_325_NEW_FIXTURES,
      'src/components/__tests__/__fixtures__/the-286-untouched.json'];
    expect(touched.length, 'the touched set collapsed — this sweep would prove nothing')
      .toBeGreaterThan(50);
    const offenders = touched.filter((p) => !/(^|\/)__tests__\//.test(p));
    expect(offenders, `THE-325 changes only test files, but these are not:\n  ${offenders.join('\n  ')}`)
      .toEqual([]);
  });

  it('and the two fixtures it adds reach into no file this ticket may not touch', () => {
    /* The suites keep their own pins on `functions/`, `firestore.indexes.json`
       and `layout.tsx`; what is asserted here is that THE-325's own additions
       say nothing about any of them. This file names them in prose, in the
       sentence you are reading, so it is not swept — its own scope is asserted
       by the case above and by section 9. */
    for (const rel of THE_325_NEW_FIXTURES) {
      expect(read(rel), `${rel} reaches into a file this ticket may not touch`)
        .not.toMatch(/functions\/|firestore\.indexes\.json|src\/app\/layout\.tsx/);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 9 — no guard here asks what the current branch changed  (BASE-REF GATED)
 * ═══════════════════════════════════════════════════════════════════════════ */

const gitOut = (args: string[]): string =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * The commit this branch is measured against — the fallback chain THE-315 and
 * THE-322 use, because a `pull_request` run checks out `refs/pull/N/merge`,
 * where `origin/main` may not exist.
 */
function baseRef(): string {
  for (const ref of ['origin/main', 'refs/remotes/origin/main', 'main']) {
    try { return gitOut(['rev-parse', '--verify', `${ref}^{commit}`]).trim(); } catch { /* next */ }
  }
  try {
    const parents = gitOut(['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(/\s+/);
    if (parents.length === 3) return parents[1];
  } catch { /* fall through */ }
  throw new Error('the base commit could not be resolved, so this sweep would measure nothing');
}

/** Does the BASE REF already carry `rel`? The stand-down signal. */
function onBase(rel: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `${baseRef()}:${rel}`],
      { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * 🔴 ASSEMBLED, NOT SPELLED. THE-315's first gate-proof passed with its gate
 * DELETED because the assertion's own error message contained the string it
 * grepped for. Every needle below is joined at run time so this file cannot
 * satisfy its own sweep.
 */
const DIFF_READS = [
  'gi' + 't diff', 'gi' + 't show', 'gi' + 't log',
  'diff --name' + '-only', 'merge' + '-base',
];
const ANY_GIT = [...DIFF_READS, 'exec' + 'Sync(', 'spawn' + 'Sync(', 'node:child' + '_process'];

describe("9 · nothing THE-325 adds asserts anything about this branch's diff", () => {
  it('🔴 the two fixtures it adds ask git nothing at all', () => {
    expect(THE_325_NEW_FIXTURES.length, 'a sweep with nothing to sweep proves nothing')
      .toBeGreaterThan(1);
    for (const rel of THE_325_NEW_FIXTURES) {
      for (const needle of ANY_GIT) {
        expect(read(rel), `${rel} reaches for \`${needle}\``).not.toContain(needle);
      }
    }
  });

  it('🔴 and this suite reads the BASE REF only — never the diff', () => {
    const body = read(SELF);
    for (const needle of DIFF_READS) {
      expect(body, `THE-325's own guard reaches for \`${needle}\``).not.toContain(needle);
    }
    // The one git call it does make, named so replacing it is visible in review.
    expect(body, 'the base-ref signal is gone, so the gate below decides nothing')
      .toContain("['cat-file', '-e', `${baseRef()}:${rel}`]");
  });

  /**
   * 🔴 THE GATE, AND IT ASSERTS IN BOTH STATES. THE-312's amendment is the
   * lesson: a guard whose only claim holds while its ticket is unmerged goes red
   * on `main` the moment it lands, for a reason that has nothing to do with the
   * next branch. So the base ref decides WHICH claim is true, not whether one is:
   *
   *   • THE-325 UNMERGED — the base ref does not carry its three new files, so
   *     the named list above is exactly the set it adds and cannot be stale.
   *   • THE-325 MERGED — the base ref carries all three, and the machinery is
   *     proved directly instead: `onBase` must still tell a tracked path from an
   *     absent one, which is the actual way this could rot into a no-op.
   */
  it('the base-ref gate still answers, in whichever state this branch is in', () => {
    const added = [...THE_325_NEW_FIXTURES, SELF];
    if (!added.every(onBase)) {
      expect(added.filter(onBase),
        'the named list has gone stale — some of it is already on the base ref')
        .toEqual([]);
      return;
    }
    expect(onBase('src/__tests__/__fixtures__/ownership-register.ts'),
      'onBase no longer finds a file the base ref certainly has').toBe(true);
    expect(onBase('src/__tests__/THE-325.a-path-that-was-never-committed.ts'),
      'onBase answers true to everything — the gate would decide nothing').toBe(false);
  });
});
