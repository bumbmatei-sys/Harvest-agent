/**
 * Stripe Connect configuration — the platform's cut of money that flows through
 * a tenant's own connected account.
 *
 * This side of the payments split stays on Stripe. Donations (THE-145) and paid
 * event tickets (THE-154) are BOTH DIRECT charges on each church's own Stripe
 * account; either way Harvest is only the platform taking an application fee
 * (currently none).
 * Subscription/price configuration lives in `billing.ts` and is on its way to
 * another processor — nothing in this module should follow it there.
 */

/**
 * Platform application-fee rate per plan, applied to money that flows through a
 * tenant's connected account: donations (THE-145) AND paid event tickets
 * (THE-154), both of which are DIRECT charges on that account. Single source of
 * truth so the two money paths can never charge a different platform fee for the
 * same plan. A missing plan defaults to 0.
 *
 * ⚠️ THERE IS NO DESTINATION CHARGE LEFT ON EITHER PATH, and re-introducing one
 * is not a refactor. Tickets were the last of them until THE-154: the card was
 * charged on the Harvest platform account and swept to the church via
 * `transfer_data.destination`, which made Harvest the merchant of record on
 * every ministry's ticket sales and debited a disputed ticket from HARVEST's
 * balance — on a sale Harvest earns 0% of. Both paths now create the charge AS
 * the connected account (`{ stripeAccount }`), and neither writes `transfer_data`.
 *
 * ZERO ON EVERY TIER. Harvest takes no cut of a donation or a paid ticket on
 * any plan — the plans sell features and capacity, not a share of giving. With
 * an application fee of 0 the connected account keeps the whole amount on both
 * money paths.
 *
 * This used to be mirrored by hand into `PLAN_FEATURES[plan].donationRetention`
 * / `PLAN_DONATION_RETENTION` as `100 - fee * 100`, so customers could be shown
 * what they keep. Both are gone: the mirror is what once let the app advertise
 * "keeps 100%" while charging 2.5%, and at a flat 0% the retention number is a
 * constant 100 that says nothing. Customer-facing surfaces now render the FEE
 * from this map. Keep this the only place a rate is written down.
 */
export const PLATFORM_FEE_MAP: Record<string, number> = {
  plus: 0,
  pro: 0,
  max: 0,
};
