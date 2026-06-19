"use client";
import React, { useState, useEffect } from 'react';
import { Globe } from 'lucide-react';

interface DomainSectionProps {
  hasCustomDomain: boolean;
  onUpgrade?: () => void;
}

export const DomainSection: React.FC<DomainSectionProps> = ({ hasCustomDomain, onUpgrade }) => {
  const [subdomain, setSubdomain] = useState('');
  const [customDomain, setCustomDomain] = useState('');
  const [domainSaving, setDomainSaving] = useState(false);
  const [domainSaved, setDomainSaved] = useState(false);
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

  return (
    <div className="space-y-6">
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

      {/* Custom Domain (Ultra/Enterprise only) */}
      {hasCustomDomain ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Custom Domain</h3>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center">
              <Globe size={24} className="text-purple-600" />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-2">Your Custom Domain</label>
              <input
                type="text"
                value={customDomain}
                onChange={(e) => setCustomDomain(e.target.value)}
                placeholder="e.g. ministry.yourchurch.org"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#d4a017] focus:border-transparent"
              />
              <p className="text-xs text-gray-400 mt-1">
                Enter your custom domain. You&apos;ll need to add a CNAME record pointing to <span className="font-mono">theharvest.app</span>.
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
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Custom Domain</h3>
          <p className="text-gray-600 text-sm mb-4">
            Custom domains are available on <strong>Max</strong>, <strong>Ultra</strong>, and <strong>Enterprise</strong> plans.
            Upgrade to use your own domain name.
          </p>
          <button
            onClick={onUpgrade}
            className="px-4 py-2 bg-[#d4a017] text-white rounded-xl text-sm font-semibold hover:bg-[#b8941a] transition-colors"
          >
            Upgrade to Unlock
          </button>
        </div>
      )}

      {/* Save Button (only for custom domain) */}
      {hasCustomDomain && (
        <div className="flex items-center gap-3">
          <button
            onClick={async () => {
              setDomainSaving(true);
              setDomainSaved(false);
              try {
                const { auth, db } = await import('../../firebase');
                const { doc, getDoc, updateDoc, setDoc, deleteDoc } = await import('firebase/firestore');
                if (auth.currentUser) {
                  const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
                  if (userDoc.exists()) {
                    const tenantId = userDoc.data().tenantId;
                    if (tenantId) {
                      // Normalize domain: lowercase, strip protocol, trailing slashes, www prefix
                      const normalizedDomain = customDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');

                      // Get old domain to clean up domains collection
                      const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));
                      const oldDomain = tenantDoc.exists() ? tenantDoc.data().config?.customDomain : null;

                      await updateDoc(doc(db, 'tenants', tenantId), {
                        'config.customDomain': normalizedDomain || null,
                        updatedAt: new Date().toISOString(),
                      });

                      // Write to domains collection for fast API lookup
                      if (normalizedDomain) {
                        await setDoc(doc(db, 'domains', normalizedDomain), { tenantId });
                      }

                      // Delete old domain entry if domain changed
                      if (oldDomain && oldDomain !== normalizedDomain) {
                        await deleteDoc(doc(db, 'domains', oldDomain)).catch(() => {});
                      }

                      setDomainSaved(true);
                      setTimeout(() => setDomainSaved(false), 3000);
                    }
                  }
                }
              } catch (e) {
                console.error('Failed to save domain settings:', e);
                alert('Failed to save domain settings. Please try again.');
              } finally {
                setDomainSaving(false);
              }
            }}
            disabled={domainSaving}
            className="px-6 py-2.5 bg-[#d4a017] text-white rounded-xl text-sm font-semibold hover:bg-[#b8941a] transition-colors disabled:opacity-50"
          >
            {domainSaving ? 'Saving...' : 'Save Domain Settings'}
          </button>
          {domainSaved && (
            <span className="text-sm text-green-600 font-medium">✓ Domain settings saved successfully</span>
          )}
        </div>
      )}
    </div>
  );
};

export default DomainSection;
