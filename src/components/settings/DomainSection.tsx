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
    <div>
      {/* Web Address */}
      <div className="bg-white rounded-brand-lg border border-stone-200 shadow-[var(--ds-sh-sm)] p-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold mb-2">Web Address</h3>
        <p className="text-sm text-warm-brown mb-4">
          Manage your ministry&apos;s web address. Your subdomain is <strong className="text-earth">{subdomain}.theharvest.app</strong>.
        </p>

        {/* Subdomain (read-only) */}
        <label className="block text-sm font-medium text-earth mb-2">Subdomain</label>
        <div className="flex items-center">
          <input
            type="text"
            value={subdomain}
            disabled
            className="w-full px-4 py-2.5 border border-stone-200 rounded-l-brand text-sm bg-stone-100 text-warm-brown cursor-not-allowed"
          />
          <span className="px-4 py-2.5 border border-l-0 border-stone-200 rounded-r-brand text-sm text-[color:var(--text-faint)] bg-stone-200 whitespace-nowrap">.theharvest.app</span>
        </div>
        <p className="text-xs text-[color:var(--text-faint)] mt-2">
          To change your subdomain, please contact support. Subdomain changes require migration and may affect your existing links.
        </p>

        {/* Custom Domain (Ministry only) */}
        {hasCustomDomain ? (
          <div className="mt-5 pt-5 border-t border-stone-200">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-earth">Custom domain</label>
              {statusBadge()}
            </div>
            <div className="flex items-center gap-3">
              <Globe size={18} className="text-[color:var(--text-faint)] shrink-0" />
              <div className="flex-1">
                <input
                  type="text"
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  placeholder="e.g. ministry.yourchurch.org"
                  className="w-full px-4 py-2.5 border border-stone-200 rounded-brand text-sm text-earth focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_35%,transparent)] focus:border-transparent"
                />
                <p className="text-xs text-[color:var(--text-faint)] mt-1.5">
                  Enter your custom domain, then point a CNAME record at <span className="font-mono">theharvest.app</span>.
                </p>
              </div>
            </div>

            {/* DNS Instructions */}
            <div className="mt-4 pt-4 border-t border-stone-200">
              <p className="text-sm font-medium text-earth mb-3">DNS Configuration</p>
              <div className="bg-stone-100 rounded-brand p-4">
                <p className="text-xs text-warm-brown mb-2">Add the following CNAME record to your DNS provider:</p>
                <div className="font-mono text-sm bg-white rounded-lg p-3 border border-stone-200">
                  <div className="flex justify-between">
                    <span className="text-[color:var(--text-faint)]">Type:</span>
                    <span className="text-earth">CNAME</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[color:var(--text-faint)]">Name:</span>
                    <span className="text-earth">{customDomain || 'your-domain.com'}</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[color:var(--text-faint)]">Value:</span>
                    <span className="text-earth">theharvest.app</span>
                  </div>
                </div>
                <p className="text-xs text-[color:var(--text-faint)] mt-2">
                  DNS changes can take up to 48 hours to propagate. Use &quot;Check Status&quot; to refresh verification.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap mt-4">
              <button
                onClick={handleSave}
                disabled={domainSaving}
                className="px-5 py-2.5 bg-gold text-white rounded-brand text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {domainSaving ? 'Saving...' : 'Save Domain'}
              </button>
              <button
                onClick={handleCheckStatus}
                disabled={checking || !customDomain.trim()}
                className="px-5 py-2.5 border border-stone-200 text-earth rounded-brand text-sm font-semibold hover:bg-stone-100 transition-colors disabled:opacity-50"
              >
                {checking ? 'Checking...' : 'Check Status'}
              </button>
              {domainSaved && (
                <span className="text-sm text-green-600 font-medium">✓ Domain settings saved</span>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-5 pt-5 border-t border-stone-200">
            <label className="block text-sm font-medium text-earth mb-2">Custom domain</label>
            <p className="text-sm text-warm-brown mb-4">
              Custom domains are available on the <strong>Ministry</strong> plan.
              Upgrade to use your own domain name.
            </p>
            <button
              onClick={onUpgrade}
              className="px-5 py-2.5 bg-gold text-white rounded-brand text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              Upgrade to Unlock
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default DomainSection;
