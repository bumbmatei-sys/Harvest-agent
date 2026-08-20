import { authFetch } from './auth-fetch';
import type { BillingTerm } from './plan-features';

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
 * THE-135: the one "Powered by …" line under the subscription-management
 * actions, derived from the processor that actually owns the subscription.
 *
 * Subscriptions moved to Dodo; donations did not. The old hardcoded
 * "Powered by Stripe" under "Manage Subscription" told every Dodo tenant its
 * subscription ran on a processor it has never paid — and it existed as TWO
 * hardcoded copies (PlanUpgradeSection, AdminUpgradePage), which is exactly how
 * one of them was missed. This is the single source; do not write the string
 * out by hand at a call site again.
 *
 * Returns null when the processor is not (yet) known — `undefined` before the
 * fetch resolves, `null` when it cannot be determined — so the caller renders
 * NO attribution rather than guessing. A default shown while the answer is
 * still loading is a silent claim, and this project has paid for that twice.
 *
 * 🔴 The donation surfaces (PaymentSection, PublicCampaign) are NOT callers:
 * donations run on Stripe Connect and their "powered by Stripe" lines are true.
 */
export function subscriptionProcessorAttribution(
  processor: PlanChangeProcessor | undefined,
): string | null {
  if (processor === 'stripe') return 'Powered by Stripe';
  if (processor === 'dodo') return 'Powered by Dodo Payments';
  return null;
}

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
  billing: BillingTerm;
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

  // 🔴 THE LOSS, BEFORE THE CONFIRM (THE-132). An add-on the new plan does not
  // offer is removed by the change. The server names them; this states them,
  // because a church learning on the next invoice that it lost something it was
  // paying for is the same failure as an unseen proration.
  const removedNames: string[] = (Array.isArray(previewData?.preview?.addOnsRemoved)
    ? previewData.preview.addOnsRemoved
    : []
  )
    .map((addOn: { name?: unknown }) => (typeof addOn?.name === 'string' ? addOn.name : ''))
    .filter((name: string) => name !== '');

  const lossLine = removedNames.length
    ? `\n\nThe new plan does not include ${removedNames.join(', ')}, so ${removedNames.length === 1 ? 'it' : 'they'} will be removed and you will stop being billed for ${removedNames.length === 1 ? 'it' : 'them'}.`
    : '';

  if (!window.confirm(`Confirm your plan change.\n\n${moneyLine}${lossLine}`)) {
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
