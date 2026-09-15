"use client";
import React, { useState, useEffect, useRef } from 'react';
import { db, auth } from '../firebase';
import { collection, query, where, onSnapshot, doc, deleteDoc, getDoc, limit } from 'firebase/firestore';
import { Church, Search, Filter, Edit2, Trash2, CheckCircle, Clock, DollarSign } from 'lucide-react';
import ChurchEnrollment from './ChurchEnrollment';
import { authFetch } from '../utils/auth-fetch';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope } from '../utils/tenant-scope';
import { getPlanFeatures } from '../utils/plan-features';
import { useTenant } from '@/contexts/TenantContext';
import { AdminPageHeader, AdminPrimaryButton } from './admin/AdminUI';
import { FORM_MEASURE } from './layout/form-layout';
import {
  fetchOfferableAddons,
  formatAddonPrice,
  type AddonBillingPeriod,
} from '../utils/addon-change';

/** Every plan includes 1 church free (the tenant's own). */
const INCLUDED_CHURCHES = 1;

/**
 * THE-191 — the campus cap now names what a second campus costs.
 *
 * ─── What a church used to get here ──────────────────────────────────────────
 *
 * At the cap, "Add church" was `disabled`, carrying a `title` that read "Your
 * plan includes 1 church. Upgrade to Ministry to add more." Three things were
 * wrong with that, and the first is the one that matters:
 *
 *  1. 🔴 IT WAS FALSE. `maxChurches` is 1 on EVERY tier — Ministry included (see
 *     `plan-features.ts`, where Ministry deliberately did not inherit the
 *     deleted ultra tier's -1). Upgrading to Ministry buys no campus at all. The
 *     church would have paid $199/mo and arrived at the same refusal.
 *  2. 🔴 THE SENTENCE WAS UNREACHABLE ANYWAY on the surface that matters. It sat
 *     on a `title` attribute of a DISABLED button, so it needed a hover: a touch
 *     admin — the mobile case this product is built around — pressed a greyed
 *     control and got nothing at all. The matching branch inside
 *     `handleAddChurchClick` was dead code, because a disabled button never
 *     fires `onClick`.
 *  3. It named no price and offered no route forward.
 *
 * ─── Why an upgrade prompt is right HERE and nowhere else ────────────────────
 *
 * Harvest does not put teasers in the nav. This is the one place the prompt is
 * genuinely earned: a church has pressed a specific button, at a specific
 * moment, wanting a specific thing that is for sale. So the cap now OPENS the
 * offer instead of refusing, and the button is no longer disabled.
 *
 * ─── 🔴 THE PRICE IS READ, NEVER WRITTEN ─────────────────────────────────────
 *
 * The figure comes from `/api/dodo/addons` — the same live catalogue read
 * `AddOnsSection` renders from — via `fetchOfferableAddons`, and is formatted by
 * the same `formatAddonPrice` on the add-on's own billing period. NOTHING here
 * spells a number.
 *
 * ⚠️ That is not fastidiousness. This file already carried
 * `ENTERPRISE_PRICE_PER_CHURCH = 10`, and `catalogue.ts` still describes the
 * campus add-on as "$15 a month" in a comment. The LIVE price is neither: both
 * hardcoded figures are wrong, which is exactly what a hardcoded price becomes.
 * Quoting a church a stale number on a money decision is the class of claim this
 * product keeps having to correct.
 *
 * 🔴 AND A FAILED READ NAMES NO FIGURE. If the catalogue call fails, or this
 * build cannot sell a campus in the running environment (`addonIdFor` returns
 * null, so the meaning is absent from the response), the offer renders WITHOUT a
 * price rather than falling back to one. Same rule `AddOnsSection`'s failed
 * preview follows: no figure beats a wrong figure. The read is reported through
 * `priceError` and never swallowed.
 */
const CAMPUS_ADDON = 'campus' as const;

interface AdminChurchesProps {
  /**
   * Opens the billing screen, where `AddOnsSection` actually sells the campus.
   * Optional and undefined-when-not-entitled, mirroring `onOpenBilling` on
   * `MyAccountMenu`: an admin without billing access gets the explanation and
   * the price, but no button to a screen they cannot open.
   */
  onOpenBilling?: () => void;
}

