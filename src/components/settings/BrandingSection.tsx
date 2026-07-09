"use client";
import React, { useState, useEffect } from 'react';
import { ImageUpload } from '../ImageUpload';
import { PlanFeatures } from '../../utils/plan-features';
import { useTenant } from '../../contexts/TenantContext';

interface BrandingSectionProps {
  currentFeatures?: PlanFeatures;
  /** Rendered between the Ministry Name and Logo cards (e.g. the Web Address section). */
  afterName?: React.ReactNode;
}

export const BrandingSection: React.FC<BrandingSectionProps> = ({ afterName }) => {
  const { refreshBranding } = useTenant();
  const [ministryName, setMinistryName] = useState('');
  const [brandingLogo, setBrandingLogo] = useState('');
  const [brandingColor, setBrandingColor] = useState('#B8962E');
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingSaved, setBrandingSaved] = useState(false);
  const [brandingLoaded, setBrandingLoaded] = useState(false);

  // Load current branding from tenant doc
  const loadBranding = async () => {
    if (brandingLoaded) return;
    try {
      const { auth, db } = await import('../../firebase');
      const { doc, getDoc } = await import('firebase/firestore');
      if (auth.currentUser) {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists()) {
          const tenantId = userDoc.data().tenantId;
          if (tenantId) {
            const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));
            if (tenantDoc.exists()) {
              const data = tenantDoc.data();
              if (data.name) setMinistryName(data.name);
              const config = data.config || {};
              if (config.logo) setBrandingLogo(config.logo);
              if (config.primaryColor) setBrandingColor(config.primaryColor);
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to load branding:', e);
    }
    setBrandingLoaded(true);
  };

  // Lazy-load on mount
  useEffect(() => {
    loadBranding();
  }, []);

  // Live-apply the chosen color so the preview matches the rest of the app
  const handleColorChange = (color: string) => {
    setBrandingColor(color);
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--brand-color', color);
    }
  };

  const handleSave = async () => {
    setBrandingSaving(true);
    setBrandingSaved(false);
    try {
      const { auth, db } = await import('../../firebase');
      const { doc, getDoc, updateDoc } = await import('firebase/firestore');
      if (auth.currentUser) {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists()) {
          const tenantId = userDoc.data().tenantId;
          if (tenantId) {
            const updates: Record<string, unknown> = {
              'config.logo': brandingLogo || null,
              'config.primaryColor': brandingColor,
              updatedAt: new Date().toISOString(),
            };
            // Custom ministry name (white-label) — only persist when provided
            if (ministryName.trim()) {
              updates.name = ministryName.trim();
            }
            await updateDoc(doc(db, 'tenants', tenantId), updates);
            await refreshBranding();
            setBrandingSaved(true);
            setTimeout(() => setBrandingSaved(false), 3000);
          }
        }
      }
    } catch (e) {
      console.error('Failed to save branding:', e);
      alert('Failed to save branding. Please try again.');
    } finally {
      setBrandingSaving(false);
    }
  };

  return (
    <div className="space-y-6" style={{ paddingBottom: 120 }}>
      <p className="text-sm text-warm-brown">Customize your ministry&apos;s name, logo, and brand color. Changes apply across your entire app.</p>

      {/* Ministry Name */}
      <div className="bg-white rounded-brand-lg border border-stone-200 shadow-[var(--ds-sh-sm)] p-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold mb-3">Ministry Name</h3>
        <label className="block text-sm font-medium text-earth mb-2">Display Name</label>
        <input
          type="text"
          value={ministryName}
          onChange={(e) => setMinistryName(e.target.value)}
          placeholder="e.g. Grace Community Church"
          className="w-full px-4 py-2.5 border border-stone-200 rounded-brand text-sm text-earth focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_35%,transparent)] focus:border-transparent"
        />
        <p className="text-xs text-[color:var(--text-faint)] mt-1.5">Shown in your app header, login page, and emails for your white-label site.</p>
      </div>

      {afterName}

      {/* Logo Upload */}
      <div className="bg-white rounded-brand-lg border border-stone-200 shadow-[var(--ds-sh-sm)] p-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold mb-3">Logo</h3>
        <div className="flex items-start gap-6">
          <div className="w-24 h-24 rounded-brand bg-stone-100 flex items-center justify-center overflow-hidden border border-stone-200 shrink-0">
            {brandingLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brandingLogo} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              <span className="text-[color:var(--text-faint)] text-sm">No logo</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <ImageUpload
              value={brandingLogo}
              onChange={setBrandingLogo}
              placeholder="Or paste a logo URL (PNG, SVG, JPG)"
            />
          </div>
        </div>
      </div>

      {/* Brand Color */}
      <div className="bg-white rounded-brand-lg border border-stone-200 shadow-[var(--ds-sh-sm)] p-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold mb-3">Brand Color</h3>
        <div className="flex items-center gap-6">
          <div className="relative">
            <input
              type="color"
              value={brandingColor}
              onChange={(e) => handleColorChange(e.target.value)}
              className="w-16 h-16 rounded-brand cursor-pointer border-2 border-stone-200 p-1"
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-earth mb-2">Primary Color</label>
            <input
              type="text"
              value={brandingColor}
              onChange={(e) => handleColorChange(e.target.value)}
              placeholder="#B8962E"
              className="w-full px-4 py-2.5 border border-stone-200 rounded-brand text-sm font-mono text-earth focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-color)_35%,transparent)] focus:border-transparent"
            />
            <p className="text-xs text-[color:var(--text-faint)] mt-1.5">Used for buttons, accents, and highlights throughout your app</p>
          </div>
        </div>

        {/* Color Preview */}
        <div className="mt-4 pt-4 border-t border-stone-200">
          <p className="text-sm font-medium text-earth mb-3">Preview</p>
          <div className="flex items-center gap-3">
            <button
              className="px-4 py-2 rounded-brand text-white text-sm font-medium"
              style={{ backgroundColor: brandingColor }}
            >
              Sample Button
            </button>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: brandingColor }} />
              <span className="text-sm text-warm-brown">Active indicator</span>
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={brandingSaving}
          className="px-5 py-2.5 bg-gold text-white rounded-brand text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {brandingSaving ? 'Saving...' : 'Save Branding'}
        </button>
        {brandingSaved && (
          <span className="text-sm text-green-600 font-medium">✓ Branding saved successfully</span>
        )}
      </div>
    </div>
  );
};

export default BrandingSection;
