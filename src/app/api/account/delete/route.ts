import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';
import { captureHandledError } from '@/lib/money-path-sentry';
import { emptyReport, type DeletionReport } from '@/lib/member-deletion';
import { eraseMemberData, resolveContactIds } from '@/lib/member-erasure';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/account/delete   — a member deletes their OWN account.
 *
 * ⚠️ DESTRUCTIVE & IRREVERSIBLE.
 *
 * ── Why this route exists ────────────────────────────────────────────────────
 * The client used to do both halves itself:
 *
 *     deleteDoc(users/{uid})   →  DENIED for every ordinary member
 *     deleteUser(currentUser)  →  succeeded anyway
 *
 * because firestore.rules gives `match /users/{userId}` `allow delete: if
 * isSuperAdmin()`, and the denial was logged rather than thrown. The result was
 * not a half-deletion in the harmless direction: THE SIGN-IN WAS DESTROYED AND
 * THE PROFILE DOCUMENT SURVIVED — name, email, phone, course progress, quiz
 * attempts, lesson notes — with no account left that could reach it and no
 * member-facing route that could remove it. The orphan kept its `tenantId`, so
 * it stayed in the tenant's user queries: counted against `maxContacts` and
 * listed in the CRM as a person who does not exist.
 *
 * ── Why a route and not a rules change ───────────────────────────────────────
 * The Admin SDK bypasses rules, so firestore.rules is untouched (nothing
 * deploys to production Firestore on merge — `deploy-rules.yml` fires on any
 * edit to that file and its blast radius is app-wide). Loosening the rule to
 * `request.auth.uid == userId` would also grant self-deletion EVERYWHERE, not
 * just in this flow, and would leave the operation split across two unordered
 * client calls with no way to recover from the first one failing. Here both
 * deletions are ordered, verified, and reported.
 *
 * ── Deletion order: SATELLITE DATA, THEN THE DOCUMENT, THEN THE AUTH USER ────
 *
 * ⚠️ STEP 0 CAME LATER (THE-76). This route originally removed `users/{uid}` and
 * the Auth account and NOTHING ELSE, and said so: everything keyed to the member
 * elsewhere was left as "a retention decision". It is one, and the decision is
 * now made and enumerated — see MEMBER_DATA_MAP in src/lib/member-erasure.ts,
 * which names every collection holding a uid, an email, a name or a photo URL
 * and says for each whether it is deleted, anonymised, or kept on purpose.
 *
 * The sweep runs BEFORE the profile document, and the profile document is only
 * deleted if the sweep came back clean. That ordering is the whole safety
 * property: a member whose sweep half-failed still has their profile, still has
 * their session, and can retry — and the retry is idempotent, because every
 * sweep is keyed on identity and finds nothing left the second time. Deleting
 * the profile first would strand any collection the sweep had not reached, since
 * `users/{uid}` is where the member's tenant and email are read from.
 *
 * Both orders leave a broken state if the second step fails, so the question is
 * which broken state a member can get OUT of. The caller's own credential is the
 * only thing that can drive a retry, and deleting the Auth user destroys it:
 *
 *   auth-first, then a document failure  → today's orphan exactly. No session
 *     survives, so nobody can retry, and only a super admin can clean up.
 *     UNRECOVERABLE BY THE MEMBER.
 *   document-first, then an auth failure → a live sign-in with no profile. Ugly,
 *     but the member is still signed in, still holds a valid token, and the
 *     retry is idempotent (the doc is already gone, so step 1 verifies clean and
 *     step 2 runs again). RECOVERABLE.
 *
 * A step-1 failure is therefore a true no-op: nothing is deleted and the account
 * is exactly as it was. That is the whole point — the bug being fixed is a
 * first step that failed and let the second one run anyway.
 *
 * ⚠️ NOTE the opposite choice in /api/tenants/delete, which deletes Auth FIRST.
 * That is not a contradiction: there a SUPER ADMIN is deleting other people's
 * accounts, so the retrier's credential is never the one being destroyed, and a
 * leftover Auth account (can still sign in, email locked against re-signup) is
 * the worse leftover. Here the retrier IS the account. Different actor,
 * different order.
 *
 * ── Partial failure is never a 200 ───────────────────────────────────────────
 * Every response names `step` and reports `documentDeleted` / `authDeleted`
 * exactly as they are, and now carries a `report` naming every collection that
 * was cleared, anonymised, retained, or failed. A route that clears 24 of 25
 * collections and returns 200 is worse than one that fails loudly, so a sweep
 * with any failure returns 500 with `report.status: 'partial'` and touches
 * neither the profile nor the sign-in. The report follows the shape the SMS
 * broadcast established in THE-29: explicit per-target counters, an explicit
 * 'complete' | 'partial' status, and a spelled-out `error` when partial — not a
 * success body a caller has to diff to notice something survived.
 *
 * ── What this deliberately does NOT delete ───────────────────────────────────
 * DONATION RECORDS. A church needs its giving history to close its books and a
 * donor needs the receipt for their tax return, so invoices, giving statements,
 * pledges and 'donation' CRM activities survive with their figures intact and
 * their identity replaced by a stable pseudonym. Two collections also survive
 * because they carry no member key at all — livestream prayers and SMS delivery
 * logs; both are named as gaps in the report rather than guessed at. Every
 * disposition and its reason is in MEMBER_DATA_MAP.
 */

