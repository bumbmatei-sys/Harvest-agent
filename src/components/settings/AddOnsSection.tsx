'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Minus, Plus, AlertCircle, PackagePlus } from 'lucide-react';
import { useTenantOptional } from '../../contexts/TenantContext';
import { CONTACTS_PER_PACK, NO_ADDONS } from '../../utils/plan-features';
import {
  ADDON_MEANINGS,
  fetchOfferableAddons,
  formatAddonAmount,
  formatAddonPrice,
  ownedAddonQuantity,
  previewAddonChange,
  runDodoAddonChange,
  type AddonBillingPeriod,
  type AddonMeaning,
  type OfferableAddon,
} from '../../utils/addon-change';

interface AddOnsSectionProps {
  tenantId?: string;
  /**
   * Which processor owns the subscription. Add-ons are a Dodo capability —
   * `/api/dodo/addons` serves Dodo-owned tenants and refuses everything else —
   * so a Stripe tenant is shown nothing rather than controls that would 409.
   * Undefined means "not known yet"; nothing renders until it is.
   */
  processor?: 'stripe' | 'dodo' | null;
}

/**
 * Settings → Billing & Payments → Add-ons: the ONE place an add-on is bought
 * (REP-5b), as a card per add-on with the real charge on the button (REP-5d).
 *
 * Billing & Payments is the canonical home because it already holds Current
 * Plan, the plan change and Manage Subscription, and it is already gated on
 * `billingAccess` (#301) to the same three identities `requireOwner` admits
 * server-side. Browse, add, change quantity, remove — all four here, none
 * anywhere else.
 *
 * ─── 🔴 WHAT IS OFFERED COMES FROM THE SERVER, ALWAYS ────────────────────────
 *
 * There is no list of add-ons in this file. `/api/dodo/addons` derives it from
 * the active add-on table, so an add-on with no id in the running environment is
 * absent from the response and therefore cannot appear here or be bought. Live
 * Campus is exactly that today: its two Dodo ids were never recorded, so a live
 * deployment does not offer it, and a church cannot be charged $15 a month for
 * something no code path could grant them. Recording the ids makes it appear
 * with no change to this component.
 *
 * ⚠️ AND WHAT THE SERVER DID NOT OFFER IS SHOWN, DISABLED — see `unavailable`
 * below. An add-on a church cannot buy yet is still a fact about the product,
 * and hiding it entirely is how a Ministry church never learns a second campus
 * is possible. The card is derived by SUBTRACTION from `ADDON_MEANINGS`, so no
 * add-on is named here and filling the two live Campus ids moves it from the
 * disabled group to the buyable one with no edit to this file.
 *
 * ⚠️ NO TIER GATE HERE, DELIBERATELY (THE-133). Which add-ons a plan may hold is
 * enforced by Dodo, on the product — "Contacts +500" is not attached to the
 * Individual products and "Unlimited Contacts" only to Ministry — precisely so
 * that a Harvest bug cannot sell Unlimited Contacts to a $49 plan. A gate here
 * would move that decision out of the payment processor and into a component.
 *
 * ⚠️ NO PRICE IS WRITTEN IN THIS FILE. Add-on prices are settled and live in
 * Dodo; every figure rendered arrived from the catalogue call or from the
 * preview. That now includes the PERIOD each price recurs on: `formatAddonPrice`
 * takes the tenant's own billing period off the catalogue read, so a bare
 * `$228.00` — which beside an add-on reads as a one-off charge — cannot be
 * spelled from here.
 *
 * ⚠️ OUT OF SCOPE: prompting at the cap. Offering "+500 for $20" at the moment a
 * church hits 500 contacts is where add-on revenue actually comes from, and it
 * is a sweep across many surfaces — REP-5c. This is the canonical surface only.
 */

/**
 * How long a stepper has to stand still before the preview is asked for.
 *
 * ⚠️ THIS IS A RATE-LIMIT GUARD, NOT A POLISH DETAIL. `/api/dodo/addons` sits
 * behind the `api` limiter at 60 requests per minute per IP, and THE-139 was
 * that limit being spent by a chatty surface until the admin nav 429'd out from
 * under people. Holding + to go from 0 to 8 is eight presses in about a second;
 * without this it is eight Dodo previews, and the ninth thing that church's
 * browser asks for is refused. With it, it is one.
 */
