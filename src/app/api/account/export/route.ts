import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';
import { captureHandledError } from '@/lib/money-path-sentry';
import { tenantAllows } from '@/lib/tenant-lifecycle';
import { resolveContactIds } from '@/lib/member-erasure';
import { exportMemberData, type MemberExportDocument } from '@/lib/member-export';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/account/export — a member downloads EVERYTHING held about them.
 *
 * ── Why this route exists ────────────────────────────────────────────────────
 *
 * 🔴 /api/account/delete shipped first, and it shipped alone. A member can erase
 * themselves across 25 collections and cannot take a copy of any of it with
 * them. Every read that exists today is per-surface — their own donation
 * history, the admin CSVs inside AdminCheckin and AdminForms, a giving
 * statement. None of them is "everything you hold about me", which is the one
 * the erasure needed a partner for.
 *
 * This is the GDPR Art. 15/20 half of the pair. See src/lib/member-export.ts for
 * what is in it, what is deliberately not, and why the set is derived from the
 * same MEMBER_DATA_MAP the erasure walks rather than written out a second time.
 *
 * ── 🔴 NEVER GATED, AND SPECIFICALLY NOT ON AN ACTIVE SUBSCRIPTION ───────────
 *
 * There is no plan check here and there is none in the library. The one
 * lifecycle question this route asks is `tenantAllows(status, 'export')`, and
 * `export` is on `NEVER_GATED` in tenant-lifecycle.ts — so the answer is true
 * for every status there is, ARCHIVED INCLUDED. That is REP-4's decision
 * verbatim: a church whose subscription ended keeps admin login, full read and
 * every export, and its members keep their own.
 *
 * ⚠️ The call is deliberately made rather than skipped. Asking the lifecycle
 * module and getting an unconditional yes is what makes a future gate a VISIBLE
 * edit — someone would have to remove `export` from `NEVER_GATED`, and the test
 * named for the archived tenant fails the moment they do. A route that simply
 * never mentioned `status` would be gated silently the first time somebody added
 * a check.
 *
 * ── 🔴 ONE MEMBER, THEIR OWN DATA, NEVER A TENANT'S ──────────────────────────
 *
 * Ownership is checked here and the scope is proven concrete in the library.
 * There is deliberately NO super-admin bypass, exactly as in the delete route:
 * this is the SELF-SERVICE path. `getTenantScope()` returns null for a super
 * admin, and on a read null means every tenant — one response containing every
 * church's members. So every query the library builds goes through
 * `assertConcreteScope`, and a member with no tenant gets their profile plus
 * tenant-scoped sections marked skipped BY NAME, never a null-scoped read.
 *
 * The response also contains no tenant-wide content: church-owned collections
 * (blog posts, courses, docs, campaigns, events, newsletters) are recorded in
 * `omitted` with the reason, and every returned row is matched on the caller's
 * own uid, own email, or a CRM contact id resolved from those. The CHURCH export
 * — what an admin may take on the church's behalf — is a separate route and a
 * separate PR; see the PR description.
 *
 * ── Why a recent sign-in ─────────────────────────────────────────────────────
 *
 * ⚠️ Re-imposed on purpose, mirroring the delete route's window and returning
 * the same 'auth/requires-recent-login' code so the client's existing
 * re-authenticate-in-place panel answers it. This route returns, in one
 * response, everything an attacker holding a stolen long-lived session would
 * otherwise have to scrape surface by surface. Art. 12(6) expressly allows
 * asking for confirmation of identity before answering a subject-access request,
 * and a five-minute-old sign-in is not undue hindrance — it is the same step the
 * member already takes to delete the same data.
 *
 * ── A partial export is never reported as whole ──────────────────────────────
 *
 * A truncated export that looks complete is worse than no export. Every section
 * carries its own `count` and `truncated`; a section that threw is named in
 * `failures` and flips the document to `status: 'partial'`. A partial document
 * comes back with a NON-2XX — the rows that were read are still in the body, so
 * nothing is thrown away, but no caller can mistake it for the whole file.
 *
 * ── Reads, and what they cost ────────────────────────────────────────────────
 *
 * Every section is cursor-paged at 400 documents; nothing lands in memory whole.
 * The document reports `reads` — the actual number of documents this run read —
 * rather than an estimate. For a typical member it is dominated by the tenant's
 * donation invoices, which have no per-member index and are scanned and matched
 * in memory exactly as /api/donation-history and the erasure scan them.
 */

