import { authFetch } from './auth-fetch';

/**
 * The client half of buying, re-quantifying and dropping an add-on (REP-5b).
 *
 * The exact shape of `runDodoPlanChange` in `./plan-change`, and deliberately
 * so: preview, state the real charge, only then confirm. A church never commits
 * to a proration it has not seen — and an add-on IS inside Dodo's proration
 * calculation, so the number here is a real number rather than a sticker price.
 *
 * 🔴 NO DODO ADD-ON ID APPEARS IN THIS FILE OR ON THE WIRE. The vocabulary is
 * the five MEANINGS (`adminSeat`, `contactPack`, …); the server maps them to ids
 * for the tenant's own billing period. REP-5a's rule — ids live once,
 * server-side — is not weakened by making add-ons buyable, and it is what keeps
 * this bundle working when an add-on is recreated in Dodo.
 *
 * 🔴 NO PRICE IS COMPUTED HERE. Add-on prices are settled in Dodo, never in this
 * repo; every figure shown comes from the catalogue read or from the preview.
 */

/**
 * The five things Harvest sells beyond a tier, as the wire names them.
 *
 * A VALUE, not just a type, and the reason is the live Campus gap. A surface
 * that wants to say "this exists but cannot be bought here yet" has to be able
 * to subtract the offerable set from the whole set, and a type union cannot be
 * subtracted at runtime. It is the client's counterpart of the server's
 * `DODO_ADDON_MEANINGS` — the same five words, in the same order, and nothing
 * else: no id, no price, and no statement about what is offerable. Availability
 * still comes from the server and only from the server.
 */
export const ADDON_MEANINGS = [
  'aiAssistant',
  'adminSeat',
  'campus',
  'contactPack',
  'unlimitedContacts',
] as const;

export type AddonMeaning = (typeof ADDON_MEANINGS)[number];

/** Which period a tenant is billed on. The tenant's own, read server-side. */
export type AddonBillingPeriod = 'monthly' | 'yearly';

/** One add-on a church can be offered: named and priced by Dodo, never by code. */
export interface OfferableAddon {
  addon: AddonMeaning;
  name: string;
  priceMinorUnits: number;
  currency: string;
}

/**
 * The add-ons that can actually be sold right now, for this tenant's period.
 *
 * 🔴 THE SERVER DECIDES THIS, from the active add-on table. There is no list in
 * this file to drift from it — an add-on with no id in the running environment
 * simply is not in the response, so it cannot be rendered and cannot be bought.
 * Live Campus is that case today; when its two ids are recorded it appears here
 * with no change to any client code.
 */
export async function fetchOfferableAddons(
  tenantId: string,
): Promise<{ addons: OfferableAddon[]; billing: AddonBillingPeriod | null; error: string | null }> {
  try {
    const resp = await authFetch(`/api/dodo/addons?tenantId=${encodeURIComponent(tenantId)}`);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return { addons: [], billing: null, error: data?.error || 'Add-ons are unavailable right now.' };
    }
    return {
      addons: Array.isArray(data?.addons) ? data.addons : [],
      billing: data?.billing === 'yearly' ? 'yearly' : data?.billing === 'monthly' ? 'monthly' : null,
      error: null,
    };
  } catch {
    return { addons: [], billing: null, error: 'Add-ons are unavailable right now.' };
  }
}

/**
 * How many of `meaning` a tenant already owns, from its stored add-on set.
 *
 * The one bridge between the wire's meaning names and `TenantAddons`' field
 * names, which differ because the fields are plural counts (`adminSeats`) and
 * the meanings are singular units (`adminSeat`). Written once, here, rather than
 * as a ternary at each control: a surface that read the wrong field would show a
 * church the wrong count of something it is paying for.
 *
 * `unlimitedContacts` reports 1 or 0 — holding it at all is the whole fact, so
 * it has no other count to report.
 */
export function ownedAddonQuantity(
  addons: {
    aiAssistant: number;
    adminSeats: number;
    contactPacks: number;
    unlimitedContacts: boolean;
    campuses: number;
  },
  meaning: AddonMeaning,
): number {
  switch (meaning) {
    case 'aiAssistant':
      return addons.aiAssistant;
    case 'adminSeat':
      return addons.adminSeats;
    case 'campus':
      return addons.campuses;
    case 'contactPack':
      return addons.contactPacks;
    case 'unlimitedContacts':
      return addons.unlimitedContacts ? 1 : 0;
  }
}

