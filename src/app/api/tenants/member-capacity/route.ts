import { NextRequest, NextResponse } from 'next/server';
import { captureHandledError } from '@/lib/money-path-sentry';
import { checkRateLimit } from '@/lib/rate-limit';
import { canTenantAcceptMember } from '@/lib/member-capacity';
import { MEMBER_CAP_CODE, memberCapCopy } from '@/utils/member-capacity-copy';

/**
 * POST /api/tenants/member-capacity — THE-201 pre-flight.
 *
 * ⚠️ THIS IS A UX AFFORDANCE, NOT THE GATE. It exists so a real human never ends
 * up with a half-created account. The enforcement is POST /api/auth/set-claims,
 * which withholds the `tenantId` claim. A client that skips this call, or lies
 * about its result, gains nothing. Any reviewer who reads this route as "the
 * cap" has misread it.
 *
 * Body: `{ tenantId: string }`. Taking the id from the body is NOT a
 * tenant-resolution violation here and only here: the id is a PUBLIC fact (it is
 * the subdomain), this route authorizes no write, and it reads nothing
 * tenant-scoped beyond an aggregate count and the tenant's display name. The
 * enforcement path derives the tenant from `users/{uid}` server-side and ignores
 * the client entirely.
 *
 * 🔴 THE PRE-FLIGHT FAILS OPEN, ON PURPOSE, AND THAT IS NOT A SILENT-FAILURE
 * VIOLATION. It is not the gate; the gate fails closed. A pre-flight that failed
 * closed would turn any transient blip into "nobody in the world can sign up",
 * which is worse and much louder than "one person gets a slightly rougher
 * refusal one hop later". The throw is still captured through
 * `captureHandledError`, so the failure is visible where failures belong, and
 * the 500 body says the check failed rather than pretending it passed.
 */

interface CapacityBody {
  tenantId?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    // Public, unauthenticated endpoint on the signup path → `auth` category.
    const limited = await checkRateLimit(request, 'auth');
    if (limited) return limited;

    let body: CapacityBody;
    try {
      body = (await request.json()) as CapacityBody;
    } catch {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : '';
    // A '/' would let a caller address an arbitrary document path — mirrors
    // `validateIds` in /api/courses/adopt.
    if (!tenantId || tenantId.includes('/')) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    const decision = await canTenantAcceptMember(tenantId);
    if (!decision.allowed) {
      const copy = memberCapCopy(decision.ministryName);
      return NextResponse.json({
        allowed: false,
        code: MEMBER_CAP_CODE,
        title: copy.title,
        body: copy.body,
      });
    }

    return NextResponse.json({ allowed: true });
  } catch (error: any) {
    console.error('member-capacity pre-flight error:', error);
    captureHandledError(error, { step: 'tenants-member-capacity' });
    return NextResponse.json({ error: 'Failed to check capacity' }, { status: 500 });
  }
}
