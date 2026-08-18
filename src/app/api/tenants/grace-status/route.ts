import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth, requireTenantAdmin } from '@/lib/api-auth';
import { getTenantPrivate, DODO_ON_HOLD_FIELD } from '@/lib/tenant-private';
import { resolveTenantGraceState, DODO_GRACE_PERIOD_MS } from '@/lib/tenant-lifecycle';
import { convergeExpiredDodoGrace } from '@/lib/dodo/lifecycle';
import { convergeDodoSubscriptionStatus } from '@/lib/dodo/subscription-convergence';
import { captureMoneyPathError } from '@/lib/money-path-sentry';

/**
 * GET /api/tenants/grace-status?tenantId=<id>
 *
 * "Is my church inside a billing grace window, and how long is left?" — for the
 * CALLER's own tenant only.
 *
 * ─── Why this route has to exist ─────────────────────────────────────────────
 *
 * REP-4 part 3 records a failed renewal as `dodoOnHoldAt` on
 * `tenant_private/{id}` and gives the church 21 days before giving stops. That
 * placement is deliberate and cannot move: `tenants/{id}` is `allow read: if
 * true`, so a billing-failure timestamp there would publish a named church's
 * failed card to anyone who asked (THE-62 with worse content). The accepted cost
 * was stated at the time — `tenant_private` is `allow read, write: if false`, so
 * THE CLIENT CANNOT READ IT, and there was no way to tell an owner their payment
 * had failed. They found out when their donate page went dark. This is the
 * authenticated read that closes that gap, and it is the whole of it: the server
 * reads the private doc through the Admin SDK, so no `firestore.rules` change is
 * involved on either side.
 *
 * ─── What it returns, and what it deliberately does not ──────────────────────
 *
 * Modelled on `/api/tenants/roster-status`: resolve the tenant from the caller,
 * read `tenant_private` server-side, and return only an answer ABOUT THE CALLER'S
 * OWN TENANT — never the underlying document.
 *
 * 🔴 The raw `dodoOnHoldAt` is NOT in the response. What ships is the derived
 * state and, inside the window, the deadline computed from
 * `DODO_GRACE_PERIOD_MS`. The 21 is not re-added here; there is exactly one
 * definition of the window and this reads it.
 *
 * ⚠️ And there is NO financial detail of any kind — no amount, no card, no
 * invoice, no processor identifier, no payment action. That is not an oversight,
 * it is what makes the gate below defensible; see the note there.
 */

export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The caller-safe shape. `graceEndsAt`/`daysRemaining` appear only for
 * `in-grace`, because they are the only state where a countdown means anything:
 * `none` has no clock and `expired` has no time left to report.
 */
interface GraceStatusBody {
  state: 'none' | 'in-grace' | 'expired';
  graceEndsAt?: string;
  daysRemaining?: number;
}

