import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';
import { captureHandledError } from '@/lib/money-path-sentry';

export const dynamic = 'force-dynamic';

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
 * ── Deletion order: DOCUMENT FIRST, THEN THE AUTH USER ───────────────────────
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
 * exactly as they are. A failure at either step returns a non-2xx. Returning a
 * success body for a half-completed deletion would be the original bug rebuilt
 * on the server.
 *
 * ── What this does NOT delete ────────────────────────────────────────────────
 * Only `users/{uid}` and the Auth account. Data keyed to the member elsewhere —
 * CRM contact rows, giving history, prayer requests, community posts and DMs,
 * event registrations, check-in records — is deliberately left alone; widening
 * the scope is a retention decision (a donation record is a financial record a
 * church may be required to keep), not a code cleanup. The member-facing copy
 * says what is and is not removed rather than implying a full erasure.
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
  });
}
