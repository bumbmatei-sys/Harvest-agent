"use client";
import React, { useState, useEffect } from 'react';
import { Globe, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { authFetch } from '../../utils/auth-fetch';

interface DomainSectionProps {
  hasCustomDomain: boolean;
  onUpgrade?: () => void;
}

type DomainStatus = 'pending' | 'verified' | 'failed' | null;

export const DomainSection: React.FC<DomainSectionProps> = ({ hasCustomDomain, onUpgrade }) => {
  const [subdomain, setSubdomain] = useState('');
  const [customDomain, setCustomDomain] = useState('');
  const [status, setStatus] = useState<DomainStatus>(null);
  const [domainSaving, setDomainSaving] = useState(false);
  const [domainSaved, setDomainSaved] = useState(false);
  const [checking, setChecking] = useState(false);
  const [domainLoaded, setDomainLoaded] = useState(false);

  // Load current domain settings from tenant doc
  const loadDomain = async () => {
    if (domainLoaded) return;
    try {
      const { auth, db } = await import('../../firebase');
      const { doc, getDoc } = await import('firebase/firestore');
      if (auth.currentUser) {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists()) {
          const tenantId = userDoc.data().tenantId;
          if (tenantId) {
            setSubdomain(tenantId);
            const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));
            if (tenantDoc.exists()) {
              const config = tenantDoc.data().config || {};
              if (config.customDomain) setCustomDomain(config.customDomain);
              if (config.customDomainStatus) {
                setStatus(config.customDomainStatus as DomainStatus);
              } else if (config.customDomainVerified != null) {
                setStatus(config.customDomainVerified ? 'verified' : 'pending');
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to load domain settings:', e);
    }
    setDomainLoaded(true);
  };

  // Lazy-load on mount
  useEffect(() => {
    loadDomain();
  }, []);

  const normalize = (d: string) =>
    d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');

  const handleSave = async () => {
    setDomainSaving(true);
    setDomainSaved(false);
    try {
      const normalizedDomain = normalize(customDomain);

      // Try Vercel provisioning first; it persists to Firestore + domains collection.
      let provisioned = false;
      if (normalizedDomain) {
        try {
          const resp = await authFetch('/api/domains/provision', {
            method: 'POST',
            body: JSON.stringify({ domain: normalizedDomain }),
          });
          if (resp.ok) {
            const data = await resp.json();
            setStatus((data.status as DomainStatus) || 'pending');
            provisioned = true;
          } else if (resp.status !== 501) {
            const data = await resp.json().catch(() => ({}));
            throw new Error(data.error || 'Failed to add domain');
          }
          // 501 = Vercel not configured; fall back to a plain Firestore write below.
        } catch (provisionErr) {
          if (provisionErr instanceof Error && provisionErr.message !== 'Failed to fetch') {
            throw provisionErr;
          }
        }
      }

      // Fallback (or domain removal): write tenant config + domains lookup directly.
      if (!provisioned) {
        const { auth, db } = await import('../../firebase');
        const { doc, getDoc, updateDoc, setDoc, deleteDoc } = await import('firebase/firestore');
        if (auth.currentUser) {
          const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
          if (userDoc.exists()) {
            const tenantId = userDoc.data().tenantId;
            if (tenantId) {
              const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));
              const oldDomain = tenantDoc.exists() ? tenantDoc.data().config?.customDomain : null;

              await updateDoc(doc(db, 'tenants', tenantId), {
                'config.customDomain': normalizedDomain || null,
                'config.customDomainStatus': normalizedDomain ? 'pending' : null,
                'config.customDomainVerified': normalizedDomain ? false : null,
                updatedAt: new Date().toISOString(),
              });

              if (normalizedDomain) {
                await setDoc(doc(db, 'domains', normalizedDomain), { tenantId });
                setStatus('pending');
              } else {
                setStatus(null);
              }
              if (oldDomain && oldDomain !== normalizedDomain) {
                await deleteDoc(doc(db, 'domains', oldDomain)).catch(() => {});
              }
            }
          }
        }
      }

      setDomainSaved(true);
      setTimeout(() => setDomainSaved(false), 3000);
    } catch (e) {
      console.error('Failed to save domain settings:', e);
      alert(e instanceof Error ? e.message : 'Failed to save domain settings. Please try again.');
    } finally {
      setDomainSaving(false);
    }
  };

  const handleCheckStatus = async () => {
    const normalizedDomain = normalize(customDomain);
    if (!normalizedDomain) return;
    setChecking(true);
    try {
      const resp = await authFetch(`/api/domains/provision?domain=${encodeURIComponent(normalizedDomain)}`);
      if (resp.ok) {
        const data = await resp.json();
        setStatus((data.status as DomainStatus) || 'pending');
      } else if (resp.status === 501) {
        alert('Domain verification is not configured on the server yet.');
      } else {
        setStatus('failed');
      }
    } catch (e) {
      console.error('Failed to check domain status:', e);
      setStatus('failed');
    } finally {
      setChecking(false);
    }
  };

  const statusBadge = () => {
    if (status === 'verified') {
      return (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-600">
          <CheckCircle2 size={16} /> Verified
        </span>
      );
    }
    if (status === 'failed') {
      return (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600">
          <XCircle size={16} /> Failed
        </span>
      );
    }
    if (status === 'pending') {
      return (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600">
          <Clock size={16} /> Pending verification
        </span>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6" style={{ paddingBottom: 120 }}>
      <p className="text-gray-600">
        Manage your ministry&apos;s web address. Your subdomain is <strong>{subdomain}.theharvest.app</strong>.
      </p>

      {/* Subdomain (read-only) */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Subdomain</h3>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center">
              <input
                type="text"
                value={subdomain}
                disabled
                className="w-full px-4 py-2.5 border border-gray-200 rounded-l-xl text-sm bg-gray-50 text-gray-600 cursor-not-allowed"
              />
              <span className="px-4 py-2.5 border border-l-0 border-gray-200 rounded-r-xl text-sm text-gray-500 bg-gray-100">.theharvest.app</span>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              To change your subdomain, please contact support. Subdomain changes require migration and may affect your existing links.
            </p>
          </div>
        </div>
      </div>

      {/* Custom Domain (Ministry only) */}
      {hasCustomDomain ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Custom Domain</h3>
            {statusBadge()}
          </div>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center shrink-0">
              <Globe size={24} className="text-purple-600" />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-2">Your Custom Domain</label>
              <input
                type="text"
                value={customDomain}
                onChange={(e) => setCustomDomain(e.target.value)}
                placeholder="e.g. ministry.yourchurch.org"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gold focus:border-transparent"
              />
              <p className="text-xs text-gray-400 mt-1">
                Enter your custom domain, then point a CNAME record at <span className="font-mono">theharvest.app</span>.
              </p>
            </div>
          </div>

          {/* DNS Instructions */}
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-sm font-medium text-gray-700 mb-3">DNS Configuration</p>
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs text-gray-600 mb-2">Add the following CNAME record to your DNS provider:</p>
              <div className="font-mono text-sm bg-white rounded-lg p-3 border border-gray-200">
                <div className="flex justify-between">
                  <span className="text-gray-500">Type:</span>
                  <span className="text-gray-900">CNAME</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-gray-500">Name:</span>
                  <span className="text-gray-900">{customDomain || 'your-domain.com'}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-gray-500">Value:</span>
                  <span className="text-gray-900">theharvest.app</span>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                DNS changes can take up to 48 hours to propagate. Use &quot;Check Status&quot; to refresh verification.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Custom Domain</h3>
          <p className="text-gray-600 text-sm mb-4">
            Custom domains are available on the <strong>Ministry</strong> plan.
            Upgrade to use your own domain name.
          </p>
          <button
            onClick={onUpgrade}
            className="px-4 py-2 bg-gold text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Upgrade to Unlock
          </button>
        </div>
      )}

      {/* Save / Verify buttons (only for custom domain) */}
      {hasCustomDomain && (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleSave}
            disabled={domainSaving}
            className="px-6 py-2.5 bg-gold text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {domainSaving ? 'Saving...' : 'Save Domain'}
          </button>
          <button
            onClick={handleCheckStatus}
            disabled={checking || !customDomain.trim()}
            className="px-6 py-2.5 border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {checking ? 'Checking...' : 'Check Status'}
          </button>
          {domainSaved && (
            <span className="text-sm text-green-600 font-medium">✓ Domain settings saved</span>
          )}
        </div>
      )}
    </div>
  );
};

export default DomainSection;
