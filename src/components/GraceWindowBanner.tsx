"use client";
import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { authFetch } from '../utils/auth-fetch';

/**
 * "Your payment failed — giving stops in N days."
 *
 * ─── What this is for ────────────────────────────────────────────────────────
 *
 * A failed Dodo renewal starts a 21-day grace window recorded as `dodoOnHoldAt`
 * on the SERVER-ONLY `tenant_private/{id}` doc. That doc is `allow read, write:
 * if false`, so no client can read it and no church could be told. Until this
 * banner, an owner's first news of a failed card was their donate page going
 * dark three weeks later. The state comes from `/api/tenants/grace-status`,
 * which is the only way a client can learn it.
 *
 * ⚠️ THE COPY IS FOR A CHURCH ADMIN, NOT A DONOR. `GIVING_UNAVAILABLE_MESSAGE`
 * on the donate route is deliberately silent about billing — a donor is not owed
 * a church's subscription status. The reader here is inside the admin, is one of
 * at most a handful of people who can act, and is served by the problem being
 * named plainly. Vagueness here just costs them the three weeks.
 *
 * ─── 🔴 No payment action, on purpose ────────────────────────────────────────
 *
 * The button opens `/api/stripe/portal` — the existing "Manage subscription"
 * path, which routes a Dodo-owned tenant to Dodo's hosted customer portal. It
 * does not collect a card, and there is no second charge route behind it. Dodo
 * has already charged or attempted to charge, and its own dunning email already
 * carries an "Update payment method" link to that same portal; a payment surface
 * here would be a second way to be billed for one subscription.
 *
 * Renders nothing at all unless the tenant is IN GRACE. `expired` is not a
 * banner state: those tenants are converged to `archived` and every surface
 * already refuses them with its own messaging — a countdown reading "0 days"
 * over a workspace that has already stopped would be worse than silence.
 */

/** What `/api/tenants/grace-status` answers. */
interface GraceStatus {
  state: 'none' | 'in-grace' | 'expired';
  graceEndsAt?: string;
  daysRemaining?: number;
}

export function formatGraceDeadline(iso: string | undefined): string | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/** "in 12 days" / "tomorrow" / "today" — the urgency, in words an admin reads. */
export function formatDaysRemaining(days: number | undefined): string | null {
  if (typeof days !== 'number' || !Number.isFinite(days)) return null;
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

export default function GraceWindowBanner({ tenantId }: { tenantId: string | null }) {
  const [status, setStatus] = useState<GraceStatus | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(
          `/api/tenants/grace-status?tenantId=${encodeURIComponent(tenantId)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as GraceStatus;
        if (!cancelled) setStatus(data);
      } catch {
        // A failed lookup shows no banner. There is nothing safe to assume from
        // silence, and inventing a warning for a church that is paying fine
        // would be worse than the missing one.
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  if (!status || status.state !== 'in-grace') return null;

  const deadline = formatGraceDeadline(status.graceEndsAt);
  const when = formatDaysRemaining(status.daysRemaining);

  const openPortal = async () => {
    if (!tenantId) return;
    setPortalLoading(true);
    try {
      const resp = await authFetch('/api/stripe/portal', {
        method: 'POST',
        body: JSON.stringify({ tenantId }),
      });
      const data = await resp.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Failed to open billing portal');
      }
    } catch (e) {
      console.error('Portal error:', e);
      alert('Failed to open billing portal. Please try again.');
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <div
      role="status"
      className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 flex flex-col sm:flex-row sm:items-center gap-3"
    >
      <AlertTriangle size={20} className="text-amber-600 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-amber-900">
          Your subscription payment didn&apos;t go through
        </p>
        <p className="text-sm text-amber-800 mt-0.5">
          Online giving stops {when ?? 'soon'}
          {deadline ? ` — on ${deadline}` : ''}, along with publishing and sending. Your
          records and exports are never affected. Update your payment details to keep
          everything running.
        </p>
      </div>
      <button
        onClick={openPortal}
        disabled={portalLoading}
        className="shrink-0 rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
      >
        {portalLoading ? 'Opening…' : 'Manage subscription'}
      </button>
    </div>
  );
}
