import { adminDb } from '@/lib/firebase-admin';
import { captureMoneyPathError } from '@/lib/money-path-sentry';

/**
 * Resolve an inbound `?ref=` value to the referrer's user id, for stamping into
 * a subscription's metadata at checkout.
 *
 * ─── Why this is a module and not two copies ─────────────────────────────────
 *
 * It was inline in `/api/stripe/checkout` and, with REP-4 PR 2, `/api/dodo/
 * checkout` needs the identical rule: the webhook on EITHER processor reads
 * `referrerId` out of subscription metadata and treats it as a user id, so a
 * route that forwards a short affiliate CODE instead of the resolved id credits
 * nobody, silently and permanently. Nothing retries a checkout that was already
 * created. The rule is expressed once, here, and imported — the same reasoning
 * as `affiliate-commission-window.ts`.
 *
 * ⚠️ CAPTURE IS DELIBERATELY STILL LIVE while `AFFILIATE_PROGRAM_ENABLED` is
 * false. The programme is hidden, but every `?ref=` link already shared must
 * keep attributing, so nothing in this module consults that flag. Gating it
 * would void real referrals in flight.
 */

/**
 * Affiliate codes are short (`users/{uid}.affiliateCode`); Firebase uids are
 * 28 chars. Anything longer than this is already a uid and needs no lookup.
 */
const MAX_AFFILIATE_CODE_LENGTH = 16;

export interface ResolvedReferrer {
  /** What to put in subscription metadata, or undefined when there is nothing. */
  readonly referrerId: string | undefined;
  /** True when a code arrived but no affiliate owns it — logged, not fatal. */
  readonly unresolvedCode: boolean;
}

/**
 * Turn whatever the client sent into a referrer user id.
 *
 * A value that is already a uid passes through untouched. A short code is looked
 * up against `users.affiliateCode`. A lookup FAILURE (not a miss) returns the raw
 * value and reports to Sentry: the webhook will read it as a user id and credit
 * nobody, so that checkout's commission is lost for good.
 */
export async function resolveAffiliateReferrer(
  rawReferrerId: unknown,
  context: { readonly plan?: string; readonly billing?: string; readonly processor: string },
): Promise<ResolvedReferrer> {
  if (typeof rawReferrerId !== 'string' || rawReferrerId.trim() === '') {
    return { referrerId: undefined, unresolvedCode: false };
  }

  const raw = rawReferrerId.trim();
  if (raw.length > MAX_AFFILIATE_CODE_LENGTH) {
    return { referrerId: raw, unresolvedCode: false };
  }

  try {
    const affiliateSnap = await adminDb
      .collection('users')
      .where('affiliateCode', '==', raw)
      .limit(1)
      .get();
    if (!affiliateSnap.empty) {
      return { referrerId: affiliateSnap.docs[0].id, unresolvedCode: false };
    }
    // A real miss: the code does not belong to anyone. Forward it anyway so the
    // value is visible in the subscription for a human to reconcile, and say so.
    return { referrerId: raw, unresolvedCode: true };
  } catch (resolveErr) {
    console.warn('Failed to resolve affiliate code, using as-is:', resolveErr);
    captureMoneyPathError(resolveErr, {
      step: 'checkout-resolve-affiliate-code',
      level: 'error',
      ids: {
        affiliateCode: raw,
        plan: context.plan,
        billing: context.billing,
        processor: context.processor,
      },
    });
    return { referrerId: raw, unresolvedCode: true };
  }
}

/**
 * The referral-capture breadcrumb both checkout routes log.
 *
 * Makes a silent drop visible: a checkout carrying a `referrerId` lands it in
 * subscription metadata (→ the webhook pays the commission), and a code that
 * arrives without resolving is logged so a mis-captured `?ref=` can be found
 * server-side instead of failing invisibly.
 */
export function logReferralCapture(
  resolved: ResolvedReferrer,
  context: { readonly plan?: string; readonly billing?: string; readonly processor: string },
): void {
  if (resolved.referrerId && !resolved.unresolvedCode) {
    console.log(
      `🔗 Checkout carries affiliate referrerId ${resolved.referrerId} ` +
        `(processor ${context.processor}, plan ${context.plan}, billing ${context.billing})`,
    );
  } else if (resolved.unresolvedCode) {
    console.warn(
      `⚠️ Checkout received an unresolvable referral code "${resolved.referrerId}" — ` +
        'no commission will be attributed',
    );
  }
}