/** Mirrors RECENT_LOGIN_WINDOW_SECONDS in the delete route, for the same reason. */
const RECENT_LOGIN_WINDOW_SECONDS = 5 * 60;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

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

  // 🔴 A member exports their own data and nobody else's. No super-admin bypass:
  // an admin-initiated export of another person is a different flow with a
  // different lawful basis, and bolting it on here would put a cross-user read
  // of everything into the one route whose job is to hand over everything.
  if (userId !== userOrErr.uid) {
    return NextResponse.json(
      { error: 'You can only export your own data.', step: 'ownership' },
      { status: 403 },
    );
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - userOrErr.authTime;
  if (!userOrErr.authTime || ageSeconds > RECENT_LOGIN_WINDOW_SECONDS) {
    return NextResponse.json(
      {
        error: 'For your security, downloading your data needs a recent sign-in.',
        code: 'auth/requires-recent-login',
        step: 'reauth',
      },
      { status: 401 },
    );
  }

  let doc: MemberExportDocument;
  try {
    // The profile is read first because it is the only place the member's tenant
    // lives, and every tenant-scoped section needs a concrete one.
    const profile = await adminDb.collection('users').doc(userId).get();
    const data = profile.exists ? profile.data() ?? {} : {};
    const tenantId = typeof data.tenantId === 'string' && data.tenantId ? data.tenantId : '';
    const email = (typeof data.email === 'string' ? data.email : userOrErr.email ?? '').trim().toLowerCase();

    if (tenantId) {
      // 🔴 REP-4's promise, asked out loud. `export` is NEVER_GATED, so this is
      // true for an archived tenant and for every other status — including a
      // tenant document that does not exist. See the header on why the question
      // is asked at all.
      const tenantSnap = await adminDb.collection('tenants').doc(tenantId).get();
      const status = tenantSnap.exists ? tenantSnap.data()?.status : undefined;
      if (!tenantAllows(status, 'export')) {
        return NextResponse.json(
          {
            error:
              'Exports are never gated by a subscription. Reaching this means `export` was removed from NEVER_GATED in tenant-lifecycle.ts.',
            step: 'lifecycle',
          },
          { status: 403 },
        );
      }
    }

    // Resolved the same way and in the same order the erasure resolves them:
    // form submissions and check-in rows are reachable ONLY through the CRM
    // contact id.
    const contactIds = tenantId ? await resolveContactIds(userId, email, tenantId) : [];
    doc = await exportMemberData({ uid: userId, email, tenantId, contactIds });
  } catch (e) {
    captureHandledError(e, { step: 'account-export', ids: { uid: userId } });
    return NextResponse.json(
      {
        error: 'Your export could not be built. Nothing was changed — please try again.',
        step: 'export',
        detail: errMsg(e),
      },
      { status: 500 },
    );
  }

  if (doc.status === 'partial') {
    captureHandledError(new Error(doc.error ?? 'member export incomplete'), {
      step: 'account-export-partial',
      ids: { uid: userId, failed: doc.failures.map((f) => f.collection).join(',') },
    });
    // The rows that WERE read stay in the body — a member chasing their data
    // should not lose 24 sections because one failed. The status code is what
    // stops any caller treating this file as the whole of it.
    return NextResponse.json({ ...doc, step: 'export' }, { status: 500 });
  }

  return NextResponse.json(doc);
}