export async function GET(request: NextRequest) {
  // Authenticate first so an anonymous caller gets 401 rather than the 400
  // below — the same ordering `/api/stripe/portal` uses for the same reason.
  const callerOrErr = await requireAuth(request);
  if (callerOrErr instanceof NextResponse) return callerOrErr;

  const tenantId = request.nextUrl.searchParams.get('tenantId') || callerOrErr.tenantId;
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId required' }, { status: 400 });
  }

  /**
   * 🔴 THE GATE: `requireTenantAdmin`, not `requireOwner`. The argument, since
   * both were live options and the narrower one is usually right on this path.
   *
   * `requireOwner` guards everything that CHANGES what a church pays — the plan
   * change, the cancel portal — and the invoice and statement READS, because
   * those sit on the same Billing screen and carry amounts and payment history.
   * Its own docstring draws the dividing line: anything that only reads or
   * operates the account uses `requireTenantAdmin` instead.
   *
   * This falls on that side, and the response shape above is what puts it there.
   * It carries no money, no card, no invoice, no processor identifier and no
   * payment action — only "this workspace's capabilities stop on <date>". That
   * is an OPERATIONAL deadline, and it lands on capabilities the volunteer admin
   * uses directly: publishing and sending are gated on the same status giving is.
   *
   * ⚠️ The asymmetry of the failure modes decides it. Gate too wide and a second
   * admin of the same church learns their own church's giving is about to stop.
   * Gate too narrow and nobody learns it at all — which is precisely the defect
   * this route exists to fix, and it lands hardest on the church whose owner has
   * moved on and whose `ownerId` now points at a uid nobody signs in as. The
   * cheap failure is the one worth risking here.
   *
   * 🔴 EITHER WAY IT MUST HONOUR THE ROSTER. `requireTenantAdmin` admits a
   * `tenant_private.adminEmails` admin on the roster grant alone, before the
   * tenant-match and before the `isAdmin` check, because that admin carries no
   * `role: 'admin'` on their user doc. A hand-rolled check that read only the
   * user document would silently refuse a legitimate admin — THE-64 exactly — so
   * the helper does the work and nothing here re-implements it.
   */
  const adminOrErr = await requireTenantAdmin(request, tenantId);
  if (adminOrErr instanceof NextResponse) return adminOrErr;

  // One clock for both the answer and the convergence below, so the state that
  // is reported and the state that is written down can never be resolved against
  // two different `now`s.
  const now = Date.now();

  const onHoldAt = (await getTenantPrivate(tenantId))[DODO_ON_HOLD_FIELD];
  const graceState = resolveTenantGraceState({ onHoldAt, now });

  const body: GraceStatusBody = { state: graceState };
  if (graceState === 'in-grace') {
    // Derived from the single definition of the window — the 21 is not repeated.
    // `onHoldAt` parsed cleanly or the resolver would have said 'none'.
    const endsAt = Date.parse(onHoldAt as string) + DODO_GRACE_PERIOD_MS;
    body.graceEndsAt = new Date(endsAt).toISOString();
    // Ceiling: with any part of a day left the church still has "1 day", not 0.
    body.daysRemaining = Math.max(0, Math.ceil((endsAt - now) / DAY_MS));
  }

  const response = NextResponse.json(body);

  /**
   * ⚠️ CONVERGENCE, AFTER THE ANSWER AND NEVER IN FRONT OF IT — the shape the
   * donate route already uses, for the same reasons.
   *
   * Before this, `convergeExpiredDodoGrace` had exactly two triggers: a donation
   * attempt past the deadline, and a repeat `subscription.on_hold`. A lapsed
   * church with no donate traffic therefore stayed recorded `active` forever
   * while every surface enforced otherwise. Admins load the admin far more
   * reliably than donors hit a donate page, so this read is the cheapest reliable
   * trigger available — and there is no scheduler to lean on instead
   * (`functions/` does not deploy on merge).
   *
   * 🔴 Best-effort, in a try/catch, on a response already built. The caller's
   * answer is correct whether or not the write lands — it came from the same
   * resolver the write consults — so a failed write must not turn a working read
   * into a 500 and leave the admin with no banner at all. The next load retries.
   */
  if (graceState === 'expired') {
    try {
      await convergeExpiredDodoGrace(tenantId, now);
    } catch (convergeErr) {
      console.error(`[dodo] Could not converge expired grace for tenant ${tenantId}:`, convergeErr);
      captureMoneyPathError(convergeErr, {
        step: 'dodo-grace-converge',
        level: 'warning',
        tenantId,
      });
    }
  }

  /**
   * ⚠️ THE SIBLING CONVERGENCE (THE-167) — the PROCESSOR's status, not Harvest's
   * clock. Same rule as the block above, for the same reasons, and deliberately
   * independent of it.
   *
   * 🔴 The defect it exists for: three subscriptions were cancelled through the
   * Dodo API on 2026-08-17, Dodo reports all three `cancelled`, and every tenant
   * doc still read `active`. `subscription.cancelled` is a terminal event that
   * archives a tenant, so the state should have moved. The endpoint is
   * configured correctly, and whether the event ever fired CANNOT BE DETERMINED
   * — Dodo exposes no delivery log this account can read. Rather than fix a
   * webhook that may not be broken, this stops depending on it for a terminal
   * state; see `@/lib/dodo/subscription-convergence` for why that closes all
   * three possible causes where a webhook fix closes at most two.
   *
   * ⚠️ IT IS THROTTLED, and that is not optional. This route runs on every admin
   * shell mount and THE-139 was a 429 on it; the interval and its argument live
   * with the function.
   *
   * 🔴 Unconditional, unlike the grace block: a cancelled subscription has
   * nothing to do with a hold, so gating this on `graceState` would miss exactly
   * the tenant it was written for — one that was never on hold and was cancelled
   * outright. Same try/catch, same best-effort contract: the answer above is
   * already built and correct, and a Dodo outage must not turn a working read
   * into a 500 that leaves the admin with no banner.
   */
  try {
    await convergeDodoSubscriptionStatus(tenantId, now);
  } catch (convergeErr) {
    console.error(`[dodo] Could not converge subscription status for tenant ${tenantId}:`, convergeErr);
    captureMoneyPathError(convergeErr, {
      step: 'dodo-subscription-converge',
      level: 'warning',
      tenantId,
    });
  }

  return response;
}
