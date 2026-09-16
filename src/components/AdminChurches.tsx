"use client";
import React, { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import { collection, query, where, onSnapshot, doc, deleteDoc, getDoc, limit } from 'firebase/firestore';
import { Church, Search, Filter, Edit2, Trash2, CheckCircle, Clock } from 'lucide-react';
import ChurchEnrollment from './ChurchEnrollment';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope } from '../utils/tenant-scope';
import { getPlanFeatures, UNLIMITED_CAP } from '../utils/plan-features';
import { useTenant } from '@/contexts/TenantContext';
import { AdminPageHeader, AdminPrimaryButton } from './admin/AdminUI';
import { FORM_MEASURE } from './layout/form-layout';

/**
 * THE-370 — A CAMPUS COSTS NOTHING, SO NOTHING HERE NAMES A PRICE.
 *
 * ─── What this screen used to do, and why none of it survives ────────────────
 *
 * THE-191 turned the cap into an OFFER: at `maxChurches`, "Add church" opened a
 * panel that read "Every Harvest plan includes 1 campus — Ministry included. A
 * second campus is an add-on", quoted the live Campus price from
 * `/api/dodo/addons`, and sent the admin to billing to buy one. Every sentence
 * of that was true when it shipped and none of it is true now: the founder
 * retired the campus add-on ("remove the campus addon. let them add as many as
 * they want"), Dodo has the two Campus products DETACHED from all nine plan
 * products, and `maxChurches` is `UNLIMITED_CAP` on all three paid tiers. So the
 * offer is gone rather than reworded — there is no product to send anyone to.
 *
 * ⚠️ THE CAP STILL EXISTS, ON EXACTLY ONE TIER. Forever Free is `maxChurches: 0`
 * and stays there: the founder's sentence was about the ADD-ON, and free has
 * never had campuses at all. So `atLimit` is reachable only on free, and what it
 * opens is an UPGRADE prompt — campuses are a paid-plan capability — and not a
 * purchase. It names no figure, because the thing it is pointing at is a plan,
 * and plan prices live on the billing screen it opens.
 *
 * ─── 🔴 AND THE DORMANT $10/mo PER-CHURCH BILLING IS DELETED ─────────────────
 *
 * This file carried a second, older money path: `ENTERPRISE_PRICE_PER_CHURCH =
 * 10`, a header subtitle printing "N churches · $X/mo", a confirm dialog reading
 * "Confirm & Add Church ($10/mo)", and calls to /api/churches/add-billing and
 * /api/churches/remove-billing. All of it hung off `isMinistry = maxChurches ===
 * -1`, which was FALSE ON EVERY TIER — so none of it had rendered since the
 * `ultra` tier was deleted.
 *
 * 🔴 UNCAPPING `maxChurches` WOULD HAVE SWITCHED ALL OF IT BACK ON, and every
 * word of it is false: the server half refuses unconditionally (add-billing
 * returns `skipped: 'not-ministry'` because it tests `plan !== 'ultra'` and no
 * tenant can be `ultra`), so the screen would have promised a church a $10/mo
 * charge, told it the charge had been applied, and no charge would exist. That
 * is not a latent bug this ticket happened to pass — it is the direct
 * consequence of the cell this ticket changes, so it is removed here.
 *
 * The two API routes are left exactly as they are. They are unreachable from
 * this screen now, they already decline, and deleting a money-path route is a
 * larger change than this ticket's mandate. Nothing renders them.
 */

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
  // THE-370 — the upgrade prompt shown at the cap. Reachable on Forever Free
  // only, which is the one tier that still has a campus cap.
  const [showCampusOffer, setShowCampusOffer] = useState(false);

  // 🔴 THE UNKNOWN/LOADING PLAN STILL FALLS BACK TO 'plus', AND STILL FAILS
  // CLOSED — unchanged by THE-370. `plus` is the cheapest PAID tier, so falling
  // back to it grants the least of anything a payer gets. What it grants for
  // campuses is now UNLIMITED rather than 1, and that is the same direction as
  // before, not a loosening: the fallback's job is to avoid showing a paying
  // church a refusal it did not earn while its plan loads, and campuses are no
  // longer a thing any paying church can be refused. The cap that still bites —
  // free's 0 — is never reached by this fallback, because an unknown plan is not
  // free.
  const maxChurches = getPlanFeatures(tenantPlan ?? 'plus').maxChurches;

  // 🔴 UNLIMITED IS -1, SO IT IS TESTED BEFORE THE COMPARISON. `length >= -1` is
  // true forever, which would turn "unlimited" into "at the limit immediately" —
  // the exact sentinel-unaware `>=` failure `getEffectiveFeatures` keeps
  // `unlimitedContacts` a separate boolean to avoid. Reachable on free (0) only.
  const atLimit = maxChurches !== UNLIMITED_CAP && churches.length >= maxChurches;

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
      await deleteDoc(doc(db, 'churches', id));
      setDeleteConfirmId(null);
    } catch (error) {
      try { handleFirestoreError(error, OperationType.DELETE, `churches/${id}`); } catch (e) { console.error(e); }
    }
  };

  const handleChurchSaved = async () => {
    setIsAdding(false);
    setEditingChurch(null);
  };

  /**
   * At the cap, explain — do not sell.
   *
   * 🔴 THE ONLY TIER THAT REACHES THIS IS FOREVER FREE. Every paid tier is
   * `UNLIMITED_CAP`, so `atLimit` is false for anyone paying and this branch is
   * unreachable for them. What a free tenant needs is the PLAN, not a product:
   * there is no campus add-on to price any more, so nothing is fetched and no
   * figure is named. `onOpenBilling` opens the screen that does carry prices.
   */
  const handleAddChurchClick = () => {
    if (loading) return; // church count not known yet — can't decide the cap
    if (atLimit) {
      setShowCampusOffer(true);
      return;
    }
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
        /* 🔴 NO SUBTITLE. It used to print a per-church running total in dollars,
           behind `isMinistry` — see the module note on the deleted $10/mo path.
           Campuses are free on every plan that has them, so there is no figure
           this header could honestly carry.

           🔴 NOT `disabled` at the cap. On free the button opens the upgrade
           prompt; disabling it is what made the refusal silent on touch and its
           own handler unreachable. */
        action={<AdminPrimaryButton onClick={() => handleAddChurchClick()} className="min-h-[44px] sm:min-h-0" icon={<span className="text-[15px] leading-none">+</span>}>Add church</AdminPrimaryButton>}
      />

      {/* THE-370 — at the cap: which plans have campuses. Free only; no price. */}
      {showCampusOffer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-surface-raised rounded-2xl p-6 max-w-md w-full shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-[var(--surface-gold)] flex items-center justify-center">
                <Church size={20} className="text-gold" />
              </div>
              <h3 className="text-xl font-bold text-strong font-display">Campuses are on the paid plans</h3>
            </div>
            <p className="text-muted mb-6">
              {/* 🔴 NO FIGURE, AND NO ADD-ON. The old copy read "Every Harvest plan
                  includes 1 campus — Ministry included. A second campus is an
                  add-on", and quoted a live Campus price beneath it. Both are
                  false since THE-370: the add-on is retired and every paid plan
                  carries as many campuses as a church needs. What a free tenant
                  is missing is the PLAN, so that is what this names. */}
              Your Forever Free plan does not include campuses. Every paid plan does — as many
              as you need, with no per-campus charge.
            </p>
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
                  See the plans
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