const AdminChurches: React.FC<AdminChurchesProps> = ({ onOpenBilling }) => {
  const { tenantId, tenantPlan } = useTenant();
  const [churches, setChurches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [pastorFilter, setPastorFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editingChurch, setEditingChurch] = useState<any | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [activeFilterPopup, setActiveFilterPopup] = useState<'city' | 'pastor' | 'country' | null>(null);
  const [tempFilterValue, setTempFilterValue] = useState('');
  const [billingNotice, setBillingNotice] = useState<string | null>(null);
  const [showBillingConfirm, setShowBillingConfirm] = useState(false);
  const [billingLoading, setBillingLoading] = useState(false);
  // THE-191 — the campus offer shown at the cap, and the live price it quotes.
  const [showCampusOffer, setShowCampusOffer] = useState(false);
  const [campusPrice, setCampusPrice] = useState<string | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  // 🔴 Held so the offer can say the price is missing rather than quietly
  // render as though a campus were free. Never rendered as a figure.
  const [priceError, setPriceError] = useState<string | null>(null);
  // Whether the church being added right now is a paid one. Captured at add-time
  // because `churches` can update via onSnapshot before handleChurchSaved runs.
  const willBeBilledRef = useRef(false);

  // Unknown/loading plan falls back to 'plus' (maxChurches: 1) — fail closed on the cap.
  const maxChurches = getPlanFeatures(tenantPlan ?? 'plus').maxChurches;

  // Whether this plan bills PER CHURCH beyond the first. Derived from the plan's
  // own church allowance instead of naming a tier: only an uncapped plan can
  // reach church 2+, so only an uncapped plan can be billed for one.
  //
  // No tier is uncapped today — every plan is maxChurches: 1, so this is false
  // everywhere and the per-church billing UI never renders. That is deliberate:
  // additional campuses become a paid add-on rather than a property of the top
  // tier. It used to read `tenantPlan === 'ultra'`, which would have gone
  // silently dead when that tier was deleted. /api/churches/add-billing is the
  // server half and is unchanged; it independently declines to charge.
  const isMinistry = maxChurches === -1;
  const ENTERPRISE_PRICE_PER_CHURCH = 10; // $10/church/mo
  const atLimit = maxChurches !== -1 && churches.length >= maxChurches;

  const openFilterPopup = (type: 'city' | 'pastor' | 'country') => {
    setActiveFilterPopup(type);
    if (type === 'city') setTempFilterValue(cityFilter);
    if (type === 'pastor') setTempFilterValue(pastorFilter);
    if (type === 'country') setTempFilterValue(countryFilter);
  };

  const applyFilter = (value: string = tempFilterValue) => {
    if (activeFilterPopup === 'city') setCityFilter(value);
    if (activeFilterPopup === 'pastor') setPastorFilter(value);
    if (activeFilterPopup === 'country') setCountryFilter(value);
    setActiveFilterPopup(null);
  };

  const addChurchBilling = async (churchId: string, churchName: string) => {
    if (!tenantId) return;
    try {
      const res = await authFetch('/api/churches/add-billing', {
        method: 'POST',
        body: JSON.stringify({ tenantId, churchId, churchName }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to add billing');
      }
      return await res.json() as { success: boolean; subscriptionItemId: string };
    } catch (err) {
      console.error('Failed to add church billing:', err);
      setBillingNotice('Warning: Church created but billing setup failed. Contact support.');
      setTimeout(() => setBillingNotice(null), 7000);
    }
  };

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    (async () => {
      const resolvedTenantId = await getTenantScope();
      const q = resolvedTenantId
        ? query(collection(db, 'churches'), where('tenantId', '==', resolvedTenantId), limit(100))
        : query(collection(db, 'churches'), limit(100));

      unsubscribe = onSnapshot(q, (snapshot) => {
        const churchData: any[] = [];
        snapshot.forEach((doc) => {
          churchData.push({ id: doc.id, ...doc.data() });
        });
        setChurches(churchData);
        setLoading(false);
      }, (error) => {
        try { handleFirestoreError(error, OperationType.GET, `churches`); } catch (e) { console.error(e); }
        setLoading(false);
      });
    })();

    return () => { if (unsubscribe) unsubscribe(); };
  }, []);

  const handleDelete = async (id: string) => {
    try {
      const resolvedTenantId = await getTenantScope();
      if (resolvedTenantId) {
        const docSnap = await getDoc(doc(db, 'churches', id));
        if (docSnap.exists() && docSnap.data().tenantId && docSnap.data().tenantId !== resolvedTenantId) {
          console.error('Tenant mismatch — cannot modify another tenant\'s document');
          return;
        }
      }
      // Remove Stripe $10/mo billing for this church before deleting
      if (isMinistry && resolvedTenantId) {
        await authFetch('/api/churches/remove-billing', {
          method: 'POST',
          body: JSON.stringify({ tenantId: resolvedTenantId, churchId: id }),
        }).catch(err => console.error('remove-billing failed (non-fatal):', err));
      }
      await deleteDoc(doc(db, 'churches', id));
      setDeleteConfirmId(null);
    } catch (error) {
      try { handleFirestoreError(error, OperationType.DELETE, `churches/${id}`); } catch (e) { console.error(e); }
    }
  };

  const handleChurchSaved = async (churchData?: any) => {
    const wasAdding = isAdding;
    const shouldBill = willBeBilledRef.current;
    setIsAdding(false);
    setEditingChurch(null);
    willBeBilledRef.current = false;

    // Bill only Ministry churches beyond the included free one (decided at add-time)
    if (isMinistry && wasAdding && churchData?.id && shouldBill) {
      setBillingNotice('Adding $10/mo to your subscription...');
      await addChurchBilling(churchData.id, churchData.name || '');
      setBillingNotice(`$10/mo added to your bill for "${churchData.name || 'New Church'}"`);
      setTimeout(() => setBillingNotice(null), 5000);
    }
  };

  /**
   * Ask the live catalogue what a campus costs. READ-ONLY, and lazy.
   *
   * Only ever called when an admin has actually pressed "Add church" at the cap,
   * so the Dodo-backed catalogue read is not spent on every admin who merely
   * opens this screen.
   *
   * 🔴 A failure is RECORDED, not swallowed: `priceError` is what makes the
   * offer drop its figure instead of rendering a blank where a price belongs.
   */
  const loadCampusPrice = async (forTenant: string) => {
    setPriceLoading(true);
    setPriceError(null);
    try {
      const { addons, billing, error } = await fetchOfferableAddons(forTenant);
      if (error) {
        setCampusPrice(null);
        setPriceError(error);
        return;
      }
      const campus = addons.find((a) => a.addon === CAMPUS_ADDON);
      // Absent means this build cannot sell a campus here — `offerableAddonMeanings`
      // derives the response from the active add-on table, so an unmapped id is
      // simply not in it. That is a refusal to sell, not a failed read.
      if (!campus || !billing) {
        setCampusPrice(null);
        setPriceError(
          campus ? 'We could not confirm the billing period.' : 'A campus cannot be added on this account yet.',
        );
        return;
      }
      setCampusPrice(
        formatAddonPrice(campus.priceMinorUnits, campus.currency, billing as AddonBillingPeriod),
      );
    } catch (err) {
      console.error('Failed to load campus add-on price:', err);
      setCampusPrice(null);
      setPriceError('We could not load the campus price just now.');
    } finally {
      setPriceLoading(false);
    }
  };

  const handleAddChurchClick = () => {
    if (loading) return; // church count not known yet — can't decide cap/billing
    if (atLimit) {
      // 🔴 Reachable now. The button is no longer `disabled`, so this opens the
      // offer instead of being dead code behind a control that cannot be pressed.
      setShowCampusOffer(true);
      setCampusPrice(null);
      setPriceError(null);
      if (tenantId) loadCampusPrice(tenantId);
      else setPriceError('A campus cannot be priced without an organisation.');
      return;
    }
    // The first church is free on every plan; only Ministry's 2nd+ church is billed.
    const willBeBilled = isMinistry && churches.length >= INCLUDED_CHURCHES;
    willBeBilledRef.current = willBeBilled;
    if (willBeBilled) {
      setShowBillingConfirm(true);
    } else {
      setIsAdding(true);
    }
  };

  const confirmBillingAndAdd = () => {
    setShowBillingConfirm(false);
    setIsAdding(true);
  };

  // "Add church" renders in the in-content page header (per the mockup).

  const filteredChurches = churches.filter(church => {
    const matchesSearch = searchTerm === '' || 
      church.name?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesPastor = pastorFilter === '' || 
      church.pastorName?.toLowerCase().includes(pastorFilter.toLowerCase());
    const matchesCity = cityFilter === '' || church.city?.toLowerCase().includes(cityFilter.toLowerCase());
    const matchesCountry = countryFilter === '' || church.country?.toLowerCase().includes(countryFilter.toLowerCase());
    
    return matchesSearch && matchesPastor && matchesCity && matchesCountry;
  });

  if (isAdding || editingChurch) {
    return (
      <div className={`bg-surface-raised rounded-2xl shadow-xs border border-line overflow-hidden ${FORM_MEASURE}`}>
        <div className="p-4 border-b border-line flex justify-between items-center">
          <h2 className="text-xl font-bold text-strong font-display">
            {isAdding ? 'Add Church' : 'Edit Church'}
          </h2>
          <button 
            onClick={() => { setIsAdding(false); setEditingChurch(null); }}
            className="text-muted hover:text-body"
          >
            Cancel
          </button>
        </div>
        <div className="p-4">
          <ChurchEnrollment 
            onBack={handleChurchSaved}
            initialData={editingChurch}
            onSave={handleChurchSaved}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      <AdminPageHeader
        eyebrow="Platform"
        title="Churches"
        subtitle={isMinistry ? `${churches.length} church${churches.length !== 1 ? 'es' : ''} · $${Math.max(0, churches.length - INCLUDED_CHURCHES) * ENTERPRISE_PRICE_PER_CHURCH}/mo (${INCLUDED_CHURCHES} included free)` : undefined}
        /* 🔴 NOT `disabled` at the cap — see the module note. The cap is a thing
           to BUY, so the button opens the offer; disabling it is what made the
           refusal silent on touch and its own handler unreachable. */
        action={<AdminPrimaryButton onClick={() => handleAddChurchClick()} className="min-h-[44px] sm:min-h-0" icon={<span className="text-[15px] leading-none">+</span>}>Add church</AdminPrimaryButton>}
      />

      {/* Billing Notice */}
      {billingNotice && (
        <div className="bg-wheat-50 border border-wheat-200 rounded-xl p-3 flex items-center gap-2">
          <DollarSign size={16} className="text-wheat-600" />
          <p className="text-sm text-wheat-700 font-medium">{billingNotice}</p>
        </div>
      )}

      {/* Add Church Billing Confirmation Modal */}
      {showBillingConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-surface-raised rounded-2xl p-6 max-w-md w-full shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-wheat-100 flex items-center justify-center">
                <DollarSign size={20} className="text-wheat-600" />
              </div>
              <h3 className="text-xl font-bold text-strong font-display">Adding a New Church</h3>
            </div>
            <p className="text-muted mb-6">
              Each additional church added to your organization will increase your monthly plan by{' '}
              <span className="font-semibold text-strong">$10/mo</span>. This will be charged
              automatically to your payment method on file.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowBillingConfirm(false)}
                className="px-4 py-2 text-muted hover:bg-surface-sunken rounded-xl transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={confirmBillingAndAdd}
                className="flex items-center gap-1.5 px-4 py-2 bg-gold text-white rounded-xl hover:bg-[color-mix(in_srgb,var(--brand-color)_85%,black)] transition-colors font-medium"
              >
                <DollarSign size={16} />
                Confirm & Add Church ($10/mo)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* THE-191 — at the cap: what a campus costs, and where to buy one. */}
      {showCampusOffer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-surface-raised rounded-2xl p-6 max-w-md w-full shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-[var(--surface-gold)] flex items-center justify-center">
                <Church size={20} className="text-gold" />
              </div>
              <h3 className="text-xl font-bold text-strong font-display">Add another campus</h3>
            </div>
            <p className="text-muted mb-2">
              {/* 🔴 "every plan, Ministry included" is the correction. The old copy
                  sent a church to a $199/mo tier that grants no extra campus. */}
              Every Harvest plan includes {INCLUDED_CHURCHES} campus — Ministry included.
              A second campus is an add-on.
            </p>
            {priceLoading ? (
              <p className="text-sm text-muted mb-6">Checking the price…</p>
            ) : campusPrice ? (
              <p className="text-base text-strong font-semibold mb-6">
                {campusPrice} for each extra campus
              </p>
            ) : (
              /* 🔴 NO FIGURE ON A FAILED READ. See the module note. */
              <p className="text-sm text-muted mb-6">
                {priceError || 'We could not load the campus price just now.'}
                {' '}You can see the current price on the billing screen.
              </p>
            )}
            <div className="flex flex-col sm:flex-row sm:justify-end gap-3">
              <button
                onClick={() => setShowCampusOffer(false)}
                className="min-h-[44px] sm:min-h-0 px-4 py-2.5 text-muted hover:bg-surface-sunken rounded-xl transition-colors font-medium"
              >
                Not now
              </button>
              {onOpenBilling && (
                <button
                  onClick={() => { setShowCampusOffer(false); onOpenBilling(); }}
                  className="min-h-[44px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-gold text-white rounded-xl hover:bg-[color-mix(in_srgb,var(--brand-color)_85%,black)] transition-colors font-medium"
                >
                  Add a campus
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-faint" size={18} />
          <input
            type="text"
            placeholder="Search churches…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-surface-raised border border-line rounded-brand-lg text-sm text-strong placeholder:text-faint focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_35%,transparent)] focus:border-transparent outline-hidden transition-all"
          />
        </div>
        
        <button
          onClick={() => openFilterPopup('city')}
          className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${cityFilter ? 'bg-gold text-white border-gold' : 'bg-surface-raised text-body border-line hover:border-gold'}`}
        >
          {cityFilter ? `City: ${cityFilter}` : 'City'}
        </button>

        <button
          onClick={() => openFilterPopup('pastor')}
          className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${pastorFilter ? 'bg-gold text-white border-gold' : 'bg-surface-raised text-body border-line hover:border-gold'}`}
        >
          {pastorFilter ? `Pastor: ${pastorFilter}` : 'Pastor'}
        </button>

        <button
          onClick={() => openFilterPopup('country')}
          className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${countryFilter ? 'bg-gold text-white border-gold' : 'bg-surface-raised text-body border-line hover:border-gold'}`}
        >
          {countryFilter ? `Country: ${countryFilter}` : 'Country'}
        </button>
      </div>

      {/* Church list — mobile: mockup card list (gold church disc, name, "city, country · pastor").
          Edit/delete reuse the same handlers as the desktop table; same filteredChurches + loading data. */}
      <div className="lg:hidden">
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-8 h-8 border-4 border-[color-mix(in_srgb,var(--brand-color)_30%,transparent)] border-t-gold rounded-full animate-spin"></div>
          </div>
        ) : filteredChurches.length === 0 ? (
          <div className="bg-surface-raised rounded-brand-xl border border-line shadow-[var(--ds-sh-sm)] p-8 text-center text-muted">
            <Church size={48} className="mx-auto mb-4 opacity-20" />
            <p className="font-display">No churches found matching your filters.</p>
          </div>
        ) : (
          <div className="bg-surface-raised rounded-brand-xl border border-line shadow-[var(--ds-sh-sm)] overflow-hidden">
            {filteredChurches.map((church) => (
              <div
                key={church.id}
                className="flex items-center gap-3 px-3.5 py-3 border-t border-line first:border-t-0"
              >
                <div className="w-[38px] h-[38px] rounded-[10px] bg-[var(--surface-gold)] text-gold flex items-center justify-center shrink-0">
                  <Church size={17} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-semibold text-strong truncate">{church.name}</div>
                  <div className="text-[11.5px] text-faint truncate">
                    {[church.city && `${church.city}${church.country ? `, ${church.country}` : ''}`, church.pastorName].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => setEditingChurch(church)}
                    className="p-1.5 rounded-lg text-faint hover:bg-surface-sunken transition-colors"
                    title="Edit"
                  >
                    <Edit2 size={15} />
                  </button>
                  <button
                    onClick={() => setDeleteConfirmId(church.id)}
                    className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Spreadsheet / Table */}
      <div className="hidden lg:block bg-surface-raised rounded-2xl shadow-xs border border-line overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className="px-4 py-3.5 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Name</th>
                <th className="px-4 py-3.5 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">City</th>
                <th className="px-4 py-3.5 text-[11px] font-semibold text-gold uppercase tracking-[0.12em]">Pastor</th>
                <th className="px-4 py-3.5 text-[11px] font-semibold text-gold uppercase tracking-[0.12em] text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center">
                    <div className="flex justify-center">
                      <div className="w-8 h-8 border-4 border-[color-mix(in_srgb,var(--brand-color)_30%,transparent)] border-t-gold rounded-full animate-spin"></div>
                    </div>
                  </td>
                </tr>
              ) : filteredChurches.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-muted">
                    <Church size={48} className="mx-auto mb-4 opacity-20" />
                    <p className="font-display">No churches found matching your filters.</p>
                  </td>
                </tr>
              ) : (
                filteredChurches.map((church) => (
                  <tr key={church.id} className="border-b border-line hover:bg-[color-mix(in_srgb,var(--surface-sunken)_60%,transparent)] transition-colors">
                    <td className="p-4">
                      <div className="font-semibold text-strong">{church.name}</div>
                      <div className="text-xs text-muted">{church.denomination}</div>
                    </td>
                    <td className="p-4 text-body">
                      {church.city}{church.country ? `, ${church.country}` : ''}
                    </td>
                    <td className="p-4 text-body">{church.pastorName}</td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setEditingChurch(church)}
                          className="p-2 text-sky-600 hover:bg-sky-100 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(church.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-surface-raised rounded-2xl p-6 max-w-md w-full shadow-xl">
            <h3 className="text-xl font-bold text-strong mb-2 font-display">Delete Church</h3>
            <p className="text-muted mb-6">
              Are you sure you want to delete this church? This action cannot be undone.
              {isMinistry && churches.find(c => c.id === deleteConfirmId)?.stripeSubscriptionItemId && (
                <span className="block text-sm text-field-700 mt-1">
                  This will automatically remove the $10/mo charge from your subscription.
                </span>
              )}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 text-muted hover:bg-surface-sunken rounded-xl transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirmId)}
                className="px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter Popup Modal */}
      {activeFilterPopup && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface-raised rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold text-strong mb-4 capitalize font-display">
              Filter by {activeFilterPopup}
            </h3>
            <input
              type="text"
              autoFocus
              placeholder={`Enter ${activeFilterPopup}...`}
              value={tempFilterValue}
              onChange={(e) => setTempFilterValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyFilter();
              }}
              className="w-full px-4 py-2 rounded-lg border border-line bg-surface-sunken text-strong focus:outline-hidden focus:border-gold mb-6"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setTempFilterValue('');
                  applyFilter('');
                }}
                className="px-4 py-2 text-sm font-medium text-muted hover:text-strong"
              >
                Clear
              </button>
              <button
                onClick={() => setActiveFilterPopup(null)}
                className="px-4 py-2 text-sm font-medium text-muted hover:text-strong"
              >
                Cancel
              </button>
              <button
                onClick={() => applyFilter(tempFilterValue)}
                className="px-4 py-2 text-sm font-medium bg-gold text-white rounded-lg hover:bg-[color-mix(in_srgb,var(--brand-color)_85%,black)]"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminChurches;
