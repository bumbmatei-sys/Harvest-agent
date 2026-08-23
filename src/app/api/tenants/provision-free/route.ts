import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { captureHandledError } from '@/lib/money-path-sentry';
import { provisionFreeTenant, FreeProvisioningError } from '@/lib/free-provisioning';

export const dynamic = 'force-dynamic';

/**
 * Provision a Forever Free tenant. (THE-203)
 *
 * The free half of the signup funnel. `/api/dodo/checkout` deliberately refuses
 * `plan: 'free'` — free is absent from `PRICED_PLAN_ORDER` because it has no
 * Dodo product to check out against — so without this route a visitor arriving
 * on `?signup=free` reaches ChurchOnboarding, presses the button, and is
 * answered `400 Invalid plan/billing: free/monthly`.
 *
 * 🔴 NO CARD, NO CHECKOUT, NO WEBHOOK. The tenant is built in this request.
 *
 * ⚠️ WHY THIS IS NOT A HOLE IN THE DOUBLE-CHARGE GUARD.
 *
 * `/api/dodo/checkout` refuses when the body carries a `tenantId`, and that
 * guard is what stops a paying church opening a second subscription. This route
 * does not weaken it, because it creates NO subscription at all — there is
 * nothing here to charge twice. Its own guard is the complementary one, and it
 * is stricter: the caller must not already belong to an organization.
 *
 * ⚠️ ABUSE, STATED RATHER THAN SOLVED (the brief asks for the exposure to be
 * NAMED, not closed).
 *
 * A Forever Free tenant costs nothing, needs no card, and comes with a public
 * subdomain. What stops one person creating fifty of them is, today, exactly
 * one thing: `provisionFreeTenant`'s idempotency guard refuses a second tenant
 * for the same `users/{uid}` document. So the cost of fifty tenants is fifty
 * Firebase Auth accounts, i.e. fifty distinct email addresses — which Gmail
 * dot/plus-addressing makes free and instant, and which nothing here detects.
 *
 * There is no rate limit on this route, no email-domain check, no captcha and
 * no manual review. Each such tenant burns a subdomain from a global namespace
 * that is first-come-first-served, and `generateUniqueSubdomain` will happily
 * hand out `grace-church-2` … `grace-church-51`. THAT is the exposure: not
 * compute, not storage — the public namespace, and the support cost of
 * reclaiming a name a real church later wants.
 *
 * Deliberately not solved here. Naming it is the deliverable; picking the
 * mitigation (verified email before provisioning, a per-IP rate limit, a
 * reserved-name policy) is a product decision with its own ticket.
 */
export async function POST(request: NextRequest) {
  try {
    const userOrErr = await requireAuth(request);
    if (userOrErr instanceof Response) return userOrErr;

    // A user who already belongs to an organization must NOT self-provision a
    // second tenant. Same guard and same wording as both paid signup paths.
    // Super admins legitimately have no tenant, and must not acquire one here.
    if (userOrErr.tenantId && !userOrErr.isSuperAdmin) {
      return NextResponse.json({ error: 'You already belong to an organization.' }, { status: 400 });
    }
    if (userOrErr.isSuperAdmin) {
      return NextResponse.json(
        { error: 'A platform super admin cannot provision a ministry for themselves.' },
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const ministryName = typeof body?.ministryName === 'string' ? body.ministryName : '';
    // THE-214: the address the signup screen collected, when it collected one.
    // Untrusted like everything else off a request body, and sanitised by
    // `generateUniqueSubdomain` rather than here — that helper already strips
    // it to [a-z0-9-], caps its length, refuses the reserved labels and
    // de-collides, and a second opinion about what a legal subdomain is would
    // be the fifth one in this repo.
    const subdomain = typeof body?.subdomain === 'string' ? body.subdomain : '';

    const result = await provisionFreeTenant({
      userId: userOrErr.uid,
      ministryName,
      userEmail: userOrErr.email || null,
      requestedSubdomain: subdomain,
    });

    return NextResponse.json({
      tenantId: result.tenantId,
      // Reported so the client can tell "I built this" from "you already had
      // one" without a second read. Both are successes: a double-submitted
      // button must not surface as an error to someone whose church exists.
      created: result.outcome === 'created',
    });
  } catch (error: any) {
    if (error instanceof FreeProvisioningError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Free provisioning error:', error?.message || error);
    // Not the money path — nothing is being charged — but a failure here is a
    // church that cannot be created at all, which is the same shape of loss.
    captureHandledError(error, { step: 'free-tenant-provisioning', level: 'error' });
    return NextResponse.json(
      { error: 'Could not create your ministry. Please try again.' },
      { status: 500 },
    );
  }
}
