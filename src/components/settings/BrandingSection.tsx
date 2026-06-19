"use client";
import React, { useState, useEffect } from 'react';
import { ImageUpload } from '../ImageUpload';
import { PlanFeatures } from '../../utils/plan-features';

interface BrandingSectionProps {
  currentFeatures?: PlanFeatures;
}

export const BrandingSection: React.FC<BrandingSectionProps> = ({ currentFeatures }) => {
  const [brandingLogo, setBrandingLogo] = useState('');
  const [brandingColor, setBrandingColor] = useState('#D4AF37');
  const [brandingBackgroundImage, setBrandingBackgroundImage] = useState('');
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
              const config = tenantDoc.data().config || {};
              if (config.logo) setBrandingLogo(config.logo);
              if (config.primaryColor) setBrandingColor(config.primaryColor);
              if (config.backgroundImage) setBrandingBackgroundImage(config.backgroundImage);
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

  return (
    <div className="space-y-6">
      <p className="text-gray-600">Update your ministry&apos;s logo and brand color. Changes apply across your entire app.</p>

      {/* Logo Upload */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Logo</h3>
        <div className="flex items-center gap-6">
          <div className="w-24 h-24 rounded-xl bg-gray-50 flex items-center justify-center overflow-hidden border border-gray-100">
            {brandingLogo ? (
              <img src={brandingLogo} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              <span className="text-gray-300 text-sm">No logo</span>
            )}
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">Logo URL</label>
            <input
              type="url"
              value={brandingLogo}
              onChange={(e) => setBrandingLogo(e.target.value)}
              placeholder="https://example.com/logo.png"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#d4a017] focus:border-transparent"
            />
            <p className="text-xs text-gray-400 mt-1">Paste a URL to your logo image (PNG, SVG, or JPG)</p>
          </div>
        </div>
      </div>

      {/* Brand Color */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Brand Color</h3>
        <div className="flex items-center gap-6">
          <div className="relative">
            <input
              type="color"
              value={brandingColor}
              onChange={(e) => setBrandingColor(e.target.value)}
              className="w-16 h-16 rounded-xl cursor-pointer border-2 border-gray-200 p-1"
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">Primary Color</label>
            <input
              type="text"
              value={brandingColor}
              onChange={(e) => setBrandingColor(e.target.value)}
              placeholder="#D4AF37"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#d4a017] focus:border-transparent"
            />
            <p className="text-xs text-gray-400 mt-1">Used for buttons, accents, and highlights throughout your app</p>
          </div>
        </div>

        {/* Color Preview */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-sm font-medium text-gray-700 mb-3">Preview</p>
          <div className="flex items-center gap-3">
            <button
              className="px-6 py-2.5 rounded-xl text-white text-sm font-semibold"
              style={{ backgroundColor: brandingColor }}
            >
              Sample Button
            </button>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: brandingColor }} />
              <span className="text-sm text-gray-600">Active indicator</span>
            </div>
          </div>
        </div>
      </div>

      {/* Background Image (Ultra/Enterprise only) */}
      {currentFeatures?.customBackground && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Background Image</h3>
          <p className="text-gray-600 text-sm mb-4">Set a custom background image for your auth/login page.</p>
          <ImageUpload
            value={brandingBackgroundImage}
            onChange={setBrandingBackgroundImage}
            placeholder="Or paste background image URL here"
          />
        </div>
      )}

      {/* Save Button */}
      <div className="flex items-center gap-3">
        <button
          onClick={async () => {
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
                    await updateDoc(doc(db, 'tenants', tenantId), {
                      'config.logo': brandingLogo || null,
                      'config.primaryColor': brandingColor,
                      'config.backgroundImage': brandingBackgroundImage || null,
                      updatedAt: new Date().toISOString(),
                    });
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
          }}
          disabled={brandingSaving}
          className="px-6 py-2.5 bg-[#d4a017] text-white rounded-xl text-sm font-semibold hover:bg-[#b8941a] transition-colors disabled:opacity-50"
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
