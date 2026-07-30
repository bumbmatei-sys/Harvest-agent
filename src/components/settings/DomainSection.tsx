"use client";
import React, { useState, useEffect } from 'react';
import { Globe, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { authFetch } from '../../utils/auth-fetch';
import { getMinPlanForFeatureCell, PLAN_DISPLAY_NAMES } from '../../utils/plan-features';

interface DomainSectionProps {
  hasCustomDomain: boolean;
  onUpgrade?: () => void;
}

type DomainStatus = 'pending' | 'verified' | 'failed' | null;

/**
 * A DNS challenge record as returned by Vercel in the `verification` array of
 * /api/domains/provision (both POST and GET). `domain` is the record NAME.
 */
interface VerificationRecord {
  type?: string;
  domain?: string;
  value?: string;
  reason?: string;
}

/**
 * Plan name shown in the locked state, derived from the feature matrix rather
 * than written by hand — so it follows `customDomain` if it ever moves tier
 * again. Falls back to the top tier's name if nothing unlocks it.
 */
const CUSTOM_DOMAIN_MIN_PLAN =
  PLAN_DISPLAY_NAMES[getMinPlanForFeatureCell('customDomain') ?? 'ultra'];

export const DomainSection: React.FC<DomainSectionProps> = ({ hasCustomDomain, onUpgrade }) => {
  const [subdomain, setSubdomain] = useState('');
  const [customDomain, setCustomDomain] = useState('');
  const [status, setStatus] = useState<DomainStatus>(null);
  const [verification, setVerification] = useState<VerificationRecord[]>([]);
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
            // The DNS records the admin must add come from Vercel via the API —
            // they differ for a subdomain (CNAME) and a root domain (A).
            setVerification(Array.isArray(data.verification) ? data.verification : []);
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
        setVerification(Array.isArray(data.verification) ? data.verification : []);
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
    // ── Theming stage 2: first converted surface (the template for the rest) ──
    // Every neutral surface/border/body-text utility below is a semantic token,
    // so this section inverts with the theme. Each swap is colour-identical to
    // what it replaced, so the light theme is byte-for-byte unchanged.
    //
    // Two things are deliberately NOT converted, and both are the convention:
    //   • `text-white` on the two `bg-gold` buttons — that white is contrast
    //     against the brand accent, not a neutral. It must stay white on a gold
    //     button in either theme, so tokenising it would be the bug.
    //   • `bg-surface-chip` on the `.theharvest.app` suffix chip — a real gap, not
    //     an oversight: a stone-200 *fill* has no semantic token (stone-200 is
    //     spoken for as --border-default). Left hardcoded rather than inventing
    //     vocabulary here; flagged in the PR body for stage 3 to name.
    <div>
      {/* Web Address */}
      <div className="bg-surface-raised rounded-brand-lg border border-line shadow-[var(--ds-sh-sm)] p-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold mb-2">Web Address</h3>
        <p className="text-sm text-muted mb-4">
          Manage your ministry&apos;s web address. Your subdomain is <strong className="text-strong">{subdomain}.theharvest.app</strong>.
        </p>

        {/* Subdomain (read-only) */}
        <label className="block text-sm font-medium text-strong mb-2">Subdomain</label>
        <div className="flex items-center">
          <input
            type="text"
            value={subdomain}
            disabled
            className="w-full px-4 py-2.5 border border-line rounded-l-brand text-sm bg-surface-sunken text-muted cursor-not-allowed"
          />
          <span className="px-4 py-2.5 border border-l-0 border-line rounded-r-brand text-sm text-faint bg-surface-chip whitespace-nowrap">.theharvest.app</span>
        </div>
        <p className="text-xs text-faint mt-2">
          To change your subdomain, please contact support. Subdomain changes require migration and may affect your existing links.
        </p>

        {/* Custom Domain (Community / max+) */}
        {hasCustomDomain ? (
          <div className="mt-5 pt-5 border-t border-line">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-strong">Custom domain</label>
              {statusBadge()}
            </div>
            <div className="flex items-center gap-3">
              <Globe size={18} className="text-faint shrink-0" />
              <div className="flex-1">
                <input
                  type="text"
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  placeholder="e.g. app.church.org"
                  className="w-full px-4 py-2.5 border border-line rounded-brand text-sm text-strong focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_35%,transparent)] focus:border-transparent"
                />
                <p className="text-xs text-faint mt-1.5">
                  Use your root domain (<span className="font-mono">church.org</span>) or a subdomain
                  of it (<span className="font-mono">app.church.org</span>,{' '}
                  <span className="font-mono">give.church.org</span>). Connecting a subdomain leaves
                  your existing website on <span className="font-mono">church.org</span> exactly where
                  it is — nothing about it changes.
                </p>
              </div>
            </div>

            {/* DNS Instructions — rendered from the records the API returns, never
                hardcoded. The correct record depends on what was entered: a
                subdomain (app.church.org) verifies with a CNAME, a root domain
                (church.org) with an A record. This block used to print one fixed
                CNAME for everyone, so anyone on the other shape followed the wrong
                instruction and verification then silently never completed. */}
            <div className="mt-4 pt-4 border-t border-line">
              <p className="text-sm font-medium text-strong mb-3">DNS Configuration</p>
              <div className="bg-surface-sunken rounded-brand p-4">
                {verification.length > 0 ? (
                  <>
                    <p className="text-xs text-muted mb-2">
                      Add {verification.length === 1 ? 'this record' : 'these records'} at your DNS provider:
                    </p>
                    <div className="space-y-2">
                      {verification.map((record, i) => (
                        <div
                          key={`${record.type ?? ''}-${record.domain ?? ''}-${i}`}
                          className="font-mono text-sm bg-surface-raised rounded-lg p-3 border border-line"
                        >
                          <div className="flex justify-between gap-3">
                            <span className="text-faint shrink-0">Type:</span>
                            <span className="text-strong break-all text-right">{(record.type || '').toUpperCase()}</span>
                          </div>
                          <div className="flex justify-between gap-3 mt-1">
                            <span className="text-faint shrink-0">Name:</span>
                            <span className="text-strong break-all text-right">{record.domain}</span>
                          </div>
                          <div className="flex justify-between gap-3 mt-1">
                            <span className="text-faint shrink-0">Value:</span>
                            <span className="text-strong break-all text-right">{record.value}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted">
                    Save your domain to get the exact DNS records for your provider. They depend on
                    what you connect: a subdomain such as <span className="font-mono">app.church.org</span>{' '}
                    uses a CNAME, while a root domain such as <span className="font-mono">church.org</span>{' '}
                    uses an A record.
                  </p>
                )}
                <p className="text-xs text-faint mt-2">
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
                className="px-5 py-2.5 border border-line text-strong rounded-brand text-sm font-semibold hover:bg-surface-sunken transition-colors disabled:opacity-50"
              >
                {checking ? 'Checking...' : 'Check Status'}
              </button>
              {domainSaved && (
                <span className="text-sm text-green-600 font-medium">✓ Domain settings saved</span>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-5 pt-5 border-t border-line">
            <label className="block text-sm font-medium text-strong mb-2">Custom domain</label>
            <p className="text-sm text-muted mb-4">
              Custom domains are available on the <strong>{CUSTOM_DOMAIN_MIN_PLAN}</strong> plan and
              above. Upgrade to use your own domain name.
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
