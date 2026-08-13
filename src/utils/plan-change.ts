import { authFetch } from './auth-fetch';

/**
 * Client-side routing for the existing-tenant plan change (THE-89).
 *
 * The server is the guard, not this file: `/api/stripe/checkout` refuses a
 * Dodo-owned tenant (409) and `/api/dodo/change-plan` refuses everything that
 * is not Dodo-owned, so a wrong pick here is an error message, never a wrong
 * charge. What this file decides is only which flow to OFFER: the Stripe
 * checkout redirect, or the Dodo preview-then-confirm exchange.
 */

export type PlanChangeProcessor = 'stripe' | 'dodo' | null;

/**
 * Which processor owns this tenant's subscription, from the same
 * `/api/billing/invoices` response the Billing screen already renders.
 * Null when it cannot be determined (not an owner, network failure) — callers
 * fall back to the Stripe flow, whose server-side guard makes that safe.
 */
export async function fetchBillingProcessor(): Promise<PlanChangeProcessor> {
  try {
    const resp = await authFetch('/api/billing/invoices');
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => ({}));
    return data?.processor === 'dodo' ? 'dodo' : data?.processor === 'stripe' ? 'stripe' : null;
  } catch {
    return null;
  }
}

const fmtMinor = (minor: number, currency: string) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (currency || 'USD').toUpperCase(),
  }).format(Math.abs(minor) / 100);

/**
 * The Dodo plan change, end to end: preview the proration, show the owner the
 * exact amount, and only on their confirmation perform the change.
 *
 * Resolves to `{ ok: true }` when the change was accepted (the plan itself is
 * moved by the `subscription.plan_changed` webhook moments later), and
 * `{ ok: false }` with a message when refused or declined. An empty message
 * means the owner cancelled the confirm dialog — nothing to show.
 */
export async function runDodoPlanChange(args: {
  tenantId: string;
  plan: string;
  billing: 'monthly' | 'yearly';
}): Promise<{ ok: boolean; message: string }> {
  const previewResp = await authFetch('/api/dodo/change-plan', {
    method: 'POST',
    body: JSON.stringify(args),
  });
  const previewData = await previewResp.json().catch(() => ({}));
  if (!previewResp.ok) {
    return { ok: false, message: previewData?.error || 'Failed to change plan. Please try again.' };
  }

  const amountDueNow: number = previewData?.preview?.amountDueNow ?? 0;
  const creditMovement: number = previewData?.preview?.creditMovement ?? 0;
  const currency: string = previewData?.preview?.currency || 'USD';

  // The charge, stated before it happens. A church never confirms a proration
  // it has not seen.
  const moneyLine =
    amountDueNow > 0
      ? `You will be charged ${fmtMinor(amountDueNow, currency)} now, covering the new plan for the rest of your current billing period.`
      : creditMovement > 0
        ? `No charge today. ${fmtMinor(creditMovement, currency)} of unused time on your current plan becomes credit that automatically reduces your future renewals.`
        : 'No charge today.';

  if (!window.confirm(`Confirm your plan change.\n\n${moneyLine}`)) {
    return { ok: false, message: '' };
  }

  const confirmResp = await authFetch('/api/dodo/change-plan', {
    method: 'POST',
    body: JSON.stringify({ ...args, confirm: true }),
  });
  const confirmData = await confirmResp.json().catch(() => ({}));
  if (!confirmResp.ok) {
    return { ok: false, message: confirmData?.error || 'Failed to change plan. Please try again.' };
  }
  return {
    ok: true,
    message: confirmData?.message || 'Your plan change is confirmed. It may take a moment to appear.',
  };
}
