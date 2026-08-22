import { NextRequest, NextResponse } from 'next/server';
import { setCustomClaims } from '@/lib/set-custom-claims';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { captureHandledError } from '@/lib/money-path-sentry';
import { decideMemberCapacity, stampRefusal } from '@/lib/member-capacity';
import {
  MEMBER_CAP_REFUSED_CODE,
  MEMBER_CAP_UNAVAILABLE_CODE,
  MEMBER_CAP_UNAVAILABLE_MESSAGE,
  memberCapRefusalMessage,
} from '@/utils/member-cap-copy';

/**
 * POST /api/auth/set-claims
 * Sets custom claims on a user's Firebase Auth token.
 * Called after user registration or role change.
 *
 * Body: { uid: string }
 * Auth: Bearer token required (the user themselves or a super admin)
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE-201 — this route is THE ENFORCEMENT POINT of the member-signup cap.
 *
 * `setCustomClaims` is the ONLY issuer of `claims.tenantId` in the codebase, it
 * runs server-side with the Admin SDK, and `firestore.rules` gate every piece
 * of tenant content on that claim. So refusing to CALL it is a real gate, not
 * decoration — no client can mint a custom claim for itself.
 *
 * 🔴 The check lives HERE, in the route, and NOT inside `setCustomClaims`.
 * That function wraps its whole body in `try { … } catch { console.error }` and
 * returns `void`. A refusal thrown inside it would be swallowed, logged to a
 * console nobody reads, and this route would answer 200 success to a person who
 * was actually refused — exactly the shape AGENTS.md's Silent-Failure Rule
 * forbids. `set-custom-claims.ts` is therefore not modified at all; this route
 * short-circuits before ever reaching it.
 *
 * Statuses this route can now answer:
 *
 *   200  allowed, or the cap did not apply (super admin / no tenant / existing
 *        member / unlimited add-on). Claims minted, unchanged behaviour.
 *   403  `Forbidden`                — uid mismatch and not a super admin (existing).
 *   403  `member_cap_reached`       — the tenant is at its member cap. Claims
 *        WITHHELD. The two 403s are distinguished by `code`, which is why
 *        `code` is mandatory on the new one.
 *   503  `capacity_check_unavailable` — the capacity check itself could not run.
 *        NOT an allow and NOT a refusal: we do not know whether the ministry is
 *        full, so the copy does not claim it is. Claims withheld, retry invited.
 *   500  anything else throws (existing).
 *
 * 🔴 Nothing on the refusal path deletes, disables, detaches or demotes
 * anybody. Refusing a NEW account is the whole action; every existing member
 * keeps everything.
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    const { uid } = await request.json();

    // Users can only set their own claims, unless they're a super admin
    if (decodedToken.uid !== uid && !decodedToken.superAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ── THE-201 member-signup cap ──────────────────────────────────────────
    // The tenant comes from the TARGET uid's own `users` doc, read server-side.
    // Never from the request body, never from the Host header. When a super
    // admin calls this route for someone else, "self" is the target uid.
    const [applicantSnap, authUser] = await Promise.all([
      adminDb.collection('users').doc(uid).get(),
      adminAuth.getUser(uid),
    ]);

    const applicantTenantId = (applicantSnap.data() as { tenantId?: unknown } | undefined)?.tenantId;
    // D3 — "is this person already a member?" is answered from the Auth custom
    // claim, NOT the `users` doc: the doc is client-writable (rules:144), the
    // claim is not.
    const existingClaimTenantId = (authUser.customClaims as { tenantId?: unknown } | undefined)
      ?.tenantId;

    const capacity = await decideMemberCapacity({
      uid,
      applicantTenantId: typeof applicantTenantId === 'string' ? applicantTenantId : null,
      existingClaimTenantId:
        typeof existingClaimTenantId === 'string' ? existingClaimTenantId : null,
    });

    if (capacity.status === 'refused') {
      // C2 — stamp the ghost so the follow-up sweep can find it. Best-effort
      // and non-throwing by contract; it must not turn a clean 403 into a 500.
      await stampRefusal(uid, String(applicantTenantId));

      return NextResponse.json(
        {
          error: memberCapRefusalMessage(capacity.ministryName),
          code: MEMBER_CAP_REFUSED_CODE,
        },
        { status: 403 },
      );
    }

    if (capacity.status === 'unavailable') {
      // Neither an allow nor a refusal. `captureHandledError` already fired
      // inside the decision with the specific failing step.
      return NextResponse.json(
        {
          error: MEMBER_CAP_UNAVAILABLE_MESSAGE,
          code: MEMBER_CAP_UNAVAILABLE_CODE,
        },
        { status: 503 },
      );
    }

    // 'allowed' and every 'skipped' reason fall through to the unchanged path.
    await setCustomClaims(uid);

    return NextResponse.json({ success: true, forceRefresh: true });
  } catch (error: any) {
    console.error('set-claims error:', error);
    // Called right after registration and after every role change. When it fails,
    // the Firestore user doc says one thing and the Auth token says another — the
    // person is signed in but firestore.rules deny them their own tenant.
    captureHandledError(error, { step: 'auth-set-claims' });
    return NextResponse.json({ error: 'Failed to set claims' }, { status: 500 });
  }
}
