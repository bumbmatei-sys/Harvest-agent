import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * POST /api/auth/verify-turnstile
 * Pre-flight bot check that runs BEFORE a Firebase account/session exists,
 * gating email/password sign-in and sign-up on AuthPage.
 *
 * Because it fires before any account exists, it cannot use requireAuth /
 * requireAdmin — it is necessarily a pre-auth, unauthenticated route. It is
 * still protected: middleware.ts rate-limits /api/auth/* at 5 req/min per IP.
 *
 * Body: { token: string }
 * 200: { success: true }
 * 400: { success: false, error: string }
 */
export const dynamic = 'force-dynamic';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const GENERIC_ERROR = 'Verification failed. Please try again.';

export async function POST(request: NextRequest) {
  let token: unknown;
  try {
    ({ token } = await request.json());
  } catch {
    return NextResponse.json({ success: false, error: GENERIC_ERROR }, { status: 400 });
  }

  if (!token || typeof token !== 'string') {
    return NextResponse.json({ success: false, error: GENERIC_ERROR }, { status: 400 });
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: process.env.TURNSTILE_SECRET_KEY,
        response: token,
        ...(ip ? { remoteip: ip } : {}),
      }),
    });
    const data = await res.json();

    if (data?.success === true) {
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ success: false, error: GENERIC_ERROR }, { status: 400 });
  } catch (error) {
    // Fail closed — a Cloudflare outage must not silently let the check pass,
    // since the whole point is that this is verified before the sensitive action.
    console.error('verify-turnstile error:', error);
    return NextResponse.json({ success: false, error: GENERIC_ERROR }, { status: 400 });
  }
}