const PREVIEW_DEBOUNCE_MS = 400;

/**
 * One line of what an add-on grants, keyed by MEANING.
 *
 * Copy, and only copy — it decides nothing. What can be bought is still whatever
 * the server returned, and an entry here for a meaning the server did not offer
 * is simply never read. Exhaustive over the union by type, so a sixth add-on
 * cannot be added to the vocabulary without someone writing its line.
 */
const GRANTS: Record<AddonMeaning, string> = {
  /* 🔴 THIS LINE DESCRIBES A GRANT NOTHING ENFORCES — THE-224, REPORTED NOT
     FIXED. Buying this raises `features.aiAssistant`, a COUNT of the RETIRED
     Telegram assistant, and no code path compares any usage against it. The
     member-facing assistant is `aiChat`, a plan capability included from Small
     Team up, and an add-on never flips a feature flag — so this purchase
     changes nothing for anyone on any tier.

     The marketing site has withdrawn its $20 card (THE-224); this surface is
     NOT the site's, and it cannot be fixed here. What renders is whatever the
     tenant's own Dodo product carries, by design — THE-133 put add-on
     availability in the processor precisely so a bug in this repo cannot sell
     something. So this card disappears when the two `AI Assistant` add-on
     products are detached from the nine plan products (or archived) in Dodo,
     which is a processor change and the founder's call. Until then it renders,
     and no honest wording exists for it: the fix is withdrawal, or building an
     enforced limit — seats, or a top-up on `queryTokensPerMonth`.

     ⚠️ Leave the mapping in place either way. It is exhaustive over
     `AddonMeaning` by type, and a tenant who somehow holds one still needs its
     card labelled rather than blank. */
  aiAssistant: 'Adds one AI assistant to your account.',
  adminSeat: 'One more admin account, beyond what your plan includes.',
  campus: 'One more campus on your account.',
  contactPack: `Adds ${CONTACTS_PER_PACK.toLocaleString()} to your contact limit.`,
  unlimitedContacts: 'Removes the contact limit on your plan entirely.',
};

/**
 * A readable name for a meaning the catalogue did NOT return.
 *
 * Names come from Dodo, and an add-on the server did not offer arrived with no
 * name — so the disabled card has to say something, and the only thing it can
 * honestly say is the meaning itself, spaced out. 🔴 Derived, never written
 * down: a table of names here would be a second place that has to learn about a
 * new add-on, and a hardcoded "Campus" would still be rendering a Campus card
 * long after the reason for it was gone.
 */