const fmtMinor = (minor: number, currency: string, trimWholeCents = false) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (currency || 'USD').toUpperCase(),
    ...(trimWholeCents && Number.isInteger(Math.abs(minor) / 100) ? { minimumFractionDigits: 0 } : {}),
  }).format(Math.abs(minor) / 100);

/**
 * An exact amount of money — a charge, a credit — always to the cent.
 *
 * Separate from `formatAddonPrice` below because the two are different kinds of
 * number. This one is what Dodo computed for one specific change, so it keeps
 * its cents: a proration is $94.12, and rounding it on a surface that is about
 * to charge it would make the button and the invoice disagree.
 */
export function formatAddonAmount(minor: number, currency: string): string {
  return fmtMinor(minor, currency);
}

/** The recurring period a price is charged over, in words a church reads. */
const PERIOD_WORD: Record<AddonBillingPeriod, string> = {
  monthly: 'month',
  yearly: 'year',
};

/**
 * An add-on's RECURRING price, and it always carries the period it recurs on.
 *
 * 🔴 THE PERIOD IS NOT OPTIONAL AND IS NOT A LITERAL. `$228.00` beside an add-on
 * reads as a one-off charge; `$228/year` is the same figure and a different
 * claim. The period comes from `billing` — the tenant's OWN subscription period,
 * resolved server-side and returned by the catalogue read — so a church billed
 * monthly is quoted `$19/month` from the same call, and no surface has to guess.
 *
 * Whole amounts lose their cents (`$228/year`, not `$228.00/year`): a sticker
 * price is a round settled figure, and the trailing zeros are what make it look
 * like a transaction total instead of a rate.
 */
export function formatAddonPrice(
  minor: number,
  currency: string,
  billing: AddonBillingPeriod,
): string {
  return `${fmtMinor(minor, currency, true)}/${PERIOD_WORD[billing]}`;
}

/** What Dodo says one specific change costs right now, for one add-on. */
export interface AddonChangePreview {
  /** The quantity this figure was computed FOR. Never dropped — see below. */
  readonly quantity: number;
  /** The prorated amount due immediately, in minor units. */
  readonly amountDueNow: number;
  readonly currency: string;
}

/**
 * We asked, and the answer did not arrive in a usable state. Deliberately has no
 * amount: there is no honest number to put in it.
 */
const PREVIEW_UNAVAILABLE = 'We could not work out what this change costs just now.';

/**
 * PREVIEW ONLY — what a change would cost, charging nothing.
 *
 * The same POST `runDodoAddonChange` makes for its first phase, without
 * `confirm`, split out so a surface can show the real prorated figure BEFORE the
 * owner commits to anything rather than only inside the confirmation.
 *
 * 🔴 NEVER RESOLVES TO AN AMOUNT IT WAS NOT GIVEN. A refusal, a network failure
 * and a reply with no `amountDueNow` in it all come back as `ok: false` with no
 * figure at all — never as zero, and never as the add-on's sticker price. A
 * caller that cannot show a real number has to say so; the one thing it must not
 * do is put a confident wrong figure on a button that charges money.
 *
 * `quantity` travels back out with the amount so the caller can tell whether the
 * answer is still the answer to the question on screen.
 */
export async function previewAddonChange(args: {
  tenantId: string;
  addon: AddonMeaning;
  quantity: number;
}): Promise<{ ok: true; preview: AddonChangePreview } | { ok: false; error: string }> {
  let data: any;
  let resp: Response;
  try {
    resp = await authFetch('/api/dodo/addons', {
      method: 'POST',
      body: JSON.stringify({
        tenantId: args.tenantId,
        addons: [{ addon: args.addon, quantity: args.quantity }],
      }),
    });
    data = await resp.json().catch(() => ({}));
  } catch {
    return { ok: false, error: PREVIEW_UNAVAILABLE };
  }

  // Every server refusal already says what happened in words a church can act
  // on — the trial refusal names the day they can come back, the unmapped-add-on
  // refusal says to contact support. Surfaced as it was written, never restated.
  if (!resp.ok) {
    return { ok: false, error: typeof data?.error === 'string' && data.error ? data.error : PREVIEW_UNAVAILABLE };
  }

  const amountDueNow = data?.preview?.amountDueNow;
  if (typeof amountDueNow !== 'number' || !Number.isFinite(amountDueNow)) {
    // A 200 with no amount in it is not "no charge" — it is an answer we could
    // not read, and the two are different facts.
    return { ok: false, error: PREVIEW_UNAVAILABLE };
  }

  return {
    ok: true,
    preview: {
      quantity: args.quantity,
      amountDueNow,
      currency: typeof data?.preview?.currency === 'string' ? data.preview.currency : 'USD',
    },
  };
}

