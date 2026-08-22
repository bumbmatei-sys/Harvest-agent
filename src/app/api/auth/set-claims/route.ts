import { NextRequest, NextResponse } from 'next/server';
import { setCustomClaims } from '@/lib/set-custom-claims';
import { adminAuth } from '@/lib/firebase-admin';
import { captureHandledError } from '@/lib/money-path-sentry';
import { checkRateLimit } from '@/lib/rate-limit';
import { decideMemberAdmission } from '@/lib/member-capacity';
import { MEMBER_CAP_CODE, memberCapCopy } from '@/utils/member-capacity-copy';

/**
 * POST /api/auth/set-claims
 * Sets custom claims on a user's Firebase Auth token.
 * Called after user registration or role change.
 *
 * Body: { uid: string }
 * Auth: Bearer token required (the user themselves or a super admin)
 *
 * THE-201 — this is THE ENFORCEMENT POINT of the member signup cap.
 *
 * `firestore.rules` lets any authenticated user create their own `users/{uid}`
 * doc, and this PR is forbidden from touching that file (it auto-deploys to
 * production on merge). So the `users` doc itself cannot be made server-only
 * here. But `setCustomClaims` is the ONLY issuer of `claims.tenantId`, it runs
 * server-side with the Admin SDK, and `firestore.rules` gate all tenant content
 * on that claim. **Withholding the claim is enforcement devtools cannot bypass.**
 *
 * On a refusal this route returns 409 and does NOT call `setCustomClaims`.
 * It never deletes, disables, detaches or modifies anybody — not the applicant,
 * not any other member. Declining to issue a claim is the whole action.
 */
export async function POST(request: NextRequest) {
  try {
    // On the signup path and reachable by anyone holding a token: brute-force
    // protection, same category as the rest of auth. (Inert on preview deploys,
    // where Upstash is unconfigured — see AGENTS.md.)
    const limited = await checkRateLimit(request, 'auth');
    if (limited) return limited;

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

    // THE-201 — the member-signup cap. A throw in here propagates to the catch
    // below and becomes a 500 through captureHandledError: the gate fails LOUD,
    // never open, and never into a default.
    const decision = await decideMemberAdmission(uid);
    if (!decision.allowed) {
      const copy = memberCapCopy(decision.ministryName);
      // 409, not 403. 403 in this codebase means "you are not allowed to do
      // this" (an admin being told about a plan). 409 Conflict says "the
      // target's state prevents this", which is exactly true, and keeps the two
      // apart in logs. The client keys off `code`, never off the status alone.
      return NextResponse.json(
        { error: copy.title, code: MEMBER_CAP_CODE, title: copy.title, body: copy.body },
        { status: 409 },
      );
    }

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
