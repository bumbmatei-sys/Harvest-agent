import {
  DODO_ADDON_MEANINGS,
  addonIdFor,
  offerableAddonMeanings,
  resolveAddonMeaning,
  type DodoAddonMeaning,
} from './catalogue';
import type { DodoAddonSelection, DodoSubscriptionLike } from './dodo-provider';
import type { BillingPeriod } from './provider';

/**
 * Turning "the church wants two admin seats" into the `addons` array Dodo's
 * change-plan call takes (REP-5b).
 *
 * ─── The wire vocabulary is MEANINGS, never ids ──────────────────────────────
 *
 * 🔴 NO `adn_` ID CROSSES THE NETWORK, in either direction. REP-5a's rule — the
 * ids live once, server-side, in `catalogue.ts` — is not weakened by making
 * add-ons buyable: the browser asks for `adminSeat`, and this module is where
 * that becomes an id. A client that knew ids would break the moment an add-on is
 * recreated in Dodo, and it would put the mapping in a bundle anyone can read.
 *
 * ─── A request is a DELTA, not a replacement ─────────────────────────────────
 *
 * 🔴 THE CLIENT NEVER SENDS THE WHOLE SET. Dodo's `addons` field IS a
 * replacement, so it would be easy to let the browser send the complete desired
 * array — and that is exactly the bug: a subscription can hold an add-on the
 * client cannot name. A live Campus is the live example (its ids are an
 * acknowledged gap, so `resolveAddonMeaning` answers null for it), and a
 * dashboard-attached add-on is the general one. A complete-set replacement from
 * a client that cannot see those would DELETE them — silently cancelling
 * something a church pays for, on the strength of the browser's ignorance.
 *
 * So the request names only what CHANGES, and `resolveDesiredAddons` folds it
 * over what the subscription actually holds, carrying everything else through
 * untouched — including ids this build cannot map.
 */

/** One requested change: a meaning, and how many of it the church wants. */
export interface DodoAddonChange {
  readonly meaning: DodoAddonMeaning;
  /** The DESIRED total for this meaning. `0` removes it. */
  readonly quantity: number;
}

/**
 * The largest quantity of one add-on this route will act on.
 *
 * ⚠️ AN INPUT BOUND, NOT AN AVAILABILITY GATE. THE-133's decision — tier
 * availability is enforced by Dodo, on the product, never by Harvest — is about
 * WHICH add-ons a plan may hold, and this says nothing about that. It only stops
 * a malformed or fat-fingered quantity from turning a $10 seat into a
 * four-figure immediate charge. The refusal is explicit and says the number, so
 * a church that genuinely needs more is told to talk to someone rather than
 * silently clamped down to a quantity it did not ask for.
 */
export const MAX_ADDON_QUANTITY = 50;

/** Is this string one of the five meanings? Total over the union, by construction. */
export function isDodoAddonMeaning(raw: unknown): raw is DodoAddonMeaning {
  return typeof raw === 'string' && (DODO_ADDON_MEANINGS as readonly string[]).includes(raw);
}

/**
 * Normalise a requested quantity for a meaning.
 *
 * 🔴 `unlimitedContacts` IS CAPPED AT ONE, and this is a money guard rather than
 * tidiness. Holding it at all is the whole fact — `applyMeaning` in `./addons`
 * treats any positive quantity as the same boolean — so a quantity of 3 would
 * grant precisely what a quantity of 1 grants while Dodo bills the church three
 * times for it. There is no reading of "three unlimiteds" that is worth money.
 */
export function normaliseAddonQuantity(meaning: DodoAddonMeaning, quantity: number): number {
  const whole = Math.floor(quantity);
  if (whole <= 0) return 0;
  if (meaning === 'unlimitedContacts') return 1;
  return whole;
}

/** Why a requested add-on change cannot be formed. */
export type DodoAddonChangeRefusal =
  /** 🔴 No id in the ACTIVE environment — live Campus. Not offerable, not sellable. */
  | { readonly reason: 'unmapped'; readonly meaning: DodoAddonMeaning }
  /** Above `MAX_ADDON_QUANTITY`. Refused rather than clamped. */
  | { readonly reason: 'quantity-too-large'; readonly meaning: DodoAddonMeaning };

/** The `addons` array to send, and what the change actually does. */
export interface DodoDesiredAddons {
  /** 🔴 The exact array for BOTH the preview and the confirm. Computed once. */
  readonly desired: readonly DodoAddonSelection[];
  /**
   * Entries whose quantity is not what the subscription already held — a new
   * add-on, or an existing one at a different count. Named `changed` rather than
   * `added` on purpose: going from three admin seats to two appears here too,
   * and calling that an addition in a preview a church reads would be a lie.
   */
  readonly changed: readonly DodoAddonSelection[];
  /** Held ids that are gone after the change, for the preview. */
  readonly removed: readonly DodoAddonSelection[];
}

/**
 * Fold a set of requested changes over what a subscription HOLDS.
 *
 * Matching is by MEANING, not by id: a church on monthly billing asking for two
 * admin seats gets the monthly Admin Seat id at quantity 2, replacing whatever
 * admin-seat id it held, so a period is never accidentally mixed inside one
 * subscription.
 *
 * 🔴 EVERY HELD ADD-ON THIS BUILD CANNOT NAME IS CARRIED THROUGH UNTOUCHED. That
 * is the whole reason this is a fold rather than a replacement — see the module
 * note. An unrecognised id is preserved at its exact quantity and position; it
 * is not this path's business to decide that something Dodo is billing for
 * should stop existing because the running build has not been taught its name.
 *
 * Returns a refusal instead of an array when a requested meaning has no id in
 * the active environment, so an unsellable add-on cannot reach Dodo at all.
 */
