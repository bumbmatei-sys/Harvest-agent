import { NextRequest, NextResponse } from 'next/server';
import { canTenantAcceptNewMember } from '@/lib/member-capacity';
import {
  MEMBER_CAP_REFUSED_CODE,
  MEMBER_CAP_UNAVAILABLE_CODE,
  MEMBER_CAP_UNAVAILABLE_MESSAGE,
  memberCapRefusalMessage,
} from '@/utils/member-cap-copy';
import { captureHandledError } from '@/lib/money-path-sentry';

/**
 * POST /api/tenants/member-capacity — the THE-201 signup pre-flight.
 *
 * 🔴 THIS IS A UX AFFORDANCE, NOT THE ENFORCEMENT. The enforcement is the
 * capacity check in `POST /api/auth/set-claims`. A client that skips this route
 * is still refused there. This exists only so a real human never ends up with a
 * half-created account — a Firebase Auth user and a `users` doc, but no claim
 * and therefore no access to anything.
 *
 * UNAUTHENTICATED BY NECESSITY: it is asked before any account exists, exactly
 * like `/api/auth/verify-turnstile`. It therefore cannot use `requireAuth`.
 *
 * RATE LIMIT: it sits under `/api/tenants/`, so `middleware.ts:10` gives it the
 * `api` category — 60/min per IP — automatically. No route-level
 * `checkRateLimit` call is needed or wanted; middleware is where this repo does
 * it. The path is deliberate: under `/api/auth/` it would land in the `auth`
 * bucket (5/min), which a single signup already spends twice, so a church
 * behind one NAT would start 429ing its own members.
 * ⚠️ Standing finding: rate limiting is inactive on preview deploys, because
 * `UPSTASH_REDIS_REST_URL` is production-only (`middleware.ts:20-22`).
 *
 * INFORMATION DISCLOSURE: the response tells an anonymous caller whether a
 * subdomain is accepting signups — the same fact they would learn by trying to
 * sign up. It carries NO count, NO cap, NO plan and NO add-on set, and the
 * message is character-identical to the one the enforcement path returns.
 *
 * The client-supplied `tenantId` is acceptable here — and ONLY here — because
 * this is a read-only yes/no about a public fact that grants nothing. It is
 * validated as a non-empty string and is never used for a write.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      // A non-JSON body is a malformed request, not a capacity answer. It must
      // not fall through to a yes.
      return NextResponse.json({ error: 'tenantId required' }, { status: 400 });
    }

    const tenantId = (body as { tenantId?: unknown } | null)?.tenantId;
    if (typeof tenantId !== 'string' || tenantId.trim() === '') {
      return NextResponse.json({ error: 'tenantId required' }, { status: 400 });
    }

    const outcome = await canTenantAcceptNewMember(tenantId);

    // 🔴 200 for the refusal, not 403. This route answers a QUESTION; it
    // refuses nothing. A 403 here would be indistinguishable from an auth
    // failure to the client and would tempt a catch-to-default. The answer is
    // in the body and the client must read it.
    if (outcome.status === 'refused') {
      return NextResponse.json({
        canAccept: false,
        message: memberCapRefusalMessage(outcome.ministryName),
        code: MEMBER_CAP_REFUSED_CODE,
      });
    }

    if (outcome.status === 'unavailable') {
      // C3/C4 — a missing tenant doc or a failed count. We do NOT know the
      // ministry is full, so the copy does not say so.
      return NextResponse.json(
        {
          canAccept: false,
          message: MEMBER_CAP_UNAVAILABLE_MESSAGE,
          code: MEMBER_CAP_UNAVAILABLE_CODE,
        },
        { status: 503 },
      );
    }

    // 'allowed' and every 'skipped' reason.
    return NextResponse.json({ canAccept: true });
  } catch (error) {
    captureHandledError(error, { step: 'member-cap-preflight-route' });
    return NextResponse.json(
      {
        canAccept: false,
        message: MEMBER_CAP_UNAVAILABLE_MESSAGE,
        code: MEMBER_CAP_UNAVAILABLE_CODE,
      },
      { status: 503 },
    );
  }
}