/**
 * One add-on change, end to end: preview the proration, show the owner the exact
 * amount, and only on their confirmation perform it.
 *
 * `quantity` is the DESIRED TOTAL for that add-on, so `0` removes it — removal
 * is the same two-phase exchange as a purchase, previewed and confirmed
 * identically, because losing something you pay for deserves the same warning as
 * starting to pay for it.
 *
 * Resolves `{ ok: true }` when the change was accepted (the add-on set itself is
 * moved by the `subscription.plan_changed` webhook moments later), and
 * `{ ok: false }` with a message when refused or declined. An empty message
 * means the owner cancelled the dialog — nothing to show.
 */
export async function runDodoAddonChange(args: {
  tenantId: string;
  addon: AddonMeaning;
  quantity: number;
  /** What the owner clicked on, for the dialog. Dodo's own name for it. */
  name: string;
}): Promise<{ ok: boolean; message: string }> {
  const request = {
    tenantId: args.tenantId,
    addons: [{ addon: args.addon, quantity: args.quantity }],
  };

  const previewResp = await authFetch('/api/dodo/addons', {
    method: 'POST',
    body: JSON.stringify(request),
  });
  const previewData = await previewResp.json().catch(() => ({}));
  if (!previewResp.ok) {
    // Every server refusal already says what happened in words a church can act
    // on — the trial refusal names the day they can come back, the failed-card
    // refusal names the card. None of them is improved by being restated here.
    return { ok: false, message: previewData?.error || 'Failed to change add-ons. Please try again.' };
  }

  const amountDueNow: number = previewData?.preview?.amountDueNow ?? 0;
  const creditMovement: number = previewData?.preview?.creditMovement ?? 0;
  const currency: string = previewData?.preview?.currency || 'USD';

  // 🔴 THE CHARGE, STATED BEFORE IT HAPPENS, and it is the amount Dodo computed
  // for THIS change — not the add-on's sticker price. Proration means a mid-cycle
  // purchase costs less than a month of it, and the church sees which.
  const moneyLine =
    amountDueNow > 0
      ? `You will be charged ${fmtMinor(amountDueNow, currency)} now, covering this change for the rest of your current billing period.`
      : creditMovement > 0
        ? `No charge today. ${fmtMinor(creditMovement, currency)} becomes credit that automatically reduces your future renewals.`
        : 'No charge today.';

  const removedNames: string[] = (Array.isArray(previewData?.preview?.addOnsRemoved)
    ? previewData.preview.addOnsRemoved
    : []
  )
    .map((addOn: { name?: unknown }) => (typeof addOn?.name === 'string' ? addOn.name : ''))
    .filter((name: string) => name !== '');

  const lossLine = removedNames.length
    ? `\n\n${removedNames.join(', ')} will be removed and you will stop being billed for ${removedNames.length === 1 ? 'it' : 'them'}.`
    : '';

  const headline =
    args.quantity === 0
      ? `Remove ${args.name}?`
      : `Confirm your add-on change: ${args.name} × ${args.quantity}.`;

  if (!window.confirm(`${headline}\n\n${moneyLine}${lossLine}`)) {
    return { ok: false, message: '' };
  }

  const confirmResp = await authFetch('/api/dodo/addons', {
    method: 'POST',
    body: JSON.stringify({ ...request, confirm: true }),
  });
  const confirmData = await confirmResp.json().catch(() => ({}));
  if (!confirmResp.ok) {
    return { ok: false, message: confirmData?.error || 'Failed to change add-ons. Please try again.' };
  }
  return {
    ok: true,
    message: confirmData?.message || 'Your add-on change is confirmed. It may take a moment to appear.',
  };
}