export function resolveDesiredAddons(
  held: readonly DodoAddonSelection[],
  changes: readonly DodoAddonChange[],
  period: BillingPeriod,
): DodoDesiredAddons | DodoAddonChangeRefusal {
  const wanted = new Map<DodoAddonMeaning, number>();
  for (const change of changes) {
    const quantity = normaliseAddonQuantity(change.meaning, change.quantity);
    if (quantity > MAX_ADDON_QUANTITY) {
      return { reason: 'quantity-too-large', meaning: change.meaning };
    }
    // 🔴 Resolved BEFORE anything is built, so an unmapped meaning refuses the
    // whole request rather than being dropped out of a set the church then
    // believes it bought.
    if (addonIdFor(change.meaning, period) === null) {
      return { reason: 'unmapped', meaning: change.meaning };
    }
    wanted.set(change.meaning, quantity);
  }

  const desired: DodoAddonSelection[] = [];
  const settled = new Set<DodoAddonMeaning>();

  for (const selection of held) {
    const meaning = resolveAddonMeaning(selection.addon_id);
    // Unrecognised, or simply not part of this request: carried, verbatim.
    if (meaning === null || !wanted.has(meaning)) {
      desired.push(selection);
      continue;
    }
    settled.add(meaning);
    const quantity = wanted.get(meaning) as number;
    if (quantity > 0) {
      desired.push({ addon_id: addonIdFor(meaning, period) as string, quantity });
    }
  }

  for (const [meaning, quantity] of wanted) {
    if (settled.has(meaning) || quantity <= 0) continue;
    desired.push({ addon_id: addonIdFor(meaning, period) as string, quantity });
  }

  const heldById = new Map(held.map((selection) => [selection.addon_id, selection.quantity]));
  const desiredById = new Map(desired.map((selection) => [selection.addon_id, selection.quantity]));
  const changed = desired.filter((selection) => heldById.get(selection.addon_id) !== selection.quantity);
  const removed = held.filter((selection) => !desiredById.has(selection.addon_id));

  return { desired, changed, removed };
}

/** Whether a resolution refused, narrowed for the caller. */
export function isAddonChangeRefusal(
  result: DodoDesiredAddons | DodoAddonChangeRefusal,
): result is DodoAddonChangeRefusal {
  return 'reason' in result;
}

/**
 * When a subscription's free trial ends, or `null` when that cannot be said.
 *
 * 🔴 ONLY THE ARITHMETIC DETECTION HAS A DATE. `isDodoSubscriptionInTrial` also
 * treats "exactly one $0 payment" as in-trial, which catches a trial extended by
 * hand in the dashboard — and that detection knows only THAT the trial is
 * running, never when it stops. Returning null there is the honest answer, and
 * the copy that consumes this has to be able to say "when your free trial ends"
 * without a date rather than invent one. A guessed date on a refusal is a
 * promise the church will hold Harvest to.
 */
export function dodoTrialEndsAt(sub: DodoSubscriptionLike): string | null {
  const trialDays = sub.trial_period_days;
  if (typeof trialDays !== 'number' || trialDays <= 0) return null;
  if (typeof sub.created_at !== 'string') return null;
  const createdMs = Date.parse(sub.created_at);
  if (!Number.isFinite(createdMs)) return null;
  const endsMs = createdMs + trialDays * 24 * 60 * 60 * 1000;
  if (endsMs <= Date.now()) return null;
  return new Date(endsMs).toISOString();
}

/** One add-on as a purchase surface needs it: named, priced, by meaning. */
export interface DodoOfferableAddon {
  /**
   * The meaning, under the name the WIRE uses for it — the same key a purchase
   * request sends back in `addons: [{ addon, quantity }]`. One word in both
   * directions, so a client cannot read the catalogue under one vocabulary and
   * order under another.
   */
  readonly addon: DodoAddonMeaning;
  /** Dodo's own name for the add-on. Never an id. */
  readonly name: string;
  /** Price in the currency's smallest unit, as Dodo holds it. Never from code. */
  readonly priceMinorUnits: number;
  readonly currency: string;
}

/**
 * The add-ons a church can be shown on `period`, priced by Dodo.
 *
 * 🔴 PRICES COME FROM DODO, ON EVERY REQUEST. Add-on prices are settled and live
 * in the processor; a copy in this repo would be a second source of truth that
 * drifts, and a drifted price shown next to a real purchase button is a quoted
 * amount that is not the charged amount. `addon-purchase-surface.test.ts` scans
 * the repo for them.
 *
 * The LIST is `offerableAddonMeanings` — the active table, never a literal — so
 * an add-on with no id in this environment is not returned and therefore cannot
 * be rendered, let alone bought. Live Campus is exactly that case today.
 */
export async function describeOfferableAddons(
  period: BillingPeriod,
  retrieveAddon: (addonId: string) => Promise<{ name?: unknown; price?: unknown; currency?: unknown }>,
): Promise<DodoOfferableAddon[]> {
  const meanings = offerableAddonMeanings(period);
  return Promise.all(
    meanings.map(async (meaning) => {
      const addon = await retrieveAddon(addonIdFor(meaning, period) as string);
      const name = typeof addon?.name === 'string' ? addon.name.trim() : '';
      const price = typeof addon?.price === 'number' ? addon.price : null;
      if (name === '' || price === null) {
        // Same rule as `describeDodoAddons`: an add-on that cannot be shown in
        // words and in money is not shown at all. A purchase button with a
        // missing price is how someone buys something for an unknown amount.
        throw new Error(`[dodo] add-on for ${meaning} has no name or price to show`);
      }
      return {
        addon: meaning,
        name,
        priceMinorUnits: price,
        currency: typeof addon?.currency === 'string' ? addon.currency : 'USD',
      };
    }),
  );
}
