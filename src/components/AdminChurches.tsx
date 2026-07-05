"use client";
import React, { useState, useEffect, useRef } from 'react';
import { db, auth } from '../firebase';
import { collection, query, where, onSnapshot, doc, deleteDoc, getDoc, addDoc, updateDoc, orderBy, limit } from 'firebase/firestore';
import { Church, Search, Filter, Edit2, Trash2, Plus, CheckCircle, Clock, DollarSign, Megaphone, Save, X } from 'lucide-react';
import ChurchEnrollment from './ChurchEnrollment';
import { authFetch } from '../utils/auth-fetch';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope } from '../utils/tenant-scope';
import { sendPushNotification } from '../utils/send-notification';
import { getPlanFeatures } from '../utils/plan-features';
import { useTenant } from '@/contexts/TenantContext';
import { useAdminHeader, HeaderActionButton } from './AdminScreenHeader';

/** Every plan includes 1 church free (the tenant's own). */
const INCLUDED_CHURCHES = 1;


const AdminChurches: React.FC = () => {
  const { tenantId, tenantPlan } = useTenant();
  const { setHeaderAction } = useAdminHeader();
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
  // Whether the church being added right now is a paid one. Captured at add-time
  // because `churches` can update via onSnapshot before handleChurchSaved runs.
  const willBeBilledRef = useRef(false);

  const isMinistry = tenantPlan === 'ultra';
  const ENTERPRISE_PRICE_PER_CHURCH = 10; // $10/church/mo

  // Unknown/loading plan falls back to 'plus' (maxChurches: 1) — fail closed on the cap.
  const maxChurches = getPlanFeatures(tenantPlan ?? 'plus').maxChurches;
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

  const handleAddChurchClick = () => {
    if (loading) return; // church count not known yet — can't decide cap/billing
    if (atLimit) {
      setBillingNotice(`Your plan includes ${INCLUDED_CHURCHES} church. Upgrade to Ministry to add more.`);
      setTimeout(() => setBillingNotice(null), 5000);
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

  useEffect(() => {
    setHeaderAction(
      <HeaderActionButton
        label="Add Church"
        onClick={() => handleAddChurchClick()}
        disabled={atLimit}
        title={atLimit ? `Your plan includes ${INCLUDED_CHURCHES} church. Upgrade to Ministry to add more.` : undefined}
      />
    );
    return () => setHeaderAction(null);
    // Re-register when the values handleAddChurchClick closes over change,
    // so the button never acts on a stale church count or plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setHeaderAction, atLimit, isMinistry, loading, churches.length]);

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
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-900">
            {isAdding ? 'Add Church' : 'Edit Church'}
          </h2>
          <button 
            onClick={() => { setIsAdding(false); setEditingChurch(null); }}
            className="text-gray-500 hover:text-gray-700"
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

        {/* Announcements Section — only when editing */}
        {editingChurch && (
          <AnnouncementsSection churchId={editingChurch.id} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 lg:max-w-5xl lg:mx-auto w-full">
      {isMinistry && (
        <p className="text-xs text-gray-500">
          {churches.length} church{churches.length !== 1 ? 'es' : ''} · ${Math.max(0, churches.length - INCLUDED_CHURCHES) * ENTERPRISE_PRICE_PER_CHURCH}/mo ({INCLUDED_CHURCHES} included free)
        </p>
      )}

      {/* Billing Notice */}
      {billingNotice && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 flex items-center gap-2">
          <DollarSign size={16} className="text-yellow-600" />
          <p className="text-sm text-yellow-800 font-medium">{billingNotice}</p>
        </div>
      )}

      {/* Add Church Billing Confirmation Modal */}
      {showBillingConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center">
                <DollarSign size={20} className="text-yellow-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">Adding a New Church</h3>
            </div>
            <p className="text-gray-600 mb-6">
              Each additional church added to your organization will increase your monthly plan by{' '}
              <span className="font-semibold text-gray-900">$10/mo</span>. This will be charged
              automatically to your payment method on file.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowBillingConfirm(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-xl transition-colors font-medium"
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

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gold" size={14} strokeWidth={2.5} />
          <input
            type="text"
            placeholder="Search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 pr-3 py-1.5 text-sm bg-white border border-gold rounded-full focus:outline-none text-gray-900 font-medium placeholder:text-gray-500 w-32 focus:w-48 transition-all duration-300"
          />
        </div>
        
        <button
          onClick={() => openFilterPopup('city')}
          className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${cityFilter ? 'bg-gold text-white border-gold' : 'bg-white text-gray-700 border-gray-300 hover:border-gold'}`}
        >
          {cityFilter ? `City: ${cityFilter}` : 'City'}
        </button>

        <button
          onClick={() => openFilterPopup('pastor')}
          className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${pastorFilter ? 'bg-gold text-white border-gold' : 'bg-white text-gray-700 border-gray-300 hover:border-gold'}`}
        >
          {pastorFilter ? `Pastor: ${pastorFilter}` : 'Pastor'}
        </button>

        <button
          onClick={() => openFilterPopup('country')}
          className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${countryFilter ? 'bg-gold text-white border-gold' : 'bg-white text-gray-700 border-gray-300 hover:border-gold'}`}
        >
          {countryFilter ? `Country: ${countryFilter}` : 'Country'}
        </button>
      </div>

      {/* Spreadsheet / Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="p-4 text-sm font-semibold text-gray-600">Name</th>
                <th className="p-4 text-sm font-semibold text-gray-600">City</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Pastor</th>
                <th className="p-4 text-sm font-semibold text-gray-600 text-right">Actions</th>
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
                  <td colSpan={4} className="p-8 text-center text-gray-500">
                    <Church size={48} className="mx-auto mb-4 opacity-20" />
                    <p>No churches found matching your filters.</p>
                  </td>
                </tr>
              ) : (
                filteredChurches.map((church) => (
                  <tr key={church.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="p-4">
                      <div className="font-medium text-gray-900">{church.name}</div>
                      <div className="text-xs text-gray-500">{church.denomination}</div>
                    </td>
                    <td className="p-4 text-gray-700">
                      {church.city}{church.country ? `, ${church.country}` : ''}
                    </td>
                    <td className="p-4 text-gray-700">{church.pastorName}</td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setEditingChurch(church)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Delete Church</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete this church? This action cannot be undone.
              {isMinistry && churches.find(c => c.id === deleteConfirmId)?.stripeSubscriptionItemId && (
                <span className="block text-sm text-green-700 mt-1">
                  This will automatically remove the $10/mo charge from your subscription.
                </span>
              )}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-xl transition-colors font-medium"
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
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4 capitalize">
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
              className="w-full px-4 py-2 rounded-lg border border-gray-300 bg-gray-50 text-gray-900 focus:outline-none focus:border-gold mb-6"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setTempFilterValue('');
                  applyFilter('');
                }}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                Clear
              </button>
              <button
                onClick={() => setActiveFilterPopup(null)}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
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

// ─── Announcements Section (inline component) ────────────────────────

const AnnouncementsSection: React.FC<{ churchId: string }> = ({ churchId }) => {
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'churches', churchId, 'announcements'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setAnnouncements(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, (error) => {
      console.error('Announcements listener error:', error);
      setLoading(false);
    });
    return () => unsub();
  }, [churchId]);

  const handleCreate = async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    setSaving(true);
    try {
      const tenantId = await getTenantScope();
      await addDoc(collection(db, 'churches', churchId, 'announcements'), {
        title: newTitle.trim(),
        content: newContent.trim(),
        tenantId: tenantId || null,
        createdAt: new Date().toISOString(),
        createdBy: auth.currentUser?.uid || null,
      });
      // Fire-and-forget push notification
      sendPushNotification('New Announcement', newTitle.trim());
      setNewTitle('');
      setNewContent('');
    } catch (error) {
      console.error('Failed to create announcement:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (id: string) => {
    if (!editTitle.trim() || !editContent.trim()) return;
    try {
      await updateDoc(doc(db, 'churches', churchId, 'announcements', id), {
        title: editTitle.trim(),
        content: editContent.trim(),
        updatedAt: new Date().toISOString(),
      });
      setEditingId(null);
    } catch (error) {
      console.error('Failed to update announcement:', error);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'churches', churchId, 'announcements', id));
    } catch (error) {
      console.error('Failed to delete announcement:', error);
    }
  };

  return (
    <div className="border-t border-gray-100 p-4">
      <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
        <Megaphone size={18} className="text-gold" />
        Announcements
      </h3>

      {/* Create Form */}
      <div className="bg-gray-50 rounded-xl p-4 mb-4">
        <input
          type="text"
          placeholder="Announcement title"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm mb-2 focus:outline-none focus:border-gold"
        />
        <textarea
          placeholder="Announcement content"
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm mb-2 focus:outline-none focus:border-gold resize-none"
        />
        <button
          onClick={handleCreate}
          disabled={saving || !newTitle.trim() || !newContent.trim()}
          className="flex items-center gap-2 bg-gold text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[color-mix(in_srgb,var(--brand-color)_85%,black)] transition-colors disabled:opacity-50"
        >
          <Plus size={14} />
          {saving ? 'Adding...' : 'Add Announcement'}
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-4">
          <div className="w-6 h-6 border-4 border-[color-mix(in_srgb,var(--brand-color)_30%,transparent)] border-t-gold rounded-full animate-spin"></div>
        </div>
      ) : announcements.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">No announcements yet</p>
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => (
            <div key={a.id} className="bg-gray-50 rounded-xl p-4">
              {editingId === a.id ? (
                <div>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm mb-2 focus:outline-none focus:border-gold"
                  />
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm mb-2 focus:outline-none focus:border-gold resize-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleUpdate(a.id)}
                      className="flex items-center gap-1 bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700"
                    >
                      <Save size={12} /> Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="flex items-center gap-1 bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-300"
                    >
                      <X size={12} /> Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <h4 className="font-bold text-gray-900 text-sm">{a.title}</h4>
                  <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{a.content}</p>
                  {a.createdAt && (
                    <p className="text-xs text-gray-400 mt-2">
                      {new Date(a.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  )}
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => { setEditingId(a.id); setEditTitle(a.title); setEditContent(a.content); }}
                      className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(a.id)}
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
