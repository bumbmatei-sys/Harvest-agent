"use client";
import React, { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import { collection, onSnapshot, limit } from 'firebase/firestore';
import { Building2, Plus, Search, Edit2, Trash2, Pause, Play, X, Check } from 'lucide-react';
import { Tenant, TenantPlan, TenantStatus } from '../types/tenant.types';
import { createTenant, updateTenant, isSubdomainAvailable } from '../utils/tenant.utils';
import { OperationType, handleFirestoreError } from '../utils/firestore-errors';
import { useAdminHeader, HeaderActionButton } from './AdminScreenHeader';

const PLAN_LABELS: Record<TenantPlan, string> = {
  plus: 'Plus',
  pro: 'Pro',
  max: 'Max',
  ultra: 'Ultra',
};

const PLAN_COLORS: Record<TenantPlan, string> = {
  plus: 'bg-blue-100 text-blue-700',
  pro: 'bg-purple-100 text-purple-700',
  max: 'bg-amber-100 text-amber-700',
  ultra: 'bg-amber-100 text-amber-700',
};

const STATUS_COLORS: Record<TenantStatus, string> = {
  active: 'bg-green-100 text-green-700',
  suspended: 'bg-red-100 text-red-700',
  pending: 'bg-yellow-100 text-yellow-700',
};

interface FormData {
  name: string;
  subdomain: string;
  plan: TenantPlan;
  adminEmail: string;
  description: string;
  customDomain: string;
}

const EMPTY_FORM: FormData = {
  name: '',
  subdomain: '',
  plan: 'plus',
  adminEmail: '',
  description: '',
  customDomain: '',
};

const AdminTenants: React.FC = () => {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const { setHeaderAction } = useAdminHeader();

  useEffect(() => {
    const q = collection(db, 'tenants');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: Tenant[] = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Tenant));
      setTenants(data);
      setLoading(false);
    }, (err) => {
      try { handleFirestoreError(err, OperationType.GET, 'tenants'); } catch (e) { console.error(e); }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const filtered = tenants.filter(t =>
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.subdomain.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setError('');
    setShowForm(true);
  };

  useEffect(() => {
    setHeaderAction(<HeaderActionButton label="Add Tenant" onClick={openCreate} />);
    return () => setHeaderAction(null);
  }, [setHeaderAction]);

  const openEdit = (tenant: Tenant) => {
    setForm({
      name: tenant.name,
      subdomain: tenant.subdomain,
      plan: tenant.plan,
      adminEmail: tenant.adminEmails?.[0] || '',
      description: tenant.config?.description || '',
      customDomain: tenant.config?.customDomain || '',
    });
    setEditingId(tenant.id);
    setError('');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required.'); return; }
    if (!editingId && !form.subdomain.trim()) { setError('Subdomain is required.'); return; }
    if (!form.adminEmail.trim()) { setError('Admin email is required.'); return; }

    setSaving(true);
    setError('');

    try {
      if (editingId) {
        await updateTenant(editingId, {
          name: form.name,
          plan: form.plan,
          config: { description: form.description, ...(form.customDomain ? { customDomain: form.customDomain } : {}) },
          adminEmails: [form.adminEmail],
        });
      } else {
        const sub = form.subdomain.toLowerCase().replace(/[^a-z0-9-]/g, '');
        const available = await isSubdomainAvailable(sub);
        if (!available) { setError('Subdomain is already taken.'); setSaving(false); return; }

        await createTenant({
          name: form.name,
          subdomain: sub,
          plan: form.plan,
          adminEmails: [form.adminEmail],
          config: { description: form.description, ...(form.customDomain ? { customDomain: form.customDomain } : {}) },
        });
      }
      setShowForm(false);
    } catch (err: any) {
      setError(err.message || 'Failed to save tenant.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (tenant: Tenant) => {
    const newStatus: TenantStatus = tenant.status === 'active' ? 'suspended' : 'active';
    try {
      await updateTenant(tenant.id, { status: newStatus });
    } catch (err: any) {
      console.error('Failed to toggle status:', err);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleteError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) { setDeleteError('Not authenticated'); return; }
      const res = await fetch(`/api/tenants/delete?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setDeleteError(data.error || 'Delete failed');
        return;
      }
      setDeleteConfirmId(null);
    } catch (err: any) {
      setDeleteError(err.message || 'Delete failed');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-gold border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search tenants..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-gold focus:border-gold outline-none transition-all"
        />
      </div>

      {/* Tenant List */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
          <Building2 size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500 font-medium">No tenants yet</p>
          <p className="text-gray-400 text-sm mt-1">Create your first church tenant to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map(tenant => (
            <div key={tenant.id} className="bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-md transition-shadow">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-lg font-bold text-gray-900 truncate">{tenant.name}</h3>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${PLAN_COLORS[tenant.plan]}`}>
                      {PLAN_LABELS[tenant.plan]}
                    </span>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[tenant.status]}`}>
                      {tenant.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">
                    <span className="font-mono text-gray-600">{tenant.subdomain}</span>.theharvest.app
                  </p>
                  {tenant.config?.customDomain && (
                    <p className="text-sm text-blue-600 font-medium mt-0.5">
                      {tenant.config.customDomain}
                    </p>
                  )}
                  {tenant.adminEmails?.length > 0 && (
                    <p className="text-xs text-gray-400 mt-1">Admin: {tenant.adminEmails[0]}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleToggleStatus(tenant)}
                    className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                    title={tenant.status === 'active' ? 'Suspend' : 'Activate'}
                  >
                    {tenant.status === 'active' ? (
                      <Pause size={16} className="text-gray-500" />
                    ) : (
                      <Play size={16} className="text-green-500" />
                    )}
                  </button>
                  <button
                    onClick={() => openEdit(tenant)}
                    className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                    title="Edit"
                  >
                    <Edit2 size={16} className="text-gray-500" />
                  </button>
                  {deleteConfirmId === tenant.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDelete(tenant.id)}
                        className="p-2 rounded-lg bg-red-50 hover:bg-red-100 transition-colors"
                        title="Confirm delete"
                      >
                        <Check size={16} className="text-red-600" />
                      </button>
                      <button
                        onClick={() => { setDeleteConfirmId(null); setDeleteError(''); }}
                        className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                        title="Cancel"
                      >
                        <X size={16} className="text-gray-500" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirmId(tenant.id)}
                      className="p-2 rounded-lg hover:bg-red-50 transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={16} className="text-gray-400 hover:text-red-500" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete error banner */}
      {deleteError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
          <span>Delete failed: {deleteError}</span>
          <button onClick={() => setDeleteError('')} className="text-red-400 hover:text-red-600">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-xl font-bold text-gray-900">
                {editingId ? 'Edit Tenant' : 'New Tenant'}
              </h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {error && (
                <div className="p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm rounded">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Church / Ministry Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-gold focus:border-gold outline-none"
                  placeholder="Grace Community Church"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Subdomain</label>
                <div className="flex items-center gap-0">
                  <input
                    type="text"
                    value={form.subdomain}
                    onChange={e => setForm({ ...form, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                    disabled={!!editingId}
                    className={`flex-1 px-4 py-2.5 border border-gray-200 rounded-l-xl text-sm focus:ring-2 focus:ring-gold focus:border-gold outline-none font-mono ${editingId ? 'bg-gray-50 text-gray-400' : ''}`}
                    placeholder="gracechurch"
                  />
                  <span className="px-3 py-2.5 bg-gray-50 border border-l-0 border-gray-200 rounded-r-xl text-sm text-gray-500">
                    .theharvest.app
                  </span>
                </div>
                {editingId && <p className="text-xs text-gray-400 mt-1">Subdomain cannot be changed after creation.</p>}
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Plan</label>
                <select
                  value={form.plan}
                  onChange={e => setForm({ ...form, plan: e.target.value as TenantPlan })}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-gold focus:border-gold outline-none bg-white"
                >
                  <option value="plus">Individual — $59/mo</option>
                  <option value="pro">Small Team — $119/mo</option>
                  <option value="max">Community — $239/mo</option>
                  <option value="ultra">Ministry — $479/mo</option>
                </select>
              </div>

              {(form.plan === 'max' || form.plan === 'ultra') && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Custom Domain</label>
                  <input
                    type="text"
                    value={form.customDomain}
                    onChange={e => setForm({ ...form, customDomain: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-gold focus:border-gold outline-none"
                    placeholder="yourchurch.com"
                  />
                  <p className="text-xs text-gray-400 mt-1">The church&apos;s own domain. DNS must point to Vercel.</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Admin Email</label>
                <input
                  type="email"
                  value={form.adminEmail}
                  onChange={e => setForm({ ...form, adminEmail: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-gold focus:border-gold outline-none"
                  placeholder="pastor@church.com"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Description (optional)</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-gold focus:border-gold outline-none resize-none"
                  rows={3}
                  placeholder="A brief description of the ministry..."
                />
              </div>
            </div>

            <div className="p-6 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2.5 bg-gold text-white font-semibold rounded-xl hover:bg-yellow-600 transition-colors disabled:opacity-50 shadow-sm"
              >
                {saving ? 'Saving...' : (editingId ? 'Save Changes' : 'Create Tenant')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminTenants;
