'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Minus, Plus, AlertCircle, PackagePlus } from 'lucide-react';
import { useTenantOptional } from '../../contexts/TenantContext';
import { NO_ADDONS } from '../../utils/plan-features';
import {
  fetchOfferableAddons,
  formatAddonPrice,
  ownedAddonQuantity,
  runDodoAddonChange,
  type AddonMeaning,
  type OfferableAddon,
} from '../../utils/addon-change';

const GOLD = 'var(--brand-color, #B8962E)';

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
 * (REP-5b).
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
 * ⚠️ NO TIER GATE HERE, DELIBERATELY (THE-133). Which add-ons a plan may hold is
 * enforced by Dodo, on the product — "Contacts +500" is not attached to the
 * Individual products and "Unlimited Contacts" only to Ministry — precisely so
 * that a Harvest bug cannot sell Unlimited Contacts to a $49 plan. A gate here
 * would move that decision out of the payment processor and into a component.
 *
 * ⚠️ NO PRICE IS WRITTEN IN THIS FILE. Add-on prices are settled and live in
 * Dodo; every figure rendered arrived from the catalogue call or from the
 * preview.
 *
 * ⚠️ OUT OF SCOPE: prompting at the cap. Offering "+500 for $20" at the moment a
 * church hits 500 contacts is where add-on revenue actually comes from, and it
 * is a sweep across many surfaces — REP-5c. This is the canonical surface only.
 */
const AddOnsSection: React.FC<AddOnsSectionProps> = ({ tenantId, processor }) => {
  const tenant = useTenantOptional();
  // 🔴 WHAT THEY OWN COMES FROM THE CONTEXT, which reads it off the same tenant
  // document the webhook writes — not from a second fetch that could disagree
  // with the caps every other screen is rendering from.
  const owned = tenant?.tenantAddons ?? NO_ADDONS;
  const refreshTenantAddons = tenant?.refreshTenantAddons;

  const [catalogue, setCatalogue] = useState<OfferableAddon[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<AddonMeaning | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (processor !== 'dodo' || !tenantId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const result = await fetchOfferableAddons(tenantId);
      if (cancelled) return;
      setCatalogue(result.addons);
      setError(result.error);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [processor, tenantId]);

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
      } finally {
        setBusy(null);
      }
    },
    [tenantId, refreshTenantAddons],
  );

  if (processor !== 'dodo' || !tenantId) return null;

  if (loading) {
    return (
      <div className="bg-surface-raised rounded-2xl p-5 border border-line shadow-sm flex items-center gap-2">
        <Loader2 size={16} className="animate-spin" style={{ color: GOLD }} />
        <span className="text-sm text-muted">Loading add-ons…</span>
      </div>
    );
  }

  // Nothing this build can sell in this environment — so nothing to render. Not
  // an error and not an empty shelf with a heading over it.
  if (!error && catalogue.length === 0) return null;

  return (
    <div className="bg-surface-raised rounded-2xl p-5 border border-line shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <PackagePlus size={16} style={{ color: GOLD }} />
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

      <ul className="divide-y divide-line-subtle">
        {catalogue.map((addon) => {
          const count = ownedAddonQuantity(owned, addon.addon);
          const isBusy = busy === addon.addon;
          // Holding it at all is the whole fact for Unlimited Contacts, so it
          // gets an on/off control rather than a counter that could bill twice
          // for one entitlement.
          const isToggle = addon.addon === 'unlimitedContacts';

          return (
            <li key={addon.addon} className="py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-strong truncate">{addon.name}</p>
                <p className="text-xs text-muted">
                  {formatAddonPrice(addon.priceMinorUnits, addon.currency)}
                  {count > 0 && (
                    <span className="ml-2 text-green-600 font-medium">
                      {isToggle ? 'Active' : `${count} owned`}
                    </span>
                  )}
                </p>
              </div>

              {isBusy ? (
                <Loader2 size={16} className="animate-spin" style={{ color: GOLD }} />
              ) : isToggle ? (
                <button
                  onClick={() => change(addon, count > 0 ? 0 : 1)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                    count > 0
                      ? 'border border-line text-body hover:bg-surface-tint'
                      : 'text-white'
                  }`}
                  style={count > 0 ? undefined : { backgroundColor: GOLD }}
                >
                  {count > 0 ? 'Remove' : 'Add'}
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => change(addon, count - 1)}
                    disabled={count === 0}
                    aria-label={`Remove one ${addon.name}`}
                    className="p-1.5 rounded-lg border border-line text-body disabled:opacity-30 hover:bg-surface-tint transition-colors"
                  >
                    <Minus size={14} />
                  </button>
                  <span className="text-sm font-semibold text-strong w-5 text-center">{count}</span>
                  <button
                    onClick={() => change(addon, count + 1)}
                    aria-label={`Add one ${addon.name}`}
                    className="p-1.5 rounded-lg text-white transition-colors"
                    style={{ backgroundColor: GOLD }}
                  >
                    <Plus size={14} />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default AddOnsSection;
