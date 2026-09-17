import { captureMoneyPathError } from '@/lib/money-path-sentry';
import { NO_ADDONS } from '@/utils/plan-features';
import type { TenantAddons } from '@/types/tenant.types';
import { resolveAddonMeaning, type DodoAddonMeaning } from './catalogue';
import {
  DodoAddonsUnreadableError,
  readHeldDodoAddons,
  type DodoAddonSelection,
  type DodoSubscriptionLike,
} from './dodo-provider';

/**
 * What a Dodo subscription's add-ons MEAN for a tenant (REP-5a).
 *
 * The one place `Array<{ addon_id, quantity }>` becomes
 * `{ adminSeats: 2, unlimitedContacts: false, ... }`. Everything either side
 * of this module speaks one vocabulary: Dodo ids on the wire side, meanings on
 * the tenant side, and no id crosses over — see `TenantAddons`.
 *
 * ─── Three rules, and each one is a bug this build refuses to have ───────────
 *
 *  1. 🔴 AN UNRECOGNISED ID IS REPORTED, NEVER DROPPED. The difference between
 *     reporting and skipping is the difference between someone finding out and a
 *     church paying every month for nothing. The tenant's other add-ons still
 *     apply — one unknown id must not cost them the ones that mapped.
 *
 *     ⚠️ THE RETIRED IDS NOW TAKE THIS PATH, and that is correct. THE-370
 *     removed Campus and Contacts +500 from the table, so a subscription still
 *     carrying one is REPORTED rather than silently granted. Dodo has them
 *     detached from all nine plan products, so no live subscription should —
 *     and if one does, that is precisely the thing worth a Sentry event.
 *
 *  2. 🔴 "NONE" AND "COULD NOT READ" NEVER CONVERGE. `readHeldDodoAddons`
 *     (THE-132's parser, reused here rather than rewritten) throws when a
 *     payload does not report its add-ons at all. Writing `NO_ADDONS` on that
 *     would strip capacity a church pays for on the strength of a malformed
 *     payload, so it resolves to `null` and every caller leaves the stored set
 *     alone.
 *
 *  3. 🔴 THE RESULT IS A REPLACEMENT, NOT AN INCREMENT. It is computed from the
 *     subscription's CURRENT add-on array, which is the whole truth about what
 *     is attached, so writing it twice writes the same thing. That is what makes
 *     redelivery safe by construction rather than by a counter someone has to
 *     remember not to `+=`.
 */

/** What one subscription's add-ons resolved to. */
export interface DodoAddonEntitlements {
  /** The meanings, ready to store on the tenant doc. Never contains an id. */
  readonly addons: TenantAddons;
  /** 🔴 Ids the active table does not map. Reported by the caller, never dropped. */
  readonly unrecognised: readonly DodoAddonSelection[];
}

/** Fold one recognised add-on into the set being built. */
function applyMeaning(
  into: TenantAddons,
  meaning: DodoAddonMeaning,
  quantity: number,
): TenantAddons {
  // Dodo sends whole units; a non-positive quantity is not an entitlement.
  const units = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 0;
  switch (meaning) {
    case 'aiAssistant':
      return { ...into, aiAssistant: into.aiAssistant + units };
    case 'adminSeat':
      return { ...into, adminSeats: into.adminSeats + units };
    case 'unlimitedContacts':
      // A quantity means nothing here: holding it at all is the fact. Two of
      // them is still unlimited, and zero of them is not holding it.
      return { ...into, unlimitedContacts: into.unlimitedContacts || units > 0 };
  }
}

/**
 * Map a held add-on list through the ACTIVE table.
 *
 * Deliberately total and deliberately unopinionated about what to do with an
 * unrecognised id: it hands them back so the caller can report them WITH the
 * tenant and subscription they belong to, which is the context that makes a
 * Sentry issue actionable.
 */