/**
 * How recently the caller must have signed in, in seconds. Mirrors the ~5-minute
 * window Firebase's CLIENT SDK enforces on `deleteUser` before it throws
 * 'auth/requires-recent-login'.
 *
 * ⚠️ Re-imposed on purpose. `adminAuth.deleteUser` has no freshness guard, so
 * without this, moving deletion server-side would let a stolen long-lived
 * session delete an account — WEAKER than the flow it replaces. Rejecting with
 * the same 'auth/requires-recent-login' code keeps the client's existing
 * re-authenticate-in-place panel as the response to it.
 */
const RECENT_LOGIN_WINDOW_SECONDS = 5 * 60;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The Auth-side "already gone" code — a retry that finds nothing left succeeded. */
const USER_NOT_FOUND = 'auth/user-not-found';
const codeOf = (e: unknown) => (e as { code?: string } | null)?.code;

export async function POST(request: NextRequest) {
  const userOrErr = await requireAuth(request);
  if (userOrErr instanceof NextResponse) return userOrErr; // 401, unauthenticated

  let body: { userId?: unknown } = {};
  try {
    body = (await request.json()) as { userId?: unknown };
  } catch {
    // Fall through to the missing-userId 400 below.
  }
  const userId = typeof body.userId === 'string' ? body.userId : '';

  if (!userId) {
    return NextResponse.json({ error: 'Missing required field: userId' }, { status: 400 });
  }

  // Ownership. Deliberately NO super-admin bypass, unlike the tenant-scoped
  // routes: this is the SELF-SERVICE path, and admin-initiated removal is a
  // separate flow (AnalyticsAndRoles). A bypass here would add an untested
  // cross-user delete to the one route whose entire job is deleting accounts.
  if (userId !== userOrErr.uid) {
    return NextResponse.json(
      { error: 'You can only delete your own account.', step: 'ownership' },
      { status: 403 },
    );
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - userOrErr.authTime;
  if (!userOrErr.authTime || ageSeconds > RECENT_LOGIN_WINDOW_SECONDS) {
    return NextResponse.json(
      {
        error: 'For your security, deleting an account needs a recent sign-in.',
        code: 'auth/requires-recent-login',
        step: 'reauth',
        documentDeleted: false,
        authDeleted: false,
      },
      { status: 401 },
    );
  }

  const userRef = adminDb.collection('users').doc(userId);

  // ── STEP 0: everything else the member is in ──────────────────────────────
  // Read the profile FIRST — it is the only place the member's tenant lives, and
  // every tenant-scoped sweep below needs a concrete one. A member with no
  // tenant has no tenant-scoped data to sweep, so the sweep is skipped and said
  // to be skipped; it is never run with a null scope (see assertConcreteScope).
  let report: DeletionReport = emptyReport();
  try {
    const profile = await userRef.get();
    const data = profile.exists ? profile.data() ?? {} : {};
    const tenantId = typeof data.tenantId === 'string' && data.tenantId ? data.tenantId : '';
    const email = (typeof data.email === 'string' ? data.email : userOrErr.email ?? '').trim().toLowerCase();

    if (tenantId) {
      // Resolved before anything is deleted: form submissions and check-in rows
      // are reachable ONLY through the CRM contact id, so clearing the contacts
      // first would make them permanently unreachable.
      const contactIds = await resolveContactIds(userId, email, tenantId);
      report = await eraseMemberData({ uid: userId, email, tenantId, contactIds });
    } else {
      report.retained['(tenant-scoped collections)'] =
        'Skipped — this account carries no tenant, so it has no tenant-scoped data.';
    }
  } catch (e) {
    // A throw here is the sweep itself failing to even start (an unreadable
    // profile, a rejected scope). Nothing has been deleted, so this is a clean
    // no-op that the member can retry from a session they still hold.
    report.status = 'partial';
    report.failures.push({ collection: '(sweep)', message: e instanceof Error ? e.message : String(e) });
    report.error = 'Deletion could not start — nothing was removed.';
  }

  if (report.status === 'partial') {
    // 🔴 THE LOUD STOP. Some of the member's data survives, so the profile and
    // the sign-in are both left alone: that is what keeps the member's own
    // credential — the only thing that can drive a retry — alive.
    captureHandledError(new Error(report.error ?? 'account deletion sweep incomplete'), {
      step: 'account-delete-sweep',
      ids: { uid: userId, failed: report.failures.map((f) => f.collection).join(',') },
    });
    return NextResponse.json(
      {
        error:
          'Some of your data could not be removed, so nothing else was deleted and you are still signed in. Please try again.',
        step: 'sweep',
        documentDeleted: false,
        authDeleted: false,
        report,
      },
      { status: 500 },
    );
  }

  // ── STEP 1: the profile document ──────────────────────────────────────────
  // Deleted AND read back. A delete that quietly does nothing is precisely the
  // failure this route exists to stop, so "it did not throw" is not accepted as
  // proof; the document has to actually be gone before step 2 is allowed to run.
  try {
    await userRef.delete();
    const after = await userRef.get();
    if (after.exists) {
      throw new Error('users document still present after delete');
    }
  } catch (e) {
    captureHandledError(e, { step: 'account-delete-document', ids: { uid: userId } });
    return NextResponse.json(
      {
        error: 'Your profile could not be deleted, so your sign-in was left untouched. Nothing was removed — please try again.',
        step: 'document',
        detail: errMsg(e),
        documentDeleted: false,
        authDeleted: false,
        report,
      },
      { status: 500 },
    );
  }

  // ── STEP 2: the Auth account ──────────────────────────────────────────────
  // Read back symmetrically: `getUser` must come back 'auth/user-not-found'.
  // If verification is the one that fails, this reports a non-success for a
  // deletion that may well have worked — the safe direction, and self-healing:
  // the retry finds the document already gone and the Auth user already absent,
  // and returns success.
  try {
    await adminAuth.deleteUser(userId);
    await adminAuth.getUser(userId);
    throw new Error('auth user still present after delete');
  } catch (e) {
    if (codeOf(e) !== USER_NOT_FOUND) {
      captureHandledError(e, { step: 'account-delete-auth', ids: { uid: userId } });
      // The loud half-deletion: the profile IS gone and the sign-in is NOT.
      // Reported as such rather than dressed up as success.
      return NextResponse.json(
        {
          error: 'Your profile was deleted but your sign-in could not be removed. Please try again — you are still signed in.',
          step: 'auth',
          detail: errMsg(e),
          documentDeleted: true,
          authDeleted: false,
          report,
        },
        { status: 500 },
      );
    }
    // Already absent — the goal state holds, so this counts as deleted.
  }

  return NextResponse.json({
    success: true,
    step: 'complete',
    documentDeleted: true,
    authDeleted: true,
    report,
  });
}