function labelForMeaning(meaning: AddonMeaning): string {
  const spaced = meaning.replace(/[A-Z]/g, (capital) => ` ${capital}`);
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Where the preview for one add-on has got to.
 *
 * 🔴 EVERY STATE CARRIES THE QUANTITY IT IS ABOUT. That is what makes a stale
 * answer detectable: the render compares this quantity with the one the stepper
 * is showing now, and an amount computed for a quantity nobody is looking at any
 * more is never offered — it is not the price of the change on screen.
 */
type PreviewState =
  | { status: 'loading'; quantity: number }
  | { status: 'ready'; quantity: number; amountDueNow: number; currency: string }
  | { status: 'failed'; quantity: number; message: string };

const AddOnsSection: React.FC<AddOnsSectionProps> = ({ tenantId, processor }) => {
  const tenant = useTenantOptional();
  // 🔴 WHAT THEY OWN COMES FROM THE CONTEXT, which reads it off the same tenant
  // document the webhook writes — not from a second fetch that could disagree
  // with the caps every other screen is rendering from.
  const owned = tenant?.tenantAddons ?? NO_ADDONS;
  const refreshTenantAddons = tenant?.refreshTenantAddons;
  // 🔴 AND THE RESULTING CAPACITY COMES FROM THE SAME PLACE, already layered by
  // `getEffectiveFeatures`. A component that added CONTACTS_PER_PACK per pack by
  // hand would be a second implementation of the one function whose whole job is
  // that sum — and the number it printed would be the one a church checks its
  // contact list against.
  const planFeatures = tenant?.planFeatures ?? null;

  const [catalogue, setCatalogue] = useState<OfferableAddon[]>([]);
  const [billing, setBilling] = useState<AddonBillingPeriod | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<AddonMeaning | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The quantity each stepper is SET TO — what they are changing to, not what they hold. */
  const [pending, setPending] = useState<Partial<Record<AddonMeaning, number>>>({});
  const [previews, setPreviews] = useState<Partial<Record<AddonMeaning, PreviewState>>>({});

  /** One pending debounce per add-on, so two steppers cannot cancel each other. */
  const timers = useRef<Partial<Record<AddonMeaning, ReturnType<typeof setTimeout>>>>({});
  /** The quantity each add-on's in-flight preview was asked about. */
  const asked = useRef<Partial<Record<AddonMeaning, number>>>({});

  useEffect(() => {
    if (processor !== 'dodo' || !tenantId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const result = await fetchOfferableAddons(tenantId);
      if (cancelled) return;
      setCatalogue(result.addons);
      setBilling(result.billing);
      setError(result.error);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [processor, tenantId]);

  // A timer that fires into an unmounted tree is a Dodo call nobody will read.
  useEffect(() => {
    const pendingTimers = timers.current;
    return () => {
      for (const timer of Object.values(pendingTimers)) if (timer) clearTimeout(timer);
    };
  }, []);

  const requestPreview = useCallback(
    async (meaning: AddonMeaning, quantity: number) => {
      if (!tenantId) return;
      asked.current[meaning] = quantity;
      setPreviews((current) => ({ ...current, [meaning]: { status: 'loading', quantity } }));
      const result = await previewAddonChange({ tenantId, addon: meaning, quantity });
      // 🔴 A REPLY TO A QUESTION NOBODY IS ASKING ANY MORE IS DROPPED. Two
      // previews can be in flight when a slow one is overtaken, and letting the
      // straggler land would replace a current amount with an older one — the
      // exact way a button ends up quoting a figure for a quantity that is no
      // longer on screen. The render's own quantity check backs this up.
      if (asked.current[meaning] !== quantity) return;
      setPreviews((current) => ({
        ...current,
        [meaning]: result.ok
          ? {
              status: 'ready',
              quantity,
              amountDueNow: result.preview.amountDueNow,
              currency: result.preview.currency,
            }
          : { status: 'failed', quantity, message: result.error },
      }));
    },
    [tenantId],
  );

  /** Move a stepper, and schedule the preview for where it landed. */
  const setQuantity = useCallback(
    (meaning: AddonMeaning, quantity: number) => {
      const target = Math.max(0, quantity);
      setPending((current) => ({ ...current, [meaning]: target }));

      const running = timers.current[meaning];
      if (running) clearTimeout(running);

      if (target === ownedAddonQuantity(owned, meaning)) {
        // Back where they started: nothing is changing, so there is nothing to
        // ask Dodo about and nothing to offer.
        delete asked.current[meaning];
        setPreviews((current) => ({ ...current, [meaning]: undefined }));
        return;
      }

      // Shown as pending IMMEDIATELY, before the debounce has even elapsed —
      // the moment the quantity moves, any amount already on the button is
      // about the old quantity and must stop being offered.
      setPreviews((current) => ({ ...current, [meaning]: { status: 'loading', quantity: target } }));
      timers.current[meaning] = setTimeout(() => {
        void requestPreview(meaning, target);
      }, PREVIEW_DEBOUNCE_MS);
    },
    [owned, requestPreview],
  );

  const change = useCallback(
    async (addon: OfferableAddon, quantity: number) => {
      if (!tenantId) return;
      setBusy(addon.addon);
      setNotice(null);
      try {
        const result = await runDodoAddonChange({
          tenantId,
          addon: addon.addon,
          quantity,
          name: addon.name,
        });
        if (result.message) setNotice(result.message);
        // 🔴 RE-READ, never assume. The `subscription.plan_changed` webhook is
        // the single writer of the add-on set, and `on_payment_failure:
        // 'prevent_change'` means Dodo decides whether the change took after the
        // payment — so what is shown here always came from that writer rather
        // than from what this component asked for. It may briefly still show the
        // old set if it beats the webhook, which is why the confirmation says
        // the change may take a moment to appear.
        if (result.ok && refreshTenantAddons) await refreshTenantAddons();
        if (result.ok) {
          // The stepper goes back to tracking what they hold, whatever the
          // webhook turns out to have written.
          delete asked.current[addon.addon];
          setPending((current) => ({ ...current, [addon.addon]: undefined }));
          setPreviews((current) => ({ ...current, [addon.addon]: undefined }));
        }
      } finally {
        setBusy(null);
      }
    },
    [tenantId, refreshTenantAddons],
  );

  if (processor !== 'dodo' || !tenantId) return null;

  if (loading) {
    return (
      <div className="bg-surface-raised rounded-2xl p-5 border border-line shadow-xs flex items-center gap-2">
        <Loader2 size={16} className="animate-spin text-gold" />
        <span className="text-sm text-muted">Loading add-ons…</span>
      </div>
    );
  }

  // Nothing this build can sell in this environment — so nothing to render. Not
  // an error and not an empty shelf with a heading over it.
  if (!error && catalogue.length === 0) return null;

  /**
   * The add-ons the server did NOT offer, by subtraction.
   *
   * 🔴 ONLY WHEN THE CATALOGUE ACTUALLY LOADED. On a failed read every meaning is
   * "missing", and rendering five "Not available yet" cards would turn an outage
   * into a product statement — telling a church nothing is for sale when the
   * truth is that we could not ask.
   */
  const unavailable = error || catalogue.length === 0
    ? []
    : ADDON_MEANINGS.filter((meaning) => !catalogue.some((offered) => offered.addon === meaning));

  return (
    <div className="bg-surface-raised rounded-2xl p-5 border border-line shadow-xs">
      <div className="flex items-center gap-2 mb-1">
        <PackagePlus size={16} className="text-gold" />
        <h3 className="text-sm font-bold text-body font-display">Add-ons</h3>
      </div>
      <p className="text-sm text-muted mb-4">
        Extra capacity on top of your plan. Changes are prorated — you&apos;ll see the exact
        amount before anything is charged.
      </p>

      {error && (
        <div className="mb-3 p-3 rounded-xl text-sm flex items-center gap-2 bg-amber-50 text-amber-700 border border-amber-100">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {notice && (
        <div className="mb-3 p-3 rounded-xl text-sm bg-surface-sunken text-body border border-line">
          {notice}
        </div>
      )}

      <ul className="max-w-[560px] space-y-3">
        {catalogue.map((addon) => {
          const held = ownedAddonQuantity(owned, addon.addon);
          const target = pending[addon.addon] ?? held;
          const delta = target - held;
          const isBusy = busy === addon.addon;
          // Holding it at all is the whole fact for Unlimited Contacts, so it
          // gets an on/off control rather than a counter that could bill twice
          // for one entitlement.
          const isToggle = addon.addon === 'unlimitedContacts';
          const preview = previews[addon.addon];
          // 🔴 THE STALENESS CHECK. An amount is only ever shown against the
          // quantity it was computed for.
          const current = preview && preview.quantity === target ? preview : undefined;

          return (
            <li
              key={addon.addon}
              className="rounded-brand border-[0.5px] border-line bg-surface-tint px-5 py-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <PackagePlus size={14} className="text-gold shrink-0" aria-hidden />
                  <p className="text-sm font-semibold text-strong truncate">{addon.name}</p>
                </div>
                {held > 0 && (
                  <span className="shrink-0 rounded-full border border-green-100 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                    {isToggle
                      ? 'Active'
                      : addon.addon === 'contactPack' && planFeatures
                        ? // What they hold, and what it adds up to. A church
                          // buying capacity is buying the second number.
                          `${held} owned · ${
                            planFeatures.unlimitedContacts
                              ? 'unlimited'
                              : planFeatures.maxContacts.toLocaleString()
                          } total`
                        : `${held} owned`}
                  </span>
                )}
              </div>

              {billing && (
                <p className="mt-2 text-base font-semibold text-strong">
                  {formatAddonPrice(addon.priceMinorUnits, addon.currency, billing)}
                  {!isToggle && ' each'}
                </p>
              )}
              <p className="mt-0.5 text-xs text-muted">{GRANTS[addon.addon]}</p>

              {isBusy ? (
                <p className="mt-3 flex items-center gap-2 text-xs text-muted">
                  <Loader2 size={14} className="animate-spin text-gold" /> Working…
                </p>
              ) : isToggle ? (
                <button
                  onClick={() => change(addon, held > 0 ? 0 : 1)}
                  className={`mt-3 w-full px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
                    held > 0
                      ? 'border border-line text-body hover:bg-surface-sunken'
                      : 'bg-gold text-white'
                  }`}
                >
                  {held > 0
                    ? 'Remove'
                    : billing
                      ? `Add for ${formatAddonPrice(addon.priceMinorUnits, addon.currency, billing)}`
                      : 'Add'}
                </button>
              ) : (
                <>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => setQuantity(addon.addon, target - 1)}
                      disabled={target === 0}
                      aria-label={`Remove one ${addon.name}`}
                      className="p-1.5 rounded-lg border border-line text-body disabled:opacity-30 hover:bg-surface-sunken transition-colors"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="text-sm font-semibold text-strong w-6 text-center">{target}</span>
                    <button
                      onClick={() => setQuantity(addon.addon, target + 1)}
                      aria-label={`Add one ${addon.name}`}
                      className="p-1.5 rounded-lg bg-gold text-white transition-colors"
                    >
                      <Plus size={14} />
                    </button>
                  </div>

                  {delta !== 0 && (
                    <>
                      <button
                        onClick={() => change(addon, target)}
                        disabled={current?.status !== 'ready'}
                        className="mt-2 w-full px-3 py-2 rounded-xl text-xs font-semibold bg-gold text-white disabled:opacity-40 transition-colors"
                      >
                        {commitCopy({
                          delta,
                          preview: current,
                          price: billing
                            ? formatAddonPrice(addon.priceMinorUnits, addon.currency, billing)
                            : null,
                        })}
                      </button>
                      {current?.status === 'failed' && (
                        // 🔴 SAID PLAINLY, AND NOT REPLACED BY THE STICKER PRICE.
                        // The recurring price is not what this change costs
                        // today, so offering it here would be a confident wrong
                        // figure on a button that charges money.
                        <p className="mt-1.5 text-xs text-danger">
                          {current.message}{' '}
                          <button
                            onClick={() => void requestPreview(addon.addon, target)}
                            className="underline font-semibold"
                          >
                            Try again
                          </button>
                        </p>
                      )}
                    </>
                  )}
                </>
              )}
            </li>
          );
        })}

        {unavailable.map((meaning) => (
          <li
            key={meaning}
            className="rounded-brand border-[0.5px] border-line bg-surface-tint px-5 py-4 opacity-70"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle size={14} className="text-muted shrink-0" aria-hidden />
                <p className="text-sm font-semibold text-strong truncate">
                  {labelForMeaning(meaning)}
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-line-subtle bg-surface-sunken px-2 py-0.5 text-xs font-medium text-muted">
                Not available yet
              </span>
            </div>
            <p className="mt-2 text-xs text-muted">{GRANTS[meaning]}</p>
            <p className="mt-0.5 text-xs text-faint">
              Not set up for purchase yet. Contact support if you need it.
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
};

/**
 * What the confirm button SAYS — and it never says more than is known.
 *
 * Four states, in the order they happen: no amount yet, the amount, the amount
 * that could not be worked out, and (only when the catalogue read gave no
 * period) no price to quote at all. 🔴 The failed state deliberately has no
 * figure in it. Falling back to the recurring price would put a number on a
 * button that is not the number about to be charged, which is the defect this
 * whole surface exists to close.
 */
function commitCopy(args: {
  delta: number;
  preview: PreviewState | undefined;
  price: string | null;
}): string {
  const { delta, preview, price } = args;
  const action = delta > 0 ? `Add ${delta}` : `Remove ${-delta}`;

  if (!preview || preview.status === 'loading') return `${action} — working out the cost…`;
  if (preview.status === 'failed') return `${action} — cost unavailable`;

  const today =
    preview.amountDueNow > 0
      ? `${formatAddonAmount(preview.amountDueNow, preview.currency)} today`
      : 'no charge today';

  // Only an addition keeps costing something afterwards; saying "then" about a
  // removal would name a price the church is about to stop paying.
  return delta > 0 && price ? `${action} — ${today}, then ${price}` : `${action} — ${today}`;
}

export default AddOnsSection;