export function mapDodoAddons(
  held: readonly DodoAddonSelection[],
): DodoAddonEntitlements {
  let addons: TenantAddons = { ...NO_ADDONS };
  const unrecognised: DodoAddonSelection[] = [];

  for (const selection of held) {
    const meaning = resolveAddonMeaning(selection.addon_id);
    if (meaning === null) {
      unrecognised.push(selection);
      continue;
    }
    addons = applyMeaning(addons, meaning, selection.quantity);
  }

  return { addons, unrecognised };
}

/**
 * The two fields mapping reads off a webhook payload.
 *
 * Narrower than `DodoSubscriptionLike` because the webhook handlers each carry
 * their own payload interface (`DodoPlanChangePayload`,
 * `DodoSubscriptionPayload`) and neither is the provider's. The one cast that
 * bridges them lives below, in this module, rather than at each call site.
 */
export interface DodoAddonBearingPayload {
  subscription_id?: unknown;
  addons?: unknown;
}

/**
 * A subscription payload → what its add-ons mean, or `null` when the payload
 * does not report them.
 *
 * `null` is "could not determine", NOT "none" — see rule 2 above. Callers must
 * branch on it and leave the stored set untouched.
 */
export function readDodoAddonEntitlements(
  sub: DodoAddonBearingPayload,
): DodoAddonEntitlements | null {
  try {
    return mapDodoAddons(readHeldDodoAddons(sub as DodoSubscriptionLike));
  } catch (err) {
    if (err instanceof DodoAddonsUnreadableError) return null;
    throw err;
  }
}

/** Where an unrecognised add-on was found, for the report. */
export interface DodoAddonReportContext {
  readonly step: string;
  readonly subscriptionId: string;
  readonly tenantId?: string;
}

/**
 * 🔴 Report every add-on id the active table could not map.
 *
 * This is the safety property that makes an incomplete catalogue shippable. A
 * church buys something, Dodo bills them for it, and this build does not know
 * what it is — the only unacceptable response to that is silence.
 *
 * Reported as a money-path ERROR, one Sentry event per unmapped id, carrying the
 * id and the subscription and nothing else: an add-on id and a subscription id
 * are identifiers, and the church's details belong in Dodo, not in a tag.
 *
 * Returns the number reported, so a caller can say so in its own outcome.
 */
export function reportUnrecognisedDodoAddons(
  unrecognised: readonly DodoAddonSelection[],
  context: DodoAddonReportContext,
): number {
  for (const selection of unrecognised) {
    console.error(
      `🔴 [dodo] Subscription ${context.subscriptionId} holds add-on ${selection.addon_id} ` +
        `(quantity ${selection.quantity}), which this build's add-on table does not map. ` +
        'The customer is being CHARGED for it and has NOT been granted it. ' +
        'Add the id to src/lib/dodo/catalogue.ts.',
    );
    captureMoneyPathError(
      new Error(
        `[dodo] Unrecognised add-on ${selection.addon_id} on subscription ${context.subscriptionId}: ` +
          'charged by Dodo, not granted by Harvest.',
      ),
      {
        step: context.step,
        level: 'error',
        ...(context.tenantId ? { tenantId: context.tenantId } : {}),
        ids: {
          subscriptionId: context.subscriptionId,
          addonId: selection.addon_id,
          quantity: String(selection.quantity),
        },
      },
    );
  }
  return unrecognised.length;
}

/**
 * Do two add-on sets say the same thing?
 *
 * Used to decide whether a `plan_changed` event has anything left to apply.
 * Field-by-field over the three meanings rather than a JSON compare: key order
 * off a Firestore document is not guaranteed, and a stringify would call two
 * identical sets different and rewrite the doc on every redelivery.
 */
export function sameTenantAddons(a: TenantAddons, b: TenantAddons): boolean {
  return (
    a.aiAssistant === b.aiAssistant &&
    a.adminSeats === b.adminSeats &&
    a.unlimitedContacts === b.unlimitedContacts
  );
}
