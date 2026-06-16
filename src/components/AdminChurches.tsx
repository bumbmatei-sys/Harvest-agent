"use client";
import React, { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import { collection, query, where, onSnapshot, doc, deleteDoc, getDoc, limit } from 'firebase/firestore';
import { Church, Search, Filter, Edit2, Trash2, Plus, CheckCircle, Clock, DollarSign } from 'lucide-react';
import ChurchEnrollment from './ChurchEnrollment';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { getTenantScope } from '../utils/tenant-scope';
import { useTenant } from '@/contexts/TenantContext';



const AdminChurches: React.FC = () => {
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

  const isEnterprise = tenantPlan === 'enterprise';
  const ENTERPRISE_PRICE_PER_CHURCH = 15; // $15/church/mo

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

  const updateSubscriptionQuantity = async () => {
    if (!tenantId) return;
    try {
      await fetch('/api/stripe/update-quantity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, action: 'add' }),
      });
    } catch (err) {
      console.error('Failed to update subscription quantity:', err);
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
      await deleteDoc(doc(db, 'churches', id));
      setDeleteConfirmId(null);

      // Update subscription quantity after deletion
      if (isEnterprise) {
        await updateSubscriptionQuantity();
      }
    } catch (error) {
      try { handleFirestoreError(error, OperationType.DELETE, `churches/${id}`); } catch (e) { console.error(e); }
    }
  };

  const handleChurchSaved = async () => {
    setIsAdding(false);
    setEditingChurch(null);

    // Update subscription quantity after adding
    if (isEnterprise) {
      setBillingNotice('This adds $15/mo to your bill');
      await updateSubscriptionQuantity();
      setTimeout(() => setBillingNotice(null), 5000);
    }
  };

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
      </div>
    );
  }

  return (
    <div className="space-y-6 lg:max-w-5xl lg:mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Church List</h2>
          {isEnterprise && (
            <p className="text-xs text-gray-500 mt-1">
              {churches.length} church{churches.length !== 1 ? 'es' : ''} · ${churches.length * ENTERPRISE_PRICE_PER_CHURCH}/mo
            </p>
          )}
        </div>
        <button
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-1.5 bg-[#d4a017] text-white px-4 py-2 text-sm rounded-lg font-medium hover:bg-[#b58812] transition-colors shadow-md shadow-[#d4a017]/20"
        >
          <Plus size={16} strokeWidth={2.5} />
          Add Church
        </button>
      </div>

      {/* Billing Notice */}
      {billingNotice && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 flex items-center gap-2">
          <DollarSign size={16} className="text-yellow-600" />
          <p className="text-sm text-yellow-800 font-medium">{billingNotice}</p>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#d4a017]" size={14} strokeWidth={2.5} />
          <input
            type="text"
            placeholder="Search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 pr-3 py-1.5 text-sm bg-white border border-[#d4a017] rounded-full focus:outline-none text-gray-900 font-medium placeholder:text-gray-500 w-32 focus:w-48 transition-all duration-300"
          />
        </div>
        
        <button
          onClick={() => openFilterPopup('city')}
          className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${cityFilter ? 'bg-[#d4a017] text-white border-[#d4a017]' : 'bg-white text-gray-700 border-gray-300 hover:border-[#d4a017]'}`}
        >
          {cityFilter ? `City: ${cityFilter}` : 'City'}
        </button>

        <button
          onClick={() => openFilterPopup('pastor')}
          className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${pastorFilter ? 'bg-[#d4a017] text-white border-[#d4a017]' : 'bg-white text-gray-700 border-gray-300 hover:border-[#d4a017]'}`}
        >
          {pastorFilter ? `Pastor: ${pastorFilter}` : 'Pastor'}
        </button>

        <button
          onClick={() => openFilterPopup('country')}
          className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${countryFilter ? 'bg-[#d4a017] text-white border-[#d4a017]' : 'bg-white text-gray-700 border-gray-300 hover:border-[#d4a017]'}`}
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
                      <div className="w-8 h-8 border-4 border-[#d4a017]/30 border-t-[#d4a017] rounded-full animate-spin"></div>
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
              {isEnterprise && (
                <span className="block text-sm text-yellow-700 mt-1">
                  This will reduce your monthly bill by $15/mo.
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
              className="w-full px-4 py-2 rounded-lg border border-gray-300 bg-gray-50 text-gray-900 focus:outline-none focus:border-[#d4a017] mb-6"
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
                className="px-4 py-2 text-sm font-medium bg-[#d4a017] text-white rounded-lg hover:bg-[#b58812]"
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
